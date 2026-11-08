# .twb XML: verified fragments and silent traps

Every item was proved by loading a file into Tableau Public 2026.1 and reading
the screen or Tableau's own save. None of the traps below logs an error: the
feature just does not happen. "GUI save" means copied from a file Tableau wrote
after a change made by hand. Placeholders: `{DS}` is the federated datasource
name, `{GUID}` a window uuid.

## Load failures (error D2E8DA72) and how to bisect

Copy the failing file, remove one suspect, reopen. Repeat until it loads.

1. **Action order.** A plain `<action>` (filter or URL) that comes AFTER an
   `<edit-parameter-action>` fails the whole load. Plain actions go first inside
   `<actions>`.
2. **Map lock without its manifest flags.** A worksheet `<viewpoint>` map lock
   fails unless `<document-format-change-manifest>` carries both
   `<LayerControlWidget />` and `<MapboxVectorStylesAndLayers />`. Without the
   second, `map-style='dark'` loads but renders the LIGHT map.
3. **Missing button flags.** Navigation buttons need `<BasicButtonObject />` and
   `<BasicButtonObjectTextSupport />`, or the load fails with "no declaration
   found for element 'button'". The manifest is not decoration: copy the whole
   block from a template Tableau authored.
4. **Button child order is schema-ordered:** caption, image-path, tooltip-text,
   button-caption-font-style, format. A well-formed file with `tooltip-text` last
   was refused.
5. **Duplicate window names** fail with "duplicate identity constraint".
6. **A copied worksheet** needs new `simple-id` uuids.
7. `<column-instance>` elements go after `<column>` and before `<drill-paths>`,
   or before `<extract>` when there are none (schema order).

**Read the real error list.** When Tableau refuses a generated workbook,
`log.txt` shows only `error-details=["*****"]`. The load-error dialog has the
text: press the dialog's own "Copy Error Message" button and read the clipboard.
It holds the full schema error list (element, line, expected children), which
often ends the bisect in one step. Send no keystroke to the main window while
doing it. A driver for this exits 0 when the workbook loaded and 1 when it did
not, printing the errors (wait up to 40 s for the dialog).

## Silent traps

### Colors

A mark color assignment lives on the DATASOURCE, in a `<style>` right after
`<layout .../>`, and needs three things. Tableau reports nothing when one is
missing: it drops the whole `<style>` and every mark falls back to the default
10-color palette.

```xml
<column datatype='string' name='[Who Fired]' role='dimension' type='nominal' />
<column-instance column='[Who Fired]' derivation='None' name='[none:Who Fired:nk]'
                 pivot='key' type='nominal' />
<extract ...>...</extract>
<layout dim-ordering='alphabetic' measure-ordering='alphabetic' show-structure='true' />
<style><style-rule element='mark'>
  <encoding attr='color' field='[none:Who Fired:nk]' palette='seattle_grays_10_0' type='palette'>
    <map to='#a8231c'><bucket>&quot;Someone shot&quot;</bucket></map>
  </encoding>
</style-rule></style>
```

1. The `<column>` AND the `<column-instance>` declared at datasource level,
   before `<extract>`. This one cost hours.
2. A `palette='...'` naming a STOCK palette id (`seattle_grays_10_0`,
   `tableau10`). A workbook-local `<color-palette>` resolves for an interpolated
   ramp but NOT for a categorical `type='palette'` encoding. Every value carries an
   explicit `<map>`, so the stock colors are never seen.
3. Tokens inside the datasource block carry NO federated prefix.

Also: Tableau prunes a `<color-palette>` nothing references. On a bar sheet,
remove the pane's fixed `mark-color` or it wins over the palette.

### Table calcs leak across the workbook

Column-instance names resolve across the WORKBOOK, not per worksheet. A
percent-of-total instance must be named `[pcto:sum:Incidents:qk]`, NOT
`[sum:Incidents:qk]`. Reusing the plain name put the table calc on every later
sheet's `SUM(Incidents)`: one bar chart silently drew percentages, and sorts on
`SUM(Incidents)` became sorts on a table calc, which is invalid, so the
dimension pill went red and the sheet rendered blank. The only trace was one
log line: `InvalidField ... The sort on X is invalid.`

