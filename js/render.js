import { barChart, donutChart, COLORS, paletteColor } from './charts.js';

const TYPE_ORDER = ['Land', 'Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment'];
const COLOR_LABELS = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
const PIP_COLORS = ['W', 'U', 'B', 'R', 'G'];
const CURVE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7+'];

function primaryType(typeLine = '') {
  for (const t of TYPE_ORDER) if (typeLine.includes(t)) return t;
  return 'Other';
}

// Counts colored mana pips in a mana cost string, e.g. "{2}{R}{R}" -> {R: 2}.
// Hybrid/Phyrexian symbols like {R/W} or {R/P} count toward every color they touch.
function pipCounts(manaCost = '') {
  const counts = {};
  const symbols = manaCost.match(/\{[^}]+\}/g) || [];
  for (const sym of symbols) {
    const inner = sym.slice(1, -1);
    for (const part of inner.split('/')) {
      if (PIP_COLORS.includes(part)) counts[part] = (counts[part] || 0) + 1;
    }
  }
  return counts;
}

// Cardmarket (EUR) price for the specific finish this copy was printed in.
// There's no eur_etched field on Scryfall, so etched copies fall back to the foil price.
function cardPriceEur(c) {
  const d = c.data;
  if (!d || d.notFound) return null;
  const price = c.finish === 'F' || c.finish === 'E'
    ? (d.price_eur_foil ?? d.price_eur)
    : (d.price_eur ?? d.price_eur_foil);
  return price != null ? parseFloat(price) : null;
}

function cmcBucket(cmc) {
  if (cmc >= 7) return '7+';
  return String(Math.floor(cmc));
}

function money(n) {
  return n == null ? null : `€${n.toFixed(2)}`;
}

// "Owned" marks made in Export mode — keyed by set:collector (c.key, stable
// across re-renders) rather than stored on the card objects themselves, so
// a decklist re-import/refresh can't silently wipe them. Per deck name, so
// switching decks doesn't bleed one deck's marks into another's.
const OWNED_KEY_PREFIX = 'edh_owned_';

function loadOwnedKeys(deckName) {
  try { return new Set(JSON.parse(localStorage.getItem(OWNED_KEY_PREFIX + deckName)) || []); }
  catch { return new Set(); }
}

function saveOwnedKeys(deckName, keys) {
  localStorage.setItem(OWNED_KEY_PREFIX + deckName, JSON.stringify([...keys]));
}

