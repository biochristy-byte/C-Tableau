/* Neurons Viz Extension - renderer.
 *
 * Links are drawn on a canvas (hundreds of eased, colored, glowing curves per
 * frame is cheap there and keeps draw order right); nodes, labels, group arcs
 * and the hit targets are SVG, so text stays crisp and hover is native.
 *
 * Motion: one eased transition (easeInOutCubic over `fadeMs`) moves every
 * link's color, opacity and width between "resting" and "focused". The loop
 * only runs while a transition is in flight, so an idle chart costs nothing.
 * A retarget in mid-fade starts from the values on screen, so it never jumps.
 */
(function (global) {
  'use strict';

  var layoutLib = global.NX.layout;
  var pal = global.NX.palettes;
  var SVGNS = 'http://www.w3.org/2000/svg';

  function el (tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function div (cls, parent) {
    var n = document.createElement('div');
    n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  function easeInOutCubic (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function clamp (n, a, b) { return n < a ? a : (n > b ? b : n); }

  var measureCtx = null, measureCache = {};
  function measureText (text, px, family) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    var key = px + '|' + family;
    if (measureCache.key !== key) { measureCache = { key: key }; measureCtx.font = px + 'px ' + family; }
    var w = measureCache[text];
    if (w === undefined) { w = measureCtx.measureText(text).width; measureCache[text] = w; }
    return w;
  }

  /* The height an SVG text box really takes (font ascent + descent), so the
   * label spacing in layout.plan is the same box the DOM will draw. */
  function measureHeight (px, family) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = px + 'px ' + family;
    measureCache = {};
    var m = measureCtx.measureText('Hg');
    var h = (m.fontBoundingBoxAscent || 0) + (m.fontBoundingBoxDescent || 0);
    return h > 0 ? h : px * 1.25;
  }

  function reducedMotion () {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function arcPath (r, a0, a1) {
    var p0 = layoutLib.polar(a0, r), p1 = layoutLib.polar(a1, r);
    var large = (a1 - a0) > Math.PI ? 1 : 0;
    return 'M' + p0[0].toFixed(2) + ',' + p0[1].toFixed(2) + ' A' + r.toFixed(2) + ',' + r.toFixed(2) + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ',' + p1[1].toFixed(2);
  }
  function arcPathRev (r, a0, a1) {
    var p0 = layoutLib.polar(a0, r), p1 = layoutLib.polar(a1, r);
    var large = (a1 - a0) > Math.PI ? 1 : 0;
    return 'M' + p1[0].toFixed(2) + ',' + p1[1].toFixed(2) + ' A' + r.toFixed(2) + ',' + r.toFixed(2) + ' 0 ' + large + ' 0 ' + p0[0].toFixed(2) + ',' + p0[1].toFixed(2);
  }

  var uid = 0;
  var CP = global.CTabPanel;
  var EASES = {
    out: function (t) { return 1 - Math.pow(1 - t, 3); },
    inout: function (t) { return easeInOutCubic(t); },
    linear: function (t) { return t; }
  };
  var CSS_EASE = { out: 'cubic-bezier(0.22, 0.61, 0.36, 1)', inout: 'ease-in-out', linear: 'linear' };
  /* Weights through the shared Number format settings; a weight with a fraction never rounds to a bare integer. */
  function fmtW (v, s) {
    if (!CP || typeof v !== 'number') return String(v);
    if (Number(s.numDecimals) === 0 && Math.floor(v) !== v) {
      var str = CP.formatNumber(v, Object.assign({}, s, { numDecimals: 2 }));
      return str.replace(/(\.\d*?)0+(?=[^\d]|$)/, '$1').replace(/\.(?=[^\d]|$)/, '');
    }
    return CP.formatNumber(v, s);
  }

  function View (host) {
    this.host = host;
    this.id = ++uid;
    host.classList.add('nx-host');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'nx-canvas';
    host.appendChild(this.canvas);
    this.svg = el('svg', { 'class': 'nx-svg', role: 'group' });
    host.appendChild(this.svg);
    this.readout = div('nx-readout', host);
    this.readout.hidden = true;
    this.titleEl = div('nx-title', host);
    this.titleEl.hidden = true;
    this.noteEl = div('nx-note', host);
    this.noteEl.hidden = true;
    this.emptyEl = div('nx-empty', host);
    this.emptyEl.hidden = true;
    this.ctx = this.canvas.getContext('2d');
    this.hover = null;
    this.pinned = null;
    this.focus = null;
    this.items = [];
    this.raf = 0;
    this.trans = { t0: 0, dur: 0, running: false };
    this.entrance = { t0: 0, dur: 0, on: false };
    this.theme = null;
    this.hooks = {};
    this.settings = null;
    this.graph = null;
    this.planned = null;
    this.frames = 0;
    this._wire();
  }

  var P = View.prototype;

  P._wire = function () {
    var self = this;
    var svg = this.svg;
    function nodeOf (t) { return t && t.closest ? t.closest('.nx-node') : null; }
    svg.addEventListener('pointerover', function (e) {
      if (e.pointerType === 'touch') return;
      var n = nodeOf(e.target);
      self.setHover(n ? n.getAttribute('data-id') : null);
    });
    svg.addEventListener('pointerleave', function () { self.setHover(null); });
    /* The readout can follow the pointer (Tooltip tab); it stays inside the chart. */
    host_move(this.host, function (e) { self._pt = e; self._place(e); });
    svg.addEventListener('focusin', function (e) { var n = nodeOf(e.target); if (n) self.setHover(n.getAttribute('data-id')); });
    svg.addEventListener('focusout', function () { self.setHover(null); });
    svg.addEventListener('click', function (e) {
      var n = nodeOf(e.target);
      self.click(n ? n.getAttribute('data-id') : null, e);
    });
    svg.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var n = nodeOf(e.target);
      if (!n) return;
      e.preventDefault();
      self.click(n.getAttribute('data-id'), e);
    });
  };

  /* ------------------------------------------------------------------ draw */

  P.draw = function (model, settings, hooks) {
    this.settings = settings;
    this.hooks = hooks || this.hooks;
    this.model = model;
    var hw = Math.max(1, this.host.clientWidth), hh = Math.max(1, this.host.clientHeight);
    this.theme = pal.resolveTheme(settings, model.worksheetBg);
    var T = this.theme;
    /* The drawing box: inside the padding, under the title. */
    var padPx = Math.max(0, Number(settings.padding) || 0);
    var titleOn = !!(settings.showTitle && settings.titleText);
    var titleH = titleOn ? Math.ceil(settings.titleSize * 1.3) + 8 : 0;
    var ox = padPx, oy = padPx + titleH;
    var w = Math.max(1, hw - 2 * padPx), h = Math.max(1, hh - 2 * padPx - titleH);
    this.box = { ox: ox, oy: oy, w: w, h: h, pad: padPx };
    this.titleEl.hidden = !titleOn;
    if (!titleOn) { this.titleEl.textContent = ''; this.titleEl.removeAttribute('style'); }
    if (titleOn) {
      this.titleEl.textContent = settings.titleText;
      this.titleEl.style.cssText = 'left:' + padPx + 'px;right:' + padPx + 'px;top:' + padPx + 'px;font-size:' + settings.titleSize + 'px;font-weight:' + (settings.titleWeight === 'bold' ? 700 : 400) + ';color:' + T.ink;
    }
    this.canvas.style.left = ox + 'px'; this.canvas.style.top = oy + 'px';
    this.svg.style.left = ox + 'px'; this.svg.style.top = oy + 'px';
    this.noteEl.style.left = padPx + 'px'; this.noteEl.style.right = padPx + 'px'; this.noteEl.style.bottom = padPx + 'px';
    this.host.style.background = settings.bgMode === 'transparent' ? 'transparent' : T.bg;
    this.host.style.border = settings.borderOn ? settings.borderWidth + 'px solid ' + ((CP && CP.color.normHex(settings.borderColor)) || T.muted) : '0';
    this.host.style.borderRadius = settings.borderOn ? settings.borderRadius + 'px' : '0';
    this.host.style.setProperty('--nx-focus', String(settings.focusScale));
    this.host.style.setProperty('--nx-nbr', String(settings.neighborScale));
    this.host.style.setProperty('--nx-dim-node', String(settings.dimNodes / 100));
    this.host.style.setProperty('--nx-dim-halo', String(Math.min(0.2, settings.dimNodes / 100)));
    this.host.style.setProperty('--nx-chart-ink', T.ink);
    this.host.style.setProperty('--nx-chart-muted', T.muted);
    this.host.style.setProperty('--nx-chart-bg', T.bg);
    this.host.style.fontFamily = settings.fontFamily;
    this.noteEl.style.fontSize = Math.max(14, settings.fontSize) + 'px';
    this.readout.style.fontSize = Math.max(14, settings.tipSize) + 'px';
    this.readout.style.maxWidth = settings.tipMaxW + 'px';
    this.readout.setAttribute('data-follow', settings.tipFollow);
    this.readout.style.left = (12 + padPx) + 'px';
    this.readout.style.top = (oy + 12) + 'px';
    this.emptyEl.style.fontSize = Math.max(14, settings.fontSize) + 'px';

    var graph = model.graph;
    this.graph = graph;
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this.items = [];
    this.planned = null;

    if (!graph || !graph.nodes.length || !graph.links.length) {
      this.canvas.width = 1; this.canvas.height = 1;
      this.emptyEl.hidden = false;
      this.emptyEl.textContent = model.emptyMessage || 'Drop a dimension on Source and one on Target.';
      this.noteEl.hidden = true;
      this.readout.hidden = true;
      this.svg.setAttribute('width', w);
      this.svg.setAttribute('height', h);
      return;
    }
    this.emptyEl.hidden = true;
    this.emptyEl.textContent = '';

    var family = settings.fontFamily;
    var measure = function (t, px) { return measureText(t, px, family); };
    measure.height = function (px) { return measureHeight(px, family); };
    var labelOf = function (n) {
      return settings.valueLabels ? n.id + '  ' + fmtW(n.outW + n.inW, settings) : n.id;
    };
    measure.labelOf = labelOf;
    var planS = Object.assign({}, settings, { manualOrder: this.manualOrder || null });
    var plan = layoutLib.plan(graph, w, h, planS, measure);
    this.planned = plan;
    var lay = plan.lay;
    var fs = plan.fs;

    /* Canvas sized in device pixels, capped at 2x. */
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.svg.setAttribute('width', w);
    this.svg.setAttribute('height', h);
    this.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    this.svg.setAttribute('aria-label', 'Hierarchical edge bundling of ' + graph.nodes.length + ' nodes and ' + graph.links.length + ' links');

    /* Group colors are keyed by first appearance in the data, so re-ordering
     * the ring never reshuffles hues. */
    var self0 = this, gcolor = {}, gpal = {}, gname = {};
    var gi = 0, ov = this.groupItems || {};
    graph.nodes.forEach(function (n) {
      if (gcolor[n.group] !== undefined) return;
      var idx = self0.groupIndex && self0.groupIndex[n.group] !== undefined ? self0.groupIndex[n.group] : gi;
      var base = T.groups[idx % T.groups.length]; gi++;
      var o = ov[n.group];
      gpal[n.group] = base;
      gcolor[n.group] = o && o.color ? pal.ensureContrast(o.color, T.bg, 3) : base;
      gname[n.group] = o && o.name ? o.name : n.group;
    });
    this.groupColor = gcolor; this.groupPalette = gpal; this.groupName = gname;

    var root = el('g', { transform: 'translate(' + plan.cx + ',' + plan.cy + ')' }, this.svg);
    if (settings.entrance && !reducedMotion() && !this._entered) {
      root.setAttribute('class', 'nx-enter');
      root.style.animationDuration = settings.animMs + 'ms';
      root.style.animationTimingFunction = CSS_EASE[settings.animEase] || CSS_EASE.inout;
      root.setAttribute('data-anim-ms', settings.animMs);
      /* The svg outlives later redraws, so this records how the entrance was set up even after its class is gone. */
      this.svg.setAttribute('data-entrance', settings.animMs + ',' + settings.animEase);
    }
    var self = this;

    /* Group arcs, then group names along them. */
    var gArcs = el('g', { 'class': 'nx-arcs' }, root);
    lay.arcs.forEach(function (a, i) {
      var col = gcolor[a.name], shownName = gname[a.name] || a.name;
      if (settings.showArcs) {
        var arc = el('path', { d: arcPath(plan.arcR, a.a0, a.a1), fill: 'none', stroke: col, 'stroke-width': plan.arcW, 'stroke-opacity': settings.arcOpacity / 100, 'stroke-linecap': 'butt', 'class': 'nx-arc', 'data-group': a.name }, gArcs);
        var title = el('title', null, arc);
        title.textContent = shownName + ', ' + a.n + ' nodes';
      }
      if (settings.showGroupNames && plan.nameShown[a.name]) {
        var mid = layoutLib.norm(a.mid);
        var bottom = mid > Math.PI / 2 && mid < Math.PI * 3 / 2;
        var rText = plan.arcR + plan.arcW / 2 + 3 + (bottom ? fs * 0.78 : 0);
        var pid = 'nx-gp-' + self.id + '-' + i;
        el('path', { id: pid, d: bottom ? arcPathRev(rText, a.a0, a.a1) : arcPath(rText, a.a0, a.a1), fill: 'none', stroke: 'none' }, gArcs);
        var tx = el('text', { 'class': 'nx-gname', 'font-size': fs, fill: T.ink, 'text-anchor': 'middle' }, gArcs);
        tx.setAttribute('font-weight', settings.groupNameWeight === 'bold' ? '600' : '400');
        var tp = el('textPath', { href: '#' + pid, startOffset: '50%' }, tx);
        tp.textContent = shownName;
      }
    });

    /* Nodes with their labels. */
    var nodeSize = settings.nodeSize;
    var showHalo = settings.nodeHalo && graph.nodes.length <= 900;
    var szOf = function () { return nodeSize; };
    var sized = settings.nodeSizeBy && settings.nodeSizeBy !== 'fixed';
    if (sized) {
      var vOf = function (n) { return settings.nodeSizeBy === 'links' ? n.out + n.inn : n.outW + n.inW; }, vlo = Infinity, vhi = -Infinity;
      graph.nodes.forEach(function (n) { var v = vOf(n); if (v < vlo) vlo = v; if (v > vhi) vhi = v; });
      szOf = function (n) { return vhi > vlo ? nodeSize * (1 + (settings.nodeSizeMax - 1) * (vOf(n) - vlo) / (vhi - vlo)) : nodeSize; };
    }
    var maxNode = sized ? nodeSize * settings.nodeSizeMax : nodeSize;
    var gNodes = el('g', { 'class': 'nx-nodes' }, root);
    /* A hit circle must not reach into its neighbour: cap it at half the slot. */
    var hitR = Math.min(9, Math.max(maxNode + 1, plan.R * lay.unit / 2));
    var nodeEls = {};
    lay.leaves.forEach(function (leaf) {
      var n = leaf.data.node;
      var pos = layoutLib.polar(leaf.x, leaf.y);
      var col = gcolor[n.group];
      var g = el('g', { 'class': 'nx-node', 'data-id': n.id, transform: 'translate(' + pos[0].toFixed(2) + ',' + pos[1].toFixed(2) + ')', tabindex: 0, role: 'button' }, gNodes);
      g.setAttribute('aria-label', n.id + ', ' + n.group + ', ' + n.out + ' outgoing and ' + n.inn + ' incoming links');
      var hit = el('circle', { r: hitR, fill: 'transparent', 'class': 'nx-hit' }, g);
      var rN = szOf(n);
      if (showHalo) el('circle', { r: rN * settings.haloSize, fill: col, 'fill-opacity': settings.haloOpacity / 100, 'class': 'nx-halo' }, g);
      if (settings.nodeShape === 'square') el('rect', { x: -rN, y: -rN, width: rN * 2, height: rN * 2, fill: col, stroke: T.bg, 'stroke-width': settings.nodeStroke, 'class': 'nx-dot' }, g);
      else el('circle', { r: rN, fill: col, stroke: T.bg, 'stroke-width': settings.nodeStroke, 'class': 'nx-dot' }, g);
      if (plan.shown[leaf.id]) {
        var p = layoutLib.labelPlacement(leaf.x);
        var off = plan.pad;
        var lg = el('g', { transform: 'rotate(' + p.rotate.toFixed(3) + ') translate(' + (p.flip ? -off : off) + ',0)', 'class': 'nx-lab' }, g);
        var t = el('text', { 'class': 'nx-label', 'font-size': fs, fill: T.ink, 'text-anchor': p.flip ? 'end' : 'start', 'dominant-baseline': 'central', x: 0, y: 0 }, lg);
        if (settings.labelWeight === 'bold') t.style.fontWeight = '700';
        t.textContent = plan.labelText[leaf.id];
      }
      nodeEls[n.id] = g;
      void hit;
    });
    this.nodeEls = nodeEls;

    /* Link items for the canvas. */
    var wlo = Infinity, whi = -Infinity;
    graph.links.forEach(function (l) { if (l.weight < wlo) wlo = l.weight; if (l.weight > whi) whi = l.weight; });
    var scale = settings.weightScale;
    var byWeight = settings.widthByWeight && graph.hasWeight;
    function tf (v) { return scale === 'log' ? Math.log(1 + Math.max(0, v)) : (scale === 'linear' ? v : Math.sqrt(Math.max(0, v))); }
    var tlo = tf(wlo), thi = tf(whi);
    var minW = settings.linkMinWidth, maxW = Math.max(settings.linkMaxWidth, minW);
    var rgb = pal.hexToRgb;
    var items = lay.links.map(function (lk) {
      var l = lk.link;
      var width = byWeight && thi > tlo ? minW + (maxW - minW) * ((tf(l.weight) - tlo) / (thi - tlo)) : (minW + maxW) / 2;
      var sg = gcolor[lk.a.data.node.group], tg = gcolor[lk.b.data.node.group];
      var base = settings.linkColorMode === 'single' ? T.single : (settings.linkColorMode === 'target' ? tg : sg);
      var c = rgb(base);
      return {
        l: l, path: new global.Path2D(lk.d), width: width, base: [c.r, c.g, c.b], a: lk.a, b: lk.b,
        s: l.s, t: l.t,
        cur: new Float64Array([c.r, c.g, c.b, 0, width]),
        from: new Float64Array(5), to: new Float64Array(5), lit: 0, own: false
      };
    });
    items.sort(function (x, y) { return settings.linkOrder === 'lightTop' ? y.l.weight - x.l.weight : x.l.weight - y.l.weight; });
    this.items = items;
    this.outRgb = rgb(T.out); this.inRgb = rgb(T.inn);

    /* The resting picture of every link goes into one offscreen layer. A
     * hover fade then costs one drawImage plus the few lit links, however
     * many thousand links there are; the layer is rebuilt only on a redraw. */
    var layer = document.createElement('canvas');
    layer.width = this.canvas.width; layer.height = this.canvas.height;
    var lx = layer.getContext('2d');
    lx.setTransform(dpr, 0, 0, dpr, plan.cx * dpr, plan.cy * dpr);
    lx.lineCap = settings.linkCap; lx.lineJoin = 'round';
    lx.globalAlpha = settings.linkOpacity;
    items.forEach(function (it) {
      lx.strokeStyle = 'rgb(' + it.base[0] + ',' + it.base[1] + ',' + it.base[2] + ')';
      lx.lineWidth = it.width;
      lx.stroke(it.path);
    });
    this.layer = layer;
    this.layerA = 1; this.layerFrom = 1; this.layerTo = 1;

    /* Note and readout. */
    if (plan.note) {
      this.noteEl.hidden = false;
      this.noteEl.textContent = plan.note;
      this.noteEl.style.height = plan.noteH + 'px';
    } else this.noteEl.hidden = true;

    /* Entrance. */
    if (settings.entrance && !reducedMotion() && !this._entered) {
      this._entered = true;
      this.entrance = { t0: performance.now(), dur: Math.max(1, settings.animMs), on: true };
    } else this.entrance.on = false;

    /* Re-apply whatever is focused, instantly, so a redraw never flashes. */
    this._applyFocus(this._focusId(), true);
    this._paint();
    this._kick();
  };

  /* ----------------------------------------------------------------- focus */

  P._focusId = function () { return this.hover || this.pinned || null; };

  P.setHover = function (id) {
    if (id === this.hover) return;
    this.hover = id;
    if (this.hooks && this.hooks.onHover) this.hooks.onHover(id);
    this._applyFocus(this._focusId(), false);
  };

  P.click = function (id, evt) {
    if (!this.settings || !this.settings.clickSelect) return;
    if (id && this.pinned === id) this.pinned = null;
    else this.pinned = id || null;
    if (this.hooks && this.hooks.onSelect) this.hooks.onSelect(this.pinned, evt);
    this._applyFocus(this._focusId(), false);
  };

  P.clearPinned = function () {
    this.pinned = null;
    this._applyFocus(this._focusId(), false);
  };

  P._applyFocus = function (id, instant) {
    var s = this.settings;
    if (!s || !this.graph) return;
    if (!s.hoverHighlight) id = null;
    this.focus = id;
    var node = id ? this.graph.byId[id] : null;
    var out = this.outRgb, inn = this.inRgb;
    var litCount = 0;
    var outSet = Object.create(null), inSet = Object.create(null);
    this.items.forEach(function (it) {
      var isOut = !!node && it.s === id, isIn = !!node && it.t === id;
      var lit = (isOut && s.hoverMode !== 'in') || (isIn && s.hoverMode !== 'out');
      var wasOwn = it.own;
      it.lit = lit ? (isOut ? 1 : 2) : 0;
      var to = it.to, cur = it.cur;
      if (lit) {
        var c = isOut ? out : inn;
        var w = it.width * s.litWidth + 0.6;
        if (!wasOwn) { cur[0] = c.r; cur[1] = c.g; cur[2] = c.b; cur[3] = 0; cur[4] = w; }
        to[0] = c.r; to[1] = c.g; to[2] = c.b; to[3] = s.litOpacity / 100; to[4] = w;
        it.own = true;
        litCount++;
        if (isOut) outSet[it.t] = true; else inSet[it.s] = true;
      } else if (wasOwn) {
        to[0] = cur[0]; to[1] = cur[1]; to[2] = cur[2]; to[3] = 0; to[4] = cur[4];
      } else {
        it.own = false;
      }
      it.from.set(cur);
    });
    this.litCount = litCount;
    /* Nodes: classes drive CSS transitions on the dots, halos and labels. */
    var svg = this.svg;
    svg.classList.toggle('has-focus', !!node);
    var els = this.nodeEls || {};
    var pinned = this.pinned;
    Object.keys(els).forEach(function (k) {
      var c = els[k].classList;
      c.toggle('is-focus', k === id);
      c.toggle('is-pinned', k === pinned);
      c.toggle('is-out', !!outSet[k]);
      c.toggle('is-in', !!inSet[k]);
    });
    this._readout(node);

    var dur = instant || reducedMotion() ? 0 : s.fadeMs;
    var now = performance.now();
    this.layerFrom = this.layerA;
    this.layerTo = node && s.linkOpacity > 0 ? Math.min(1, s.dimOpacity / s.linkOpacity) : 1;
    this.trans = { t0: now, dur: dur, running: true };
    if (dur === 0) { this._step(now); }
    else this._kick();
  };

  function host_move (host, fn) { host.addEventListener('pointermove', fn); }

  P._place = function (e) {
    var r = this.readout, s = this.settings;
    if (!s || r.hidden || s.tipFollow !== 'cursor' || !e) return;
    var hr = this.host.getBoundingClientRect(), w = r.offsetWidth, h = r.offsetHeight;
    var x = e.clientX - hr.left + 16, y = e.clientY - hr.top + 16;
    if (x + w > hr.width - 4) x = e.clientX - hr.left - w - 16;
    if (y + h > hr.height - 4) y = e.clientY - hr.top - h - 16;
    r.style.left = Math.max(4, Math.min(x, hr.width - w - 4)) + 'px';
    r.style.top = Math.max(4, Math.min(y, hr.height - h - 4)) + 'px';
  };

  P._readout = function (node) {
    var r = this.readout, s = this.settings, T = this.theme;
    if (!node || !s.showReadout) { r.hidden = true; return; }
    r.hidden = false;
    r.style.background = pal.rgba(T.bg, 0.92);
    r.style.borderColor = T.muted;
    r.style.color = T.ink;
    r.textContent = '';
    var a = document.createElement('div');
    a.className = 'nx-ro-name';
    a.textContent = node.id;
    var g = document.createElement('span');
    g.className = 'nx-ro-group';
    g.textContent = '  ' + ((this.groupName && this.groupName[node.group]) || node.group);
    g.style.color = T.muted;
    a.appendChild(g);
    r.appendChild(a);
    var wl = this.model.weightName ? (' (' + fmtW(node.outW, s) + ' ' + this.model.weightName + ')') : '';
    var wi = this.model.weightName ? (' (' + fmtW(node.inW, s) + ' ' + this.model.weightName + ')') : '';
    function line (rgbHex, text) {
      var d = document.createElement('div');
      if (s.tipSwatch) {
        var sw = document.createElement('span');
        sw.className = 'nx-sw';
        sw.style.background = rgbHex;
        d.appendChild(sw);
      }
      d.appendChild(document.createTextNode(text));
      r.appendChild(d);
    }
    if (s.hoverMode !== 'in') line(T.out, node.out + ' outgoing' + wl);
    if (s.hoverMode !== 'out') line(T.inn, node.inn + ' incoming' + wi);
    this._place(this._pt);
  };

  /* ---------------------------------------------------------------- motion */

  P._kick = function () {
    if (this.raf) return;
    var self = this;
    var loop = function (now) {
      self.raf = 0;
      var more = self._step(now);
      if (more) self.raf = global.requestAnimationFrame(loop);
    };
    this.raf = global.requestAnimationFrame(loop);
  };

  P._step = function (now) {
    var tr = this.trans;
    var more = false;
    var p = tr.dur <= 0 ? 1 : clamp((now - tr.t0) / tr.dur, 0, 1);
    var e = easeInOutCubic(p);
    this.ease = e;
    var items = this.items;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.own) continue;
      var c = it.cur, f = it.from, t = it.to;
      for (var k = 0; k < 5; k++) c[k] = f[k] + (t[k] - f[k]) * e;
    }
    this.layerA = this.layerFrom + (this.layerTo - this.layerFrom) * e;
    if (p < 1) more = true;
    else {
      tr.running = false;
      for (var j = 0; j < items.length; j++) if (!items[j].lit) items[j].own = false;
    }
    if (this.entrance.on) {
      if (now - this.entrance.t0 < this.entrance.dur) more = true; else this.entrance.on = false;
    }
    this._paint(now);
    this.frames++;
    return more;
  };

  P._paint = function (now) {
    var ctx = this.ctx, p = this.planned, s0 = this.settings;
    if (!ctx || !p) return;
    var dpr = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, p.cx * dpr, p.cy * dpr);
    ctx.lineCap = this.settings.linkCap;
    ctx.lineJoin = 'round';
    var ent = 1;
    if (this.entrance.on) ent = (EASES[s0.animEase] || EASES.inout)(clamp(((now || performance.now()) - this.entrance.t0) / this.entrance.dur, 0, 1));
    var items = this.items, s = this.settings;
    var glow = s.glow && this.litCount > 0 && this.litCount <= 160;
    if (this.layer && this.layerA > 0.002) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = this.layerA * ent;
      ctx.drawImage(this.layer, 0, 0);
      ctx.restore();
    }
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.own) continue;
      var c = it.cur;
      if (c[3] < 0.004) continue;
      ctx.globalAlpha = c[3] * ent;
      var col = 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
      ctx.strokeStyle = col;
      ctx.lineWidth = c[4];
      if (glow && it.lit) { ctx.shadowColor = col; ctx.shadowBlur = s.glowSize * dpr; } else ctx.shadowBlur = 0;
      ctx.stroke(it.path);
    }
    ctx.shadowBlur = 0;
    /* Synapse bulbs: a small filled end on each lit link, at the far end. */
    if (s.terminals && this.litCount > 0 && this.litCount <= 400) {
      for (var j = 0; j < items.length; j++) {
        var q = items[j];
        if (!q.lit || q.cur[3] < 0.2) continue;
        var leaf = q.lit === 1 ? q.b : q.a;
        var pos = layoutLib.polar(leaf.x, leaf.y);
        var a = q.cur[3];
        ctx.globalAlpha = a * ent;
        ctx.fillStyle = 'rgb(' + (q.cur[0] | 0) + ',' + (q.cur[1] | 0) + ',' + (q.cur[2] | 0) + ')';
        ctx.beginPath();
        ctx.arc(pos[0], pos[1], Math.max(2.4, q.cur[4] * 0.9 + 1.2) * s.terminalSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  };

  /* Test and debugging view of the live state. */
  P.inspect = function () {
    var items = this.items, s = this.settings || {};
    var own = items.filter(function (it) { return it.own; });
    var lit = items.filter(function (it) { return it.lit; });
    var layerEff = this.layerA * (s.linkOpacity || 0);
    return {
      focus: this.focus, hover: this.hover, pinned: this.pinned, links: items.length, lit: lit.length, own: own.length,
      litAlpha: lit.length ? lit[0].cur[3] : null, dimAlpha: layerEff,
      layerA: this.layerA, layerEff: layerEff,
      ownAlphaMean: own.length ? own.reduce(function (a, it) { return a + it.cur[3]; }, 0) / own.length : 0,
      minAlpha: layerEff, maxAlpha: Math.max(layerEff, own.length ? Math.max.apply(null, own.map(function (it) { return it.cur[3]; })) : 0),
      running: this.trans.running, frames: this.frames, ease: this.ease,
      plan: this.planned ? {
        R: this.planned.R, shown: this.planned.shownCount, hidden: this.planned.hidden, note: this.planned.note, fs: this.planned.fs,
        clipped: this.planned.clipped, labelsOn: this.planned.labelsOn, noteH: this.planned.noteH, cx: this.planned.cx, cy: this.planned.cy
      } : null,
      theme: this.theme
    };
  };

  global.NX.View = View;
  global.NX.measureText = measureText;
})(typeof window !== 'undefined' ? window : globalThis);
