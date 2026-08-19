export const COLORS = {
  W: '#f8f6d8',
  U: '#0e68ab',
  B: '#8b7fb0',
  R: '#d3202a',
  G: '#00733e',
  C: '#9a9a9a',
  M: '#cca44b', // multicolor
};

const PALETTE = ['#7c5cff', '#4fc3f7', '#66bb6a', '#ffca28', '#ef5350', '#ab47bc', '#8d6e63', '#78909c'];

export function paletteColor(i) {
  return PALETTE[i % PALETTE.length];
}

export function barChart(data, { width = 480, height = 220, color = '#7c5cff', colorFn } = {}) {
  const padding = 30;
  const max = Math.max(1, ...data.map(d => d.value));
  const n = Math.max(1, data.length);
  const barW = (width - padding * 2) / n;

  const bars = data.map((d, i) => {
    const h = (d.value / max) * (height - padding * 2);
    const x = padding + i * barW;
    const y = height - padding - h;
    const fill = colorFn ? colorFn(d, i) : color;
    return `
      <g>
        <rect x="${x + barW * 0.15}" y="${y}" width="${barW * 0.7}" height="${Math.max(h, 1)}" rx="3" fill="${fill}"></rect>
        <text x="${x + barW / 2}" y="${height - padding + 16}" text-anchor="middle" class="chart-label">${escapeXml(d.label)}</text>
        <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" class="chart-value">${d.value}</text>
      </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" class="chart" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
}

export function stackedBarChart(buckets, categories, { width = 600, height = 260, colorFn } = {}) {
  const padding = 34;
  const totals = buckets.map(b => categories.reduce((s, cat) => s + (b.values[cat] || 0), 0));
  const max = Math.max(1, ...totals);
  const n = Math.max(1, buckets.length);
  const barW = (width - padding * 2) / n;

  const bars = buckets.map((b, i) => {
    const x = padding + i * barW;
    let yCursor = height - padding;
    const segs = categories.map((cat, ci) => {
      const v = b.values[cat] || 0;
      if (!v) return '';
      const h = (v / max) * (height - padding * 2);
      const y = yCursor - h;
      yCursor = y;
      const fill = colorFn(cat, ci);
      return `<rect x="${x + barW * 0.15}" y="${y}" width="${barW * 0.7}" height="${h}" fill="${fill}"><title>${escapeXml(cat)}: ${v}</title></rect>`;
    }).join('');
    return `
      <g>
        ${segs}
        <text x="${x + barW / 2}" y="${height - padding + 18}" text-anchor="middle" class="chart-label">${escapeXml(b.label)}</text>
        ${totals[i] ? `<text x="${x + barW / 2}" y="${yCursor - 6}" text-anchor="middle" class="chart-value">${totals[i]}</text>` : ''}
      </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" class="chart" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
}

export function donutChart(data, { size = 200, innerRatio = 0.55 } = {}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2 - 4;
  const cx = size / 2, cy = size / 2;
  const ir = r * innerRatio;
  let angle = -Math.PI / 2;

  const segs = data.filter(d => d.value > 0).map(d => {
    const frac = d.value / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2 - (frac < 1 ? 0.015 : 0);
    angle = a0 + frac * Math.PI * 2;

    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const xi0 = cx + ir * Math.cos(a0), yi0 = cy + ir * Math.sin(a0);
    const xi1 = cx + ir * Math.cos(a1), yi1 = cy + ir * Math.sin(a1);
    const large = frac > 0.5 ? 1 : 0;

    const path = `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${xi1},${yi1} A${ir},${ir} 0 ${large} 0 ${xi0},${yi0} Z`;
    return `<path d="${path}" fill="${d.color}"><title>${escapeXml(d.label)}: ${d.value}</title></path>`;
  }).join('');

  return `<svg viewBox="0 0 ${size} ${size}" class="chart donut">${segs}</svg>`;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
