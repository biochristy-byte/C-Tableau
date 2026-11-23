/* In-viz gear settings panel, built from a schema (see core.js makeSchema).
 * Identical in Depth Lines and Sketchbook. No sliders: toggles, steppers you can
 * type into, chip groups, dropdowns and color inputs. No browser dialogs:
 * pasting settings uses an inline text box. */
(function (global) {
  'use strict';

  function h (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function Panel (root, schema, ctl) {
    this.root = root; this.schema = schema; this.ctl = ctl;
    this.open = false; this.rows = [];
    this._build();
  }

  Panel.prototype._build = function () {
    var self = this, s = this.schema;
    var gear = h('button', 'xp-gear');
    gear.type = 'button';
    gear.setAttribute('aria-label', 'Settings');
    gear.setAttribute('aria-expanded', 'false');
    gear.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
    gear.addEventListener('click', function () { self.toggle(); });
    this.gear = gear;

    var panel = h('div', 'xp-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Settings');
    panel.hidden = true;
    this.panel = panel;

    var head = h('div', 'xp-head');
    head.appendChild(h('div', 'xp-title', 'Settings'));
    var close = h('button', 'xp-btn xp-close', 'Close');
    close.type = 'button';
    close.addEventListener('click', function () { self.toggle(false); });
    head.appendChild(close);
    panel.appendChild(head);

    var body = h('div', 'xp-body');
    this.body = body;
    s.GROUPS.forEach(function (g, gi) {
      var d = h('details', 'xp-group');
      if (gi === 0) d.open = true;
      d.appendChild(h('summary', 'xp-sum', g.label));
      g.options.forEach(function (o) { d.appendChild(self._row(o)); });
      body.appendChild(d);
    });
    panel.appendChild(body);

    var foot = h('div', 'xp-foot');
    var reset = h('button', 'xp-btn', 'Reset all'); reset.type = 'button';
    reset.addEventListener('click', function () {
      if (self._confirm) { self._confirm = false; reset.textContent = 'Reset all'; reset.classList.remove('xp-danger'); self.ctl.reset(); self.refresh(); }
      else {
        self._confirm = true; reset.textContent = 'Tap again to confirm'; reset.classList.add('xp-danger');
        setTimeout(function () { self._confirm = false; reset.textContent = 'Reset all'; reset.classList.remove('xp-danger'); }, 3500);
      }
    });
    var copy = h('button', 'xp-btn', 'Copy settings'); copy.type = 'button';
    copy.addEventListener('click', function () { self._copy(copy); });
    var paste = h('button', 'xp-btn', 'Paste settings'); paste.type = 'button';
    paste.addEventListener('click', function () { self.pasteBox.hidden = !self.pasteBox.hidden; if (!self.pasteBox.hidden) self.pasteText.focus(); });
    foot.appendChild(reset); foot.appendChild(copy); foot.appendChild(paste);
    panel.appendChild(foot);

    var pb = h('div', 'xp-paste'); pb.hidden = true;
    var ta = h('textarea', 'xp-paste-text'); ta.rows = 4; ta.setAttribute('aria-label', 'Settings JSON'); ta.placeholder = 'Paste the settings JSON here';
    var apply = h('button', 'xp-btn', 'Apply'); apply.type = 'button';
    var msg = h('div', 'xp-msg');
    apply.addEventListener('click', function () {
      try {
        var obj = JSON.parse(ta.value);
        if (!obj || typeof obj !== 'object') throw new Error('not an object');
        self.ctl.replaceAll(obj); self.refresh();
        msg.textContent = 'Applied.'; pb.hidden = true; ta.value = '';
      } catch (e) { msg.textContent = 'That is not valid settings JSON.'; }
    });
    pb.appendChild(ta); pb.appendChild(apply); pb.appendChild(msg);
    panel.appendChild(pb);
    this.pasteBox = pb; this.pasteText = ta;

    this.root.appendChild(gear);
    this.root.appendChild(panel);
    this.refresh();
  };

  Panel.prototype._copy = function (btn) {
    var json = JSON.stringify(this.ctl.get(), null, 2);
    var done = function (ok) {
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { btn.textContent = 'Copy settings'; }, 1600);
    };
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = json; ta.style.cssText = 'position:fixed;left:-999px;top:0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta); done(ok);
    };
    /* Tableau's extension frame blocks the async clipboard API, so try
     * execCommand first and fall back to the API. */
    try {
      var ta2 = document.createElement('textarea');
      ta2.value = json; ta2.style.cssText = 'position:fixed;left:-999px;top:0';
      document.body.appendChild(ta2); ta2.select();
      var ok2 = document.execCommand('copy');
      document.body.removeChild(ta2);
      if (ok2) return done(true);
    } catch (e) { /* try the API */ }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json).then(function () { done(true); }, fallback);
    else fallback();
  };

  Panel.prototype._row = function (o) {
    var self = this;
    var row = h('div', 'xp-row'); row.setAttribute('data-key', o.key);
    var id = 'xp-' + o.key;
    var lab = h('label', 'xp-label', o.label); lab.setAttribute('for', id);
    row.appendChild(lab);
    var ctrl = h('div', 'xp-ctrl');
    var set = function (v) { self.ctl.set(o.key, v); self.refresh(); };
    var get = function () { return self.ctl.get()[o.key]; };
    var update;

    if (o.type === 'toggle') {
      var cb = h('input', 'xp-check'); cb.type = 'checkbox'; cb.id = id;
      cb.addEventListener('change', function () { set(cb.checked); });
      ctrl.appendChild(cb); update = function () { cb.checked = !!get(); };
    } else if (o.type === 'number') {
      var wrap = h('div', 'xp-step');
      var minus = h('button', 'xp-btn xp-sbtn', '−'); minus.type = 'button'; minus.setAttribute('aria-label', 'Decrease ' + o.label);
      var inp = h('input', 'xp-num'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.id = id;
      var plus = h('button', 'xp-btn xp-sbtn', '+'); plus.type = 'button'; plus.setAttribute('aria-label', 'Increase ' + o.label);
      var bump = function (dir) {
        var v = Number(get()) + dir * (o.step || 1);
        set(Math.round(v * 10000) / 10000);
      };
      minus.addEventListener('click', function () { bump(-1); });
      plus.addEventListener('click', function () { bump(1); });
      inp.addEventListener('change', function () { set(inp.value); });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { set(inp.value); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); }
      });
      wrap.appendChild(minus); wrap.appendChild(inp); wrap.appendChild(plus);
      if (o.unit) wrap.appendChild(h('span', 'xp-unit', o.unit));
      ctrl.appendChild(wrap); update = function () { inp.value = String(get()); };
    } else if (o.type === 'segmented') {
      var grp = h('div', 'xp-chips'); grp.setAttribute('role', 'group'); grp.setAttribute('aria-label', o.label);
      var btns = o.choices.map(function (c) {
        var b = h('button', 'xp-chip', c.label); b.type = 'button'; b.setAttribute('data-value', c.value);
        b.addEventListener('click', function () { set(c.value); });
        grp.appendChild(b); return b;
      });
      ctrl.appendChild(grp);
      update = function () { btns.forEach(function (b) { var on = b.getAttribute('data-value') === String(get()); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); };
    } else if (o.type === 'select') {
      var sel = h('select', 'xp-select'); sel.id = id;
      o.choices.forEach(function (c) { var op = h('option', '', c.label); op.value = c.value; sel.appendChild(op); });
      sel.addEventListener('change', function () { set(sel.value); });
      ctrl.appendChild(sel); update = function () { sel.value = String(get()); };
    } else if (o.type === 'color') {
      var cw = h('div', 'xp-colorwrap');
      var ci = h('input', 'xp-color'); ci.type = 'color'; ci.id = id;
      var ct = h('input', 'xp-hex'); ct.type = 'text'; ct.maxLength = 7; ct.setAttribute('aria-label', o.label + ' hex');
      ci.addEventListener('input', function () { set(ci.value); });
      ct.addEventListener('change', function () { set(ct.value); });
      cw.appendChild(ci); cw.appendChild(ct); ctrl.appendChild(cw);
      update = function () { ci.value = String(get()); ct.value = String(get()); };
    } else {
      var ti = h('input', 'xp-text'); ti.type = 'text'; ti.id = id;
      ti.addEventListener('change', function () { set(ti.value); });
      ctrl.appendChild(ti); update = function () { ti.value = String(get()); };
    }
    row.appendChild(ctrl);
    if (o.help) row.appendChild(h('div', 'xp-help', o.help));
    this.rows.push({ opt: o, row: row, update: update });
    return row;
  };

  Panel.prototype.refresh = function () {
    var cur = this.ctl.get();
    this.rows.forEach(function (r) {
      r.update();
      var w = r.opt.when;
      r.row.hidden = !!(w && cur[w.key] !== w.eq && !(w.in && w.in.indexOf(cur[w.key]) >= 0));
    });
  };

  Panel.prototype.toggle = function (on) {
    this.open = on === undefined ? !this.open : !!on;
    this.panel.hidden = !this.open;
    this.gear.setAttribute('aria-expanded', this.open ? 'true' : 'false');
  };

  /* The panel follows the chart: bg and ink come from the resolved theme. */
  Panel.prototype.applyAppearance = function (bg, ink, accent, showGear) {
    var st = this.root.style;
    st.setProperty('--xp-bg', bg); st.setProperty('--xp-fg', ink);
    st.setProperty('--xp-line', global.HX.mix(bg, ink, 0.45));
    st.setProperty('--xp-field', global.HX.mix(bg, ink, 0.08));
    st.setProperty('--xp-accent', accent || ink);
    st.setProperty('--xp-accent-fg', global.HX.pickText(accent || ink));
    this.gear.hidden = showGear === false;
    if (showGear === false && this.open) this.toggle(false);
  };

  global.HX.Panel = Panel;
})(typeof window !== 'undefined' ? window : globalThis);
