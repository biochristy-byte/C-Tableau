/* Reef - entry point. Binds the Tableau worksheet to the renderer and panel.
 *
 * Only API surface the C-Tableau Viz pages stand-in provides is required:
 * initializeAsync, worksheetContent.worksheet, getVisualSpecificationAsync,
 * getSummaryDataReaderAsync (+ page + release), settings get/set/saveAsync.
 * Selection, hover and events are used when present and skipped quietly when not.
 */
(function (global) {
  'use strict';
  var RF = global.RF, CP = global.CTabPanel, SET = RF.settings, PREFIX = 'reef.';
  var LEVEL_IDS = ['level1', 'level2', 'level3'];

  var state = { worksheet: null, renderer: null, panel: null, store: null, settings: SET.DEFAULTS, data: null, dataVersion: 0, model: null, ready: false };
  function log() { if (global.console && console.warn) console.warn.apply(console, ['[RF]'].concat([].slice.call(arguments))); }

  /* -------------------------------------------------------------------- data */
  function fieldName(f) { return f ? (f.name || f.fieldName || f.fieldId || null) : null; }
  function readEncodings(ws) {
    return ws.getVisualSpecificationAsync().then(function (spec) {
      var map = {};
      if (!spec || !spec.marksSpecifications) return map;
      var idx = spec.activeMarksSpecificationIndex;
      if (idx === undefined || idx === null || idx < 0) return map;
      var card = spec.marksSpecifications[idx];
      (card && card.encodings || []).forEach(function (e) { if (!map[e.id]) map[e.id] = fieldName(e.field); });
      return map;
    });
  }
  function readSummary(ws) {
    return ws.getSummaryDataReaderAsync(undefined, { ignoreSelection: true }).then(function (reader) {
      var pages = [], chain = Promise.resolve();
      for (var i = 0; i < reader.pageCount; i++) (function (p) { chain = chain.then(function () { return reader.getPageAsync(p).then(function (pg) { pages.push(pg); }); }); })(i);
      return chain.then(function () {
        var names = (pages.length ? pages[0].columns : []).map(function (c) { return c.fieldName; }), rows = [];
        pages.forEach(function (pg) {
          pg.data.forEach(function (r) {
            var o = {};
            for (var c = 0; c < names.length; c++) o[names[c]] = r[c] ? (r[c].value !== undefined ? r[c].value : r[c].formattedValue) : null;
            rows.push(o);
          });
        });
        var done = { rows: rows, columns: names };
        return reader.releaseAsync().then(function () { return done; }, function () { return done; });
      });
    });
  }
  function isNum(rows, c) { for (var i = 0; i < rows.length; i++) { var v = rows[i][c]; if (v !== null && v !== undefined && v !== '') return typeof v === 'number'; } return false; }

  function loadData() {
    var ws = state.worksheet;
    return Promise.all([readSummary(ws), readEncodings(ws)]).then(function (res) {
      var bg = null; try { if (ws.backgroundColor) bg = ws.backgroundColor; } catch (e) { /* optional */ }
      state.data = { rows: res[0].rows, columns: res[0].columns, enc: res[1], bg: bg };
      state.dataVersion++;
    });
  }

  /* Compose the model from data + the colour settings. Cheap, so a colour change never re-reads Tableau. */
  function compose() {
    var d = state.data, s = state.settings;
    if (!d) return { rows: [], emptyMessage: 'Reading the worksheet...' };
    var cols = d.columns, enc = d.enc;
    function has(c) { return c && cols.indexOf(c) >= 0; }
    var levelFields = LEVEL_IDS.map(function (id, i) { return chosen('fieldLevel' + (i + 1), enc[id]); }).filter(has);
    var sizeField = chosen('fieldSize', has(enc.size) ? enc.size : null);
    if (!sizeField) sizeField = cols.filter(function (c) { return levelFields.indexOf(c) < 0 && isNum(d.rows, c); })[0] || null;
    if (!levelFields.length) {
      var guess = cols.filter(function (c) { return c !== sizeField && !isNum(d.rows, c); })[0];
      if (guess) levelFields = [guess];
    }
    var colorField = s.colorMode === 'field' && has(s.colorField) ? s.colorField : null;
    function chosen(key, auto) { var v = s[key]; return v && has(v) ? v : auto; }
    var colorIsNum = colorField ? isNum(d.rows, colorField) : false;
    var rows = d.rows.map(function (r, i) {
      return { path: levelFields.map(function (f) { return r[f]; }), value: sizeField ? Number(r[sizeField]) : NaN, color: colorField ? (colorIsNum ? Number(r[colorField]) : r[colorField]) : null, tuple: i + 1 };
    });
    return {
      rows: levelFields.length && sizeField ? rows : [], levels: levelFields.length, levelFields: levelFields, levelNames: levelFields, valueName: sizeField || 'Size',
      colorName: colorField, worksheetBg: d.bg, columns: cols.filter(function (c) { return c !== sizeField; }), rootName: 'All',
      version: [state.dataVersion, levelFields.join('/'), sizeField || '', colorField || '', colorIsNum].join(':'),
      emptyMessage: !d.rows.length ? 'Drop a dimension on Level 1 and a measure on Size.' : (!sizeField ? 'Put a measure on the Size shelf.' : 'Drop a dimension on Level 1.')
    };
  }

  /* ----------------------------------------------------------------- Tableau */
  function pushSelect(node, additive) {
    var ws = state.worksheet, m = state.model;
    if (!ws || !state.store.get().selectEnabled) return;
    try {
      var p;
      if (!node) p = ws.clearSelectedMarksAsync && ws.clearSelectedMarksAsync();
      else if (ws.selectMarksByValueAsync && m.levelFields.length) {
        var sel = [];
        node.data.pathNames.forEach(function (nm, i) { if (m.levelFields[i]) sel.push({ fieldName: m.levelFields[i], value: [nm === '(blank)' ? null : nm] }); });
        var T = global.tableau.SelectionUpdateType || {};
        p = ws.selectMarksByValueAsync(sel, additive ? (T.Add || 'select-add') : (T.Replace || 'select-replace'));
      } else if (ws.selectTuplesAsync) {
        var ids = []; node.leaves().forEach(function (l) { ids = ids.concat(l.data.tuples || []); });
        p = ws.selectTuplesAsync(ids, additive ? 'select-options-toggle' : 'select-options-simple');
      }
      if (p && p.catch) p.catch(function (e) { log('selection rejected', e); });
    } catch (e) { log('selection threw', e); }
  }
  var lastHover = null;
  function pushHover(node) {
    var ws = state.worksheet;
    if (!ws || !ws.hoverTupleAsync || !state.store.get().hoverPush) return;
    var id = node && !node.children && node.data.tuples && node.data.tuples.length ? node.data.tuples[0] : 0;
    if (id === lastHover) return; lastHover = id;
    try { var p = ws.hoverTupleAsync(id); if (p && p.catch) p.catch(function () { /* cosmetic */ }); } catch (e) { /* cosmetic */ }
  }

  /* -------------------------------------------------------------------- draw */
  function redraw() {
    if (!state.renderer) return;
    state.settings = state.store.get();
    state.model = compose();
    state.renderer.draw(state.model, state.settings);
    var root = document.getElementById('rf-root');
    ['tl', 'tr', 'bl', 'br'].forEach(function (c) { root.classList.toggle('gc-' + c, state.settings.gearCorner === c); });
    var th = state.renderer.th;
    if (state.panel && th) { state.panel.applyAppearance(th.clear ? (th.dark ? '#0d2b45' : '#ffffff') : th.bg, th.ink); }
  }

  /* One reader at a time, and the last request always wins. */
  var busy = false, queued = false;
  function refresh() {
    if (!state.worksheet) return Promise.resolve();
    if (busy) { queued = true; return Promise.resolve(); }
    busy = true;
    var done = function () { busy = false; if (queued) { queued = false; return refresh(); } };
    return loadData().then(redraw, function (e) {
      log('data refresh failed', e); state.data = { rows: [], columns: [], enc: {}, bg: null };
      state.model = { rows: [], emptyMessage: 'Could not read data from this worksheet.' }; state.renderer.draw(state.model, state.settings);
    }).then(done, done);
  }

  function info() {
    var d = state.data, m = state.model || {};
    var numeric = d ? d.columns.filter(function (c) { return isNum(d.rows, c); }) : [];
    return { columns: d ? d.columns : [], numericColumns: numeric,
      auto: { fieldLevel1: d && d.enc.level1, fieldLevel2: d && d.enc.level2, fieldLevel3: d && d.enc.level3, fieldSize: d && d.enc.size },
      lists: { categories: state.renderer ? state.renderer.catItems() : [] } };
  }

  function mount(ws) {
    state.worksheet = ws;
    /* A workbook saved before the shared panel keeps its look: old keys are read when the new one is empty (see settings.js). */
    state.store = CP.createStore({ rows: SET.prepared.rows, settings: SET.withLegacy(global.tableau.extensions.settings), prefix: PREFIX, onChange: function () { redraw(); }, log: log });
    state.store.load(); state.settings = state.store.get();
    var root = document.getElementById('rf-root'), chart = document.getElementById('rf-chart');
    state.renderer = new RF.Renderer(chart, { onSelect: pushSelect, onHover: pushHover });
    state.panel = CP.create(root, { title: 'Reef settings', schema: SET.schema, store: state.store, prefix: PREFIX, state: state.store.panelState, info: info });
    var t = null, again = function () { clearTimeout(t); t = setTimeout(redraw, 60); };
    global.addEventListener('resize', again);
    if (global.ResizeObserver) new ResizeObserver(again).observe(chart);
    var T = global.tableau.TableauEventType || {};
    if (ws.addEventListener) [T.SummaryDataChanged, T.FilterChanged, T.ParameterChanged, T.WorksheetFormattingChanged].forEach(function (ev) {
      if (ev) { try { ws.addEventListener(ev, refresh); } catch (e) { log('listener failed', ev, e); } }
    });
    state.ready = true;
    return refresh();
  }

  function boot() {
    if (!global.tableau || !global.tableau.extensions) { log('Tableau Extensions API not present'); return; }
    global.tableau.extensions.initializeAsync().then(function () {
      var wc = global.tableau.extensions.worksheetContent;
      if (!wc || !wc.worksheet) { log('no worksheetContent: load this as a viz extension'); return; }
      return mount(wc.worksheet);
    }).catch(function (e) {
      log('initializeAsync failed', e);
      var c = document.getElementById('rf-chart'); if (c) { c.textContent = ''; var d = document.createElement('div'); d.className = 'rf-empty'; d.textContent = 'Reef could not start. Check the browser console.'; c.appendChild(d); }
    });
  }

  RF.app = { boot: boot, state: state, redraw: redraw, refresh: refresh, compose: compose };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
