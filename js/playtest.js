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

// Floating "lifted card" shown while pointer-dragging — a single reused DOM
// node, same pattern as the hover preview. Pointer Events unify mouse and
// touch, which is what lets dragging work on mobile without a separate code
// path for desktop.
function ensureGhostEl() {
  let el = document.getElementById('card-drag-ghost');
  if (!el) {
    el = document.createElement('div');
    el.id = 'card-drag-ghost';
    el.className = 'card-drag-ghost';
    el.appendChild(document.createElement('img'));
    // Shown only when dragging a multi-selected group — the count of other
    // cards coming along for the ride, so it's clear it's not just the one.
    const count = document.createElement('span');
    count.className = 'card-drag-ghost__count';
    el.appendChild(count);
    document.body.appendChild(el);
  }
  return el;
}

function positionGhost(el, x, y) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

// Marquee-select rectangle on the battlefield canvas — same reused-DOM-node
// pattern as the ghost/preview, so dragging the box stays smooth.
function ensureMarqueeEl() {
  let el = document.getElementById('battlefield-marquee');
  if (!el) {
    el = document.createElement('div');
    el.id = 'battlefield-marquee';
    el.className = 'playtest__selection-box';
    document.body.appendChild(el);
  }
  return el;
}

function positionMarquee(el, x1, y1, x2, y2) {
  el.style.left = `${Math.min(x1, x2)}px`;
  el.style.top = `${Math.min(y1, y2)}px`;
  el.style.width = `${Math.abs(x2 - x1)}px`;
  el.style.height = `${Math.abs(y2 - y1)}px`;
}

const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];
const MAX_HISTORY = 50;
const OPENING_HAND_SIZE = 10;
const DBLCLICK_WINDOW = 250;
const BROWSABLE_ZONES = { library: 'Library', graveyard: 'Graveyard', exile: 'Exile', tokens: 'Tokens' };
const DRAW_PILE_KEY = '__draw-pile__';
const HAND_SORT_TYPE_ORDER = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'];
const DRAG_THRESHOLD = 6; // px of pointer movement before a press becomes a drag, not a click
const LONG_PRESS_DELAY = 550; // ms — touch has no hover, so a held (but still) press peeks a full-size preview instead
const CARD_SCALE_KEY = 'edh_card_scale';
const CARD_SCALE_STEP = 0.1;
const CARD_SCALE_MIN = 0.5;
const CARD_SCALE_MAX = 1.3;
const CARD_SCALE_DEFAULT = 0.8; // a bit smaller out of the box — the Battlefield reads as cluttered at full size once it has more than a few cards

// Short and worth actually memorizing — everything else (click to play,
// drag to move, etc.) is discoverable on its own and doesn't need a tip.
const TIPS = [
  { action: 'Adjust turn', control: '← → or A D' },
  { action: 'Adjust life', control: '↑ ↓ or W S' },
  { action: 'Draw a card', control: 'Space' },
  { action: 'Browse the Library (tutor effects)', control: 'Enter' },
  { action: 'Collapse/expand Command Zone', control: 'C' },
  { action: 'Fullscreen Battlefield (hide everything else)', control: 'B' },
  { action: 'Mulligan', control: 'M' },
  { action: 'Send selected cards to Graveyard', control: 'Delete' },
  { action: 'Toggle this panel', control: 'T' },
  { action: 'Undo', control: 'Browser Back' },
  { action: 'Flip a double-faced card', control: 'Right-click' },
];

// ---------- Pure game logic (unchanged from playtest.js) ----------

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
      out.push({ uid: `p${n++}-${Math.random().toString(36).slice(2, 7)}`, name: c.name, data: c.data, commander, tapped: false, flipped: false, isToken: false, counters: {} });
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
    counters: {},
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
  sortHand(state.hand, 'cmc'); // a reasonable default for a fresh opening hand — sort buttons re-sort it however from here
  return state;
}

function locateCard(state, uid) {
  for (const zone of ZONES) {
    const card = state[zone].find(c => c.uid === uid);
    if (card) return { zone, card };
  }
  return null;
}

// Default landing spot for a card played by click (no drop coordinate to go
// on) — cascades across a loose grid so successive plays don't all pile on
// the same spot, wrapping back to the top-left after a few rows. Kept
// within a band ([24, 80]) that stays clear of the card's own half-height
// at any card/canvas size actually in use (see battlefieldDropPosition for
// the precise version used for drag-drops, which has live DOM to measure).
function nextCascadePosition(battlefield) {
  const cols = 6, startX = 12, startY = 24, stepX = 13, stepY = 16;
  const n = battlefield.length;
  const col = n % cols;
  const row = Math.floor(n / cols) % 4;
  return { x: startX + col * stepX, y: startY + row * stepY };
}

