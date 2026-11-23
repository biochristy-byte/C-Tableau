/* Tide Lines - the settings schema for the shared ctab-panel. Chart-specific tabs (Density, Layout, Marks, Gradient,
 * Outline, Axis) plus the nine standard tabs. The panel is generated from this and the renderer reads the resolved values.
 * Keys are flat, which is the shape Copy settings produces.
 *
 * Older workbooks saved a few keys under other names (animate, bgMatch, inkAuto, inkColor, selectEnabled, and a font
 * stored as a CSS stack). legacy() turns those into the new keys so an old workbook keeps its look.
 */
(function (root, factory) {
  var CP = typeof require === 'function' && typeof module === 'object' ? require('../../lib/ctab-panel/ctab-panel.js') : root.CTabPanel;
  var s = factory(CP);
  if (typeof module === 'object' && module.exports) module.exports = s;
  else { root.TL = root.TL || {}; root.TL.settings = s; }
})(typeof window !== 'undefined' ? window : globalThis, function (CP) {
  'use strict';

  var std = CP.standard({
    fields: [
      { key: 'fieldCategory', label: 'Category field', help: 'The dimension that gives each ridge its own row. Auto uses the Category shelf.' },
      { key: 'fieldValue', label: 'Value field', kind: 'numeric', help: 'The measure whose distribution is drawn. Auto uses the Value shelf.' },
      { key: 'fieldColor', label: 'Colour field', help: 'Colours each ridge when Ridge colour is By field. Auto uses the Colour shelf.' },
      { key: 'fieldLabel', label: 'Label field', help: 'Text written beside each ridge instead of the category. Auto uses the Label shelf.' }
    ],
    over: {
      numDecimals: { def: 0, label: 'Least decimal places', help: 'Tick labels, tooltip numbers and value labels show at least this many. Numbers that need more still show them.' },
      animMs: { def: 760 }, hoverMs: { def: 220 }, dimOthers: { def: 50 }, hoverPush: { def: true, help: 'Also shows Tableau\'s own tooltip. Turn it off on the Marks card if you only want the one drawn here.' },
      labelLines: { def: 1 }, padding: { def: 0 }, labelWeight: { def: 'normal' },
      catColors: { help: 'Rename, recolor, hide or reorder each ridge. Choose "My order" on the Layout tab to use this order.' }
    }
  });
  /* The standard categorical palette keeps its own key (catPalette) because Tide Lines already saved "palette" for the tide ramps. */
  var stdRows = std.rows.map(function (r) {
    if (r.key !== 'palette') return r;
    var c = {}; Object.keys(r).forEach(function (k) { c[k] = r[k]; });
    c.key = 'catPalette'; c.label = 'Palette for By field'; c.help = 'Used when Ridge colour is By field. Data Divers is the house palette.';
    return c;
  });

  var TABS = [{ id: 'density', label: 'Density' }, { id: 'layout', label: 'Layout' }, { id: 'marks', label: 'Marks' }, { id: 'gradient', label: 'Gradient' },
    { id: 'outline', label: 'Outline' }, { id: 'axis', label: 'Axis' }].concat(std.tabs);
  var BIG = 1000000000;

  var ROWS = [
    { tab: 'density', sec: 'Kernel', key: 'kernel', label: 'Kernel', type: 'chips', opts: [['gaussian', 'Gaussian'], ['epanechnikov', 'Epanechnikov']], def: 'gaussian', help: 'Gaussian is smooth; Epanechnikov is a rounded hill with a hard edge.' },
    { tab: 'density', sec: 'Bandwidth', key: 'bandwidth', label: 'Bandwidth', type: 'number', min: 0, max: BIG, step: 0.01, def: 0, help: '0 is Auto: Silverman\'s rule, worked out for each ridge. A number uses one bandwidth for every ridge, in the Value field\'s own units.' },
    { tab: 'density', sec: 'Bandwidth', key: 'bwMult', label: 'Bandwidth adjust', type: 'number', min: 0.25, max: 4, step: 0.05, unit: 'x', def: 1, help: 'Multiplies the bandwidth, Auto or typed. Below 1 shows more bumps, above 1 smooths them away.' },
    { tab: 'density', sec: 'Height', key: 'scale', label: 'Ridge height', type: 'chips', opts: [['shared', 'Shared scale'], ['own', 'Each its own']], def: 'shared', help: 'Shared keeps areas honest: a wide, thin ridge stays low. Each its own scales every peak to the same height.' },
    { tab: 'density', sec: 'Tails', key: 'trim', label: 'Tails', type: 'chips', opts: [['extend', 'Extend'], ['trim', 'Trim to data']], def: 'extend', help: 'Trim stops each ridge at its own smallest and largest value.' },
    { tab: 'density', sec: 'Tails', key: 'padMult', label: 'Room past the data', type: 'number', min: 0.5, max: 2, step: 0.1, unit: 'x', def: 1, help: 'How much empty axis is left beyond the smallest and largest value.' },
    { tab: 'density', sec: 'Curve', key: 'points', label: 'Curve detail', type: 'number', min: 40, max: 600, step: 20, unit: 'points', def: 240, help: 'Points along each ridge. More is smoother and slower.' },

    { tab: 'layout', sec: 'Order', key: 'sort', label: 'Sort ridges', type: 'chips', opts: [['data', 'Data order'], ['median', 'By median'], ['name', 'By name'], ['mean', 'By average'], ['count', 'By count'], ['manual', 'My order']], def: 'median' },
    { tab: 'layout', sec: 'Order', key: 'flip', label: 'Reverse order', type: 'check', def: false },
    { tab: 'layout', sec: 'Spacing', key: 'overlap', label: 'Overlap', type: 'number', min: 0.2, max: 8, step: 0.1, unit: 'x', def: 2, help: 'How many ridge spacings tall a peak is. 1 just touches, 3 overlaps heavily.' },
    { tab: 'layout', sec: 'Spacing', key: 'showBaselines', label: 'Draw a line under each ridge', type: 'check', def: true },
    { tab: 'layout', sec: 'Spacing', key: 'baselineOpacity', label: 'Baseline strength', type: 'number', min: 5, max: 100, step: 5, unit: '%', def: 22, when: { key: 'showBaselines', truthy: true } },
    { tab: 'layout', sec: 'Names', key: 'labelSide', label: 'Names go on the', type: 'chips', opts: [['left', 'Left'], ['right', 'Right']], def: 'left', when: { key: 'labelsOn', truthy: true } },
    { tab: 'layout', sec: 'Names', key: 'labelMaxPct', label: 'Name column up to', type: 'number', min: 15, max: 50, step: 1, unit: '%', def: 34, help: 'Share of the chart width the names may take before they are cut short.', when: { key: 'labelsOn', truthy: true } },
    { tab: 'layout', sec: 'Names', key: 'footNote', label: 'Say when names are left out', type: 'check', def: true, help: 'If names cannot all fit at this size, fewer are shown and the footer says how many.' },
    { tab: 'layout', sec: 'Legend', key: 'legendOn', label: 'Show the colour legend', type: 'check', def: true, help: 'Only appears when Ridge colour is By field and there is room.' },

    { tab: 'marks', sec: 'Median', key: 'showMedian', label: 'Median tick', type: 'check', def: true },
    { tab: 'marks', sec: 'Median', key: 'medianWidth', label: 'Median tick width', type: 'number', min: 1, max: 8, step: 0.5, unit: 'px', def: 2.5, when: { key: 'showMedian', truthy: true } },
    { tab: 'marks', sec: 'Quartiles', key: 'showQuartiles', label: 'Quartile ticks', type: 'check', def: true },
    { tab: 'marks', sec: 'Quartiles', key: 'quartileWidth', label: 'Quartile tick width', type: 'number', min: 0.5, max: 6, step: 0.5, unit: 'px', def: 1.5, when: { key: 'showQuartiles', truthy: true } },
    { tab: 'marks', sec: 'Quartiles', key: 'quartileHeight', label: 'Quartile tick height', type: 'number', min: 20, max: 100, step: 2, unit: '%', def: 62, help: 'Share of the ridge height at that value.', when: { key: 'showQuartiles', truthy: true } },
    { tab: 'marks', sec: 'Mean', key: 'showMean', label: 'Mean tick', type: 'check', def: false },
    { tab: 'marks', sec: 'Colour of ticks', key: 'tickColor', label: 'Tick color', type: 'color', auto: true, def: '', help: 'Auto picks white or navy, whichever reads best on the ridge.' },
    { tab: 'marks', sec: 'Observations', key: 'showRug', label: 'Mark every observation under its ridge', type: 'check', def: false, help: 'A small tick for each value, up to 400 per ridge.' },
    { tab: 'marks', sec: 'Observations', key: 'rugSize', label: 'Observation tick height', type: 'number', min: 2, max: 14, step: 1, unit: 'px', def: 6, when: { key: 'showRug', truthy: true } },
    { tab: 'marks', sec: 'Observations', key: 'rugOpacity', label: 'Observation tick strength', type: 'number', min: 5, max: 100, step: 5, unit: '%', def: 45, when: { key: 'showRug', truthy: true } },

    { tab: 'gradient', sec: 'Ridge colour', key: 'colorSource', label: 'Ridge colour', type: 'chips', opts: [['tide', 'Tide gradient'], ['field', 'By field']], def: 'tide', help: 'By field uses the Colour shelf. Tide gradient follows the sort order.' },
    { tab: 'gradient', sec: 'Ridge colour', key: 'palette', label: 'Tide palette', type: 'select', opts: [['tide', 'Tide (Data Divers)'], ['reef', 'Reef shallows'], ['dusk', 'Dusk tide'], ['single', 'One colour']], def: 'tide' },
    { tab: 'gradient', sec: 'Ridge colour', key: 'singleColor', label: 'One colour', type: 'color', def: '#3cc4d1', when: { key: 'palette', eq: 'single' } },
    { tab: 'gradient', sec: 'Ridge colour', key: 'tideReverse', label: 'Reverse the tide', type: 'check', def: false, help: 'Flips which end of the palette the top ridge gets.' },
    { tab: 'gradient', sec: 'Fill', key: 'fillOpacity', label: 'Fill opacity', type: 'number', min: 0.1, max: 1, step: 0.05, def: 0.9 },
    { tab: 'gradient', sec: 'Fill', key: 'gradOn', label: 'Fade each ridge from crest to base', type: 'check', def: true, help: 'Off fills each ridge with one flat color.' },
    { tab: 'gradient', sec: 'Fill', key: 'gradCrest', label: 'Crest lightening', type: 'number', min: 0, max: 100, step: 2, unit: '%', def: 38, when: { key: 'gradOn', truthy: true }, help: 'How much lighter the top of a ridge is than its base.' },
    { tab: 'gradient', sec: 'Fill', key: 'baseFade', label: 'Fade out at the base', type: 'number', min: 0, max: 90, step: 5, unit: '%', def: 0, when: { key: 'gradOn', truthy: true } },

    { tab: 'outline', sec: 'Line', key: 'lineWidth', label: 'Outline width', type: 'number', min: 0, max: 6, step: 0.5, unit: 'px', def: 1.5, help: '0 draws no outline.' },
    { tab: 'outline', sec: 'Line', key: 'outlineMode', label: 'Outline color', type: 'chips', opts: [['ridge', 'Ridge color'], ['ink', 'Text color'], ['custom', 'Custom']], def: 'ridge' },
    { tab: 'outline', sec: 'Line', key: 'outlineColor', label: 'Custom outline color', type: 'color', def: '#12527a', when: { key: 'outlineMode', eq: 'custom' } },
    { tab: 'outline', sec: 'Line', key: 'outlineDash', label: 'Line style', type: 'chips', opts: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], def: 'solid' },
    { tab: 'outline', sec: 'Line', key: 'outlineOpacity', label: 'Outline strength', type: 'number', min: 10, max: 100, step: 5, unit: '%', def: 100 },
    { tab: 'outline', sec: 'Line', key: 'outlineJoin', label: 'Corners', type: 'chips', opts: [['round', 'Round'], ['miter', 'Sharp']], def: 'round' },
    { tab: 'outline', sec: 'On hover', key: 'hotLineWidth', label: 'Outline width on hover or select', type: 'number', min: 0.5, max: 8, step: 0.5, unit: 'px', def: 3 },

    { tab: 'axis', sec: 'Ticks', key: 'tickCount', label: 'Most ticks', type: 'number', min: 2, max: 12, step: 1, def: 10, help: 'Ticks are thinned until no two labels touch.' },
    { tab: 'axis', sec: 'Ticks', key: 'axisLine', label: 'Draw the axis line', type: 'check', def: true },
    { tab: 'axis', sec: 'Grid', key: 'showGrid', label: 'Vertical grid', type: 'check', def: true },
    { tab: 'axis', sec: 'Grid', key: 'gridOpacity', label: 'Grid strength', type: 'number', min: 2, max: 60, step: 2, unit: '%', def: 14, when: { key: 'showGrid', truthy: true } },
    { tab: 'axis', sec: 'Grid', key: 'gridStyle', label: 'Grid line', type: 'chips', opts: [['solid', 'Solid'], ['dashed', 'Dashed']], def: 'solid', when: { key: 'showGrid', truthy: true } },
    { tab: 'axis', sec: 'Title', key: 'showAxisTitle', label: 'Axis title', type: 'check', def: true },
    { tab: 'axis', sec: 'Title', key: 'axisTitleText', label: 'Axis title text', type: 'text', def: '', maxLength: 80, placeholder: 'The Value field name', when: { key: 'showAxisTitle', truthy: true } },
    { tab: 'axis', sec: 'Range', key: 'rangeMode', label: 'Axis range', type: 'chips', opts: [['auto', 'Fit the data'], ['custom', 'Custom']], def: 'auto' },
    { tab: 'axis', sec: 'Range', key: 'rangeMin', label: 'Axis starts at', type: 'number', min: -BIG, max: BIG, step: 0.01, def: 0, when: { key: 'rangeMode', eq: 'custom' } },
    { tab: 'axis', sec: 'Range', key: 'rangeMax', label: 'Axis ends at', type: 'number', min: -BIG, max: BIG, step: 0.01, def: 100, when: { key: 'rangeMode', eq: 'custom' } },

    { tab: 'interaction', sec: 'Marks', key: 'hoverLift', label: 'Hover lift', type: 'number', min: 0, max: 16, step: 1, unit: 'px', def: 6, when: { key: 'hoverOn', truthy: true } },
    { tab: 'interaction', sec: 'Marks', key: 'selectDim', label: 'Dim unselected ridges to', type: 'number', min: 5, max: 100, step: 5, unit: '%', def: 60, when: { key: 'selectOn', truthy: true } }
  ];

  /* Interaction rows of mine are appended after the standard ones so the standard order reads Marks first. */
  var schema = { tabs: TABS, rows: ROWS.concat(stdRows) };
  var prepared = CP.prepare(schema);
  var BY_KEY = {};
  prepared.rows.forEach(function (r) { BY_KEY[r.key] = r; });

  /* Old saved keys to new ones. get(key) returns the saved string for a bare key, or undefined. */
  var STACKS = {};
  CP.FONTS.forEach(function (f) { STACKS[f.stack] = f.id; });
  function legacy(get) {
    var out = {};
    function have(k) { var v = get(k); return v !== undefined && v !== null; }
    var v;
    if (!have('animOn') && have('animate')) out.animOn = String(get('animate')) === 'true';
    if (!have('bgMode') && have('bgMatch')) out.bgMode = String(get('bgMatch')) === 'false' ? 'custom' : 'worksheet';
    if (!have('labelColor') && have('inkAuto') && String(get('inkAuto')) === 'false' && have('inkColor')) {
      v = CP.color.normHex(get('inkColor')); if (v) out.labelColor = v;
    }
    if (!have('selectOn') && have('selectEnabled')) out.selectOn = String(get('selectEnabled')) === 'true';
    v = get('fontFamily');
    if (v && !CP.FONTS.some(function (f) { return f.id === v; }) && STACKS[v]) out.fontFamily = STACKS[v];
    return out;
  }

  return { schema: schema, prepared: prepared, BY_KEY: BY_KEY, DEFAULTS: CP.defaultsOf(prepared.rows), legacy: legacy,
    KEYS: prepared.rows.filter(function (r) { return r.type !== 'note'; }).map(function (r) { return r.key; }) };
});