```xml
<column-instance column='[Incidents]' derivation='Sum' name='[pcto:sum:Incidents:qk]'
                 pivot='key' type='quantitative'>
  <table-calc ordering-type='Rows' type='PctTotal' />
</column-instance>
```

### Shelves

- `(A / B)` on a shelf is not nesting; Tableau rewrites it. Use `*` with the OUTER
  field first: `(Year * Month)`.
- An integer field is a `:qk` token, and a `:qk` on a shelf renders as a
  CONTINUOUS AXIS, which always sits innermost. A year slid inside Month. Put
  `STR([Year])` on the shelf: discrete, stays where put, sorts chronologically.

### Filters

A one-member filter, in the only shape that works:

```xml
<filter class='categorical' column='[federated.x].[none:Has Subject:nk]'>
  <groupfilter function='member' level='[none:Has Subject:nk]' member='&quot;Yes&quot;' />
</filter>
```

No `user:*` attributes, a SHORT level token, no wrapper. Wrapping it in
`<groupfilter function='union' user:op='manual'>` is rejected with a Warning
dialog; `user:*` attributes on the member load clean and then filter EVERY row
away.

A quick filter's HOST sheet must sit on the same dashboard as a SHEET zone. When
it does not, the editor draws empty space where the filter should be, and a GUI
save DELETES such zones. Fix: a 1 px zone of the host sheet on that page. On
first open, only the active dashboard renders before the other sheets exist, so a
filter hosted by a sheet on another page can come up blank: keep the host on
page one, and make only that window `maximized='true'`.

`(All)` cannot be aliased on a dropdown filter card. A numeric filter's "N nulls"
badge goes away with `<filter class='quantitative' column='...'
included-values='non-null' />`.

### Tooltips and line breaks

- A line break in a text zone or tooltip is `<run>Æ&#10;</run>` (an AE ligature
  then a newline). A bare `<run>&#10;</run>` is silently dropped. Keep script
  output ASCII: Git Bash prints the Æ as a replacement character.
- A tooltip line naming a field that is NOT in its pane's view kills the WHOLE
  tooltip. On a dual axis a Columns measure belongs only to the pane whose
  `x-axis-name` it is. Put each tooltip measure in that pane's encodings as
  `<tooltip column=../>`, after color, size and shape.
- A DIMENSION on a pane's Tooltip shelf, when the pane colors by another field,
  blanked the entire sheet, headers and all. A discrete dimension on Tooltip
  loaded as a red invalid pill. Auto-add measures only; use `<lod>` (Detail)
  for dimensions, which can still be read inside the tooltip text.
- On polygons the value is constant per segment: use `[min:value:qk]`, since SUM
  multiplies by the vertex count.
- Custom tooltip fragment, inside `<pane>` after the encodings:
  `<customized-tooltip><formatted-text><run fontcolor='#9a9aa5'>Label: </run><run
  bold='true'><![CDATA[<[ds].[token]>]]></run> ... </formatted-text></customized-tooltip>`.
  Repeat the pair per line, with the line-break run from above between lines.
- A straight `"` at the start of a formatted-text run renders as a CLOSING curly
  quote. Write U+201C and U+201D yourself.
- A run made only of whitespace is stripped on load. Put the gap inside a run
  with visible content, or use U+00A0 (non-breaking space). A GUI save strips
  whitespace-only spacer runs of their font size.

### Transparency

A `#00000000` sheet background renders opaque WHITE unless the manifest lists
`<WorksheetBackgroundTransparency />`. Row banding needs `band-color`
`#00000000` on the table and pane rules too. Over a transparent sheet ground,
unselected marks fade toward white: give the sheet a solid ground if you rely on
selection.

`<ZoneBackgroundTransparency />` is not always needed. Tableau's own Save As
drops it (and adds `SetMembershipControl` and `SortTagCleanup`) and the reopened
workbook is still pixel-identical, while the worksheet flag IS required for a
`#00000000` sheet. Test a manifest flag by pixel diff before treating its absence
as a defect, and copy the flag set Tableau itself wrote.

### Maps

