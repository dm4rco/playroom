const DECKS_KEY = 'edh_decks_v1';

export function loadDecks() {
  try { return JSON.parse(localStorage.getItem(DECKS_KEY)) || {}; }
  catch { return {}; }
}

function saveDecks(decks) {
  localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
}

export function upsertDeck(name, rawText, cards, tokens = []) {
  const decks = loadDecks();
  decks[name] = { name, rawText, cards, tokens, updatedAt: Date.now() };
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
