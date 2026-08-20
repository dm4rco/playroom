const CACHE_KEY = 'edh_scryfall_cache_v1';
const TOKEN_CACHE_KEY = 'edh_token_cache_v1';

function loadCache(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; }
  catch { return {}; }
}

function saveCache(key, cache) {
  localStorage.setItem(key, JSON.stringify(cache));
}

function simplifyCard(card) {
  const face = card.card_faces?.[0];
  const backFace = card.card_faces?.[1];
  // Transform/modal-DFC cards render as two separate physical images; layouts
  // like split/adventure/aftermath still have card_faces but only one actual
  // image (top-level image_uris), so they're not flippable.
  const hasSeparateBack = !card.image_uris && !!backFace?.image_uris;
  return {
    name: card.name,
    mana_cost: card.mana_cost || face?.mana_cost || '',
    cmc: card.cmc ?? 0,
    type_line: card.type_line || face?.type_line || '',
    colors: card.colors || face?.colors || [],
    color_identity: card.color_identity || [],
    image: card.image_uris?.normal || face?.image_uris?.normal || '',
    image_small: card.image_uris?.small || face?.image_uris?.small || '',
    // Back face image/name, for flipping double-faced cards in the
    // playtester. null for single-faced cards and non-flippable layouts.
    backImage: hasSeparateBack ? backFace.image_uris.normal : null,
    backImageSmall: hasSeparateBack ? backFace.image_uris.small : null,
    backName: hasSeparateBack ? backFace.name : null,
    // Cardmarket (EUR) pricing, as supplied by Scryfall. There's no eur_etched field,
    // so etched cards fall back to the foil price.
    price_eur: card.prices?.eur ?? null,
    price_eur_foil: card.prices?.eur_foil ?? null,
    scryfall_uri: card.scryfall_uri || '',
    // Tokens this card can create, per Scryfall's "related cards" data — used
    // to populate the playtester's Tokens zone. Only id/name/type_line are
    // available here; fetchTokenData() resolves the full card (image, etc).
    tokenParts: (card.all_parts || [])
      .filter(p => p.component === 'token')
      .map(p => ({ id: p.id, name: p.name, type_line: p.type_line })),
  };
}

// Fetches (set, collector_number) pairs from Scryfall's collection endpoint
// in batches of 75, using a localStorage cache so repeat imports are fast.
export async function fetchCardData(cards, { force = false, onProgress } = {}) {
  const cache = loadCache(CACHE_KEY);
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

  saveCache(CACHE_KEY, cache);

  const result = {};
  for (const c of cards) result[c.key] = cache[c.key];
  return result;
}

// Resolves token references (from cards' tokenParts) into full card data
// (image, type_line, etc.), for the playtester's Tokens zone. Different
// printings link to different token ids even for identical tokens (e.g.
// every "Treasure" token has its own uuid per source card), so this dedupes
// by name first and only fetches one representative per unique name.
export async function fetchTokenData(tokenRefs) {
  const seenNames = new Set();
  const uniqueRefs = [];
  for (const t of tokenRefs) {
    if (seenNames.has(t.name)) continue;
    seenNames.add(t.name);
    uniqueRefs.push(t);
  }

  const cache = loadCache(TOKEN_CACHE_KEY);
  const need = uniqueRefs.filter(t => !cache[t.name]);

  const batches = [];
  for (let i = 0; i < need.length; i += 75) batches.push(need.slice(i, i + 75));

  for (const batch of batches) {
    const identifiers = batch.map(t => ({ id: t.id }));
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers }),
    });
    if (!res.ok) throw new Error(`Scryfall error ${res.status}`);
    const data = await res.json();

    for (const card of data.data) cache[card.name] = simplifyCard(card);
    await new Promise(r => setTimeout(r, 100));
  }

  saveCache(TOKEN_CACHE_KEY, cache);

  return uniqueRefs
    .map(t => ({ name: t.name, data: cache[t.name] }))
    .filter(t => t.data);
}
