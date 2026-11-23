/* Schools - in-viz settings panel, generated from schema.js.
 * No sliders: steppers you can type into, chip groups, dropdowns, colour inputs.
 * No browser dialogs: paste and reset confirm inline.
 */
(function (global) {
  'use strict';
  var NS = global.SC, schema = NS.schema;

  function h(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  var GEAR = 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9.4 4a7.6 7.6 0 0 1-.1 1.2l2 1.6-1.9 3.3-2.5-1a7.6 7.6 0 0 1-2 1.2l-.4 2.6h-3.8l-.4-2.6a7.6 7.6 0 0 1-2-1.2l-2.5 1L2 14.8l2-1.6a7.6 7.6 0 0 1 0-2.4L2 9.2l1.9-3.3 2.5 1a7.6 7.6 0 0 1 2-1.2l.4-2.6h3.8l.4 2.6c.7.3 1.4.7 2 1.2l2.5-1L21.4 9l-2 1.6c.1.4.1.8.1 1.4z';
  function icon(path, stroke) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', 18); svg.setAttribute('height', 18);
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path); p.setAttribute('fill', stroke ? 'none' : 'currentColor');
    if (stroke) { p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); }
    svg.appendChild(p); return svg;
  }

  function toggle(opt, value, on) {
    var b = h('button', 'sc-switch' + (value ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(!!value)); b.setAttribute('aria-label', opt.label); b.appendChild(h('span', 'sc-knob'));
    var cur = value;
    b.addEventListener('click', function () { cur = !cur; b.classList.toggle('on', cur); b.setAttribute('aria-checked', String(cur)); on(cur); });
    return b;
  }
  function number(opt, value, on) {
    var w = h('div', 'sc-stepper'), minus = h('button', 'sc-step', '−'), plus = h('button', 'sc-step', '+');
    minus.type = plus.type = 'button'; minus.setAttribute('aria-label', 'Decrease ' + opt.label); plus.setAttribute('aria-label', 'Increase ' + opt.label);
    var i = document.createElement('input'); i.type = 'number'; i.value = value; i.step = opt.step || 1; i.setAttribute('aria-label', opt.label);
    if (opt.min !== undefined) i.min = opt.min; if (opt.max !== undefined) i.max = opt.max;
    function set(v) {
      var n = parseFloat(v); if (!isFinite(n)) n = opt.def;
      if (opt.min !== undefined) n = Math.max(opt.min, n); if (opt.max !== undefined) n = Math.min(opt.max, n);
      n = Math.round(n * 1000) / 1000; i.value = n; on(n);
    }
    minus.addEventListener('click', function () { set(parseFloat(i.value) - (opt.step || 1)); });
    plus.addEventListener('click', function () { set(parseFloat(i.value) + (opt.step || 1)); });
    i.addEventListener('change', function () { set(i.value); });
    w.appendChild(minus); w.appendChild(i); if (opt.unit) w.appendChild(h('span', 'sc-unit', opt.unit)); w.appendChild(plus);
    return w;
  }
  function color(opt, value, on) {
    var w = h('div', 'sc-color'), sw = document.createElement('input'), hx = document.createElement('input');
    sw.type = 'color'; sw.value = value; sw.setAttribute('aria-label', opt.label);
    hx.type = 'text'; hx.className = 'sc-hex'; hx.value = value; hx.spellcheck = false; hx.setAttribute('aria-label', opt.label + ' hex');
    sw.addEventListener('input', function () { hx.value = sw.value; on(sw.value); });
    hx.addEventListener('change', function () {
      var v = hx.value.trim(); if (/^[0-9a-f]{6}$/i.test(v)) v = '#' + v;
      if (/^#[0-9a-f]{6}$/i.test(v)) { sw.value = v; hx.value = v; on(v); } else hx.value = sw.value;
    });
    w.appendChild(sw); w.appendChild(hx); return w;
  }
  function segmented(opt, value, on) {
    var w = h('div', 'sc-seg'), btns = []; w.setAttribute('role', 'radiogroup'); w.setAttribute('aria-label', opt.label);
    opt.choices.forEach(function (c) {
      var b = h('button', 'sc-seg-btn' + (c.value === value ? ' on' : ''), c.label); b.type = 'button';
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(c.value === value));
      b.addEventListener('click', function () {
        btns.forEach(function (o) { o.classList.toggle('on', o === b); o.setAttribute('aria-checked', String(o === b)); }); on(c.value);
      });
      btns.push(b); w.appendChild(b);
    });
    return w;
  }
  function select(opt, value, on, columns) {
    var s = h('select', 'sc-select'); s.setAttribute('aria-label', opt.label);
    var choices = opt.choices;
    if (choices === 'columns') {
      choices = [{ value: '', label: '(none)' }].concat((columns() || []).map(function (c) { return { value: c, label: c }; }));
      if (value && !choices.some(function (c) { return c.value === value; })) choices.push({ value: value, label: value });
    }
    choices.forEach(function (c) { var o = document.createElement('option'); o.value = c.value; o.textContent = c.label; if (c.value === value) o.selected = true; s.appendChild(o); });
    s.addEventListener('change', function () { on(s.value); });
    return s;
  }
  var BUILD = { toggle: toggle, number: number, color: color, segmented: segmented, select: select };

  function Panel(host, api) {
    this.host = host; this.api = api; this.open = false; this.collapsed = {}; this.filter = '';
    var self = this;
    var gear = this.gear = h('button', 'sc-gear at-tr'); gear.type = 'button'; gear.title = 'Chart settings';
    gear.setAttribute('aria-label', 'Open chart settings'); gear.appendChild(icon(GEAR));
    gear.addEventListener('click', function () { self.toggle(); });
    var panel = this.panel = h('aside', 'sc-panel'); panel.setAttribute('aria-label', 'Chart settings');
    var head = h('div', 'sc-head'); head.appendChild(h('div', 'sc-title', 'Chart settings'));
    var x = h('button', 'sc-iconbtn'); x.type = 'button'; x.setAttribute('aria-label', 'Close settings'); x.appendChild(icon('M6 6l12 12M18 6L6 18', true));
    x.addEventListener('click', function () { self.toggle(false); }); head.appendChild(x); panel.appendChild(head);
    var q = document.createElement('input'); q.type = 'search'; q.className = 'sc-search'; q.placeholder = 'Find a setting'; q.setAttribute('aria-label', 'Find a setting');
    q.addEventListener('input', function () { self.filter = q.value.trim().toLowerCase(); self.refresh(); }); panel.appendChild(q);
    this.body = h('div', 'sc-body'); panel.appendChild(this.body);
    // paste area (inline, replaces the browser prompt)
    var pasteBox = this.pasteBox = h('div', 'sc-pastebox'); pasteBox.style.display = 'none';
    var ta = this.ta = document.createElement('textarea'); ta.setAttribute('aria-label', 'Settings JSON'); ta.placeholder = 'Paste a settings JSON block here';
    var apply = h('button', 'sc-btn', 'Apply'); apply.type = 'button';
    this.msg = h('div', 'sc-msg'); this.msg.setAttribute('role', 'status');
    apply.addEventListener('click', function () {
      try { var o = JSON.parse(ta.value); if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('x'); api.replaceAll(o); ta.value = ''; pasteBox.style.display = 'none'; self.flash('Settings applied'); self.refresh(); }
      catch (e) { self.flash('That is not valid settings JSON'); }
    });
    pasteBox.appendChild(ta); pasteBox.appendChild(apply); panel.appendChild(pasteBox); panel.appendChild(this.msg);
    var foot = h('div', 'sc-foot');
    var reset = this.resetBtn = h('button', 'sc-btn', 'Reset all'); reset.type = 'button';
    reset.addEventListener('click', function () {
      if (self._arm) { clearTimeout(self._armT); self._arm = false; reset.textContent = 'Reset all'; reset.classList.remove('danger'); api.reset(); self.refresh(); }
      else { self._arm = true; reset.textContent = 'Press again to confirm'; reset.classList.add('danger'); self._armT = setTimeout(function () { self._arm = false; reset.textContent = 'Reset all'; reset.classList.remove('danger'); }, 3500); }
    });
    var copy = h('button', 'sc-btn', 'Copy settings'); copy.type = 'button';
    copy.addEventListener('click', function () {
      var json = JSON.stringify(api.get(), null, 2);
      function done(ok) { self.flash(ok ? 'Settings copied' : 'Copy failed. Select the text below and copy it.'); if (!ok) { pasteBox.style.display = ''; ta.value = json; ta.select(); } }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(function () { done(true); }, function () { done(legacy(json)); });
      else done(legacy(json));
    });
    var paste = h('button', 'sc-btn', 'Paste settings'); paste.type = 'button';
    paste.addEventListener('click', function () { var on = pasteBox.style.display === 'none'; pasteBox.style.display = on ? '' : 'none'; if (on) ta.focus(); });
    foot.appendChild(reset); foot.appendChild(copy); foot.appendChild(paste); panel.appendChild(foot);
    host.appendChild(gear); host.appendChild(panel);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && self.open) self.toggle(false); });
    this.refresh();
  }
  function legacy(text) {
    var t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } document.body.removeChild(t); return ok;
  }
  Panel.prototype.flash = function (t) { var m = this.msg; m.textContent = t; clearTimeout(this._mt); this._mt = setTimeout(function () { m.textContent = ''; }, 2600); };
  Panel.prototype.applyAppearance = function (s) {
    var corner = s.gearCorner || 'tr', g = this.gear;
    ['tr', 'tl', 'br', 'bl'].forEach(function (c) { g.classList.toggle('at-' + c, c === corner); });
    this.panel.classList.toggle('side-left', corner === 'tl' || corner === 'bl');
  };
  Panel.prototype.toggle = function (force) {
    this.open = force === undefined ? !this.open : !!force;
    this.panel.classList.toggle('open', this.open); this.gear.classList.toggle('active', this.open);
    this.gear.setAttribute('aria-label', this.open ? 'Close chart settings' : 'Open chart settings');
    if (this.open) this.refresh();
  };
  Panel.prototype.refresh = function () {
    var self = this, s = this.api.get(), body = this.body, top = body.scrollTop, shown = 0;
    body.textContent = '';
    schema.GROUPS.forEach(function (g) {
      var vis = g.options.filter(function (o) {
        if (!schema.isVisible(o, s)) return false;
        return !self.filter || (o.label + ' ' + g.label + ' ' + (o.help || '')).toLowerCase().indexOf(self.filter) >= 0;
      });
      if (!vis.length) return; shown += vis.length;
      var sec = h('section', 'sc-sec'), col = !!self.collapsed[g.id] && !self.filter;
      var hd = h('button', 'sc-ghead' + (col ? ' collapsed' : '')); hd.type = 'button'; hd.setAttribute('aria-expanded', String(!col));
      hd.appendChild(h('span', null, g.label)); hd.appendChild(h('span', 'sc-caret', '›'));
      hd.addEventListener('click', function () { self.collapsed[g.id] = !self.collapsed[g.id]; self.refresh(); });
      sec.appendChild(hd);
      if (!col) {
        var list = h('div', 'sc-gbody');
        vis.forEach(function (o) {
          var row = h('div', 'sc-row' + (o.type === 'toggle' ? ' inline' : '')); row.appendChild(h('label', 'sc-label', o.label));
          var ctl = BUILD[o.type](o, s[o.key], function (v) {
            self.api.set(o.key, v);
            var gates = schema.GROUPS.some(function (g2) { return g2.options.some(function (o2) { return o2.when && o2.when.key === o.key; }); });
            if (gates) self.refresh();
          }, self.api.columns);
          ctl.classList.add('sc-ctl'); row.appendChild(ctl);
          if (o.help) row.appendChild(h('div', 'sc-help', o.help));
          list.appendChild(row);
        });
        sec.appendChild(list);
      }
      body.appendChild(sec);
    });
    if (!shown) body.appendChild(h('div', 'sc-none', 'No setting matches "' + this.filter + '".'));
    body.scrollTop = top;
  };
  NS.Panel = Panel;
})(typeof window !== 'undefined' ? window : globalThis);
