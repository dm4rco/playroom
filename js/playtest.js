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

function newState(deck) {
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
    command: expand(commanderCards, { commander: true }),
  };
}

function drawN(state, n) {
  for (let i = 0; i < n && state.library.length; i++) {
    state.hand.push(state.library.shift());
  }
}

function moveByUid(fromArr, toArr, uid) {
  const idx = fromArr.findIndex(c => c.uid === uid);
  if (idx === -1) return false;
  const [card] = fromArr.splice(idx, 1);
  toArr.push(card);
  return true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cardEl(c) {
  const img = c.data.image_small || c.data.image;
  return `<div class="playtest__card" data-uid="${escapeHtml(c.uid)}" title="${escapeHtml(c.name)}">
    <img loading="lazy" src="${escapeHtml(img)}" alt="${escapeHtml(c.name)}">
  </div>`;
}

export function openPlaytest(deck, overlay) {
  let state = newState(deck);
  drawN(state, 7);

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
          <button class="btn" data-action="draw">Draw Card</button>
          <button class="btn" data-action="mulligan">Mulligan</button>
          <button class="btn" data-action="newgame">New Game</button>
          <button class="btn btn--danger" data-action="exit">Exit</button>
        </div>
      </div>

      <div class="playtest__board">
        ${state.command.length ? `
          <div class="playtest__zone playtest__zone--command">
            <h4>Command Zone</h4>
            <div class="playtest__cards">${state.command.map(cardEl).join('')}</div>
          </div>
        ` : ''}

        <div class="playtest__zone playtest__zone--battlefield">
          <h4>Battlefield <span class="count">${state.battlefield.length}</span></h4>
          <div class="playtest__cards">
            ${state.battlefield.length ? state.battlefield.map(cardEl).join('') : `<span class="playtest__empty-hint">Click a card in your hand to play it here.</span>`}
          </div>
        </div>

        <div class="playtest__sidezones">
          <div class="playtest__pile" data-action="draw" title="Library — click to draw">
            <strong>${state.library.length}</strong>
            Library
          </div>
          <div class="playtest__pile playtest__pile--gy" title="Graveyard">
            <strong>${state.graveyard.length}</strong>
            Graveyard
          </div>
        </div>
      </div>

      <div class="playtest__zone playtest__zone--hand">
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
      if (action === 'draw') drawN(state, 1);
      else if (action === 'mulligan') {
        state.library.push(...state.hand);
        state.hand = [];
        state.library = shuffle(state.library);
        drawN(state, 7);
      } else if (action === 'newgame') {
        state = newState(deck);
        drawN(state, 7);
      } else if (action === 'life-inc') state.life++;
      else if (action === 'life-dec') state.life--;
      else if (action === 'turn-inc') state.turn++;
      else if (action === 'turn-dec') state.turn = Math.max(1, state.turn - 1);
      else if (action === 'exit') {
        overlay.classList.remove('open');
        return;
      }
      render();
      return;
    }

    if (clickedCardEl) {
      const uid = clickedCardEl.dataset.uid;
      if (moveByUid(state.hand, state.battlefield, uid)) { render(); return; }
      if (state.command.some(c => c.uid === uid)) {
        moveByUid(state.command, state.battlefield, uid);
        render();
        return;
      }
      const onBattlefield = state.battlefield.find(c => c.uid === uid);
      if (onBattlefield) {
        if (onBattlefield.commander) moveByUid(state.battlefield, state.command, uid);
        else moveByUid(state.battlefield, state.graveyard, uid);
        render();
      }
    }
  };

  render();
  overlay.classList.add('open');
}
