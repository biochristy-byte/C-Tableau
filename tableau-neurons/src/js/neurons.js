/* Neurons Viz Extension - entry point.
 *
 * Binds the Tableau worksheet to the renderer and the settings panel:
 *   - reads the Marks card encodings declared in neurons.trex
 *   - pulls summary data through the paged reader (one reader at a time)
 *   - keeps every setting in tableau.extensions.settings
 *   - pushes hover and selection back to Tableau where the API allows
 *
 * Only calls that every host provides are required: getVisualSpecificationAsync,
 * getSummaryDataReaderAsync, settings.get/set/saveAsync. Everything else
 * (selectMarksByValueAsync, hoverTupleAsync, events) is feature-detected, so
 * the same code runs inside the C-Tableau Viz pages stand-in, which no-ops
 * most of them.
 */
(function (global) {
  'use strict';

  var schema = global.NX.schema;
  var layoutLib = global.NX.layout;
  var PREFIX = 'neurons.';

  var state = {
    worksheet: null, view: null, panel: null,
    settings: schema.resolve({}),
    model: { graph: null, emptyMessage: '' },
    saveTimer: null, ready: false, errors: []
  };

  function log () {
    var args = [].slice.call(arguments);
    state.errors.push(args.map(String).join(' ').slice(0, 200));
    if (global.console && console.warn) console.warn.apply(console, ['[NX]'].concat(args));
  }

  /* ------------------------------------------------------------- settings */

  function readStoredSettings () {
    var stored = {};
    var st = null;
    try { st = global.tableau.extensions.settings; } catch (e) { log('no settings api', e); }
    if (st) {
      Object.keys(schema.DEFAULTS).forEach(function (k) {
        try {
          var v = st.get(PREFIX + k);
          if (v !== undefined && v !== null) stored[k] = v;
        } catch (e) { log('could not read setting', k, e); }
      });
    }
    return schema.resolve(stored);
  }

  function persist (key, value) {
    try { global.tableau.extensions.settings.set(PREFIX + key, String(value)); } catch (e) { log('could not stage setting', key, e); }
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      state.saveTimer = null;
      try {
        var p = global.tableau.extensions.settings.saveAsync();
        if (p && p.catch) p.catch(function (e) { log('saveAsync rejected', e); });
      } catch (e) { log('saveAsync threw', e); }
    }, 400);
  }

  function setSetting (key, value) {
    state.settings[key] = schema.coerce(key, value);
    persist(key, state.settings[key]);
    redraw();
  }

  function resetSettings () {
    state.settings = schema.resolve({});
    Object.keys(schema.DEFAULTS).forEach(function (k) { persist(k, state.settings[k]); });
    redraw();
  }

  function replaceAllSettings (obj) {
    var src = obj;
    /* A block saved with the prefix ("neurons.beta") is accepted too. */
    Object.keys(schema.DEFAULTS).forEach(function (k) {
      var has = Object.prototype.hasOwnProperty;
      var raw;
      if (has.call(src, k)) raw = src[k];
      else if (has.call(src, PREFIX + k)) raw = src[PREFIX + k];
      else return;
      state.settings[k] = schema.coerce(k, raw);
      persist(k, state.settings[k]);
    });
    redraw();
  }

  /* ----------------------------------------------------------------- data */

  function readEncodings (worksheet) {
    return worksheet.getVisualSpecificationAsync().then(function (spec) {
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

  function readSummary (worksheet) {
    return worksheet.getSummaryDataReaderAsync(undefined, { ignoreSelection: true }).then(function (reader) {
      var pages = [];
      var chain = Promise.resolve();
      for (var i = 0; i < reader.pageCount; i++) {
        (function (p) { chain = chain.then(function () { return reader.getPageAsync(p).then(function (pg) { pages.push(pg); }); }); })(i);
      }
      return chain.then(function () {
        var cols = pages.length ? pages[0].columns : [];
        var names = cols.map(function (c) { return c.fieldName; });
        var rows = [];
        pages.forEach(function (page) {
          page.data.forEach(function (r) {
            var obj = {};
            for (var c = 0; c < names.length; c++) obj[names[c]] = r[c] ? (r[c].value !== undefined ? r[c].value : r[c].formattedValue) : null;
            rows.push(obj);
          });
        });
        var done = function () { return { rows: rows, columns: names }; };
        return reader.releaseAsync().then(done, done);
      });
    });
  }

  function pickByName (columns, re, exclude) {
    for (var i = 0; i < columns.length; i++) if (re.test(columns[i]) && exclude.indexOf(columns[i]) < 0) return columns[i];
    return null;
  }

  function cleanName (n) {
    return String(n || '').replace(/^(?:SUM|AVG|MIN|MAX|CNT|COUNT|CNTD|ATTR|MEDIAN)\((.*)\)$/i, '$1');
  }

  function buildModel (worksheet) {
    return Promise.all([readSummary(worksheet), readEncodings(worksheet)]).then(function (res) {
      var data = res[0], enc = res[1];
      var cols = data.columns;
      var srcF = fieldName(enc.source), tgtF = fieldName(enc.target), grpF = fieldName(enc.group), wtF = fieldName(enc.weight);
      var used = [];
      if (!srcF || cols.indexOf(srcF) < 0) srcF = pickByName(cols, /^(?:source|from|origin|src)\b|source|from/i, used);
      if (srcF) used.push(srcF);
      if (!tgtF || cols.indexOf(tgtF) < 0) tgtF = pickByName(cols, /^(?:target|to|dest|destination|tgt)\b|target|dest/i, used);
      if (tgtF) used.push(tgtF);
      if (grpF && cols.indexOf(grpF) < 0) grpF = null;
      if (!grpF && !enc.group) grpF = pickByName(cols, /^group$|^parent$|group|parent|category/i, used.concat([]).filter(function (c) { return !/target/i.test(c); }));
      if (grpF && /target/i.test(grpF) && cols.length > 2) grpF = null;
      if (wtF && cols.indexOf(wtF) < 0) wtF = null;
      if (!wtF && !enc.weight) {
        var cand = pickByName(cols, /weight|synapse|count|value|flow|sum|strength/i, used.concat([grpF]));
        if (cand && data.rows.length && typeof data.rows[0][cand] === 'number') wtF = cand;
      }
      var tgF = pickByName(cols, /target.?group|to.?group|dest.?group/i, used.concat([grpF, wtF]));

      var model = { graph: null, rows: [], names: { group: grpF, source: srcF, target: tgtF, weight: wtF }, worksheetBg: null,
        weightName: wtF ? cleanName(wtF).toLowerCase() : null, emptyMessage: '' };
      if (!srcF || !tgtF) {
        model.emptyMessage = data.rows.length
          ? 'Drop a dimension on Source and another on Target. Group (the parent) and Weight are optional.'
          : 'No data yet. Drop a dimension on Source and another on Target.';
        model.graph = layoutLib.buildGraph([]);
        return model;
      }
      var rows = data.rows.map(function (r) {
        return { group: grpF ? r[grpF] : '', source: r[srcF], target: r[tgtF], weight: wtF ? r[wtF] : undefined, targetGroup: tgF ? r[tgF] : '' };
      });
      model.rows = rows;
      model.graph = layoutLib.buildGraph(rows);
      model.emptyMessage = model.graph.links.length ? '' : 'No links to draw: every row had an empty or identical Source and Target.';
      try { if (worksheet.backgroundColor) model.worksheetBg = worksheet.backgroundColor; } catch (e) { /* optional */ }
      model.srcField = srcF; model.tgtField = tgtF;
      return model;
    });
  }

  /* ----------------------------------------------------------- Tableau out */

  var lastHover = null;
  function pushHover (id) {
    var ws = state.worksheet;
    if (!ws || !state.settings.pushHover || typeof ws.hoverTupleAsync !== 'function') return;
    if (id === lastHover) return;
    lastHover = id;
    try {
      var node = id && state.model.graph ? state.model.graph.byId[id] : null;
      var tuple = node && node.rows.length ? node.rows[0] + 1 : 0;
      var p = ws.hoverTupleAsync(tuple);
      if (p && p.catch) p.catch(function () { /* cosmetic */ });
    } catch (e) { /* cosmetic */ }
  }

  function pushSelect (id) {
    var ws = state.worksheet, m = state.model;
    if (!ws || !state.settings.clickSelect) return;
    try {
      var T = global.tableau || {};
      var U = T.SelectionUpdateType || {};
      var replace = U.Replace || 'select-replace', add = U.Add || 'select-add';
      if (!id) {
        if (typeof ws.clearSelectedMarksAsync === 'function') { var c = ws.clearSelectedMarksAsync(); if (c && c.catch) c.catch(function () {}); }
        return;
      }
      if (typeof ws.selectMarksByValueAsync !== 'function' || !m.srcField || !m.tgtField) return;
      /* A node is a Source in some rows and a Target in others. Criteria on
       * different fields combine with AND, so it takes two calls. */
      var p1 = ws.selectMarksByValueAsync([{ fieldName: m.srcField, value: [id] }], replace);
      var after = function () {
        var p2 = ws.selectMarksByValueAsync([{ fieldName: m.tgtField, value: [id] }], add);
        if (p2 && p2.catch) p2.catch(function () { /* no marks where it is a target */ });
      };
      if (p1 && p1.then) p1.then(after, function () { after(); }); else after();
    } catch (e) { log('selection push failed', e); }
  }

  /* --------------------------------------------------------------- render */

  function redraw () {
    if (!state.view) return;
    state.view.draw(state.model, state.settings, { onSelect: pushSelect, onHover: pushHover });
    if (state.panel) state.panel.applyAppearance(state.settings, state.view.theme ? state.view.theme.bg : null);
  }

  /* One reader at a time, and the last request always wins. */
  var refreshing = false, refreshQueued = false;
  function refreshData () {
    if (!state.worksheet) return Promise.resolve();
    if (refreshing) { refreshQueued = true; return Promise.resolve(); }
    refreshing = true;
    var done = function () {
      refreshing = false;
      if (refreshQueued) { refreshQueued = false; return refreshData(); }
      return undefined;
    };
    return buildModel(state.worksheet).then(function (m) {
      state.model = m;
      redraw();
    }, function (e) {
      log('data refresh failed', e);
      state.model = { graph: layoutLib.buildGraph([]), emptyMessage: 'Could not read data from this worksheet.' };
      redraw();
    }).then(done, done);
  }

  /* ----------------------------------------------------------------- boot */

  function mount (worksheet) {
    state.worksheet = worksheet;
    state.settings = readStoredSettings();
    var root = document.getElementById('nx-root');
    var chart = document.getElementById('nx-chart');
    state.view = new global.NX.View(chart);
    state.panel = new global.NX.Panel(root, {
      get: function () { return state.settings; },
      set: setSetting, reset: resetSettings, replaceAll: replaceAllSettings
    });
    state.panel.applyAppearance(state.settings, null);

    /* Resize: the guard skips a callback whose size did not change, and the
     * redraw is deferred to a frame, which is what stops the ResizeObserver
     * feedback loop that blanked another extension in real Tableau. */
    var lastW = 0, lastH = 0, pending = 0;
    var onSize = function () {
      var w = chart.clientWidth, h = chart.clientHeight;
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      if (pending) return;
      pending = global.requestAnimationFrame(function () { pending = 0; redraw(); });
    };
    if (global.ResizeObserver) new global.ResizeObserver(onSize).observe(chart);
    global.addEventListener('resize', onSize);

    if (worksheet && typeof worksheet.addEventListener === 'function') {
      var T = global.tableau.TableauEventType || {};
      [T.SummaryDataChanged, T.FilterChanged, T.ParameterChanged, T.WorksheetFormattingChanged].forEach(function (evt) {
        if (!evt) return;
        try { worksheet.addEventListener(evt, refreshData); } catch (e) { log('listener failed for', evt, e); }
      });
    }
    state.ready = true;
    return refreshData();
  }

  function boot () {
    if (!global.tableau || !global.tableau.extensions) { log('Tableau Extensions API not present'); return; }
    global.tableau.extensions.initializeAsync().then(function () {
      var wc = global.tableau.extensions.worksheetContent;
      if (!wc || !wc.worksheet) { log('no worksheetContent: load this as a viz extension'); return; }
      return mount(wc.worksheet);
    }).catch(function (e) {
      log('initializeAsync failed', e);
      var chart = document.getElementById('nx-chart');
      if (chart) { chart.textContent = 'This extension could not start. Check the browser console for details.'; }
    });
  }

  global.NX.app = { boot: boot, mount: mount, refreshData: refreshData, redraw: redraw, state: state, pushSelect: pushSelect };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
