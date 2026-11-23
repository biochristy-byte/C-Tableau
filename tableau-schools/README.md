# Schools: a Tableau viz extension

Clustered bubbles for Tableau, by Chris Fryar at Data Divers. One circle per
item, area proportional to a measure, and the circles swim into schools by a
category. A force simulation settles the layout off-screen, then a guarantee
pass makes sure no two circles overlap. It is free, MIT licensed, and runs in
the free edition of Tableau Desktop.

Tableau has no built-in clustered (Dorling-style) bubble chart. A packed
bubble chart packs everything into one blob; Schools keeps each category as its
own labeled school.

## What it does

- **Four Marks card shelves**: Item (required, one circle each), Cluster (the
  school), Size (the measure) and Color (optional). Four is the most Tableau
  allows a viz extension.
- **No overlaps, by construction and by test.** Circle area is proportional to
  the measure (tiny values are drawn at a minimum size so they stay visible).
  Every settled layout is checked pairwise.
- **No jitter, no jank.** The simulation is ticked by hand and stopped before
  anything is drawn. It runs a few milliseconds per frame while the old picture
  holds still, so no frame carries the whole layout; the entrance and every
  re-layout are then an eased morph between two settled layouts, and every morph
  frame only interpolates. Once settled, nothing moves.
- **Hover** lights one school and dims the rest, with a tooltip. **Click** a
  circle to select that item in Tableau, click a school label to select the
  whole cluster, click empty space or press Escape to clear.
- **Labels that never collide**: every label is a solid chip, 14 px or larger,
  7:1 against its chip in light and dark. Each school gets a label; big circles
  get their own name and value inside them.
- **Color by** cluster (default), the Color shelf, or one color; six palettes
  including a colorblind safe one.
- **88 settings on 15 tabs** (Colors, Cluster layout, Collisions, Size scale, Circles, Labels, Cluster labels, Legend, Number format,
  Tooltip, Fonts, Background, Animation, Interaction, Fields, plus the built-in Panel tab) in a floating panel inside the viz,
  the same one as the other Data Divers extensions: click the gear, drag it by its title bar, minimize it,
  Escape closes it, and below 420px wide it becomes a full-frame sheet. Settings that need explaining have a plain-language help line, a search box
  finds a setting by name, and the Panel tab holds Reset all, Undo, **Copy settings** and **Paste settings** (the JSON the C-Tableau
  Viz pages flow accepts). **No sliders**: steppers you can type into, chip groups, dropdowns and color inputs. No browser dialogs.
- Settings are saved in the workbook through Tableau's extension settings. A workbook saved before the panel change keeps its look:
  the old font stack and number format are read as the new Font and Compact numbers settings.
- Background follows the worksheet, or light, dark or a custom color.
  Reduced-motion users get no morph.

## What else you need

| You need | Why |
| --- | --- |
| **Tableau Desktop 2024.2 or newer** | Viz extensions need 2024.2 at minimum. The free edition works. |
| **Windows PowerShell** (or Node, or Python 3) | Tableau loads the extension from a local server. `Start-Schools.bat` runs one with nothing installed. |
| **One file from Tableau** | The Extensions API library `tableau.extensions.1.latest.min.js`. See [lib/README.md](lib/README.md). |

**Tableau Public: you can author with it, but viewers will not see it.** A
self-hosted `.trex` loads in Tableau Public Desktop, but visitors to the
published viz see "isn't currently supported on Tableau Public" until the
extension is Exchange-approved. For a public audience use the **C-Tableau Viz
pages**: they host the extension and a CSV, and the page can sit in a Tableau
dashboard Web Page object.

## Install

1. Put `tableau.extensions.1.latest.min.js` in `lib/` ([lib/README.md](lib/README.md)).
2. Double-click `Start-Schools.bat` and leave the window open. It serves this
   folder on `http://localhost:8771`. (Port 8771 belongs to Schools; the sibling
   extensions use 8765 to 8774, one each.)
3. In Tableau: Marks card > the mark type dropdown > Viz Extensions > Add
   Extension > Access Local Viz Extensions > pick `schools.trex`. Click Allow.
