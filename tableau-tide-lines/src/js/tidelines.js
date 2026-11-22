/* Tide Lines - entry point. Binds the Tableau worksheet to the renderer and the
 * settings panel: reads the four encodings declared in tidelines.trex, pulls
 * summary data through the paged reader (one reader at a time), keeps settings in
 * tableau.extensions.settings, and pushes selection and hover back to Tableau.
 *
 * It uses only calls the C-Tableau Viz pages stand-in also provides, and every
 * call that stand-in lacks (selectTuplesAsync, hoverTupleAsync) is guarded.
 */
(function (global) {
  'use strict';
  var TL = global.TL, schema = TL.schema;
  var PREFIX = 'tidelines.';

  var state = { worksheet: null, renderer: null, panel: null, settings: schema.resolve({}),
    model: { rows: [] }, saveTimer: null, resizeTimer: null };

  function log () { if (global.console && console.warn) console.warn.apply(console, ['[TL]'].concat([].slice.call(arguments))); }

  /* ---------------------------------------------------------------- settings */

  function readStored () {
    var stored = {}, st = global.tableau.extensions.settings, all = {};
    try { all = st.getAll() || {}; } catch (e) { log('could not read settings', e); }
    Object.keys(schema.DEFAULTS).forEach(function (k) {
      var v;
      try { v = st.get(PREFIX + k); } catch (e) { v = undefined; }
      if (v === undefined) {   /* a host that stores under a different prefix: match on the last segment */
        Object.keys(all).some(function (ak) { if (ak.split('.').pop() === k) { v = all[ak]; return true; } return false; });
      }
      if (v !== undefined && v !== null) stored[k] = v;
    });
    return schema.resolve(stored);
  }

  function persist (key, value) {
    try { global.tableau.extensions.settings.set(PREFIX + key, String(value)); } catch (e) { log('could not stage setting', key, e); }
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {   /* batch rapid stepper clicks into one workbook write */
      state.saveTimer = null;
      try { var p = global.tableau.extensions.settings.saveAsync(); if (p && p.catch) p.catch(function (e) { log('saveAsync rejected', e); }); } catch (e) { log('saveAsync threw', e); }
    }, 400);
  }

  function setSetting (key, value) { state.settings[key] = schema.coerce(key, value); persist(key, state.settings[key]); redraw(); }
  function resetSettings () {
    state.settings = schema.resolve({});
    Object.keys(schema.DEFAULTS).forEach(function (k) { persist(k, state.settings[k]); });
    redraw();
  }
  function replaceAll (obj) {
    Object.keys(schema.DEFAULTS).forEach(function (k) {
      var v = obj[k];
      if (v === undefined && obj[PREFIX + k] !== undefined) v = obj[PREFIX + k];
      if (v !== undefined) { state.settings[k] = schema.coerce(k, v); persist(k, state.settings[k]); }
    });
    redraw();
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

  function buildModel (ws) {
    return Promise.all([readSummary(ws), readEncodings(ws)]).then(function (res) {
      var data = res[0], enc = res[1];
      var cat = fieldName(enc.category), val = fieldName(enc.value), col = fieldName(enc.color), lab = fieldName(enc.label);
      var firstRow = data.rows[0];
      if (!cat || data.columns.indexOf(cat) < 0) cat = data.columns.filter(function (c) { return firstRow && typeof firstRow[c] === 'string'; })[0] || data.columns[0];
      if (!val || data.columns.indexOf(val) < 0) val = data.columns.filter(function (c) { return firstRow && isNum(firstRow[c]) && c !== cat; })[0] || data.columns[1];
      var rows = [];
      data.rows.forEach(function (r, i) {
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
      var bg = '#ffffff';
      try { if (ws.backgroundColor) bg = ws.backgroundColor; } catch (e) { /* not fatal */ }
      return { rows: rows, catName: cat || 'Category', valueName: val || 'Value', worksheetBg: bg, hasColor: !!col, hasLabel: !!lab,
        emptyMessage: data.rows.length ? 'No numeric values to plot. Put one observation per row on the Value shelf.' : 'Drop a dimension on Category and a measure on Value.' };
    });
  }

  /* ------------------------------------------------------------ Tableau out */

  function pushSelection (ridges) {
    var ws = state.worksheet;
    if (!ws || !state.settings.selectEnabled) return;
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
    var ws = state.worksheet;
    if (!ws || !state.settings.hoverPush || typeof ws.hoverTupleAsync !== 'function') return;
    var id = ridge && ridge.tuples.length ? ridge.tuples[0] : 0;
    if (id === lastHover) return;
    lastHover = id;
    try { var p = ws.hoverTupleAsync(id); if (p && p.catch) p.catch(function () { /* hover is cosmetic */ }); } catch (e) { /* cosmetic */ }
  }

  /* ----------------------------------------------------------------- render */

  function redraw () {
    if (!state.renderer) return;
    state.renderer.draw(state.model, state.settings, { onSelect: pushSelection, onHover: pushHover });
    if (state.panel) state.panel.applyAppearance(state.renderer.chartBg, state.renderer.ink);
  }

  /* Reads are serialized: one open reader per worksheet, and a slow earlier read must never
   * overwrite a newer one. Requests that arrive mid-read collapse into one follow-up. */
  var refreshing = false, queued = false;
  function refreshData () {
    if (!state.worksheet) return Promise.resolve();
    if (refreshing) { queued = true; return Promise.resolve(); }
    refreshing = true;
    var done = function () { refreshing = false; if (queued) { queued = false; return refreshData(); } return undefined; };
    return buildModel(state.worksheet).then(function (m) { state.model = m; redraw(); }, function (e) {
      log('data refresh failed', e);
      state.model = { rows: [], emptyMessage: 'Could not read data from this worksheet.' };
      redraw();
    }).then(done, done);
  }

  function mount (ws) {
    state.worksheet = ws;
    state.settings = readStored();
    var root = document.getElementById('tl-root'), chart = document.getElementById('tl-chart');
    state.renderer = new TL.Renderer(chart);
    state.panel = new TL.Panel(root, {
      get: function () { return state.settings; }, set: setSetting, reset: resetSettings, replaceAll: replaceAll,
      ctx: function () { return { autoBw: state.renderer.autoBw }; }
    });
    state.panel.applyAppearance('#ffffff', '#0b1f2e');
    global.addEventListener('resize', function () {
      if (state.resizeTimer) clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(function () { state.resizeTimer = null; redraw(); }, 60);
    });
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
      if (chart) { chart.innerHTML = ''; var d = document.createElement('div'); d.className = 'tl-empty'; d.textContent = 'This extension could not start. Check the browser console for details.'; chart.appendChild(d); }
    });
  }

  TL.app = { boot: boot, mount: mount, refreshData: refreshData, redraw: redraw, state: state };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
