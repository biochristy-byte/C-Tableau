/* Panel Chart - the pure part: rows to categories and series, aggregation, sorting, stacking, nice ticks, and the full
 * layout (every mark, every text with its box, every grid line) for a given size. No DOM here, so the node tests can
 * prove the layout (text floor, no overlaps, inside the frame) and the browser gate proves the painted result.
 *
 * measure(text, sizePx, weight) returns a width in px. The browser passes a canvas measurer; node passes an estimate.
 */
(function (root, factory) {
  var CP = typeof require === 'function' && typeof module === 'object' ? require('../../lib/ctab-panel/ctab-panel.js') : root.CTabPanel;
  var m = factory(CP);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.PC = root.PC || {}; root.PC.model = m; }
})(typeof window !== 'undefined' ? window : globalThis, function (CP) {
  'use strict';
  var MIN_FONT = 14;
  var GUARDED = { tick: 1, cat: 1, axistitle: 1 };
  var MARK_CONTRAST = 3;
  var C = CP.color;

  function fontPx(v) { return Math.max(MIN_FONT, Math.round(typeof v === 'number' && isFinite(v) ? v : MIN_FONT)); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /* rows: [{cat, ser, value, x, tuple}] -> {cats, series, cells{c|s: {v, n, tuples}}} */
  function aggregate(rows, how) {
    var cats = [], ci = {}, sers = [], si = {}, cells = {};
    (rows || []).forEach(function (r) {
      var v = r.value;
      if (how !== 'count' && !isNum(v)) return;
      var c = String(r.cat), s = String(r.ser);
      if (!(c in ci)) { ci[c] = cats.length; cats.push(c); }
      if (!(s in si)) { si[s] = sers.length; sers.push(s); }
      var k = c + '\u0001' + s, cell = cells[k];
      if (!cell) cell = cells[k] = { v: null, n: 0, sum: 0, tuples: [] };
      cell.n++; cell.tuples.push(r.tuple);
      if (how === 'count') { cell.v = cell.n; return; }
      cell.sum += v;
      if (how === 'avg') cell.v = cell.sum / cell.n;
      else if (how === 'min') cell.v = cell.v === null ? v : Math.min(cell.v, v);
      else if (how === 'max') cell.v = cell.v === null ? v : Math.max(cell.v, v);
      else cell.v = cell.sum;
    });
    return { cats: cats, series: sers, cells: cells };
  }
  function cellKey(c, s) { return c + '\u0001' + s; }

  function total(agg, c, sers) { var t = 0; sers.forEach(function (s) { var cl = agg.cells[cellKey(c, s)]; if (cl && isNum(cl.v)) t += cl.v; }); return t; }

  /* Category order: sort mode, manual list order, hidden categories dropped, reverse, then first N. */
  function orderCats(agg, s, sers) {
    var cats = agg.cats.slice(), mode = s.sort;
    var listed = CP.mergeList(s.catOrder, cats.map(function (c) { return { key: c, name: c }; }));
    var hidden = {}; listed.forEach(function (it) { if (it.hidden) hidden[it.key] = 1; });
    if (mode === 'desc' || mode === 'asc') {
      var tot = {}; cats.forEach(function (c) { tot[c] = total(agg, c, sers); });
      cats.sort(function (a, b) { return mode === 'desc' ? tot[b] - tot[a] : tot[a] - tot[b]; });
    } else if (mode === 'name') {
      cats.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); });
    } else if (mode === 'manual') {
      cats = listed.map(function (it) { return it.key; });
    }
    cats = cats.filter(function (c) { return !hidden[c]; });
    if (s.flip) cats.reverse();
    if (s.topN > 0) cats = cats.slice(0, s.topN);
    return { cats: cats, listed: listed };
  }

  /* For each category and series: {v, a, b} where a..b is the span in value units. */
  function stack(agg, cats, sers, mode, gapZero) {
    var out = {};
    cats.forEach(function (c) {
      var pos = 0, neg = 0, sumAbs = 0;
      if (mode === 'percent') sers.forEach(function (s) { var cl = agg.cells[cellKey(c, s)]; if (cl && isNum(cl.v)) sumAbs += Math.abs(cl.v); });
      sers.forEach(function (s) {
        var cl = agg.cells[cellKey(c, s)], v = cl && isNum(cl.v) ? cl.v : (gapZero ? 0 : null);
        if (v === null) return;
        if (mode === 'percent') v = sumAbs > 0 ? v / sumAbs * 100 : 0;
        var e = { v: v, raw: cl && isNum(cl.v) ? cl.v : 0, tuples: cl ? cl.tuples : [], missing: !cl };
        if (mode === 'group') { e.a = 0; e.b = v; } else if (v >= 0) { e.a = pos; e.b = pos + v; pos += v; } else { e.a = neg; e.b = neg + v; neg += v; }
        out[cellKey(c, s)] = e;
      });
    });
    return out;
  }

  function niceStep(span, count) {
    var raw = span / Math.max(1, count), p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function niceTicks(lo, hi, count) {
    if (!isNum(lo) || !isNum(hi)) { lo = 0; hi = 1; }
    if (hi < lo) { var t = lo; lo = hi; hi = t; }
    if (hi === lo) { var pad = Math.abs(lo) * 0.1 || 1; lo -= pad; hi += pad; }
    var step = niceStep(hi - lo, Math.max(1, count - 1)), min = Math.floor(lo / step + 1e-9) * step, max = Math.ceil(hi / step - 1e-9) * step, ticks = [];
    for (var v = min, i = 0; v <= max + step * 1e-6 && i < 60; v += step, i++) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toFixed(10));
    return { min: min, max: max, step: step, ticks: ticks };
  }

  function median(a) { var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : 0; }

  /* Fit text into a width: whole words, up to `lines` lines, an ellipsis on the last one if it still runs over. */
  function fitText(measure, text, size, weight, width, lines) {
    text = String(text === null || text === undefined ? '' : text);
    if (width <= 0) return [];
    if (measure(text, size, weight) <= width) return [text];
    var words = text.split(/\s+/), out = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var tryS = cur ? cur + ' ' + words[i] : words[i];
      if (measure(tryS, size, weight) <= width || !cur) { cur = tryS; continue; }
      out.push(cur); cur = words[i];
      if (out.length === lines - 1) { cur = words.slice(i).join(' '); break; }
    }
    out.push(cur);
    out = out.slice(0, Math.max(1, lines));
    var last = out[out.length - 1];
    if (measure(last, size, weight) > width) {
      var lo = 0, hi = last.length;
      while (lo < hi) { var mid = Math.ceil((lo + hi) / 2); if (measure(last.slice(0, mid) + '…', size, weight) <= width) lo = mid; else hi = mid - 1; }
      last = lo > 0 ? last.slice(0, lo).replace(/\s+$/, '') + '…' : '';
      out[out.length - 1] = last;
    }
    for (var j = 0; j < out.length - 1; j++) if (measure(out[j], size, weight) > width) out[j] = fitText(measure, out[j], size, weight, width, 1)[0] || '';
    return out.filter(function (l) { return l; });
  }

  function boxOf(t) {
    var w = t.w, h = t.h, x0;
    if (t.rotate) { var cx = t.x, cy = t.y; return { l: cx - h / 2, r: cx + h / 2, t: cy - w / 2, b: cy + w / 2 }; }
    x0 = t.anchor === 'middle' ? t.x - w / 2 : t.anchor === 'end' ? t.x - w : t.x;
    return { l: x0, r: x0 + w, t: t.y - h / 2, b: t.y + h / 2 };
  }
  function hit(a, b, pad) { pad = pad || 0; return a.l < b.r + pad && b.l < a.r + pad && a.t < b.b + pad && b.t < a.b + pad; }

  function seriesColors(s, sers, valueName) {
    var pal = CP.paletteColors(s.palette, s.paletteReverse), items = sers.map(function (k, i) { return { key: k, name: k, color: pal[i % pal.length] }; });
    var merged = CP.mergeList(s.catColors, items), out = [];
    merged.forEach(function (m) { if (!m.hidden) out.push({ key: m.key, name: m.name, color: C.normHex(m.color) || m.defColor }); });
    return { list: out, items: items };
  }

  function curvePath(pts, curve) {
    if (!pts.length) return '';
    var d = 'M' + pts[0][0].toFixed(2) + ',' + pts[0][1].toFixed(2), i;
    if (curve === 'step') {
      for (i = 1; i < pts.length; i++) { var mx = (pts[i - 1][0] + pts[i][0]) / 2; d += 'H' + mx.toFixed(2) + 'V' + pts[i][1].toFixed(2) + 'H' + pts[i][0].toFixed(2); }
    } else if (curve === 'smooth' && pts.length > 2) {
      /* Monotone cubic (Fritsch-Carlson): smooth, and never overshoots the data. */
      var n = pts.length, dx = [], m = [], t = [];
      for (i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0; }
      t[0] = m[0]; t[n - 1] = m[n - 2];
      for (i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
      for (i = 0; i < n - 1; i++) {
        var h = dx[i] / 3;
        d += 'C' + (pts[i][0] + h).toFixed(2) + ',' + (pts[i][1] + h * t[i]).toFixed(2) + ' ' + (pts[i + 1][0] - h).toFixed(2) + ',' + (pts[i + 1][1] - h * t[i + 1]).toFixed(2) + ' ' + pts[i + 1][0].toFixed(2) + ',' + pts[i + 1][1].toFixed(2);
      }
    } else {
      for (i = 1; i < pts.length; i++) d += 'L' + pts[i][0].toFixed(2) + ',' + pts[i][1].toFixed(2);
    }
    return d;
  }

  /* data: {rows, catName, valueName, serName, xName, hasSeries, hasX}; env: {W, H, bg, measure} */
  function layout(data, s, env) {
    var W = env.W, H = env.H, measure = env.measure, type = s.chartType || 'bar';
    var bg = env.bg, ink = C.ensureContrast(C.normHex(s.labelColor) || C.bestInk(bg), [bg], 7);
    var out = { type: type, W: W, H: H, bg: bg, ink: ink, marks: [], lines: [], texts: [], grid: [], legend: [], plot: null, empty: '' };
    var tsize = fontPx(s.labelSize), tweight = s.labelWeight === 'bold' ? 'bold' : 'normal', lh = Math.ceil(tsize * 1.25);
    var pad = Math.max(0, s.padding || 0) + 4;
    var box = { l: pad, t: pad, r: W - pad, b: H - pad };
    function addText(t) {
      t.size = fontPx(t.size); t.weight = t.weight || 'normal'; t.h = Math.ceil(t.size * 1.25);
      t.w = measure(t.text, t.size, t.weight); t.fill = t.fill || ink; t.bg = t.bg || bg; t.anchor = t.anchor || 'start';
      t.box = boxOf(t);
      if (GUARDED[t.kind]) {
        /* Axis text never leaves the frame and never lands on text already placed: it is dropped instead. */
        if (t.box.l < 0 || t.box.t < 0 || t.box.r > W || t.box.b > H) return null;
        for (var q = 0; q < out.texts.length; q++) if (hit(t.box, out.texts[q].box, 1)) return null;
      }
      out.texts.push(t); return t;
    }

    /* Title and subtitle */
    if (s.showTitle) {
      var ta = s.titleAlign || 'left', tx = ta === 'center' ? (box.l + box.r) / 2 : ta === 'right' ? box.r : box.l, anc = ta === 'center' ? 'middle' : ta === 'right' ? 'end' : 'start';
      var title = s.titleText || data.valueName + (data.catName ? ' by ' + data.catName : '');
      var tsz = fontPx(s.titleSize), tl = fitText(measure, title, tsz, s.titleWeight, box.r - box.l, 1)[0];
      if (tl) { addText({ kind: 'title', text: tl, size: tsz, weight: s.titleWeight === 'bold' ? 'bold' : 'normal', x: tx, y: box.t + Math.ceil(tsz * 1.25) / 2, anchor: anc }); box.t += Math.ceil(tsz * 1.25) + 2; }
      if (s.subtitleText) {
        var ssz = fontPx(s.subtitleSize), sl = fitText(measure, s.subtitleText, ssz, 'normal', box.r - box.l, 1)[0];
        if (sl) { addText({ kind: 'subtitle', text: sl, size: ssz, x: tx, y: box.t + Math.ceil(ssz * 1.25) / 2, anchor: anc }); box.t += Math.ceil(ssz * 1.25) + 2; }
      }
      box.t += 6;
    }

    var rows = data.rows || [];
    var serInfo = seriesColors(s, uniq(rows.map(function (r) { return r.ser; })), data.valueName);
    out.seriesItems = serInfo.items;
    /* Marks stay visible on any background: every series color is pushed to at least 3:1 against it (WCAG 1.4.11). */
    serInfo.list.forEach(function (x) { x.color = C.ensureContrast(x.color, [bg], MARK_CONTRAST); });
    var visSer = serInfo.list, serKeys = visSer.map(function (x) { return x.key; }), serColor = {}, serName = {};
    visSer.forEach(function (x) { serColor[x.key] = x.color; serName[x.key] = x.name; });
    var visRows = rows.filter(function (r) { return serColor[r.ser] !== undefined; });
    var agg = aggregate(visRows, type === 'scatter' ? 'sum' : s.aggregate);
    var oc = orderCats(aggregate(rows, s.aggregate), s, serKeys);
    out.catItems = agg.cats.length ? aggregate(rows, s.aggregate).cats.map(function (c) { return { key: c, name: c, color: '' }; }) : [];
    var catName = {}, catColor = {};
    oc.listed.forEach(function (it) { catName[it.key] = it.name; if (it.color && C.normHex(it.color)) catColor[it.key] = C.ensureContrast(C.normHex(it.color), [bg], MARK_CONTRAST); });
    var cats = oc.cats.filter(function (c) { return agg.cats.indexOf(c) >= 0 || type === 'scatter'; });
    if (!visRows.length || !cats.length) { out.empty = data.emptyMessage || 'No values to plot.'; return out; }
    function colorOf(c, sKey) { return catColor[c] || serColor[sKey]; }

    /* Legend */
    var showLegend = s.legendOn && data.hasSeries && visSer.length > 0;
    var lsz = MIN_FONT, sw = 14;
    if (showLegend) {
      var pos = s.legendPos || 'top', items = visSer.map(function (x) { return { key: x.key, text: x.name, color: x.color, w: sw + 6 + measure(x.name, lsz, 'normal') }; });
      var head = s.legendTitle ? data.serName : '';
      if (pos === 'right') {
        var colW = Math.min(Math.round((box.r - box.l) * 0.3), Math.max(measure(head, lsz, 'bold'), items.reduce(function (m, it) { return Math.max(m, it.w); }, 0)) + 4);
        var y = box.t + lh / 2, x0 = box.r - colW, room = Math.floor((box.b - box.t) / (lh + 4)) - (head ? 1 : 0), shown = items;
        if (head) { addText({ kind: 'legend', text: fitText(measure, head, lsz, 'bold', colW, 1)[0] || '', size: lsz, weight: 'bold', x: x0, y: y }); y += lh + 4; }
        if (items.length > room) shown = items.slice(0, Math.max(0, room - 1));
        shown.forEach(function (it) {
          var t = fitText(measure, it.text, lsz, 'normal', colW - sw - 6, 1)[0] || '';
          out.legend.push({ key: it.key, color: it.color, x: x0, y: y - sw / 2, size: sw });
          addText({ kind: 'legend', text: t, size: lsz, x: x0 + sw + 6, y: y, key: it.key }); y += lh + 4;
        });
        if (shown.length < items.length) addText({ kind: 'legend', text: '+' + (items.length - shown.length) + ' more', size: lsz, x: x0, y: y });
        box.r = x0 - 12;
      } else {
        var maxW = box.r - box.l, rowsL = [[]], cx = 0, hw = head ? measure(head, lsz, 'bold') + 14 : 0;
        cx = hw;
        items.forEach(function (it) {
          var w = Math.min(it.w, maxW);
          if (cx + w > maxW && rowsL[rowsL.length - 1].length) { rowsL.push([]); cx = 0; }
          it.x = cx; it.fw = w; rowsL[rowsL.length - 1].push(it); cx += w + 16;
        });
        var maxRows = 2, extra = 0;
        if (rowsL.length > maxRows) { rowsL.slice(maxRows).forEach(function (r) { extra += r.length; }); rowsL = rowsL.slice(0, maxRows); }
        if (extra) {
          var last = rowsL[maxRows - 1], more = '+' + (extra + 1) + ' more', mw = measure(more, lsz, 'normal');
          while (last.length && last[last.length - 1].x + last[last.length - 1].fw + 16 + mw > maxW) { last.pop(); extra++; more = '+' + extra + ' more'; mw = measure(more, lsz, 'normal'); }
        }
        var blockH = rowsL.length * (lh + 4), yy = pos === 'bottom' ? box.b - blockH + lh / 2 : box.t + lh / 2;
        if (head) addText({ kind: 'legend', text: head, size: lsz, weight: 'bold', x: box.l, y: yy });
        rowsL.forEach(function (r, ri) {
          r.forEach(function (it) {
            var t = fitText(measure, it.text, lsz, 'normal', it.fw - sw - 6, 1)[0] || '';
            out.legend.push({ key: it.key, color: it.color, x: box.l + it.x, y: yy - sw / 2, size: sw });
            addText({ kind: 'legend', text: t, size: lsz, x: box.l + it.x + sw + 6, y: yy, key: it.key });
            if (ri === rowsL.length - 1 && it === r[r.length - 1] && extra) addText({ kind: 'legend', text: '+' + extra + ' more', size: lsz, x: box.l + it.x + it.fw + 16, y: yy });
          });
          yy += lh + 4;
        });
        if (pos === 'bottom') box.b -= blockH + 8; else box.t += blockH + 8;
      }
    }

    /* Values in value units */
    var horiz = type === 'bar' && s.orientation === 'horizontal';
    var mode = type === 'scatter' ? 'group' : (s.stack || 'stack');
    if (!data.hasSeries || visSer.length < 2) mode = mode === 'percent' ? 'percent' : 'group';
    var st = type === 'scatter' ? null : stack(agg, cats, serKeys, mode, s.gapMode === 'zero');
    var vals = [];
    /* Side-by-side lines and points have no bar to anchor at zero: only their values set the range. */
    if (st) Object.keys(st).forEach(function (k) { if (mode !== 'group' || type === 'bar' || type === 'area') vals.push(st[k].a); vals.push(st[k].b); });
    else visRows.forEach(function (r) { if (isNum(r.value)) vals.push(r.value); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var mustZero = type === 'bar' || (type === 'area') || mode !== 'group';
    if (s.zeroBase || mustZero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    if (s.rangeMode === 'custom' && isNum(s.rangeMin) && isNum(s.rangeMax) && s.rangeMax > s.rangeMin) { lo = s.rangeMin; hi = s.rangeMax; }
    var fmtS = {}; Object.keys(s).forEach(function (k) { fmtS[k] = s[k]; });
    if (mode === 'percent') { fmtS.numPrefix = ''; fmtS.numSuffix = '%'; fmtS.numScale = '1'; fmtS.numCompact = false; }
    function fmt(v) { return CP.formatNumber(v, fmtS); }

    /* Scatter X in value units */
    var scatterNumX = type === 'scatter' && data.hasX;
    var xlo = 0, xhi = 1;
    if (scatterNumX) { var xs = visRows.map(function (r) { return r.x; }).filter(isNum); xlo = Math.min.apply(null, xs); xhi = Math.max.apply(null, xs); if (s.zeroBase) { xlo = Math.min(0, xlo); xhi = Math.max(0, xhi); } }

    /* Axis titles */
    var showLabels = !!s.labelsOn;
    var catTitle = s.catTitleOn ? (s.catTitleText || (scatterNumX ? data.xName : data.catName) || '') : '';
    var valTitle = s.valTitleOn ? (s.valTitleText || (mode === 'percent' ? 'Share of ' + data.valueName : data.valueName) || '') : '';
    var bottomTitle = horiz ? valTitle : catTitle, leftTitle = horiz ? catTitle : valTitle;
    if (!(horiz ? s.showValAxis : s.showCatAxis)) bottomTitle = '';
    if (!(horiz ? s.showCatAxis : s.showValAxis)) leftTitle = '';
    var leftTitleW = leftTitle ? lh + 6 : 0, bottomTitleH = bottomTitle ? lh + 4 : 0;

    /* Ticks along the value axis (vertical when not horiz). Fewer ticks until labels breathe. */
    function ticksFor(a, b, count, along, sizeOf) {
      var tk = niceTicks(a, b, count);
      while (count > 2) {
        var labs = tk.ticks.map(function (v) { return sizeOf(fmt(v)); }), spacing = along / Math.max(1, tk.ticks.length - 1), need = Math.max.apply(null, labs) + 10;
        if (spacing >= need) break;
        count--; tk = niceTicks(a, b, count);
      }
      if (s.rangeMode === 'custom' && type !== 'scatter') { tk.min = a; tk.max = b; tk.ticks = tk.ticks.filter(function (v) { return v >= a - 1e-9 && v <= b + 1e-9; }); }
      return tk;
    }
    var valAxisOn = s.showValAxis && showLabels, catAxisOn = s.showCatAxis && showLabels;

    /* Provisional plot to size tick labels */
    var plot = { l: box.l + leftTitleW, t: box.t + lh / 2, r: box.r - 4, b: box.b - bottomTitleH };
    var vt, xt, catLabW = 0, catLines = Math.max(1, s.labelLines || 1);
    if (!horiz) {
      vt = ticksFor(lo, hi, s.tickCount, plot.b - plot.t - lh * 2, function () { return lh; });
      var yw = valAxisOn ? Math.max.apply(null, vt.ticks.map(function (v) { return measure(fmt(v), tsize, tweight); })) + 8 : 0;
      plot.l += yw;
      if (scatterNumX) {
        xt = ticksFor(xlo, xhi, s.tickCount, plot.r - plot.l, function (t) { return measure(t, tsize, tweight); });
        plot.b -= catAxisOn ? lh + 6 : 0;
        plot.r -= catAxisOn ? measure(fmt(xt.max), tsize, tweight) / 2 : 0;
      } else {
        plot.b -= catAxisOn ? lh * catLines + 6 : 0;
      }
      vt = ticksFor(lo, hi, s.tickCount, plot.b - plot.t, function () { return lh; });
    } else {
      catLabW = catAxisOn ? Math.min(Math.round((box.r - box.l) * 0.34), Math.max.apply(null, cats.map(function (c) { return measure(catName[c] || c, tsize, tweight); })) + 8) : 0;
      plot.l += catLabW;
      plot.b -= valAxisOn ? lh + 6 : 0;
      vt = ticksFor(lo, hi, s.tickCount, plot.r - plot.l, function (t) { return measure(t, tsize, tweight); });
      var lastW = valAxisOn ? measure(fmt(vt.max), tsize, tweight) / 2 : 0;
      plot.r -= lastW;
    }
    if (plot.r - plot.l < 20 || plot.b - plot.t < 20) { out.empty = 'Too small to draw. Make the worksheet bigger.'; return out; }
    out.plot = plot;
    var vmin = vt.min, vmax = vt.max;
    function vpos(v) { var f = (v - vmin) / (vmax - vmin || 1); return horiz ? plot.l + f * (plot.r - plot.l) : plot.b - f * (plot.b - plot.t); }
    function xpos(v) { var f = (v - xt.min) / (xt.max - xt.min || 1); return plot.l + f * (plot.r - plot.l); }
    var n = cats.length, along = horiz ? plot.b - plot.t : plot.r - plot.l, band = along / n;
    function cpos(i) { return horiz ? plot.t + band * (i + 0.5) : plot.l + band * (i + 0.5); }
    out.band = band; out.horiz = horiz; out.cats = cats; out.catNames = catName;
    var gridInk = C.mix(bg, ink, (s.gridOpacity || 16) / 100), axisInk = C.mix(bg, ink, 0.6);

    /* Grid and axis lines */
    vt.ticks.forEach(function (v) {
      var p = vpos(v);
      if (s.gridVal) out.grid.push(horiz ? { x1: p, y1: plot.t, x2: p, y2: plot.b, color: gridInk, dash: s.gridStyle } : { x1: plot.l, y1: p, x2: plot.r, y2: p, color: gridInk, dash: s.gridStyle });
    });
    if (s.gridCat) {
      if (scatterNumX) xt.ticks.forEach(function (v) { var p = xpos(v); out.grid.push({ x1: p, y1: plot.t, x2: p, y2: plot.b, color: gridInk, dash: s.gridStyle }); });
      else for (var gi = 0; gi < n; gi++) { var gp = cpos(gi); out.grid.push(horiz ? { x1: plot.l, y1: gp, x2: plot.r, y2: gp, color: gridInk, dash: s.gridStyle } : { x1: gp, y1: plot.t, x2: gp, y2: plot.b, color: gridInk, dash: s.gridStyle }); }
    }
    if (s.axisLine) {
      var zp = vpos(Math.max(vmin, Math.min(vmax, 0)));
      if (horiz) { out.lines.push({ x1: plot.l, y1: plot.b, x2: plot.r, y2: plot.b, color: axisInk, w: 1 }); out.lines.push({ x1: zp, y1: plot.t, x2: zp, y2: plot.b, color: axisInk, w: 1 }); }
      else { out.lines.push({ x1: plot.l, y1: plot.t, x2: plot.l, y2: plot.b, color: axisInk, w: 1 }); out.lines.push({ x1: plot.l, y1: zp, x2: plot.r, y2: zp, color: axisInk, w: 1 }); }
    }

    /* Value tick labels */
    if (valAxisOn) vt.ticks.forEach(function (v) {
      var p = vpos(v);
      if (horiz) addText({ kind: 'tick', text: fmt(v), size: tsize, weight: tweight, x: p, y: plot.b + 6 + lh / 2, anchor: 'middle' });
      else addText({ kind: 'tick', text: fmt(v), size: tsize, weight: tweight, x: plot.l - 8, y: p, anchor: 'end' });
    });
    /* Category labels: thinned so none touch, wrapped then cut with an ellipsis */
    if (catAxisOn && scatterNumX) {
      xt.ticks.forEach(function (v) { addText({ kind: 'tick', text: fmt(v), size: tsize, weight: tweight, x: xpos(v), y: plot.b + 6 + lh / 2, anchor: 'middle' }); });
    } else if (catAxisOn) {
      if (horiz) {
        var stepH = Math.max(1, Math.ceil((lh + 2) / band));
        cats.forEach(function (c, i) {
          if (i % stepH) return;
          var t = fitText(measure, catName[c] || c, tsize, tweight, catLabW - 8, 1)[0];
          if (t) addText({ kind: 'cat', text: t, size: tsize, weight: tweight, x: plot.l - 8, y: cpos(i), anchor: 'end', full: catName[c] || c });
        });
      } else {
        var widest = Math.max.apply(null, cats.map(function (c) { return Math.min(measure(catName[c] || c, tsize, tweight), 160); }));
        var step = 1;
        while (step < n && band * step - 8 < Math.min(widest, 60 * catLines)) step++;
        cats.forEach(function (c, i) {
          if (i % step) return;
          var cx = cpos(i), room = Math.min(band * step - 8, 2 * Math.min(cx - (plot.l - 2), W - 2 - cx));
          var ls = fitText(measure, catName[c] || c, tsize, tweight, room, catLines);
          ls.forEach(function (l, li) { addText({ kind: 'cat', text: l, size: tsize, weight: tweight, x: cpos(i), y: plot.b + 6 + lh / 2 + li * lh, anchor: 'middle', full: catName[c] || c }); });
        });
      }
    }
    if (bottomTitle) { var bt = fitText(measure, bottomTitle, tsize, 'bold', plot.r - plot.l, 1)[0]; if (bt) addText({ kind: 'axistitle', text: bt, size: tsize, weight: 'bold', x: (plot.l + plot.r) / 2, y: box.b - lh / 2, anchor: 'middle' }); }
    if (leftTitle) { var lt = fitText(measure, leftTitle, tsize, 'bold', plot.b - plot.t, 1)[0]; if (lt) addText({ kind: 'axistitle', text: lt, size: tsize, weight: 'bold', x: box.l + lh / 2, y: (plot.t + plot.b) / 2, anchor: 'middle', rotate: -90 }); }

    /* Marks */
    var base = vpos(Math.max(vmin, Math.min(vmax, 0)));
    if (type === 'bar') {
      var bw = Math.min(band * (1 - (s.barGap || 0) / 100), s.barMaxWidth || 96), grouped = mode === 'group' && serKeys.length > 1;
      var sub = grouped ? bw / serKeys.length : bw, inner = grouped ? sub * (s.groupGap || 0) / 100 : 0;
      cats.forEach(function (c, i) {
        serKeys.forEach(function (sk, si) {
          var e = st[cellKey(c, sk)]; if (!e) return;
          var off = grouped ? -bw / 2 + si * sub + inner / 2 : -bw / 2, thick = Math.max(1, sub - inner);
          var p1 = vpos(e.a), p2 = vpos(e.b), g;
          if (horiz) g = { x: Math.min(p1, p2), y: cpos(i) + off, w: Math.abs(p2 - p1), h: thick };
          else g = { x: cpos(i) + off, y: Math.min(p1, p2), w: thick, h: Math.abs(p2 - p1) };
          out.marks.push({ kind: 'bar', key: sk + '|' + c, cat: c, ser: sk, v: e.v, raw: e.raw, tuples: e.tuples, color: colorOf(c, sk), g: g, neg: e.b < e.a });
        });
      });
    } else if (type === 'line' || type === 'area') {
      serKeys.forEach(function (sk) {
        var segs = [[]];
        cats.forEach(function (c, i) {
          var e = st[cellKey(c, sk)];
          if (!e) { if (segs[segs.length - 1].length) segs.push([]); return; }
          segs[segs.length - 1].push({ c: c, i: i, x: cpos(i), y: vpos(e.b), y0: vpos(e.a), v: e.v, raw: e.raw, tuples: e.tuples });
        });
        segs.filter(function (sg) { return sg.length; }).forEach(function (sg, k) {
          out.marks.push({ kind: type, key: sk + '#' + k, ser: sk, color: serColor[sk], pts: sg });
          if (s.showPoints || type === 'line') sg.forEach(function (p) {
            if (!s.showPoints) return;
            out.marks.push({ kind: 'dot', key: sk + '|' + p.c, cat: p.c, ser: sk, v: p.v, raw: p.raw, tuples: p.tuples, color: colorOf(p.c, sk), g: { x: p.x, y: p.y, r: Math.max(2, (s.pointSize || 6) / 2 + 0.5) } });
          });
        });
      });
    } else {
      var bySer = {};
      visRows.forEach(function (r, ri) {
        if (!isNum(r.value) || cats.indexOf(String(r.cat)) < 0) return;
        var ci = cats.indexOf(String(r.cat)), x;
        if (scatterNumX) { if (!isNum(r.x)) return; x = xpos(r.x); } else x = cpos(ci);
        var m = { kind: 'point', key: r.ser + '|' + r.cat + '|' + ri, cat: String(r.cat), ser: r.ser, v: r.value, raw: r.value, xv: r.x, tuples: [r.tuple], color: colorOf(String(r.cat), r.ser),
          g: { x: x, y: vpos(r.value), r: Math.max(1, (s.pointSize || 6) / 2) } };
        out.marks.push(m); (bySer[r.ser] = bySer[r.ser] || []).push(m);
      });
      if (s.trendLine) Object.keys(bySer).forEach(function (sk) {
        var ps = bySer[sk]; if (ps.length < 3) return;
        var mx = 0, my = 0; ps.forEach(function (p) { mx += p.g.x; my += p.g.y; }); mx /= ps.length; my /= ps.length;
        var sxx = 0, sxy = 0; ps.forEach(function (p) { sxx += (p.g.x - mx) * (p.g.x - mx); sxy += (p.g.x - mx) * (p.g.y - my); });
        if (!sxx) return;
        var k = sxy / sxx, y1 = my + k * (plot.l - mx), y2 = my + k * (plot.r - mx);
        out.marks.push({ kind: 'trend', key: 'trend|' + sk, ser: sk, color: serColor[sk], x1: plot.l, y1: Math.max(plot.t, Math.min(plot.b, y1)), x2: plot.r, y2: Math.max(plot.t, Math.min(plot.b, y2)) });
      });
    }

    /* Reference line */
    if (s.refLine && s.refLine !== 'none') {
      var vs = out.marks.filter(function (m) { return isNum(m.raw) && m.kind !== 'trend'; }).map(function (m) { return mode === 'percent' ? m.v : m.raw; });
      var rv = s.refLine === 'avg' ? vs.reduce(function (a, b) { return a + b; }, 0) / (vs.length || 1) : s.refLine === 'median' ? median(vs) : s.refValue;
      if (isNum(rv) && rv >= vmin && rv <= vmax) {
        var rp = vpos(rv);
        out.lines.push(horiz ? { x1: rp, y1: plot.t, x2: rp, y2: plot.b, color: ink, w: 1.5, dash: 'dashed', ref: true } : { x1: plot.l, y1: rp, x2: plot.r, y2: rp, color: ink, w: 1.5, dash: 'dashed', ref: true });
        out.refValue = rv;
      }
    }

    /* Value labels: outside the mark end, or centered inside a stacked segment when it fits at 7:1. Greedy: no overlaps. */
    if (s.valueLabels) {
      var vsz = fontPx(s.valueLabelSize), vlh = Math.ceil(vsz * 1.25), placed = out.texts.map(function (t) { return t.box; });
      var stacked = mode !== 'group' && serKeys.length > 1;
      out.marks.forEach(function (m) {
        if (m.kind === 'line' || m.kind === 'area' || m.kind === 'trend') return;
        var txt = fmt(m.v), w = measure(txt, vsz, 'normal'), t = null, g = m.g;
        if (m.kind === 'bar') {
          if (stacked) {
            var lab = C.bestInk(m.color);
            if (C.contrast(lab, m.color) >= 7 && g.w >= w + 6 && g.h >= vlh + 2) t = { x: g.x + g.w / 2, y: g.y + g.h / 2, anchor: 'middle', fill: lab, bg: m.color };
          } else if (horiz) t = m.neg ? { x: g.x - 4, y: g.y + g.h / 2, anchor: 'end' } : { x: g.x + g.w + 4, y: g.y + g.h / 2, anchor: 'start' };
          else t = m.neg ? { x: g.x + g.w / 2, y: g.y + g.h + vlh / 2 + 2, anchor: 'middle' } : { x: g.x + g.w / 2, y: g.y - vlh / 2 - 2, anchor: 'middle' };
        } else if (m.kind === 'dot') t = { x: g.x, y: g.y - g.r - vlh / 2 - 2, anchor: 'middle' };
        else if (m.kind === 'point') t = { x: g.x + g.r + 4, y: g.y, anchor: 'start' };
        if (!t) return;
        var cand = { kind: 'value', text: txt, size: vsz, x: t.x, y: t.y, anchor: t.anchor, fill: t.fill, bg: t.bg, key: m.key, w: w, h: vlh };
        var b = boxOf(cand);
        if (b.l < box.l || b.r > W - 2 || b.t < 2 || b.b > H - 2) return;
        for (var pi = 0; pi < placed.length; pi++) if (hit(b, placed[pi], 1)) return;
        if (!cand.bg || cand.bg === bg) {
          for (var mi = 0; mi < out.marks.length; mi++) { var o = out.marks[mi]; if (o.kind === 'bar' && hit(b, { l: o.g.x, r: o.g.x + o.g.w, t: o.g.y, b: o.g.y + o.g.h }, 0)) return; }
        }
        placed.push(b); addText(cand);
      });
    }
    out.mode = mode; out.fmt = fmt; out.vmin = vmin; out.vmax = vmax;
    return out;
  }
  function uniq(a) { var seen = {}, out = []; a.forEach(function (x) { var k = String(x); if (!seen[k]) { seen[k] = 1; out.push(k); } }); return out; }

  return { MIN_FONT: MIN_FONT, fontPx: fontPx, aggregate: aggregate, orderCats: orderCats, stack: stack, niceTicks: niceTicks, fitText: fitText,
    layout: layout, curvePath: curvePath, boxOf: boxOf, hit: hit, cellKey: cellKey, median: median };
});
