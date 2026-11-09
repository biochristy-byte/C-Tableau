# Technique library: charts, interactions and calc pitfalls

Distilled from 39 recent videos of Andy Kriebel's public VizWiz channel
(youtube.com/@VizWiz), read as auto-caption transcripts, plus the recurring
techniques from a full pass over Tableau's chart types. Credit and go watch
the originals. Check this page before building any chart or interaction.

## The five recurring moves

Most advanced Tableau charts are one of these: dual axis with synchronized axes,
a `MIN(0)` or `MIN(1)` placeholder measure, table calcs with Compute Using set on
purpose, negating a measure for a diverging layout, and disaggregating so every
row is its own mark. [reference/TABLEAU_MASTERY.md](reference/TABLEAU_MASTERY.md)
has the full catalogue (40+ chart types, 20+ advanced custom vizzes, maps,
interactivity, calcs, performance, shortcuts).

## Highest-value techniques for a generator pipeline

Full step-by-step versions of these (and more) are in
[andy-kriebel-recipes.md](andy-kriebel-recipes.md).

- **Map layers as a drawing canvas.** A helper point table (rectangle = 5 rows,
  semicircle arc = 180, waffle = 100) plus `MAKEPOINT(row, col)` or
  `MAKEPOINT(-offset, weekday)` on a flat grid, background map off (needs two or
  more layers first, or a 100% washout). Rescale values with
  `SUM(x)/SUM({SUM(x)})` because map layers cannot use table calcs. Disable
  Selection on every layer. Covers big bar, L-bar, donut, waffle, gauge (trig
  x/y), marginal histogram, calendar heat map. Precompute the point tables in
  Python.
- **Dynamic zone visibility, string-state flavor.** `[show X] = [param]="X"`
  booleans work as well as the integer pattern. Five ingredients: a parameter, a
  boolean calc, the objects to toggle, a container, a parameter action. Build and
  test as a worksheet action first. A mobile KPI accordion: the text calc sits on
  Detail of the clickable mark layer, and the dehighlight filter action targets
  the SHEET with Show all values, F = T.
- **Dashboard-level actions.** A set action made from the Worksheet menu does
  nothing once the sheet is on a dashboard. It must live under Dashboard >
  Actions with the dashboard as source. Matters for XML injection.
- **Zoom with no extension.** Reference line value `IF [zoomy]="no" THEN 0 END`,
  Include Zero off. A reference line with aggregation "Total" is hidden on
  grand-total columns.
- **Two values in one parameter** (a two-click date range): test `LEN(param)=10`,
  append the clicked date, split with `LEFT`/`RIGHT` 10 wrapped in `DATE()`.
- **Drill with set actions.** `IF [set] THEN [Sub-Category] ELSE "" END`. A
  year-to-month filter: `{FIXED: SUM(INT([Year Set]))}=0 OR [Year Set]`. Sticky
  highlight fix: a dummy field plus the toolbar highlighter, or a never-matching
  true/false filter action.
- **Hexbin:** `HEXBINX/HEXBINY` scaled by a 0.005 to 0.1 adjuster parameter.
- **Quadrant:** `WINDOW_AVG` flags, and use `NOT` rather than `=FALSE`.
- **Rounded bar with inside labels:** a thick line plus a transparent Gantt layer.
- **Sparkline:** independent axis, no zero, hide headers and dividers.
- **Viz in tooltip:** replace the "all fields" filter with only the hover key.

## More recipes from tutorial videos and long builds

The video transcripts were machine captions with errors; the shapes below are the
parts that were clear. Check a number on your own build.

- **Multi-state custom shapes (Figma Image Tracer).** Download a shape. In Figma:
  Frame, place the image, run the Image Tracer plugin (vectorizes it), edit the
  object, press F to fill white, set transparency or stroke for the off state.
  Export one PNG per state (for example 4 signal bars lit down to 0 lit). Put the
  PNGs in `Documents/My Tableau Repository/Shapes/<your folder>`, then Shape > More
  Shapes > Reload Shapes, and assign by a calc (`>=80 -> 1, >=60 -> 2, ...`). Size
  through the Size card.
- **Tile grid map from coordinates in the data.** Put integer `row` and `col`
  columns in the data (one per entity), drag them to Rows and Columns as discrete
  dimensions, entity on Detail or Label, and reverse the Rows axis so row 1 is at the
  top. No Tableau-side coordinate calcs.
- **Parameter as a filter that survives a pivot.** Data pivoted so each entity has a
  Population column (Total, Rural, Urban, Poorest, Richest). String parameter with
  those values, calc `Selected = [Population]=[Param]` filtered to True on the shape
  sheet. A button-strip sheet (parameter on Color, Population on Columns, Square
  marks, text centered) plus a Change Parameter action from that sheet to the
  parameter makes the strip the control. A plain quick filter would lose the
  strip's selection state. Split a long header into two label lines with two
  SPLIT calcs.
- **Top N plus Bottom N.** Two integer parameters (range 1 to 20), two sets by
  Top and Bottom N driven by them, a combined set (union) on Filters or Color.
