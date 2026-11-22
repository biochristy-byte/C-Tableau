/* Reef - colour maths, palettes, number formatting.
 *
 * The default palette lives inside the Data Divers brand colours (teal, gold,
 * ember, coral, navy) and extends them with a few reef tones. Contrast helpers
 * follow WCAG 2 relative luminance so the tests and the renderer agree.
 */
(function (global) {
  'use strict';

  var PALETTES = {
    reef: ['#f08f8f', '#3cc4d1', '#f2b84b', '#e8873a', '#7fdce6', '#c79bf2', '#7bd88f', '#f5d9a8'],
    lagoon: ['#3cc4d1', '#7fdce6', '#2f9fb5', '#9be3c8', '#58b7e8', '#b4e8f2', '#4fb89a', '#8fc5f5'],
    sunset: ['#e8873a', '#f08f8f', '#f2b84b', '#c79bf2', '#f5a37a', '#ffd48a', '#e87aa6', '#f7c6a8'],
    datadivers: ['#3cc4d1', '#f2b84b', '#e8873a', '#f08f8f', '#7fdce6', '#f7c96a', '#fbc08e', '#b9ccd8'],
    kelp: ['#7bd88f', '#3cc4d1', '#c4e87a', '#4fb89a', '#f2b84b', '#9be3c8', '#e8d58a', '#6fb6a0'],
    colorblind10: ['#1170aa', '#fc7d0b', '#a3acb9', '#57606c', '#5fa2ce', '#c85200', '#7b848f', '#a3cce9', '#ffbc79', '#c8d0d9']
  };
  var RAMPS = {
    reef: ['#1d7f95', '#3cc4d1', '#bfe9d6', '#f2b84b', '#e8873a'],
    lagoon: ['#0d2b45', '#1d7f95', '#3cc4d1', '#9be3c8', '#e6f7ee'],
    sunset: ['#5a2a52', '#c0566e', '#e8873a', '#f2b84b', '#fff0c8']
  };

  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }

  /* Accepts #rgb, #rrggbb, rgb(), rgba(). Returns {r,g,b,a} or null. */
  function parse(css) {
    if (!css) return null;
    var s = String(css).trim().toLowerCase();
    var m = /^#([0-9a-f]{3})$/.exec(s);
    if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
    m = /^#([0-9a-f]{6})$/.exec(s);
    if (m) { var n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }; }
    m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/.exec(s);
    if (m) {
      var a = m[4] === undefined ? 1 : (/%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      return { r: +m[1], g: +m[2], b: +m[3], a: a };
    }
    return null;
  }
  function hex(c) {
    var f = function (v) { var h = Math.round(clamp(v, 0, 255)).toString(16); return h.length === 1 ? '0' + h : h; };
    return '#' + f(c.r) + f(c.g) + f(c.b);
  }
  function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function unlin(v) { return (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255; }
  function luminance(c) { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }
  function contrast(a, b) {
    var A = typeof a === 'string' ? parse(a) : a, B = typeof b === 'string' ? parse(b) : b;
    var la = luminance(A), lb = luminance(B);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  /* Mix two colours in linear light. t = 0 gives a, t = 1 gives b. */
  function mix(a, b, t) {
    var A = typeof a === 'string' ? parse(a) : a, B = typeof b === 'string' ? parse(b) : b;
    t = clamp(t, 0, 1);
    return hex({ r: unlin(lin(A.r) + (lin(B.r) - lin(A.r)) * t), g: unlin(lin(A.g) + (lin(B.g) - lin(A.g)) * t), b: unlin(lin(A.b) + (lin(B.b) - lin(A.b)) * t) });
  }
  /* Composite a (possibly translucent) colour over an opaque backdrop. */
  function over(fg, bg) {
    var F = typeof fg === 'string' ? parse(fg) : fg, B = typeof bg === 'string' ? parse(bg) : bg;
    var a = F.a === undefined ? 1 : F.a;
    return hex({ r: F.r * a + B.r * (1 - a), g: F.g * a + B.g * (1 - a), b: F.b * a + B.b * (1 - a) });
  }
  function isDark(bg) { var c = typeof bg === 'string' ? parse(bg) : bg; return luminance(c) < 0.18; }

  function ramp(t, stops) {
    t = clamp(isFinite(t) ? t : 0, 0, 1);
    var n = stops.length - 1, p = t * n, i = Math.min(n - 1, Math.floor(p));
    return mix(stops[i], stops[i + 1], p - i);
  }
  function palette(name) { return PALETTES[name] || PALETTES.reef; }
  function rampStops(name) { return RAMPS[name] || RAMPS.reef; }

  /* ---- number formatting (compact by default, plain on request) ---- */
  function fmt(v, style) {
    if (v === null || v === undefined || !isFinite(v)) return '';
    var a = Math.abs(v), s = v < 0 ? '-' : '';
    if (style === 'plain') return s + a.toLocaleString('en-US', { maximumFractionDigits: a < 100 ? 2 : 0 });
    var u = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (var i = 0; i < u.length; i++) {
      if (a >= u[i][0]) {
        var x = a / u[i][0];
        return s + (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10) + u[i][1];
      }
    }
    return s + (a >= 100 ? String(Math.round(a)) : String(Math.round(a * 100) / 100));
  }

  global.RF = global.RF || {};
  global.RF.colors = {
    PALETTES: PALETTES, RAMPS: RAMPS, parse: parse, hex: hex, luminance: luminance, contrast: contrast,
    mix: mix, over: over, isDark: isDark, ramp: ramp, palette: palette, rampStops: rampStops, fmt: fmt, clamp: clamp
  };
})(typeof window !== 'undefined' ? window : globalThis);
