/* Sketchbook - the settings schema. Chart-specific rows plus the ctab-panel standard tabs. The panel is generated from
 * this, the renderer reads the resolved values. Keys are flat, which is the shape Copy settings produces and the Viz
 * pages flow reads. LEGACY lists the keys the old (pre ctab-panel) panel saved, so an existing workbook keeps its look. */
(function (root, factory) {
  var CP = typeof require === 'function' && typeof module === 'object' ? require('../../lib/ctab-panel/ctab-panel.js') : root.CTabPanel;
  var s = factory(CP);
  if (typeof module === 'object' && module.exports) module.exports = s;
  else { root.SB = root.SB || {}; root.SB.settings = s; }
})(typeof window !== 'undefined' ? window : globalThis, function (CP) {
  'use strict';

  var std = CP.standard({
    fields: [
      { key: 'fieldCategory', label: 'Category field', help: 'The dimension along the bottom. Auto uses the Category shelf.' },
      { key: 'fieldValue', label: 'Value field', kind: 'numeric', help: 'The measure that sets each mark. Auto uses the Value shelf.' },
      { key: 'fieldSeries', label: 'Series field', help: 'The dimension that splits each category into colored marks. Auto uses the Series shelf.' },
      { key: 'fieldLabel', label: 'Label field', help: 'Text written above each mark when the label text is "Label shelf". Auto uses the Label shelf.' }
    ],
    over: {
      labelSize: { help: 'Sets every chart text: ticks, axis titles, mark labels and the legend. Never below 14px.' },
      numDecimals: { def: 2, help: 'Used by tooltips and value labels. Axis ticks pick their own decimals.' },
      padding: { def: 0 }, tipMaxW: { def: 260 }, animMs: { def: 480 }, hoverMs: { def: 140 }, dimOthers: { def: 50, help: 'The other marks fade to this while one is hovered. 100 leaves them alone.' },
      hoverPush: { def: true, help: 'Highlights the same mark on other sheets of a dashboard. Not available on C-Tableau Viz pages.' },
      valueLabelSize: { when: { key: 'valueLabels', truthy: true } },
      labelLines: { def: 1, help: 'Long category names wrap onto this many lines. 1 cuts them with an ellipsis.' }
    }
  });

  var TABS = [{ id: 'chart', label: 'Chart' }, { id: 'sketch', label: 'Sketch' }, { id: 'marks', label: 'Marks' }, { id: 'axes', label: 'Axes' },
    { id: 'grid', label: 'Grid' }, { id: 'underline', label: 'Title underline' }, { id: 'legend', label: 'Legend' }].concat(std.tabs);

  var FILLS = [['hachure', 'Hachure'], ['solid', 'Solid'], ['zigzag', 'Zigzag'], ['cross-hatch', 'Cross-hatch'], ['dots', 'Dots'], ['dashed', 'Dashed']];
  var SORTS = [['data', 'Data order'], ['value-desc', 'Value, high to low'], ['value-asc', 'Value, low to high'], ['alpha', 'A to Z']];
  var HATCH = { key: 'fillStyle', in: ['hachure', 'zigzag', 'cross-hatch', 'dashed'] };

  var ROWS = [
    { tab: 'chart', sec: 'Chart', key: 'chartType', label: 'Chart type', type: 'chips', opts: [['bar', 'Bar'], ['line', 'Line'], ['dot', 'Dot']], def: 'bar' },
    { tab: 'chart', sec: 'Chart', key: 'sort', label: 'Order of categories', type: 'select', opts: SORTS, def: 'data' },
    { tab: 'chart', sec: 'Chart', key: 'maxCats', label: 'Show only the first', type: 'number', min: 0, max: 60, step: 1, unit: 'categories', def: 0, help: '0 shows every category. Use with an order to get a top-N chart.' },
    { tab: 'chart', sec: 'Chart', key: 'zero', label: 'Start the value axis at zero', type: 'check', def: true, help: 'Bars always start at zero.' },

    { tab: 'sketch', sec: 'The hand', key: 'roughness', label: 'Roughness', type: 'number', min: 0, max: 5, step: 0.1, def: 1.2, help: '0 is a clean line, 5 is a shaky hand.' },
    { tab: 'sketch', sec: 'The hand', key: 'bowing', label: 'Bowing', type: 'number', min: 0, max: 10, step: 0.5, def: 1, help: 'How much each line bends between its ends.' },
    { tab: 'sketch', sec: 'The hand', key: 'seed', label: 'Seed', type: 'number', min: 1, max: 99999, step: 1, def: 42, help: 'The same seed draws the same sketch every time.' },
    { tab: 'sketch', sec: 'The hand', key: 'doubleStroke', label: 'Go over each line twice', type: 'check', def: true, help: 'Pencil-style: every outline is drawn twice, a little apart.' },
    { tab: 'sketch', sec: 'Fill', key: 'fillStyle', label: 'Fill', type: 'chips', opts: FILLS, def: 'hachure' },
    { tab: 'sketch', sec: 'Fill', key: 'hachureGap', label: 'Hatch spacing', type: 'number', min: 2, max: 30, step: 1, unit: 'px', def: 7, when: HATCH },
    { tab: 'sketch', sec: 'Fill', key: 'hachureAngle', label: 'Hatch angle', type: 'number', min: -90, max: 90, step: 5, unit: 'deg', def: -41, when: HATCH },
    { tab: 'sketch', sec: 'Fill', key: 'hatchWeight', label: 'Hatch line weight', type: 'number', min: 0, max: 4, step: 0.1, unit: 'px', def: 0, help: '0 sets it from the stroke width.' },
    { tab: 'sketch', sec: 'Outline', key: 'strokeWidth', label: 'Stroke width', type: 'number', min: 0.5, max: 6, step: 0.25, unit: 'px', def: 1.6 },
    { tab: 'sketch', sec: 'Outline', key: 'outlineMix', label: 'Outline darkness', type: 'number', min: 0, max: 100, step: 5, unit: '%', def: 40, help: 'How far each outline moves from the fill color toward the ink.' },

    { tab: 'marks', sec: 'Bars', key: 'barWidth', label: 'Bar width', type: 'number', min: 20, max: 100, step: 4, unit: '%', def: 72, when: { key: 'chartType', eq: 'bar' } },
    { tab: 'marks', sec: 'Lines', key: 'lineWidth', label: 'Line width', type: 'number', min: 1, max: 10, step: 0.5, unit: 'px', def: 3, when: { key: 'chartType', eq: 'line' } },
    { tab: 'marks', sec: 'Lines', key: 'lineDots', label: 'Dots on the line', type: 'check', def: true, when: { key: 'chartType', eq: 'line' } },
    { tab: 'marks', sec: 'Dots', key: 'dotSize', label: 'Dot size', type: 'number', min: 6, max: 48, step: 1, unit: 'px', def: 16, when: { key: 'chartType', eq: 'dot' } },
    { tab: 'marks', sec: 'Dots', key: 'dotShape', label: 'Dot shape', type: 'chips', opts: [['circle', 'Circle'], ['square', 'Square'], ['diamond', 'Diamond']], def: 'circle', when: { key: 'chartType', eq: 'dot' } },
    { tab: 'marks', sec: 'Dots', key: 'stems', label: 'Sketched stems to the axis', type: 'check', def: true, when: { key: 'chartType', eq: 'dot' } },
    { tab: 'marks', sec: 'All marks', key: 'markOpacity', label: 'Mark opacity', type: 'number', min: 20, max: 100, step: 5, unit: '%', def: 100 },

    { tab: 'colors', sec: 'Colors', key: 'greys', label: 'Pencil grays for the series', type: 'check', def: false, help: 'Draws every series in graphite grays instead of the palette.' },
    { tab: 'colors', sec: 'Colors', key: 'color', label: 'Color when there is no series', type: 'color', def: '#2aa9b8' },

    { tab: 'labels', sec: 'Mark labels', key: 'labels', label: 'Mark label text', type: 'chips', opts: [['value', 'Value'], ['field', 'Label shelf']], def: 'value', help: 'Turn the labels on with Show value labels below.' },
    { tab: 'labels', sec: 'Mark labels', key: 'labelGap', label: 'Gap above the mark', type: 'number', min: 2, max: 30, step: 1, unit: 'px', def: 6, when: { key: 'valueLabels', truthy: true } },

    { tab: 'axes', sec: 'Axes', key: 'axes', label: 'Axis lines and labels', type: 'check', def: true },
    { tab: 'axes', sec: 'Axes', key: 'axisColor', label: 'Axis line color', type: 'color', auto: true, def: '', when: { key: 'axes', truthy: true } },
    { tab: 'axes', sec: 'Axes', key: 'tickDensity', label: 'Number of ticks', type: 'number', min: 40, max: 250, step: 10, unit: '%', def: 100, when: { key: 'axes', truthy: true } },
    { tab: 'axes', sec: 'Axes', key: 'catLabelMax', label: 'Longest category label', type: 'number', min: 4, max: 40, step: 1, unit: 'characters', def: 16, when: { key: 'axes', truthy: true }, help: 'Longer names are cut with an ellipsis; hover for the whole name.' },
    { tab: 'axes', sec: 'Titles', key: 'axisTitles', label: 'Axis titles', type: 'check', def: true, when: { key: 'axes', truthy: true } },
    { tab: 'axes', sec: 'Titles', key: 'xTitle', label: 'Category axis title', type: 'text', def: '', maxLength: 60, placeholder: 'The field name', when: { key: 'axisTitles', truthy: true } },
    { tab: 'axes', sec: 'Titles', key: 'yTitle', label: 'Value axis title', type: 'text', def: '', maxLength: 60, placeholder: 'The field name', when: { key: 'axisTitles', truthy: true } },
    { tab: 'axes', sec: 'Range', key: 'valueMin', label: 'Value axis from', type: 'text', def: '', maxLength: 16, placeholder: 'Auto', help: 'Type a number to fix the range. Leave blank for Auto. Bars still start at zero.' },
    { tab: 'axes', sec: 'Range', key: 'valueMax', label: 'Value axis to', type: 'text', def: '', maxLength: 16, placeholder: 'Auto' },

    { tab: 'grid', sec: 'Grid lines', key: 'grid', label: 'Sketched grid lines', type: 'check', def: true },
    { tab: 'grid', sec: 'Grid lines', key: 'gridDash', label: 'Line style', type: 'chips', opts: [['solid', 'Solid'], ['dashed', 'Dashed']], def: 'solid', when: { key: 'grid', truthy: true } },
    { tab: 'grid', sec: 'Grid lines', key: 'gridWidth', label: 'Line width', type: 'number', min: 0.5, max: 4, step: 0.5, unit: 'px', def: 1, when: { key: 'grid', truthy: true } },
    { tab: 'grid', sec: 'Grid lines', key: 'gridColor', label: 'Line color', type: 'color', auto: true, def: '', when: { key: 'grid', truthy: true } },

    { tab: 'underline', sec: 'Under the title', key: 'underline', label: 'Sketched underline under the title', type: 'check', def: false, help: 'Needs a title: turn on Show a title on the Fonts tab.' },
    { tab: 'underline', sec: 'Under the title', key: 'underlineWeight', label: 'Stroke width', type: 'number', min: 1, max: 8, step: 0.2, unit: 'px', def: 2.4, when: { key: 'underline', truthy: true } },
    { tab: 'underline', sec: 'Under the title', key: 'underlineRough', label: 'Roughness', type: 'number', min: 0, max: 5, step: 0.1, def: 1.8, when: { key: 'underline', truthy: true } },
    { tab: 'underline', sec: 'Under the title', key: 'underlineColor', label: 'Color', type: 'color', auto: true, def: '', when: { key: 'underline', truthy: true } },

    { tab: 'legend', sec: 'Legend', key: 'legend', label: 'Show the legend', type: 'check', def: true, help: 'Shown when there is a series.' },
    { tab: 'legend', sec: 'Legend', key: 'legendPos', label: 'Position', type: 'chips', opts: [['bottom', 'Bottom'], ['top', 'Top']], def: 'bottom', when: { key: 'legend', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'legendSwatch', label: 'Swatch size', type: 'number', min: 14, max: 40, step: 2, unit: 'px', def: 20, when: { key: 'legend', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'legendTitle', label: 'Legend title', type: 'text', def: '', maxLength: 40, placeholder: 'No title', when: { key: 'legend', truthy: true } },

    { tab: 'interaction', sec: 'Gear', key: 'showGear', label: 'Show the gear button', type: 'check', def: true, help: 'Hide it for a finished dashboard. Paste your settings back in to get the gear again.' }
  ];

  var schema = { tabs: TABS, rows: ROWS.concat(std.rows) };
  var prepared = CP.prepare(schema);

  /* The keys the pre-panel version saved. Each entry: when the old key is stored and the new key(s) are not, write the new
   * key(s). Renamed or re-meant: fontSize, title, theme, palette (the old "ink" value became the Pencil grays check),
   * labels (none became Show value labels off), selectEnabled, hoverEnabled. All other old keys kept their name and meaning. */
  var LEGACY = [
    { old: 'fontSize', map: function (v) { var n = Number(v); return isFinite(n) ? { labelSize: n, titleSize: Math.round(n * 1.35), valueLabelSize: n } : null; } },
    { old: 'title', map: function (v) { return v === '' ? null : { titleText: String(v), showTitle: true }; } },
    { old: 'theme', map: function (v) { return v === 'light' ? { bgMode: 'custom', bgColor: '#ffffff' } : v === 'paper' ? { bgMode: 'custom', bgColor: '#fbf6e9' } : v === 'dark' ? { bgMode: 'custom', bgColor: '#081f33' } : v === 'custom' ? { bgMode: 'custom' } : null; } },
    { old: 'palette', map: function (v) { return v === 'ink' ? { greys: true } : null; } },
    { old: 'labels', map: function (v) { return v === 'none' ? { valueLabels: false } : v === 'value' || v === 'field' ? { valueLabels: true } : null; } },
    { old: 'selectEnabled', map: function (v) { return { selectOn: v }; } },
    { old: 'hoverEnabled', map: function (v) { return { hoverPush: v }; } }
  ];

  return { schema: schema, prepared: prepared, LEGACY: LEGACY, FILLS: FILLS, DEFAULTS: CP.defaultsOf(prepared.rows), KEYS: prepared.rows.filter(function (r) { return r.type !== 'note'; }).map(function (r) { return r.key; }) };
});
