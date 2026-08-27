# EDH Deck Viewer

A tiny local website for visualizing your Commander decks. Paste a decklist,
it fetches card data from [Scryfall](https://scryfall.com) and shows a mana
curve, color identity breakdown, your custom category tags, and a card
gallery.

## Decklist format

```
1x Aang's Defense (tle) 211 *F* [Draw]
11x Mountain (dft) 288 [Land]
1x Vihaan, Goldwaker (otc) 8 *F* [Commander{top}]
```

`qty`x `Name` (`set code`) `collector number` [optional `*F*`/`*E*` finish] `[Category]`

A card with a finish shows a small F (Foil) or E (Etched foil) badge on its
gallery tile — hover it for a tooltip spelling out which.

The commander is detected from any category containing the word
"Commander". A ready-made example is in [sample-decklist.txt](sample-decklist.txt).

You can also paste an Archidekt deck URL (e.g.
`https://archidekt.com/decks/1234567/deck_name`) into the "Fetch from
Archidekt" box and it'll convert the deck into this format for you — works for
both new imports and editing an existing deck.

## Running it

Browsers block ES module imports (and some fetches) from `file://` pages, so
serve the folder over local HTTP instead of double-clicking `index.html`.

Pick one:

```bash
node server.js
```

```bash
npx serve .
```

Then open the printed URL (e.g. `http://localhost:8080` or `http://localhost:3000`).

## Notes

- A first-ever visit auto-imports a ready-made deck (Indominus Rex) via the
  Archidekt pipeline above, so anyone trying the site — a friend testing the
  playtester, say — has something to click Playtest on immediately without
  bringing their own decklist. Delete it like any other deck; it's seeded
  once, ever, and never comes back on its own.
- Card data and images are pulled live from Scryfall's free API each time you
  import a deck, then cached in `localStorage` so re-opening a deck is instant.
- "Refresh Card Data" re-fetches Scryfall data (prices, prints) for a deck.
  If the deck was fetched from Archidekt, it also re-pulls the decklist
  itself from Archidekt first — so cards added, removed, or changed there
  since the last fetch show up too, not just updated prices for the list
  already saved. A deck built from a pasted/manual decklist (no Archidekt
  link) just refreshes Scryfall data for what's there, as before.
- Everything is stored locally in your browser — nothing leaves your machine
  except the requests to Scryfall's API.
- Deck import currently expects the format above (this is the same format
  Archidekt's text export uses). If a line fails to parse it's skipped and
  reported after import.
- Archidekt import goes through a public CORS proxy (Archidekt's API doesn't
  allow browser requests from other sites). If that proxy is ever down, paste
  the decklist manually instead.
- The commander is excluded from the Mana Curve, Color Pips, Category
  Breakdown, and Card Types charts (it's always exactly one card, so it just
  adds noise) but still counts toward Total Cards, Unique, and Est. Value.
  Charts cap their own size instead of growing to fill the whole screen on
  large monitors — they add more columns instead.
- Click a bar in Category Breakdown or Card Types to exclude it from the
  Mana Curve and Color Pips above (and Avg CMC, which is curve-derived) —
  handy for seeing how the deck would look without, say, its removal suite
  or its artifacts. The bar dims but stays put (and clickable) so it's easy
  to switch back; Category Breakdown and Card Types themselves always show
  every card, unaffected by the toggle.
- Each category's card gallery shows a price under every card and its total
  value next to the category name, and has a Sort control (Name / CMC /
  Price) that applies to every category at once.
- A Tokens section at the bottom of the page lists every token the deck can
  create (same data the playtester's Tokens pile uses) as a quick reference
  — purely informational, so it's never counted in Total Cards, the charts,
  or Est. Value. Click a token to see which card(s) in the deck actually
  make it, with each one's category and price.
- "Export" (next to the deck name) is for building a Cardmarket wantlist:
  it drops in a banner explaining the mode, and clicking a card marks it
  "already owned" (dimmed with a ✓) instead of opening it — owned cards are
  left out of the copy. "Copy Wantlist" copies the rest to your clipboard as
  plain `2x Name` lines, one per card, ready to paste into a Cardmarket
  wantlist. Everything else (playing, browsing, the lightbox) still works
  normally while export mode is on; "Done" just turns the click-to-mark
  behavior back off. Owned marks are saved per deck and stick around even
  after leaving export mode or reloading the page.
- The "Playtest" button (top right, once a deck is loaded) opens a simple
  goldfishing sandbox with Library (split into Top/Bottom drop targets),
  Hand, Battlefield, Graveyard, Exile, and Tokens zones, plus a Command Zone
  if your deck has a commander — it stays on screen (as an empty drop
  target) even after the commander is cast, so you can drag or click it
  back. Rendered with Preact+htm loaded from a CDN as ES modules (no build
  step, no npm — still just static files pushed to GitHub Pages).
  - Press **T** in the playtester for the full list of controls (hover to
    preview, click to play/tap/cast/draw, tap the ⟲ badge or right-click to
    flip a double-faced card, drag to move or reorder, arrow keys/WASD,
    Space, Enter, etc). Works on touch too — dragging, tap-to-flip, and a
    long-press peek preview all use Pointer Events, so mouse and touch share
    the same code path. In portrait on a phone the playtester asks you to
    rotate; landscape gets a compact version of the same layout.
  - Hovering a hand card previews it without moving it; clicking it plays it.
    The Battlefield is a free canvas — drag a card anywhere and it stays put,
    same as a real table. A dashed line splits it into a lower lane (a bit
    taller than one card) for lands and the rest for everything else — a
    click-to-play with no drop point cascades into the matching lane, but
    dragging still puts a card exactly wherever you drop it, line or no
    line. The Command Zone still fans overlapping cards instead of
    wrapping, since 90%+ of decks only ever have one or two commanders.
  - Marquee-select a group of battlefield cards by dragging on empty canvas
    space, then click any one of them to tap/untap the whole group together,
    or drag any one of them to move the whole group at once (keeping their
    relative positions, or all landing in the same zone if you drag them
    onto Graveyard/Exile/Hand/etc). **Delete** sends the selected cards
    straight to the Graveyard without needing to drag them there. Click
    empty space or press Escape to clear the selection.
  - Every battlefield card has a duplicate badge (top-left corner) for
    quickly making a second copy of it — untapped, offset slightly so it
    doesn't sit exactly on top of the original.
  - Library, Graveyard, and Exile sit next to the Hand at the bottom of the
    board instead of beside the Battlefield, so the Battlefield gets the
    full width to spread cards out in (Graveyard and Exile are stacked on
    top of each other rather than side by side, so they don't eat into the
    Hand's width either).
  - Command Zone/Tokens and the whole top controls row are both collapsed
    by default (◂/▸ toggle, or the C key for Command Zone) — the Battlefield
    is what matters once a game's actually underway. Hand and the piles
    beside it (Library, Graveyard, Exile) work the same way but
    automatically: they sit peeked down to a sliver until the cursor is
    actually over them (hovering, or just naturally passing through while
    dragging a card toward the Graveyard), then expand on their own — no
    toggle needed. Click the pin icon next to Sort to keep that row open
    regardless (handy on touch, where there's no hover to trigger it).
    Collapsing/peeking shrinks those sections but doesn't hand their space
    to the Battlefield (nothing here uses viewport-relative sizing) — for
    that, press **B** to go fully fullscreen: everything except the
    Battlefield itself disappears and the canvas fills the whole screen.
    Press B again, Escape, or the small "Exit Fullscreen" button to go back.
  - A "Cards" control next to Turn/Life scales every card on the board up
    or down (50%–130%, defaults to 80%) — persisted, so it's a one-time
    "make the Battlefield less cluttered" setting rather than something to
    redo every game. **M** is a shortcut for Mulligan.
  - The Hand caps at ~2 rows and scrolls internally, so drawing a lot of
    cards doesn't push the rest of the board out of reach. Sort buttons
    (CMC / Type / Name) reorder it on demand, or drag cards to reorder
    manually.
  - The Tokens pile lists every token your deck can actually create
    (auto-detected from Scryfall's data on each card, including its real
    type). It's an unlimited supply — spawning one doesn't remove it from
    the list — and spawned tokens go away for good once they leave the
    battlefield, same as in paper Magic, since they aren't real cards. Decks
    imported before this feature need a "Refresh Card Data" to pick up
    their token list.
  - Closing the Library browser (or switching to browse a different zone)
    always reshuffles it, since you just searched it.
  - +1/+1 and -1/-1 counters are physical-style tokens, not attached to any
    card — drag one off the tray next to Tokens (or just tap it for a quick
    default spot) to drop it on the battlefield, then drag it again onto
    whichever creature it's for, same as a real glass bead (grab it
    anywhere on the chip, including the number in the middle). Tap its
    left/right half to decrement/increment (a token that hits 0 removes
    itself); right-click removes it outright. Since it's just a marker
    sitting near a card rather than data attached to it, this covers any
    number of stacked counters on one creature without needing a whole
    per-card counter type system. "Custom" makes one with any name you
    type (Vigilance, Shield, Experience, whatever a card grants) — it gets
    a random color the first time, then keeps that same color for the rest
    of the session so repeats of the same name are recognizable at a glance.
  - Advancing the turn (the + button, D, or →) untaps the whole battlefield
    automatically, like the untap step in paper Magic.
- Opening hand is just a draw of 10, full stop — there's no forced mulligan
  step. It's single-player testing, so do whatever you want with them (play
  them, bottom some via drag, whatever). Both "New Game" and "Mulligan"
  reshuffle the whole deck, redraw 10, and sort the new hand by CMC (the
  sort buttons still work as normal from there).
- It's solitaire testing only — no rules enforcement, mana, or opponent.
  Drag-and-drop uses the native HTML5 API, so it's mouse-only (no touch).
