/* Tide Lines - color maths and the Data Divers palette.
 *
 * Text must hit 7:1 against its background, in light and dark. ensureContrast
 * walks a color toward black or white until it does, so the ridge labels and
 * axis never depend on what the worksheet background happens to be.
 */
(function (global) {
  'use strict';
  var TL = global.TL = global.TL || {};

  function parse (hex) {
    var h = String(hex || '').trim().replace('#', '');
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function toHex (rgb) {
    return '#' + rgb.map(function (v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('');
  }
  /* Accept rgb()/rgba() strings too, because a worksheet background may arrive that way. */
  function toRgb (c) {
    var p = parse(c);
    if (p) return p;
    var m = /rgba?\(\s*([0-9.]+)[ ,]+([0-9.]+)[ ,]+([0-9.]+)/.exec(String(c || ''));
    return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null;
  }
  function lum (rgb) {
    var c = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast (a, b) {
    var A = toRgb(a), B = toRgb(b);
    if (!A || !B) return 1;
    var la = lum(A), lb = lum(B);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function mix (a, b, t) {
    var A = toRgb(a), B = toRgb(b);
    return toHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
  }
  function isDark (bg) { var r = toRgb(bg); return r ? lum(r) < 0.18 : false; }

  /* Move fg toward black or white (whichever helps) until contrast with bg >= ratio. */
  function ensureContrast (fg, bg, ratio) {
    if (!toRgb(fg)) fg = isDark(bg) ? '#f3f5f7' : '#0b1f2e';
    if (contrast(fg, bg) >= ratio) return toHex(toRgb(fg));
    var target = contrast('#000000', bg) >= contrast('#ffffff', bg) ? '#000000' : '#ffffff';
    for (var t = 0.05; t <= 1.0001; t += 0.05) {
      var c = mix(fg, target, t);
      if (contrast(c, bg) >= ratio) return c;
    }
    return target;
  }

  /* Ocean-tide ramps, deep water to foam. The first is the Data Divers palette
   * (deep navy #081f33 / #0c2a45, teal #3cc4d1, foam #8fe3ec). */
  var RAMPS = {
    tide: ['#0c2a45', '#12527a', '#1f8fa6', '#3cc4d1', '#8fe3ec', '#d9f6f9'],
    reef: ['#16324a', '#1d6b6b', '#2fa58a', '#7fd1a0', '#d6ec9b', '#f8f3c4'],
    dusk: ['#2a2358', '#6a3d8f', '#c2528a', '#f26b5b', '#f5b83d', '#fde7a8']
  };
  var CATEGORICAL = ['#3cc4d1', '#12527a', '#f26b5b', '#f5b83d', '#8a6bd6', '#2fa58a', '#e0457b', '#8fa7b8'];

  function lerpRamp (stops, t) {
    t = Math.max(0, Math.min(1, t));
    var f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f));
    return mix(stops[i], stops[i + 1], f - i);
  }

  /* Color for ridge i of n. The usable slice of the ramp depends on the background so
   * foam never vanishes on white and navy never vanishes on a dark sheet. */
  function ridgeColor (name, single, i, n, bg) {
    if (name === 'single') return single;
    var stops = RAMPS[name] || RAMPS.tide;
    var dark = isDark(bg), a = dark ? 0.22 : 0.08, b = dark ? 1 : 0.78;
    var t = n > 1 ? i / (n - 1) : 0.5;
    return lerpRamp(stops, a + (b - a) * t);
  }

  TL.palettes = { parse: parse, toHex: toHex, toRgb: toRgb, contrast: contrast, mix: mix, isDark: isDark,
    ensureContrast: ensureContrast, RAMPS: RAMPS, CATEGORICAL: CATEGORICAL, lerpRamp: lerpRamp, ridgeColor: ridgeColor };
})(typeof window !== 'undefined' ? window : globalThis);
