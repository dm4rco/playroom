// Rendered with Preact+htm, loaded straight from a CDN as ES modules — no
// build step, no npm, still deployable by just pushing files. Keyed diffing
// means DOM nodes for unchanged cards persist across renders (rather than
// every action tearing down and rebuilding the whole zone), which is what
// makes things like the hand's scroll position survive a redraw.
import { h, render as preactRender } from 'https://esm.sh/preact@10.19.6';
import { useState, useRef, useEffect } from 'https://esm.sh/preact@10.19.6/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);
const PREVIEW_OFFSET = 20;

// Floating full-size preview shown while hovering any card — a single
// reused DOM node updated directly (bypassing Preact) since mousemove needs
// to stay smooth and doesn't need to go through a re-render.
function ensurePreviewEl() {
  let el = document.getElementById('card-hover-preview');
  if (!el) {
    el = document.createElement('div');
    el.id = 'card-hover-preview';
    el.className = 'card-hover-preview';
    el.appendChild(document.createElement('img'));
    document.body.appendChild(el);
  }
  return el;
}

function positionPreview(el, x, y) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = el.offsetWidth || 280, h = el.offsetHeight || 391;
  let left = x + PREVIEW_OFFSET;
  let top = y + PREVIEW_OFFSET;
  if (left + w > vw) left = x - w - PREVIEW_OFFSET;
  if (top + h > vh) top = Math.max(10, vh - h - 10);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function showCardPreview(src, x, y) {
  const el = ensurePreviewEl();
  const img = el.querySelector('img');
  if (img.src !== src) img.src = src;
  positionPreview(el, x, y);
  el.classList.add('open');
}

function moveCardPreview(x, y) {
  const el = document.getElementById('card-hover-preview');
  if (el && el.classList.contains('open')) positionPreview(el, x, y);
}

function hideCardPreview() {
  document.getElementById('card-hover-preview')?.classList.remove('open');
}

const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
const MAX_HISTORY = 50;
const OPENING_HAND_SIZE = 10;
const DBLCLICK_WINDOW = 250;
const BROWSABLE_ZONES = { library: 'Library', graveyard: 'Graveyard', exile: 'Exile', tokens: 'Tokens' };
const DRAW_PILE_KEY = '__draw-pile__';
const HAND_SORT_TYPE_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'];

// ---------- Pure game logic (unchanged from playtest.js) ----------

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

function battlefieldGroups(battlefield) {
  return {
    creatures: battlefield.filter(c => primaryTypeOf(c) === 'creature'),
    others: battlefield.filter(c => primaryTypeOf(c) === 'other'),
    lands: battlefield.filter(c => primaryTypeOf(c) === 'land'),
  };
}

function handSortTypeRank(card) {
  const t = card.data?.type_line || '';
  const idx = HAND_SORT_TYPE_ORDER.findIndex(x => t.includes(x));
  return idx === -1 ? HAND_SORT_TYPE_ORDER.length : idx;
}

function sortHand(hand, mode) {
  if (mode === 'cmc') hand.sort((a, b) => (a.data.cmc - b.data.cmc) || a.name.localeCompare(b.name));
  else if (mode === 'type') hand.sort((a, b) => (handSortTypeRank(a) - handSortTypeRank(b)) || a.name.localeCompare(b.name));
  else if (mode === 'name') hand.sort((a, b) => a.name.localeCompare(b.name));
}

function expand(cardList, { commander = false } = {}) {
  const out = [];
  let n = 0;
  for (const c of cardList) {
    if (!c.data || c.data.notFound) continue;
    for (let i = 0; i < c.qty; i++) {
      out.push({ uid: `p${n++}-${Math.random().toString(36).slice(2, 7)}`, name: c.name, data: c.data, commander, tapped: false, flipped: false, isToken: false });
    }
  }
  return out;
}

