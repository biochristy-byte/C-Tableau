/* Reef - entry point. Binds the Tableau worksheet to the renderer and panel.
 *
 * Only API surface the C-Tableau Viz pages stand-in provides is required:
 * initializeAsync, worksheetContent.worksheet, getVisualSpecificationAsync,
 * getSummaryDataReaderAsync (+ page + release), settings get/set/saveAsync.
 * Selection, hover and events are used when present and skipped quietly when not.
 */
(function (global) {
  'use strict';
  var RF = global.RF, schema = RF.schema, PREFIX = 'reef.';
  var LEVEL_IDS = ['level1', 'level2', 'level3'];

  var state = { worksheet: null, renderer: null, panel: null, settings: schema.resolve({}), data: null, dataVersion: 0, model: null, saveTimer: null, ready: false };
  function log() { if (global.console && console.warn) console.warn.apply(console, ['[RF]'].concat([].slice.call(arguments))); }

  /* ---------------------------------------------------------------- settings */
  function readStored() {
    var out = {}, st = global.tableau.extensions.settings;
    Object.keys(schema.DEFAULTS).forEach(function (k) {
      try { var v = st.get(PREFIX + k); if (v !== undefined && v !== null) out[k] = v; } catch (e) { /* unreadable key */ }
    });
    return schema.resolve(out);
  }
  function persist(key, value) {
    try { global.tableau.extensions.settings.set(PREFIX + key, String(value)); } catch (e) { log('could not stage', key, e); }
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () {
      try { var p = global.tableau.extensions.settings.saveAsync(); if (p && p.catch) p.catch(function (e) { log('save rejected', e); }); } catch (e) { log('save threw', e); }
    }, 400);
  }
  function setSetting(key, value) { state.settings[key] = schema.coerce(key, value); persist(key, state.settings[key]); redraw(); }
  function resetSettings() { state.settings = schema.resolve({}); Object.keys(schema.DEFAULTS).forEach(function (k) { persist(k, state.settings[k]); }); redraw(); }
  function replaceAll(obj) {
    Object.keys(schema.DEFAULTS).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) { state.settings[k] = schema.coerce(k, obj[k]); persist(k, state.settings[k]); }
    });
    redraw();
  }

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
    var levelFields = LEVEL_IDS.map(function (id) { return enc[id]; }).filter(has);
    var sizeField = has(enc.size) ? enc.size : null;
    if (!sizeField) sizeField = cols.filter(function (c) { return levelFields.indexOf(c) < 0 && isNum(d.rows, c); })[0] || null;
    if (!levelFields.length) {
      var guess = cols.filter(function (c) { return c !== sizeField && !isNum(d.rows, c); })[0];
      if (guess) levelFields = [guess];
    }
    var colorField = s.colorMode === 'field' && has(s.colorField) ? s.colorField : null;
    var colorIsNum = colorField ? isNum(d.rows, colorField) : false;
    var rows = d.rows.map(function (r, i) {
      return { path: levelFields.map(function (f) { return r[f]; }), value: sizeField ? Number(r[sizeField]) : NaN, color: colorField ? (colorIsNum ? Number(r[colorField]) : r[colorField]) : null, tuple: i + 1 };
    });
    return {
      rows: levelFields.length && sizeField ? rows : [], levels: levelFields.length, levelFields: levelFields, levelNames: levelFields, valueName: sizeField || 'Size',
      colorName: colorField, worksheetBg: d.bg, columns: cols.filter(function (c) { return c !== sizeField; }), rootName: 'All',
      version: state.dataVersion + ':' + (colorField || '') + ':' + colorIsNum,
      emptyMessage: !d.rows.length ? 'Drop a dimension on Level 1 and a measure on Size.' : (!sizeField ? 'Put a measure on the Size shelf.' : 'Drop a dimension on Level 1.')
    };
  }

  /* ----------------------------------------------------------------- Tableau */
  function pushSelect(node, additive) {
    var ws = state.worksheet, m = state.model;
    if (!ws || !state.settings.selectEnabled) return;
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
    if (!ws || !ws.hoverTupleAsync || !state.settings.tooltips) return;
    var id = node && !node.children && node.data.tuples && node.data.tuples.length ? node.data.tuples[0] : 0;
    if (id === lastHover) return; lastHover = id;
    try { var p = ws.hoverTupleAsync(id); if (p && p.catch) p.catch(function () { /* cosmetic */ }); } catch (e) { /* cosmetic */ }
  }

  /* -------------------------------------------------------------------- draw */
  function redraw() {
    if (!state.renderer) return;
    state.model = compose();
    state.renderer.draw(state.model, state.settings);
    if (state.panel) state.panel.applyAppearance(state.settings);
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

  function mount(ws) {
    state.worksheet = ws; state.settings = readStored();
    var root = document.getElementById('rf-root'), chart = document.getElementById('rf-chart');
    state.renderer = new RF.Renderer(chart, { onSelect: pushSelect, onHover: pushHover });
    state.panel = new RF.Panel(root, { get: function () { return state.settings; }, set: setSetting, reset: resetSettings, replaceAll: replaceAll, columns: function () { return state.model && state.model.columns || []; } });
    state.panel.applyAppearance(state.settings);
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
