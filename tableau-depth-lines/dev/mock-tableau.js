/* A stand-in for the Tableau Extensions API, shaped like the Lollipop mock.
 * It proves OUR side of the contract in a plain browser. It does not prove
 * Tableau drives the extension correctly. Fidelity choices:
 *   - summary data comes in 10,000 row pages
 *   - a second reader while one is open is rejected, so a leak shows up here
 *   - settings come back as strings, like Tableau's own store
 * URL params: fx=<fixture> cat=0|1 weight=0|1 bg=<hex without #> still=1 bare=1 */
(function (global) {
  'use strict';
  var PAGE = 10000;
  var q = new URLSearchParams(global.location.search);
  if (q.get('still') === '1') global.DL_STILL = true;

  var ENC = {
    tumours: { x: 'Mean radius', y: 'Mean concave points', category: 'Diagnosis' },
    blobs: { x: 'Depth', y: 'Count', category: 'Zone', weight: 'Weight' },
    single: { x: 'X', y: 'Y' },
    tiny: { x: 'X', y: 'Y' },
    empty: { x: 'X', y: 'Y' }
  };

  function MockSheet () {
    this.name = 'Sheet 1'; this._fx = q.get('fx') || 'tumours'; this._open = null; this._listeners = {};
    this.selected = []; this.hovered = null; this.backgroundColor = q.get('bg') ? '#' + q.get('bg') : undefined;
    this.useCat = q.get('cat') !== '0'; this.useWeight = q.get('weight') !== '0';
  }
  MockSheet.prototype.fixture = function () { return global.DL_FIXTURES[this._fx]; };
  MockSheet.prototype.getSummaryDataReaderAsync = function () {
    var self = this;
    if (this._open) return Promise.reject(new Error('A DataTableReader is already open on this worksheet. Call releaseAsync first.'));
    var fx = this.fixture(), pages = Math.max(1, Math.ceil(fx.rows.length / PAGE));
    var reader = {
      pageCount: pages, totalRowCount: fx.rows.length,
      getPageAsync: function (i) {
        var sl = fx.rows.slice(i * PAGE, (i + 1) * PAGE);
        return Promise.resolve({
          columns: fx.columns.map(function (n, k) { return { fieldName: n, index: k, dataType: typeof (fx.rows[0] || [])[k] === 'number' ? 'float' : 'string' }; }),
          data: sl.map(function (r) { return r.map(function (v) { return { value: v, nativeValue: v, formattedValue: String(v) }; }); })
        });
      },
      releaseAsync: function () { self._open = null; return Promise.resolve(); }
    };
    this._open = reader;
    return Promise.resolve(reader);
  };
  MockSheet.prototype.getVisualSpecificationAsync = function () {
    var e = ENC[this._fx] || {}, self = this, enc = [];
    Object.keys(e).forEach(function (id) {
      if (id === 'category' && !self.useCat) return;
      if (id === 'weight' && !self.useWeight) return;
      enc.push({ id: id, fieldEncodingId: id + '-0', type: 'custom', field: { name: e[id], fieldId: 'f-' + e[id] } });
    });
    return Promise.resolve({ rowFields: [], columnFields: [], activeMarksSpecificationIndex: 0, marksSpecifications: [{ primitiveType: 'viz-extension', encodings: enc }] });
  };
  MockSheet.prototype.addEventListener = function (t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); return function () {}; };
  MockSheet.prototype._emit = function (t) { (this._listeners[t] || []).forEach(function (f) { f({ type: t }); }); };
  MockSheet.prototype.selectTuplesAsync = function (ids, mode) { this.selected = ids.slice(); this.lastMode = mode; return Promise.resolve(); };
  MockSheet.prototype.clearSelectedMarksAsync = function () { this.selected = []; return Promise.resolve(); };
  MockSheet.prototype.hoverTupleAsync = function (t) { this.hovered = t; return Promise.resolve(); };

  function MockSettings () { this._v = {}; this.saves = 0; }
  MockSettings.prototype.getAll = function () { var o = {}; for (var k in this._v) o[k] = this._v[k]; return o; };
  MockSettings.prototype.get = function (k) { return this._v[k]; };
  MockSettings.prototype.set = function (k, v) { this._v[k] = String(v); };
  MockSettings.prototype.erase = function (k) { delete this._v[k]; };
  MockSettings.prototype.saveAsync = function () { this.saves++; return Promise.resolve(this.getAll()); };

  var sheet = new MockSheet(), settings = new MockSettings();
  var pre = q.get('settings');   // URL-passed JSON, stored as strings with the extension prefix
  if (pre) { try { var o = JSON.parse(pre); Object.keys(o).forEach(function (k) { settings.set('depthlines.' + k, o[k]); }); } catch (e) { /* ignore */ } }

  global.tableau = {
    extensions: {
      initializeAsync: function () { return new Promise(function (r) { setTimeout(r, 0); }); },
      worksheetContent: { worksheet: sheet }, settings: settings,
      environment: { mode: 'authoring', apiVersion: '1.17.0', tableauVersion: 'mock' }
    },
    TableauEventType: { SummaryDataChanged: 'summary-data-changed', FilterChanged: 'filter-changed', ParameterChanged: 'parameter-changed', WorksheetFormattingChanged: 'worksheet-formatting-changed' }
  };
  global.DL_MOCK = { sheet: sheet, settings: settings, setFixture: function (k) { sheet._fx = k; sheet._emit('summary-data-changed'); } };
})(window);
