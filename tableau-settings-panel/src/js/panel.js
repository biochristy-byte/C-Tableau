/* Settings Panel - the floating panel. It wears the shared ctab-panel look (the cp-* classes and the same 7:1 theme
 * function, CTabPanel.color.themeTokens) but its rows are built from the live workbook: every parameter, every
 * worksheet filter, mark highlighting and named presets. No browser dialogs, no range inputs, text 14px or more.
 *
 * SP.panel.create(host, ctx) where ctx = { model, settings, apply: {...}, canFit, onFit(open, size), onRefresh() }.
 */
(function (global) {
  'use strict';
  var CP = global.CTabPanel, M = global.SP.model;
  var TABS = [['params', 'Parameters'], ['filters', 'Filters'], ['highlight', 'Highlight'], ['presets', 'Presets'], ['panel', 'Panel']];
  var PANEL_KEY = 'sp.panel';
  var HL_SHOW = 100;   /* highlight lists: a sheet can have thousands of marks, so the find box does the narrowing */
  var GEAR = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.6 7.6 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6c-.6.3-1.2.6-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .2.2.4.5.4h4c.3 0 .5-.2.5-.4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6L19.4 13zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';

  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pdec(c) { return c.free ? Math.max(c.dec || 0, M.decimals(c.value)) : c.dec; }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function fmtNum(v, dec) { return isFinite(v) ? Number(v).toFixed(dec || 0) : ''; }

  function create(host, ctx) {
    var doc = host.ownerDocument, win = doc.defaultView, st = ctx.settings;
    var S = { model: ctx.model, tab: 'params', query: '', expanded: {}, listQ: {}, marks: {}, hlField: {}, hlSel: {}, hlAll: false,
      presets: M.loadPresets(st), defaults: M.loadDefaults(st), editing: null, confirm: null, status: '', err: false, dirty: {}, timers: {}, busy: false, sheet: false, drag: null };
    var ps = { theme: 'auto', customBg: '#ffffff', customInk: '#14202e', x: null, y: null, min: false, tab: 'params', fit: true, w: 380, h: 640 };
    try { var saved = JSON.parse(st.get(PANEL_KEY) || '{}'); Object.keys(ps).forEach(function (k) { if (saved[k] !== undefined && saved[k] !== null) ps[k] = saved[k]; }); } catch (e) { /* first run */ }
    if (!TABS.some(function (t) { return t[0] === ps.tab; })) ps.tab = 'params';
    S.tab = ps.tab;
    var psTimer = null;
    function persist() {
      try { st.set(PANEL_KEY, JSON.stringify(ps)); } catch (e) { return; }
      if (psTimer) clearTimeout(psTimer);
      psTimer = setTimeout(function () { psTimer = null; try { var p = st.saveAsync(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* cosmetic */ } }, 400);
    }

    /* ---------------------------------------------------------- skeleton */
    var gear = doc.createElement('button');
    gear.type = 'button'; gear.className = 'cp-gear sp-gear'; gear.setAttribute('aria-label', 'Open dashboard controls');
    gear.setAttribute('aria-haspopup', 'dialog'); gear.setAttribute('aria-expanded', 'false'); gear.title = 'Dashboard controls'; gear.innerHTML = GEAR;
    var panel = doc.createElement('div');
    panel.className = 'cp-panel sp-panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Dashboard controls'); panel.tabIndex = -1;
    panel.innerHTML =
      '<div class="cp-head" tabindex="0" aria-label="Dashboard controls title bar. Drag to move, or use the arrow keys."><span class="cp-grip" aria-hidden="true">&#8942;&#8942;</span>' +
      '<h2 class="cp-title">Dashboard controls</h2>' +
      '<button type="button" class="cp-ib" data-act="min" aria-label="Minimize controls">&minus;</button>' +
      '<button type="button" class="cp-ib" data-act="close" aria-label="Close controls">&times;</button></div>' +
      '<div class="cp-main"><div class="cp-search"><input type="text" class="cp-q" data-in="q" aria-label="Search every control" placeholder="Search parameters, filters, presets" autocomplete="off" spellcheck="false"></div>' +
      '<div class="cp-tabs" role="tablist" aria-label="Control groups"></div><div class="cp-body" role="tabpanel"></div>' +
      '<div class="cp-status" role="status" aria-live="polite"></div><div class="cp-foot"></div></div>';
    if (win.getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(gear); host.appendChild(panel);
    var head = panel.querySelector('.cp-head'), tabsEl = panel.querySelector('.cp-tabs'), bodyEl = panel.querySelector('.cp-body');
    var statusEl = panel.querySelector('.cp-status'), footEl = panel.querySelector('.cp-foot'), qEl = panel.querySelector('.cp-q');

    /* ------------------------------------------------------------- theme */
    var mq = win.matchMedia ? win.matchMedia('(prefers-color-scheme: dark)') : null;
    function themeName() { return ps.theme === 'auto' ? (mq && mq.matches ? 'dark' : 'light') : ps.theme; }
    function applyTheme() {
      var t = CP.color.themeTokens(themeName(), null, { bg: ps.customBg, ink: ps.customInk });
      [panel, gear].forEach(function (el) {
        var s = el.style;
        s.setProperty('--cp-bg', t.bg); s.setProperty('--cp-surface', t.surface); s.setProperty('--cp-ink', t.ink); s.setProperty('--cp-muted', t.muted);
        s.setProperty('--cp-border', t.border); s.setProperty('--cp-accent', t.accent); s.setProperty('--cp-danger', t.danger);
      });
      panel.setAttribute('data-theme', themeName());
      S.tokens = t;
    }
    if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (ps.theme === 'auto') applyTheme(); });

    /* --------------------------------------------------------- placement */
    function hostSize() { return { w: host.clientWidth, h: host.clientHeight }; }
    function place(x, y, save) {
      if (S.sheet) return;
      var hs = hostSize(), w = panel.offsetWidth, h = panel.offsetHeight;
      ps.x = Math.round(Math.max(0, Math.min(hs.w - w, x))); ps.y = Math.round(Math.max(0, Math.min(hs.h - h, y)));
      panel.style.transform = 'translate(' + ps.x + 'px,' + ps.y + 'px)';
      if (save) persist();
    }
    function settle() {
      S.sheet = hostSize().w < 420;
      panel.classList.toggle('cp-sheet', S.sheet);
      panel.classList.toggle('sp-fitted', S.sheet && !!ctx.canFit && !!ps.fit);   /* the zone is the panel: keep its frame */
      if (S.sheet) { panel.style.transform = ''; return; }
      if (ps.x === null || ps.y === null) place(hostSize().w - panel.offsetWidth - 8, 8, false); else place(ps.x, ps.y, false);
    }
    var ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(function () { if (!panel.hidden) settle(); }) : null;
    if (ro) ro.observe(host); else win.addEventListener('resize', function () { if (!panel.hidden) settle(); });
    head.addEventListener('pointerdown', function (e) {
      if (S.sheet || e.target.closest('button') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      S.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: ps.x || 0, oy: ps.y || 0 };
      try { head.setPointerCapture(e.pointerId); } catch (er) { /* synthetic */ }
      panel.classList.add('cp-dragging'); e.preventDefault();
    });
    head.addEventListener('pointermove', function (e) { if (S.drag && e.pointerId === S.drag.id) place(S.drag.ox + e.clientX - S.drag.sx, S.drag.oy + e.clientY - S.drag.sy, false); });
    function endDrag() { if (!S.drag) return; S.drag = null; panel.classList.remove('cp-dragging'); persist(); }
    head.addEventListener('pointerup', endDrag); head.addEventListener('pointercancel', endDrag); head.addEventListener('lostpointercapture', endDrag);
    head.addEventListener('keydown', function (e) {
      if (e.target !== head || S.sheet) return;
      var d = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
      if (d) { e.preventDefault(); place((ps.x || 0) + d[0], (ps.y || 0) + d[1], true); }
    });

    /* ------------------------------------------------------------ status */
    function say(msg, err) { S.status = msg || ''; S.err = !!err; statusEl.textContent = S.status; statusEl.className = 'cp-status' + (err ? ' cp-err' : ''); }

    /* ------------------------------------------------------------ writes */
    /* One queue per control: the newest value wins, rapid clicks become one Tableau call. */
    function queue(id, delay, fn, okMsg) {
      S.dirty[id] = (S.dirty[id] || 0) + 1;
      if (S.timers[id]) clearTimeout(S.timers[id]);
      S.timers[id] = setTimeout(function () {
        S.timers[id] = null;
        Promise.resolve().then(fn).then(function () { if (okMsg) say(typeof okMsg === 'function' ? okMsg() : okMsg); }, function (e) { say((e && e.message) || 'Tableau did not accept that change.', true); })
          .then(function () { S.dirty[id] = 0; if (ctx.onRefresh) ctx.onRefresh(); });
      }, delay);
    }
    function findCtl(id) { return S.model.params.concat(S.model.filters).filter(function (c) { return c.id === id; })[0]; }

    /* ---------------------------------------------------------- controls */
    function chip(act, id, v, label, on, extra) {
      return '<button type="button" class="cp-chip" data-act="' + act + '" data-id="' + esc(id) + '" data-v="' + esc(v) + '" aria-pressed="' + (on ? 'true' : 'false') + '"' + (extra || '') + '>' + esc(label) + '</button>';
    }
    function stepper(act, id, end, val, label, inputmode) {
      var fk = act + '|' + id + '|' + (end || '');
      return '<div class="cp-num"><button type="button" class="cp-step" data-act="' + act + '" data-id="' + esc(id) + '" data-end="' + (end || '') + '" data-d="-1" aria-label="Decrease ' + esc(label) + '">&minus;</button>' +
        '<input type="text" inputmode="' + (inputmode || 'decimal') + '" data-in="' + act + '" data-id="' + esc(id) + '" data-end="' + (end || '') + '" data-fk="' + esc(fk) + '" aria-label="' + esc(label) + '" value="' + esc(val) + '" autocomplete="off" spellcheck="false">' +
        '<button type="button" class="cp-step" data-act="' + act + '" data-id="' + esc(id) + '" data-end="' + (end || '') + '" data-d="1" aria-label="Increase ' + esc(label) + '">+</button></div>';
    }
    function help(t) { return t ? '<div class="cp-help">' + esc(t) + '</div>' : ''; }

    function paramRow(c) {
      var lab = '<div class="cp-lab" id="l-' + esc(c.id) + '">' + esc(c.label) + '</div>', ctl = '', h = '';
      if (c.control === 'toggle') {
        ctl = '<button type="button" class="sp-switch" role="switch" data-act="pswitch" data-id="' + esc(c.id) + '" aria-checked="' + (c.value ? 'true' : 'false') + '" aria-labelledby="l-' + esc(c.id) + '"><span class="sp-knob" aria-hidden="true"></span><span>' + (c.value ? 'On' : 'Off') + '</span></button>';
      } else if (c.control === 'chips') {
        ctl = '<div class="cp-chips" role="group" aria-labelledby="l-' + esc(c.id) + '">' + c.options.map(function (o) { return chip('pchip', c.id, o.value, o.label, o.value === String(c.value)); }).join('') + '</div>';
      } else if (c.control === 'select') {
        ctl = '<select data-in="psel" data-id="' + esc(c.id) + '" data-fk="psel|' + esc(c.id) + '" aria-labelledby="l-' + esc(c.id) + '">' + c.options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (o.value === String(c.value) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>';
      } else if (c.control === 'stepper') {
        ctl = stepper('pnum', c.id, '', fmtNum(c.value, pdec(c)), c.label);
        h = (c.min !== null && c.max !== null ? 'From ' + c.min + ' to ' + c.max + ', steps of ' + c.step + '.' : 'Any number. The buttons step by ' + c.step + '.') + (c.formatted && c.formatted !== String(c.value) ? ' Shown in Tableau as ' + c.formatted + '.' : '');
      } else if (c.control === 'date') {
        ctl = stepper('pdate', c.id, '', c.value || '', c.label, 'numeric');
        h = 'Type a date like 2026-11-24. The buttons step by ' + c.step + ' ' + String(c.period).replace(/s$/, '') + (c.step === 1 ? '' : 's') + '.' + (c.min && c.max ? ' From ' + c.min + ' to ' + c.max + '.' : '');
      } else {
        ctl = '<input type="text" data-in="ptext" data-id="' + esc(c.id) + '" data-fk="ptext|' + esc(c.id) + '" aria-labelledby="l-' + esc(c.id) + '" value="' + esc(c.value) + '" maxlength="300" autocomplete="off">';
        h = 'Press Enter to send it to Tableau.';
      }
      return '<div class="cp-row sp-ctl" data-ctl="' + esc(c.id) + '">' + lab + ctl + help(h) + '</div>';
    }

    function catSummary(g) {
      var n = g.domain.length;
      if (g.all) return 'All ' + n;
      if (g.exclude) return 'Excluding ' + g.selected.length + ' of ' + n;
      return g.selected.length + ' of ' + n + ' kept';
    }
    function filterRow(g) {
      var id = esc(g.id), where = g.sheets.length > 1 ? 'Applies to ' + g.sheets.join(', ') + '.' : '';
      if (g.unsupported) return '<div class="cp-row sp-ctl" data-ctl="' + id + '"><div class="cp-lab cp-full">' + esc(g.label) + '</div>' + help('A hierarchical filter. Change it in Tableau; extensions cannot edit it.') + '</div>';
      if (g.type === 'categorical') {
        var open = S.expanded[g.id] !== undefined ? S.expanded[g.id] : g.domain.length <= 12, out = '';
        out += '<div class="cp-full sp-disc-row"><button type="button" class="sp-disc" data-act="fdisc" data-id="' + id + '" aria-expanded="' + open + '"><span class="sp-caret" aria-hidden="true">' + (open ? '&#9662;' : '&#9656;') + '</span><span class="sp-name">' + esc(g.label) + '</span><span class="sp-sum">' + esc(catSummary(g)) + '</span></button></div>';
        if (open) {
          out += '<div class="cp-full cp-chips" role="group" aria-label="' + esc(g.label) + ' mode">' + chip('fmode', g.id, 'keep', 'Keep checked', !g.exclude) + chip('fmode', g.id, 'exclude', 'Exclude checked', g.exclude) +
            '<button type="button" class="cp-btn cp-small" data-act="fall" data-id="' + id + '">All</button><button type="button" class="cp-btn cp-small" data-act="fnone" data-id="' + id + '">None</button></div>';
          if (g.domain.length > 12) out += '<div class="cp-full"><input type="text" data-in="flq" data-id="' + id + '" data-fk="flq|' + id + '" aria-label="Find a ' + esc(g.label) + ' value" placeholder="Find a value" value="' + esc(S.listQ[g.id] || '') + '" autocomplete="off"></div>';
          out += '<div class="cp-full sp-list" role="group" aria-label="' + esc(g.label) + ' values">' + listHtml(g) + '</div>';
        }
        return '<div class="cp-row sp-ctl" data-ctl="' + id + '">' + out + help(where) + '</div>';
      }
      if (g.type === 'range') {
        var mode = g.isDate ? 'numeric' : 'decimal', mn = g.isDate ? g.min : fmtNum(g.min, g.dec), mx = g.isDate ? g.max : fmtNum(g.max, g.dec);
        return '<div class="cp-row sp-ctl" data-ctl="' + id + '"><div class="cp-lab cp-full">' + esc(g.label) + '</div>' +
          '<div class="cp-lab">From</div>' + stepper('rnum', g.id, 'min', mn, g.label + ' from', mode) +
          '<div class="cp-lab">To</div>' + stepper('rnum', g.id, 'max', mx, g.label + ' to', mode) +
          '<label class="cp-check cp-full"><input type="checkbox" data-in="rnull" data-id="' + id + '"' + (g.nulls ? ' checked' : '') + '> Include empty values</label>' +
          '<div class="cp-full"><button type="button" class="cp-btn cp-small" data-act="fclear" data-id="' + id + '">Show everything</button></div>' +
          help((g.isDate ? 'Dates like 2026-11-24, one day per step. ' : 'Steps of ' + g.step + '. ') + 'The data runs from ' + (g.isDate ? g.dmin : fmtNum(g.dmin, g.dec)) + ' to ' + (g.isDate ? g.dmax : fmtNum(g.dmax, g.dec)) + '. ' + where) + '</div>';
      }
      var n = g.range === 'lastn' || g.range === 'nextn';
      return '<div class="cp-row sp-ctl" data-ctl="' + id + '"><div class="cp-lab cp-full">' + esc(g.label) + '</div>' +
        '<div class="cp-full cp-chips" role="group" aria-label="' + esc(g.label) + ' range">' + M.RANGES.map(function (r) { return chip('relr', g.id, r[0], r[1], g.range === r[0]); }).join('') + '</div>' +
        '<div class="cp-full cp-chips" role="group" aria-label="' + esc(g.label) + ' period">' + M.PERIODS.map(function (p) { return chip('relp', g.id, p[0], p[1], g.period === p[0]); }).join('') + '</div>' +
        (n ? '<div class="cp-lab">How many</div>' + stepper('reln', g.id, '', String(g.n), g.label + ' how many', 'numeric') : '') +
        '<div class="cp-lab">Counting from</div>' + stepper('rela', g.id, '', g.anchor, g.label + ' anchor date', 'numeric') +
        help('Reads as: ' + relText(g) + '. ' + where) + '</div>';
    }
    function relText(g) {
      var p = (M.PERIODS.filter(function (x) { return x[0] === g.period; })[0] || ['', g.period])[1].toLowerCase(), one = p.replace(/s$/, '');
      return { last: 'previous ' + one, current: 'this ' + one, next: 'next ' + one, lastn: 'last ' + g.n + ' ' + (g.n === 1 ? one : p), nextn: 'next ' + g.n + ' ' + (g.n === 1 ? one : p), todate: one + ' to date' }[g.range] + ', counting from ' + g.anchor;
    }
    function listHtml(g) {
      var q = (S.listQ[g.id] || '').toLowerCase(), sel = {}, shown = 0, out = '';
      (g.all ? g.domain.map(function (d) { return d.value; }) : g.selected).forEach(function (v) { sel[v] = 1; });
      var match = g.domain.filter(function (d) { return !q || d.label.toLowerCase().indexOf(q) >= 0; });
      match.slice(0, M.LIST_SHOW).forEach(function (d) {
        shown++;
        out += '<label class="cp-check sp-item"><input type="checkbox" data-in="fval" data-id="' + esc(g.id) + '" data-v="' + esc(d.value) + '"' + (sel[d.value] ? ' checked' : '') + '> <span>' + esc(d.label) + '</span></label>';
      });
      if (match.length > shown) out += '<div class="cp-help">Showing ' + shown + ' of ' + match.length + '. Type above to narrow the list.</div>';
      if (!match.length) out += '<div class="cp-help">No value matches.</div>';
      return out;
    }

    function hlRow(sheet) {
      var mk = S.marks[sheet];
      if (!mk) return '<div class="cp-row"><div class="cp-help">Reading marks from ' + esc(sheet) + '.</div></div>';
      if (mk.error) return '<div class="cp-row"><div class="cp-help cp-err">' + esc(mk.error) + '</div></div>';
      if (!mk.columns.length) return '<div class="cp-row"><div class="cp-help">No text fields on this sheet to highlight by.</div></div>';
      var field = S.hlField[sheet] || mk.columns[0].name, col = mk.columns.filter(function (c) { return c.name === field; })[0] || mk.columns[0];
      var sel = S.hlSel[sheet] || [], sid = esc(sheet), q = (S.listQ['h:' + sheet] || '').toLowerCase();
      var vals = col.values.filter(function (v) { return !q || v.label.toLowerCase().indexOf(q) >= 0; });
      var out = '<div class="cp-row sp-ctl" data-ctl="h:' + sid + '"><label class="cp-lab" for="hf-' + sid + '">Highlight by</label><select id="hf-' + sid + '" data-in="hfield" data-s="' + sid + '" data-fk="hfield|' + sid + '">' +
        mk.columns.map(function (c) { return '<option value="' + esc(c.name) + '"' + (c.name === col.name ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>';
      var hid = 'h:' + sheet, open = S.expanded[hid] !== undefined ? S.expanded[hid] : col.values.length <= 12;
      out += '<div class="cp-full sp-disc-row"><button type="button" class="sp-disc" data-act="fdisc" data-id="' + esc(hid) + '" aria-expanded="' + open + '"><span class="sp-caret" aria-hidden="true">' + (open ? '&#9662;' : '&#9656;') + '</span><span class="sp-name">' + esc(col.name) + ' values</span><span class="sp-sum">' + (sel.length ? sel.length + ' highlighted' : 'None highlighted') + '</span></button></div>';
      if (open) {
        if (col.values.length > 12) out += '<div class="cp-full"><input type="text" data-in="hlq" data-s="' + sid + '" data-fk="hlq|' + sid + '" aria-label="Find a ' + esc(col.name) + ' value" placeholder="Find a value" value="' + esc(S.listQ['h:' + sheet] || '') + '" autocomplete="off"></div>';
        out += '<div class="cp-full sp-list" role="group" aria-label="' + esc(col.name) + ' values to highlight">' + vals.slice(0, HL_SHOW).map(function (v) {
          return '<label class="cp-check sp-item"><input type="checkbox" data-in="hval" data-s="' + sid + '" data-v="' + esc(v.value) + '"' + (sel.indexOf(v.value) >= 0 ? ' checked' : '') + '> <span>' + esc(v.label) + '</span></label>';
        }).join('') + '</div>';
        if (vals.length > HL_SHOW) out += '<div class="cp-help">Showing ' + HL_SHOW + ' of ' + vals.length + '. Type above to narrow the list.</div>';
      }
      out += '<div class="cp-full"><button type="button" class="cp-btn cp-small" data-act="hclear" data-s="' + sid + '">Clear highlight</button></div>' + help(sel.length ? sel.length + ' highlighted. Tableau dims the rest.' : 'Check values to highlight their marks.') + '</div>';
      return out;
    }

    function presetRows() {
      var out = '<div class="cp-sec">Save the current view</div><div class="cp-row"><input type="text" class="cp-full" data-in="pname" data-fk="pname" aria-label="Preset name" placeholder="Name, like Q3 review" maxlength="60" value="' + esc(S.pname || '') + '" autocomplete="off">' +
        '<div class="cp-full"><button type="button" class="cp-btn cp-primary" data-act="psave">Save as preset</button></div>' + help('Saves every parameter and filter. Presets are stored in the workbook, so anyone who opens it gets them.') + '</div>';
      out += '<div class="cp-sec">Presets (' + S.presets.length + ')</div>';
      if (!S.presets.length) out += '<div class="cp-empty">No presets yet.</div>';
      S.presets.forEach(function (p) {
        if (M.matches({ label: p.name }, S.query) === false && S.query) return;
        var pid = esc(p.id);
        out += '<div class="sp-preset" data-pid="' + pid + '">';
        if (S.editing === p.id) {
          out += '<input type="text" data-in="prename" data-pid="' + pid + '" data-fk="prename|' + pid + '" aria-label="New name for ' + esc(p.name) + '" value="' + esc(S.editText !== undefined ? S.editText : p.name) + '" maxlength="60" autocomplete="off">' +
            '<div class="cp-actions"><button type="button" class="cp-btn cp-small cp-primary" data-act="prenok" data-pid="' + pid + '">Save name</button><button type="button" class="cp-btn cp-small" data-act="prencancel">Cancel</button></div>';
        } else if (S.confirm === 'del:' + p.id) {
          out += '<div class="cp-msg">Delete ' + esc(p.name) + '?</div><div class="cp-actions"><button type="button" class="cp-btn cp-small cp-primary" data-act="pdelok" data-pid="' + pid + '">Yes, delete</button><button type="button" class="cp-btn cp-small" data-act="pdelno">Keep it</button></div>';
        } else {
          out += '<div class="sp-pname">' + esc(p.name) + '</div><div class="cp-help">Saved ' + esc(String(p.savedAt || '').slice(0, 10)) + ', ' + plural(Object.keys(p.snap.params || {}).length, 'parameter') + ', ' + plural(Object.keys(p.snap.filters || {}).length, 'filter') + '</div>' +
            '<div class="cp-actions"><button type="button" class="cp-btn cp-small cp-primary" data-act="papply" data-pid="' + pid + '" aria-label="Apply ' + esc(p.name) + '">Apply</button>' +
            '<button type="button" class="cp-btn cp-small" data-act="pren" data-pid="' + pid + '" aria-label="Rename ' + esc(p.name) + '">Rename</button>' +
            '<button type="button" class="cp-btn cp-small" data-act="pdel" data-pid="' + pid + '" aria-label="Delete ' + esc(p.name) + '">Delete</button></div>';
        }
        out += '</div>';
      });
      out += '<div class="cp-sec">Workbook defaults</div><div class="cp-row"><div class="cp-full"><button type="button" class="cp-btn" data-act="pdefault">Make the current view the default</button></div>' +
        help(S.defaults ? 'Reset returns to the view captured ' + esc(String(S.defaults.at || '').slice(0, 10) || 'when the panel was added') + '.' : 'No default captured yet.') + '</div>';
      return out;
    }

    function panelRows() {
      var themes = [['auto', 'Match my system'], ['light', 'Light'], ['dark', 'Dark'], ['custom', 'Custom']];
      var out = '<div class="cp-sec">Panel theme</div><div class="cp-row"><div class="cp-full cp-chips" role="group" aria-label="Panel theme">' + themes.map(function (t) { return chip('theme', '', t[0], t[1], ps.theme === t[0]); }).join('') + '</div>' + help('Every theme keeps text at 7:1 contrast or better.') + '</div>';
      if (ps.theme === 'custom') {
        [['customBg', 'Custom background'], ['customInk', 'Custom text']].forEach(function (c) {
          out += '<div class="cp-row"><label class="cp-lab" for="sp-' + c[0] + '">' + c[1] + '</label><div class="cp-color"><input type="color" data-in="pcolor" data-k="' + c[0] + '" value="' + esc(ps[c[0]]) + '" aria-label="' + c[1] + ' picker"><input type="text" class="cp-hex" id="sp-' + c[0] + '" data-in="phex" data-k="' + c[0] + '" data-fk="phex|' + c[0] + '" value="' + esc(ps[c[0]]) + '" maxlength="7" autocomplete="off"></div></div>';
        });
        out += '<div class="cp-row">' + help('Text is adjusted to stay readable (7:1).') + '</div>';
      }
      if (ctx.canFit) {
        out += '<div class="cp-sec">Dashboard zone</div><div class="cp-row"><label class="cp-check cp-full"><input type="checkbox" data-in="fit"' + (ps.fit ? ' checked' : '') + '> Grow the zone when the panel opens, shrink it to the gear when it closes</label>' + help('Needs the extension to be a floating object on the dashboard.') + '</div>';
        if (ps.fit) {
          out += '<div class="cp-row"><div class="cp-lab">Open width</div>' + stepper('zone', 'w', '', String(ps.w), 'Open width', 'numeric') + '<div class="cp-lab">Open height</div>' + stepper('zone', 'h', '', String(ps.h), 'Open height', 'numeric') + help('In dashboard pixels. Width 320 to 520, height 360 to 900.') + '</div>';
        }
      }
      out += '<div class="cp-sec">Position</div><div class="cp-row"><div class="cp-full"><button type="button" class="cp-btn" data-act="resetpos">Put the panel back top right</button></div></div>';
      return out;
    }

    /* ------------------------------------------------------------ render */
    function groupsOf(filters) {
      var order = [], by = {};
      filters.forEach(function (g) { var k = g.sheets.length > 1 ? '\u0001' + g.group : g.sheets[0]; if (!by[k]) { by[k] = { name: g.group, items: [] }; order.push(k); } by[k].items.push(g); });
      return order.sort(function (a, b) { return (b.charAt(0) === '\u0001') - (a.charAt(0) === '\u0001'); }).map(function (k) { return by[k]; });
    }
    function bodyHtml() {
      var m = S.model, q = S.query.trim();
      if (q) {
        var ps2 = m.params.filter(function (c) { return M.matches(c, q); }), fs = m.filters.filter(function (g) { return M.matches(g, q); });
        var pr = S.presets.filter(function (p) { return M.matches({ label: p.name }, q); }), hs = m.sheets.filter(function (s) { return M.matches({ label: s }, q); });
        var n = ps2.length + fs.length + pr.length + hs.length, out = '<div class="cp-count">' + n + ' match' + (n === 1 ? '' : 'es') + ' for "' + esc(q) + '"</div>';
        if (ps2.length) out += '<div class="cp-sec">Parameters</div>' + ps2.map(paramRow).join('');
        groupsOf(fs).forEach(function (gr) { out += '<div class="cp-sec">Filters: ' + esc(gr.name) + '</div>' + gr.items.map(filterRow).join(''); });
        hs.forEach(function (s) { out += '<div class="cp-sec">Highlight: ' + esc(s) + '</div>' + hlRow(s); if (!S.marks[s]) loadMarks(); });
        if (pr.length) out += '<div class="cp-sec">Presets</div>' + pr.map(function (p) { return '<div class="sp-preset"><div class="sp-pname">' + esc(p.name) + '</div><div class="cp-actions"><button type="button" class="cp-btn cp-small cp-primary" data-act="papply" data-pid="' + esc(p.id) + '" aria-label="Apply ' + esc(p.name) + '">Apply</button></div></div>'; }).join('');
        if (!n) out += '<div class="cp-empty">Nothing matches. Try a sheet, field or parameter name.</div>';
        return out;
      }
      if (S.tab === 'params') return m.params.length ? '<div class="cp-sec">All parameters (' + m.params.length + ')</div>' + m.params.map(paramRow).join('') : '<div class="cp-empty">This workbook has no parameters.</div>';
      if (S.tab === 'filters') {
        if (!m.filters.length) return '<div class="cp-empty">No worksheet on this dashboard has a filter.</div>';
        return groupsOf(m.filters).map(function (gr) { return '<div class="cp-sec">' + esc(gr.name) + '</div>' + gr.items.map(filterRow).join(''); }).join('');
      }
      if (S.tab === 'highlight') {
        loadMarks();
        return '<div class="cp-row"><label class="cp-check cp-full"><input type="checkbox" data-in="hall"' + (S.hlAll ? ' checked' : '') + '> Highlight the same values on every sheet that has the field</label></div>' +
          m.sheets.map(function (s) { return '<div class="cp-sec">' + esc(s) + '</div>' + hlRow(s); }).join('');
      }
      if (S.tab === 'presets') return presetRows();
      return panelRows();
    }
    function footHtml() {
      if (S.confirm === 'reset') return '<div class="cp-msg">Put every parameter and filter back to the workbook default?</div><div class="cp-actions"><button type="button" class="cp-btn cp-primary" data-act="resetok">Yes, reset</button><button type="button" class="cp-btn" data-act="resetno">Keep my changes</button></div>';
      return '<div class="cp-actions"><button type="button" class="cp-btn" data-act="reset"' + (S.defaults ? '' : ' disabled') + '>Reset to workbook defaults</button><button type="button" class="cp-btn" data-act="refresh">Read the workbook again</button></div>';
    }
    function tabsHtml() {
      var counts = { params: S.model.params.length, filters: S.model.filters.length, presets: S.presets.length };
      return TABS.map(function (t) {
        var on = !S.query && S.tab === t[0];
        return '<button type="button" class="cp-tab" role="tab" data-act="tab" data-t="' + t[0] + '" aria-selected="' + on + '" tabindex="' + (S.tab === t[0] ? 0 : -1) + '">' + t[1] + (counts[t[0]] !== undefined ? ' ' + counts[t[0]] : '') + '</button>';
      }).join('');
    }
    var renders = 0;
    function render() {
      if (panel.hidden) return;
      renders++;
      var a = doc.activeElement, fk = a && panel.contains(a) ? (a.getAttribute('data-fk') || (a.getAttribute('data-act') ? a.getAttribute('data-act') + '|' + (a.getAttribute('data-id') || a.getAttribute('data-pid') || a.getAttribute('data-s') || '') + '|' + (a.getAttribute('data-v') || a.getAttribute('data-t') || a.getAttribute('data-end') || '') + '|' + (a.getAttribute('data-d') || '') : null)) : null;
      var selStart = a && a.selectionStart, inBody = a && bodyEl.contains(a), top = bodyEl.scrollTop;
      tabsEl.innerHTML = tabsHtml(); bodyEl.innerHTML = bodyHtml(); footEl.innerHTML = footHtml();
      bodyEl.scrollTop = top;
      if (fk) {
        var cand = [].slice.call(panel.querySelectorAll('[data-fk],[data-act]')).filter(function (el) {
          var k = el.getAttribute('data-fk') || (el.getAttribute('data-act') ? el.getAttribute('data-act') + '|' + (el.getAttribute('data-id') || el.getAttribute('data-pid') || el.getAttribute('data-s') || '') + '|' + (el.getAttribute('data-v') || el.getAttribute('data-t') || el.getAttribute('data-end') || '') + '|' + (el.getAttribute('data-d') || '') : '');
          return k === fk;
        })[0];
        if (cand) { try { cand.focus({ preventScroll: true }); if (selStart !== null && selStart !== undefined && cand.setSelectionRange && cand.type === 'text') cand.setSelectionRange(selStart, selStart); } catch (e) { /* not focusable */ } }
        else if (inBody) { try { panel.focus({ preventScroll: true }); } catch (e) { /* ok */ } }
      }
    }

    /* --------------------------------------------------------- marks load */
    var loadingMarks = false;
    function loadMarks() {
      if (loadingMarks) return;
      var todo = S.model.worksheets.filter(function (ws) { return !S.marks[ws.name]; });
      if (!todo.length) return;
      loadingMarks = true;
      todo.reduce(function (p, ws) {
        return p.then(function () { return M.marks(ws).then(function (mk) { S.marks[ws.name] = mk; }, function (e) { S.marks[ws.name] = { columns: [], error: 'Could not read marks: ' + ((e && e.message) || 'unknown error') }; }); });
      }, Promise.resolve()).then(function () { loadingMarks = false; render(); });
    }
    function applyHighlight(sheet) {
      var field = S.hlField[sheet] || (S.marks[sheet] && S.marks[sheet].columns[0] && S.marks[sheet].columns[0].name), vals = S.hlSel[sheet] || [];
      var targets = S.model.worksheets.filter(function (ws) { return ws.name === sheet || (S.hlAll && S.marks[ws.name] && S.marks[ws.name].columns.some(function (c) { return c.name === field; })); });
      targets.forEach(function (ws) { if (ws.name !== sheet) { S.hlField[ws.name] = field; S.hlSel[ws.name] = vals.slice(); } });
      queue('h:' + sheet, 150, function () { return Promise.all(targets.map(function (ws) { return M.highlight(ws, field, vals); })); },
        vals.length ? 'Highlighted ' + vals.length + ' ' + field + (vals.length === 1 ? ' value' : ' values') + ' on ' + targets.length + (targets.length === 1 ? ' sheet.' : ' sheets.') : 'Highlight cleared.');
    }

    /* ---------------------------------------------------------- handlers */
    function stepParam(c, d) {
      if (c.control === 'date') { c.value = M.addPeriod(c.value, c.period, d * (c.step || 1)); if (c.min && c.value < c.min) c.value = c.min; if (c.max && c.value > c.max) c.value = c.max; }
      else c.value = M.clamp(M.roundTo((Number(c.value) || 0) + d * c.step, c.free ? 6 : (c.dec || 0)), c.min, c.max);
      var v = c.value;
      queue(c.id, 250, function () { return M.setParam(c, v); }, function () { return c.label + ' is ' + (c.control === 'date' ? v : fmtNum(v, pdec(c))) + '.'; });
      render();
    }
    function sendCat(g) {
      queue(g.id, 250, function () { return M.setCategorical(g, g.all ? 'all' : g.selected.slice(), g.exclude); }, function () { return g.label + ': ' + catSummary(g) + (g.sheets.length > 1 ? ' on ' + g.sheets.length + ' sheets.' : '.'); });
    }
    function sendRange(g) { queue(g.id, 250, function () { return M.setRange(g, g.min, g.max, g.nulls); }, function () { return g.label + ' runs from ' + g.min + ' to ' + g.max + '.'; }); }
    function sendRel(g) { queue(g.id, 250, function () { return M.setRelative(g, g); }, function () { return g.label + ': ' + relText(g) + '.'; }); }

    panel.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b || !panel.contains(b) || b.disabled) return;
      var act = b.getAttribute('data-act'), id = b.getAttribute('data-id'), v = b.getAttribute('data-v'), d = Number(b.getAttribute('data-d')), pid = b.getAttribute('data-pid'), c = id ? findCtl(id) : null;
      if (act === 'close') return close();
      if (act === 'min') { ps.min = !ps.min; panel.classList.toggle('cp-min', ps.min); b.setAttribute('aria-label', ps.min ? 'Restore controls' : 'Minimize controls'); persist(); if (!S.sheet) place(ps.x || 0, ps.y || 0, false); return; }
      if (act === 'tab') { S.tab = ps.tab = b.getAttribute('data-t'); S.query = ''; qEl.value = ''; S.confirm = null; persist(); render(); return; }
      if (act === 'pchip') { c.value = v; queue(c.id, 0, function () { return M.setParam(c, v); }, c.label + ' is ' + (c.options.filter(function (o) { return o.value === v; })[0] || {}).label + '.'); render(); return; }
      if (act === 'pswitch') { c.value = !c.value; var nv = c.value; queue(c.id, 0, function () { return M.setParam(c, nv); }, c.label + ' is ' + (nv ? 'on.' : 'off.')); render(); return; }
      if (act === 'pnum' || act === 'pdate') return stepParam(c, d);
      if (act === 'fdisc') { S.expanded[id] = b.getAttribute('aria-expanded') !== 'true'; render(); return; }
      if (act === 'fmode') { c.exclude = v === 'exclude'; if (c.all && c.exclude) { c.all = false; c.selected = []; } sendCat(c); render(); return; }
      if (act === 'fall') { c.all = true; c.exclude = false; c.selected = c.domain.map(function (x) { return x.value; }); sendCat(c); render(); return; }
      if (act === 'fnone') { c.all = false; c.selected = []; sendCat(c); render(); return; }
      if (act === 'fclear') { c.min = c.dmin; c.max = c.dmax; c.nulls = true; queue(c.id, 0, function () { return M.clearFilter(c); }, c.label + ' shows everything.'); render(); return; }
      if (act === 'rnum') {
        var end = b.getAttribute('data-end');
        if (c.isDate) c[end] = M.addPeriod(c[end], 'days', d); else c[end] = M.roundTo(Number(c[end]) + d * c.step, c.dec || 0);
        if (c.min > c.max) { if (end === 'min') c.max = c.min; else c.min = c.max; }
        sendRange(c); render(); return;
      }
      if (act === 'relr') { c.range = v; sendRel(c); render(); return; }
      if (act === 'relp') { c.period = v; sendRel(c); render(); return; }
      if (act === 'reln') { c.n = Math.max(1, c.n + d); sendRel(c); render(); return; }
      if (act === 'rela') { c.anchor = M.addPeriod(c.anchor, c.period, d); sendRel(c); render(); return; }
      if (act === 'hclear') { var s0 = b.getAttribute('data-s'); S.hlSel[s0] = []; applyHighlight(s0); render(); return; }
      if (act === 'psave') {
        var name = M.cleanName(S.pname);
        if (!name) { say('Type a name for the preset first.', true); var inp = panel.querySelector('[data-in=pname]'); if (inp) inp.focus(); return; }
        S.presets = M.addPreset(S.presets, name, M.capture(S.model));
        var saved2 = S.presets[S.presets.length - 1].name;
        S.pname = ''; savePresets('Saved ' + saved2 + '.'); render(); return;
      }
      if (act === 'papply') { var p = S.presets.filter(function (x) { return x.id === pid; })[0]; if (p) restoreSnap(p.snap, p.name); return; }
      if (act === 'pren') { S.editing = pid; S.editText = undefined; S.confirm = null; render(); var ri = panel.querySelector('[data-in=prename]'); if (ri) { ri.focus(); ri.select(); } return; }
      if (act === 'prenok') { finishRename(); return; }
      if (act === 'prencancel') { S.editing = null; render(); return; }
      if (act === 'pdel') { S.confirm = 'del:' + pid; S.editing = null; render(); var y = panel.querySelector('[data-act=pdelno]'); if (y) y.focus(); return; }
      if (act === 'pdelok') { var gone = (S.presets.filter(function (x) { return x.id === pid; })[0] || {}).name; S.presets = M.deletePreset(S.presets, pid); S.confirm = null; savePresets('Deleted ' + gone + '.'); render(); return; }
      if (act === 'pdelno') { S.confirm = null; render(); return; }
      if (act === 'pdefault') { S.defaults = M.capture(S.model); S.defaults.at = new Date().toISOString(); M.saveDefaults(st, S.defaults); say('The current view is now the workbook default.'); render(); return; }
      if (act === 'reset') { S.confirm = 'reset'; render(); var ok = footEl.querySelector('[data-act=resetno]'); if (ok) ok.focus(); return; }
      if (act === 'resetno') { S.confirm = null; render(); return; }
      if (act === 'resetok') { S.confirm = null; render(); if (S.defaults) restoreSnap(S.defaults, 'the workbook defaults'); return; }
      if (act === 'refresh') { say('Reading the workbook.'); if (ctx.onRefresh) ctx.onRefresh(true); return; }
      if (act === 'theme') { ps.theme = v; applyTheme(); persist(); render(); return; }
      if (act === 'zone') { ps[id] = id === 'w' ? Math.max(320, Math.min(520, ps[id] + d * 20)) : Math.max(360, Math.min(900, ps[id] + d * 20)); persist(); if (ctx.onFit && ps.fit) ctx.onFit(true, ps); render(); return; }
      if (act === 'resetpos') { ps.x = null; ps.y = null; settle(); persist(); say('The panel is back in the top right.'); return; }
    });

    function finishRename() {
      var inp = panel.querySelector('[data-in=prename]'), name = M.cleanName(inp ? inp.value : '');
      if (!name) { say('A preset needs a name.', true); return; }
      S.presets = M.renamePreset(S.presets, S.editing, name); S.editing = null;
      savePresets('Renamed to ' + name + '.'); render();
    }
    function savePresets(msg) {
      Promise.resolve().then(function () { return M.savePresets(st, S.presets); }).then(function () { say(msg); }, function () { say('Tableau could not save the presets.', true); });
    }
    function restoreSnap(snap, name) {
      if (S.busy) return;
      S.busy = true; say('Applying ' + name + '.');
      M.restore(S.model, snap).then(function (r) {
        S.busy = false;
        var msg = 'Applied ' + name + ': ' + r.applied + ' change' + (r.applied === 1 ? '' : 's') + ', ' + r.unchanged + ' already matched.';
        if (r.missing.length) msg += ' Not on this dashboard: ' + r.missing.join(', ') + '.';
        if (r.failed.length) msg += ' Tableau refused: ' + r.failed.join(', ') + '.';
        say(msg, r.failed.length > 0);
        if (ctx.onRefresh) ctx.onRefresh(true);
      });
    }

    function onTyped(t) {
      var k = t.getAttribute('data-in'), id = t.getAttribute('data-id'), c = id ? findCtl(id) : null, end = t.getAttribute('data-end');
      if (k === 'pnum') { var n = Number(t.value); if (!isFinite(n) || t.value.trim() === '') { say(c.label + ' needs a number.', true); return; } c.value = M.clamp(M.roundTo(n, c.free ? 6 : (c.dec || 0)), c.min, c.max); t.value = fmtNum(c.value, pdec(c)); var v1 = c.value; queue(c.id, 0, function () { return M.setParam(c, v1); }, c.label + ' is ' + fmtNum(v1, pdec(c)) + '.'); return; }
      if (k === 'pdate') { if (!M.parseDate(t.value)) { say('Use a date like 2026-11-24.', true); return; } c.value = t.value.trim(); var v2 = c.value; queue(c.id, 0, function () { return M.setParam(c, v2); }, c.label + ' is ' + v2 + '.'); return; }
      if (k === 'ptext') { c.value = t.value; var v3 = c.value; queue(c.id, 0, function () { return M.setParam(c, v3); }, c.label + ' is set.'); return; }
      if (k === 'rnum') {
        if (c.isDate ? !M.parseDate(t.value) : !isFinite(Number(t.value)) || t.value.trim() === '') { say(c.isDate ? 'Use a date like 2026-11-24.' : 'That is not a number.', true); return; }
        c[end] = c.isDate ? t.value.trim() : Number(t.value); if (c.min > c.max) { if (end === 'min') c.max = c.min; else c.min = c.max; } sendRange(c); render(); return;
      }
      if (k === 'reln') { var n2 = Math.round(Number(t.value)); if (!(n2 >= 1)) { say('Use a whole number, 1 or more.', true); return; } c.n = n2; sendRel(c); render(); return; }
      if (k === 'rela') { if (!M.parseDate(t.value)) { say('Use a date like 2026-11-24.', true); return; } c.anchor = t.value.trim(); sendRel(c); render(); return; }
      if (k === 'phex') { var h = CP.color.normHex(t.value); if (!h) { say('Use a color like #1a2b3c.', true); return; } ps[t.getAttribute('data-k')] = h; applyTheme(); persist(); render(); return; }
    }
    panel.addEventListener('change', function (e) {
      var t = e.target, k = t.getAttribute('data-in'); if (!k) return;
      var id = t.getAttribute('data-id'), c = id ? findCtl(id) : null;
      if (k === 'psel') { c.value = t.value; var v = t.value; queue(c.id, 0, function () { return M.setParam(c, v); }, c.label + ' is ' + t.options[t.selectedIndex].text + '.'); return; }
      if (k === 'fval') {
        var val = t.getAttribute('data-v'), sel = c.all ? c.domain.map(function (x) { return x.value; }) : c.selected.slice();
        if (t.checked && sel.indexOf(val) < 0) sel.push(val); if (!t.checked) sel = sel.filter(function (x) { return x !== val; });
        c.selected = c.domain.map(function (x) { return x.value; }).filter(function (x) { return sel.indexOf(x) >= 0; });
        c.all = !c.exclude && c.selected.length === c.domain.length;
        sendCat(c); render(); return;
      }
      if (k === 'rnull') { c.nulls = t.checked; sendRange(c); return; }
      if (k === 'hfield') { var s = t.getAttribute('data-s'); S.hlField[s] = t.value; S.hlSel[s] = []; S.listQ['h:' + s] = ''; applyHighlight(s); render(); return; }
      if (k === 'hval') { var s2 = t.getAttribute('data-s'), hv = t.getAttribute('data-v'), cur = (S.hlSel[s2] || []).filter(function (x) { return x !== hv; }); if (t.checked) cur.push(hv); S.hlSel[s2] = cur; applyHighlight(s2); render(); return; }
      if (k === 'hall') { S.hlAll = t.checked; return; }
      if (k === 'fit') { ps.fit = t.checked; persist(); if (ctx.onFit) ctx.onFit(true, ps); render(); return; }
      if (k === 'pcolor') { ps[t.getAttribute('data-k')] = t.value; applyTheme(); persist(); render(); return; }
      if (['pnum', 'pdate', 'ptext', 'rnum', 'reln', 'rela', 'phex'].indexOf(k) >= 0) onTyped(t);
    });
    panel.addEventListener('input', function (e) {
      var t = e.target, k = t.getAttribute('data-in');
      if (k === 'q') { S.query = t.value; render(); return; }
      if (k === 'flq') { S.listQ[t.getAttribute('data-id')] = t.value; render(); return; }
      if (k === 'hlq') { S.listQ['h:' + t.getAttribute('data-s')] = t.value; render(); return; }
      if (k === 'pname') { S.pname = t.value; return; }
      if (k === 'prename') { S.editText = t.value; return; }
    });
    panel.addEventListener('keydown', function (e) {
      var t = e.target, k = t.getAttribute && t.getAttribute('data-in');
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (S.editing || S.confirm) { S.editing = null; S.confirm = null; render(); return; }
        close(); return;
      }
      if (e.key === 'Enter' && k === 'pname') { e.preventDefault(); S.pname = t.value; panel.querySelector('[data-act=psave]').click(); return; }
      if (e.key === 'Enter' && k === 'prename') { e.preventDefault(); finishRename(); return; }
      if (e.key === 'Enter' && t.tagName === 'INPUT' && t.type === 'text' && k && k !== 'q' && k !== 'flq' && k !== 'hlq') { e.preventDefault(); onTyped(t); return; }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (k === 'pnum' || k === 'pdate' || k === 'rnum' || k === 'reln' || k === 'rela')) {
        e.preventDefault(); var btn = t.parentNode.querySelector('[data-d="' + (e.key === 'ArrowUp' ? 1 : -1) + '"]'); if (btn) btn.click(); return;
      }
      if (t.classList && t.classList.contains('cp-tab') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) >= 0) {
        e.preventDefault();
        var ids = TABS.map(function (x) { return x[0]; }), i = ids.indexOf(t.getAttribute('data-t'));
        i = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
        S.tab = ps.tab = ids[i]; S.query = ''; qEl.value = ''; persist(); render();
        var nt = tabsEl.querySelector('[data-t=' + ids[i] + ']'); if (nt) nt.focus();
      }
    });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden && !panel.contains(doc.activeElement)) close(); });

    /* -------------------------------------------------------- open, close */
    function open() {
      if (!panel.hidden) return;
      if (ctx.onFit && ps.fit) ctx.onFit(true, ps);
      panel.hidden = false; gear.hidden = true; gear.setAttribute('aria-expanded', 'true');
      panel.classList.toggle('cp-min', !!ps.min);
      panel.classList.add('sp-enter');
      applyTheme(); render(); settle();
      win.requestAnimationFrame(function () { win.requestAnimationFrame(function () { panel.classList.remove('sp-enter'); }); });
      try { panel.focus({ preventScroll: true }); } catch (e) { panel.focus(); }
    }
    function close() {
      if (panel.hidden) return;
      panel.hidden = true; gear.hidden = false; gear.setAttribute('aria-expanded', 'false');
      S.query = ''; qEl.value = ''; S.editing = null; S.confirm = null;
      if (ctx.onFit && ps.fit) ctx.onFit(false, ps);
      gear.focus();
    }
    gear.addEventListener('click', open);
    applyTheme();

    /* New workbook state from Tableau. Controls with a write still pending keep what the user just set. */
    function setModel(m) {
      var old = S.model;
      m.params.concat(m.filters).forEach(function (c) {
        if (!S.dirty[c.id]) return;
        var prev = old.params.concat(old.filters).filter(function (x) { return x.id === c.id; })[0];
        if (prev) ['value', 'selected', 'all', 'exclude', 'min', 'max', 'nulls', 'range', 'period', 'n', 'anchor'].forEach(function (k) { if (k in prev) c[k] = prev[k]; });
      });
      S.model = m;
      Object.keys(S.marks).forEach(function (k) { if (S.marks[k] && S.marks[k].error) delete S.marks[k]; });
      render();
    }
    function refreshMarks() { S.marks = {}; if (!panel.hidden && S.tab === 'highlight') render(); }

    return { open: open, close: close, isOpen: function () { return !panel.hidden; }, render: render, setModel: setModel, refreshMarks: refreshMarks,
      say: say, state: S, ps: ps, panel: panel, gear: gear, renders: function () { return renders; },
      pending: function () { return Object.keys(S.dirty).some(function (k) { return S.dirty[k]; }); } };
  }

  global.SP.panel = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
