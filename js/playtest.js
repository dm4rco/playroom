const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
const MAX_HISTORY = 50;
const OPENING_HAND_SIZE = 10;
const OPENING_BOTTOM_COUNT = 3;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
      out.push({ uid: `p${n++}-${Math.random().toString(36).slice(2, 7)}`, name: c.name, data: c.data, commander });
    }
  }
  return out;
}

function freshState(deck) {
  const commanderCards = deck.cards.filter(c => c.isCommander);
  const libraryCards = deck.cards.filter(c => !c.isCommander);
  return {
    deckName: deck.name,
    life: 40,
    turn: 1,
    library: shuffle(expand(libraryCards)),
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    command: expand(commanderCards, { commander: true }),
    // >0 while resolving the "draw 10, put N on the bottom" opening hand rule.
    bottomingRemaining: 0,
  };
}

function drawN(state, n) {
  for (let i = 0; i < n && state.library.length; i++) {
    state.hand.push(state.library.shift());
  }
}

// House rule opening hand: draw 10, then the player bottoms 3 of them.
function openingDraw(state) {
  drawN(state, OPENING_HAND_SIZE);
  state.bottomingRemaining = Math.min(OPENING_BOTTOM_COUNT, state.hand.length);
}

function resetGame(deck) {
  const state = freshState(deck);
  openingDraw(state);
  return state;
}

function findZoneOf(state, uid) {
  for (const zone of ZONES) {
    if (state[zone].some(c => c.uid === uid)) return zone;
  }
  return null;
}

// Moves a card between zones. Library placement defaults to the top (next
// draw); pass toBottom to put it on the bottom instead. Moving a card from
// hand to library while an opening-hand bottoming is in progress counts
// against that requirement.
function moveCard(state, uid, toZone, { toBottom = false } = {}) {
  const fromZone = findZoneOf(state, uid);
  if (!fromZone || fromZone === toZone) return false;

  const idx = state[fromZone].findIndex(c => c.uid === uid);
  const [card] = state[fromZone].splice(idx, 1);

  if (toZone === 'library') {
    if (toBottom) state.library.push(card);
    else state.library.unshift(card);
  } else {
    state[toZone].push(card);
  }

  if (fromZone === 'hand' && toZone === 'library' && state.bottomingRemaining > 0) {
    state.bottomingRemaining--;
  }
  return true;
}

function snapshot(state) {
  return {
    deckName: state.deckName,
    life: state.life,
    turn: state.turn,
    library: [...state.library],
    hand: [...state.hand],
    battlefield: [...state.battlefield],
    graveyard: [...state.graveyard],
    exile: [...state.exile],
    command: [...state.command],
    bottomingRemaining: state.bottomingRemaining,
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cardEl(c) {
  const img = c.data.image_small || c.data.image;
  return `<div class="playtest__card" draggable="true" data-uid="${escapeHtml(c.uid)}" title="${escapeHtml(c.name)}">
    <img loading="lazy" src="${escapeHtml(img)}" alt="${escapeHtml(c.name)}">
  </div>`;
}

export function openPlaytest(deck, overlay) {
  let state = resetGame(deck);
  const history = [];

  function pushHistory() {
    history.push(snapshot(state));
    if (history.length > MAX_HISTORY) history.shift();
  }

  function undo() {
    if (!history.length) return;
    state = history.pop();
  }

  function render() {
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
          <button class="btn" data-action="undo" ${history.length ? '' : 'disabled'}>↺ Undo</button>
          <button class="btn" data-action="shuffle">Shuffle Library</button>
          <button class="btn" data-action="draw">Draw Card</button>
          <button class="btn" data-action="mulligan">Mulligan</button>
          <button class="btn" data-action="newgame">New Game</button>
          <button class="btn btn--danger" data-action="exit">Exit</button>
        </div>
      </div>

      ${state.bottomingRemaining > 0 ? `
        <div class="playtest__banner">
          Opening hand: choose <strong>${state.bottomingRemaining}</strong> more card${state.bottomingRemaining === 1 ? '' : 's'} to put on the bottom of your library — click a hand card, or drag it onto the Library pile.
        </div>
      ` : ''}

      <div class="playtest__board">
        ${state.command.length ? `
          <div class="playtest__zone playtest__zone--command" data-dropzone="command">
            <h4>Command Zone</h4>
            <div class="playtest__cards">${state.command.map(cardEl).join('')}</div>
          </div>
        ` : ''}

        <div class="playtest__zone playtest__zone--battlefield" data-dropzone="battlefield">
          <h4>Battlefield <span class="count">${state.battlefield.length}</span></h4>
          <div class="playtest__cards">
            ${state.battlefield.length ? state.battlefield.map(cardEl).join('') : `<span class="playtest__empty-hint">Click or drag a card here to play it.</span>`}
          </div>
        </div>

        <div class="playtest__sidezones">
          <div class="playtest__pile" data-action="draw" data-dropzone="library" title="Library — click to draw, drag a card here to bottom-deck it">
            <strong>${state.library.length}</strong>
            Library
          </div>
          <div class="playtest__pile playtest__pile--gy" data-dropzone="graveyard" title="Graveyard — drag a card here">
            <strong>${state.graveyard.length}</strong>
            Graveyard
          </div>
          <div class="playtest__pile playtest__pile--exile" data-dropzone="exile" title="Exile — drag a card here">
            <strong>${state.exile.length}</strong>
            Exile
          </div>
        </div>
      </div>

      <div class="playtest__zone playtest__zone--hand" data-dropzone="hand">
        <h4>Hand <span class="count">${state.hand.length}</span></h4>
        <div class="playtest__cards">
          ${state.hand.length ? state.hand.map(cardEl).join('') : `<span class="playtest__empty-hint">No cards in hand.</span>`}
        </div>
      </div>
    `;
  }

  overlay.onclick = (e) => {
    const actionEl = e.target.closest('[data-action]');
    const clickedCardEl = e.target.closest('[data-uid]');

    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === 'undo') { undo(); render(); return; }
      if (action === 'exit') { overlay.classList.remove('open'); return; }

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
      const fromZone = findZoneOf(state, uid);
      if (fromZone === 'hand' || fromZone === 'command' || fromZone === 'battlefield') {
        pushHistory();
        if (fromZone === 'hand') {
          if (state.bottomingRemaining > 0) moveCard(state, uid, 'library', { toBottom: true });
          else moveCard(state, uid, 'battlefield');
        } else if (fromZone === 'command') {
          moveCard(state, uid, 'battlefield');
        } else {
          const card = state.battlefield.find(c => c.uid === uid);
          moveCard(state, uid, card.commander ? 'command' : 'graveyard');
        }
        render();
      }
    }
  };

  let draggedUid = null;

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

    const toZone = zone.dataset.dropzone;
    const fromZone = findZoneOf(state, draggedUid);
    if (fromZone && fromZone !== toZone) {
      pushHistory();
      moveCard(state, draggedUid, toZone, { toBottom: toZone === 'library' });
      render();
    }
    draggedUid = null;
  };

  render();
  overlay.classList.add('open');
}
