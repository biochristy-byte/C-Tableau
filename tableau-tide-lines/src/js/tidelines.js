/* Tide Lines - entry point. Binds the Tableau worksheet to the renderer and the
 * shared settings panel (ctab-panel): reads the four encodings declared in
 * tide-lines.trex, pulls summary data through the paged reader (one reader at a
 * time), keeps settings in tableau.extensions.settings through the panel's store,
 * and pushes selection and hover back to Tableau.
 *
 * It uses only calls the C-Tableau Viz pages stand-in also provides, and every
 * call that stand-in lacks (selectTuplesAsync, hoverTupleAsync) is guarded.
 */
(function (global) {
  'use strict';
  var TL = global.TL, CP = global.CTabPanel, SET = TL.settings;
  var PREFIX = 'tidelines.';
  var DATA_KEYS = { fieldCategory: 1, fieldValue: 1, fieldColor: 1, fieldLabel: 1 };

  var state = { worksheet: null, renderer: null, panel: null, store: null, raw: null, auto: {},
    model: { rows: [] }, resizeTimer: null };

  function log () { if (global.console && console.warn) console.warn.apply(console, ['[TL]'].concat([].slice.call(arguments))); }

  /* ---------------------------------------------------------------- settings */

  /* Workbooks saved before the shared panel used other keys for a few settings (see settings.js legacy()). */
  function applyLegacy (store) {
    var st = global.tableau.extensions.settings, all = {};
    try { all = st.getAll() || {}; } catch (e) { all = {}; }
    function get (k) {
      var v;
      try { v = st.get(PREFIX + k); } catch (e) { v = undefined; }
      if (v === undefined || v === null) {   /* a host that stores under a different prefix: match on the last segment */
        Object.keys(all).some(function (ak) { if (ak.split('.').pop() === k) { v = all[ak]; return true; } return false; });
      }
      return v;
    }
    var old = SET.legacy(get);
    if (Object.keys(old).length) store.setMany(old);
  }

  /* -------------------------------------------------------------------- data */

  function readEncodings (ws) {
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
  function fieldName (f) { return f ? (f.name || f.fieldName || f.fieldId || null) : null; }

  function readSummary (ws) {
    return ws.getSummaryDataReaderAsync(undefined, { ignoreSelection: true }).then(function (reader) {
      var pages = [], chain = Promise.resolve();
      for (var i = 0; i < reader.pageCount; i++) {
        (function (p) { chain = chain.then(function () { return reader.getPageAsync(p).then(function (pg) { pages.push(pg); }); }); })(i);
      }
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
        var done = { rows: rows, columns: names };
        return reader.releaseAsync().then(function () { return done; }, function () { return done; });
      });
    });
  }

  function isNum (v) { return typeof v === 'number' && isFinite(v); }

  /* Raw rows plus the shelf mapping. The model is rebuilt from this when a Fields-tab setting changes. */
  function readData (ws) {
    return Promise.all([readSummary(ws), readEncodings(ws)]).then(function (res) {
      var data = res[0], enc = res[1];
      var cat = fieldName(enc.category), val = fieldName(enc.value), col = fieldName(enc.color), lab = fieldName(enc.label);
      var firstRow = data.rows[0];
      if (!cat || data.columns.indexOf(cat) < 0) cat = data.columns.filter(function (c) { return firstRow && typeof firstRow[c] === 'string'; })[0] || data.columns[0];
      if (!val || data.columns.indexOf(val) < 0) val = data.columns.filter(function (c) { return firstRow && isNum(firstRow[c]) && c !== cat; })[0] || data.columns[1];
      if (col && data.columns.indexOf(col) < 0) col = null;
      if (lab && data.columns.indexOf(lab) < 0) lab = null;
      var numeric = data.columns.filter(function (c) { return data.rows.some(function (r) { return isNum(r[c]); }); });
      var bg = '#ffffff';
      try { if (ws.backgroundColor) bg = ws.backgroundColor; } catch (e) { /* not fatal */ }
      return { raw: data, auto: { fieldCategory: cat || null, fieldValue: val || null, fieldColor: col, fieldLabel: lab }, numeric: numeric, bg: bg, hasRows: data.rows.length > 0 };
    });
  }

  function pick (key, auto, columns) { var v = state.store.get()[key]; return v && columns.indexOf(v) >= 0 ? v : auto; }

  function buildModel () {
    var d = state.raw;
    if (!d) return { rows: [], emptyMessage: 'Loading.' };
    var cols = d.raw.columns;
    var cat = pick('fieldCategory', d.auto.fieldCategory, cols), val = pick('fieldValue', d.auto.fieldValue, cols);
    var col = pick('fieldColor', d.auto.fieldColor, cols), lab = pick('fieldLabel', d.auto.fieldLabel, cols);
    var rows = [];
    d.raw.rows.forEach(function (r, i) {
      var raw = r[val];
      if (raw === null || raw === undefined || raw === '') return;
      var v = Number(raw);
      if (!isFinite(v)) return;
      rows.push({
        cat: r[cat] === null || r[cat] === undefined || r[cat] === '' ? '(blank)' : String(r.__fmt[cat] || r[cat]),
        value: v,
        colorKey: col ? (r.__fmt[col] || r[col]) : null,
        labelField: lab ? (r.__fmt[lab] || r[lab]) : null,
        tupleId: i + 1,
        rawCat: r[cat]
      });
    });
    return { rows: rows, catName: cat || 'Category', valueName: val || 'Value', worksheetBg: d.bg, hasColor: !!col, hasLabel: !!lab,
      emptyMessage: d.hasRows ? 'No numeric values to plot. Put one observation per row on the Value shelf.' : 'Drop a dimension on Category and a measure on Value.' };
  }

  /* ------------------------------------------------------------ Tableau out */

  function pushSelection (ridges) {
    var ws = state.worksheet;
    if (!ws || !state.store.get().selectOn) return;
    var swallow = function (p) { if (p && p.catch) p.catch(function (e) { log('selection rejected', e); }); };
    try {
      if (!ridges.length) { if (typeof ws.clearSelectedMarksAsync === 'function') swallow(ws.clearSelectedMarksAsync()); return; }
      if (typeof ws.selectMarksByValueAsync === 'function') {
        swallow(ws.selectMarksByValueAsync([{ fieldName: state.model.catName, value: ridges.map(function (r) { return r.key; }) }], 'select-replace'));
      } else if (typeof ws.selectTuplesAsync === 'function') {
        var ids = []; ridges.forEach(function (r) { r.tuples.forEach(function (t) { ids.push(t); }); });
        swallow(ws.selectTuplesAsync(ids, 'select-options-simple'));
      }
    } catch (e) { log('selection threw', e); }
  }

  var lastHover = null;
  function pushHover (ridge) {
    var ws = state.worksheet, s = state.store.get();
    if (!ws || !s.hoverPush || !s.hoverOn || typeof ws.hoverTupleAsync !== 'function') return;
    var id = ridge && ridge.tuples.length ? ridge.tuples[0] : 0;
    if (id === lastHover) return;
    lastHover = id;
    try { var p = ws.hoverTupleAsync(id); if (p && p.catch) p.catch(function () { /* hover is cosmetic */ }); } catch (e) { /* cosmetic */ }
  }

  /* ----------------------------------------------------------------- render */

  function redraw () {
    if (!state.renderer) return;
    state.renderer.draw(state.model, state.store.get(), { onSelect: pushSelection, onHover: pushHover });
    if (state.panel) { state.panel.applyAppearance(state.renderer.chartBg, state.renderer.ink); state.panel.render(); }
    diagOnEmpty(document.getElementById('tl-chart'));
    if (state.panel) { try { state.panel.trace({ marks: state.renderer.info && state.renderer.info.n ? state.renderer.info.n : 0 }); } catch (e) { /* diagnostics only */ } }
  }
  function onChange (keys) {
    if (keys.some(function (k) { return DATA_KEYS[k]; })) state.model = buildModel();
    redraw();
  }

  /* Reads are serialized: one open reader per worksheet, and a slow earlier read must never
   * overwrite a newer one. Requests that arrive mid-read collapse into one follow-up. */
  var refreshing = false, queued = false;
  function refreshData () {
    if (!state.worksheet) return Promise.resolve();
    if (refreshing) { queued = true; return Promise.resolve(); }
    refreshing = true;
    var done = function () { refreshing = false; if (queued) { queued = false; return refreshData(); } return undefined; };
    return readData(state.worksheet).then(function (d) { state.raw = d; state.auto = d.auto; state.model = buildModel(); redraw(); }, function (e) {
      log('data refresh failed', e);
      state.raw = null;
      state.model = { rows: [], emptyMessage: 'Could not read data from this worksheet.' };
      redraw();
    }).then(done, done);
  }

  function info () {
    var d = state.raw;
    return { columns: d ? d.raw.columns : [], numericColumns: d ? d.numeric : [], auto: d ? d.auto : {},
      lists: { categories: state.renderer ? state.renderer.items : [] }, autoBw: state.renderer ? state.renderer.autoBw : 0,
      data: diagData(), tokens: diagTokens() };
  }

  /* What the diagnostics report and the title placeholders see. Cheap, and never throws. */
  function diagData () {
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
  /* A ridgeline shows distributions, so a sum means nothing: only the category with the highest mean is offered. */
  function diagTokens () {
    try {
      var rows = state.model && state.model.rows; if (!rows || !rows.length) return {};
      var sum = {}, cnt = {}, top = '', topV = -Infinity;
      rows.forEach(function (r) { sum[r.cat] = (sum[r.cat] || 0) + r.value; cnt[r.cat] = (cnt[r.cat] || 0) + 1; });
      Object.keys(sum).forEach(function (k) { var m = sum[k] / cnt[k]; if (m > topV) { topV = m; top = k; } });
      return top ? { top: top } : {};
    } catch (e) { return {}; }
  }
  /* A Copy diagnostics button on the blank screen; the message box is rebuilt on every draw, so one at a time. */
  function diagOnEmpty (chart) {
    try {
      var e = chart && chart.querySelector('.tl-empty');
      if (e && !e.querySelector('.cp-diagwrap')) CP.diagButton(e, { panel: state.panel });
    } catch (x) { log('diag button failed', x); }
  }
  function scheduleRedraw () {
    if (state.resizeTimer) clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(function () { state.resizeTimer = null; redraw(); }, 60);
  }

  function mount (ws) {
    state.worksheet = ws;
    state.store = CP.createStore({ rows: SET.prepared.rows, settings: global.tableau.extensions.settings, prefix: PREFIX, onChange: onChange, log: log });
    state.store.load();
    applyLegacy(state.store);
    var root = document.getElementById('tl-root'), chart = document.getElementById('tl-chart');
    state.renderer = new TL.Renderer(chart);
    state.panel = CP.create(root, { title: 'Tide Lines settings', schema: SET.schema, store: state.store, info: info, state: state.store.panelState, prefix: PREFIX, version: '1.0.0',
      /* Pinned to the side, the panel pulls the chart in from the right; a window resize never fires for that. */
      onLayout: function () { if (state.model) scheduleRedraw(); } });
    state.panel.applyAppearance('#ffffff', '#0b1f2e');
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

  function boot () {
    if (!global.tableau || !global.tableau.extensions) { log('Tableau Extensions API not present'); return; }
    global.tableau.extensions.initializeAsync().then(function () {
      var wc = global.tableau.extensions.worksheetContent;
      if (!wc || !wc.worksheet) { log('no worksheetContent: load this as a viz extension, not a dashboard extension'); return; }
      return mount(wc.worksheet);
    }).catch(function (e) {
      log('initializeAsync failed', e);
      var chart = document.getElementById('tl-chart');
      if (chart) { chart.innerHTML = ''; var d = document.createElement('div'); d.className = 'tl-empty'; d.textContent = 'This extension could not start. Check the browser console for details.'; chart.appendChild(d); try { CP.diagButton(d, { panel: state.panel }); } catch (x) { /* no panel yet */ } }
    });
  }

  TL.app = { boot: boot, mount: mount, refreshData: refreshData, redraw: redraw, state: state };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
