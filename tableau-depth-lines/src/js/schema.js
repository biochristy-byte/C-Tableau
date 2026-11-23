/* Depth Lines - settings schema. Single source of truth: the panel is built
 * from it and the renderer reads the resolved values. */
(function (global) {
  'use strict';
  var HX = global.HX;

  var GROUPS = [
    {
      id: 'contours', label: 'Contours', options: [
        { key: 'bandwidth', label: 'Bandwidth', type: 'number', def: 4, min: 0.5, max: 25, step: 0.5, unit: '% of plot',
          help: 'How far each point spreads. Small shows fine detail, large shows one smooth hill.' },
        { key: 'levels', label: 'Depth bands', type: 'number', def: 8, min: 2, max: 24, step: 1, int: true,
          help: 'How many contour levels, shallow to deep.' },
        { key: 'floor', label: 'Shallowest band at', type: 'number', def: 6, min: 1, max: 60, step: 1, unit: '% of peak',
          help: 'The outermost contour sits at this share of the densest spot.' },
        { key: 'fill', label: 'Filled bands', type: 'toggle', def: true },
        { key: 'lines', label: 'Contour lines', type: 'toggle', def: true },
        { key: 'lineWidth', label: 'Line width', type: 'number', def: 1, min: 0.5, max: 4, step: 0.25, unit: 'px', when: { key: 'lines', eq: true } },
        { key: 'sea', label: 'Water tint behind bands', type: 'toggle', def: true },
        { key: 'points', label: 'Show points', type: 'toggle', def: false },
        { key: 'pointSize', label: 'Point size', type: 'number', def: 2.5, min: 1, max: 8, step: 0.5, unit: 'px', when: { key: 'points', eq: true } },
        { key: 'pointOpacity', label: 'Point opacity', type: 'number', def: 0.6, min: 0.1, max: 1, step: 0.05, when: { key: 'points', eq: true } }
      ]
    },
    {
      id: 'category', label: 'Category', options: [
        { key: 'multi', label: 'Several categories', type: 'segmented', def: 'overlay',
          choices: [{ value: 'overlay', label: 'Overlay' }, { value: 'small', label: 'Small multiples' }],
          help: 'Only applies when a field is on the Category shelf.' },
        { key: 'scale', label: 'Depth scale', type: 'segmented', def: 'each',
          choices: [{ value: 'shared', label: 'Shared' }, { value: 'each', label: 'Each its own' }],
          help: 'Shared uses one set of depth levels so categories compare fairly. Each lets a sparse category show its own shape.' },
        { key: 'cols', label: 'Panel columns', type: 'number', def: 0, min: 0, max: 8, step: 1, int: true, when: { key: 'multi', eq: 'small' },
          help: '0 picks the best fit for the space.' },
        { key: 'catPalette', label: 'Category colors', type: 'select', def: 'divers',
          choices: [{ value: 'divers', label: 'Data Divers' }, { value: 'okabe', label: 'Color-blind safe' }] }
      ]
    },
    {
      id: 'colour', label: 'Color', options: [
        { key: 'ramp', label: 'Depth ramp', type: 'select', def: 'abyss',
          choices: [{ value: 'abyss', label: 'Abyss (teal)' }, { value: 'sunrise', label: 'Sunrise (gold)' }, { value: 'mono', label: 'Mono (gray)' }] },
        { key: 'reverse', label: 'Reverse ramp', type: 'toggle', def: false },
        { key: 'lineInk', label: 'Contour line color', type: 'segmented', def: 'ink',
          choices: [{ value: 'ink', label: 'Ink' }, { value: 'band', label: 'Band color' }] },
        { key: 'theme', label: 'Theme', type: 'segmented', def: 'auto',
          choices: [{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'custom', label: 'Custom' }],
          help: 'Auto follows the worksheet background, or the viewer light or dark mode.' },
        { key: 'bgColor', label: 'Background', type: 'color', def: '#081f33', when: { key: 'theme', eq: 'custom' } }
      ]
    },
    {
      id: 'chart', label: 'Chart', options: [
        { key: 'title', label: 'Title', type: 'text', def: '' },
        { key: 'fontSize', label: 'Text size', type: 'number', def: 14, min: 14, max: 28, step: 1, int: true, unit: 'px' },
        { key: 'axes', label: 'Axis labels', type: 'toggle', def: true },
        { key: 'axisTitles', label: 'Axis titles', type: 'toggle', def: true },
        { key: 'grid', label: 'Grid lines', type: 'toggle', def: true },
        { key: 'legend', label: 'Legend', type: 'toggle', def: true }
      ]
    },
    {
      id: 'interaction', label: 'Interaction', options: [
        { key: 'selectEnabled', label: 'Click a band to select its points', type: 'toggle', def: true },
        { key: 'hoverEnabled', label: 'Hover points to highlight in Tableau', type: 'toggle', def: true },
        { key: 'showGear', label: 'Show the gear button', type: 'toggle', def: true }
      ]
    }
  ];

  global.DL = global.DL || {};
  global.DL.schema = HX.makeSchema(GROUPS);
})(typeof window !== 'undefined' ? window : globalThis);
