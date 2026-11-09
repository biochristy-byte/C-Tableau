# Andy Kriebel's VizWiz recipes, written as build steps

Distilled from 40 videos on Andy Kriebel's public VizWiz channel (2026), the one
channel I used for Tableau technique. This file holds the full recipes. The short
version of the best ones is in [technique-library.md](technique-library.md); the
design opinions are folded into [house-style.md](house-style.md) rules 30 to 33.
Credit goes to him: watch the originals for the craft, this is only the notes.

Not covered: a few promo, career and conference-reaction videos had no build
content and were skipped.

Two ideas run through almost everything here:

1. **Any x/y you can compute, you can draw.** Map layers on a flat grid replace
   custom shapes, floating text and table calcs.
2. **State lives in one small field.** A set, a parameter or a boolean drives
   highlights, drills, zone visibility and KPI accordions.

## 1. Map layers as a drawing canvas

The canvas is a flat Earth: latitude -90 to 90, longitude -180 to 180. Anything
that fits can be drawn as a polygon, line, circle or text.

**Common setup**

- Main data source plus a tiny helper table of points (`Point ID` 1 to 5 for a
  rectangle, 1 to 3 for an L, 1 to 100 for a waffle, 1 to 180 for an arc, 0 to 361
  for a gauge).
- Join them with a relationship calculation that is the constant `1` on BOTH
  sides (cardinality One on the helper side). For an L-shape use `3` on the data
  side with operator `>=` and `[Point]` on the helper side so only points 1 to 3
  join. With Point on Rows every category shows the same value for each point;
  with Point off you still get the true total (no double counting).
- Build the shape with `MAKEPOINT(lat, lon)` where each coordinate is a
  `CASE MIN([Point ID]) WHEN 1 THEN ... END`. Wrap Point ID in `MIN` or you get
  "cannot mix aggregate and non-aggregate arguments".
- Rescale values into the longitude range with a share, and make it a LOD
  because map layers cannot use table calcs: `SUM([Sales]) / SUM({ SUM([Sales]) })`.
- Mark type Polygon (or Line) with Point ID on Path. Bring each extra layer in by
  dropping it on "Add a Marks Layer", not as a new axis.
- You need TWO layers before you can turn the background off with Map >
  Background Maps > None. A third layer can be added afterwards. The better
  option for spacing control is Map > Background Layers > Washout 100%.
- Set **Disable Selection** on every decoration layer so a click cannot highlight
  it. The exception: do NOT disable it on the layer whose tooltip you want (the
  day circles of a calendar lose their tooltip).
- Label layers: a separate `MAKEPOINT` per label, mark type Circle (easiest to
  align), label alignment set per layer, then Color opacity 0 to hide the dot.
- Pad the axis (for example -0.5 to 1.5) so bars do not touch the frame, hide
  headers, gridlines, zero lines and row and column dividers.

**Shapes**

| Chart | Points | Key calc or step |
|---|---|---|
| Big bar | 5 (closed rectangle) | lat `0,1,1,0,0`; lon `0,0,share,share,0` |
| L-shaped bar | 3 (bottom, elbow, tip) | same calc, points 1 to 3, mark Line; a second layer with only first and last point for end dots |
| Budget tick | 2 | lat 1.1 and -0.1, lon = share of budget, dotted line, label the end only |
| Donut | none | `MAKEPOINT(0,0)` as a Pie with `% of total` and `1 - % of total` as Measure Values on Angle, then the same point again as a white Circle layer on top with the number as its label |
| Waffle | 100 | helper table with col 1 to 10, row 1 to 10, percentage 0 to 100; `MAKEPOINT([row],[col])`, mark Square, color where percent of total passes the 0 to 100 index (22 percent must color exactly 22 squares: test it); round the share to 2 dp so it aligns to the index; reverse the latitude axis so fill starts at the top |
| Gauge | 0 to 361 | x = radius * COS(angle), y = radius * SIN(angle), angle = degrees * PI()/180; inner arc for points up to 180, mirrored outer arc after; about 7 layers (arcs, the big number at (0,0), actual line, target line) |
| Calendar heat map | 7 columns by up to 6 weeks per month | see below |
| Marginal histogram | 5 per cell | heat cells as polygons, bars as more polygon layers scaled by `count / max`, all against one shared max so they compare (multiply by about 10 because 0 to 1 is tiny on a degree grid); duplicate the measure per layer so each layer has its own color range |
| Jump plot (retention arc) | 180 | x = cosine of the point times half the customer lifetime plus first-purchase date, y = arc height, mark Line, customer on Detail, point on Path |

