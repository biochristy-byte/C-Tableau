/* Reef - settings schema. One source of truth: defaults, control types, groups.
 * The settings panel is generated from this and the renderer reads the result.
 *
 * Control types: toggle, number (stepper you can type into, never a slider),
 * color, segmented (chips), select (dropdown), text.
 * A select with choices:'columns' is filled from the worksheet's data columns.
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
      { key: 'colorMode', label: 'Colour by', type: 'select', def: 'group', choices: [
        { value: 'group', label: 'Top-level group' }, { value: 'field', label: 'A field from Detail' },
        { value: 'depth', label: 'Level' }, { value: 'single', label: 'One colour' }],
        help: 'Field: drop a dimension or measure on Detail, then pick it below.' },
      { key: 'colorField', label: 'Colour field', type: 'select', def: '', choices: 'columns', when: { key: 'colorMode', is: 'field' } },
      { key: 'sort', label: 'Order circles', type: 'select', def: 'size', choices: [
        { value: 'size', label: 'Largest first' }, { value: 'name', label: 'Name, A to Z' }, { value: 'data', label: 'Data order' }] }
    ] },
    { id: 'colors', label: 'Colours', options: [
      { key: 'palette', label: 'Palette', type: 'select', def: 'reef', choices: PALETTE_CHOICES },
      { key: 'rampName', label: 'Number ramp', type: 'select', def: 'reef', choices: [
        { value: 'reef', label: 'Reef' }, { value: 'lagoon', label: 'Lagoon' }, { value: 'sunset', label: 'Sunset' }],
        help: 'Used when the colour field is a number.' },
      { key: 'singleColor', label: 'One colour', type: 'color', def: '#3cc4d1', when: { key: 'colorMode', is: 'single' } },
      { key: 'groupFill', label: 'Group shading', type: 'number', def: 18, min: 0, max: 60, step: 2, unit: '%' },
      { key: 'leafOpacity', label: 'Circle opacity', type: 'number', def: 92, min: 30, max: 100, step: 2, unit: '%' },
      { key: 'ringWidth', label: 'Outline width', type: 'number', def: 1.5, min: 0, max: 6, step: 0.5, unit: 'px' }
    ] },
    { id: 'layout', label: 'Layout', options: [
      { key: 'gap', label: 'Gap between circles', type: 'number', def: 5, min: 0, max: 40, step: 1, unit: '' },
      { key: 'hideBelow', label: 'Hide circles under', type: 'number', def: 2, min: 0, max: 20, step: 1, unit: 'px' },
      { key: 'margin', label: 'Edge margin', type: 'number', def: 12, min: 0, max: 80, step: 2, unit: 'px' },
      { key: 'legend', label: 'Show legend', type: 'toggle', def: true }
    ] },
    { id: 'labels', label: 'Labels', options: [
      { key: 'labels', label: 'Show labels', type: 'toggle', def: true },
      { key: 'groupLabels', label: 'Label groups', type: 'toggle', def: true, when: { key: 'labels', is: true } },
      { key: 'showValues', label: 'Show values', type: 'toggle', def: true, when: { key: 'labels', is: true } },
      { key: 'valueFormat', label: 'Number style', type: 'segmented', def: 'compact', choices: [
        { value: 'compact', label: 'Compact' }, { value: 'plain', label: 'Plain' }], when: { key: 'showValues', is: true } },
      { key: 'fontSize', label: 'Label size', type: 'number', def: 14, min: 14, max: 28, step: 1, unit: 'px',
        help: 'Never below 14 px.', when: { key: 'labels', is: true } },
      { key: 'fontFamily', label: 'Font', type: 'select', def: FONTS[0].value, choices: FONTS }
    ] },
    { id: 'zoom', label: 'Zoom', options: [
      { key: 'zoomOnClick', label: 'Click to zoom', type: 'toggle', def: true },
      { key: 'zoomMs', label: 'Zoom time', type: 'number', def: 700, min: 150, max: 2000, step: 50, unit: 'ms', when: { key: 'zoomOnClick', is: true } },
      { key: 'breadcrumb', label: 'Show breadcrumb', type: 'toggle', def: true },
      { key: 'intro', label: 'Entrance animation', type: 'toggle', def: true }
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

  global.RF = global.RF || {};
  global.RF.schema = { GROUPS: GROUPS, BY_KEY: BY_KEY, DEFAULTS: DEFAULTS, FONTS: FONTS, coerce: coerce, resolve: resolve, isVisible: isVisible };
})(typeof window !== 'undefined' ? window : globalThis);
