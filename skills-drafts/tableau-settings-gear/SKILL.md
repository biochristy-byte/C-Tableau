---
name: tableau-settings-gear
description: Build a settings gear into a Tableau extension. Two shapes - an in-viz panel for a viz extension (chart type, sort, stacking, labels, axes, palette, saved in the workbook) and a dashboard gear that lists every parameter and worksheet filter with search, named presets and reset to workbook defaults. Use when someone asks for a settings panel, a control panel, a parameter or filter panel, presets, or "let viewers change X without leaving the dashboard" in a viz or dashboard extension.
argument-hint: "<viz|dashboard> <extension folder or idea>"
---

# /tableau-settings-gear

Two patterns came out of two retired house extensions (Panel Chart and Settings Panel). The
extensions are retired; the patterns are not. Their source is kept in
`C:/Users/bioch/projects/retired-extensions/` and every fact in the references cites the file it came from.
Facts were taken from that source; each extension shipped with its own test suite (see Step 4).

## Step 1: pick the shape

| The ask | Shape | Read |
| --- | --- | --- |
| Settings that restyle one chart (type, sort, stack, labels, axes, colors) | **In-viz gear**, a viz extension reading `worksheetContent` | `references/viz-gear.md` |
| One place to change parameters and filters across a dashboard, with presets | **Dashboard gear**, a dashboard extension reading `dashboardContent` | `references/dashboard-gear.md` |
| Both | Two extensions. One extension cannot be both: a viz extension gets `worksheetContent`, a dashboard extension gets `dashboardContent`. | both |

## Step 2: reuse the shared library, do not rewrite it

The floating gear UI (tabs, chips, number steppers, `when` rules, copy settings, diagnostics, dark
palette) is `shared/ctab-panel/` in this repo, vendored byte-for-byte into each extension at
`lib/ctab-panel/`. Run `shared/ctab-panel/sync_check.py` after copying. For a viz extension you write
only a schema (rows) and a redraw function. The dashboard gear is a different UI (it lists live
workbook objects), so it has its own panel code; take the model layer from the reference.

## Step 3: rules that held in the source

1. **Keep tabs and rows as data.** One `schema = {tabs, rows}` drives the panel, the defaults, the
   copy-settings text and the tests. Never hand-write a control twice.
2. **Show a row only when it applies.** `when: {key:'chartType', eq:'bar'}` keeps 100 settings readable.
3. **Persist in `tableau.extensions.settings`** (travels inside the workbook, no server). Values are
   strings: serialize on write, parse on read. Batch writes behind a ~400 ms quiet timer and call
   `saveAsync()` once.
4. **Typed values with clamps.** Clamp numbers to min/max and round to step before sending to Tableau
   or storing. Reject, do not coerce, a value outside a list parameter's allowed values.
5. **Send only what changed, one call at a time,** when restoring a preset. Tableau re-queries on every
   call; diffing the current snapshot against the preset avoids needless queries and gives clean
   `applied / unchanged / missing / failed` counts.
6. **Feature-check newer API calls.** Manifest `min-api-version` is 1.12; calls added later
   (`moveAndResizeDashboardObjectsAsync`, `applyRelativeDateFilterAsync`) are guarded with
   `typeof fn === 'function'` and skip with a message.
7. **Release readers.** A `getSummaryDataReaderAsync` reader must be released on success and on error.
8. **Dev page with a mock Tableau** (`dev/mock-tableau.js` or `dev/mock-dashboard.js`) so the panel can
   be driven in a browser and tested without Desktop.

## Step 4: prove it

- A node suite over the schema and the model: defaults round-trip, `when` rules, clamps, preset
  add/rename/delete, restore diff. Source suites: `tableau-panel-chart/test/run.js` and
  `tableau-settings-panel/test/run.js` in the retired folder.
- A sabotage run that restores the original shape (`test/sabotage.py`): break a row, break a clamp,
  confirm RED, restore, confirm GREEN.
- A browser test of the panel on the dev page (`test/browser_test.py`).
- In real Tableau: add the extension, change a setting, save, close and reopen the workbook, confirm it
  persisted. Never test on a published workbook.
- Port: register the extension in `ports.json` and run `python tools/test_port.py` (must be GREEN).

## Not covered

Letting the gear resize its own dashboard zone depends on the Tableau version
(`moveAndResizeDashboardObjectsAsync` moves floating zones only). See the dashboard reference.
