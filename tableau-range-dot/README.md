# Range Dot

A custom Tableau **Viz Extension** that shows where one member sits against a group, column by column.

Each column (a week, a grade, a store) draws four things:

- a **light bar** for the group's range, lowest to highest
- a **darker band** for the middle half, 25th to 75th percentile
- a **line** for the group's median
- a **dot** on top for the highlighted member, colored by bands whose boundaries you set

It started as a "person vs team" design: one person's weekly load against a nine-person pool. Native Tableau could not build it cleanly, because the range, the band, the median tick and the dot each want their own mark type on one axis. Here the extension works the statistics out from ordinary rows, so the worksheet only needs the person, the week and the measure.

## Run it

First get Tableau's Extensions API library, once: see [`lib/README.md`](lib/README.md). Then:

```powershell
cd tableau-range-dot
node serve.js
```

Or double-click `Start-RangeDot.bat` and leave the window open.

Serves `http://localhost:8771/index.html`. No `npm install` is needed. **The server must be running before you load the .trex**, or Tableau shows "localhost refused to connect".

In a Tableau worksheet (2024.2 or later): Marks card, mark type dropdown, **Viz Extensions**, **Add Extension**, **Access Local Viz Extensions**, pick `RangeDot.trex`. Copy it to `My Tableau Repository\Extensions\` if you want the file picker to open on it.

## Shelves

Tableau allows four custom shelves.

| Shelf | Required | What it does |
| --- | --- | --- |
| Category | yes | a dimension; one column per member. A date should be an **exact date**, discrete. |
| Value | yes | the measure being compared |
| Member | no | the dimension whose members make up the range, such as a person |
| Color | no | a measure is cut into bands at boundaries you set; a dimension colors the dot by its names |

One row means one member in one category. The extension computes the range, the middle band and the median from those rows, using the same percentile method as Tableau's PERCENTILE.

The rest ride on the built-in **Detail** shelf (Tooltip works too) and are matched by field name. Override any match in the Fields tab.

| Detail field | Matched on | Used for |
| --- | --- | --- |
| Highlight | highlight, selected, focus, flag | a true or false field: who gets the dot |
| Member name | name, label | a readable name when Member holds an id |
| Category note | note, capacity, cap, available, comment | a small second line under a column, such as "24 h cap" |
| Sort order | order, rank, sort, sequence | column order |
| Range low, Band low, Center, Band high, Range high | min, p25, median, p75, max | a ready-made range, read only while Member is empty |

### Three shapes of data

1. **Members** (the usual one). Member is filled. The range is computed here.
2. **Summary.** Member is empty and low and high fields sit on Detail, one row per category. Use this when level of detail calculations or a benchmark table already hold the range. Value is the dot.
3. **Dots only.** Neither. One dot per category with nothing behind it.

### Who gets the dot

A true or false field on Detail, for example `[Resource] = [Selected Resource]` against a parameter. Or pick a member in the panel's Dot tab, which needs no field. With neither, the range draws alone and the panel says why. A field that is true for everyone highlights no one.

### Short weeks and other notes

Most weeks share a baseline, such as 40 hours of capacity. Only the exceptions are called out under the week label, as in "24 h cap" under 11/22 and "32 h cap" under 12/20.

Put the capacity measure on Detail. It is matched by name (capacity, cap, available, note) and can be changed on the Fields tab. In person-by-week data the note comes from the highlighted member's row, because capacity is per person.

The controls are on the Layout tab, under **Note under a column**:

| Control | What it does |
| --- | --- |
| Show | only the exceptions (default), under every column, or hidden |
| Baseline | automatic, the most common value in the data, or a number you type. The panel shows the detected baseline and how many columns are exceptions. |
| Exceptions | any difference from the baseline, only below it, or only above it |
| Tolerance | how far from the baseline still counts as the same, as a share of it. At 1%, 39.9 against 40 is not called out. |
| Note text | words around `{note}`, as in `{note} h cap`. `{baseline}` and `{diff}` work too, as in `{diff} h vs {baseline}`. |
| Emphasis | an accent color for the exceptions |
| Key line | an optional line in the key that states the baseline, as in `Usual capacity: {baseline} h` |

The tooltip shows the note for every column. The title and subtitle accept `{baseline}` and `{exceptions}`.

A dimension on Detail that is not an attribute of the member splits a value into several rows. The chart adds them up and says so in a notice. That is right for sums and counts and wrong for averages and ratios.

## Dot color

Set on the Dot tab. Automatic picks the first that applies:

1. **Names.** A dimension on Color. Each name gets a color you can change. A name that is a hex code is used as the color.
2. **Boundaries.** A list of cut points you define, each band with its own color and label. The number being cut is the measure on Color. With Color empty, it is the dot's own value. A setting decides which band a value exactly on a boundary belongs to.
3. **Position.** With no boundaries set: below, in or above the middle band.

Boundaries are typed in the data's own units, so 0.85 for 85% when the data holds fractions. **Suggest from the data** fills in the quartiles as a starting set.

**Set up as percent of a limit** on the Layout tab does the common case in one click: percent format, a line at 100%, and four bands at 85%, 100% and 120%.

## Settings panel

Opened from the gear, top right. **Drag it by its title bar** anywhere on the screen; the position is remembered per machine, and **Dock** (or a double-click on the title bar) sends it back to the corner. Every change previews live; **Apply** saves it to the workbook and **Cancel** puts things back. **Reset to defaults** edits the draft only.

Tabs: Layout (quick setup, columns, category labels, notes, value axis), Range (what the bar, band and line show, whether the dot counts toward the range, a small dot for every member), Dot (who is highlighted, size, value label, color), Values (number format and tooltip lines), Line (one reference line at a value you set), Title (title, subtitle and the key), Colors, Fonts, Fields (Detail overrides, Copy settings and Paste settings to move a look between workbooks, and Diagnostics).

The title and subtitle can quote the chart, so a headline stays true when the data changes: `{highlight}`, `{group}`, `{n}`, `{above}`, `{below}`, `{over}`, `{under}`, `{ref}`, `{baseline}`, `{exceptions}`, `{category}`, `{value}`, `{member}`. Example: `{highlight} sits above the team's middle in {above} of {n} weeks and is over capacity in {over}.`

