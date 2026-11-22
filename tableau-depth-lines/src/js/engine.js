/* Depth Lines - pure maths. No DOM, no Tableau. Needs d3-array and d3-contour
 * (vendored in lib/) and core.js. Every function here is covered by
 * test/run.js. */
(function (global) {
  'use strict';
  var HX = global.HX;

  /* Each ramp has a light-ground and a dark-ground version, shallow to deep.
   * On a light ground deep is the darkest; on a dark ground deep is the
   * brightest, so the densest water always stands out from the background. */
  var RAMPS = {
    abyss: {
      light: ['#e2f4f7', '#9bdbe3', '#3cc4d1', '#1d7f9b', '#0d2b45'],
      dark: ['#12384d', '#1a6a85', '#3cc4d1', '#8fe3ec', '#eafcfe']
    },
    sunrise: {
      light: ['#fcf0d2', '#f2b84b', '#e8873a', '#b04a24', '#4a1a12'],
      dark: ['#3a2412', '#8a4a1c', '#e8873a', '#f2b84b', '#fff3d1']
    },
    mono: {
      light: ['#eef1f4', '#b6bec7', '#7c8793', '#445260', '#0a2439'],
      dark: ['#1b2733', '#44546a', '#8794a6', '#c3ccd8', '#f4f7fa']
    }
  };
  var CAT_PALETTES = {
    divers: ['#3cc4d1', '#f2b84b', '#e8873a', '#7d8de8', '#5fbf84', '#e0658f', '#b3bcc6', '#a77be0'],
    okabe: ['#56b4e9', '#e69f00', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#999999']
  };

  function rampColor (name, dark, t, reverse) {
    var stops = (RAMPS[name] || RAMPS.abyss)[dark ? 'dark' : 'light'];
    t = Math.max(0, Math.min(1, t));
    if (reverse) t = 1 - t;
    var x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x));
    return HX.mix(stops[i], stops[i + 1], x - i);
  }
  function catColor (palette, index) {
    var p = CAT_PALETTES[palette] || CAT_PALETTES.divers;
    return p[index % p.length];
  }

  function linear (d0, d1, r0, r1) {
    var k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
    var f = function (v) { return r0 + (v - d0) * k; };
    f.invert = function (p) { return k === 0 ? d0 : d0 + (p - r0) / k; };
    return f;
  }

  /* The data domain for one axis, padded so the outer contours are not cut
   * off by the frame. */
  function domainOf (values, padFrac) {
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < values.length; i++) { var v = values[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!isFinite(lo)) return [0, 1];
    if (hi === lo) { var d = Math.abs(lo) * 0.1 || 1; return [lo - d, hi + d]; }
    var pad = (hi - lo) * padFrac;
    return [lo - pad, hi + pad];
  }

  function groupPoints (points, hasCategory) {
    if (!hasCategory) return [{ key: '', index: 0, points: points }];
    var order = [], map = {};
    points.forEach(function (p) {
      if (!Object.prototype.hasOwnProperty.call(map, p.cat)) { map[p.cat] = { key: p.cat, index: order.length, points: [] }; order.push(map[p.cat]); }
      map[p.cat].points.push(p);
    });
    return order;
  }

  /* Bandwidth is a share of the plot's shorter side, so the shape of the
   * density does not change when the viz is resized. */
  function bandwidthPx (pct, w, h) { return Math.max(3, pct / 100 * Math.min(w, h)); }

  /* `levels` thresholds from `floor` (a share of the peak) up to 95% of it.
   * An explicit array means the stepper is exact: levels contours, no more. */
  function thresholdsFor (max, levels, floorPct) {
    var out = [], lo = floorPct / 100, hi = 0.95;
    for (var i = 0; i < levels; i++) {
      var f = levels === 1 ? lo : lo + (hi - lo) * i / (levels - 1);
      out.push(max * f);
    }
    return out;
  }

  function ringPath (ring) {
    var s = '';
    for (var i = 0; i < ring.length; i++) s += (i ? 'L' : 'M') + ring[i][0].toFixed(1) + ',' + ring[i][1].toFixed(1);
    return s + 'Z';
  }
  function pathOf (coordinates) {
    var s = '';
    coordinates.forEach(function (poly) { poly.forEach(function (ring) { s += ringPath(ring); }); });
    return s;
  }
  function ringsClosed (coordinates) {
    return coordinates.every(function (poly) {
      return poly.every(function (ring) {
        var a = ring[0], b = ring[ring.length - 1];
        return ring.length >= 4 && a[0] === b[0] && a[1] === b[1];
      });
    });
  }
  function inRing (x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /* Inside an outer ring and not inside any of its holes. */
  function inMulti (x, y, coordinates) {
    for (var p = 0; p < coordinates.length; p++) {
      var poly = coordinates[p];
      if (inRing(x, y, poly[0])) {
        var hole = false;
        for (var r = 1; r < poly.length; r++) if (inRing(x, y, poly[r])) { hole = true; break; }
        if (!hole) return true;
      }
    }
    return false;
  }

  /* One density grid per group, then `levels` contours from a shared or a
   * per-group peak. points need px, py (plot pixels) and w (weight). */
  function computeBands (groups, w, h, s) {
    var d3 = global.d3;
    var bw = bandwidthPx(s.bandwidth, w, h);
    var cell = Math.min(w, h) < 420 ? 2 : 4;
    var fns = groups.map(function (g) {
      var dens = d3.contourDensity()
        .x(function (d) { return d.px; }).y(function (d) { return d.py; }).weight(function (d) { return d.w; })
        .size([Math.max(2, Math.round(w)), Math.max(2, Math.round(h))]).cellSize(cell).bandwidth(bw);
      return dens.contours(g.points);
    });
    var sharedMax = Math.max.apply(null, fns.map(function (f) { return f.max; }).concat([0]));
    return groups.map(function (g, gi) {
      var max = s.scale === 'each' || groups.length === 1 ? fns[gi].max : sharedMax;
      var th = thresholdsFor(max, s.levels, s.floor);
      var levels = th.map(function (v, i) {
        var c = fns[gi](v);
        return { index: i, frac: th.length > 1 ? i / (th.length - 1) : 0.5, value: v, coordinates: c.coordinates, d: pathOf(c.coordinates), closed: ringsClosed(c.coordinates) };
      });
      return { key: g.key, index: g.index, max: max, bandwidthPx: bw, levels: levels };
    });
  }

  /* Cells for small multiples: the column count that gives the biggest square-ish panel. */
  function gridFor (n, w, h, colsPref) {
    if (n <= 1) return { cols: 1, rows: 1 };
    if (colsPref > 0) { var c0 = Math.min(colsPref, n); return { cols: c0, rows: Math.ceil(n / c0) }; }
    var best = null;
    for (var c = 1; c <= n; c++) {
      var r = Math.ceil(n / c), sc = Math.min(w / c, (h / r) * 1.3);
      if (!best || sc > best.sc + 1e-9) best = { cols: c, rows: r, sc: sc };
    }
    return { cols: best.cols, rows: best.rows };
  }

  global.DL = global.DL || {};
  global.DL.engine = {
    RAMPS: RAMPS, CAT_PALETTES: CAT_PALETTES, rampColor: rampColor, catColor: catColor, linear: linear, domainOf: domainOf,
    groupPoints: groupPoints, bandwidthPx: bandwidthPx, thresholdsFor: thresholdsFor, pathOf: pathOf, ringsClosed: ringsClosed,
    inMulti: inMulti, inRing: inRing, computeBands: computeBands, gridFor: gridFor
  };
})(typeof window !== 'undefined' ? window : globalThis);