- The background map switch is a `<mapsources>` element, in two places: at
  workbook level right after `</datasources>`, and inside the map worksheet's
  `<view>`. `<style-rule element='map'><format attr='map-style' .../>` alone is
  dropped. `washout` on that rule is kept.

```xml
<mapsources><mapsource name='Tableau' /></mapsources>
```

- Dark map: three rules needed together (`map-layer` enables, `map` with
  `map-style='dark'`, `map-data-layer`). The `map` rule alone rendered light.
- Lock the map (no search, toolbar, pan, zoom) on BOTH the worksheet window's
  `<viewpoint>` and the dashboard window's `<viewpoints>` entry for that sheet:

```xml
<viewpoint><floating-toolbar-visibility value='2' /><geo-search-visibility value='1' />
  <map-navigation value='1' /><layer-control toolbar-button-enabled='false' /></viewpoint>
```

- A fixed degree range is IGNORED on a map. A GUI zoom then save stores the frame
  in Web Mercator metres; that form holds (`projection='EPSG:3857'
  range-type='fixed'` on the lon and lat `space` encodings).
- The automatic map halo draws a dark square round custom shapes:
  `<format attr='has-halo' value='false' />` on the pane mark.
- Size range: `<encoding attr='size' ... max-size='1' min-size='0.005'
  type='centersize' />` makes sizes grow from zero. The FIRST item of a manual
  sort on the shape field draws on top.
- Geographic role attribute is `semantic-role='[State].[Name]'`, not `geo-role`.
  A non-map source with a Country column gets a guessed geographic role: strip it.
- Mapbox tile labels are tile text, not in the file, and cannot be contrast
  gated from the XML (measured 1.4:1 on a dark tile).

### Selection

- A dashboard Pages card is a zone with `type-v2='currpage'`. It needs
  `synchronized='1' trailctrls='0'`, and any zone later in z-order that overlaps
  it swallows its clicks. See [workflow-and-qa.md](workflow-and-qa.md).

- Clicking a mark dims every other mark until the viewer clicks empty space. Tried
  and NOT effective: `fog-desaturation-*` and `fog-bg-color` on every element,
  `selection-relaxation-disallow`. Effective but costly: `<pane inert='true'>`
  needs the `<Layers />` flag and kills hover tooltips and click actions too.
- The True/False auto-deselect trick (a self-filter action on two constant
  calcs) did not clear selection in 2026.1.
- Faded unselected headers can drop to 1.57:1 contrast. The fade multiplies a
  color's distance from the card by about 0.26, so no base color survives it. Fix:
  one single-mark sheet per option and one parameter action per sheet, all
  setting the same parameter. A click selects the only mark, so nothing fades.
- A parameter RADIO list zone only changes on a click on the radio circle, not
  its label. A list parameter's radio list always stacks (about 33 px per item at
  11 pt).
- Filter action "Show all values" is `<param name='on-empty' value='all' />`;
  `none` left the target EMPTY after a second click on the same bar.
  Parameter action clear option `do-nothing` keeps the value after a click on
  empty space.

### Sizes and text layout

- A BAN tile hashes out on HEIGHT. 24 pt fit a 118 px band; 30 pt did not.
- Dashboard text zones truncate with ".." when the next line does not fit the
  zone height; they do not grow. Allow about 25 px per 9 to 10 pt line plus wrap.
- A header holds about 1.45x its Arial width plus 10 px; a dashboard text zone
  about 1.6x. Add slack past the estimate: an average-width estimate fit "Cohort"
  to the pixel and Tableau cut "Wards" (same length, wider letters) to "Wa..".
- Text table row height is a CELL format keyed to the innermost row field:
  `<style-rule element='cell'><format attr='height' field='[ds].[none:Lockdown:nk]'
  value='246' /><format attr='wrap' value='on' />`. A bare `height` on the cell,
  or a header height, is ignored.
- Mark label number format (`p0%`) goes on `element='cell'` or the datasource
  column's `default-format`. On `element='label'` alone it formats the HEADERS.
  **Two sources disagree here.** One build recorded the label format on the
  datasource column (`default-format='c0"%"'` on `<column name='[pct]'>`) and
  found that a worksheet `element='label'` text-format rule formats the AXIS;
  another recorded `p0%` on `element='cell'`. Both were observed, on different
  builds or paths. Test which one your build honours: set it once, render, and
  keep whichever changes the mark label.
  `<style-rule element='label'>` styles row and column headers; mark label ink is
  `element='datalabel'` with `color-mode='user'`.
