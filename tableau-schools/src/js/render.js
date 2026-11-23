/* Schools - renderer. SVG circles in one group per cluster, chip labels, legend, tooltip.
 *
 * Motion rules: the force layout is settled completely off-screen and only then drawn. It runs
 * as a resumable job (layout.js layoutJob), a slice per animation frame (SLICE_STILL ms while the
 * picture stands still, SLICE_MOVING ms while an earlier morph is still running), so no frame ever
 * carries the whole layout: the old picture stays still and responsive meanwhile. When the targets
 * are ready they are committed to the DOM on a frame of their own, and only then does the eased
 * morph start, so every morph frame does interpolation only. Labels are hidden while it moves and
 * planned once when it settles.
 */
(function (global) {
  'use strict';
  var SC = global.SC, C = SC.colors, L = SC.layout, CP = global.CTabPanel;
  var SVGNS = 'http://www.w3.org/2000/svg';
  // ms of layout work per frame: 11 keeps a still picture at 60 fps, 5 leaves room for a morph already running, 30 when nothing is on screen yet.
  // One force tick on 2,000 circles is about 22 ms, and a slice stops before the next unit would cross its budget.
  // a shortened item label keeps at least this many letters before the ellipsis; a shorter stub ("Ir…") names nothing,
  // so that circle goes unlabeled and its tooltip carries the name
  var MIN_STUB = 4;
  var SLICE_STILL = 11, SLICE_MOVING = 5, SLICE_EMPTY = 30;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function sv(tag, attrs) { var n = document.createElementNS(SVGNS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }
  var INK_DARK = '#10202b', INK_LIGHT = '#f3f5f7';

  function resolveTheme(s, worksheetBg) {
    var bg, clear = s.theme === 'transparent';
    if (s.theme === 'light') bg = '#ffffff';
    else if (s.theme === 'dark') bg = '#0d2b45';
    else if (s.theme === 'custom') bg = s.customBg;
    else {
      var p = C.parse(worksheetBg);
      if (p && p.a > 0.05) bg = C.over(p, '#ffffff');
      else bg = (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) ? '#0d2b45' : '#ffffff';
    }
    var inkDark = C.contrast(bg, INK_DARK) >= C.contrast(bg, INK_LIGHT);
    var chipInk = s.labelColor && /^#[0-9a-f]{6}$/i.test(s.labelColor) ? s.labelColor : (inkDark ? INK_DARK : INK_LIGHT);
    return { bg: bg, clear: clear, dark: !inkDark, ink: inkDark ? INK_DARK : INK_LIGHT, chipBg: inkDark ? '#ffffff' : '#081f33', chipInk: chipInk,
             chipLine: inkDark ? 'rgba(16,32,43,.45)' : 'rgba(243,245,247,.45)' };
  }

  var EASE_CSS = { out: 'cubic-bezier(.2,.8,.2,1)', inout: 'cubic-bezier(.65,0,.35,1)', linear: 'linear' };
  function palOf(s) { var p = C.palette(s.palette).slice(); return s.paletteReverse ? p.reverse() : p; }
  /* Number text for labels. A whole number that is not shortened never shows decimals. */
  function fmtVal(v, s) {
    var o = s, x = v * (parseFloat(s.numScale) || 1);
    if (!s.numCompact && Math.abs(x - Math.round(x)) < 1e-9) { o = {}; Object.keys(s).forEach(function (k) { o[k] = s[k]; }); o.numDecimals = 0; }
    return CP.formatNumber(v, o);
  }
  function plainVal(v, s) { var o = {}; Object.keys(s).forEach(function (k) { o[k] = s[k]; }); o.numCompact = false; return fmtVal(v, o); }
  function casing(text, mode) { return mode === 'upper' ? text.toUpperCase() : mode === 'lower' ? text.toLowerCase() : text; }

  function Renderer(host, hooks) {
    this.host = host; this.hooks = hooks || {};
    this.titleEl = el('div', 'sc-title'); this.titleEl.style.display = 'none';
    this.stage = el('div', 'sc-stage'); this.legend = el('div', 'sc-legend');
    this.svg = sv('svg', { 'class': 'sc-svg', role: 'img', tabindex: '0' });
    this.gRings = sv('g', { 'class': 'sc-rings' }); this.gCircles = sv('g', { 'class': 'sc-circles' }); this.gLabels = sv('g', { 'class': 'sc-labels' });
    this.svg.appendChild(this.gRings); this.svg.appendChild(this.gCircles); this.svg.appendChild(this.gLabels);
    this.tip = el('div', 'sc-tip'); this.tip.style.display = 'none';
    this.empty = el('div', 'sc-empty'); this.empty.style.display = 'none';
    this.stage.appendChild(this.svg); this.stage.appendChild(this.tip); this.stage.appendChild(this.empty);
    host.appendChild(this.titleEl); host.appendChild(this.stage); host.appendChild(this.legend);
    this.nodes = []; this.clusters = []; this.byId = new Map(); this.key = ''; this.anim = null; this.job = null; this.hotCluster = null; this.selected = null; this.hovered = null; this.catDefault = []; this.catList = []; this.catMap = {};
    this.frameMs = []; this.measureCache = {}; this.first = true; this.lastLayout = null;
    this.ctx = document.createElement('canvas').getContext('2d');
    var self = this;
    this.svg.addEventListener('click', function (e) { self._click(e); });
    this.svg.addEventListener('pointermove', function (e) { self._move(e); });
    this.svg.addEventListener('pointerleave', function () { self._hover(null); });
    this.svg.addEventListener('keydown', function (e) { if (e.key === 'Escape') { self._select(null); } });
  }
  var P = Renderer.prototype;

  P._measure = function (text) {
    var k = this.font + '|' + text, c = this.measureCache;
    if (c[k] === undefined) { this.ctx.font = this.font; c[k] = this.ctx.measureText(text).width; }
    return c[k];
  };

  /* ---------------------------------------------------------------- color */
  P._colorOf = function (n, s) {
    var pal = palOf(s);
    if (s.colorMode === 'single') return s.singleColor;
    if (s.colorMode === 'field' && n.colorKey !== undefined && n.colorKey !== null) {
      var fc = this.catMap[n.colorKey]; if (fc) return fc.color;
      var i = this.catIndex[n.colorKey]; return pal[(i === undefined ? 0 : i) % pal.length];
    }
    var cc = this.catMap[n.cl.name]; return cc ? cc.color : pal[n.cl.idx % pal.length];
  };

  P._paint = function (s, th) {
    var self = this;
    this.nodes.forEach(function (n) {
      var col = self._colorOf(n, s), c = n.el;
      c.setAttribute('fill', col); c.setAttribute('fill-opacity', s.opacity / 100);
      c.setAttribute('stroke', s.ringColorMode === 'ink' ? th.ink : (th.dark ? C.mix(col, '#ffffff', 0.3) : C.mix(col, '#000000', 0.5)));
      c.setAttribute('stroke-width', s.ringWidth); c.setAttribute('stroke-opacity', s.ringOpacity / 100);
      if (s.ringStyle === 'dashed') c.setAttribute('stroke-dasharray', '7 5'); else if (s.ringStyle === 'dotted') c.setAttribute('stroke-dasharray', '1.5 5'); else c.removeAttribute('stroke-dasharray');
      c.setAttribute('stroke-linecap', s.ringStyle === 'dotted' ? 'round' : 'butt');
    });
  };

  /* ---------------------------------------------------------------- layout */
  P._compute = function (model, s) {
    // aggregate duplicate (item, cluster) rows, drop non-positive sizes
    var map = new Map(), dropped = 0, cats = {};
    model.rows.forEach(function (r) {
      var v = Number(r.value);
      if (!isFinite(v) || v <= 0) { dropped++; return; }
      var name = r.name === null || r.name === undefined || r.name === '' ? '(blank)' : String(r.name);
      var cl = r.cluster === null || r.cluster === undefined || r.cluster === '' ? '(blank)' : String(r.cluster);
      var key = name + '\u0001' + cl, it = map.get(key);
      if (!it) { it = { id: key, name: name, cluster: cl, value: 0, color: null, tuples: [], colorW: {} }; map.set(key, it); }
      it.value += v; if (r.tuple !== undefined) it.tuples.push(r.tuple);
      if (r.color !== null && r.color !== undefined && r.color !== '') { var ck = String(r.color); it.colorW[ck] = (it.colorW[ck] || 0) + v; cats[ck] = (cats[ck] || 0) + v; }
    });
    var items = Array.from(map.values());
    items.forEach(function (it) { var b = null, bw = -1; Object.keys(it.colorW).forEach(function (k) { if (it.colorW[k] > bw) { bw = it.colorW[k]; b = k; } }); it.color = b; });
    this.catOrder = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a] || (a < b ? -1 : 1); });
    this.catIndex = {}; this.catOrder.forEach(function (k, i) { this.catIndex[k] = i; }, this);
    this.dropped = dropped;
    /* The categories color is picked from: clusters (largest first, which is the default order) or the Color shelf's values.
     * The saved list can recolor, rename and hide them. Default colors never depend on what is hidden. */
    var pal = palOf(s), defs = [];
    if (s.colorMode === 'cluster') {
      var tot = {}; items.forEach(function (it) { tot[it.cluster] = (tot[it.cluster] || 0) + it.value; });
      Object.keys(tot).sort(function (a, b) { return tot[b] - tot[a] || (a < b ? -1 : 1); }).forEach(function (nm, i) { defs.push({ key: nm, name: nm, color: pal[i % pal.length] }); });
    } else if (s.colorMode === 'field') this.catOrder.forEach(function (k, i) { defs.push({ key: k, name: k, color: pal[i % pal.length] }); });
    this.catDefault = defs; this.catList = CP.mergeList(s.catColors, defs); this.catMap = {};
    var hide = {}, map = this.catMap; this.hidden = [];
    this.catList.forEach(function (c) { map[c.key] = c; if (c.hidden) { hide[c.key] = 1; } });
    this.hidden = Object.keys(hide).sort();
    if (this.hidden.length) items = items.filter(function (it) { return !(s.colorMode === 'cluster' ? hide[it.cluster] : (it.color !== null && hide[it.color])); });
    return items;
  };

  P._layoutOpts = function (s) {
    var fs = Math.max(14, s.fontSize), chipH = fs + 10;
    return { w: this.w, h: this.h, pad: s.pad, minR: s.minRadius, areaFill: s.areaFill / 100, spread: s.spread, pull: s.pull,
      margin: s.margin, topBand: s.labels && s.clusterLabels ? chipH + 10 : 0, sizeScale: s.sizeScale, capMedian: s.capMedian, density: s.density, stretch: s.stretch, ticks: s.ticks,
      clusterSort: s.clusterSort, clusterDir: s.clusterDir, itemSort: s.itemSort, itemDir: s.itemDir, padGrow: s.padGrow };
  };
  P._name = function (c) { var m = this.catMap[c.name]; return this.s.colorMode === 'cluster' && m && m.name ? m.name : c.name; };
  /* Start the off-screen layout job; a newer job replaces an unfinished one. */
  P._startLayout = function (s, noMorph) {
    var self = this, items = this._items, job = L.layoutJob(items, this._layoutOpts(s)), token = { noMorph: !!noMorph || !!(this.job && this.job.noMorph) };
    this.job = token;
    var commit = function () { if (self.job !== token) return; self.job = null; self._commit(items, job.result, token.noMorph); };
    var slice = function () {
      if (self.job !== token) return;
      if (job.step(self.anim ? SLICE_MOVING : (self.nodes.length ? SLICE_STILL : SLICE_EMPTY))) global.requestAnimationFrame(commit);   // the DOM swap gets a frame of its own
      else global.requestAnimationFrame(slice);
    };
    global.requestAnimationFrame(slice);   // first slice
  };
  P._commit = function (items, res, noMorph) {
    var s = this.s;
    if (this.hovered || (this.hotCluster !== null && this.hotCluster !== undefined)) this._hover(null);
    var moveFrom = this.nodes.length && !this.first && !noMorph;
    this._relayout(items, res);
    this._paint(s, this.th); this._legend(); this._rings();
    var dur = this._reduced() ? 0 : s.animMs;
    var intro = this.first ? s.intro : moveFrom;
    this.first = false;
    this.anim = null;
    if (intro && dur > 0 && this.nodes.length <= 1500) this._animate(dur);
    else this._finish();
    this._mark();
  };
  P._relayout = function (items, res) {
    var itemById = new Map();
    items.forEach(function (it) { itemById.set(it.id, it); });
    var old = this.byId, self = this;
    this.gCircles.textContent = ''; this.byId = new Map();
    this.nodes = res.nodes; this.clusters = res.clusters; this.layoutInfo = { maxOverlap: res.maxOverlap, ticks: res.ticks, passes: res.passes, scale: res.scale, overlapAfterSim: res.overlapAfterSim };
    var groups = [];
    this.clusters.forEach(function (c) { var g = sv('g', { 'class': 'sc-cl', 'data-c': c.idx }); groups.push(g); self.gCircles.appendChild(g); });
    this.nodes.forEach(function (n, i) {
      n.idx = i; var src = itemById.get(n.id); n.colorKey = src.color; n.tuples = src.tuples;
      n.el = sv('circle', { 'class': 'sc-c', 'data-i': i }); groups[n.cl.idx].appendChild(n.el); self.byId.set(n.id, n);
      var o = old.get(n.id);
      n.from = o && o.cur ? { x: o.cur.x, y: o.cur.y, r: o.cur.r } : { x: n.cl.cx, y: n.cl.cy, r: 0 };
      n.cur = { x: n.x, y: n.y, r: n.r };
    });
    this.selected = null; this.hovered = null;
  };

  /* Frame update. */
  P._place = function (t) {
    var ns = this.nodes, e = L.ease(t, this.s.animEase);
    for (var i = 0; i < ns.length; i++) {
      var n = ns[i], f = n.from, x = f.x + (n.x - f.x) * e, y = f.y + (n.y - f.y) * e, r = f.r + (n.r - f.r) * e;
      n.cur.x = x; n.cur.y = y; n.cur.r = r;
      var c = n.el; c.setAttribute('cx', x.toFixed(2)); c.setAttribute('cy', y.toFixed(2)); c.setAttribute('r', Math.max(0, r).toFixed(2));
    }
  };
  P._finish = function () {
    this.anim = null; this.host.classList.remove('sc-moving');
    this.nodes.forEach(function (n) { n.cur = { x: n.x, y: n.y, r: n.r }; n.from = n.cur; });
    this._place(1); this._rings(); this._labels();
  };
  /* A ring around each cluster's territory (off by default). Drawn once the circles have settled. */
  P._rings = function () {
    var s = this.s; this.gRings.textContent = '';
    if (!s.clusterRing || this.anim) return;
    this.clusters.forEach(function (c) {
      var ring = sv('circle', { 'class': 'sc-ring', cx: c.cx.toFixed(2), cy: c.cy.toFixed(2), r: (c.R + 3).toFixed(2), fill: 'none', 'stroke-width': s.clusterRingWidth });
      this.gRings.appendChild(ring);
    }, this);
  };
  P._reduced = function () { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); };

  /* ----------------------------------------------------------------- labels */
  P._labels = function () {
    var s = this.s, self = this;
    this.gLabels.textContent = ''; this.chips = [];
    this.gLabels.setAttribute('class', 'sc-labels sc-style-' + s.chipStyle);
    if (!s.labels || this.anim || !this.nodes.length) return;
    var fs = Math.max(14, s.fontSize), padX = 8, padY = 5, chipH = fs + padY * 2, cands = [], fmt = function (v) { return fmtVal(v, s); };
    var bounds = { x0: 2, y0: 2, x1: this.w - 2, y1: this.h - 2 };
    var avoid = this.nodes.map(function (n) { return { x: n.x, y: n.y, r: n.r, cl: n.cl }; });
    if (s.clusterLabels) this.clusters.forEach(function (c) {
      var texts = [], name = casing(self._name(c), s.clusterCase);
      if (s.showValues) texts.push(name + '  ' + fmt(c.total));
      texts.push(name);
      [0.45, 0.28, 0.16].forEach(function (f) {
        var t = name, maxW = Math.max(40, self.w * f);
        if (self._measure(t) > maxW) { while (t.length > 1 && self._measure(t + '…') > maxW) t = t.slice(0, -1); texts.push(t.replace(/\s+$/, '') + '…'); }
      });
      var sp = L.clusterSpots(c, s.clusterPos);
      cands.push({ id: 'c' + c.idx, mode: 'free', cl: c, x: c.cx, y: c.cy, r: c.R, texts: texts, prio: 0, spots: sp.spots, fallback: sp.fallback });
    });
    if (s.itemLabels) this.nodes.forEach(function (n) {
      if (n.r < chipH * 0.62 || n.r < s.labelMinR) return;
      var name = casing(n.name, s.labelCase), texts = [], maxW = Math.max(10, 2 * Math.sqrt(Math.max(0, (n.r - 3) * (n.r - 3) - (chipH / 2) * (chipH / 2))) - padX * 2);
      if (s.showValues) texts.push(name + '  ' + fmt(n.value));
      texts.push(name);
      var t = name;
      if (self._measure(t) > maxW) { while (t.length > 1 && self._measure(t + '…') > maxW) t = t.slice(0, -1); t = t.replace(/\s+$/, ''); if (t.length >= MIN_STUB) texts.push(t + '…'); }
      cands.push({ id: 'n' + n.idx, mode: 'inside', x: n.x, y: n.y, r: n.r, texts: texts, prio: 1 });
    });
    var placed = L.planChips(cands, bounds, function (t) { return self._measure(t); }, fs, padX, padY, avoid, []);
    placed.forEach(function (p) {
      var g = sv('g', { 'class': 'sc-chip' + (p.id.charAt(0) === 'c' ? ' sc-cchip' : ''), 'data-k': p.id });
      if (p.id.charAt(0) === 'c') g.setAttribute('data-c', p.id.slice(1)); else g.setAttribute('data-i', p.id.slice(1));
      g.appendChild(sv('rect', { x: p.x.toFixed(1), y: p.y.toFixed(1), width: p.w, height: p.h, rx: Math.min(10, p.h / 2) }));
      var tx = sv('text', { x: (p.x + p.w / 2).toFixed(1), y: (p.y + p.h / 2).toFixed(1), 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      tx.textContent = p.text; tx.style.fontSize = fs + 'px'; g.appendChild(tx); self.gLabels.appendChild(g); self.chips.push(p);
    });
    this.gLabels.classList.remove('sc-fade'); void this.gLabels.getBoundingClientRect(); this.gLabels.classList.add('sc-fade');
  };

  /* ----------------------------------------------------------------- legend */
  P._legend = function () {
    var s = this.s, box = this.legend; box.textContent = '';
    var small = this.host.clientWidth < 460 || this.host.clientHeight < 400;
    box.className = 'sc-legend sc-sw-' + s.legendShape;
    if (s.legendPos === 'top') this.host.insertBefore(box, this.stage); else this.host.appendChild(box);
    var want = s.colorMode === 'field' ? true : (s.colorMode === 'cluster' && s.legendClusters);
    var list = this.catList.filter(function (c) { return !c.hidden; });
    if (s.legend && !small && want && list.length) {
      var shown = list.slice(0, s.legendMax);
      if (s.legendTitle) box.appendChild(el('span', 'sc-lg-title', s.legendTitle));
      shown.forEach(function (c) { var chip = el('span', 'sc-key'), sw = el('i', 'sc-sw'); sw.style.background = c.color; chip.appendChild(sw); chip.appendChild(document.createTextNode(c.name)); box.appendChild(chip); });
      if (list.length > shown.length) box.appendChild(el('span', 'sc-key', '+' + (list.length - shown.length) + ' more'));
    }
    if (this.dropped) box.appendChild(el('span', 'sc-key sc-warn', this.dropped + ' row' + (this.dropped === 1 ? '' : 's') + ' skipped: size is zero or negative'));
    box.style.display = box.children.length ? '' : 'none';
  };

  /* ------------------------------------------------------------------- draw */
  P.draw = function (model, s) {
    this.model = model; this.s = s;
    var th = this.th = resolveTheme(s, model.worksheetBg), root = this.host.parentNode;
    var stack = CP.fontStack(s.font), wt = s.labelWeight === 'normal' ? 400 : 600;
    this.font = wt + ' ' + Math.max(14, s.fontSize) + 'px ' + stack; this.measureCache = {};
    var vars = { '--sc-bg': th.bg, '--sc-ink': th.ink, '--sc-chip-bg': th.chipBg, '--sc-chip-ink': th.chipInk, '--sc-chip-line': th.chipLine, '--sc-font': stack,
      '--sc-hover-ms': s.hoverMs + 'ms', '--sc-hover-ring': s.hoverRing + 'px', '--sc-sel-ring': s.selRing + 'px', '--sc-dim': String(s.dimOthers / 100), '--sc-seldim': String(s.selDim / 100),
      '--sc-label-ms': s.labelFadeMs + 'ms', '--sc-tip-size': Math.max(14, s.tipSize) + 'px', '--sc-tip-w': s.tipMaxW + 'px', '--sc-label-weight': String(wt), '--sc-ring-w': s.clusterRingWidth + 'px' };
    Object.keys(vars).forEach(function (k) { root.style.setProperty(k, vars[k]); });
    var paintBg = th.clear ? 'transparent' : th.bg;
    root.style.background = paintBg; document.body.style.background = paintBg; document.documentElement.style.background = paintBg; root.classList.toggle('sc-dark', th.dark);
    var host = this.host;
    host.style.padding = s.padding + 'px'; host.style.border = s.borderOn ? s.borderWidth + 'px solid ' + s.borderColor : '0';
    host.style.borderRadius = s.borderOn ? s.borderRadius + 'px' : '0'; host.style.overflow = 'hidden';
    var te = this.titleEl;
    if (s.showTitle) {
      te.style.display = ''; te.textContent = s.titleText || (model.valueName ? model.valueName + (model.clusterName ? ' by ' + model.clusterName : '') : 'Schools');
      te.style.fontSize = Math.max(14, s.titleSize) + 'px'; te.style.fontWeight = s.titleWeight === 'bold' ? '700' : '400';
    } else te.style.display = 'none';
    this.empty.style.display = 'none';
    if (!model.rows || !model.rows.length) { this._clearAll(); this._msg(model.emptyMessage || 'Drop a dimension on Item and a measure on Size.'); return; }
    this.svg.style.display = '';
    // legend first (it takes height), then measure the stage
    this._items = this._compute(model, s); this._legend();
    if (!this._items.length) { this._clearAll(); this._msg('Every row has a size of zero or less, so there is nothing to draw.'); return; }
    var rect = this.stage.getBoundingClientRect(), w = Math.max(60, Math.floor(rect.width)), h = Math.max(60, Math.floor(rect.height));
    var sizeChanged = w !== this.w || h !== this.h;
    this.w = w; this.h = h;
    this.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); this.svg.setAttribute('width', w); this.svg.setAttribute('height', h);
    var key = [model.version, s.pad, s.padGrow, s.areaFill, s.minRadius, s.spread, s.pull, s.density, s.stretch, s.ticks, s.sizeScale, s.capMedian, s.clusterSort, s.clusterDir, s.itemSort, s.itemDir, s.colorMode, this.hidden.join(','), s.labels && s.clusterLabels, Math.max(14, s.fontSize), s.margin, s.padding, s.borderOn && s.borderWidth, s.showTitle && s.titleSize, w, h].join('|');
    if (key !== this.key) { this.key = key; this._startLayout(s, sizeChanged); }
    else { this._paint(s, th); this._legend(); if (!this.anim && !this.job) { this._rings(); this._labels(); } }
    this._mark();
  };
  P._animate = function (dur) {
    var self = this, a = {}, t0 = null;
    this.anim = a; this.host.classList.add('sc-moving'); this.gLabels.textContent = ''; this.chips = [];
    this._place(0); this.frameMs.length = 0;
    var frame = function (now) {
      if (self.anim !== a) return;
      var w0 = performance.now();
      if (t0 === null) t0 = w0;   // the clock starts at the first frame we draw: rAF's own timestamp can predate a long synchronous layout
      var t = (w0 - t0) / dur;
      if (t >= 1) { self._finish(); return; }
      self._place(t); self.frameMs.push(performance.now() - w0);
      global.requestAnimationFrame(frame);
    };
    global.requestAnimationFrame(frame);
  };
  P._clearAll = function () { this.job = null; this.svg.style.display = 'none'; this.legend.style.display = 'none'; this.nodes = []; this.clusters = []; this.key = ''; };
  P._msg = function (t) { this.empty.textContent = t; this.empty.style.display = ''; };

  /* ----------------------------------------------------- pointer and marks */
  P._at = function (e) {
    var t = e.target; if (!t || !t.closest) return null;
    var c = t.closest('[data-c].sc-cchip'); if (c) return { cluster: this.clusters[+c.getAttribute('data-c')] };
    var g = t.closest('[data-i]'); if (g) return { node: this.nodes[+g.getAttribute('data-i')] };
    return null;
  };
  P._click = function (e) {
    if (!this.nodes.length) return;
    var hit = this._at(e);
    if (!hit) { this._select(null); return; }
    this._select(hit, this.s.multiSel && (e.ctrlKey || e.metaKey || e.shiftKey));
  };
  P._select = function (hit, additive) {
    this.selected = hit; this._mark();
    if (this.hooks.onSelect) this.hooks.onSelect(hit ? (hit.node ? { type: 'item', node: hit.node } : { type: 'cluster', cluster: hit.cluster }) : null, !!additive);
  };
  P._move = function (e) {
    if (!this.nodes.length || this.anim) return;
    var hit = this._at(e);
    this._hover(hit && hit.node ? hit.node : null, e, hit && hit.cluster);
  };
  P._hover = function (n, e, cluster) {
    var s = this.s, on = s.hoverOn, cl = n ? n.cl : (cluster || null);
    if (n !== this.hovered) { if (this.hovered) this.hovered.el.classList.remove('sc-hover'); this.hovered = n; if (n && on) n.el.classList.add('sc-hover'); if (this.hooks.onHover) this.hooks.onHover(n); }
    var idx = cl && on && (s.clusterHover || !n) ? cl.idx : null;
    if (idx !== this.hotCluster) {
      this.hotCluster = idx;
      var gs = this.gCircles.children;
      for (var i = 0; i < gs.length; i++) gs[i].classList.toggle('sc-on', idx !== null && +gs[i].getAttribute('data-c') === idx);
      this.gCircles.classList.toggle('sc-dimming', idx !== null);
    }
    if (!s.tooltips || !e || (!n && !cluster)) { this.tip.style.display = 'none'; return; }
    var m = this.model, self = this, tip = this.tip;
    tip.textContent = '';
    if (n) {
      var head = el('b', null, null), col = this._colorOf(n, s);
      if (s.tipSwatch && col) { var sw = el('i', 'sc-sw'); sw.style.background = col; head.appendChild(sw); }
      head.appendChild(document.createTextNode(n.name)); tip.appendChild(head);
      tip.appendChild(el('div', null, m.valueName + ': ' + plainVal(n.value, s)));
      tip.appendChild(el('div', null, (m.clusterName || 'Cluster') + ': ' + this._name(n.cl)));
      tip.appendChild(el('div', null, Math.round(n.value / n.cl.total * 1000) / 10 + '% of ' + this._name(n.cl)));
      if (n.colorKey !== null && n.colorKey !== undefined && m.colorName) tip.appendChild(el('div', null, m.colorName + ': ' + n.colorKey));
    } else {
      var head2 = el('b', null, null), ccol = cluster.nodes.length ? this._colorOf(cluster.nodes[0], s) : null;
      if (s.tipSwatch && ccol) { var sw2 = el('i', 'sc-sw'); sw2.style.background = ccol; head2.appendChild(sw2); }
      head2.appendChild(document.createTextNode(this._name(cluster))); tip.appendChild(head2);
      tip.appendChild(el('div', null, m.valueName + ': ' + plainVal(cluster.total, s)));
      tip.appendChild(el('div', null, cluster.nodes.length + ' circle' + (cluster.nodes.length === 1 ? '' : 's')));
    }
    tip.style.display = '';
    tip.style.fontSize = Math.max(14, s.tipSize) + 'px'; tip.style.maxWidth = s.tipMaxW + 'px';
    var sr = this.stage.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight, x, y;
    if (s.tipFollow === 'corner') { x = 8; y = 8; }
    else {
      x = e.clientX - sr.left + 14; y = e.clientY - sr.top + 14;
      if (x + tw > sr.width - 4) x = Math.max(4, e.clientX - sr.left - tw - 14);
      if (y + th > sr.height - 4) y = Math.max(4, e.clientY - sr.top - th - 14);
    }
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  P.catItems = function () { return this.catDefault; };
  P._mark = function () {
    var sel = this.selected;
    this.nodes.forEach(function (n) {
      var on = !!(sel && ((sel.node && sel.node === n) || (sel.cluster && sel.cluster === n.cl)));   // must be a real boolean: classList.toggle(cls, undefined) TOGGLES
      n.el.classList.toggle('sc-sel', on);
    });
    this.gCircles.classList.toggle('sc-hassel', !!sel);
  };

  global.SC.Renderer = Renderer;
  global.SC.resolveTheme = resolveTheme;
})(typeof window !== 'undefined' ? window : globalThis);
