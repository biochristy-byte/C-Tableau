# Tableau Vizard recipes, written as build steps

Distilled from 14 usable videos (17 captured) on the public YouTube channel [Tableau Vizard](https://www.youtube.com/@TableauVizard) (the presenter introduces himself as Sankalp). The channel is a beginner-friendly Tableau channel: short single-technique tutorials (radial bar, motion chart, 3D bar, top/bottom N, free licences) plus one longer "Viz Exploration" episode where he downloads an expert's Tableau Public dashboard and reverse-engineers it. He also posts Makeover Monday dashboard walkthroughs. Credit goes to him: watch the originals for the craft, this is only notes.

Coverage: 14 videos are covered below. Videos 1 to 6 came from YouTube auto-captions (3 more captured captions were unusable). Videos 7 to 14 (8 videos, added later) came from Whisper small.en transcription of the audio, which is cleaner than the captions but still mishears Tableau terms (fixed where the meaning was certain, otherwise marked unclear).

Source quality: captions are auto-generated. The Viz Exploration episode is clean. The three short tutorials (radial bar, top/bottom N, 3D bar) are badly garbled, with Tableau terms and numbers mangled. Where a step could not be resolved it is marked "(unclear in transcript)". No calculation below was invented.

## Not yet covered

Still to be transcribed (ids from the channel list):

| Id | Title |
|---|---|
| 81MffiJZtuQ | Tableau Interactive Resume 2 (step by step guide) |
| BYM4-j949yg | Makeover Monday 2020 Week 34, using viz in tooltip |
| NOMp2-HrQic | Makeover Monday 2020 Week 33, using a shape file for a map |
| k_TX7VMPh1k | Dendrogram in 5 minutes |
| LclaJGRXRFU | Sankey chart in 10 minutes |
| a-phsD3G3q0 | Makeover Monday Tableau: everything you need to know |
| 4QtE7ZI9ywA | Custom colour palettes |
| D-C2AUot7vo | Makeover Monday 2020 Week 25, using Figma to create the background layout |
| z6RFiIAXYd0 | Tiled hex map of USA |
| 5D7HhQVZ-f8 | Makeover Monday 2020 Week 24 |
| IXVI08LA1BY | Donut chart |

## Videos covered

| # | Title | URL | What it teaches |
|---|---|---|---|
| 1 | Tableau Viz Exploration, Episode 1: Using Parameters As Filters & Creating Custom Shapes | https://www.youtube.com/watch?v=UOnW5olbugE | Grid-of-countries layout from x/y columns in the data, custom fill-level shapes made in Figma, a parameter plus parameter action that acts as a filter and a button row |
| 2 | Tableau Tutorial: Radial Bar Chart | https://www.youtube.com/watch?v=NsJaQuQ3iuQ | Radial bar built from a path table, radius parameters and X/Y coordinate calcs (calc bodies mostly unclear) |
| 3 | Tableau Tutorial: Top N & Bottom N values | https://www.youtube.com/watch?v=ViEuhqswf5s | Two parameters, two Top sets, one combined set as a filter |
| 4 | Tableau Tutorial: 3D Bar Plot | https://www.youtube.com/watch?v=uAdjPwhsews | Stacked cube shapes: join to a 0-100 path table, bin the path, shape = cube image |
| 5 | Tableau Tutorial: Give Life To Your Viz With Motion Chart | https://www.youtube.com/watch?v=xAUzbTZN4AM | Pages shelf, show history, trails |
| 6 | Tableau Free Download Full Version | https://www.youtube.com/watch?v=0Y-_lmPFN3g | Two legal free routes: Tableau Public, and the student/teacher one-year licence |
| 7 | Toggle Switch: select the measure in a dashboard | https://www.youtube.com/watch?v=LjLmfWU2H9s | Figma switch images, Boolean parameter, colour calc swapping Profit and Profit Ratio, Change Parameter action |
| 8 | Makeover Monday 2020 W42: small multiples for trend lines | https://www.youtube.com/watch?v=3rhISDZs3-w | INDEX-based grid of mini line charts, dual-axis label trick, Figma background, coolors.co palettes |
| 9 | Tableau Date Functions Introduction | https://www.youtube.com/watch?v=dvGCUogaL9Q | Every date function in one table |
| 10 | Makeover Monday 2020 W41: toggle buttons to change theme | https://www.youtube.com/watch?v=lQc2JOQWlAU | Day and night dashboards linked by image navigation buttons, percent suffix format |
| 11 | Tableau Interactive Resume | https://www.youtube.com/watch?v=EHzoxlKKn4Y | Figma template, bar plus diamond timeline, word cloud, waffle, show/hide buttons, URL images |
| 12 | Makeover Monday 2020 W36: buttons for filters and animation | https://www.youtube.com/watch?v=7qbNGGBDa1Y | Three stacked shape-sheet layers as image buttons, filter action, Format > Animation |
| 13 | Makeover Monday 2020 W35: toggle switch for sorting | https://www.youtube.com/watch?v=gdExfY1ygqw | Union padding for ball counts, boolean toggle driving sort-by-field, Change Parameter action |
| 14 | Figma Tutorial For Beginners | https://www.youtube.com/watch?v=juAavOJ4niY | Figma tools that serve Tableau backgrounds and shapes |

Not usable: 3 other captured transcripts are only music tags (Makeover Monday Week 25 background, Week 34 viz-in-tooltip short, Week 22 Mapbox short). See the failures section at the end.

---

## 1. Viz Exploration Ep. 1: parameter as filter and custom shapes

Source dashboard: "School-age digital connectivity" by Dennis Cowell (shared with permission), data: percent of school-age children with internet access, split into Total, Rural, Urban, Poorest quintile, Richest quintile, per country. Method he recommends: download workbooks from experts on Tableau Public, read the data and its source article first, then take the dashboard apart.

### A. Country grid (one tile per country)

The original typed X and Y coordinates inside each calc. His improvement: put the coordinates in the data.

1. Add two columns to the data source: `Row` and `Column`, one integer pair per country (its grid cell).
2. Put `Column` on Columns and `Row` on Rows. Convert both to Dimension and Discrete (blue pills, "also dimension").
3. Drag Country/Area to Detail.
4. To put the first country at the top, right-click the Row axis > Edit Axis > Reversed.

### B. Custom shapes from Figma

The idea: four-bar signal icons (like wifi bars) where the number of white bars equals the percent band. Tableau has no such shape, so draw them.

1. Download a bar-icon image from an icon site.
2. In Figma: new Frame, place the image, run the plugin Image Tracer (Plugins > Find more plugins if absent) to vectorise it so each bar is a separate object.
3. Edit Object. For a "lit" bar set fill white. For an "unlit" bar remove the fill and add a white stroke, thicker.
4. Export one image per state (five states for five bands).
5. Save into `Documents\My Tableau Repository\Shapes\<your folder>` (he made a folder named for the episode).
6. In Tableau: Marks > Shape > More Shapes > pick your folder. If it does not appear, click Reload Shapes.

### C. Percent band calc (drives the shape)

He shows the logic: more than 80 percent is band 1, 60 to 80 is band 2, and so on down. Exact thresholds below 60 were not read out (unclear in transcript). Pattern:

```
// [Percent Group] , thresholds beyond 60 are unclear in transcript
IF [Percent] >= 80 THEN 1
ELSEIF [Percent] >= 60 THEN 2
// ... remaining bands unclear in transcript
END
```

Drag `Percent Group` to Shape and assign the five custom shapes in order. Set the mark Size up and the mark background colour dark so white bars show.

### D. Gotcha: the data was pivoted

When he enlarged the marks, Algeria showed five shapes. Cause: the data is pivoted, so one row per country per group (Total, Rural, Urban, Poorest, Richest) in a column called `Population`. Adding Country alone shows all five.

How to pivot (if you need to rebuild it): in the data source, select all the group columns, right-click > Pivot, rename the pivoted field to `Population` (names) and the values to Percent.

### E. Parameter as filter

1. Create a String parameter `Selected Parameter` (list): Total, Rural, Urban, Richest quintile, Poorest quintile.
2. Calc used as the filter:

```
// name as given: "selected parameter" equals test
[Selected Parameter] = [Population]
```

(He writes it as an IF per value; the compact equality above is the same logic and is what he describes in words. The exact original text is unclear in transcript.)

3. Drag the calc to Filters and keep True.

Why a parameter and not a normal filter: with the pivoted field as a filter you lose the ability to show the five choices as clickable buttons. The parameter keeps them visible.

### F. Button row that sets the parameter

1. Split the Population label in two so long words fit: Split 1 gives "Poorest"/"Richest", Split 2 gives "quintile". (He used the Split command on the field; exact split delimiter unclear in transcript, a space is implied.)
2. New sheet: `Selected Parameter` on Color, `Population` on Columns, the splits on Label. Set Fit to Entire View, mark type Square, label alignment centre/middle. Colour so the selected one is blue and the rest gray, with the calc `[Selected Parameter] = [Population]` or the true/false equivalent on Color.
3. Dashboard > Actions > Add Action > Change Parameter. Source sheet: the button sheet. Target parameter: `Selected Parameter`. Field: `Population`. Run on Select.
4. Result: clicking a square sets the parameter, which re-filters the grid.

Gotcha: the colour highlight did not update until the dashboard action was added (his first test "was not working").

---

## 2. Radial bar chart

Data: the sample bike-riding style CSV (field names unreadable in the captions). The chart is built from a path-per-mark scaffold plus trigonometric coordinates. Transcript is heavily garbled; only the structure is reliable.

Setup steps:

1. Connect the CSV. Open the join/union area to bring in a helper table of path points ("path" field) as he describes with a "Table Name = file name" style calc (unclear in transcript). He edits an already-created calculation that tests the table name against the file name.
2. Create two parameters:
   - `Inner Radius`, float, current value 0.5.
   - `Outer Radius`, float, current value 1 (spoken as "12011", most likely 1; unclear in transcript).
3. Create calculated fields (bodies unclear in transcript):
   - `Radial Angle`: the angle for each point along the path (formula unclear).
   - `Normalized Length`: rescales each value into the radius band. Spoken description: inner radius plus (outer radius minus inner radius) times (value as a fraction of the maximum), with 0 returned when the value is 0. A scaling factor controls the length of the arc. Exact code unclear.
   - `X Coordinate` and `Y Coordinate`: radial angle and normalized length turned into cartesian, using cosine for X and sine for Y (stated as "sign of ... normalized length"; exact code unclear).
4. Mark type Line. Put the path field on Path. Remove Latitude/Longitude from Rows/Columns, put X Coordinate on Columns, Y Coordinate on Rows.
5. Compute using: for each coordinate pill, Compute Using the path field (and category), as he says "just click any coordinate, compute using, select the dimension".
6. Format: workspace and sheet background black. Double-click the axes > Edit Axis > Fixed range for a square scale. Resize via the radius parameters.

---

## 3. Top N and Bottom N with parameters

Data: Sample Superstore-like sample data, bar chart coloured by a dimension.

1. Create two integer parameters `Top N` and `Bottom N`. Range: min 1, max 10 (he says you can choose any range).
2. Create a Set on the dimension (for example Sub-Category/Customer, the transcript says "sample ID" which is garbled), on the Top tab choose "By field", Top, enter the `Top N` parameter, by the measure. Name it `Top N Set`.
3. Repeat for `Bottom N Set`, choosing Bottom and the `Bottom N` parameter.
4. Select both sets, right-click > Create Combined Set, name it `Top and Bottom`. He combines the top-N and bottom-N sets into one; which Combined Set option he picked is unclear in transcript. To show both groups at once you need the option that keeps members in either set (All Members in Both Sets).
5. Drag the combined set to Filters, keep In.
6. Show both parameter controls (right-click each parameter > Show Parameter Control, type: typing/slider-free input). He selects the typing option.

Gotcha: the set must reference the parameter by field, not a fixed number, or the chart will not react.

---

## 4. 3D bar plot from cube shapes

Inspired by a blog post on 3D-style bar charts in Tableau (title unclear in transcript). The trick: a bar is a stack of cube pictures, one cube per unit of a 0 to 100 path.

1. Copy a 0-to-100 list of numbers (path) from the blog, paste into a new sheet in the data connection.
2. Join your data (left join) to that path table. In the join, create a join calculation of the constant `1` on both sides, so every row repeats 101 times.
3. Create three calculated fields:

```
// Index
100 - INDEX()
```

(spoken as "100 minus index"; whether it is `INDEX()` or `[Index]` and the table calc scope are unclear in transcript. The Path field can serve the same role.)

```
// Max marks
MAX([Marks of Student])
```

```
// Rows
IF [Index] > [Max marks] THEN NULL ELSE [Index] END
```

(His description: for a mark of 50, index runs 100 down to 0; when index is greater than 50 the calc returns null, otherwise it returns the index. The comparison direction in the code is what he says; exact syntax unclear.)

4. Create bins on the path field, bin size 1, name `Path Bin`.
5. Columns: Student Name. Rows: `Rows` calc (as Sum or Max). Drag `Path Bin` to Detail. Drag Student to Shape. Compute Using the Path Bin on the table calcs.
6. Download cube images from the blog, copy to `My Tableau Repository\Shapes\<folder>`, Shape > Reload Shapes, assign the cube palette to each student.

---

## 5. Motion chart (Pages shelf)

1. Tiny dataset: Year, Country (India, China), Population.
2. Columns: Year (as the continuous/discrete date, whichever he double-clicked, "2018" suggests Year). Rows: Population. Colour by Country to separate the two.
3. Drag Year to the Pages shelf. Play control appears. Move it with the player.
4. Show History: in the Pages card tick Show History. Under Show choose All (to leave the full trail) or Marks. Adjust the Fade/colour settings: past points can show lighter, current point brighter. To see a line as it grows, change Show History to Both and pick Trails (dotted line trail); colour and opacity of the trail are edited in the Marks section (unclear details).

Gotcha: if past points look the same as current ones, change the field in the data or the history format to get the "brighter current" contrast.

---

## 6. Free Tableau

| Route | Steps |
|---|---|
| Tableau Public | public.tableau.com, enter email, download the app. Everything a learner needs, fewer features than paid. |
| Student/teacher licence | tableau.com > Products > Desktop > Try for free > Student or Teacher > Get a free one-year license. Enter country, name, school email (a personal email is accepted but school mail preferred), school name, how you will use it. Upload a college ID to verify. Email arrives with an activation key for Tableau Desktop and Tableau Prep for one year, plus a key for free e-learning (badges, courses). |

---

## 7. Toggle switch that swaps the measure on a map

Source: https://www.youtube.com/watch?v=LjLmfWU2H9s. Use: show two measures (Profit and Profit Ratio) in one sheet, switched by a clickable image.

1. Figma: draw a rounded rectangle (Radius box or drag the corner point), white fill, 5 px blue stroke. Add an ellipse for the knob and a text label ("Profit Ratio" with the knob on the left). Select all three, group, Export as PNG.
2. Save into `Documents\My Tableau Repository\Shapes\Toggle` (new folder). Ungroup, change the text to "Profit", drag the knob to the right, group, export again into the same folder.
3. Sheet 1: drag State onto the sheet (filled map).
4. Create parameter `Toggle`: data type Boolean, true displays "Profit Ratio", false displays "Profit" (as spoken; later he picks "Profit" for true in the Change Parameter step, so the labels look swapped: check which shape lands on which value in your build).
5. Calc `Toggle Button`:

```
IF [Toggle] = FALSE THEN TRUE ELSE FALSE END
```

(Spoken as "if toggle is equal to false then true; if the value is unknown then false". The exact tail is unclear in transcript.)

6. Calc `Color`:

```
IF [Toggle Button] = FALSE THEN SUM([Profit]) ELSE [Profit Ratio] END
```

Profit Ratio is already an aggregate, so it is not wrapped in SUM. Show the parameter, drag `Color` to Color. The map came out reversed, so he edited the colour legend to flip it (Edit Colors, set True).
7. Sheet 2 (the switch): drag `Toggle Button` into the view, Marks > Shape, drag `Toggle Button` to Shape. Shape palette > Reload Shapes > Toggle folder, assign the Profit Ratio image to False and the Profit image to True. Fit: Entire View.
8. Dashboard: drop both sheets, remove unneeded filters, shrink sheet 2 with the horizontal object. Dashboard > Actions > Add Action > Change Parameter: source sheet 2, Run on Select, target parameter `Toggle`, value field `Toggle Button`.

Gotcha: Reload Shapes before the shape assignment or the new folder does not show.

---

## 8. Makeover Monday 2020 W42: small multiples of trend lines

Source: https://www.youtube.com/watch?v=3rhISDZs3-w. Data: healthcare spending per capita, by location and year.

**Background (Figma):** 1200 x 1600 frame, rectangle FFA62B, white F7FFF6 lines with 5 px stroke and drop shadow, background 2E5266, font Sahitya. Export PNG.

**Build:**
1. Text file connection. Put Subject on Filters, keep Total only. Convert the time field to Date, then Discrete.
2. Grid position calcs (6 = number of columns; change it for more or fewer):

```
// X   (spoken "index minus 1, 6": the operator is unclear in transcript, a modulo by 6 fits a grid)
(INDEX() - 1) % 6
// Y
(INDEX() - 1) / 6
```

3. `X` to Columns, `Y` to Rows, both Discrete. Location to Detail. On both X and Y: Compute Using > Location. Fit: Entire View. Then time to Columns and Value to Rows: one small trend line per country.
4. Format: hide field labels for rows, remove headers, Format > Lines remove zero lines and grid lines, Format > Borders row and column divider (second line style) in F7FFF6, Format > Shading worksheet in 2E5266. Hide title. Line colour FFA62B.
5. Sort Location: Sort > Descending > By Field > Value (USA lands first).
6. Gotcha, country labels: Location on Label does not show properly. Fix: double-click the Rows pill again and type `AVG(10000)` (10000 was the axis max; spoken as "AVG 10,000"), make it Dual Axis, remove the headers, colour the new mark 2E5266 so it blends in, then drag Location to Label on that mark, remove the line-end label, bold and orange.
7. Tooltip: bring in a country-code file mapping code to full name, drag Country and Value to Tooltip (Marks card on All). Sentence pattern: "In [Year], [Country] spent [Value]". Rename the sheet `main worksheet`.
8. Dashboard: Image object > Fit Image, choose the background PNG, set 1200 x 1600, Layout padding 0 on dashboard and image. Float the sheet, hide header and title, Hide Indicator, remove the colour legend.

Colour tip: coolors.co > Start the generator > Space bar to reshuffle, lock the ones you like, drag to reorder, X to drop, Export for hex codes.

---

## 9. Date functions in 6 minutes

Source: https://www.youtube.com/watch?v=dvGCUogaL9Q. Sample Superstore fields (Order Date, Ship Date). He reads the functions aloud over the calc editor; only argument order and examples were stated.

| Function | What he says it does | Example as spoken |
|---|---|---|
| `DATEADD` | Adds an interval to a date. Args: date part, interval, date | month, 3, Order Date: 15 March becomes 15 June |
| `DATEDIFF` | Difference between two dates in the chosen part | day, Order Date, Ship Date |
| `DATENAME` | Date part as a string | month of Order Date as text |
| `DATEPARSE` | String to a Tableau date, given a format | "19 October 2020" string with a day-month-year format (format text unclear in transcript) |
| `DATEPART` | Date part as an integer | January returns 1 |
| `DATETRUNC` | Truncates to the part | month: every January date becomes 1 January; also quarter, year |
| `DAY`, `MONTH`, `QUARTER`, `WEEK`, `YEAR` | Integer, like DATEPART without naming the part | |
| `ISDATE` | True or false: is the string a date | |
| `ISOQUARTER`, `ISOWEEK`, `ISOWEEKDAY`, `ISOYEAR` | ISO 8601 week-based values | |
| `MAX`, `MIN` | Latest and earliest date in the field | |
| `NOW`, `TODAY` | NOW is date and time, TODAY is the date | |

Rule of thumb from him: DATENAME returns text, DATEPART returns a number.

---

## 10. Makeover Monday 2020 W41: toggle buttons to switch day and night theme

Source: https://www.youtube.com/watch?v=lQc2JOQWlAU.

1. Figma: design a white (day) and a black (night) background layout, plus one button image per direction. Export all.
2. Build two dashboards, "Day" and "Night", each with its own background image and the same bar chart (financial services sector values grouped).
3. Percent formatting gotcha: applying the Percent number format to values already given as percentages gives 0.087 style output. Fix: Format > Number > Custom, and put a `%` sign in the Suffix box.
4. Tooltip text improved with wording such as "[sector] had [x] of total respondents".
5. Drag a Navigation object onto the Day dashboard > Edit Button > Navigate to: Night dashboard, Button style: Image Button, Image: the Figma button. Optional border, background and tooltip. Apply.
6. On the Night dashboard, repeat with Navigate to: Day dashboard.

No parameter or calc is needed: the theme switch is two dashboards linked by image navigation buttons.

---

## 11. Interactive resume (one dashboard, show/hide everywhere)

Source: https://www.youtube.com/watch?v=EHzoxlKKn4Y. A 40-minute build; steps in order.

**Step 1, inspiration:** Tableau Public's interactive resume gallery. Take ideas, not copies.

**Step 2, Figma template (1000 x 1000 frame):**
- Left band: rectangle 218 x 1000, fill 505390. Profile photo: ellipse 200 x 200 at x 62, y 22, white stroke, image fill; a 220 x 220 white ellipse at x 52, y 12 behind it. Photos and logos get their background removed at remove.bg.
- White strips: rectangles, copy-paste (Figma snaps to equal spacing).
- Hexagons for skills: Polygon tool, 6 sides, rotate 90, 80 x 80, partly below the frame edge. Fill colour with lowered opacity for shades, or Fill > Image for a logo; stroke for the border.
- Font Rasa. Pointers: small rectangle plus a 30 x 30 ellipse. Project circles: a 100 x 100 rectangle with image fill, drag the corner point to the centre to make a circle. Line chart: white lines width 4 with small circles at the joints.
- Remove the logos and per-item content from the template (they go back in as separate images), export the frame as PNG `background layout`. Also export each icon, the plus and minus signs, and each info panel as its own PNG.

**Step 3, timeline workbook** (Excel, one row per stage with Start Date and End Date, 1 January of each year):

Bar sheet, named `bars`:

```
DATEDIFF('year', [Start Date], [End Date])
```

- Calc `bar` to Columns, Timeline to Color and ordered (college, engineering college, company 1, 2, 3). Education gray, companies 50539D, lighter for older ones. White mark border, worksheet shading none, header off, clean all lines.

Diamond sheet, named `rhombuses` (puts a mark at the midpoint of each bar):

```
DATEPART('year', [Start Date]) + DATEDIFF('year', [Start Date], [End Date]) / 2
```

- Calc to Columns, Timeline to Color, Marks > Shape > solid diamond. Edit Axis: untick Include Zero, remove header, Entire View, raise Size. Background none so the two sheets overlay.
- He says "plus 10 date difference ... divided by 2"; the 10 is garbled, the midpoint logic above is the described intent (exact original unclear in transcript).

**Step 4, word cloud:** Excel list of qualities, repeat a word more times to make it larger. Qualities to Text and to Size, Size as Count, mark type Text.

**Step 5, waffle chart for skills:** Excel with Skills, a Column field 1 to 10, and the Score repeated on each of the 10 rows per skill.
- Column to Columns (Discrete, Dimension), Skills to Rows, Marks > Shape (diamond). Calc named `color`:

```
SUM([Column]) <= SUM([Score])
```

- Drag to Color. True is the dashboard colour 505390, False gray. Entire View, enlarge shapes, hide row labels, clean formatting.

**Step 6, dashboard:**
1. Size 1000 x 1000, Tiled, drag Image > Fit Image > the background PNG. Layout: outer padding 0 on both dashboard and image.
2. Link icons: floating Image object, set Target URL to the LinkedIn or Tableau Public profile URL.
3. Email reveal: a floating Vertical container, Add Show/Hide Button, Edit Button: Item shown and Item hidden both set to the Gmail icon. Ctrl-drag an Image object into the container, Fit Image, choose the image of the email address. Click icon to reveal, click again to hide.
4. Skill hexagons: same pattern, one show/hide button per skill with an info image (certifications, projects) in the container.
5. Timeline: drop `bars` then `rhombuses`, remove legends and titles, give the diamond sheet enough height for annotations. Right-click a mark > Annotate > Point; Format annotation: shading none, border second line black, corner more rounded, line broken style black. Per stage, a Show/Hide button (Item shown: minus image, Item hidden: plus image) beside an info image.
6. Drop the waffle and word cloud sheets (title off, legends off, shading none, tweak mark size).
7. Project logos: images with a Target URL to the project link; Show/Hide buttons using Button Style Text Button ("minimize" when shown, "no more" when hidden, as spoken) reveal a details image.

Gotchas: every reveal panel is an image, so write the text in Figma and export it. Leave enough floating-object height for annotations or they clip.

---

## 12. Makeover Monday 2020 W36: image buttons as a filter, animation

Source: https://www.youtube.com/watch?v=7qbNGGBDa1Y. Data: cereals (sugar vs complex carbohydrates, by manufacturer).

**Scatter (`scatter plot`):**
1. Sugar and complex carbohydrate as the two axes (he swaps them once), Manufacturer to Filters (select all, show filter as Single Value), Name to Detail, mark type Circle.
2. Axis titles: "Sugar in grams" fixed -1 to 17; "Complex carbs in grams" fixed 0 to 24. Untick Logarithmic.
3. Set `good cereals` (condition): sugar below 4 and carbs above 15. Drag to Color, orange, lower opacity, add border, bigger circles.
4. Clean format (grid lines, zero lines, rulers, ticks off), Entire View.

**Three button layers (the key trick).** One sheet per layer, all with Manufacturer on Rows, Marks = Shape, Entire View, hide field labels for rows, no header, Manufacturer ctrl-dragged to Label (alignment middle/middle), shading none, row divider none:

| Layer | Shape | Extras |
|---|---|---|
| Background layer | white rectangle PNG (Figma) | |
| Main layer | orange rectangle PNG (Figma) | label white, Tableau Bold |
| Transparent layer | rectangle with no fill and no outline, made in PowerPoint (Insert > Shapes > Square, Shape Fill none, Outline none, Save as Picture) | nothing visible |

Save all PNGs in `My Tableau Repository\Shapes\<folder>`, Reload Shapes in the Shape palette. On every layer: Analysis > Table Layout > Show Empty Rows. He calls this very important or the layers do not align.

**Dashboard:**
1. 1100 x 650 (the Figma frame size). Floating image of the Figma background, padding 0 on image and dashboard.
2. Float the background layer, then the main layer on top, then the transparent layer on top of both (titles hidden, sizes matched).
3. Dashboard > Actions > Add Action > Filter. Source: transparent layer, Run on Select, "Clearing the selection will: Leave the filter", target sheet: main layer only.
4. Float the scatter, title off, so clicking a brand filters it. Add a floating image of a Figma rectangle behind the "good" zone (sugar under 4, carbs over 15) and an arrow image; check every orange point falls inside.

**Animation:** Format > Animation > On, duration 5.5 seconds (preset versus Custom: unclear in transcript). Points then animate as the filter changes.

---

## 13. Makeover Monday 2020 W35: toggle switch that re-sorts the view

Source: https://www.youtube.com/watch?v=gdExfY1ygqw. Data: cricketers, wickets and averages. Layout in Figma: image cutouts via remove.bg, font Quantico Bold Italic 20 with drop shadow, background 2255A4, two groups for the switch (white, blue) exported to a `Shapes` subfolder.

**Sheet `wickets` (cricket balls):**
1. Data: union the CSV with itself. Every value now appears twice.
2. Calc `pad`:

```
IF [Table Name] = "W35.csv" THEN 1 ELSE 12 END
```

(12 is the maximum number of dismissals.) Create > Bins on `pad`, size 1, name `padded`.
3. Calcs:

```
// index
13 - INDEX()
// many balls
IF [index] <= WINDOW_MAX(MAX([Dismissals])) THEN [index] END
```

(Bodies are as heard; "13 minus index" may mean the INDEX() function, as written. Unclear in transcript.)
4. `many balls` to Columns, Batsman to Rows, `padded` to Detail, Compute Using `padded`. Mark Circle, then Shape > More Shapes > Reload > cricket ball image. Entire View, resize. Dismissals on Label (12 pt, white, bold), Hide Indicator for nulls. Background 2255A4, clean all lines.

**Sheet `average`:** Batsman on Rows, `SUM([Average]) / 2` on Columns (halved because of the union). Bars white, background same blue, lines off, Batsman names white 12 bold, hide row labels. Ctrl-drag the pill to the right, Dual Axis, Synchronize Axis, one mark type Bar, header off, row and column dividers none. Resize the circles to get a rounded-bar look.

**Toggle:**
1. Parameter (spoken "short buy", likely a sort-by name): Boolean, current value True.
2. Calcs:

```
// toggle calc
IF [Sort By] THEN [Average] ELSE [Dismissals] END
// flip
IF [Sort By] THEN FALSE ELSE TRUE END
```

(The ELSE branch of `flip` was cut off in the transcript; the opposite value is implied. Which Average or Dismissals aggregate is used: unclear in transcript.)
3. New sheet: `flip` to Shape, Show Parameter, Shape palette: False = white switch, True = blue switch. Entire View.
4. Sort Batsman on both sheets: Sort > Descending > By Field > `toggle calc`.
5. Dashboard: background image, padding 0, float `wickets` and `average` (titles off), float the switch sheet (fill none, title off). Dashboard > Actions > Change Parameter: source the switch sheet, target the sort parameter, field `flip`. Click the switch and both charts re-sort.

---

## 14. Figma basics for Tableau backgrounds

Source: https://www.youtube.com/watch?v=juAavOJ4niY. Only the parts that serve dashboard work.

| Task | How |
|---|---|
| Start | figma.com > Drafts > plus. Frame tool (hash icon) > Desktop, then set width and height to your Tableau dashboard size (his example 900 x 1600). Zoom to fit |
| Panel | Rectangle: drag corner points or the radius box for rounded corners; Fill (hex, RGB, CSS, HSL, HSB, opacity, linear/radial/diamond/angular gradient, or image) |
| Border | Stroke: thickness, inside / center / outside, colour, opacity |
| Depth | Effects > Drop Shadow (the one he uses most; inner shadow, layer blur, background blur exist) |
| Custom shape | Edit Object > Bend line, drag points of a rectangle to bend it |
| Line, arrow, circle | Line and Arrow tools, size set in the right panel; Ellipse with equal width and height for a circle |
| Text | T tool: font, weight, size, alignment, line height, letter spacing, colour |
| Z order | Elements float; reorder in the left layer list to put one in front |
| Group | Shift-select, right-click > Group selection |
| Preview | Play button; copy the link to open on a phone |
| Export | Select the frame or any single element > Export panel > PNG (other formats allowed) |

Tableau use: export the frame as the dashboard background, set the Tableau dashboard to the same pixel size, drop an Image object, Fit Image, padding 0. Export individual pieces (buttons, switches, shapes) into `My Tableau Repository\Shapes`. Inspiration he lists: Tableau Public gallery and authors (get inspired, do not copy), Pinterest, Dribbble, Google, Twitter, Facebook.

---

## New vs already in the repo

Compared against andy-kriebel-recipes.md and technique-library.md (grep of toggle, datediff, navigation, animation, Figma, transparent, empty rows).

| New here | Already covered |
|---|---|
| Grid-of-countries tile map from Row/Column fields stored in the data (not typed in calcs), with the Row axis reversed | Andy: map layers as a canvas, which solves a different problem |
| Custom icon shapes made in Figma (Image Tracer) and loaded from the Shapes repository folder | Not in either file (Andy avoids custom shapes) |
| "Parameter as filter": String parameter + boolean calc on Filters, and clickable buttons that set it via a Change Parameter action | Andy: dynamic zone visibility, two-click range parameter. Same action type, different use |
| Pivot gotcha: duplicate shapes per country mean the data is pivoted | Andy: pivot wide columns (covered, as a prep tip) |
| Top N and Bottom N with two parameters and a combined set | Andy: sets for highlight/drill, not this |
| Radial bar with inner/outer radius parameters and X/Y coordinate calcs (structure only) | Andy: trig gauge/arc by map layers, a different build |
| 3D bar from stacked cube shapes on a 0-100 path join | not covered |
| Motion chart with Pages and Show History | not covered |
| Toggle switch: Boolean parameter + colour calc + Figma switch images + Change Parameter action (W35 version re-sorts via sort-by-field) | technique-library.md: parameter action and Figma multi-state shapes noted, not this build |
| Image navigation buttons to swap a Day and Night dashboard (W41) | not covered |
| INDEX-based small-multiples grid, plus the dual-axis `AVG(10000)` label fix | not covered |
| Three-layer image-button filter (background, main, transparent shape sheets, Show Empty Rows, filter action) | not covered |
| Interactive resume: show/hide buttons, URL-target images, diamond timeline, waffle and word cloud | Andy: container show/hide with a parameter (different method) |
| Date function cheat table | andy-kriebel-recipes.md: DATEDIFF in one use only |
| Format > Animation on (5.5 s) for filter-driven mark movement | technique-library.md: filter-state mark animation noted |
| Figma toolbox for dashboard backgrounds (frame sized to dashboard, export per element) | technique-library.md: Image Tracer and multi-state shapes only |

---