4. Drag a dimension to **Item**, another to **Cluster**, a measure to **Size**,
   and optionally a dimension to **Color**. Click the gear for settings.

Tableau reads the `.trex` only when the extension is added, so after editing the
manifest remove and re-add it.

## Try it with real data

`example/countries-population-life-expectancy-2021.csv`: 217 countries and
territories for 2021, with population and life expectancy at birth.

- **Data credit:** The World Bank, World Development Indicators, indicators
  `SP.POP.TOTL` (Population, total) and `SP.DYN.LE00.IN` (Life expectancy at
  birth, total, years), year 2021, with the World Bank's region and income-group
  country classifications. Licensed CC BY 4.0
  (https://datacatalog.worldbank.org/public-licenses#cc-by). Spot-checked
  against the World Bank API on 11/22/2026 (Afghanistan: 40,000,412 people,
  60.417 years). Life expectancy is rounded to one decimal. Aggregates (regions,
  income groups) are not included, only countries and territories.
- Columns: Country, Region, Income group, Population, Life expectancy.
- Connect it in Tableau, then Item = Country, Cluster = Region, Size =
  SUM(Population), Color = Income group.

## How the layout works

Rows with the same item and cluster merge and their sizes add. Rows whose size
is zero, negative or not a number cannot be a circle area, so they are skipped
and the legend says how many. Blank names become "(blank)".

Cluster centers are placed by d3-hierarchy's `packSiblings` from each cluster's
total area. d3-force pulls each circle toward its center with a collision force,
ticked by hand (300 ticks, fewer past 1,500 circles) and stopped. A
pairwise relaxation pass then removes any remaining overlap, and one uniform
scale fits the result to the stage so gaps survive the fit.

## Tests

```
node test/run.js                 unit tests: no circle overlaps, area proportional to value,
                                 clustering, determinism, no timer left running, label
                                 placement, settings coercion (2.9 million pairs checked)
python test/settings_test.py     every one of the 88 settings is changed and must change the render
python test/render_test.py       Playwright, headless Chromium, against the mock Tableau API:
                                 3 sizes x light and dark, text 14 px and 7:1, no circle or
                                 label overlap measured from the DOM, no jitter across
                                 consecutive frames, morph frame timing, hover, selection,
                                 panel, copy and paste, stress with 1,200 and 2,000 circles
python test/standin_test.py      drives the extension with the real C-Tableau Viz pages stand-in (legacy settings and Copy-settings JSON)
python tools/sabotage.py         breaks one thing per gate and requires RED, proves each restore
                                 byte-exact by sha256, then requires every gate green
python ../shared/ctab-panel/sync_check.py   lib/ctab-panel must match shared/ctab-panel byte for byte
python test/render_test.py --shots   also writes preview/*.png and preview/thumbnail.jpg
```

`dev/dev.html` is a harness with a resizable stage and a mock of the Extensions
API that rejects a second open data reader, so a reader leak fails loudly.

## What is proven and what is not

Proven here: the layout math, the rendering at 300x300 to 1600x1000 in light
and dark, the morph frame timing, the settings panel, and that the C-Tableau
stand-in can drive it. The re-layout is computed in slices (11 ms a frame
while the picture is still), so every frame from the trigger to the end of the
morph stays under 50 ms (measured 16.8 ms max for 217 and for 1,200 circles).
The morph starts about 0.2 s after a change at 217 circles and about 1.3 to
1.8 s after one at 1,200 circles on the test machine.

**Not yet tried in a real Tableau Desktop session**: how Tableau reports the
four shelves, whether `selectMarksByValueAsync` selects the expected marks, and
settings surviving a workbook save and reopen. The C-Tableau stand-in cannot
drive selection, hover or live data refresh (those calls are no-ops there). The
mock follows the published API types, it is not Tableau.

## Libraries

- [d3-force](https://github.com/d3/d3-force) 3.0.0, d3-dispatch 3.0.1,
  d3-quadtree 3.0.1, d3-timer 3.0.1 and d3-hierarchy 3.1.2, all ISC, vendored in
  `lib/` with their licenses in `lib/LICENSE-*.txt`. No CDN is used at runtime.
- Tableau's Extensions API library is not redistributed here.

## License

MIT, see the repository LICENSE.
