/* ctab-panel 1.1.0 - the shared floating settings panel for the C-Tableau viz extensions.
 * One library, vendored byte-for-byte into every extension at lib/ctab-panel/ (shared/ctab-panel/sync_check.py
 * fails if a copy differs). Generalized from Garden Petals' settings-panel.js ("float like the AI Garden").
 *
 *   CTabPanel.create(host, { title, schema, store, info, state, prefix, onLayout, version })  -> panel instance
 *   CTabPanel.createStore({ rows, settings, prefix, onChange })            -> settings store (debounced save)
 *   CTabPanel.standard(opts)                                               -> the standard tabs and rows
 *   CTabPanel.diagButton(host, { panel })                                  -> a Copy diagnostics button for blank screens
 *   CTabPanel.engine pieces for renderers: coerce, defaultsOf, formatNumber, paletteColors, mergeList, fontStack, fillTitle
 *
 * 1.1.0 (11/24/2026) adds, from Celia's settings-panel guide: diagnostics, panel habits kept per machine
 * (localStorage, with a one-time HYDRATE of the 1.0.0 workbook copy), pin to side with an accordion, Revert to when
 * I opened, a save-status line, Copy formatting and Copy everything with a labeled block, rows grayed out instead of
 * hidden, a Dock button, bundled Inter and Poppins, text size as chips, title placeholders, option labels that show
 * their result, dark palette variants and one-click setup rows.
 *
 * No range inputs, no window.alert/confirm/prompt, text never below 14px, text at 7:1 in every theme.
 * ASCII only on purpose (entities for symbols). Pure engine functions run under node (module.exports). */
