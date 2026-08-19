import { openLightbox } from './render.js';

const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
const MAX_HISTORY = 50;
const OPENING_HAND_SIZE = 10;
const DBLCLICK_WINDOW = 250;
const BROWSABLE_ZONES = { library: 'Library', graveyard: 'Graveyard', exile: 'Exile', tokens: 'Tokens' };
const DRAW_PILE_KEY = '__draw-pile__';

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function primaryTypeOf(card) {
  const t = card.data?.type_line || '';
  if (t.includes('Land')) return 'land';
  if (t.includes('Creature')) return 'creature';
  return 'other';
}

// Splits the battlefield into Creatures / Other / Lands for display, so
// permanents are easy to scan at a glance instead of one undifferentiated pile.
function battlefieldGroups(battlefield) {
  return {
    creatures: battlefield.filter(c => primaryTypeOf(c) === 'creature'),
    others: battlefield.filter(c => primaryTypeOf(c) === 'other'),
    lands: battlefield.filter(c => primaryTypeOf(c) === 'land'),
  };
}

// Expands qty-based deck entries into individual card instances (one Mountain
// entry with qty 11 becomes 11 separate objects), since goldfishing draws
// physical copies, not stacks.
function expand(cardList, { commander = false } = {}) {
  const out = [];
  let n = 0;
  for (const c of cardList) {
    if (!c.data || c.data.notFound) continue;
    for (let i = 0; i < c.qty; i++) {
      out.push({ uid: `p${n++}-${Math.random().toString(36).slice(2, 7)}`, name: c.name, data: c.data, commander, tapped: false, isToken: false });
    }
  }
  return out;
}

