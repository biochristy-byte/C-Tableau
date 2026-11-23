/* Sketchbook - renderer. Marks, axes and grid are drawn with rough.js; all text
 * is Inter (never a handwriting face). Every shape gets its own seed derived
 * from the user's seed (engine.seedFor), so redraws are identical. Layout is
 * computed before anything is drawn; the only motion is a one-time eased
 * opacity fade-in on the first draw. */
(function (global) {
  'use strict';
  var HX = global.HX, E = global.SB.engine, CP = global.CTabPanel;
  var NS = 'http://www.w3.org/2000/svg';
  var EASE = { out: 'cubic-bezier(.22,.61,.36,1)', inout: 'cubic-bezier(.65,0,.35,1)', linear: 'linear' };

  function esc (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function sv (tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function num (v) { var n = parseFloat(v); return isFinite(n) ? n : null; }

  function Renderer (root) {
    this.root = root;                                   /* the frame: data-* attributes, and the settings panel lives here */
    this.chart = el('div', 'sb-chart'); root.appendChild(this.chart);
    this.titleEl = el('div', 'sb-title');
    this.stage = el('div', 'sb-stage');
    this.legendEl = el('div', 'sb-legend');
    this.tip = el('div', 'sb-tip'); this.tip.hidden = true;
    var c = this.chart;
    c.appendChild(this.titleEl); c.appendChild(this.stage); c.appendChild(this.legendEl); c.appendChild(this.tip);
    this.animated = false; this.selected = {}; this.chartBg = '#ffffff'; this.ink = '#0a1018';
  }

  Renderer.prototype.theme = function (model, s) {
    var ws;
    if (model.worksheetBg && HX.parseColor(model.worksheetBg)) ws = HX.hex(HX.parseColor(model.worksheetBg));
    else ws = (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) ? '#081f33' : '#fbf6e9';
    var bg = s.bgMode === 'custom' ? s.bgColor : ws;
    return { bg: bg, ink: HX.pickText(bg), dark: HX.isDark(bg), transparent: s.bgMode === 'transparent' };
  };
  Renderer.prototype.clearSelection = function () { this.selected = {}; };

  /* The series that draw, in the user's order, with their shown name and color. Hidden ones are dropped. */
  Renderer.prototype.resolveSeries = function (model, s) {
    var seen = {}, keys = [];
    (model.rows || []).forEach(function (r) { if (!seen[r.series]) { seen[r.series] = 1; keys.push(r.series); } });
    var pal = s.greys ? E.PALETTES.ink : CP.paletteColors(s.palette, s.paletteReverse);
    var items = keys.map(function (k, i) { return { key: k, name: k, color: pal[i % pal.length] }; });
    var out = {}, order = [];
    CP.mergeList(s.catColors, items).forEach(function (m) { if (!m.hidden) { out[m.key] = { name: m.name, color: m.color }; order.push(m.key); } });
    return { map: out, order: order };
  };

  /* Number text. At the number-format defaults this is the original text, so an old workbook looks the same. */
  Renderer.prototype.tick = function (v, step) {
    var s = this.s;
    if (!(s.numCompact || s.numPrefix || s.numSuffix || s.numScale !== '1' || s.numThousands !== 'comma')) return HX.formatNumber(v, step);
    var dec = step && step > 0 ? Math.max(0, Math.min(6, -Math.floor(Math.log(step) / Math.LN10 + 1e-9))) : 0;
    return CP.formatNumber(v, Object.assign({}, s, { numDecimals: dec }));
  };
  Renderer.prototype.fmt = function (v, step) {
    var s = this.s;
    if (!(s.numCompact || s.numPrefix || s.numSuffix || s.numScale !== '1' || s.numThousands !== 'comma' || s.numDecimals !== 2)) return HX.formatNumber(v, step);
    return CP.formatNumber(v, s);
  };

  function wrapLines (text, per, maxLines) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      while (w.length > per) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, per)); w = w.slice(per); }
      if (!cur) cur = w; else if ((cur + ' ' + w).length <= per) cur += ' ' + w; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); var l = lines[maxLines - 1]; lines[maxLines - 1] = (l.length > per - 1 ? l.slice(0, per - 1) : l) + '…'; }
    return lines;
  }

  /* Common rough options from the settings. */
  Renderer.prototype._opts = function (seed, extra) {
    var s = this.s, o = { seed: seed, roughness: s.roughness, bowing: s.bowing, strokeWidth: s.strokeWidth, disableMultiStroke: !s.doubleStroke };
    for (var k in extra) o[k] = extra[k];
    return o;
  };
  Renderer.prototype._fill = function (color, seed, extra) {
    var s = this.s, th = this.th;
    var o = this._opts(seed, {
      fill: color, fillStyle: s.fillStyle, hachureGap: s.hachureGap, hachureAngle: s.hachureAngle, fillWeight: s.hatchWeight > 0 ? s.hatchWeight : Math.max(0.6, s.strokeWidth * 0.7),
      stroke: HX.mix(color, th.ink, s.outlineMix / 100)
    });
    for (var k in extra) o[k] = extra[k];
    return o;
  };

  Renderer.prototype.draw = function (model, s, hooks) {
    var self = this, th = this.theme(model, s);
    this.hooks = hooks || {}; this.model = model; this.s = s; this.th = th; this.chartBg = th.bg; this.ink = th.ink;
    var root = this.root, chart = this.chart;
    var lc = s.labelColor ? CP.color.ensureContrast(s.labelColor, [th.bg], 7) : th.ink;
    root.style.background = th.transparent ? 'transparent' : th.bg;
    root.setAttribute('data-theme', th.dark ? 'dark' : 'light');
    root.setAttribute('data-ready', '0');
    chart.style.background = th.transparent ? 'transparent' : th.bg; chart.style.color = th.ink;
    chart.style.fontSize = s.labelSize + 'px';
    chart.style.fontFamily = CP.fontStack(s.fontFamily);
    chart.style.padding = s.padding + 'px';
    chart.style.border = s.borderOn ? s.borderWidth + 'px solid ' + s.borderColor : '0';
    chart.style.borderRadius = s.borderOn ? s.borderRadius + 'px' : '0';
    var animOn = s.animOn !== false;
    chart.style.setProperty('--sb-ms', (animOn ? s.animMs : 0) + 'ms');
    chart.style.setProperty('--sb-ease', EASE[s.animEase] || EASE.out);
    chart.style.setProperty('--sb-hover-ms', s.hoverMs + 'ms');
    chart.style.setProperty('--sb-dim', String(s.dimOthers / 100));
    this.tip.hidden = true; this.tip.style.background = th.ink; this.tip.style.color = th.bg;
    this.tip.style.fontSize = s.tipSize + 'px'; this.tip.style.maxWidth = s.tipMaxW + 'px'; this.tip.setAttribute('data-follow', s.tipFollow);
    chart.classList.remove('sb-hovering');

    var sers = this.resolveSeries(model, s);
    var rows = (model.rows || []).filter(function (r) { return !!sers.map[r.series]; });
    var agg = E.aggregate(rows, s.sort);
    if (s.maxCats > 0 && agg.cats.length > s.maxCats) agg.cats = agg.cats.slice(0, s.maxCats);
    /* the user's series order */
    if (sers.order.length) agg.series.sort(function (a, b) { return sers.order.indexOf(a.key) - sers.order.indexOf(b.key); });
    this.agg = agg;
    var ns = agg.series.length, hasSeries = model.hasSeries && ns >= 1;
    var colorOf = function (si) { return hasSeries ? sers.map[agg.series[si].key].color : s.color; };
    var nameOf = function (si) { return sers.map[agg.series[si].key].name; };
    this.colorOf = colorOf; this.nameOf = nameOf;

    this._title(s, th);
    this._legend(agg, s, th, hasSeries, colorOf, nameOf);

    if (!rows.length) {
      this.stage.innerHTML = '<div class="sb-empty">' + esc(model.emptyMessage || 'Put a dimension on Category and a measure on Value.') + '</div>';
      root.setAttribute('data-ready', '1'); root.setAttribute('data-marks', '0');
      return;
    }
    var W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (W < 20 || H < 20) return;
    var fs = s.labelSize, labels = s.labelsOn, lw = s.labelWeight === 'bold' ? 700 : 400;
    var markLabels = labels && s.valueLabels;

    var showAxes = s.axes, showTicks = s.axes && labels, showTitles = s.axes && labels && s.axisTitles && W >= 420 && H >= 320;
    var dom = E.valueDomain(agg, s.chartType, s.zero, Math.max(2, Math.floor(H / (fs * 3.4) * s.tickDensity / 100)), num(s.valueMin), num(s.valueMax));
    var yt = []; for (var v = dom.lo, i = 0; v <= dom.hi + dom.step * 1e-6 && i < 80; v += dom.step, i++) yt.push(Math.round(v / dom.step) * dom.step);
    var yLabW = 0; if (showTicks) yt.forEach(function (t) { yLabW = Math.max(yLabW, self.tick(t, dom.step).length); });
    /* category labels: cut with an ellipsis (one line), or wrapped onto up to labelLines lines */
    var stepW = (W - 12) / Math.max(1, agg.cats.length), xLines = [], maxXL = 1;
    if (showTicks) agg.cats.forEach(function (c) {
      var per = Math.max(3, Math.floor(stepW / (fs * 0.58)));
      var L = s.labelLines > 1 ? wrapLines(c.key, Math.min(Math.max(per, 6), s.catLabelMax * 2), s.labelLines) : [E.truncate(c.key, Math.min(s.catLabelMax, Math.max(per, 8)))];
      xLines.push(L); maxXL = Math.max(maxXL, L.length);
    });
    var leftM = 12 + (showTicks ? Math.ceil(yLabW * fs * 0.64) + 12 : 0) + (showTitles ? Math.round(fs * 1.5) : 0);
    var bottomM = 10 + (showTicks ? Math.round(fs * 1.5) + 8 + (maxXL - 1) * Math.round(fs * 1.2) : 0) + (showTitles ? Math.round(fs * 1.6) : 0);
    var topM = 10 + (markLabels ? Math.round(fs * 1.4) : Math.ceil(fs * 0.5));
    var rightM = 16;
    var plot = { x: leftM, y: topM, w: Math.max(40, W - leftM - rightM), h: Math.max(40, H - topM - bottomM) };
    this.plot = plot; this.dom = dom;

    var lay = E.marks(agg, plot, dom, s);
    this.lay = lay;

    var svg = sv('svg', { 'class': 'sb-svg', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Hand-drawn ' + s.chartType + ' chart of ' + model.valueName + ' by ' + model.catName });
    var rc = global.rough.svg(svg);
    var gridCol = s.gridColor || HX.mix(th.bg, th.ink, 0.22), axisCol = s.axisColor || HX.mix(th.bg, th.ink, 0.8);

    /* grid */
    if (s.grid) {
      var gGrid = sv('g', { 'class': 'sb-grid' });
      yt.forEach(function (t, k) {
        if (Math.abs(t) < dom.step * 1e-6 && showAxes) return;
        var y = lay.sy(t);
        var go = { stroke: gridCol, strokeWidth: s.gridWidth, roughness: Math.min(s.roughness, 1) * 0.7, bowing: 0.6, seed: E.seedFor(s.seed, k, 0, 9) };
        if (s.gridDash === 'dashed') go.strokeLineDash = [6, 5];
        gGrid.appendChild(rc.line(plot.x, y, plot.x + plot.w, y, go));
      });
      svg.appendChild(gGrid);
    }
    /* axes */
    var gAx = sv('g', { 'class': 'sb-axes' });
    var ax = { stroke: axisCol, strokeWidth: Math.max(1.2, s.strokeWidth * 0.8), roughness: Math.min(s.roughness, 1.5) * 0.8, bowing: 0.8 };
    gAx.appendChild(rc.line(plot.x, plot.y, plot.x, plot.y + plot.h, Object.assign({ seed: E.seedFor(s.seed, 0, 0, 7) }, ax)));
    gAx.appendChild(rc.line(plot.x, lay.zeroY, plot.x + plot.w, lay.zeroY, Object.assign({ seed: E.seedFor(s.seed, 0, 0, 8) }, ax)));
    svg.appendChild(gAx);

    /* marks */
    var gM = sv('g', { 'class': 'sb-marks' });
    var anySel = Object.keys(this.selected).length > 0;
    var isSel = function (cell) { return cell.ids.some(function (id) { return self.selected[id]; }); };
    var lineByS = {};
    lay.marks.forEach(function (m) {
      var color = colorOf(m.si), seed = E.seedFor(s.seed, m.ci, m.si, 1);
      var g = sv('g', { 'class': 'sb-mark', 'data-ci': m.ci, 'data-si': m.si });
      if (anySel && !isSel(m.cell)) g.setAttribute('opacity', '0.3');
      else if (s.markOpacity < 100) g.setAttribute('opacity', String(s.markOpacity / 100));
      if (s.chartType === 'bar') {
        if (m.h >= 0.5) g.appendChild(rc.rectangle(m.x, m.top, m.w, m.h, self._fill(color, seed)));
        g.appendChild(sv('rect', { 'class': 'sb-hit', x: m.x, y: m.top - 2, width: m.w, height: m.h + 4, fill: 'transparent' }));
      } else if (s.chartType === 'dot') {
        if (s.stems) g.appendChild(rc.line(m.cx, m.baseY, m.cx, m.y, self._opts(E.seedFor(s.seed, m.ci, m.si, 2), { stroke: HX.mix(color, th.ink, 0.25), strokeWidth: Math.max(1, s.strokeWidth * 0.8) })));
        var fo = self._fill(color, seed, { hachureGap: Math.max(2, s.hachureGap * 0.55) });
        if (s.dotShape === 'square') g.appendChild(rc.rectangle(m.cx - m.d / 2, m.y - m.d / 2, m.d, m.d, fo));
        else if (s.dotShape === 'diamond') g.appendChild(rc.polygon([[m.cx, m.y - m.d * 0.64], [m.cx + m.d * 0.64, m.y], [m.cx, m.y + m.d * 0.64], [m.cx - m.d * 0.64, m.y]], fo));
        else g.appendChild(rc.circle(m.cx, m.y, m.d, fo));
        g.appendChild(sv('circle', { 'class': 'sb-hit', cx: m.cx, cy: m.y, r: Math.max(12, m.d / 2 + 3), fill: 'transparent' }));
      } else {
        (lineByS[m.si] = lineByS[m.si] || []).push(m);
        if (s.lineDots || agg.cats.length === 1) g.appendChild(rc.circle(m.cx, m.y, Math.max(8, s.lineWidth * 3.4), self._opts(seed, { fill: color, fillStyle: 'solid', stroke: HX.mix(color, th.ink, s.outlineMix / 100), strokeWidth: 1 })));
        g.appendChild(sv('circle', { 'class': 'sb-hit', cx: m.cx, cy: m.y, r: 13, fill: 'transparent' }));
      }
      m.node = g;
    });
    if (s.chartType === 'line') {
      Object.keys(lineByS).forEach(function (si) {
        var pts = lineByS[si].map(function (m) { return [m.cx, m.y]; });
        if (pts.length < 2) return;
        var lg = sv('g', { 'class': 'sb-path', 'pointer-events': 'none' });
        if (anySel) lg.setAttribute('opacity', '0.55'); else if (s.markOpacity < 100) lg.setAttribute('opacity', String(s.markOpacity / 100));
        lg.appendChild(rc.linearPath(pts, self._opts(E.seedFor(s.seed, 0, +si, 3), { stroke: colorOf(+si), strokeWidth: s.lineWidth })));
        gM.appendChild(lg);
      });
    }
    lay.marks.forEach(function (m) { gM.appendChild(m.node); });
    svg.appendChild(gM);

    /* text */
    var gT = sv('g', { 'class': 'sb-text' });
    var tcommon = { fill: lc, 'font-size': fs };
    if (showTicks) {
      yt.forEach(function (t) { gT.appendChild(sv('text', Object.assign({ 'class': 'sb-tick sb-ytick', x: plot.x - 9, y: (lay.sy(t) + fs * 0.35).toFixed(1), 'text-anchor': 'end', 'font-weight': lw }, tcommon), self.tick(t, dom.step))); });
      agg.cats.forEach(function (c, ci) {
        var tx = sv('text', Object.assign({ 'class': 'sb-tick sb-xtick', x: (plot.x + lay.step * (ci + 0.5)).toFixed(1), y: plot.y + plot.h + fs + 8, 'text-anchor': 'middle', 'font-weight': lw }, tcommon));
        xLines[ci].forEach(function (ln, li) { tx.appendChild(sv('tspan', { x: (plot.x + lay.step * (ci + 0.5)).toFixed(1), dy: li ? Math.round(fs * 1.2) : 0 }, ln)); });
        tx.appendChild(sv('title', {}, c.key));
        gT.appendChild(tx);
      });
    }
    if (markLabels) {
      lay.marks.forEach(function (m) {
        var txt = s.labels === 'value' ? self.fmt(m.value, dom.step) : (m.cell.label || '');
        if (!txt) return;
        var above = m.value >= 0 || s.chartType !== 'bar';
        var yy = s.chartType === 'bar' ? (above ? m.top - s.labelGap : m.top + m.h + fs + 2) : (m.y - (m.d ? m.d / 2 : 8) - s.labelGap);
        gT.appendChild(sv('text', Object.assign({ 'class': 'sb-vlabel', x: m.cx.toFixed(1), y: yy.toFixed(1), 'text-anchor': 'middle', 'font-weight': 600 }, tcommon, { 'font-size': s.valueLabelSize }), E.truncate(txt, 14)));
      });
    }
    if (showTitles) {
      gT.appendChild(sv('text', Object.assign({ 'class': 'sb-axtitle', x: (plot.x + plot.w / 2).toFixed(1), y: H - 6, 'text-anchor': 'middle', 'font-weight': 600 }, tcommon), s.xTitle || model.catName));
      gT.appendChild(sv('text', Object.assign({ 'class': 'sb-axtitle', transform: 'translate(' + (fs + 2) + ',' + (plot.y + plot.h / 2).toFixed(1) + ') rotate(-90)', 'text-anchor': 'middle', 'font-weight': 600 }, tcommon), s.yTitle || model.valueName));
    }
    svg.appendChild(gT);

    this.stage.innerHTML = '';
    this.stage.appendChild(svg);
    this.svg = svg;

    var order = [].slice.call(svg.querySelectorAll('.sb-axtitle'))
      .concat([].slice.call(svg.querySelectorAll('.sb-ytick')), [].slice.call(svg.querySelectorAll('.sb-xtick')), [].slice.call(svg.querySelectorAll('.sb-vlabel')));
    this.thinned = HX.thin(order, 6);

    var anim = animOn && !this.animated && !global.SB_STILL && !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    chart.classList.toggle('sb-anim', anim);
    if (anim) [].forEach.call(svg.querySelectorAll('.sb-mark, .sb-path'), function (g, k) { g.style.animationDelay = (Math.min(k, 24) * 30) + 'ms'; });
    this.animated = true;
    this._wire();
    root.setAttribute('data-marks', String(lay.marks.length));
    root.setAttribute('data-cats', String(agg.cats.length));
    root.setAttribute('data-series', String(ns));
    root.setAttribute('data-ready', '1');
  };

  Renderer.prototype._title = function (s, th) {
    var t = this.titleEl, text = s.showTitle ? s.titleText : '';
    t.innerHTML = '';
    t.style.display = text ? '' : 'none';
    t.style.fontSize = s.titleSize + 'px'; t.style.fontWeight = s.titleWeight === 'bold' ? '700' : '400';
    if (!text) return;
    var wrap = el('div', 'sb-title-wrap'), span = el('span', 'sb-title-text', text);
    wrap.appendChild(span); t.appendChild(wrap);
    if (s.underline) {
      var w = Math.max(20, Math.ceil(span.getBoundingClientRect().width));
      var u = sv('svg', { 'class': 'sb-ul', width: w, height: 12, viewBox: '0 0 ' + w + ' 12', 'aria-hidden': 'true' });
      u.appendChild(global.rough.svg(u).line(1, 6, w - 1, 6, { stroke: s.underlineColor || th.ink, strokeWidth: s.underlineWeight, roughness: s.underlineRough, bowing: 2.5, seed: E.seedFor(s.seed, 0, 0, 5) }));
      wrap.appendChild(u);
    }
  };

  Renderer.prototype._legend = function (agg, s, th, hasSeries, colorOf, nameOf) {
    var L = this.legendEl, self = this;
    L.innerHTML = '';
    L.style.order = s.legendPos === 'top' ? '-1' : '0';
    L.style.display = (s.legend && hasSeries) ? '' : 'none';
    if (!s.legend || !hasSeries) return;
    if (s.legendTitle) { var lt = el('span', 'sb-lg-t', s.legendTitle); L.appendChild(lt); }
    var sz = s.legendSwatch;
    agg.series.forEach(function (sr, si) {
      var chip = el('span', 'sb-chip');
      var u = sv('svg', { width: sz, height: sz, viewBox: '0 0 ' + sz + ' ' + sz, 'aria-hidden': 'true' });
      var rc = global.rough.svg(u);
      u.appendChild(rc.rectangle(2, 2, sz - 4, sz - 4, self._fill(colorOf(si), E.seedFor(s.seed, si, 0, 6), { hachureGap: 4, roughness: Math.min(s.roughness, 1.5), strokeWidth: 1.2, fillWeight: 1 })));
      chip.appendChild(u); chip.appendChild(document.createTextNode(nameOf(si)));
      L.appendChild(chip);
    });
  };

  Renderer.prototype._place = function (evt, html) {
    var s = this.s;
    if (!s.tipOn) return;
    var t = this.tip, r = this.chart.getBoundingClientRect();
    t.innerHTML = html; t.hidden = false;
    var x, y;
    if (s.tipFollow === 'corner') { x = r.width - t.offsetWidth - 8; y = 8; }
    else {
      x = evt.clientX - r.left + 14; y = evt.clientY - r.top + 14;
      if (x + t.offsetWidth > r.width - 4) x = evt.clientX - r.left - t.offsetWidth - 14;
      if (y + t.offsetHeight > r.height - 4) y = evt.clientY - r.top - t.offsetHeight - 14;
    }
    t.style.left = Math.max(4, x) + 'px'; t.style.top = Math.max(4, y) + 'px';
  };

  Renderer.prototype._wire = function () {
    var self = this, svg = this.svg, s = this.s, model = this.model, agg = this.agg, chart = this.chart;
    var cur = null;
    function markOf (t) {
      if (!t.classList || !t.classList.contains('sb-hit')) return null;
      return t.parentNode;
    }
    function leave () {
      if (cur) cur.classList.remove('sb-hot');
      cur = null; chart.classList.remove('sb-hovering'); self.tip.hidden = true;
      if (self.hooks.onHover) self.hooks.onHover(null);
    }
    svg.addEventListener('mousemove', function (e) {
      var g = markOf(e.target);
      if (!g) { if (cur) leave(); return; }
      if (g !== cur) { if (cur) cur.classList.remove('sb-hot'); cur = g; if (s.hoverOn) { g.classList.add('sb-hot'); chart.classList.add('sb-hovering'); } }
      var si = +g.getAttribute('data-si'), c = agg.cats[+g.getAttribute('data-ci')], sr = agg.series[si], cell = agg.cell(c, sr);
      var sw = s.tipSwatch && model.hasSeries ? '<i class="sb-sw" style="background:' + self.colorOf(si) + '"></i>' : '';
      self._place(e, '<b>' + esc(c.key) + '</b>' + (model.hasSeries ? '<br>' + sw + esc(self.nameOf(si)) : '') + '<br>' + esc(model.valueName) + ': ' + esc(self.fmt(cell.value, 0.01)) + (cell.label ? '<br>' + esc(cell.label) : ''));
      if (self.hooks.onHover) self.hooks.onHover(cell.ids[0]);
    });
    svg.addEventListener('mouseleave', leave);
    svg.addEventListener('click', function (e) {
      if (!s.selectOn) return;
      var g = markOf(e.target), ids = [];
      if (g) ids = agg.cell(agg.cats[+g.getAttribute('data-ci')], agg.series[+g.getAttribute('data-si')]).ids;
      var same = ids.length && ids.every(function (i) { return self.selected[i]; }) && Object.keys(self.selected).length === ids.length;
      self.selected = {};
      if (!same) ids.forEach(function (i) { self.selected[i] = true; });
      if (self.hooks.onSelect) self.hooks.onSelect(same ? [] : ids);
      self.draw(self.model, self.s, self.hooks);
    });
  };

  global.SB.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