- A text table shows column names only when `display-field-labels scope='rows'`
  is `true`; it is a per-sheet flag. To HIDE field labels use
  `<style-rule element='worksheet'><format attr='display-field-labels'
  scope='rows' value='false' />`, not `element='label'` (that hides the header).
- A row header is hidden with `<style-rule element='label'><format attr='display'
  field='...' value='false' />`.
- Label right of a circle: pane cell rule `text-align='right'`; widen the axis so
  the longest label fits or Tableau slides it back over the mark.
- Column dividers draw n + 1 lines (three clouds on Columns drew four): the outer
  ones box the card. Turn them off and bake inner hairlines into the background PNG.
- Row dividers in Tableau's own form (60 of 655 `table-div` rules in 97 local
  files): per style one rule with rows `line-visibility` on, `line-pattern-only`
  solid, `div-level` 1 and a `stroke-color`.
- A hidden axis still draws a 1 px `#f5f5f5` ruler at the pane edge: invisible on
  a light card, a white rule on a dark one. Put `<format attr='line-visibility'
  value='off' />` in EVERY `element='axis'` style-rule (row and column scopes) and
  gate it in the build. To find which element draws a stray pixel, recolor each
  suspect (zeroline, gridline, table-div, pane border, axis) garish magenta one at
  a time; here only the axis rule was guilty.
- A fixed-range axis that keeps its title shows a pin icon in presentation mode.
  Drop the axis title and put the note in the sheet subtitle.
- A text sheet that must scroll (705 quote rows) has NO `<zoom type='entire-view'/>`
  on its dashboard viewpoint, or the rows are squashed into the zone. Keep header
  widths plus cell width at least 64 px under the zone width or a horizontal
  scrollbar appears.
- A dropdown quick-filter card's title area is about 76 px: an 8-letter title
  truncates at 10 pt and fits at 9 pt. Add 10 px of slack per filter label;
  per-character averages cut "Nurses" to "Nurs..".
- A Square mark is a square, sized linearly at about 14.5 px per size-unit step
  (measured on Desktop), not a cell fill. A size near the column width overlaps
  the next row. For a heat map that must tile with no gaps use full-width **Bar**
  marks on a `MIN(1)` measure.
- A fixed axis min/max on an integer-typed measure is silently ignored. Wrap it in
  a float calc (`FLOAT([n])`) and the range holds.
- A dimension on Text or Detail splits a Line into separate points. To label a
  line use an AGGREGATE string calc on Text (`MAX(STR([label]))`).
- Stacked-bar labels default to segment centres. For a value at the bar end add a
  dual-axis Text layer at `SUM(x) + SIGN(x) * offset`; SIGN puts it on the correct
  side of a diverging bar. A label that cannot fit past a bar end is drawn INSIDE
  it by Tableau.
- Bar thickness: a pane mark rule `<format attr='size' value=.. />` (not linear).
- Stacked bar order: the FIRST member of a manual color sort is drawn OUTERMOST.
- Single-segment stacked bars print the count twice (segment plus total). Label
  calc `IF MIN({FIXED [dim] : COUNTD([color])}) > 1 THEN SUM([w]) END` on Text.
- `STR()` of a float prints 87.700000: format it by hand.
- Null alias: `<alias key='%null%' value=' ' />` (bare key; string keys are quoted).
- A null position on a constant-position text pane shows a ">N nulls" indicator.
  Blank the label calc instead.

### The workbook reads the extract, not the CSV

Regenerating the CSV changes nothing on screen: the `.hyper` files are what the
workbook queries. Rewrite them from the CSV with the schema read back from the
existing extract, so a column that vanished from the CSV is RED rather than a
quietly narrower extract.

### Custom shapes and packaging

- File > Save As `.twbx` embeds every custom shape in use as base64 in
  `<external><shapes>` at the end of the twb. Packaging without the GUI means
  rewriting each extract `dbname` to `Data/extracts/<name>.hyper`, each
  background `param` to `Image/...`, and embedding the shapes.