**Calendar heat map recipe**

- `Week Offset = DATEPART('week',[d]) - {FIXED DATETRUNC('month',[d]) : MIN(DATEPART('week',[d]))}`
  so each month restarts at 0. Both pieces come back as measures: drag them to
  Dimensions.
- `Weekday Number`: Monday 1 to Sunday 7 (`IF DATEPART('weekday',[d])=1 THEN 7 ELSE ... -1 END`;
  skip the IF where Sunday is 1).
- Day circle: `MAKEPOINT(-[Week Offset], [Weekday Number])`. The latitude is
  negated because latitude grows upward and weeks must run down.
- Month grid: group the months into three column buckets and put the quarter on
  Rows, giving a 3 by 4 layout.
- Weekday letter row: `MAKEPOINT(1,[Weekday Number])` as a Text layer, the date
  field's Dates format set to first letter. Month title: `MAKEPOINT(2,4)`.
- Color the day layer by a continuous measure. Why a map: discrete-header
  calendars run months together and continuous ones space circles badly; layers
  fix both.

## 2. Sets: highlight, drill, compare

A set is a boolean (in is true, out is false). A set action means "assign values
to the set on select, remove all values on deselect". A parameter holds one
value; a set can hold many, so any parameter action can be done with a set
action but not the reverse.

Settings that matter: Run on Select, single select only if you want exactly one,
target set, "Assign values to set", and on clear either "Remove all values from
set" (reset) or "Keep set values" (sticky).

| Technique | Recipe |
|---|---|
| Proportional brushing (compare, do not filter) | Set on the dimension, drop it on Color of BOTH sheets, untick Include in Tooltip, drag `In` below `Out` in the legend so the highlighted part sits on the baseline. It shows contribution and never drops rows. |
| Bar drill-down | `IF [Set] THEN [Sub] ELSE "" END` on Rows beside the parent. Only the clicked parent expands. Multi-level: `IF [Set] THEN [State] ELSE [Market] END`. |
| Date drill, year to month | Create custom dates (not date parts) for Year and Month, build the set from the custom Year, `IF [Year Set] THEN [Month] ELSE [Year] END` as a continuous date, filter calc `{ FIXED : SUM(INT([Year Set])) } = 0 OR [Year Set]` (keep True). Do not put category filters in context. Add a Color calc ("Month level" or "Year level") so the reader sees the level change. |
| Variance to the selected mark | `{ FIXED : SUM(IF [Set] THEN [Sales] END) }` broadcasts the one selected value to every mark; variance is `SUM([Sales])` minus that. Build intermediates in the view first, then drag them into the next calc to avoid typos. |
| Reorder by click | `IF [Set] THEN [Sales] ELSE 0 END` as the sort field, ascending (a stacked bar puts the first item at the bottom). |

**The sticky highlight problem.** Clicking a mark always leaves it highlighted.
Fix A (keeps the transition animation): add a constant calc (`"x"`) to Detail
and pick it in the toolbar highlighter, which creates a highlight action. Fix B
(loses the animation): put calcs `true` and `false` on Detail and add a filter
action (source and target the same sheet, Show all values, selected fields
true = false) that never matches and runs after the set action. B cannot be used
when click-off must reset, because the mark is already deselected.

**Housekeeping that prevents cross-contamination:** one data-pane folder per
technique, name every action after what it does, and give a duplicated sheet its
own set and actions (deleting an action on a copy broke the original).

## 3. Dynamic zone visibility and the KPI accordion

