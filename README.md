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
  - Hover any card, anywhere, to see it full-size in a floating preview next
    to your cursor — no clicking required. Click a hand card to play it,
    click a battlefield card to tap/untap it (rotates 90°, and battlefield
    slots always reserve room for the rotation so nothing jumps around),
    click your commander in the Command Zone to cast it.
  - The Hand caps at ~2 rows and scrolls internally beyond that, so drawing a
    lot of cards doesn't push the rest of the board out of reach. Sort
    buttons (CMC / Type / Name) in the Hand header reorder it on demand.
  - The battlefield is split into Creatures / Other / Lands rows so permanents
    are easy to scan; drop a card anywhere in the battlefield area and it
    lands in the right row automatically. Cards within a row overlap in a
    fan (rather than wrapping) and scroll horizontally, so a dozen Treasure
    tokens or a handful of basics don't blow the row out — consecutive
    copies of the *same* card overlap much tighter than usual (you don't
    need to see all 10 Mountains clearly, just that they're there). Hover a
    card to bring it fully to the front (and see the full-size preview).
  - Click the Library pile to draw, or double-click it (or the Bottom strip)
    to browse every card in it — for tutors (Library is the one zone that
    still uses double-click, since single-click there already means draw).
    Click the Graveyard, Exile, or Tokens pile once to browse it — for
    recursion or making tokens. Click a card in that view to play it to the
    battlefield (it stays open so you can grab more than one). Closing the
    Library browser (or switching to browse a different zone) always
    reshuffles it, since you just searched it.
  - The Tokens pile (below the Command Zone) lists every token your deck can
    actually create (auto-detected from Scryfall's data on each card,
    including its real type — creature, artifact, land, whatever). It's an
    unlimited supply: click a token to spawn a fresh copy onto the
    battlefield — the token stays in the list so you can make more. Spawned
    tokens go away for good once they leave the battlefield (graveyard/
    exile/etc.), same as in paper Magic, since a token isn't a real card.
    Decks imported before this feature need a "Refresh Card Data" to pick up
    their token list.
  - Drag any card onto any zone to place it exactly where you want,
    including dragging onto the Library's Top or Bottom strip. Within the
    Hand or Battlefield, drop a card onto another card there to reorder —
    drops left/right of its midpoint insert before/after it (a thin accent
    bar shows where it'll land).
  - Right-click a double-faced card (transform/modal DFC, e.g. Aang, Master
    of Elements) to flip it to its other face — a small ⟲ badge marks cards
    that can flip. Single-faced cards ignore right-click.
  - Space bar draws a card. Enter opens the Library browser (same as
    double-clicking the pile). Arrow keys or WASD: ←/→ or A/D adjust turn,
    ↑/↓ or W/S adjust life. The browser's Back button undoes the last
    action, same as the on-screen Undo button.
- Opening hand is just a draw of 10, full stop — there's no forced mulligan
  step. It's single-player testing, so do whatever you want with them (play
  them, bottom some via drag, whatever). Both "New Game" and "Mulligan"
  reshuffle the whole deck and redraw 10.
- It's solitaire testing only — no rules enforcement, mana, or opponent.
  Drag-and-drop uses the native HTML5 API, so it's mouse-only (no touch).