- A PIL resize of an RGBA image sets the RGB of fully transparent pixels to
  black, and Tableau's scaling bleeds a dark fringe round the shape. Refill
  transparent pixels with the shape's own color after every resize.
- A polygon sheet from precomputed vertices works with plain fields: Rows
  `[avg:y:qk]`, Columns `[avg:x:qk]`, color a dimension, Path a point-order field
  declared as an integer CONTINUOUS DIMENSION.

## Verified fragments

### Hover highlight on a calculated copy

A highlight action keys on the real field's caption, and hover paints the ROW
HEADER of the highlighted field yellow. Put the real field on Detail or Color and
a calculated copy on Rows. A calculated field takes no aliases, so build the copy
as a `CASE` over an aliases dict (`"2 Considering"` shown as `"Weighing it"`).
Gate it by counting yellow pixels in the header boxes: the broken build measured
4,620 yellow px, the fixed build 0. The control restores the broken shape and
must find the yellow.

### Legend as a layout zone

`<zone type='color' name='<sheet>' pane-specification-id='1'
param='[ds].[none:field:nk]' .../>` added to the dashboard layout gives that
sheet's color legend as a strip. Lay legend text out in whole units (see
[workflow-and-qa.md](workflow-and-qa.md)).

### Cross-dashboard filter action

Link expression `tsl:{target dashboard}?..`, `<source dashboard='{source page}'
.../>`, `<param name='target' value='{target page}'/>`, and an exclude list that
names the OTHER sheets on the target page. Clicking a source mark jumps to the
target dashboard, filtered. `<param name='on-empty' value='all' />` is "Show all
values" on clear; `'none'` left the target EMPTY after a second click on the same
bar.

### Dumbbell (verified shape)

- Rows: a display copy of the dimension (`Calculation_gaprow`). Columns:
  `(SUM(pct) + SUM([pct_dot]))` where `pct_dot = SUM([pct])` is a calc, so the
  dual axis is synchronized.
- Pane 1: `<mark class='Line' />`, `<lod>` the dimension, `<path column=cohort>`,
  fixed `mark-color`, size 2, labels off.
- Pane 2: `<mark class='Circle' />`, `<color column=cohort>`, `<lod>`,
  `<text column=label_calc>`, cell rule `text-align=right`, mark size 3,
  `has-stroke false`, `mark-labels-cull false`.
- Axes: first axis `range-type='fixed'` min 0 max N, second axis `fold='true'
  synchronized='true'`, both `display false`.
- Label calc prints "40% vs 16%" on the larger dot only.

### Slope chart (verified shape)

- Rows: `FLOAT([y])` (rank). Columns: `(sx1 + sx2)` with `sx1 = FLOAT([source_x])` and
  `sx2 = FLOAT([source_x])`; two copies make two panes.
- Pane 0 an empty Line. Pane 1 `Line` with `<color direction>`, `<lod reason>`,
  `<path column=sx1>`, size 3, tooltip naming only the reason. Pane 2 `Circle`
  with the same encodings plus `<lod source>` and the full tooltip.
- Axes: `sx1` fixed (for example -0.35 to 1.35), `sx2` synchronized, y fixed.
- A line spans both sources, so it cannot carry per-end values; the dots do.

### Ribbon or bump chart (rank by age)

Precompute S-curve points per reason (x, y, point_order, highlight,
role='curve'). One sheet: `<mark class='Line' />`, Columns `[none:x:qk]`, Rows
`[none:y:qk]`, color = highlight, `<lod reason>`, `<path point_order>`, size 4, a
member filter on role='curve', both axes fixed and hidden, grid off. Labels live
on separate sheets (next section).

### End labels beside any chart (invisible-Circle label sheet)

A separate narrow sheet: `<mark class='Circle' />` size 0.25, `mark-color` equal
to the pane ground, `has-stroke false`, `mark-labels-show true`,
`mark-labels-cull false`, Text = the label field, cell rule `text-align` right
(labels left of the dot) or left (labels right of it). X is a constant calc
`[y]*0 + a` on a fixed 0..1 axis, with `a = 1 - GAP/width` (left) or `GAP/width`
(right). Y shares the chart's fixed range so rows line up. The same trick prints a
stacked-bar total past the bar end.