Five ingredients: a parameter, a boolean calc that reads it, the objects to
toggle, usually a container, and a parameter action that sets it on click. Then
Layout > Control visibility using value. The boolean can be any calc, even one
holding a FIXED LOD. Assign the visibility to the CONTAINER holding several
sheets, not to each sheet. DZV is presentation only (no database query); a
filter on each sheet works but re-queries.

- Build and test the action as a WORKSHEET action first, then convert it to a
  dashboard action.
- Details on click: a string parameter that defaults to a placeholder, a
  parameter action with "when cleared, set to blank", `Show table = [p] <> ""`
  for visibility and `Filter = [p] = [Sub-Category]` as a True filter on the
  detail sheet. Put the parameter in the popup's title so the reader knows what
  they picked. A DZV popup is the one place floating a zone is justified.
- Chart swapping with DZV avoids the padding that stacking sheets in one
  container adds and lets each chart keep its own title. A drill from borough
  to zip to point can be one sheet per level.

**Mobile KPI accordion (a 375 wide dashboard built from scratch)**

- Delete the Phone preset and build a custom 375 wide dashboard instead. Float
  ONE vertical container at 0,0 at the full dashboard size and tile inside it.
- Each summary row is one sheet: Columns `AVG(0)` and `AVG(1)`, dual axis,
  synchronized, axis fixed 0 to 1, header hidden. `AVG(1)` is a bar carrying the
  measure label; `AVG(0)` is a Gantt bar with the text label right aligned and
  Color opacity 0 (a text-only layer).
- String state parameter, `[show sales] = [measure parameter] = "Sales"`, with
  the boolean's aliases set to "-" for True and "+" for False, placed first on
  the label so the row reads "- Sales" or "+ Sales".
- Detail charts get DZV on their boolean. One change-parameter action per KPI
  row, source field = the text calc, "leave current value on clear".
- Pitfall 1: the click does nothing until the text calc is also on Detail of the
  bar layer, because the click lands on the other mark layer. Whatever the action
  reads must sit on Detail of the clickable layer.
- Pitfall 2: after a click the plus or minus alias dims with the selection. Fix:
  calcs `T = "true"` and `F = "false"`, F on Detail of each summary sheet, and one
  filter action per sheet (Run on Select, source that sheet only, TARGET the
  SHEET not the dashboard, Show all values, selected fields F = T).

## 4. Two values in one parameter (a two-click range)

Use it to pick a promotion period with two clicks, with a band shown between.

- Custom date Month (date value). `[month text] = STR([Month])`, ten characters.
- String parameter seeded with a ten character date. `[text for parameter] =
  IF LEN([p]) = 10 THEN [p] + [month text] ELSE [month text] END`; put it on
  Detail and on Path so the line stays connected.
- Change-parameter action, source = the data source, Run on Select, keep the
  value on clear. The first click appends (10 to 20 characters), the second
  resets.
- `[left] = DATE(LEFT([p],10))`, `[right] = DATE(RIGHT([p],10))`, then `MIN` and
  `MAX` of the two so click order does not matter. `[in range] = IF [Month] >= [min] AND [Month] <= [max] THEN [Sales] END`,
  placed ABOVE sales in the color order or it draws behind.
- Reference band from left to right, label off, dashed, no fill, untick
  Recalculate. Same trick counts weekdays between two dates: days between is
  `DATEDIFF('day', start, end) + 1`, weekend days is a FIXED-less LOD over an
  in-range flag, result is `IF weekend > days THEN 0 ELSE days - weekend END`.

## 5. KPI cards and actionable comparisons

Year over year (swap YEAR for MONTH for month over month):

- `current year = {MAX(DATETRUNC('year',[d]))}`, `is current year = [current year] = DATETRUNC('year',[d])`,
  `py` is the same wrapped in `DATEADD('year',-1, ...)`.
- `current year sales = INT([is current year]) * [Sales]`, prior year likewise.
- `YoY difference = SUM([cy sales]) - SUM([py sales])`; percent divides by
  `SUM([py sales])`. The denominator MUST be aggregated.
- Custom format `+0.0%;-0.0%`. For sparkline cards add LOD totals on Detail and
  reference them in the title card, so one sheet holds the big number and the
  line.
