/* Panel Chart - entry point. Binds the Tableau worksheet to the renderer and the shared settings panel (ctab-panel):
 * reads the four encodings declared in panel-chart.trex, pulls summary data through the paged reader (one reader at a
 * time, always released), keeps settings in tableau.extensions.settings through the panel's store, and pushes
 * selection and hover back to Tableau. Calls a host may lack (hoverTupleAsync, selectMarksByValueAsync) are guarded.
 */
(function (global) {
  'use strict';
  var PC = global.PC, CP = global.CTabPanel, SET = PC.settings;
  var PREFIX = 'panelchart.';
  var DATA_KEYS = { fieldCategory: 1, fieldValue: 1, fieldColor: 1, fieldX: 1 };
  var state = { worksheet: null, renderer: null, panel: null, store: null, raw: null, model: { rows: [] }, resizeTimer: null };

  function log() { if (global.console && console.warn) console.warn.apply(console, ['[PC]'].concat([].slice.call(arguments))); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function fieldName(f) { return f ? (f.name || f.fieldName || f.fieldId || null) : null; }

  function readEncodings(ws) {
    return ws.getVisualSpecificationAsync().then(function (spec) {
      var map = {};
      if (!spec || !spec.marksSpecifications) return map;
      var idx = spec.activeMarksSpecificationIndex;
      if (idx === undefined || idx === null || idx < 0) return map;
      var card = spec.marksSpecifications[idx];
      if (!card || !card.encodings) return map;
      card.encodings.forEach(function (enc) { if (!map[enc.id]) map[enc.id] = enc.field; });
      return map;
    });
  }

  function readSummary(ws) {
    return ws.getSummaryDataReaderAsync(undefined, { ignoreSelection: true }).then(function (reader) {
      var pages = [], chain = Promise.resolve();
      for (var i = 0; i < reader.pageCount; i++) {
        (function (p) { chain = chain.then(function () { return reader.getPageAsync(p).then(function (pg) { pages.push(pg); }); }); })(i);
      }
      var release = function () { return reader.releaseAsync().catch(function () { /* already released */ }); };
      return chain.then(function () {
        var names = pages.length ? pages[0].columns.map(function (c) { return c.fieldName; }) : [], rows = [];
        pages.forEach(function (pg) {
          pg.data.forEach(function (r) {
            var o = {}, fm = {};
            for (var c = 0; c < names.length; c++) {
              o[names[c]] = r[c] ? (r[c].value !== undefined ? r[c].value : r[c].formattedValue) : null;
              fm[names[c]] = r[c] ? r[c].formattedValue : '';
            }
            o.__fmt = fm; rows.push(o);
          });
        });
        return release().then(function () { return { rows: rows, columns: names }; });
      }, function (e) { return release().then(function () { throw e; }); });
    });
  }

  function readData(ws) {
    return Promise.all([readSummary(ws), readEncodings(ws)]).then(function (res) {
      var data = res[0], enc = res[1], first = data.rows[0];
      var cat = fieldName(enc.category), val = fieldName(enc.value), col = fieldName(enc.color), xv = fieldName(enc.xvalue);
      if (!cat || data.columns.indexOf(cat) < 0) cat = data.columns.filter(function (c) { return first && typeof first[c] === 'string'; })[0] || data.columns[0];
      if (!val || data.columns.indexOf(val) < 0) val = data.columns.filter(function (c) { return first && isNum(first[c]) && c !== cat; })[0] || data.columns[1];
      if (col && data.columns.indexOf(col) < 0) col = null;
      if (xv && data.columns.indexOf(xv) < 0) xv = null;
      var numeric = data.columns.filter(function (c) { return data.rows.some(function (r) { return isNum(r[c]); }); });
      var bg = '#ffffff';
      try { if (ws.backgroundColor) bg = ws.backgroundColor; } catch (e) { /* not fatal */ }
      return { raw: data, auto: { fieldCategory: cat || null, fieldValue: val || null, fieldColor: col, fieldX: xv }, numeric: numeric, bg: bg, hasRows: data.rows.length > 0 };
    });
  }

  function pick(key, auto, columns) { var v = state.store.get()[key]; return v && columns.indexOf(v) >= 0 ? v : auto; }

  function buildModel() {
    var d = state.raw;
    if (!d) return { rows: [], emptyMessage: 'Loading.' };
    var cols = d.raw.columns;
    var cat = pick('fieldCategory', d.auto.fieldCategory, cols), val = pick('fieldValue', d.auto.fieldValue, cols);
    var col = pick('fieldColor', d.auto.fieldColor, cols), xv = pick('fieldX', d.auto.fieldX, cols);
    var rows = [];
    d.raw.rows.forEach(function (r, i) {
      var raw = r[val], v = raw === null || raw === undefined || raw === '' ? null : Number(raw);
      var x = xv ? Number(r[xv]) : null;
      rows.push({
        cat: r[cat] === null || r[cat] === undefined || r[cat] === '' ? '(blank)' : String(r.__fmt[cat] || r[cat]),
        ser: col ? String(r.__fmt[col] || r[col] || '(blank)') : (val || 'Value'),
        value: isFinite(v) ? v : null, x: isFinite(x) ? x : null, tuple: i + 1, rawCat: r[cat], rawSer: col ? r[col] : null
      });
    });
    return { rows: rows, catName: cat || 'Category', valueName: val || 'Value', serName: col || '', xName: xv || '', hasSeries: !!col, hasX: !!xv, worksheetBg: d.bg,
      emptyMessage: d.hasRows ? 'No numeric values to plot. Put a measure on Value.' : 'Drop a dimension on Category and a measure on Value.' };
  }

  function pushSelection(sel) {
    var ws = state.worksheet, m = state.model;
    if (!ws || !state.store.get().selectOn) return;
    var swallow = function (p) { if (p && p.catch) p.catch(function (e) { log('selection rejected', e); }); };
    try {
      if (!sel.length) { if (typeof ws.clearSelectedMarksAsync === 'function') swallow(ws.clearSelectedMarksAsync()); return; }
      var crit = [{ fieldName: m.catName, value: sel.map(function (x) { return rawOf('cat', x.cat); }) }];
      if (sel[0].ser && m.hasSeries) crit.push({ fieldName: m.serName, value: [rawOf('ser', sel[0].ser)] });
      if (typeof ws.selectMarksByValueAsync === 'function') swallow(ws.selectMarksByValueAsync(crit, 'select-replace'));
    } catch (e) { log('selection threw', e); }
  }
  function rawOf(kind, label) {
    var rows = state.model.rows;
    for (var i = 0; i < rows.length; i++) if ((kind === 'cat' ? rows[i].cat : rows[i].ser) === label) return kind === 'cat' ? rows[i].rawCat : rows[i].rawSer;
    return label;
  }

  var lastHover = null;
  function pushHover(mark) {
    var ws = state.worksheet, s = state.store.get();
    if (!ws || !s.hoverPush || !s.hoverOn || typeof ws.hoverTupleAsync !== 'function') return;
    var id = mark && mark.tuples && mark.tuples.length ? mark.tuples[0] : 0;
    if (id === lastHover) return;
    lastHover = id;
    try { var p = ws.hoverTupleAsync(id); if (p && p.catch) p.catch(function () { /* cosmetic */ }); } catch (e) { /* cosmetic */ }
  }

  function redraw() {
    if (!state.renderer) return;
    state.renderer.draw(state.model, state.store.get(), { onSelect: pushSelection, onHover: pushHover });
    if (state.panel) { state.panel.applyAppearance(state.renderer.chartBg, state.renderer.ink); state.panel.render(); }
    diagOnEmpty();
    if (state.panel) { try { state.panel.trace({ marks: state.renderer.L && state.renderer.L.marks ? state.renderer.L.marks.length : 0 }); } catch (e) { /* diagnostics only */ } }
  }
  function onChange(keys) {
    if (keys.some(function (k) { return DATA_KEYS[k]; })) state.model = buildModel();
    redraw();
  }

  var refreshing = false, queued = false;
  function refreshData() {
    if (!state.worksheet) return Promise.resolve();
    if (refreshing) { queued = true; return Promise.resolve(); }
    refreshing = true;
    var done = function () { refreshing = false; if (queued) { queued = false; return refreshData(); } return undefined; };
    return readData(state.worksheet).then(function (d) { state.raw = d; state.model = buildModel(); redraw(); }, function (e) {
      log('data refresh failed', e);
      state.raw = null; state.model = { rows: [], emptyMessage: 'Could not read data from this worksheet.' }; redraw();
    }).then(done, done);
  }

  function info() {
    var d = state.raw, r = state.renderer;
    return { columns: d ? d.raw.columns : [], numericColumns: d ? d.numeric : [], auto: d ? d.auto : {},
      lists: { categories: r ? r.items : [], cats: r ? r.catItems : [] }, data: diagData(), tokens: diagTokens() };
  }

  /* What the diagnostics report and the title placeholders see. Cheap, and never throws. */
  function diagData() {
    try {
      var d = state.raw && state.raw.raw;
      if (!d) return { rows: 0, fields: [], sample: [] };
      var rows = d.rows, cols = d.columns;
      var fields = cols.map(function (c) {
        var t = 'text';
        for (var i = 0; i < rows.length; i++) { var v = rows[i][c]; if (v === null || v === undefined) continue; t = typeof v === 'number' ? 'number' : (v instanceof Date ? 'date' : typeof v === 'boolean' ? 'boolean' : 'text'); break; }
        return { name: c, type: t };
      });
      var sample = rows.slice(0, 4).map(function (r) {
        var o = {};
        cols.forEach(function (c) { o[c] = { value: r[c] === undefined ? null : r[c], formatted: r.__fmt ? r.__fmt[c] : '' }; });
        return o;
      });
      return { rows: rows.length, fields: fields, sample: sample };
    } catch (e) { return { rows: 0, fields: [], sample: [] }; }
  }
  function diagTokens() {
    try {
      var rows = state.model && state.model.rows; if (!rows || !rows.length) return {};
      var by = {}, total = 0, top = '', topV = -Infinity;
      rows.forEach(function (r) {
        if (r.value === null) return;
        total += r.value; by[r.cat] = (by[r.cat] || 0) + r.value;
        if (by[r.cat] > topV) { topV = by[r.cat]; top = r.cat; }
      });
      return topV === -Infinity ? {} : { top: top, total: total.toLocaleString('en-US', { maximumFractionDigits: 1 }) };
    } catch (e) { return {}; }
  }
  /* A Copy diagnostics button on the blank screen; the box is rewritten on every draw, so one at a time. */
  function diagOnEmpty() {
    try {
      var e = state.renderer && state.renderer.empty;
      if (e && !e.hidden && !e.querySelector('.cp-diagwrap')) CP.diagButton(e, { panel: state.panel });
    } catch (x) { log('diag button failed', x); }
  }
  function scheduleRedraw() {
    if (state.resizeTimer) clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(function () { state.resizeTimer = null; redraw(); }, 60);
  }

  function mount(ws) {
    state.worksheet = ws;
    state.store = CP.createStore({ rows: SET.prepared.rows, settings: global.tableau.extensions.settings, prefix: PREFIX, onChange: onChange, log: log });
    state.store.load();
    var root = document.getElementById('pc-root'), chart = document.getElementById('pc-chart');
    state.renderer = new PC.Renderer(chart);
    state.panel = CP.create(root, { title: 'Panel Chart settings', schema: SET.schema, store: state.store, info: info, state: state.store.panelState, prefix: PREFIX, version: '1.0.0',
      /* Pinned to the side, the panel pulls the chart in from the right; a window resize never fires for that. */
      onLayout: function () { if (state.model) scheduleRedraw(); } });
    state.panel.applyAppearance('#ffffff', '#14202e');
    global.addEventListener('resize', scheduleRedraw);
    if (ws.addEventListener) {
      var T = global.tableau.TableauEventType || {};
      [T.SummaryDataChanged, T.FilterChanged, T.ParameterChanged, T.WorksheetFormattingChanged].forEach(function (evt) {
        if (!evt) return;
        try { ws.addEventListener(evt, refreshData); } catch (e) { log('listener failed for', evt, e); }
      });
    }
    return refreshData();
  }

  function boot() {
    if (!global.tableau || !global.tableau.extensions) { log('Tableau Extensions API not present'); return; }
    global.tableau.extensions.initializeAsync().then(function () {
      var wc = global.tableau.extensions.worksheetContent;
      if (!wc || !wc.worksheet) { log('no worksheetContent: load this as a viz extension, not a dashboard extension'); return; }
      return mount(wc.worksheet);
    }).catch(function (e) {
      log('initializeAsync failed', e);
      var chart = document.getElementById('pc-chart');
      if (chart) { chart.innerHTML = ''; var d = document.createElement('div'); d.className = 'pc-empty'; d.textContent = 'This extension could not start. Check the browser console for details.'; chart.appendChild(d); try { CP.diagButton(d, { panel: state.panel }); } catch (x) { /* no panel yet */ } }
    });
  }

  PC.app = { boot: boot, mount: mount, refreshData: refreshData, redraw: redraw, state: state };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
