/* Tide Lines - SVG renderer. Turns a model of observations and the resolved
 * settings into a ridgeline. All numbers come from kde.js and layout.js.
 *
 * Smoothness: hover only toggles classes. The lift, the dimming and the
 * entrance are CSS transitions on transforms and opacity, so the browser
 * composites them at the display rate and nothing is rebuilt while the pointer
 * moves. The hit areas are a separate, non-moving layer, so a lifted ridge
 * never slides out from under the pointer and flickers.
 */
(function (global) {
  'use strict';
  var TL = global.TL, kde = TL.kde, layout = TL.layout, pal = TL.palettes, CP = global.CTabPanel;
  var NS = 'http://www.w3.org/2000/svg';

  function el (tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function f1 (v) { return Math.round(v * 10) / 10; }

  var measureCtx = null;
  function makeMeasure (font, weight) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    var key = weight + ' ' + font.px + 'px ' + font.family;
    return function (text) { measureCtx.font = key; return measureCtx.measureText(String(text)).width; };
  }

  /* Decimals that show 4 significant digits of v. */
  function sigDec (v) { return v === 0 || !isFinite(v) ? 0 : Math.max(0, Math.min(6, 3 - Math.floor(Math.log(Math.abs(v)) / Math.LN10 + 1e-12))); }
  /* A number formatter from the Number format tab. The tab's decimal places are a floor: a value that needs more
   * digits to show 4 significant ones still gets them (forcedDec fixes the digits for axis ticks). */
  function numFmt (s, forcedDec) {
    return function (v) {
      var x = v * (parseFloat(s.numScale) || 1);
      var dec = forcedDec === undefined ? sigDec(x) : forcedDec;
      return CP.formatNumber(v, Object.assign({}, s, { numDecimals: Math.max(s.numDecimals || 0, dec) }));
    };
  }

  /* Up to `lines` lines of text no wider than maxW. One line is cut with an ellipsis. */
  function wrapName (text, maxW, lines, measure) {
    text = String(text);
    if (lines <= 1 || measure(text) <= maxW) return [layout.fitText(text, maxW, measure)];
    var words = text.split(/\s+/), out = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var tryLine = cur ? cur + ' ' + words[i] : words[i];
      if (measure(tryLine) <= maxW || !cur) cur = tryLine;
      else {
        out.push(cur); cur = words[i];
        if (out.length === lines - 1) { cur = words.slice(i).join(' '); break; }
      }
    }
    out.push(layout.fitText(cur, maxW, measure));
    return out;
  }

  var EASES = { out: 'cubic-bezier(0.22, 0.8, 0.28, 1)', inout: 'cubic-bezier(0.65, 0, 0.35, 1)', linear: 'linear' };

  function Renderer (container) {
    this.container = container;
    this.sig = null;
    this.selected = {};
    this.chartBg = '#ffffff';
    this.autoBw = 0;
    this.info = null;
    this.items = [];
    this.tip = document.createElement('div');
    this.tip.className = 'tl-tip';
    this.tip.setAttribute('role', 'tooltip');
  }

  Renderer.prototype.message = function (text, bg, ink) {
    this.container.innerHTML = '';
    var d = document.createElement('div');
    d.className = 'tl-empty';
    d.style.color = ink;
    d.textContent = text;
    this.container.appendChild(d);
    this.container.style.background = bg;
    this.info = { n: 0, empty: true };
    this.items = [];
  };

  /* model: { rows: [{cat, value, colorKey, labelField, tupleId}], catName, valueName, worksheetBg, hasColor, emptyMessage }
   * s: the resolved settings (see settings.js).  hooks: { onSelect(ridges, additive), onHover(ridgeOrNull) } */
  Renderer.prototype.draw = function (model, s, hooks) {
    var self = this, box = this.container;
    var pad = s.padding || 0;
    var W = Math.max(1, Math.floor(box.clientWidth) - 2 * pad), H = Math.max(1, Math.floor(box.clientHeight) - 2 * pad);
    var wsBg = pal.toRgb(model.worksheetBg) ? pal.toHex(pal.toRgb(model.worksheetBg)) : '#ffffff';
    var bg = s.bgMode === 'custom' ? (CP.color.normHex(s.bgColor) || wsBg) : wsBg;
    var dark = pal.isDark(bg);
    var ink = pal.ensureContrast(CP.color.normHex(s.labelColor) || (dark ? '#f3f5f7' : '#0b1f2e'), bg, 7);
    var fam = CP.fontStack(s.fontFamily);
    this.chartBg = bg; this.ink = ink;
    box.style.padding = pad + 'px';
    box.style.border = s.borderOn ? s.borderWidth + 'px solid ' + (CP.color.normHex(s.borderColor) || ink) : '0';
    box.style.borderRadius = s.borderOn ? s.borderRadius + 'px' : '0';
    box.style.fontFamily = fam;
    var paintBg = s.bgMode === 'transparent' ? 'transparent' : bg;
    if (!model.rows || !model.rows.length) { this.message(model.emptyMessage || 'Drop a dimension on Category and a measure on Value.', paintBg, ink); return; }

    /* ---- groups, in order of first appearance ---- */
    var order = [], map = {};
    model.rows.forEach(function (r) {
      var g = map[r.cat];
      if (!g) { g = map[r.cat] = { key: r.cat, values: [], tuples: [], colorCount: {}, label: null }; order.push(g); }
      g.values.push(r.value); g.tuples.push(r.tupleId);
      if (r.colorKey !== null && r.colorKey !== undefined) { var ck = String(r.colorKey); g.colorCount[ck] = (g.colorCount[ck] || 0) + 1; }
      if (!g.label && r.labelField) g.label = String(r.labelField);
    });
    order.forEach(function (g) {
      var best = null, bc = 0;
      Object.keys(g.colorCount).forEach(function (k) { if (g.colorCount[k] > bc) { bc = g.colorCount[k]; best = k; } });
      g.color = best;
    });
    /* per-ridge overrides from the Colors tab list: name, color, hidden, and (with My order) the order */
    var ov = {}, manual = [];
    (s.catColors || []).forEach(function (x) { ov[x.key] = x; manual.push(x.key); });
    var hiddenGroups = order.filter(function (g) { return ov[g.key] && ov[g.key].hidden; });
    var shownGroups = order.filter(function (g) { return !(ov[g.key] && ov[g.key].hidden); });
    if (!shownGroups.length) { this.message('Every ridge is hidden. Show some on the Colors tab.', paintBg, ink); return; }

    var built = kde.build(shownGroups, { kernel: s.kernel, bandwidth: s.bandwidth, bwMult: s.bwMult, padMult: s.padMult, points: s.points, scale: s.scale, trim: s.trim === 'trim',
      range: s.rangeMode === 'custom' ? [s.rangeMin, s.rangeMax] : null });
    this.autoBw = built.autoBw;
    var ridges = kde.sortRidges(built.ridges, s.sort, s.flip, manual);
    var n = ridges.length, lo = built.domain[0], hi = built.domain[1];
    var nameOf = function (r) { return (ov[r.key] && ov[r.key].name) || r.label || r.key; };

    /* ---- text and margins ---- */
    var fontPx = Math.max(layout.MIN_FONT, s.labelSize);
    var lblW = s.labelWeight === 'bold' ? 700 : 500;
    var measure = makeMeasure({ px: fontPx, family: fam }, lblW);
    var vPx = Math.max(layout.MIN_FONT, s.valueLabelSize || 14);
    var padL = 10, padR = 16, gap = 8;
    var showNames = !!s.labelsOn, leftSide = s.labelSide !== 'right';
    var names = ridges.map(nameOf);
    var maxName = 0;
    if (showNames) names.forEach(function (t) { maxName = Math.max(maxName, measure(t)); });
    var labelW = showNames ? Math.min(Math.ceil(maxName) + 4, Math.floor(W * (s.labelMaxPct || 34) / 100)) : 0;
    var lgap = showNames ? gap : 0;
    var x0, x1, lx;
    if (leftSide) { x0 = padL + labelW + lgap; x1 = W - padR; lx = padL + labelW; } else { x0 = padL; x1 = W - padR - labelW - lgap; lx = W - padR - labelW; }
    var plotW = Math.max(40, x1 - x0);
    var lineSets = names.map(function (t) { return showNames ? wrapName(t, labelW, s.labelLines || 1, measure) : []; });
    var maxLines = 1; lineSets.forEach(function (l) { maxLines = Math.max(maxLines, l.length); });

    var lift = s.hoverOn ? s.hoverLift : 0;
    var legendItems = [];
    if (s.legendOn && s.colorSource === 'field' && model.hasColor) {
      var seen = {};
      ridges.forEach(function (r) { if (r.color !== null && !seen[r.color]) { seen[r.color] = true; legendItems.push(r.color); } });
    }
    var legendRow = fontPx + 10;
    var legendFits = false;
    if (legendItems.length > 1 && legendItems.length <= 8) {
      var lw = 0;
      legendItems.forEach(function (t) { lw += 12 + 6 + measure(t) + 18; });
      legendFits = lw <= W - padL - padR;
    }
    var titleOn = s.showTitle && s.titleText, titleH = titleOn ? Math.ceil(s.titleSize * 1.25) + 6 : 0;
    var top = Math.max(8, lift + 6) + titleH + (legendFits ? legendRow : 0);
    var tickBlock = Math.ceil(1.57 * fontPx + 6 + 0.3 * fontPx);
    var footRow = Math.ceil(fontPx * 1.25 + 8);
    var plotBottom = H - tickBlock - footRow;
    var plotH = Math.max(30, plotBottom - top);
    var rows = layout.rows(top, plotH, n, s.overlap);
    var plan = layout.labelPlan(n, rows.step, Math.max(fontPx, s.valueLabels ? vPx : 0), maxLines);
    if (!showNames) plan.note = '';

    /* ---- svg ---- */
    box.innerHTML = '';
    box.style.background = paintBg;
    var animate = s.animOn && !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var sig = [model.rows.length, n, built.domain[0], built.domain[1], model.catName, model.valueName].join('|');
    var enter = animate && sig !== this.sig;
    this.sig = sig;
    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', class: 'tl-svg' + (enter ? ' tl-enter' : '') });
    svg.setAttribute('aria-label', 'Ridgeline of ' + model.valueName + ' by ' + model.catName + ', ' + n + ' ridges');
    svg.style.fontFamily = fam;
    svg.style.setProperty('--tl-lift', lift + 'px');
    svg.style.setProperty('--tl-ink', ink);
    svg.style.setProperty('--tl-dim', String(s.dimOthers / 100));
    svg.style.setProperty('--tl-seldim', String(s.selectDim / 100));
    svg.style.setProperty('--tl-ms', s.hoverMs + 'ms');
    svg.style.setProperty('--tl-anim-ms', s.animMs + 'ms');
    svg.style.setProperty('--tl-ease', EASES[s.animEase] || EASES.out);
    svg.style.setProperty('--tl-hotw', String(s.hotLineWidth));
    box.appendChild(svg);
    box.appendChild(this.tip);
    this.tip.style.background = dark ? '#f3f5f7' : '#081f33';
    this.tip.style.color = dark ? '#081f33' : '#f3f5f7';
    this.tip.style.fontSize = s.tipSize + 'px';
    this.tip.style.maxWidth = 'min(' + s.tipMaxW + 'px, 90%)';
    this.tip.style.fontFamily = fam;

    if (titleOn) {
      var tw = s.titleWeight === 'bold' ? 700 : 400;
      var tt0 = el('text', { x: padL, y: f1(titleH - 8), 'font-size': s.titleSize, 'font-weight': tw, fill: ink, class: 'tl-title' }, svg);
      tt0.textContent = layout.fitText(s.titleText, W - padL - padR, makeMeasure({ px: s.titleSize, family: fam }, tw));
    }

    var X = function (v) { return x0 + plotW * (v - lo) / (hi - lo); };

    /* grid and axis */
    var lastBase = rows.baselines[n - 1];
    var fmtTick, ticks;
    (function () {
      var probe = kde.niceTicks(lo, hi, 6), st = probe.length > 1 ? probe[1] - probe[0] : (hi - lo);
      var decFor = function (step) { return step > 0 ? Math.max(0, Math.min(6, -Math.floor(Math.log(step) / Math.LN10 + 1e-9))) : 0; };
      fmtTick = numFmt(s, decFor(st));
      ticks = layout.pickTicks(kde, lo, hi, plotW, fmtTick, measure, s.tickCount);
      var st2 = ticks.length > 1 ? ticks[1] - ticks[0] : st;
      fmtTick = numFmt(s, decFor(st2));
    })();
    var gGrid = el('g', { class: 'tl-grid' }, svg);
    ticks.forEach(function (t) {
      var x = f1(X(t));
      if (s.showGrid) {
        var gl0 = el('line', { x1: x, x2: x, y1: top, y2: lastBase, stroke: ink, 'stroke-opacity': s.gridOpacity / 100, 'stroke-width': 1, class: 'tl-gridline' }, gGrid);
        if (s.gridStyle === 'dashed') gl0.setAttribute('stroke-dasharray', '4 4');
      }
      var txt = fmtTick(t), w = measure(txt), anchor = 'middle', tx = x;
      if (x - w / 2 < 2) { anchor = 'start'; tx = 2; } else if (x + w / 2 > W - 2) { anchor = 'end'; tx = W - 2; }
      var tn = el('text', { x: tx, y: f1(lastBase + 1.57 * fontPx + 6), 'text-anchor': anchor, class: 'tl-tick', 'font-size': fontPx, fill: ink }, gGrid);
      tn.textContent = txt;
    });
    if (s.axisLine) el('line', { x1: x0, x2: x1, y1: f1(lastBase + 4), y2: f1(lastBase + 4), stroke: ink, 'stroke-opacity': 0.5, 'stroke-width': 1, class: 'tl-axisline' }, gGrid);

    /* colours */
    var pal8 = CP.paletteColors(s.catPalette, s.paletteReverse);
    var catColors = {}, catList = [];
    ridges.forEach(function (r) { if (r.color !== null && catColors[r.color] === undefined) { catColors[r.color] = pal8[catList.length % pal8.length]; catList.push(r.color); } });
    function colorOf (r, i) {
      var o = ov[r.key] && CP.color.normHex(ov[r.key].color);
      if (o) return o;
      if (s.colorSource === 'field' && model.hasColor && r.color !== null) return catColors[r.color];
      return pal.ridgeColor(s.palette, s.singleColor, s.tideReverse ? n - 1 - i : i, n, bg);
    }

    /* legend */
    if (legendFits) {
      var gl = el('g', { class: 'tl-legend' }, svg), lx2 = padL, ly0 = 8 + titleH;
      legendItems.forEach(function (t) {
        el('rect', { x: lx2, y: ly0 + (fontPx - 12) / 2 + 1, width: 12, height: 12, rx: 3, fill: catColors[t] }, gl);
        var tt = el('text', { x: lx2 + 18, y: ly0 + fontPx * 0.8 + 1, 'font-size': fontPx, fill: ink, class: 'tl-legend-text' }, gl);
        tt.textContent = t;
        lx2 += 12 + 6 + measure(t) + 18;
      });
    }

    /* ridges */
    var gR = el('g', { class: 'tl-ridges' }, svg), gH = el('g', { class: 'tl-hits' }, svg), gL = el('g', { class: 'tl-labels' }, svg);
    var groups = [], itemsOut = [];
    function interp (r, x) {
      var xs = r.xs, ys = r.ys, k = 0;
      if (x <= xs[0]) return ys[0];
      if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
      while (k < xs.length - 2 && xs[k + 1] < x) k++;
      var t = (x - xs[k]) / (xs[k + 1] - xs[k] || 1);
      return ys[k] + (ys[k + 1] - ys[k]) * t;
    }
    var defs = el('defs', null, svg);
    var dashOf = { solid: null, dashed: '7 4', dotted: '1.5 4' }[s.outlineDash] || null;
    ridges.forEach(function (r, i) {
      var base = rows.baselines[i], peak = rows.peak, c = colorOf(r, i);
      itemsOut.push({ key: r.key, name: r.label || r.key, color: c });
      var crest = pal.mix(c, '#ffffff', s.gradCrest / 100);
      var fillAttr;
      if (s.gradOn) {
        var gid = 'tl-g' + i;
        var lg = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
        el('stop', { offset: '0', 'stop-color': crest, 'stop-opacity': s.fillOpacity }, lg);
        el('stop', { offset: '1', 'stop-color': c, 'stop-opacity': Math.round(s.fillOpacity * (1 - s.baseFade / 100) * 1000) / 1000 }, lg);
        fillAttr = { fill: 'url(#' + gid + ')' };
      } else fillAttr = { fill: c, 'fill-opacity': s.fillOpacity };
      var pts = r.xs.map(function (x, k) { return f1(X(x)) + ',' + f1(base - r.ys[k] * peak); });
      var d0 = 'M' + f1(X(r.xs[0])) + ',' + f1(base) + ' L' + pts.join(' L') + ' L' + f1(X(r.xs[r.xs.length - 1])) + ',' + f1(base) + ' Z';
      var outer = el('g', { class: 'tl-ridge', 'data-i': i, 'data-key': r.key }, gR);
      outer.style.setProperty('--tl-delay', Math.min(600, i * 45) + 'ms');
      var lifter = el('g', { class: 'tl-lift' }, outer);
      var inner = el('g', { class: 'tl-grow' }, lifter);
      inner.style.transformOrigin = '0px ' + f1(base) + 'px';
      if (s.showBaselines) el('line', { class: 'tl-baseline', x1: x0, x2: x1, y1: f1(base), y2: f1(base), stroke: ink, 'stroke-opacity': s.baselineOpacity / 100, 'stroke-width': 1 }, inner);
      el('path', Object.assign({ class: 'tl-fill', d: d0 }, fillAttr), inner);
      var outlineC = s.outlineMode === 'ink' ? ink : s.outlineMode === 'custom' ? (CP.color.normHex(s.outlineColor) || c) : pal.ensureContrast(c, bg, 3);
      if (s.lineWidth > 0) {
        var lp = el('path', { class: 'tl-line', d: 'M' + pts.join(' L'), fill: 'none', stroke: outlineC, 'stroke-width': s.lineWidth, 'stroke-linejoin': s.outlineJoin, 'stroke-opacity': s.outlineOpacity / 100 }, inner);
        if (dashOf) lp.setAttribute('stroke-dasharray', dashOf);
      }
      var tickC = CP.color.normHex(s.tickColor) || (pal.contrast('#ffffff', c) >= pal.contrast('#081f33', c) ? '#ffffff' : '#081f33');
      function tick (v, frac, w, cls, dash) {
        var hgt = Math.max(3, interp(r, v) * peak * frac);
        var tk = el('line', { class: cls, x1: f1(X(v)), x2: f1(X(v)), y1: f1(base), y2: f1(base - hgt), stroke: tickC, 'stroke-width': w, 'stroke-linecap': 'round' }, inner);
        if (dash) tk.setAttribute('stroke-dasharray', dash);
      }
      if (s.showQuartiles && r.n > 1) { tick(r.stats.q1, s.quartileHeight / 100, s.quartileWidth, 'tl-q'); tick(r.stats.q3, s.quartileHeight / 100, s.quartileWidth, 'tl-q'); }
      if (s.showMean && r.n > 0) tick(r.stats.mean, 0.8, 2, 'tl-mean', '3 3');
      if (s.showMedian && r.n > 0) tick(r.stats.median, 1, s.medianWidth, 'tl-med');
      if (s.showRug) {
        var vals = r.stats.sorted, stepR = Math.max(1, Math.ceil(vals.length / 400));
        for (var q = 0; q < vals.length; q += stepR) {
          el('line', { class: 'tl-rug', x1: f1(X(vals[q])), x2: f1(X(vals[q])), y1: f1(base + 2), y2: f1(base + 2 + s.rugSize), stroke: ink, 'stroke-opacity': s.rugOpacity / 100, 'stroke-width': 1 }, inner);
        }
      }

      /* hit layer, label, in the same order as the paint */
      var hit = el('path', { class: 'tl-hit', d: d0, fill: '#000', 'fill-opacity': 0, 'pointer-events': 'all', 'data-i': i }, gH);
      var row = el('rect', { class: 'tl-hit tl-hitrow', x: leftSide ? 0 : f1(x1), y: f1(base - rows.step / 2), width: leftSide ? f1(x0) : f1(W - x1), height: f1(rows.step), fill: '#000', 'fill-opacity': 0, 'pointer-events': 'all', 'data-i': i }, gH);
      var label = null;
      if (showNames && plan.shown[i]) {
        var ls = lineSets[i], lh = fontPx * 1.15, y0 = base + 0.33 * fontPx - (ls.length - 1) * lh / 2;
        label = el('text', { class: 'tl-label', x: lx, y: f1(y0), 'text-anchor': leftSide ? 'end' : 'start', 'font-size': fontPx, 'font-weight': lblW, fill: ink, 'data-i': i }, gL);
        if (ls.length === 1) label.textContent = ls[0];
        else ls.forEach(function (ln, k) { var ts = el('tspan', { x: lx, dy: k === 0 ? 0 : f1(lh) }, label); ts.textContent = ln; });
        if (ls.join(' ') !== names[i]) { var tt = el('title', null, label); tt.textContent = names[i]; }
      }
      if (s.valueLabels && plan.shown[i] && r.n > 0) {
        var vt = el('text', { class: 'tl-value', x: f1(x1 - 2), y: f1(base - 4), 'text-anchor': 'end', 'font-size': vPx, 'font-weight': 500, fill: ink }, gL);
        vt.textContent = numFmt(s)(r.stats.median);
      }
      groups.push({ outer: outer, hit: hit, row: row, label: label, ridge: r, color: c });
    });
    hiddenGroups.forEach(function (g) { itemsOut.push({ key: g.key, name: g.label || g.key, color: '' }); });
    this.items = itemsOut;

    /* footer: axis title and the note about hidden labels, as ONE line so they can never collide */
    var parts = [];
    if (s.showAxisTitle) parts.push(s.axisTitleText || model.valueName);
    if (plan.note && s.footNote) parts.push(plan.note);
    if (parts.length) {
      var full = parts.join('  ·  '), maxW = W - padL - padR;
      var text = measure(full) <= maxW ? full : layout.fitText(plan.note || full, maxW, measure);
      var ft = el('text', { class: 'tl-foot', x: padL, y: f1(H - 0.3 * fontPx - 6), 'font-size': fontPx, fill: ink }, svg);
      ft.textContent = text;
    }

    this.info = { n: n, shown: plan.shownCount, stride: plan.stride, font: fontPx, note: plan.note, autoBw: built.autoBw,
      kernel: built.kernel, step: rows.step, domain: built.domain, ticks: ticks.length, legend: legendFits };
    svg.setAttribute('data-n', n); svg.setAttribute('data-shown', plan.shownCount); svg.setAttribute('data-stride', plan.stride);
    svg.setAttribute('data-kernel', built.kernel); svg.setAttribute('data-bw-auto', built.autoBw);
    svg.setAttribute('data-anim', animate ? 'on' : 'off');

    /* ---- interaction ---- */
    var hot = -1;
    function setHot (i, ev) {
      if (i === hot) { if (i >= 0 && ev) self.moveTip(ev); return; }
      if (hot >= 0) groups[hot].outer.classList.remove('is-hot');
      hot = i;
      if (i >= 0) {
        if (s.hoverOn) { groups[i].outer.classList.add('is-hot'); svg.classList.add('has-hot'); } else svg.classList.remove('has-hot');
        if (s.tipOn) self.showTip(groups[i].ridge, ev, model, s, groups[i].color, names[i]);
      } else { svg.classList.remove('has-hot'); self.tip.classList.remove('on'); }
      if (hooks && hooks.onHover) hooks.onHover(i >= 0 ? groups[i].ridge : null);
    }
    function applySel () {
      var any = Object.keys(self.selected).length > 0;
      svg.classList.toggle('has-sel', any);
      groups.forEach(function (g) { g.outer.classList.toggle('is-sel', !!self.selected[g.ridge.key]); });
    }
    applySel();
    groups.forEach(function (g, i) {
      [g.hit, g.row].forEach(function (h) {
        h.addEventListener('pointerenter', function (e) { setHot(i, e); });
        h.addEventListener('pointermove', function (e) { setHot(i, e); });
        h.addEventListener('pointerleave', function () { if (hot === i) setHot(-1); });
        h.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!s.selectOn) return;
          var add = e.ctrlKey || e.metaKey || e.shiftKey, k = g.ridge.key;
          if (add) { if (self.selected[k]) delete self.selected[k]; else self.selected[k] = true; }
          else if (self.selected[k] && Object.keys(self.selected).length === 1) self.selected = {};
          else { self.selected = {}; self.selected[k] = true; }
          applySel();
          if (hooks && hooks.onSelect) hooks.onSelect(Object.keys(self.selected).map(function (kk) { return groups.filter(function (x) { return x.ridge.key === kk; })[0].ridge; }), add);
        });
      });
      g.outer.setAttribute('tabindex', '0');
      g.outer.setAttribute('role', 'button');
      g.outer.setAttribute('aria-label', names[i] + ': n ' + g.ridge.n + ', median ' + numFmt(s)(g.ridge.stats.median));
      g.outer.addEventListener('focus', function () { setHot(i, null); });
      g.outer.addEventListener('blur', function () { if (hot === i) setHot(-1); });
      g.outer.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); g.hit.dispatchEvent(new MouseEvent('click', { bubbles: true })); } });
    });
    svg.addEventListener('click', function () {
      if (!Object.keys(self.selected).length) return;
      self.selected = {}; applySel();
      if (hooks && hooks.onSelect) hooks.onSelect([], false);
    });
    svg.addEventListener('pointerleave', function () { setHot(-1); });
    this.names = names;
  };

  Renderer.prototype.showTip = function (r, ev, model, s, color, name) {
    var st = r.stats, t = this.tip, nf = numFmt(s);
    t.innerHTML = '';
    function line (k, v, strong) {
      var d = document.createElement('div');
      if (strong) {
        d.className = 'tl-tip-h';
        if (s.tipSwatch) { var sw = document.createElement('span'); sw.className = 'tl-tip-sw'; sw.style.background = color; d.appendChild(sw); }
        d.appendChild(document.createTextNode(k));
      } else { var a = document.createElement('span'); a.className = 'tl-tip-k'; a.textContent = k; var b = document.createElement('span'); b.className = 'tl-tip-v'; b.textContent = v; d.appendChild(a); d.appendChild(document.createTextNode(' ')); d.appendChild(b); }
      t.appendChild(d);
    }
    line(name, '', true);
    if (name !== r.key) line(model.catName, r.key);
    line('n', Number(st.n).toLocaleString('en-US'));
    line('Median', nf(st.median));
    line('IQR', nf(st.iqr) + '  (' + nf(st.q1) + ' to ' + nf(st.q3) + ')');
    if (s.colorSource === 'field' && model.hasColor && r.color) line('Colour', r.color);
    t.classList.add('on');
    this.tipFollow = s.tipFollow;
    if (ev) this.moveTip(ev);
    else {
      var rect = this.container.getBoundingClientRect();
      this.placeTip(rect.left + 24, rect.top + 24);
    }
  };
  Renderer.prototype.moveTip = function (ev) { this.placeTip(ev.clientX, ev.clientY); };
  Renderer.prototype.placeTip = function (cx, cy) {
    var c = this.container.getBoundingClientRect(), t = this.tip;
    var w = t.offsetWidth, h = t.offsetHeight;
    if (this.tipFollow === 'corner') { t.style.left = '8px'; t.style.top = '8px'; return; }
    var x = cx - c.left + 14, y = cy - c.top + 16;
    if (x + w > c.width - 4) x = cx - c.left - w - 14;
    if (y + h > c.height - 4) y = cy - c.top - h - 14;
    t.style.left = Math.max(4, Math.min(x, c.width - w - 4)) + 'px';
    t.style.top = Math.max(4, Math.min(y, c.height - h - 4)) + 'px';
  };

  TL.Renderer = Renderer;
  TL.fmt = { numFmt: numFmt, sigDec: sigDec, wrapName: wrapName };
})(typeof window !== 'undefined' ? window : globalThis);