- Card forms worth knowing: big number; sparkline in the title area (discrete
  month, first letter header, Include Zero off, header hidden); two lines; dual
  axis with prior year as a grey area behind; bars (bars ALWAYS start at zero);
  bullet-like with Measure Names on Color and Size and Stack Marks off; bars
  with a prior-year reference line per cell; bars colored by an increase flag;
  a "decrease indicator" calc that prints a big red dot only when false.
- Blue and red semantics: color the title text run to key the series.

## 6. Smaller chart recipes

| Chart | Recipe |
|---|---|
| Hexbin | Float parameter `adjuster`; `HEXBINX([x]*[adj], [y]*[adj]) / [adj]` (and `Y`). They return numbers so Tableau files them as measures: drag to Dimensions, then make Continuous. The adjuster is tiny: 0.005 looked right, 0.1 barely moved, 2 did nothing. Count on Color, roughly square zone. |
| Quadrant | Average lines on both axes, flags `AVG([x]) > WINDOW_AVG(AVG([x]))` set to Compute Using the detail field. Use `NOT`, not `= FALSE`. One string `Quadrants` field (IF/ELSEIF over both flags) is better than two stacked flags: one field, one palette. |
| Multi-column dot plot | Circles per measure, a dotted rail behind each row from calcs `zero` and `one` on a combined axis (mark Line, Measure Names on Path). Custom axis range -0.4 to 1.4. |
| Sparkline | Date on Columns, measure on Rows, Include Zero off, Independent axis range, axis header hidden, dividers off. |
| Rounded bar with labels inside | Fat Line mark on `AVG(0)` combined axis for the bar; a second synchronized layer as a Gantt bar with Color opacity 0 and left, center, white labels, Allow labels to overlap. |
| Marimekko alternative | Running total table calc on Columns, count on Size (fixed, right aligned); wrap the running total in a second calc divided by the grand count to get 0 to 100 percent (two table calcs must be configured separately); show the group total with a hidden Total reference line per pane. Table-calc heavy: prefer precomputed fields in a pipeline. |
| Population pyramid | Pivot the gender-year columns, split the pivot names into Gender and Year, `IF [Gender]='Males' THEN [Pop] END` (case sensitive), female on the same axis as a combined axis, negate one side, hide the minus with a custom number format on both the field and the axis. Gray background bars: the measure twice with Stack Marks off. |
| Viz in tooltip | Build a small helper sheet, Tooltip > Insert > Sheets. Replace the default "all fields" filter with only the field that identifies the hovered mark. |
| Reference line off the grand total | Set the line's aggregation to Total (not Average): it disappears on the total column through an aggregation mismatch while the per-bar lines stay. |
| Zoom with no extension | Reference line value `IF [zoomy]="no" THEN 0 END`, label and tooltip off, line none, "show recalculated values" off, Include Zero off on the axis. 0 forces zero into the range (zoomed out); NULL lets the axis fit (zoomed in). |

## 7. Calculation fundamentals worth enforcing

- **The level of detail of a view** is the dimensions on Rows and Columns plus
  anything on Color, Size, Label, Detail, Path and Shape. Measures do not count.
  Tooltip does NOT add granularity (that is why a dimension there becomes
  `ATTR()`). The status bar mark count is the check.
- **Find the table's true grain:** put Number of Records on Text and add IDs
  until the mark count matches. Hidden fields (a row ID) can be the only thing
  that reaches it. If the view is not at that grain, every ratio is an aggregate
  calc.
- **Mixing aggregate and non-aggregate fails**, and the aggregate may hide inside
  another calc: expand the field to read it.
- **The ratio trap:** `[a]/[b]` at row level is then summed (19,000 percent) or
  averaged (a plausible but wrong number). Always `SUM(a)/SUM(b)`, and name the
  aggregated and row-level versions apart.
- A non-aggregate IF returns a dimension and can split an entity into two
  buckets; an IF built on an aggregate returns a measure.
