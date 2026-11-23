# ctab-panel

The shared floating settings panel for the C-Tableau viz extensions. It is what Garden Petals' settings panel
("float like the AI Garden") grew into: one library, vendored byte-for-byte into every extension.

Files: `ctab-panel.js`, `ctab-panel.css`. Vendor both into `<extension>/lib/ctab-panel/` and run
`python shared/ctab-panel/sync_check.py`, which fails if a copy's sha256 differs from this folder.

## What it does

- A gear button opens a floating panel. Drag it by the title bar (pointer events, so mouse, pen and touch),
  clamped to the frame. Minimize to the title bar, close, Escape closes, focus returns to the gear.
  Arrow keys on the focused title bar move it 16px. Position, minimized state and last tab are remembered.
- Under 420px wide the panel becomes a full-frame sheet that scrolls as one piece.
- Tabs wrap (scroll in the sheet). A search box filters rows across every tab.
- Row types: `number` (typed stepper, min/max/step/unit, never a range input), `select`, `chips`, `check`,
  `color` (picker plus hex text, optional Auto), `text`, `font` (sans-serif only), `palette`, `field`
  (pick a field by hand), `list` (reorder with up/down, per-item name, color, show/hide), `note`.
- Conditional rows (`when`), help text under a row, "Reset this tab" and "Reset all" with an inline confirm,
  Copy settings and Paste settings (validated, inline message, nothing changes on bad input), Undo.
- Panel theme: light, dark, match the chart, custom. Every color comes from one function that forces 7:1 text,
  so any chart background works. Text is never below 14px. No browser dialogs anywhere.

## Declaring a schema

```js
var std = CTabPanel.standard({
  fields: [{ key: 'fieldAxis', label: 'Axis field' }, { key: 'fieldValue', label: 'Value field', kind: 'numeric' }]
});                       // Colors, Labels, Number format, Tooltip, Fonts, Background, Animation, Interaction, Fields

var schema = {
  tabs: [{ id: 'layout', label: 'Layout' }].concat(std.tabs),
  rows: [
    { tab: 'layout', sec: 'View', key: 'mode', label: 'Show as', type: 'chips', opts: [['overlay', 'Overlay'], ['multi', 'Small multiples']], def: 'overlay' },
    { tab: 'layout', sec: 'View', key: 'cols', label: 'Columns', type: 'number', min: 1, max: 8, step: 1, def: 3,
      when: { key: 'mode', eq: 'multi' }, help: 'Only for small multiples.' }
  ].concat(std.rows)
};
```

`when` is `{key, eq|ne|in|truthy}`, an array of those (all must hold), or `function (settings, info) {}`.
Keys are flat (`ringCount`), which is the shape Copy settings produces and the Viz pages flow reads.

```js
var store = CTabPanel.createStore({ schema: schema, settings: tableau.extensions.settings, prefix: 'radar.',
                                    onChange: redraw });   // onChange fires at most once per frame
store.load();                                              // typed values from the stored strings
var panel = CTabPanel.create(document.getElementById('root'), {
  title: 'Radar settings', schema: schema, store: store, prefix: 'radar.', state: store.panelState,
  info: function () { return { columns: [...], numericColumns: [...], auto: { fieldAxis: 'Region' },
                               lists: { categories: [{ key, name, color }], axes: [...] } }; }
});
panel.applyAppearance(chartBg, chartInk);   // so the "match the chart" theme follows the worksheet
```

The store keeps values typed in memory, writes `prefix + key` strings to Tableau extension settings, and calls
`saveAsync` after a quiet 400 ms (one write for a burst of clicks). Renderers read `store.get()` and use the
exported helpers: `formatNumber(v, settings)`, `paletteColors(id, reverse)`, `fontStack(id)`,
`mergeList(saved, items)`, `coerce(row, v)`.

## Tests

| Command | What it proves |
|---|---|
| `node test/schema_test.js` | schema engine: validation, coercion, `when`, search, paste, list merge, number format, 7:1 theme math, the store, the standard rows |
| `python test/panel_test.py` | the demo page in Chromium: drag (mouse and touch) clamps to the frame, minimize, close, Escape, focus return, search, conditional rows, reset with inline confirm, undo, copy and paste, keyboard, 14px floor, 7:1 in light, dark, match and custom, no range input, no browser dialog, the full-frame sheet |
| `python test/sync_test.py` | the sync gate itself |
| `python test/sabotage.py` | breaks the subject of each test once (28 sabotages), shows RED, restores byte-exact (sha256), ends GREEN |

`--only group,group` runs chosen groups of `panel_test.py`; `--shots DIR` writes screenshots.
