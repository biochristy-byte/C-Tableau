# In-viz gear: a multi chart type viz extension

All facts from `C:/Users/bioch/projects/retired-extensions/tableau-panel-chart/` (Panel Chart), built on
the shared library `shared/ctab-panel/` (API: `shared/ctab-panel/README.md`).

## Manifest (`panel-chart.trex`)

- `<viz-extension id="com.datadivers.vizext.<name>">`, `<min-api-version>1.12</min-api-version>`.
- `<source-location><url>http://localhost:<port>/src/index.html</url>`; the port comes from `ports.json`.
- `<permissions><permission>full data</permission></permissions>` so the extension can read summary data.
- A viz extension gets `tableau.extensions.worksheetContent.worksheet`. If it is missing, the extension
  was loaded as a dashboard extension: log it and stop (`src/js/app.js`, `boot`).

## Boot sequence (`src/js/app.js`, `boot` and `mount`)

```js
tableau.extensions.initializeAsync().then(function () {
  var wc = tableau.extensions.worksheetContent;
  if (!wc || !wc.worksheet) return log('load as a viz extension');
  return mount(wc.worksheet);
});
// mount(ws):
state.store = CP.createStore({ rows: SET.prepared.rows, settings: tableau.extensions.settings,
                               prefix: PREFIX, onChange: onChange, log: log });
state.store.load();
state.panel = CP.create(root, { title: '... settings', schema: SET.schema, store: state.store,
                                info: info, state: state.store.panelState, prefix: PREFIX,
                                version: '1.0.0', onLayout: scheduleRedraw });
state.panel.applyAppearance('#ffffff', '#14202e');   // chart background, ink: the "match the chart" theme
```

- Redraw on three triggers: store `onChange`, window `resize`, and the panel's `onLayout` (a pinned
  panel narrows the chart without firing `resize`). Debounce ~60 ms (`scheduleRedraw`).
- Re-read data on worksheet events with `ws.addEventListener(evt, refreshData)`, each in try/catch
  (`app.js`, `mount`); an event type can be missing on older Tableau.
- When `initializeAsync` fails, show a plain message plus `CP.diagButton(el, {panel})` so a blank
  screen still yields a diagnostics report.

## The schema (`src/js/settings.js`)

Start from `CP.standard({ fields: [...], over: {...} })`. It returns the standard tabs and rows;
`over` retunes labels, defaults and tab of standard rows by key; `fields` adds field pickers
(`kind: 'numeric'` limits the choices). Add your own tabs and rows, then `CP.prepare(schema)` and
`CP.defaultsOf(prepared.rows)`.

Row types in the source: `chips` (`opts: [[value,label],...]`), `check`, `number`
(`min max step unit`), `text` (`maxLength placeholder`), `list` (`source: 'cats'`: rename, hide,
reorder, color a category). Every row: `tab sec key label def help when`.

The multi chart type pattern is one `chartType` chips row at the top of the first tab, then every
type-specific row gated on it:

```js
{ tab:'chart', sec:'Type', key:'chartType', label:'Chart type', type:'chips',
  opts:[['bar','Bar'],['line','Line'],['area','Area'],['scatter','Scatter']], def:'bar' },
{ tab:'chart', sec:'Type', key:'orientation', label:'Bars run', type:'chips',
  opts:[['vertical','Up'],['horizontal','Across']], def:'vertical', when:{key:'chartType', eq:'bar'} },
{ tab:'lines', sec:'Line', key:'showPoints', label:'Dot on every value', type:'check', def:true,
  when:{key:'chartType', in:['line','area']} },
{ tab:'bars', sec:'Shape', key:'barOutlineWidth', label:'Outline width', type:'number',
  min:0.5, max:6, step:0.5, unit:'px', def:1.5, when:{key:'barOutline', truthy:true} }
```

`when` forms: `{key, eq|ne|in|truthy}`, an array of those (all must hold), or
`function (settings, info) {}`. Keep one render path per type behind a switch on `chartType`
(`src/js/render.js`) over one shared model (`src/js/model.js`: group by category and series, aggregate
with sum, avg, min, max or count, sort, top N, stack or percent).

## Rules specific to this shape

- Keys are flat (`barGap`, not `bars.gap`): the shape Copy settings emits.
- Stack and percent only matter when a Series field splits the marks: say so in `help`.
- Bars and stacks start at zero whatever `zeroBase` says (the schema help says so; the renderer
  enforces it). A truncated bar axis misleads.
- Thin axis labels until none touch instead of shrinking text; wrap category labels to N lines.
- Text color: Auto picks the best contrast on the background; a user color is adjusted to 7:1.
- Marks glide to their new place on a data or setting change (`animMs`, default 650).

## Tests that existed

`test/run.js` (schema, model, render math), `test/panel_audit.js` (every row reachable, `when` rules),
`test/sabotage.py` (break, restore), `test/browser_test.py` (panel in a browser on `dev/dev.html`).