- **Table calcs:** after hunting with Table Across, Down or Pane, lock to
  Specific Dimensions or moving a pill silently breaks them (one demo gave
  14,400 percent). Uncheck the dimensions you restart on (like GROUP BY), check
  the one that adds to 100 percent. Sanity check: the grand total of a
  percent-of-total equals 100 percent times the number of partitions. Do not
  bake a compute-using into the calc itself.
- **LODs:** `{FIXED dims : AGG()}` is "for each"; prefer FIXED, avoid
  INCLUDE and EXCLUDE (they depend on the view and cannot be named well). An
  average of a sub-grain needs a nested fixed LOD (calcs run inside out). Fixed
  LODs ignore dimension filters unless the filter is added to context. FIXED on
  nothing broadcasts one value to every mark (used for variance, filter-by-count
  and percent of total).
- A total that is really an average must be renamed "Average".
- Right-click drag a date to get the date-part menu; right-click drag a measure
  to pick its aggregation.
- Tableau will not autocomplete a field name that starts with a digit.

## 8. Layout and dashboard opinions

- **Skeleton:** new dashboard, FLOAT one vertical container (hold Shift), set it
  to the exact dashboard size at 0,0, tile everything else inside it. 10 px
  inner and outer padding on everything gives 20 px gaps. Pin (fix) the title and
  divider heights and leave one chart unpinned to absorb resizing. Double-click a
  horizontal container's grabber, Distribute contents evenly. Delete the stray
  legend container Tableau adds. Fewer containers, each with intent.
- **Border pitfall:** on Tableau Cloud and Public inner padding does not show a
  container border; use outer padding to see it.
- **Divider:** a Blank object, height 10 (4 outer top and bottom plus a 2 px
  line), black background.
- **Legend:** use end-of-line labels in the series color (Label > most recent
  value, scope line, font matches the mark, bold, the dimension dropped on
  Label) and delete the color legend.
- **Bars:** sort descending, labels left aligned inside the bar, same alignment
  on every bar chart, axis header off.
