/* Tide Lines - layout maths. Pure functions, no DOM. Text is measured through an
 * injected function so node can test the same code the browser runs.
 *
 * The one hard rule here: text is never smaller than MIN_FONT (14px). When the
 * ridge labels cannot all fit at that size, fewer labels are drawn and the
 * footer says how many were left out. The size is never reduced to make room.
 */
(function (global) {
  'use strict';
  var TL = global.TL = global.TL || {};
  var MIN_FONT = 14;

  /* Rows: n ridges, `overlap` = how many row-steps tall a ridge's peak is.
   * Total height = step * (n - 1 + overlap). */
  function rows (plotTop, plotH, n, overlap) {
    var step = plotH / (Math.max(0, n - 1) + overlap);
    var base0 = plotTop + overlap * step;
    var baselines = [];
    for (var i = 0; i < n; i++) baselines.push(base0 + i * step);
    return { step: step, peak: overlap * step, baselines: baselines };
  }

  /* Which ridge labels to draw. A label needs a line of 1.25 x font size to itself.
   * Returns { stride, shown: [bool per ridge], shownCount, total, note }. */
  function labelPlan (n, rowStep, fontPx, lines) {
    var font = Math.max(MIN_FONT, fontPx || MIN_FONT);
    var need = font * 1.25 * Math.max(1, lines || 1);
    var stride = rowStep >= need ? 1 : Math.max(1, Math.ceil(need / Math.max(rowStep, 0.0001)));
    var shown = [], count = 0;
    for (var i = 0; i < n; i++) {
      var on = i % stride === 0;
      shown.push(on);
      if (on) count++;
    }
    return {
      stride: stride, shown: shown, shownCount: count, total: n, font: font,
      note: count < n ? 'Showing ' + count + ' of ' + n + ' labels' : ''
    };
  }

  /* Cut text to a width with an ellipsis. measure(text) returns pixels. */
  function fitText (text, maxW, measure) {
    text = String(text);
    if (measure(text) <= maxW) return text;
    var lo = 0, hi = text.length;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      if (measure(text.slice(0, mid) + '…') <= maxW) lo = mid; else hi = mid - 1;
    }
    return lo > 0 ? text.slice(0, lo) + '…' : '';
  }

  /* Choose x tick values so adjacent labels never touch (gap >= 10px). */
  function pickTicks (kde, lo, hi, plotW, fmt, measure, most) {
    for (var want = Math.max(2, most || 10); want >= 2; want--) {
      var t = kde.niceTicks(lo, hi, want);
      var ok = true, lastEnd = -1e9;
      for (var i = 0; i < t.length; i++) {
        var x = plotW * (t[i] - lo) / (hi - lo), w = measure(fmt(t[i]));
        if (x - w / 2 < lastEnd + 10) { ok = false; break; }
        lastEnd = x + w / 2;
      }
      if (ok) return t;
    }
    return [lo, hi];
  }

  TL.layout = { MIN_FONT: MIN_FONT, rows: rows, labelPlan: labelPlan, fitText: fitText, pickTicks: pickTicks };
})(typeof window !== 'undefined' ? window : globalThis);
