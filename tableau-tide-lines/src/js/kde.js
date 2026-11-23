/* Tide Lines - density maths. Pure functions, no DOM, so node can test them.
 *
 * One kernel density estimate per category, all drawn on a SHARED x grid so
 * ridges can be compared. Bandwidth is given in Gaussian-equivalent units: the
 * Epanechnikov kernel is stretched by its canonical factor (2.214) so the same
 * bandwidth gives the same amount of smoothing under either kernel.
 */
(function (global) {
  'use strict';
  var TL = global.TL = global.TL || {};

  var EPAN_SCALE = 2.214;           /* canonical bandwidth ratio, Epanechnikov to Gaussian */
  var GAUSS_CUT = 4.5;              /* a Gaussian is treated as zero beyond 4.5 bandwidths */
  var SQRT_2PI = Math.sqrt(2 * Math.PI);

  function sortedCopy (a) { return a.slice().sort(function (x, y) { return x - y; }); }

  /* Quantile, type 7 (linear between order statistics), on a sorted array. */
  function quantile (s, p) {
    if (!s.length) return NaN;
    var h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
    return s[lo] + (h - lo) * (s[hi] - s[lo]);
  }

  function summarize (values) {
    var s = sortedCopy(values), n = s.length, sum = 0, i;
    for (i = 0; i < n; i++) sum += s[i];
    var mean = n ? sum / n : NaN, ss = 0;
    for (i = 0; i < n; i++) ss += (s[i] - mean) * (s[i] - mean);
    var q1 = quantile(s, 0.25), med = quantile(s, 0.5), q3 = quantile(s, 0.75);
    return {
      n: n, min: s[0], max: s[n - 1], mean: mean, sd: n > 1 ? Math.sqrt(ss / (n - 1)) : 0,
      q1: q1, median: med, q3: q3, iqr: q3 - q1, sorted: s
    };
  }

  /* Silverman's rule of thumb: 0.9 * min(sd, IQR / 1.34) * n^(-1/5).
   * Returns 0 when it cannot be computed (fewer than 2 points, or no spread). */
  function silverman (stats) {
    if (stats.n < 2) return 0;
    var spread = stats.sd;
    if (stats.iqr > 0) spread = Math.min(stats.sd, stats.iqr / 1.34);
    if (!(spread > 0)) return 0;
    return 0.9 * spread * Math.pow(stats.n, -0.2);
  }

  function kernelFn (kind) {
    if (kind === 'epanechnikov') {
      return function (u) { return u > -1 && u < 1 ? 0.75 * (1 - u * u) : 0; };
    }
    return function (u) { return Math.exp(-0.5 * u * u) / SQRT_2PI; };
  }

  /* Effective half-width of one kernel bump, in data units. */
  function reach (kind, bw) { return kind === 'epanechnikov' ? bw * EPAN_SCALE : bw * GAUSS_CUT; }

  /* Density of the sorted sample s at each x in xs. */
  function density (s, bw, kind, xs) {
    var n = s.length, out = new Array(xs.length), k = kernelFn(kind);
    var h = kind === 'epanechnikov' ? bw * EPAN_SCALE : bw, r = reach(kind, bw);
    var start = 0;
    for (var j = 0; j < xs.length; j++) {
      var x = xs[j];
      while (start < n && s[start] < x - r) start++;
      var acc = 0;
      for (var i = start; i < n && s[i] <= x + r; i++) acc += k((x - s[i]) / h);
      out[j] = acc / (n * h);
    }
    return out;
  }

  /* Group definitions in, drawable ridges out.
   * groups: [{ key, values: number[] }]
   * opts:   { kernel, bandwidth (0 = auto), bwMult (x), padMult (x), range ([lo, hi] or null), scale ('shared'|'own'), trim (bool), points (grid size) }
   * Result: { xs, domain, ridges: [{ key, n, stats, bw, ys (0..1), xs (own grid when trimmed) }], autoBw } */
  function build (groups, opts) {
    var kind = opts.kernel === 'epanechnikov' ? 'epanechnikov' : 'gaussian';
    var points = Math.max(40, opts.points || 240);
    var all = [], infos = [];
    groups.forEach(function (g) {
      var st = summarize(g.values);
      infos.push({ key: g.key, label: g.label, color: g.color, tuples: g.tuples, st: st, auto: silverman(st) });
      for (var i = 0; i < g.values.length; i++) all.push(g.values[i]);
    });
    var pooled = summarize(all);
    var fallback = pooled.n && pooled.max > pooled.min ? (pooled.max - pooled.min) / 40 : 1;
    /* Median of the per-category Silverman values, used when a category has no spread of its own. */
    var autos = infos.map(function (i) { return i.auto; }).filter(function (b) { return b > 0; }).sort(function (a, b) { return a - b; });
    var autoBw = autos.length ? quantile(autos, 0.5) : fallback;

    var maxReach = 0;
    infos.forEach(function (i) {
      i.bw = (opts.bandwidth > 0 ? opts.bandwidth : (i.auto > 0 ? i.auto : autoBw)) * (opts.bwMult > 0 ? opts.bwMult : 1);
      maxReach = Math.max(maxReach, reach(kind, i.bw));
    });
    var pad = (kind === 'epanechnikov' ? maxReach : Math.min(maxReach, 3 * maxReach / GAUSS_CUT)) * (opts.padMult > 0 ? opts.padMult : 1);
    var lo = pooled.n ? pooled.min - pad : 0, hi = pooled.n ? pooled.max + pad : 1;
    if (opts.range && isFinite(opts.range[0]) && isFinite(opts.range[1]) && opts.range[1] > opts.range[0]) { lo = opts.range[0]; hi = opts.range[1]; }
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    var xs = new Array(points);
    for (var p = 0; p < points; p++) xs[p] = lo + (hi - lo) * p / (points - 1);

    var peakAll = 0;
    var ridges = infos.map(function (i) {
      var gx = xs;
      if (opts.trim && i.st.n) {
        gx = [i.st.min];
        for (var q = 0; q < xs.length; q++) if (xs[q] > i.st.min && xs[q] < i.st.max) gx.push(xs[q]);
        if (i.st.max > i.st.min) gx.push(i.st.max);
      }
      var ys = i.st.n ? density(i.st.sorted, i.bw, kind, gx) : gx.map(function () { return 0; });
      var peak = 0;
      for (var m = 0; m < ys.length; m++) if (ys[m] > peak) peak = ys[m];
      peakAll = Math.max(peakAll, peak);
      return { key: i.key, label: i.label, color: i.color, tuples: i.tuples, n: i.st.n, stats: i.st, bw: i.bw, xs: gx, raw: ys, peak: peak };
    });
    ridges.forEach(function (r) {
      var d = opts.scale === 'own' ? r.peak : peakAll;
      r.ys = r.raw.map(function (v) { return d > 0 ? v / d : 0; });
    });
    return { xs: xs, domain: [lo, hi], ridges: ridges, autoBw: autoBw, kernel: kind };
  }

  /* Order ridges. mode: 'data' | 'median' | 'name'. flip reverses the result.
   * 'median' puts the highest median on top by default. */
  function sortRidges (ridges, mode, flip, order) {
    var idx = ridges.map(function (r, i) { return { r: r, i: i }; });
    if (mode === 'manual' && order && order.length) {
      var pos = {}; order.forEach(function (k, n) { pos[k] = n; });
      var at = function (r) { return pos[r.key] === undefined ? 1e9 : pos[r.key]; };
      idx.sort(function (a, b) { return (at(a.r) - at(b.r)) || (a.i - b.i); });
    } else if (mode === 'mean') {
      idx.sort(function (a, b) { return (b.r.stats.mean - a.r.stats.mean) || (a.i - b.i); });
    } else if (mode === 'count') {
      idx.sort(function (a, b) { return (b.r.n - a.r.n) || (a.i - b.i); });
    } else if (mode === 'median') {
      idx.sort(function (a, b) { return (b.r.stats.median - a.r.stats.median) || (a.i - b.i); });
    } else if (mode === 'name') {
      idx.sort(function (a, b) {
        return String(a.r.key).localeCompare(String(b.r.key), undefined, { numeric: true, sensitivity: 'base' }) || (a.i - b.i);
      });
    }
    var out = idx.map(function (o) { return o.r; });
    return flip ? out.reverse() : out;
  }

  /* "Nice" tick values covering [lo, hi], about `count` of them. */
  function niceTicks (lo, hi, count) {
    if (!(hi > lo)) return [lo];
    var raw = (hi - lo) / Math.max(1, count), pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var f = raw / pow, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pow;
    var out = [], t = Math.ceil(lo / step) * step;
    for (var guard = 0; t <= hi + step * 1e-9 && guard < 200; guard++, t += step) {
      var tv = Math.round(t / step) * step;
      out.push(tv === 0 ? 0 : tv);
    }
    return out;
  }

  TL.kde = { quantile: quantile, summarize: summarize, silverman: silverman, density: density, build: build,
    sortRidges: sortRidges, niceTicks: niceTicks, EPAN_SCALE: EPAN_SCALE };
})(typeof window !== 'undefined' ? window : globalThis);