function moveCard(state, uid, toZone, { toBottom = false, x, y } = {}) {
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
    if (toZone === 'battlefield') {
      const pos = (x != null && y != null) ? { x, y } : nextCascadePosition(state.battlefield);
      card.x = pos.x;
      card.y = pos.y;
    }
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
// counters is nested, so it relies on adjustCounter() always replacing that
// object wholesale (never mutating its keys in place) for this shallow copy
// to be safe — same trick, no deep clone needed.
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

function CardTile({ c, zone, onClick, onPointerDown, onContextMenu, onFlipClick, onCountersClick, onDuplicateClick, selected }) {
  const showingBack = c.flipped && c.data.backImage;
  const smallImg = showingBack ? (c.data.backImageSmall || c.data.backImage) : (c.data.image_small || c.data.image);
  const fullImg = showingBack ? (c.data.backImage || c.data.backImageSmall) : (c.data.image || c.data.image_small);
  const displayName = showingBack ? (c.data.backName || c.name) : c.name;
  const onBattlefield = zone === 'battlefield';
  // Counters (+1/+1, -1/-1, or anything custom) only make sense on a
  // permanent, so only the battlefield gets the badge.
  const counterTotal = onBattlefield ? Object.values(c.counters || {}).reduce((s, n) => s + n, 0) : 0;
  // Battlefield cards are freely positioned (left/top, in % of the canvas)
  // instead of flowing in a row — everywhere else keeps the normal layout.
  const slotStyle = onBattlefield ? `left:${c.x}%; top:${c.y}%;` : '';
  return html`
    <div class=${`playtest__card-slot${onBattlefield ? ' playtest__card-slot--free' : ''}`} style=${slotStyle} key=${c.uid}>
      <div
        class=${`playtest__card${c.tapped ? ' tapped' : ''}${selected ? ' selected' : ''}`}
        data-uid=${c.uid}
        data-zone=${zone}
        onClick=${onClick}
        onPointerDown=${onPointerDown}
        onContextMenu=${onContextMenu}
        onMouseEnter=${(e) => showCardPreview(fullImg, e.clientX, e.clientY)}
        onMouseMove=${(e) => moveCardPreview(e.clientX, e.clientY)}
        onMouseLeave=${() => hideCardPreview()}
      >
        <img loading="lazy" src=${smallImg} alt=${displayName} />
        ${c.data.backImage ? html`<span class="playtest__card-flip-badge" title="Flip: tap this, or right-click the card" onClick=${onFlipClick} onPointerDown=${(e) => e.stopPropagation()}>⟲</span>` : ''}
        ${onBattlefield ? html`<span class=${`playtest__card-counter-badge${counterTotal ? '' : ' playtest__card-counter-badge--empty'}`} title="Counters" onClick=${onCountersClick} onPointerDown=${(e) => e.stopPropagation()}>${counterTotal || '+'}</span>` : ''}
        ${onBattlefield ? html`<span class="playtest__card-dup-badge" title="Duplicate this card" onClick=${onDuplicateClick} onPointerDown=${(e) => e.stopPropagation()}>⧉</span>` : ''}
      </div>
    </div>
  `;
}

function TokenTile({ t, onClick }) {
  const smallImg = t.data.image_small || t.data.image;
  const fullImg = t.data.image || t.data.image_small;
  return html`
    <div class="playtest__card-slot" key=${t.name}>
      <div
        class="playtest__card"
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
  const [showTips, setShowTips] = useState(false);
  const [bottomRowPinned, setBottomRowPinned] = useState(true); // pins Hand/Library/Graveyard/Exile open by default — a fresh board has room to spare; unpin once the Battlefield fills up and needs the space back
  const [leftColCollapsed, setLeftColCollapsed] = useState(true); // collapses Command Zone + Tokens — starts collapsed, Battlefield matters more
  const [topbarCollapsed, setTopbarCollapsed] = useState(true); // collapses the secondary controls row + hint (Turn/Life/Exit stay put) — starts collapsed
  const [battlefieldFullscreen, setBattlefieldFullscreen] = useState(false); // B — everything but the Battlefield disappears
  const [cardScale, setCardScale] = useState(() => {
    const saved = parseFloat(localStorage.getItem(CARD_SCALE_KEY));
    return Number.isFinite(saved) ? saved : CARD_SCALE_DEFAULT;
  });
  const [countersFor, setCountersFor] = useState(null); // uid of the battlefield card whose counters panel is open, if any
  const [newCounterName, setNewCounterName] = useState('');
  const [selectedUids, setSelectedUids] = useState(() => new Set()); // battlefield multi-select, via marquee drag on empty canvas
  const stateRef = useRef(state);
  stateRef.current = state;
  // Mirrors selectedUids for the keydown effect below, which is registered
  // once (empty deps, so it never re-subscribes and re-pushes browser
  // history) and would otherwise only ever see the selection from mount.
  const selectedUidsRef = useRef(selectedUids);
  selectedUidsRef.current = selectedUids;
  const undoStack = useRef([]);
  const pendingClick = useRef(null); // { id, uid } — only used to debounce the Library pile's click-to-draw vs. double-click-to-browse
  const dragRef = useRef(null); // { uid, fromZone, startX, startY, dragging, previewImg, lastTarget, lastX, lastY, longPressTimer, longPressFired } — the in-flight pointer drag, if any
  const marqueeRef = useRef(null); // { canvasEl, startX, startY, moved } — the in-flight battlefield marquee-select, if any
  const suppressClickUntil = useRef(0); // Date.now() cutoff — swallows the ghost click a drag or long-press-flip leaves behind
  const deckTokens = deck.tokens || [];

  // --card-scale is set inline (highest specificity a stylesheet can't
  // easily out-rank) so it works the same whether the current breakpoint's
  // base card size comes from the desktop rule or the landscape-mobile one.
  useEffect(() => {
    overlay.style.setProperty('--card-scale', cardScale);
  }, [cardScale]);

  const adjustCardScale = (delta) => {
    const next = Math.round(Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, cardScale + delta)) * 100) / 100;
    setCardScale(next);
    localStorage.setItem(CARD_SCALE_KEY, String(next));
  };

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
      // Clicking a card that's part of the current multi-selection taps/
      // untaps the whole group together; clicking outside it acts on just
      // that card and drops the selection.
      if (selectedUids.size > 1 && selectedUids.has(uid)) {
        const newTapped = !card.tapped;
        selectedUids.forEach(u => {
          const found = locateCard(stateRef.current, u);
          if (found && found.zone === 'battlefield') found.card.tapped = newTapped;
        });
      } else {
        card.tapped = !card.tapped;
        if (selectedUids.size) setSelectedUids(new Set());
      }
      commit();
    } else if (browsingZone === fromZone) {
      pushHistory();
      moveCard(stateRef.current, uid, 'battlefield');
      commit();
    }
  };

  const onCardClick = (uid) => (e) => {
    e.stopPropagation();
    if (Date.now() < suppressClickUntil.current) return; // ghost click left behind by a drag or long-press flip
    handleCardClick(uid);
  };

  const flipCard = (uid) => {
    const located = locateCard(stateRef.current, uid);
    if (!located || !located.card.data.backImage) return;
    pushHistory();
    located.card.flipped = !located.card.flipped;
    commit();
  };

  const onCardContextMenu = (uid) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    flipCard(uid);
  };

  // Same action as right-click, but as an actual tap target — the badge is
  // the only flip trigger that works on touch without a long-press.
  const onFlipBadgeClick = (uid) => (e) => {
    e.stopPropagation();
    flipCard(uid);
  };

  const onCountersClick = (uid) => (e) => {
    e.stopPropagation();
    setCountersFor(uid);
  };

  // counters is replaced wholesale rather than mutated in place — see the
  // note on cloneCard for why that matters for undo.
  const adjustCounter = (uid, type, delta) => {
    const located = locateCard(stateRef.current, uid);
    if (!located) return;
    pushHistory();
    const next = (located.card.counters?.[type] || 0) + delta;
    const counters = { ...located.card.counters };
    if (next <= 0) delete counters[type];
    else counters[type] = next;
    located.card.counters = counters;
    commit();
  };

  const onAddCounterType = () => {
    const type = newCounterName.trim();
    if (!type) return;
    adjustCounter(countersFor, type, 1);
    setNewCounterName('');
  };

  // A fresh copy of a battlefield card — same printed card, new instance:
  // untapped, no counters, offset slightly so it doesn't sit exactly on top
  // of the original.
  const onDuplicateClick = (uid) => (e) => {
    e.stopPropagation();
    const located = locateCard(stateRef.current, uid);
    if (!located || located.zone !== 'battlefield') return;
    pushHistory();
    const copy = {
      ...cloneCard(located.card),
      uid: `d${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      tapped: false,
      counters: {},
      x: Math.min(97, (located.card.x ?? 50) + 4),
      y: Math.min(95, (located.card.y ?? 50) + 4),
    };
    stateRef.current.battlefield.push(copy);
    commit();
  };

  // Delete key with cards selected — the highlighted battlefield cards die
  // to the Graveyard together, same target zone dragging them there would use.
  const sendSelectedToGraveyard = () => {
    const uids = selectedUidsRef.current;
    if (!uids.size) return;
    pushHistory();
    uids.forEach(u => {
      const found = locateCard(stateRef.current, u);
      if (found?.zone === 'battlefield') moveCard(stateRef.current, u, 'graveyard');
    });
    setSelectedUids(new Set());
    commit();
  };

  const onTokenClick = (template) => (e) => {
    e.stopPropagation();
    pushHistory();
    stateRef.current.battlefield.push(spawnToken(template));
    commit();
  };

  // Pointer-based drag-and-drop: Pointer Events fire the same way for mouse,
  // touch, and pen, so this one implementation covers both desktop drag and
  // mobile touch-drag (unlike the native HTML5 DnD API it replaces, which
  // never fires on touch at all). A press only becomes a "drag" once the
  // pointer moves past DRAG_THRESHOLD — short of that it's left alone so the
  // element's native click still fires normally (play/tap/etc), on both
  // mouse and touch.
  const clearDropHighlights = () => {
    document.querySelectorAll('.drop-hover').forEach(el => el.classList.remove('drop-hover'));
    document.querySelectorAll('.insert-before, .insert-after').forEach(el => el.classList.remove('insert-before', 'insert-after'));
  };

  const endDrag = () => {
    if (dragRef.current?.longPressTimer) clearTimeout(dragRef.current.longPressTimer);
    document.getElementById('card-drag-ghost')?.classList.remove('open');
    hideCardPreview(); // in case a long-press peek was open
    clearDropHighlights();
    dragRef.current = null;
  };

  // Hit-tests whatever's under the pointer: another card in the same zone
  // (reorder) beats a zone/pile drop target (cross-zone move) beats nothing.
  const resolveDropTarget = (x, y, fromZone, uid) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    // Battlefield is freely positioned now, so a card dropped there always
    // just lands at the drop point — card-on-card "reorder" only still
    // makes sense for the row-based zones (Hand, Command Zone).
    if (fromZone !== 'battlefield') {
      const cardEl = el.closest('[data-uid]');
      if (cardEl && cardEl.dataset.uid !== uid && cardEl.dataset.zone === fromZone) {
        const rect = cardEl.getBoundingClientRect();
        const insertAfter = (x - rect.left) > rect.width / 2;
        return { kind: 'reorder', el: cardEl, targetUid: cardEl.dataset.uid, insertAfter };
      }
    }
    const zoneEl = el.closest('[data-dropzone]');
    if (zoneEl) return { kind: 'zone', el: zoneEl, zoneName: zoneEl.dataset.dropzone, toBottom: zoneEl.dataset.toBottom === 'true' };
    return null;
  };

  const onPointerCancelGlobal = () => {
    window.removeEventListener('pointermove', onPointerMoveGlobal);
    window.removeEventListener('pointerup', onPointerUpGlobal);
    window.removeEventListener('pointercancel', onPointerCancelGlobal);
    endDrag();
  };

  const onPointerMoveGlobal = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.dragging) {
      const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      if (dist < DRAG_THRESHOLD) return;
      clearTimeout(drag.longPressTimer); // a real drag takes priority over a pending long-press flip
      drag.dragging = true;
      hideCardPreview();
      const ghost = ensureGhostEl();
      ghost.querySelector('img').src = drag.previewImg;
      const countEl = ghost.querySelector('.card-drag-ghost__count');
      if (drag.groupUids?.length > 1) {
        countEl.textContent = `+${drag.groupUids.length - 1}`;
        countEl.classList.add('open');
      } else {
        countEl.classList.remove('open');
      }
      ghost.classList.add('open');
    }
    e.preventDefault(); // stop touch-scroll once an actual drag is underway
    positionGhost(document.getElementById('card-drag-ghost'), e.clientX, e.clientY);
    clearDropHighlights();
    const target = resolveDropTarget(e.clientX, e.clientY, drag.fromZone, drag.uid);
    if (target?.kind === 'reorder') target.el.classList.add(target.insertAfter ? 'insert-after' : 'insert-before');
    else if (target?.kind === 'zone') target.el.classList.add('drop-hover');
    drag.lastTarget = target;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
  };

  // Margin (as a % of the canvas) a card's center has to stay clear of the
  // edge so the card itself — positioned by its center, half its own size
  // in every direction — never pokes out past the canvas. Derived from the
  // actual card size in play, so it's correct at any card scale/breakpoint.
  // Shared by the single-card drop below and the group-drag reposition in
  // onPointerUpGlobal, which clamps every card in the group the same way.
  const canvasMargins = (target) => {
    const rect = target.el.getBoundingClientRect();
    const cardHalf = (parseFloat(getComputedStyle(target.el).getPropertyValue('--card-bf')) || 182) / 2;
    return { marginXPct: Math.min(45, (cardHalf / rect.width) * 100), marginYPct: Math.min(45, (cardHalf / rect.height) * 100) };
  };

  const battlefieldDropPosition = (target, x, y) => {
    const rect = target.el.getBoundingClientRect();
    const { marginXPct, marginYPct } = canvasMargins(target);
    const xPct = Math.min(100 - marginXPct, Math.max(marginXPct, ((x - rect.left) / rect.width) * 100));
    const yPct = Math.min(100 - marginYPct, Math.max(marginYPct, ((y - rect.top) / rect.height) * 100));
    return { x: xPct, y: yPct };
  };

  const onPointerUpGlobal = () => {
    const drag = dragRef.current;
    window.removeEventListener('pointermove', onPointerMoveGlobal);
    window.removeEventListener('pointerup', onPointerUpGlobal);
    window.removeEventListener('pointercancel', onPointerCancelGlobal);
    if (drag?.dragging) {
      const target = drag.lastTarget;
      if (target?.kind === 'reorder') {
        pushHistory();
        reorderWithinZone(stateRef.current, drag.fromZone, drag.uid, target.targetUid, target.insertAfter);
        commit();
      } else if (target?.kind === 'zone' && target.zoneName === 'battlefield') {
        const pos = battlefieldDropPosition(target, drag.lastX, drag.lastY);
        pushHistory();
        if (drag.fromZone === 'battlefield') {
          // Repositioning in place — also bring it to the front of the
          // stacking order, matching the intuition of picking a card up.
          const idx = stateRef.current.battlefield.findIndex(c => c.uid === drag.uid);
          const [card] = stateRef.current.battlefield.splice(idx, 1);
          card.x = pos.x;
          card.y = pos.y;
          stateRef.current.battlefield.push(card);
          // The rest of the selected group rides along, each keeping its
          // offset from the card that was actually grabbed.
          if (drag.groupOffsets) {
            const { marginXPct, marginYPct } = canvasMargins(target);
            drag.groupOffsets.forEach((off, u) => {
              const gidx = stateRef.current.battlefield.findIndex(c => c.uid === u);
              if (gidx === -1) return;
              const [gcard] = stateRef.current.battlefield.splice(gidx, 1);
              gcard.x = Math.min(100 - marginXPct, Math.max(marginXPct, pos.x + off.dx));
              gcard.y = Math.min(100 - marginYPct, Math.max(marginYPct, pos.y + off.dy));
              stateRef.current.battlefield.push(gcard);
            });
          }
        } else {
          moveCard(stateRef.current, drag.uid, 'battlefield', pos);
        }
        commit();
      } else if (target?.kind === 'zone' && target.zoneName !== drag.fromZone) {
        pushHistory();
        moveCard(stateRef.current, drag.uid, target.zoneName, { toBottom: target.toBottom });
        if (drag.groupUids) {
          drag.groupUids.forEach(u => {
            if (u === drag.uid) return;
            const found = locateCard(stateRef.current, u);
            if (found?.zone === drag.fromZone) moveCard(stateRef.current, u, target.zoneName, { toBottom: target.toBottom });
          });
          setSelectedUids(new Set());
        }
        commit();
      }
    }
    endDrag();
  };

  const onCardPointerDown = (uid) => (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Without this, the browser starts its own native text-selection drag
    // on mousedown before our threshold ever sees the movement — visible
    // as the page highlighting/selecting while dragging a card.
    e.preventDefault();
    const located = locateCard(stateRef.current, uid);
    if (!located) return;
    const showingBack = located.card.flipped && located.card.data.backImage;
    const previewImg = showingBack
      ? (located.card.data.backImageSmall || located.card.data.image_small)
      : (located.card.data.image_small || located.card.data.image);
    const fullImg = showingBack
      ? (located.card.data.backImage || located.card.data.backImageSmall)
      : (located.card.data.image || located.card.data.image_small);
    const drag = {
      uid, fromZone: located.zone, startX: e.clientX, startY: e.clientY,
      dragging: false, previewImg, lastTarget: null, longPressTimer: null, longPressFired: false,
      groupUids: null, groupOffsets: null,
    };
    // Grabbing a card that's part of the current multi-selection drags the
    // whole group together — everyone else's position is stored relative to
    // this card's, so the group keeps its shape wherever it lands.
    if (located.zone === 'battlefield' && selectedUids.size > 1 && selectedUids.has(uid)) {
      drag.groupUids = Array.from(selectedUids);
      drag.groupOffsets = new Map();
      drag.groupUids.forEach(u => {
        if (u === uid) return;
        const found = locateCard(stateRef.current, u);
        if (found?.zone === 'battlefield') {
          drag.groupOffsets.set(u, { dx: (found.card.x ?? 50) - (located.card.x ?? 50), dy: (found.card.y ?? 50) - (located.card.y ?? 50) });
        }
      });
    }
    dragRef.current = drag;
    // Touch has no hover, so a held (but still) press peeks the full-size
    // preview instead — released on pointerup, cancelled if it turns into
    // an actual drag (see the threshold check above).
    if (e.pointerType !== 'mouse') {
      drag.longPressTimer = setTimeout(() => {
        if (dragRef.current !== drag || drag.dragging) return;
        drag.longPressFired = true;
        suppressClickUntil.current = Date.now() + 300;
        navigator.vibrate?.(15);
        showCardPreview(fullImg, e.clientX, e.clientY);
      }, LONG_PRESS_DELAY);
    }
    window.addEventListener('pointermove', onPointerMoveGlobal, { passive: false });
    window.addEventListener('pointerup', onPointerUpGlobal);
    window.addEventListener('pointercancel', onPointerCancelGlobal);
  };

  // Marquee-select: pressing on empty battlefield canvas (not a card) and
  // dragging box-selects whatever cards fall inside the rectangle. A press
  // that doesn't move — a plain click on empty space — clears the
  // selection instead, same as clicking a card outside it.
  const endMarquee = () => {
    window.removeEventListener('pointermove', onMarqueeMove);
    window.removeEventListener('pointerup', onMarqueeUp);
    window.removeEventListener('pointercancel', onMarqueeCancel);
    document.getElementById('battlefield-marquee')?.classList.remove('open');
    marqueeRef.current = null;
  };

  // Same rect-intersection query used live (while dragging, so the
  // highlight tracks the box like Windows' own icon-select) and once more
  // on release, in case the very last pointermove landed slightly off from
  // the final pointerup coordinate.
  const marqueeHits = (canvasEl, x1, y1, x2, y2) => {
    const hits = new Set();
    canvasEl.querySelectorAll('[data-uid]').forEach(cardEl => {
      const r = cardEl.getBoundingClientRect();
      if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) hits.add(cardEl.dataset.uid);
    });
    return hits;
  };

  const onMarqueeMove = (e) => {
    const m = marqueeRef.current;
    if (!m) return;
    const dist = Math.hypot(e.clientX - m.startX, e.clientY - m.startY);
    if (!m.moved) {
      if (dist < DRAG_THRESHOLD) return;
      m.moved = true;
      ensureMarqueeEl().classList.add('open');
    }
    e.preventDefault();
    positionMarquee(ensureMarqueeEl(), m.startX, m.startY, e.clientX, e.clientY);
    const x1 = Math.min(m.startX, e.clientX), x2 = Math.max(m.startX, e.clientX);
    const y1 = Math.min(m.startY, e.clientY), y2 = Math.max(m.startY, e.clientY);
    setSelectedUids(marqueeHits(m.canvasEl, x1, y1, x2, y2));
  };

  const onMarqueeUp = (e) => {
    const m = marqueeRef.current;
    if (m?.moved) {
      const x1 = Math.min(m.startX, e.clientX), x2 = Math.max(m.startX, e.clientX);
      const y1 = Math.min(m.startY, e.clientY), y2 = Math.max(m.startY, e.clientY);
      setSelectedUids(marqueeHits(m.canvasEl, x1, y1, x2, y2));
    } else {
      setSelectedUids(new Set());
    }
    endMarquee();
  };

  const onMarqueeCancel = () => endMarquee();

  const onBattlefieldCanvasPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('[data-uid]')) return; // a card handles its own drag
    marqueeRef.current = { canvasEl: e.currentTarget, startX: e.clientX, startY: e.clientY, moved: false };
    window.addEventListener('pointermove', onMarqueeMove, { passive: false });
    window.addEventListener('pointerup', onMarqueeUp);
    window.addEventListener('pointercancel', onMarqueeCancel);
  };

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

  // Advancing a turn is also an untap step, same as paper Magic — saves
  // clicking through a big board of tapped cards by hand every turn.
  const nextTurn = () => {
    stateRef.current.turn++;
    stateRef.current.battlefield.forEach(c => { c.tapped = false; });
  };

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
      else if (e.key === 'ArrowRight' || key === 'd') { e.preventDefault(); pushHistory(); nextTurn(); commit(); }
      else if (e.key === 'ArrowUp' || key === 'w') { e.preventDefault(); pushHistory(); stateRef.current.life++; commit(); }
      else if (e.key === 'ArrowDown' || key === 's') { e.preventDefault(); pushHistory(); stateRef.current.life--; commit(); }
      else if (e.code === 'Space') { e.preventDefault(); pushHistory(); drawN(stateRef.current, 1); commit(); }
      else if (e.key === 'Enter') { e.preventDefault(); setBrowsingZoneState('library'); }
      else if (key === 't') { e.preventDefault(); setShowTips(v => !v); }
      else if (key === 'c') { setLeftColCollapsed(v => !v); }
      else if (key === 'b') { setBattlefieldFullscreen(v => !v); }
      else if (key === 'm') { setState(resetGame(deck)); }
      else if (e.key === 'Delete') { e.preventDefault(); sendSelectedToGraveyard(); }
      else if (e.key === 'Escape') { setShowTips(false); setCountersFor(null); setSelectedUids(new Set()); setBattlefieldFullscreen(false); }
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

  return html`
    <div class="playtest__rotate-gate">
      <span class="icon">↻</span>
      <h3>Rotate your device</h3>
      <p>The playtester needs a bit of width to lay out the board — turn your phone sideways to keep going.</p>
    </div>
    ${battlefieldFullscreen ? html`
      <div class="playtest__main playtest__fullscreen-battlefield">
        <button class="playtest__fullscreen-exit" title="Exit fullscreen (B or Escape)" onClick=${() => setBattlefieldFullscreen(false)}>✕ Exit Fullscreen</button>
        <div class="playtest__battlefield-canvas" data-dropzone="battlefield" onPointerDown=${onBattlefieldCanvasPointerDown}>
          ${state.battlefield.map(c => html`<${CardTile} c=${c} zone="battlefield" selected=${selectedUids.has(c.uid)} onClick=${onCardClick(c.uid)} onPointerDown=${onCardPointerDown(c.uid)} onContextMenu=${onCardContextMenu(c.uid)} onFlipClick=${onFlipBadgeClick(c.uid)} onCountersClick=${onCountersClick(c.uid)} onDuplicateClick=${onDuplicateClick(c.uid)} />`)}
        </div>
      </div>
    ` : html`
    <div class="playtest__main">
    <div class="playtest__topbar">
      <div class="playtest__title">${state.deckName} — Goldfish Test</div>
      <div class="playtest__controls">
        <span class="playtest__stat">Turn
          <button onClick=${doAction(() => { stateRef.current.turn = Math.max(1, stateRef.current.turn - 1); })}>−</button>
          <strong>${state.turn}</strong>
          <button onClick=${doAction(nextTurn)}>+</button>
        </span>
        <span class="playtest__stat">Life
          <button onClick=${doAction(() => { stateRef.current.life--; })}>−</button>
          <strong>${state.life}</strong>
          <button onClick=${doAction(() => { stateRef.current.life++; })}>+</button>
        </span>
        <span class="playtest__stat" title="Card size">Cards
          <button disabled=${cardScale <= CARD_SCALE_MIN} onClick=${() => adjustCardScale(-CARD_SCALE_STEP)}>−</button>
          <strong>${Math.round(cardScale * 100)}%</strong>
          <button disabled=${cardScale >= CARD_SCALE_MAX} onClick=${() => adjustCardScale(CARD_SCALE_STEP)}>+</button>
        </span>
        <div class=${`playtest__controls-extra${topbarCollapsed ? ' controls-collapsed' : ''}`}>
          <button class="btn" disabled=${!undoStack.current.length} onClick=${() => undo()}>↺ Undo</button>
          <button class="btn" onClick=${doAction(() => { stateRef.current.library = shuffle(stateRef.current.library); })}>Shuffle Library</button>
          <button class="btn" onClick=${doAction(() => drawN(stateRef.current, 1))}>Draw Card</button>
          <button class="btn" onClick=${() => setState(resetGame(deck))}>Mulligan</button>
          <button class="btn" onClick=${() => setState(resetGame(deck))}>New Game</button>
        </div>
        <button class="playtest__topbar-toggle" title="Collapse/expand controls" onClick=${() => setTopbarCollapsed(v => !v)}>${topbarCollapsed ? '▸' : '◂'}</button>
        <button class="btn btn--danger" onClick=${onExit}>Exit</button>
      </div>
    </div>

    <div class=${`playtest__hint${topbarCollapsed ? ' hint-collapsed' : ''}`}>Press <strong>T</strong> for controls & tips.</div>

    <div class="playtest__board">
      <div class=${`playtest__leftcol${leftColCollapsed ? ' leftcol-collapsed' : ''}`}>
        <button class="playtest__leftcol-toggle" title="Collapse/expand Command Zone (C)" onClick=${() => setLeftColCollapsed(v => !v)}>${leftColCollapsed ? '▸' : '◂'}</button>
        ${state.hasCommander ? html`
          <div class="playtest__zone playtest__zone--command" data-dropzone="command">
            <h4>Command Zone</h4>
            <div class="playtest__cards">
              ${state.command.length
                ? state.command.map(c => html`<${CardTile} c=${c} zone="command" onClick=${onCardClick(c.uid)} onPointerDown=${onCardPointerDown(c.uid)} onContextMenu=${onCardContextMenu(c.uid)} onFlipClick=${onFlipBadgeClick(c.uid)} />`)
                : html`<span class="playtest__empty-hint">Empty — click or drag your commander here.</span>`}
            </div>
          </div>
        ` : ''}
        <div class="playtest__pile playtest__pile--tokens" onClick=${onBrowsePile('tokens')} title="Tokens — click to browse, click one there to create it on the battlefield">
          <strong>∞</strong>
          Tokens
        </div>
      </div>

      <div class="playtest__zone playtest__zone--battlefield">
        <h4>Battlefield <span class="count">${state.battlefield.length}</span></h4>
        ${state.battlefield.length ? '' : html`<span class="playtest__empty-hint">Drag a card here to play it.</span>`}
        <div class="playtest__battlefield-canvas" data-dropzone="battlefield" onPointerDown=${onBattlefieldCanvasPointerDown}>
          ${state.battlefield.map(c => html`<${CardTile} c=${c} zone="battlefield" selected=${selectedUids.has(c.uid)} onClick=${onCardClick(c.uid)} onPointerDown=${onCardPointerDown(c.uid)} onContextMenu=${onCardContextMenu(c.uid)} onFlipClick=${onFlipBadgeClick(c.uid)} onCountersClick=${onCountersClick(c.uid)} onDuplicateClick=${onDuplicateClick(c.uid)} />`)}
        </div>
      </div>
    </div>

    <div class=${`playtest__bottomrow${bottomRowPinned ? ' bottomrow-pinned' : ''}`}>
      <div class="playtest__zone playtest__zone--hand" data-dropzone="hand">
        <h4>Hand <span class="count">${state.hand.length}</span>
          <span class="playtest__sort">
            Sort:
            <button onClick=${onSortHand('cmc')}>CMC</button>
            <button onClick=${onSortHand('type')}>Type</button>
            <button onClick=${onSortHand('name')}>Name</button>
          </span>
          <button class="playtest__hand-toggle" title=${bottomRowPinned ? 'Unpin Hand, Library, Graveyard & Exile (auto-hide again when the cursor leaves)' : 'Pin Hand, Library, Graveyard & Exile open (otherwise they peek and expand on hover, or while dragging a card toward them)'} onClick=${() => setBottomRowPinned(v => !v)}>${bottomRowPinned ? '▣' : '▢'}</button>
        </h4>
        <div class="playtest__cards playtest__cards--hand">
          ${state.hand.length
            ? state.hand.map(c => html`<${CardTile} c=${c} zone="hand" onClick=${onCardClick(c.uid)} onPointerDown=${onCardPointerDown(c.uid)} onContextMenu=${onCardContextMenu(c.uid)} onFlipClick=${onFlipBadgeClick(c.uid)} />`)
            : html`<span class="playtest__empty-hint">No cards in hand.</span>`}
        </div>
      </div>

      <div class="playtest__sidezones">
        <div class="playtest__librarygroup">
          <div class="playtest__pile playtest__pile--libtop" onClick=${onDrawPileClick} onDblClick=${onBrowsePile('library')} data-dropzone="library" title="Top of Library — click to draw, double-click to browse, drag here to place on top">
            <strong>${state.library.length}</strong>
            Library
          </div>
          <div class="playtest__pile playtest__pile--libbottom" onDblClick=${onBrowsePile('library')} data-dropzone="library" data-to-bottom="true" title="Bottom of Library — drag here to bottom-deck, double-click to browse">
            ↓ Bottom
          </div>
        </div>
        <div class="playtest__gyexile">
          <div class="playtest__pile playtest__pile--gy" onClick=${onBrowsePile('graveyard')} data-dropzone="graveyard" title="Graveyard — click to browse, drag a card here">
            <strong>${state.graveyard.length}</strong>
            Graveyard
          </div>
          <div class="playtest__pile playtest__pile--exile" onClick=${onBrowsePile('exile')} data-dropzone="exile" title="Exile — click to browse, drag a card here">
            <strong>${state.exile.length}</strong>
            Exile
          </div>
        </div>
      </div>
    </div>
    </div>
    `}

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
                  ? state[browsingZone].map(c => html`<${CardTile} c=${c} onClick=${onCardClick(c.uid)} onContextMenu=${onCardContextMenu(c.uid)} onFlipClick=${onFlipBadgeClick(c.uid)} />`)
                  : html`<span class="playtest__empty-hint">Nothing here.</span>`)}
          </div>
        </div>
      </div>
    ` : ''}

    ${showTips ? html`
      <div class="zone-browser">
        <div class="zone-browser__panel tips-panel">
          <div class="zone-browser__header">
            <h3>Controls & Tips</h3>
            <button class="btn btn--primary" onClick=${() => setShowTips(false)}>Close</button>
          </div>
          <ul class="tips-list">
            ${TIPS.map(t => html`<li><span class="tips-list__action">${t.action}</span><span class="tips-list__control">${t.control}</span></li>`)}
          </ul>
        </div>
      </div>
    ` : ''}

    ${countersFor ? (() => {
      const located = locateCard(state, countersFor);
      if (!located) return '';
      const counters = located.card.counters || {};
      const customTypes = Object.keys(counters).filter(t => t !== '+1/+1' && t !== '-1/-1');
      const counterRow = (type, count) => html`
        <li class="counter-row">
          <span class="counter-row__label">${type}</span>
          <span class="counter-row__stepper">
            <button onClick=${() => adjustCounter(countersFor, type, -1)}>−</button>
            <span class="counter-row__count">${count}</span>
            <button onClick=${() => adjustCounter(countersFor, type, 1)}>+</button>
          </span>
        </li>
      `;
      return html`
        <div class="zone-browser">
          <div class="zone-browser__panel counters-panel">
            <div class="zone-browser__header">
              <h3>Counters — ${located.card.name}</h3>
              <button class="btn btn--primary" onClick=${() => setCountersFor(null)}>Close</button>
            </div>
            <ul class="counter-list">
              ${counterRow('+1/+1', counters['+1/+1'] || 0)}
              ${counterRow('-1/-1', counters['-1/-1'] || 0)}
              ${customTypes.map(t => counterRow(t, counters[t]))}
            </ul>
            <div class="counter-add">
              <input
                type="text"
                placeholder="Custom counter (e.g. Shield, Loyalty)"
                value=${newCounterName}
                onInput=${(e) => setNewCounterName(e.target.value)}
                onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddCounterType(); } }}
              />
              <button class="btn" onClick=${onAddCounterType}>Add</button>
            </div>
          </div>
        </div>
      `;
    })() : ''}
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
