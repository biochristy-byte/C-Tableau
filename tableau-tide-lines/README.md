# Tide Lines: a Tableau viz extension

A ridgeline (joy plot) extension I built for Tableau. It adds Tide Lines as a mark type on the Marks card: one
smoothed density ridge per category, stacked and overlapping on a shared scale, filled with an ocean-tide
gradient. Every choice is adjustable from a settings panel that opens from a gear inside the viz. It is free, it
is MIT licensed, and it runs in the free edition of Tableau Desktop.

![Tide Lines on 189 real birth weights](preview/tide-lines-thumbnail.png)

## What it does

- **Four Marks card shelves**: Category (one ridge per value), Value (the number whose distribution is drawn, one
  row per observation), Colour (optional), Label (optional display name for each ridge).
- **A kernel density estimate per category** on one shared x scale, so ridges compare honestly. Kernel chips:
  Gaussian or Epanechnikov.
- **Bandwidth is a stepper you can type into.** Empty (Auto) uses Silverman's rule of thumb, worked out for each
  ridge. Type a number to use one bandwidth for all of them. The bandwidth is in Gaussian-equivalent units, so
  switching kernel keeps the same amount of smoothing.
- **Overlap is a typed stepper**: how many ridge spacings tall a peak is (default 2).
- **Ocean-tide fill** from the Data Divers palette (deep navy, teal, foam), with two more palettes and a one-colour
  option. Or colour ridges by a field on the Colour shelf.
- **Median tick and quartile ticks**, each switchable.
- **Sort chips**: data order, by median, by name. A reverse switch flips any of them.
- **Hover lifts a ridge** with an eased move while the others dim, and a tooltip shows n, median and IQR.
  Click selects the ridge's marks in Tableau; Ctrl or Shift click adds.
- **Labels sit on the left at 14px or larger.** If the ridges are too tight for every label, fewer labels are
  drawn and the footer says "Showing 12 of 60 labels". The type is never shrunk to make room.
- **Shared height scale or each its own**, trim tails to the data, vertical grid, axis title.
- **Settings are saved in the workbook** through Tableau's extension settings, and **Copy settings** produces the
  JSON the C-Tableau Viz pages accept.
- **No sliders.** Numbers are typed steppers, choices are chips and dropdowns, colours are colour inputs. No
  browser dialogs.
- Sans-serif only, 14px minimum, text at 7:1 contrast against the background (it picks dark or light text from the
  worksheet background), works from 300 by 300 up to 1600 by 1000, no horizontal scroll.

## What else you need

| You need | Why |
| --- | --- |
| Tableau Desktop 2024.2 or newer | Viz extensions need the 1.12 Extensions API. The free edition works. |
| Windows PowerShell | `Start-TideLines.bat` serves the folder on `http://localhost:8775`. |
| Nothing else | The Tableau API library is in `lib/` and the density maths is in `src/js`. No CDN, no npm install. |

**Tableau Public: you can author with it, but viewers will not see it.** A self-hosted `.trex` loads in Tableau
Public Desktop, but visitors to the published viz see "isn't currently supported on Tableau Public", because
Public only runs Tableau-approved Exchange extensions. For a public audience use the C-Tableau Viz pages (the
hosted stand-in runs this same code) or the single-file page from `tools/build_standalone.py`.

## Install

1. Double-click `Start-TideLines.bat` and leave the window open.
2. In Tableau: Marks card > mark type dropdown > Viz Extensions > Add Extension > Access Local Viz Extensions >
   pick `tide-lines.trex`. Click Allow.
3. Drag a dimension onto Category and a measure onto Value.

Tableau reads the `.trex` only when you add the extension, so after editing it, remove and re-add the extension.

## Use it in a workbook

One mark must be one observation. Put the row identifier on Detail (or turn off Analysis > Aggregate Measures) so
Tableau sends every row instead of one summed number per category. Try it on `example/birth-weight.csv`: Mother
group on Category, Birth weight (g) on Value, Baby ID on Detail, Mother smoked in pregnancy on Colour, Short name on
Label.

