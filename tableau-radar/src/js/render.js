/* Radar - SVG renderer. Takes the pivoted model and the resolved settings, lays out one radar (or one per series),
 * draws rings, spokes, wrapped axis labels, series shapes, dots, a dashed benchmark ring, legend and tooltip, and
 * handles hover (eased dim of the other series), click-to-isolate and the entrance animation. */
(function (global) {
  'use strict';
  var RD = global.RD = global.RD || {};
  var M = RD.math, CP = global.CTabPanel, C = CP.color;
  var NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function htmlEl(tag, cls, parent, text) {
    var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; if (parent) parent.appendChild(e); return e;
  }

  /* ------------------------------------------------- model + settings -> drawable */

  function seriesItems(model, s) {
    var pal = CP.paletteColors(s.palette, s.paletteReverse);
    return model.series.map(function (x, i) { return { key: x.key, name: x.name, color: pal[i % pal.length] }; });
  }
  function axisItems(model) { return model.axes.map(function (a) { return { key: a.key, name: a.label, color: '' }; }); }

  /* Applies the per-series and per-axis lists (rename, recolor, hide), pulls the benchmark out of the series,
   * and keeps value arrays aligned with the visible axes. Pure, so node can test it. */
  function prepare(model, s) {
    var si = CP.mergeList(s.catColors, seriesItems(model, s)), byKey = {};
    model.series.forEach(function (x) { byKey[x.key] = x; });
    var ai = CP.mergeList(s.axesList, axisItems(model)).filter(function (a) { return !a.hidden; });
    var axisIndex = {}; model.axes.forEach(function (a, i) { axisIndex[a.key] = i; });
    var axisOrder = ai.map(function (a) { return axisIndex[a.key]; });
    var axes = ai.map(function (a) { return { key: a.key, label: a.name }; });
    var pal = CP.paletteColors(s.palette, s.paletteReverse);
    var series = [], bench = null, want = String(s.benchSeries || '').trim().toLowerCase();
    si.forEach(function (it, pos) {
      if (it.hidden) return;
      var src = byKey[it.key];
      var o = { key: it.key, name: it.name, color: it.color || pal[pos % pal.length], values: axisOrder.map(function (i) { return src.values[i]; }),
        tuples: src.tupleList, byAxisTuples: axisOrder.map(function (i) { return src.tuples[model.axes[i].key] || []; }) };
      if (s.benchMode === 'series' && want && (it.key.toLowerCase() === want || it.name.toLowerCase() === want)) bench = { key: it.key, name: it.name, values: o.values, tuples: o.tuples, isSeries: true };
      else series.push(o);
    });
    if (s.benchMode === 'value') bench = { key: '__bench', name: s.benchLabel || 'Benchmark', values: axes.map(function () { return s.benchValue; }), tuples: [], isSeries: false };
    return { axes: axes, series: series, bench: bench };
  }

  function scaleOf(p, s) {
    var extra = p.bench ? p.bench.values.map(function (v) { return [v]; }) : null;
    return M.scales(p.axes, p.series, { perAxis: s.scaleMode === 'perAxis', rings: s.ringCount, minMode: s.minMode, min: s.minCustom, maxMode: s.maxMode, max: s.maxCustom, extra: extra });
  }

  /* ---------------------------------------------------------------- layout */

  /* One radar inside a w x h cell. measure(text) -> px. Returns the center, radius and the label boxes that fit. */
  function layoutRadar(w, h, p, s, measure, labelTexts) {
    var n = p.axes.length, pad = 6, fs = s.labelSize, lh = Math.round(fs * 1.28), gap = s.axisLabelDist;
    var thetas = p.axes.map(function (a, i) { return M.angleOf(i, n, s.rotation, s.direction === 'ccw' ? -1 : 1); });
    var wrapW = Math.max(48, Math.min(s.axisWrap, w * 0.34));
    var boxes = labelTexts.map(function (t) {
      var lines = M.wrapText(t, wrapW, measure, s.labelLines), bw = 0;
      lines.forEach(function (l) { bw = Math.max(bw, measure(l)); });
      return { lines: lines, w: Math.ceil(bw) + 2, h: lines.length * lh };
    });
    function place(R, cx, cy) {
      return boxes.map(function (b, i) {
        var c = Math.cos(thetas[i]), sn = Math.sin(thetas[i]), ax = cx + (R + gap) * c, ay = cy + (R + gap) * sn, l, t, anchor;
        if (c > 0.25) { l = ax; anchor = 'start'; } else if (c < -0.25) { l = ax - b.w; anchor = 'end'; } else { l = ax - b.w / 2; anchor = 'middle'; }
        if (sn > 0.25) t = ay; else if (sn < -0.25) t = ay - b.h; else t = ay - b.h / 2;
        return { l: l, t: t, r: l + b.w, b: t + b.h, anchor: anchor, lines: b.lines, ax: anchor === 'start' ? l : anchor === 'end' ? l + b.w : l + b.w / 2 };
      });
    }
    function union(R, withLabels) {
      var cx = w / 2, cy = h / 2, bb = { l: cx - R, t: cy - R, r: cx + R, b: cy + R };
      if (withLabels) place(R, cx, cy).forEach(function (q) { bb.l = Math.min(bb.l, q.l); bb.t = Math.min(bb.t, q.t); bb.r = Math.max(bb.r, q.r); bb.b = Math.max(bb.b, q.b); });
      return bb;
    }
    function fits(R, withLabels) { var bb = union(R, withLabels); return bb.r - bb.l <= w - 2 * pad && bb.b - bb.t <= h - 2 * pad; }
    var showLabels = s.labelsOn, minR = 28, R;
    if (showLabels && !fits(minR, true)) showLabels = false;
    var hi = Math.max(8, Math.min(w, h) / 2 - pad), lo = showLabels ? minR : 8;
    for (var it = 0; it < 40; it++) { var mid = (lo + hi) / 2; if (fits(mid, showLabels)) lo = mid; else hi = mid; }
    R = Math.max(8, lo);
    var bb = union(R, showLabels), cx = w / 2 + ((pad + (w - 2 * pad) / 2) - (bb.l + bb.r) / 2), cy = h / 2 + ((pad + (h - 2 * pad) / 2) - (bb.t + bb.b) / 2);
    R = R * Math.max(0.2, s.sizePct / 100);
    var out = { top: bb.t + (cy - h / 2), cx: cx, cy: cy, R: R, thetas: thetas, labels: [], hidden: 0, labelsOff: !showLabels && s.labelsOn, lh: lh };
    if (showLabels) {
      var q = place(R, cx, cy), kept = [];
      q.forEach(function (b, i) {
        var clash = kept.some(function (k) { return M.overlaps(b, k.box, 2); });
        if (clash) { out.hidden++; return; }
        kept.push({ i: i, box: b });
        out.labels.push({ i: i, box: b });
      });
    }
    return out;
  }

  /* --------------------------------------------------------------- renderer */

  function Renderer(host) {
    var self = this;
    this.host = host; this.iso = null; this.hover = null; this.lastKey = null; this.anim = 0; this.measureCache = {}; this.cvs = null;
    host.classList.add('rd-chart'); host.innerHTML = '';
    this.title = htmlEl('div', 'rd-title', host);
    this.legTop = htmlEl('div', 'rd-legend rd-legend-top', host);
    this.mid = htmlEl('div', 'rd-mid', host);
    this.stage = htmlEl('div', 'rd-stage', this.mid);
    this.legRight = htmlEl('div', 'rd-legend rd-legend-right', this.mid);
    this.legBottom = htmlEl('div', 'rd-legend rd-legend-bottom', host);
    this.note = htmlEl('div', 'rd-note', host);
    this.tip = htmlEl('div', 'rd-tip', host); this.tip.setAttribute('role', 'tooltip');
    this.stage.addEventListener('pointerover', function (e) { self.onOver(e); });
    this.stage.addEventListener('pointermove', function (e) { self.onMove(e); });
    this.stage.addEventListener('pointerleave', function () { self.setHover(null); self.hideTip(); });
    this.stage.addEventListener('click', function (e) { self.onClick(e); });
    this.stage.addEventListener('keydown', function (e) {
      var g = e.target.closest && e.target.closest('.rd-s');
      if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); self.toggleIso(g.getAttribute('data-key')); }
    });
    this.stage.addEventListener('focusin', function (e) { var g = e.target.closest && e.target.closest('.rd-s'); if (g) self.setHover(g.getAttribute('data-key')); });
    this.stage.addEventListener('focusout', function () { self.setHover(null); });
  }

  Renderer.prototype.measure = function (text, size, weight, stack) {
    if (!this.cvs) this.cvs = document.createElement('canvas').getContext('2d');
    var f = weight + ' ' + size + 'px ' + stack;
    if (this.cvs.font !== f) this.cvs.font = f;
    return this.cvs.measureText(text).width;
  };

  Renderer.prototype.setHover = function (key) {
    if (this.hover === key) return;
    this.hover = key; this.applyFocus();
    if (this.hooks && this.hooks.onHover) this.hooks.onHover(key);
  };
  Renderer.prototype.toggleIso = function (key) {
    this.iso = this.iso === key ? null : key; this.applyFocus();
    if (this.hooks && this.hooks.onSelect) this.hooks.onSelect(this.iso ? 'series' : 'clear', this.iso || null);
  };
  Renderer.prototype.applyFocus = function () {
    var key = this.iso || (this.s && this.s.hoverOn ? this.hover : null), svg = this.svg;
    if (svg) {
      svg.classList.toggle('rd-focus', !!key); svg.classList.toggle('rd-iso', !!this.iso);
      svg.querySelectorAll('.rd-s').forEach(function (g) { g.classList.toggle('is-on', g.getAttribute('data-key') === key); });
    }
    this.host.querySelectorAll('.rd-lg[data-key]').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-key') === key);
      b.setAttribute('aria-pressed', String(b.getAttribute('data-key') === this.iso));
    }, this);
  };
  Renderer.prototype.hideTip = function () { this.tip.classList.remove('on'); };

  Renderer.prototype.onOver = function (e) {
    var dot = e.target.closest && e.target.closest('.rd-dhit'), g = e.target.closest && e.target.closest('.rd-s');
    if (!this.s) return;
    if (g && !(this.iso && g.getAttribute('data-key') !== this.iso)) this.setHover(g.getAttribute('data-key')); else if (!g) this.setHover(null);
    if (!this.s.tipOn) return;
    if (dot) this.showTip(e, 'axis', +dot.getAttribute('data-ai'), g ? g.getAttribute('data-key') : null);
    else if (g) this.showTip(e, 'series', 0, g.getAttribute('data-key'));
    else this.hideTip();
  };
  Renderer.prototype.onMove = function (e) { if (this.tip.classList.contains('on')) this.placeTip(e); else this.onOver(e); };
  Renderer.prototype.onClick = function (e) {
    if (!this.s) return;
    var g = e.target.closest && e.target.closest('.rd-s');
    if (g && this.s.clickIsolate) { this.toggleIso(g.getAttribute('data-key')); return; }
    if (g && this.hooks && this.hooks.onSelect && this.s.selectOn) { this.hooks.onSelect('series', g.getAttribute('data-key')); return; }
    if (!g && this.iso) { this.iso = null; this.applyFocus(); if (this.hooks && this.hooks.onSelect) this.hooks.onSelect('clear', null); }
  };

  Renderer.prototype.showTip = function (e, kind, ai, skey) {
    var p = this.p, s = this.s, tip = this.tip, rows = [], title, swatch = s.tipSwatch;
    tip.innerHTML = '';
    var fmt = function (v) { return v === null || v === undefined ? 'no data' : CP.formatNumber(v, s); };
    if (kind === 'axis') {
      title = p.axes[ai].label;
      p.series.forEach(function (x) { rows.push({ name: x.name, color: x.color, v: x.values[ai], key: x.key }); });
      if (p.bench) rows.push({ name: p.bench.name, color: null, v: p.bench.values[ai], key: p.bench.key, dashed: true });
      rows.sort(function (a, b) { return (b.v === null ? -Infinity : b.v) - (a.v === null ? -Infinity : a.v); });
    } else {
      var x = null; p.series.forEach(function (q) { if (q.key === skey) x = q; });
      if (!x && p.bench && p.bench.key === skey) x = p.bench;
      if (!x) { this.hideTip(); return; }
      title = x.name;
      p.axes.forEach(function (a, i) { rows.push({ name: a.label, color: null, v: x.values[i], key: a.key }); });
    }
    htmlEl('div', 'rd-tip-h', tip, title);
    var max = 9, self = this;
    rows.slice(0, max).forEach(function (r) {
      var row = htmlEl('div', 'rd-tip-r' + (r.key === skey ? ' is-on' : ''), tip);
      if (swatch && r.color) { var sw = htmlEl('span', 'rd-tip-sw', row); sw.style.background = r.color; }
      htmlEl('span', 'rd-tip-n', row, r.name); htmlEl('span', 'rd-tip-v', row, fmt(r.v));
    });
    if (rows.length > max) htmlEl('div', 'rd-tip-m', tip, '+ ' + (rows.length - max) + ' more');
    tip.classList.add('on'); this.placeTip(e);
  };
  Renderer.prototype.placeTip = function (e) {
    var tip = this.tip, hr = this.host.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, x, y;
    if (this.s.tipFollow === 'corner') { x = 8; y = 8; }
    else { x = e.clientX - hr.left + 14; y = e.clientY - hr.top + 14; if (x + w > hr.width - 4) x = e.clientX - hr.left - w - 14; if (y + h > hr.height - 4) y = e.clientY - hr.top - h - 14; }
    tip.style.left = Math.max(4, Math.min(hr.width - w - 4, x)) + 'px'; tip.style.top = Math.max(4, Math.min(hr.height - h - 4, y)) + 'px';
  };

  /* ------------------------------------------------------------------ draw */

  Renderer.prototype.draw = function (model, s, hooks) {
    this.hooks = hooks || {}; this.s = s; this.model = model;
    var host = this.host, stack = CP.fontStack(s.fontFamily), self = this;
    var bgWs = C.normHex(model.worksheetBg) || '#ffffff', bg = s.bgMode === 'custom' ? (C.normHex(s.bgColor) || bgWs) : bgWs;
    var ink = C.ensureContrast(C.normHex(s.labelColor) || C.bestInk(bg), [bg], 7.5), muted = C.ensureContrast(C.mix(ink, bg, 0.28), [bg], 7.2);
    this.colors = { bg: bg, ink: ink, muted: muted };
    host.style.background = s.bgMode === 'transparent' ? 'transparent' : bg;
    host.style.color = ink; host.style.fontFamily = stack; host.style.padding = s.padding + 'px';
    host.style.border = s.borderOn ? s.borderWidth + 'px solid ' + (C.normHex(s.borderColor) || muted) : '0';
    host.style.borderRadius = s.borderOn ? s.borderRadius + 'px' : '0';
    host.style.setProperty('--rd-dim', String(s.dimOthers / 100)); host.style.setProperty('--rd-ms', s.hoverMs + 'ms');
    host.style.setProperty('--rd-tip-size', s.tipSize + 'px'); host.style.setProperty('--rd-tip-w', s.tipMaxW + 'px');
    host.style.setProperty('--rd-tip-bg', C.mix(bg, ink, 0.06)); host.style.setProperty('--rd-ink', ink); host.style.setProperty('--rd-muted', muted); host.style.setProperty('--rd-bg', bg);

    var p = this.p = prepare(model, s);
    this.stage.innerHTML = ''; this.svg = null; this.hideTip();
    ['legTop', 'legRight', 'legBottom'].forEach(function (k) { self[k].innerHTML = ''; self[k].style.display = 'none'; });
    this.title.style.display = s.showTitle && s.titleText ? '' : 'none';
    this.title.textContent = s.titleText || ''; this.title.style.fontSize = s.titleSize + 'px'; this.title.style.fontWeight = s.titleWeight === 'bold' ? '700' : '400';
    this.note.style.display = 'none'; this.note.textContent = '';
    this.mid.classList.toggle('rd-mid-right', s.legendOn && s.legendPos === 'right');
    if (p.axes.length < 3 || !p.series.length) {
      var em = htmlEl('div', 'rd-empty', this.stage);
      em.textContent = !model.axes.length ? (model.emptyMessage || 'Drop a dimension on Axis and a measure on Value.') :
        (p.axes.length < 3 ? 'A radar needs at least 3 axes. Put a dimension with 3 or more values on Axis.' : 'Every series is hidden. Show one on the Colors tab.');
      em.style.color = ink; em.style.fontSize = Math.max(14, s.labelSize) + 'px';
      this.svg = null; return;
    }
    /* Named small multiples already say which radar is which; the legend would only take room from the radars. A benchmark keeps it, as it explains the dashed ring. */
    var legendDrawn = false;
    if (s.legendOn && !(s.view === 'multiples' && p.series.length > 1 && s.mtitle && !p.bench)) { this.drawLegend(p, s, ink); legendDrawn = true; }
    var sc = scaleOf(p, s), sig = model.key || '';
    var run = (sig !== this.lastKey) && s.animOn && !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.lastKey = sig;
    for (var pass = 0; pass < 3; pass++) {
      this.stage.innerHTML = '';
      var rect = this.stage.getBoundingClientRect(), W = Math.max(40, Math.floor(rect.width)), H = Math.max(40, Math.floor(rect.height));
      var info = this.drawSvg(p, s, sc, W, H, stack);
      /* a panel whose name had to be dropped (tiny frame, settings gear in the way) must still be identifiable: bring the legend back */
      if (info.titlesLost && !legendDrawn) { this.drawLegend(p, s, ink); legendDrawn = true; continue; }
      var msg = info.labelsOff ? 'Axis labels are hidden: the chart is too small for ' + s.labelSize + 'px text. Enlarge it to see them.' :
        info.hidden ? 'Showing ' + (p.axes.length - info.hidden) + ' of ' + p.axes.length + ' axis labels. Enlarge the chart or shorten the labels to see the rest.' : '';
      if (!!msg === (this.note.style.display !== 'none') && (!msg || this.note.textContent === msg)) break;
      this.note.textContent = msg; this.note.style.display = msg ? '' : 'none';
    }
    this.applyFocus();
    if (run) this.animateIn(s); else this.svg.setAttribute('data-anim', 'done');
  };

  Renderer.prototype.drawLegend = function (p, s, ink) {
    var self = this, box = s.legendPos === 'right' ? this.legRight : s.legendPos === 'top' ? this.legTop : this.legBottom;
    box.style.display = ''; box.style.fontSize = Math.max(14, s.labelSize) + 'px'; box.style.color = ink;
    if (s.legendTitle) htmlEl('span', 'rd-lg-t', box, s.legendTitle);
    if (p.series.length > 1 || p.bench) p.series.forEach(function (x) {
      var b = htmlEl('button', 'rd-lg', box); b.type = 'button'; b.setAttribute('data-key', x.key); b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', 'Isolate ' + x.name);
      var sw = htmlEl('span', 'rd-lg-sw', b); sw.style.background = C.ensureContrast(x.color, [self.colors.bg], 3); htmlEl('span', 'rd-lg-n', b, x.name);
      b.addEventListener('pointerenter', function () { self.setHover(x.key); }); b.addEventListener('pointerleave', function () { self.setHover(null); });
      b.addEventListener('click', function () { self.toggleIso(x.key); });
    });
    if (p.bench) {
      var bi = htmlEl('span', 'rd-lg rd-lg-bench', box), bsw = htmlEl('span', 'rd-lg-sw rd-lg-dash', bi), bc = this.benchColor(s);
      bsw.style.borderColor = bc; htmlEl('span', 'rd-lg-n', bi, p.bench.name);
    }
    if (!box.childNodes.length) box.style.display = 'none';
  };
  Renderer.prototype.benchColor = function (s) { return C.ensureContrast(C.normHex(s.benchColor) || this.colors.ink, [this.colors.bg], 3); };

  Renderer.prototype.drawSvg = function (p, s, sc, W, H, stack) {
    var self = this, col = this.colors, svg = this.svg = svgEl('svg', { 'class': 'rd-svg', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Radar chart of ' + p.series.length + ' series across ' + p.axes.length + ' axes' }, this.stage);
    svg.setAttribute('data-view', s.view); svg.setAttribute('data-axes', p.axes.length); svg.setAttribute('data-series', p.series.length);
    svg.setAttribute('data-curve', s.curve); svg.setAttribute('data-scale', s.scaleMode); svg.setAttribute('data-rings', s.ringCount);
    svg.style.fontFamily = stack;
    var multi = s.view === 'multiples' && p.series.length > 1, panels = [];
    var texts = [], hiddenTotal = 0, labelsOff = false, self2 = this, titlesLost = 0;
    this.anims = [];
    var fsl = s.labelSize, wl = s.labelWeight === 'bold' ? '700' : '400';
    var meas = function (t) { return self2.measure(t, fsl, wl, stack); };
    var labelTexts = p.axes.map(function (a, i) {
      var t = a.label;
      if (s.axisRange) { var d = sc.axes[i]; t += ' (' + CP.formatNumber(d.lo, s) + ' to ' + CP.formatNumber(d.hi, s) + ')'; }
      return t;
    });
    var gridCfg = { cells: [{ x: 0, y: 0, w: W, h: H }] };
    if (multi) {
      var cols = s.mcols, nS = p.series.length, tH = s.mtitle ? Math.round(Math.max(16, s.labelSize) * 1.5) : 0;
      if (!(cols > 0)) { // pick the column count that gives the biggest radars with the most axis labels kept
        var bestScore = -Infinity;
        for (var c = 1; c <= nS; c++) {
          var g0 = M.layoutMultiples(W, H, nS, c, s.mgap), c0 = g0.cells[0], l0 = layoutRadar(c0.w, c0.h - tH, p, s, meas, labelTexts);
          var sc0 = l0.R + (l0.labelsOff ? 0 : 1000) - l0.hidden * 40 - (tH && c0.w < 80 ? 500 : 0); // cells too narrow to name are a last resort
          if (sc0 > bestScore + 1e-9) { bestScore = sc0; cols = c; }
        }
      }
      gridCfg = M.layoutMultiples(W, H, nS, cols, s.mgap);
    }
    var rootR = this.host.parentNode.getBoundingClientRect(), stR = this.stage.getBoundingClientRect();
    var gear = { l: rootR.right - 52 - stR.left, b: rootR.top + 52 - stR.top }; // the settings gear floats here; titles keep clear of it
    gridCfg.cells.forEach(function (cell, ci) { panels.push({ cell: cell, series: multi ? [p.series[ci]] : p.series, title: multi && s.mtitle ? p.series[ci].name : '' }); });
    panels.forEach(function (pn, pi) {
      var g = svgEl('g', { 'class': 'rd-panel', transform: 'translate(' + pn.cell.x.toFixed(2) + ',' + pn.cell.y.toFixed(2) + ')' }, svg);
      var th = 0, tt = null;
      if (pn.title) {
        /* the title never leaves its cell: 16px when it fits, else 14px, else cut with an ellipsis, else dropped */
        var tsz = Math.max(16, s.labelSize), tw0 = pn.cell.w - 6;
        var tmeas = function (t, z) { return self2.measure(t, z, '700', stack); };
        if (tmeas(pn.title, tsz) > tw0) tsz = 14;
        var tx = pn.cell.w / 2, tanchor = 'middle', tmw = tmeas(pn.title, tsz);
        if (pn.cell.y < gear.b && pn.cell.x + pn.cell.w > gear.l && pn.cell.x + tx + Math.min(tmw, tw0) / 2 > gear.l) { tx = 3; tanchor = 'start'; tw0 = Math.max(0, gear.l - pn.cell.x - 8); }
        var ttext = M.fitLine(pn.title, tw0, function (t) { return tmeas(t, tsz); });
        if (ttext) {
          th = Math.round(tsz * 1.5);
          tt = svgEl('text', { 'class': 'rd-ptitle', x: tx, y: Math.round(th * 0.7), 'text-anchor': tanchor, fill: col.ink, 'font-size': tsz, 'font-weight': '700' }, g);
          tt.textContent = ttext;
          tt.appendChild(svgEl('title', null)).textContent = pn.title;
        } else titlesLost++;
      }
      var lay = layoutRadar(pn.cell.w, pn.cell.h - th, p, s, meas, labelTexts);
      if (tt) tt.setAttribute('y', Math.max(Math.round(th * 0.7), Math.round(th + lay.top - 7))); // the name sits right above its radar
      hiddenTotal = Math.max(hiddenTotal, lay.hidden); labelsOff = labelsOff || lay.labelsOff;
      var gg = svgEl('g', { transform: 'translate(0,' + th + ')' }, g);
      self2.drawPanel(gg, pn, lay, p, s, sc, labelTexts, wl, texts, pn.cell.x, pn.cell.y + th);
    });
    return { hidden: hiddenTotal, labelsOff: labelsOff, texts: texts, titlesLost: titlesLost };
  };

  Renderer.prototype.drawPanel = function (g, pn, lay, p, s, sc, labelTexts, wl, placedTexts, ox, oy) {
    var self = this, col = this.colors, n = p.axes.length, cx = lay.cx, cy = lay.cy, R = lay.R, th = lay.thetas;
    var ringC = C.normHex(s.ringColor) || C.mix(col.bg, col.ink, 0.28), axC = C.normHex(s.axisColor) || C.mix(col.bg, col.ink, 0.34);
    var dash = s.ringStyle === 'dashed' ? '6 4' : s.ringStyle === 'dotted' ? '1.5 4' : null;
    var gGrid = svgEl('g', { 'class': 'rd-grid' }, g), rings = s.ringCount, i, k;
    function ringPath(r) {
      if (s.ringShape === 'circle') return 'M' + (cx - r) + ',' + cy + 'a' + r + ',' + r + ' 0 1,0 ' + (2 * r) + ',0a' + r + ',' + r + ' 0 1,0 ' + (-2 * r) + ',0Z';
      return M.polygonPath(th.map(function (t) { return M.pointAt(cx, cy, r, t); }));
    }
    if (s.ringBands) for (k = rings; k >= 1; k -= 1) if ((rings - k) % 2 === 0) svgEl('path', { 'class': 'rd-band', d: ringPath(R * k / rings), fill: C.mix(col.bg, col.ink, 0.06), stroke: 'none' }, gGrid);
    for (k = 1; k <= rings; k++) {
      var rp = svgEl('path', { 'class': 'rd-ring', d: ringPath(R * k / rings), fill: 'none', stroke: ringC, 'stroke-width': s.ringWidth }, gGrid);
      if (dash) rp.setAttribute('stroke-dasharray', dash);
    }
    if (s.axisLines) th.forEach(function (t, j) {
      var e = M.pointAt(cx, cy, R, t); svgEl('line', { 'class': 'rd-axis', x1: cx, y1: cy, x2: e.x.toFixed(2), y2: e.y.toFixed(2), stroke: axC, 'stroke-width': s.axisLineWidth }, gGrid);
    });
    var boxes = []; // text boxes in svg-local coordinates, for overlap tests among the optional texts
    var gLab = svgEl('g', { 'class': 'rd-labels' }, g);
    lay.labels.forEach(function (L) {
      var b = L.box, t = svgEl('text', { 'class': 'rd-label', x: b.ax.toFixed(1), 'text-anchor': b.anchor, fill: col.ink, 'font-size': s.labelSize, 'font-weight': wl, 'data-axis': p.axes[L.i].key }, gLab);
      b.lines.forEach(function (ln, li) {
        var ts = svgEl('tspan', { x: b.ax.toFixed(1), y: (b.t + lay.lh * (li + 0.8)).toFixed(1) }, t); ts.textContent = ln;
      });
      boxes.push(b);
    });
    var gRing = null;
    if (s.ringLabels && R >= 36) { // a ring value beside a radar smaller than this reads as noise
      gRing = svgEl('g', { 'class': 'rd-ringlabels' }, g); var rs = s.ringLabelSize, t0 = th[0];
      var tickFmt = s, allInt = !sc.ticks || sc.ticks.every(function (v) { return Math.abs(v - Math.round(v)) < 1e-9; });
      if (allInt) { tickFmt = {}; Object.keys(s).forEach(function (kk) { tickFmt[kk] = s[kk]; }); tickFmt.numDecimals = 0; }
      for (k = 1; k <= rings; k++) {
        var rr = R * k / rings, pt = M.pointAt(cx, cy, rr, t0);
        var txt = sc.perAxis ? Math.round(k / rings * 100) + '%' : CP.formatNumber(sc.ticks[k], tickFmt), tw = self.measure(txt, rs, '400', CP.fontStack(s.fontFamily));
        var bx = { l: pt.x + 4, r: pt.x + 4 + tw + 2, t: pt.y - rs * 0.62, b: pt.y + rs * 0.62 };
        if (bx.l < -1 || bx.r > pn.cell.w + 1 || bx.t < 0 || bx.b > pn.cell.h) continue;
        if (boxes.some(function (o) { return M.overlaps(bx, o, 1); })) continue;
        var tt = svgEl('text', { 'class': 'rd-ringlabel', x: (pt.x + 4).toFixed(1), y: (pt.y + rs * 0.35).toFixed(1), 'font-size': rs, fill: col.muted, stroke: col.bg, 'stroke-width': 3, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, gRing);
        tt.textContent = txt; boxes.push(bx);
      }
    }
    // benchmark
    var benchG = null, bench = p.bench, bPts = null, bPath = null;
    var shapePath = function (pts) { return s.curve === 'smooth' ? M.cardinalClosedPath(pts, s.smooth, cx, cy, R) : M.polygonPath(pts); };
    var anims = this.anims;
    if (bench) {
      benchG = svgEl('g', { 'class': 'rd-bench' }, g);
      var bc = this.benchColor(s), bd = s.benchDash === 'dashed' ? '8 5' : s.benchDash === 'dotted' ? '2 5' : null;
      bPath = svgEl('path', { 'class': 'rd-benchline', fill: s.benchFill ? bc : 'none', 'fill-opacity': s.benchFill ? 0.12 : 0, stroke: bc, 'stroke-width': s.benchWidth, 'stroke-linejoin': 'round' }, benchG);
      if (bd) bPath.setAttribute('stroke-dasharray', bd);
      bPath.setAttribute('aria-label', bench.name + ' benchmark');
      anims.push(function (t) { bPath.setAttribute('d', shapePath(M.seriesPoints(bench, sc, cx, cy, R, th, s.missing, t))); });
    }
    var order = pn.series.slice();
    if (s.drawOrder === 'bigfirst') {
      var areaOf = function (x) { return M.polygonArea(M.seriesPoints(x, sc, cx, cy, R, th, s.missing, 1)); };
      var areas = {}; order.forEach(function (x) { areas[x.key] = areaOf(x); });
      order.sort(function (a, b) { return areas[b.key] - areas[a.key]; });
    }
    var gSer = svgEl('g', { 'class': 'rd-series' }, g), valueBoxes = [];
    order.forEach(function (x) {
      var stroke = C.ensureContrast(x.color, [col.bg], 3);
      var sg = svgEl('g', { 'class': 'rd-s', 'data-key': x.key, tabindex: 0, role: 'img', 'aria-label': x.name + ': ' + x.values.map(function (v, i) { return p.axes[i].label + ' ' + (v === null ? 'no data' : CP.formatNumber(v, s)); }).join(', ') }, gSer);
      var path = svgEl('path', { 'class': 'rd-shape', fill: s.fillOn ? x.color : 'transparent', 'fill-opacity': s.fillOn ? s.fillOpacity / 100 : 1, stroke: stroke, 'stroke-width': s.lineWidth, 'stroke-linejoin': 'round' }, sg);
      var dots = [], hits = [];
      var pts1 = M.seriesPoints(x, sc, cx, cy, R, th, s.missing, 1);
      if (s.dots) pts1.forEach(function (pt) {
        if (pt.v === null) return;
        var d = svgEl('circle', { 'class': 'rd-dot', r: Math.min(s.dotSize, Math.max(2.5, R / 9)), fill: stroke, stroke: col.bg, 'stroke-width': 1.5, 'data-ai': pt.i }, sg);
        var h = svgEl('circle', { 'class': 'rd-dhit', r: Math.max(12, s.dotSize + 7), fill: 'transparent', 'data-ai': pt.i }, sg);
        dots.push({ d: d, h: h, pt: pt });
      });
      anims.push(function (t) {
        var pts = M.seriesPoints(x, sc, cx, cy, R, th, s.missing, t);
        path.setAttribute('d', shapePath(pts));
        dots.forEach(function (o) { var r = R * M.frac(sc, o.pt.i, o.pt.v) * t, q = M.pointAt(cx, cy, r, th[o.pt.i]); o.d.setAttribute('cx', q.x.toFixed(2)); o.d.setAttribute('cy', q.y.toFixed(2)); o.h.setAttribute('cx', q.x.toFixed(2)); o.h.setAttribute('cy', q.y.toFixed(2)); });
      });
      if (s.valueLabels) {
        var vs = s.valueLabelSize;
        pts1.forEach(function (pt) {
          if (pt.v === null) return;
          var txt = CP.formatNumber(pt.v, s), tw = self.measure(txt, vs, '400', CP.fontStack(s.fontFamily)), ux = Math.cos(th[pt.i]), uy = Math.sin(th[pt.i]), off = s.dotSize + vs * 0.7;
          var qx = pt.x + ux * off, qy = pt.y + uy * off, anchor = ux > 0.3 ? 'start' : ux < -0.3 ? 'end' : 'middle';
          var l = anchor === 'start' ? qx : anchor === 'end' ? qx - tw : qx - tw / 2, bx = { l: l, r: l + tw, t: qy - vs * 0.62, b: qy + vs * 0.62 };
          if (bx.l < 0 || bx.r > pn.cell.w || bx.t < 0 || bx.b > pn.cell.h) return;
          if (boxes.some(function (o) { return M.overlaps(bx, o, 1); }) || valueBoxes.some(function (o) { return M.overlaps(bx, o, 1); })) return;
          valueBoxes.push(bx);
          var vt = svgEl('text', { 'class': 'rd-value', x: qx.toFixed(1), y: (qy + vs * 0.35).toFixed(1), 'text-anchor': anchor, 'font-size': vs, fill: col.ink, 'font-weight': '600', stroke: col.bg, 'stroke-width': 3, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, sg);
          vt.textContent = txt;
        });
      }
    });
    if (gRing) g.appendChild(gRing); // ring values paint above the filled shapes (with their halo) so a fill never hides them
    this.anims.forEach(function (f) { f(1); }); // final geometry first, so a stalled animation still leaves a finished chart
  };

  Renderer.prototype.animateIn = function (s) {
    var self = this, token = ++this.anim, svg = this.svg, fns = this.anims, ms = Math.max(1, s.animMs), t0 = null;
    var ease = s.animEase === 'linear' ? function (t) { return t; } : s.animEase === 'inout' ? function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; } : function (t) { return 1 - Math.pow(1 - t, 3); };
    svg.setAttribute('data-anim', 'running'); svg.classList.add('rd-entering');
    fns.forEach(function (f) { f(0); });
    function frame(now) {
      if (token !== self.anim || svg !== self.svg) return;
      if (t0 === null) t0 = now;
      var t = Math.min(1, (now - t0) / ms), e = ease(t);
      fns.forEach(function (f) { f(e); });
      if (t < 1) global.requestAnimationFrame(frame);
      else { svg.setAttribute('data-anim', 'done'); svg.classList.remove('rd-entering'); }
    }
    global.requestAnimationFrame(frame);
  };

  RD.Renderer = Renderer; RD.prepare = prepare; RD.scaleOf = scaleOf; RD.seriesItems = seriesItems; RD.axisItems = axisItems; RD.layoutRadar = layoutRadar;
})(typeof window !== 'undefined' ? window : globalThis);
