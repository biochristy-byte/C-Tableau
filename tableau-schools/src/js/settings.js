/* Schools - the settings schema, built on the shared ctab-panel. Chart-specific rows plus the standard tabs.
 * One source of truth: the panel is generated from it and the renderer reads the resolved values.
 *
 * Saved keys: every key Schools shipped with is kept (palette, pad, spread, pull, labels, fontSize, theme, animMs ...),
 * so a workbook saved before the panel change keeps its look. Two old settings changed shape and are read as a fallback:
 *   fontFamily (a CSS font stack)  ->  font (a ctab-panel font id)
 *   valueFormat (compact | plain)  ->  numCompact (true | false)
 * LEGACY below does that translation; the tests cover it.
 */
(function (root, factory) {
  var CP = typeof require === 'function' && typeof module === 'object' ? require('../../lib/ctab-panel/ctab-panel.js') : root.CTabPanel;
  var s = factory(CP);
  if (typeof module === 'object' && module.exports) module.exports = s;
  else { root.SC = root.SC || {}; root.SC.settings = s; }
})(typeof window !== 'undefined' ? window : globalThis, function (CP) {
  'use strict';

  var std = CP.standard({
    fields: [
      { key: 'fieldItem', label: 'Item field', help: 'The dimension that makes one circle each. Auto uses the Item shelf.' },
      { key: 'fieldCluster', label: 'Cluster field', help: 'The dimension that groups circles into clusters. Auto uses the Cluster shelf.' },
      { key: 'fieldSize', label: 'Size field', kind: 'numeric', help: 'The measure that sets each circle\'s area. Auto uses the Size shelf.' },
      { key: 'fieldColor', label: 'Color field', help: 'The dimension that colors the circles when Color by is "Color shelf". Auto uses the Color shelf.' }
    ],
    over: {
      numCompact: { def: true, help: 'Schools has always shown 1.2M style values: this is on by default.' },
      numDecimals: { def: 1, help: 'Whole numbers that are not shortened never show decimals.' },
      animMs: { def: 800, label: 'Entrance and morph duration' },
      hoverMs: { def: 0, help: 'How long the hover outline and the dimming take. 0 is instant, as before.' },
      dimOthers: { def: 30, label: 'Dim the other clusters to', help: 'Shown while you hover a circle or a cluster name.' },
      hoverPush: { def: true },
      padding: { def: 0, label: 'Padding around the chart' },
      labelWeight: { def: 'bold' },
      tipMaxW: { def: 260 },
      titleSize: { def: 18 }
    }
  });

  /* Schools' own names for settings the standard rows also offer. The saved key stays the old one. */
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
    return o;
  });

  var ORDER = ['colors', 'layout', 'collision', 'size', 'circles', 'labels', 'clabels', 'legend', 'numbers', 'tooltip', 'fonts', 'background', 'animation', 'interaction', 'fields'];
  var TABS = [{ id: 'layout', label: 'Cluster layout' }, { id: 'collision', label: 'Collisions' }, { id: 'size', label: 'Size scale' }, { id: 'circles', label: 'Circles' },
    { id: 'clabels', label: 'Cluster labels' }, { id: 'legend', label: 'Legend' }].concat(std.tabs);
  TABS.sort(function (a, b) { return ORDER.indexOf(a.id) - ORDER.indexOf(b.id); });

  var CHART = [
    /* Colors */
    { tab: 'colors', sec: 'Color by', key: 'colorMode', label: 'Color by', type: 'select', def: 'cluster', opts: [['cluster', 'Cluster'], ['field', 'Color shelf'], ['single', 'One color']],
      help: 'Color shelf uses the field you drop on the Color shelf.' },
    { tab: 'colors', sec: 'Color by', key: 'singleColor', label: 'One color', type: 'color', def: '#3cc4d1', when: { key: 'colorMode', eq: 'single' } },
    { tab: 'colors', sec: 'Palette', key: 'palette', label: 'Palette', type: 'select', def: 'reef',
      opts: [['reef', 'Reef (default)'], ['lagoon', 'Lagoon'], ['sunset', 'Sunset'], ['datadivers', 'Data Divers'], ['kelp', 'Kelp'], ['colorblind10', 'Colorblind safe']] },

    /* Cluster layout */
    { tab: 'layout', sec: 'Clusters', key: 'spread', label: 'Gap between clusters', type: 'number', min: 0, max: 120, step: 4, unit: 'px', def: 28 },
    { tab: 'layout', sec: 'Clusters', key: 'pull', label: 'Cluster pull', type: 'number', min: 1, max: 10, step: 1, def: 5, help: 'How hard circles are drawn to their cluster. 1 is loose, 10 is tight.' },
    { tab: 'layout', sec: 'Clusters', key: 'density', label: 'Cluster tightness', type: 'number', min: 40, max: 90, step: 5, unit: '%', def: 60, help: 'How full each cluster\'s territory is. Lower leaves air between the circles.' },
    { tab: 'layout', sec: 'Clusters', key: 'stretch', label: 'Fill the stage sideways', type: 'check', def: true, help: 'Spreads the clusters toward the shape of the chart so a wide chart is not left with empty sides.' },
    { tab: 'layout', sec: 'Clusters', key: 'ticks', label: 'Settling effort', type: 'number', min: 60, max: 600, step: 20, def: 300, help: 'How long the physics runs before the picture is drawn. More is calmer, and slower on big data.' },
    { tab: 'layout', sec: 'Frame', key: 'margin', label: 'Edge margin', type: 'number', min: 0, max: 80, step: 2, unit: 'px', def: 14 },
    { tab: 'layout', sec: 'Order', key: 'clusterSort', label: 'Order clusters', type: 'chips', def: 'size', opts: [['size', 'Largest first'], ['name', 'Name, A to Z'], ['data', 'Data order']],
      help: 'The order the clusters are placed in. It decides who sits where, and which color each cluster gets.' },
    { tab: 'layout', sec: 'Order', key: 'clusterDir', label: 'Reverse the cluster order', type: 'check', def: false },

    /* Collisions */
    { tab: 'collision', sec: 'Padding', key: 'pad', label: 'Gap between circles', type: 'number', min: 0, max: 20, step: 1, unit: 'px', def: 3 },
    { tab: 'collision', sec: 'Padding', key: 'padGrow', label: 'Extra gap that grows with circle size', type: 'number', min: 0, max: 40, step: 2, unit: '%', def: 0, help: 'Big circles get more breathing room than small ones.' },
    { tab: 'collision', sec: 'Order', key: 'itemSort', label: 'Order circles inside a cluster', type: 'chips', def: 'size', opts: [['size', 'Largest first'], ['name', 'Name, A to Z'], ['data', 'Data order']],
      help: 'Circles are dropped in from the middle outward in this order.' },
    { tab: 'collision', sec: 'Order', key: 'itemDir', label: 'Reverse the circle order', type: 'check', def: false },

    /* Size scale */
    { tab: 'size', sec: 'Scale', key: 'sizeScale', label: 'Circle size shows the value as', type: 'chips', def: 'area',
      opts: [['area', 'Area'], ['soft', 'Softened (cube root)'], ['radius', 'Radius'], ['equal', 'Equal circles']],
      help: 'Area is the default: circle area is proportional to the value. Softened keeps small circles readable next to a giant one.' },
    { tab: 'size', sec: 'Scale', key: 'areaFill', label: 'Circle area share', type: 'number', min: 10, max: 70, step: 2, unit: '%', def: 42, help: 'How much of the stage the circles cover. Bigger means bigger circles.' },
    { tab: 'size', sec: 'Limits', key: 'minRadius', label: 'Smallest circle', type: 'number', min: 1, max: 20, step: 1, unit: 'px', def: 3, help: 'Tiny values are drawn at least this big so they stay visible.' },
    { tab: 'size', sec: 'Limits', key: 'capMedian', label: 'Cap the biggest at this many times the typical circle', type: 'number', min: 0, max: 20, step: 1, unit: 'x', def: 0, help: '0 means no cap. A cap keeps one giant from squeezing everyone else.' },

    /* Circles */
    { tab: 'circles', sec: 'Fill', key: 'opacity', label: 'Circle opacity', type: 'number', min: 30, max: 100, step: 2, unit: '%', def: 92 },
    { tab: 'circles', sec: 'Outline', key: 'ringWidth', label: 'Outline width', type: 'number', min: 0, max: 6, step: 0.5, unit: 'px', def: 1.5 },
    { tab: 'circles', sec: 'Outline', key: 'ringStyle', label: 'Outline line', type: 'chips', def: 'solid', opts: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']] },
    { tab: 'circles', sec: 'Outline', key: 'ringColorMode', label: 'Outline color', type: 'chips', def: 'shade', opts: [['shade', 'Shade of the fill'], ['ink', 'Text color']] },
    { tab: 'circles', sec: 'Outline', key: 'ringOpacity', label: 'Outline opacity', type: 'number', min: 10, max: 100, step: 5, unit: '%', def: 100 },
    { tab: 'circles', sec: 'Emphasis', key: 'hoverRing', label: 'Hover outline width', type: 'number', min: 1, max: 8, step: 1, unit: 'px', def: 3, help: 'Shown when Highlight on hover is on (Interaction tab).' },
    { tab: 'circles', sec: 'Emphasis', key: 'selRing', label: 'Selected outline width', type: 'number', min: 1, max: 8, step: 1, unit: 'px', def: 4 },

    /* Labels (the standard Labels rows come with std) */
    { tab: 'labels', sec: 'Which circles', key: 'itemLabels', label: 'Label big circles', type: 'check', def: true, when: { key: 'labels', truthy: true } },
    { tab: 'labels', sec: 'Which circles', key: 'showValues', label: 'Show values', type: 'check', def: true, when: { key: 'labels', truthy: true } },
    { tab: 'labels', sec: 'Which circles', key: 'labelMinR', label: 'Skip labels on circles smaller than', type: 'number', min: 0, max: 200, step: 5, unit: 'px', def: 0,
      when: { key: 'labels', truthy: true }, help: 'Radius in pixels. 0 labels every circle a label fits in.' },
    { tab: 'labels', sec: 'Look', key: 'chipStyle', label: 'Label chip', type: 'chips', def: 'filled', opts: [['filled', 'Filled'], ['outline', 'Outline only'], ['plain', 'Text only']], when: { key: 'labels', truthy: true } },
    { tab: 'labels', sec: 'Look', key: 'labelCase', label: 'Letter case', type: 'chips', def: 'asis', opts: [['asis', 'As written'], ['upper', 'UPPER'], ['lower', 'lower']], when: { key: 'labels', truthy: true } },

    /* Cluster labels */
    { tab: 'clabels', sec: 'Names', key: 'clusterLabels', label: 'Label clusters', type: 'check', def: true, when: { key: 'labels', truthy: true } },
    { tab: 'clabels', sec: 'Names', key: 'clusterPos', label: 'Where the name goes', type: 'chips', def: 'auto', opts: [['auto', 'Wherever it fits'], ['above', 'Above'], ['below', 'Below'], ['inside', 'Inside']],
      when: [{ key: 'labels', truthy: true }, { key: 'clusterLabels', truthy: true }] },
    { tab: 'clabels', sec: 'Names', key: 'clusterCase', label: 'Letter case', type: 'chips', def: 'asis', opts: [['asis', 'As written'], ['upper', 'UPPER'], ['lower', 'lower']],
      when: [{ key: 'labels', truthy: true }, { key: 'clusterLabels', truthy: true }] },
    { tab: 'clabels', sec: 'Territory', key: 'clusterRing', label: 'Draw a ring around each cluster', type: 'check', def: false },
    { tab: 'clabels', sec: 'Territory', key: 'clusterRingWidth', label: 'Ring width', type: 'number', min: 1, max: 6, step: 0.5, unit: 'px', def: 1.5, when: { key: 'clusterRing', truthy: true } },

    /* Legend */
    { tab: 'legend', sec: 'Legend', key: 'legend', label: 'Show legend', type: 'check', def: true },
    { tab: 'legend', sec: 'Legend', key: 'legendClusters', label: 'List the clusters when coloring by cluster', type: 'check', def: false, when: { key: 'legend', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'legendPos', label: 'Position', type: 'chips', def: 'bottom', opts: [['bottom', 'Bottom'], ['top', 'Top']], when: { key: 'legend', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'legendMax', label: 'Most entries shown', type: 'number', min: 2, max: 30, step: 1, def: 10, when: { key: 'legend', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'legendShape', label: 'Swatch shape', type: 'chips', def: 'circle', opts: [['circle', 'Circle'], ['square', 'Square']], when: { key: 'legend', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'legendTitle', label: 'Title', type: 'text', def: '', maxLength: 40, placeholder: 'No title', when: { key: 'legend', truthy: true } },

    /* Animation */
    { tab: 'animation', sec: 'Labels', key: 'labelFadeMs', label: 'Label fade-in', type: 'number', min: 0, max: 1000, step: 20, unit: 'ms', def: 220, help: 'How long the labels take to appear once the circles settle.' },

    /* Interaction */
    { tab: 'interaction', sec: 'Marks', key: 'selDim', label: 'Dim unselected circles to', type: 'number', min: 5, max: 100, step: 5, unit: '%', def: 55, when: { key: 'selectEnabled', truthy: true } },
    { tab: 'interaction', sec: 'Marks', key: 'multiSel', label: 'Ctrl or Shift click adds to the selection', type: 'check', def: true, when: { key: 'selectEnabled', truthy: true } },
    { tab: 'interaction', sec: 'Marks', key: 'clusterHover', label: 'Hovering a circle lights its whole cluster', type: 'check', def: true, when: { key: 'hoverOn', truthy: true } },
    { tab: 'interaction', sec: 'Panel', key: 'gearCorner', label: 'Gear corner', type: 'chips', def: 'tr', opts: [['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']] }
  ];

  var schema = { tabs: TABS, rows: CHART.concat(stdRows) };
  var prepared = CP.prepare(schema);

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

  return { schema: schema, prepared: prepared, DEFAULTS: CP.defaultsOf(prepared.rows), LEGACY: LEGACY, withLegacy: withLegacy, RENAME: RENAME,
    KEYS: prepared.rows.filter(function (r) { return r.type !== 'note'; }).map(function (r) { return r.key; }) };
});
