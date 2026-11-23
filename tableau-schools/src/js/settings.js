/* Schools - settings schema. One source of truth: defaults, control types, groups.
 * The settings panel is generated from this and the renderer reads the result.
 *
 * Control types: toggle, number (stepper you can type into, never a slider),
 * color, segmented (chips), select (dropdown), text.
 * `when` hides a control that cannot apply.
 */
(function (global) {
  'use strict';

  var FONTS = [
    { value: 'Inter, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif', label: 'Inter / system' },
    { value: '"Segoe UI", system-ui, Roboto, Arial, sans-serif', label: 'Segoe UI' },
    { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
    { value: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: 'Helvetica Neue' },
    { value: '"Trebuchet MS", Tahoma, sans-serif', label: 'Trebuchet MS' },
    { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' }
  ];
  var PALETTE_CHOICES = [
    { value: 'reef', label: 'Reef (default)' }, { value: 'lagoon', label: 'Lagoon' }, { value: 'sunset', label: 'Sunset' },
    { value: 'datadivers', label: 'Data Divers' }, { value: 'kelp', label: 'Kelp' }, { value: 'colorblind10', label: 'Colour-blind safe' }
  ];

  var GROUPS = [
    { id: 'data', label: 'Data', options: [
      { key: 'colorMode', label: 'Colour by', type: 'select', def: 'cluster', choices: [
        { value: 'cluster', label: 'Cluster' }, { value: 'field', label: 'Colour shelf' }, { value: 'single', label: 'One colour' }],
        help: 'Colour shelf uses the field you drop on the Colour shelf.' }
    ] },
    { id: 'colors', label: 'Colours', options: [
      { key: 'palette', label: 'Palette', type: 'select', def: 'reef', choices: PALETTE_CHOICES },
      { key: 'singleColor', label: 'One colour', type: 'color', def: '#3cc4d1', when: { key: 'colorMode', is: 'single' } },
      { key: 'opacity', label: 'Circle opacity', type: 'number', def: 92, min: 30, max: 100, step: 2, unit: '%' },
      { key: 'ringWidth', label: 'Outline width', type: 'number', def: 1.5, min: 0, max: 6, step: 0.5, unit: 'px' }
    ] },
    { id: 'layout', label: 'Layout', options: [
      { key: 'areaFill', label: 'Circle area share', type: 'number', def: 42, min: 10, max: 70, step: 2, unit: '%',
        help: 'How much of the stage the circles cover. Bigger means bigger circles.' },
      { key: 'pad', label: 'Gap between circles', type: 'number', def: 3, min: 0, max: 20, step: 1, unit: 'px' },
      { key: 'spread', label: 'Gap between clusters', type: 'number', def: 28, min: 0, max: 120, step: 4, unit: 'px' },
      { key: 'pull', label: 'Cluster pull', type: 'number', def: 5, min: 1, max: 10, step: 1, unit: '', help: 'How hard circles are drawn to their cluster. 1 is loose, 10 is tight.' },
      { key: 'minRadius', label: 'Smallest circle', type: 'number', def: 3, min: 1, max: 20, step: 1, unit: 'px', help: 'Tiny values are drawn at least this big so they stay visible.' },
      { key: 'margin', label: 'Edge margin', type: 'number', def: 14, min: 0, max: 80, step: 2, unit: 'px' },
      { key: 'legend', label: 'Show legend', type: 'toggle', def: true }
    ] },
    { id: 'labels', label: 'Labels', options: [
      { key: 'labels', label: 'Show labels', type: 'toggle', def: true },
      { key: 'clusterLabels', label: 'Label clusters', type: 'toggle', def: true, when: { key: 'labels', is: true } },
      { key: 'itemLabels', label: 'Label big circles', type: 'toggle', def: true, when: { key: 'labels', is: true } },
      { key: 'showValues', label: 'Show values', type: 'toggle', def: true, when: { key: 'labels', is: true } },
      { key: 'valueFormat', label: 'Number style', type: 'segmented', def: 'compact', choices: [
        { value: 'compact', label: 'Compact' }, { value: 'plain', label: 'Plain' }], when: { key: 'showValues', is: true } },
      { key: 'fontSize', label: 'Label size', type: 'number', def: 14, min: 14, max: 28, step: 1, unit: 'px', help: 'Never below 14 px.', when: { key: 'labels', is: true } },
      { key: 'fontFamily', label: 'Font', type: 'select', def: FONTS[0].value, choices: FONTS }
    ] },
    { id: 'motion', label: 'Motion', options: [
      { key: 'intro', label: 'Entrance animation', type: 'toggle', def: true },
      { key: 'animMs', label: 'Animation time', type: 'number', def: 800, min: 150, max: 2000, step: 50, unit: 'ms' }
    ] },
    { id: 'look', label: 'Appearance', options: [
      { key: 'theme', label: 'Background', type: 'segmented', def: 'worksheet', choices: [
        { value: 'worksheet', label: 'Worksheet' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'custom', label: 'Custom' }] },
      { key: 'customBg', label: 'Background colour', type: 'color', def: '#0d2b45', when: { key: 'theme', is: 'custom' } },
      { key: 'tooltips', label: 'Hover tooltip', type: 'toggle', def: true },
      { key: 'selectEnabled', label: 'Click selects in Tableau', type: 'toggle', def: true },
      { key: 'gearCorner', label: 'Gear corner', type: 'segmented', def: 'tr', choices: [
        { value: 'tl', label: 'Top left' }, { value: 'tr', label: 'Top right' }, { value: 'bl', label: 'Bottom left' }, { value: 'br', label: 'Bottom right' }] }
    ] }
  ];

  var DEFAULTS = {}, BY_KEY = {};
  GROUPS.forEach(function (g) { g.options.forEach(function (o) { DEFAULTS[o.key] = o.def; BY_KEY[o.key] = o; }); });

  function coerce(key, raw) {
    var o = BY_KEY[key];
    if (!o) return raw;
    if (raw === undefined || raw === null || raw === '') return o.def;
    switch (o.type) {
      case 'toggle': if (raw === true || raw === 'true') return true; if (raw === false || raw === 'false') return false; return o.def;
      case 'number':
        var n = typeof raw === 'number' ? raw : parseFloat(raw);
        if (!isFinite(n)) return o.def;
        if (o.min !== undefined) n = Math.max(o.min, n);
        if (o.max !== undefined) n = Math.min(o.max, n);
        return n;
      case 'color': return /^#[0-9a-f]{6}$/i.test(String(raw)) ? String(raw).toLowerCase() : o.def;
      case 'segmented':
      case 'select':
        if (o.choices === 'columns') return String(raw);
        return o.choices.some(function (c) { return c.value === raw; }) ? raw : o.def;
      default: return String(raw);
    }
  }
  function resolve(stored) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = coerce(k, stored ? stored[k] : undefined); });
    return out;
  }
  function isVisible(opt, s) { return !opt.when || s[opt.when.key] === opt.when.is; }

  global.SC = global.SC || {};
  global.SC.schema = { GROUPS: GROUPS, BY_KEY: BY_KEY, DEFAULTS: DEFAULTS, FONTS: FONTS, coerce: coerce, resolve: resolve, isVisible: isVisible };
})(typeof window !== 'undefined' ? window : globalThis);
