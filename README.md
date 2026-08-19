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
  goldfishing sandbox: shuffles the deck, draws an opening hand of 7, and lets
  you click cards to draw/play/discard them, with basic life and turn
  counters. It's solitaire testing only — no rules enforcement, mana, or
  opponent.
