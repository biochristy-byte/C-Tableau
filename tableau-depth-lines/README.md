# Depth Lines: a Tableau viz extension

A density-contour chart for Tableau, drawn like a bathymetry map. Give it a scatter
(an x measure and a y measure, one row per point) and it finds where the points pile
up, then draws that as filled depth bands from shallow to deep, with optional
contour lines and optional points. Tableau has no built-in chart for this, and
nothing on the Tableau Exchange does it. It adds **Depth Lines** as a mark type on
the Marks card. Free, MIT licensed, runs in the free edition of Tableau Desktop.

Preview images are in [previews/](previews/): `thumbnail.jpg`, `preview-*.png`.

## What it does

- **Four Marks card shelves**: X, Y, Category (optional), Weight (optional).
  Four is the most Tableau allows. Put a dimension on **Detail** (an ID) so each row
  is one point; without it Tableau sums your measures into a single mark.
- **2D kernel density** with d3-contour `contourDensity`, then marching squares.
  **Bandwidth** and **Depth bands** are steppers. The bands are exact: ask for 8, get 8.
- **Filled bands, contour lines and points** switch on and off separately.
- **One contour set per category**: overlaid in category colors, or **small multiples**
  with one panel per category. The depth scale can be shared (fair comparison) or
  per category (so a sparse category still shows its shape).
- **Three depth ramps** (Abyss, Sunrise, Mono), reversible. On a dark background the
  ramp flips so the densest water is the brightest.
- **Click a band** to select every point inside it in Tableau. **Hover a point** to
  highlight its mark. Hover a band for its point count.
- **Settings in the viz, in a floating panel.** The gear opens the shared C-Tableau settings panel
  (`lib/ctab-panel`, the same one every house extension uses). Drag it by its title bar (it stays inside the frame),
  minimize it, close it, or press Escape. Under 420px wide it becomes a full-frame sheet. Everything is saved in the
  workbook through Tableau's extension settings; **Copy settings** gives the flat JSON the C-Tableau Viz pages flow
  accepts, **Paste settings** takes it back, and there is an Undo, a search box over every setting, and Reset this tab / Reset all.
- **No sliders anywhere.** Steppers you can type into, chips, dropdowns, color boxes.
- Inter (bundled) at 14px and up, text at 7:1 contrast or better on light and dark,
  the Data Divers palette by default, follows the worksheet background.
- One 520 ms eased fade-in on the first draw, then nothing moves. Density is computed
  before anything is drawn, so a published viz never jitters.

## Settings (90 across 17 tabs)

| Tab | What it sets |
| --- | --- |
| Contours | Bandwidth, grid detail, number of depth bands, shallowest and deepest band (share of the peak), even or shallow-crowded spacing |
| Bands | Fill on/off and opacity, water tint, contour lines on/off, width, solid/dashed/dotted, a heavier index line every N bands |
| Points | Show points, size, opacity, shape (circle, square, diamond), color |
| Category | Overlay or small multiples, shared or per-category depth scale, columns, gap, panel titles |
| Axes | Axis lines and labels, color, tick density, axis titles (your own text), fixed X and Y ranges |
| Grid | On/off, solid/dashed/dotted, width, color |
| Legend | On/off, top or bottom, the depth note, ramp width |
| Colors | Palette (Data Divers plus six colorblind-safe sets), reverse, per-category names, colors, order and hide; depth ramp, reverse, line color |
| Labels | Show labels, size (never under 14px), weight, color, panel-title wrapping, contour value labels |
| Number format | Decimals, thousands separator, K/M short form, multiplier, prefix, suffix |
| Tooltip | On/off, size, swatch, placement, width |
| Fonts | Font, title text, size, weight |
| Background | Worksheet, custom or transparent; padding; border color, width, corner radius |
| Animation | Entrance on/off, duration, easing, hover fade |
| Interaction | Click selects, highlight on hover, dim the others to N%, send hover to Tableau, show the gear |
| Fields | Pick X, Y, Category and Weight by hand instead of using the shelves |
| Panel | The panel's own theme (light, dark, match the chart, custom) |

