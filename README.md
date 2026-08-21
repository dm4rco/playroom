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

- Card data and images are pulled live from Scryfall's free API each time you
  import a deck, then cached in `localStorage` so re-opening a deck is instant.
- "Refresh Card Data" on a deck re-fetches everything (useful if prices or
  prints have changed).
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
    same as a real table (a click-to-play with no drop point just cascades
    into a loose grid). The Command Zone still fans overlapping cards
    instead of wrapping, since 90%+ of decks only ever have one or two
    commanders.
  - Marquee-select a group of battlefield cards by dragging on empty canvas
    space, then click any one of them to tap/untap the whole group together.
    Click empty space or press Escape to clear the selection.
  - Every battlefield card has a duplicate badge (top-left corner) for
    quickly making a second copy of it — untapped, no counters, offset
    slightly so it doesn't sit exactly on top of the original.
  - Library, Graveyard, and Exile sit next to the Hand at the bottom of the
    board instead of beside the Battlefield, so the Battlefield gets the
    full width to spread cards out in (Graveyard and Exile are stacked on
    top of each other rather than side by side, so they don't eat into the
    Hand's width either).
  - Command Zone/Tokens and the whole top controls row are both
    collapsible (◂/▸ toggle, or the C key for Command Zone) — useful once a
    game's actually underway and the Battlefield is what matters. Control
    now collapses Hand *and* the piles beside it together, for the same
    reason.
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
  - Every battlefield card has a small counter badge (bottom-left corner) —
    click it for +1/+1 and -1/-1 steppers plus a free-text field for
    anything else (Shield, Loyalty, Experience, whatever the card grants).
    The badge itself shows the running total once it's non-zero.
  - Advancing the turn (the + button, D, or →) untaps the whole battlefield
    automatically, like the untap step in paper Magic.
- Opening hand is just a draw of 10, full stop — there's no forced mulligan
  step. It's single-player testing, so do whatever you want with them (play
  them, bottom some via drag, whatever). Both "New Game" and "Mulligan"
  reshuffle the whole deck, redraw 10, and sort the new hand by CMC (the
  sort buttons still work as normal from there).
- It's solitaire testing only — no rules enforcement, mana, or opponent.
  Drag-and-drop uses the native HTML5 API, so it's mouse-only (no touch).
