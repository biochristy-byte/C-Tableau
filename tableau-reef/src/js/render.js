/* Reef - renderer. SVG circles, an eased zoom driven by requestAnimationFrame,
 * chip labels, breadcrumb, legend and tooltip.
 *
 * Motion rules: the zoom only changes circle geometry (cx, cy, r) once per frame,
 * labels are hidden while it runs and planned once when it settles, and the entrance
 * is a CSS opacity and transform animation (runs on the compositor). Nothing
 * re-lays-out the page during a zoom.
 */
(function (global) {
  'use strict';
  var RF = global.RF, C = RF.colors, L = RF.layout, CP = global.CTabPanel;
  var SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function sv(tag, attrs) { var n = document.createElementNS(SVGNS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }

  var INK_DARK = '#10202b', INK_LIGHT = '#f3f5f7';

  function resolveTheme(s, worksheetBg) {
    var bg;
    var clear = s.theme === 'transparent';
    if (s.theme === 'light') bg = '#ffffff';
    else if (s.theme === 'dark') bg = '#0d2b45';
    else if (s.theme === 'custom') bg = s.customBg;
    else {
      var p = C.parse(worksheetBg);
      if (p && p.a > 0.05) bg = C.over(p, '#ffffff');
      else bg = (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) ? '#0d2b45' : '#ffffff';
    }
    var inkDark = C.contrast(bg, INK_DARK) >= C.contrast(bg, INK_LIGHT);
    var ink = inkDark ? INK_DARK : INK_LIGHT;
    var chipInk = s.labelColor && /^#[0-9a-f]{6}$/i.test(s.labelColor) ? s.labelColor : (inkDark ? INK_DARK : INK_LIGHT);
    return {
      bg: bg, clear: clear, dark: !inkDark, ink: ink,
      chipBg: inkDark ? '#ffffff' : '#081f33', chipInk: chipInk,
      chipLine: inkDark ? 'rgba(16,32,43,.45)' : 'rgba(243,245,247,.45)'
    };
  }

  var EASE_CSS = { out: 'cubic-bezier(.2,.8,.2,1)', inout: 'cubic-bezier(.65,0,.35,1)', linear: 'linear' };
  function palOf(s) { var p = C.palette(s.palette).slice(); return s.paletteReverse ? p.reverse() : p; }
  /* Number text for labels and the legend ramp. A whole number that is not shortened never shows decimals. */
  function fmtVal(v, s) {
    var o = s, x = v * (parseFloat(s.numScale) || 1);
    if (!s.numCompact && Math.abs(x - Math.round(x)) < 1e-9) { o = {}; Object.keys(s).forEach(function (k) { o[k] = s[k]; }); o.numDecimals = 0; }
    return CP.formatNumber(v, o);
  }
  function plainVal(v, s) { var o = {}; Object.keys(s).forEach(function (k) { o[k] = s[k]; }); o.numCompact = false; return fmtVal(v, o); }
  function casing(text, mode) { return mode === 'upper' ? text.toUpperCase() : mode === 'lower' ? text.toLowerCase() : text; }

  function Renderer(host, hooks) {
    this.host = host; this.hooks = hooks || {};
    this.titleEl = el('div', 'rf-title'); this.titleEl.style.display = 'none';
    this.crumbs = el('div', 'rf-crumbs');
    this.stage = el('div', 'rf-stage');
    this.legend = el('div', 'rf-legend');
    this.svg = sv('svg', { 'class': 'rf-svg', role: 'img', tabindex: '0' });
    this.world = sv('g', { 'class': 'rf-world' });
    this.gCircles = sv('g', { 'class': 'rf-circles' });
    this.gLabels = sv('g', { 'class': 'rf-labels' });
    this.world.appendChild(this.gCircles); this.world.appendChild(this.gLabels);
    this.svg.appendChild(this.world);
    this.tip = el('div', 'rf-tip'); this.tip.style.display = 'none';
    this.empty = el('div', 'rf-empty'); this.empty.style.display = 'none';
    this.stage.appendChild(this.svg); this.stage.appendChild(this.tip); this.stage.appendChild(this.empty);
    host.appendChild(this.titleEl); host.appendChild(this.crumbs); host.appendChild(this.stage); host.appendChild(this.legend);
    this.nodes = []; this.root = null; this.focus = null; this.treeKey = ''; this.anim = null;
    this.selected = null; this.hovered = null; this.hovLeaves = []; this.catDefault = []; this.catList = []; this.catMap = {}; this.introDone = false; this.frameMs = []; this.measureCache = {};
    this.ctx = document.createElement('canvas').getContext('2d');
    var self = this;
    this.svg.addEventListener('click', function (e) { self._click(e); });
    this.svg.addEventListener('pointermove', function (e) { self._move(e); });
    this.svg.addEventListener('pointerleave', function () { self._hover(null); });
    this.svg.addEventListener('keydown', function (e) {
      if (self.s && self.s.escUp && (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'ArrowUp')) { e.preventDefault(); self.goUp(); }
    });
  }
  var P = Renderer.prototype;

  P._measure = function (text) {
    var k = this.font + '|' + text, c = this.measureCache;
    if (c[k] === undefined) { this.ctx.font = this.font; c[k] = this.ctx.measureText(text).width; }
    return c[k];
  };

  /* ------------------------------------------------------------ data to tree */
  P._tree = function (model, s) {
    var lv = Math.max(1, Math.min(model.levels, s.maxDepth)), bopts = { fold: s.foldSingle, reverse: s.sortReverse };
    /* The top-level groups, in tree order, give each one a stable default colour; the saved list can recolour, rename and hide them. */
    var full = L.buildTree(model.rows, lv, s.sort, bopts), pal = palOf(s);
    this.catDefault = (full.root.children || []).map(function (t, k) { var nm = t.data.pathNames[0]; return { key: nm, name: nm, color: pal[k % pal.length] }; });
    this.catList = CP.mergeList(s.catColors, this.catDefault); this.catMap = {};
    var hidden = [], map = this.catMap;
    this.catList.forEach(function (c) { map[c.key] = c; if (c.hidden) hidden.push(c.key); });
    var key = [model.version, s.gap, s.topGap, s.groupPad, s.sort, s.sortReverse, s.foldSingle, lv, hidden.join('|')].join('#');
    if (key === this.treeKey && this.root) return;
    var prevPath = this.focus ? this.focus.data.pathNames : [];
    var built = hidden.length ? L.buildTree(model.rows.filter(function (r) { return hidden.indexOf(L.nameOf(r.path[0])) < 0; }), lv, s.sort, bopts) : full;
    this.dropped = built.dropped; this.lv = lv;
    this.root = L.pack(built.root, s.gap, { topGap: s.topGap, groupPad: s.groupPad });
    this.nodes = this.root.descendants();
    this.treeKey = key;
    this._indexColors(model);
    var f = this.root, nx;
    do {   // a folded circle owns several path steps, so match each child by its whole path prefix
      var have = f.data.pathNames.length;
      nx = f.children && f.children.filter(function (c) {
        var pn = c.data.pathNames; if (pn.length > prevPath.length) return false;
        for (var j = 0; j < pn.length; j++) if (pn[j] !== prevPath[j]) return false;
        return pn.length > have;
      })[0];
      if (nx) f = nx;
    } while (nx);
    this.focus = f; this.selected = null; this.hovered = null; this.anim = null;
    // circle elements
    this.gCircles.textContent = '';
    var self = this;
    this.nodes.forEach(function (n, i) {
      var c = sv('circle', { 'class': 'rf-c ' + (n.children ? 'rf-group' : 'rf-leaf') + (n.parent ? '' : ' rf-rootc'), 'data-i': i });
      n.el = c; n.idx = i; self.gCircles.appendChild(c);
    });
  };

  P._indexColors = function (model) {
    var root = this.root, order = [], i;
    // top-level group index
    (root.children || []).forEach(function (t) { var tk = t.data.pathNames[0]; t.each(function (n) { n.topKey = tk; }); });
    this.catIndex = {}; this.numRange = null;
    var cats = {}, lo = Infinity, hi = -Infinity;
    root.leaves().forEach(function (lf) {
      var d = lf.data;
      if (d.cat) {
        var best = null, bw = -1;
        Object.keys(d.cat).forEach(function (k) { cats[k] = (cats[k] || 0) + d.cat[k]; if (d.cat[k] > bw) { bw = d.cat[k]; best = k; } });
        lf.catKey = best;
      } else if (d.cw) {
        lf.numVal = d.cs / d.cw; lo = Math.min(lo, lf.numVal); hi = Math.max(hi, lf.numVal);
      }
    });
    order = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a] || (a < b ? -1 : 1); });
    order.forEach(function (k, j) { this.catIndex[k] = j; }, this);
    this.catOrder = order;
    if (lo <= hi) this.numRange = [lo, hi];
  };

  /* ------------------------------------------------------------------ paint */
  P._colorOf = function (n, s) {
    var pal = palOf(s);
    if (s.colorMode === 'single') return s.singleColor;
    if (s.colorMode === 'depth') return pal[Math.max(0, n.data.depthIdx) % pal.length];
    if (s.colorMode === 'field') {
      if (n.catKey !== undefined && this.catIndex[n.catKey] !== undefined) return pal[this.catIndex[n.catKey] % pal.length];
      if (n.numVal !== undefined && this.numRange) {
        var span = this.numRange[1] - this.numRange[0];
        return C.ramp(span > 0 ? (n.numVal - this.numRange[0]) / span : 0.5, C.rampStops(s.rampName));
      }
      return null;
    }
    var cat = n.topKey === undefined ? null : this.catMap[n.topKey];
    return cat ? cat.color : null;
  };

  P._paint = function (s, th) {
    var self = this;
    this.nodes.forEach(function (n) {
      var c = n.el;
      if (!n.parent) {
        if (!s.outerRing) { c.setAttribute('fill', 'none'); c.setAttribute('stroke', 'none'); return; }
        c.setAttribute('fill', th.dark ? 'rgba(255,255,255,.04)' : 'rgba(16,32,43,.04)'); c.setAttribute('stroke', th.chipLine); c.setAttribute('stroke-width', 1); return;
      }
      var col = self._colorOf(n, s) || (n.children ? null : C.mix(th.bg, th.ink, 0.5));
      var edge = s.ringColorMode === 'ink' ? th.ink : (col ? (th.dark ? C.mix(col, '#ffffff', 0.3) : C.mix(col, '#000000', 0.5)) : th.chipLine);
      if (n.children) {
        c.setAttribute('fill', col || th.ink);
        c.setAttribute('fill-opacity', (col ? s.groupFill / 100 : 0.05) + (n.depth > 1 ? s.depthTint / 100 : 0));
      } else {
        c.setAttribute('fill', col); c.setAttribute('fill-opacity', s.leafOpacity / 100);
      }
      c.setAttribute('stroke', edge); c.setAttribute('stroke-width', s.ringWidth);
      c.setAttribute('stroke-opacity', (n.children ? 0.889 : 1) * s.ringOpacity / 100);
      if (s.ringStyle === 'dashed') c.setAttribute('stroke-dasharray', '7 5'); else if (s.ringStyle === 'dotted') c.setAttribute('stroke-dasharray', '1.5 5'); else c.removeAttribute('stroke-dasharray');
      c.setAttribute('stroke-linecap', s.ringStyle === 'dotted' ? 'round' : 'butt');
    });
  };

  /* ------------------------------------------------------------- positioning */
  P._setView = function (f, subset) {
    var v = L.viewFor(f, this.w, this.h, 0, 0, this.s.margin, this.s.sizePct / 100), hide = this.s.hideBelow;
    this.view = v;
    var list = subset || this.nodes;
    for (var i = 0; i < list.length; i++) {
      var n = list[i], r = n.r * v.k, e = n.el, x = v.ox + n.x * v.k, y = v.oy + n.y * v.k;
      if (r < hide || r < 0.5 || x + r < -2 || x - r > this.w + 2 || y + r < -2 || y - r > this.h + 2) { if (n.shown !== false) { e.style.display = 'none'; n.shown = false; } continue; }
      if (n.shown === false) { e.style.display = ''; n.shown = true; }
      e.setAttribute('cx', x.toFixed(2));
      e.setAttribute('cy', y.toFixed(2));
      e.setAttribute('r', r.toFixed(2));
    }
  };
  P._visibleSet = function (focus) {
    var set = focus.descendants();
    return set;
  };
  P._hideAllExcept = function (keep) {
    var keepSet = new Set(keep);
    this.nodes.forEach(function (n) { if (!keepSet.has(n) && n.shown !== false) { n.el.style.display = 'none'; n.shown = false; } });
  };

  /* ------------------------------------------------------------------ labels */
  P._labels = function () {
    var s = this.s, th = this.th, self = this, f = this.focus;
    this.gLabels.textContent = '';
    this.chips = [];
    this.gLabels.setAttribute('class', 'rf-labels rf-style-' + s.chipStyle);
    if (!s.labels || this.anim) return;
    var v = this.view, fs = Math.max(14, s.fontSize), cands = [];
    var padX = 8, padY = 5, chipH = fs + padY * 2;
    /* Only the focus circle and its direct children get a chip. Deeper circles stay
     * unlabelled until you zoom to them, so a group chip never sits on a child chip. */
    [f].concat(f.children || []).forEach(function (n) {
      if (!n.parent || n.shown === false) return;
      var group = !!n.children;
      if (group && !s.groupLabels) return;
      var x = v.ox + n.x * v.k, y = v.oy + n.y * v.k, r = n.r * v.k;
      if (r < chipH * 0.62 || r < s.labelMinR) return;
      if (x + r < 0 || x - r > self.w || y + r < 0 || y - r > self.h) return;
      var name = casing(self._name(n), s.labelCase), val = fmtVal(n.value, s), texts = [];
      /* A label shows in full or not at all: no truncated stubs. The tooltip and zoom reveal hidden names. */
      if (s.showValues) texts.push(name + '  ' + val);
      texts.push(name);
      cands.push({ id: n.idx, group: group, x: x, y: y, r: r, texts: texts, prio: (n.parent === f ? 0 : 1) + (group ? 0 : 0.5) });
    });
    var placed = L.planLabels(cands, { x0: 2, y0: 2, x1: this.w - 2, y1: this.h - 2 }, function (t) { return self._measure(t); }, fs, padX, padY, s.labelPlace);
    placed.forEach(function (p) {
      var g = sv('g', { 'class': 'rf-chip', 'data-i': p.id });
      var rect = sv('rect', { x: p.x.toFixed(1), y: p.y.toFixed(1), width: p.w, height: p.h, rx: Math.min(10, p.h / 2) });
      var tx = sv('text', { x: (p.x + p.w / 2).toFixed(1), y: (p.y + p.h / 2).toFixed(1), 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      tx.textContent = p.text; tx.style.fontSize = fs + 'px';
      g.appendChild(rect); g.appendChild(tx); self.gLabels.appendChild(g);
      self.chips.push(p);
    });
    this.gLabels.classList.remove('rf-fade'); void this.gLabels.getBoundingClientRect(); this.gLabels.classList.add('rf-fade');
  };

  /* ---------------------------------------------------------- chrome (HTML) */
  P._crumbs = function () {
    var self = this, s = this.s;
    this.crumbs.textContent = '';
    this.crumbs.style.display = (s.breadcrumb && this.model.levels > 0) ? '' : 'none';
    this.crumbs.className = 'rf-crumbs' + (s.crumbStyle === 'text' ? ' rf-crumbs-text' : '');
    var chain = this.focus.ancestors().reverse();
    chain.forEach(function (n, i) {
      var last = i === chain.length - 1;
      var b = el(last ? 'span' : 'button', 'rf-crumb' + (last ? ' now' : ''), n.parent ? self._name(n) : (s.rootName || self.model.rootName));
      if (!last) { b.type = 'button'; b.addEventListener('click', function () { self.zoomTo(n); }); b.setAttribute('aria-label', 'Zoom out to ' + b.textContent); }
      else b.setAttribute('aria-current', 'true');
      self.crumbs.appendChild(b);
      if (!last) self.crumbs.appendChild(el('span', 'rf-sep', '›'));
    });
    this.svg.setAttribute('aria-label', 'Nested circle chart of ' + this.model.valueName + ', showing ' + this._name(this.focus) + '. Press Escape to zoom out.');
  };

  P._legend = function () {
    var s = this.s, th = this.th, self = this, box = this.legend;
    box.textContent = '';
    var items = [], note = null;
    var small = this.stage.clientWidth < 460 || this.host.clientHeight < 400;
    box.className = 'rf-legend rf-sw-' + s.legendShape;
    if (s.legendPos === 'top') this.host.insertBefore(box, this.stage); else this.host.appendChild(box);
    if (s.legend && !small) {
      var pal = palOf(s);
      if (s.colorMode === 'group') this.catList.forEach(function (c) { if (!c.hidden) items.push([c.name, c.color]); });
      else if (s.colorMode === 'depth') for (var d = 1; d <= this.lv; d++) items.push([this.model.levelNames[d - 1] || 'Level ' + d, pal[(d - 1) % pal.length]]);
      else if (s.colorMode === 'field' && this.catOrder.length) this.catOrder.forEach(function (k, j) { items.push([k, pal[j % pal.length]]); });
      else if (s.colorMode === 'field' && this.numRange) note = 'ramp';
    }
    if (s.legend && !small && s.legendTitle && (items.length || note)) box.appendChild(el('span', 'rf-lg-title', s.legendTitle));
    var shown = items.slice(0, s.legendMax);
    shown.forEach(function (it) {
      var chip = el('span', 'rf-key'); var sw = el('i', 'rf-sw'); sw.style.background = it[1];
      chip.appendChild(sw); chip.appendChild(document.createTextNode(it[0])); box.appendChild(chip);
    });
    if (items.length > shown.length) box.appendChild(el('span', 'rf-key', '+' + (items.length - shown.length) + ' more'));
    if (note === 'ramp') {
      var chip2 = el('span', 'rf-key'); var bar = el('i', 'rf-ramp');
      var st = C.rampStops(s.rampName); bar.style.background = 'linear-gradient(90deg,' + st.join(',') + ')';
      chip2.appendChild(document.createTextNode(fmtVal(this.numRange[0], s) + ' ')); chip2.appendChild(bar);
      chip2.appendChild(document.createTextNode(' ' + fmtVal(this.numRange[1], s)));
      box.appendChild(chip2);
    }
    if (this.dropped) box.appendChild(el('span', 'rf-key rf-warn', this.dropped + ' row' + (this.dropped === 1 ? '' : 's') + ' skipped: size is zero or negative'));
    box.style.display = box.children.length ? '' : 'none';
  };

  /* ------------------------------------------------------------------- draw */
  P.draw = function (model, s) {
    this.model = model; this.s = s;
    var th = this.th = resolveTheme(s, model.worksheetBg);
    var root = this.host;
    var stack = CP.fontStack(s.font), wt = s.labelWeight === 'normal' ? 400 : 600;
    this.font = wt + ' ' + Math.max(14, s.fontSize) + 'px ' + stack;
    this.measureCache = {};
    var vars = { '--rf-bg': th.bg, '--rf-ink': th.ink, '--rf-chip-bg': th.chipBg, '--rf-chip-ink': th.chipInk, '--rf-chip-line': th.chipLine, '--rf-font': stack,
      '--rf-hover-ms': s.hoverMs + 'ms', '--rf-hover-ring': s.hoverRing + 'px', '--rf-sel-ring': s.selRing + 'px', '--rf-dim': String(s.dimOthers / 100),
      '--rf-anim-ms': s.animMs + 'ms', '--rf-anim-ease': EASE_CSS[s.animEase] || EASE_CSS.out, '--rf-label-ms': s.labelFadeMs + 'ms',
      '--rf-tip-size': Math.max(14, s.tipSize) + 'px', '--rf-tip-w': s.tipMaxW + 'px', '--rf-label-weight': String(wt) };
    Object.keys(vars).forEach(function (k) { root.parentNode.style.setProperty(k, vars[k]); });
    var paintBg = th.clear ? 'transparent' : th.bg;
    root.parentNode.style.background = paintBg; document.body.style.background = paintBg; document.documentElement.style.background = paintBg;
    root.parentNode.classList.toggle('rf-dark', th.dark);
    root.style.padding = s.padding + 'px';
    root.style.border = s.borderOn ? s.borderWidth + 'px solid ' + s.borderColor : '0';
    root.style.borderRadius = s.borderOn ? s.borderRadius + 'px' : '0';
    root.style.overflow = 'hidden';
    var te = this.titleEl;
    if (s.showTitle) {
      te.style.display = ''; te.textContent = s.titleText || (model.valueName ? model.valueName + (model.levelNames && model.levelNames.length ? ' by ' + model.levelNames.join(', ') : '') : 'Reef');
      te.style.fontSize = Math.max(14, s.titleSize) + 'px'; te.style.fontWeight = s.titleWeight === 'bold' ? '700' : '400';
    } else te.style.display = 'none';
    this.empty.style.display = 'none';
    if (!model.rows || !model.rows.length) { this._clearAll(); this._msg(model.emptyMessage || 'Drop a dimension on Level 1 and a measure on Size.'); return; }
    this._tree(model, s);
    if (!this.root.children || !this.root.children.length) { this._clearAll(); this._msg('Every row has a size of zero or less, so there is nothing to draw.'); return; }
    this.svg.style.display = '';
    this._crumbs(); this._legend();
    var rect = this.stage.getBoundingClientRect();
    this.w = Math.max(60, Math.floor(rect.width)); this.h = Math.max(60, Math.floor(rect.height));
    this.svg.setAttribute('viewBox', '0 0 ' + this.w + ' ' + this.h);
    this.svg.setAttribute('width', this.w); this.svg.setAttribute('height', this.h);
    this._paint(s, th);
    var vis = this._visibleSet(this.focus);
    this._hideAllExcept(vis);
    this.anim = null;
    this._setView(this.focus, vis);
    this._labels();
    this._mark();
    if (!this.introDone) {
      this.introDone = true;
      if (s.intro && !this._reduced()) { this.svg.classList.remove('rf-intro'); void this.svg.getBoundingClientRect(); this.svg.classList.add('rf-intro'); }
    }
  };
  P._clearAll = function () { this.svg.style.display = 'none'; this.crumbs.style.display = 'none'; this.legend.style.display = 'none'; this.root = null; this.treeKey = ''; this.nodes = []; };
  P._msg = function (t) { this.empty.textContent = t; this.empty.style.display = ''; };
  P._reduced = function () { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); };

  /* -------------------------------------------------------------------- zoom */
  P.goUp = function () { if (this.focus && this.focus.parent) this.zoomTo(this.focus.parent); };
  P.zoomTo = function (node) {
    if (!node || !this.root || node === this.focus && !this.anim) return;
    var self = this, from = this.anim ? this.anim.cur : { x: this.focus.x, y: this.focus.y, r: this.focus.r };
    var to = { x: node.x, y: node.y, r: node.r };
    var union = this._visibleSet(this.focus).concat(this._visibleSet(node));
    var dur = this._reduced() ? 0 : this.s.zoomMs;
    this.focus = node;
    this.gLabels.textContent = ''; this.chips = [];
    this._crumbs();
    this.tip.style.display = 'none';
    if (dur <= 0) { this._finishZoom(); return; }
    var t0 = null, a = { cur: from };
    this.anim = a; this.host.classList.add('rf-zooming');
    var set = new Set(union); this.animSet = Array.from(set);
    this.animSet.forEach(function (n) { if (n.shown === false) { n.el.style.display = ''; } });
    var frame = function (now) {
      if (self.anim !== a) return;
      if (t0 === null) t0 = now;
      var t = (now - t0) / dur, w0 = performance.now();
      if (t >= 1) { self._finishZoom(); return; }
      a.cur = L.lerpFocus(from, to, L.ease(self.s.zoomEase, t));
      self._setView(a.cur, self.animSet);
      self.frameMs.push(performance.now() - w0);
      global.requestAnimationFrame(frame);
    };
    global.requestAnimationFrame(frame);
  };
  P._finishZoom = function () {
    this.anim = null; this.host.classList.remove('rf-zooming');
    var vis = this._visibleSet(this.focus);
    this.nodes.forEach(function (n) { n.shown = undefined; });
    this._hideAllExcept(vis);
    this._setView(this.focus, vis);
    this._labels(); this._mark();
    if (this.hooks.onZoom) this.hooks.onZoom(this.focus);
  };

  /* ------------------------------------------------------- pointer and marks */
  P._nodeAt = function (e) {
    var t = e.target; if (!t || !t.getAttribute) return null;
    var g = t.closest ? t.closest('[data-i]') : null;
    var i = g ? g.getAttribute('data-i') : null;
    return i === null ? null : this.nodes[+i];
  };
  P._click = function (e) {
    if (!this.root) return;
    var n = this._nodeAt(e), s = this.s;
    if (!n || !n.parent && n === this.focus) { if (this.selected) { this.selected = null; this._mark(); if (this.hooks.onSelect) this.hooks.onSelect(null); } return; }
    if (n === this.focus) { if (s.zoomOnClick && s.clickOut) this.goUp(); return; }
    if (!n.parent) return;
    var additive = s.multiSel && (e.ctrlKey || e.metaKey || e.shiftKey);
    this.selected = n; this._mark();
    if (this.hooks.onSelect) this.hooks.onSelect(n, additive);
    if (s.zoomOnClick) {
      if (n.children) this.zoomTo(n);
      else if (s.zoomLeaf && n.parent !== this.focus && n.parent.parent) this.zoomTo(n.parent);
    }
  };
  P._move = function (e) {
    if (!this.root || this.anim) return;
    var n = this._nodeAt(e);
    if (n && !n.parent) n = null;
    this._hover(n, e);
  };
  P._name = function (n) {
    if (n.depth === 1 && n.data.name === n.data.pathNames[0]) {
      var c = this.catMap[n.data.pathNames[0]];
      if (c && c.name && c.name !== c.defName) return c.name;
    }
    return n.data.name;
  };
  P.catItems = function () { return this.catDefault; };
  P._hover = function (n, e) {
    var s = this.s, on = s.hoverOn;
    if (n !== this.hovered) {
      if (this.hovered) this.hovered.el.classList.remove('rf-hover');
      this.hovLeaves.forEach(function (l) { l.el.classList.remove('rf-hov-in'); }); this.hovLeaves = [];
      this.hovered = n;
      if (n && on) {
        n.el.classList.add('rf-hover');
        if (n.children) { this.hovLeaves = n.leaves(); this.hovLeaves.forEach(function (l) { l.el.classList.add('rf-hov-in'); }); }
      }
      this.gCircles.classList.toggle('rf-has-hover', !!(n && on));
      this.gCircles.classList.toggle('rf-hoverdim', !!s.hoverDim);
      if (this.hooks.onHover) this.hooks.onHover(n);
    }
    if (!n || !s.tooltips || !e) { this.tip.style.display = 'none'; return; }
    var m = this.model, self = this, par = n.parent && n.parent.value ? Math.round(n.value / n.parent.value * 1000) / 10 : 100;
    this.tip.textContent = '';
    var path = n.ancestors().reverse().slice(1).map(function (a) { return self._name(a); }).join(' \u203a ');
    var head = el('b', null, null);
    var col = this._colorOf(n, s);
    if (s.tipSwatch && col) { var sw = el('i', 'rf-sw'); sw.style.background = col; head.appendChild(sw); }
    head.appendChild(document.createTextNode(path));
    this.tip.appendChild(head);
    this.tip.appendChild(el('div', null, m.valueName + ': ' + plainVal(n.value, s)));
    if (n.parent && n.parent.parent) this.tip.appendChild(el('div', null, par + '% of ' + this._name(n.parent)));
    if (n.children) this.tip.appendChild(el('div', null, n.leaves().length + ' item' + (n.leaves().length === 1 ? '' : 's') + (s.zoomOnClick ? '. Click to zoom in.' : '')));
    if (n.catKey !== undefined) this.tip.appendChild(el('div', null, (m.colorName || 'Colour') + ': ' + n.catKey));
    else if (n.numVal !== undefined) this.tip.appendChild(el('div', null, (m.colorName || 'Colour') + ': ' + plainVal(n.numVal, s)));
    this.tip.style.display = '';
    this.tip.style.fontSize = Math.max(14, s.tipSize) + 'px'; this.tip.style.maxWidth = s.tipMaxW + 'px';
    var sr = this.stage.getBoundingClientRect(), tw = this.tip.offsetWidth, th = this.tip.offsetHeight, x, y;
    if (s.tipFollow === 'corner') { x = 8; y = 8; }
    else {
      x = e.clientX - sr.left + 14; y = e.clientY - sr.top + 14;
      if (x + tw > sr.width - 4) x = Math.max(4, e.clientX - sr.left - tw - 14);
      if (y + th > sr.height - 4) y = Math.max(4, e.clientY - sr.top - th - 14);
    }
    this.tip.style.left = x + 'px'; this.tip.style.top = y + 'px';
  };
  P._mark = function () {
    var sel = this.selected;
    this.nodes.forEach(function (n) { if (n.el) n.el.classList.toggle('rf-sel', n === sel); });
    this.gCircles.classList.toggle('rf-has-sel', !!sel);
  };

  global.RF.Renderer = Renderer;
  global.RF.resolveTheme = resolveTheme;
})(typeof window !== 'undefined' ? window : globalThis);
