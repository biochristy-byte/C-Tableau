/* Panel Chart - the SVG renderer. Paints the layout from model.js and glides every mark from where it was to where
 * it goes with one requestAnimationFrame loop (geometry only, no layout thrash). Marks keep their DOM element across
 * draws, keyed by series and category, so a sort, a stack change or new data moves the same bar instead of redrawing.
 * A change of chart type cross-fades: the old marks fade while the new ones grow from the baseline.
 */
(function (global) {
  'use strict';
  var PC = global.PC = global.PC || {}, CP = global.CTabPanel, M = PC.model, C = CP.color;
  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  var EASE = { out: function (t) { return 1 - Math.pow(1 - t, 3); }, inout: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }, linear: function (t) { return t; } };
  var DASH = { dashed: '6 4', dotted: '1.5 3.5' };

  function shapePath(shape, x, y, r) {
    if (r <= 0) return 'M' + x + ',' + y + 'Z';
    if (shape === 'square') return 'M' + (x - r) + ',' + (y - r) + 'h' + 2 * r + 'v' + 2 * r + 'h' + -2 * r + 'Z';
    if (shape === 'diamond') { var d = r * 1.3; return 'M' + x + ',' + (y - d) + 'L' + (x + d) + ',' + y + 'L' + x + ',' + (y + d) + 'L' + (x - d) + ',' + y + 'Z'; }
    if (shape === 'triangle') { var t = r * 1.35; return 'M' + x + ',' + (y - t) + 'L' + (x + t * 0.95) + ',' + (y + t * 0.7) + 'L' + (x - t * 0.95) + ',' + (y + t * 0.7) + 'Z'; }
    return 'M' + (x - r) + ',' + y + 'a' + r + ',' + r + ' 0 1,0 ' + 2 * r + ',0a' + r + ',' + r + ' 0 1,0 ' + -2 * r + ',0Z';
  }

  function Renderer(host) {
    this.host = host;
    this.svg = el('svg', { 'class': 'pc-svg', role: 'img' }, host);
    this.gGrid = el('g', { 'class': 'pc-grid' }, this.svg);
    this.gMarks = el('g', { 'class': 'pc-marks' }, this.svg);
    this.gAxis = el('g', { 'class': 'pc-axis' }, this.svg);
    this.gText = el('g', { 'class': 'pc-texts' }, this.svg);
    this.gLegend = el('g', { 'class': 'pc-legend' }, this.svg);
    this.cross = el('line', { 'class': 'pc-cross', visibility: 'hidden' }, this.svg);
    this.overlay = el('rect', { 'class': 'pc-overlay', fill: 'transparent', x: 0, y: 0, width: 0, height: 0 }, this.svg);
    this.tip = document.createElement('div'); this.tip.className = 'pc-tip'; this.tip.hidden = true; this.tip.setAttribute('role', 'status'); host.appendChild(this.tip);
    this.empty = document.createElement('div'); this.empty.className = 'pc-empty'; this.empty.hidden = true; host.appendChild(this.empty);
    this.nodes = {}; this.geo = {}; this.anim = null; this.animating = false; this.frames = 0; this.lastTween = null;
    this.chartBg = '#ffffff'; this.ink = '#14202e'; this.items = []; this.catItems = []; this.selected = null; this.hot = null; this.L = null;
    this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d');
    var self = this;
    this.overlay.addEventListener('pointermove', function (e) { self.pointer(e, false); });
    this.overlay.addEventListener('pointerleave', function () { self.leave(); });
    this.overlay.addEventListener('click', function (e) { self.pointer(e, true); });
  }

  Renderer.prototype.measure = function (stack) {
    var ctx = this.ctx, cache = {};
    return function (text, size, weight) {
      var k = weight + size + '|' + text;
      if (cache[k] === undefined) { ctx.font = (weight === 'bold' ? '700 ' : '400 ') + size + 'px ' + stack; cache[k] = Math.ceil(ctx.measureText(String(text)).width) + 1; }
      return cache[k];
    };
  };

  Renderer.prototype.draw = function (data, s, cb) {
    this.cb = cb || {}; this.s = s; this.data = data;
    var host = this.host, W = Math.max(40, host.clientWidth), H = Math.max(40, host.clientHeight);
    var wsBg = C.legalBg(C.normHex(data.worksheetBg) || '#ffffff');
    var bg = s.bgMode === 'custom' ? C.legalBg(C.normHex(s.bgColor) || wsBg) : wsBg;
    var stack = CP.fontStack(s.fontFamily);
    host.style.background = s.bgMode === 'transparent' ? 'transparent' : bg;
    host.style.fontFamily = stack;
    host.style.setProperty('--pc-hover-ms', (s.hoverMs || 0) + 'ms');
    host.style.setProperty('--pc-dim', String((s.dimOthers || 30) / 100));
    host.style.border = s.borderOn ? (s.borderWidth || 1) + 'px solid ' + (C.normHex(s.borderColor) || '#8fa7b8') : 'none';
    host.style.borderRadius = s.borderOn ? (s.borderRadius || 0) + 'px' : '0';
    if (s.borderOn) { W -= 2 * (s.borderWidth || 1); H -= 2 * (s.borderWidth || 1); }
    var L = M.layout(data, s, { W: W, H: H, bg: bg, measure: this.measure(stack) });
    this.L = L; this.chartBg = bg; this.ink = L.ink; this.items = L.seriesItems || []; this.catItems = L.catItems || [];
    var svg = this.svg;
    svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.dataset.type = s.chartType; svg.dataset.sort = s.sort; svg.dataset.mode = L.mode || ''; svg.dataset.marks = String(L.marks.length);
    svg.setAttribute('aria-label', (s.chartType || 'bar') + ' chart of ' + (data.valueName || 'values') + (data.catName ? ' by ' + data.catName : ''));
    this.empty.hidden = !L.empty; this.empty.textContent = L.empty || ''; this.empty.style.color = L.ink;
    this.paintStatic(L, s);
    this.paintMarks(L, s);
    var p = L.plot || { l: 0, t: 0, r: 0, b: 0 };
    this.overlay.setAttribute('x', p.l); this.overlay.setAttribute('y', p.t); this.overlay.setAttribute('width', Math.max(0, p.r - p.l)); this.overlay.setAttribute('height', Math.max(0, p.b - p.t));
    this.leave(true);
    this.applySelection();
  };

  Renderer.prototype.paintStatic = function (L, s) {
    var g = '', a = '', t = '', lg = '';
    L.grid.forEach(function (l) { g += '<line x1="' + l.x1 + '" y1="' + l.y1 + '" x2="' + l.x2 + '" y2="' + l.y2 + '" stroke="' + l.color + '" stroke-width="1"' + (DASH[l.dash] ? ' stroke-dasharray="' + DASH[l.dash] + '" stroke-linecap="round"' : '') + '/>'; });
    L.lines.forEach(function (l) { a += '<line class="' + (l.ref ? 'pc-ref' : 'pc-axisline') + '" x1="' + l.x1 + '" y1="' + l.y1 + '" x2="' + l.x2 + '" y2="' + l.y2 + '" stroke="' + l.color + '" stroke-width="' + l.w + '"' + (DASH[l.dash] ? ' stroke-dasharray="' + DASH[l.dash] + '"' : '') + '/>'; });
    L.texts.forEach(function (x) {
      t += '<text class="pc-text pc-' + x.kind + '" data-kind="' + x.kind + '" data-bg="' + x.bg + '"' + (x.key ? ' data-k="' + esc(x.key) + '"' : '') + ' x="' + x.x.toFixed(1) + '" y="' + x.y.toFixed(1) + '" text-anchor="' + x.anchor + '" dominant-baseline="central" font-size="' + x.size + '" font-weight="' + (x.weight === 'bold' ? 700 : 400) + '" fill="' + x.fill + '"' +
        (x.rotate ? ' transform="rotate(' + x.rotate + ' ' + x.x.toFixed(1) + ' ' + x.y.toFixed(1) + ')"' : '') + '>' + (x.full && x.full !== x.text ? '<title>' + esc(x.full) + '</title>' : '') + esc(x.text) + '</text>';
    });
    L.legend.forEach(function (k) {
      var c = k.color, z = k.size, sh = s.legendSwatch;
      if (sh === 'circle') lg += '<circle cx="' + (k.x + z / 2) + '" cy="' + (k.y + z / 2) + '" r="' + z / 2 + '" fill="' + c + '"/>';
      else if (sh === 'line') lg += '<line x1="' + k.x + '" y1="' + (k.y + z / 2) + '" x2="' + (k.x + z) + '" y2="' + (k.y + z / 2) + '" stroke="' + c + '" stroke-width="4" stroke-linecap="round"/>';
      else lg += '<rect x="' + k.x + '" y="' + k.y + '" width="' + z + '" height="' + z + '" rx="2" fill="' + c + '"/>';
    });
    this.gGrid.innerHTML = g; this.gAxis.innerHTML = a; this.gText.innerHTML = t; this.gLegend.innerHTML = lg;
  };

  /* Geometry of a mark as a flat object of numbers (or a point map for lines and areas). */
  function target(m, L) {
    if (m.kind === 'bar' || m.kind === 'dot' || m.kind === 'point') return { x: m.g.x, y: m.g.y, w: m.g.w, h: m.g.h, r: m.g.r };
    if (m.kind === 'trend') return { x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2 };
    var pts = {}; m.pts.forEach(function (p) { pts[p.c] = [p.x, p.y, p.y0]; }); return { pts: pts, order: m.pts.map(function (p) { return p.c; }) };
  }
  function entering(m, L, tgt) {
    var base = L.plot ? (L.horiz ? L.plot.l : L.plot.b) : 0;
    if (L.vmin !== undefined && L.plot) { var f = (Math.max(L.vmin, Math.min(L.vmax, 0)) - L.vmin) / ((L.vmax - L.vmin) || 1); base = L.horiz ? L.plot.l + f * (L.plot.r - L.plot.l) : L.plot.b - f * (L.plot.b - L.plot.t); }
    if (m.kind === 'bar') return L.horiz ? { x: base, y: tgt.y, w: 0, h: tgt.h } : { x: tgt.x, y: base, w: tgt.w, h: 0 };
    if (m.kind === 'dot' || m.kind === 'point') return { x: tgt.x, y: tgt.y, r: 0 };
    if (m.kind === 'trend') return { x1: tgt.x1, y1: tgt.y1, x2: tgt.x1, y2: tgt.y1 };
    var pts = {}; Object.keys(tgt.pts).forEach(function (c) { var p = tgt.pts[c]; pts[c] = [p[0], base, base]; }); return { pts: pts, order: tgt.order };
  }

  Renderer.prototype.paintMarks = function (L, s) {
    var self = this, live = {}, items = [];
    var reduce = false; try { reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduce = false; }
    var ms = s.animOn && !reduce ? s.animMs : 0, ease = EASE[s.animEase] || EASE.out;
    this.lastTween = { ms: ms, ease: s.animEase };
    var ringBg = this.chartBg;
    L.marks.forEach(function (m) {
      var id = m.kind + ':' + m.key; live[id] = 1;
      var node = self.nodes[id], tgt = target(m, L), from;
      if (!node) {
        node = el(m.kind === 'trend' ? 'line' : 'path', { 'class': 'pc-mark pc-' + m.kind }, self.gMarks);
        if (m.kind === 'area') node.__top = el('path', { 'class': 'pc-mark pc-areatop', fill: 'none' }, self.gMarks);
        self.nodes[id] = node; from = entering(m, L, tgt);
      } else {
        from = self.geo[id] || entering(m, L, tgt);
        if (tgt.pts) { var fp = {}; tgt.order.forEach(function (c) { fp[c] = (from.pts && from.pts[c]) || entering(m, L, tgt).pts[c]; }); from = { pts: fp, order: tgt.order }; }
      }
      node.__m = m; node.__exit = false;
      node.dataset.k = m.cat !== undefined ? m.cat : ''; node.dataset.s = m.ser;
      node.style.opacity = '';
      if (m.kind === 'bar') {
        node.setAttribute('fill', m.color); node.setAttribute('fill-opacity', (s.barOpacity || 100) / 100);
        if (s.barOutline) { node.setAttribute('stroke', C.mix(m.color, self.ink, 0.45)); node.setAttribute('stroke-width', s.barOutlineWidth); } else node.removeAttribute('stroke');
      } else if (m.kind === 'line' || m.kind === 'trend') {
        node.setAttribute('fill', 'none'); node.setAttribute('stroke', m.color); node.setAttribute('stroke-width', m.kind === 'trend' ? 2 : s.lineWidth);
        node.setAttribute('stroke-linejoin', 'round'); node.setAttribute('stroke-linecap', 'round'); node.setAttribute('stroke-opacity', 1);
        var dsh = m.kind === 'trend' ? '7 5' : DASH[s.lineDash]; if (dsh) node.setAttribute('stroke-dasharray', dsh); else node.removeAttribute('stroke-dasharray');
      } else if (m.kind === 'area') {
        node.setAttribute('fill', m.color); node.setAttribute('fill-opacity', (s.areaOpacity || 40) / 100); node.setAttribute('stroke', 'none');
        var top = node.__top; top.setAttribute('stroke', m.color); top.setAttribute('stroke-width', s.lineWidth); top.setAttribute('stroke-linejoin', 'round'); top.setAttribute('stroke-opacity', 1);
        top.style.display = s.areaLine ? '' : 'none';
        if (DASH[s.lineDash]) top.setAttribute('stroke-dasharray', DASH[s.lineDash]); else top.removeAttribute('stroke-dasharray');
      } else {
        node.setAttribute('fill', m.color); node.setAttribute('fill-opacity', (m.kind === 'point' ? s.pointOpacity : 100) / 100);
        if (s.pointRing) { node.setAttribute('stroke', ringBg); node.setAttribute('stroke-width', 1.25); } else node.removeAttribute('stroke');
      }
      self.gMarks.appendChild(node); if (node.__top) self.gMarks.appendChild(node.__top);
      items.push({ id: id, node: node, m: m, from: from, to: tgt });
    });
    Object.keys(this.nodes).forEach(function (id) {
      if (live[id]) return;
      var node = self.nodes[id]; delete self.nodes[id]; delete self.geo[id];
      if (!ms) { if (node.__top) node.__top.remove(); node.remove(); return; }
      node.__exit = true; items.push({ id: id, node: node, exit: true });
    });
    function apply(it, t) {
      var n = it.node, m = it.m;
      if (it.exit) { var o = String(1 - t); n.style.opacity = o; if (n.__top) n.__top.style.opacity = o; if (t >= 1) { if (n.__top) n.__top.remove(); n.remove(); } return; }
      var a = it.from, b = it.to, g;
      if (b.pts) {
        var pts = b.order.map(function (c) { var p = a.pts[c] || b.pts[c], q = b.pts[c]; return [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)]; });
        g = { pts: {}, order: b.order }; b.order.forEach(function (c, i) { g.pts[c] = pts[i]; });
        var curve = s.curve, top = M.curvePath(pts.map(function (p) { return [p[0], p[1]]; }), curve);
        if (m.kind === 'line') n.setAttribute('d', top);
        else {
          var basePts = pts.slice().reverse().map(function (p) { return [p[0], p[2]]; }), bottom = M.curvePath(basePts, curve);
          n.setAttribute('d', top + (bottom ? 'L' + bottom.slice(1) : '') + 'Z'); n.__top.setAttribute('d', top);
        }
      } else if (m.kind === 'trend') {
        g = { x1: lerp(a.x1, b.x1, t), y1: lerp(a.y1, b.y1, t), x2: lerp(a.x2, b.x2, t), y2: lerp(a.y2, b.y2, t) };
        n.setAttribute('x1', g.x1); n.setAttribute('y1', g.y1); n.setAttribute('x2', g.x2); n.setAttribute('y2', g.y2);
      } else if (m.kind === 'bar') {
        g = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
        var r = Math.max(0, Math.min(s.barRadius || 0, g.w / 2, g.h / 2));
        n.setAttribute('d', 'M' + (g.x + r) + ',' + g.y + 'h' + (g.w - 2 * r) + (r ? 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r : '') + 'v' + (g.h - 2 * r) + (r ? 'a' + r + ',' + r + ' 0 0 1 ' + -r + ',' + r : '') + 'h' + -(g.w - 2 * r) + (r ? 'a' + r + ',' + r + ' 0 0 1 ' + -r + ',' + -r : '') + 'v' + -(g.h - 2 * r) + (r ? 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + -r : '') + 'Z');
      } else {
        g = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), r: lerp(a.r || 0, b.r, t) };
        n.setAttribute('d', shapePath(s.pointShape, +g.x.toFixed(2), +g.y.toFixed(2), +g.r.toFixed(2)));
      }
      self.geo[it.id] = g;
    }
    if (this.anim) { global.cancelAnimationFrame(this.anim); this.anim = null; }
    if (!ms) { items.forEach(function (it) { apply(it, 1); }); this.animating = false; return; }
    var t0 = null; this.animating = true;
    function frame(now) {
      if (t0 === null) t0 = now;
      var k = Math.min(1, (now - t0) / ms), e = ease(k);
      for (var i = 0; i < items.length; i++) apply(items[i], items[i].exit ? k : e);
      self.frames++;
      if (k < 1) self.anim = global.requestAnimationFrame(frame);
      else { self.anim = null; self.animating = false; }
    }
    items.forEach(function (it) { apply(it, 0); });
    this.anim = global.requestAnimationFrame(frame);
  };

  /* ------------------------------------------------------------ hover, tooltip, selection */

  Renderer.prototype.find = function (x, y) {
    var L = this.L; if (!L || !L.plot) return null;
    var best = null, bd = Infinity;
    if (L.type === 'line' || L.type === 'area') {
      var i = Math.round(((L.horiz ? y - L.plot.t : x - L.plot.l) / L.band) - 0.5);
      if (i < 0 || i >= L.cats.length) return null;
      return { group: true, cat: L.cats[i], x: L.plot.l + L.band * (i + 0.5) };
    }
    L.marks.forEach(function (m) {
      if (m.kind === 'bar') { var g = m.g; if (x >= g.x - 2 && x <= g.x + g.w + 2 && y >= g.y - 2 && y <= g.y + g.h + 2) { best = m; bd = 0; } }
      else if (m.kind === 'point' || m.kind === 'dot') { var d = Math.hypot(m.g.x - x, m.g.y - y); if (d < Math.max(12, m.g.r + 6) && d < bd) { best = m; bd = d; } }
    });
    return best;
  };

  Renderer.prototype.pointer = function (e, click) {
    var s = this.s, r = this.svg.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, f = this.find(x, y);
    if (click) {
      if (!s.selectOn) return;
      var m = f && !f.group ? f : f && f.group ? { cat: f.cat, ser: null } : null;
      this.selected = m ? { cat: m.cat, ser: s.selectBy === 'mark' ? m.ser : null } : null;
      this.applySelection();
      if (this.cb.onSelect) this.cb.onSelect(this.selected ? [this.selected] : []);
      return;
    }
    this.hover(f, x, y);
  };

  Renderer.prototype.hover = function (f, x, y) {
    var s = this.s, L = this.L, self = this;
    var id = f ? (f.group ? 'g|' + f.cat : f.key) : null;
    if (s.hoverOn) {
      var hotCat = f ? f.cat : null;
      Object.keys(this.nodes).forEach(function (k) {
        var n = self.nodes[k], m = n.__m; if (!m) return;
        var dim = !!f && !f.group && m.kind !== 'line' && m.kind !== 'area' && m.kind !== 'trend' && m.cat !== hotCat;
        n.classList.toggle('pc-dim', dim);
        n.classList.toggle('pc-hot', !!f && m.cat === hotCat && (m.kind === 'dot' || m.kind === 'point' || m.kind === 'bar'));
      });
      if (f && f.group && s.crosshair && L.plot) { var c = this.cross; c.setAttribute('x1', f.x); c.setAttribute('x2', f.x); c.setAttribute('y1', L.plot.t); c.setAttribute('y2', L.plot.b); c.setAttribute('stroke', C.mix(this.chartBg, this.ink, 0.6)); c.setAttribute('visibility', 'visible'); }
      else this.cross.setAttribute('visibility', 'hidden');
    }
    if (id !== this.hot) { this.hot = id; if (this.cb.onHover) this.cb.onHover(f && !f.group ? f : f && f.group ? L.marks.filter(function (m) { return m.cat === f.cat && m.tuples; })[0] || null : null); }
    this.showTip(f, x, y);
    if (!f) this.applySelection();
  };

  Renderer.prototype.leave = function (quiet) {
    var self = this;
    Object.keys(this.nodes).forEach(function (k) { self.nodes[k].classList.remove('pc-dim'); self.nodes[k].classList.remove('pc-hot'); });
    this.cross.setAttribute('visibility', 'hidden'); this.tip.hidden = true;
    if (!quiet && this.hot !== null && this.cb.onHover) this.cb.onHover(null);
    this.hot = null;
    if (!quiet) this.applySelection();
  };

  Renderer.prototype.applySelection = function () {
    var sel = this.selected, self = this; if (!sel) return;
    Object.keys(this.nodes).forEach(function (k) {
      var m = self.nodes[k].__m; if (!m || m.kind === 'line' || m.kind === 'area' || m.kind === 'trend') return;
      self.nodes[k].classList.toggle('pc-dim', !(m.cat === sel.cat && (!sel.ser || m.ser === sel.ser)));
    });
  };

  Renderer.prototype.showTip = function (f, x, y) {
    var s = this.s, L = this.L, tip = this.tip;
    if (!f || !s.tipOn) { tip.hidden = true; return; }
    var tk = C.tokens(this.chartBg, this.ink), rows = [], data = this.data;
    var catLab = (L.catNames && L.catNames[f.cat]) || f.cat;
    if (f.group) L.marks.forEach(function (m) { if (m.kind === 'dot' && m.cat === f.cat) rows.push(m); });
    if (f.group && !rows.length) {
      L.marks.forEach(function (m) { if ((m.kind === 'line' || m.kind === 'area')) m.pts.forEach(function (p) { if (p.c === f.cat) rows.push({ ser: m.ser, v: p.v, color: m.color }); }); });
    }
    if (!f.group) rows = [f];
    var names = {}; (this.items || []).forEach(function (it) { names[it.key] = it.name; });
    (s.catColors || []).forEach(function (it) { if (it.name) names[it.key] = it.name; });
    var h = '<div class="pc-tip-h">' + esc((data.catName ? data.catName + ': ' : '') + catLab) + '</div>';
    rows.forEach(function (m) {
      var label = data.hasSeries ? (names[m.ser] || m.ser) : data.valueName;
      h += '<div class="pc-tip-r">' + (s.tipSwatch ? '<span class="pc-sw" style="background:' + m.color + '"></span>' : '') + '<span class="pc-tip-n">' + esc(label) + '</span> <b>' + esc(L.fmt(m.v)) + '</b></div>';
      if (m.kind === 'point' && data.hasX && typeof m.xv === 'number') h += '<div class="pc-tip-r"><span class="pc-tip-n">' + esc(data.xName) + '</span> <b>' + esc(CP.formatNumber(m.xv, s)) + '</b></div>';
    });
    tip.innerHTML = h; tip.hidden = false;
    var st = tip.style; st.background = tk.bg; st.color = tk.ink; st.borderColor = tk.border; st.fontSize = Math.max(14, s.tipSize || 14) + 'px'; st.maxWidth = (s.tipMaxW || 280) + 'px';
    tip.style.setProperty('--pc-tip-muted', tk.muted);
    var W = this.host.clientWidth, H = this.host.clientHeight, tw = tip.offsetWidth, th = tip.offsetHeight, px, py;
    if (s.tipFollow === 'corner' && L.plot) { px = L.plot.l + 6; py = L.plot.t + 6; }
    else { px = x + 14; py = y + 14; if (px + tw > W - 4) px = x - tw - 14; if (py + th > H - 4) py = y - th - 14; }
    px = Math.max(4, Math.min(W - tw - 4, px)); py = Math.max(4, Math.min(H - th - 4, py));
    st.transform = 'translate(' + Math.round(px) + 'px,' + Math.round(py) + 'px)';
  };

  PC.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
