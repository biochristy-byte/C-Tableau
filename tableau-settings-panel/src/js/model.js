/* Settings Panel - the workbook model. Pure logic, no DOM: it reads every parameter and every worksheet filter from
 * the Dashboard Extensions API into one list of controls, applies a change back through the API, and captures or
 * restores the whole state for named presets and "reset to workbook defaults".
 *
 * Runs in the browser (window.SP.model) and under node (module.exports) so test/run.js can drive it against the mock.
 * Every API call it makes is one the Extensions API documents for 1.12; calls added later are feature-checked.
 */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.SP = root.SP || {}; root.SP.model = m; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var CHIP_MAX = 6, CHIP_CHARS = 48, LIST_SHOW = 200;
  var PERIODS = [['years', 'Years'], ['quarters', 'Quarters'], ['months', 'Months'], ['weeks', 'Weeks'], ['days', 'Days']];
  var RANGES = [['last', 'Previous'], ['current', 'This'], ['next', 'Next'], ['lastn', 'Last N'], ['nextn', 'Next N'], ['todate', 'To date']];

  /* ------------------------------------------------------------------ values */

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(v) {
    if (v instanceof Date && !isNaN(v)) return v.getUTCFullYear() + '-' + pad(v.getUTCMonth() + 1) + '-' + pad(v.getUTCDate());
    var s = String(v === null || v === undefined ? '' : v), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
  }
  function parseDate(s) {
    var m = String(s || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 ? d : null;   /* rejects 2026-02-31 */
  }
  function addPeriod(iso, period, n) {
    var d = parseDate(iso); if (!d) return iso;
    var p = String(period || 'days').toLowerCase();
    if (p === 'years') d.setUTCFullYear(d.getUTCFullYear() + n);
    else if (p === 'quarters') d.setUTCMonth(d.getUTCMonth() + 3 * n);
    else if (p === 'months') d.setUTCMonth(d.getUTCMonth() + n);
    else if (p === 'weeks') d.setUTCDate(d.getUTCDate() + 7 * n);
    else d.setUTCDate(d.getUTCDate() + n);
    return isoDate(d);
  }
  function isDateType(t) { return t === 'date' || t === 'date-time'; }
  function isNumType(t) { return t === 'int' || t === 'float'; }
  function rawOf(dv) { return dv === null || dv === undefined ? null : (dv.value !== undefined ? dv.value : dv); }
  function labelOf(dv) {
    if (dv === null || dv === undefined) return '';
    if (dv.formattedValue !== undefined && dv.formattedValue !== null && dv.formattedValue !== '') return String(dv.formattedValue);
    var v = rawOf(dv); return v instanceof Date ? isoDate(v) : String(v);
  }
  function keyOf(dv) { var v = rawOf(dv); return v instanceof Date ? isoDate(v) : String(v); }
  function decimals(x) { var s = String(x); var i = s.indexOf('.'); return i < 0 ? 0 : Math.min(6, s.length - i - 1); }
  function roundTo(x, d) { var f = Math.pow(10, d); return Math.round(x * f) / f; }
  /* A step that gives about 20 clicks across a range, on a 1-2-5 ladder. */
  function niceStep(span, isInt) {
    if (!(span > 0)) return 1;
    var raw = span / 20, mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), n = raw / mag;
    var s = (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
    return isInt ? Math.max(1, Math.round(s)) : s;
  }
  function clamp(v, lo, hi) { if (lo !== null && lo !== undefined && v < lo) v = lo; if (hi !== null && hi !== undefined && v > hi) v = hi; return v; }

  /* ----------------------------------------------------------- read workbook */

  function paramControl(p) {
    var dt = p.dataType, av = p.allowableValues || { type: 'all' }, cv = p.currentValue;
    var c = { kind: 'param', id: 'p:' + p.name, name: p.name, label: p.name, dataType: dt, ref: p,
      value: keyOf(cv), formatted: labelOf(cv), allow: av.type };
    if (dt === 'bool') { c.control = 'toggle'; c.value = String(rawOf(cv)) === 'true'; return c; }
    if (av.type === 'list') {
      c.options = (av.allowableValues || []).map(function (o) { return { value: keyOf(o), label: labelOf(o) }; });
      var chars = c.options.reduce(function (a, o) { return a + o.label.length; }, 0);
      c.control = c.options.length <= CHIP_MAX && chars <= CHIP_CHARS ? 'chips' : 'select';
      return c;
    }
    if (isDateType(dt)) {
      c.control = 'date';
      c.min = av.type === 'range' && av.minValue ? keyOf(av.minValue) : null;
      c.max = av.type === 'range' && av.maxValue ? keyOf(av.maxValue) : null;
      c.step = av.type === 'range' && av.stepSize ? Number(av.stepSize) : 1;
      c.period = (av.type === 'range' && av.dateStepPeriod) || 'days';
      return c;
    }
    if (isNumType(dt)) {
      c.control = 'stepper'; c.value = Number(rawOf(cv));
      if (av.type === 'range') {
        c.min = av.minValue ? Number(rawOf(av.minValue)) : null; c.max = av.maxValue ? Number(rawOf(av.maxValue)) : null;
        c.step = av.stepSize ? Number(av.stepSize) : niceStep((c.max || 0) - (c.min || 0), dt === 'int');
      } else { c.min = null; c.max = null; c.step = dt === 'int' ? 1 : Math.pow(10, -Math.max(1, decimals(c.value))); c.free = dt === 'float'; }
      c.dec = Math.max(decimals(c.step), dt === 'int' ? 0 : decimals(c.value));
      return c;
    }
    c.control = 'text';
    return c;
  }

  function readFilter(ws, f) {
    var base = { field: f.fieldName, type: f.filterType, sheet: ws.name, ws: ws, ref: f };
    if (f.filterType === 'categorical') {
      return Promise.resolve(f.getDomainAsync ? f.getDomainAsync('database') : { values: [] }).then(function (dom) {
        base.domain = ((dom && dom.values) || []).map(function (o) { return { value: keyOf(o), label: labelOf(o) }; });
        base.selected = (f.appliedValues || []).map(keyOf);
        base.exclude = !!f.isExcludeMode;
        base.all = f.isAllSelected === true || (!base.exclude && base.domain.length > 0 && base.selected.length >= base.domain.length);
        return base;
      });
    }
    if (f.filterType === 'range') {
      return Promise.resolve(f.getDomainAsync ? f.getDomainAsync('database') : null).then(function (dom) {
        var lo = dom && dom.min, hi = dom && dom.max, sample = rawOf(f.minValue);
        base.isDate = sample instanceof Date || (typeof sample === 'string' && !!isoDate(sample));
        if (base.isDate) {
          base.dmin = isoDate(rawOf(lo)) || isoDate(sample); base.dmax = isoDate(rawOf(hi)) || isoDate(rawOf(f.maxValue));
          base.min = isoDate(sample); base.max = isoDate(rawOf(f.maxValue)); base.period = 'days'; base.step = 1;
        } else {
          base.dmin = Number(rawOf(lo)); base.dmax = Number(rawOf(hi));
          if (!isFinite(base.dmin)) base.dmin = Number(sample);
          if (!isFinite(base.dmax)) base.dmax = Number(rawOf(f.maxValue));
          base.min = Number(sample); base.max = Number(rawOf(f.maxValue));
          var isInt = [base.dmin, base.dmax].every(function (x) { return Math.round(x) === x; });
          base.step = niceStep(base.dmax - base.dmin, isInt);
          base.dec = Math.max(decimals(base.step), decimals(base.min), decimals(base.max));
        }
        base.nulls = f.includeNullValues !== false;
        return base;
      });
    }
    if (f.filterType === 'relative-date') {
      base.anchor = isoDate(rawOf(f.anchorDate)) || isoDate(new Date());
      base.period = String(f.periodType || 'months').toLowerCase();
      base.range = String(f.rangeType || 'last').toLowerCase();
      base.n = Number(f.rangeN) || 1;
      return Promise.resolve(base);
    }
    base.unsupported = true;   /* hierarchical (cube) filters: listed, not editable */
    return Promise.resolve(base);
  }

  /* One control per filter field and type. A filter that sits on several worksheets (the usual
   * "apply to all worksheets using this data source") becomes one control that drives every copy. */
  function groupFilters(list) {
    var by = {}, out = [];
    list.forEach(function (f) {
      var id = 'f:' + f.type + ':' + f.field;
      if (!by[id]) { by[id] = { kind: 'filter', id: id, label: f.field, field: f.field, type: f.type, sheets: [], copies: [] }; out.push(by[id]); }
      var g = by[id]; g.sheets.push(f.sheet); g.copies.push(f);
      if (g.copies.length === 1) Object.keys(f).forEach(function (k) { if (['sheet', 'ws', 'ref', 'field', 'type'].indexOf(k) < 0) g[k] = f[k]; });
    });
    out.forEach(function (g) { g.group = g.sheets.length > 1 ? 'On ' + g.sheets.length + ' sheets' : g.sheets[0]; });
    return out;
  }

  function read(dashboard) {
    var sheets = (dashboard.worksheets || []).slice();
    var pp = typeof dashboard.getParametersAsync === 'function' ? dashboard.getParametersAsync() : Promise.resolve([]);
    var ff = Promise.all(sheets.map(function (ws) {
      return (typeof ws.getFiltersAsync === 'function' ? ws.getFiltersAsync() : Promise.resolve([])).then(function (fs) {
        return Promise.all((fs || []).map(function (f) { return readFilter(ws, f); }));
      }, function () { return []; });
    }));
    return Promise.all([pp, ff]).then(function (r) {
      var params = (r[0] || []).map(paramControl);
      var flat = []; r[1].forEach(function (a) { flat = flat.concat(a); });
      return { params: params, filters: groupFilters(flat), sheets: sheets.map(function (ws) { return ws.name; }), worksheets: sheets };
    });
  }

  /* ----------------------------------------------------------------- writes */

  function each(copies, fn) { return Promise.all(copies.map(function (f) { return fn(f.ws, f); })); }

  function setParam(c, v) {
    var send;
    if (c.control === 'toggle') send = v === true || v === 'true';
    else if (c.control === 'stepper') {
      send = Number(v); if (!isFinite(send)) return Promise.reject(new Error('Not a number'));
      send = clamp(roundTo(send, c.free ? 6 : (c.dec || 0)), c.min, c.max);
    } else if (c.control === 'date') {
      if (!parseDate(v)) return Promise.reject(new Error('Use a date like 2026-11-24'));
      send = v;
      if (c.min && send < c.min) send = c.min;
      if (c.max && send > c.max) send = c.max;
    } else if (c.control === 'chips' || c.control === 'select') {
      if (!c.options.some(function (o) { return o.value === String(v); })) return Promise.reject(new Error('Not one of the allowed values'));
      send = String(v);
      if (isNumType(c.dataType)) send = Number(send);
    } else send = String(v);
    return Promise.resolve(c.ref.changeValueAsync(send)).then(function () { return send; });
  }

  /* values: an array of value keys, or 'all'. */
  function setCategorical(g, values, exclude) {
    return each(g.copies, function (ws) {
      if (values === 'all') return ws.applyFilterAsync(g.field, [], 'all', { isExcludeMode: false });
      return ws.applyFilterAsync(g.field, values.map(String), 'replace', { isExcludeMode: !!exclude });
    });
  }
  function setRange(g, min, max, nulls) {
    var lo, hi;
    if (g.isDate) {
      if (!parseDate(min) || !parseDate(max)) return Promise.reject(new Error('Use dates like 2026-11-24'));
      lo = parseDate(min); hi = parseDate(max);
    } else {
      lo = Number(min); hi = Number(max);
      if (!isFinite(lo) || !isFinite(hi)) return Promise.reject(new Error('Not a number'));
    }
    if (lo > hi) { var t = lo; lo = hi; hi = t; }
    return each(g.copies, function (ws) {
      return ws.applyRangeFilterAsync(g.field, { min: lo, max: hi, nullOption: nulls === false ? 'non-null-values' : 'all-values' });
    });
  }
  function setRelative(g, o) {
    var anchor = parseDate(o.anchor);
    if (!anchor) return Promise.reject(new Error('Use a date like 2026-11-24'));
    return each(g.copies, function (ws) {
      if (typeof ws.applyRelativeDateFilterAsync !== 'function') return Promise.reject(new Error('This Tableau version cannot set relative dates from an extension'));
      return ws.applyRelativeDateFilterAsync(g.field, { anchorDate: anchor, periodType: o.period, rangeType: o.range, rangeN: Math.max(1, Math.round(Number(o.n) || 1)) });
    });
  }
  function clearFilter(g) { return each(g.copies, function (ws) { return ws.clearFilterAsync(g.field); }); }

  /* ---------------------------------------------------------- highlighting */

  /* Distinct values of each text column of a worksheet's summary data, through one reader that is always released. */
  function marks(ws) {
    if (typeof ws.getSummaryDataReaderAsync !== 'function') return Promise.resolve({ columns: [] });
    return ws.getSummaryDataReaderAsync(undefined, { ignoreSelection: true }).then(function (reader) {
      var pages = [], chain = Promise.resolve();
      for (var i = 0; i < reader.pageCount; i++) (function (p) { chain = chain.then(function () { return reader.getPageAsync(p).then(function (pg) { pages.push(pg); }); }); })(i);
      var fin = function () { return reader.releaseAsync ? reader.releaseAsync() : null; };
      return chain.then(function () {
        var cols = pages.length ? pages[0].columns : [], out = [];
        cols.forEach(function (col, ci) {
          if (col.dataType && col.dataType !== 'string') return;
          var seen = {}, vals = [];
          pages.forEach(function (pg) { pg.data.forEach(function (r) { var c = r[ci]; if (!c) return; var k = String(rawOf(c)); if (!seen[k]) { seen[k] = 1; vals.push({ value: k, label: labelOf(c) }); } }); });
          out.push({ name: col.fieldName, values: vals });
        });
        return Promise.resolve(fin()).then(function () { return { columns: out }; }, function () { return { columns: out }; });
      }, function (e) { return Promise.resolve(fin()).then(function () { throw e; }); });
    });
  }
  function highlight(ws, field, values) {
    if (!values || !values.length) return Promise.resolve(ws.clearSelectedMarksAsync());
    return Promise.resolve(ws.selectMarksByValueAsync([{ fieldName: field, value: values.map(String) }], 'select-replace'));
  }

  /* ------------------------------------------------------- presets, defaults */

  function capture(m) {
    var snap = { v: 1, params: {}, filters: {} };
    m.params.forEach(function (c) { snap.params[c.name] = c.value; });
    m.filters.forEach(function (g) {
      if (g.unsupported) return;
      if (g.type === 'categorical') snap.filters[g.id] = { all: !!g.all, exclude: !!g.exclude, values: g.all ? [] : g.selected.slice() };
      else if (g.type === 'range') snap.filters[g.id] = { min: g.min, max: g.max, nulls: g.nulls };
      else if (g.type === 'relative-date') snap.filters[g.id] = { anchor: g.anchor, period: g.period, range: g.range, n: g.n };
    });
    return snap;
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* Applies a snapshot to the live workbook. Only what differs is sent, one call at a time, so Tableau
   * re-queries as little as possible. Returns { applied, unchanged, missing: [names], failed: [names] }. */
  function restore(m, snap) {
    var now = capture(m), res = { applied: 0, unchanged: 0, missing: [], failed: [] }, jobs = [];
    Object.keys(snap.params || {}).forEach(function (name) {
      var c = m.params.filter(function (p) { return p.name === name; })[0];
      if (!c) { res.missing.push(name); return; }
      if (same(now.params[name], snap.params[name])) { res.unchanged++; return; }
      jobs.push(function () { return setParam(c, snap.params[name]); });
      jobs[jobs.length - 1].label = name;
    });
    Object.keys(snap.filters || {}).forEach(function (id) {
      var g = m.filters.filter(function (f) { return f.id === id; })[0], s = snap.filters[id];
      if (!g) { res.missing.push(id.split(':').slice(2).join(':')); return; }
      if (same(now.filters[id], s)) { res.unchanged++; return; }
      var job;
      if (g.type === 'categorical') job = function () { return setCategorical(g, s.all ? 'all' : s.values, s.exclude); };
      else if (g.type === 'range') job = function () { return setRange(g, s.min, s.max, s.nulls); };
      else job = function () { return setRelative(g, s); };
      job.label = g.field; jobs.push(job);
    });
    return jobs.reduce(function (p, job) {
      return p.then(function () { return job().then(function () { res.applied++; }, function () { res.failed.push(job.label); }); });
    }, Promise.resolve()).then(function () { return res; });
  }

  /* Presets live in tableau.extensions.settings as one JSON string, so they travel inside the workbook. */
  var PKEY = 'sp.presets', DKEY = 'sp.defaults';
  function loadPresets(st) {
    var raw; try { raw = st.get(PKEY); } catch (e) { raw = null; }
    try { var a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a.filter(function (p) { return p && p.id && typeof p.name === 'string' && p.snap; }) : []; } catch (e) { return []; }
  }
  function savePresets(st, list) { st.set(PKEY, JSON.stringify(list)); return st.saveAsync(); }
  function cleanName(s) { return String(s || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); }
  function uniqueName(list, name, skipId) {
    var base = cleanName(name) || 'Preset', n = base, i = 2;
    var taken = function (x) { return list.some(function (p) { return p.id !== skipId && p.name.toLowerCase() === x.toLowerCase(); }); };
    while (taken(n)) n = base + ' ' + (i++);
    return n;
  }
  function addPreset(list, name, snap, now) {
    var id = 'p' + (now || Date.now()).toString(36) + Math.floor(Math.random() * 1296).toString(36);
    return list.concat([{ id: id, name: uniqueName(list, name), snap: snap, savedAt: new Date(now || Date.now()).toISOString() }]);
  }
  function renamePreset(list, id, name) { return list.map(function (p) { return p.id === id ? { id: p.id, name: uniqueName(list, name, id), snap: p.snap, savedAt: p.savedAt } : p; }); }
  function deletePreset(list, id) { return list.filter(function (p) { return p.id !== id; }); }
  function loadDefaults(st) { var raw; try { raw = st.get(DKEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
  function saveDefaults(st, snap) { st.set(DKEY, JSON.stringify(snap)); return st.saveAsync(); }

  /* --------------------------------------------------------------- search */

  function words(s) { return String(s || '').toLowerCase(); }
  function matches(c, q) {
    q = words(q).trim(); if (!q) return true;
    var hay = words([c.label, c.group, (c.sheets || []).join(' '), c.formatted || '', (c.options || []).map(function (o) { return o.label; }).join(' ')].join(' '));
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
  }

  return {
    read: read, paramControl: paramControl, groupFilters: groupFilters, setParam: setParam, setCategorical: setCategorical, setRange: setRange,
    setRelative: setRelative, clearFilter: clearFilter, marks: marks, highlight: highlight, capture: capture, restore: restore,
    loadPresets: loadPresets, savePresets: savePresets, addPreset: addPreset, renamePreset: renamePreset, deletePreset: deletePreset,
    uniqueName: uniqueName, cleanName: cleanName, loadDefaults: loadDefaults, saveDefaults: saveDefaults, matches: matches,
    decimals: decimals, isoDate: isoDate, parseDate: parseDate, addPeriod: addPeriod, niceStep: niceStep, roundTo: roundTo, clamp: clamp,
    PERIODS: PERIODS, RANGES: RANGES, LIST_SHOW: LIST_SHOW, CHIP_MAX: CHIP_MAX
  };
});
