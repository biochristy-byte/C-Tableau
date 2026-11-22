/* Depth Lines - renderer. Builds the SVG, the HTML title and legend, and the
 * tooltip. Layout and density are computed synchronously BEFORE anything is
 * drawn, so nothing jitters. The only motion is a one-time opacity fade-in of
 * the bands (compositor-friendly, eased, skipped for reduced motion). */
(function (global) {
  'use strict';
  var HX = global.HX, E = global.DL.engine;
  var NS = 'http://www.w3.org/2000/svg';

  function esc (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el (tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  function Renderer (root) {
    this.root = root;
    this.titleEl = el('div', 'dl-title');
    this.stage = el('div', 'dl-stage');
    this.legendEl = el('div', 'dl-legend');
    this.tip = el('div', 'dl-tip'); this.tip.hidden = true;
    root.appendChild(this.titleEl); root.appendChild(this.stage); root.appendChild(this.legendEl); root.appendChild(this.tip);
    this.svg = null; this.animated = false; this.selected = {}; this.chartBg = '#ffffff'; this.ink = '#0a1018';
    this.bandCache = {};
  }

  Renderer.prototype.theme = function (model, s) {
    var bg;
    if (s.theme === 'light') bg = '#ffffff';
    else if (s.theme === 'dark') bg = '#081f33';
    else if (s.theme === 'custom') bg = s.bgColor;
    else if (model.worksheetBg && HX.parseColor(model.worksheetBg)) bg = HX.hex(HX.parseColor(model.worksheetBg));
    else bg = (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) ? '#081f33' : '#ffffff';
    return { bg: bg, ink: HX.pickText(bg), dark: HX.isDark(bg) };
  };

  Renderer.prototype.clearSelection = function () { this.selected = {}; };

  Renderer.prototype.draw = function (model, s, hooks) {
    var self = this, th = this.theme(model, s);
    this.hooks = hooks || {}; this.model = model; this.s = s; this.th = th;
    this.chartBg = th.bg; this.ink = th.ink;
    var root = this.root;
    root.style.background = th.bg; root.style.color = th.ink;
    root.style.fontSize = s.fontSize + 'px';
    root.setAttribute('data-theme', th.dark ? 'dark' : 'light');
    root.setAttribute('data-ready', '0');
    this.tip.hidden = true;
    this.tip.style.background = th.ink; this.tip.style.color = th.bg;

    var pts = model.points || [];
    var groups = E.groupPoints(pts, model.hasCategory);
    var multi = model.hasCategory && groups.length > 1 && s.multi === 'small';
    var overlay = model.hasCategory && groups.length > 1 && !multi;
    this.groups = groups; this.multi = multi; this.overlay = overlay;

    /* Title and legend are HTML so they wrap by themselves; the SVG takes what is left. */
    this.titleEl.textContent = s.title || '';
    this.titleEl.style.display = s.title ? '' : 'none';
    this.titleEl.style.fontSize = Math.round(s.fontSize * 1.3) + 'px';
    var W0 = root.clientWidth;
    this._legend(groups, s, th, overlay, W0);

    if (pts.length < 3) {
      this.stage.innerHTML = '<div class="dl-empty">' + esc(model.emptyMessage || 'Put a measure on X and a measure on Y, with a dimension on Detail so each row is one point.') + '</div>';
      this.svg = null; root.setAttribute('data-ready', '1'); root.setAttribute('data-bands', '0');
      return;
    }

    var W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (W < 20 || H < 20) return;
    var fs = s.fontSize;

    /* ---------- domains and tick text, which set the margins */
    var padFrac = Math.min(0.4, Math.max(0.03, s.bandwidth / 100 * 2.4));
    var xd = E.domainOf(pts.map(function (p) { return p.x; }), padFrac);
    var yd = E.domainOf(pts.map(function (p) { return p.y; }), padFrac);
    var showAxes = s.axes, showTitles = s.axes && s.axisTitles && W >= 420 && H >= 320;
    var n = groups.length;
    var gridSpec = multi ? E.gridFor(n, W, H, s.cols) : { cols: 1, rows: 1 };
    var panelTitleH = multi ? Math.round(fs * 1.6) : 0;
    var gap = 14;

    var yTicksGuess = HX.ticks(yd[0], yd[1], Math.max(2, Math.floor(H / (fs * 3.2))));
    var yLabW = 0;
    if (showAxes) yTicksGuess.forEach(function (t) { yLabW = Math.max(yLabW, HX.formatNumber(t, yTicksGuess.step).length); });
    var leftM = 8 + (showAxes ? Math.ceil(yLabW * fs * 0.64) + 10 : 0) + (showTitles ? Math.round(fs * 1.5) : 0);
    var bottomM = 8 + (showAxes ? Math.round(fs * 1.5) + 6 : 0) + (showTitles ? Math.round(fs * 1.6) : 0);
    var topM = 6 + Math.ceil(fs * 0.5), rightM = 14;
    var availW = W - leftM - rightM, availH = H - topM - bottomM;
    var cellW = (availW - (gridSpec.cols - 1) * gap) / gridSpec.cols;
    var rowH = (availH - (gridSpec.rows - 1) * gap) / gridSpec.rows;
    var pw = Math.max(40, Math.floor(cellW)), ph = Math.max(40, Math.floor(rowH - panelTitleH));

    /* ---------- density: all groups on the same grid size so a shared scale is fair */
    var sx = E.linear(xd[0], xd[1], 0, pw), sy = E.linear(yd[0], yd[1], ph, 0);
    var gpts = groups.map(function (g) {
      return { key: g.key, index: g.index, points: g.points.map(function (p) { return { px: sx(p.x), py: sy(p.y), w: p.w, id: p.id, ref: p }; }) };
    });
    var bands = E.computeBands(gpts, pw, ph, s);
    this.bands = bands; this.gpts = gpts; this.plot = { w: pw, h: ph };

    /* ---------- colours */
    var seaShallow = E.rampColor(s.ramp, th.dark, 0, s.reverse);
    var gridCol = HX.mix(th.bg, th.ink, 0.2), axisCol = HX.mix(th.bg, th.ink, 0.55);
    function bandColor (gi, frac) { return overlay ? E.catColor(s.catPalette, gi) : E.rampColor(s.ramp, th.dark, frac, s.reverse); }
    var nLev = s.levels;
    var overlayAlpha = Math.max(0.1, Math.min(0.4, 1.7 / nLev));

    var xt = HX.ticks(xd[0], xd[1], Math.max(2, Math.floor(pw / (fs * 5))));
    var yt = HX.ticks(yd[0], yd[1], Math.max(2, Math.floor(ph / (fs * 3.2))));

    var out = '';
    var defs = '', body = '';
    var gx = leftM, gy = topM;
    /* Small multiples: one panel per group. Overlay (and a lone group): ONE panel
     * that every group draws into, so no later water tint covers an earlier group. */
    var panels = multi ? gpts.map(function (g, gi) { return { members: [gi] }; }) : [{ members: gpts.map(function (g, gi) { return gi; }) }];
    panels.forEach(function (pn, pi) {
      var r = multi ? Math.floor(pi / gridSpec.cols) : 0, c = multi ? pi % gridSpec.cols : 0;
      var x0 = gx + c * (pw + gap), y0 = gy + r * (ph + panelTitleH + gap) + panelTitleH;
      defs += '<clipPath id="dl-clip-' + pi + '"><rect x="0" y="0" width="' + pw + '" height="' + ph + '"/></clipPath>';
      var p = '<g class="dl-panel" data-panel="' + pi + '" transform="translate(' + x0 + ',' + y0 + ')">';
      if (multi) p += '<text class="dl-ptitle" x="0" y="' + (-Math.round(fs * 0.45)) + '" fill="' + th.ink + '" font-size="' + fs + '" font-weight="600">' + esc(gpts[pn.members[0]].key) + '</text>';
      var seaFill = s.sea ? (overlay ? HX.mix(th.bg, th.ink, 0.06) : HX.mix(th.bg, seaShallow, 0.4)) : 'none';
      p += '<rect class="dl-sea" x="0" y="0" width="' + pw + '" height="' + ph + '" fill="' + seaFill + '"/>';
      p += '<g class="dl-clip" clip-path="url(#dl-clip-' + pi + ')">';
      if (s.grid) {
        xt.forEach(function (t) { var X = sx(t).toFixed(1); p += '<line class="dl-grid" x1="' + X + '" x2="' + X + '" y1="0" y2="' + ph + '" stroke="' + gridCol + '" stroke-width="1"/>'; });
        yt.forEach(function (t) { var Y = sy(t).toFixed(1); p += '<line class="dl-grid" x1="0" x2="' + pw + '" y1="' + Y + '" y2="' + Y + '" stroke="' + gridCol + '" stroke-width="1"/>'; });
      }
      pn.members.forEach(function (gi) {
        var gB = bands[gi];
        gB.levels.forEach(function (lv) {
          if (!lv.coordinates.length) return;
          var col = bandColor(gi, lv.frac);
          var fillOp = s.fill ? (overlay ? overlayAlpha : 1) : 0;
          p += '<path class="dl-band" data-g="' + gi + '" data-level="' + lv.index + '" d="' + lv.d + '" fill="' + col + '" fill-opacity="' + fillOp + '" fill-rule="evenodd" style="animation-delay:' + (lv.index * 45) + 'ms"/>';
        });
        if (s.lines) {
          gB.levels.forEach(function (lv) {
            if (!lv.coordinates.length) return;
            var col = bandColor(gi, lv.frac), stroke, op = 0.7;
            if (overlay) { stroke = E.catColor(s.catPalette, gi); op = 0.95; }
            else if (s.lineInk === 'band') { stroke = E.rampColor(s.ramp, th.dark, Math.min(1, lv.frac + 0.22), s.reverse); op = 0.95; }
            else { stroke = s.fill ? HX.pickText(col) : th.ink; }
            p += '<path class="dl-line" d="' + lv.d + '" fill="none" stroke="' + stroke + '" stroke-opacity="' + op + '" stroke-width="' + s.lineWidth + '" stroke-linejoin="round" pointer-events="none" style="animation-delay:' + (lv.index * 45) + 'ms"/>';
          });
        }
      });
      p += '<path class="dl-hl" d="" fill="none" stroke="' + th.ink + '" stroke-width="2.5" pointer-events="none"/>';
      pn.members.forEach(function (gi) {
        gpts[gi].points.forEach(function (pt) {
          var sel = !!self.selected[pt.id];
          if (!s.points && !sel) return;
          var col = overlay ? E.catColor(s.catPalette, gi) : th.ink;
          p += '<circle class="dl-pt' + (sel ? ' sel' : '') + '" data-g="' + gi + '" data-id="' + pt.id + '" cx="' + pt.px.toFixed(1) + '" cy="' + pt.py.toFixed(1) +
            '" r="' + (sel ? s.pointSize * 1.7 : s.pointSize) + '" fill="' + (sel ? '#f2b84b' : col) + '" fill-opacity="' + (sel ? 1 : s.pointOpacity) + '" stroke="' + (sel ? th.ink : th.bg) + '" stroke-width="' + (sel ? 1.5 : 0.8) + '"/>';
        });
      });
      p += '</g>';
      /* axes: only the left column and the bottom edge of each column carry labels */
      var below = multi ? (pi + gridSpec.cols < n) : false;
      if (showAxes) {
        if (c === 0) {
          p += '<line x1="0" x2="0" y1="0" y2="' + ph + '" stroke="' + axisCol + '" stroke-width="1"/>';
          yt.forEach(function (t) { p += '<text class="dl-tick dl-ytick" x="-7" y="' + (sy(t) + fs * 0.35).toFixed(1) + '" text-anchor="end" fill="' + th.ink + '" font-size="' + fs + '">' + esc(HX.formatNumber(t, yt.step)) + '</text>'; });
        }
        if (!below) {
          p += '<line x1="0" x2="' + pw + '" y1="' + ph + '" y2="' + ph + '" stroke="' + axisCol + '" stroke-width="1"/>';
          xt.forEach(function (t) { p += '<text class="dl-tick dl-xtick" x="' + sx(t).toFixed(1) + '" y="' + (ph + fs + 6) + '" text-anchor="middle" fill="' + th.ink + '" font-size="' + fs + '">' + esc(HX.formatNumber(t, xt.step)) + '</text>'; });
        }
      }
      p += '</g>';
      body += p;
    });
    out += '<defs>' + defs + '</defs>' + body;
    if (showTitles) {
      var cx = leftM + (gridSpec.cols * pw + (gridSpec.cols - 1) * gap) / 2;
      var cy = topM + (gridSpec.rows * (ph + panelTitleH) + (gridSpec.rows - 1) * gap) / 2;
      out += '<text class="dl-axtitle" id="dl-xtitle" x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" fill="' + th.ink + '" font-size="' + fs + '" font-weight="600">' + esc(model.xName) + '</text>';
      out += '<text class="dl-axtitle" id="dl-ytitle" transform="translate(' + (fs + 2) + ',' + cy.toFixed(1) + ') rotate(-90)" text-anchor="middle" fill="' + th.ink + '" font-size="' + fs + '" font-weight="600">' + esc(model.yName) + '</text>';
    }
    this.stage.innerHTML = '<svg class="dl-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc('Density contours of ' + model.yName + ' against ' + model.xName) + '">' + out + '</svg>';
    this.svg = this.stage.firstChild;

    /* Thin overlapping tick labels. Titles are first, so ticks give way to them. */
    var order = [].slice.call(this.svg.querySelectorAll('.dl-axtitle, .dl-ptitle'))
      .concat([].slice.call(this.svg.querySelectorAll('.dl-xtick')), [].slice.call(this.svg.querySelectorAll('.dl-ytick')));
    this.thinned = HX.thin(order, 8);

    var anim = !this.animated && !global.DL_STILL && !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.root.classList.toggle('dl-anim', anim);
    this.animated = true;

    this._wire();
    root.setAttribute('data-bands', String(bands.reduce(function (a, b) { return a + b.levels.filter(function (l) { return l.coordinates.length; }).length; }, 0)));
    root.setAttribute('data-panels', String(panels.length));
    root.setAttribute('data-ready', '1');
  };

  Renderer.prototype._legend = function (groups, s, th, overlay, W) {
    var L = this.legendEl, h = '';
    L.style.display = s.legend ? '' : 'none';
    if (!s.legend) { L.innerHTML = ''; return; }
    if (overlay) {
      groups.forEach(function (g, gi) { h += '<span class="dl-chip"><i style="background:' + E.catColor(s.catPalette, gi) + '"></i>' + esc(g.key) + '</span>'; });
      h += '<span class="dl-note">Deeper bands are denser</span>';
    } else if (W >= 340) {
      var stops = [0, 0.25, 0.5, 0.75, 1].map(function (t) { return E.rampColor(s.ramp, th.dark, t, s.reverse); }).join(',');
      h += '<span class="dl-note">Shallow</span><span class="dl-ramp" style="background:linear-gradient(90deg,' + stops + ');border-color:' + HX.mix(th.bg, th.ink, 0.5) + '"></span><span class="dl-note">Deep</span>';
    } else {
      h += '<span class="dl-note">Deeper is denser</span>';
    }
    L.innerHTML = h;
  };

  Renderer.prototype._pointsIn = function (gi, level) {
    var key = gi + ':' + level + ':' + this.s.bandwidth + ':' + this.s.levels + ':' + this.s.floor + ':' + this.plot.w + 'x' + this.plot.h;
    if (this.bandCache[key]) return this.bandCache[key];
    var lv = this.bands[gi].levels[level], ids = [];
    this.gpts[gi].points.forEach(function (p) { if (E.inMulti(p.px, p.py, lv.coordinates)) ids.push(p.id); });
    this.bandCache = {}; this.bandCache[key] = ids;
    return ids;
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
    var self = this, svg = this.svg, s = this.s, model = this.model;
    function clearHl () { [].forEach.call(svg.querySelectorAll('.dl-hl'), function (p) { p.setAttribute('d', ''); }); }
    function over (e) {
      var t = e.target;
      if (t.classList.contains('dl-pt')) {
        clearHl();
        var gi = +t.getAttribute('data-g'), id = +t.getAttribute('data-id');
        var pt = self.gpts[gi].points.filter(function (p) { return p.id === id; })[0];
        if (!pt) return;
        var r = pt.ref;
        self._place(e, (model.hasCategory ? '<b>' + esc(r.cat) + '</b><br>' : '') + esc(model.xName) + ': ' + esc(HX.formatNumber(r.x)) + '<br>' + esc(model.yName) + ': ' + esc(HX.formatNumber(r.y)));
        if (s.hoverEnabled && self.hooks.onHover) self.hooks.onHover(id);
      } else if (t.classList.contains('dl-band')) {
        var g = +t.getAttribute('data-g'), lvl = +t.getAttribute('data-level');
        clearHl();
        var panel = t.parentNode;
        panel.querySelector('.dl-hl').setAttribute('d', self.bands[g].levels[lvl].d);
        var count = self._pointsIn(g, lvl).length;
        self._place(e, (model.hasCategory ? '<b>' + esc(self.groups[g].key) + '</b><br>' : '') + 'Depth band ' + (lvl + 1) + ' of ' + s.levels + '<br>' + count + ' point' + (count === 1 ? '' : 's') + ' inside');
        if (s.hoverEnabled && self.hooks.onHover) self.hooks.onHover(null);
      } else { clearHl(); self.tip.hidden = true; if (self.hooks.onHover) self.hooks.onHover(null); }
    }
    svg.addEventListener('mousemove', over);
    svg.addEventListener('mouseleave', function () { clearHl(); self.tip.hidden = true; if (self.hooks.onHover) self.hooks.onHover(null); });
    svg.addEventListener('click', function (e) {
      if (!s.selectEnabled) return;
      var t = e.target, ids = [];
      if (t.classList.contains('dl-band')) ids = self._pointsIn(+t.getAttribute('data-g'), +t.getAttribute('data-level'));
      else if (t.classList.contains('dl-pt')) ids = [+t.getAttribute('data-id')];
      self.selected = {}; ids.forEach(function (i) { self.selected[i] = true; });
      if (self.hooks.onSelect) self.hooks.onSelect(ids);
      self._restyleSelection();
    });
  };

  /* Selection restyle without a full redraw, so the click feels instant. */
  Renderer.prototype._restyleSelection = function () {
    var self = this;
    [].forEach.call(this.svg.querySelectorAll('.dl-pt'), function (c) { c.parentNode.removeChild(c); });
    this.gpts.forEach(function (g, gi) {
      var anyBand = self.svg.querySelector('path.dl-band[data-g="' + gi + '"]');
      var layer = anyBand ? anyBand.parentNode : self.svg.querySelector('.dl-clip');
      g.points.forEach(function (pt) {
        var sel = !!self.selected[pt.id];
        if (!sel && !self.s.points) return;
        var c = document.createElementNS(NS, 'circle');
        c.setAttribute('class', 'dl-pt' + (sel ? ' sel' : '')); c.setAttribute('data-g', gi); c.setAttribute('data-id', pt.id);
        c.setAttribute('cx', pt.px.toFixed(1)); c.setAttribute('cy', pt.py.toFixed(1));
        c.setAttribute('r', sel ? self.s.pointSize * 1.7 : self.s.pointSize);
        c.setAttribute('fill', sel ? '#f2b84b' : (self.overlay ? E.catColor(self.s.catPalette, gi) : self.th.ink));
        c.setAttribute('fill-opacity', sel ? 1 : self.s.pointOpacity);
        c.setAttribute('stroke', sel ? self.th.ink : self.th.bg); c.setAttribute('stroke-width', sel ? 1.5 : 0.8);
        layer.appendChild(c);
      });
    });
  };

  global.DL.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
