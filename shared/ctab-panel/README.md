# ctab-panel

The shared floating settings panel for the C-Tableau viz extensions. It is what Garden Petals' settings panel
("float like the AI Garden") grew into: one library, vendored byte-for-byte into every extension.

Files: `ctab-panel.js`, `ctab-panel.css` and `fonts/` (Inter and Poppins as woff2, with their SIL OFL 1.1 licenses).
Vendor all of them into `<extension>/lib/ctab-panel/` and run `python shared/ctab-panel/sync_check.py`, which fails
if any copy's sha256 differs from this folder, a file is missing, or a stray file sits in the copy.

## What it does

- A gear button opens a floating panel. Drag it by the title bar (pointer events, so mouse, pen and touch),
  clamped to the frame. Minimize to the title bar, close, Escape closes, focus returns to the gear.
  Arrow keys on the focused title bar move it 16px.
- **Dock** (header button, or double-click the title bar) puts it back top right; double-click again returns it
  to where you had it. A docked panel follows the corner when the frame resizes.
- **Pin to side** (header button): a 360px full-height strip on the right, and the chart reflows narrower. Every
  other child of the host is pulled in from the right (`right` for positioned children, `margin-right` for the
  rest), so an extension whose ResizeObserver watches its chart redraws with no extra code; `opts.onLayout({
  reserveRight, pinned })` tells one that lays out another way. Pinned, the tabs become an accordion (several
  sections open at once, `aria-expanded`). Pin needs a view at least 760 by 420; smaller, the button says why.
- **Panel habits live per machine**: position, dock, pin, open sections, tab, theme and panel text size go to
  `localStorage` under `ctab:<prefix>panel` (every access in try/catch, with an in-memory fallback), never to the
  workbook, so moving the panel no longer dirties the workbook. HYDRATE: 1.0.0 wrote them to the workbook as
  `<prefix>_panel`; the first load on a machine with nothing local carries that copy over once and leaves it in
  the workbook.
- Under 420px wide the panel becomes a full-frame sheet that scrolls as one piece (Dock and Pin step aside).
- Tabs wrap (scroll in the sheet). A search box filters rows across every tab.
- Row types: `number` (typed stepper, min/max/step/unit, never a range input), `select`, `chips`, `check`,
  `color` (picker plus hex text, optional Auto), `text`, `font` (sans-serif only), `palette`, `field`
  (pick a field by hand), `list` (reorder with up/down, per-item name, color, show/hide), `note`,
  `preview` (a live line, `text(settings)`), `action` (a one-click setup, `apply(settings, info) -> values`,
  one undo step).
