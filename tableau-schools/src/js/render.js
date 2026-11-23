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
  var SC = global.SC, C = SC.colors, L = SC.layout;
  var SVGNS = 'http://www.w3.org/2000/svg';
  // ms of layout work per frame: 11 keeps a still picture at 60 fps, 5 leaves room for a morph already running, 30 when nothing is on screen yet.
  // One force tick on 2,000 circles is about 22 ms, and a slice stops before the next unit would cross its budget.
  var SLICE_STILL = 11, SLICE_MOVING = 5, SLICE_EMPTY = 30;

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function sv(tag, attrs) { var n = document.createElementNS(SVGNS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }
  var INK_DARK = '#10202b', INK_LIGHT = '#f3f5f7';

  function resolveTheme(s, worksheetBg) {
    var bg;
    if (s.theme === 'light') bg = '#ffffff';
    else if (s.theme === 'dark') bg = '#0d2b45';
    else if (s.theme === 'custom') bg = s.customBg;
    else {
      var p = C.parse(worksheetBg);
      if (p && p.a > 0.05) bg = C.over(p, '#ffffff');
      else bg = (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) ? '#0d2b45' : '#ffffff';
    }
    var inkDark = C.contrast(bg, INK_DARK) >= C.contrast(bg, INK_LIGHT);
    return { bg: bg, dark: !inkDark, ink: inkDark ? INK_DARK : INK_LIGHT, chipBg: inkDark ? '#ffffff' : '#081f33', chipInk: inkDark ? INK_DARK : INK_LIGHT,
             chipLine: inkDark ? 'rgba(16,32,43,.45)' : 'rgba(243,245,247,.45)' };
  }

  function Renderer(host, hooks) {
    this.host = host; this.hooks = hooks || {};
    this.stage = el('div', 'sc-stage'); this.legend = el('div', 'sc-legend');
    this.svg = sv('svg', { 'class': 'sc-svg', role: 'img', tabindex: '0' });
    this.gCircles = sv('g', { 'class': 'sc-circles' }); this.gLabels = sv('g', { 'class': 'sc-labels' });
    this.svg.appendChild(this.gCircles); this.svg.appendChild(this.gLabels);
    this.tip = el('div', 'sc-tip'); this.tip.style.display = 'none';
    this.empty = el('div', 'sc-empty'); this.empty.style.display = 'none';
    this.stage.appendChild(this.svg); this.stage.appendChild(this.tip); this.stage.appendChild(this.empty);
    host.appendChild(this.stage); host.appendChild(this.legend);
    this.nodes = []; this.clusters = []; this.byId = new Map(); this.key = ''; this.anim = null; this.job = null; this.hotCluster = null; this.selected = null; this.hovered = null;
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

  /* ---------------------------------------------------------------- colour */
  P._colorOf = function (n, s) {
    var pal = C.palette(s.palette);
    if (s.colorMode === 'single') return s.singleColor;
    if (s.colorMode === 'field' && n.colorKey !== undefined && n.colorKey !== null) {
      var i = this.catIndex[n.colorKey]; return pal[(i === undefined ? 0 : i) % pal.length];
    }
    return pal[n.cl.idx % pal.length];
  };

  P._paint = function (s, th) {
    var self = this;
    this.nodes.forEach(function (n) {
      var col = self._colorOf(n, s), c = n.el;
      c.setAttribute('fill', col); c.setAttribute('fill-opacity', s.opacity / 100);
      c.setAttribute('stroke', th.dark ? C.mix(col, '#ffffff', 0.3) : C.mix(col, '#000000', 0.5));
      c.setAttribute('stroke-width', s.ringWidth);
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
    return items;
  };

  P._layoutOpts = function (s) {
    var fs = Math.max(14, s.fontSize), chipH = fs + 10;
    return { w: this.w, h: this.h, pad: s.pad, minR: s.minRadius, areaFill: s.areaFill / 100, spread: s.spread, pull: s.pull,
      margin: s.margin, topBand: s.labels && s.clusterLabels ? chipH + 10 : 0 };
  };
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
    this._paint(s, this.th); this._legend();
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
    var ns = this.nodes, e = L.ease(t);
    for (var i = 0; i < ns.length; i++) {
      var n = ns[i], f = n.from, x = f.x + (n.x - f.x) * e, y = f.y + (n.y - f.y) * e, r = f.r + (n.r - f.r) * e;
      n.cur.x = x; n.cur.y = y; n.cur.r = r;
      var c = n.el; c.setAttribute('cx', x.toFixed(2)); c.setAttribute('cy', y.toFixed(2)); c.setAttribute('r', Math.max(0, r).toFixed(2));
    }
  };
  P._finish = function () {
    this.anim = null; this.host.classList.remove('sc-moving');
    this.nodes.forEach(function (n) { n.cur = { x: n.x, y: n.y, r: n.r }; n.from = n.cur; });
    this._place(1); this._labels();
  };
  P._reduced = function () { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); };

  /* ----------------------------------------------------------------- labels */
  P._labels = function () {
    var s = this.s, self = this;
    this.gLabels.textContent = ''; this.chips = [];
    if (!s.labels || this.anim || !this.nodes.length) return;
    var fs = Math.max(14, s.fontSize), padX = 8, padY = 5, chipH = fs + padY * 2, cands = [], fmt = function (v) { return C.fmt(v, s.valueFormat); };
    var bounds = { x0: 2, y0: 2, x1: this.w - 2, y1: this.h - 2 };
    var avoid = this.nodes.map(function (n) { return { x: n.x, y: n.y, r: n.r }; });
    if (s.clusterLabels) this.clusters.forEach(function (c) {
      var texts = [], name = c.name;
      if (s.showValues) texts.push(name + '  ' + fmt(c.total));
      texts.push(name);
      [0.45, 0.28, 0.16].forEach(function (f) {
        var t = name, maxW = Math.max(40, self.w * f);
        if (self._measure(t) > maxW) { while (t.length > 1 && self._measure(t + '…') > maxW) t = t.slice(0, -1); texts.push(t.replace(/\s+$/, '') + '…'); }
      });
      var sp = L.clusterSpots(c);
      cands.push({ id: 'c' + c.idx, mode: 'free', x: c.cx, y: c.cy, r: c.R, texts: texts, prio: 0, spots: sp.spots, fallback: sp.fallback });
    });
    if (s.itemLabels) this.nodes.forEach(function (n) {
      if (n.r < chipH * 0.62) return;
      var name = n.name, texts = [], maxW = Math.max(10, 2 * Math.sqrt(Math.max(0, (n.r - 3) * (n.r - 3) - (chipH / 2) * (chipH / 2))) - padX * 2);
      if (s.showValues) texts.push(name + '  ' + fmt(n.value));
      texts.push(name);
      var t = name;
      if (self._measure(t) > maxW) { while (t.length > 1 && self._measure(t + '…') > maxW) t = t.slice(0, -1); if (t.length > 1) texts.push(t.replace(/\s+$/, '') + '…'); }
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
    if (s.legend && !small && s.colorMode === 'field' && this.catOrder.length) {
      var pal = C.palette(s.palette), shown = this.catOrder.slice(0, 10);
      shown.forEach(function (k, i) { var chip = el('span', 'sc-key'), sw = el('i', 'sc-sw'); sw.style.background = pal[i % pal.length]; chip.appendChild(sw); chip.appendChild(document.createTextNode(k)); box.appendChild(chip); });
      if (this.catOrder.length > shown.length) box.appendChild(el('span', 'sc-key', '+' + (this.catOrder.length - shown.length) + ' more'));
    }
    if (this.dropped) box.appendChild(el('span', 'sc-key sc-warn', this.dropped + ' row' + (this.dropped === 1 ? '' : 's') + ' skipped: size is zero or negative'));
    box.style.display = box.children.length ? '' : 'none';
  };

  /* ------------------------------------------------------------------- draw */
  P.draw = function (model, s) {
    this.model = model; this.s = s;
    var th = this.th = resolveTheme(s, model.worksheetBg), root = this.host.parentNode;
    this.font = '600 ' + Math.max(14, s.fontSize) + 'px ' + s.fontFamily; this.measureCache = {};
    var vars = { '--sc-bg': th.bg, '--sc-ink': th.ink, '--sc-chip-bg': th.chipBg, '--sc-chip-ink': th.chipInk, '--sc-chip-line': th.chipLine, '--sc-font': s.fontFamily };
    Object.keys(vars).forEach(function (k) { root.style.setProperty(k, vars[k]); });
    root.style.background = th.bg; document.body.style.background = th.bg; root.classList.toggle('sc-dark', th.dark);
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
    var key = [model.version, s.pad, s.areaFill, s.minRadius, s.spread, s.pull, s.labels && s.clusterLabels, Math.max(14, s.fontSize), s.margin, w, h].join('|');
    if (key !== this.key) { this.key = key; this._startLayout(s, sizeChanged); }
    else { this._paint(s, th); if (!this.anim && !this.job) this._labels(); }
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
    this._select(hit, e.ctrlKey || e.metaKey || e.shiftKey);
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
    var cl = n ? n.cl : (cluster || null);
    if (n !== this.hovered) { if (this.hovered) this.hovered.el.classList.remove('sc-hover'); this.hovered = n; if (n) n.el.classList.add('sc-hover'); if (this.hooks.onHover) this.hooks.onHover(n); }
    var idx = cl ? cl.idx : null;
    if (idx !== this.hotCluster) {
      this.hotCluster = idx;
      var gs = this.gCircles.children;
      for (var i = 0; i < gs.length; i++) gs[i].classList.toggle('sc-on', idx !== null && +gs[i].getAttribute('data-c') === idx);
      this.gCircles.classList.toggle('sc-dimming', idx !== null);
    }
    if (!this.s.tooltips || !e || (!n && !cluster)) { this.tip.style.display = 'none'; return; }
    var m = this.model;
    this.tip.textContent = '';
    if (n) {
      this.tip.appendChild(el('b', null, n.name));
      this.tip.appendChild(el('div', null, m.valueName + ': ' + C.fmt(n.value, 'plain')));
      this.tip.appendChild(el('div', null, (m.clusterName || 'Cluster') + ': ' + n.cl.name));
      this.tip.appendChild(el('div', null, Math.round(n.value / n.cl.total * 1000) / 10 + '% of ' + n.cl.name));
      if (n.colorKey !== null && n.colorKey !== undefined && m.colorName) this.tip.appendChild(el('div', null, m.colorName + ': ' + n.colorKey));
    } else {
      this.tip.appendChild(el('b', null, cluster.name));
      this.tip.appendChild(el('div', null, m.valueName + ': ' + C.fmt(cluster.total, 'plain')));
      this.tip.appendChild(el('div', null, cluster.nodes.length + ' circle' + (cluster.nodes.length === 1 ? '' : 's')));
    }
    this.tip.style.display = '';
    var sr = this.stage.getBoundingClientRect(), x = e.clientX - sr.left + 14, y = e.clientY - sr.top + 14, tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    if (x + tw > sr.width - 4) x = Math.max(4, e.clientX - sr.left - tw - 14);
    if (y + th > sr.height - 4) y = Math.max(4, e.clientY - sr.top - th - 14);
    this.tip.style.left = x + 'px'; this.tip.style.top = y + 'px';
  };
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
