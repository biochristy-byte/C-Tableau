/* Sketchbook - Tableau adapter. Reads the Marks card encodings declared in
 * sketchbook.trex, pulls summary data through the paged reader, keeps every
 * setting in Tableau's extension settings, and pushes selection and hover back.
 *
 * Only API calls the C-Tableau Viz pages stand-in provides are required:
 * initializeAsync, worksheetContent.worksheet.getVisualSpecificationAsync,
 * getSummaryDataReaderAsync and settings.get/set/saveAsync. Selection and hover
 * calls are used only when they exist, so a read-only host still draws. */
(function (global) {
  'use strict';
  var CP = global.CTabPanel, SET = global.SB.settings;
  var PREFIX = 'sketchbook.';
  var DATA_KEYS = { fieldCategory: 1, fieldValue: 1, fieldSeries: 1, fieldLabel: 1 };

  var state = { worksheet: null, renderer: null, panel: null, store: null, raw: null, auto: {}, model: { rows: [] }, resizeTimer: null };

  function log () { if (global.console && console.warn) console.warn.apply(console, ['[SB]'].concat([].slice.call(arguments))); }

  /* ---------------------------------------------------------- settings */

  /* A workbook saved by the old panel keeps its look: where an old key was renamed or re-meant (SET.LEGACY) and the new key is
   * not stored yet, the old value is carried over once. The new keys are then saved under their own names. */
  function migrateLegacy (store, st) {
    var carried = {};
    SET.LEGACY.forEach(function (m) {
      var raw; try { raw = st.get(PREFIX + m.old); } catch (e) { raw = undefined; }
      if (raw === undefined || raw === null) return;
      var out = m.map(raw);
      if (!out) return;
      Object.keys(out).forEach(function (k) {
        var cur; try { cur = st.get(PREFIX + k); } catch (e) { cur = undefined; }
        if (cur === undefined || cur === null) carried[k] = out[k];
      });
    });
    if (Object.keys(carried).length) store.setMany(carried);
  }

  /* -------------------------------------------------------------- data */

  function fieldName (f) { return f ? (f.name || f.fieldName || f.fieldId || null) : null; }

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

  function readSummary (ws) {
    return ws.getSummaryDataReaderAsync(undefined, { ignoreSelection: true }).then(function (reader) {
      var pages = [], chain = Promise.resolve();
      for (var i = 0; i < reader.pageCount; i++) {
        (function (p) { chain = chain.then(function () { return reader.getPageAsync(p).then(function (pg) { pages.push(pg); }); }); })(i);
      }
      return chain.then(function () {
        var names = pages.length ? pages[0].columns.map(function (c) { return c.fieldName; }) : [];
        var rows = [];
        pages.forEach(function (pg) {
          pg.data.forEach(function (r) {
            var o = {};
            for (var c = 0; c < names.length; c++) o[names[c]] = r[c] ? (r[c].value !== undefined ? r[c].value : r[c].formattedValue) : null;
            rows.push(o);
          });
        });
        var fin = function () { return { rows: rows, columns: names }; };
        return reader.releaseAsync().then(fin, fin);
      });
    });
  }

  function isNum (v) { return v !== null && v !== '' && v !== undefined && isFinite(Number(v)) && typeof v !== 'boolean'; }

  /* The raw rows plus the shelf mapping. The model is rebuilt from this whenever a field setting changes. */
  function readData (ws) {
    return Promise.all([readSummary(ws), readEncodings(ws)]).then(function (res) {
      var data = res[0], enc = res[1], cols = data.columns;
      var auto = { fieldCategory: fieldName(enc.category), fieldValue: fieldName(enc.value), fieldSeries: fieldName(enc.series), fieldLabel: fieldName(enc.label) };
      /* Shelves still empty: first text column is the category, first numeric column the value. */
      var numericCols = cols.filter(function (c) { return data.rows.some(function (r) { return isNum(r[c]); }) && data.rows.every(function (r) { return r[c] === null || isNum(r[c]); }); });
      var textCols = cols.filter(function (c) { return numericCols.indexOf(c) < 0; });
      if (!auto.fieldCategory || cols.indexOf(auto.fieldCategory) < 0) auto.fieldCategory = textCols[0] || cols[0] || null;
      if (!auto.fieldValue || cols.indexOf(auto.fieldValue) < 0) auto.fieldValue = numericCols.filter(function (c) { return c !== auto.fieldCategory; })[0] || null;
      if (auto.fieldSeries && cols.indexOf(auto.fieldSeries) < 0) auto.fieldSeries = null;
      if (auto.fieldLabel && cols.indexOf(auto.fieldLabel) < 0) auto.fieldLabel = null;
      var bg = null;
      try { if (ws.backgroundColor) bg = ws.backgroundColor; } catch (e) { /* optional */ }
      return { raw: data, auto: auto, numeric: numericCols, bg: bg };
    });
  }

  function pick (key, auto, columns) { var v = state.store.get()[key]; return v && columns.indexOf(v) >= 0 ? v : auto; }

  function buildModel () {
    var d = state.raw;
    if (!d) return { rows: [], emptyMessage: 'Loading.' };
    var cols = d.raw.columns;
    var cf = pick('fieldCategory', d.auto.fieldCategory, cols), vf = pick('fieldValue', d.auto.fieldValue, cols), sf = pick('fieldSeries', d.auto.fieldSeries, cols), lf = pick('fieldLabel', d.auto.fieldLabel, cols);
    var rows = [];
    d.raw.rows.forEach(function (r, i) {
      if (!vf || !isNum(r[vf])) return;
      rows.push({
        cat: r[cf] === null || r[cf] === undefined ? '(blank)' : String(r[cf]),
        value: Number(r[vf]),
        series: sf ? (r[sf] === null || r[sf] === undefined ? '(blank)' : String(r[sf])) : '',
        label: lf && r[lf] !== null && r[lf] !== undefined ? String(r[lf]) : '',
        id: i + 1
      });
    });
    return {
      rows: rows, catName: cf || 'Category', valueName: vf || 'Value', hasSeries: !!sf, worksheetBg: d.bg,
      emptyMessage: d.raw.rows.length ? 'Put a measure on the Value shelf.' : 'Drop a dimension on Category and a measure on Value.'
    };
  }

  /* ---------------------------------------------------------- Tableau out */

  function pushSelection (ids) {
    var ws = state.worksheet;
    if (!ws || !state.store.get().selectOn) return;
    try {
      if (typeof ws.selectTuplesAsync === 'function') {
        var p = ids.length ? ws.selectTuplesAsync(ids, 'select-options-simple') : (typeof ws.clearSelectedMarksAsync === 'function' ? ws.clearSelectedMarksAsync() : null);
        if (p && p.catch) p.catch(function (e) { log('select rejected', e); });
      }
    } catch (e) { log('select threw', e); }
  }
  var lastHover = null;
  function pushHover (id) {
    var ws = state.worksheet, s = state.store.get();
    if (!ws || !s.hoverOn || !s.hoverPush || id === lastHover) return;
    lastHover = id;
    try {
      if (typeof ws.hoverTupleAsync === 'function') { var p = ws.hoverTupleAsync(id === null ? 0 : id); if (p && p.catch) p.catch(function () {}); }
    } catch (e) { /* hover is cosmetic */ }
  }

  /* -------------------------------------------------------------- render */

  function redraw () {
    if (!state.renderer) return;
    var s = state.store.get();
    lastHover = null;   /* a redraw drops the hovered mark, so the next hover must be sent again */
    state.renderer.draw(state.model, s, { onSelect: pushSelection, onHover: pushHover });
    if (state.panel) {
      state.panel.applyAppearance(state.renderer.chartBg, state.renderer.ink);
      state.panel.gear.style.display = s.showGear ? '' : 'none';
      state.panel.render();
    }
  }
  function onChange (keys) {
    if (keys.some(function (k) { return DATA_KEYS[k]; })) { state.model = buildModel(); state.renderer.clearSelection(); }
    redraw();
  }

  /* One reader at a time (Tableau allows one open reader per worksheet), and
   * the last request always wins. */
  var refreshing = false, queued = false;
  function refreshData () {
    if (!state.worksheet) return Promise.resolve();
    if (refreshing) { queued = true; return Promise.resolve(); }
    refreshing = true;
    var done = function () { refreshing = false; if (queued) { queued = false; return refreshData(); } };
    return readData(state.worksheet).then(function (d) {
      state.raw = d; state.auto = d.auto; state.model = buildModel(); state.renderer.clearSelection(); redraw();
    }, function (e) {
      log('data refresh failed', e); state.raw = null; state.model = { rows: [], emptyMessage: 'Could not read data from this worksheet.' }; redraw();
    }).then(done, done);
  }

  /* The series, for the Colors tab list: name, color and order are the user's to set. */
  function info () {
    var d = state.raw, items = [];
    if (d && state.model.hasSeries) {
      var s = state.store.get(), pal = s.greys ? global.SB.engine.PALETTES.ink : CP.paletteColors(s.palette, s.paletteReverse);
      var seen = {};
      state.model.rows.forEach(function (r) { if (!seen[r.series]) { seen[r.series] = 1; items.push({ key: r.series, name: r.series, color: pal[items.length % pal.length] }); } });
    }
    return { columns: d ? d.raw.columns : [], numericColumns: d ? d.numeric : [], auto: d ? d.auto : {}, lists: { categories: items } };
  }

  /* ---------------------------------------------------------------- boot */

  function mount (ws) {
    state.worksheet = ws;
    var st = global.tableau.extensions.settings;
    state.store = CP.createStore({ rows: SET.prepared.rows, settings: st, prefix: PREFIX, onChange: onChange, log: log });
    state.store.load();
    migrateLegacy(state.store, st);
    var root = document.getElementById('sb-root');
    state.renderer = new global.SB.Renderer(root);
    state.panel = CP.create(root, { title: 'Sketchbook settings', schema: SET.schema, store: state.store, info: info, state: state.store.panelState, prefix: PREFIX });
    global.addEventListener('resize', function () {
      if (state.resizeTimer) clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(function () { state.resizeTimer = null; redraw(); }, 60);
    });
    var T = global.tableau.TableauEventType || {};
    [T.SummaryDataChanged, T.FilterChanged, T.ParameterChanged, T.WorksheetFormattingChanged].forEach(function (evt) {
      if (!evt || !ws.addEventListener) return;
      try { ws.addEventListener(evt, refreshData); } catch (e) { log('listener failed', evt, e); }
    });
    /* Inter is bundled but loads on first use, and tick thinning and the title underline measure
     * text. So the first draw waits for it (1.5 s at most), or it would be measured in a fallback
     * font and then redrawn, which would cut the entrance fade. */
    var fontReady = (global.document.fonts && global.document.fonts.load)
      ? Promise.race([global.document.fonts.load('400 14px Inter').catch(function () {}), new Promise(function (r) { setTimeout(r, 1500); })])
      : Promise.resolve();
    return fontReady.then(refreshData);
  }

  function boot () {
    if (!global.tableau || !global.tableau.extensions) { log('Tableau Extensions API not present'); return; }
    global.tableau.extensions.initializeAsync().then(function () {
      var wc = global.tableau.extensions.worksheetContent;
      if (!wc || !wc.worksheet) { log('no worksheetContent: load this as a viz extension'); return; }
      return mount(wc.worksheet);
    }).catch(function (e) {
      log('initializeAsync failed', e);
      var root = document.getElementById('sb-root');
      if (root) root.innerHTML = '<div class="sb-empty">This extension could not start. Check the browser console.</div>';
    });
  }

  global.SB.app = { boot: boot, refreshData: refreshData, redraw: redraw, state: state };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
