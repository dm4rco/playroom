import { parseDecklist } from './js/parser.js';
import { fetchCardData, fetchTokenData } from './js/scryfall.js';
import { loadDecks, upsertDeck, deleteDeck, renameDeck } from './js/storage.js';
import { renderDeck } from './js/render.js';
import { fetchArchidektDeck } from './js/archidekt.js';
import { openPlaytest } from './js/playtest.js';

const els = {
  deckList: document.getElementById('deck-list'),
  newDeckBtn: document.getElementById('new-deck-btn'),
  importPanel: document.getElementById('import-panel'),
  importTitle: document.getElementById('import-title'),
  importName: document.getElementById('import-name'),
  importText: document.getElementById('import-text'),
  importSubmit: document.getElementById('import-submit'),
  importCancel: document.getElementById('import-cancel'),
  importStatus: document.getElementById('import-status'),
  archidektUrl: document.getElementById('archidekt-url'),
  archidektFetchBtn: document.getElementById('archidekt-fetch-btn'),
  main: document.getElementById('main'),
  emptyState: document.getElementById('empty-state'),
  editBtn: document.getElementById('edit-btn'),
  refreshBtn: document.getElementById('refresh-btn'),
  renameBtn: document.getElementById('rename-btn'),
  deleteBtn: document.getElementById('delete-btn'),
  deckActions: document.getElementById('deck-actions'),
  playtestBtn: document.getElementById('playtest-btn'),
  playtestOverlay: document.getElementById('playtest-overlay'),
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  mobileSidebarToggle: document.getElementById('mobile-sidebar-toggle'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
};

let currentDeckName = null;
// Set while the import panel is open for an existing deck, so we can tell
// doImport whether to overwrite that deck (and clean up a rename) vs create a new one.
let editingOriginalName = null;

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
  els.playtestBtn.classList.remove('hidden');
  renderDeck(deck, els.main);
  renderSidebar();
  closeMobileSidebar();
}

function showImportPanel(prefillName = '', prefillText = '', isEdit = false) {
  editingOriginalName = isEdit ? currentDeckName : null;
  els.importTitle.textContent = isEdit ? 'Edit Decklist' : 'Import Decklist';
  els.importPanel.classList.remove('hidden');
  els.emptyState.classList.add('hidden');
  els.main.classList.add('hidden');
  els.importName.value = prefillName;
  els.importText.value = prefillText;
  els.importStatus.textContent = '';
}