- **Rows that do not apply are grayed out, not hidden**, so nothing jumps: controls disabled, `aria-disabled`, a
  dashed outline and a lock, and a full-contrast line saying what turns the row on ("Turn on "Show labels" to use
  this."). No opacity, so 7:1 holds. `offHelp` overrides the sentence; `hideWhenOff: true` hides a row instead.
- Footer: Undo, **Revert to when I opened** (back to the settings at the first open of this visit, one undo
  step), Reset all; **Copy formatting** (leaves out field picks and per-item lists: `field` and `list` rows, or
  `data: true`), **Copy everything**, Paste. Reset this tab sits at the foot of the tab. A copy is a labeled block
  `{ ctab, chart, name, kind, copied, settings }`; Paste says where it came from, and a block from another
  C-Tableau chart applies only the shared standard-tab looks. The last copy is also kept on this machine
  ("Use the last copy on this machine"), since embedded frames often block the clipboard.
- **Save-status line**: "Saved to the workbook.", or "These changes last for this visit only: this view cannot save
  to the workbook." when `saveAsync` is rejected (a viewer without edit rights).
- **Diagnostics** (Panel tab): Show and Copy a JSON report with the library and extension versions, view size and
  pixel ratio, browser, Tableau environment, data received (`info().data`: rows, fields, up to 4 sample rows),
  automatic picks, the last 6 draws (timed by the store) and `panel.trace({ marks })` calls, the last 20 errors
  (window `error` and `unhandledrejection` listeners, plus `CTabPanel.noteError`), settings and panel state.
  `CTabPanel.diagButton(el, { panel })` puts a Copy diagnostics button on a blank or error screen.
- Panel theme: light, dark, match the chart, custom. Every color comes from one function that forces 7:1 text,
  so any chart background works. Panel text size 100, 115 or 130% (chips). Text is never below 14px. No browser
  dialogs anywhere.

## Standard tabs (CTabPanel.standard)

Colors, Labels, Number format, Tooltip, Fonts, Background, Animation, Interaction, Fields. 1.1.0 adds:

- **Text size** chips (100, 115, 130, 145%), each drawn at its own size. Renderers get every chart text size
  multiplied (never under 14px) through `store.get()`; the panel reads `store.raw()` so steppers show what was
  typed. A text size row is a `number` row with `textSize: true`, or a px row with min 14 and "size" in its label
  or key (`textSize: false` opts out).
- **Title placeholders**: `titleText` fills `{n}` (from `info().data.rows`) and any `info().tokens` such as `{top}`
  and `{total}`; unknown ones stay as typed. The help line lists the ones the chart offers.
- **Option labels show their result**: thousands chips read `1,234,567`, `1 234 567`, `1234567`; a live
  "Shows as 12,345.6 and -0.5" line; weight chips drawn in their own weight.
- **Dark palette variants**: on a dark chart background (from `applyAppearance`) `paletteColors` lifts each color
  to 3:1 against that background, and the panel redraws the chart once when the background flips.
- **One-click setups**: "Set up for a meeting room" and "Set up for a small dashboard tile".
- **Poppins** joins the font list; Inter and Poppins are bundled, so they render the same on every machine.

## Declaring a schema

```js
var std = CTabPanel.standard({
  fields: [{ key: 'fieldAxis', label: 'Axis field' }, { key: 'fieldValue', label: 'Value field', kind: 'numeric' }]
});

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
Keys are flat (`ringCount`), which is the shape the Viz pages flow reads.

```js
var store = CTabPanel.createStore({ schema: schema, settings: tableau.extensions.settings, prefix: 'radar.',
                                    onChange: redraw });   // onChange fires at most once per frame
store.load();
var panel = CTabPanel.create(document.getElementById('root'), {
  title: 'Radar settings', schema: schema, store: store, prefix: 'radar.', state: store.panelState, version: '1.4.0',
  info: function () { return { columns: [...], numericColumns: [...], auto: { fieldAxis: 'Region' },
                               lists: { categories: [{ key, name, color }] },
                               data: { rows: 120, fields: [{ name, type }], sample: [row, row, row, row] },
                               tokens: { top: 'West', total: '1.2M' } }; }
});
panel.applyAppearance(chartBg, chartInk);   // the "match the chart" theme and the dark palette follow the worksheet
panel.trace({ marks: n });                  // optional, once per draw, for the diagnostics report
CTabPanel.diagButton(emptyStateEl, { panel: panel });   // on a blank or error screen
```

The store keeps values typed in memory, writes `prefix + key` strings to Tableau extension settings, and calls
`saveAsync` after a quiet 400 ms (one write for a burst of clicks), reporting the result to the save-status line.

## Tests

| Command | What it proves |
|---|---|
| `node test/schema_test.js` | schema engine: validation, coercion, `when`, gray-out reasons, search, paste (flat and labeled, same chart and cross-chart), copy blocks, list merge, number format, 7:1 theme math, dark palettes at 3:1, text-size view, title placeholders, the store (debounce, save status, per-machine panel state, HYDRATE), the standard rows |
| `python test/panel_test.py` | the demo page in Chromium, 35 groups: drag, touch, minimize, persist (no workbook write), close, Escape, search, gray-out, reset, undo, copy and paste, keyboard, 14px floor, 7:1 in six themes through opacity and color alpha (grayed rows included), no range input, no browser dialog, the sheet, plus diag, machine (HYDRATE, blocked storage), pin, dock, revert, savestatus, copyfmt, fonts, textsize, titles, options, darkpal, action and frames (rAF timing while dragging and pinning) |
| `python test/sync_test.py` | the sync gate itself, fonts included |
| `python test/sabotage.py` | breaks the subject of each test once, shows RED, restores byte-exact (sha256), ends GREEN |

`--only group,group` runs chosen groups of `panel_test.py`; `--shots DIR` writes screenshots.
