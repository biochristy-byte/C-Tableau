/* A stand-in for the Tableau Extensions API, shaped from the published type
 * declarations (@tableau/extensions-api-types) and the Lollipop mock.
 *
 * It exists so the renderer, the settings panel and the paging logic can be
 * proven in a plain browser. It does NOT prove Tableau Desktop drives this
 * extension correctly; it proves our side of the contract as documented.
 *
 * Fidelity choices:
 *   - summary data is served in 10,000 row pages, like the real reader
 *   - releaseAsync must run before a second reader can open, and the mock
 *     rejects a leak, so it fails loudly here instead of silently in Tableau
 *   - settings values come back as strings, because Tableau stores strings
 *   - selection and hover calls are recorded so tests can assert them
 */
(function (global) {
  'use strict';

  var PAGE_SIZE = 10000;

  function MockWorksheet () {
    this.name = 'Sheet 1';
    this.backgroundColor = null;
    this._fixtureKey = 'worm';
    this._listeners = {};
    this.calls = [];
    this._encodings = null;
    this._open = null;
  }

  MockWorksheet.prototype._fixture = function () { return global.NX_FIXTURES[this._fixtureKey]; };
  MockWorksheet.prototype._enc = function () { return this._encodings || this._fixture().enc; };

  MockWorksheet.prototype.getSummaryDataReaderAsync = function () {
    var self = this;
    if (this._open) return Promise.reject(new Error('A DataTableReader is already open on this worksheet. Call releaseAsync first.'));
    var fx = this._fixture();
    var rows = fx.rows, columns = fx.columns;
    var pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    var reader = {
      pageCount: pageCount,
      totalRowCount: rows.length,
      getPageAsync: function (i) {
        if (i < 0 || i >= pageCount) return Promise.reject(new RangeError('page out of range: ' + i));
        var slice = rows.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
        return Promise.resolve({
          columns: columns.map(function (name, idx) {
            return { fieldName: name, index: idx, dataType: typeof (rows[0] || {})[name] === 'number' ? 'float' : 'string' };
          }),
          data: slice.map(function (r) {
            return columns.map(function (c) {
              var v = r[c];
              return { value: v, formattedValue: v === null || v === undefined ? '' : String(v), nativeValue: v };
            });
          })
        });
      },
      releaseAsync: function () { self._open = null; return Promise.resolve(); }
    };
    this._open = reader;
    return Promise.resolve(reader);
  };

  MockWorksheet.prototype.getVisualSpecificationAsync = function () {
    var enc = [], e = this._enc();
    ['group', 'source', 'target', 'weight'].forEach(function (id) {
      if (e[id]) enc.push({ id: id, fieldEncodingId: id + '-0', type: 'custom', field: { name: e[id], fieldId: 'f-' + e[id] } });
    });
    return Promise.resolve({
      rowFields: [], columnFields: [], activeMarksSpecificationIndex: 0,
      marksSpecifications: [{ primitiveType: 'viz-extension', encodings: enc }]
    });
  };

  MockWorksheet.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
    return function () {};
  };
  MockWorksheet.prototype._emit = function (type) {
    (this._listeners[type] || []).forEach(function (f) { try { f({ type: type }); } catch (e) { console.error('[mock] listener threw', e); } });
  };

  MockWorksheet.prototype.selectMarksByValueAsync = function (criteria, mode) {
    this.calls.push({ call: 'selectMarksByValue', criteria: JSON.parse(JSON.stringify(criteria)), mode: mode });
    global.dispatchEvent(new CustomEvent('nx-mock-call', { detail: this.calls[this.calls.length - 1] }));
    return Promise.resolve();
  };
  MockWorksheet.prototype.clearSelectedMarksAsync = function () {
    this.calls.push({ call: 'clearSelectedMarks' });
    global.dispatchEvent(new CustomEvent('nx-mock-call', { detail: this.calls[this.calls.length - 1] }));
    return Promise.resolve();
  };
  MockWorksheet.prototype.hoverTupleAsync = function (tuple) {
    this.calls.push({ call: 'hoverTuple', tuple: tuple });
    global.dispatchEvent(new CustomEvent('nx-mock-call', { detail: this.calls[this.calls.length - 1] }));
    return Promise.resolve();
  };

  function MockSettings () { this._v = {}; this.saveCount = 0; }
  MockSettings.prototype.getAll = function () { var o = {}; for (var k in this._v) o[k] = this._v[k]; return o; };
  MockSettings.prototype.get = function (k) { return this._v[k]; };
  MockSettings.prototype.set = function (k, v) { this._v[k] = String(v); };
  MockSettings.prototype.erase = function (k) { delete this._v[k]; };
  MockSettings.prototype.saveAsync = function () {
    this.saveCount++;
    var snap = this.getAll();
    try { global.localStorage.setItem('nx-mock-settings', JSON.stringify(snap)); } catch (e) { /* private mode */ }
    return Promise.resolve(snap);
  };
  MockSettings.prototype._restore = function () {
    try { var raw = global.localStorage.getItem('nx-mock-settings'); if (raw) this._v = JSON.parse(raw); } catch (e) { /* ignore */ }
  };

  var worksheet = new MockWorksheet();
  var settings = new MockSettings();
  settings._restore();

  global.tableau = {
    extensions: {
      initializeAsync: function () { return new Promise(function (res) { setTimeout(res, 0); }); },
      worksheetContent: { worksheet: worksheet },
      settings: settings,
      environment: { mode: 'authoring', apiVersion: '1.17.0', tableauVersion: 'mock' },
      ui: { displayDialogAsync: function () { return Promise.reject(new Error('not implemented in mock')); } }
    },
    TableauEventType: {
      SummaryDataChanged: 'summary-data-changed', FilterChanged: 'filter-changed', ParameterChanged: 'parameter-changed',
      MarkSelectionChanged: 'mark-selection-changed', SettingsChanged: 'settings-changed', WorksheetFormattingChanged: 'worksheet-formatting-changed'
    },
    SelectionUpdateType: { Replace: 'select-replace', Add: 'select-add', Remove: 'select-remove' },
    MarkType: { VizExtension: 'viz-extension' }
  };

  global.NX_MOCK = {
    worksheet: worksheet,
    settings: settings,
    setFixture: function (key) { worksheet._fixtureKey = key; worksheet._encodings = null; worksheet._emit('summary-data-changed'); },
    setEncoding: function (id, name) {
      if (!worksheet._encodings) { var cur = worksheet._fixture().enc; worksheet._encodings = { group: cur.group, source: cur.source, target: cur.target, weight: cur.weight }; }
      worksheet._encodings[id] = name || null;
      worksheet._emit('summary-data-changed');
    },
    setBackground: function (hex) { worksheet.backgroundColor = hex || null; worksheet._emit('summary-data-changed'); },
    clearSettings: function () { settings._v = {}; try { global.localStorage.removeItem('nx-mock-settings'); } catch (e) { /* ignore */ } global.location.reload(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