export function computeStats(cards, { excludedCategories = new Set(), excludedTypes = new Set() } = {}) {
  const totalCards = cards.reduce((s, c) => s + c.qty, 0);
  const uniqueCards = cards.length;

  const allWithData = cards.filter(c => c.data && !c.data.notFound);
  const totalPrice = allWithData.reduce((s, c) => {
    const p = cardPriceEur(c);
    return s + (p || 0) * c.qty;
  }, 0);

  // The charts below exclude the commander — it's always exactly one card,
  // so counting it just adds noise (a "Commander" category bar that's
  // always 1, an extra type/pip/curve entry) without telling you anything.
  const nonCommanderCards = cards.filter(c => !c.isCommander);
  const withData = nonCommanderCards.filter(c => c.data && !c.data.notFound);

  // Cards actually contributing to the Mana Curve / Color Pips below —
  // clicking a bar in Category Breakdown or Card Types toggles its cards
  // in and out here so you can see how removing a category/type would
  // shift the curve, without those two breakdown charts themselves (which
  // always show the full deck) changing shape.
  const activeWithData = withData.filter(c => !excludedCategories.has(c.category) && !excludedTypes.has(primaryType(c.data.type_line)));

  const nonland = activeWithData.filter(c => primaryType(c.data.type_line) !== 'Land');
  const nonlandQty = nonland.reduce((s, c) => s + c.qty, 0);
  const avgCmc = nonlandQty
    ? nonland.reduce((s, c) => s + c.data.cmc * c.qty, 0) / nonlandQty
    : 0;

  const curveMap = new Map();
  for (const c of nonland) {
    const b = cmcBucket(c.data.cmc);
    curveMap.set(b, (curveMap.get(b) || 0) + c.qty);
  }
  const manaCurve = CURVE_ORDER.map(b => ({ label: b, value: curveMap.get(b) || 0 }));

  const pipMap = new Map();
  for (const c of activeWithData) {
    const counts = pipCounts(c.data.mana_cost || '');
    for (const [color, n] of Object.entries(counts)) {
      pipMap.set(color, (pipMap.get(color) || 0) + n * c.qty);
    }
  }
  const colorPips = PIP_COLORS
    .map(k => ({ label: COLOR_LABELS[k], value: pipMap.get(k) || 0, color: COLORS[k] }))
    .filter(d => d.value > 0);

  const catMap = new Map();
  for (const c of nonCommanderCards) catMap.set(c.category, (catMap.get(c.category) || 0) + c.qty);
  const categoryBreakdown = [...catMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));

  // Per-category mana curve, shown inline within each category's gallery section.
  // Skipped for categories with fewer than 2 nonland cards, where a curve isn't meaningful.
  const categoryCurveCounts = new Map();
  for (const c of nonland) {
    const b = cmcBucket(c.data.cmc);
    if (!categoryCurveCounts.has(c.category)) categoryCurveCounts.set(c.category, new Map());
    const m = categoryCurveCounts.get(c.category);
    m.set(b, (m.get(b) || 0) + c.qty);
  }
  const categoryCurves = new Map();
  for (const [cat, bucketMap] of categoryCurveCounts) {
    const total = [...bucketMap.values()].reduce((s, v) => s + v, 0);
    if (total < 2) continue;
    categoryCurves.set(cat, CURVE_ORDER.map(b => ({ label: b, value: bucketMap.get(b) || 0 })));
  }

  const typeMap = new Map();
  for (const c of withData) {
    const t = primaryType(c.data.type_line);
    typeMap.set(t, (typeMap.get(t) || 0) + c.qty);
  }
  const typeBreakdown = [...typeMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));

  const commander = cards.find(c => c.isCommander);
  const notFound = cards.filter(c => c.data?.notFound);

  return {
    totalCards, uniqueCards, avgCmc, totalPrice,
    manaCurve, categoryCurves,
    colorPips, categoryBreakdown, typeBreakdown,
    commander, notFound,
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cardTile(c, ctx = {}) {
  const data = c.data;
  const owned = ctx.exportMode && ctx.ownedKeys.has(c.key);
  const tileClass = `card-tile${ctx.exportMode ? ' card-tile--export' : ''}${owned ? ' card-tile--owned' : ''}`;
  const ownedBadge = ctx.exportMode ? `<span class="card-tile__owned-badge">${owned ? '✓ Owned' : ''}</span>` : '';

  if (!data || data.notFound) {
    return `<div class="card-cell">
      <div class="${tileClass} card-tile--missing" data-key="${escapeHtml(c.key)}" title="Not found on Scryfall: ${escapeHtml(c.name)}">
        ${ownedBadge}
        <div class="card-tile__placeholder">${escapeHtml(c.name)}</div>
      </div>
    </div>`;
  }
  const img = data.image_small || data.image;
  const full = data.image || data.image_small;
  const price = cardPriceEur(c);
  const priceLabel = price != null ? money(price) : '—';
  return `<div class="card-cell">
    <div class="${tileClass}" data-key="${escapeHtml(c.key)}" data-full="${escapeHtml(full)}" data-uri="${escapeHtml(data.scryfall_uri)}" data-name="${escapeHtml(data.name)}" data-price="${price != null ? escapeHtml(money(price)) : ''}">
      ${c.qty > 1 ? `<span class="card-tile__qty">${c.qty}x</span>` : ''}
      ${c.finish ? `<span class="card-tile__finish">${c.finish}</span>` : ''}
      ${ownedBadge}
      <img loading="lazy" src="${escapeHtml(img)}" alt="${escapeHtml(data.name)}">
    </div>
    <div class="card-price">${priceLabel}</div>
  </div>`;
}

// FYI reference only — these don't count toward Total Cards, the charts, or
// Est. Value, since they're not cards you're buying or building around.
function tokenTile(t) {
  const d = t.data;
  if (!d) return '';
  const img = d.image_small || d.image;
  const full = d.image || d.image_small;
  return `<div class="card-cell">
    <div class="card-tile card-tile--token" data-full="${escapeHtml(full)}" data-uri="${escapeHtml(d.scryfall_uri)}" data-name="${escapeHtml(t.name)}">
      <img loading="lazy" src="${escapeHtml(img)}" alt="${escapeHtml(t.name)}">
    </div>
    <div class="card-price">${escapeHtml(d.type_line || '')}</div>
  </div>`;
}

const SORT_OPTIONS = [
  { key: 'name', label: 'Name', cmp: (a, b) => a.name.localeCompare(b.name) },
  { key: 'cmc', label: 'CMC', cmp: (a, b) => (a.data?.cmc ?? 0) - (b.data?.cmc ?? 0) || a.name.localeCompare(b.name) },
  // Highest value first — missing price data sorts to the end either way.
  { key: 'price', label: 'Price', cmp: (a, b) => (cardPriceEur(b) ?? -1) - (cardPriceEur(a) ?? -1) || a.name.localeCompare(b.name) },
];

export function renderDeck(deck, root, { exportMode: initialExportMode = false } = {}) {
  // Clicking a Category Breakdown/Card Types bar toggles its cards out of
  // the Mana Curve/Color Pips below (see computeStats), so you can see how
  // dropping a category or type would shift the curve without actually
  // editing the decklist. Local to this render — switching decks resets it.
  const excludedCategories = new Set();
  const excludedTypes = new Set();
  let gallerySort = 'name';
  // Export mode: clicking a card marks it "already owned" instead of
  // opening the lightbox. ownedKeys persists (see loadOwnedKeys) so marks
  // survive leaving and re-entering export mode, or reloading the page.
  let exportMode = initialExportMode;
  const ownedKeys = loadOwnedKeys(deck.name);

  const draw = () => {
    const stats = computeStats(deck.cards, { excludedCategories, excludedTypes });
    const commanderData = stats.commander?.data;
    const categoryColor = new Map(stats.categoryBreakdown.map((d, i) => [d.label, paletteColor(i)]));
    const sortOption = SORT_OPTIONS.find(o => o.key === gallerySort);
    const missingCards = deck.cards.filter(c => !ownedKeys.has(c.key));

    root.innerHTML = `
      <div class="deck-header">
        ${commanderData && !commanderData.notFound ? `
          <img class="commander-art" src="${escapeHtml(commanderData.image_small || commanderData.image)}" alt="${escapeHtml(commanderData.name)}">
        ` : ''}
        <div class="deck-header__info">
          <div class="deck-header__title-row">
            <h2>${escapeHtml(deck.name)}</h2>
            <button class="btn" id="export-toggle-btn">${exportMode ? 'Exit Export' : 'Export'}</button>
          </div>
          ${commanderData ? `<div class="commander-name">Commander: ${escapeHtml(commanderData.name)}</div>` : ''}
          <div class="deck-header__stats">
            <div class="stat"><span class="stat__value">${stats.totalCards}</span><span class="stat__label">Total Cards</span></div>
            <div class="stat"><span class="stat__value">${stats.uniqueCards}</span><span class="stat__label">Unique</span></div>
            <div class="stat"><span class="stat__value">${stats.avgCmc.toFixed(2)}</span><span class="stat__label">Avg CMC</span></div>
            <div class="stat"><span class="stat__value">${money(stats.totalPrice) ?? '—'}</span><span class="stat__label">Est. Value (Cardmarket)</span></div>
          </div>
        </div>
      </div>

      ${exportMode ? `
        <div class="export-banner">
          <p><strong>Export mode:</strong> click a card below to mark it as one you already own —
            owned cards are shown dimmed with a ✓ and left out of the export. Everything else stays
            playable here as normal; this only affects what gets copied.</p>
          <div class="export-banner__actions">
            <button class="btn btn--primary" id="export-copy-btn">Copy Wantlist (${missingCards.length} card${missingCards.length === 1 ? '' : 's'})</button>
            <button class="btn" id="export-done-btn">Done</button>
          </div>
        </div>
      ` : ''}

      ${stats.notFound.length ? `
        <div class="warning-box">
          ${stats.notFound.length} card(s) not found on Scryfall: ${stats.notFound.map(c => escapeHtml(c.name)).join(', ')}
        </div>
      ` : ''}

      <div class="charts-grid">
        <div class="chart-card">
          <h3>Mana Curve</h3>
          ${barChart(stats.manaCurve, { color: '#7c5cff' })}
        </div>
        <div class="chart-card">
          <h3>Color Pips</h3>
          <div class="donut-row">
            ${donutChart(stats.colorPips)}
            <ul class="legend">
              ${stats.colorPips.map(d => `<li><span class="swatch" style="background:${d.color}"></span>${d.label} (${d.value})</li>`).join('')}
            </ul>
          </div>
        </div>
        <div class="chart-card${stats.categoryBreakdown.length > 5 ? ' chart-card--wide' : ''}">
          <h3>Category Breakdown</h3>
          <p class="chart-hint">Click a bar to exclude/include it in the Mana Curve &amp; Color Pips above.</p>
          ${barChart(stats.categoryBreakdown, { colorFn: (d) => categoryColor.get(d.label), interactive: 'category', excluded: excludedCategories })}
        </div>
        <div class="chart-card${stats.typeBreakdown.length > 5 ? ' chart-card--wide' : ''}">
          <h3>Card Types</h3>
          <p class="chart-hint">Click a bar to exclude/include it in the Mana Curve &amp; Color Pips above.</p>
          ${barChart(stats.typeBreakdown, { colorFn: (_, i) => paletteColor(i + 3), interactive: 'type', excluded: excludedTypes })}
        </div>
      </div>

      <div class="gallery">
        <div class="gallery-sort">
          Sort:
          ${SORT_OPTIONS.map(o => `<button class="gallery-sort__btn${o.key === gallerySort ? ' active' : ''}" data-sort="${o.key}">${o.label}</button>`).join('')}
        </div>
        ${stats.categoryBreakdown.map(({ label: cat }) => {
          const cardsInCat = deck.cards.filter(c => c.category === cat).sort(sortOption.cmp);
          const curve = stats.categoryCurves.get(cat);
          const categoryValue = cardsInCat.reduce((s, c) => s + (cardPriceEur(c) || 0) * c.qty, 0);
          const hasCategoryPrice = cardsInCat.some(c => cardPriceEur(c) != null);
          return `
            <section class="category-section">
              <h3>${escapeHtml(cat)} <span class="count">${cardsInCat.reduce((s, c) => s + c.qty, 0)}</span>${hasCategoryPrice ? `<span class="category-value">${money(categoryValue)}</span>` : ''}</h3>
              ${curve ? `
                <div class="category-curve">
                  ${barChart(curve, { width: 420, height: 110, color: categoryColor.get(cat) })}
                </div>
              ` : ''}
              <div class="card-grid">
                ${cardsInCat.map(c => cardTile(c, { exportMode, ownedKeys })).join('')}
              </div>
            </section>`;
        }).join('')}
      </div>

      ${deck.tokens?.length ? `
        <div class="token-section">
          <h3>Tokens <span class="count">${deck.tokens.length}</span></h3>
          <p class="chart-hint">Tokens this deck can create — for reference only, not counted in the stats above.</p>
          <div class="card-grid">
            ${deck.tokens.map(tokenTile).join('')}
          </div>
        </div>
      ` : ''}
    `;

    if (exportMode) {
      root.querySelectorAll('.card-tile[data-key]').forEach(tile => {
        tile.addEventListener('click', () => {
          const key = tile.dataset.key;
          if (ownedKeys.has(key)) ownedKeys.delete(key); else ownedKeys.add(key);
          saveOwnedKeys(deck.name, ownedKeys);
          draw();
        });
      });
    } else {
      root.querySelectorAll('.card-tile[data-full]:not(.card-tile--token)').forEach(tile => {
        tile.addEventListener('click', () => openLightbox(tile.dataset));
      });
    }

    // Tokens open the lightbox in every mode — they're not part of Export
    // (no key/qty/price), so exportMode's toggle-owned wiring above skips them.
    root.querySelectorAll('.card-tile--token[data-full]').forEach(tile => {
      tile.addEventListener('click', () => openLightbox(tile.dataset));
    });

    document.getElementById('export-toggle-btn')?.addEventListener('click', () => {
      exportMode = !exportMode;
      draw();
    });

    document.getElementById('export-done-btn')?.addEventListener('click', () => {
      exportMode = false;
      draw();
    });

    document.getElementById('export-copy-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const text = missingCards.map(c => `${c.qty}x ${c.data?.name || c.name}`).join('\n');
      const original = btn.textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied to clipboard!';
      } catch {
        btn.textContent = 'Copy failed — select & copy manually';
      }
      setTimeout(() => { btn.textContent = original; }, 1800);
    });

    root.querySelectorAll('.chart-bar-group--interactive[data-label]').forEach(g => {
      g.addEventListener('click', () => {
        const set = g.dataset.kind === 'category' ? excludedCategories : excludedTypes;
        const label = g.dataset.label;
        if (set.has(label)) set.delete(label); else set.add(label);
        draw();
      });
    });

    root.querySelectorAll('.gallery-sort__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        gallerySort = btn.dataset.sort;
        draw();
      });
    });
  };

  draw();
}

export function openLightbox({ full, uri, name, price }) {
  let modal = document.getElementById('lightbox');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'lightbox';
    modal.className = 'lightbox';
    modal.addEventListener('click', () => modal.classList.remove('open'));
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="lightbox__content">
      <img src="${escapeHtml(full)}" alt="${escapeHtml(name)}">
      <div class="lightbox__meta">
        <strong>${escapeHtml(name)}</strong>
        ${price ? `<span>${escapeHtml(price)}</span>` : ''}
        ${uri ? `<a href="${escapeHtml(uri)}" target="_blank" rel="noopener">View on Scryfall</a>` : ''}
      </div>
    </div>`;
  modal.classList.add('open');
}