// Tokens are an unlimited supply, not real cards — spawn a fresh instance
// each time one is played rather than removing it from the catalog.
function spawnToken(tokenTemplate) {
  return {
    uid: `t${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: tokenTemplate.name,
    data: tokenTemplate.data,
    commander: false,
    tapped: false,
    isToken: true,
  };
}

function freshState(deck) {
  const commanderCards = deck.cards.filter(c => c.isCommander);
  const libraryCards = deck.cards.filter(c => !c.isCommander);
  return {
    deckName: deck.name,
    hasCommander: commanderCards.length > 0,
    life: 40,
    turn: 1,
    library: shuffle(expand(libraryCards)),
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    command: expand(commanderCards, { commander: true }),
  };
}

function drawN(state, n) {
  for (let i = 0; i < n && state.library.length; i++) {
    state.hand.push(state.library.shift());
  }
}

function resetGame(deck) {
  const state = freshState(deck);
  drawN(state, OPENING_HAND_SIZE);
  return state;
}

function locateCard(state, uid) {
  for (const zone of ZONES) {
    const card = state[zone].find(c => c.uid === uid);
    if (card) return { zone, card };
  }
  return null;
}

// Moves a card between zones. Library placement defaults to the top (next
// draw); pass toBottom to put it on the bottom instead. Tap state clears
// whenever a card enters or leaves the battlefield. Tokens cease to exist
// once they leave the battlefield, same as in paper Magic.
function moveCard(state, uid, toZone, { toBottom = false } = {}) {
  const located = locateCard(state, uid);
  if (!located || located.zone === toZone) return false;
  const { zone: fromZone, card } = located;

  const idx = state[fromZone].findIndex(c => c.uid === uid);
  state[fromZone].splice(idx, 1);
  card.tapped = false;

  if (fromZone === 'battlefield' && card.isToken) return true;

  if (toZone === 'library') {
    if (toBottom) state.library.push(card);
    else state.library.unshift(card);
  } else {
    state[toZone].push(card);
  }
  return true;
}

function snapshot(state) {
  return {
    deckName: state.deckName,
    hasCommander: state.hasCommander,
    life: state.life,
    turn: state.turn,
    library: [...state.library],
    hand: [...state.hand],
    battlefield: [...state.battlefield],
    graveyard: [...state.graveyard],
    exile: [...state.exile],
    command: [...state.command],
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cardEl(c) {
  const img = c.data.image_small || c.data.image;
  return `<div class="playtest__card-slot">
    <div class="playtest__card${c.tapped ? ' tapped' : ''}" draggable="true" data-uid="${escapeHtml(c.uid)}" title="${escapeHtml(c.name)}">
      <img loading="lazy" src="${escapeHtml(img)}" alt="${escapeHtml(c.name)}">
    </div>
  </div>`;
}

function cardRow(cards) {
  return cards.length ? cards.map(cardEl).join('') : '';
}

// Token catalog tiles (in the Tokens browser) aren't real card instances —
// no uid, not draggable — clicking one spawns a fresh copy onto the battlefield.
function tokenTileEl(t) {
  const img = t.data.image_small || t.data.image;
  return `<div class="playtest__card-slot">
    <div class="playtest__card" data-token-name="${escapeHtml(t.name)}" title="${escapeHtml(t.name)}">
      <img loading="lazy" src="${escapeHtml(img)}" alt="${escapeHtml(t.name)}">
    </div>
  </div>`;
}

export function openPlaytest(deck, overlay) {
  let state = resetGame(deck);
  const deckTokens = deck.tokens || [];
  const undoStack = [];
  let pendingClick = null; // { id, uid } for the debounced single click awaiting a possible double-click
  let draggedUid = null;
  let browsingZone = null; // 'library' | 'graveyard' | 'exile' | null — which zone's full contents are on screen

  function pushHistory() {
    undoStack.push(snapshot(state));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
  }

  function undo() {
    if (!undoStack.length) return;
    state = undoStack.pop();
  }

  function openCardLightbox(card) {
    openLightbox({
      full: card.data.image || card.data.image_small,
      uri: card.data.scryfall_uri,
      name: card.name,
      price: '',
    });
  }

  // Leaving a library browse (closing it, or switching to browse a
  // different zone) always reshuffles — you searched your library, so per
  // the rules it gets shuffled again, hiding the order you just revealed.
  function setBrowsingZone(newZone) {
    if (browsingZone === 'library' && newZone !== 'library') {
      pushHistory();
      state.library = shuffle(state.library);
    }
    browsingZone = newZone;
    render();
  }

  function render() {
    const { creatures, others, lands } = battlefieldGroups(state.battlefield);

    overlay.innerHTML = `
      <div class="playtest__topbar">
        <div class="playtest__title">${escapeHtml(state.deckName)} — Goldfish Test</div>
        <div class="playtest__controls">
          <span class="playtest__stat">Turn
            <button data-action="turn-dec">−</button>
            <strong>${state.turn}</strong>
            <button data-action="turn-inc">+</button>
          </span>
          <span class="playtest__stat">Life
            <button data-action="life-dec">−</button>
            <strong>${state.life}</strong>
            <button data-action="life-inc">+</button>
          </span>
          <button class="btn" data-action="undo" ${undoStack.length ? '' : 'disabled'}>↺ Undo</button>
          <button class="btn" data-action="shuffle">Shuffle Library</button>
          <button class="btn" data-action="draw">Draw Card</button>
          <button class="btn" data-action="mulligan">Mulligan</button>
          <button class="btn" data-action="newgame">New Game</button>
          <button class="btn btn--danger" data-action="exit">Exit</button>
        </div>
      </div>

      <div class="playtest__hint">Hand: click to view, drag to play. Battlefield: click to tap/untap. Command Zone / Library / Graveyard / Exile / Tokens: click a card to play it. Double-click Library/Graveyard/Exile/Tokens to browse. Arrow keys: turn (←→), life (↑↓). Browser Back: undo.</div>

      <div class="playtest__board">
        <div class="playtest__leftcol">
          ${state.hasCommander ? `
            <div class="playtest__zone playtest__zone--command" data-dropzone="command">
              <h4>Command Zone</h4>
              <div class="playtest__cards">
                ${state.command.length ? cardRow(state.command) : `<span class="playtest__empty-hint">Empty — click or drag your commander here.</span>`}
              </div>
            </div>
          ` : ''}
          <div class="playtest__pile playtest__pile--tokens" data-browse="tokens" title="Tokens — double-click to browse, click one there to create it on the battlefield">
            <strong>∞</strong>
            Tokens
          </div>
        </div>

        <div class="playtest__zone playtest__zone--battlefield" data-dropzone="battlefield">
          <h4>Battlefield <span class="count">${state.battlefield.length}</span></h4>
          ${state.battlefield.length ? '' : `<span class="playtest__empty-hint">Drag a card here to play it.</span>`}
          <div class="playtest__battlefield-row">
            <span class="playtest__battlefield-label">Creatures</span>
            <div class="playtest__cards">${cardRow(creatures)}</div>
          </div>
          <div class="playtest__battlefield-row">
            <span class="playtest__battlefield-label">Other</span>
            <div class="playtest__cards">${cardRow(others)}</div>
          </div>
          <div class="playtest__battlefield-row">
            <span class="playtest__battlefield-label">Lands</span>
            <div class="playtest__cards">${cardRow(lands)}</div>
          </div>
        </div>

        <div class="playtest__sidezones">
          <div class="playtest__librarygroup">
            <div class="playtest__pile playtest__pile--libtop" data-action="draw" data-dropzone="library-top" data-browse="library" title="Top of Library — click to draw, double-click to browse, drag here to place on top">
              <strong>${state.library.length}</strong>
              Library
            </div>
            <div class="playtest__pile playtest__pile--libbottom" data-dropzone="library-bottom" data-browse="library" title="Bottom of Library — drag here to bottom-deck, double-click to browse">
              ↓ Bottom
            </div>
          </div>
          <div class="playtest__pile playtest__pile--gy" data-dropzone="graveyard" data-browse="graveyard" title="Graveyard — drag a card here, double-click to browse">
            <strong>${state.graveyard.length}</strong>
            Graveyard
          </div>
          <div class="playtest__pile playtest__pile--exile" data-dropzone="exile" data-browse="exile" title="Exile — drag a card here, double-click to browse">
            <strong>${state.exile.length}</strong>
            Exile
          </div>
        </div>
      </div>

      <div class="playtest__zone playtest__zone--hand" data-dropzone="hand">
        <h4>Hand <span class="count">${state.hand.length}</span></h4>
        <div class="playtest__cards">
          ${state.hand.length ? cardRow(state.hand) : `<span class="playtest__empty-hint">No cards in hand.</span>`}
        </div>
      </div>

      ${browsingZone ? `
        <div class="zone-browser">
          <div class="zone-browser__panel">
            <div class="zone-browser__header">
              <h3>${escapeHtml(BROWSABLE_ZONES[browsingZone])} <span class="count">${browsingZone === 'tokens' ? deckTokens.length : state[browsingZone].length}</span></h3>
              <button class="btn btn--primary" data-action="close-browser">${browsingZone === 'library' ? 'Close & Shuffle' : 'Close'}</button>
            </div>
            <div class="playtest__cards">
              ${browsingZone === 'tokens'
                ? (deckTokens.length ? deckTokens.map(tokenTileEl).join('') : `<span class="playtest__empty-hint">No tokens found for this deck. (Older imports need "Refresh Card Data" to pick up token detection.)</span>`)
                : (state[browsingZone].length ? cardRow(state[browsingZone]) : `<span class="playtest__empty-hint">Nothing here.</span>`)}
            </div>
          </div>
        </div>
      ` : ''}
    `;
  }

  function handleCardClick(uid) {
    const located = locateCard(state, uid);
    if (!located) return;
    const { zone: fromZone, card } = located;

    if (fromZone === 'command') {
      pushHistory();
      moveCard(state, uid, 'battlefield');
      render();
    } else if (fromZone === 'battlefield') {
      pushHistory();
      card.tapped = !card.tapped;
      render();
    } else if (browsingZone === fromZone) {
      // Tutoring/recursion: clicking a card while browsing Library/Graveyard/Exile plays it.
      pushHistory();
      moveCard(state, uid, 'battlefield');
      render();
    }
  }

  overlay.onclick = (e) => {
    const actionEl = e.target.closest('[data-action]');
    const clickedCardEl = e.target.closest('[data-uid]');

    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === 'undo') { undo(); render(); return; }
      if (action === 'exit') { cleanup(); overlay.classList.remove('open'); return; }
      if (action === 'close-browser') { setBrowsingZone(null); return; }

      if (action === 'draw' && actionEl.dataset.browse) {
        // Only the library PILE (not the separate "Draw Card" button) is
        // also a double-click target for browsing, so only it needs to
        // debounce — otherwise two quick draws in a row would cancel out.
        if (pendingClick && pendingClick.uid === DRAW_PILE_KEY) {
          clearTimeout(pendingClick.id);
          pendingClick = null;
          return;
        }
        const id = setTimeout(() => {
          pendingClick = null;
          pushHistory();
          drawN(state, 1);
          render();
        }, DBLCLICK_WINDOW);
        pendingClick = { id, uid: DRAW_PILE_KEY };
        return;
      }

      pushHistory();
      if (action === 'draw') drawN(state, 1);
      else if (action === 'shuffle') state.library = shuffle(state.library);
      else if (action === 'mulligan' || action === 'newgame') state = resetGame(deck);
      else if (action === 'life-inc') state.life++;
      else if (action === 'life-dec') state.life--;
      else if (action === 'turn-inc') state.turn++;
      else if (action === 'turn-dec') state.turn = Math.max(1, state.turn - 1);
      render();
      return;
    }

    if (clickedCardEl) {
      const uid = clickedCardEl.dataset.uid;
      const located = locateCard(state, uid);

      // Hand cards are single-purpose: a click always just previews them —
      // moving them is drag-only, so there's no double-click ambiguity to debounce.
      if (located && located.zone === 'hand') {
        openCardLightbox(located.card);
        return;
      }

      // A second click on the SAME card within the window means this is a
      // double-click — let ondblclick handle it instead of also playing/
      // tapping the card. Clicks on other cards schedule independently.
      if (pendingClick && pendingClick.uid === uid) {
        clearTimeout(pendingClick.id);
        pendingClick = null;
        return;
      }
      const id = setTimeout(() => {
        pendingClick = null;
        handleCardClick(uid);
      }, DBLCLICK_WINDOW);
      pendingClick = { id, uid };
      return;
    }

    const tokenEl = e.target.closest('[data-token-name]');
    if (tokenEl) {
      const key = `__token__:${tokenEl.dataset.tokenName}`;
      // Same debounce as cards, keyed by name — a double-click should
      // preview the token, not spawn two of it.
      if (pendingClick && pendingClick.uid === key) {
        clearTimeout(pendingClick.id);
        pendingClick = null;
        return;
      }
      const id = setTimeout(() => {
        pendingClick = null;
        const template = deckTokens.find(t => t.name === tokenEl.dataset.tokenName);
        if (template) {
          pushHistory();
          state.battlefield.push(spawnToken(template));
          render();
        }
      }, DBLCLICK_WINDOW);
      pendingClick = { id, uid: key };
    }
  };

  overlay.ondblclick = (e) => {
    const clickedCardEl = e.target.closest('[data-uid]');
    if (clickedCardEl) {
      if (pendingClick && pendingClick.uid === clickedCardEl.dataset.uid) {
        clearTimeout(pendingClick.id);
        pendingClick = null;
      }
      const located = locateCard(state, clickedCardEl.dataset.uid);
      if (!located) return;
      openCardLightbox(located.card);
      return;
    }

    const tokenEl = e.target.closest('[data-token-name]');
    if (tokenEl) {
      const key = `__token__:${tokenEl.dataset.tokenName}`;
      if (pendingClick && pendingClick.uid === key) {
        clearTimeout(pendingClick.id);
        pendingClick = null;
      }
      const template = deckTokens.find(t => t.name === tokenEl.dataset.tokenName);
      if (template) openCardLightbox(template);
      return;
    }

    const pile = e.target.closest('[data-browse]');
    if (pile) {
      if (pendingClick && pendingClick.uid === DRAW_PILE_KEY) {
        clearTimeout(pendingClick.id);
        pendingClick = null;
      }
      setBrowsingZone(pile.dataset.browse);
    }
  };

  overlay.ondragstart = (e) => {
    const el = e.target.closest('[data-uid]');
    if (!el) return;
    draggedUid = el.dataset.uid;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedUid);
  };

  overlay.ondragover = (e) => {
    const zone = e.target.closest('[data-dropzone]');
    if (!zone) return;
    e.preventDefault();
    zone.classList.add('drop-hover');
  };

  overlay.ondragleave = (e) => {
    const zone = e.target.closest('[data-dropzone]');
    if (zone) zone.classList.remove('drop-hover');
  };

  overlay.ondrop = (e) => {
    const zone = e.target.closest('[data-dropzone]');
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('drop-hover');
    if (!draggedUid) return;

    let toZone = zone.dataset.dropzone;
    let toBottom = false;
    if (toZone === 'library-top') { toZone = 'library'; toBottom = false; }
    else if (toZone === 'library-bottom') { toZone = 'library'; toBottom = true; }

    const located = locateCard(state, draggedUid);
    if (located && located.zone !== toZone) {
      pushHistory();
      moveCard(state, draggedUid, toZone, { toBottom });
      render();
    }
    draggedUid = null;
  };

  function onKeyDown(e) {
    if (!overlay.classList.contains('open')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'ArrowLeft') { e.preventDefault(); pushHistory(); state.turn = Math.max(1, state.turn - 1); render(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); pushHistory(); state.turn++; render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); pushHistory(); state.life++; render(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); pushHistory(); state.life--; render(); }
  }

  // Pressing the browser Back button undoes the last action instead of
  // navigating away, by keeping one extra history entry "primed" for us to
  // intercept — we refill it after every undo so Back keeps working.
  function onPopState() {
    if (!overlay.classList.contains('open')) return;
    undo();
    render();
    window.history.pushState({ playtestGuard: true }, '');
  }

  function cleanup() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('popstate', onPopState);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('popstate', onPopState);
  window.history.pushState({ playtestGuard: true }, '');

  render();
  overlay.classList.add('open');
}
