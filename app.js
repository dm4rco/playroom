import { parseDecklist } from './js/parser.js';
import { fetchCardData } from './js/scryfall.js';
import { loadDecks, upsertDeck, deleteDeck, renameDeck } from './js/storage.js';
import { renderDeck } from './js/render.js';

const els = {
  deckList: document.getElementById('deck-list'),
  newDeckBtn: document.getElementById('new-deck-btn'),
  importPanel: document.getElementById('import-panel'),
  importName: document.getElementById('import-name'),
  importText: document.getElementById('import-text'),
  importSubmit: document.getElementById('import-submit'),
  importCancel: document.getElementById('import-cancel'),
  importStatus: document.getElementById('import-status'),
  main: document.getElementById('main'),
  emptyState: document.getElementById('empty-state'),
  refreshBtn: document.getElementById('refresh-btn'),
  renameBtn: document.getElementById('rename-btn'),
  deleteBtn: document.getElementById('delete-btn'),
  deckActions: document.getElementById('deck-actions'),
};

let currentDeckName = null;

function guessDeckName(cards) {
  const cmd = cards.find(c => c.isCommander);
  return cmd ? cmd.name : `Deck ${new Date().toLocaleDateString()}`;
}

function renderSidebar() {
  const decks = loadDecks();
  const names = Object.keys(decks).sort((a, b) => decks[b].updatedAt - decks[a].updatedAt);

  els.deckList.innerHTML = names.map(name => {
    const d = decks[name];
    const total = d.cards.reduce((s, c) => s + c.qty, 0);
    const active = name === currentDeckName ? 'active' : '';
    return `<li class="deck-list__item ${active}" data-name="${escapeHtml(name)}">
      <span class="deck-list__name">${escapeHtml(name)}</span>
      <span class="deck-list__count">${total}</span>
    </li>`;
  }).join('') || `<li class="deck-list__empty">No decks yet</li>`;

  els.deckList.querySelectorAll('.deck-list__item[data-name]').forEach(li => {
    li.addEventListener('click', () => selectDeck(li.dataset.name));
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function selectDeck(name) {
  currentDeckName = name;
  const decks = loadDecks();
  const deck = decks[name];
  if (!deck) return;

  els.emptyState.classList.add('hidden');
  els.main.classList.remove('hidden');
  els.deckActions.classList.remove('hidden');
  renderDeck(deck, els.main);
  renderSidebar();
}

function showImportPanel(prefillName = '', prefillText = '') {
  els.importPanel.classList.remove('hidden');
  els.emptyState.classList.add('hidden');
  els.main.classList.add('hidden');
  els.importName.value = prefillName;
  els.importText.value = prefillText;
  els.importStatus.textContent = '';
}

function hideImportPanel() {
  els.importPanel.classList.add('hidden');
  if (currentDeckName) {
    els.main.classList.remove('hidden');
  } else {
    els.emptyState.classList.remove('hidden');
  }
}

async function doImport(forceRefresh = false) {
  const text = els.importText.value.trim();
  if (!text) {
    els.importStatus.textContent = 'Paste a decklist first.';
    return;
  }

  const { cards, errors } = parseDecklist(text);
  if (!cards.length) {
    els.importStatus.textContent = 'No valid lines found. Check the format.';
    return;
  }

  const name = els.importName.value.trim() || guessDeckName(cards);

  els.importSubmit.disabled = true;
  els.importStatus.textContent = `Fetching card data from Scryfall (0/${cards.length})...`;

  try {
    const cardData = await fetchCardData(cards, {
      force: forceRefresh,
      onProgress: (done, total) => {
        els.importStatus.textContent = `Fetching card data from Scryfall (${done}/${total})...`;
      },
    });

    for (const c of cards) c.data = cardData[c.key] || null;

    upsertDeck(name, text, cards);
    currentDeckName = name;

    let msg = `Imported "${name}" — ${cards.length} unique cards.`;
    if (errors.length) msg += ` ${errors.length} line(s) could not be parsed.`;
    els.importStatus.textContent = msg;

    setTimeout(() => {
      hideImportPanel();
      selectDeck(name);
    }, errors.length ? 1200 : 300);
  } catch (err) {
    els.importStatus.textContent = `Error: ${err.message}`;
  } finally {
    els.importSubmit.disabled = false;
  }
}

els.newDeckBtn.addEventListener('click', () => showImportPanel());
els.importCancel.addEventListener('click', hideImportPanel);
els.importSubmit.addEventListener('click', () => doImport(false));

els.refreshBtn.addEventListener('click', async () => {
  if (!currentDeckName) return;
  const decks = loadDecks();
  const deck = decks[currentDeckName];
  if (!deck) return;
  els.importName.value = deck.name;
  els.importText.value = deck.rawText;
  showImportPanel(deck.name, deck.rawText);
  await doImport(true);
});

els.renameBtn.addEventListener('click', () => {
  if (!currentDeckName) return;
  const newName = prompt('Rename deck to:', currentDeckName);
  if (!newName || newName === currentDeckName) return;
  renameDeck(currentDeckName, newName);
  currentDeckName = newName;
  selectDeck(newName);
});

els.deleteBtn.addEventListener('click', () => {
  if (!currentDeckName) return;
  if (!confirm(`Delete deck "${currentDeckName}"? This cannot be undone.`)) return;
  deleteDeck(currentDeckName);
  currentDeckName = null;
  els.deckActions.classList.add('hidden');
  els.main.classList.add('hidden');
  els.emptyState.classList.remove('hidden');
  renderSidebar();
});

// init
renderSidebar();
const decks = loadDecks();
const firstDeck = Object.keys(decks).sort((a, b) => decks[b].updatedAt - decks[a].updatedAt)[0];
if (firstDeck) {
  selectDeck(firstDeck);
} else {
  els.emptyState.classList.remove('hidden');
}
