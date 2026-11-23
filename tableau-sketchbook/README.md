# Sketchbook: a Tableau viz extension

Hand-drawn bar, line and dot charts for Tableau. Every bar, line, dot, grid line and
axis is drawn with rough.js, so it looks pencilled on paper instead of plotted. Tableau
has no built-in sketch style. It adds **Sketchbook** as a mark type on the Marks card.
Free, MIT licensed, runs in the free edition of Tableau Desktop.

Preview images are in [previews/](previews/): `thumbnail.jpg`, `preview-*.png`.

## What it does

- **Four Marks card shelves**: Category, Value, Series (optional), Label (optional).
  Four is the most Tableau allows. Put a dimension on **Detail** if you want one mark
  per row; without it Tableau sums your measures.
- **Chart type chips**: Bar, Line, Dot. Series become grouped bars, several lines, or
  several dot rows, with a sketched legend. Negative values draw bars below the zero line.
- **Fill style**: hachure, solid or zigzag, with hatch spacing and angle.
- **Roughness, bowing and seed** are steppers you can type into. The seed is hashed per
  mark, so the same seed draws the same sketch every time, on every redraw and every machine.
- **Optional hand-drawn underline** under the title, sketched grid lines, mark labels
  (the value, or whatever is on the Label shelf).
- **Click a mark** to select its rows in Tableau. **Hover** highlights the mark.
- **Settings in the viz.** The gear opens a panel; everything is saved in the workbook
  through Tableau's extension settings (keys start with `sketchbook.`). **Copy settings**
  gives the JSON the C-Tableau Viz pages flow accepts; **Paste settings** takes it back.
- **No sliders anywhere.** Steppers, chips, dropdowns, colour boxes.
- Inter (bundled) at 14px and up, text at 7:1 contrast or better on white, paper, dark and
  custom backgrounds, the Data Divers palette by default (a colour-blind safe palette and
  pencil greys are built in). Follows the worksheet background.
- One 520 ms eased fade-in on the first draw, then nothing moves. Each draw waits for Inter
  before measuring text, so labels never shift after the first paint.

## Install

You need Tableau Desktop 2024.2 or newer (Free Edition works), and Python 3 or Node.

1. Download Tableau's Extensions API library into `lib/`, see [lib/README.md](lib/README.md).
2. Double-click `Start-Sketchbook.bat` (or run `python -m http.server 8773` in this
   folder, or `npm start`). Leave it running.
3. In Tableau: a worksheet, Marks card mark-type dropdown > Viz Extensions > Add
   Extension > **Access Local Viz Extensions** > pick `sketchbook.trex` > Allow.
4. Drag fields on the shelves. Try `data/life-expectancy-sample.csv`: Category = Year,
   Value = Life expectancy (years), Series = Country, with Country on Detail.

Tableau reads the `.trex` only when the extension is added: after editing it, remove
and re-add the extension.

## Tableau Public

You can build with it in Tableau Public Desktop, but **viewers of a published viz will
not see it**: Public only runs extensions Tableau has approved on the Exchange. For a
public audience use the C-Tableau Viz pages flow, which hosts the chart as a standalone
page you embed in a dashboard Web Page object. It runs the extension against a
read-only stand-in for the Extensions API, and is tested that way (see below).

## Example data

`data/life-expectancy-sample.csv`: life expectancy at birth for six countries across nine
years (54 rows). Our World in Data, licence **CC BY 4.0**. See [data/README.md](data/README.md).

## Tests

| Command | What it proves |
| --- | --- |
| `node test/run.js` | The maths, no browser: layout, negative bars, deterministic seeds, settings coercion, no option is a slider, the 14px floor, contrast. |
| `python test/render_test.py` | Playwright: renders across sizes, light and dark, and every chart type; 0 console errors, no horizontal scroll, text 14px or more, 7:1 contrast, no overlapping labels; the settings panel, steppers, persistence, Copy and Paste settings, selection and hover push-back, resize, determinism across a seed and the entrance animation. |
| `python test/standin_test.py` | The chart on the real Viz pages stand-in, with every way settings arrive. |
| `python tools/sabotage_check.py` | Breaks each gate's subject, expects RED, restores the file byte for byte, expects GREEN. |

What none of them prove: that Tableau itself drives the extension. The mock is shaped
from Tableau's published API types, not from a live Tableau. Tuple ids for selection
are 1-based row positions, the same assumption Lollipop makes, and are unconfirmed. The
contrast gate cannot reach 7:1 on a mid-grey custom background (no ink can), so it is
tested on white, paper and dark.

## Files

`src/` the extension. `lib/` vendored rough.js (MIT) and Inter (OFL), each with its
licence. `dev/` mock Tableau and fixtures. `data/` example data. `tools/` fixtures,
thumbnail builder and the sabotage check. `test/` the gates.

MIT licensed. Made by Chris Fryar, Data Divers.