function hideImportPanel() {
  editingOriginalName = null;
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

    els.importStatus.textContent = 'Checking for tokens...';
    const tokenRefs = cards.flatMap(c => c.data?.tokenParts || []);
    const tokens = tokenRefs.length ? await fetchTokenData(tokenRefs) : [];

    const wasEditing = editingOriginalName !== null;
    upsertDeck(name, text, cards, tokens);
    if (editingOriginalName && editingOriginalName !== name) {
      deleteDeck(editingOriginalName);
    }
    editingOriginalName = null;
    currentDeckName = name;

    let msg = `${wasEditing ? 'Saved' : 'Imported'} "${name}" — ${cards.length} unique cards.`;
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

els.newDeckBtn.addEventListener('click', () => { showImportPanel(); closeMobileSidebar(); });
els.importCancel.addEventListener('click', hideImportPanel);
els.importSubmit.addEventListener('click', () => doImport(false));

els.editBtn.addEventListener('click', () => {
  if (!currentDeckName) return;
  const decks = loadDecks();
  const deck = decks[currentDeckName];
  if (!deck) return;
  showImportPanel(deck.name, deck.rawText, true);
});

els.refreshBtn.addEventListener('click', async () => {
  if (!currentDeckName) return;
  const decks = loadDecks();
  const deck = decks[currentDeckName];
  if (!deck) return;
  showImportPanel(deck.name, deck.rawText, true);
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
  els.playtestBtn.classList.add('hidden');
  els.main.classList.add('hidden');
  els.emptyState.classList.remove('hidden');
  renderSidebar();
});

els.archidektFetchBtn.addEventListener('click', async () => {
  const input = els.archidektUrl.value.trim();
  if (!input) {
    els.importStatus.textContent = 'Paste an Archidekt deck URL first.';
    return;
  }
  els.archidektFetchBtn.disabled = true;
  els.importStatus.textContent = 'Fetching deck from Archidekt...';
  try {
    const { name, text } = await fetchArchidektDeck(input);
    els.importName.value = name;
    els.importText.value = text;
    els.importStatus.textContent = `Loaded "${name}" from Archidekt — review below, then click Import.`;
  } catch (err) {
    els.importStatus.textContent = `Error: ${err.message}`;
  } finally {
    els.archidektFetchBtn.disabled = false;
  }
});

els.playtestBtn.addEventListener('click', () => {
  if (!currentDeckName) return;
  const decks = loadDecks();
  const deck = decks[currentDeckName];
  if (!deck) return;
  openPlaytest(deck, els.playtestOverlay);
});

const SIDEBAR_COLLAPSED_KEY = 'edh_sidebar_collapsed';
const isMobileViewport = () => window.matchMedia('(max-width: 700px)').matches;
// On desktop "collapsed" shrinks the sidebar to an icon rail — a real
// preference, persisted. On mobile the same class instead means the drawer
// is off-screen, which is a transient per-visit thing (always starts
// closed), not a preference — kept in memory only, on its own variable, so
// testing/using the drawer on a phone can never leave a desktop visit
// stuck collapsed (they used to share one localStorage key).
let mobileDrawerOpen = false;

function applySidebarState() {
  const collapsed = isMobileViewport()
    ? !mobileDrawerOpen
    : localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  els.sidebar.classList.toggle('collapsed', collapsed);
  els.sidebarToggle.textContent = collapsed ? '›' : '‹';
  els.sidebarToggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  els.sidebarBackdrop.classList.toggle('visible', !collapsed);
}

function setSidebarCollapsed(collapsed) {
  if (isMobileViewport()) mobileDrawerOpen = !collapsed;
  else localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  applySidebarState();
}

// Only meaningful on mobile (the sidebar isn't an overlay on desktop, so
// there's nothing to close) — called after an action that reveals content
// the drawer would otherwise be covering.
function closeMobileSidebar() {
  if (isMobileViewport()) setSidebarCollapsed(true);
}

els.sidebarToggle.addEventListener('click', () => {
  setSidebarCollapsed(!els.sidebar.classList.contains('collapsed'));
});
els.mobileSidebarToggle.addEventListener('click', () => setSidebarCollapsed(false));
els.sidebarBackdrop.addEventListener('click', () => setSidebarCollapsed(true));

// A ready-made deck so a friend trying the playtester doesn't have to bring
// their own — seeded once, ever, regardless of what happens to it after
// (rename, edit, even delete) so deleting it is permanent, not "until next
// visit". Runs after the normal deck-selection below so it never steals
// focus from a deck a returning user already has open.
const DEFAULT_DECK_URL = 'https://archidekt.com/decks/7404579/indominus_rex';
const DEFAULT_DECK_SEEDED_KEY = 'edh_default_deck_seeded';

async function ensureDefaultDeck() {
  if (localStorage.getItem(DEFAULT_DECK_SEEDED_KEY) === '1') return;
  try {
    const { name, text } = await fetchArchidektDeck(DEFAULT_DECK_URL);
    const { cards } = parseDecklist(text);
    if (!cards.length) return;
    const cardData = await fetchCardData(cards, {});
    for (const c of cards) c.data = cardData[c.key] || null;
    const tokenRefs = cards.flatMap(c => c.data?.tokenParts || []);
    const tokens = tokenRefs.length ? await fetchTokenData(tokenRefs) : [];
    upsertDeck(name, text, cards, tokens);
    localStorage.setItem(DEFAULT_DECK_SEEDED_KEY, '1');
    renderSidebar();
    if (!currentDeckName) selectDeck(name);
  } catch {
    // Archidekt/proxy/Scryfall hiccup — skip quietly and try again next
    // visit (the flag above is only set on success), the user can still
    // import their own decks normally in the meantime.
  }
}

// init
applySidebarState();
renderSidebar();
const decks = loadDecks();
const firstDeck = Object.keys(decks).sort((a, b) => decks[b].updatedAt - decks[a].updatedAt)[0];
if (firstDeck) {
  selectDeck(firstDeck);
} else {
  els.emptyState.classList.remove('hidden');
}
ensureDefaultDeck();
