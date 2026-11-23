/* Sketchbook - renderer. Marks, axes and grid are drawn with rough.js; all text
 * is Inter (never a handwriting face). Every shape gets its own seed derived
 * from the user's seed (engine.seedFor), so redraws are identical. Layout is
 * computed before anything is drawn; the only motion is a one-time eased
 * opacity fade-in on the first draw. */
(function (global) {
  'use strict';
  var HX = global.HX, E = global.SB.engine;
  var NS = 'http://www.w3.org/2000/svg';

  function esc (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function sv (tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function Renderer (root) {
    this.root = root;
    this.titleEl = el('div', 'sb-title');
    this.stage = el('div', 'sb-stage');
    this.legendEl = el('div', 'sb-legend');
    this.tip = el('div', 'sb-tip'); this.tip.hidden = true;
    root.appendChild(this.titleEl); root.appendChild(this.stage); root.appendChild(this.legendEl); root.appendChild(this.tip);
    this.animated = false; this.selected = {}; this.chartBg = '#ffffff'; this.ink = '#0a1018';
  }

  Renderer.prototype.theme = function (model, s) {
    var bg;
    if (s.theme === 'light') bg = '#ffffff';
    else if (s.theme === 'paper') bg = '#fbf6e9';
    else if (s.theme === 'dark') bg = '#081f33';
    else if (s.theme === 'custom') bg = s.bgColor;
    else if (model.worksheetBg && HX.parseColor(model.worksheetBg)) bg = HX.hex(HX.parseColor(model.worksheetBg));
    else bg = (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) ? '#081f33' : '#fbf6e9';
    return { bg: bg, ink: HX.pickText(bg), dark: HX.isDark(bg) };
  };
  Renderer.prototype.clearSelection = function () { this.selected = {}; };

  /* Common rough options from the settings. */
  Renderer.prototype._opts = function (seed, extra) {
    var s = this.s, o = { seed: seed, roughness: s.roughness, bowing: s.bowing, strokeWidth: s.strokeWidth };
    for (var k in extra) o[k] = extra[k];
    return o;
  };
  Renderer.prototype._fill = function (color, seed, extra) {
    var s = this.s, th = this.th;
    var o = this._opts(seed, {
      fill: color, fillStyle: s.fillStyle, hachureGap: s.hachureGap, hachureAngle: s.hachureAngle, fillWeight: Math.max(0.6, s.strokeWidth * 0.7),
      stroke: HX.mix(color, th.ink, 0.4), disableMultiStroke: false
    });
    for (var k in extra) o[k] = extra[k];
    return o;
  };

  Renderer.prototype.draw = function (model, s, hooks) {
    var self = this, th = this.theme(model, s);
    this.hooks = hooks || {}; this.model = model; this.s = s; this.th = th; this.chartBg = th.bg; this.ink = th.ink;
    var root = this.root;
    root.style.background = th.bg; root.style.color = th.ink; root.style.fontSize = s.fontSize + 'px';
    root.setAttribute('data-theme', th.dark ? 'dark' : 'light');
    root.setAttribute('data-ready', '0');
    this.tip.hidden = true; this.tip.style.background = th.ink; this.tip.style.color = th.bg;
    root.classList.remove('sb-hovering');

    var rows = model.rows || [];
    var agg = E.aggregate(rows, s.sort);
    this.agg = agg;
    var ns = agg.series.length, hasSeries = model.hasSeries && ns >= 1;
    var colorOf = function (si) { return hasSeries ? E.seriesColor(s.palette, si) : s.color; };
    this.colorOf = colorOf;

    this._title(s, th);
    this._legend(agg, s, th, hasSeries, colorOf);

    if (!rows.length) {
      this.stage.innerHTML = '<div class="sb-empty">' + esc(model.emptyMessage || 'Put a dimension on Category and a measure on Value.') + '</div>';
      root.setAttribute('data-ready', '1'); root.setAttribute('data-marks', '0');
      return;
    }
    var W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (W < 20 || H < 20) return;
    var fs = s.fontSize;

    var showAxes = s.axes, showTitles = s.axes && s.axisTitles && W >= 420 && H >= 320;
    var dom = E.valueDomain(agg, s.chartType, s.zero, Math.max(2, Math.floor(H / (fs * 3.4))));
    var yt = []; for (var v = dom.lo, i = 0; v <= dom.hi + dom.step * 1e-6 && i < 60; v += dom.step, i++) yt.push(Math.round(v / dom.step) * dom.step);
    var yLabW = 0; yt.forEach(function (t) { yLabW = Math.max(yLabW, HX.formatNumber(t, dom.step).length); });
    var leftM = 12 + (showAxes ? Math.ceil(yLabW * fs * 0.64) + 12 : 0) + (showTitles ? Math.round(fs * 1.5) : 0);
    var bottomM = 10 + (showAxes ? Math.round(fs * 1.5) + 8 : 0) + (showTitles ? Math.round(fs * 1.6) : 0);
    var topM = 10 + (s.labels !== 'none' ? Math.round(fs * 1.4) : Math.ceil(fs * 0.5));
    var rightM = 16;
    var plot = { x: leftM, y: topM, w: Math.max(40, W - leftM - rightM), h: Math.max(40, H - topM - bottomM) };
    this.plot = plot; this.dom = dom;

    var lay = E.marks(agg, plot, dom, s);
    this.lay = lay;

    var svg = sv('svg', { 'class': 'sb-svg', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Hand-drawn ' + s.chartType + ' chart of ' + model.valueName + ' by ' + model.catName });
    var rc = global.rough.svg(svg);
    var gridCol = HX.mix(th.bg, th.ink, 0.22), axisCol = HX.mix(th.bg, th.ink, 0.8);

    /* grid */
    if (s.grid) {
      var gGrid = sv('g', { 'class': 'sb-grid' });
      yt.forEach(function (t, k) {
        if (Math.abs(t) < dom.step * 1e-6 && showAxes) return;
        var y = lay.sy(t);
        gGrid.appendChild(rc.line(plot.x, y, plot.x + plot.w, y, { stroke: gridCol, strokeWidth: 1, roughness: Math.min(s.roughness, 1) * 0.7, bowing: 0.6, seed: E.seedFor(s.seed, k, 0, 9) }));
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
      if (s.chartType === 'bar') {
        if (m.h >= 0.5) g.appendChild(rc.rectangle(m.x, m.top, m.w, m.h, self._fill(color, seed)));
        g.appendChild(sv('rect', { 'class': 'sb-hit', x: m.x, y: m.top - 2, width: m.w, height: m.h + 4, fill: 'transparent' }));
      } else if (s.chartType === 'dot') {
        if (s.stems) g.appendChild(rc.line(m.cx, m.baseY, m.cx, m.y, self._opts(E.seedFor(s.seed, m.ci, m.si, 2), { stroke: HX.mix(color, th.ink, 0.25), strokeWidth: Math.max(1, s.strokeWidth * 0.8) })));
        g.appendChild(rc.circle(m.cx, m.y, m.d, self._fill(color, seed, { hachureGap: Math.max(2, s.hachureGap * 0.55) })));
        g.appendChild(sv('circle', { 'class': 'sb-hit', cx: m.cx, cy: m.y, r: Math.max(12, m.d / 2 + 3), fill: 'transparent' }));
      } else {
        (lineByS[m.si] = lineByS[m.si] || []).push(m);
        if (s.lineDots || agg.cats.length === 1) g.appendChild(rc.circle(m.cx, m.y, Math.max(8, s.lineWidth * 3.4), self._opts(seed, { fill: color, fillStyle: 'solid', stroke: HX.mix(color, th.ink, 0.4), strokeWidth: 1 })));
        g.appendChild(sv('circle', { 'class': 'sb-hit', cx: m.cx, cy: m.y, r: 13, fill: 'transparent' }));
      }
      m.node = g;
    });
    if (s.chartType === 'line') {
      Object.keys(lineByS).forEach(function (si) {
        var pts = lineByS[si].map(function (m) { return [m.cx, m.y]; });
        if (pts.length < 2) return;
        var lg = sv('g', { 'class': 'sb-path', 'pointer-events': 'none' });
        if (anySel) lg.setAttribute('opacity', '0.55');
        lg.appendChild(rc.linearPath(pts, self._opts(E.seedFor(s.seed, 0, +si, 3), { stroke: colorOf(+si), strokeWidth: s.lineWidth })));
        gM.appendChild(lg);
      });
    }
    lay.marks.forEach(function (m) { gM.appendChild(m.node); });
    svg.appendChild(gM);

    /* text */
    var gT = sv('g', { 'class': 'sb-text' });
    var tcommon = { fill: th.ink, 'font-size': fs };
    if (showAxes) {
      yt.forEach(function (t) { gT.appendChild(sv('text', Object.assign({ 'class': 'sb-tick sb-ytick', x: plot.x - 9, y: (lay.sy(t) + fs * 0.35).toFixed(1), 'text-anchor': 'end' }, tcommon), HX.formatNumber(t, dom.step))); });
      var maxChars = Math.max(3, Math.floor(lay.step / (fs * 0.58)));
      agg.cats.forEach(function (c, ci) {
        var tx = sv('text', Object.assign({ 'class': 'sb-tick sb-xtick', x: (plot.x + lay.step * (ci + 0.5)).toFixed(1), y: plot.y + plot.h + fs + 8, 'text-anchor': 'middle' }, tcommon), E.truncate(c.key, Math.min(16, Math.max(maxChars, 8))));
        tx.appendChild(sv('title', {}, c.key));
        gT.appendChild(tx);
      });
    }
    if (s.labels !== 'none') {
      lay.marks.forEach(function (m) {
        var txt = s.labels === 'value' ? HX.formatNumber(m.value, dom.step) : (m.cell.label || '');
        if (!txt) return;
        var above = m.value >= 0 || s.chartType !== 'bar';
        var yy = s.chartType === 'bar' ? (above ? m.top - 6 : m.top + m.h + fs + 2) : (m.y - (m.d ? m.d / 2 : 8) - 6);
        gT.appendChild(sv('text', Object.assign({ 'class': 'sb-vlabel', x: m.cx.toFixed(1), y: yy.toFixed(1), 'text-anchor': 'middle', 'font-weight': 600 }, tcommon), E.truncate(txt, 14)));
      });
    }
    if (showTitles) {
      gT.appendChild(sv('text', Object.assign({ 'class': 'sb-axtitle', x: (plot.x + plot.w / 2).toFixed(1), y: H - 6, 'text-anchor': 'middle', 'font-weight': 600 }, tcommon), model.catName));
      gT.appendChild(sv('text', Object.assign({ 'class': 'sb-axtitle', transform: 'translate(' + (fs + 2) + ',' + (plot.y + plot.h / 2).toFixed(1) + ') rotate(-90)', 'text-anchor': 'middle', 'font-weight': 600 }, tcommon), model.valueName));
    }
    svg.appendChild(gT);

    this.stage.innerHTML = '';
    this.stage.appendChild(svg);
    this.svg = svg;

    var order = [].slice.call(svg.querySelectorAll('.sb-axtitle'))
      .concat([].slice.call(svg.querySelectorAll('.sb-ytick')), [].slice.call(svg.querySelectorAll('.sb-xtick')), [].slice.call(svg.querySelectorAll('.sb-vlabel')));
    this.thinned = HX.thin(order, 6);

    var anim = !this.animated && !global.SB_STILL && !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    root.classList.toggle('sb-anim', anim);
    if (anim) [].forEach.call(svg.querySelectorAll('.sb-mark, .sb-path'), function (g, k) { g.style.animationDelay = (Math.min(k, 24) * 30) + 'ms'; });
    this.animated = true;
    this._wire();
    root.setAttribute('data-marks', String(lay.marks.length));
    root.setAttribute('data-cats', String(agg.cats.length));
    root.setAttribute('data-series', String(ns));
    root.setAttribute('data-ready', '1');
  };

  Renderer.prototype._title = function (s, th) {
    var t = this.titleEl;
    t.innerHTML = '';
    t.style.display = s.title ? '' : 'none';
    if (!s.title) return;
    t.style.fontSize = Math.round(s.fontSize * 1.35) + 'px';
    var wrap = el('div', 'sb-title-wrap'), span = el('span', 'sb-title-text', s.title);
    wrap.appendChild(span); t.appendChild(wrap);
    if (s.underline) {
      var w = Math.max(20, Math.ceil(span.getBoundingClientRect().width));
      var u = sv('svg', { 'class': 'sb-ul', width: w, height: 12, viewBox: '0 0 ' + w + ' 12', 'aria-hidden': 'true' });
      u.appendChild(global.rough.svg(u).line(1, 6, w - 1, 6, { stroke: th.ink, strokeWidth: 2.4, roughness: 1.8, bowing: 2.5, seed: E.seedFor(s.seed, 0, 0, 5) }));
      wrap.appendChild(u);
    }
  };

  Renderer.prototype._legend = function (agg, s, th, hasSeries, colorOf) {
    var L = this.legendEl, self = this;
    L.innerHTML = '';
    L.style.display = (s.legend && hasSeries) ? '' : 'none';
    if (!s.legend || !hasSeries) return;
    agg.series.forEach(function (sr, si) {
      var chip = el('span', 'sb-chip');
      var u = sv('svg', { width: 20, height: 20, viewBox: '0 0 20 20', 'aria-hidden': 'true' });
      var rc = global.rough.svg(u);
      u.appendChild(rc.rectangle(2, 2, 16, 16, self._fill(colorOf(si), E.seedFor(s.seed, si, 0, 6), { hachureGap: 4, roughness: Math.min(s.roughness, 1.5), strokeWidth: 1.2, fillWeight: 1 })));
      chip.appendChild(u); chip.appendChild(document.createTextNode(sr.key));
      L.appendChild(chip);
    });
  };

  Renderer.prototype._place = function (evt, html) {
    var t = this.tip, r = this.root.getBoundingClientRect();
    t.innerHTML = html; t.hidden = false;
    var x = evt.clientX - r.left + 14, y = evt.clientY - r.top + 14;
    if (x + t.offsetWidth > r.width - 4) x = evt.clientX - r.left - t.offsetWidth - 14;
    if (y + t.offsetHeight > r.height - 4) y = evt.clientY - r.top - t.offsetHeight - 14;
    t.style.left = Math.max(4, x) + 'px'; t.style.top = Math.max(4, y) + 'px';
  };

  Renderer.prototype._wire = function () {
    var self = this, svg = this.svg, s = this.s, model = this.model, agg = this.agg, root = this.root;
    var cur = null;
    function markOf (t) {
      if (!t.classList || !t.classList.contains('sb-hit')) return null;
      return t.parentNode;
    }
    function leave () {
      if (cur) cur.classList.remove('sb-hot');
      cur = null; root.classList.remove('sb-hovering'); self.tip.hidden = true;
      if (self.hooks.onHover) self.hooks.onHover(null);
    }
    svg.addEventListener('mousemove', function (e) {
      var g = markOf(e.target);
      if (!g) { if (cur) leave(); return; }
      if (g !== cur) { if (cur) cur.classList.remove('sb-hot'); cur = g; g.classList.add('sb-hot'); root.classList.add('sb-hovering'); }
      var c = agg.cats[+g.getAttribute('data-ci')], sr = agg.series[+g.getAttribute('data-si')], cell = agg.cell(c, sr);
      self._place(e, '<b>' + esc(c.key) + '</b>' + (model.hasSeries ? '<br>' + esc(sr.key) : '') + '<br>' + esc(model.valueName) + ': ' + esc(HX.formatNumber(cell.value, 0.01)) + (cell.label ? '<br>' + esc(cell.label) : ''));
      if (s.hoverEnabled && self.hooks.onHover) self.hooks.onHover(cell.ids[0]);
    });
    svg.addEventListener('mouseleave', leave);
    svg.addEventListener('click', function (e) {
      if (!s.selectEnabled) return;
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
