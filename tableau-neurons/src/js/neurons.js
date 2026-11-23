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

  var SET = global.NX.settings;
  var CP = global.CTabPanel;
  var layoutLib = global.NX.layout;
  var PREFIX = 'neurons.';
  /* Settings that change which rows or nodes exist, so the model is rebuilt, not just redrawn. */
  var DATA_KEYS = { fieldGroup: 1, fieldSource: 1, fieldTarget: 1, fieldWeight: 1, minWeight: 1, catColors: 1 };

  var state = {
    worksheet: null, view: null, panel: null, store: null, raw: null,
    model: { graph: null, emptyMessage: '' },
    ready: false, errors: []
  };
  /* state.settings is the store's live typed values, so a test or the panel can read and set it the same way. */
  Object.defineProperty(state, 'settings', { enumerable: true, get: function () { return state.store ? state.store.get() : SET.resolve({}); } });

  function log () {
    var args = [].slice.call(arguments);
    state.errors.push(args.map(String).join(' ').slice(0, 200));
    if (global.console && console.warn) console.warn.apply(console, ['[NX]'].concat(args));
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

  /* Reads the sheet once: summary rows, the shelf mapping and the background. The model is rebuilt from this
   * whenever a field, filter or group setting changes, without asking Tableau again. */
  function readData (worksheet) {
    return Promise.all([readSummary(worksheet), readEncodings(worksheet)]).then(function (res) {
      var bg = null;
      try { if (worksheet.backgroundColor) bg = worksheet.backgroundColor; } catch (e) { /* optional */ }
      return { data: res[0], enc: res[1], bg: bg };
    });
  }

  function pickSetting (key, auto, cols) { var v = state.store ? state.store.get()[key] : ''; return v && cols.indexOf(v) >= 0 ? v : auto; }

  function buildModel () {
    var raw = state.raw, s = state.settings;
    if (!raw) return { graph: layoutLib.buildGraph([]), rows: [], names: {}, emptyMessage: 'Loading.' };
    var data = raw.data, enc = raw.enc, cols = data.columns;
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
    /* A field picked by hand on the Fields tab wins over the shelf. */
    srcF = pickSetting('fieldSource', srcF, cols); tgtF = pickSetting('fieldTarget', tgtF, cols);
    grpF = pickSetting('fieldGroup', grpF, cols); wtF = pickSetting('fieldWeight', wtF, cols);
    var tgF = pickByName(cols, /target.?group|to.?group|dest.?group/i, used.concat([grpF, wtF]));

    var model = { graph: null, rows: [], names: { group: grpF, source: srcF, target: tgtF, weight: wtF }, worksheetBg: raw.bg,
      weightName: wtF ? cleanName(wtF).toLowerCase() : null, emptyMessage: '', columns: cols,
      numeric: cols.filter(function (c) { return data.rows.some(function (r) { return typeof r[c] === 'number' && isFinite(r[c]); }); }) };
    if (!srcF || !tgtF) {
      model.emptyMessage = data.rows.length
        ? 'Drop a dimension on Source and another on Target. Group (the parent) and Weight are optional.'
        : 'No data yet. Drop a dimension on Source and another on Target.';
      model.graph = layoutLib.buildGraph([]);
      state.groupList = [];
      return model;
    }
    var rows = data.rows.map(function (r) {
      return { group: grpF ? r[grpF] : '', source: r[srcF], target: r[tgtF], weight: wtF ? r[wtF] : undefined, targetGroup: tgF ? r[tgF] : '' };
    });
    model.rows = rows;
    /* Every group in first-appearance order (this fixes its palette color), then the Colors tab list on top. */
    var full = layoutLib.buildGraph(rows), seen = {}, groups = [];
    full.nodes.forEach(function (n) { if (!seen[n.group]) { seen[n.group] = true; groups.push(n.group); } });
    state.groupList = groups;
    var items = CP.mergeList(s.catColors, groups.map(function (g) { return { key: g, name: g, color: '' }; }));
    var hidden = {}, any = false;
    items.forEach(function (m) { if (m.hidden) { hidden[m.key] = true; any = true; } });
    model.graph = layoutLib.buildGraph(rows, { hiddenGroups: any ? hidden : null, minWeight: s.minWeight });
    model.emptyMessage = model.graph.links.length ? '' : (full.links.length ? 'No links left to draw: the weight floor or a hidden group removed them all.' : 'No links to draw: every row had an empty or identical Source and Target.');
    model.srcField = srcF; model.tgtField = tgtF;
    return model;
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

  /* The Colors tab list: per-group name, color and visibility. The palette color is what the group would get
   * with no override, so Reset restores it. */
  function groupItemsFor (theme) {
    var groups = state.groupList || [], pc = theme && theme.groups && theme.groups.length ? theme.groups : ['#c9d6e0'];
    return groups.map(function (g, i) { return { key: g, name: g, color: pc[i % pc.length] }; });
  }

  function redraw () {
    if (!state.view) return;
    var s = state.settings, view = state.view;
    var groups = state.groupList || [], idx = {}, ov = {};
    groups.forEach(function (g, i) { idx[g] = i; });
    var merged = CP.mergeList(s.catColors, groups.map(function (g) { return { key: g, name: g, color: '' }; }));
    merged.forEach(function (m) {
      ov[m.key] = { name: m.name !== m.defName ? m.name : '', color: m.color !== m.defColor ? m.color : '' };
    });
    view.groupIndex = idx; view.groupItems = ov; view.manualOrder = merged.map(function (m) { return m.key; });
    view.draw(state.model, s, { onSelect: pushSelect, onHover: pushHover });
    if (state.panel && view.theme) { state.panel.applyAppearance(view.theme.bg, view.theme.ink); state.panel.render(); }
  }

  function onChange (keys) {
    if (keys.some(function (k) { return DATA_KEYS[k]; })) state.model = buildModel();
    redraw();
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
    return readData(state.worksheet).then(function (raw) {
      state.raw = raw;
      state.model = buildModel();
      redraw();
    }, function (e) {
      log('data refresh failed', e);
      state.raw = null;
      state.model = { graph: layoutLib.buildGraph([]), emptyMessage: 'Could not read data from this worksheet.' };
      redraw();
    }).then(done, done);
  }

  function info () {
    var m = state.model || {}, theme = state.view && state.view.theme;
    return { columns: m.columns || [], numericColumns: m.numeric || [],
      auto: { fieldGroup: m.names && m.names.group, fieldSource: m.names && m.names.source, fieldTarget: m.names && m.names.target, fieldWeight: m.names && m.names.weight },
      lists: { categories: groupItemsFor(theme) } };
  }

  /* ----------------------------------------------------------------- boot */

  function mount (worksheet) {
    state.worksheet = worksheet;
    var st = global.tableau.extensions.settings;
    state.store = CP.createStore({ rows: SET.prepared.rows, settings: st, prefix: PREFIX, onChange: onChange, log: log });
    state.store.load();
    var root = document.getElementById('nx-root');
    var chart = document.getElementById('nx-chart');
    state.view = new global.NX.View(chart);
    /* The old home-made panel kept its theme under panelTheme; carry it into the shared panel's saved state once. */
    try {
      var lg = SET.legacy(function (k) { var v = st.get(PREFIX + k); return v === undefined || v === null ? undefined : v; });
      var ps = state.store.panelState, cur = ps.get() || {};
      if (lg.panel.theme && !cur.theme) { cur.theme = lg.panel.theme; ps.set(cur); }
    } catch (e) { log('legacy settings not carried', e); }
    state.panel = CP.create(root, { title: 'Neurons settings', schema: SET.schema, store: state.store, info: info, state: state.store.panelState, prefix: PREFIX });
    state.panel.applyAppearance('#081f33', '#f3f5f7');

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

  global.NX.app = { boot: boot, mount: mount, refreshData: refreshData, redraw: redraw, state: state, pushSelect: pushSelect, buildModel: buildModel };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
