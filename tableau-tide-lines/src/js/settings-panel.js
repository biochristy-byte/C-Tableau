/* Tide Lines - in-viz settings panel. A gear opens a panel built from schema.js.
 * No sliders anywhere: typed steppers, chip groups, dropdowns, colour inputs.
 * No browser dialogs: pasted settings and every message live inside the panel.
 */
(function (global) {
  'use strict';
  var TL = global.TL, schema = TL.schema, pal = TL.palettes;

  function h (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function btn (cls, text, label) {
    var b = h('button', cls, text); b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }

  /* A step that follows the data: about a tenth of the automatic bandwidth, rounded to 1, 2 or 5. */
  function niceStep (auto) {
    if (!(auto > 0)) return 1;
    var raw = auto / 10, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  }
  function tidy (v) { return Math.round(v * 1e6) / 1e6; }

  function Panel (root, api) {
    var self = this;
    this.api = api; this.root = root; this.closed = { tableau: true };
    this.gear = btn('tl-gear', null, 'Open Tide Lines settings');
    this.gear.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9.4 4a7.6 7.6 0 0 1-.1 1.2l2 1.6-1.9 3.3-2.5-1a7.6 7.6 0 0 1-2 1.2l-.4 2.6h-3.8l-.4-2.6a7.6 7.6 0 0 1-2-1.2l-2.5 1L2 14.8l2-1.6a7.6 7.6 0 0 1 0-2.4L2 9.2l1.9-3.3 2.5 1a7.6 7.6 0 0 1 2-1.2l.4-2.6h3.8l.4 2.6c.7.3 1.4.7 2 1.2l2.5-1L21.4 9l-2 1.6c.1.4.1.8.1 1.4z"/></svg>';
    this.panel = h('div', 'tl-panel');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Tide Lines settings');
    root.appendChild(this.gear);
    root.appendChild(this.panel);
    this.gear.addEventListener('click', function () { self.toggle(); });
    this.build();
  }

  Panel.prototype.toggle = function (force) {
    var open = force === undefined ? !this.root.classList.contains('tl-root-open') : force;
    this.root.classList.toggle('tl-root-open', open);
    this.gear.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) this.build();
  };

  /* Colours follow the chart so the panel reads in light and dark. */
  Panel.prototype.applyAppearance = function (bg, ink) {
    var st = document.documentElement.style;
    ink = ink || '#0b1f2e';
    st.setProperty('--tl-bg', bg);
    st.setProperty('--tl-ink', ink);
    st.setProperty('--tl-field', pal.mix(bg, ink, 0.09));
    st.setProperty('--tl-line', pal.mix(bg, ink, 0.55));
  };

  Panel.prototype.build = function () {
    var self = this, api = this.api, s = api.get();
    var keepScroll = this.body ? this.body.scrollTop : 0;
    this.panel.innerHTML = '';
    var head = h('div', 'tl-ph');
    head.appendChild(h('span', null, 'Tide Lines settings'));
    var close = btn('tl-close', '×', 'Close settings');
    close.addEventListener('click', function () { self.toggle(false); });
    head.appendChild(close);
    this.panel.appendChild(head);
    var body = this.body = h('div', 'tl-pb');
    this.panel.appendChild(body);

    schema.GROUPS.forEach(function (g) {
      var wrap = h('div', 'tl-group' + (self.closed[g.id] ? ' closed' : ''));
      var gh = btn('tl-gh', null);
      gh.appendChild(h('span', null, g.label));
      gh.appendChild(h('span', null, self.closed[g.id] ? '+' : '−'));
      gh.setAttribute('aria-expanded', self.closed[g.id] ? 'false' : 'true');
      gh.addEventListener('click', function () { self.closed[g.id] = !self.closed[g.id]; self.build(); });
      wrap.appendChild(gh);
      var opts = h('div', 'tl-opts');
      g.options.forEach(function (o) {
        if (!schema.visible(o, s)) return;
        opts.appendChild(self.control(o, s[o.key]));
      });
      wrap.appendChild(opts);
      body.appendChild(wrap);
    });
    body.scrollTop = keepScroll;

    var foot = h('div', 'tl-pf');
    var reset = btn('tl-link', 'Reset to defaults');
    reset.addEventListener('click', function () { api.reset(); self.build(); });
    var paste = btn('tl-btn', 'Paste settings');
    var copy = btn('tl-btn', 'Copy settings');
    var msg = h('div', 'tl-msg'); msg.setAttribute('role', 'status');
    copy.addEventListener('click', function () {
      var txt = JSON.stringify(api.get(), null, 2), ok = false;
      try { var ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); document.body.removeChild(ta); } catch (e) { ok = false; }
      if (!ok) { try { navigator.clipboard.writeText(txt); ok = true; } catch (e2) { ok = false; } }
      msg.textContent = ok ? 'Settings copied. Paste them into the C-Tableau Viz pages settings box.' : 'Copy failed. Select the text under Paste settings instead.';
      copy.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { copy.textContent = 'Copy settings'; }, 1400);
      self.lastCopied = txt;
    });
    paste.addEventListener('click', function () {
      if (foot.querySelector('.tl-paste')) return;
      var box = h('div', 'tl-paste'), ta = document.createElement('textarea');
      ta.placeholder = 'Paste copied settings here'; ta.setAttribute('aria-label', 'Settings JSON');
      var apply = btn('tl-btn', 'Apply');
      apply.addEventListener('click', function () {
        try {
          var obj = JSON.parse(ta.value);
          if (!obj || typeof obj !== 'object') throw new Error('not an object');
          api.replaceAll(obj); self.build();
        } catch (e) { msg.textContent = 'Those settings could not be read. Check that you pasted all of the copied text.'; }
      });
      box.appendChild(ta); box.appendChild(apply);
      foot.appendChild(box);
    });
    foot.appendChild(reset); foot.appendChild(paste); foot.appendChild(copy); foot.appendChild(msg);
    this.panel.appendChild(foot);
  };

  Panel.prototype.control = function (o, value) {
    var self = this, api = this.api;
    var wrap = h('div', 'tl-opt'), row = h('div', 'tl-opt-row');
    var lab = h('label', null, o.label);
    row.appendChild(lab);
    var change = function (v) { api.set(o.key, v); /* rebuild only when a change can reveal or hide controls */
      var rebuild = schema.GROUPS.some(function (g) { return g.options.some(function (x) { return x.when && Object.prototype.hasOwnProperty.call(x.when, o.key); }); });
      if (rebuild) self.build(); };

    if (o.type === 'chips') {
      wrap.appendChild(row);
      var chips = h('div', 'tl-chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', o.label);
      o.choices.forEach(function (c) {
        var b = btn('tl-chip', c.label); b.setAttribute('aria-pressed', c.value === value ? 'true' : 'false'); b.dataset.value = c.value;
        b.addEventListener('click', function () {
          Array.prototype.forEach.call(chips.children, function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          change(c.value);
        });
        chips.appendChild(b);
      });
      wrap.appendChild(chips);
    } else if (o.type === 'toggle') {
      var sw = btn('tl-switch' + (value ? ' on' : ''), null, o.label);
      sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', value ? 'true' : 'false');
      sw.appendChild(h('span', 'tl-switch-knob'));
      var cur = !!value;
      sw.addEventListener('click', function () { cur = !cur; sw.classList.toggle('on', cur); sw.setAttribute('aria-checked', cur ? 'true' : 'false'); change(cur); });
      row.appendChild(sw); wrap.appendChild(row);
    } else if (o.type === 'number' || o.type === 'bandwidth') {
      var st = h('div', 'tl-stepper'), minus = btn('tl-step', '−', 'Decrease ' + o.label), plus = btn('tl-step', '+', 'Increase ' + o.label);
      var input = document.createElement('input');
      input.type = o.type === 'bandwidth' ? 'text' : 'number'; input.setAttribute('inputmode', 'decimal');
      input.setAttribute('aria-label', o.label);
      var isBw = o.type === 'bandwidth';
      var auto = function () { return api.ctx().autoBw || 0; };
      var show = function (v) {
        if (isBw) { input.value = v > 0 ? String(v) : ''; input.placeholder = auto() > 0 ? 'Auto ' + Number(auto().toPrecision(3)) : 'Auto'; }
        else input.value = String(v);
      };
      if (!isBw) { if (o.min !== undefined) input.min = o.min; if (o.max !== undefined) input.max = o.max; input.step = o.step || 1; }
      show(value);
      var commit = function (n) {
        if (!isFinite(n)) n = o.def;
        if (isBw && n <= 0) n = 0;
        else { if (o.min !== undefined) n = Math.max(o.min, n); if (o.max !== undefined) n = Math.min(o.max, n); }
        n = tidy(n); show(n); change(n);
      };
      var stepSize = function () { return isBw ? niceStep(auto()) : (o.step || 1); };
      minus.addEventListener('click', function () { var c = isBw ? (parseFloat(input.value) || auto()) : parseFloat(input.value); commit(c - stepSize()); });
      plus.addEventListener('click', function () { var c = isBw ? (parseFloat(input.value) || auto()) : parseFloat(input.value); commit(c + stepSize()); });
      input.addEventListener('change', function () { commit(input.value === '' && isBw ? 0 : parseFloat(input.value)); });
      st.appendChild(minus); st.appendChild(input); st.appendChild(plus);
      if (o.unit) st.appendChild(h('span', 'tl-unit', o.unit));
      if (isBw) { var autoBtn = btn('tl-chip', 'Auto'); autoBtn.addEventListener('click', function () { commit(0); }); st.appendChild(autoBtn); }
      row.appendChild(st); wrap.appendChild(row);
    } else if (o.type === 'color') {
      var cw = h('div', 'tl-color'), sw2 = document.createElement('input'), hex = document.createElement('input');
      sw2.type = 'color'; sw2.value = value; sw2.setAttribute('aria-label', o.label);
      hex.type = 'text'; hex.value = value; hex.spellcheck = false; hex.setAttribute('aria-label', o.label + ' hex value');
      sw2.addEventListener('input', function () { hex.value = sw2.value; change(sw2.value); });
      hex.addEventListener('change', function () { var v = hex.value.trim(); if (v.charAt(0) !== '#') v = '#' + v; if (/^#[0-9a-fA-F]{6}$/.test(v)) { sw2.value = v; change(v.toLowerCase()); } else hex.value = sw2.value; });
      cw.appendChild(sw2); cw.appendChild(hex); row.appendChild(cw); wrap.appendChild(row);
    } else if (o.type === 'select') {
      var sel = h('select', 'tl-select'); sel.setAttribute('aria-label', o.label);
      o.choices.forEach(function (c) { var op = h('option', null, c.label); op.value = c.value; if (c.value === value) op.selected = true; sel.appendChild(op); });
      sel.addEventListener('change', function () { change(sel.value); });
      row.appendChild(sel); wrap.appendChild(row);
    }
    if (o.help) wrap.appendChild(h('div', 'tl-help', o.help));
    return wrap;
  };

  Panel.niceStep = niceStep;
  TL.Panel = Panel;
})(typeof window !== 'undefined' ? window : globalThis);
