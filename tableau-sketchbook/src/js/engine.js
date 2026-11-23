/* Sketchbook - pure layout maths. No DOM, no Tableau, no rough.js: it decides
 * WHERE every mark goes and which seed each mark is drawn with. The sketch
 * itself is rough.js (render.js). Covered by test/run.js. */
(function (global) {
  'use strict';
  var HX = global.HX;

  var PALETTES = {
    divers: ['#2aa9b8', '#e8a53a', '#e8873a', '#6f7fe0', '#4fae78', '#d9578a', '#8f9aa6', '#9a6fd6'],
    okabe: ['#0072b2', '#e69f00', '#009e73', '#d55e00', '#56b4e9', '#cc79a7', '#f0e442', '#555555'],
    ink: ['#3d4752', '#6b7682', '#99a2ad', '#c4cad1', '#222a33', '#555f6a', '#808b97', '#adb5bf']
  };
  function seriesColor (palette, i) {
    var p = PALETTES[palette] || PALETTES.divers;
    return p[i % p.length];
  }

  /* Rows {cat, series, value, label, id} into categories x series. Rows that
   * share a category and series are summed (Tableau can send several per mark). */
  function aggregate (rows, sort) {
    var catMap = {}, serMap = {}, cats = [], series = [], cells = {};
    rows.forEach(function (r) {
      if (!Object.prototype.hasOwnProperty.call(catMap, r.cat)) { catMap[r.cat] = { key: r.cat, total: 0, order: cats.length }; cats.push(catMap[r.cat]); }
      if (!Object.prototype.hasOwnProperty.call(serMap, r.series)) { serMap[r.series] = { key: r.series, order: series.length }; series.push(serMap[r.series]); }
      var k = r.cat + '\u0001' + r.series;
      if (!cells[k]) cells[k] = { value: 0, ids: [], label: r.label || '', cat: r.cat, series: r.series };
      cells[k].value += r.value; cells[k].ids.push(r.id);
      if (r.label && !cells[k].label) cells[k].label = r.label;
      catMap[r.cat].total += r.value;
    });
    if (sort === 'value-desc') cats.sort(function (a, b) { return b.total - a.total || a.order - b.order; });
    else if (sort === 'value-asc') cats.sort(function (a, b) { return a.total - b.total || a.order - b.order; });
    else if (sort === 'alpha') cats.sort(function (a, b) { return String(a.key).localeCompare(String(b.key), undefined, { numeric: true }); });
    return { cats: cats, series: series, cell: function (c, s) { return cells[c.key + '\u0001' + s.key] || null; } };
  }

  /* The value axis: bars always include zero. The domain snaps to tick steps. */
  function valueDomain (agg, type, zero, tickCount, fixLo, fixHi) {
    var lo = Infinity, hi = -Infinity;
    agg.cats.forEach(function (c) { agg.series.forEach(function (s) {
      var cell = agg.cell(c, s); if (!cell) return;
      if (cell.value < lo) lo = cell.value; if (cell.value > hi) hi = cell.value;
    }); });
    if (!isFinite(lo)) return { lo: 0, hi: 1, step: 0.2 };
    if (type === 'bar' || zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (fixLo !== null && fixLo !== undefined && !(type === 'bar' && fixLo > 0)) lo = fixLo;
    if (fixHi !== null && fixHi !== undefined && fixHi > lo) hi = fixHi;
    if (hi === lo) { var d = Math.abs(hi) * 0.1 || 1; lo -= d; hi += d; }
    var step = HX.niceStep(hi - lo, tickCount);
    var nlo = Math.floor(lo / step + 1e-9) * step, nhi = Math.ceil(hi / step - 1e-9) * step;
    if (nhi === nlo) nhi = nlo + step;
    return { lo: nlo, hi: nhi, step: step };
  }

  function linear (d0, d1, r0, r1) {
    var k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
    return function (v) { return r0 + (v - d0) * k; };
  }

  /* Boxes for every cell. plot = {x, y, w, h}. */
  function marks (agg, plot, dom, s) {
    var nC = agg.cats.length, nS = agg.series.length;
    var step = plot.w / Math.max(1, nC), sy = linear(dom.lo, dom.hi, plot.y + plot.h, plot.y);
    var zeroY = sy(Math.max(dom.lo, Math.min(dom.hi, 0)));
    var groupW = step * (s.chartType === 'bar' ? s.barWidth / 100 : 0.7);
    var slot = groupW / nS;
    var out = [];
    agg.cats.forEach(function (c, ci) {
      var cx = plot.x + step * (ci + 0.5);
      agg.series.forEach(function (sr, si) {
        var cell = agg.cell(c, sr);
        if (!cell) return;
        var m = { ci: ci, si: si, cell: cell, cx: cx, value: cell.value, y: sy(cell.value) };
        if (s.chartType === 'bar') {
          var gap = nS > 1 ? Math.min(3, slot * 0.12) : 0;
          m.x = cx - groupW / 2 + si * slot + gap / 2; m.w = Math.max(1, slot - gap);
          m.top = Math.min(m.y, zeroY); m.h = Math.abs(m.y - zeroY);
          m.cx = m.x + m.w / 2;
        } else if (s.chartType === 'dot') {
          m.cx = cx + (si - (nS - 1) / 2) * slot;
          m.d = Math.max(6, Math.min(s.dotSize, slot - 2));
          m.baseY = zeroY;
        }
        out.push(m);
      });
    });
    return { marks: out, step: step, zeroY: zeroY, sy: sy, groupW: groupW };
  }

  /* One non-zero seed per mark, from the user's seed. Pure and stable, so a
   * redraw, a resize or a reload draws the same wobble. rough.js treats seed 0
   * as "random every time", so 0 is never returned. */
  function seedFor (base, ci, si, kind) {
    var h = (Math.imul(base | 0, 2654435761) ^ Math.imul(ci + 1, 40503) ^ Math.imul(si + 1, 69069) ^ Math.imul(kind + 1, 374761393)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return (h % 2147483646) + 1;
  }

  function truncate (text, max) {
    text = String(text);
    return text.length > max ? text.slice(0, Math.max(1, max - 1)) + '…' : text;
  }

  global.SB = global.SB || {};
  global.SB.engine = { PALETTES: PALETTES, seriesColor: seriesColor, aggregate: aggregate, valueDomain: valueDomain, linear: linear, marks: marks, seedFor: seedFor, truncate: truncate };
})(typeof window !== 'undefined' ? window : globalThis);
