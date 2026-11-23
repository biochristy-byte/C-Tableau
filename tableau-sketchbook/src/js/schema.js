/* Sketchbook - settings schema. Single source of truth: the panel is built from
 * it and the renderer reads the resolved values. */
(function (global) {
  'use strict';
  var HX = global.HX;

  var GROUPS = [
    {
      id: 'chart', label: 'Chart', options: [
        { key: 'chartType', label: 'Chart type', type: 'segmented', def: 'bar',
          choices: [{ value: 'bar', label: 'Bar' }, { value: 'line', label: 'Line' }, { value: 'dot', label: 'Dot' }] },
        { key: 'sort', label: 'Order of categories', type: 'select', def: 'data',
          choices: [{ value: 'data', label: 'Data order' }, { value: 'value-desc', label: 'Value, high to low' }, { value: 'value-asc', label: 'Value, low to high' }, { value: 'alpha', label: 'A to Z' }] },
        { key: 'labels', label: 'Mark labels', type: 'segmented', def: 'none',
          choices: [{ value: 'none', label: 'None' }, { value: 'value', label: 'Value' }, { value: 'field', label: 'Label shelf' }] },
        { key: 'zero', label: 'Start the value axis at zero', type: 'toggle', def: true, help: 'Bars always start at zero.' },
        { key: 'title', label: 'Title', type: 'text', def: '' },
        { key: 'underline', label: 'Sketched underline under the title', type: 'toggle', def: false },
        { key: 'fontSize', label: 'Text size', type: 'number', def: 14, min: 14, max: 28, step: 1, int: true, unit: 'px' }
      ]
    },
    {
      id: 'sketch', label: 'Sketch', options: [
        { key: 'fillStyle', label: 'Fill', type: 'segmented', def: 'hachure',
          choices: [{ value: 'hachure', label: 'Hachure' }, { value: 'solid', label: 'Solid' }, { value: 'zigzag', label: 'Zigzag' }] },
        { key: 'roughness', label: 'Roughness', type: 'number', def: 1.2, min: 0, max: 5, step: 0.1, help: '0 is a clean line, 5 is a shaky hand.' },
        { key: 'bowing', label: 'Bowing', type: 'number', def: 1, min: 0, max: 10, step: 0.5, help: 'How much each line bends between its ends.' },
        { key: 'seed', label: 'Seed', type: 'number', def: 42, min: 1, max: 99999, step: 1, int: true, help: 'The same seed draws the same sketch every time.' },
        { key: 'hachureGap', label: 'Hatch spacing', type: 'number', def: 7, min: 2, max: 30, step: 1, unit: 'px', when: { key: 'fillStyle', in: ['hachure', 'zigzag'] } },
        { key: 'hachureAngle', label: 'Hatch angle', type: 'number', def: -41, min: -90, max: 90, step: 5, unit: 'deg', when: { key: 'fillStyle', in: ['hachure', 'zigzag'] } },
        { key: 'strokeWidth', label: 'Stroke width', type: 'number', def: 1.6, min: 0.5, max: 6, step: 0.25, unit: 'px' }
      ]
    },
    {
      id: 'marks', label: 'Marks', options: [
        { key: 'barWidth', label: 'Bar width', type: 'number', def: 72, min: 20, max: 100, step: 4, int: true, unit: '%', when: { key: 'chartType', eq: 'bar' } },
        { key: 'lineWidth', label: 'Line width', type: 'number', def: 3, min: 1, max: 10, step: 0.5, unit: 'px', when: { key: 'chartType', eq: 'line' } },
        { key: 'lineDots', label: 'Dots on the line', type: 'toggle', def: true, when: { key: 'chartType', eq: 'line' } },
        { key: 'dotSize', label: 'Dot size', type: 'number', def: 16, min: 6, max: 48, step: 1, int: true, unit: 'px', when: { key: 'chartType', eq: 'dot' } },
        { key: 'stems', label: 'Sketched stems to the axis', type: 'toggle', def: true, when: { key: 'chartType', eq: 'dot' } }
      ]
    },
    {
      id: 'colour', label: 'Colour', options: [
        { key: 'palette', label: 'Series colours', type: 'select', def: 'divers',
          choices: [{ value: 'divers', label: 'Data Divers' }, { value: 'okabe', label: 'Colour-blind safe' }, { value: 'ink', label: 'Pencil greys' }] },
        { key: 'color', label: 'Colour when there is no series', type: 'color', def: '#2aa9b8' },
        { key: 'theme', label: 'Paper', type: 'segmented', def: 'auto',
          choices: [{ value: 'auto', label: 'Auto' }, { value: 'light', label: 'White' }, { value: 'paper', label: 'Paper' }, { value: 'dark', label: 'Dark' }, { value: 'custom', label: 'Custom' }],
          help: 'Auto follows the worksheet background, or the viewer light or dark mode.' },
        { key: 'bgColor', label: 'Background', type: 'color', def: '#fbf6e9', when: { key: 'theme', eq: 'custom' } }
      ]
    },
    {
      id: 'axes', label: 'Axes', options: [
        { key: 'axes', label: 'Axis labels', type: 'toggle', def: true },
        { key: 'axisTitles', label: 'Axis titles', type: 'toggle', def: true },
        { key: 'grid', label: 'Sketched grid lines', type: 'toggle', def: true },
        { key: 'legend', label: 'Legend', type: 'toggle', def: true }
      ]
    },
    {
      id: 'interaction', label: 'Interaction', options: [
        { key: 'selectEnabled', label: 'Click a mark to select it in Tableau', type: 'toggle', def: true },
        { key: 'hoverEnabled', label: 'Hover a mark to highlight it in Tableau', type: 'toggle', def: true },
        { key: 'showGear', label: 'Show the gear button', type: 'toggle', def: true }
      ]
    }
  ];

  global.SB = global.SB || {};
  global.SB.schema = HX.makeSchema(GROUPS);
})(typeof window !== 'undefined' ? window : globalThis);