### Reading a mark count without trusting the CSV

To prove a map filter keeps N marks: copy the `.twb`, un-hide and maximize the map
worksheet window (dashboard `maximized='false'`), add `<card type='summary' />` to
the worksheet window's left strip, set the parameter value and formula per state,
and open it. The Summary card prints "Count: N". Compare to the rows the calc
keeps (356, 342 and 61 read for three states).

### Navigation button (page arrows)

A button is a dashboard-object zone. `window-id` is the uuid of the target
dashboard's `<window>`, so generate `<windows>` first and reuse the uuids. The
image path resolves inside the `.twbx`. No `<image-path>` renders a text button.

```xml
<zone h='5000' id='29' type-v2='dashboard-object' w='4000' x='88800' y='3000'>
  <button action='tabdoc:goto-sheet window-id="{GUID}"'>
    <button-visual-state>
      <image-path>Image/arrow.png</image-path>
      <tooltip-text>Detail</tooltip-text>
    </button-visual-state>
  </button>
</zone>
```

Button captions take `fontname='Tableau Bold'` in `<button-caption-font-style>`.

### Dashboard shell and title bar

```xml
<dashboard enable-sort-zone-taborder='true' name='KPIs'>
  <style />
  <size maxheight='800' maxwidth='1000' minheight='800' minwidth='1000' />
  <zones>
    <zone h='98000' id='3' param='vert' type-v2='layout-flow' w='98400' x='800' y='1000'>
      <zone fixed-size='66' id='5' is-fixed='true' type-v2='text' .../>
      <zone-style><format attr='background-color' value='#b4b4b4' /></zone-style>
    </zone>
  </zones>
</dashboard>
```

`fixed-size` plus `is-fixed='true'` pins a band's height in pixels; everything
else shares the rest. `show-title='false'` hides a sheet caption. A title run:

```xml
<run bold='true' fontalignment='1' fontcolor='#ffffff' fontname='Tableau Semibold' fontsize='22'>Title</run>
```

`fontalignment`: 1 centers, 2 right-aligns, absent is left. Several runs in one
`<formatted-text>` give mixed sizes and colors in one zone. Right-aligned text
zone: `<style-rule element='dash-text'><format attr='text-align' id='dash-text_<zoneid>'
value='right' /></style-rule>` in the dashboard style.

### BAN tile (big number)

Empty `<rows />` and `<cols />`, a Text encoding on the measure, a
`<customized-label>` with a bold number run, a `Æ&#10;` break run, then a smaller
caption run. Number formats: `c"$"#,##0,.0K;("$"#,##0,.0K)` for abbreviated
thousands, `n#,##0` for an integer.

### Actions

```xml
<action caption='Highlight' name='[Action13_x]'>
  <activation auto-clear='true' type='on-select' />
  <source dashboard='Detail' type='sheet' worksheet='Drill In' />
  <command command='tsc:brush'>
    <param name='exclude' value='KPI: Avg Cost,KPI: Avg Wait' />
    <param name='field-captions' value='T' />
    <param name='target' value='Detail' />
  </command>
</action>
```

Filter is the same with `command='tsc:tsl-filter'` and `special-fields` `all`.
Parameter action is its own element:

```xml
<edit-parameter-action caption='Pick' name='[Action10_x]'>
  <activation type='on-select' />
  <source type='sheet' worksheet='Drill In' />
  <agg-type type='attr' />
  <clear-option type='assign-fixed-value' value='s:LROOT:None' />
  <params>
    <param name='source-field' value='[{DS}].[none:Initial Diagnosis:nk]' />
    <param name='target-parameter' value='[Parameters].[Parameter 3]' />
  </params>
</edit-parameter-action>
```

URL action (no `url-action-type` element): `<action><activation type='on-select'
/><source .../><link caption='..' expression='&lt;[ds].[url]&gt;' /></action>`. A
mark whose url is empty opens nothing. Cross-dashboard filter action: the link
expression is `tsl:{target dashboard}?..`, the exclude list names the other
sheets on the TARGET page.

