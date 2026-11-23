/* Radar - entry point. Binds the Tableau worksheet to the renderer and the shared settings panel: reads the four
 * encodings declared in radar.trex, pulls summary data through the paged reader (one reader at a time), keeps settings
 * in tableau.extensions.settings (through ctab-panel's store), and pushes selection and hover back to Tableau.
 *
 * It uses only calls the C-Tableau Viz pages stand-in also provides; every call that stand-in lacks
 * (hoverTupleAsync) is guarded.
 */
(function (global) {
  'use strict';
  var RD = global.RD, CP = global.CTabPanel, M = RD.math, SET = RD.settings;
  var PREFIX = 'radar.';
  var DATA_KEYS = { fieldAxis: 1, fieldSeries: 1, fieldValue: 1, fieldLabel: 1, sortAxes: 1, sortSeries: 1, axesList: 1 };

  var state = { worksheet: null, renderer: null, panel: null, store: null, raw: null, model: { axes: [], series: [] }, resizeTimer: null, auto: {} };

  function log() { if (global.console && console.warn) console.warn.apply(console, ['[RD]'].concat([].slice.call(arguments))); }

  /* -------------------------------------------------------------------- data */

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
  function fieldName(f) { return f ? (f.name || f.fieldName || f.fieldId || null) : null; }

  function readSummary(ws) {
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
  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /* Raw data plus the shelf mapping. The pivot is redone from this whenever a field or sort setting changes. */
  function readData(ws) {
    return Promise.all([readSummary(ws), readEncodings(ws)]).then(function (res) {
      var data = res[0], enc = res[1], first = data.rows[0] || {};
      var numeric = data.columns.filter(function (c) { return data.rows.some(function (r) { return isNum(r[c]); }); });
      var auto = { fieldAxis: fieldName(enc.axis), fieldSeries: fieldName(enc.series), fieldValue: fieldName(enc.value), fieldLabel: fieldName(enc.label) };
      var strs = data.columns.filter(function (c) { return typeof first[c] === 'string'; });
      if (!auto.fieldAxis || data.columns.indexOf(auto.fieldAxis) < 0) auto.fieldAxis = strs[0] || data.columns[0] || null;
      if (!auto.fieldValue || data.columns.indexOf(auto.fieldValue) < 0) auto.fieldValue = numeric.filter(function (c) { return c !== auto.fieldAxis; })[0] || null;
      if (auto.fieldSeries && data.columns.indexOf(auto.fieldSeries) < 0) auto.fieldSeries = null;
      if (!enc.series && !enc.axis && !enc.value) auto.fieldSeries = strs.filter(function (c) { return c !== auto.fieldAxis && c !== auto.fieldLabel; })[0] || null;
      if (auto.fieldLabel && data.columns.indexOf(auto.fieldLabel) < 0) auto.fieldLabel = null;
      var bg = '#ffffff';
      try { if (ws.backgroundColor) bg = ws.backgroundColor; } catch (e) { /* not fatal */ }
      return { raw: data, auto: auto, numeric: numeric, bg: bg, hasRows: data.rows.length > 0 };
    });
  }

  function pick(settingKey, auto, columns) { var v = state.store.get()[settingKey]; return v && columns.indexOf(v) >= 0 ? v : auto; }

  function buildModel() {
    var d = state.raw, s = state.store.get();
    if (!d) return { axes: [], series: [], emptyMessage: 'Loading.' };
    var cols = d.raw.columns;
    var fa = pick('fieldAxis', d.auto.fieldAxis, cols), fs = pick('fieldSeries', d.auto.fieldSeries, cols), fv = pick('fieldValue', d.auto.fieldValue, cols), fl = pick('fieldLabel', d.auto.fieldLabel, cols);
    var rows = [];
    d.raw.rows.forEach(function (r, i) {
      var raw = r[fv]; if (raw === null || raw === undefined || raw === '') return;
      var v = Number(raw); if (!isFinite(v)) return;
      var a = r[fa]; if (a === null || a === undefined || a === '') a = '(blank)';
      rows.push({ axis: String(r.__fmt[fa] || a), series: fs ? String(r.__fmt[fs] || r[fs] || '(blank)') : null, value: v, label: fl ? (r.__fmt[fl] || r[fl]) : '', tuple: i + 1 });
    });
    var axisOrder = (s.axesList || []).map(function (x) { return x.key; });
    var m = M.buildModel(rows, { sortAxes: s.sortAxes, sortSeries: s.sortSeries, axisOrder: axisOrder, singleName: fv || 'Value' });
    m.worksheetBg = d.bg; m.axisName = fa || 'Axis'; m.seriesName = fs; m.valueName = fv || 'Value'; m.hasSeries = !!fs;
    m.emptyMessage = d.hasRows ? 'No numeric values to plot. Put a measure on Value.' : 'Drop a dimension on Axis and a measure on Value.';
    var h = 0, str = m.axes.map(function (a) { return a.key; }).join('|') + '#' + m.series.map(function (x) { return x.key + ':' + x.values.join(','); }).join('|');
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    m.key = String(h);
    return m;
  }

  /* ------------------------------------------------------------ Tableau out */

  function pushSelection(kind, key) {
    var ws = state.worksheet, s = state.store.get();
    if (!ws || !s.selectOn) return;
    var swallow = function (p) { if (p && p.catch) p.catch(function (e) { log('selection rejected', e); }); };
    try {
      if (kind === 'clear' || !key) { if (typeof ws.clearSelectedMarksAsync === 'function') swallow(ws.clearSelectedMarksAsync()); return; }
      var field = state.model.seriesName;
      if (kind === 'series' && field && typeof ws.selectMarksByValueAsync === 'function') {
        swallow(ws.selectMarksByValueAsync([{ fieldName: field, value: [key] }], 'select-replace'));
      }
    } catch (e) { log('selection threw', e); }
  }

  var lastHover = null;
  function pushHover(key) {
    var ws = state.worksheet, s = state.store.get();
    if (!ws || !s.hoverPush || typeof ws.hoverTupleAsync !== 'function') return;
    var tuple = 0;
    if (key) state.model.series.forEach(function (x) { if (x.key === key && x.tupleList.length) tuple = x.tupleList[0]; });
    if (tuple === lastHover) return;
    lastHover = tuple;
    try { var p = ws.hoverTupleAsync(tuple); if (p && p.catch) p.catch(function () { /* hover is cosmetic */ }); } catch (e) { /* cosmetic */ }
  }

  /* ----------------------------------------------------------------- render */

  function redraw() {
    if (!state.renderer) return;
    state.renderer.draw(state.model, state.store.get(), { onSelect: pushSelection, onHover: pushHover });
    if (state.panel && state.renderer.colors) state.panel.applyAppearance(state.renderer.colors.bg, state.renderer.colors.ink);
    if (state.panel) state.panel.render();
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
    return readData(state.worksheet).then(function (d) { state.raw = d; state.auto = d.auto; state.model = buildModel(); redraw(); }, function (e) {
      log('data refresh failed', e);
      state.raw = null; state.model = { axes: [], series: [], emptyMessage: 'Could not read data from this worksheet.' };
      redraw();
    }).then(done, done);
  }

  function info() {
    var d = state.raw, s = state.store.get(), m = state.model;
    return { columns: d ? d.raw.columns : [], numericColumns: d ? d.numeric : [], auto: d ? d.auto : {},
      lists: { axes: RD.axisItems(m), categories: RD.seriesItems(m, s) } };
  }

  function mount(ws) {
    state.worksheet = ws;
    state.store = CP.createStore({ rows: SET.prepared.rows, settings: global.tableau.extensions.settings, prefix: PREFIX, onChange: onChange, log: log });
    state.store.load();
    var root = document.getElementById('rd-root'), chart = document.getElementById('rd-chart');
    state.renderer = new RD.Renderer(chart);
    state.panel = CP.create(root, { title: 'Radar settings', schema: SET.schema, store: state.store, info: info, state: state.store.panelState, prefix: PREFIX });
    /* Redraw only when the chart box really changed size. ResizeObserver also fires once on observe(); a redraw then would
     * replace the SVG under a hover that already started and cut its fade short. */
    var lastW = -1, lastH = -1;
    function sizeChanged() {
      var r = chart.getBoundingClientRect(), w = Math.round(r.width), h = Math.round(r.height);
      if (w === lastW && h === lastH) return false;
      lastW = w; lastH = h; return true;
    }
    function onSize() {
      if (state.resizeTimer) clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(function () { state.resizeTimer = null; if (sizeChanged()) redraw(); }, 60);
    }
    sizeChanged();
    global.addEventListener('resize', onSize);
    if (typeof global.ResizeObserver === 'function') new global.ResizeObserver(onSize).observe(chart);
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
      var chart = document.getElementById('rd-chart');
      if (chart) { chart.innerHTML = ''; var d = document.createElement('div'); d.className = 'rd-empty'; d.textContent = 'This extension could not start. Check the browser console for details.'; chart.appendChild(d); }
    });
  }

  RD.app = { boot: boot, mount: mount, refreshData: refreshData, redraw: redraw, state: state };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
