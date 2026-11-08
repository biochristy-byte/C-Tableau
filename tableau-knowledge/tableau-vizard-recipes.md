# Tableau Vizard recipes, written as build steps

Distilled from the captions of 9 videos on the public YouTube channel [Tableau Vizard](https://www.youtube.com/@TableauVizard) (the presenter introduces himself as Sankalp). The channel is a beginner-friendly Tableau channel: short single-technique tutorials (radial bar, motion chart, 3D bar, top/bottom N, free licences) plus one longer "Viz Exploration" episode where he downloads an expert's Tableau Public dashboard and reverse-engineers it. He also posts Makeover Monday dashboard walkthroughs. Credit goes to him: watch the originals for the craft, this is only notes.

Source quality: captions are auto-generated. The Viz Exploration episode is clean. The three short tutorials (radial bar, top/bottom N, 3D bar) are badly garbled, with Tableau terms and numbers mangled. Where a step could not be resolved it is marked "(unclear in transcript)". No calculation below was invented.

## Videos covered

| # | Title | URL | What it teaches |
|---|---|---|---|
| 1 | Tableau Viz Exploration, Episode 1: Using Parameters As Filters & Creating Custom Shapes | https://www.youtube.com/watch?v=UOnW5olbugE | Grid-of-countries layout from x/y columns in the data, custom fill-level shapes made in Figma, a parameter plus parameter action that acts as a filter and a button row |
| 2 | Tableau Tutorial: Radial Bar Chart | https://www.youtube.com/watch?v=NsJaQuQ3iuQ | Radial bar built from a path table, radius parameters and X/Y coordinate calcs (calc bodies mostly unclear) |
| 3 | Tableau Tutorial: Top N & Bottom N values | https://www.youtube.com/watch?v=ViEuhqswf5s | Two parameters, two Top sets, one combined set as a filter |
| 4 | Tableau Tutorial: 3D Bar Plot | https://www.youtube.com/watch?v=uAdjPwhsews | Stacked cube shapes: join to a 0-100 path table, bin the path, shape = cube image |
| 5 | Tableau Tutorial: Give Life To Your Viz With Motion Chart | https://www.youtube.com/watch?v=xAUzbTZN4AM | Pages shelf, show history, trails |
| 6 | Tableau Free Download Full Version | https://www.youtube.com/watch?v=0Y-_lmPFN3g | Two legal free routes: Tableau Public, and the student/teacher one-year licence |

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

## New vs already in the repo

Compared against andy-kriebel-recipes.md and technique-library.md.

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

---
