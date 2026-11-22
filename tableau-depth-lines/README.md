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
- **One contour set per category**: overlaid in category colours, or **small multiples**
  with one panel per category. The depth scale can be shared (fair comparison) or
  per category (so a sparse category still shows its shape).
- **Three depth ramps** (Abyss, Sunrise, Mono), reversible. On a dark background the
  ramp flips so the densest water is the brightest.
- **Click a band** to select every point inside it in Tableau. **Hover a point** to
  highlight its mark. Hover a band for its point count.
- **Settings in the viz.** The gear opens a panel; everything is saved in the workbook
  through Tableau's extension settings. **Copy settings** gives the JSON the
  C-Tableau Viz pages flow accepts; **Paste settings** takes it back.
- **No sliders anywhere.** Steppers you can type into, chips, dropdowns, colour boxes.
- Inter (bundled) at 14px and up, text at 7:1 contrast or better on light and dark,
  the Data Divers palette by default, follows the worksheet background.
- One 520 ms eased fade-in on the first draw, then nothing moves. Density is computed
  before anything is drawn, so a published viz never jitters.

## Install

You need Tableau Desktop 2024.2 or newer (Free Edition works), and Python 3 or Node.

1. Download Tableau's Extensions API library into `lib/`, see [lib/README.md](lib/README.md).
2. Double-click `Start-DepthLines.bat` (or run `python -m http.server 8772` in this
   folder, or `npm start`). Leave it running.
3. In Tableau: a worksheet, Marks card mark-type dropdown > Viz Extensions > Add
   Extension > **Access Local Viz Extensions** > pick `depth-lines.trex` > Allow.
4. Drag fields on the shelves. Try `data/wisconsin-tumours.csv`: X = Mean radius,
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

`data/wisconsin-tumours.csv`: 569 breast-mass samples, 212 malignant and 357 benign,
four measurements each. Wolberg, Mangasarian, Street and Street (1993), UCI Machine
Learning Repository, Breast Cancer Wisconsin (Diagnostic), licence **CC BY 4.0**.
See [data/README.md](data/README.md). It makes a good first chart: the malignant
cloud is wider and has two peaks, the benign one is one tight hill.

## Tests

| Command | What it proves |
| --- | --- |
| `node test/run.js` | The maths, no browser: contours are closed, nested, deterministic, exact in count; bandwidth, weights, shared scale; settings coercion; contrast and ticks. |
| `python test/render_test.py` | Playwright: 24 renders (3 sizes x light and dark x 4 scenarios) for drawn bands, 0 console errors, no horizontal scroll, text 14px or more, 7:1 contrast, no overlapping labels; the settings panel, steppers, persistence, Copy and Paste settings, selection and hover push-back, resize, determinism and the entrance animation. |
| `python test/standin_test.py` | The chart on the real Viz pages stand-in, with every way settings arrive. |

What none of them prove: that Tableau itself drives the extension. The mock is shaped
from Tableau's published API types, not from a live Tableau. Tuple ids for selection
are 1-based row positions, the same assumption Lollipop makes, and are unconfirmed.

## Files

`src/` the extension. `lib/` vendored d3-array and d3-contour (ISC) and Inter (OFL), each with its
licence. `dev/` mock Tableau and fixtures. `data/` example data. `tools/` fixtures and thumbnail
builders. `test/` the gates.

MIT licensed. Made by Chris Fryar, Data Divers.