### Filters, parameters, phone layout

```xml
<filter class='categorical' column='[{DS}].[none:Department:nk]' filter-group='101'>
  <groupfilter function='member' level='[none:Department:nk]'
               member='&quot;Cardiology&quot;' user:ui-domain='database'
               user:ui-enumeration='inclusive' user:ui-marker='enumerate' />
</filter>
```

`function='level-members'` with `user:ui-enumeration='all'` is "(All)". Filter
card zones: `mode='checkdropdown'` (multi) or `mode='dropdown'` (single), a 30 px
box that starts at its zone's top edge. List parameter:

```xml
<column caption='Diagnosis' datatype='string' name='[Parameter 3]' param-domain-type='list'
        role='measure' type='nominal' value='&quot;None&quot;'>
  <calculation class='tableau' formula='&quot;None&quot;' />
  <members><member value='&quot;Anxiety&quot;' /><member value='&quot;None&quot;' /></members>
</column>
```

Parameter members are the display words: no list-parameter member alias exists.
Phone layout: one `<devicelayout auto-generated='true' name='Phone'>` per
dashboard with `<size ... sizing-mode='vscroll'/>`, reusing the desktop zone ids
restacked vertically with pinned heights.

### Background, glass panel, icons

```xml
<zone fixed-size='498' is-fixed='true' is-scaled='1' param='Image/background.jpg'
      type-v2='bitmap' h='100000' w='100000' x='0' y='0' />
```

```xml
<zone-style>
  <format attr='background-color' value='#f5f5f584' />
  <format attr='border-color' value='#d4d4d4' />
  <format attr='border-style' value='solid' />
  <format attr='border-width' value='2' />
  <format attr='margin' value='4' />
  <_.fcp.DashboardRoundedCorners.true...format attr='corner-radius-top-left' value='15' />
</zone-style>
```

The alpha byte of the 8-digit hex is the whole trick. A clickable image zone is
`type-v2='bitmap'` with a `url=` attribute.

### Dynamic zone visibility

Per zone: `<dashboard-zone-visibility-node dashboard-identifier='{DASH}'
zone-id='{N}' visibility-input-guid='{GUID}' />`. At workbook level a
`<datagraph>` after `<windows>`: one `single-value-field-node` per boolean calc,
one `dashboard-zone-visibility-node` per zone, an `<edge from='{value-output-guid}'
to='{visibility-input-guid}' />` per pair, all in `node-execution-subgraphs` under
one subgraph guid. Manifest flags: `DatagraphCoreV1`,
`DatagraphNodeDashboardZoneVisibilityV1`, `DatagraphNodeSingleValueFieldV1`,
`ZoneVisibilityControl`. Remove the flags (and `ParameterAction*`) when you drop
the feature, and the workbook loads without them.

### Fixed text columns beside a bar

A synchronized dual axis whose second measure is a CONSTANT position
(`IF MIN([valence]) = 'push' THEN -135 ELSE 235 END`), a Text mark in that pane
with `<view><breakdown value='off' /></view>` (otherwise Tableau stacks the text
marks like the bars), `text-align` on the pane cell rule, both axes hidden, a
fixed axis range that leaves the gutters.

### Other course-era shapes (schema unchanged)

Dual axis: two measures in `<rows>` joined with `+`, then a `<pane id='1'
y-axis-name='...'>` per measure. Table calc `PctTotal` with
`ordering-type='Columns'`. Highlight table: `<mark class='Square' />` with color
and text on the same measure. Manual sort: `<sort class='manual'><dictionary>`;
computed sort: `<sort class='computed' ... using=measure>`. Number formats:
`default-format='p0%'`, `'n#,##0'`, `'*00000'`. A custom multi-stop palette is
`<color-palette custom='true'>` with 2 to 8 hex stops.

## Sources of truth

Copy the whole `<document-format-change-manifest>` block from a template
Tableau authored for your version. Header used here:
`version='18.1' source-build='2026.1.1'`. Rounded corners are a vendor-namespaced
element name copied verbatim from a GUI save. If you need a shape not listed
here, produce it in the GUI once and diff the saved file.
