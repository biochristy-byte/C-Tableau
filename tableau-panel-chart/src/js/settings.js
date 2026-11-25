/* Panel Chart - the settings schema for the shared ctab-panel. Eight chart tabs (Chart, Bars, Lines, Points, Axes,
 * Grid, Legend, Title) plus the standard nine. The panel is generated from this and the layout reads the resolved values.
 * Keys are flat, which is the shape Copy settings produces.
 */
(function (root, factory) {
  var CP = typeof require === 'function' && typeof module === 'object' ? require('../../lib/ctab-panel/ctab-panel.js') : root.CTabPanel;
  var s = factory(CP);
  if (typeof module === 'object' && module.exports) module.exports = s;
  else { root.PC = root.PC || {}; root.PC.settings = s; }
})(typeof window !== 'undefined' ? window : globalThis, function (CP) {
  'use strict';

  var std = CP.standard({
    fields: [
      { key: 'fieldCategory', label: 'Category field', help: 'The dimension along the category axis. Auto uses the Category shelf.' },
      { key: 'fieldValue', label: 'Value field', kind: 'numeric', help: 'The measure that sets bar length, line height or point height. Auto uses the Value shelf.' },
      { key: 'fieldColor', label: 'Series field', help: 'Splits the marks into colored series. Auto uses the Color shelf.' },
      { key: 'fieldX', label: 'Scatter X field', kind: 'numeric', help: 'The measure along the X axis of a scatter. Auto uses the X value shelf.' }
    ],
    over: {
      labelsOn: { label: 'Show axis labels', help: 'Category and value tick labels. Labels that would touch are thinned, never shrunk.' },
      labelSize: { label: 'Axis label size' },
      labelLines: { label: 'Wrap category labels onto up to', def: 2 },
      labelColor: { label: 'Text color', help: 'Auto picks the color that reads best on the background. Any color you choose is adjusted to 7:1.' },
      catColors: { label: 'Series colors and names', help: 'Rename, recolor, hide or reorder each series. With no Series field there is one series, named after the Value field.' },
      numDecimals: { def: 0 },
      showTitle: { tab: 'title', sec: 'Title' }, titleText: { tab: 'title', sec: 'Title' }, titleSize: { tab: 'title', sec: 'Title' }, titleWeight: { tab: 'title', sec: 'Title' },
      animMs: { def: 650, label: 'Transition length', help: 'Marks glide to their new place when the data or a setting changes.' },
      dimOthers: { def: 30 }
    }
  });

  var TABS = [{ id: 'chart', label: 'Chart' }, { id: 'bars', label: 'Bars' }, { id: 'lines', label: 'Lines' }, { id: 'points', label: 'Points' },
    { id: 'axes', label: 'Axes' }, { id: 'grid', label: 'Grid' }, { id: 'legend', label: 'Legend' }, { id: 'title', label: 'Title' }].concat(std.tabs);
  var BIG = 1000000000;
  var LINEISH = { key: 'chartType', in: ['line', 'area'] };

  var ROWS = [
    { tab: 'chart', sec: 'Type', key: 'chartType', label: 'Chart type', type: 'chips', opts: [['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['scatter', 'Scatter']], def: 'bar' },
    { tab: 'chart', sec: 'Type', key: 'orientation', label: 'Bars run', type: 'chips', opts: [['vertical', 'Up'], ['horizontal', 'Across']], def: 'vertical', when: { key: 'chartType', eq: 'bar' } },
    { tab: 'chart', sec: 'Series', key: 'stack', label: 'Series', type: 'chips', opts: [['group', 'Side by side'], ['stack', 'Stacked'], ['percent', '100% stacked']], def: 'stack', when: { key: 'chartType', in: ['bar', 'line', 'area'] }, help: 'Only matters when the Series field splits the marks. Lines and areas overlap when Side by side.' },
    { tab: 'chart', sec: 'Values', key: 'aggregate', label: 'Combine rows with', type: 'chips', opts: [['sum', 'Sum'], ['avg', 'Average'], ['min', 'Smallest'], ['max', 'Largest'], ['count', 'Count']], def: 'sum', help: 'When several rows share a category and series. Scatter plots every row.' },
    { tab: 'chart', sec: 'Order', key: 'sort', label: 'Sort categories', type: 'chips', opts: [['data', 'Data order'], ['desc', 'Largest first'], ['asc', 'Smallest first'], ['name', 'By name'], ['manual', 'My order']], def: 'data' },
    { tab: 'chart', sec: 'Order', key: 'flip', label: 'Reverse the order', type: 'check', def: false },
    { tab: 'chart', sec: 'Order', key: 'topN', label: 'Show only the first', type: 'number', min: 0, max: 500, step: 1, unit: 'categories', def: 0, help: '0 shows every category. Applied after sorting.' },
    { tab: 'chart', sec: 'Order', key: 'catOrder', label: 'Categories', type: 'list', source: 'cats', def: [], visible: true, help: 'Rename, hide or reorder categories (My order uses this order). A color here paints that category, so one bar can stand out.' },

    { tab: 'bars', sec: 'Size', key: 'barGap', label: 'Gap between categories', type: 'number', min: 0, max: 90, step: 5, unit: '%', def: 25 },
    { tab: 'bars', sec: 'Size', key: 'groupGap', label: 'Gap inside a group', type: 'number', min: 0, max: 60, step: 2, unit: '%', def: 8, help: 'Between side-by-side bars of one category.' },
    { tab: 'bars', sec: 'Size', key: 'barMaxWidth', label: 'Widest bar', type: 'number', min: 4, max: 240, step: 4, unit: 'px', def: 96 },
    { tab: 'bars', sec: 'Shape', key: 'barRadius', label: 'Corner radius', type: 'number', min: 0, max: 24, step: 1, unit: 'px', def: 3 },
    { tab: 'bars', sec: 'Shape', key: 'barOutline', label: 'Outline each bar', type: 'check', def: false },
    { tab: 'bars', sec: 'Shape', key: 'barOutlineWidth', label: 'Outline width', type: 'number', min: 0.5, max: 6, step: 0.5, unit: 'px', def: 1.5, when: { key: 'barOutline', truthy: true } },
    { tab: 'bars', sec: 'Shape', key: 'barOpacity', label: 'Bar strength', type: 'number', min: 10, max: 100, step: 5, unit: '%', def: 100 },

    { tab: 'lines', sec: 'Line', key: 'lineWidth', label: 'Line width', type: 'number', min: 0.5, max: 12, step: 0.5, unit: 'px', def: 2.5 },
    { tab: 'lines', sec: 'Line', key: 'curve', label: 'Line shape', type: 'chips', opts: [['straight', 'Straight'], ['smooth', 'Smooth'], ['step', 'Steps']], def: 'smooth' },
    { tab: 'lines', sec: 'Line', key: 'lineDash', label: 'Line style', type: 'chips', opts: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], def: 'solid' },
    { tab: 'lines', sec: 'Line', key: 'showPoints', label: 'Dot on every value', type: 'check', def: true, when: LINEISH },
    { tab: 'lines', sec: 'Line', key: 'gapMode', label: 'Missing values', type: 'chips', opts: [['gap', 'Leave a gap'], ['zero', 'Treat as zero']], def: 'gap', help: 'When a series has no row for a category.' },
    { tab: 'lines', sec: 'Area', key: 'areaOpacity', label: 'Area fill strength', type: 'number', min: 5, max: 100, step: 5, unit: '%', def: 40, when: { key: 'chartType', eq: 'area' } },
    { tab: 'lines', sec: 'Area', key: 'areaLine', label: 'Line along the top of each area', type: 'check', def: true, when: { key: 'chartType', eq: 'area' } },

    { tab: 'points', sec: 'Points', key: 'pointSize', label: 'Point size', type: 'number', min: 2, max: 24, step: 1, unit: 'px', def: 6 },
    { tab: 'points', sec: 'Points', key: 'pointShape', label: 'Point shape', type: 'chips', opts: [['circle', 'Circle'], ['square', 'Square'], ['diamond', 'Diamond'], ['triangle', 'Triangle']], def: 'circle' },
    { tab: 'points', sec: 'Points', key: 'pointOpacity', label: 'Point strength', type: 'number', min: 10, max: 100, step: 5, unit: '%', def: 85 },
    { tab: 'points', sec: 'Points', key: 'pointRing', label: 'Ring around each point', type: 'check', def: true, help: 'A thin ring in the background color keeps overlapping points apart.' },
    { tab: 'points', sec: 'Scatter', key: 'trendLine', label: 'Trend line', type: 'check', def: false, when: { key: 'chartType', eq: 'scatter' }, help: 'Least squares, one line for each series.' },

    { tab: 'axes', sec: 'Category axis', key: 'showCatAxis', label: 'Show the category axis', type: 'check', def: true },
    { tab: 'axes', sec: 'Category axis', key: 'catTitleOn', label: 'Category axis title', type: 'check', def: true },
    { tab: 'axes', sec: 'Category axis', key: 'catTitleText', label: 'Category title text', type: 'text', def: '', maxLength: 80, placeholder: 'The Category field name', when: { key: 'catTitleOn', truthy: true } },
    { tab: 'axes', sec: 'Value axis', key: 'showValAxis', label: 'Show the value axis', type: 'check', def: true },
    { tab: 'axes', sec: 'Value axis', key: 'valTitleOn', label: 'Value axis title', type: 'check', def: true },
    { tab: 'axes', sec: 'Value axis', key: 'valTitleText', label: 'Value title text', type: 'text', def: '', maxLength: 80, placeholder: 'The Value field name', when: { key: 'valTitleOn', truthy: true } },
    { tab: 'axes', sec: 'Value axis', key: 'tickCount', label: 'Most ticks', type: 'number', min: 2, max: 12, step: 1, def: 6, help: 'Ticks are thinned until no two labels touch.' },
    { tab: 'axes', sec: 'Value axis', key: 'zeroBase', label: 'Start at zero', type: 'check', def: true, help: 'Bars and stacks always start at zero so their length stays true.' },
    { tab: 'axes', sec: 'Value axis', key: 'rangeMode', label: 'Value range', type: 'chips', opts: [['auto', 'Fit the data'], ['custom', 'Custom']], def: 'auto' },
    { tab: 'axes', sec: 'Value axis', key: 'rangeMin', label: 'Axis starts at', type: 'number', min: -BIG, max: BIG, step: 1, def: 0, when: { key: 'rangeMode', eq: 'custom' } },
    { tab: 'axes', sec: 'Value axis', key: 'rangeMax', label: 'Axis ends at', type: 'number', min: -BIG, max: BIG, step: 1, def: 100, when: { key: 'rangeMode', eq: 'custom' } },
    { tab: 'axes', sec: 'Lines', key: 'axisLine', label: 'Draw the axis lines', type: 'check', def: true },

    { tab: 'grid', sec: 'Grid', key: 'gridVal', label: 'Lines at each value tick', type: 'check', def: true },
    { tab: 'grid', sec: 'Grid', key: 'gridCat', label: 'Lines at each category', type: 'check', def: false },
    { tab: 'grid', sec: 'Grid', key: 'gridOpacity', label: 'Grid strength', type: 'number', min: 4, max: 60, step: 2, unit: '%', def: 16 },
    { tab: 'grid', sec: 'Grid', key: 'gridStyle', label: 'Grid line', type: 'chips', opts: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], def: 'solid' },
    { tab: 'grid', sec: 'Reference', key: 'refLine', label: 'Reference line', type: 'chips', opts: [['none', 'None'], ['avg', 'Average'], ['median', 'Median'], ['value', 'A value']], def: 'none' },
    { tab: 'grid', sec: 'Reference', key: 'refValue', label: 'Reference value', type: 'number', min: -BIG, max: BIG, step: 1, def: 0, when: { key: 'refLine', eq: 'value' } },

    { tab: 'legend', sec: 'Legend', key: 'legendOn', label: 'Show the legend', type: 'check', def: true, help: 'Appears when the Series field splits the marks.' },
    { tab: 'legend', sec: 'Legend', key: 'legendPos', label: 'Legend goes', type: 'chips', opts: [['top', 'Top'], ['bottom', 'Bottom'], ['right', 'Right']], def: 'top', when: { key: 'legendOn', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'legendTitle', label: 'Name the Series field', type: 'check', def: true, when: { key: 'legendOn', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'legendSwatch', label: 'Key shape', type: 'chips', opts: [['square', 'Square'], ['circle', 'Circle'], ['line', 'Line']], def: 'square', when: { key: 'legendOn', truthy: true } },

    { tab: 'title', sec: 'Title', key: 'titleAlign', label: 'Align', type: 'chips', opts: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], def: 'left', when: { key: 'showTitle', truthy: true } },
    { tab: 'title', sec: 'Subtitle', key: 'subtitleText', label: 'Subtitle', type: 'text', def: '', maxLength: 160, placeholder: 'One sentence that says what to see', when: { key: 'showTitle', truthy: true } },
    { tab: 'title', sec: 'Subtitle', key: 'subtitleSize', label: 'Subtitle size', type: 'number', min: 14, max: 28, step: 1, unit: 'px', def: 14, when: { key: 'showTitle', truthy: true } },

    { tab: 'interaction', sec: 'Marks', key: 'crosshair', label: 'Guide line on hover', type: 'check', def: true, when: { key: 'hoverOn', truthy: true }, help: 'Lines and areas: a vertical line at the hovered category.' },
    { tab: 'interaction', sec: 'Marks', key: 'selectBy', label: 'A click selects', type: 'chips', opts: [['cat', 'The category'], ['mark', 'That one mark']], def: 'cat', when: { key: 'selectOn', truthy: true }, help: 'That one mark also sends the series value.' }
  ];

  var schema = { tabs: TABS, rows: ROWS.concat(std.rows) };
  var prepared = CP.prepare(schema);
  var BY_KEY = {};
  prepared.rows.forEach(function (r) { BY_KEY[r.key] = r; });
  return { schema: schema, prepared: prepared, BY_KEY: BY_KEY, DEFAULTS: CP.defaultsOf(prepared.rows),
    KEYS: prepared.rows.filter(function (r) { return r.type !== 'note'; }).map(function (r) { return r.key; }) };
});
