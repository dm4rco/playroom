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

// `interactive` (a string like 'category'/'type') makes every bar clickable
// — render.js delegates a click listener that toggles the bar's label in
// and out of an exclusion set, dimming it here via `excluded` and (in
// computeStats) filtering it out of the Mana Curve/Color Pips downstream.
export function barChart(data, { width = 480, height = 220, color = '#7c5cff', colorFn, interactive = null, excluded = null } = {}) {
  const sidePad = 30;
  const topPad = 30;
  const max = Math.max(1, ...data.map(d => d.value));
  const n = Math.max(1, data.length);
  const barW = (width - sidePad * 2) / n;

  // Angle labels only when they'd actually overlap at this bar width — short
  // labels (mana curve's "0".."7+") stay horizontal even with many bars,
  // while long category names rotate once they no longer fit.
  const maxLabelLen = Math.max(0, ...data.map(d => String(d.label).length));
  const rotateLabels = maxLabelLen * 7 > barW * 0.9;
  const bottomPad = rotateLabels ? 76 : 30;
  const h = rotateLabels ? height + 46 : height;

  const bars = data.map((d, i) => {
    const barH = (d.value / max) * (h - topPad - bottomPad);
    const x = sidePad + i * barW;
    const y = h - bottomPad - barH;
    const fill = colorFn ? colorFn(d, i) : color;
    const labelX = x + barW / 2;
    const labelY = h - bottomPad + (rotateLabels ? 10 : 16);
    const label = rotateLabels
      ? `<text x="${labelX}" y="${labelY}" text-anchor="end" transform="rotate(-45 ${labelX} ${labelY})" class="chart-label">${escapeXml(d.label)}</text>`
      : `<text x="${labelX}" y="${labelY}" text-anchor="middle" class="chart-label">${escapeXml(d.label)}</text>`;
    const isExcluded = excluded?.has(d.label);
    const groupClass = interactive
      ? `chart-bar-group chart-bar-group--interactive${isExcluded ? ' chart-bar-group--excluded' : ''}`
      : 'chart-bar-group';
    const groupAttrs = interactive ? ` data-kind="${escapeXml(interactive)}" data-label="${escapeXml(d.label)}"` : '';
    // An invisible full-height rect widens the click target to the whole
    // column (not just the visible bar, which can be a sliver near 0).
    const hitRect = interactive
      ? `<rect class="chart-hit" x="${x}" y="0" width="${barW}" height="${h}" fill="transparent" pointer-events="all"></rect>`
      : '';
    return `
      <g class="${groupClass}"${groupAttrs}>
        ${hitRect}
        <rect x="${x + barW * 0.15}" y="${y}" width="${barW * 0.7}" height="${Math.max(barH, 1)}" rx="3" fill="${fill}"><title>${escapeXml(d.label)}: ${d.value}${interactive ? (isExcluded ? ' (excluded — click to include)' : ' (click to exclude from Mana Curve/Color Pips)') : ''}</title></rect>
        ${label}
        <text x="${labelX}" y="${y - 6}" text-anchor="middle" class="chart-value">${d.value}</text>
      </g>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${h}" class="chart${interactive ? ' chart--interactive' : ''}" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
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
