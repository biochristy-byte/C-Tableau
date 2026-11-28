# Dashboard gear: parameters, filters, presets, reset

All facts from `C:/Users/bioch/projects/retired-extensions/tableau-settings-panel/`: `src/js/model.js`
(Tableau calls, snapshots, presets, search), `src/js/app.js` (boot, events, zone fit),
`src/js/panel.js` (UI), `settings-panel.trex`.

## Manifest

- `<dashboard-extension id="com.datadivers.dashext.<name>">`, `<min-api-version>1.12`.
- `<context-menu><configure-context-menu-item/></context-menu>` so the zone menu offers Configure; wire
  it with `initializeAsync({ configure: function () { panel.open(); return Promise.resolve(); } })`.
- A dashboard extension reads `tableau.extensions.dashboardContent.dashboard`. No `dashboardContent`
  means it was added as a viz extension: log and stop.

## Read the workbook (`model.js`, `read`)

```js
var pp = dashboard.getParametersAsync();                         // every parameter
var ff = dashboard.worksheets.map(ws => ws.getFiltersAsync());   // filters, per worksheet
```

- Parameter fields used: `name`, `dataType` (`bool int float string date date-time`), `currentValue`,
  `allowableValues.type` (`all list range`) with `.allowableValues` (list), `.minValue`, `.maxValue`,
  `.stepSize`, `.dateStepPeriod`. Values are `DataValue` objects: raw is `.value`, display is
  `.formattedValue` (`rawOf`, `labelOf`, `keyOf`; a `Date` becomes ISO text).
- Control choice (`paramControl`): bool is a toggle; list is chips when few and short, else a select;
  date is a date input; number is a stepper (a range uses `stepSize`, else a 1-2-5 `niceStep` giving
  about 20 clicks); anything else is text.
- Filter fields: `fieldName`, `filterType` (`categorical range relative-date`; hierarchical is listed,
  not editable), `appliedValues`, `isExcludeMode`, `isAllSelected`, `minValue`, `maxValue`,
  `includeNullValues`, `anchorDate`, `periodType`, `rangeType`, `rangeN`.
- Domain: `f.getDomainAsync('database')` returns `{values}` (categorical) or `{min, max}` (range). The
  `'database'` domain is the full domain, not only what survives other filters.
- A filter applied to several worksheets arrives once per sheet. Group by type plus field into one
  control that drives every copy (`groupFilters`) and label it "On N sheets".

## Write (`model.js`)

| Change | Call | Note |
| --- | --- | --- |
| Parameter | `param.changeValueAsync(value)` | send a typed value (Number, boolean, string); clamp and round first |
| Categorical filter | `ws.applyFilterAsync(field, values, 'replace', {isExcludeMode})` | values as strings; select all with `applyFilterAsync(field, [], 'all', {isExcludeMode:false})` |
| Range filter | `ws.applyRangeFilterAsync(field, {min, max, nullOption})` | `nullOption` is `'all-values'` or `'non-null-values'`; swap if min > max; dates as `Date` |
| Relative date | `ws.applyRelativeDateFilterAsync(field, {anchorDate, periodType, rangeType, rangeN})` | feature-check; absent on older Tableau |
| Clear | `ws.clearFilterAsync(field)` | |
| Highlight | `ws.selectMarksByValueAsync([{fieldName, value:[...]}], 'select-replace')` | |

Run the call on every copy of a grouped filter (`Promise.all`).

## Events (`app.js`, `mount`)

```js
var T = tableau.TableauEventType;
param.addEventListener(T.ParameterChanged, refresh);          // each parameter
ws.addEventListener(T.FilterChanged, refresh);                // each worksheet
ws.addEventListener(T.SummaryDataChanged, panel.refreshMarks);
```

`refresh` re-runs `read`, so a change made elsewhere (a dashboard filter card) shows in the gear. Guard
each with `if (x.addEventListener && T.X)`.

## Search

One lowercased haystack per control: label, group, sheet names, formatted value, option labels. Split
the query on spaces and require every word (`matches`).

## Presets and reset to workbook defaults

A snapshot is plain JSON (`capture`):

```js
{ v:1, params:{ [name]: value },
  filters:{ ['f:' + type + ':' + field]: {all, exclude, values} | {min, max, nulls} | {anchor, period, range, n} } }
```

- Presets: one JSON string in `tableau.extensions.settings` under key `sp.presets`, an array of
  `{id, name, snap, savedAt}`. Save with `settings.set(key, JSON.stringify(list))` then
  `await settings.saveAsync()`. Names: strip control characters, collapse spaces, cap at 60, make
  unique (`Name 2`, `Name 3`). Parse defensively: bad JSON means an empty list.
- Defaults: on first run, if `sp.defaults` is empty, capture the live state and store it. That snapshot
  is the workbook defaults; Reset restores it. Capture it in `mount` right after the first `read`,
  before the viewer touches anything.
- `restore(model, snap)` diffs the snapshot against `capture(model)`, builds one job per difference and
  runs the jobs in sequence (a `reduce` over a promise chain). It returns
  `{applied, unchanged, missing:[names], failed:[names]}`. A parameter or filter that no longer exists
  is reported as missing, not thrown.

## Zone fit (optional)

For a floating zone only, `dashboard.moveAndResizeDashboardObjectsAsync([{dashboardObjectID, x, y,
width, height}])` can shrink the zone to a gear button and grow it when the panel opens, clamped to
`dashboard.size`. Feature-check it and `.catch` the promise (`app.js`, `fit`): Tableau can refuse.

## Tests that existed

`test/run.js` (read, group, set, snapshot, restore diff, presets, search), `test/sabotage.py`,
`test/browser_test.py` on `dev/dev.html` with `dev/mock-dashboard.js`.
