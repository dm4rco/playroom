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
`https://archidekt.com/decks/25521882/vihaan_goldwaker`) into the "Fetch from
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
- The "Playtest" button (top right, once a deck is loaded) opens a simple
  goldfishing sandbox with Library (split into Top/Bottom drop targets),
  Hand, Battlefield, Graveyard, and Exile zones, plus a Command Zone if your
  deck has a commander — it stays on screen (as an empty drop target) even
  after the commander is cast, so you can drag or click it back.
  - Click a hand card to play it, click a battlefield card to tap/untap it
    (rotates 90°), click your commander in the Command Zone to cast it.
  - Double-click any visible card to see it full-size.
  - Double-click the Library, Graveyard, or Exile pile to browse every card
    in it — for tutor/recursion effects. Click a card in that view to play
    it to the battlefield (it stays open so you can grab more than one);
    double-click one to preview it. Closing the Library browser (or
    switching to browse a different zone) always reshuffles it, since you
    just searched it.
  - Drag any card onto any zone to place it exactly where you want,
    including dragging onto the Library's Top or Bottom strip.
  - Arrow keys: ←/→ adjust turn, ↑/↓ adjust life. The browser's Back button
    undoes the last action, same as the on-screen Undo button.
- Opening hand follows a house mulligan rule: draw 10, then bottom 3 (click or
  drag them onto the Library pile) to end up with 7. Both "New Game" and
  "Mulligan" restart from a fresh shuffle and redo this draw. Shuffling
  (including the initial deal) sorts creatures toward the top of the
  library, lands toward the bottom, and everything else in between,
  randomized within each group.
- It's solitaire testing only — no rules enforcement, mana, or opponent.
  Drag-and-drop uses the native HTML5 API, so it's mouse-only (no touch).
