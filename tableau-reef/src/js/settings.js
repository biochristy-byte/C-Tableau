/* Reef - the settings schema, built on the shared ctab-panel. Chart-specific rows plus the standard tabs.
 * One source of truth: the panel is generated from it and the renderer reads the resolved values.
 *
 * Saved keys: every key Reef shipped with is kept (palette, gap, labels, fontSize, theme, zoomMs ...), so a workbook
 * saved before the panel change keeps its look. Two old settings changed shape and are read as a fallback:
 *   fontFamily (a CSS font stack)  ->  font (a ctab-panel font id)
 *   valueFormat (compact | plain)  ->  numCompact (true | false)
 * LEGACY below does that translation; the tests cover it.
 */
(function (root, factory) {
  var CP = typeof require === 'function' && typeof module === 'object' ? require('../../lib/ctab-panel/ctab-panel.js') : root.CTabPanel;
  var s = factory(CP);
  if (typeof module === 'object' && module.exports) module.exports = s;
  else { root.RF = root.RF || {}; root.RF.settings = s; }
})(typeof window !== 'undefined' ? window : globalThis, function (CP) {
  'use strict';

  var std = CP.standard({
    fields: [
      { key: 'fieldLevel1', label: 'Level 1 field', help: 'The outer groups. Auto uses the Level 1 shelf.' },
      { key: 'fieldLevel2', label: 'Level 2 field', help: 'The circles inside each group. Auto uses the Level 2 shelf.' },
      { key: 'fieldLevel3', label: 'Level 3 field', help: 'The circles inside those. Auto uses the Level 3 shelf.' },
      { key: 'fieldSize', label: 'Size field', kind: 'numeric', help: 'The measure that sets each circle\'s area. Auto uses the Size shelf.' }
    ],
    over: {
      numCompact: { def: true, help: 'Reef has always shown 1.2M style values: this is on by default.' },
      numDecimals: { def: 1, help: 'Whole numbers that are not shortened never show decimals.' },
      animMs: { def: 800, label: 'Entrance duration' },
      hoverMs: { def: 0, help: 'How long the hover outline and the dimming take. 0 is instant, as before.' },
      dimOthers: { def: 60, label: 'Dim the others to', help: 'Used for the circle you click, and for hover when "Dim the others on hover" is on.', when: undefined },
      hoverPush: { def: true },
      padding: { def: 0, label: 'Padding around the chart' },
      labelWeight: { def: 'bold' },
      tipMaxW: { def: 260 },
      titleSize: { def: 18 }
    }
  });

  /* Reef's own names for settings the standard rows also offer. The saved key stays the old one. */
  var RENAME = { labelsOn: 'labels', labelSize: 'fontSize', tipOn: 'tooltips', selectOn: 'selectEnabled', animOn: 'intro', fontFamily: 'font', bgMode: 'theme', bgColor: 'customBg' };
  var DROP = { palette: 1, labelLines: 1, valueLabels: 1, valueLabelSize: 1 };

  function remapWhen(w) {
    if (!w || typeof w === 'function') return w;
    if (Array.isArray(w)) return w.map(remapWhen);
    var o = {}; Object.keys(w).forEach(function (k) { o[k] = w[k]; });
    if (RENAME[o.key]) o.key = RENAME[o.key];
    return o;
  }
  var stdRows = std.rows.filter(function (r) { return !DROP[r.key]; }).map(function (r) {
    var o = {}; Object.keys(r).forEach(function (k) { o[k] = r[k]; });
    if (RENAME[o.key]) o.key = RENAME[o.key];
    if (o.when) o.when = remapWhen(o.when);
    if (o.key === 'theme') {
      o.opts = [['worksheet', 'Worksheet'], ['light', 'Light'], ['dark', 'Dark'], ['custom', 'Custom'], ['transparent', 'Transparent']]; o.def = 'worksheet';
      o.help = 'Worksheet follows the sheet\'s own background. Transparent lets the dashboard show through.';
    }
    if (o.key === 'customBg') { o.def = '#0d2b45'; o.when = { key: 'theme', eq: 'custom' }; }
    if (o.key === 'dimOthers') delete o.when;
    return o;
  });

  var FIELDS_TAB = std.tabs.filter(function (t) { return t.id === 'fields'; });
  var STD_TABS = std.tabs.filter(function (t) { return t.id !== 'fields'; });
  var TABS = [{ id: 'packing', label: 'Packing' }, { id: 'depth', label: 'Depth' }, { id: 'zoom', label: 'Zoom' }, { id: 'rings', label: 'Rings' }, { id: 'legend', label: 'Legend' }]
    .concat(STD_TABS).concat(FIELDS_TAB);
  TABS.sort(function (a, b) { return order(a.id) - order(b.id); });
  function order(id) {
    var o = ['colors', 'packing', 'depth', 'zoom', 'rings', 'labels', 'legend', 'numbers', 'tooltip', 'fonts', 'background', 'animation', 'interaction', 'fields'];
    return o.indexOf(id);
  }

  var CHART = [
    /* Colors */
    { tab: 'colors', sec: 'Color by', key: 'colorMode', label: 'Color by', type: 'select', def: 'group',
      opts: [['group', 'Top-level group'], ['field', 'A field from Detail'], ['depth', 'Level'], ['single', 'One color']],
      help: 'Field: drop a dimension or measure on Detail, then pick it below.' },
    { tab: 'colors', sec: 'Color by', key: 'colorField', label: 'Color field', type: 'field', kind: 'any', def: '', when: { key: 'colorMode', eq: 'field' }, help: 'Pick a column. A number gives a ramp, text gives one color per value.' },
    { tab: 'colors', sec: 'Color by', key: 'singleColor', label: 'One color', type: 'color', def: '#3cc4d1', when: { key: 'colorMode', eq: 'single' } },
    { tab: 'colors', sec: 'Palette', key: 'palette', label: 'Palette', type: 'select', def: 'reef',
      opts: [['reef', 'Reef (default)'], ['lagoon', 'Lagoon'], ['sunset', 'Sunset'], ['datadivers', 'Data Divers'], ['kelp', 'Kelp'], ['colorblind10', 'Colorblind safe']] },
    { tab: 'colors', sec: 'Palette', key: 'rampName', label: 'Number ramp', type: 'select', def: 'reef', opts: [['reef', 'Reef'], ['lagoon', 'Lagoon'], ['sunset', 'Sunset']],
      when: { key: 'colorMode', eq: 'field' }, help: 'Used when the color field is a number.' },

    /* Packing */
    { tab: 'packing', sec: 'Spacing', key: 'gap', label: 'Gap between circles', type: 'number', min: 0, max: 40, step: 1, def: 5 },
    { tab: 'packing', sec: 'Spacing', key: 'topGap', label: 'Extra gap between top-level groups', type: 'number', min: 0, max: 60, step: 1, def: 0 },
    { tab: 'packing', sec: 'Spacing', key: 'groupPad', label: 'Extra room inside groups', type: 'number', min: 0, max: 40, step: 1, def: 0, help: 'Space between a group\'s ring and the circles inside it.' },
    { tab: 'packing', sec: 'Size', key: 'margin', label: 'Edge margin', type: 'number', min: 0, max: 80, step: 2, unit: 'px', def: 12 },
    { tab: 'packing', sec: 'Size', key: 'sizePct', label: 'Chart size', type: 'number', min: 40, max: 100, step: 5, unit: '%', def: 100, help: 'Share of the available room the circles fill.' },
    { tab: 'packing', sec: 'Size', key: 'hideBelow', label: 'Hide circles under', type: 'number', min: 0, max: 40, step: 1, unit: 'px', def: 2 },
    { tab: 'packing', sec: 'Order', key: 'sort', label: 'Order circles', type: 'chips', def: 'size', opts: [['size', 'Largest first'], ['name', 'Name, A to Z'], ['data', 'Data order']] },
    { tab: 'packing', sec: 'Order', key: 'sortReverse', label: 'Reverse the order', type: 'check', def: false },

    /* Depth */
    { tab: 'depth', sec: 'Levels', key: 'maxDepth', label: 'Levels to draw', type: 'number', min: 1, max: 3, step: 1, def: 3, help: '1 draws only the Level 1 circles, 2 adds Level 2, 3 adds Level 3.' },
    { tab: 'depth', sec: 'Levels', key: 'foldSingle', label: 'Fold a group with one circle into that circle', type: 'check', def: true, help: 'Off keeps a ring around a lone circle.' },
    { tab: 'depth', sec: 'Levels', key: 'outerRing', label: 'Draw the outer circle', type: 'check', def: true, help: 'The faint circle that holds everything.' },
    { tab: 'depth', sec: 'Levels', key: 'depthTint', label: 'Darken each deeper group by', type: 'number', min: 0, max: 20, step: 1, unit: '%', def: 4 },

    /* Zoom */
    { tab: 'zoom', sec: 'Zoom', key: 'zoomOnClick', label: 'Click to zoom', type: 'check', def: true },
    { tab: 'zoom', sec: 'Zoom', key: 'zoomMs', label: 'Zoom time', type: 'number', min: 150, max: 2000, step: 50, unit: 'ms', def: 700, when: { key: 'zoomOnClick', truthy: true } },
    { tab: 'zoom', sec: 'Zoom', key: 'zoomEase', label: 'Zoom easing', type: 'chips', def: 'inout', opts: [['inout', 'Ease in-out'], ['out', 'Ease out'], ['linear', 'Linear']], when: { key: 'zoomOnClick', truthy: true } },
    { tab: 'zoom', sec: 'Zoom', key: 'zoomLeaf', label: 'Clicking a small circle zooms to its group', type: 'check', def: true, when: { key: 'zoomOnClick', truthy: true } },
    { tab: 'zoom', sec: 'Zoom', key: 'clickOut', label: 'Clicking the zoomed circle zooms back out', type: 'check', def: true, when: { key: 'zoomOnClick', truthy: true } },
    { tab: 'zoom', sec: 'Zoom', key: 'escUp', label: 'Escape and Backspace zoom out', type: 'check', def: true },
    { tab: 'zoom', sec: 'Breadcrumb', key: 'breadcrumb', label: 'Show breadcrumb', type: 'check', def: true },
    { tab: 'zoom', sec: 'Breadcrumb', key: 'crumbStyle', label: 'Breadcrumb style', type: 'chips', def: 'pills', opts: [['pills', 'Pills'], ['text', 'Plain text']], when: { key: 'breadcrumb', truthy: true } },
    { tab: 'zoom', sec: 'Breadcrumb', key: 'rootName', label: 'Name of the top step', type: 'text', def: 'All', maxLength: 30, when: { key: 'breadcrumb', truthy: true } },

    /* Rings */
    { tab: 'rings', sec: 'Fill', key: 'groupFill', label: 'Group shading', type: 'number', min: 0, max: 60, step: 2, unit: '%', def: 18 },
    { tab: 'rings', sec: 'Fill', key: 'leafOpacity', label: 'Circle opacity', type: 'number', min: 30, max: 100, step: 2, unit: '%', def: 92 },
    { tab: 'rings', sec: 'Outline', key: 'ringWidth', label: 'Outline width', type: 'number', min: 0, max: 6, step: 0.5, unit: 'px', def: 1.5 },
    { tab: 'rings', sec: 'Outline', key: 'ringStyle', label: 'Outline line', type: 'chips', def: 'solid', opts: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']] },
    { tab: 'rings', sec: 'Outline', key: 'ringColorMode', label: 'Outline color', type: 'chips', def: 'shade', opts: [['shade', 'Shade of the fill'], ['ink', 'Text color']] },
    { tab: 'rings', sec: 'Outline', key: 'ringOpacity', label: 'Outline opacity', type: 'number', min: 10, max: 100, step: 5, unit: '%', def: 90 },
    { tab: 'rings', sec: 'Emphasis', key: 'hoverRing', label: 'Hover outline width', type: 'number', min: 1, max: 8, step: 1, unit: 'px', def: 3, help: 'Shown when Highlight on hover is on (Interaction tab).' },
    { tab: 'rings', sec: 'Emphasis', key: 'selRing', label: 'Selected outline width', type: 'number', min: 1, max: 8, step: 1, unit: 'px', def: 4 },

    /* Labels (the standard Labels rows come with std) */
    { tab: 'labels', sec: 'Which circles', key: 'groupLabels', label: 'Label groups', type: 'check', def: true, when: { key: 'labels', truthy: true } },
    { tab: 'labels', sec: 'Which circles', key: 'showValues', label: 'Show values', type: 'check', def: true, when: { key: 'labels', truthy: true } },
    { tab: 'labels', sec: 'Which circles', key: 'labelMinR', label: 'Skip labels on circles smaller than', type: 'number', min: 0, max: 200, step: 5, unit: 'px', def: 0,
      when: { key: 'labels', truthy: true }, help: 'Radius in pixels. 0 labels every circle a label fits in.' },
    { tab: 'labels', sec: 'Look', key: 'labelPlace', label: 'Group labels sit', type: 'chips', def: 'top', opts: [['top', 'At the top'], ['center', 'In the middle']], when: { key: 'labels', truthy: true } },
    { tab: 'labels', sec: 'Look', key: 'chipStyle', label: 'Label chip', type: 'chips', def: 'filled', opts: [['filled', 'Filled'], ['outline', 'Outline only'], ['plain', 'Text only']], when: { key: 'labels', truthy: true } },
    { tab: 'labels', sec: 'Look', key: 'labelCase', label: 'Letter case', type: 'chips', def: 'asis', opts: [['asis', 'As written'], ['upper', 'UPPER'], ['lower', 'lower']], when: { key: 'labels', truthy: true } },

    /* Legend */
    { tab: 'legend', sec: 'Legend', key: 'legend', label: 'Show legend', type: 'check', def: true },
    { tab: 'legend', sec: 'Legend', key: 'legendPos', label: 'Position', type: 'chips', def: 'bottom', opts: [['bottom', 'Bottom'], ['top', 'Top']], when: { key: 'legend', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'legendMax', label: 'Most entries shown', type: 'number', min: 2, max: 30, step: 1, def: 10, when: { key: 'legend', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'legendShape', label: 'Swatch shape', type: 'chips', def: 'circle', opts: [['circle', 'Circle'], ['square', 'Square']], when: { key: 'legend', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'legendTitle', label: 'Title', type: 'text', def: '', maxLength: 40, placeholder: 'No title', when: { key: 'legend', truthy: true } },

    /* Animation */
    { tab: 'animation', sec: 'Labels', key: 'labelFadeMs', label: 'Label fade-in', type: 'number', min: 0, max: 1000, step: 20, unit: 'ms', def: 220, help: 'How long the labels take to appear once a zoom settles.' },

    /* Interaction */
    { tab: 'interaction', sec: 'Marks', key: 'hoverDim', label: 'Dim the others on hover', type: 'check', def: false, when: { key: 'hoverOn', truthy: true } },
    { tab: 'interaction', sec: 'Marks', key: 'multiSel', label: 'Ctrl or Shift click adds to the selection', type: 'check', def: true, when: { key: 'selectEnabled', truthy: true } },
    { tab: 'interaction', sec: 'Panel', key: 'gearCorner', label: 'Gear corner', type: 'chips', def: 'tr', opts: [['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']] }
  ];

  var ALL = CHART.concat(stdRows);
  var schema = { tabs: TABS, rows: ALL };
  var prepared = CP.prepare(schema);
  var FIELD_KEYS = { fieldLevel1: 1, fieldLevel2: 1, fieldLevel3: 1, fieldSize: 1 };

  /* Old saved values, read when the new key has nothing saved. get(key) reads one stored setting, returns undefined if none. */
  var FONT_BY_FIRST = { inter: 'worksheet', '"segoe ui"': 'segoe', arial: 'arial', '"helvetica neue"': 'helvetica', '"trebuchet ms"': 'trebuchet', verdana: 'verdana', tahoma: 'tahoma' };
  var LEGACY = {
    font: function (get) {
      var v = get('fontFamily'); if (typeof v !== 'string' || !v) return undefined;
      var first = v.split(',')[0].trim().toLowerCase();
      return FONT_BY_FIRST[first];
    },
    numCompact: function (get) {
      var v = get('valueFormat');
      return v === 'plain' ? 'false' : v === 'compact' ? 'true' : undefined;
    }
  };
  /* A settings object that answers a missing new key from its old one. Wraps tableau.extensions.settings. */
  function withLegacy(st) {
    function get(k) {
      var v = st.get(k);
      if (v !== undefined && v !== null) return v;
      var m = /^(.*\.)([^.]+)$/.exec(k), pre = m ? m[1] : '', key = m ? m[2] : k;
      if (LEGACY[key]) { var lv = LEGACY[key](function (old) { return st.get(pre + old); }); if (lv !== undefined) return lv; }
      return v;
    }
    return { get: get, set: function (k, v) { return st.set(k, v); }, getAll: function () { return st.getAll ? st.getAll() : {}; },
      saveAsync: function () { return st.saveAsync(); }, erase: function (k) { return st.erase && st.erase(k); } };
  }

  return { schema: schema, prepared: prepared, DEFAULTS: CP.defaultsOf(prepared.rows), FIELD_KEYS: FIELD_KEYS, LEGACY: LEGACY, withLegacy: withLegacy, RENAME: RENAME,
    KEYS: prepared.rows.filter(function (r) { return r.type !== 'note'; }).map(function (r) { return r.key; }) };
});
