/* Depth Lines - renderer. Builds the SVG, the HTML title and legend, and the
 * tooltip. Layout and density are computed synchronously BEFORE anything is
 * drawn, so nothing jitters. The only motion is a one-time opacity fade-in of
 * the bands (compositor-friendly, eased, skipped for reduced motion) and the
 * eased fade of the hover highlight. Every setting comes from the ctab-panel
 * schema in settings.js. */
(function (global) {
  'use strict';
  var HX = global.HX, E = global.DL.engine, CP = global.CTabPanel;
  var DASH = { solid: '', dashed: '6 4', dotted: '1.5 3.5' };
  var EASE = { out: 'cubic-bezier(.22,.61,.36,1)', inout: 'cubic-bezier(.65,0,.35,1)', linear: 'linear' };

  function esc (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function el (tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function num (v) { var n = parseFloat(v); return isFinite(n) ? n : null; }

  function Renderer (root) {
    this.root = root;                                   /* the frame: data-* attributes, and the settings panel lives here */
    this.chart = el('div', 'dl-chart'); root.appendChild(this.chart);
    this.titleEl = el('div', 'dl-title');
    this.stage = el('div', 'dl-stage');
    this.legendEl = el('div', 'dl-legend');
    this.tip = el('div', 'dl-tip'); this.tip.hidden = true;
    var c = this.chart;
    c.appendChild(this.titleEl); c.appendChild(this.stage); c.appendChild(this.legendEl); c.appendChild(this.tip);
    this.svg = null; this.animated = false; this.selected = {}; this.chartBg = '#ffffff'; this.ink = '#0a1018';
    this.bandCache = {};
  }

  Renderer.prototype.theme = function (model, s) {
    var ws;
    if (model.worksheetBg && HX.parseColor(model.worksheetBg)) ws = HX.hex(HX.parseColor(model.worksheetBg));
    else ws = (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches) ? '#081f33' : '#ffffff';
    var bg = s.bgMode === 'custom' ? s.bgColor : ws;
    return { bg: bg, ink: HX.pickText(bg), dark: HX.isDark(bg), transparent: s.bgMode === 'transparent' };
  };

  Renderer.prototype.clearSelection = function () { this.selected = {}; };

  /* The groups that will draw, in the user's order, with their shown name and color. Hidden ones are dropped. */
  Renderer.prototype.resolveGroups = function (model, s) {
    var all = E.groupPoints(model.points || [], model.hasCategory);
    if (!model.hasCategory) return all.map(function (g) { g.name = g.key; g.color = ''; return g; });
    var pal = CP.paletteColors(s.palette, s.paletteReverse);
    var items = all.map(function (g, i) { return { key: g.key, name: g.key, color: pal[i % pal.length] }; });
    var byKey = {}; all.forEach(function (g) { byKey[g.key] = g; });
    var out = [];
    CP.mergeList(s.catColors, items).forEach(function (m) {
      if (m.hidden || !byKey[m.key]) return;
      var g = byKey[m.key]; g.name = m.name; g.color = m.color; out.push(g);
    });
    out.forEach(function (g, i) { g.index = i; });
    return out;
  };

  /* Tick text. With the number format at its defaults this is the original tick text, so an old workbook looks the same. */
  Renderer.prototype.tick = function (v, step) {
    var s = this.s;
    var custom = s.numCompact || s.numPrefix || s.numSuffix || s.numScale !== '1' || s.numThousands !== 'comma';
    if (!custom) return HX.formatNumber(v, step);
    var dec = step && step > 0 ? Math.max(0, Math.min(6, -Math.floor(Math.log(step) / Math.LN10 + 1e-9))) : 0;
    return CP.formatNumber(v, Object.assign({}, s, { numDecimals: dec }));
  };

  function wrapLines (text, maxW, fs, maxLines) {
    var cw = fs * 0.6, per = Math.max(4, Math.floor(maxW / cw)), words = String(text).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      while (w.length > per) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, per)); w = w.slice(per); }
      if (!cur) cur = w; else if ((cur + ' ' + w).length <= per) cur += ' ' + w; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); var l = lines[maxLines - 1]; lines[maxLines - 1] = (l.length > per - 1 ? l.slice(0, per - 1) : l) + '…'; }
    return lines;
  }

  Renderer.prototype.draw = function (model, s, hooks) {
    var self = this, th = this.theme(model, s);
    this.hooks = hooks || {}; this.model = model; this.s = s; this.th = th;
    this.chartBg = th.bg; this.ink = th.ink;
    var root = this.root, chart = this.chart;
    var lc = s.labelColor ? CP.color.ensureContrast(s.labelColor, [th.bg], 7) : th.ink;
    this.lc = lc;
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
    chart.style.setProperty('--dl-ms', (animOn ? s.animMs : 0) + 'ms');
    chart.style.setProperty('--dl-ease', EASE[s.animEase] || EASE.out);
    chart.style.setProperty('--dl-hover-ms', s.hoverMs + 'ms');
    chart.style.setProperty('--dl-dim', String(s.dimOthers / 100));
    this.tip.hidden = true;
    this.tip.style.background = th.ink; this.tip.style.color = th.bg;
    this.tip.style.fontSize = s.tipSize + 'px'; this.tip.style.maxWidth = s.tipMaxW + 'px';
    this.tip.setAttribute('data-follow', s.tipFollow);

    var groups = this.resolveGroups(model, s);
    var multi = model.hasCategory && groups.length > 1 && s.multi === 'small';
    var overlay = model.hasCategory && groups.length > 1 && !multi;
    this.groups = groups; this.multi = multi; this.overlay = overlay;
    var pts = [];
    groups.forEach(function (g) { pts = pts.concat(g.points); });
    var colorOf = function (gi) { return groups[gi].color; };
    this.colorOf = colorOf;

    /* Title and legend are HTML so they wrap by themselves; the SVG takes what is left. */
    var ttl = s.showTitle ? s.titleText : '';
    this.titleEl.textContent = ttl;
    this.titleEl.style.display = ttl ? '' : 'none';
    this.titleEl.style.fontSize = s.titleSize + 'px'; this.titleEl.style.fontWeight = s.titleWeight === 'bold' ? '700' : '400';
    this.titleEl.style.order = '-2';
    var W0 = chart.clientWidth;
    this._legend(groups, s, th, overlay, W0);

    if (pts.length < 3) {
      this.stage.innerHTML = '<div class="dl-empty">' + esc(model.emptyMessage || 'Put a measure on X and a measure on Y, with a dimension on Detail so each row is one point.') + '</div>';
      this.svg = null; root.setAttribute('data-ready', '1'); root.setAttribute('data-bands', '0');
      return;
    }

    var W = this.stage.clientWidth, H = this.stage.clientHeight;
    if (W < 20 || H < 20) return;
    var fs = s.labelSize, labels = s.labelsOn;
    var lw = s.labelWeight === 'bold' ? 700 : 400;

    /* ---------- domains and tick text, which set the margins */
    var padFrac = Math.min(0.4, Math.max(0.03, s.bandwidth / 100 * 2.4));
    var xd = E.domainOf(pts.map(function (p) { return p.x; }), padFrac);
    var yd = E.domainOf(pts.map(function (p) { return p.y; }), padFrac);
    var cx0 = num(s.xMin), cx1 = num(s.xMax), cy0 = num(s.yMin), cy1 = num(s.yMax);
    if (cx0 !== null) xd[0] = cx0;
    if (cx1 !== null) xd[1] = cx1;
    if (cy0 !== null) yd[0] = cy0;
    if (cy1 !== null) yd[1] = cy1;
    if (!(xd[1] > xd[0])) xd[1] = xd[0] + 1;
    if (!(yd[1] > yd[0])) yd[1] = yd[0] + 1;
    var showAxes = s.axes, showTicks = s.axes && labels, showTitles = s.axes && labels && s.axisTitles && W >= 420 && H >= 320;
    var n = groups.length;
    var gridSpec = multi ? E.gridFor(n, W, H, s.cols) : { cols: 1, rows: 1 };
    var ptLines = 0, gap = s.panelGap;
    var titleW = Math.max(60, Math.floor((W - 12) / gridSpec.cols));
    var titleLines = [];
    if (multi && s.panelTitles && labels) groups.forEach(function (g) { var L = wrapLines(g.name, titleW, fs, s.labelLines); titleLines.push(L); ptLines = Math.max(ptLines, L.length); });
    var panelTitleH = ptLines ? Math.round(fs * (0.4 + 1.25 * ptLines)) : 0;
    var tickN = function (base) { return Math.max(2, Math.floor(base * s.tickDensity / 100)); };

    var yTicksGuess = HX.ticks(yd[0], yd[1], tickN(Math.floor(H / (fs * 3.2))));
    var yLabW = 0;
    if (showTicks) yTicksGuess.forEach(function (t) { yLabW = Math.max(yLabW, self.tick(t, yTicksGuess.step).length); });
    var leftM = 8 + (showTicks ? Math.ceil(yLabW * fs * 0.64) + 10 : 0) + (showTitles ? Math.round(fs * 1.5) : 0);
    var bottomM = 8 + (showTicks ? Math.round(fs * 1.5) + 6 : 0) + (showTitles ? Math.round(fs * 1.6) : 0);
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
    this.bands = bands; this.gpts = gpts; this.plot = { w: pw, h: ph }; this.bandCache = {};

    /* ---------- colors */
    var seaShallow = E.rampColor(s.ramp, th.dark, 0, s.reverse);
    var gridCol = s.gridColor || HX.mix(th.bg, th.ink, 0.2), axisCol = s.axisColor || HX.mix(th.bg, th.ink, 0.55);
    function bandColor (gi, frac) { return overlay ? colorOf(gi) : E.rampColor(s.ramp, th.dark, frac, s.reverse); }
    var overlayAlpha = Math.max(0.1, Math.min(0.4, 1.7 / s.levels));
    var fillMul = s.fillOpacity / 100;

    var xt = HX.ticks(xd[0], xd[1], tickN(Math.floor(pw / (fs * 5))));
    var yt = HX.ticks(yd[0], yd[1], tickN(Math.floor(ph / (fs * 3.2))));
    var gridDash = DASH[s.gridStyle] ? ' stroke-dasharray="' + DASH[s.gridStyle] + '"' : '';
    var lineDash = DASH[s.lineStyle] ? ' stroke-dasharray="' + DASH[s.lineStyle] + '"' : '';

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
      if (multi && titleLines[pi]) {
        var L = titleLines[pi];
        p += '<text class="dl-ptitle" x="0" y="' + (-Math.round(fs * 0.45) - (ptLines - 1) * Math.round(fs * 1.25)) + '" fill="' + lc + '" font-size="' + fs + '" font-weight="600">';
        L.forEach(function (ln, li) { p += '<tspan x="0" dy="' + (li ? Math.round(fs * 1.25) : 0) + '">' + esc(ln) + '</tspan>'; });
        p += '</text>';
      }
      var seaFill = s.sea ? (overlay ? HX.mix(th.bg, th.ink, 0.06) : HX.mix(th.bg, seaShallow, 0.4)) : 'none';
      p += '<rect class="dl-sea" x="0" y="0" width="' + pw + '" height="' + ph + '" fill="' + seaFill + '"/>';
      p += '<g class="dl-clip" clip-path="url(#dl-clip-' + pi + ')">';
      if (s.grid) {
        xt.forEach(function (t) { var X = sx(t).toFixed(1); p += '<line class="dl-grid" x1="' + X + '" x2="' + X + '" y1="0" y2="' + ph + '" stroke="' + gridCol + '" stroke-width="' + s.gridWidth + '"' + gridDash + '/>'; });
        yt.forEach(function (t) { var Y = sy(t).toFixed(1); p += '<line class="dl-grid" x1="0" x2="' + pw + '" y1="' + Y + '" y2="' + Y + '" stroke="' + gridCol + '" stroke-width="' + s.gridWidth + '"' + gridDash + '/>'; });
      }
      pn.members.forEach(function (gi) {
        var gB = bands[gi];
        gB.levels.forEach(function (lv) {
          if (!lv.coordinates.length) return;
          var col = bandColor(gi, lv.frac);
          var fillOp = s.fill ? (overlay ? overlayAlpha : 1) * fillMul : 0;
          p += '<path class="dl-band" data-g="' + gi + '" data-level="' + lv.index + '" d="' + lv.d + '" fill="' + col + '" fill-opacity="' + fillOp.toFixed(3) + '" fill-rule="evenodd" style="animation-delay:' + (lv.index * 45) + 'ms"/>';
        });
        if (s.lines) {
          gB.levels.forEach(function (lv) {
            if (!lv.coordinates.length) return;
            var col = bandColor(gi, lv.frac), stroke, op = 0.7;
            if (overlay) { stroke = colorOf(gi); op = 0.95; }
            else if (s.lineInk === 'band') { stroke = E.rampColor(s.ramp, th.dark, Math.min(1, lv.frac + 0.22), s.reverse); op = 0.95; }
            else { stroke = s.fill ? HX.pickText(col) : th.ink; }
            var major = s.majorEvery > 0 && (lv.index + 1) % s.majorEvery === 0;
            p += '<path class="dl-line' + (major ? ' dl-major' : '') + '" data-g="' + gi + '" d="' + lv.d + '" fill="none" stroke="' + stroke + '" stroke-opacity="' + op + '" stroke-width="' + (major ? s.lineWidth * 2.2 : s.lineWidth) + '" stroke-linejoin="round"' + lineDash + ' pointer-events="none" style="animation-delay:' + (lv.index * 45) + 'ms"/>';
          });
        }
      });
      p += '<path class="dl-hl" d="" fill="none" stroke="' + th.ink + '" stroke-width="2.5" pointer-events="none"/>';
      pn.members.forEach(function (gi) {
        gpts[gi].points.forEach(function (pt) {
          var sel = !!self.selected[pt.id];
          if (!s.points && !sel) return;
          p += self._pointSvg(pt, gi, sel);
        });
      });
      p += '</g>';
      /* value labels: the share of the peak each contour sits at, written at the top of its outer ring */
      if (s.valueLabels && labels) {
        pn.members.forEach(function (gi) {
          bands[gi].levels.forEach(function (lv) {
            if (!lv.coordinates.length) return;
            var ring = lv.coordinates[0][0], best = ring[0];
            ring.forEach(function (q) { if (q[1] < best[1]) best = q; });
            var pct = lv.value / (bands[gi].max || 1) * 100;
            var txt = CP.formatNumber(pct, Object.assign({}, s, { numSuffix: s.numSuffix || '%' }));
            p += '<text class="dl-vlabel" x="' + Math.max(12, Math.min(pw - 12, best[0])).toFixed(1) + '" y="' + Math.max(s.valueLabelSize, best[1] - 3).toFixed(1) + '" text-anchor="middle" fill="' + lc + '" font-size="' + s.valueLabelSize + '" stroke="' + th.bg + '" stroke-width="3" paint-order="stroke" pointer-events="none">' + esc(txt) + '</text>';
          });
        });
      }
      /* axes: only the left column and the bottom edge of each column carry labels */
      var below = multi ? (pi + gridSpec.cols < n) : false;
      if (showAxes) {
        if (c === 0) {
          p += '<line x1="0" x2="0" y1="0" y2="' + ph + '" stroke="' + axisCol + '" stroke-width="1"/>';
          if (showTicks) yt.forEach(function (t) { p += '<text class="dl-tick dl-ytick" x="-7" y="' + (sy(t) + fs * 0.35).toFixed(1) + '" text-anchor="end" fill="' + lc + '" font-size="' + fs + '" font-weight="' + lw + '">' + esc(self.tick(t, yt.step)) + '</text>'; });
        }
        if (!below) {
          p += '<line x1="0" x2="' + pw + '" y1="' + ph + '" y2="' + ph + '" stroke="' + axisCol + '" stroke-width="1"/>';
          if (showTicks) xt.forEach(function (t) { p += '<text class="dl-tick dl-xtick" x="' + sx(t).toFixed(1) + '" y="' + (ph + fs + 6) + '" text-anchor="middle" fill="' + lc + '" font-size="' + fs + '" font-weight="' + lw + '">' + esc(self.tick(t, xt.step)) + '</text>'; });
        }
      }
      p += '</g>';
      body += p;
    });
    out += '<defs>' + defs + '</defs>' + body;
    if (showTitles) {
      var cx = leftM + (gridSpec.cols * pw + (gridSpec.cols - 1) * gap) / 2;
      var cy = topM + (gridSpec.rows * (ph + panelTitleH) + (gridSpec.rows - 1) * gap) / 2;
      out += '<text class="dl-axtitle" id="dl-xtitle" x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" fill="' + lc + '" font-size="' + fs + '" font-weight="600">' + esc(s.xTitle || model.xName) + '</text>';
      out += '<text class="dl-axtitle" id="dl-ytitle" transform="translate(' + (fs + 2) + ',' + cy.toFixed(1) + ') rotate(-90)" text-anchor="middle" fill="' + lc + '" font-size="' + fs + '" font-weight="600">' + esc(s.yTitle || model.yName) + '</text>';
    }
    this.stage.innerHTML = '<svg class="dl-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc('Density contours of ' + model.yName + ' against ' + model.xName) + '">' + out + '</svg>';
    this.svg = this.stage.firstChild;

    /* Thin overlapping tick labels. Titles are first, so ticks give way to them. */
    var order = [].slice.call(this.svg.querySelectorAll('.dl-axtitle, .dl-ptitle'))
      .concat([].slice.call(this.svg.querySelectorAll('.dl-xtick')), [].slice.call(this.svg.querySelectorAll('.dl-ytick')), [].slice.call(this.svg.querySelectorAll('.dl-vlabel')));
    this.thinned = HX.thin(order, 8);

    var anim = animOn && !this.animated && !global.DL_STILL && !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    chart.classList.toggle('dl-anim', anim);
    this.animated = true;

    this._wire();
    root.setAttribute('data-bands', String(bands.reduce(function (a, b) { return a + b.levels.filter(function (l) { return l.coordinates.length; }).length; }, 0)));
    root.setAttribute('data-panels', String(panels.length));
    root.setAttribute('data-ready', '1');
  };

  /* One point as SVG text, in the shape the user chose. Selected points are larger and gold. */
  Renderer.prototype._pointSvg = function (pt, gi, sel) {
    var s = this.s, th = this.th, r = sel ? s.pointSize * 1.7 : s.pointSize;
    var col = sel ? '#f2b84b' : (s.pointColor || (this.overlay ? this.colorOf(gi) : th.ink));
    var op = sel ? 1 : s.pointOpacity, stroke = sel ? th.ink : th.bg, sw = sel ? 1.5 : 0.8;
    var x = pt.px.toFixed(1), y = pt.py.toFixed(1);
    var common = ' class="dl-pt' + (sel ? ' sel' : '') + '" data-shape="' + s.pointShape + '" data-g="' + gi + '" data-id="' + pt.id + '" fill="' + col + '" fill-opacity="' + op + '" stroke="' + stroke + '" stroke-width="' + sw + '"';
    var box = ' x="' + (pt.px - r).toFixed(1) + '" y="' + (pt.py - r).toFixed(1) + '" width="' + (2 * r) + '" height="' + (2 * r) + '"';
    if (s.pointShape === 'square') return '<rect' + common + box + '/>';
    if (s.pointShape === 'diamond') return '<rect' + common + box + ' transform="rotate(45 ' + x + ' ' + y + ')"/>';
    return '<circle' + common + ' cx="' + x + '" cy="' + y + '" r="' + r + '"/>';
  };

  Renderer.prototype._legend = function (groups, s, th, overlay, W) {
    var L = this.legendEl, h = '', self = this;
    L.style.display = s.legend ? '' : 'none';
    L.style.order = s.legendPos === 'top' ? '-1' : '0';
    if (!s.legend) { L.innerHTML = ''; return; }
    var note = function (t) { return s.legendNote ? '<span class="dl-note">' + t + '</span>' : ''; };
    if (overlay) {
      groups.forEach(function (g, gi) { h += '<span class="dl-chip"><i style="background:' + self.colorOf(gi) + '"></i>' + esc(g.name) + '</span>'; });
      h += note('Deeper bands are denser');
    } else if (W >= 340) {
      var stops = [0, 0.25, 0.5, 0.75, 1].map(function (t) { return E.rampColor(s.ramp, th.dark, t, s.reverse); }).join(',');
      h += '<span class="dl-note">Shallow</span><span class="dl-ramp" style="width:' + s.rampWidth + 'px;background:linear-gradient(90deg,' + stops + ');border-color:' + HX.mix(th.bg, th.ink, 0.5) + '"></span><span class="dl-note">Deep</span>';
    } else {
      h += note('Deeper is denser');
    }
    L.innerHTML = h;
  };

  Renderer.prototype._pointsIn = function (gi, level) {
    var key = gi + ':' + level + ':' + this.s.bandwidth + ':' + this.s.levels + ':' + this.s.floor + ':' + this.s.ceil + ':' + this.s.thresholds + ':' + this.plot.w + 'x' + this.plot.h;
    if (this.bandCache[key]) return this.bandCache[key];
    var lv = this.bands[gi].levels[level], ids = [];
    this.gpts[gi].points.forEach(function (p) { if (E.inMulti(p.px, p.py, lv.coordinates)) ids.push(p.id); });
    this.bandCache = {}; this.bandCache[key] = ids;
    return ids;
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

  Renderer.prototype._swatch = function (gi) {
    return this.s.tipSwatch && this.overlay ? '<i class="dl-sw" style="background:' + this.colorOf(gi) + '"></i>' : '';
  };

  Renderer.prototype._wire = function () {
    var self = this, svg = this.svg, s = this.s, model = this.model, chart = this.chart, lastBand = null;
    function clearHl () {
      [].forEach.call(svg.querySelectorAll('.dl-hl.on'), function (p) { p.classList.remove('on'); });
      [].forEach.call(svg.querySelectorAll('.dl-band.is-on'), function (b) { b.classList.remove('is-on'); });
      svg.classList.remove('dl-focus'); lastBand = null;
    }
    function over (e) {
      var t = e.target;
      if (t.classList.contains('dl-pt')) {
        clearHl();
        var gi = +t.getAttribute('data-g'), id = +t.getAttribute('data-id');
        var pt = self.gpts[gi].points.filter(function (p) { return p.id === id; })[0];
        if (!pt) return;
        var r = pt.ref;
        self._place(e, (model.hasCategory ? '<b>' + self._swatch(gi) + esc(self.groups[gi].name) + '</b><br>' : '') + esc(model.xName) + ': ' + esc(CP.formatNumber(r.x, s)) + '<br>' + esc(model.yName) + ': ' + esc(CP.formatNumber(r.y, s)));
        if (self.hooks.onHover) self.hooks.onHover(id);
      } else if (t.classList.contains('dl-band')) {
        var g = +t.getAttribute('data-g'), lvl = +t.getAttribute('data-level');
        if (s.hoverOn && lastBand !== t) {
          clearHl(); lastBand = t;
          var hl = t.parentNode.querySelector('.dl-hl');
          hl.setAttribute('d', self.bands[g].levels[lvl].d); hl.classList.add('on');
          t.classList.add('is-on'); svg.classList.add('dl-focus');
        }
        var count = self._pointsIn(g, lvl).length;
        self._place(e, (model.hasCategory ? '<b>' + self._swatch(g) + esc(self.groups[g].name) + '</b><br>' : '') + 'Depth band ' + (lvl + 1) + ' of ' + s.levels + '<br>' + count + ' point' + (count === 1 ? '' : 's') + ' inside');
        if (self.hooks.onHover) self.hooks.onHover(null);
      } else { clearHl(); self.tip.hidden = true; if (self.hooks.onHover) self.hooks.onHover(null); }
    }
    svg.addEventListener('mousemove', over);
    svg.addEventListener('mouseleave', function () { clearHl(); self.tip.hidden = true; if (self.hooks.onHover) self.hooks.onHover(null); });
    svg.addEventListener('click', function (e) {
      if (!s.selectOn) return;
      var t = e.target, ids = [];
      if (t.classList.contains('dl-band')) ids = self._pointsIn(+t.getAttribute('data-g'), +t.getAttribute('data-level'));
      else if (t.classList.contains('dl-pt')) ids = [+t.getAttribute('data-id')];
      self.selected = {}; ids.forEach(function (i) { self.selected[i] = true; });
      if (self.hooks.onSelect) self.hooks.onSelect(ids);
      self._restyleSelection();
    });
    void chart;
  };

  /* Selection restyle without a full redraw, so the click feels instant. */
  Renderer.prototype._restyleSelection = function () {
    var self = this;
    [].forEach.call(this.svg.querySelectorAll('.dl-pt'), function (c) { c.parentNode.removeChild(c); });
    this.gpts.forEach(function (g, gi) {
      var anyBand = self.svg.querySelector('path.dl-band[data-g="' + gi + '"]');
      var layer = anyBand ? anyBand.parentNode : self.svg.querySelector('.dl-clip');
      var html = '';
      g.points.forEach(function (pt) {
        var sel = !!self.selected[pt.id];
        if (!sel && !self.s.points) return;
        html += self._pointSvg(pt, gi, sel);
      });
      if (html) layer.insertAdjacentHTML('beforeend', html);
    });
  };

  global.DL.Renderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
