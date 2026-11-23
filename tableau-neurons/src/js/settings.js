/* Neurons - the settings schema. Chart-specific rows plus the ctab-panel standard tabs. The panel is generated from
 * this, the renderer reads the resolved values. Keys are flat (the shape Copy settings produces), and every key that
 * existed before the panel moved to ctab-panel keeps its name, its default and its meaning, so saved workbooks keep
 * their look. Where a standard row would have collided with an old key, the standard row is dropped and the old key
 * stays (palette, bgMode, bgCustom, fontFamily, fontSize, showLabels, textMode, textCustom, entrance, fadeMs,
 * clickSelect, hoverHighlight, dimOpacity, pushHover, showReadout). The only old keys retired are the three that
 * styled the old home-made panel (panelTheme, panelSide, gearCorner): ctab-panel drags and has its own theme, and
 * legacy() carries panelTheme across. */
(function (root, factory) {
  var CP = typeof require === 'function' && typeof module === 'object' ? require('../../lib/ctab-panel/ctab-panel.js') : root.CTabPanel;
  var s = factory(CP);
  if (typeof module === 'object' && module.exports) module.exports = s;
  else { root.NX = root.NX || {}; root.NX.settings = s; root.NX.schema = s; }
})(typeof window !== 'undefined' ? window : globalThis, function (CP) {
  'use strict';

  var FONT_STACKS = [
    ['Inter, "Segoe UI", system-ui, -apple-system, Arial, sans-serif', 'Inter / Segoe UI'],
    ['"Tableau Book", "Benton Sans", Arial, sans-serif', 'Tableau Book'],
    ['Arial, Helvetica, sans-serif', 'Arial'],
    ['"Trebuchet MS", Tahoma, sans-serif', 'Trebuchet MS'],
    ['Verdana, Geneva, sans-serif', 'Verdana'],
    ['Tahoma, Verdana, sans-serif', 'Tahoma']
  ];

  var std = CP.standard({
    fields: [
      { key: 'fieldGroup', label: 'Group field', help: 'The parent each node belongs to. Auto uses the Group shelf.' },
      { key: 'fieldSource', label: 'Source field', help: 'Where a link starts. Auto uses the Source shelf.' },
      { key: 'fieldTarget', label: 'Target field', help: 'Where a link ends. Auto uses the Target shelf.' },
      { key: 'fieldWeight', label: 'Weight field', kind: 'numeric', help: 'The measure that sets link width. Auto uses the Weight shelf.' }
    ],
    over: { numDecimals: { def: 0 }, padding: { def: 0 }, tipFollow: { def: 'corner' }, tipMaxW: { def: 380 }, animMs: { def: 700 }, animEase: { def: 'inout' } }
  });
  /* Standard rows that an older Neurons key already covers, so they are not offered twice. */
  var COVERED = ['palette', 'labelsOn', 'labelSize', 'labelColor', 'labelLines', 'valueLabelSize', 'tipOn', 'fontFamily', 'bgMode', 'bgColor',
    'animOn', 'hoverMs', 'selectOn', 'hoverOn', 'dimOthers', 'hoverPush'];
  var stdRows = std.rows.filter(function (r) { return COVERED.indexOf(r.key) < 0; });

  var TABS = [{ id: 'layout', label: 'Layout' }, { id: 'nodes', label: 'Nodes' }, { id: 'links', label: 'Links' }, { id: 'hover', label: 'Hover' }, { id: 'arcs', label: 'Group arcs' }].concat(std.tabs);

  var HOV = { key: 'hoverHighlight', truthy: true };
  var R = [
    /* ---- Layout ---- */
    { tab: 'layout', sec: 'Bundling', key: 'beta', label: 'Bundling strength (beta)', type: 'number', min: 0, max: 1, step: 0.05, def: 0.85, help: '0 draws straight chords. 1 pulls every link tightly through its group hubs.' },
    { tab: 'layout', sec: 'Groups', key: 'groupGap', label: 'Gap between groups', type: 'number', min: 0, max: 8, step: 0.5, unit: 'slots', def: 2.5, help: 'Empty room between groups, measured in node spacings.' },
    { tab: 'layout', sec: 'Groups', key: 'groupOrder', label: 'Group order', type: 'select', opts: [['data', 'Data order'], ['alpha', 'A to Z'], ['size', 'Biggest group first'], ['manual', 'My order (Colors tab list)']], def: 'data' },
    { tab: 'layout', sec: 'Groups', key: 'nodeSort', label: 'Order inside a group', type: 'select', opts: [['alpha', 'A to Z'], ['degree', 'Most connected first'], ['data', 'Data order']], def: 'alpha' },
    { tab: 'layout', sec: 'Shape', key: 'rotation', label: 'Rotate', type: 'number', min: -180, max: 180, step: 5, unit: 'deg', def: 0 },
    { tab: 'layout', sec: 'Shape', key: 'direction', label: 'Nodes run', type: 'chips', opts: [['cw', 'Clockwise'], ['ccw', 'Counter-clockwise']], def: 'cw' },
    { tab: 'layout', sec: 'Shape', key: 'sizePct', label: 'Chart size', type: 'number', min: 40, max: 100, step: 5, unit: '%', def: 100, help: 'Share of the available room the ring fills.' },

    /* ---- Nodes ---- */
    { tab: 'nodes', sec: 'Dots', key: 'nodeSize', label: 'Node size', type: 'number', min: 2, max: 12, step: 0.5, unit: 'px', def: 4 },
    { tab: 'nodes', sec: 'Dots', key: 'nodeShape', label: 'Shape', type: 'chips', opts: [['circle', 'Circle'], ['square', 'Square']], def: 'circle' },
    { tab: 'nodes', sec: 'Dots', key: 'nodeSizeBy', label: 'Size each node by', type: 'chips', opts: [['fixed', 'Nothing'], ['links', 'Number of links'], ['weight', 'Total weight']], def: 'fixed', help: 'The most connected node gets the multiple below; the least gets 1x.' },
    { tab: 'nodes', sec: 'Dots', key: 'nodeSizeMax', label: 'Biggest node is', type: 'number', min: 1, max: 4, step: 0.25, unit: 'x', def: 2, when: { key: 'nodeSizeBy', ne: 'fixed' } },
    { tab: 'nodes', sec: 'Dots', key: 'nodeStroke', label: 'Outline width', type: 'number', min: 0, max: 4, step: 0.5, unit: 'px', def: 1 },
    { tab: 'nodes', sec: 'Halo', key: 'nodeHalo', label: 'Soft halo around nodes', type: 'check', def: true },
    { tab: 'nodes', sec: 'Halo', key: 'haloSize', label: 'Halo size', type: 'number', min: 1.2, max: 4, step: 0.2, unit: 'x', def: 2.2, when: { key: 'nodeHalo', truthy: true } },
    { tab: 'nodes', sec: 'Halo', key: 'haloOpacity', label: 'Halo strength', type: 'number', min: 5, max: 80, step: 5, unit: '%', def: 20, when: { key: 'nodeHalo', truthy: true } },

    /* ---- Links ---- */
    { tab: 'links', sec: 'Look', key: 'linkOpacity', label: 'Link opacity', type: 'number', min: 0.02, max: 1, step: 0.02, def: 0.34 },
    { tab: 'links', sec: 'Look', key: 'linkCap', label: 'Line ends', type: 'chips', opts: [['round', 'Round'], ['butt', 'Flat']], def: 'round' },
    { tab: 'links', sec: 'Look', key: 'linkOrder', label: 'Stacking', type: 'chips', opts: [['heavyTop', 'Heaviest on top'], ['lightTop', 'Lightest on top']], def: 'heavyTop' },
    { tab: 'links', sec: 'Width by weight', key: 'widthByWeight', label: 'Link width follows weight', type: 'check', def: true, help: 'Off draws every link at the middle width.' },
    { tab: 'links', sec: 'Width by weight', key: 'linkMinWidth', label: 'Thinnest link', type: 'number', min: 0.25, max: 6, step: 0.25, unit: 'px', def: 0.8 },
    { tab: 'links', sec: 'Width by weight', key: 'linkMaxWidth', label: 'Thickest link', type: 'number', min: 0.5, max: 12, step: 0.25, unit: 'px', def: 3.2, help: 'Used when a link weight is on the Weight shelf.' },
    { tab: 'links', sec: 'Width by weight', key: 'weightScale', label: 'Weight scale', type: 'chips', opts: [['sqrt', 'Square root'], ['linear', 'Linear'], ['log', 'Log']], def: 'sqrt', when: { key: 'widthByWeight', truthy: true } },
    { tab: 'links', sec: 'Filter', key: 'minWeight', label: 'Hide links lighter than', type: 'number', min: 0, max: 1000000, step: 1, def: 0, help: 'Weak links drop out of the picture and out of the hover counts.' },
    { tab: 'links', sec: 'Colour', key: 'linkColorMode', label: 'Link colour', type: 'chips', opts: [['source', 'Source group'], ['target', 'Target group'], ['single', 'One colour']], def: 'source' },
    { tab: 'links', sec: 'Colour', key: 'linkColor', label: 'One colour', type: 'color', def: '#3cc4d1', when: { key: 'linkColorMode', eq: 'single' } },

    /* ---- Hover ---- */
    { tab: 'hover', sec: 'Which links', key: 'hoverMode', label: 'Which links light up', type: 'chips', opts: [['both', 'Both'], ['out', 'Outgoing'], ['in', 'Incoming']], def: 'both', when: HOV },
    { tab: 'hover', sec: 'Which links', key: 'outColor', label: 'Outgoing colour', type: 'color', def: '#f2b84b', when: HOV },
    { tab: 'hover', sec: 'Which links', key: 'inColor', label: 'Incoming colour', type: 'color', def: '#8fe3ec', when: HOV },
    { tab: 'hover', sec: 'Lit links', key: 'litWidth', label: 'Lit link width', type: 'number', min: 1, max: 4, step: 0.2, unit: 'x', def: 1.4, when: HOV },
    { tab: 'hover', sec: 'Lit links', key: 'litOpacity', label: 'Lit link opacity', type: 'number', min: 30, max: 100, step: 5, unit: '%', def: 95, when: HOV },
    { tab: 'hover', sec: 'Lit links', key: 'glow', label: 'Glow on lit links', type: 'check', def: true, when: HOV },
    { tab: 'hover', sec: 'Lit links', key: 'glowSize', label: 'Glow reach', type: 'number', min: 2, max: 30, step: 1, unit: 'px', def: 10, when: [HOV, { key: 'glow', truthy: true }] },
    { tab: 'hover', sec: 'Lit links', key: 'terminals', label: 'Synapse bulbs on lit links', type: 'check', def: true, when: HOV },
    { tab: 'hover', sec: 'Lit links', key: 'terminalSize', label: 'Bulb size', type: 'number', min: 0.5, max: 3, step: 0.25, unit: 'x', def: 1, when: [HOV, { key: 'terminals', truthy: true }] },
    { tab: 'hover', sec: 'Everything else', key: 'dimOpacity', label: 'Dimmed links', type: 'number', min: 0, max: 0.5, step: 0.01, def: 0.05, when: HOV, help: 'How much of the picture stays visible while a node is lit.' },
    { tab: 'hover', sec: 'Everything else', key: 'dimNodes', label: 'Dimmed nodes', type: 'number', min: 0, max: 100, step: 5, unit: '%', def: 35, when: HOV },
    { tab: 'hover', sec: 'Nodes', key: 'focusScale', label: 'Hovered node grows to', type: 'number', min: 1, max: 3, step: 0.1, unit: 'x', def: 1.7, when: HOV },
    { tab: 'hover', sec: 'Nodes', key: 'neighborScale', label: 'Connected nodes grow to', type: 'number', min: 1, max: 2.5, step: 0.1, unit: 'x', def: 1.3, when: HOV },
    { tab: 'hover', sec: 'Timing', key: 'fadeMs', label: 'Fade time', type: 'number', min: 0, max: 1000, step: 20, unit: 'ms', def: 280, help: 'How long the dim and highlight take. 0 is instant.' },

    /* ---- Group arcs ---- */
    { tab: 'arcs', sec: 'Arcs', key: 'showArcs', label: 'Draw the group arcs', type: 'check', def: true },
    { tab: 'arcs', sec: 'Arcs', key: 'arcWidth', label: 'Arc thickness', type: 'number', min: 1, max: 20, step: 1, unit: 'px', def: 5, when: { key: 'showArcs', truthy: true } },
    { tab: 'arcs', sec: 'Arcs', key: 'arcGap', label: 'Distance from the labels', type: 'number', min: 0, max: 30, step: 1, unit: 'px', def: 6, when: { key: 'showArcs', truthy: true } },
    { tab: 'arcs', sec: 'Arcs', key: 'arcPad', label: 'Overhang past the first and last node', type: 'number', min: 0, max: 100, step: 5, unit: '%', def: 40, when: { key: 'showArcs', truthy: true }, help: 'In node spacings. 0 ends each arc on its outermost node.' },
    { tab: 'arcs', sec: 'Arcs', key: 'arcOpacity', label: 'Arc opacity', type: 'number', min: 10, max: 100, step: 5, unit: '%', def: 100, when: { key: 'showArcs', truthy: true } },
    { tab: 'arcs', sec: 'Names', key: 'showGroupNames', label: 'Group names on the arcs', type: 'check', def: true },
    { tab: 'arcs', sec: 'Names', key: 'groupNameWeight', label: 'Group name weight', type: 'chips', opts: [['bold', 'Bold'], ['normal', 'Regular']], def: 'bold', when: { key: 'showGroupNames', truthy: true } },

    /* ---- Standard tabs, with the old keys filed where they belong ---- */
    { tab: 'colors', sec: 'Palette', key: 'palette', label: 'Group colours', type: 'select', opts: [['diver', 'Data Divers'], ['safe', 'Colour-blind safe'], ['warm', 'Warm'], ['cool', 'Cool']], def: 'diver' },
    { tab: 'labels', sec: 'Labels', key: 'showLabels', label: 'Node labels', type: 'check', def: true },
    { tab: 'labels', sec: 'Labels', key: 'fontSize', label: 'Text size', type: 'number', min: 14, max: 28, step: 1, unit: 'px', def: 14, help: 'Never below 14px. When labels do not fit, some are left out and a note says how many.' },
    { tab: 'labels', sec: 'Labels', key: 'labelPriority', label: 'Keep first when space runs out', type: 'select', opts: [['weight', 'Heaviest links'], ['links', 'Most links'], ['alpha', 'A to Z']], def: 'weight' },
    { tab: 'labels', sec: 'Labels', key: 'labelGap', label: 'Distance from the node', type: 'number', min: 2, max: 30, step: 1, unit: 'px', def: 7 },
    { tab: 'labels', sec: 'Labels', key: 'labelMaxPct', label: 'Longest label may take', type: 'number', min: 15, max: 60, step: 1, unit: '%', def: 34, help: 'Share of the ring radius. Longer names are cut with an ellipsis.' },
    { tab: 'labels', sec: 'Colour', key: 'textMode', label: 'Text colour', type: 'chips', opts: [['auto', 'Automatic'], ['custom', 'Custom']], def: 'auto', help: 'A custom colour is used only if it reaches 7 to 1 contrast on the background.' },
    { tab: 'labels', sec: 'Colour', key: 'textCustom', label: 'Custom text', type: 'color', def: '#f3f5f7', when: { key: 'textMode', eq: 'custom' } },
    { tab: 'tooltip', sec: 'Tooltip', key: 'showReadout', label: 'Show the hover readout', type: 'check', def: true },
    { tab: 'fonts', sec: 'Font', key: 'fontFamily', label: 'Font', type: 'select', opts: FONT_STACKS, def: FONT_STACKS[0][0] },
    { tab: 'background', sec: 'Background', key: 'bgMode', label: 'Background', type: 'chips', opts: [['auto', 'Worksheet'], ['navy', 'Navy'], ['white', 'White'], ['custom', 'Custom'], ['transparent', 'Transparent']], def: 'auto', help: 'Worksheet uses the sheet background when Tableau supplies one, deep navy otherwise.' },
    { tab: 'background', sec: 'Background', key: 'bgCustom', label: 'Custom background', type: 'color', def: '#081f33', when: { key: 'bgMode', eq: 'custom' } },
    { tab: 'animation', sec: 'Entrance', key: 'entrance', label: 'Entrance fade-in', type: 'check', def: true },
    { tab: 'interaction', sec: 'Marks', key: 'hoverHighlight', label: 'Light links on hover', type: 'check', def: true },
    { tab: 'interaction', sec: 'Marks', key: 'clickSelect', label: 'Click pins a node and selects its marks', type: 'check', def: true },
    { tab: 'interaction', sec: 'Marks', key: 'pushHover', label: 'Send hover to Tableau', type: 'check', def: true, help: 'Makes other sheets on the dashboard highlight too. Not available on C-Tableau Viz pages.', when: HOV }
  ];

  /* animMs and animEase belong to the entrance only; show them only while it is on. */
  stdRows.forEach(function (r) { if (r.key === 'animMs' || r.key === 'animEase') r.when = { key: 'entrance', truthy: true }; });

  var schema = { tabs: TABS, rows: R.concat(stdRows) };
  var prepared = CP.prepare(schema);
  var DEFAULTS = CP.defaultsOf(prepared.rows);
  var BY_KEY = {};
  prepared.rows.forEach(function (r) { if (r.type !== 'note') BY_KEY[r.key] = r; });

  /* Typed values from whatever is stored (strings, or a Copy settings block). */
  function resolve(stored) {
    var out = {};
    Object.keys(BY_KEY).forEach(function (k) {
      var raw = stored ? stored[k] : undefined;
      var v = raw === undefined || raw === null || raw === '' ? undefined : CP.coerce(BY_KEY[k], raw);
      out[k] = v === undefined ? DEFAULTS[k] : v;
    });
    return out;
  }

  /* Old keys that moved. get(key) returns one stored string or undefined. Returns what to carry across.
   * Today: panelTheme (the old panel's light, dark or match) becomes the new panel's theme. */
  function legacy(get) {
    var out = { panel: {} };
    var pt = get('panelTheme');
    if (pt === 'light' || pt === 'dark' || pt === 'match') out.panel.theme = pt;
    return out;
  }

  return { schema: schema, prepared: prepared, DEFAULTS: DEFAULTS, BY_KEY: BY_KEY, KEYS: Object.keys(BY_KEY), resolve: resolve, legacy: legacy,
    coerce: function (k, v) { var r = BY_KEY[k]; return r ? CP.coerce(r, v) : v; }, FONT_STACKS: FONT_STACKS, std: std };
});