- **Radial bar chart from calcs only (no precompute).** Parameters `Inner radius`
  (0.5) and `Outer radius`. `Normalized length = inner + (outer - inner) *
  (value / MAX(value))`, with a sqrt option. X = `normalized_length * COS(angle)`,
  Y = `* SIN(angle)` on densified path points (a scaffold join of 0..100 path bins to
  the data, "path bin" size 1), line mark, path = bin. The precompute route in
  [buildout-pipeline.md](buildout-pipeline.md) is the alternative.
- **3D bar plot with cube shapes (gimmick).** Left-join the data to a 0..100
  scaffold twice, `Index = 100 - INDEX()`, a rows calc that masks the scaffold,
  path bin size 1, cube PNGs as the shape palette.
- **Motion chart.** Year on the Pages shelf, Show History, trails for Selected or
  All marks, a line trail via Show History > Trails. The control side (Pages card
  placement) is in [workflow-and-qa.md](workflow-and-qa.md) section 5.
- **Word cloud: fit the ink, not the font size.** Fit each word's left, right, top
  and bottom ink edge as a line `a + b * pt` from two measured sizes (see
  [gate-designs.md](gate-designs.md)). Keep words off the line-box bottom, where
  Tableau underlines a hovered Text mark and the underline strikes through the next
  word. Put kinds (strips) 64 px apart so a gutter exists, set pt as
  `round(S * (2.5 + n))` from the count, and carry one label run per font size.
- **Easter-egg or bubble button on a map.** A speech-bubble custom shape on its OWN
  map layer beside the target dot, with a URL action. Keep it always visible and
  lock the map on that page. Untested: clicking the bubble in the published
  workbook. A selected mark dims everyone else until empty space is clicked; the fade
  multiplies colors toward the card, so recoloring cannot fix it (the
  single-mark-sheet-per-option fix is in [xml-traps.md](xml-traps.md)).
- **Radial and unit charts: one fixed ANGLE per dot**, never a fixed arc length (the
  eye reads sweep angle). Recipe and gate in [gate-designs.md](gate-designs.md).

## A Tableau twin of an HTML story: dark and mobile checklist

Tableau has no viewer theme switch, so the workbook is dark by design.

- Background PNG at zone 0; every sheet and container background None.
- Set tooltip text AND background explicitly (the default is white).
- Light-on-dark icons only as transparent PNG (no matte edges). Gridlines muted
  navy, never default grey.
- The phone gets its OWN background PNG at phone width; do not scale the desktop PNG.
- Phone tap targets at least 44 px tall. Tooltips short (3 lines), since they open
  on tap.
- No ambient motion in Tableau: only filter-state mark animation and Pages.
- Viz extensions render blank in PDF export, so avoid them in anything exported.
- Mapping HTML to Tableau: a radial unit chart is a precomputed scatter with ring
  guides baked in; a kelp forest is path lines plus a circle layer; a swell is area
  over a gradient image; anchors are lines plus custom shapes.

## Calc pitfalls (silent wrong numbers)

- **Aggregate BEFORE you divide.** A row-level `[SO]/[AB]` gets summed (19,000%
  instead of 20%). Every rate you inject is `SUM(a)/SUM(b)`.
- **Lock table calcs to Specific Dimensions**, or moving a pill breaks them.
- **Fixed LODs ignore dimension filters** unless the filter is added to context.
- **Bars always start at zero.**
- **Never join individual-level and aggregate-level data.** It double-counts.
  Keep them on separate sheets. Prefer a weight column to duplicating rows.
- **Filter order of operations:** extract, data source, context, FIXED, dimension,
  INCLUDE/EXCLUDE, measure, table calc. Know where your filter sits.

## Design opinions that confirm or tension with the house rules

- Confirms rules 5, 6, 11, 12, 22: a "rule of four" charts per page, a neutral
  palette plus one focus color, series-colored end-of-line labels instead of a
  legend, a 9 to 10 pt italic instruction line, rename every action, avoid Hover
  as an action trigger.
- Layout: one root container floated at 0,0 sized to the dashboard, nested tiled
  children, 10 px outer padding, pinned title and divider heights, "Distribute
  contents evenly". This tensions with rule 3 (avoid floats) and rule 4 (8 px
  outer padding): pick per project.
- He deletes the Phone layout and builds a separate 375-wide dashboard instead.
- He writes titles as questions. Worth a mock; not adopted.

## Data prep habits

- Tidy shape: one variable per column, one observation per row, a single grain
  per output file.
- Code free text ONCE into a fixed taxonomy through an editable lookup file, so a
  human can fix it in Excel and re-run. Route the unsure to a `needs_review` flag.
- Tag grain with an `is_individual_level` or `data_grain` flag.
- If you must show a rate, precompute the numerator and denominator so
  `SUM(weight)` just works for the analyst; nobody should need survey-weighting
  math to count.
- Precompute geometry in Python (trig for wedges, Venn x/y from radius).
- Quotes, significance tests, weighted survey shares and "every published number"
  collections have their own rules: see [data-honesty.md](data-honesty.md).
- A word cloud is a scatter placed by a layout script. Tableau's packed Text-mark
  cloud cannot hold a gutter, and mark size on a scatter is a narrow font band, so
  carry one label run per font size with each run's field on Text.
