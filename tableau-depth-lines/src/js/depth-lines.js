/* Depth Lines - Tableau adapter. Reads the Marks card encodings declared in
 * depth-lines.trex, pulls summary data through the paged reader, keeps every
 * setting in Tableau's extension settings, and pushes selection and hover back.
 *
 * Only API calls the C-Tableau Viz pages stand-in provides are required:
 * initializeAsync, worksheetContent.worksheet.getVisualSpecificationAsync,
 * getSummaryDataReaderAsync and settings.get/set/saveAsync. Selection and hover
 * calls are used only when they exist, so a read-only host still draws. */
(function (global) {
  'use strict';
  var CP = global.CTabPanel, SET = global.DL.settings;
  var PREFIX = 'depthlines.';
  var DATA_KEYS = { fieldX: 1, fieldY: 1, fieldCategory: 1, fieldWeight: 1 };

  var state = { worksheet: null, renderer: null, panel: null, store: null, raw: null, auto: {}, model: { points: [] }, resizeTimer: null };

  function log () { if (global.console && console.warn) console.warn.apply(console, ['[DL]'].concat([].slice.call(arguments))); }

  /* ---------------------------------------------------------- settings */

  /* A workbook saved by the old panel keeps its look: where an old key was renamed (SET.LEGACY) and the new key is not stored yet,
   * the old value is carried over once. The renamed keys stay in the store, so the next save writes them under their new names. */
  function migrateLegacy (store, st) {
    var carried = {};
    SET.LEGACY.forEach(function (m) {
      var raw; try { raw = st.get(PREFIX + m.old); } catch (e) { raw = undefined; }
      if (raw === undefined || raw === null) return;
      var out = m.map(raw);
      if (!out) return;
      Object.keys(out).forEach(function (k) {
        var cur; try { cur = st.get(PREFIX + k); } catch (e) { cur = undefined; }
        if ((cur === undefined || cur === null) && k !== 'bgColor') carried[k] = out[k];
      });
      if (out.bgColor !== undefined) { var cb; try { cb = st.get(PREFIX + 'bgColor'); } catch (e) { cb = undefined; } if (cb === undefined || cb === null) carried.bgColor = out.bgColor; }
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
      var numericCols = cols.filter(function (c) { return data.rows.length && data.rows.every(function (r) { return r[c] === null || isNum(r[c]); }) && data.rows.some(function (r) { return isNum(r[c]); }); });
      /* Shelves still empty: use the first two numeric columns so something draws. */
      var auto = { fieldX: fieldName(enc.x), fieldY: fieldName(enc.y), fieldCategory: fieldName(enc.category), fieldWeight: fieldName(enc.weight) };
      if (!auto.fieldX || cols.indexOf(auto.fieldX) < 0) auto.fieldX = numericCols[0] || null;
      if (!auto.fieldY || cols.indexOf(auto.fieldY) < 0) auto.fieldY = numericCols.filter(function (c) { return c !== auto.fieldX; })[0] || null;
      if (auto.fieldCategory && cols.indexOf(auto.fieldCategory) < 0) auto.fieldCategory = null;
      if (auto.fieldWeight && cols.indexOf(auto.fieldWeight) < 0) auto.fieldWeight = null;
      var bg = null;
      try { if (ws.backgroundColor) bg = ws.backgroundColor; } catch (e) { /* optional */ }
      return { raw: data, auto: auto, numeric: numericCols, bg: bg };
    });
  }

  function pick (key, auto, columns) { var v = state.store.get()[key]; return v && columns.indexOf(v) >= 0 ? v : auto; }

  function buildModel () {
    var d = state.raw;
    if (!d) return { points: [], emptyMessage: 'Loading.' };
    var cols = d.raw.columns;
    var xf = pick('fieldX', d.auto.fieldX, cols), yf = pick('fieldY', d.auto.fieldY, cols), cf = pick('fieldCategory', d.auto.fieldCategory, cols), wf = pick('fieldWeight', d.auto.fieldWeight, cols);
    var points = [];
    d.raw.rows.forEach(function (r, i) {
      if (!xf || !yf || !isNum(r[xf]) || !isNum(r[yf])) return;
      var w = wf ? Number(r[wf]) : 1;
      if (!isFinite(w) || w <= 0) return;
      points.push({ x: Number(r[xf]), y: Number(r[yf]), w: w, cat: cf ? (r[cf] === null || r[cf] === undefined ? '(blank)' : String(r[cf])) : '', id: i + 1 });
    });
    return {
      points: points, xName: xf || 'X', yName: yf || 'Y', hasCategory: !!cf, worksheetBg: d.bg,
      emptyMessage: d.raw.rows.length ? 'Needs two numeric fields on X and Y, with a dimension on Detail so each row is one point.' : 'Drop a measure on X and a measure on Y, and a dimension on Detail.'
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
    state.renderer.draw(state.model, s, { onSelect: pushSelection, onHover: pushHover });
    if (state.panel) {
      state.panel.applyAppearance(state.renderer.chartBg, state.renderer.ink);
      state.panel.gear.style.display = s.showGear ? '' : 'none';
      state.panel.render();
      try { state.panel.trace({ marks: state.model && state.model.points ? state.model.points.length : 0 }); } catch (e) { /* diagnostics only */ }
    }
    diagOnEmpty(document.getElementById('dl-root'));
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
      log('data refresh failed', e); state.raw = null; state.model = { points: [], emptyMessage: 'Could not read data from this worksheet.' }; redraw();
    }).then(done, done);
  }

  function info () {
    var d = state.raw, r = state.renderer, items = [];
    if (d && state.model.hasCategory) {
      var seen = {}, pal = CP.paletteColors(state.store.get().palette, state.store.get().paletteReverse);
      var cf = pick('fieldCategory', d.auto.fieldCategory, d.raw.columns);
      d.raw.rows.forEach(function (row) {
        var k = row[cf] === null || row[cf] === undefined ? '(blank)' : String(row[cf]);
        if (!seen[k]) { seen[k] = 1; items.push({ key: k, name: k, color: pal[items.length % pal.length] }); }
      });
    }
    void r;
    return { columns: d ? d.raw.columns : [], numericColumns: d ? d.numeric : [], auto: d ? d.auto : {}, lists: { categories: items }, data: diagData(d), tokens: diagTokens() };
  }

  /* What the diagnostics report and the title placeholders see. Cheap, and never throws. */
  function diagData (d) {
    try {
      if (!d || !d.raw) return { rows: 0, fields: [], sample: [] };
      var rows = d.raw.rows, cols = d.raw.columns;
      var fields = cols.map(function (c) {
        var t = 'text';
        for (var i = 0; i < rows.length; i++) { var v = rows[i][c]; if (v === null || v === undefined) continue; t = typeof v === 'number' ? 'number' : (v instanceof Date ? 'date' : typeof v === 'boolean' ? 'boolean' : 'text'); break; }
        return { name: c, type: t };
      });
      var sample = rows.slice(0, 4).map(function (r) { var o = {}; cols.forEach(function (c) { o[c] = r[c] === undefined ? null : r[c]; }); return o; });
      return { rows: rows.length, fields: fields, sample: sample };
    } catch (e) { return { rows: 0, fields: [], sample: [] }; }
  }
  function diagTokens () {
    try {
      var pts = state.model && state.model.points; if (!pts || !pts.length) return {};
      var by = {}, total = 0, top = '', topV = -Infinity;
      pts.forEach(function (p) { total += p.w; if (p.cat) { by[p.cat] = (by[p.cat] || 0) + p.w; if (by[p.cat] > topV) { topV = by[p.cat]; top = p.cat; } } });
      var out = { total: total.toLocaleString('en-US', { maximumFractionDigits: 1 }) };
      if (top) out.top = top;
      return out;
    } catch (e) { return {}; }
  }
  /* A Copy diagnostics button on the blank screen. One per empty box; a redraw rebuilds the box. */
  function diagOnEmpty (root) {
    try {
      var e = root && root.querySelector('.dl-empty');
      if (e && !e.querySelector('.cp-diagwrap')) CP.diagButton(e, { panel: state.panel });
    } catch (x) { log('diag button failed', x); }
  }

  /* ---------------------------------------------------------------- boot */

  function scheduleRedraw () {
    if (state.resizeTimer) clearTimeout(state.resizeTimer);
    state.resizeTimer = setTimeout(function () { state.resizeTimer = null; redraw(); }, 60);
  }

  function mount (ws) {
    state.worksheet = ws;
    var st = global.tableau.extensions.settings;
    state.store = CP.createStore({ rows: SET.prepared.rows, settings: st, prefix: PREFIX, onChange: onChange, log: log });
    state.store.load();
    migrateLegacy(state.store, st);
    var root = document.getElementById('dl-root');
    state.renderer = new global.DL.Renderer(root);
    state.panel = CP.create(root, { title: 'Depth Lines settings', schema: SET.schema, store: state.store, info: info, state: state.store.panelState, prefix: PREFIX, version: '1.0.0',
      /* Pinned to the side the panel pulls the chart in from the right; window resize does not fire, so say so. */
      onLayout: function () { if (state.model) scheduleRedraw(); } });
    global.addEventListener('resize', scheduleRedraw);
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
      var root = document.getElementById('dl-root');
      if (root) { root.innerHTML = '<div class="dl-empty">This extension could not start. Check the browser console.</div>'; diagOnEmpty(root); }
    });
  }

  global.DL.app = { boot: boot, refreshData: refreshData, redraw: redraw, state: state };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
