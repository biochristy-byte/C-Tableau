/* Settings Panel - entry point. A dashboard extension: initializeAsync, read every parameter and worksheet filter,
 * listen for ParameterChanged and FilterChanged, and keep the panel in step with the workbook.
 *
 * On first run it captures the workbook's current view as "the workbook defaults" (stored in extension settings),
 * so Reset always has something true to return to. If the extension is a floating object, it shrinks its own zone
 * to the gear when closed and grows it to the panel size when open (moveAndResizeDashboardObjectsAsync, guarded).
 * No network calls: every file it loads sits next to it.
 */
(function (global) {
  'use strict';
  var SP = global.SP, M = SP.model;
  var GEAR_BOX = 56;
  var state = { panel: null, dashboard: null, model: null, timer: null, reading: false, again: false, zone: null };
  function log () { if (global.console && console.warn) console.warn.apply(console, ['[SP]'].concat([].slice.call(arguments))); }

  function refresh(now) {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(read, now ? 0 : 120);
  }
  function read() {
    state.timer = null;
    if (state.reading) { state.again = true; return Promise.resolve(); }
    state.reading = true;
    return M.read(state.dashboard).then(function (m) {
      state.model = m;
      if (state.panel) state.panel.setModel(m);
    }, function (e) { log('read failed', e); if (state.panel) state.panel.say('Could not read the workbook: ' + ((e && e.message) || 'unknown error'), true); })
      .then(function () { state.reading = false; if (state.again) { state.again = false; return read(); } return undefined; });
  }

  /* The extension's own zone on the dashboard, when the API can move it. */
  function myZone() {
    var ext = global.tableau.extensions, d = state.dashboard, id = ext.dashboardObjectId;
    if (id === undefined || id === null || !d || !d.objects || typeof d.moveAndResizeDashboardObjectsAsync !== 'function') return null;
    return d.objects.filter(function (o) { return o.id === id; })[0] || null;
  }
  function fit(open, ps) {
    var z = myZone();
    if (!z || !z.isFloating) return;
    var dw = (state.dashboard.size && state.dashboard.size.width) || 1e9, dh = (state.dashboard.size && state.dashboard.size.height) || 1e9;
    var right = z.position.x + z.size.width, top = z.position.y;
    var w = open && ps.fit ? ps.w : GEAR_BOX, h = open && ps.fit ? ps.h : GEAR_BOX;
    if (!open && !ps.fit) return;
    w = Math.min(w, dw); h = Math.min(h, dh);
    var x = Math.max(0, Math.min(dw - w, right - w)), y = Math.max(0, Math.min(dh - h, top));
    if (z.size.width === w && z.size.height === h && z.position.x === x) return;
    var p = state.dashboard.moveAndResizeDashboardObjectsAsync([{ dashboardObjectID: z.id, x: x, y: y, width: w, height: h }]);
    if (p && p.catch) p.catch(function (e) { log('zone resize refused', e); });
  }

  function mount() {
    var ext = global.tableau.extensions;
    state.dashboard = ext.dashboardContent && ext.dashboardContent.dashboard;
    if (!state.dashboard) { log('no dashboardContent: add this as a dashboard extension'); return Promise.resolve(); }
    return M.read(state.dashboard).then(function (m) {
      state.model = m;
      var st = ext.settings;
      if (!M.loadDefaults(st)) {
        var snap = M.capture(m); snap.at = new Date().toISOString();
        try { M.saveDefaults(st, snap).catch(function (e) { log('could not save defaults', e); }); } catch (e) { log('could not save defaults', e); }
      }
      var z = myZone();
      state.panel = SP.panel.create(document.getElementById('sp-root'), { model: m, settings: st, canFit: !!(z && z.isFloating), onFit: fit, onRefresh: refresh });
      var T = global.tableau.TableauEventType || {};
      m.params.forEach(function (c) { if (c.ref.addEventListener && T.ParameterChanged) c.ref.addEventListener(T.ParameterChanged, function () { refresh(); }); });
      state.dashboard.worksheets.forEach(function (ws) {
        if (!ws.addEventListener) return;
        if (T.FilterChanged) ws.addEventListener(T.FilterChanged, function () { refresh(); });
        if (T.SummaryDataChanged) ws.addEventListener(T.SummaryDataChanged, function () { if (state.panel) state.panel.refreshMarks(); });
      });
      fit(false, state.panel.ps);
    });
  }

  function boot() {
    if (!global.tableau || !global.tableau.extensions) { log('Tableau Extensions API not present'); return; }
    /* The manifest adds Configure to the zone's menu; it opens the panel. */
    var configure = function () { if (state.panel) state.panel.open(); return Promise.resolve(); };
    global.SP_READY = global.tableau.extensions.initializeAsync({ configure: configure }).then(mount).catch(function (e) {
      log('initializeAsync failed', e);
      var r = document.getElementById('sp-root');
      if (r) { var d = document.createElement('div'); d.className = 'sp-fail'; d.textContent = 'The controls could not start. Check the browser console for details.'; r.appendChild(d); }
    });
  }

  SP.app = { boot: boot, state: state, refresh: refresh, read: read, fit: fit };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
