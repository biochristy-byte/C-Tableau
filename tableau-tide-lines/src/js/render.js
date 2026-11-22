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
  var TL = global.TL, kde = TL.kde, layout = TL.layout, pal = TL.palettes;
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

  function fmtFor (step) {
    var dec = step > 0 ? Math.max(0, Math.min(6, -Math.floor(Math.log(step) / Math.LN10 + 1e-9))) : 0;
    return function (v) { return Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); };
  }
  function fmtSig (v) {
    if (!isFinite(v)) return '';
    return Number(v).toLocaleString('en-US', { maximumSignificantDigits: 4 });
  }

  function Renderer (container) {
    this.container = container;
    this.sig = null;
    this.selected = {};
    this.chartBg = '#ffffff';
    this.autoBw = 0;
    this.info = null;
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
  };

  /* model: { rows: [{cat, value, colorKey, labelField, tupleId}], catName, valueName, worksheetBg, hasColor, emptyMessage }
   * hooks: { onSelect(ridgeOrNull, additive), onHover(ridgeOrNull) } */
  Renderer.prototype.draw = function (model, s, hooks) {
    var self = this, box = this.container;
    var W = Math.max(1, Math.floor(box.clientWidth)), H = Math.max(1, Math.floor(box.clientHeight));
    var wsBg = pal.toRgb(model.worksheetBg) ? pal.toHex(pal.toRgb(model.worksheetBg)) : '#ffffff';
    var bg = s.bgMatch ? wsBg : s.bgColor;
    var dark = pal.isDark(bg);
    var ink = pal.ensureContrast(s.inkAuto ? (dark ? '#f3f5f7' : '#0b1f2e') : s.inkColor, bg, 7);
    this.chartBg = bg; this.ink = ink;
    if (!model.rows || !model.rows.length) { this.message(model.emptyMessage || 'Drop a dimension on Category and a measure on Value.', bg, ink); return; }

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

    var built = kde.build(order, { kernel: s.kernel, bandwidth: s.bandwidth, scale: s.scale, trim: s.trim === 'trim' });
    this.autoBw = built.autoBw;
    var ridges = kde.sortRidges(built.ridges, s.sort, s.flip);
    var n = ridges.length, lo = built.domain[0], hi = built.domain[1];

    /* ---- text and margins ---- */
    var fontPx = Math.max(layout.MIN_FONT, s.labelSize);
    var measure = makeMeasure({ px: fontPx, family: s.fontFamily }, 500);
    var padL = 10, padR = 16, gap = 8;
    var names = ridges.map(function (r) { return r.label || r.key; });
    var maxName = 0;
    names.forEach(function (t) { maxName = Math.max(maxName, measure(t)); });
    var labelW = Math.min(Math.ceil(maxName) + 4, Math.floor(W * 0.34));
    var x0 = padL + labelW + gap, x1 = W - padR, plotW = Math.max(40, x1 - x0);

    var lift = s.hoverLift;
    var legendItems = [];
    if (s.colorSource === 'field' && model.hasColor) {
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
    var top = Math.max(8, lift + 6) + (legendFits ? legendRow : 0);
    var tickBlock = Math.ceil(1.57 * fontPx + 6 + 0.3 * fontPx);
    var footRow = Math.ceil(fontPx * 1.25 + 8);
    var wantFoot = s.showAxisTitle || true;   /* the footer row is always reserved so a label note has a home */
    var plotBottom = H - tickBlock - (wantFoot ? footRow : 0);
    var plotH = Math.max(30, plotBottom - top);
    var rows = layout.rows(top, plotH, n, s.overlap);
    var plan = layout.labelPlan(n, rows.step, fontPx);

    /* ---- svg ---- */
    box.innerHTML = '';
    box.style.background = bg;
    var animate = s.animate && !(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var sig = [model.rows.length, n, built.domain[0], built.domain[1], model.catName, model.valueName].join('|');
    var enter = animate && sig !== this.sig;
    this.sig = sig;
    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', class: 'tl-svg' + (enter ? ' tl-enter' : '') });
    svg.setAttribute('aria-label', 'Ridgeline of ' + model.valueName + ' by ' + model.catName + ', ' + n + ' ridges');
    svg.style.fontFamily = s.fontFamily;
    svg.style.setProperty('--tl-lift', lift + 'px');
    svg.style.setProperty('--tl-ink', ink);
    box.appendChild(svg);
    box.appendChild(this.tip);
    this.tip.style.background = dark ? '#f3f5f7' : '#081f33';
    this.tip.style.color = dark ? '#081f33' : '#f3f5f7';

    var X = function (v) { return x0 + plotW * (v - lo) / (hi - lo); };

    /* grid and axis */
    var lastBase = rows.baselines[n - 1];
    var fmtTick, ticks;
    (function () {
      var probe = kde.niceTicks(lo, hi, 6), st = probe.length > 1 ? probe[1] - probe[0] : (hi - lo);
      fmtTick = fmtFor(st);
      ticks = layout.pickTicks(kde, lo, hi, plotW, fmtTick, measure);
      var st2 = ticks.length > 1 ? ticks[1] - ticks[0] : st;
      fmtTick = fmtFor(st2);
    })();
    var gGrid = el('g', { class: 'tl-grid' }, svg);
    ticks.forEach(function (t) {
      var x = f1(X(t));
      if (s.showGrid) el('line', { x1: x, x2: x, y1: top, y2: lastBase, stroke: ink, 'stroke-opacity': 0.14, 'stroke-width': 1 }, gGrid);
      var txt = fmtTick(t), w = measure(txt), anchor = 'middle', tx = x;
      if (x - w / 2 < 2) { anchor = 'start'; tx = 2; } else if (x + w / 2 > W - 2) { anchor = 'end'; tx = W - 2; }
      var tn = el('text', { x: tx, y: f1(lastBase + 1.57 * fontPx + 6), 'text-anchor': anchor, class: 'tl-tick', 'font-size': fontPx, fill: ink }, gGrid);
      tn.textContent = txt;
    });
    el('line', { x1: x0, x2: x1, y1: f1(lastBase + 4), y2: f1(lastBase + 4), stroke: ink, 'stroke-opacity': 0.5, 'stroke-width': 1 }, gGrid);

    /* colours */
    var catColors = {}, catList = [];
    ridges.forEach(function (r) { if (r.color !== null && catColors[r.color] === undefined) { catColors[r.color] = pal.CATEGORICAL[catList.length % pal.CATEGORICAL.length]; catList.push(r.color); } });
    function colorOf (r, i) {
      if (s.colorSource === 'field' && model.hasColor && r.color !== null) return catColors[r.color];
      return pal.ridgeColor(s.palette, s.singleColor, i, n, bg);
    }

    /* legend */
    if (legendFits) {
      var gl = el('g', { class: 'tl-legend' }, svg), lx = padL;
      legendItems.forEach(function (t) {
        el('rect', { x: lx, y: 8 + (fontPx - 12) / 2 + 1, width: 12, height: 12, rx: 3, fill: catColors[t] }, gl);
        var tt = el('text', { x: lx + 18, y: 8 + fontPx * 0.8 + 1, 'font-size': fontPx, fill: ink, class: 'tl-legend-text' }, gl);
        tt.textContent = t;
        lx += 12 + 6 + measure(t) + 18;
      });
    }

    /* ridges */
    var gR = el('g', { class: 'tl-ridges' }, svg), gH = el('g', { class: 'tl-hits' }, svg), gL = el('g', { class: 'tl-labels' }, svg);
    var groups = [];
    function interp (r, x) {
      var xs = r.xs, ys = r.ys, k = 0;
      if (x <= xs[0]) return ys[0];
      if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
      while (k < xs.length - 2 && xs[k + 1] < x) k++;
      var t = (x - xs[k]) / (xs[k + 1] - xs[k] || 1);
      return ys[k] + (ys[k + 1] - ys[k]) * t;
    }
    var defs = el('defs', null, svg);
    ridges.forEach(function (r, i) {
      var base = rows.baselines[i], peak = rows.peak, c = colorOf(r, i);
      var crest = pal.mix(c, dark ? '#ffffff' : '#ffffff', 0.38);
      var gid = 'tl-g' + i;
      var lg = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      el('stop', { offset: '0', 'stop-color': crest, 'stop-opacity': s.fillOpacity }, lg);
      el('stop', { offset: '1', 'stop-color': c, 'stop-opacity': s.fillOpacity }, lg);
      var pts = r.xs.map(function (x, k) { return f1(X(x)) + ',' + f1(base - r.ys[k] * peak); });
      var d0 = 'M' + f1(X(r.xs[0])) + ',' + f1(base) + ' L' + pts.join(' L') + ' L' + f1(X(r.xs[r.xs.length - 1])) + ',' + f1(base) + ' Z';
      var outer = el('g', { class: 'tl-ridge', 'data-i': i, 'data-key': r.key }, gR);
      outer.style.setProperty('--tl-delay', Math.min(600, i * 45) + 'ms');
      var lifter = el('g', { class: 'tl-lift' }, outer);
      var inner = el('g', { class: 'tl-grow' }, lifter);
      inner.style.transformOrigin = '0px ' + f1(base) + 'px';
      el('line', { x1: x0, x2: x1, y1: f1(base), y2: f1(base), stroke: ink, 'stroke-opacity': 0.22, 'stroke-width': 1 }, inner);
      el('path', { class: 'tl-fill', d: d0, fill: 'url(#' + gid + ')' }, inner);
      var outlineC = pal.ensureContrast(c, bg, 3);
      if (s.lineWidth > 0) el('path', { class: 'tl-line', d: 'M' + pts.join(' L'), fill: 'none', stroke: outlineC, 'stroke-width': s.lineWidth, 'stroke-linejoin': 'round' }, inner);
      var tickC = pal.contrast('#ffffff', c) >= pal.contrast('#081f33', c) ? '#ffffff' : '#081f33';
      function tick (v, frac, w, cls) {
        var hgt = Math.max(3, interp(r, v) * peak * frac);
        el('line', { class: cls, x1: f1(X(v)), x2: f1(X(v)), y1: f1(base), y2: f1(base - hgt), stroke: tickC, 'stroke-width': w, 'stroke-linecap': 'round' }, inner);
      }
      if (s.showQuartiles && r.n > 1) { tick(r.stats.q1, 0.62, 1.5, 'tl-q'); tick(r.stats.q3, 0.62, 1.5, 'tl-q'); }
      if (s.showMedian && r.n > 0) tick(r.stats.median, 1, 2.5, 'tl-med');

      /* hit layer, label, in the same order as the paint */
      var hit = el('path', { class: 'tl-hit', d: d0, fill: '#000', 'fill-opacity': 0, 'pointer-events': 'all', 'data-i': i }, gH);
      var row = el('rect', { class: 'tl-hit tl-hitrow', x: 0, y: f1(base - rows.step / 2), width: f1(x0), height: f1(rows.step), fill: '#000', 'fill-opacity': 0, 'pointer-events': 'all', 'data-i': i }, gH);
      var label = null;
      if (plan.shown[i]) {
        label = el('text', { class: 'tl-label', x: padL + labelW, y: f1(base + 0.33 * fontPx), 'text-anchor': 'end', 'font-size': fontPx, 'font-weight': 500, fill: ink, 'data-i': i }, gL);
        var shownName = layout.fitText(names[i], labelW, measure);
        label.textContent = shownName;
        if (shownName !== names[i]) { var tt = el('title', null, label); tt.textContent = names[i]; }
      }
      groups.push({ outer: outer, hit: hit, row: row, label: label, ridge: r });
    });

    /* footer: axis title and the honest note about hidden labels, as ONE line so they can never collide */
    var parts = [];
    if (s.showAxisTitle) parts.push(model.valueName);
    if (plan.note) parts.push(plan.note);
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

    /* ---- interaction ---- */
    var hot = -1;
    function setHot (i, ev) {
      if (i === hot) { if (i >= 0 && ev) self.moveTip(ev); return; }
      if (hot >= 0) groups[hot].outer.classList.remove('is-hot');
      hot = i;
      if (i >= 0) { groups[i].outer.classList.add('is-hot'); svg.classList.add('has-hot'); self.showTip(groups[i].ridge, ev, model, s); }
      else { svg.classList.remove('has-hot'); self.tip.classList.remove('on'); }
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
      g.outer.setAttribute('aria-label', names[i] + ': n ' + g.ridge.n + ', median ' + fmtSig(g.ridge.stats.median));
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

  Renderer.prototype.showTip = function (r, ev, model, s) {
    var st = r.stats, t = this.tip;
    t.innerHTML = '';
    function line (k, v, strong) {
      var d = document.createElement('div');
      if (strong) { d.className = 'tl-tip-h'; d.textContent = k; }
      else { var a = document.createElement('span'); a.className = 'tl-tip-k'; a.textContent = k; var b = document.createElement('span'); b.className = 'tl-tip-v'; b.textContent = v; d.appendChild(a); d.appendChild(document.createTextNode(' ')); d.appendChild(b); }
      t.appendChild(d);
    }
    line(r.label || r.key, '', true);
    if (r.label && r.label !== r.key) line(model.catName, r.key);
    line('n', Number(st.n).toLocaleString('en-US'));
    line('Median', fmtSig(st.median));
    line('IQR', fmtSig(st.iqr) + '  (' + fmtSig(st.q1) + ' to ' + fmtSig(st.q3) + ')');
    if (s.colorSource === 'field' && model.hasColor && r.color) line('Colour', r.color);
    t.classList.add('on');
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
    var x = cx - c.left + 14, y = cy - c.top + 16;
    if (x + w > c.width - 4) x = cx - c.left - w - 14;
    if (y + h > c.height - 4) y = cy - c.top - h - 14;
    t.style.left = Math.max(4, Math.min(x, c.width - w - 4)) + 'px';
    t.style.top = Math.max(4, Math.min(y, c.height - h - 4)) + 'px';
  };

  TL.Renderer = Renderer;
  TL.fmt = { sig: fmtSig, forStep: fmtFor };
})(typeof window !== 'undefined' ? window : globalThis);
