/* Tide Lines - settings schema. One source of truth for every option: default,
 * control type and group. The panel is generated from this and the renderer
 * reads the resolved values.
 *
 * Control types: toggle, number (typed stepper, never a slider), bandwidth
 * (stepper whose step follows the data and whose empty value means Auto),
 * color, chips (2-4 choices as a button row), select, text.
 * Every value is stored by Tableau as a string, so coerce() turns "14" back
 * into 14 and "false" back into false.
 */
(function (global) {
  'use strict';
  var TL = global.TL = global.TL || {};

  var FONTS = [
    { value: 'Inter, "Tableau Book", "Segoe UI", system-ui, Arial, sans-serif', label: 'Inter / worksheet sans' },
    { value: '"Segoe UI", system-ui, Arial, sans-serif', label: 'Segoe UI' },
    { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
    { value: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: 'Helvetica Neue' },
    { value: '"Trebuchet MS", Tahoma, sans-serif', label: 'Trebuchet MS' },
    { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' }
  ];

  var GROUPS = [
    { id: 'density', label: 'Density', options: [
      { key: 'kernel', label: 'Kernel', type: 'chips', def: 'gaussian',
        choices: [{ value: 'gaussian', label: 'Gaussian' }, { value: 'epanechnikov', label: 'Epanechnikov' }],
        help: 'Gaussian is smooth; Epanechnikov is a rounded hill with a hard edge.' },
      { key: 'bandwidth', label: 'Bandwidth', type: 'bandwidth', def: 0, min: 0,
        help: 'Empty or 0 is Auto: Silverman\'s rule, worked out for each ridge. Type a number to use one bandwidth for every ridge. Units are the Value field\'s own units.' },
      { key: 'scale', label: 'Ridge height', type: 'chips', def: 'shared',
        choices: [{ value: 'shared', label: 'Shared scale' }, { value: 'own', label: 'Each its own' }],
        help: 'Shared keeps areas honest: a wide, thin ridge stays low. Each its own scales every peak to the same height.' },
      { key: 'trim', label: 'Tails', type: 'chips', def: 'extend',
        choices: [{ value: 'extend', label: 'Extend' }, { value: 'trim', label: 'Trim to data' }],
        help: 'Trim stops each ridge at its own smallest and largest value.' }
    ] },
    { id: 'layout', label: 'Layout', options: [
      { key: 'sort', label: 'Sort ridges', type: 'chips', def: 'median',
        choices: [{ value: 'data', label: 'Data order' }, { value: 'median', label: 'By median' }, { value: 'name', label: 'By name' }] },
      { key: 'flip', label: 'Reverse order', type: 'toggle', def: false },
      { key: 'overlap', label: 'Overlap', type: 'number', def: 2, min: 0.2, max: 8, step: 0.1, unit: 'x',
        help: 'How many ridge spacings tall a peak is. 1 just touches, 3 overlaps heavily.' },
      { key: 'labelSize', label: 'Label size', type: 'number', def: 14, min: 14, max: 28, step: 1, unit: 'px',
        help: 'Never below 14px. If labels do not fit, fewer are shown and the footer says so.' },
      { key: 'showGrid', label: 'Vertical grid', type: 'toggle', def: true },
      { key: 'showAxisTitle', label: 'Axis title', type: 'toggle', def: true }
    ] },
    { id: 'marks', label: 'Marks', options: [
      { key: 'showMedian', label: 'Median tick', type: 'toggle', def: true },
      { key: 'showQuartiles', label: 'Quartile ticks', type: 'toggle', def: true },
      { key: 'fillOpacity', label: 'Fill opacity', type: 'number', def: 0.9, min: 0.1, max: 1, step: 0.05 },
      { key: 'lineWidth', label: 'Outline width', type: 'number', def: 1.5, min: 0, max: 6, step: 0.5, unit: 'px' },
      { key: 'hoverLift', label: 'Hover lift', type: 'number', def: 6, min: 0, max: 16, step: 1, unit: 'px' },
      { key: 'animate', label: 'Entrance animation', type: 'toggle', def: true }
    ] },
    { id: 'color', label: 'Colour', options: [
      { key: 'colorSource', label: 'Ridge colour', type: 'chips', def: 'tide',
        choices: [{ value: 'tide', label: 'Tide gradient' }, { value: 'field', label: 'By field' }],
        help: 'By field uses the Colour shelf. Tide gradient follows the sort order.' },
      { key: 'palette', label: 'Tide palette', type: 'select', def: 'tide',
        choices: [{ value: 'tide', label: 'Tide (Data Divers)' }, { value: 'reef', label: 'Reef shallows' }, { value: 'dusk', label: 'Dusk tide' }, { value: 'single', label: 'One colour' }] },
      { key: 'singleColor', label: 'One colour', type: 'color', def: '#3cc4d1', when: { palette: 'single' } },
      { key: 'bgMatch', label: 'Match worksheet background', type: 'toggle', def: true },
      { key: 'bgColor', label: 'Background', type: 'color', def: '#ffffff', when: { bgMatch: false } },
      { key: 'inkAuto', label: 'Auto text colour', type: 'toggle', def: true,
        help: 'Auto picks dark or light text for 7:1 contrast against the background.' },
      { key: 'inkColor', label: 'Text colour', type: 'color', def: '#0b1f2e', when: { inkAuto: false } },
      { key: 'fontFamily', label: 'Font', type: 'select', def: FONTS[0].value, choices: FONTS }
    ] },
    { id: 'tableau', label: 'Tableau', options: [
      { key: 'selectEnabled', label: 'Click a ridge to select its marks', type: 'toggle', def: true },
      { key: 'hoverPush', label: 'Send hover to Tableau', type: 'toggle', def: true,
        help: 'Also shows Tableau\'s own tooltip. Turn it off on the Marks card if you only want the one drawn here.' }
    ] }
  ];

  var DEFAULTS = {}, BY_KEY = {};
  GROUPS.forEach(function (g) { g.options.forEach(function (o) { DEFAULTS[o.key] = o.def; BY_KEY[o.key] = o; }); });

  function coerce (key, raw) {
    var o = BY_KEY[key];
    if (!o) return undefined;
    var v = raw;
    switch (o.type) {
      case 'toggle':
        if (typeof v === 'string') v = v.toLowerCase() === 'true';
        return !!v;
      case 'number':
      case 'bandwidth': {
        var n = typeof v === 'number' ? v : parseFloat(v);
        if (!isFinite(n)) n = o.def;
        if (o.min !== undefined) n = Math.max(o.min, n);
        if (o.max !== undefined) n = Math.min(o.max, n);
        return n;
      }
      case 'color':
        return /^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v).toLowerCase() : o.def;
      case 'chips':
      case 'select': {
        var ok = o.choices.some(function (c) { return c.value === v; });
        return ok ? v : o.def;
      }
      default:
        return v === undefined || v === null ? o.def : String(v);
    }
  }

  function resolve (stored) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      out[k] = stored && Object.prototype.hasOwnProperty.call(stored, k) && stored[k] !== undefined ? coerce(k, stored[k]) : DEFAULTS[k];
    });
    return out;
  }

  function visible (opt, settings) {
    if (!opt.when) return true;
    return Object.keys(opt.when).every(function (k) { return settings[k] === opt.when[k]; });
  }

  TL.schema = { GROUPS: GROUPS, DEFAULTS: DEFAULTS, BY_KEY: BY_KEY, FONTS: FONTS, coerce: coerce, resolve: resolve, visible: visible };
})(typeof window !== 'undefined' ? window : globalThis);
