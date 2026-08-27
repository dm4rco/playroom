const DECKS_KEY = 'edh_decks_v1';

export function loadDecks() {
  try { return JSON.parse(localStorage.getItem(DECKS_KEY)) || {}; }
  catch { return {}; }
}

function saveDecks(decks) {
  localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
}

// sourceUrl is the Archidekt deck URL this deck was last fetched from, if
// any — lets "Refresh Card Data" re-pull the decklist itself, not just
// Scryfall's data for whatever was already saved. Omit the argument
// (rather than passing null) to leave an existing value alone, so a plain
// manual edit doesn't silently un-link a deck from Archidekt.
export function upsertDeck(name, rawText, cards, tokens = [], sourceUrl) {
  const decks = loadDecks();
  const existing = decks[name];
  decks[name] = {
    name, rawText, cards, tokens,
    sourceUrl: sourceUrl !== undefined ? sourceUrl : (existing?.sourceUrl ?? null),
    updatedAt: Date.now(),
  };
  saveDecks(decks);
  return decks;
}

export function deleteDeck(name) {
  const decks = loadDecks();
  delete decks[name];
  saveDecks(decks);
  return decks;
}

export function renameDeck(oldName, newName) {
  const decks = loadDecks();
  if (!decks[oldName] || oldName === newName) return decks;
  decks[newName] = { ...decks[oldName], name: newName };
  delete decks[oldName];
  saveDecks(decks);
  return decks;
}
