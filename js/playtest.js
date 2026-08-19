// Rendered with Preact+htm, loaded straight from a CDN as ES modules — no
// build step, no npm, still deployable by just pushing files. Keyed diffing
// means DOM nodes for unchanged cards persist across renders (rather than
// every action tearing down and rebuilding the whole zone), which is what
// makes things like the hand's scroll position survive a redraw.
import { h, render as preactRender } from 'https://esm.sh/preact@10.19.6';
import { useState, useRef, useEffect } from 'https://esm.sh/preact@10.19.6/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import { openLightbox } from './render.js';

const html = htm.bind(h);

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
      out.push({ uid: `p${n++}-${Math.random().toString(36).slice(2, 7)}`, name: c.name, data: c.data, commander, tapped: false, isToken: false });
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

// ---------- Rendering (Preact) ----------

function CardTile({ c, onClick, onDblClick, onDragStart, tight }) {
  const img = c.data.image_small || c.data.image;
  return html`
    <div class=${`playtest__card-slot${tight ? ' playtest__card-slot--tight' : ''}`} key=${c.uid}>
      <div
        class=${`playtest__card${c.tapped ? ' tapped' : ''}`}
        draggable="true"
        title=${c.name}
        data-uid=${c.uid}
        onClick=${onClick}
        onDblClick=${onDblClick}
        onDragStart=${onDragStart}
      >
        <img loading="lazy" src=${img} alt=${c.name} />
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

function TokenTile({ t, onClick, onDblClick }) {
  const img = t.data.image_small || t.data.image;
  return html`
    <div class="playtest__card-slot" key=${t.name}>
      <div class="playtest__card" title=${t.name} data-token-name=${t.name} onClick=${onClick} onDblClick=${onDblClick}>
        <img loading="lazy" src=${img} alt=${t.name} />
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
  const pendingClick = useRef(null); // { id, uid }
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

  const openCardLightbox = (card) => {
    openLightbox({
      full: card.data.image || card.data.image_small,
      uri: card.data.scryfall_uri,
      name: card.name,
      price: '',
    });
  };

  const setBrowsingZone = (newZone) => {
    if (browsingZone === 'library' && newZone !== 'library') {
      pushHistory();
      stateRef.current.library = shuffle(stateRef.current.library);
      setState({ ...stateRef.current });
    }
    setBrowsingZoneState(newZone);
  };

  const handleCardClick = (uid) => {
    const located = locateCard(stateRef.current, uid);
    if (!located) return;
    const { zone: fromZone, card } = located;

    if (fromZone === 'command') {
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

  // Debounced single-click (vs. double-click preview), shared by
  // command/battlefield/browsed-zone cards.
  const onCardClick = (uid) => (e) => {
    e.stopPropagation();
    if (pendingClick.current && pendingClick.current.uid === uid) {
      clearTimeout(pendingClick.current.id);
      pendingClick.current = null;
      return;
    }
    const id = setTimeout(() => {
      pendingClick.current = null;
      handleCardClick(uid);
    }, DBLCLICK_WINDOW);
    pendingClick.current = { id, uid };
  };

  const onCardDblClick = (uid, card) => (e) => {
    e.stopPropagation();
    if (pendingClick.current && pendingClick.current.uid === uid) {
      clearTimeout(pendingClick.current.id);
      pendingClick.current = null;
    }
    openCardLightbox(card);
  };

  // Hand cards: click always previews, immediately — no debounce needed.
  const onHandCardClick = (card) => (e) => {
    e.stopPropagation();
    openCardLightbox(card);
  };

  const onTokenClick = (template) => (e) => {
    e.stopPropagation();
    pushHistory();
    stateRef.current.battlefield.push(spawnToken(template));
    commit();
  };

  const onTokenDblClick = (template) => (e) => {
    e.stopPropagation();
    openCardLightbox(template);
  };

  const onDragStart = (uid) => (e) => {
    draggedUid.current = uid;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', uid);
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
      if (e.key === 'ArrowLeft') { e.preventDefault(); pushHistory(); stateRef.current.turn = Math.max(1, stateRef.current.turn - 1); commit(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); pushHistory(); stateRef.current.turn++; commit(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); pushHistory(); stateRef.current.life++; commit(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); pushHistory(); stateRef.current.life--; commit(); }
      else if (e.code === 'Space') { e.preventDefault(); pushHistory(); drawN(stateRef.current, 1); commit(); }
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

    <div class="playtest__hint">Hand: click to view, drag to play. Battlefield: click to tap/untap. Command Zone: click a card to play it. Library: click to draw, double-click to browse. Graveyard / Exile / Tokens: click to browse. Drag any card to any zone. Space: draw a card. Arrow keys: turn (←→), life (↑↓). Browser Back: undo.</div>

    <div class="playtest__board">
      <div class="playtest__leftcol">
        ${state.hasCommander ? html`
          <div class="playtest__zone playtest__zone--command" ...${zoneDropProps('command')}>
            <h4>Command Zone</h4>
            <div class="playtest__cards">
              ${state.command.length
                ? state.command.map(c => html`<${CardTile} c=${c} onClick=${onCardClick(c.uid)} onDblClick=${onCardDblClick(c.uid, c)} onDragStart=${onDragStart(c.uid)} />`)
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
            ${withStackTightness(creatures).map(({ card: c, tight }) => html`<${CardTile} c=${c} tight=${tight} onClick=${onCardClick(c.uid)} onDblClick=${onCardDblClick(c.uid, c)} onDragStart=${onDragStart(c.uid)} />`)}
          </div>
        </div>
        <div class="playtest__battlefield-row">
          <span class="playtest__battlefield-label">Other</span>
          <div class="playtest__cards">
            ${withStackTightness(others).map(({ card: c, tight }) => html`<${CardTile} c=${c} tight=${tight} onClick=${onCardClick(c.uid)} onDblClick=${onCardDblClick(c.uid, c)} onDragStart=${onDragStart(c.uid)} />`)}
          </div>
        </div>
        <div class="playtest__battlefield-row">
          <span class="playtest__battlefield-label">Lands</span>
          <div class="playtest__cards">
            ${withStackTightness(lands).map(({ card: c, tight }) => html`<${CardTile} c=${c} tight=${tight} onClick=${onCardClick(c.uid)} onDblClick=${onCardDblClick(c.uid, c)} onDragStart=${onDragStart(c.uid)} />`)}
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
          ? state.hand.map(c => html`<${CardTile} c=${c} onClick=${onHandCardClick(c)} onDblClick=${onHandCardClick(c)} onDragStart=${onDragStart(c.uid)} />`)
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
                  ? deckTokens.map(t => html`<${TokenTile} t=${t} onClick=${onTokenClick(t)} onDblClick=${onTokenDblClick(t)} />`)
                  : html`<span class="playtest__empty-hint">No tokens found for this deck.</span>`)
              : (state[browsingZone].length
                  ? state[browsingZone].map(c => html`<${CardTile} c=${c} onClick=${onCardClick(c.uid)} onDblClick=${onCardDblClick(c.uid, c)} onDragStart=${onDragStart(c.uid)} />`)
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