(function (root, factory) {
  var lib = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.CTabPanel = lib;
})(typeof window !== 'undefined' ? window : globalThis, function (G) {
  'use strict';

  var VERSION = '1.1.0';

  /* ------------------------------------------------------- per-machine storage */

  /* Panel habits and the last copy live in localStorage. Every access is wrapped: a sandboxed frame or a private
   * window can throw, and then an in-memory copy keeps the panel working for this visit. */
  var MEM = {};
  function lsGet(k) {
    try { var v = G.localStorage.getItem(k); if (v !== null && v !== undefined) return v; } catch (e) { /* blocked */ }
    return Object.prototype.hasOwnProperty.call(MEM, k) ? MEM[k] : null;
  }
  function lsSet(k, v) {
    MEM[k] = v;
    try { G.localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }

  /* ------------------------------------------------------------- diagnostics */

  var ERRORS = [], WATCHED = [], REPORTERS = [];
  function noteError(kind, message, where) {
    ERRORS.push({ time: new Date().toISOString(), kind: kind, message: String(message === undefined ? '' : message).slice(0, 500), where: where ? String(where).slice(0, 200) : '' });
    if (ERRORS.length > 20) ERRORS.shift();
  }
  function watchErrors(win) {
    if (!win || !win.addEventListener || WATCHED.indexOf(win) >= 0) return;
    WATCHED.push(win);
    win.addEventListener('error', function (e) { noteError('error', e.message || (e.error && e.error.message) || 'error', (e.filename || '') + (e.lineno ? ':' + e.lineno : '')); });
    win.addEventListener('unhandledrejection', function (e) { var r = e.reason; noteError('unhandledrejection', r && r.message ? r.message : String(r)); });
  }
  /* Clipboard chain shared by Copy and Diagnostics: the Clipboard API, then execCommand, then done(false). */
  function copyChain(doc, text, done) {
    var win = doc.defaultView;
    function legacy() {
      try {
        var ta = doc.createElement('textarea'); ta.value = text; ta.setAttribute('aria-hidden', 'true'); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        doc.body.appendChild(ta); ta.select(); var ok = doc.execCommand('copy'); doc.body.removeChild(ta); return !!ok;
      } catch (e) { return false; }
    }
    try {
      if (win.navigator.clipboard && win.navigator.clipboard.writeText) { win.navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(legacy()); }); return; }
    } catch (e) { /* fall through */ }
    done(legacy());
  }
  function basicReport(win) {
    return { report: 'C-Tableau diagnostics', library: 'ctab-panel ' + VERSION, created: new Date().toISOString(), note: 'No settings panel was running on this page.',
      view: { width: win.innerWidth, height: win.innerHeight, pixelRatio: win.devicePixelRatio || 1 }, browser: win.navigator.userAgent, errors: ERRORS.slice() };
  }
  /* A Copy diagnostics button for an extension's blank or error screen. o.panel picks the panel to report on. */
  function diagButton(host, o) {
    o = o || {};
    var doc = host.ownerDocument, win = doc.defaultView;
    watchErrors(win);
    var wrap = doc.createElement('div'); wrap.className = 'cp-diagwrap';
    var b = doc.createElement('button'); b.type = 'button'; b.className = 'cp-btn cp-diagbtn'; b.textContent = o.label || 'Copy diagnostics';
    b.setAttribute('data-f', 'diagbtn');
    wrap.appendChild(b);
    b.addEventListener('click', function () {
      var rep = o.panel && o.panel.diagnostics ? o.panel.diagnostics() : (REPORTERS.length ? REPORTERS[REPORTERS.length - 1]() : basicReport(win));
      var text = JSON.stringify(rep, null, 2);
      wrap.setAttribute('data-copied', text);
      copyChain(doc, text, function (ok) {
        b.textContent = ok ? 'Copied diagnostics' : 'Copy the text below';
        if (!ok && !wrap.querySelector('textarea')) {
          var ta = doc.createElement('textarea'); ta.readOnly = true; ta.rows = 6; ta.value = text; ta.className = 'cp-diagtext'; ta.setAttribute('aria-label', 'Diagnostics report');
          wrap.appendChild(ta); ta.select();
        }
      });
    });
    host.appendChild(wrap);
    return b;
  }

  /* ------------------------------------------------------------------ data */

  var FONTS = [
    { id: 'worksheet', label: 'Worksheet font (Inter)', stack: 'Inter, "Tableau Book", "Segoe UI", system-ui, Arial, sans-serif' },
    { id: 'poppins', label: 'Poppins', stack: 'Poppins, Inter, "Segoe UI", system-ui, Arial, sans-serif' },
    { id: 'segoe', label: 'Segoe UI', stack: '"Segoe UI", system-ui, Arial, sans-serif' },
    { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
    { id: 'helvetica', label: 'Helvetica Neue', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
    { id: 'trebuchet', label: 'Trebuchet MS', stack: '"Trebuchet MS", Tahoma, sans-serif' },
    { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
    { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma, Geneva, sans-serif' }
  ];
  function fontStack(id) {
    for (var i = 0; i < FONTS.length; i++) if (FONTS[i].id === id) return FONTS[i].stack;
    return FONTS[0].stack;
  }

  /* The Data Divers palette first, then six colorblind-safe sets. */
  var PALETTES = [
    { id: 'datadivers', label: 'Data Divers', safe: false, colors: ['#3cc4d1', '#12527a', '#f26b5b', '#f5b83d', '#8a6bd6', '#2fa58a', '#e0457b', '#8fa7b8'] },
    { id: 'okabe', label: 'Okabe-Ito', safe: true, colors: ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#999999'] },
    { id: 'tolbright', label: 'Tol Bright', safe: true, colors: ['#4477aa', '#ee6677', '#228833', '#ccbb44', '#66ccee', '#aa3377', '#bbbbbb'] },
    { id: 'tolmuted', label: 'Tol Muted', safe: true, colors: ['#cc6677', '#332288', '#ddcc77', '#117733', '#88ccee', '#882255', '#44aa99', '#999933', '#aa4499'] },
    { id: 'ibm', label: 'IBM', safe: true, colors: ['#648fff', '#785ef0', '#dc267f', '#fe6100', '#ffb000', '#009d9a'] },
    { id: 'viridis', label: 'Viridis', safe: true, colors: ['#440154', '#46337e', '#365c8d', '#277f8e', '#1fa187', '#4ac16d', '#9fda3a', '#fde725'] },
    { id: 'cividis', label: 'Cividis', safe: true, colors: ['#00224e', '#35456c', '#666970', '#948e77', '#c8b866', '#fee838'] }
  ];
  /* The chart background the panel last saw (applyAppearance). On a dark background every palette swaps to its dark
   * variant: each color lifted until it reaches 3:1 against that background (WCAG non-text contrast). */
  var CHART = { bg: '#ffffff' };
  function isDarkBg(bg) { return lum(legalBg(bg)) < 0.18; }
  function darkVariant(colors, bg) { return colors.map(function (c) { return ensureContrast(c, [bg], 3); }); }
  function paletteColors(id, reverse, bg) {
    var c = PALETTES[0].colors;
    for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) c = PALETTES[i].colors;
    var b = normHex(bg) || CHART.bg;
    c = isDarkBg(b) ? darkVariant(c, b) : c.slice();
    return reverse ? c.reverse() : c;
  }

  /* ----------------------------------------------------------------- colour */

  function normHex(h) {
    if (typeof h !== 'string') return null;
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h.trim());
    if (!m) return null;
    var s = m[1].toLowerCase();
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    return '#' + s;
  }
  function toRgb(h) {
    var n = normHex(h);
    if (!n) return null;
    return [parseInt(n.substr(1, 2), 16), parseInt(n.substr(3, 2), 16), parseInt(n.substr(5, 2), 16)];
  }
  function toHex(rgb) {
    return '#' + rgb.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }
  function lum(h) {
    var c = toRgb(h) || [0, 0, 0];
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function contrast(a, b) {
    var la = lum(a), lb = lum(b), hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  function mix(a, b, t) {
    var x = toRgb(a) || [0, 0, 0], y = toRgb(b) || [0, 0, 0];
    return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  function minContrast(fg, bgs) {
    var m = Infinity;
    for (var i = 0; i < bgs.length; i++) m = Math.min(m, contrast(fg, bgs[i]));
    return m;
  }
  /* Push fg toward black or white (whichever helps) until it reaches `min` against every background. */
  function ensureContrast(fg, bgs, min) {
    fg = normHex(fg) || '#000000';
    if (minContrast(fg, bgs) >= min) return fg;
    var avg = 0; bgs.forEach(function (b) { avg += lum(b); }); avg /= bgs.length;
    var target = avg > 0.18 ? '#000000' : '#ffffff';
    for (var t = 0.05; t <= 1.0001; t += 0.05) {
      var c = mix(fg, target, t);
      if (minContrast(c, bgs) >= min) return c;
    }
    return target;
  }
  /* A background that black or white text can reach 7:1 on. Mid-greys are lightened or darkened. */
  function legalBg(bg) {
    bg = normHex(bg) || '#ffffff';
    var l = lum(bg);
    var target = l >= 0.18 ? '#ffffff' : '#000000';
    for (var t = 0; t <= 1.0001; t += 0.02) {
      var c = mix(bg, target, t);
      if (Math.max(contrast('#000000', c), contrast('#ffffff', c)) >= 7.5) return c;
    }
    return target;
  }
  function bestInk(bg) { return contrast('#101820', bg) >= contrast('#f5f7fa', bg) ? '#101820' : '#f5f7fa'; }

  /* Every colour the panel paints comes from one function so every theme meets 7:1 by construction. */
  function tokens(bgIn, inkIn, accentHint, dangerHint) {
    var bg = legalBg(bgIn);
    var ink = ensureContrast(inkIn || bestInk(bg), [bg], 8);
    var surface = bg, k = 0.07;
    for (var i = 0; i < 6; i++) {
      surface = mix(bg, ink, k);
      if (contrast(ink, surface) >= 7.5) break;
      k = k / 2;
    }
    var muted = ensureContrast(mix(ink, bg, 0.25), [bg, surface], 7.2);
    var border = ensureContrast(mix(bg, ink, 0.55), [bg], 3.2);
    var accent = ensureContrast(accentHint || '#0a54a0', [bg, surface], 7.2);
    var danger = ensureContrast(dangerHint || '#a3180e', [bg, surface], 7.2);
    return { bg: bg, surface: surface, ink: ink, muted: muted, border: border, accent: accent, danger: danger };
  }
  var THEMES = {
    light: { bg: '#ffffff', ink: '#14202e', accent: '#0a54a0', danger: '#a3180e' },
    dark: { bg: '#101a26', ink: '#f1f5f9', accent: '#8ccbff', danger: '#ffb4ab' }
  };
  function themeTokens(name, chart, custom) {
    if (name === 'dark') return tokens(THEMES.dark.bg, THEMES.dark.ink, THEMES.dark.accent, THEMES.dark.danger);
    if (name === 'match' && chart && normHex(chart.bg)) {
      var dark = lum(legalBg(chart.bg)) < 0.18;
      return tokens(chart.bg, chart.ink, dark ? THEMES.dark.accent : THEMES.light.accent, dark ? THEMES.dark.danger : THEMES.light.danger);
    }
    if (name === 'custom' && custom) {
      var d2 = lum(legalBg(custom.bg)) < 0.18;
      return tokens(custom.bg, custom.ink, d2 ? THEMES.dark.accent : THEMES.light.accent, d2 ? THEMES.dark.danger : THEMES.light.danger);
    }
    return tokens(THEMES.light.bg, THEMES.light.ink, THEMES.light.accent, THEMES.light.danger);
  }

  /* ------------------------------------------------------------ schema engine */

  /* preview: a live line of text, `text(settings)`. action: a one-click setup, `apply(settings, info) -> values`.
   * diag: the Diagnostics block (Panel tab). note: a plain button row. None of these four hold a value. */
  var TYPES = ['number', 'select', 'chips', 'check', 'color', 'text', 'font', 'list', 'palette', 'field', 'note', 'preview', 'action', 'diag'];
  var NOVALUE = ['note', 'preview', 'action', 'diag'];

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* An option: [value, label] or [value, label, style] or {value, label, style}. style (schema-authored CSS) lets
   * a chip show its own result, such as a weight chip drawn in that weight. */
  function optPair(o) {
    var p = Array.isArray(o) ? { value: String(o[0]), label: String(o[1]), style: o[2] } : { value: String(o.value), label: String(o.label), style: o.style };
    if (typeof p.style !== 'string' || !/^[a-z0-9 :;.%#()-]*$/i.test(p.style)) delete p.style;
    return p;
  }

  /* Validates and normalizes a schema. Throws on a bad schema so a typo fails loudly at startup, not silently on screen. */
  function prepare(schema) {
    if (!schema || !Array.isArray(schema.rows) || !Array.isArray(schema.tabs)) throw new Error('ctab-panel: schema needs tabs[] and rows[]');
    var tabs = schema.tabs.map(function (t) { return typeof t === 'string' ? { id: t, label: t } : { id: String(t.id), label: String(t.label || t.id) }; });
    var tabIds = {}; tabs.forEach(function (t) { tabIds[t.id] = true; });
    var seen = {}, rows = schema.rows.map(function (r) {
      if (TYPES.indexOf(r.type) < 0) throw new Error('ctab-panel: unknown row type "' + r.type + '" (' + r.key + ')');
      if (!r.key) throw new Error('ctab-panel: a row has no key');
      if (seen[r.key]) throw new Error('ctab-panel: duplicate key ' + r.key);
      seen[r.key] = true;
      if (!tabIds[r.tab]) throw new Error('ctab-panel: row ' + r.key + ' names unknown tab "' + r.tab + '"');
      var n = {}; Object.keys(r).forEach(function (k) { n[k] = r[k]; });
      if (n.type === 'select' || n.type === 'chips') {
        if (!Array.isArray(n.opts) || !n.opts.length) throw new Error('ctab-panel: ' + n.key + ' needs opts');
        n.opts = n.opts.map(optPair);
        if (n.def === undefined) n.def = n.opts[0].value;
      }
      if (n.type === 'number') {
        if (typeof n.min !== 'number' || typeof n.max !== 'number' || !(n.step > 0)) throw new Error('ctab-panel: ' + n.key + ' needs min, max and step');
        if (n.def === undefined) n.def = n.min;
      }
      if (n.def === undefined) n.def = n.type === 'check' ? false : n.type === 'list' ? [] : n.type === 'palette' ? 'datadivers' : n.type === 'font' ? 'worksheet' : '';
      n.sec = n.sec || 'General';
      return n;
    });
    return { tabs: tabs, rows: rows };
  }

  function decimalsOf(step) {
    var s = String(step), i = s.indexOf('.');
    return i < 0 ? 0 : s.length - i - 1;
  }

  /* Returns a valid value for the row, or undefined when v cannot be one. */
  function coerce(row, v) {
    switch (row.type) {
      case 'number': {
        if (v === '' || v === null || v === undefined || typeof v === 'boolean') return undefined;
        var n = typeof v === 'number' ? v : Number(v);
        if (!isFinite(n)) return undefined;
        n = Math.min(row.max, Math.max(row.min, n));
        var d = Math.max(decimalsOf(row.step), decimalsOf(row.min));
        return Number(n.toFixed(Math.min(d, 6)));
      }
      case 'select': case 'chips': {
        if (row.dynamic && typeof v === 'string') return v.slice(0, 300);
        var s = String(v);
        for (var i = 0; i < row.opts.length; i++) if (row.opts[i].value === s) return s;
        return undefined;
      }
      case 'check':
        if (v === true || v === 'true' || v === 1 || v === '1') return true;
        if (v === false || v === 'false' || v === 0 || v === '0') return false;
        return undefined;
      case 'color': {
        if (v === '' && row.auto) return '';
        return normHex(v) || undefined;
      }
      case 'text': return typeof v === 'string' ? v.slice(0, row.maxLength || 200) : (typeof v === 'number' ? String(v) : undefined);
      case 'font': {
        for (var j = 0; j < FONTS.length; j++) if (FONTS[j].id === v) return v;
        return undefined;
      }
      case 'palette': {
        for (var k = 0; k < PALETTES.length; k++) if (PALETTES[k].id === v) return v;
        return undefined;
      }
      case 'field': return typeof v === 'string' ? v.slice(0, 300) : undefined;
      case 'list': return normList(v);
      default: return undefined;
    }
  }
  function normList(v) {
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return undefined; } }
    if (!Array.isArray(v) || v.length > 300) return undefined;
    var out = [];
    for (var i = 0; i < v.length; i++) {
      var it = v[i];
      if (!it || typeof it !== 'object' || typeof it.key !== 'string' || !it.key || it.key.length > 300) return undefined;
      out.push({ key: it.key, name: typeof it.name === 'string' ? it.name.slice(0, 120) : '', color: normHex(it.color) || '', hidden: it.hidden === true });
    }
    return out;
  }
  function serialize(row, v) { return row.type === 'list' ? JSON.stringify(v) : String(v); }
  function same(a, b) { return typeof a === 'object' || typeof b === 'object' ? JSON.stringify(a) === JSON.stringify(b) : a === b; }

  function settable(rows) { return rows.filter(function (r) { return NOVALUE.indexOf(r.type) < 0; }); }
  /* Data-tied rows (field picks, per-item lists, or data: true) stay out of Copy formatting. */
  function isData(r) { return r.data === true || ((r.type === 'field' || r.type === 'list') && r.data !== false); }
  /* A row is a chart text size when it says so, or when it is a px size whose floor is the 14px house floor. */
  function isTextSize(r) { return r.type === 'number' && (r.textSize === true || (r.textSize !== false && r.unit === 'px' && r.min === 14 && /size/i.test((r.label || '') + ' ' + r.key))); }
  function defaultsOf(rows) {
    var o = {}; settable(rows).forEach(function (r) { o[r.key] = JSON.parse(JSON.stringify(r.def)); });
    return o;
  }
  function isVisible(row, s, info) {
    var w = row.when;
    if (!w) return true;
    if (typeof w === 'function') { try { return !!w(s, info || {}); } catch (e) { return true; } }
    var list = Array.isArray(w) ? w : [w];
    return list.every(function (c) {
      var v = s[c.key];
      if (c.eq !== undefined) return same(v, c.eq);
      if (c.ne !== undefined) return !same(v, c.ne);
      if (c.in) return c.in.indexOf(v) >= 0;
      if (c.truthy) return !!v;
      return true;
    });
  }
  function visibleRows(rows, s, info) { return rows.filter(function (r) { return isVisible(r, s, info); }); }
  /* Rows on screen: every row whose condition holds, plus the grayed-out ones (all but hideWhenOff rows). */
  function shownRows(rows, s, info) { return rows.filter(function (r) { return !r.hideWhenOff || isVisible(r, s, info); }); }
  function optLabel(r, v) {
    if (r && r.type === 'check') return v ? 'on' : 'off';
    if (r && r.opts) for (var i = 0; i < r.opts.length; i++) if (r.opts[i].value === String(v)) return '"' + r.opts[i].label + '"';
    return '"' + String(v) + '"';
  }
  /* The plain sentence under a grayed-out row: what turns it on. */
  function offReason(row, rows, s) {
    if (row.offHelp) return row.offHelp;
    var w = row.when, fallback = 'Not used with the current settings.';
    if (!w || typeof w === 'function') return fallback;
    var byKey = {}; rows.forEach(function (r) { byKey[r.key] = r; });
    var parts = [];
    (Array.isArray(w) ? w : [w]).forEach(function (c) {
      if (isVisible({ when: c }, s || {}, {})) return;
      var r = byKey[c.key], name = '"' + (r ? (r.label || r.key) : c.key) + '"';
      if (c.truthy || (c.eq === true && r && r.type === 'check')) parts.push('turn on ' + name);
      else if (c.eq === false && r && r.type === 'check') parts.push('turn off ' + name);
      else if (c.eq !== undefined) parts.push('set ' + name + ' to ' + optLabel(r, c.eq));
      else if (c.ne !== undefined) parts.push('change ' + name + ' from ' + optLabel(r, c.ne));
      else if (c.in) parts.push('set ' + name + ' to ' + c.in.map(function (v) { return optLabel(r, v); }).join(' or '));
    });
    if (!parts.length) return fallback;
    var t = parts.join(' and ');
    return t.charAt(0).toUpperCase() + t.slice(1) + ' to use this.';
  }
  /* Title placeholders: {n}, {top}, {total} and any token an extension supplies. Unknown ones stay as typed. */
  function fillTitle(text, tokens) {
    tokens = tokens || {};
    return String(text === undefined || text === null ? '' : text).replace(/\{([a-zA-Z][\w]{0,30})\}/g, function (m, k) {
      var v = tokens[k];
      return v === undefined || v === null || v === '' ? m : String(v);
    });
  }
  function haystack(row, tabs) {
    var tab = '';
    tabs.forEach(function (t) { if (t.id === row.tab) tab = t.label; });
    var opts = row.opts ? row.opts.map(function (o) { return o.label; }).join(' ') : '';
    return (tab + ' ' + row.sec + ' ' + (row.label || '') + ' ' + (row.help || '') + ' ' + row.key + ' ' + opts).toLowerCase();
  }
  /* Rows on screen (grayed-out ones included) whose text contains every word of q, across all tabs. */
  function searchRows(prepared, s, info, q) {
    var words = String(q || '').toLowerCase().split(' ').filter(Boolean);
    if (!words.length) return [];
    return shownRows(prepared.rows, s, info).filter(function (r) {
      var h = haystack(r, prepared.tabs);
      return words.every(function (w) { return h.indexOf(w) >= 0; });
    });
  }

  /* Validated paste. Accepts the flat map Copy settings makes, with or without the extension prefix. */
  function parsePaste(rows, text, prefix) {
    var t = String(text || '').trim();
    if (!t) return { ok: false, message: 'Paste the settings text first.', values: {}, applied: 0, ignored: [], invalid: [] };
    var obj;
    try { obj = JSON.parse(t); } catch (e) { return { ok: false, message: 'That is not valid JSON. Paste the text exactly as Copy settings made it.', values: {}, applied: 0, ignored: [], invalid: [] }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, message: 'Settings must be a JSON object, like the text Copy settings makes.', values: {}, applied: 0, ignored: [], invalid: [] };
    /* A labeled block from Copy formatting or Copy everything: { ctab, chart, name, kind, copied, settings }.
     * From another C-Tableau chart, only the shared standard-tab looks move over (never its field picks). */
    var src = null, cross = false, other = [];
    if (obj.settings && typeof obj.settings === 'object' && !Array.isArray(obj.settings) && (obj.ctab !== undefined || obj.chart !== undefined)) {
      src = { chart: String(obj.chart || ''), name: String(obj.name || '').slice(0, 80), kind: obj.kind === 'everything' ? 'everything' : 'formatting', copied: String(obj.copied || '') };
      cross = !!(src.chart && prefix && src.chart !== prefix);
      obj = obj.settings;
    }
    var byKey = {}; settable(rows).forEach(function (r) { byKey[r.key] = r; });
    var values = {}, ignored = [], invalid = [], applied = 0;
    Object.keys(obj).forEach(function (k0) {
      var k = k0;
      if (!byKey[k] && prefix && k.indexOf(prefix) === 0) k = k.slice(prefix.length);
      if (!byKey[k] && k.indexOf('.') >= 0) k = k.split('.').pop();
      var row = byKey[k];
      if (cross && (!row || !row.std || isData(row))) { other.push(k0); return; }
      if (!row) { ignored.push(k0); return; }
      var c = coerce(row, obj[k0]);
      if (c === undefined) { invalid.push(k0); return; }
      values[k] = c; applied++;
    });
    var from = src ? 'From ' + (src.name || 'another chart') + ' (' + src.kind + (src.copied ? ', copied ' + shortDate(src.copied) : '') + '): ' : '';
    if (!applied) return { ok: false, message: (from || '') + 'No settings in that text match this chart.' + (invalid.length ? ' Invalid values: ' + invalid.slice(0, 3).join(', ') + '.' : ''), values: {}, applied: 0, ignored: ignored, invalid: invalid, source: src, other: other };
    var msg = from ? from + 'applied ' + applied + (cross ? ' shared' : '') + ' setting' + (applied === 1 ? '' : 's') + '.' : 'Applied ' + applied + ' setting' + (applied === 1 ? '' : 's') + '.';
    if (other.length) msg += ' Skipped ' + other.length + ' only that chart has.';
    if (ignored.length) msg += ' Skipped ' + ignored.length + ' unknown.';
    if (invalid.length) msg += ' Skipped ' + invalid.length + ' invalid (' + invalid.slice(0, 3).join(', ') + ').';
    return { ok: true, message: msg, values: values, applied: applied, ignored: ignored, invalid: invalid, source: src, other: other };
  }
  function shortDate(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return String(iso).slice(0, 20);
    var p = function (n) { return (n < 10 ? '0' : '') + n; }, h = d.getHours(), ap = h < 12 ? 'AM' : 'PM';
    return p(d.getMonth() + 1) + '/' + p(d.getDate()) + '/' + d.getFullYear() + ' ' + ((h % 12) || 12) + ':' + p(d.getMinutes()) + ' ' + ap;
  }
  /* The labeled block Copy formatting / Copy everything put on the clipboard. */
  function copyBlock(rows, s, kind, meta) {
    meta = meta || {};
    var o = {};
    settable(rows).forEach(function (r) { if (kind === 'formatting' && isData(r)) return; o[r.key] = s[r.key]; });
    return { ctab: 1, chart: meta.prefix || '', name: meta.name || '', kind: kind === 'everything' ? 'everything' : 'formatting', copied: new Date().toISOString(), settings: o };
  }

  /* Saved list over the live items: saved order and names win, new items are appended, gone items drop. */
  function mergeList(saved, items) {
    var byKey = {}, out = [], used = {};
    (items || []).forEach(function (it) { byKey[it.key] = it; });
    (saved || []).forEach(function (s) {
      var it = byKey[s.key]; if (!it || used[s.key]) return;
      used[s.key] = true;
      out.push({ key: s.key, name: s.name || it.name || s.key, color: s.color || it.color || '', hidden: !!s.hidden, defName: it.name || s.key, defColor: it.color || '' });
    });
    (items || []).forEach(function (it) {
      if (used[it.key]) return;
      out.push({ key: it.key, name: it.name || it.key, color: it.color || '', hidden: false, defName: it.name || it.key, defColor: it.color || '' });
    });
    return out;
  }

  /* Number format shared by every renderer: the keys are the standard Number format tab's. */
  function formatNumber(v, s) {
    s = s || {};
    if (typeof v !== 'number' || !isFinite(v)) return '';
    var scale = parseFloat(s.numScale); if (!isFinite(scale) || scale === 0) scale = 1;
    var x = v * scale, suffix = '';
    if (s.numCompact) {
      var a = Math.abs(x);
      if (a >= 1e9) { x /= 1e9; suffix = 'B'; } else if (a >= 1e6) { x /= 1e6; suffix = 'M'; } else if (a >= 1e3) { x /= 1e3; suffix = 'K'; }
    }
    var dec = typeof s.numDecimals === 'number' ? s.numDecimals : 1;
    var str = Math.abs(x).toFixed(dec), parts = str.split('.');
    var sep = s.numThousands === 'space' ? ' ' : s.numThousands === 'none' ? '' : ',';
    if (sep) parts[0] = parts[0].replace(/(\d)(?=(\d{3})+$)/g, '$1' + sep);
    var neg = x < 0 && Number(str) !== 0;
    return (neg ? '-' : '') + (s.numPrefix || '') + parts.join('.') + suffix + (s.numSuffix || '');
  }

  /* ------------------------------------------------------------ standard rows */

  /* The tabs every extension shares. opts.fields = [{key, label, help}] for the Fields tab;
   * opts.over = { key: { def: ... } } to change a default; opts.skip = [tab ids] to leave a tab out. */
  function standard(opts) {
    opts = opts || {};
    var over = opts.over || {}, skip = opts.skip || [], rows = [];
    var T = function (id, label) { return { id: id, label: label }; };
    var all = [T('colors', 'Colors'), T('labels', 'Labels'), T('numbers', 'Number format'), T('tooltip', 'Tooltip'), T('fonts', 'Fonts'),
      T('background', 'Background'), T('animation', 'Animation'), T('interaction', 'Interaction'), T('fields', 'Fields')];
    var tabs = all.filter(function (t) { return skip.indexOf(t.id) < 0; });
    function add(r) { r.std = true; if (over[r.key]) Object.keys(over[r.key]).forEach(function (k) { r[k] = over[r.key][k]; }); if (skip.indexOf(r.tab) < 0) rows.push(r); }
    var CH = function (a) { return a.map(function (p) { return p.length > 2 ? [p[0], p[1], p[2]] : [p[0], p[1]]; }); };
    var WEIGHTS = CH([['normal', 'Regular', 'font-weight:400'], ['bold', 'Bold', 'font-weight:700']]);

    add({ tab: 'colors', sec: 'Palette', key: 'palette', label: 'Palette', type: 'palette', def: 'datadivers', help: 'Data Divers is the house palette. The other six are colorblind-safe.' });
    add({ tab: 'colors', sec: 'Palette', key: 'paletteReverse', label: 'Reverse the palette order', type: 'check', def: false });
    add({ tab: 'colors', sec: 'Per-category overrides', key: 'catColors', label: 'Colors and names', type: 'list', source: 'categories', def: [], visible: true,
      help: 'Rename, recolor, hide or reorder each category. Reset restores the palette.' });

    add({ tab: 'labels', sec: 'Labels', key: 'labelsOn', label: 'Show labels', type: 'check', def: true });
    add({ tab: 'labels', sec: 'Labels', key: 'labelSize', label: 'Label size', type: 'number', min: 14, max: 28, step: 1, unit: 'px', def: 14, help: 'Never below 14px.', when: { key: 'labelsOn', truthy: true } });
    add({ tab: 'labels', sec: 'Labels', key: 'labelWeight', label: 'Label weight', type: 'chips', opts: WEIGHTS, def: 'normal', when: { key: 'labelsOn', truthy: true } });
    add({ tab: 'labels', sec: 'Labels', key: 'labelColor', label: 'Label color', type: 'color', auto: true, def: '', help: 'Auto picks the color that reads best on the background.', when: { key: 'labelsOn', truthy: true } });
    add({ tab: 'labels', sec: 'Labels', key: 'labelLines', label: 'Wrap onto up to', type: 'number', min: 1, max: 4, step: 1, unit: 'lines', def: 2, when: { key: 'labelsOn', truthy: true } });
    add({ tab: 'labels', sec: 'Values', key: 'valueLabels', label: 'Show value labels', type: 'check', def: false });
    add({ tab: 'labels', sec: 'Values', key: 'valueLabelSize', label: 'Value label size', type: 'number', min: 14, max: 24, step: 1, unit: 'px', def: 14, when: { key: 'valueLabels', truthy: true } });

    add({ tab: 'numbers', sec: 'Format', key: 'numDecimals', label: 'Decimal places', type: 'number', min: 0, max: 6, step: 1, def: 1 });
    add({ tab: 'numbers', sec: 'Format', key: 'numPreview', label: 'Shows as', type: 'preview', text: function (s) { return 'Shows as ' + formatNumber(12345.6, s) + ' and ' + formatNumber(-0.5, s); } });
    add({ tab: 'numbers', sec: 'Format', key: 'numThousands', label: 'Thousands separator', type: 'chips', opts: CH([['comma', '1,234,567'], ['space', '1 234 567'], ['none', '1234567']]), def: 'comma' });
    add({ tab: 'numbers', sec: 'Format', key: 'numCompact', label: 'Short form (1.2K, 3.4M)', type: 'check', def: false });
    add({ tab: 'numbers', sec: 'Format', key: 'numScale', label: 'Multiply by', type: 'chips', opts: CH([['1', 'As is'], ['100', '100 (percent)'], ['0.001', '0.001']]), def: '1' });
    add({ tab: 'numbers', sec: 'Text', key: 'numPrefix', label: 'Prefix', type: 'text', def: '', maxLength: 12, placeholder: 'for example $' });
    add({ tab: 'numbers', sec: 'Text', key: 'numSuffix', label: 'Suffix', type: 'text', def: '', maxLength: 12, placeholder: 'for example %' });

    add({ tab: 'tooltip', sec: 'Tooltip', key: 'tipOn', label: 'Show tooltips', type: 'check', def: true });
    add({ tab: 'tooltip', sec: 'Tooltip', key: 'tipSize', label: 'Tooltip text size', type: 'number', min: 14, max: 22, step: 1, unit: 'px', def: 14, when: { key: 'tipOn', truthy: true } });
    add({ tab: 'tooltip', sec: 'Tooltip', key: 'tipSwatch', label: 'Color swatch beside each name', type: 'check', def: true, when: { key: 'tipOn', truthy: true } });
    add({ tab: 'tooltip', sec: 'Tooltip', key: 'tipFollow', label: 'Placement', type: 'chips', opts: CH([['cursor', 'Follow the cursor'], ['corner', 'Fixed corner']]), def: 'cursor', when: { key: 'tipOn', truthy: true } });
    add({ tab: 'tooltip', sec: 'Tooltip', key: 'tipMaxW', label: 'Maximum width', type: 'number', min: 160, max: 520, step: 10, unit: 'px', def: 280, when: { key: 'tipOn', truthy: true } });

    add({ tab: 'fonts', sec: 'Font', key: 'fontFamily', label: 'Font', type: 'font', def: 'worksheet', help: 'Sans-serif families only. Inter and Poppins ship with the extension, so they look the same on every machine.' });
    add({ tab: 'fonts', sec: 'Font', key: 'textScale', label: 'Text size', type: 'chips', def: '1',
      opts: CH([['1', 'Aa 100%', 'font-size:14px'], ['1.15', 'Aa 115%', 'font-size:16px'], ['1.3', 'Aa 130%', 'font-size:18px'], ['1.45', 'Aa 145%', 'font-size:20px']]),
      help: 'Scales every chart text size up together, for meetings and wall screens. Never below 14px.' });
    add({ tab: 'fonts', sec: 'Title', key: 'showTitle', label: 'Show a title', type: 'check', def: false });
    add({ tab: 'fonts', sec: 'Title', key: 'titleText', label: 'Title text', type: 'text', def: '', maxLength: 120, placeholder: 'Top {top} of {n}', when: { key: 'showTitle', truthy: true }, tokensHelp: true,
      help: 'Placeholders refill when a filter changes: {n} the number of marks, {top} the largest, {total} the sum.' });
    add({ tab: 'fonts', sec: 'Title', key: 'titleSize', label: 'Title size', type: 'number', min: 14, max: 40, step: 1, unit: 'px', def: 18, when: { key: 'showTitle', truthy: true } });
    add({ tab: 'fonts', sec: 'Title', key: 'titleWeight', label: 'Title weight', type: 'chips', opts: WEIGHTS, def: 'bold', when: { key: 'showTitle', truthy: true } });
    add({ tab: 'fonts', sec: 'One-click setups', key: 'setupMeeting', label: 'Set up for a meeting room', type: 'action', help: 'Text at 130%, bold labels and a bold title. Undo takes it back.',
      apply: function () { return { textScale: '1.3', labelsOn: true, labelWeight: 'bold', titleWeight: 'bold' }; } });
    add({ tab: 'fonts', sec: 'One-click setups', key: 'setupTile', label: 'Set up for a small dashboard tile', type: 'action', help: 'Text at 100%, no title and tight padding.',
      apply: function () { return { textScale: '1', showTitle: false, padding: 4 }; } });

    add({ tab: 'background', sec: 'Background', key: 'bgMode', label: 'Background', type: 'chips', opts: CH([['worksheet', 'Worksheet'], ['custom', 'Custom'], ['transparent', 'Transparent']]), def: 'worksheet' });
    add({ tab: 'background', sec: 'Background', key: 'bgColor', label: 'Background color', type: 'color', def: '#ffffff', when: { key: 'bgMode', eq: 'custom' } });
    add({ tab: 'background', sec: 'Background', key: 'padding', label: 'Padding', type: 'number', min: 0, max: 60, step: 2, unit: 'px', def: 12 });
    add({ tab: 'background', sec: 'Border', key: 'borderOn', label: 'Draw a border', type: 'check', def: false });
    add({ tab: 'background', sec: 'Border', key: 'borderColor', label: 'Border color', type: 'color', def: '#8fa7b8', when: { key: 'borderOn', truthy: true } });
    add({ tab: 'background', sec: 'Border', key: 'borderWidth', label: 'Border width', type: 'number', min: 1, max: 8, step: 1, unit: 'px', def: 1, when: { key: 'borderOn', truthy: true } });
    add({ tab: 'background', sec: 'Border', key: 'borderRadius', label: 'Corner radius', type: 'number', min: 0, max: 40, step: 2, unit: 'px', def: 0, when: { key: 'borderOn', truthy: true } });

    add({ tab: 'animation', sec: 'Entrance', key: 'animOn', label: 'Animate the chart', type: 'check', def: true, help: 'Off draws everything at once. Reduced-motion users always get that.' });
    add({ tab: 'animation', sec: 'Entrance', key: 'animMs', label: 'Duration', type: 'number', min: 100, max: 3000, step: 50, unit: 'ms', def: 600, when: { key: 'animOn', truthy: true } });
    add({ tab: 'animation', sec: 'Entrance', key: 'animEase', label: 'Easing', type: 'chips', opts: CH([['out', 'Ease out'], ['inout', 'Ease in-out'], ['linear', 'Linear']]), def: 'out', when: { key: 'animOn', truthy: true } });
    add({ tab: 'animation', sec: 'Hover', key: 'hoverMs', label: 'Hover fade', type: 'number', min: 0, max: 600, step: 20, unit: 'ms', def: 160, help: 'How long the dim and highlight take. 0 is instant.' });

    add({ tab: 'interaction', sec: 'Marks', key: 'selectOn', label: 'Click selects marks in Tableau', type: 'check', def: true });
    add({ tab: 'interaction', sec: 'Marks', key: 'hoverOn', label: 'Highlight on hover', type: 'check', def: true });
    add({ tab: 'interaction', sec: 'Marks', key: 'dimOthers', label: 'Dim the others to', type: 'number', min: 5, max: 100, step: 5, unit: '%', def: 25, when: { key: 'hoverOn', truthy: true } });
    add({ tab: 'interaction', sec: 'Marks', key: 'hoverPush', label: 'Send hover to Tableau', type: 'check', def: false, help: 'Makes other sheets on the dashboard highlight too. Not available on C-Tableau Viz pages.', when: { key: 'hoverOn', truthy: true } });

    (opts.fields || []).forEach(function (f) {
      add({ tab: 'fields', sec: 'Pick fields by hand', key: f.key, label: f.label, type: 'field', def: '', kind: f.kind || 'any', help: f.help || 'Auto uses the field on the shelf.' });
    });
    return { tabs: tabs, rows: rows };
  }

  /* ------------------------------------------------------------------ store */

  function indexRows(rows) { var m = {}; settable(rows).forEach(function (r) { m[r.key] = r; }); return m; }

  /* A settings store over tableau.extensions.settings: typed in memory, written as strings under prefix+key,
   * saved through saveAsync after a quiet period, change notices batched to one per frame. */
  function createStore(o) {
    var prepared = o.rows ? { rows: o.rows } : prepare(o.schema);
    var rows = prepared.rows, byKey = indexRows(rows), prefix = o.prefix || '', st = o.settings, wait = o.debounce === undefined ? 400 : o.debounce;
    var vals = defaultsOf(rows), saveTimer = null, noteTimer = null, noteKeys = {}, log = o.log || function () {};
    function stored(key) {
      var v;
      try { v = st.get(prefix + key); } catch (e) { v = undefined; }
      if (v === undefined || v === null) {
        var all = {}; try { all = st.getAll() || {}; } catch (e2) { all = {}; }
        Object.keys(all).some(function (ak) { if (ak.split('.').pop() === key) { v = all[ak]; return true; } return false; });
      }
      return v;
    }
    function load() {
      if (!st) return vals;
      Object.keys(byKey).forEach(function (k) {
        var raw = stored(k);
        if (raw === undefined || raw === null) return;
        var c = coerce(byKey[k], raw);
        if (c !== undefined) vals[k] = c;
      });
      return vals;
    }
    /* Save results go to listeners (the panel's save-status line): pending, saved, failed. */
    var saveState = st ? 'idle' : 'none', saveListeners = [], draws = [], tokensFn = null, view = null;
    function saved(state, err) { saveState = state; saveListeners.forEach(function (fn) { try { fn(state, err); } catch (e) { log('save listener threw', e); } }); }
    function flush() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (!st) return;
      try {
        var p = st.saveAsync();
        if (p && p.then) p.then(function () { saved('saved'); }, function (e) { log('saveAsync rejected', e); saved('failed', e); });
        else saved('saved');
      } catch (e) { log('saveAsync threw', e); saved('failed', e); }
    }
    function later() { if (!st) return; if (saveTimer) clearTimeout(saveTimer); saved('pending'); saveTimer = setTimeout(flush, wait); }
    function notify(keys) {
      view = null;
      keys.forEach(function (k) { noteKeys[k] = 1; });
      if (noteTimer || !o.onChange) return;
      var fire = function () {
        noteTimer = null; var ks = Object.keys(noteKeys); noteKeys = {};
        var t0 = Date.now();
        try { o.onChange(ks); } catch (e) { log('onChange threw', e); noteError('draw', e && e.message ? e.message : e, 'onChange'); }
        draws.push({ time: new Date().toISOString(), keys: ks.slice(0, 8), ms: Date.now() - t0 }); if (draws.length > 6) draws.shift();
      };
      if (typeof requestAnimationFrame === 'function') noteTimer = requestAnimationFrame(fire); else noteTimer = setTimeout(fire, 0);
    }
    function setMany(obj) {
      var changed = [];
      Object.keys(obj).forEach(function (k) {
        var row = byKey[k]; if (!row) return;
        var c = coerce(row, obj[k]);
        if (c === undefined || same(vals[k], c)) return;
        vals[k] = c; changed.push(k);
        if (st) { try { st.set(prefix + k, serialize(row, c)); } catch (e) { log('could not stage', k, e); } }
      });
      if (changed.length) { later(); notify(changed); }
      return changed;
    }
    /* What renderers read: the stored values, with every chart text size multiplied by Text size (never under 14)
     * and {placeholders} in the title filled from the extension's tokens. At 100% with no title tokens it is the
     * stored object itself. The panel reads raw() so its steppers show what was typed. */
    function derived() {
      var scale = parseFloat(vals.textScale);
      var scaled = isFinite(scale) && scale > 1 && scale <= 3;
      var titled = !!tokensFn && typeof vals.titleText === 'string' && vals.titleText.indexOf('{') >= 0;
      if (!scaled && !titled) return vals;
      if (view) return view;
      var v = {}; Object.keys(vals).forEach(function (k) { v[k] = vals[k]; });
      if (scaled) Object.keys(byKey).forEach(function (k) { if (isTextSize(byKey[k]) && typeof v[k] === 'number') v[k] = Math.max(14, Math.round(v[k] * scale)); });
      if (titled) {
        var tpl = vals.titleText;
        Object.defineProperty(v, 'titleText', { enumerable: true, get: function () { var t = {}; try { t = tokensFn() || {}; } catch (e) { t = {}; } return fillTitle(tpl, t); } });
      }
      view = v;
      return v;
    }
    /* Panel habits (position, dock, pin, open sections, tab, theme) are a person's, so they live per machine in
     * localStorage, never in the workbook: dragging the panel no longer dirties the workbook. HYDRATE: 1.0.0 kept
     * them in the workbook as prefix_panel. The first load on a machine with nothing local carries that copy over
     * once. The workbook copy is left where it is (never deleted), so no saved theme is ever lost. */
    var panelKey = prefix + '_panel', machineKey = 'ctab:' + prefix + 'panel';
    return {
      rows: rows, load: load, flush: flush,
      get: derived,
      raw: function () { return vals; },
      snapshot: function () { return JSON.parse(JSON.stringify(vals)); },
      set: function (k, v) { var o2 = {}; o2[k] = v; return setMany(o2); },
      setMany: setMany,
      reset: function (keys) { var d = defaultsOf(rows), o2 = {}; (keys || Object.keys(d)).forEach(function (k) { if (k in d) o2[k] = d[k]; }); return setMany(o2); },
      poke: function (keys) { notify(keys || []); },
      setTokens: function (fn) { tokensFn = typeof fn === 'function' ? fn : null; view = null; },
      onSave: function (fn) { saveListeners.push(fn); },
      saveState: function () { return saveState; },
      draws: function () { return draws.slice(); },
      panelState: {
        key: machineKey,
        get: function () {
          var r = lsGet(machineKey);
          if (r) { try { var o1 = JSON.parse(r); if (o1 && typeof o1 === 'object') return o1; } catch (e) { /* fall through to the workbook copy */ } }
          var legacy = null; try { legacy = st ? st.get(panelKey) : null; } catch (e2) { legacy = null; }
          if (legacy) {
            try {
              var o3 = JSON.parse(legacy);
              if (o3 && typeof o3 === 'object' && !Array.isArray(o3)) { o3.hydrated = '1.0.0 workbook'; lsSet(machineKey, JSON.stringify(o3)); return o3; }
            } catch (e3) { log('legacy panel state unreadable', e3); }
          }
          return {};
        },
        set: function (obj) { lsSet(machineKey, JSON.stringify(obj)); }
      }
    };
  }

  /* --------------------------------------------------------------------- UI */

  var COUNT = 0;

  function create(host, opts) {
    var doc = host.ownerDocument, win = doc.defaultView;
    var prepared = prepare(opts.schema), rows = prepared.rows, store = opts.store;
    var infoFn = opts.info || function () { return {}; };
    var uid = 'cp' + (++COUNT), title = opts.title || 'Settings';
    var panelTab = { id: '_panel', label: 'Panel' };
    var panelRows = [
      { tab: '_panel', sec: 'Panel theme', key: 'theme', label: 'Theme', type: 'chips', _p: true, opts: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'match', label: 'Match the chart' }, { value: 'custom', label: 'Custom' }], def: 'match' },
      { tab: '_panel', sec: 'Panel theme', key: 'customBg', label: 'Custom background', type: 'color', _p: true, def: '#ffffff', when: { key: 'theme', eq: 'custom' } },
      { tab: '_panel', sec: 'Panel theme', key: 'customInk', label: 'Custom text', type: 'color', _p: true, def: '#14202e', when: { key: 'theme', eq: 'custom' }, help: 'Text is always adjusted to stay readable (7:1).' },
      { tab: '_panel', sec: 'Panel theme', key: 'uiScale', label: 'Panel text size', type: 'chips', _p: true, def: '1',
        opts: [{ value: '1', label: 'Aa 100%', style: 'font-size:14px' }, { value: '1.15', label: 'Aa 115%', style: 'font-size:16px' }, { value: '1.3', label: 'Aa 130%', style: 'font-size:18px' }] },
      { tab: '_panel', sec: 'Position', key: 'resetPos', label: 'Put the panel back top right', type: 'note', _p: true },
      { tab: '_panel', sec: 'Diagnostics', key: 'diag', label: 'Diagnostics', type: 'diag', _p: true,
        help: 'A report for fixing a problem: what data arrived, which fields were picked automatically, the last draws, recent errors and these settings. It includes up to 4 sample rows of your data, so read it before you share it.' }
    ];
    var allTabs = prepared.tabs.concat([panelTab]);
    var allRows = rows.concat(panelRows);
    var PIN_W = 360, PIN_MIN_W = 760, PIN_MIN_H = 420;
    var ps = { theme: 'match', customBg: '#ffffff', customInk: '#14202e', uiScale: '1', x: null, y: null, docked: true, lastFree: null, pinned: false, open: null, min: false, tab: prepared.tabs[0].id };
    var saved = {}; try { saved = (opts.state && opts.state.get && opts.state.get()) || {}; } catch (e) { saved = {}; }
    Object.keys(ps).forEach(function (k) { if (saved[k] !== undefined && saved[k] !== null) ps[k] = saved[k]; });
    if (saved.docked === undefined) ps.docked = typeof saved.x !== 'number';   /* a 1.0.0 state: a stored x means it was moved */
    if (!allTabs.some(function (t) { return t.id === ps.tab; })) ps.tab = prepared.tabs[0].id;
    if (!Array.isArray(ps.open)) ps.open = [ps.tab];
    ['theme', 'uiScale'].forEach(function (k) { var r = panelRows.filter(function (p) { return p.key === k; })[0]; if (coerce(prepare({ tabs: ['_panel'], rows: [r] }).rows[0], ps[k]) === undefined) ps[k] = r.def; });
    var chart = { bg: '#ffffff', ink: '#14202e' };
    var query = '', mode = 'idle', confirm = null, status = '', statusErr = false, undo = [], lastCopied = '', pasteText = '', pasteMsg = '', drag = null, sheet = false, pinned = false;
    var openSnap = null, diagOpen = false, diagText = '', traces = [], reserved = [], reservedPx = 0;
    watchErrors(win);

    /* --- skeleton --- */
    var gear = doc.createElement('button');
    gear.type = 'button'; gear.className = 'cp-gear'; gear.setAttribute('aria-label', 'Open ' + title.toLowerCase());
    gear.setAttribute('aria-haspopup', 'dialog'); gear.setAttribute('aria-expanded', 'false'); gear.title = title;
    gear.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.6 7.6 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6c-.6.3-1.2.6-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .2.2.4.5.4h4c.3 0 .5-.2.5-.4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6L19.4 13zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';
    var panel = doc.createElement('div');
    panel.className = 'cp-panel'; panel.hidden = true; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', title); panel.tabIndex = -1;
    panel.innerHTML =
      '<div class="cp-head" tabindex="0" aria-label="' + esc(title) + ' title bar. Drag to move, or use the arrow keys."><span class="cp-grip" aria-hidden="true">&#8942;&#8942;</span>' +
      '<h2 class="cp-title">' + esc(title) + '</h2>' +
      '<button type="button" class="cp-ib cp-hd" data-a="dock" data-f="dock" aria-label="Dock the panel top right" title="Dock the panel top right (or double-click the title bar)">' +
      '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 3h14v14H3z"/><path fill="currentColor" d="M11 3h6v6h-6z"/></svg></button>' +
      '<button type="button" class="cp-ib cp-hd" data-a="pin" data-f="pin" aria-label="Pin to side" aria-pressed="false" title="Pin to side">' +
      '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 3h14v14H3z"/><path fill="currentColor" d="M12 3h5v14h-5z"/></svg></button>' +
      '<button type="button" class="cp-ib" data-a="min" aria-label="Minimize settings">&minus;</button>' +
      '<button type="button" class="cp-ib" data-a="close" aria-label="Close settings">&times;</button></div>' +
      '<div class="cp-main"><div class="cp-search"><input type="text" class="cp-q" data-f="q" aria-label="Search settings" placeholder="Search all settings" autocomplete="off" spellcheck="false"></div>' +
      '<div class="cp-tabs" role="tablist" aria-label="Settings tabs"></div><div class="cp-body" role="tabpanel"></div>' +
      '<div class="cp-status" role="status" aria-live="polite"></div><div class="cp-foot"><div class="cp-save" role="status" aria-live="polite"></div><div class="cp-footin"></div></div></div>';
    var cs = host.ownerDocument.defaultView.getComputedStyle(host);
    if (cs.position === 'static') host.style.position = 'relative';
    host.appendChild(gear); host.appendChild(panel);
    var head = panel.querySelector('.cp-head'), main = panel.querySelector('.cp-main'), tabsEl = panel.querySelector('.cp-tabs');
    var bodyEl = panel.querySelector('.cp-body'), statusEl = panel.querySelector('.cp-status'), footEl = panel.querySelector('.cp-footin'), qEl = panel.querySelector('.cp-q');
    var saveEl = panel.querySelector('.cp-save'), pinBtn = head.querySelector('[data-a=pin]');

    function curSettings() { return store.raw ? store.raw() : store.get(); }
    function getVal(row) { return row._p ? ps[row.key] : curSettings()[row.key]; }
    function info() { var i = null; try { i = infoFn(); } catch (e) { i = null; } return i || {}; }
    /* {n}: the rows the extension reports; {top}, {total} and the rest come from info().tokens. */
    function tokensOf(inf) {
      var t = {}, d = inf.data || {};
      if (typeof d.rows === 'number') t.n = d.rows;
      Object.keys(inf.tokens || {}).forEach(function (k) { t[k] = inf.tokens[k]; });
      return t;
    }
    if (store.setTokens) store.setTokens(function () { return tokensOf(info()); });
    function persistState() {
      try {
        if (opts.state && opts.state.set) opts.state.set({ theme: ps.theme, customBg: ps.customBg, customInk: ps.customInk, uiScale: ps.uiScale, x: ps.x, y: ps.y, docked: ps.docked,
          lastFree: ps.lastFree, pinned: ps.pinned, open: ps.open, min: ps.min, tab: ps.tab });
      } catch (e) { /* cosmetic */ }
    }
    function say(msg, err) { status = msg || ''; statusErr = !!err; statusEl.textContent = status; statusEl.className = 'cp-status' + (err ? ' cp-err' : ''); }

    /* --- save status --- */
    var SAVE_TEXT = { none: 'Changes last for this visit only: no workbook is connected.', idle: 'Changes save to the workbook as you go.', pending: 'Saving to the workbook...',
      saved: 'Saved to the workbook.', failed: 'These changes last for this visit only: this view cannot save to the workbook.' };
    function showSave() {
      var s = store.saveState ? store.saveState() : 'idle';
      saveEl.textContent = SAVE_TEXT[s] || SAVE_TEXT.idle;
      saveEl.className = 'cp-save' + (s === 'failed' || s === 'none' ? ' cp-err' : '');
      saveEl.setAttribute('data-state', s);
    }
    if (store.onSave) store.onSave(function () { showSave(); });

    /* --- theme --- */
    function applyTheme() {
      var t = themeTokens(ps.theme, chart, { bg: ps.customBg, ink: ps.customInk });
      var s = panel.style;
      s.setProperty('--cp-bg', t.bg); s.setProperty('--cp-surface', t.surface); s.setProperty('--cp-ink', t.ink); s.setProperty('--cp-muted', t.muted);
      s.setProperty('--cp-border', t.border); s.setProperty('--cp-accent', t.accent); s.setProperty('--cp-danger', t.danger);
      gear.style.setProperty('--cp-bg', t.bg); gear.style.setProperty('--cp-ink', t.ink); gear.style.setProperty('--cp-border', t.border); gear.style.setProperty('--cp-accent', t.accent);
      panel.setAttribute('data-theme', ps.theme);
      panel.style.setProperty('--cp-fs', Math.round(14 * (parseFloat(ps.uiScale) || 1) * 10) / 10 + 'px');
      var dark = isDarkBg(chart.bg);
      if (dark !== isDarkBg(CHART.bg)) { CHART.bg = normHex(chart.bg) || '#ffffff'; if (store.poke) store.poke(['palette']); }
      else CHART.bg = normHex(chart.bg) || CHART.bg;
    }

    /* --- placement --- */
    function hostSize() { return { w: host.clientWidth, h: host.clientHeight }; }
    function clamp(x, y) {
      var hs = hostSize(), w = panel.offsetWidth, h = panel.offsetHeight;
      return { x: Math.round(Math.max(0, Math.min(hs.w - w, x))), y: Math.round(Math.max(0, Math.min(hs.h - h, y))) };
    }
    function place(x, y, save) {
      if (sheet || pinned) return;
      var c = clamp(x, y); ps.x = c.x; ps.y = c.y;
      panel.style.transform = 'translate(' + c.x + 'px,' + c.y + 'px)';
      if (save) persistState();
    }
    function canPin() { var hs = hostSize(); return hs.w >= PIN_MIN_W && hs.h >= PIN_MIN_H; }
    function pinReason() { var hs = hostSize(); return 'Pin to side needs a view at least ' + PIN_MIN_W + ' by ' + PIN_MIN_H + ' pixels. This one is ' + hs.w + ' by ' + hs.h + '.'; }
    /* Pinned and open, the chart gives up the right-hand strip: every other child of the host is pulled in from the
     * right (`right` for positioned children, margin for the rest), so its ResizeObserver redraws it narrower.
     * opts.onLayout({ reserveRight, pinned }) tells an extension that lays out some other way. */
    function reserve(px) {
      if (px === reservedPx) return;
      reserved.forEach(function (r) { r.el.style[r.prop] = r.old; });
      reserved = [];
      if (px > 0) {
        for (var i = 0; i < host.children.length; i++) {
          var el = host.children[i];
          if (el === gear || el === panel) continue;
          var pos = win.getComputedStyle(el).position, prop = pos === 'absolute' || pos === 'fixed' ? 'right' : 'marginRight';
          reserved.push({ el: el, prop: prop, old: el.style[prop] });
          el.style[prop] = px + 'px';
        }
      }
      reservedPx = px;
      host.classList.toggle('cp-host-pinned', px > 0);
      if (opts.onLayout) { try { opts.onLayout({ reserveRight: px, pinned: px > 0 }); } catch (e) { noteError('onLayout', e && e.message ? e.message : e); } }
    }
    function layoutMode() {
      var hs = hostSize(), was = sheet + ':' + pinned;
      sheet = hs.w < 420;
      pinned = !sheet && !!ps.pinned && canPin();
      panel.classList.toggle('cp-sheet', sheet);
      panel.classList.toggle('cp-pinned', pinned);
      if (sheet || pinned) panel.style.transform = '';
      var ok = canPin();
      pinBtn.setAttribute('aria-pressed', String(pinned));
      pinBtn.setAttribute('aria-disabled', String(!ok && !pinned));
      pinBtn.setAttribute('aria-label', pinned ? 'Float the panel' : ok ? 'Pin to side' : 'Pin to side (unavailable: the view is too small)');
      pinBtn.title = pinned ? 'Float the panel' : ok ? 'Pin to side' : pinReason();
      reserve(pinned && !panel.hidden && !ps.min ? PIN_W : 0);
      return was !== sheet + ':' + pinned;
    }
    function settle() {
      var moved = layoutMode();
      if (moved && !panel.hidden) render();
      if (sheet || pinned) return;
      var hs = hostSize(), w = panel.offsetWidth;
      if (ps.docked || ps.x === null || ps.y === null) place(hs.w - w - 8, 8, false); else place(ps.x, ps.y, false);
    }
    function dock(save) {
      if (!ps.docked && typeof ps.x === 'number') ps.lastFree = { x: ps.x, y: ps.y };
      ps.docked = true; ps.x = null; ps.y = null;
      settle(); if (save !== false) persistState();
    }
    function undock() {
      var lf = ps.lastFree; if (!lf) return false;
      ps.docked = false; place(lf.x, lf.y, true);
      return true;
    }
    function setPinned(on) {
      if (on && !canPin()) { say(pinReason(), true); return; }
      ps.pinned = !!on; persistState(); settle(); render();
      say(on ? 'Pinned to the right side. The chart is narrower while the panel is open.' : 'The panel floats again.');
    }
    function onResize() { if (!panel.hidden) settle(); }
    var ro = null;
    if (typeof win.ResizeObserver === 'function') { ro = new win.ResizeObserver(onResize); ro.observe(host); } else win.addEventListener('resize', onResize);

    head.addEventListener('pointerdown', function (e) {
      if (sheet || pinned || e.target.closest('button')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: ps.x === null ? 0 : ps.x, oy: ps.y === null ? 0 : ps.y, moved: false };
      try { head.setPointerCapture(e.pointerId); } catch (er) { /* synthetic pointer */ }
      panel.classList.add('cp-dragging');
      e.preventDefault();
    });
    head.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 2) { drag.moved = true; ps.docked = false; }
      place(drag.ox + e.clientX - drag.sx, drag.oy + e.clientY - drag.sy, false);
    });
    function endDrag(e) {
      if (!drag || (e && e.pointerId !== undefined && e.pointerId !== drag.id)) return;
      drag = null; panel.classList.remove('cp-dragging'); persistState();
    }
    head.addEventListener('pointerup', endDrag); head.addEventListener('pointercancel', endDrag); head.addEventListener('lostpointercapture', endDrag);
    head.addEventListener('keydown', function (e) {
      if (e.target !== head || sheet || pinned) return;
      var d = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
      if (!d) return;
      e.preventDefault(); ps.docked = false; place((ps.x || 0) + d[0], (ps.y || 0) + d[1], true);
    });
    /* Double-click the title bar: a moved panel docks top right; a docked one goes back to where it was; a pinned one floats. */
    head.addEventListener('dblclick', function (e) {
      if (sheet || e.target.closest('button')) return;
      if (pinned) { setPinned(false); return; }
      if (ps.docked) { if (undock()) say('Panel moved back to where you had it.'); else say('The panel is already docked top right.'); return; }
      dock(); say('Panel docked top right. Double-click the title bar again to put it back.');
    });

    /* --- rendering --- */
    function sigOf(s, inf) { return allRows.map(function (r) { return isVisible(r, s, inf) ? r.key : r.hideWhenOff ? '' : '!' + r.key; }).join(','); }
    var lastSig = '';
    var LOCK = '<svg class="cp-lock" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7h1zm2 0h4V5a2 2 0 0 0-4 0v2z"/></svg>';

    function control(row, v, inf, fid) {
      var id = uid + '-' + row.key, lab = '<label class="cp-lab" for="' + id + '">' + esc(row.label) + '</label>', t = row.type;
      if (t === 'note') {
        return '<div class="cp-full"><button type="button" class="cp-btn" data-a="resetpos" data-f="resetpos">' + esc(row.label) + '</button></div>';
      }
      if (t === 'preview') {
        var pt = ''; try { pt = row.text(curSettings(), inf); } catch (e) { pt = ''; }
        return '<div class="cp-full cp-preview" data-preview="' + row.key + '" aria-live="polite">' + esc(pt) + '</div>';
      }
      if (t === 'action') {
        return '<div class="cp-full"><button type="button" class="cp-btn" data-a="action" data-k="' + row.key + '" data-f="' + row.key + '">' + esc(row.label) + '</button></div>';
      }
      if (t === 'diag') {
        return '<div class="cp-full cp-actions"><button type="button" class="cp-btn" data-a="diagshow" data-f="diagshow" aria-expanded="' + diagOpen + '">' + (diagOpen ? 'Hide diagnostics' : 'Show diagnostics') + '</button>' +
          '<button type="button" class="cp-btn" data-a="diagcopy" data-f="diagcopy">Copy diagnostics</button></div>' +
          (diagOpen ? '<textarea class="cp-full cp-diagtext" data-f="diagtext" readonly rows="10" spellcheck="false" aria-label="Diagnostics report">' + esc(diagText) + '</textarea>' : '');
      }
      if (t === 'check') {
        return '<label class="cp-check cp-full"><input type="checkbox" id="' + id + '" data-k="' + row.key + '" data-f="' + row.key + '"' + (v ? ' checked' : '') + '><span>' + esc(row.label) + '</span></label>';
      }
      if (t === 'number') {
        return lab + '<div class="cp-num"><button type="button" class="cp-step" data-a="dec" data-k="' + row.key + '" data-f="' + row.key + '-" aria-label="Decrease ' + esc(row.label) + '">&minus;</button>' +
          '<input type="number" inputmode="decimal" id="' + id + '" data-k="' + row.key + '" data-f="' + row.key + '" min="' + row.min + '" max="' + row.max + '" step="' + row.step + '" value="' + esc(v) + '">' +
          '<button type="button" class="cp-step" data-a="inc" data-k="' + row.key + '" data-f="' + row.key + '+" aria-label="Increase ' + esc(row.label) + '">+</button>' +
          (row.unit ? '<span class="cp-unit">' + esc(row.unit) + '</span>' : '') + '</div>';
      }
      if (t === 'select') {
        var sopts = row.opts;
        if (row.dynamic) {
          sopts = row.opts.slice();
          ((inf.lists && inf.lists[row.source]) || []).forEach(function (it) { sopts.push({ value: it.key, label: it.name || it.key }); });
          if (v && !sopts.some(function (o) { return o.value === String(v); })) sopts.push({ value: String(v), label: String(v) + ' (not in the data)' });
        }
        return lab + '<select id="' + id + '" data-k="' + row.key + '" data-f="' + row.key + '">' + sopts.map(function (o) { return '<option value="' + esc(o.value) + '"' + (o.value === String(v) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>';
      }
      if (t === 'chips') {
        return '<div class="cp-lab" id="' + id + '-l">' + esc(row.label) + '</div><div class="cp-chips" role="group" aria-labelledby="' + id + '-l">' + row.opts.map(function (o) {
          return '<button type="button" class="cp-chip" data-a="chip" data-k="' + row.key + '" data-v="' + esc(o.value) + '" data-f="' + row.key + '=' + esc(o.value) + '" aria-pressed="' + (o.value === String(v)) + '"' + (o.style ? ' style="' + esc(o.style) + '"' : '') + '>' + esc(o.label) + '</button>';
        }).join('') + '</div>';
      }
      if (t === 'color') {
        var hx = normHex(v), shown = hx || (row._p ? '#000000' : chart.ink);
        return lab + '<div class="cp-color"><input type="color" id="' + id + '" data-k="' + row.key + '" data-f="' + row.key + '" value="' + esc(normHex(shown) || '#000000') + '" aria-label="' + esc(row.label) + ' picker">' +
          '<input type="text" class="cp-hex" data-k="' + row.key + '" data-f="' + row.key + '#" value="' + esc(hx || '') + '" maxlength="7" placeholder="' + (row.auto ? 'auto' : '#rrggbb') + '" aria-label="' + esc(row.label) + ' hex value" spellcheck="false">' +
          (row.auto ? '<button type="button" class="cp-btn cp-small" data-a="auto" data-k="' + row.key + '" data-f="' + row.key + '~">Auto</button>' : '') + '</div>';
      }
      if (t === 'text') {
        return lab + '<input type="text" id="' + id + '" data-k="' + row.key + '" data-f="' + row.key + '" value="' + esc(v) + '" maxlength="' + (row.maxLength || 200) + '"' + (row.placeholder ? ' placeholder="' + esc(row.placeholder) + '"' : '') + '>';
      }
      if (t === 'font') {
        return lab + '<select id="' + id + '" data-k="' + row.key + '" data-f="' + row.key + '">' + FONTS.map(function (f) { return '<option value="' + f.id + '"' + (f.id === v ? ' selected' : '') + '>' + esc(f.label) + '</option>'; }).join('') + '</select>';
      }
      if (t === 'palette') {
        return '<div class="cp-lab" id="' + id + '-l">' + esc(row.label) + '</div><div class="cp-pals" role="group" aria-labelledby="' + id + '-l">' + PALETTES.map(function (p) {
          return '<button type="button" class="cp-pal" data-a="chip" data-k="' + row.key + '" data-v="' + p.id + '" data-f="' + row.key + '=' + p.id + '" aria-pressed="' + (p.id === v) + '"><span class="cp-strip" aria-hidden="true">' +
            paletteColors(p.id, false, chart.bg).map(function (c) { return '<i style="background:' + c + '"></i>'; }).join('') + '</span><span class="cp-pname">' + esc(p.label) + (p.safe ? ' <em>colorblind-safe</em>' : '') + (isDarkBg(chart.bg) ? ' <em>dark variant</em>' : '') + '</span></button>';
        }).join('') + '</div>';
      }
      if (t === 'field') {
        var cols = (inf.columns || []).slice(), want = row.kind === 'numeric' ? (inf.numericColumns || cols) : cols;
        var auto = inf.auto && inf.auto[row.key] ? ' (' + inf.auto[row.key] + ')' : '';
        return lab + '<select id="' + id + '" data-k="' + row.key + '" data-f="' + row.key + '"><option value="">Auto' + esc(auto) + '</option>' + want.map(function (c) { return '<option value="' + esc(c) + '"' + (c === v ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>';
      }
      if (t === 'list') {
        var items = (inf.lists && inf.lists[row.source]) || [];
        if (!items.length) return '<div class="cp-full cp-help">Nothing to list yet. Add the field to the shelf first.</div>';
        var merged = mergeList(v, items);
        return '<div class="cp-list cp-full" role="list">' + merged.map(function (it, i) {
          return '<div class="cp-li" role="listitem">' +
            '<button type="button" class="cp-step" data-a="up" data-k="' + row.key + '" data-i="' + i + '" data-f="' + row.key + '^' + i + '" aria-label="Move ' + esc(it.name) + ' up">&uarr;</button>' +
            '<button type="button" class="cp-step" data-a="down" data-k="' + row.key + '" data-i="' + i + '" data-f="' + row.key + 'v' + i + '" aria-label="Move ' + esc(it.name) + ' down">&darr;</button>' +
            (row.visible ? '<input type="checkbox" class="cp-lshow" data-lk="' + row.key + '" data-i="' + i + '" data-f="' + row.key + 's' + i + '"' + (it.hidden ? '' : ' checked') + ' aria-label="Show ' + esc(it.name) + '">' : '') +
            '<input type="text" class="cp-lname" data-lk="' + row.key + '" data-i="' + i + '" data-f="' + row.key + 'n' + i + '" value="' + esc(it.name) + '" maxlength="120" aria-label="Name of ' + esc(it.defName) + '">' +
            '<input type="color" class="cp-lcol" data-lk="' + row.key + '" data-i="' + i + '" data-f="' + row.key + 'c' + i + '" value="' + esc(normHex(it.color) || '#888888') + '" aria-label="Color of ' + esc(it.name) + '"></div>';
        }).join('') + '<div><button type="button" class="cp-btn cp-small" data-a="listreset" data-k="' + row.key + '" data-f="' + row.key + '!">Reset names, colors and order</button></div></div>';
      }
      return '';
    }

    /* A row whose `when` fails is grayed out, not hidden, so nothing below it jumps: controls disabled, a dashed
     * outline and a lock, and a full-contrast line saying what turns it on. No opacity: a fade would break 7:1. */
    function rowHtml(row, s, inf) {
      var m = mergedState(s), off = !isVisible(row, m, inf);
      var help = row.help;
      if (row.tokensHelp) { var tk = Object.keys(tokensOf(inf)); if (tk.length) help = (help ? help + ' ' : '') + 'This chart offers ' + tk.map(function (k) { return '{' + k + '}'; }).join(', ') + '.'; }
      return '<div class="cp-row' + (off ? ' cp-off' : '') + '" data-row="' + row.key + '"' + (off ? ' aria-disabled="true"' : '') + '>' + control(row, getVal(row), inf, row.key) +
        (off ? '<div class="cp-help cp-offwhy">' + LOCK + ' ' + esc(offReason(row, allRows, m)) + '</div>' : '') +
        (help ? '<div class="cp-help">' + esc(help) + '</div>' : '') + '</div>';
    }
    function tabHtml(tabId, s, inf, tabLabel) {
      var html = '', lastSec = '';
      shownRows(allRows.filter(function (r) { return r.tab === tabId; }), mergedState(s), inf).forEach(function (r) {
        if (r.sec !== lastSec) {
          lastSec = r.sec;
          if (!(html === '' && tabLabel && r.sec.toLowerCase() === tabLabel.toLowerCase())) html += '<h3 class="cp-sec">' + esc(r.sec) + '</h3>';   /* no "Rings" under "Rings" */
        }
        html += rowHtml(r, s, inf);
      });
      if (!html) return '<p class="cp-empty">Nothing to set on this tab right now.</p>';
      return html + '<div class="cp-tabfoot"><button type="button" class="cp-btn cp-small" data-a="resettab" data-t="' + tabId + '" data-f="resettab' + (tabLabel ? '-' + tabId : '') + '">Reset this ' + (tabLabel ? 'section' : 'tab') + '</button></div>';
    }

    function renderTabs() {
      tabsEl.innerHTML = allTabs.map(function (t) {
        var on = !query && t.id === ps.tab;
        return '<button type="button" role="tab" class="cp-tab" data-a="tab" data-t="' + t.id + '" data-f="tab-' + t.id + '" aria-selected="' + on + '" tabindex="' + (on || (query && t.id === ps.tab) ? 0 : -1) + '">' + esc(t.label) + '</button>';
      }).join('');
    }
    function renderBody() {
      var s = curSettings(), inf = info(), html = '', list;
      bodyEl.setAttribute('role', pinned && !query ? 'region' : 'tabpanel');
      bodyEl.setAttribute('aria-label', pinned && !query ? 'Settings sections' : 'Settings');
      if (query) {
        list = searchRows({ tabs: allTabs, rows: allRows }, mergedState(s), inf, query);
        if (!list.length) html = '<p class="cp-empty">No setting matches "' + esc(query) + '".</p>';
        else {
          html = '<p class="cp-count">' + list.length + ' match' + (list.length === 1 ? '' : 'es') + '</p>';
          var lastTab = '';
          list.forEach(function (r) {
            if (r.tab !== lastTab) { lastTab = r.tab; allTabs.forEach(function (t) { if (t.id === r.tab) html += '<h3 class="cp-sec">' + esc(t.label) + '</h3>'; }); }
            html += rowHtml(r, s, inf);
          });
        }
      } else if (pinned) {
        /* Pinned: the tabs become an accordion, several sections open at once, the open set remembered. */
        html = allTabs.map(function (t) {
          var open = ps.open.indexOf(t.id) >= 0, bid = uid + '-acc-' + t.id;
          return '<section class="cp-accs"><h3 class="cp-acch"><button type="button" class="cp-acc" data-a="acc" data-t="' + t.id + '" data-f="acc-' + t.id + '" aria-expanded="' + open + '" aria-controls="' + bid + '">' +
            '<span class="cp-caret" aria-hidden="true">' + (open ? '&#9662;' : '&#9656;') + '</span>' + esc(t.label) + '</button></h3>' +
            '<div class="cp-accb" id="' + bid + '"' + (open ? '' : ' hidden') + '>' + (open ? tabHtml(t.id, s, inf, t.label) : '') + '</div></section>';
        }).join('');
      } else {
        html = tabHtml(ps.tab, s, inf);
      }
      bodyEl.innerHTML = html;
      var offs = bodyEl.querySelectorAll('.cp-off input, .cp-off select, .cp-off button, .cp-off textarea');
      for (var i = 0; i < offs.length; i++) offs[i].disabled = true;
      lastSig = sigOf(mergedState(s), inf);
    }
    function refreshPreviews() {
      var els = bodyEl.querySelectorAll('[data-preview]'), inf = null;
      for (var i = 0; i < els.length; i++) {
        var r = rowOf(els[i].getAttribute('data-preview')); if (!r) continue;
        inf = inf || info();
        var t = ''; try { t = r.text(curSettings(), inf); } catch (e) { t = ''; }
        if (els[i].textContent !== t) els[i].textContent = t;
      }
    }
    /* when() reads the chart settings; Panel-tab rows read the panel's own state */
    function mergedState(s) { var m = {}; Object.keys(s).forEach(function (k) { m[k] = s[k]; }); Object.keys(ps).forEach(function (k) { if (!(k in m)) m[k] = ps[k]; }); return m; }

    function renderFoot() {
      var h = '';
      if (mode === 'paste') {
        var lc = lastCopyMeta();
        h = '<div class="cp-extra"><label class="cp-lab" for="' + uid + '-paste">Paste settings text</label><textarea id="' + uid + '-paste" data-f="paste" rows="4" spellcheck="false" placeholder="Paste the text Copy formatting or Copy everything made">' + esc(pasteText) + '</textarea>' +
          '<div class="cp-msg' + (pasteMsg ? ' cp-err' : '') + '" role="alert">' + esc(pasteMsg) + '</div>' +
          '<div class="cp-actions"><button type="button" class="cp-btn cp-primary" data-a="pasteapply" data-f="pasteapply">Apply</button><button type="button" class="cp-btn" data-a="pastecancel" data-f="pastecancel">Cancel</button></div>' +
          (lc ? '<div class="cp-actions"><button type="button" class="cp-btn" data-a="pastelast" data-f="pastelast">Use the last copy on this machine</button></div><div class="cp-help">' + esc(lc) + '</div>' : '') + '</div>';
      } else if (mode === 'confirm') {
        h = '<div class="cp-extra" role="alertdialog" aria-label="Confirm reset"><div class="cp-msg">' + esc(confirm.message) + '</div><div class="cp-actions"><button type="button" class="cp-btn cp-primary" data-a="confirmyes" data-f="confirmyes">Yes, reset</button><button type="button" class="cp-btn" data-a="confirmno" data-f="confirmno">Cancel</button></div></div>';
      } else {
        /* Two rows at 400px: change history, then moving settings between sheets. Reset this tab sits at the foot of
         * the tab it resets (body), so its scope is where the eye already is. */
        h = '<div class="cp-actions"><button type="button" class="cp-btn" data-a="undo" data-f="undo">Undo</button><button type="button" class="cp-btn" data-a="revert" data-f="revert">Revert to when I opened</button>' +
          '<button type="button" class="cp-btn" data-a="resetall" data-f="resetall">Reset all</button></div>' +
          '<div class="cp-actions"><button type="button" class="cp-btn" data-a="copy" data-kind="formatting" data-f="copy" title="Colors, fonts, labels and the rest of the look. Leaves out field picks and per-item names and colors.">Copy formatting</button>' +
          '<button type="button" class="cp-btn" data-a="copy" data-kind="everything" data-f="copyall" title="Every setting, field picks included.">Copy everything</button><button type="button" class="cp-btn" data-a="paste" data-f="paste-open" aria-label="Paste settings">Paste</button></div>';
      }
      footEl.innerHTML = h;
      showSave();
    }
    var LASTCOPY = 'ctab:lastcopy';
    function lastCopyMeta() {
      var t = lsGet(LASTCOPY); if (!t) return '';
      try { var o = JSON.parse(t); return 'Last copy: ' + (o.name || 'a chart') + ', ' + (o.kind || 'formatting') + ', ' + shortDate(o.copied) + '.'; } catch (e) { return ''; }
    }
    function applyPaste(text) {
      var res = parsePaste(rows, text, opts.prefix);
      if (!res.ok) { pasteMsg = res.message; render(); refocus('paste'); return; }
      bulk(res.values, 'the pasted settings');
      mode = 'idle'; pasteMsg = ''; say(res.message); render(); refocus('paste-open');
    }

    function activeFid() { var a = doc.activeElement; return a && panel.contains(a) && a.getAttribute ? a.getAttribute('data-f') : null; }
    function refocus(fid) {
      if (!fid) return;
      var els = panel.querySelectorAll('[data-f]');
      for (var i = 0; i < els.length; i++) if (els[i].getAttribute('data-f') === fid) { try { els[i].focus({ preventScroll: true }); } catch (e) { els[i].focus(); } return; }
    }
    function render() {
      var fid = activeFid(), sc = bodyEl.scrollTop, msc = main.scrollTop;
      renderTabs(); renderBody(); renderFoot();
      bodyEl.scrollTop = sc; main.scrollTop = msc;
      panel.classList.toggle('cp-min', !!ps.min);
      head.querySelector('[data-a=min]').setAttribute('aria-label', ps.min ? 'Restore settings' : 'Minimize settings');
      head.querySelector('[data-a=min]').innerHTML = ps.min ? '&#9633;' : '&minus;';
      refocus(fid);
    }
    function softRender() {   /* after a typed change: redraw the body only if the set of visible rows moved */
      var s = mergedState(curSettings());
      if (sigOf(s, info()) !== lastSig) render();
    }

    /* --- changing values --- */
    var lastEdit = { key: null, t: 0 };
    function record(prev, label, coalesceKey) {
      var now = Date.now();
      if (coalesceKey && lastEdit.key === coalesceKey && now - lastEdit.t < 1200 && undo.length) { lastEdit.t = now; return; }
      lastEdit = { key: coalesceKey || null, t: now };
      undo.push({ prev: prev, label: label }); if (undo.length > 100) undo.shift();
    }
    function change(row, value, fromTyping) {
      if (row._p) {
        var c0 = coerce(row, value); if (c0 === undefined) return false;
        ps[row.key] = c0; persistState(); applyTheme(); return true;
      }
      var c = coerce(row, value); if (c === undefined) return false;
      var cur = curSettings()[row.key];
      if (same(cur, c)) return true;
      var prev = {}; prev[row.key] = JSON.parse(JSON.stringify(cur));
      var changed = store.set(row.key, c);
      if (changed && changed.length === 0 && !same(curSettings()[row.key], c)) return false;
      record(prev, row.label || row.key, fromTyping ? row.key : null);
      refreshPreviews();
      return true;
    }
    function rowOf(key) { for (var i = 0; i < allRows.length; i++) if (allRows[i].key === key) return allRows[i]; return null; }
    function bulk(values, label) {
      var s = curSettings(), prev = {};
      Object.keys(values).forEach(function (k) { if (k in s && !same(s[k], values[k])) prev[k] = JSON.parse(JSON.stringify(s[k])); });
      if (!Object.keys(prev).length) return 0;
      store.setMany(values);
      record(prev, label, null);
      return Object.keys(prev).length;
    }
    function keysOfTab(tabId) { return settable(rows).filter(function (r) { return tabId === null || r.tab === tabId; }); }
    function dirtyCount(rs) { var s = curSettings(); return rs.filter(function (r) { return !same(s[r.key], r.def); }).length; }
    function defaultsFor(rs) { var o = {}; rs.forEach(function (r) { o[r.key] = JSON.parse(JSON.stringify(r.def)); }); return o; }

    function stepBy(row, dir) {
      var v = Number(curSettings()[row.key]); if (!isFinite(v)) v = row.def;
      var d = Math.max(decimalsOf(row.step), decimalsOf(row.min));
      change(row, Number((v + dir * row.step).toFixed(d)), true);
    }
    function moveItem(row, i, dir) {
      var inf = info(), items = (inf.lists && inf.lists[row.source]) || [], merged = mergeList(curSettings()[row.key], items), j = i + dir;
      if (j < 0 || j >= merged.length) return;
      var t = merged[i]; merged[i] = merged[j]; merged[j] = t;
      change(row, merged.map(function (m) { return { key: m.key, name: m.name === m.defName ? '' : m.name, color: m.color === m.defColor ? '' : m.color, hidden: m.hidden }; }), false);
    }
    function editItem(row, i, patch, typing) {
      var inf = info(), items = (inf.lists && inf.lists[row.source]) || [], merged = mergeList(curSettings()[row.key], items);
      if (!merged[i]) return;
      Object.keys(patch).forEach(function (k) { merged[i][k] = patch[k]; });
      change(row, merged.map(function (m) { return { key: m.key, name: m.name === m.defName ? '' : m.name, color: m.color === m.defColor ? '' : m.color, hidden: m.hidden }; }), typing ? row.key + '#' + i : false);
    }

    function doUndo() {
      var u = undo.pop();
      if (!u) { say('Nothing to undo.'); return; }
      lastEdit = { key: null, t: 0 };
      store.setMany(u.prev);
      say('Undid ' + u.label + '.'); render();
    }
    function copyText(kind) {
      var block = copyBlock(rows, curSettings(), kind, { prefix: opts.prefix || '', name: title });
      lastCopied = JSON.stringify(block, null, 2);
      lsSet(LASTCOPY, lastCopied);   /* embedded frames often block the clipboard; the next sheet can use this */
      var n = Object.keys(block.settings).length, what = kind === 'everything' ? 'every setting' : 'the formatting';
      copyChain(doc, lastCopied, function (ok) {
        say(ok ? 'Copied ' + what + ' (' + n + ' settings).' : 'Could not reach the clipboard. Paste settings opens a box you can copy from, and Use the last copy works on this machine.', !ok);
        if (!ok) { mode = 'paste'; pasteText = lastCopied; pasteMsg = ''; render(); }
      });
    }

    /* --- diagnostics --- */
    function report() {
      var inf = info(), s = curSettings(), env = {}, lists = {};
      try { var te = win.tableau && win.tableau.extensions, e = te && te.environment; if (e) env = { apiVersion: e.apiVersion, context: e.context, mode: e.mode, tableauVersion: e.tableauVersion, os: e.operatingSystem, locale: e.uiLocale }; } catch (er) { env = { error: String(er) }; }
      Object.keys(inf.lists || {}).forEach(function (k) { lists[k] = (inf.lists[k] || []).length; });
      var data = null;
      if (inf.data) {
        data = { rows: inf.data.rows, fields: (inf.data.fields || []).slice(0, 60) };
        data.sample = (inf.data.sample || []).slice(0, 4).map(function (r) { return JSON.parse(JSON.stringify(r, function (k, v) { return typeof v === 'string' ? v.slice(0, 120) : v; })); });
      }
      return {
        report: 'C-Tableau diagnostics', library: 'ctab-panel ' + VERSION, extension: title, extensionVersion: opts.version || '', prefix: opts.prefix || '', created: new Date().toISOString(),
        view: { width: host.clientWidth, height: host.clientHeight, pixelRatio: win.devicePixelRatio || 1, window: [win.innerWidth, win.innerHeight] },
        browser: win.navigator.userAgent, language: win.navigator.language, tableau: env,
        data: data, fields: { columns: inf.columns || [], numeric: inf.numericColumns || [] }, automaticPicks: inf.auto || {}, lists: lists,
        draws: store.draws ? store.draws() : [], traces: traces.slice(-6), errors: ERRORS.slice(-20),
        save: store.saveState ? store.saveState() : 'unknown', settings: JSON.parse(JSON.stringify(s)),
        panel: { theme: ps.theme, uiScale: ps.uiScale, pinned: ps.pinned, docked: ps.docked, min: ps.min, tab: ps.tab, x: ps.x, y: ps.y }
      };
    }
    REPORTERS.push(report);

    /* --- events --- */
    panel.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b || !panel.contains(b)) return;
      var a = b.getAttribute('data-a'), k = b.getAttribute('data-k'), row = k ? rowOf(k) : null;
      if (b.disabled) return;
      if (a === 'close') { close(); return; }
      if (a === 'min') { ps.min = !ps.min; persistState(); panel.classList.toggle('cp-min', ps.min); render(); settle(); return; }
      if (a === 'dock') { if (pinned) { ps.pinned = false; } dock(); render(); say('Panel docked top right.'); return; }
      if (a === 'pin') { if (!pinned && !canPin()) { say(pinReason(), true); return; } setPinned(!pinned); refocus('pin'); return; }
      if (a === 'acc') {
        var tid = b.getAttribute('data-t'), at = ps.open.indexOf(tid);
        if (at >= 0) ps.open.splice(at, 1); else ps.open.push(tid);
        ps.tab = tid; persistState(); render(); refocus('acc-' + tid); return;
      }
      if (a === 'action' && row) {
        var vals = {}; try { vals = row.apply(curSettings(), info()) || {}; } catch (er) { noteError('action', er && er.message ? er.message : er, row.key); vals = {}; }
        var nA = bulk(vals, '"' + row.label + '"');
        say(nA ? 'Applied "' + row.label + '": ' + nA + ' setting' + (nA === 1 ? '' : 's') + ' changed. Undo takes it back.' : 'Already set up that way.');
        render(); refocus(row.key); return;
      }
      if (a === 'revert') {
        var snap = openSnap || {}, back = {}, sNow = curSettings();
        Object.keys(snap).forEach(function (k2) { if (!same(sNow[k2], snap[k2])) back[k2] = JSON.parse(JSON.stringify(snap[k2])); });
        var nR = Object.keys(back).length ? bulk(back, 'the revert') : 0;
        say(nR ? 'Back to how it was when you opened the panel (' + nR + ' setting' + (nR === 1 ? '' : 's') + '). Undo brings your changes back.' : 'Nothing has changed since you opened the panel.');
        render(); refocus('revert'); return;
      }
      if (a === 'diagshow') { diagOpen = !diagOpen; diagText = diagOpen ? JSON.stringify(report(), null, 2) : ''; render(); refocus('diagshow'); return; }
      if (a === 'diagcopy') {
        diagText = JSON.stringify(report(), null, 2); lastCopied = diagText;
        copyChain(doc, diagText, function (ok) {
          if (ok) say('Copied the diagnostics report.');
          else { diagOpen = true; render(); say('Could not reach the clipboard. The report is shown below: select it and copy.', true); }
        });
        return;
      }
      if (a === 'pastelast') { var lt = lsGet(LASTCOPY); if (lt) { pasteText = lt; applyPaste(lt); } return; }
      if (a === 'tab') { ps.tab = b.getAttribute('data-t'); query = ''; qEl.value = ''; persistState(); say(''); render(); return; }
      if (a === 'chip' && row) { if (change(row, b.getAttribute('data-v'), false)) { render(); } return; }
      if ((a === 'inc' || a === 'dec') && row) { stepBy(row, a === 'inc' ? 1 : -1); bodyEl.querySelector('[data-f="' + k + '"]').value = curSettings()[k]; softRender(); return; }
      if (a === 'auto' && row) { change(row, '', false); render(); return; }
      if ((a === 'up' || a === 'down') && row) { moveItem(row, +b.getAttribute('data-i'), a === 'up' ? -1 : 1); render(); return; }
      if (a === 'listreset' && row) { change(row, [], false); render(); return; }
      if (a === 'resetpos') { dock(); say('Panel moved back to the top right.'); return; }
      if (a === 'undo') { doUndo(); return; }
      if (a === 'copy') { copyText(b.getAttribute('data-kind') === 'everything' ? 'everything' : 'formatting'); return; }
      if (a === 'paste') { mode = 'paste'; pasteText = ''; pasteMsg = ''; say(''); render(); refocus('paste'); return; }
      if (a === 'pastecancel') { mode = 'idle'; pasteMsg = ''; render(); refocus('paste-open'); return; }
      if (a === 'pasteapply') {
        var ta = panel.querySelector('textarea[data-f="paste"]'); pasteText = ta ? ta.value : pasteText;
        applyPaste(pasteText); return;
      }
      if (a === 'resettab' || a === 'resetall') {
        if (a === 'resettab' && b.getAttribute('data-t')) ps.tab = b.getAttribute('data-t');
        var tabId = a === 'resettab' ? ps.tab : null, rs;
        if (a === 'resettab' && ps.tab === '_panel') { ps.theme = 'match'; ps.customBg = '#ffffff'; ps.customInk = '#14202e'; ps.uiScale = '1'; persistState(); applyTheme(); say('Panel theme reset.'); render(); return; }
        rs = keysOfTab(tabId);
        var n = dirtyCount(rs);
        if (!n) { say(a === 'resettab' ? 'This tab is already at its defaults.' : 'Everything is already at its defaults.'); return; }
        mode = 'confirm'; confirm = { tabId: tabId, message: 'Reset ' + n + ' setting' + (n === 1 ? '' : 's') + (tabId ? ' on this tab' : ' across every tab') + ' to the defaults? You can still Undo.' };
        say(''); render(); refocus('confirmno'); return;
      }
      if (a === 'confirmno') { mode = 'idle'; confirm = null; render(); refocus('resettab'); return; }
      if (a === 'confirmyes') {
        var rs2 = keysOfTab(confirm.tabId), cnt = bulk(defaultsFor(rs2), confirm.tabId ? 'the tab reset' : 'the full reset');
        mode = 'idle'; confirm = null; say('Reset ' + cnt + ' setting' + (cnt === 1 ? '' : 's') + '.'); render(); refocus('undo'); return;
      }
    });

    panel.addEventListener('input', function (e) {
      var t = e.target, k = t.getAttribute('data-k'), lk = t.getAttribute('data-lk');
      if (t === qEl) { query = t.value; render(); return; }
      if (t.getAttribute('data-f') === 'paste') { pasteText = t.value; return; }
      if (lk) {
        var lrow = rowOf(lk), i = +t.getAttribute('data-i');
        if (t.classList.contains('cp-lname')) editItem(lrow, i, { name: t.value || '' }, true);
        else if (t.classList.contains('cp-lcol')) editItem(lrow, i, { color: t.value }, true);
        return;
      }
      if (!k) return;
      var row = rowOf(k); if (!row) return;
      if (row.type === 'number') {
        if (t.value === '') return;
        change(row, t.value, true); softRender();
      } else if (row.type === 'text' && !t.classList.contains('cp-hex')) {
        change(row, t.value, true);
      } else if (row.type === 'color') {
        if (t.classList.contains('cp-hex')) {
          if (normHex(t.value)) { change(row, t.value, true); var pk = bodyEl.querySelector('input[type=color][data-k="' + k + '"]'); if (pk) pk.value = normHex(t.value); }
        } else { change(row, t.value, true); var hx = bodyEl.querySelector('.cp-hex[data-k="' + k + '"]'); if (hx) hx.value = normHex(t.value); }
      }
    });
    panel.addEventListener('change', function (e) {
      var t = e.target, k = t.getAttribute('data-k'), lk = t.getAttribute('data-lk');
      if (lk && t.classList.contains('cp-lshow')) { editItem(rowOf(lk), +t.getAttribute('data-i'), { hidden: !t.checked }, false); render(); return; }
      if (!k) return;
      var row = rowOf(k); if (!row) return;
      if (row.type === 'number') {
        var ok = change(row, t.value, false);
        t.value = ok ? getVal(row) : getVal(row);
        if (!ok) say('Type a number from ' + row.min + ' to ' + row.max + '.', true);
        softRender();
      } else if (row.type === 'check') { change(row, t.checked, false); render(); }
      else if (row.type === 'select' || row.type === 'font' || row.type === 'field') { change(row, t.value, false); render(); }
      else if (row.type === 'color' && t.classList.contains('cp-hex')) {
        if (row.auto && t.value.trim() === '') { change(row, '', false); render(); return; }
        if (!normHex(t.value)) { say('Colors are six hex digits like #3cc4d1.', true); t.value = getVal(row) || ''; } else { change(row, t.value, false); }
      }
    });

    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      var tb = e.target.closest ? e.target.closest('.cp-tab') : null;
      if (tb && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End')) {
        e.preventDefault();
        var ids = allTabs.map(function (t) { return t.id; }), i = ids.indexOf(tb.getAttribute('data-t'));
        i = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
        ps.tab = ids[i]; query = ''; qEl.value = ''; persistState(); render(); refocus('tab-' + ids[i]); return;
      }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'number') { e.preventDefault(); e.target.blur(); }
    });
    var onDocKey = function (e) { if (e.key === 'Escape' && !panel.hidden && !panel.contains(doc.activeElement)) close(); };
    doc.addEventListener('keydown', onDocKey);

    /* --- open and close --- */
    function open() {
      if (!panel.hidden) return;
      panel.hidden = false; gear.hidden = true; gear.setAttribute('aria-expanded', 'true');
      if (!openSnap) openSnap = JSON.parse(JSON.stringify(curSettings()));   /* Revert goes back to the first open of this visit */
      applyTheme(); render(); settle();
      try { panel.focus({ preventScroll: true }); } catch (e) { panel.focus(); }
      if (opts.onToggle) opts.onToggle(true);
    }
    function close() {
      if (panel.hidden) return;
      panel.hidden = true; gear.hidden = false; gear.setAttribute('aria-expanded', 'false');
      mode = 'idle'; confirm = null; query = ''; qEl.value = ''; pasteMsg = '';
      reserve(0);
      gear.focus();
      if (opts.onToggle) opts.onToggle(false);
    }
    gear.addEventListener('click', open);
    applyTheme();

    return {
      open: open, close: close, toggle: function () { if (panel.hidden) open(); else close(); },
      isOpen: function () { return !panel.hidden; },
      render: function () { if (!panel.hidden) { render(); } },
      undo: doUndo, gear: gear, panel: panel, state: ps,
      get lastCopied() { return lastCopied; },
      applyAppearance: function (bg, ink) { var was = chart.bg; chart = { bg: bg || chart.bg, ink: ink || chart.ink }; applyTheme(); if (!panel.hidden && isDarkBg(was) !== isDarkBg(chart.bg)) render(); },
      /* One call per draw from an extension that wants mark counts in the report: trace({ marks }). */
      trace: function (o) { var t = { time: new Date().toISOString(), w: host.clientWidth, h: host.clientHeight }; Object.keys(o || {}).forEach(function (k) { t[k] = o[k]; }); traces.push(t); if (traces.length > 6) traces.shift(); },
      diagnostics: report,
      isPinned: function () { return pinned; },
      reserveRight: function () { return reservedPx; },
      destroy: function () {
        reserve(0); doc.removeEventListener('keydown', onDocKey); if (ro) ro.disconnect(); else win.removeEventListener('resize', onResize);
        var ri = REPORTERS.indexOf(report); if (ri >= 0) REPORTERS.splice(ri, 1); gear.remove(); panel.remove();
      }
    };
  }

  return {
    version: VERSION, create: create, createStore: createStore, standard: standard, prepare: prepare, diagButton: diagButton,
    coerce: coerce, serialize: serialize, defaultsOf: defaultsOf, isVisible: isVisible, visibleRows: visibleRows, shownRows: shownRows, searchRows: searchRows,
    parsePaste: parsePaste, copyBlock: copyBlock, offReason: offReason, fillTitle: fillTitle, isData: isData, isTextSize: isTextSize,
    mergeList: mergeList, formatNumber: formatNumber, paletteColors: paletteColors, fontStack: fontStack,
    noteError: noteError, errors: function () { return ERRORS.slice(); },
    FONTS: FONTS, PALETTES: PALETTES, color: { normHex: normHex, contrast: contrast, mix: mix, ensureContrast: ensureContrast, legalBg: legalBg, tokens: tokens, themeTokens: themeTokens, bestInk: bestInk, lum: lum, isDarkBg: isDarkBg }
  };
});