function spawnToken(tokenTemplate) {
  return {
    uid: `t${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: tokenTemplate.name,
    data: tokenTemplate.data,
    commander: false,
    tapped: false,
    flipped: false,
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

// Reorders a card within the same zone (e.g. dragging the 3rd hand card to
// the front) — a pure array-position move, no zone transfer.
function reorderWithinZone(state, zone, draggedUid, targetUid, insertAfter) {
  const arr = state[zone];
  const fromIdx = arr.findIndex(c => c.uid === draggedUid);
  if (fromIdx === -1) return false;
  const [card] = arr.splice(fromIdx, 1);
  let toIdx = arr.findIndex(c => c.uid === targetUid);
  if (toIdx === -1) { arr.push(card); return true; }
  if (insertAfter) toIdx++;
  arr.splice(toIdx, 0, card);
  return true;
}

// Cards carry mutable per-instance flags (tapped, flipped) that get changed
// in place on the live objects. A snapshot has to clone each card, not just
// the zone arrays — otherwise a later mutation of the same object would
// silently "reach back" and corrupt an already-saved snapshot, breaking undo.
function cloneCard(c) {
  return { ...c };
}

function snapshot(state) {
  return {
    deckName: state.deckName,
    hasCommander: state.hasCommander,
    life: state.life,
    turn: state.turn,
    library: state.library.map(cloneCard),
    hand: state.hand.map(cloneCard),
    battlefield: state.battlefield.map(cloneCard),
    graveyard: state.graveyard.map(cloneCard),
    exile: state.exile.map(cloneCard),
    command: state.command.map(cloneCard),
  };
}

// ---------- Rendering (Preact) ----------

function CardTile({ c, onClick, onDragStart, onContextMenu, onCardDragOver, onCardDragLeave, onCardDrop, tight }) {
  const showingBack = c.flipped && c.data.backImage;
  const smallImg = showingBack ? (c.data.backImageSmall || c.data.backImage) : (c.data.image_small || c.data.image);
  const fullImg = showingBack ? (c.data.backImage || c.data.backImageSmall) : (c.data.image || c.data.image_small);
  const displayName = showingBack ? (c.data.backName || c.name) : c.name;
  return html`
    <div class=${`playtest__card-slot${tight ? ' playtest__card-slot--tight' : ''}`} key=${c.uid}>
      <div
        class=${`playtest__card${c.tapped ? ' tapped' : ''}`}
        draggable="true"
        title=${displayName}
        data-uid=${c.uid}
        onClick=${onClick}
        onDragStart=${onDragStart}
        onContextMenu=${onContextMenu}
        onDragOver=${onCardDragOver}
        onDragLeave=${onCardDragLeave}
        onDrop=${onCardDrop}
        onMouseEnter=${(e) => showCardPreview(fullImg, e.clientX, e.clientY)}
        onMouseMove=${(e) => moveCardPreview(e.clientX, e.clientY)}
        onMouseLeave=${() => hideCardPreview()}
      >
        <img loading="lazy" src=${smallImg} alt=${displayName} />
        ${c.data.backImage ? html`<span class="playtest__card-flip-badge" title="Right-click to flip">⟲</span>` : ''}
      </div>
    </div>
  `;
}

// Overlaps consecutive same-named battlefield cards more tightly than
// different cards — you don't need to see 10 identical Treasures clearly,
// just that there are 10 of them.
function withStackTightness(cards) {
  return cards.map((c, i) => ({ card: c, tight: i > 0 && cards[i - 1].name === c.name }));
}

function TokenTile({ t, onClick }) {
  const smallImg = t.data.image_small || t.data.image;
  const fullImg = t.data.image || t.data.image_small;
  return html`
    <div class="playtest__card-slot" key=${t.name}>
      <div
        class="playtest__card"
        title=${t.name}
        data-token-name=${t.name}
        onClick=${onClick}
        onMouseEnter=${(e) => showCardPreview(fullImg, e.clientX, e.clientY)}
        onMouseMove=${(e) => moveCardPreview(e.clientX, e.clientY)}
        onMouseLeave=${() => hideCardPreview()}
      >
        <img loading="lazy" src=${smallImg} alt=${t.name} />
      </div>
    </div>
  `;
}

function App({ deck, overlay, onExit }) {
  const [state, setState] = useState(() => resetGame(deck));
  const [browsingZone, setBrowsingZoneState] = useState(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const undoStack = useRef([]);
  const pendingClick = useRef(null); // { id, uid } — only used to debounce the Library pile's click-to-draw vs. double-click-to-browse
  const draggedUid = useRef(null);
  const deckTokens = deck.tokens || [];

  const commit = () => setState({ ...stateRef.current });

  const pushHistory = () => {
    undoStack.current.push(snapshot(stateRef.current));
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
  };

  const undo = () => {
    if (!undoStack.current.length) return;
    setState(undoStack.current.pop());
  };

  const setBrowsingZone = (newZone) => {
    if (browsingZone === 'library' && newZone !== 'library') {
      pushHistory();
      stateRef.current.library = shuffle(stateRef.current.library);
      setState({ ...stateRef.current });
    }
    setBrowsingZoneState(newZone);
  };

  // Hovering shows the full-size preview (see CardTile/TokenTile), so a
  // click's only job is the zone's primary action — no double-click
  // ambiguity to debounce, so every click fires immediately.
  const handleCardClick = (uid) => {
    const located = locateCard(stateRef.current, uid);
    if (!located) return;
    const { zone: fromZone, card } = located;

    if (fromZone === 'hand' || fromZone === 'command') {
      pushHistory();
      moveCard(stateRef.current, uid, 'battlefield');
      commit();
    } else if (fromZone === 'battlefield') {
      pushHistory();
      card.tapped = !card.tapped;
      commit();
    } else if (browsingZone === fromZone) {
      pushHistory();
      moveCard(stateRef.current, uid, 'battlefield');
      commit();
    }
  };

  const onCardClick = (uid) => (e) => {
    e.stopPropagation();
    handleCardClick(uid);
  };

  const onCardContextMenu = (uid) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const located = locateCard(stateRef.current, uid);
    if (!located || !located.card.data.backImage) return;
    pushHistory();
    located.card.flipped = !located.card.flipped;
    commit();
  };

  const onTokenClick = (template) => (e) => {
    e.stopPropagation();
    pushHistory();
    stateRef.current.battlefield.push(spawnToken(template));
    commit();
  };

  const onDragStart = (uid) => (e) => {
    hideCardPreview();
    draggedUid.current = uid;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', uid);
  };

  // Manual reordering within Hand/Battlefield: dropping one card onto
  // another (same zone) inserts it before/after based on cursor position,
  // instead of the usual "drop anywhere in the zone" cross-zone move. Drags
  // from a different zone fall through untouched to the zone's own drop
  // handler (zoneDropProps), which does the normal cross-zone move.
  const onCardDragOver = (zone, targetUid) => (e) => {
    const dragged = draggedUid.current;
    if (!dragged || dragged === targetUid) return;
    const located = locateCard(stateRef.current, dragged);
    if (!located || located.zone !== zone) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const insertAfter = (e.clientX - rect.left) > rect.width / 2;
    e.currentTarget.classList.toggle('insert-before', !insertAfter);
    e.currentTarget.classList.toggle('insert-after', insertAfter);
  };

  const onCardDragLeaveReorder = (e) => {
    e.currentTarget.classList.remove('insert-before', 'insert-after');
  };

  const onCardDropReorder = (zone, targetUid) => (e) => {
    const dragged = draggedUid.current;
    e.currentTarget.classList.remove('insert-before', 'insert-after');
    if (!dragged || dragged === targetUid) return;
    const located = locateCard(stateRef.current, dragged);
    if (!located || located.zone !== zone) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const insertAfter = (e.clientX - rect.left) > rect.width / 2;
    pushHistory();
    reorderWithinZone(stateRef.current, zone, dragged, targetUid, insertAfter);
    commit();
    draggedUid.current = null;
  };

  const zoneDropProps = (zoneName, toBottom = false) => ({
    onDragOver: (e) => { e.preventDefault(); e.currentTarget.classList.add('drop-hover'); },
    onDragLeave: (e) => { e.currentTarget.classList.remove('drop-hover'); },
    onDrop: (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove('drop-hover');
      if (!draggedUid.current) return;
      const located = locateCard(stateRef.current, draggedUid.current);
      if (located && located.zone !== zoneName) {
        pushHistory();
        moveCard(stateRef.current, draggedUid.current, zoneName, { toBottom });
        commit();
      }
      draggedUid.current = null;
    },
  });

  const onDrawPileClick = (e) => {
    e.stopPropagation();
    if (pendingClick.current && pendingClick.current.uid === DRAW_PILE_KEY) {
      clearTimeout(pendingClick.current.id);
      pendingClick.current = null;
      return;
    }
    const id = setTimeout(() => {
      pendingClick.current = null;
      pushHistory();
      drawN(stateRef.current, 1);
      commit();
    }, DBLCLICK_WINDOW);
    pendingClick.current = { id, uid: DRAW_PILE_KEY };
  };

  const onBrowsePile = (zoneName) => (e) => {
    e.stopPropagation();
    if (pendingClick.current && pendingClick.current.uid === DRAW_PILE_KEY) {
      clearTimeout(pendingClick.current.id);
      pendingClick.current = null;
    }
    setBrowsingZone(zoneName);
  };

  const doAction = (fn) => () => { pushHistory(); fn(); commit(); };

  const onSortHand = (mode) => (e) => {
    e.stopPropagation();
    pushHistory();
    sortHand(stateRef.current.hand, mode);
    commit();
  };

  // Arrow keys (turn/life) and the browser Back button (undo), same as the
  // vanilla version. Registered once per mount, cleaned up on unmount.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!overlay.classList.contains('open')) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      if (e.key === 'ArrowLeft' || key === 'a') { e.preventDefault(); pushHistory(); stateRef.current.turn = Math.max(1, stateRef.current.turn - 1); commit(); }
      else if (e.key === 'ArrowRight' || key === 'd') { e.preventDefault(); pushHistory(); stateRef.current.turn++; commit(); }
      else if (e.key === 'ArrowUp' || key === 'w') { e.preventDefault(); pushHistory(); stateRef.current.life++; commit(); }
      else if (e.key === 'ArrowDown' || key === 's') { e.preventDefault(); pushHistory(); stateRef.current.life--; commit(); }
      else if (e.code === 'Space') { e.preventDefault(); pushHistory(); drawN(stateRef.current, 1); commit(); }
      else if (e.key === 'Enter') { e.preventDefault(); setBrowsingZoneState('library'); }
    };
    const onPopState = () => {
      if (!overlay.classList.contains('open')) return;
      undo();
      window.history.pushState({ playtestGuard: true }, '');
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('popstate', onPopState);
    window.history.pushState({ playtestGuard: true }, '');
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const { creatures, others, lands } = battlefieldGroups(state.battlefield);

  return html`
    <div class="playtest__topbar">
      <div class="playtest__title">${state.deckName} — Goldfish Test</div>
      <div class="playtest__controls">
        <span class="playtest__stat">Turn
          <button onClick=${doAction(() => { stateRef.current.turn = Math.max(1, stateRef.current.turn - 1); })}>−</button>
          <strong>${state.turn}</strong>
          <button onClick=${doAction(() => { stateRef.current.turn++; })}>+</button>
        </span>
        <span class="playtest__stat">Life
          <button onClick=${doAction(() => { stateRef.current.life--; })}>−</button>
          <strong>${state.life}</strong>
          <button onClick=${doAction(() => { stateRef.current.life++; })}>+</button>
        </span>
        <button class="btn" disabled=${!undoStack.current.length} onClick=${() => undo()}>↺ Undo</button>
        <button class="btn" onClick=${doAction(() => { stateRef.current.library = shuffle(stateRef.current.library); })}>Shuffle Library</button>
        <button class="btn" onClick=${doAction(() => drawN(stateRef.current, 1))}>Draw Card</button>
        <button class="btn" onClick=${() => setState(resetGame(deck))}>Mulligan</button>
        <button class="btn" onClick=${() => setState(resetGame(deck))}>New Game</button>
        <button class="btn btn--danger" onClick=${onExit}>Exit</button>
      </div>
    </div>

    <div class="playtest__hint">Hover any card to see it full-size. Right-click a double-faced card to flip it. Hand: click to play. Battlefield: click to tap/untap. Command Zone: click a card to play it. Library: click to draw, double-click (or Enter) to browse. Graveyard / Exile / Tokens: click to browse. Drag any card to any zone — drop it on another card in Hand or Battlefield to reorder. Space: draw a card. Arrow keys or WASD: turn (←→/AD), life (↑↓/WS). Browser Back: undo.</div>

    <div class="playtest__board">
      <div class="playtest__leftcol">
        ${state.hasCommander ? html`
          <div class="playtest__zone playtest__zone--command" ...${zoneDropProps('command')}>
            <h4>Command Zone</h4>
            <div class="playtest__cards">
              ${state.command.length
                ? state.command.map(c => html`<${CardTile} c=${c} onClick=${onCardClick(c.uid)} onDragStart=${onDragStart(c.uid)} onContextMenu=${onCardContextMenu(c.uid)} />`)
                : html`<span class="playtest__empty-hint">Empty — click or drag your commander here.</span>`}
            </div>
          </div>
        ` : ''}
        <div class="playtest__pile playtest__pile--tokens" onClick=${onBrowsePile('tokens')} title="Tokens — click to browse, click one there to create it on the battlefield">
          <strong>∞</strong>
          Tokens
        </div>
      </div>

      <div class="playtest__zone playtest__zone--battlefield" ...${zoneDropProps('battlefield')}>
        <h4>Battlefield <span class="count">${state.battlefield.length}</span></h4>
        ${state.battlefield.length ? '' : html`<span class="playtest__empty-hint">Drag a card here to play it.</span>`}
        <div class="playtest__battlefield-row">
          <span class="playtest__battlefield-label">Creatures</span>
          <div class="playtest__cards">
            ${withStackTightness(creatures).map(({ card: c, tight }) => html`<${CardTile} c=${c} tight=${tight} onClick=${onCardClick(c.uid)} onDragStart=${onDragStart(c.uid)} onContextMenu=${onCardContextMenu(c.uid)} onCardDragOver=${onCardDragOver('battlefield', c.uid)} onCardDragLeave=${onCardDragLeaveReorder} onCardDrop=${onCardDropReorder('battlefield', c.uid)} />`)}
          </div>
        </div>
        <div class="playtest__battlefield-row">
          <span class="playtest__battlefield-label">Other</span>
          <div class="playtest__cards">
            ${withStackTightness(others).map(({ card: c, tight }) => html`<${CardTile} c=${c} tight=${tight} onClick=${onCardClick(c.uid)} onDragStart=${onDragStart(c.uid)} onContextMenu=${onCardContextMenu(c.uid)} onCardDragOver=${onCardDragOver('battlefield', c.uid)} onCardDragLeave=${onCardDragLeaveReorder} onCardDrop=${onCardDropReorder('battlefield', c.uid)} />`)}
          </div>
        </div>
        <div class="playtest__battlefield-row">
          <span class="playtest__battlefield-label">Lands</span>
          <div class="playtest__cards">
            ${withStackTightness(lands).map(({ card: c, tight }) => html`<${CardTile} c=${c} tight=${tight} onClick=${onCardClick(c.uid)} onDragStart=${onDragStart(c.uid)} onContextMenu=${onCardContextMenu(c.uid)} onCardDragOver=${onCardDragOver('battlefield', c.uid)} onCardDragLeave=${onCardDragLeaveReorder} onCardDrop=${onCardDropReorder('battlefield', c.uid)} />`)}
          </div>
        </div>
      </div>

      <div class="playtest__sidezones">
        <div class="playtest__librarygroup">
          <div class="playtest__pile playtest__pile--libtop" onClick=${onDrawPileClick} onDblClick=${onBrowsePile('library')} ...${zoneDropProps('library', false)} title="Top of Library — click to draw, double-click to browse, drag here to place on top">
            <strong>${state.library.length}</strong>
            Library
          </div>
          <div class="playtest__pile playtest__pile--libbottom" onDblClick=${onBrowsePile('library')} ...${zoneDropProps('library', true)} title="Bottom of Library — drag here to bottom-deck, double-click to browse">
            ↓ Bottom
          </div>
        </div>
        <div class="playtest__pile playtest__pile--gy" onClick=${onBrowsePile('graveyard')} ...${zoneDropProps('graveyard')} title="Graveyard — click to browse, drag a card here">
          <strong>${state.graveyard.length}</strong>
          Graveyard
        </div>
        <div class="playtest__pile playtest__pile--exile" onClick=${onBrowsePile('exile')} ...${zoneDropProps('exile')} title="Exile — click to browse, drag a card here">
          <strong>${state.exile.length}</strong>
          Exile
        </div>
      </div>
    </div>

    <div class="playtest__zone playtest__zone--hand" ...${zoneDropProps('hand')}>
      <h4>Hand <span class="count">${state.hand.length}</span>
        <span class="playtest__sort">
          Sort:
          <button onClick=${onSortHand('cmc')}>CMC</button>
          <button onClick=${onSortHand('type')}>Type</button>
          <button onClick=${onSortHand('name')}>Name</button>
        </span>
      </h4>
      <div class="playtest__cards playtest__cards--hand">
        ${state.hand.length
          ? state.hand.map(c => html`<${CardTile} c=${c} onClick=${onCardClick(c.uid)} onDragStart=${onDragStart(c.uid)} onContextMenu=${onCardContextMenu(c.uid)} onCardDragOver=${onCardDragOver('hand', c.uid)} onCardDragLeave=${onCardDragLeaveReorder} onCardDrop=${onCardDropReorder('hand', c.uid)} />`)
          : html`<span class="playtest__empty-hint">No cards in hand.</span>`}
      </div>
    </div>

    ${browsingZone ? html`
      <div class="zone-browser">
        <div class="zone-browser__panel">
          <div class="zone-browser__header">
            <h3>${BROWSABLE_ZONES[browsingZone]} <span class="count">${browsingZone === 'tokens' ? deckTokens.length : state[browsingZone].length}</span></h3>
            <button class="btn btn--primary" onClick=${() => setBrowsingZone(null)}>${browsingZone === 'library' ? 'Close & Shuffle' : 'Close'}</button>
          </div>
          <div class="playtest__cards">
            ${browsingZone === 'tokens'
              ? (deckTokens.length
                  ? deckTokens.map(t => html`<${TokenTile} t=${t} onClick=${onTokenClick(t)} />`)
                  : html`<span class="playtest__empty-hint">No tokens found for this deck.</span>`)
              : (state[browsingZone].length
                  ? state[browsingZone].map(c => html`<${CardTile} c=${c} onClick=${onCardClick(c.uid)} onDragStart=${onDragStart(c.uid)} onContextMenu=${onCardContextMenu(c.uid)} />`)
                  : html`<span class="playtest__empty-hint">Nothing here.</span>`)}
          </div>
        </div>
      </div>
    ` : ''}
  `;
}

export function openPlaytest(deck, overlay) {
  // Force a fresh component instance every time Playtest is opened (matches
  // the vanilla version starting a new game each time) rather than Preact
  // reusing the previous session's state.
  const sessionKey = `${Date.now()}-${Math.random()}`;
  preactRender(
    html`<${App} key=${sessionKey} deck=${deck} overlay=${overlay} onExit=${() => overlay.classList.remove('open')} />`,
    overlay,
  );
  overlay.classList.add('open');
}
