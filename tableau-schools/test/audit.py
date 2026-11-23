"""Shared in-page audit (text size, contrast, chip and circle overlap) used by render_test.py and standin_test.py."""

def lum(c):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
def contrast(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)

AUDIT = r"""() => {
  const root = document.getElementById('sc-root');
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3]));
  function bgOf(el) {           // solid colour actually behind an HTML element
    let layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
    }
    let base = [255, 255, 255];
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  }
  const out = { text: [], chips: [], overlaps: 0, circles: 0, shown: 0, fonts: [], hscroll: document.documentElement.scrollWidth > innerWidth + 1, ranges: document.querySelectorAll('input[type=range]').length };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let t; while ((t = walker.nextNode())) {
    const s = t.nodeValue.trim(); if (!s) continue;
    const el = t.parentElement; if (!el) continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || (r.width === 0 && r.height === 0)) continue;
    if (el.closest('.sc-panel:not(.open)')) continue;
    let bg, fg = parse(cs.color);
    if (el instanceof SVGElement) { const g = el.closest('.sc-chip'); const rect = g && g.querySelector('rect'); bg = parse(getComputedStyle(rect).fill); fg = parse(getComputedStyle(el).fill); bg = bg.slice(0, 3); }
    else bg = bgOf(el);
    out.text.push({ s: s.slice(0, 40), size: parseFloat(cs.fontSize), fg: fg.slice(0, 3), bg, family: cs.fontFamily, svg: el instanceof SVGElement });
  }
  const circles = {}; document.querySelectorAll('.sc-c').forEach(c => { out.circles++; if (c.style.display !== 'none') out.shown++; circles[c.getAttribute('data-i')] = c; });
  const stage = document.querySelector('.sc-stage').getBoundingClientRect();
  const rects = [];
  out.cchips = [];
  document.querySelectorAll('.sc-chip').forEach(g => {
    const rc = g.querySelector('rect'), r = rc.getBoundingClientRect(), tx = g.querySelector('text').getBoundingClientRect();
    const inStage = r.left >= stage.left - 0.5 && r.right <= stage.right + 0.5 && r.top >= stage.top - 0.5 && r.bottom <= stage.bottom + 0.5;
    const textFits = tx.width <= r.width + 0.5 && tx.height <= r.height + 0.5, text = g.querySelector('text').textContent;
    if (g.classList.contains('sc-cchip')) { out.cchips.push({ c: g.getAttribute('data-c'), inStage, textFits, text }); }
    else {
      const c = circles[g.getAttribute('data-i')];
      const cx = +c.getAttribute('cx') + stage.left, cy = +c.getAttribute('cy') + stage.top, cr = +c.getAttribute('r');
      let inside = true;
      [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].forEach(p => { if (Math.hypot(p[0] - cx, p[1] - cy) > cr + 0.6) inside = false; });
      out.chips.push({ inside, inStage, textFits, text });
    }
    rects.push(r);
  });
  // every circle, measured from the DOM: pairwise overlap, and inside the stage
  const cs = [...document.querySelectorAll('.sc-c')].filter(c => c.style.display !== 'none').map(c => ({ x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), r: +c.getAttribute('r') }));
  out.circleOverlaps = 0; out.circleOutside = 0; out.circlePairs = 0; out.minGap = Infinity;
  const sw = stage.width, sh = stage.height;
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i]; if (a.x - a.r < -0.5 || a.y - a.r < -0.5 || a.x + a.r > sw + 0.5 || a.y + a.r > sh + 0.5) out.circleOutside++;
    for (let j = i + 1; j < cs.length; j++) { const b = cs[j], gap = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r; out.circlePairs++; if (gap < out.minGap) out.minGap = gap; if (gap < -0.05) out.circleOverlaps++; }
  }
  out.circleCount = cs.length;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) out.overlaps++; }
  // HTML chips (breadcrumb, legend) must not overlap each other or the gear
  const html = [...document.querySelectorAll('.sc-key, .sc-gear, .ctab-exit')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.getBoundingClientRect());
  out.htmlOverlaps = 0; for (let i = 0; i < html.length; i++) for (let j = i + 1; j < html.length; j++) { const a = html[i], b = html[j]; if (a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5) out.htmlOverlaps++; }
  out.htmlCount = html.length;
  return out;
}"""

