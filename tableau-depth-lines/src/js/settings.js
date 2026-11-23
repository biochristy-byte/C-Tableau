/* Depth Lines - the settings schema. Chart-specific rows plus the ctab-panel standard tabs. The panel is generated from
 * this, the renderer reads the resolved values. Keys are flat, which is the shape Copy settings produces and the Viz
 * pages flow reads. LEGACY lists the keys the old (pre ctab-panel) panel saved, so an existing workbook keeps its look. */
(function (root, factory) {
  var CP = typeof require === 'function' && typeof module === 'object' ? require('../../lib/ctab-panel/ctab-panel.js') : root.CTabPanel;
  var s = factory(CP);
  if (typeof module === 'object' && module.exports) module.exports = s;
  else { root.DL = root.DL || {}; root.DL.settings = s; }
})(typeof window !== 'undefined' ? window : globalThis, function (CP) {
  'use strict';

  var std = CP.standard({
    fields: [
      { key: 'fieldX', label: 'X field', kind: 'numeric', help: 'The measure along the bottom. Auto uses the X shelf.' },
      { key: 'fieldY', label: 'Y field', kind: 'numeric', help: 'The measure up the side. Auto uses the Y shelf.' },
      { key: 'fieldCategory', label: 'Category field', help: 'The dimension that makes one set of contours each. Auto uses the Category shelf.' },
      { key: 'fieldWeight', label: 'Weight field', kind: 'numeric', help: 'Counts a row more than once. Auto uses the Weight shelf.' }
    ],
    over: {
      labelSize: { help: 'Sets every chart text: ticks, axis titles, panel titles and the legend. Never below 14px.' },
      numDecimals: { def: 2, help: 'Used by tooltips and value labels. Axis ticks pick their own decimals.' },
      padding: { def: 0 }, tipMaxW: { def: 260 }, animMs: { def: 520 }, hoverMs: { def: 160 }, dimOthers: { def: 100, help: '100 leaves the other bands as they are. Lower fades them while one band is hovered.' },
      hoverPush: { def: true, help: 'Highlights the same mark on other sheets of a dashboard. Not available on C-Tableau Viz pages.' },
      labelLines: { def: 2, help: 'Panel titles in small multiples wrap onto this many lines.' }
    }
  });

  var TABS = [{ id: 'contours', label: 'Contours' }, { id: 'bands', label: 'Bands' }, { id: 'points', label: 'Points' }, { id: 'category', label: 'Category' },
    { id: 'axes', label: 'Axes' }, { id: 'grid', label: 'Grid' }, { id: 'legend', label: 'Legend' }].concat(std.tabs);

  var DASH = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']];

  var ROWS = [
    { tab: 'contours', sec: 'Density', key: 'bandwidth', label: 'Bandwidth', type: 'number', min: 0.5, max: 25, step: 0.5, unit: '% of plot', def: 4,
      help: 'How far each point spreads. Small shows fine detail, large shows one smooth hill.' },
    { tab: 'contours', sec: 'Density', key: 'cell', label: 'Grid detail', type: 'chips', opts: [['auto', 'Auto'], ['fine', 'Fine'], ['medium', 'Medium'], ['coarse', 'Coarse']], def: 'auto',
      help: 'The size of the grid the density is computed on. Fine is smoother and slower.' },
    { tab: 'contours', sec: 'Depth bands', key: 'levels', label: 'Depth bands', type: 'number', min: 2, max: 24, step: 1, def: 8, help: 'How many contour levels, shallow to deep.' },
    { tab: 'contours', sec: 'Depth bands', key: 'floor', label: 'Shallowest band at', type: 'number', min: 1, max: 60, step: 1, unit: '% of peak', def: 6,
      help: 'The outermost contour sits at this share of the densest spot.' },
    { tab: 'contours', sec: 'Depth bands', key: 'ceil', label: 'Deepest band at', type: 'number', min: 62, max: 99, step: 1, unit: '% of peak', def: 95 },
    { tab: 'contours', sec: 'Depth bands', key: 'thresholds', label: 'Spacing of the bands', type: 'chips', opts: [['linear', 'Even'], ['log', 'Crowded toward the shallow edge']], def: 'linear',
      help: 'Crowding the bands toward the shallow edge shows the thin outskirts of a cloud.' },

    { tab: 'bands', sec: 'Fill', key: 'fill', label: 'Filled bands', type: 'check', def: true },
    { tab: 'bands', sec: 'Fill', key: 'fillOpacity', label: 'Fill opacity', type: 'number', min: 10, max: 100, step: 5, unit: '%', def: 100, when: { key: 'fill', truthy: true } },
    { tab: 'bands', sec: 'Fill', key: 'sea', label: 'Water tint behind bands', type: 'check', def: true },
    { tab: 'bands', sec: 'Contour lines', key: 'lines', label: 'Contour lines', type: 'check', def: true },
    { tab: 'bands', sec: 'Contour lines', key: 'lineWidth', label: 'Line width', type: 'number', min: 0.5, max: 4, step: 0.25, unit: 'px', def: 1, when: { key: 'lines', truthy: true } },
    { tab: 'bands', sec: 'Contour lines', key: 'lineStyle', label: 'Line style', type: 'chips', opts: DASH, def: 'solid', when: { key: 'lines', truthy: true } },
    { tab: 'bands', sec: 'Contour lines', key: 'majorEvery', label: 'Heavier line every', type: 'number', min: 0, max: 12, step: 1, unit: 'bands', def: 0,
      help: 'Like the index contours on a map. 0 draws every line the same.', when: { key: 'lines', truthy: true } },

    { tab: 'colors', sec: 'Depth ramp', key: 'ramp', label: 'Depth ramp', type: 'chips', opts: [['abyss', 'Abyss (teal)'], ['sunrise', 'Sunrise (gold)'], ['mono', 'Mono (gray)']], def: 'abyss',
      help: 'Colors the bands when there is one set of contours or small multiples. Overlaid categories use the palette.' },
    { tab: 'colors', sec: 'Depth ramp', key: 'reverse', label: 'Reverse the ramp', type: 'check', def: false },
    { tab: 'colors', sec: 'Depth ramp', key: 'lineInk', label: 'Contour line color', type: 'chips', opts: [['ink', 'Ink'], ['band', 'Band color']], def: 'ink', when: { key: 'lines', truthy: true } },

    { tab: 'points', sec: 'Points', key: 'points', label: 'Show points', type: 'check', def: false },
    { tab: 'points', sec: 'Points', key: 'pointSize', label: 'Point size', type: 'number', min: 1, max: 8, step: 0.5, unit: 'px', def: 2.5, when: { key: 'points', truthy: true } },
    { tab: 'points', sec: 'Points', key: 'pointOpacity', label: 'Point opacity', type: 'number', min: 0.1, max: 1, step: 0.05, def: 0.6, when: { key: 'points', truthy: true } },
    { tab: 'points', sec: 'Points', key: 'pointShape', label: 'Point shape', type: 'chips', opts: [['circle', 'Circle'], ['square', 'Square'], ['diamond', 'Diamond']], def: 'circle', when: { key: 'points', truthy: true } },
    { tab: 'points', sec: 'Points', key: 'pointColor', label: 'Point color', type: 'color', auto: true, def: '', help: 'Auto uses the ink, or the category color when categories are overlaid.', when: { key: 'points', truthy: true } },

    { tab: 'category', sec: 'Several categories', key: 'multi', label: 'Show categories as', type: 'chips', opts: [['overlay', 'Overlay'], ['small', 'Small multiples']], def: 'overlay',
      help: 'Only applies when a field is on the Category shelf.' },
    { tab: 'category', sec: 'Several categories', key: 'scale', label: 'Depth scale', type: 'chips', opts: [['shared', 'Shared'], ['each', 'Each its own']], def: 'each',
      help: 'Shared uses one set of depth levels so categories compare fairly. Each lets a sparse category show its own shape.' },
    { tab: 'category', sec: 'Small multiples', key: 'cols', label: 'Panel columns', type: 'number', min: 0, max: 8, step: 1, def: 0, when: { key: 'multi', eq: 'small' }, help: '0 picks the best fit for the space.' },
    { tab: 'category', sec: 'Small multiples', key: 'panelGap', label: 'Gap between panels', type: 'number', min: 4, max: 60, step: 2, unit: 'px', def: 14, when: { key: 'multi', eq: 'small' } },
    { tab: 'category', sec: 'Small multiples', key: 'panelTitles', label: 'Name each panel', type: 'check', def: true, when: { key: 'multi', eq: 'small' } },

    { tab: 'axes', sec: 'Axes', key: 'axes', label: 'Axis lines and labels', type: 'check', def: true },
    { tab: 'axes', sec: 'Axes', key: 'axisColor', label: 'Axis line color', type: 'color', auto: true, def: '', when: { key: 'axes', truthy: true } },
    { tab: 'axes', sec: 'Axes', key: 'tickDensity', label: 'Number of ticks', type: 'number', min: 40, max: 250, step: 10, unit: '%', def: 100, when: { key: 'axes', truthy: true } },
    { tab: 'axes', sec: 'Titles', key: 'axisTitles', label: 'Axis titles', type: 'check', def: true, when: { key: 'axes', truthy: true } },
    { tab: 'axes', sec: 'Titles', key: 'xTitle', label: 'X axis title', type: 'text', def: '', maxLength: 60, placeholder: 'The field name', when: { key: 'axisTitles', truthy: true } },
    { tab: 'axes', sec: 'Titles', key: 'yTitle', label: 'Y axis title', type: 'text', def: '', maxLength: 60, placeholder: 'The field name', when: { key: 'axisTitles', truthy: true } },
    { tab: 'axes', sec: 'Range', key: 'xMin', label: 'X from', type: 'text', def: '', maxLength: 16, placeholder: 'Auto', help: 'Type a number to fix the range. Leave blank for Auto.' },
    { tab: 'axes', sec: 'Range', key: 'xMax', label: 'X to', type: 'text', def: '', maxLength: 16, placeholder: 'Auto' },
    { tab: 'axes', sec: 'Range', key: 'yMin', label: 'Y from', type: 'text', def: '', maxLength: 16, placeholder: 'Auto' },
    { tab: 'axes', sec: 'Range', key: 'yMax', label: 'Y to', type: 'text', def: '', maxLength: 16, placeholder: 'Auto' },

    { tab: 'grid', sec: 'Grid lines', key: 'grid', label: 'Grid lines', type: 'check', def: true },
    { tab: 'grid', sec: 'Grid lines', key: 'gridStyle', label: 'Line style', type: 'chips', opts: DASH, def: 'solid', when: { key: 'grid', truthy: true } },
    { tab: 'grid', sec: 'Grid lines', key: 'gridWidth', label: 'Line width', type: 'number', min: 0.5, max: 4, step: 0.5, unit: 'px', def: 1, when: { key: 'grid', truthy: true } },
    { tab: 'grid', sec: 'Grid lines', key: 'gridColor', label: 'Line color', type: 'color', auto: true, def: '', when: { key: 'grid', truthy: true } },

    { tab: 'legend', sec: 'Legend', key: 'legend', label: 'Show the legend', type: 'check', def: true },
    { tab: 'legend', sec: 'Legend', key: 'legendPos', label: 'Position', type: 'chips', opts: [['bottom', 'Bottom'], ['top', 'Top']], def: 'bottom', when: { key: 'legend', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'legendNote', label: 'Say what the depth means', type: 'check', def: true, when: { key: 'legend', truthy: true } },
    { tab: 'legend', sec: 'Legend', key: 'rampWidth', label: 'Depth ramp width', type: 'number', min: 60, max: 320, step: 10, unit: 'px', def: 140, when: { key: 'legend', truthy: true },
      help: 'The color bar shown when one set of contours is drawn.' },

    { tab: 'interaction', sec: 'Gear', key: 'showGear', label: 'Show the gear button', type: 'check', def: true, help: 'Hide it for a finished dashboard. Paste your settings back in to get the gear again.' }
  ];

  var schema = { tabs: TABS, rows: ROWS.concat(std.rows) };
  var prepared = CP.prepare(schema);

  /* The keys the pre-panel version saved. Each entry: when the old key is stored and none of its new keys is, write the new
   * key(s). The renamed ones: fontSize, title, theme, catPalette, selectEnabled, hoverEnabled. All other old keys kept their name. */
  var LEGACY = [
    { old: 'fontSize', map: function (v) { var n = Number(v); return isFinite(n) ? { labelSize: n, titleSize: Math.round(n * 1.3) } : null; } },
    { old: 'title', map: function (v) { return v === '' ? null : { titleText: String(v), showTitle: true }; } },
    { old: 'theme', map: function (v) { return v === 'light' ? { bgMode: 'custom', bgColor: '#ffffff' } : v === 'dark' ? { bgMode: 'custom', bgColor: '#081f33' } : v === 'custom' ? { bgMode: 'custom' } : null; } },
    { old: 'catPalette', map: function (v) { return v === 'okabe' ? { palette: 'okabe' } : null; } },
    { old: 'selectEnabled', map: function (v) { return { selectOn: v }; } },
    { old: 'hoverEnabled', map: function (v) { return { hoverPush: v }; } }
  ];

  return { schema: schema, prepared: prepared, LEGACY: LEGACY, DEFAULTS: CP.defaultsOf(prepared.rows), KEYS: prepared.rows.filter(function (r) { return r.type !== 'note'; }).map(function (r) { return r.key; }) };
});