- **Five mistakes to fix:** color for its own sake (neutral palette plus one
  focus color, and the same color never means two things); more than four
  competing elements (rule of four); a dashboard with no stakeholder question
  (ask what should stand out in five seconds, write the title as a question,
  rename sheet titles to say what they show); container hell; a dashboard that
  is a static image (make a sheet a filter and add a 10 pt "Click a bar to
  filter" line).
- **Highlight versus filter:** a filter controls what is in the view, a
  highlight draws attention to what is already in it. The highlight field must
  exist in the target sheet's view (put Region on Detail); untick targets that
  lack it. "Use as Filter" applies to ALL sheets and names itself "Filter 1
  (generated)", so for control use Dashboard > Actions > Add > Filter with one
  source and one target.
- **Actions:** run on Select, never on Hover (the screen moves when the reader
  only wanted a tooltip), clear with Show all values (Keep filtered values leaves
  it stuck), rename every generated action.
- **Information overload:** start from KPI numbers only and reveal detail on
  click. Complexity of design is not complexity of function.
- **Simple beats impressive:** gauges are not best practice but stakeholders read
  them; a chart people can act on beats one they cannot.
- **Data source basics before publishing:** a Public workbook must use an
  extract or it will not save; a packaged `.twbx` embeds the data. Put an
  "inspired by" link in the workbook details.
- **Process:** keep each technique's calcs in a text file ready to paste, save
  often, study trusted authors' workbooks and then simplify.

## 9. Messy data inside Tableau

- Data Interpreter (a checkbox on the data source page) promotes the real header
  row and drops junk rows and footers; few people click it.
- Pivot wide columns, Split the pivot names, rename and retype the pieces: no
  formulas.
- The default Split guesses from a sample and breaks on multi-word names. Use
  Custom Split on a fixed separator, or chained `REPLACE`, and name the result
  something real ("county clean"). In a pipeline, do this in Python instead.

## 10. Portfolio advice (from one of his talks)

Pick curated work rather than a bare profile link; group vizzes in Public
playlists; host tall or portrait vizzes elsewhere because a Public tile is only a
preview; never delete old work (progression is the point and a profile of ten
flawless vizzes looks suspicious); a consistent style across projects is a
selling point; for confidential work use a synthetic dataset or a four-part case
study (challenge, process, solution, impact). Makeover Monday, Workout Wednesday
and Back to Viz Basics are the starter community projects.

## 11. Frequency matrix (enrollment and performance, plus flow variants)

Source: "Frequency Matrix" live session, 56 min (video gv5uJvETqZo). He says it is
recorded, so he moves fast: use the timestamps to jump. The data is made up
(generated with Claude, framed as Appalachian State data). No Tableau version is
named, and no feature is announced as new.

### What it answers and when to use it

A frequency matrix is a grid that compares two dimensions: one on Rows, one on
Columns, each cell showing a count or a measure such as GPA (at 1:12). Here it is
majors down the side and minors across the top. It shows the whole picture at
once and answers (at 1:47):

- Which majors most commonly pair with which minors (color by student count).
- Which pairings produce the strongest outcomes (color by average GPA, with a dot
  on the single best cell).
- Which pairings are rare or surprisingly common.

Reading it (at 4:13): darker cells are higher, lighter are lower, the eye goes to
extremes first. Look for clusters, outliers and cold spots. To see clusters,
order neighbors that belong together (psychology, sociology, education next to
each other). His GPA range was only about 2.7 to 3.9, so color varies little.

### Data shape

One row per student and term (at 5:55): student ID, term, major, minor, GPA in
the major, GPA in the minor, average GPA (the two added and divided by 2, no
weighting), plus filters such as first generation. Every major and minor
combination must exist so the grid is full (at 7:26). He aggregates courses up to
department to keep it simple. Drop the Excel file on the canvas and Tableau
connects it (at 6:51). The second source (at 28:47) is student mobility: resident
state, enrollment state, number of students, limited to Northeast states so the
grid is not 50 by 50. The map build (Build 6) also needs a state table with latitude, longitude and a
state abbreviation (at 35:06).

### Build 1: count matrix (at 7:13)

1. Major on Rows, minor on Columns. Hide the field labels. Fill the view (Entire
   View).
2. Drag the student count field onto Color. The exact field is unclear in the
   transcript. This shows students per combination.
3. Pick a better palette (his own "next level" palette) and add cell borders
   (at 8:06). Mark labels on is possible, but he finds numbers make the grid busy
   and hide the pattern, so he leaves them off (at 8:31).
4. Bold 14 pt axis titles for minors (top) and majors (side) so the reader knows
   which direction is which (at 10:11). He used dummy data to add the minor
   label on top.

### Build 2: most common pair per row (at 8:58)

```
// most common pair
// Exact formula is unclear in the transcript. Spoken as: if the number of
// students equals the largest in the row, return the number of students,
// otherwise nothing. Table calculation computed across each row.
```

Convert the result to continuous, put it on Label, set the mark type to Square,
and make the table calc run across the view (at 9:41). Reads as "most biology
majors who take a minor take psychology". It is a labeled square only where the
row maximum sits.

### Build 3: blank the diagonal (at 11:06)

The diagonal is a major paired with a minor in the same department. It would
dominate the color scale.

```
// major and minor the same
// Spoken: if major equals minor then 0, else 1. Whether it is a separate IF
// ELSE with two branches is audible; the exact casing is not.
IF [Major] = [Minor] THEN 0 ELSE 1 END
```

1. Duplicate the sheet first so the earlier version survives (at 11:51).
2. Put the calc on Color. Edit the palette: reverse it so reds are at the top,
   set the center to 1, and make the bottom color white (at 12:00). The diagonal
   is now white.
3. To show the diagonal on its own as numbers, duplicate the calc and switch the
   branches (at 12:55):

```
// major and minor students
// Spoken: the same IF with the branches switched, so it returns the student
// count only on the diagonal; put it on Label. Exact body unclear in transcript.
```

   That diagonal count is students with a major and a minor in the same
   department (117 for biology), not all biology students. Row context
   in the final view: 1,100 biology minors, 1,082 biology majors (at 19:21).

### Build 4: GPA matrix (at 13:36)

1. Set the default aggregation of the average GPA field to Average (at 13:43).
2. Put average GPA on Color instead of the count. Diagonal cells look too strong
   if left in, so factor them out as before (at 14:34):

```
// major and minor GPA
// Spoken: if major does not equal minor, average GPA, else 0.
IF [Major] <> [Minor] THEN AVG([Average GPA]) ELSE 0 END
// exact wrapping of the average is unclear in transcript
```

3. Put it on Color. The diagonal now reads as a zero GPA
   and turns dark, so fix the palette (at 15:04): reverse the colors so red is at
   the top, set the center, and use Stepped Color. His start value has to be 1,
   not 0, and the bottom color white so the zero cells show as white (at 16:30).
4. Use four steps, with the end set to 4.0, so the bands read as GPA 1, 2, 3, 4
   (at 17:02). Dark red now means high GPA. The first attempt showed gray instead
   of white and he fought the palette settings for about two minutes: if the
   diagonal turns gray, check the start value.

### Highlight the best cell with a dot (at 17:23)

```
// highest GPA
// Spoken: if the average GPA (the major and minor GPA field wrapped in an
// average) equals the highest value across the entire view, return a small
// circle character, else nothing.
// The window function name is unclear in the transcript.
```

Put it on Label. First result showed many ties because it marked the maximum in
every row. Edit the table calc to Compute Using the specific dimensions Major
and Minor, so it runs over every major and minor combination, not within each
row (at 18:21). One dot now marks the best pair (political science
major with history minor in this data, at 18:32). Set the label to 20 pt bold to
make it stand out (at 18:50). His preferred version is the one with the wider
color range and student counts down the rows for context.

### Variants he builds on the same data

- **Sankey** (at 20:12): a viz extension (Marks card, Add Extension), must be
  enabled by the Tableau admin. Major and minor on it, student count as the
  link. Filter out the diagonal with a calc `major equals minor` set to False
  (at 20:54). Filter to a few majors (STEM: biology, computer science, nursing)
  or it is too busy. Sort each side by the field, descending, to rank (at 31:19).
- **Distribution by minor** (at 22:11): major on Rows, student count and average
  GPA, circles, minor on Color. Adding student on Detail gets too dense. Spread
  with the RANDOM function (how it is applied is unclear in transcript), add an average line per
  pane. He finds it too busy and goes to a **box plot** instead (Tableau adds it
  in the view): biology majors with a history minor perform significantly worse
  than other minors (at 24:45). He calls it an analytical chart and would not
  put it on a dashboard (at 24:45).
- **Major GPA vs minor GPA scatter** (at 25:02): both GPAs, student ID on Detail
  is too busy, so detail by major and minor, circles, student count on Size set
  as a range, opacity down (at 26:29). Psychology major with sociology minor has a
  high GPA but only 25 students; computer science with English minor has many
  students and low GPA. A diagonal pattern means major and minor GPA move
  together (R squared 0.85, "a correlation, not causation", at 27:24).
- **Slope graph** (at 27:41): major GPA to minor GPA, major on Color. A line going
  down means a lower GPA in the minor; steeper slope for biology majors.
- **Dual axis dot plus line** (at 47:12): duplicate the measure, dual axis,
  synchronize, second mark a Line connecting the minors, to show the range.
- **Tree diagram** (viz extension, at 32:18): resident state and enrollment state
  on Detail, student count, drop in-state students. Free to use, but publishing
  to Server or Cloud needs a license (at 54:44, details below).
- **Network diagram** (viz extension, at 33:44): resident state as start,
  enrollment state as end, students as measure. Horizontal, vertical or radial
  layout in the extension; he prefers radial. It would not fill the space in the
  demo and he did not fix it (at 34:39).
- **Split by first generation, term, school year** (at 42:52): the same view
  filtered; first generation students did not perform as well. Nothing stood out
  by term or year.

### Build 5: mobility matrix and Sankey (at 29:22)

1. Resident state on Rows, enrollment state on Columns, student count on Color.
   Most students stay in state.
2. Calc to remove them (at 29:44):

```
// in state
[Enrollment State] = [Resident State]
```

   Put it on Filter and keep False. Neighbors then show: New Jersey to New York
   and Pennsylvania (at 30:01). Raw counts ignore the population of each state,
   so they are not the best comparison (at 32:30).
3. Sankey on resident state to enrollment state with students as the link
   (at 30:54).

### Build 6: flow lines on a map with map layers (at 34:58)

1. Bring in the state latitude and longitude table as a second data source
   (a CSV against an Excel file works through relationships) (at 35:21).
2. Add it TWICE as a relationship: first resident state to the table's state
   abbreviation, renamed Residence, then enrollment state to the same state
   abbreviation, renamed Enrollment (at 35:47). The same table can be used more
   than once. Hide the unneeded fields.
3. Calcs (at 37:19 and 38:19):

```
// residence point
MAKEPOINT([Residence Latitude], [Residence Longitude])
// enrollment point
MAKEPOINT([Enrollment Latitude], [Enrollment Longitude])
// state flow
MAKELINE([residence point], [enrollment point])
// field names inside MAKEPOINT are not spoken; the pattern (latitude and
// longitude from each connection) is.
```

4. Double-click the residence point, set it as circles, state name on Detail,
   students on Size (he first filters to one state to focus the view, at 37:44).
5. Add a layer (drop on Add a Marks Layer) for the flow: state flow, with
   residence state and enrollment state on Detail and student count on Color.
   Sort the states by students so the darker lines come to the front
   (at 40:17). He keeps the dots because they help show the spokes.
6. Tooltip rewritten as "students that reside in X ... enrolled in Y" (at 40:40).
   Example: 8,000 New York residents enrolled in Pennsylvania. Switch to his red
   palette or a university palette.

### Formatting and design choices

- Palette: his own "next level" palette for counts; red high to white low for
  GPA; four stepped colors from 1 to 4.0 (no hex codes given in the video).
- Square marks, cell borders, no labels except the diagonal or the best cell.
- Axis titles 14 pt bold; best-cell dot 20 pt bold.
- Reduce opacity on overlapping circles.

### Interactions and actions

None built. He did not build a dashboard. Filters (major and minor flag,
first generation, term) are used on the sheets in exploration (at 42:52).

### Gotchas and his opinions

- Numbers on every cell make the matrix busy and cover the pattern (at 8:35).
- Blank the diagonal or it hijacks the color scale. If you blank it with a 0, the
  zero shows as the darkest color unless the center and start are set (at 15:19).
- Table calcs for the best cell must be set to the specific dimensions, or you get
  one winner per row (at 18:11).
- Counts versus per capita: raw counts hide that big states dominate (at 32:30).
- Viz extensions: must be enabled by the admin. Of the free ones, three are built
  by Tableau and publish free to Cloud (the Sankey works after publishing). Third
  party ones (he shows LaDataViz) are free on Desktop and Public but need a
  license to publish to Server or Cloud (at 54:44).
- Colorblind palettes exist built in (at 48:04). A parameter `colorblind` (yes or
  no) on Detail then Color, with two palette assignments, lets the reader switch
  (at 49:55). Custom palettes do not update automatically when a brand palette
  changes, because Tableau stores a hex code per member (at 52:01). Chart types
  cannot be disabled; use guidelines and training (at 53:41).
- Guiding principles (at 43:42): ask the stakeholder what question they are
  answering, not what they want in the dashboard; build many charts and choose
  the one that answers it best; add context ("compared to what", for example the
  average for that major); know the decision that follows; expect the next
  question ("why five times") and give a drill or popup for it. Most dashboards
  show what is wrong, not what is going well. A dashboard is an overview, not
  deep analysis.
- Same data three ways: matrix, Sankey and tree map all show the same data
  (at 33:27). Pick by audience and question.

## Announced but not shipped (at the time of the videos)

Layers without the lat/lon trick, transparent tooltips, dynamic field
formatting, vector images on Cloud, an accessible authoring experience. None had
dates, so do not plan around them.
