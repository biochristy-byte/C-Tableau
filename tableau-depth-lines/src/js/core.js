/* Shared helpers for the Data Divers house extensions: color math, contrast,
 * number formatting, tick picking and label thinning. This file is identical in Depth Lines and Sketchbook on purpose.
 * Nothing here touches Tableau. */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------- color */

  function parseColor (c) {
    if (typeof c !== 'string') return null;
    c = c.trim();
    var m = /^#([0-9a-f]{3})$/i.exec(c);
    if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
    m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c);
    if (m) return [+m[1], +m[2], +m[3]];
    return null;
  }
  function hex (rgb) {
    return '#' + rgb.map(function (v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('');
  }
  function luminance (rgb) {
    var l = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  }
  function contrast (a, b) {
    var la = luminance(parseColor(a) || [0, 0, 0]), lb = luminance(parseColor(b) || [255, 255, 255]);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  function mix (a, b, t) {
    var x = parseColor(a) || [0, 0, 0], y = parseColor(b) || [255, 255, 255];
    return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  var INK_DARK = '#0a1018', INK_LIGHT = '#f5f8fb';
  /* The ink that reads best on a background. Near-black or near-white both
   * clear 7:1 on every background that is not a mid gray. */
  function pickText (bg) {
    return contrast(INK_DARK, bg) >= contrast(INK_LIGHT, bg) ? INK_DARK : INK_LIGHT;
  }
  function isDark (bg) { return pickText(bg) === INK_LIGHT; }

  /* ----------------------------------------------------------- numbers */

  function niceStep (range, count) {
    var raw = range / Math.max(1, count);
    var p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var f = raw / p;
    var n = f >= 7.5 ? 10 : f >= 3.5 ? 5 : f >= 1.5 ? 2 : 1;
    return n * p;
  }
  /* Ticks inside [min, max], about `count` of them. */
  function ticks (min, max, count) {
    if (!(max > min)) return [min];
    var step = niceStep(max - min, count);
    var out = [];
    var start = Math.ceil(min / step - 1e-9) * step;
    for (var v = start, i = 0; v <= max + step * 1e-9 && i < 200; v += step, i++) {
      out.push(Math.round(v / step) * step);
    }
    out.step = step;
    return out;
  }
  function trimZeros (s) { return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; }
  function formatNumber (v, step) {
    if (v === null || v === undefined || !isFinite(v)) return '';
    var a = Math.abs(v);
    if (a >= 1e9) return trimZeros((v / 1e9).toFixed(2)) + 'B';
    if (a >= 1e6) return trimZeros((v / 1e6).toFixed(a >= 1e7 ? 1 : 2)) + 'M';
    if (a >= 1e4) return trimZeros((v / 1e3).toFixed(1)) + 'K';
    var dec = 0;
    if (step && step > 0) dec = Math.max(0, Math.min(6, -Math.floor(Math.log(step) / Math.LN10 + 1e-9)));
    else if (a < 10) dec = 2;
    var s = (Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec);
    s = trimZeros(s);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  /* ------------------------------------------------- label overlap pass */

  function rectsOverlap (a, b, pad) {
    return a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
  }
  /* Removes any node whose box overlaps one already kept, in the order given.
   * Returns the number removed. */
  function thin (nodes, pad) {
    var kept = [], removed = 0;
    nodes.forEach(function (n) {
      var r = n.getBoundingClientRect();
      var clash = kept.some(function (k) { return rectsOverlap(r, k, pad || 2); });
      if (clash) { if (n.parentNode) n.parentNode.removeChild(n); removed++; } else kept.push(r);
    });
    return removed;
  }

  global.HX = {
    parseColor: parseColor, hex: hex, luminance: luminance, contrast: contrast, mix: mix,
    pickText: pickText, isDark: isDark, INK_DARK: INK_DARK, INK_LIGHT: INK_LIGHT,
    niceStep: niceStep, ticks: ticks, formatNumber: formatNumber, thin: thin, rectsOverlap: rectsOverlap
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.HX;
})(typeof window !== 'undefined' ? window : globalThis);