## Browser preview (no Tableau)

`http://localhost:8771/index.html?preview=1` loads `mock-tableau.js` with the sample data (fake people, one row per person per week, built by `sample-data/make_sample.py`). The default scenario is seeded to match the original mockup.

Scenarios: `&scenario=plain` (untouched defaults), `colormeasure`, `colorname`, `summary`, `minimal`, `nohighlight`, `uid`, `salary`, `formatted`, `dateobj`, `split`, `small`, `one`, `long`, `many`, plus `&slow=3000`, `&rename=3000` and `&fresh=1` to ignore saved settings.

## Files

`RangeDot.trex` (manifest), `index.html` (page, styles, panel markup), `viz.js` (all logic), `mock-tableau.js` (preview only), `serve.js` (the server), `Start-RangeDot.bat` (double-click launcher), `sample-data/`, `lib/` (Tableau's Extensions API library goes here, see `lib/README.md`), `assets/fonts/` (Poppins, bundled so the chart works offline; SIL Open Font License, text beside the fonts).

## Reload rule

Tableau Desktop has no Reload button for a viz extension. After a code edit (html, js, css), load the page again one of these ways, least disruptive first:

1. **Close the workbook and open it again.** It loads the current code.
2. **Analysis** menu, **Manage Workbook Extensions**. Pick the extension, click **Replace**, then **Confirm**, then **Access Local Viz Extensions** and choose `RangeDot.trex` again. Nothing has to be deleted first, and the chart redraws with its fields and settings in place. The file picker may open in another folder.
3. Same dialog, **Delete**, then add the extension again. The last resort: expect to set the worksheet up again.

Manifest edits (name, version, url, shelves): the same **Replace** picks them up, as long as you choose the edited `.trex`. If you pick from `My Tableau Repository\Extensions`, copy the edited file there first.

## Limits

- Viz extensions export blank to PDF and PowerPoint. Present live, or take screenshots ahead of time.
- Tableau Public viewers cannot see a self-hosted extension.
- A workbook stores the extension's address, not its code. Anyone opening it needs the server running at `localhost:8771`.
- A group of two or three members makes a thin range. The tooltip shows how many members each column has.
- Dense charts (around 60 columns) thin out the category labels and drop the notes. The tooltip still carries both.

## Status

Version 1.1.0, built 2026-11-24. **Confirmed inside Tableau Desktop 2026.3** on a workbook of demo data: one person's weekly load against the five people on their team, 10 weeks, 50 marks.

What Tableau confirmed:

- The manifest loads with four shelves, and the `color` icon token shows on the Color shelf.
- The range, middle half, median and dot draw from ordinary rows.
- A true or false calculated field on Detail picks the dot, and the chart follows a parameter on a dashboard.
- An exact date on Category arrives in order, with Tableau's own text for the label (`11/08`).
- The note baseline is detected from the data ("Detected baseline: 40").
- Renaming the sheet did not blank the chart. No Retry was needed.
- Analysis, Manage Workbook Extensions, Replace loaded new code and kept the fields and settings.
- Paste settings, live preview, Apply and the tooltip all work in Tableau's built-in browser.

Added in 1.1.0, also confirmed in Tableau Desktop 2026.3, on a worksheet and on a dashboard: the settings panel can be pinned to the right side.

- **Pin to side** (title bar) turns the panel into a full-height strip on the right. The chart narrows beside it, so nothing is covered. **Float** returns it to the draggable panel, and **Dock** still sends a floating panel to the corner.
- Pinned, the nine tabs show as an accordion. Every header is visible, a click opens or closes a section, and several can be open at once.
- Pinned or floating, the open sections and the dragged position are remembered per machine, not saved in the workbook.
- A view under 760 px wide or 420 px tall cannot pin. The panel floats there and the button says why. A short dashboard zone is the usual case.

**A warning about Replace.** Reloading through Analysis, Manage Workbook Extensions, Replace worked cleanly twice from the worksheet's own tab. Run a third time from a dashboard tab, Tableau warned that the worksheet "does not have a valid data source," and after OK the sheet had lost its fields and showed the drop-fields instructions. One click on Undo brought back every field, filter and setting, and the chart then ran the new code. Run Replace from the worksheet's tab, and use Undo at once if the fields vanish. Whether the dashboard tab was the cause is not confirmed.

Changed in 1.0.4: the tooltip appears only while the pointer is over a column's bar or its dot. Empty space above and below the bar, and the labels under it, no longer trigger it. The Values tab has the choice (**Appears**: over the bar or the dot, or anywhere in the column).

Fixed in 1.0.3, found in Tableau: a percent measure arrived as 0.81 with the text "81%". The dots kept that text, but the axis and the range values, which are worked out here, showed raw fractions. They now follow Tableau's percent text and its decimals.

### An example sheet

| Where | Field |
| --- | --- |
| Filters | the selected person's team only, and the weeks in view |
| Category | `Week Start`, exact date, discrete |
| Value | `Load %`, scheduled hours over capacity hours |
| Member | `Resource` |
| Detail | `Is Selected Person`, `Available Capacity` |

`Is Selected Person` is `[Resource] = [Selected Resource]`, against a parameter. The team filter keeps the selected person's own team:

```
[Team] = { FIXED : MAX(IF [Resource] = [Selected Resource] THEN [Team] END) }
```

`Available Capacity` drives the note under a week. It is capacity less time off, so a week with a holiday reads "24 h cap" and an ordinary week shows nothing. If capacity in your data never changes from week to week, the note has nothing to flag.

Two things to know when building a sheet:

- **Exact Date turns the pill continuous, and a continuous pill falls off the Category shelf to Detail.** Set it to Exact Date, then Discrete, then drag it back onto Category.
- On a dashboard that Desktop shrinks to fit the window, the extension gets the on-screen size, not the dashboard's design size. Text stays full size, so a short strip is tighter in Desktop than it will be at full size.

Still not checked: Tableau Cloud or Server, a measure on the Color shelf inside Tableau, and the Diagnostics text copied out of Tableau.

## Not built on ctab-panel

Range Dot has its own settings panel, written before this repo's shared `shared/ctab-panel/`. It does not vendor that library. The ideas behind its panel are written up in [`settings-panel-guide/`](../settings-panel-guide/README.md).

## License

MIT, like the rest of this repo. Poppins is under the SIL Open Font License; the text is in `assets/fonts/LICENSE-Poppins-OFL.txt`.