## Troubleshooting

| What you see | Why |
| --- | --- |
| Every ridge is one identical narrow hill | Each category arrived as a single summed row. Put the row id on Detail. |
| "Showing 8 of 60 labels" | The ridges are closer together than a 14px label needs. Make the viz taller, reduce Overlap, or filter. Labels are never made smaller than 14px. |
| One ridge is a lone hill while the others are spread out | That category has one row, or every value is the same. Silverman's rule has no spread to work with, so it borrows the typical bandwidth of the other ridges. |
| Blank in a PDF or PowerPoint export | Tableau draws all viz extensions blank in those exports. |
| Two tooltips | Tableau's own tooltip shows because Send hover to Tableau is on. Turn it off in the Tableau group of the panel, or clear the Marks card Tooltip. |
| Text is lower contrast on a grey sheet | On a mid-grey background 7:1 is mathematically out of reach (black reaches about 4.7:1), so it uses the best of black or white. |

## Try it without Tableau

`dev/dev.html` runs the shipping code against a mock of the Tableau API. Serve the folder (for example
`python -m http.server 8775`) and open `http://localhost:8775/dev/dev.html?fixture=birth&size=900x520&theme=dark`.
Fixtures: typical, birth (real data), many (60 ridges), long, tiny, constant, empty.

`python tools/build_standalone.py --data example/birth-weight.csv --category "Mother group" --value "Birth weight (g)" --color "Mother smoked in pregnancy" --label "Short name" --settings example/dark-settings.json --out standalone/index.html`
writes one self-contained page. `python tools/make_thumbnail.py OUT.png` captures the catalog thumbnail.

## Tests

```
node test/run.js              # 102 unit checks: density, Silverman, quantiles, sorting, layout, label fitting, contrast, settings
python test/mock_render.py    # browser: 15 cases at 3 sizes in light and dark, hover, selection, panel, settings round trip
python test/standin_test.py   # the hub's real stand-in file drives it, four settings shapes, plus the standalone page
```

Every gate prints what it examined and goes RED if it examined too little. Each was shown to fail by breaking its
subject once (see the notes in the commit).

## What I have and have not checked in Tableau

- Checked: the unit maths, the rendering in Chromium against a mock of the Extensions API (every feature listed above),
  and the C-Tableau Viz pages stand-in.
- **Not checked in real Tableau Desktop yet**: loading the `.trex`, the four shelves, summary data arriving one row
  per mark, `selectMarksByValueAsync` selecting the right marks, `hoverTupleAsync`, and settings surviving a save and
  reopen. The mock follows the published API, which is not the same as proof. Test these before relying on it.
- The Viz pages stand-in has no `selectTuplesAsync` or `hoverTupleAsync` and its selection calls do nothing, so on a
  viz page the chart draws, hovers and shows its own tooltip, but clicking a ridge cannot filter anything.

## Layout

```
tide-lines.trex            the manifest (port 8775, id com.datadivers.vizext.tidelines)
src/index.html             the page Tableau loads
src/js/kde.js              density, Silverman, quantiles, sorting, ticks (pure)
src/js/layout.js           rows, label fitting, tick picking (pure)
src/js/palettes.js         colour maths, the Data Divers tide ramps, 7:1 contrast
src/js/schema.js           every setting, its default and its control
src/js/render.js           the SVG ridgeline, hover, selection, tooltip
src/js/settings-panel.js   the gear and panel
src/js/tidelines.js        the Tableau adapter
dev/                       mock Tableau API and harness
example/                   birth-weight.csv and dark-settings.json, credited in example/README.md
test/  tools/  preview/
```

## License

MIT. See the repository `LICENSE`. `lib/tableau.extensions.1.latest.min.js` is Tableau's own library (MIT).
