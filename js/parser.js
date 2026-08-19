// Parses decklist lines like:
//   1x Aang's Defense (tle) 211 *F* [Draw]
//   11x Mountain (dft) 288 [Land]
//   1x Big Score (plst) SNC-102 [Draw]
//   1x Vihaan, Goldwaker (otc) 8 *F* [Commander{top}]
const LINE_RE = /^(\d+)x\s+(.+)\s+\(([a-z0-9]+)\)\s+([A-Za-z0-9\-]+)(?:\s+\*([A-Za-z]+)\*)?\s*(?:\[([^\]]*)\])?\s*$/i;

export function parseDecklist(text) {
  const cards = [];
  const errors = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;

    const m = line.match(LINE_RE);
    if (!m) {
      errors.push(line);
      continue;
    }

    const [, qty, name, set, collector, finish, category] = m;
    const catRaw = (category || '').trim();
    const isCommander = /commander/i.test(catRaw);
    const catClean = catRaw.replace(/\{[^}]*\}/g, '').trim() || 'Uncategorized';

    cards.push({
      qty: parseInt(qty, 10),
      name: name.trim(),
      set: set.toLowerCase(),
      collector_number: collector,
      finish: finish ? finish.toUpperCase() : null,
      category: catClean,
      isCommander,
      key: `${set.toLowerCase()}:${collector}`,
    });
  }

  return { cards, errors };
}
