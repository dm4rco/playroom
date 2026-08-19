import { barChart, donutChart, stackedBarChart, COLORS, paletteColor } from './charts.js';

const TYPE_ORDER = ['Land', 'Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment'];
const COLOR_LABELS = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
const PIP_COLORS = ['W', 'U', 'B', 'R', 'G'];
const CATEGORY_ORDER_HINT = ['Commander']; // pinned first; rest sorted by count
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

export function computeStats(cards) {
  const withData = cards.filter(c => c.data && !c.data.notFound);
  const totalCards = cards.reduce((s, c) => s + c.qty, 0);
  const uniqueCards = cards.length;

  const nonland = withData.filter(c => primaryType(c.data.type_line) !== 'Land');
  const nonlandQty = nonland.reduce((s, c) => s + c.qty, 0);
  const avgCmc = nonlandQty
    ? nonland.reduce((s, c) => s + c.data.cmc * c.qty, 0) / nonlandQty
    : 0;

  const totalPrice = withData.reduce((s, c) => {
    const p = cardPriceEur(c);
    return s + (p || 0) * c.qty;
  }, 0);

  const curveMap = new Map();
  for (const c of nonland) {
    const b = cmcBucket(c.data.cmc);
    curveMap.set(b, (curveMap.get(b) || 0) + c.qty);
  }
  const manaCurve = CURVE_ORDER.map(b => ({ label: b, value: curveMap.get(b) || 0 }));

  const pipMap = new Map();
  for (const c of withData) {
    const counts = pipCounts(c.data.mana_cost || '');
    for (const [color, n] of Object.entries(counts)) {
      pipMap.set(color, (pipMap.get(color) || 0) + n * c.qty);
    }
  }
  const colorPips = PIP_COLORS
    .map(k => ({ label: COLOR_LABELS[k], value: pipMap.get(k) || 0, color: COLORS[k] }))
    .filter(d => d.value > 0);

  const catMap = new Map();
  for (const c of cards) catMap.set(c.category, (catMap.get(c.category) || 0) + c.qty);
  const categoryBreakdown = [...catMap.entries()]
    .sort((a, b) => {
      const ai = CATEGORY_ORDER_HINT.indexOf(a[0]);
      const bi = CATEGORY_ORDER_HINT.indexOf(b[0]);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return b[1] - a[1];
    })
    .map(([label, value]) => ({ label, value }));

  // Same category order/coloring as the breakdown chart, so the two stay visually linked.
  const curveCatMap = new Map();
  for (const c of nonland) {
    const b = cmcBucket(c.data.cmc);
    if (!curveCatMap.has(b)) curveCatMap.set(b, {});
    const bucket = curveCatMap.get(b);
    bucket[c.category] = (bucket[c.category] || 0) + c.qty;
  }
  const curveCategories = categoryBreakdown.map(d => d.label).filter(cat => cat !== 'Land');
  const manaCurveByCategory = CURVE_ORDER.map(b => ({ label: b, values: curveCatMap.get(b) || {} }));

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
    manaCurve, manaCurveByCategory, curveCategories,
    colorPips, categoryBreakdown, typeBreakdown,
    commander, notFound,
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cardTile(c) {
  const data = c.data;
  if (!data || data.notFound) {
    return `<div class="card-tile card-tile--missing" title="Not found on Scryfall: ${escapeHtml(c.name)}">
      <div class="card-tile__placeholder">${escapeHtml(c.name)}</div>
    </div>`;
  }
  const img = data.image_small || data.image;
  const full = data.image || data.image_small;
  const price = cardPriceEur(c);
  return `<div class="card-tile" data-full="${escapeHtml(full)}" data-uri="${escapeHtml(data.scryfall_uri)}" data-name="${escapeHtml(data.name)}" data-price="${price != null ? escapeHtml(money(price)) : ''}">
    ${c.qty > 1 ? `<span class="card-tile__qty">${c.qty}x</span>` : ''}
    ${c.finish ? `<span class="card-tile__finish">${c.finish}</span>` : ''}
    <img loading="lazy" src="${escapeHtml(img)}" alt="${escapeHtml(data.name)}">
  </div>`;
}

export function renderDeck(deck, root) {
  const stats = computeStats(deck.cards);
  const commanderData = stats.commander?.data;
  const categoryColor = new Map(stats.categoryBreakdown.map((d, i) => [d.label, paletteColor(i)]));

  root.innerHTML = `
    <div class="deck-header">
      ${commanderData && !commanderData.notFound ? `
        <img class="commander-art" src="${escapeHtml(commanderData.image_small || commanderData.image)}" alt="${escapeHtml(commanderData.name)}">
      ` : ''}
      <div class="deck-header__info">
        <h2>${escapeHtml(deck.name)}</h2>
        ${commanderData ? `<div class="commander-name">Commander: ${escapeHtml(commanderData.name)}</div>` : ''}
        <div class="deck-header__stats">
          <div class="stat"><span class="stat__value">${stats.totalCards}</span><span class="stat__label">Total Cards</span></div>
          <div class="stat"><span class="stat__value">${stats.uniqueCards}</span><span class="stat__label">Unique</span></div>
          <div class="stat"><span class="stat__value">${stats.avgCmc.toFixed(2)}</span><span class="stat__label">Avg CMC</span></div>
          <div class="stat"><span class="stat__value">${money(stats.totalPrice) ?? '—'}</span><span class="stat__label">Est. Value (Cardmarket)</span></div>
        </div>
      </div>
    </div>

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
      <div class="chart-card">
        <h3>Category Breakdown</h3>
        ${barChart(stats.categoryBreakdown, { colorFn: (d) => categoryColor.get(d.label) })}
      </div>
      <div class="chart-card">
        <h3>Card Types</h3>
        ${barChart(stats.typeBreakdown, { colorFn: (_, i) => paletteColor(i + 3) })}
      </div>
      <div class="chart-card chart-card--wide">
        <h3>Mana Curve by Category</h3>
        ${stackedBarChart(stats.manaCurveByCategory, stats.curveCategories, { colorFn: (cat) => categoryColor.get(cat) })}
        <div class="chart-card__legend">
          ${stats.curveCategories.map(cat => `<span><span class="swatch" style="background:${categoryColor.get(cat)}"></span>${escapeHtml(cat)}</span>`).join('')}
        </div>
      </div>
    </div>

    <div class="gallery">
      ${stats.categoryBreakdown.map(({ label: cat }) => {
        const cardsInCat = deck.cards.filter(c => c.category === cat)
          .sort((a, b) => a.name.localeCompare(b.name));
        return `
          <section class="category-section">
            <h3>${escapeHtml(cat)} <span class="count">${cardsInCat.reduce((s, c) => s + c.qty, 0)}</span></h3>
            <div class="card-grid">
              ${cardsInCat.map(cardTile).join('')}
            </div>
          </section>`;
      }).join('')}
    </div>
  `;

  root.querySelectorAll('.card-tile[data-full]').forEach(tile => {
    tile.addEventListener('click', () => openLightbox(tile.dataset));
  });
}

function openLightbox({ full, uri, name, price }) {
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
