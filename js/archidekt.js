// Archidekt's API doesn't allow cross-origin requests from other sites, so we
// route through a public CORS proxy. This is a soft dependency: if the proxy
// is ever down, the user can still paste a decklist manually.
// corsproxy.io started requiring a paid API key (every request now 401s with
// "A valid API key is required"). corsfix.com (tried next) works great but
// requires the calling domain to be pre-registered in a dashboard — it only
// ever worked here because their free tier allows localhost unconditionally
// for local dev; deployed on GitHub Pages it 403s with "domain_not_registered".
// Jina's read-only content proxy needs no registration and works from any
// origin, at the cost of wrapping the response in its own "Title/URL Source/
// Markdown Content" envelope instead of returning it raw — see the JSON.parse
// below, which just skips to the first "{" to pull the real payload back out.
const CORS_PROXY = 'https://r.jina.ai/';

// These are never real deck contents, so they're excluded unconditionally —
// even if a deck's own category settings mark them as included.
const ALWAYS_EXCLUDED_CATEGORIES = new Set(['Maybeboard', 'Tokens & Extras']);

export function parseArchidektId(input) {
  const s = String(input).trim();
  const m = s.match(/archidekt\.com\/decks\/(\d+)/i) || s.match(/^(\d+)$/);
  return m ? m[1] : null;
}

// Fetches an Archidekt deck and converts it into our own decklist text format
// (the same one produced by pasting), so it can flow through the existing
// parser + Scryfall pipeline unchanged.
export async function fetchArchidektDeck(idOrUrl) {
  const id = parseArchidektId(idOrUrl);
  if (!id) throw new Error('Could not find a deck ID in that Archidekt URL.');

  const apiUrl = `https://archidekt.com/api/decks/${id}/`;
  let res;
  try {
    res = await fetch(CORS_PROXY + apiUrl);
  } catch {
    throw new Error('Could not reach Archidekt (the CORS proxy may be down). Try again, or paste the decklist manually.');
  }
  if (!res.ok) throw new Error(`Archidekt fetch failed (HTTP ${res.status}). Is the deck public?`);

  const body = await res.text();
  const jsonStart = body.indexOf('{');
  let data;
  try {
    data = JSON.parse(body.slice(jsonStart));
  } catch {
    throw new Error('Could not parse the response from Archidekt.');
  }
  if (!Array.isArray(data.cards)) throw new Error('Unexpected response from Archidekt.');

  const excludedCats = new Set([
    ...ALWAYS_EXCLUDED_CATEGORIES,
    ...(data.categories || []).filter(c => c.includedInDeck === false).map(c => c.name),
  ]);

  const lines = [];
  for (const entry of data.cards) {
    const cats = entry.categories || [];
    if (cats.length && !cats.some(cat => !excludedCats.has(cat))) continue; // e.g. maybeboard-only

    const card = entry.card;
    const set = card.edition?.editioncode;
    const collector = card.collectorNumber;
    if (!set || !collector) continue; // custom/unlinked cards we can't map to Scryfall

    const name = card.oracleCard?.name || card.displayName || 'Unknown Card';
    const isCommander = cats.includes('Commander');
    const category = isCommander ? 'Commander' : (cats.find(cat => !excludedCats.has(cat)) || 'Uncategorized');
    const finish = entry.modifier === 'Foil' ? ' *F*' : entry.modifier === 'Etched' ? ' *E*' : '';

    lines.push(`${entry.quantity}x ${name} (${set}) ${collector}${finish} [${category}]`);
  }

  if (!lines.length) throw new Error('No cards found in that deck.');

  return { name: data.name || 'Imported Deck', text: lines.join('\n') };
}
