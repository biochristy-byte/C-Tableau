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
  var schema = global.DL.schema;
  var PREFIX = 'depthlines.';

  var state = { worksheet: null, renderer: null, panel: null, settings: schema.resolve({}), model: { points: [] }, saveTimer: null, resizeTimer: null };

  function log () { if (global.console && console.warn) console.warn.apply(console, ['[DL]'].concat([].slice.call(arguments))); }

  /* ---------------------------------------------------------- settings */

  /* Read each key with settings.get(): it works in Tableau and in the Viz
   * pages stand-in, including when a pasted settings object has no prefix. */
  function readStoredSettings () {
    var stored = {};
    try {
      var st = global.tableau.extensions.settings;
      Object.keys(schema.DEFAULTS).forEach(function (k) {
        var v = st.get(PREFIX + k);
        if (v !== undefined && v !== null) stored[k] = v;
      });
    } catch (e) { log('could not read settings', e); }
    return schema.resolve(stored);
  }
  function persist (key, value) {
    try { global.tableau.extensions.settings.set(PREFIX + key, String(value)); } catch (e) { log('could not stage setting', key, e); }
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
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
  function replaceAllSettings (obj) {
    Object.keys(schema.DEFAULTS).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) { state.settings[k] = schema.coerce(k, obj[k]); persist(k, state.settings[k]); }
    });
    redraw();
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

  function buildModel (ws) {
    return Promise.all([readSummary(ws), readEncodings(ws)]).then(function (res) {
      var data = res[0], enc = res[1];
      var xf = fieldName(enc.x), yf = fieldName(enc.y), cf = fieldName(enc.category), wf = fieldName(enc.weight);
      var cols = data.columns;
      /* Shelves still empty: use the first two numeric columns so something draws. */
      var numericCols = cols.filter(function (c) { return data.rows.length && data.rows.every(function (r) { return r[c] === null || isNum(r[c]); }) && data.rows.some(function (r) { return isNum(r[c]); }); });
      if (!xf || cols.indexOf(xf) < 0) xf = numericCols[0];
      if (!yf || cols.indexOf(yf) < 0) yf = numericCols.filter(function (c) { return c !== xf; })[0];
      if (cf && cols.indexOf(cf) < 0) cf = null;
      if (wf && cols.indexOf(wf) < 0) wf = null;
      var points = [];
      data.rows.forEach(function (r, i) {
        if (!xf || !yf || !isNum(r[xf]) || !isNum(r[yf])) return;
        var w = wf ? Number(r[wf]) : 1;
        if (!isFinite(w) || w <= 0) return;
        points.push({ x: Number(r[xf]), y: Number(r[yf]), w: w, cat: cf ? (r[cf] === null || r[cf] === undefined ? '(blank)' : String(r[cf])) : '', id: i + 1 });
      });
      var bg = null;
      try { if (ws.backgroundColor) bg = ws.backgroundColor; } catch (e) { /* optional */ }
      return {
        points: points, xName: xf || 'X', yName: yf || 'Y', hasCategory: !!cf, worksheetBg: bg,
        emptyMessage: data.rows.length ? 'Needs two numeric fields on X and Y, with a dimension on Detail so each row is one point.' : 'Drop a measure on X and a measure on Y, and a dimension on Detail.'
      };
    });
  }

  /* ---------------------------------------------------------- Tableau out */

  function pushSelection (ids) {
    var ws = state.worksheet;
    if (!ws || !state.settings.selectEnabled) return;
    try {
      if (typeof ws.selectTuplesAsync === 'function') {
        var p = ids.length ? ws.selectTuplesAsync(ids, 'select-options-simple') : (typeof ws.clearSelectedMarksAsync === 'function' ? ws.clearSelectedMarksAsync() : null);
        if (p && p.catch) p.catch(function (e) { log('select rejected', e); });
      }
    } catch (e) { log('select threw', e); }
  }
  var lastHover = null;
  function pushHover (id) {
    var ws = state.worksheet;
    if (!ws || !state.settings.hoverEnabled || id === lastHover) return;
    lastHover = id;
    try {
      if (typeof ws.hoverTupleAsync === 'function') { var p = ws.hoverTupleAsync(id === null ? 0 : id); if (p && p.catch) p.catch(function () {}); }
    } catch (e) { /* hover is cosmetic */ }
  }

  /* -------------------------------------------------------------- render */

  function redraw () {
    if (!state.renderer) return;
    state.renderer.draw(state.model, state.settings, { onSelect: pushSelection, onHover: pushHover });
    if (state.panel) {
      var accent = state.renderer.th && state.renderer.th.dark ? '#3cc4d1' : '#0d2b45';
      state.panel.applyAppearance(state.renderer.chartBg, state.renderer.ink, accent, state.settings.showGear);
    }
  }

  /* One reader at a time (Tableau allows one open reader per worksheet), and
   * the last request always wins. */
  var refreshing = false, queued = false;
  function refreshData () {
    if (!state.worksheet) return Promise.resolve();
    if (refreshing) { queued = true; return Promise.resolve(); }
    refreshing = true;
    var done = function () { refreshing = false; if (queued) { queued = false; return refreshData(); } };
    return buildModel(state.worksheet).then(function (m) {
      state.model = m; state.renderer.clearSelection(); redraw();
    }, function (e) {
      log('data refresh failed', e); state.model = { points: [], emptyMessage: 'Could not read data from this worksheet.' }; redraw();
    }).then(done, done);
  }

  /* ---------------------------------------------------------------- boot */

  function mount (ws) {
    state.worksheet = ws;
    state.settings = readStoredSettings();
    var root = document.getElementById('dl-root');
    state.renderer = new global.DL.Renderer(root);
    state.panel = new global.HX.Panel(root, schema, { get: function () { return state.settings; }, set: setSetting, reset: resetSettings, replaceAll: replaceAllSettings });
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
      var root = document.getElementById('dl-root');
      if (root) root.innerHTML = '<div class="dl-empty">This extension could not start. Check the browser console.</div>';
    });
  }

  global.DL.app = { boot: boot, refreshData: refreshData, redraw: redraw, state: state };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
