/* Neurons Viz Extension - settings schema.
 *
 * One source of truth for every option: default, control type, group. The
 * settings panel is generated from it and the renderer reads the resolved
 * values. No sliders anywhere: numbers are steppers you can type into.
 *
 * Control types: toggle, number (stepper), color, segmented (chip group),
 * select (dropdown), text.
 */
(function (global) {
  'use strict';

  var FONT_STACKS = [
    { value: 'Inter, "Segoe UI", system-ui, -apple-system, Arial, sans-serif', label: 'Inter / Segoe UI' },
    { value: '"Tableau Book", "Benton Sans", Arial, sans-serif', label: 'Tableau Book' },
    { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
    { value: '"Trebuchet MS", Tahoma, sans-serif', label: 'Trebuchet MS' },
    { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
    { value: 'Tahoma, Verdana, sans-serif', label: 'Tahoma' }
  ];

  var MIN_FONT = 14;

  var GROUPS = [
    {
      id: 'layout', label: 'Layout', options: [
        { key: 'beta', label: 'Bundling strength (beta)', type: 'number', def: 0.85, min: 0, max: 1, step: 0.05,
          help: '0 draws straight chords. 1 pulls every link tightly through its group hubs.' },
        { key: 'groupGap', label: 'Gap between groups', type: 'number', def: 2.5, min: 0, max: 8, step: 0.5, unit: 'slots',
          help: 'Empty room between groups, measured in node spacings.' },
        { key: 'groupOrder', label: 'Group order', type: 'select', def: 'data',
          choices: [{ value: 'data', label: 'Data order' }, { value: 'alpha', label: 'A to Z' }, { value: 'size', label: 'Biggest group first' }] },
        { key: 'nodeSort', label: 'Order inside a group', type: 'select', def: 'alpha',
          choices: [{ value: 'alpha', label: 'A to Z' }, { value: 'degree', label: 'Most connected first' }, { value: 'data', label: 'Data order' }] },
        { key: 'rotation', label: 'Rotate', type: 'number', def: 0, min: -180, max: 180, step: 5, unit: 'deg' }
      ]
    },
    {
      id: 'links', label: 'Links', options: [
        { key: 'linkOpacity', label: 'Link opacity', type: 'number', def: 0.34, min: 0.02, max: 1, step: 0.02 },
        { key: 'linkMinWidth', label: 'Thinnest link', type: 'number', def: 0.8, min: 0.25, max: 6, step: 0.25, unit: 'px' },
        { key: 'linkMaxWidth', label: 'Thickest link', type: 'number', def: 3.2, min: 0.5, max: 12, step: 0.25, unit: 'px',
          help: 'Used when a link weight is on the Weight shelf.' },
        { key: 'weightScale', label: 'Weight scale', type: 'segmented', def: 'sqrt',
          choices: [{ value: 'sqrt', label: 'Square root' }, { value: 'linear', label: 'Linear' }, { value: 'log', label: 'Log' }] },
        { key: 'linkColorMode', label: 'Link colour', type: 'segmented', def: 'source',
          choices: [{ value: 'source', label: 'Source group' }, { value: 'target', label: 'Target group' }, { value: 'single', label: 'One colour' }] },
        { key: 'linkColor', label: 'One colour', type: 'color', def: '#3cc4d1', when: { key: 'linkColorMode', is: 'single' } }
      ]
    },
    {
      id: 'hover', label: 'Hover and click', options: [
        { key: 'hoverHighlight', label: 'Light links on hover', type: 'toggle', def: true },
        { key: 'hoverMode', label: 'Which links light up', type: 'segmented', def: 'both',
          choices: [{ value: 'both', label: 'Both' }, { value: 'out', label: 'Outgoing' }, { value: 'in', label: 'Incoming' }] },
        { key: 'outColor', label: 'Outgoing colour', type: 'color', def: '#f2b84b' },
        { key: 'inColor', label: 'Incoming colour', type: 'color', def: '#8fe3ec' },
        { key: 'dimOpacity', label: 'Dimmed links', type: 'number', def: 0.05, min: 0, max: 0.5, step: 0.01 },
        { key: 'fadeMs', label: 'Fade time', type: 'number', def: 280, min: 0, max: 1000, step: 20, unit: 'ms' },
        { key: 'glow', label: 'Glow on lit links', type: 'toggle', def: true },
        { key: 'terminals', label: 'Synapse bulbs on lit links', type: 'toggle', def: true },
        { key: 'clickSelect', label: 'Click pins a node and selects its marks', type: 'toggle', def: true },
        { key: 'pushHover', label: 'Send hover to Tableau', type: 'toggle', def: true },
        { key: 'showReadout', label: 'Show the hover readout', type: 'toggle', def: true },
        { key: 'entrance', label: 'Entrance fade-in', type: 'toggle', def: true }
      ]
    },
    {
      id: 'nodes', label: 'Nodes', options: [
        { key: 'nodeSize', label: 'Node size', type: 'number', def: 4, min: 2, max: 12, step: 0.5, unit: 'px' },
        { key: 'nodeHalo', label: 'Soft halo around nodes', type: 'toggle', def: true }
      ]
    },
    {
      id: 'labels', label: 'Labels', options: [
        { key: 'showLabels', label: 'Node labels', type: 'toggle', def: true },
        { key: 'fontSize', label: 'Text size', type: 'number', def: MIN_FONT, min: MIN_FONT, max: 28, step: 1, unit: 'px',
          help: 'Never below 14px. When labels do not fit, some are left out and a note says how many.' },
        { key: 'labelPriority', label: 'Keep first when space runs out', type: 'select', def: 'weight',
          choices: [{ value: 'weight', label: 'Heaviest links' }, { value: 'links', label: 'Most links' }, { value: 'alpha', label: 'A to Z' }] },
        { key: 'showGroupNames', label: 'Group names on the arcs', type: 'toggle', def: true },
        { key: 'fontFamily', label: 'Font', type: 'select', def: FONT_STACKS[0].value, choices: FONT_STACKS }
      ]
    },
    {
      id: 'colors', label: 'Colours', options: [
        { key: 'bgMode', label: 'Background', type: 'segmented', def: 'auto',
          choices: [{ value: 'auto', label: 'Worksheet' }, { value: 'navy', label: 'Navy' }, { value: 'white', label: 'White' }, { value: 'custom', label: 'Custom' }],
          help: 'Worksheet uses the sheet background when Tableau supplies one, deep navy otherwise.' },
        { key: 'bgCustom', label: 'Custom background', type: 'color', def: '#081f33', when: { key: 'bgMode', is: 'custom' } },
        { key: 'textMode', label: 'Text colour', type: 'segmented', def: 'auto',
          choices: [{ value: 'auto', label: 'Automatic' }, { value: 'custom', label: 'Custom' }],
          help: 'A custom colour is used only if it reaches 7 to 1 contrast on the background.' },
        { key: 'textCustom', label: 'Custom text', type: 'color', def: '#f3f5f7', when: { key: 'textMode', is: 'custom' } },
        { key: 'palette', label: 'Group colours', type: 'select', def: 'diver',
          choices: [{ value: 'diver', label: 'Data Divers' }, { value: 'safe', label: 'Colour-blind safe' }, { value: 'warm', label: 'Warm' }, { value: 'cool', label: 'Cool' }] }
      ]
    },
    {
      id: 'panel', label: 'This panel', options: [
        { key: 'panelTheme', label: 'Panel theme', type: 'segmented', def: 'match',
          choices: [{ value: 'match', label: 'Match' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] },
        { key: 'panelSide', label: 'Side', type: 'segmented', def: 'right',
          choices: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }] },
        { key: 'gearCorner', label: 'Gear corner', type: 'select', def: 'tr',
          choices: [{ value: 'tr', label: 'Top right' }, { value: 'tl', label: 'Top left' }, { value: 'br', label: 'Bottom right' }, { value: 'bl', label: 'Bottom left' }] }
      ]
    }
  ];

  var BY_KEY = {};
  var DEFAULTS = {};
  GROUPS.forEach(function (g) {
    g.options.forEach(function (o) { BY_KEY[o.key] = o; DEFAULTS[o.key] = o.def; });
  });

  function isHex (v) { return /^#[0-9a-f]{6}$/i.test(String(v || '')); }

  function coerce (key, raw) {
    var o = BY_KEY[key];
    if (!o) return raw;
    if (raw === undefined || raw === null || raw === '') return o.def;
    switch (o.type) {
      case 'toggle':
        if (typeof raw === 'boolean') return raw;
        return String(raw).toLowerCase() === 'true';
      case 'number': {
        var n = typeof raw === 'number' ? raw : parseFloat(raw);
        if (!isFinite(n)) return o.def;
        if (o.min !== undefined) n = Math.max(o.min, n);
        if (o.max !== undefined) n = Math.min(o.max, n);
        return Math.round(n * 1000) / 1000;
      }
      case 'color': {
        var s = String(raw).trim();
        if (/^[0-9a-f]{6}$/i.test(s)) s = '#' + s;
        return isHex(s) ? s.toLowerCase() : o.def;
      }
      case 'segmented':
      case 'select': {
        var v = String(raw);
        for (var i = 0; i < o.choices.length; i++) if (o.choices[i].value === v) return v;
        return o.def;
      }
      default:
        return String(raw);
    }
  }

  function resolve (stored) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = coerce(k, stored ? stored[k] : undefined); });
    return out;
  }

  function isVisible (opt, settings) {
    if (!opt.when) return true;
    return settings[opt.when.key] === opt.when.is;
  }

  global.NX = global.NX || {};
  global.NX.schema = {
    GROUPS: GROUPS, BY_KEY: BY_KEY, DEFAULTS: DEFAULTS, FONT_STACKS: FONT_STACKS, MIN_FONT: MIN_FONT,
    coerce: coerce, resolve: resolve, isVisible: isVisible
  };
})(typeof window !== 'undefined' ? window : globalThis);
