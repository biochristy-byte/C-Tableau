# Reef: a Tableau viz extension

Nested circle packing for Tableau, by Chris Fryar at Data Divers. One to three
dimension levels become circles inside circles, sized by a measure, in a coral
and reef palette that sits inside the Data Divers colours. Click a group and the
view zooms into it with an eased transition; a breadcrumb climbs back out. It
is free, MIT licensed, and runs in the free edition of Tableau Desktop.

Tableau has no built-in circle packing chart and the Tableau Exchange had no
circle-packing extension when this was checked on 11/22/2026.

## What it does

- **Four Marks card shelves**: Level 1 (required), Level 2, Level 3 (both
  optional) and Size. Four is the most Tableau allows a viz extension.
- **Optional colour**: Tableau gives an extension only four shelves, so colour
  comes from the settings panel. Pick Colour by > A field from Detail, drop any
  dimension or measure on Detail, and choose it. A dimension colours by
  category, a measure colours by a reef ramp. The default is the top-level group.
- **Smooth zoom**: click a group (or a leaf's parent) and the camera glides in
  with an ease-in-out curve at 60 fps. Only circle geometry changes per frame,
  labels fade back in when the move settles. Escape, the breadcrumb, or a click
  on the surrounding circle climbs back out. Reduced-motion users get an
  instant zoom.
- **Labels that never collide**: each label shows in full or not at all (no
  truncated stubs, the tooltip and zoom reveal hidden names), and only the focus
  level and its direct children carry one. A group with a single child folds
  into one circle. Every label is a solid chip that sits fully
  inside its own circle, so the text is 14 px or larger and 7:1 against its
  chip in light and dark, whatever colour the circle behind it is.
- **28 settings** in 6 groups (data, colours, layout, labels, zoom, appearance)
  in a gear panel inside the viz. **No sliders**: steppers you can type into,
  chip groups, dropdowns and colour inputs. No browser dialogs.
- **Selection and hover push back into Tableau.** Clicking a circle selects the
  marks under it by value on every level it sits at.
- **Copy settings** puts the whole configuration on the clipboard as JSON, and
  **Paste settings** applies one. That JSON is what the C-Tableau Viz pages flow
  accepts.
- **Settings are saved in the workbook** through Tableau's extension settings.
- **Background**: follows the worksheet, or light, dark or a custom colour.

## What else you need

| You need | Why |
| --- | --- |
| **Tableau Desktop 2024.2 or newer** | Viz extensions need 2024.2 at minimum. The free edition works. |
| **Windows PowerShell** (or Node, or Python 3) | Tableau loads the extension from a local server. `Start-Reef.bat` runs one with nothing installed. |
| **One file from Tableau** | The Extensions API library `tableau.extensions.1.latest.min.js`. See [lib/README.md](lib/README.md). |

**Tableau Public: you can author with it, but viewers will not see it.** A
self-hosted `.trex` loads in Tableau Public Desktop, but visitors to the
published viz see "isn't currently supported on Tableau Public" until the
extension is Exchange-approved. For a public audience use the **C-Tableau Viz
pages**: they host the extension and a CSV, and the page can sit in a Tableau
dashboard Web Page object.

## Install

1. Put `tableau.extensions.1.latest.min.js` in `lib/` ([lib/README.md](lib/README.md)).
2. Double-click `Start-Reef.bat` and leave the window open. It serves this folder
   on `http://localhost:8770`. (Port 8770 is Reef's; the sibling extensions use
   8765 to 8774, one each.)
3. In Tableau: Marks card > the mark type dropdown > Viz Extensions > Add
   Extension > Access Local Viz Extensions > pick `reef.trex`. Click Allow.
4. Drag a dimension to **Level 1**, optionally more to **Level 2** and **Level 3**,
   and a measure to **Size**. Click the gear for settings.

Tableau reads the `.trex` only when the extension is added, so after editing the
manifest remove and re-add it.

## Try it with real data

`example/us-deaths-by-cause-2017.csv` is the CDC's NCHS *Leading Causes of
Death* table for 2017, 10 causes in 51 US states and DC, grouped by me into five
families and the four Census regions. Public domain (US federal government work).

- Source: CDC National Center for Health Statistics, "NCHS - Leading Causes of
  Death: United States", data.cdc.gov dataset `bi63-dtpu`, year 2017, the ten
  cause rows, state rows only (the "United States" total is dropped).
- Columns: Cause group (my grouping), Cause, Census region (US Census Bureau
  regions), State, Deaths, Age-adjusted death rate (per 100,000).
- Connect it in Tableau, then Level 1 = Cause group, Level 2 = Cause, Level 3 =
  Census region, Size = SUM(Deaths). Drag Age-adjusted death rate to Detail and
  choose it under Colour by > A field from Detail.

## How the layout works

The hierarchy is built from the rows (identical paths merge and their sizes add),
packed by d3-hierarchy's `pack` in a fixed square, and then a camera maps the
focused circle onto the stage. Rows whose size is zero, negative or not a number
cannot be drawn as a circle area, so they are skipped and the legend says how
many. Leaf area is proportional to the measure.

## Tests

```
node test/run.js                 unit tests: packing has no overlaps, area is proportional
                                 to value, zoom maths, label placement, settings coercion
python test/render_test.py       Playwright, headless Chromium, against the mock Tableau API:
                                 3 sizes x light and dark, zoom smoothness, panel, copy and
                                 paste, stress with 1,200 leaves
python test/standin_test.py      drives the extension with the real C-Tableau Viz pages stand-in
python tools/sabotage.py         breaks one thing per gate and requires RED, then restores
python test/render_test.py --shots   also writes preview/*.png and preview/thumbnail.jpg
```

`dev/dev.html` is a harness with a resizable stage and a mock of the Extensions
API that rejects a second open data reader, so a reader leak fails loudly.

## What is proven and what is not

Proven here: the layout maths, the rendering at 300x300 to 1600x1000 in light
and dark, the zoom frame timing, the settings panel, and that the C-Tableau
stand-in can drive it. **Not yet tried in a real Tableau Desktop session**: how
Tableau reports the four shelves, whether `selectMarksByValueAsync` selects the
expected marks, and settings surviving a workbook save and reopen. The mock
follows the published API types, it is not Tableau.

## Libraries

- [d3-hierarchy](https://github.com/d3/d3-hierarchy) 3.1.2, ISC, vendored in
  `lib/d3-hierarchy.min.js` with its licence in `lib/LICENSE-d3-hierarchy.txt`.
  No CDN is used at runtime.
- Tableau's Extensions API library is not redistributed here.

## License

MIT, see the repository LICENSE.
