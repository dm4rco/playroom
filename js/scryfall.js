const CACHE_KEY = 'edh_scryfall_cache_v1';

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; }
  catch { return {}; }
}

function saveCache(cache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

function simplifyCard(card) {
  const face = card.card_faces?.[0];
  return {
    name: card.name,
    mana_cost: card.mana_cost || face?.mana_cost || '',
    cmc: card.cmc ?? 0,
    type_line: card.type_line || face?.type_line || '',
    colors: card.colors || face?.colors || [],
    color_identity: card.color_identity || [],
    image: card.image_uris?.normal || face?.image_uris?.normal
      || card.card_faces?.[1]?.image_uris?.normal || '',
    image_small: card.image_uris?.small || face?.image_uris?.small || '',
    // Cardmarket (EUR) pricing, as supplied by Scryfall. There's no eur_etched field,
    // so etched cards fall back to the foil price.
    price_eur: card.prices?.eur ?? null,
    price_eur_foil: card.prices?.eur_foil ?? null,
    scryfall_uri: card.scryfall_uri || '',
  };
}

// Fetches (set, collector_number) pairs from Scryfall's collection endpoint
// in batches of 75, using a localStorage cache so repeat imports are fast.
export async function fetchCardData(cards, { force = false, onProgress } = {}) {
  const cache = loadCache();
  const need = [];
  const seen = new Set();

  for (const c of cards) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    if (!force && cache[c.key]) continue;
    need.push(c);
  }

  const batches = [];
  for (let i = 0; i < need.length; i += 75) batches.push(need.slice(i, i + 75));

  let done = 0;
  for (const batch of batches) {
    const identifiers = batch.map(c => ({ set: c.set, collector_number: c.collector_number }));
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    });
    if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
    const data = await res.json();

    for (const card of data.data) {
      const key = `${card.set}:${card.collector_number}`;
      cache[key] = simplifyCard(card);
    }
    for (const nf of data.not_found || []) {
      const key = `${nf.set}:${nf.collector_number}`;
      cache[key] = { notFound: true };
    }

    done += batch.length;
    onProgress?.(done, need.length);
    await new Promise(r => setTimeout(r, 100)); // stay polite to Scryfall's rate limit
  }

  saveCache(cache);

  const result = {};
  for (const c of cards) result[c.key] = cache[c.key];
  return result;
}