Workbooks saved before the panel existed keep their look: `fontSize` is read as `labelSize` (and the title size), `title` as
the title text, `theme` as the background mode, `catPalette` as the palette, and `selectEnabled` and `hoverEnabled` as
`selectOn` and `hoverPush`. Every other saved key kept its name. One visible difference: the default category colors are now the
shared Data Divers palette (the Okabe-Ito choice carries over unchanged).

Previews of the panel: [previews/settings-panel-1280x800.png](previews/settings-panel-1280x800.png) and
[previews/settings-panel-mobile-390.png](previews/settings-panel-mobile-390.png).

## Install

You need Tableau Desktop 2024.2 or newer (Free Edition works), and Python 3 or Node.

1. Download Tableau's Extensions API library into `lib/`, see [lib/README.md](lib/README.md).
2. Double-click `Start-DepthLines.bat` (or run `python -m http.server 8772` in this
   folder, or `npm start`). Leave it running.
3. In Tableau: a worksheet, Marks card mark-type dropdown > Viz Extensions > Add
   Extension > **Access Local Viz Extensions** > pick `depth-lines.trex` > Allow.
4. Drag fields on the shelves. Try `data/wisconsin-tumors.csv`: X = Mean radius,
   Y = Mean concave points, Category = Diagnosis, Sample on Detail.

Tableau reads the `.trex` only when the extension is added: after editing it, remove
and re-add the extension.

## Tableau Public

You can build with it in Tableau Public Desktop, but **viewers of a published viz will
not see it**: Public only runs extensions Tableau has approved on the Exchange. For a
public audience use the C-Tableau Viz pages flow, which hosts the chart as a standalone
page you embed in a dashboard Web Page object. It runs the extension against a
read-only stand-in for the Extensions API, and is tested that way (see below).

## Example data

`data/wisconsin-tumors.csv`: 569 breast-mass samples, 212 malignant and 357 benign,
four measurements each. Wolberg, Mangasarian, Street and Street (1993), UCI Machine
Learning Repository, Breast Cancer Wisconsin (Diagnostic), license **CC BY 4.0**.
See [data/README.md](data/README.md). It makes a good first chart: the malignant
cloud is wider and has two peaks, the benign one is one tight hill.

## Tests

| Command | What it proves |
| --- | --- |
| `node test/run.js` | The maths, no browser: contours are closed, nested, deterministic, exact in count; bandwidth, weights, shared scale; settings coercion; contrast and ticks. |
| `python test/render_test.py` | Playwright: 24 renders (3 sizes x light and dark x 4 scenarios) for drawn bands, 0 console errors, no horizontal scroll, text 14px or more, 7:1 contrast, no overlapping labels; selection and hover push-back, resize, determinism and the entrance animation. |
| `python test/panel_test.py` | The panel in Chromium: gear opens it, drag clamps to the frame, minimize, close, Escape, Copy and Paste round-trip, live re-render, saved as strings, no range input, no browser dialog, text 14px and 7:1 on every tab, the 390px sheet. It then flips **every one of the 90 settings** and requires the render (or the Tableau calls) to change, and loads old saved keys. |
| `python test/standin_test.py` | The chart on the real Viz pages stand-in, with every way settings arrive, plus Copy settings. |
| `python tools/sabotage_check.py` | Breaks one thing at a time and shows the matching gate go RED, then restores the file byte-exact and shows it GREEN. |
| `python ../shared/ctab-panel/sync_check.py` | `lib/ctab-panel` is byte-identical to `shared/ctab-panel`. |

What none of them prove: that Tableau itself drives the extension. The mock is shaped
from Tableau's published API types, not from a live Tableau. Tuple ids for selection
are 1-based row positions, the same assumption Lollipop makes, and are unconfirmed.

## Files

`src/` the extension. `lib/` vendored d3-array and d3-contour (ISC), Inter (OFL) and `ctab-panel/` (the shared settings panel, an exact copy of `shared/ctab-panel`), each with its
license. `dev/` mock Tableau and fixtures. `data/` example data. `tools/` fixtures and thumbnail
builders. `test/` the gates.

MIT licensed. Made by Chris Fryar, Data Divers.
