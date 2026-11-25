/* A stand-in for the Tableau Dashboard Extensions API, shaped from the published type declarations
 * (@tableau/extensions-api-types 1.12 to 1.17): Dashboard, Worksheet, Parameter, CategoricalFilter, RangeFilter,
 * RelativeDateFilter, HierarchicalFilter, DataValue, the paged summary-data reader and extension settings.
 *
 * It proves our side of the contract as documented. It does NOT prove Tableau Desktop drives the extension the same
 * way. Deliberate fidelity choices:
 *   - settings store strings only and set() throws on anything else, like Tableau
 *   - only one summary-data reader may be open per worksheet; a second open rejects until releaseAsync
 *   - every write resolves on a later tick and then fires the matching event to every listener
 *   - changeValueAsync rejects a value outside a list or range parameter's allowed values
 * Runs in the browser (window.SP_MOCK, and window.tableau unless ?nomock) and under node (module.exports.create).
 */
(function (root, factory) {
  var lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else { root.SP_MOCK_LIB = lib; if (!root.tableau) { var m = lib.create(); root.SP_MOCK = m; root.tableau = m.tableau; } }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var EV = { FilterChanged: 'filter-changed', ParameterChanged: 'parameter-changed', MarkSelectionChanged: 'mark-selection-changed', SummaryDataChanged: 'summary-data-changed' };
  function later(fn) { return new Promise(function (res, rej) { setTimeout(function () { try { res(fn()); } catch (e) { rej(e); } }, 1); }); }
  function dv(v, f) { return { value: v, nativeValue: v, formattedValue: f === undefined ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)) : f }; }
  function iso(d) { return d.toISOString().slice(0, 10); }

  /* -------------------------------------------------------- the fake data */
  var REGIONS = ['Central', 'East', 'South', 'West'], CATS = ['Furniture', 'Office Supplies', 'Technology'], SEGS = ['Consumer', 'Corporate', 'Home Office'];
  function rows() {
    var out = [], seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    for (var i = 0; i < 480; i++) {
      var d = new Date(Date.UTC(2025, 0, 1) + Math.floor(rnd() * 690) * 86400000);
      var sales = Math.round(20 + rnd() * 1980);
      out.push({ 'Order ID': 'O-' + (1000 + i), Region: REGIONS[i % 4], Category: CATS[Math.floor(rnd() * 3)], Segment: SEGS[Math.floor(rnd() * 3)],
        Customer: 'Customer ' + (100 + Math.floor(rnd() * 300)), 'Order Date': d, 'Ship Date': new Date(d.getTime() + Math.floor(1 + rnd() * 6) * 86400000),
        Sales: sales, Profit: Math.round(sales * (rnd() * 0.5 - 0.12)), Quantity: 1 + Math.floor(rnd() * 9) });
    }
    return out;
  }

  function create(opts) {
    opts = opts || {};
    var DATA = rows(), calls = [], listeners = {}, settings = {}, saves = { n: 0 };
    function log(c) { calls.push(c); }
    function fire(type, target, extra) {
      (listeners[type] || []).forEach(function (l) {
        if (l.target !== target && !(l.target && target && l.target.name === target.name)) return;
        setTimeout(function () { var e = { type: type, sheet: target }; Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; }); l.fn(e); }, 0);
      });
    }
    function listen(target) {
      return function (type, fn) { (listeners[type] = listeners[type] || []).push({ target: target, fn: fn }); return function () { listeners[type] = listeners[type].filter(function (l) { return l.fn !== fn; }); }; };
    }

    /* ---- parameters, one of each kind the panel must handle ---- */
    function P(name, dataType, value, allow, fmt) {
      var p = { name: name, id: 'param.' + name.replace(/\W/g, ''), dataType: dataType, allowableValues: allow, currentValue: dv(value, fmt ? fmt(value) : undefined) };
      p.changeValueAsync = function (v) {
        log({ op: 'changeValueAsync', param: name, value: v });
        return later(function () {
          var nv = v;
          if (dataType === 'int' || dataType === 'float') { nv = Number(v); if (!isFinite(nv)) throw new Error('invalid number for ' + name); }
          if (dataType === 'bool') { if (typeof v !== 'boolean' && v !== 'true' && v !== 'false') throw new Error('invalid bool'); nv = v === true || v === 'true'; }
          if (dataType === 'date') { nv = v instanceof Date ? iso(v) : String(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(nv)) throw new Error('invalid date ' + v); }
          if (allow.type === 'list' && !allow.allowableValues.some(function (o) { return String(o.value) === String(nv); })) throw new Error('not an allowed value: ' + v);
          if (allow.type === 'range') {
            var lo = allow.minValue.value, hi = allow.maxValue.value;
            if (nv < lo || nv > hi) throw new Error('out of range: ' + v);
          }
          p.currentValue = dv(nv, fmt ? fmt(nv) : undefined);
          fire(EV.ParameterChanged, p, { getParameterAsync: function () { return Promise.resolve(p); } });
          return p.currentValue;
        });
      };
      p.addEventListener = listen(p);
      return p;
    }
    var money = function (v) { return '$' + Number(v).toLocaleString('en-US'); };
    var pct = function (v) { return Math.round(Number(v) * 100) + '%'; };
    var params = [
      P('Top N', 'int', 10, { type: 'range', minValue: dv(1), maxValue: dv(50), stepSize: 1 }),
      P('Profit Ratio Target', 'float', 0.15, { type: 'range', minValue: dv(0), maxValue: dv(1), stepSize: 0.05 }, pct),
      P('Metric', 'string', 'Sales', { type: 'list', allowableValues: ['Sales', 'Profit', 'Quantity'].map(function (v) { return dv(v); }) }),
      P('Region Focus', 'string', 'All regions', { type: 'list', allowableValues: ['All regions', 'Central', 'East', 'South', 'West', 'Central and East', 'South and West', 'Everywhere but West'].map(function (v) { return dv(v); }) }),
      P('Bucket Size', 'int', 25, { type: 'list', allowableValues: [5, 10, 25, 50].map(function (v) { return dv(v); }) }),
      P('Show Labels', 'bool', true, { type: 'all' }),
      P('Title Text', 'string', 'Superstore at a glance', { type: 'all' }),
      P('Discount Cap', 'float', 0.2, { type: 'all' }),
      P('Sales Floor', 'int', 500, { type: 'all' }, money),
      P('As Of Month', 'date', '2026-06-01', { type: 'range', minValue: dv('2025-01-01'), maxValue: dv('2026-12-01'), stepSize: 1, dateStepPeriod: 'months' }),
      P('Start Date', 'date', '2025-03-15', { type: 'all' })
    ];

    /* ---- worksheets and their filters ---- */
    function WS(name) {
      var ws = { name: name, sheetType: 'worksheet', filters: {}, selected: null, open: false };
      ws.getFiltersAsync = function () { return later(function () { return Object.keys(ws.filters).map(function (k) { return ws.filters[k]; }); }); };
      ws.applyFilterAsync = function (field, values, update, o) {
        log({ op: 'applyFilterAsync', sheet: name, field: field, values: values.slice(), update: update, exclude: !!(o && o.isExcludeMode) });
        return later(function () {
          var f = ws.filters[field]; if (!f || f.filterType !== 'categorical') throw new Error('no categorical filter ' + field + ' on ' + name);
          if (update === 'all') { f.appliedValues = f._domain.slice(); f.isAllSelected = true; f.isExcludeMode = false; }
          else if (update === 'replace') {
            var keep = f._domain.filter(function (d) { return values.indexOf(String(d.value)) >= 0; });
            if (keep.length !== values.length) throw new Error('unknown value in ' + JSON.stringify(values));
            f.appliedValues = keep; f.isExcludeMode = !!(o && o.isExcludeMode); f.isAllSelected = !f.isExcludeMode && keep.length === f._domain.length;
          } else throw new Error('update type not used by the panel: ' + update);
          fire(EV.FilterChanged, ws, { fieldName: field });
          return field;
        });
      };
      ws.applyRangeFilterAsync = function (field, r) {
        log({ op: 'applyRangeFilterAsync', sheet: name, field: field, min: r.min, max: r.max, nullOption: r.nullOption });
        return later(function () {
          var f = ws.filters[field]; if (!f || f.filterType !== 'range') throw new Error('no range filter ' + field);
          if (r.min > r.max) throw new Error('min above max');
          f.minValue = dv(r.min); f.maxValue = dv(r.max); f.includeNullValues = r.nullOption !== 'non-null-values';
          fire(EV.FilterChanged, ws, { fieldName: field }); return field;
        });
      };
      ws.applyRelativeDateFilterAsync = function (field, o) {
        log({ op: 'applyRelativeDateFilterAsync', sheet: name, field: field, anchor: o.anchorDate, periodType: o.periodType, rangeType: o.rangeType, rangeN: o.rangeN });
        return later(function () {
          var f = ws.filters[field]; if (!f || f.filterType !== 'relative-date') throw new Error('no relative date filter ' + field);
          if (!(o.anchorDate instanceof Date)) throw new Error('anchorDate must be a Date');
          f.anchorDate = dv(o.anchorDate); f.periodType = o.periodType; f.rangeType = o.rangeType; f.rangeN = o.rangeN;
          fire(EV.FilterChanged, ws, { fieldName: field }); return field;
        });
      };
      ws.clearFilterAsync = function (field) {
        log({ op: 'clearFilterAsync', sheet: name, field: field });
        return later(function () { var f = ws.filters[field]; if (f && f._reset) f._reset(); fire(EV.FilterChanged, ws, { fieldName: field }); return field; });
      };
      ws.selectMarksByValueAsync = function (sel, type) {
        log({ op: 'selectMarksByValueAsync', sheet: name, field: sel[0].fieldName, values: sel[0].value.slice(), type: type });
        return later(function () { ws.selected = { field: sel[0].fieldName, values: sel[0].value.slice() }; fire(EV.MarkSelectionChanged, ws); });
      };
      ws.clearSelectedMarksAsync = function () { log({ op: 'clearSelectedMarksAsync', sheet: name }); return later(function () { ws.selected = null; fire(EV.MarkSelectionChanged, ws); }); };
      ws.getSummaryDataReaderAsync = function () {
        if (ws.open) return Promise.reject(new Error('A DataTableReader is already open on ' + name));
        ws.open = true;
        var visible = view(ws), cols = ws._cols;
        return later(function () {
          return { pageCount: 1, totalRowCount: visible.length,
            getPageAsync: function () { return later(function () { return { columns: cols.map(function (c, i) { return { fieldName: c, index: i, dataType: typeof visible[0] === 'object' && typeof (visible[0] || {})[c] === 'number' ? 'float' : 'string' }; }),
              data: visible.map(function (r) { return cols.map(function (c) { return dv(r[c]); }); }) }; }); },
            releaseAsync: function () { ws.open = false; return later(function () {}); } };
        });
      };
      ws.addEventListener = listen(ws);
      return ws;
    }
    function domainOf(field) { var s = {}, out = []; DATA.forEach(function (r) { var k = r[field]; if (!s[k]) { s[k] = 1; out.push(k); } }); return out.sort().map(function (v) { return dv(v); }); }
    function Cat(ws, field, opts2) {
      var dom = domainOf(field), f = { fieldName: field, filterType: 'categorical', worksheetName: ws.name, _domain: dom };
      f._reset = function () { f.appliedValues = dom.slice(); f.isAllSelected = true; f.isExcludeMode = false; };
      f._reset();
      if (opts2 && opts2.exclude) { f.appliedValues = dom.filter(function (d) { return d.value === opts2.exclude; }); f.isExcludeMode = true; f.isAllSelected = false; }
      f.getDomainAsync = function (t) { if (t !== 'database' && t !== 'relevant') throw new Error('bad domain type'); return later(function () { return { type: t, values: dom.slice() }; }); };
      ws.filters[field] = f; return f;
    }
    function Rng(ws, field, isDate) {
      var vals = DATA.map(function (r) { return r[field]; }), lo = vals.reduce(function (a, b) { return a < b ? a : b; }), hi = vals.reduce(function (a, b) { return a > b ? a : b; });
      var f = { fieldName: field, filterType: 'range', worksheetName: ws.name };
      f._reset = function () { f.minValue = dv(lo); f.maxValue = dv(hi); f.includeNullValues = true; };
      f._reset();
      f.getDomainAsync = function () { return later(function () { return { type: 'database', min: dv(lo), max: dv(hi) }; }); };
      ws.filters[field] = f; return f;
    }
    function Rel(ws, field) {
      var f = { fieldName: field, filterType: 'relative-date', worksheetName: ws.name };
      f._reset = function () { f.anchorDate = dv(new Date(Date.UTC(2026, 10, 24))); f.periodType = 'months'; f.rangeType = 'lastn'; f.rangeN = 3; };
      f._reset(); ws.filters[field] = f; return f;
    }
    var sheets = [WS('Sales by Region'), WS('Profit Trend'), WS('Orders')];
    sheets[0]._cols = ['Region', 'Category', 'Sales'];
    sheets[1]._cols = ['Order Date', 'Region', 'Profit'];
    sheets[2]._cols = ['Order ID', 'Customer', 'Segment', 'Region', 'Sales'];
    sheets.forEach(function (ws) { Cat(ws, 'Region'); });
    Cat(sheets[0], 'Category');
    Rng(sheets[1], 'Order Date', true);
    sheets[1].filters.Product = { fieldName: 'Product', filterType: 'hierarchical', worksheetName: 'Profit Trend' };
    Cat(sheets[2], 'Segment', { exclude: 'Home Office' });
    Rng(sheets[2], 'Sales');
    Rel(sheets[2], 'Ship Date');
    Cat(sheets[2], 'Customer');

    /* Rows a worksheet shows after its own filters (relative date is shown, not applied, to keep the mock small). */
    function view(ws) {
      return DATA.filter(function (r) {
        return Object.keys(ws.filters).every(function (k) {
          var f = ws.filters[k];
          if (f.filterType === 'categorical') { var inSet = f.appliedValues.some(function (d) { return d.value === r[k]; }); return f.isExcludeMode ? !inSet : inSet; }
          if (f.filterType === 'range') { var v = r[k]; return v >= f.minValue.value && v <= f.maxValue.value; }
          return true;
        });
      }).map(function (r) { var o = {}; ws._cols.forEach(function (c) { o[c] = c === 'Order Date' ? iso(r[c]) : r[c]; }); return o; });
    }

    /* ---- the dashboard and its zones ---- */
    var me = { id: 7, name: 'Settings Panel', type: 'extension', isFloating: true, isVisible: true, position: { x: 1000, y: 16 }, size: { width: 56, height: 56 } };
    var dashboard = {
      name: 'Superstore Overview', sheetType: 'dashboard', worksheets: sheets, size: { width: 1440, height: 900 },
      objects: [{ id: 3, name: 'Sales by Region', type: 'worksheet', isFloating: false, position: { x: 0, y: 0 }, size: { width: 720, height: 450 } }, me],
      getParametersAsync: function () { log({ op: 'getParametersAsync' }); return later(function () { return params.slice(); }); },
      moveAndResizeDashboardObjectsAsync: function (ups) {
        log({ op: 'moveAndResizeDashboardObjectsAsync', updates: ups });
        return later(function () {
          ups.forEach(function (u) {
            var o = dashboard.objects.filter(function (x) { return x.id === u.dashboardObjectID; })[0];
            if (!o) throw new Error('no object ' + u.dashboardObjectID);
            if (!o.isFloating) throw new Error('only floating objects move');
            o.position = { x: u.x, y: u.y }; o.size = { width: u.width, height: u.height };
          });
          if (mock.onZone) mock.onZone(me);
        });
      }
    };

    var st = {
      get: function (k) { return Object.prototype.hasOwnProperty.call(settings, k) ? settings[k] : undefined; },
      getAll: function () { var o = {}; Object.keys(settings).forEach(function (k) { o[k] = settings[k]; }); return o; },
      set: function (k, v) { if (typeof v !== 'string') throw new Error('settings values must be strings: ' + k); settings[k] = v; },
      erase: function (k) { delete settings[k]; },
      saveAsync: function () { saves.n++; log({ op: 'saveAsync' }); if (mock.persist) mock.persist(settings); return later(function () { return st.getAll(); }); }
    };
    Object.keys(opts.settings || {}).forEach(function (k) { settings[k] = String(opts.settings[k]); });

    var tableau = {
      TableauEventType: EV,
      FilterType: { Categorical: 'categorical', Range: 'range', Hierarchical: 'hierarchical', RelativeDate: 'relative-date' },
      extensions: {
        environment: { apiVersion: '1.12.0', context: 'desktop', mode: 'authoring', tableauVersion: '2024.2.0' },
        dashboardObjectId: me.id,
        dashboardContent: { dashboard: dashboard },
        settings: st,
        initializeAsync: function () { log({ op: 'initializeAsync' }); return later(function () { return undefined; }); }
      }
    };
    var mock = { tableau: tableau, calls: calls, settings: settings, saves: saves, params: params, sheets: sheets, dashboard: dashboard, me: me, data: DATA, view: view, onZone: null, persist: null,
      param: function (n) { return params.filter(function (p) { return p.name === n; })[0]; },
      sheet: function (n) { return sheets.filter(function (s) { return s.name === n; })[0]; } };
    return mock;
  }

  return { create: create, EV: EV };
});
