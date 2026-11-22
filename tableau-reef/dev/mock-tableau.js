/* A stand-in for the Tableau Extensions API, shaped from the published type
 * declarations and the Lollipop mock. It proves OUR side of the contract; it
 * does not prove Tableau Desktop drives the extension (see README).
 *   - summary data in 10,000-row pages; a second reader before releaseAsync REJECTS
 *   - settings come back as strings, exactly like Tableau
 *   - every selection, hover and clear call is recorded on RF_MOCK.calls
 */
(function (global) {
  'use strict';
  var PAGE = 10000;
  function Sheet() {
    this.name = 'Sheet 1'; this.backgroundColor = '#ffffff'; this.key = 'causes'; this.listeners = {}; this.open = null;
    this.enc = null;
  }
  Sheet.prototype.fx = function () { return global.RF_FIXTURES[this.key]; };
  Sheet.prototype.getSummaryDataReaderAsync = function () {
    var self = this;
    if (this.open) return Promise.reject(new Error('A DataTableReader is already open on this worksheet. Call releaseAsync first.'));
    var f = this.fx(), n = Math.max(1, Math.ceil(f.rows.length / PAGE));
    var reader = {
      pageCount: n, totalRowCount: f.rows.length,
      getPageAsync: function (i) {
        var sl = f.rows.slice(i * PAGE, (i + 1) * PAGE);
        return Promise.resolve({
          columns: f.columns.map(function (c, ix) { return { fieldName: c, index: ix, dataType: typeof (f.rows[0] || {})[c] === 'number' ? 'float' : 'string' }; }),
          data: sl.map(function (r) { return f.columns.map(function (c) { var v = r[c]; return { value: v, nativeValue: v, formattedValue: v === null || v === undefined ? '' : String(v) }; }); })
        });
      },
      releaseAsync: function () { self.open = null; return Promise.resolve(); }
    };
    this.open = reader; return Promise.resolve(reader);
  };
  Sheet.prototype.getVisualSpecificationAsync = function () {
    var enc = this.enc || this.fx().enc, out = [];
    Object.keys(enc).forEach(function (id) { if (enc[id]) out.push({ id: id, fieldEncodingId: id + '-0', type: 'custom', field: { name: enc[id], fieldId: 'f-' + id } }); });
    return Promise.resolve({ rowFields: [], columnFields: [], activeMarksSpecificationIndex: 0, marksSpecifications: [{ primitiveType: 'viz-extension', encodings: out }] });
  };
  Sheet.prototype.addEventListener = function (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); return function () {}; };
  Sheet.prototype.emit = function (t) { (this.listeners[t] || []).forEach(function (f) { try { f({ type: t }); } catch (e) { console.error('[mock] listener threw', e); } }); };
  Sheet.prototype.selectMarksByValueAsync = function (sel, mode) { RF_MOCK.calls.push({ call: 'select', sel: sel, mode: mode }); return Promise.resolve(); };
  Sheet.prototype.clearSelectedMarksAsync = function () { RF_MOCK.calls.push({ call: 'clear' }); return Promise.resolve(); };
  Sheet.prototype.hoverTupleAsync = function (t) { RF_MOCK.calls.push({ call: 'hover', tuple: t }); return Promise.resolve(); };

  function Settings() { this.v = {}; this.saves = 0; }
  Settings.prototype.getAll = function () { var o = {}; for (var k in this.v) o[k] = this.v[k]; return o; };
  Settings.prototype.get = function (k) { return this.v[k]; };
  Settings.prototype.set = function (k, x) { this.v[k] = String(x); };
  Settings.prototype.erase = function (k) { delete this.v[k]; };
  Settings.prototype.saveAsync = function () { this.saves++; try { global.localStorage.setItem('rf-mock-settings', JSON.stringify(this.v)); } catch (e) { /* private mode */ } return Promise.resolve(this.getAll()); };
  var sheet = new Sheet(), settings = new Settings();
  if (!/[?&]fresh=1/.test(global.location.search)) { try { var raw = global.localStorage.getItem('rf-mock-settings'); if (raw) settings.v = JSON.parse(raw); } catch (e) { /* ignore */ } }

  global.tableau = {
    extensions: { initializeAsync: function () { return new Promise(function (r) { setTimeout(r, 0); }); }, worksheetContent: { worksheet: sheet }, settings: settings,
      environment: { mode: 'authoring', apiVersion: '1.17.0', tableauVersion: 'mock' } },
    TableauEventType: { SummaryDataChanged: 'summary-data-changed', FilterChanged: 'filter-changed', ParameterChanged: 'parameter-changed',
      MarkSelectionChanged: 'mark-selection-changed', SettingsChanged: 'settings-changed', WorksheetFormattingChanged: 'worksheet-formatting-changed' },
    SelectionUpdateType: { Replace: 'select-replace', Add: 'select-add', Remove: 'select-remove' }
  };
  var param = /[?&]fixture=([a-z0-9]+)/.exec(global.location.search); if (param && global.RF_FIXTURES[param[1]]) sheet.key = param[1];
  var bgp = /[?&]bg=([0-9a-f]{6})/i.exec(global.location.search); if (bgp) sheet.backgroundColor = '#' + bgp[1];
  global.RF_MOCK = {
    sheet: sheet, settings: settings, calls: [],
    setFixture: function (k) { sheet.key = k; sheet.enc = null; sheet.emit('summary-data-changed'); },
    setEncoding: function (id, name) { sheet.enc = Object.assign({}, sheet.enc || sheet.fx().enc); sheet.enc[id] = name || null; sheet.emit('summary-data-changed'); },
    setBackground: function (hex) { sheet.backgroundColor = hex; sheet.emit('summary-data-changed'); },
    clearSettings: function () { settings.v = {}; try { global.localStorage.removeItem('rf-mock-settings'); } catch (e) { /* ignore */ } global.location.reload(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
