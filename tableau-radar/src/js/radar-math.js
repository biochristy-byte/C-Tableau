/* Radar - pure maths. No DOM, so node can test it: model building (pivot axes x series), scales and nice rings,
 * polar geometry, straight and cardinal-closed outlines, label wrapping, small-multiples layout.
 * Browser: window.RD.math. Node: module.exports. */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.RD = root.RD || {}; root.RD.math = m; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var ELLIPSIS = String.fromCharCode(8230);

  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }

  /* ----------------------------------------------------------------- model */

  /* rows: [{ axis, series, value, label, tuple }]. Duplicates for one (axis, series) are averaged. */
  function buildModel(rows, o) {
    o = o || {};
    var axisIdx = {}, axes = [], serIdx = {}, series = [];
    rows.forEach(function (r) {
      var ak = String(r.axis), sk = r.series === null || r.series === undefined || r.series === '' ? (o.singleName || 'Value') : String(r.series);
      if (!(ak in axisIdx)) { axisIdx[ak] = axes.length; axes.push({ key: ak, label: ak, tuples: [], i: 0 }); }
      if (!(sk in serIdx)) { serIdx[sk] = series.length; series.push({ key: sk, name: sk, sums: {}, cnt: {}, tuples: {} }); }
      var a = axes[axisIdx[ak]], s = series[serIdx[sk]];
      if (r.label && a.label === ak) a.label = String(r.label);
      if (typeof r.value === 'number' && isFinite(r.value)) { s.sums[ak] = (s.sums[ak] || 0) + r.value; s.cnt[ak] = (s.cnt[ak] || 0) + 1; }
      if (r.tuple !== undefined) { (s.tuples[ak] = s.tuples[ak] || []).push(r.tuple); a.tuples.push(r.tuple); }
    });
    function order(list, how, valueOf, manual) {
      var idx = list.map(function (x, i) { return { x: x, i: i }; });
      if (how === 'name') idx.sort(function (a, b) { return String(a.x.label || a.x.name).localeCompare(String(b.x.label || b.x.name), undefined, { numeric: true }); });
      else if (how === 'nameDesc') idx.sort(function (a, b) { return String(b.x.label || b.x.name).localeCompare(String(a.x.label || a.x.name), undefined, { numeric: true }); });
      else if (how === 'mean') idx.sort(function (a, b) { return valueOf(a.x) - valueOf(b.x) || a.i - b.i; });
      else if (how === 'meanDesc') idx.sort(function (a, b) { return valueOf(b.x) - valueOf(a.x) || a.i - b.i; });
      else if (how === 'manual' && manual && manual.length) {
        var pos = {}; manual.forEach(function (k, i) { pos[k] = i; });
        idx.sort(function (a, b) { var pa = a.x.key in pos ? pos[a.x.key] : 1e9 + a.i, pb = b.x.key in pos ? pos[b.x.key] : 1e9 + b.i; return pa - pb; });
      }
      return idx.map(function (e) { return e.x; });
    }
    var axMean = {};
    axes.forEach(function (a) { var vals = []; series.forEach(function (s) { if (s.cnt[a.key]) vals.push(s.sums[a.key] / s.cnt[a.key]); }); axMean[a.key] = mean(vals); });
    axes = order(axes, o.sortAxes, function (a) { return axMean[a.key]; }, o.axisOrder);
    axes.forEach(function (a, i) { a.i = i; });
    series.forEach(function (s) {
      s.values = axes.map(function (a) { return s.cnt[a.key] ? s.sums[a.key] / s.cnt[a.key] : null; });
      s.tupleList = []; axes.forEach(function (a) { (s.tuples[a.key] || []).forEach(function (t) { s.tupleList.push(t); }); });
      s.mean = mean(s.values.filter(function (v) { return v !== null; }));
    });
    series = order(series, o.sortSeries, function (s) { return s.mean; }, o.seriesOrder);
    return { axes: axes, series: series };
  }

  /* ---------------------------------------------------------------- scales */

  function niceNum(x, round) {
    if (!(x > 0)) return 1;
    var e = Math.floor(Math.log(x) / Math.LN10), f = x / Math.pow(10, e), nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10; else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, e);
  }

  /* Domain with exactly `rings` evenly spaced rings. cfg: { minMode: auto|zero|custom, min, maxMode: auto|custom, max } */
  function domain(lo, hi, rings, cfg) {
    cfg = cfg || {};
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (cfg.minMode === 'zero') lo = Math.min(0, lo);
    var fixLo = cfg.minMode === 'custom' && isFinite(cfg.min), fixHi = cfg.maxMode === 'custom' && isFinite(cfg.max);
    if (fixLo) lo = cfg.min;
    if (fixHi) hi = cfg.max;
    if (hi <= lo) hi = lo + (Math.abs(lo) > 0 ? Math.abs(lo) * 0.1 : 1);
    var step = niceNum((hi - lo) / rings, false);
    if (!fixLo && cfg.minMode !== 'zero') {
      lo = Math.floor(lo / step) * step;
      step = niceNum((hi - lo) / rings, false);
    }
    if (!fixHi) hi = lo + step * rings;
    var ticks = [];
    for (var i = 0; i <= rings; i++) ticks.push(Number((lo + (hi - lo) * i / rings).toPrecision(12)));
    return { lo: lo, hi: hi, ticks: ticks };
  }

  /* series: the visible series. cfg: { perAxis, rings, minMode, min, maxMode, max, extra: [values] } */
  function scales(axes, series, cfg) {
    var per = axes.map(function (a, i) {
      var lo = Infinity, hi = -Infinity;
      series.forEach(function (s) { var v = s.values[i]; if (v !== null && v !== undefined) { if (v < lo) lo = v; if (v > hi) hi = v; } });
      ((cfg.extra && cfg.extra[i]) || []).forEach(function (v) { if (v < lo) lo = v; if (v > hi) hi = v; });
      return { lo: lo, hi: hi };
    });
    var out = { perAxis: !!cfg.perAxis, axes: [], rings: cfg.rings };
    if (cfg.perAxis) {
      per.forEach(function (p) { out.axes.push(domain(p.lo, p.hi, cfg.rings, cfg)); });
      out.ticks = null;
    } else {
      var lo = Infinity, hi = -Infinity;
      per.forEach(function (p) { if (p.lo < lo) lo = p.lo; if (p.hi > hi) hi = p.hi; });
      var d = domain(lo, hi, cfg.rings, cfg);
      axes.forEach(function () { out.axes.push(d); });
      out.ticks = d.ticks;
    }
    return out;
  }
  function frac(sc, i, v) { var d = sc.axes[i], t = (v - d.lo) / ((d.hi - d.lo) || 1); return t < 0 ? 0 : t > 1 ? 1 : t; }

  /* --------------------------------------------------------------- geometry */

  function angleOf(i, n, rotationDeg, dir) { return -Math.PI / 2 + (rotationDeg || 0) * Math.PI / 180 + (dir < 0 ? -1 : 1) * 2 * Math.PI * i / n; }
  function pointAt(cx, cy, r, theta) { return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) }; }
  function f2(v) { return (Math.round(v * 100) / 100).toString(); }

  /* Points of one series at animation progress t (0 center, 1 full). Missing values: 'zero' pins to the center, 'skip' drops the point. */
  function seriesPoints(s, sc, cx, cy, R, thetas, missing, t) {
    var pts = [];
    s.values.forEach(function (v, i) {
      if (v === null || v === undefined) { if (missing === 'skip') return; v = sc.axes[i].lo; }
      var r = R * frac(sc, i, v) * (t === undefined ? 1 : t), p = pointAt(cx, cy, r, thetas[i]);
      pts.push({ x: p.x, y: p.y, v: s.values[i], i: i });
    });
    return pts;
  }
  function polygonPath(pts) {
    if (!pts.length) return '';
    return 'M' + pts.map(function (p) { return f2(p.x) + ',' + f2(p.y); }).join('L') + 'Z';
  }
  /* d3 curveCardinalClosed with a clamp: every control point stays inside the outer circle, so the curve (inside the
   * convex hull of its control points) can never leave the chart. smooth 1 = Catmull-Rom, 0 = straight. */
  function cardinalClosedPath(pts, smooth, cx, cy, R) {
    var n = pts.length;
    if (n < 3 || !(smooth > 0)) return polygonPath(pts);
    var k = Math.min(1, smooth) / 6;
    function clampPt(x, y) {
      var dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy);
      return d > R ? { x: cx + dx * R / d, y: cy + dy * R / d } : { x: x, y: y };
    }
    var d = 'M' + f2(pts[0].x) + ',' + f2(pts[0].y);
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      var c1 = clampPt(p1.x + k * (p2.x - p0.x), p1.y + k * (p2.y - p0.y)), c2 = clampPt(p2.x - k * (p3.x - p1.x), p2.y - k * (p3.y - p1.y));
      d += 'C' + f2(c1.x) + ',' + f2(c1.y) + ' ' + f2(c2.x) + ',' + f2(c2.y) + ' ' + f2(p2.x) + ',' + f2(p2.y);
    }
    return d + 'Z';
  }
  function polygonArea(pts) {
    var a = 0;
    for (var i = 0; i < pts.length; i++) { var p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
    return Math.abs(a) / 2;
  }
  function pointInPolygon(x, y, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i], b = pts[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-12) + a.x) inside = !inside;
    }
    return inside;
  }

  /* ------------------------------------------------------------------ text */

  /* Greedy word wrap. measure(text) returns pixel width. A word wider than maxW is broken by characters. */
  function wrapText(text, maxW, measure, maxLines) {
    var words = String(text).split(' ').filter(Boolean), lines = [], cur = '';
    function push(w) {
      while (measure(w) > maxW && w.length > 1) {
        var cut = w.length - 1; while (cut > 1 && measure(w.slice(0, cut)) > maxW) cut--;
        lines.push(w.slice(0, cut)); w = w.slice(cut);
      }
      return w;
    }
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (measure(t) <= maxW) { cur = t; return; }
      if (cur) lines.push(cur);
      cur = push(w);
    });
    if (cur) lines.push(cur);
    if (!lines.length) lines.push('');
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length > 1 && measure(last + ELLIPSIS) > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last + ELLIPSIS;
    }
    return lines;
  }
  /* One line that fits maxW: the text itself, or its longest prefix plus an ellipsis, or '' when not even one character fits. */
  function fitLine(text, maxW, measure) {
    text = String(text);
    if (measure(text) <= maxW) return text;
    var cut = text.length - 1;
    while (cut > 0 && measure(text.slice(0, cut).replace(/\s+$/, '') + ELLIPSIS) > maxW) cut--;
    return cut > 0 ? text.slice(0, cut).replace(/\s+$/, '') + ELLIPSIS : '';
  }
  function overlaps(a, b, pad) { pad = pad || 0; return a.l < b.r + pad && b.l < a.r + pad && a.t < b.b + pad && b.t < a.b + pad; }

  /* ----------------------------------------------------------- multiples */

  function layoutMultiples(w, h, count, cols, gap) {
    gap = gap || 0;
    var best = null;
    var from = cols > 0 ? Math.min(cols, count) : 1, to = cols > 0 ? Math.min(cols, count) : count;
    for (var c = from; c <= to; c++) {
      var rows = Math.ceil(count / c), cw = (w - (c - 1) * gap) / c, ch = (h - (rows - 1) * gap) / rows, score = Math.min(cw, ch);
      if (!best || score > best.score + 1e-9) best = { cols: c, rows: rows, cw: cw, ch: ch, score: score };
    }
    var cells = [];
    for (var i = 0; i < count; i++) {
      var col = i % best.cols, row = Math.floor(i / best.cols);
      cells.push({ x: col * (best.cw + gap), y: row * (best.ch + gap), w: best.cw, h: best.ch });
    }
    return { cols: best.cols, rows: best.rows, cells: cells };
  }

  return { buildModel: buildModel, niceNum: niceNum, domain: domain, scales: scales, frac: frac, angleOf: angleOf, pointAt: pointAt,
    seriesPoints: seriesPoints, polygonPath: polygonPath, cardinalClosedPath: cardinalClosedPath, polygonArea: polygonArea, pointInPolygon: pointInPolygon,
    wrapText: wrapText, fitLine: fitLine, overlaps: overlaps, layoutMultiples: layoutMultiples, mean: mean, ELLIPSIS: ELLIPSIS };
});
