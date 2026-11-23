/* Radar - the settings schema. Chart-specific rows plus the ctab-panel standard tabs. The panel is generated from
 * this, the renderer reads the resolved values. Keys are flat, which is the shape Copy settings produces. */
(function (root, factory) {
  var CP = typeof require === 'function' && typeof module === 'object' ? require('../../lib/ctab-panel/ctab-panel.js') : root.CTabPanel;
  var s = factory(CP);
  if (typeof module === 'object' && module.exports) module.exports = s;
  else { root.RD = root.RD || {}; root.RD.settings = s; }
})(typeof window !== 'undefined' ? window : globalThis, function (CP) {
  'use strict';

  var std = CP.standard({
    fields: [
      { key: 'fieldAxis', label: 'Axis field', help: 'The dimension that makes one spoke each. Auto uses the Axis shelf.' },
      { key: 'fieldSeries', label: 'Series field', help: 'The dimension that makes one shape each. Auto uses the Series shelf.' },
      { key: 'fieldValue', label: 'Value field', kind: 'numeric', help: 'The measure that sets how far out each point sits. Auto uses the Value shelf.' },
      { key: 'fieldLabel', label: 'Axis label field', help: 'Text written at the end of each spoke instead of the axis value.' }
    ],
    over: { animMs: { def: 700 }, hoverMs: { def: 180 }, dimOthers: { def: 22 }, labelLines: { def: 3 } }
  });

  var TABS = [{ id: 'layout', label: 'Layout' }, { id: 'rings', label: 'Rings' }, { id: 'axes', label: 'Axes' }, { id: 'series', label: 'Series' },
    { id: 'benchmark', label: 'Benchmark' }, { id: 'legend', label: 'Legend' }].concat(std.tabs);

  var SORT_AXES = [['data', 'Data order'], ['name', 'Name, A to Z'], ['nameDesc', 'Name, Z to A'], ['mean', 'Average, low to high'], ['meanDesc', 'Average, high to low'], ['manual', 'My order (Axes tab list)']];
  var SORT_SERIES = [['data', 'Data order'], ['name', 'Name, A to Z'], ['nameDesc', 'Name, Z to A'], ['mean', 'Average, low to high'], ['meanDesc', 'Average, high to low']];
  var BIG = 1000000;

  var ROWS = [
    { tab: 'layout', sec: 'View', key: 'view', label: 'Show series as', type: 'chips', opts: [['overlay', 'Overlaid'], ['multiples', 'Small multiples']], def: 'overlay',
      help: 'Overlaid draws every series on one radar. Small multiples gives each series its own radar on the same scale.' },
    { tab: 'layout', sec: 'View', key: 'mcols', label: 'Panels per row', type: 'number', min: 0, max: 8, step: 1, def: 0, when: { key: 'view', eq: 'multiples' }, help: '0 chooses the arrangement that makes the radars largest.' },
    { tab: 'layout', sec: 'View', key: 'mgap', label: 'Gap between panels', type: 'number', min: 0, max: 60, step: 2, unit: 'px', def: 12, when: { key: 'view', eq: 'multiples' } },
    { tab: 'layout', sec: 'View', key: 'mtitle', label: 'Name each panel', type: 'check', def: true, when: { key: 'view', eq: 'multiples' } },
    { tab: 'layout', sec: 'Shape', key: 'rotation', label: 'Rotate', type: 'number', min: 0, max: 345, step: 15, unit: 'deg', def: 0, help: '0 puts the first axis at the top, turning clockwise.' },
    { tab: 'layout', sec: 'Shape', key: 'direction', label: 'Axes run', type: 'chips', opts: [['cw', 'Clockwise'], ['ccw', 'Counter-clockwise']], def: 'cw' },
    { tab: 'layout', sec: 'Shape', key: 'sizePct', label: 'Chart size', type: 'number', min: 40, max: 100, step: 5, unit: '%', def: 100, help: 'Share of the available room the radar fills.' },
    { tab: 'layout', sec: 'Order', key: 'sortAxes', label: 'Sort axes', type: 'select', opts: SORT_AXES, def: 'data' },
    { tab: 'layout', sec: 'Order', key: 'sortSeries', label: 'Sort series', type: 'select', opts: SORT_SERIES, def: 'data' },
    { tab: 'layout', sec: 'Order', key: 'missing', label: 'Missing values', type: 'chips', opts: [['zero', 'Draw at the center'], ['skip', 'Skip the point']], def: 'zero' },

    { tab: 'rings', sec: 'Scale', key: 'scaleMode', label: 'Scale', type: 'chips', opts: [['shared', 'One shared scale'], ['perAxis', 'Each axis its own']], def: 'shared',
      help: 'Shared keeps every axis comparable. Each axis its own stretches every axis from its own lowest to highest value.' },
    { tab: 'rings', sec: 'Scale', key: 'minMode', label: 'Center value', type: 'chips', opts: [['zero', 'Zero'], ['auto', 'Lowest value'], ['custom', 'Custom']], def: 'zero' },
    { tab: 'rings', sec: 'Scale', key: 'minCustom', label: 'Custom center', type: 'number', min: -BIG, max: BIG, step: 1, def: 0, when: { key: 'minMode', eq: 'custom' } },
    { tab: 'rings', sec: 'Scale', key: 'maxMode', label: 'Outer ring', type: 'chips', opts: [['auto', 'Highest value, rounded up'], ['custom', 'Custom']], def: 'auto' },
    { tab: 'rings', sec: 'Scale', key: 'maxCustom', label: 'Custom outer ring', type: 'number', min: -BIG, max: BIG, step: 1, def: 100, when: { key: 'maxMode', eq: 'custom' } },
    { tab: 'rings', sec: 'Rings', key: 'ringCount', label: 'Number of rings', type: 'number', min: 1, max: 10, step: 1, def: 5 },
    { tab: 'rings', sec: 'Rings', key: 'ringShape', label: 'Ring shape', type: 'chips', opts: [['polygon', 'Polygon'], ['circle', 'Circle']], def: 'polygon' },
    { tab: 'rings', sec: 'Rings', key: 'ringStyle', label: 'Ring line', type: 'chips', opts: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], def: 'solid' },
    { tab: 'rings', sec: 'Rings', key: 'ringWidth', label: 'Ring width', type: 'number', min: 0.5, max: 4, step: 0.5, unit: 'px', def: 1 },
    { tab: 'rings', sec: 'Rings', key: 'ringColor', label: 'Ring color', type: 'color', auto: true, def: '', help: 'Auto follows the background.' },
    { tab: 'rings', sec: 'Rings', key: 'ringBands', label: 'Tint alternate rings', type: 'check', def: false },
    { tab: 'rings', sec: 'Ring labels', key: 'ringLabels', label: 'Show ring values', type: 'check', def: true, help: 'With each axis on its own scale the rings read as a share of each axis range.' },
    { tab: 'rings', sec: 'Ring labels', key: 'ringLabelSize', label: 'Ring value size', type: 'number', min: 14, max: 20, step: 1, unit: 'px', def: 14, when: { key: 'ringLabels', truthy: true } },

    { tab: 'axes', sec: 'Spokes', key: 'axisLines', label: 'Draw the axis lines', type: 'check', def: true },
    { tab: 'axes', sec: 'Spokes', key: 'axisLineWidth', label: 'Axis line width', type: 'number', min: 0.5, max: 4, step: 0.5, unit: 'px', def: 1, when: { key: 'axisLines', truthy: true } },
    { tab: 'axes', sec: 'Spokes', key: 'axisColor', label: 'Axis line color', type: 'color', auto: true, def: '', when: { key: 'axisLines', truthy: true } },
    { tab: 'axes', sec: 'Axis labels', key: 'axisLabelDist', label: 'Distance from the outer ring', type: 'number', min: 4, max: 60, step: 2, unit: 'px', def: 12 },
    { tab: 'axes', sec: 'Axis labels', key: 'axisWrap', label: 'Wrap labels at', type: 'number', min: 60, max: 320, step: 10, unit: 'px', def: 170, help: 'Labels wrap onto the number of lines set on the Labels tab.' },
    { tab: 'axes', sec: 'Axis labels', key: 'axisRange', label: 'Show each axis range in its label', type: 'check', def: false },
    { tab: 'axes', sec: 'Order and names', key: 'axesList', label: 'Axes', type: 'list', source: 'axes', visible: true, def: [], help: 'Rename or hide an axis. Choose "My order" on the Layout tab to use this order.' },

    { tab: 'series', sec: 'Outline', key: 'curve', label: 'Outline', type: 'chips', opts: [['straight', 'Straight'], ['smooth', 'Smoothed']], def: 'straight' },
    { tab: 'series', sec: 'Outline', key: 'smooth', label: 'Smoothness', type: 'number', min: 0.1, max: 1, step: 0.05, def: 0.8, when: { key: 'curve', eq: 'smooth' }, help: 'Smoothed outlines never leave the outer ring.' },
    { tab: 'series', sec: 'Outline', key: 'lineWidth', label: 'Line width', type: 'number', min: 0.5, max: 8, step: 0.5, unit: 'px', def: 2.5 },
    { tab: 'series', sec: 'Fill', key: 'fillOn', label: 'Fill the shapes', type: 'check', def: true },
    { tab: 'series', sec: 'Fill', key: 'fillOpacity', label: 'Fill opacity', type: 'number', min: 5, max: 100, step: 5, unit: '%', def: 22, when: { key: 'fillOn', truthy: true } },
    { tab: 'series', sec: 'Points', key: 'dots', label: 'Mark each value with a dot', type: 'check', def: true },
    { tab: 'series', sec: 'Points', key: 'dotSize', label: 'Dot size', type: 'number', min: 2, max: 12, step: 1, unit: 'px', def: 4, when: { key: 'dots', truthy: true } },
    { tab: 'series', sec: 'Stacking', key: 'drawOrder', label: 'Draw order', type: 'chips', opts: [['bigfirst', 'Largest at the back'], ['data', 'Series order']], def: 'bigfirst', help: 'Largest at the back keeps small shapes visible and hoverable.' },

    { tab: 'benchmark', sec: 'Benchmark', key: 'benchMode', label: 'Benchmark', type: 'chips', opts: [['none', 'None'], ['series', 'A series'], ['value', 'One value']], def: 'none',
      help: 'A target drawn as a dashed ring: pick one of the series, or type a single value for every axis.' },
    { tab: 'benchmark', sec: 'Benchmark', key: 'benchSeries', label: 'Series to use as the benchmark', type: 'select', dynamic: true, source: 'categories', opts: [['', 'Choose a series']], def: '', when: { key: 'benchMode', eq: 'series' } },
    { tab: 'benchmark', sec: 'Benchmark', key: 'benchValue', label: 'Benchmark value', type: 'number', min: -BIG, max: BIG, step: 1, def: 80, when: { key: 'benchMode', eq: 'value' } },
    { tab: 'benchmark', sec: 'Benchmark', key: 'benchLabel', label: 'Benchmark name', type: 'text', def: 'Benchmark', maxLength: 40, when: { key: 'benchMode', eq: 'value' } },
    { tab: 'benchmark', sec: 'Look', key: 'benchDash', label: 'Line', type: 'chips', opts: [['dashed', 'Dashed'], ['dotted', 'Dotted'], ['solid', 'Solid']], def: 'dashed', when: { key: 'benchMode', ne: 'none' } },
    { tab: 'benchmark', sec: 'Look', key: 'benchWidth', label: 'Line width', type: 'number', min: 0.5, max: 6, step: 0.5, unit: 'px', def: 2, when: { key: 'benchMode', ne: 'none' } },
    { tab: 'benchmark', sec: 'Look', key: 'benchColor', label: 'Color', type: 'color', auto: true, def: '', when: { key: 'benchMode', ne: 'none' } },
    { tab: 'benchmark', sec: 'Look', key: 'benchFill', label: 'Tint inside the benchmark', type: 'check', def: false, when: { key: 'benchMode', ne: 'none' } },

    { tab: 'legend', sec: 'Legend', key: 'legendOn', label: 'Show the legend', type: 'check', def: true },
    { tab: 'legend', sec: 'Legend', key: 'legendPos', label: 'Position', type: 'chips', opts: [['bottom', 'Bottom'], ['top', 'Top'], ['right', 'Right']], def: 'bottom', when: { key: 'legendOn', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'legendTitle', label: 'Title', type: 'text', def: '', maxLength: 60, placeholder: 'No title', when: { key: 'legendOn', truthy: true } },

    { tab: 'interaction', sec: 'Marks', key: 'clickIsolate', label: 'Click a series to isolate it', type: 'check', def: true, help: 'Click again, or click the background, to bring the others back.' }
  ];

  var schema = { tabs: TABS, rows: ROWS.concat(std.rows) };
  var prepared = CP.prepare(schema);
  return { schema: schema, prepared: prepared, DEFAULTS: CP.defaultsOf(prepared.rows), KEYS: prepared.rows.filter(function (r) { return r.type !== 'note'; }).map(function (r) { return r.key; }) };
});
