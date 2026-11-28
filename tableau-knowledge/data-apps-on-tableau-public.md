# Put a Tableau data app on Tableau Public (Viz pages)

**For Claude, first:** a Tableau *data app* (made with Tableau MCP's `scaffold-data-app`)
does not read the Marks card. It calls `tableau.extensions.workbook.getAllDataSourcesAsync()`,
finds its data source by name, and runs `ds.queryAsync({ fields, filters })` and
`ds.readMetadataAsync()`. Since 11/27/2026 a C-Tableau viz page answers those calls too.
**Do not rewrite the app to read Marks card data, and do not bake rows into `app.js`.**
Upload the app as it is, give the page a CSV for each data source, and type the data
source's name.

## Two kinds of extension, one viz page

| | Viz extension (Marks card) | Data app (`scaffold-data-app`) |
|---|---|---|
| Reads data with | `worksheet.getSummaryDataReaderAsync()` | `workbook.getAllDataSourcesAsync()`, then `ds.queryAsync()` / `ds.readMetadataAsync()` |
| Data comes from | the fields on its encodings (shelves) | VizQL Data Service queries it writes itself |
| Manifest | `.trex` with your own `<url>` | `Packages/<id>/extensions/data-app.trex` with `<url>index.html</url>`, inside a `.twbx` |
| On a C-Tableau viz page | your CSV is the summary data | your CSV is a data source the app queries |

Tableau Public will not run either one in a published workbook. The route for both is
the same: a hosted page inside a dashboard Web Page object
([`extension-on-tableau-public.md`](extension-on-tableau-public.md), section 5).

## How the page answers a data app

The hosted page removes the app's `tableau.extensions.1.latest.min.js` and loads two
C-Tableau files in its place:

- `/_vz/standin.js` turns your CSV into a real `DataSource`. It has `name`, `id`,
  `fields`, `queryAsync`, `readMetadataAsync`, `getLogicalTablesAsync` and a raw-row
  reader. `workbook.getAllDataSourcesAsync()` lists every data source on the page.
  `worksheet.getDataSourcesAsync()` returns the first one.
- `/_vz/vds.js` runs each query in the browser over that CSV. It returns the VDS shape,
  `{ data: [rows] }`. Each row is keyed by `fieldAlias`, else `FUNC(Caption)` (for
  example `SUM(Sales)`), else the caption.
- Dates come back the way Tableau sends them. A raw date field is `YYYY-MM-DD`. A
  `TRUNC_YEAR` to `TRUNC_DAY` value is a datetime with no time zone,
  `YYYY-MM-DDT00:00:00`, as Tableau's `DATETRUNC` returns. `new Date()` reads that as
  local time, so a month stays in its month for a viewer west of UTC. A bare
  `YYYY-MM-DD` would be read as UTC midnight and slip back a month in the Americas.

The Marks card calls keep working on the same page, so one page can serve either kind.

Proof: Tableau's own sample, the *Tableau Superstore Data App*
(github.com/tableau/extensions-api, `Samples/DataApp`), runs unmodified on a viz page.
Its five tabs draw from live queries. Its KPIs match an independent pandas
calculation on the same 10,194 rows ($2,326,534 sales, $292,297 profit, 38,654 units).
Seventeen query shapes are also checked cell by cell against pandas.

## Steps

1. **Export each data source as a CSV.** The header row must hold the exact field
   captions the app queries (`Order Date`, `Sales`, `State/Province`). Dates read as
   `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM:SS`, `M/D/YYYY` or `M/D/YYYY h:mm AM`. From a published
   data source, Tableau MCP's `query-datasource` with every field gives you the rows. From
   Desktop, use View Data, Full Data, Download. Up to 5 MB and 200,000 rows per CSV.
2. **Upload the app.** At https://c-tableau.netlify.app/account/ go to **Upload an
   extension** and pick the app's `.twbx` under **Or pick a .zip of that folder, or a
   Tableau data app .twbx**. C-Tableau takes the one
   package inside (`Packages/<id>/content/` plus its `.trex`) and leaves the workbook,
   `Data/` and `Resources/` behind. With the CLI: `python ctab.py upload MyApp.twbx`.
   Every upload waits for approval.
3. **Make a viz page.** Open **Viz pages**, then **New viz page**, and pick the app. Upload the
   CSV, then type the **Data source name** exactly as the workbook's Data pane shows it
   (for example `Sample - Superstore`). Apps look their source up by that name. If the
   app uses more than one source, add one CSV per extra source under **More data
   sources**. Name each file like its source: `Returns.csv` becomes `Returns`. You can add up to 7.
4. **Preview and publish.** Publish turns on once all three preview sizes draw with no
   errors. A data app is a fixed-size dashboard, so sideways scroll at the narrow size is
   noted, not blocked: size the Web Page object to the app's full width. Then follow section 5 of
   [`extension-on-tableau-public.md`](extension-on-tableau-public.md): Web Page object,
   keep `?embed=1`, and File > Save to Tableau Public As (never Ctrl+S).

With Claude or a script:

```
python ctab.py upload "UK Crime Ridge Plot.twbx"
python ctab.py vizpage publish --name "UK Crime" --extension <extension id> \
    --csv crime.csv --datasource "UK Crime" --source Forces.csv
```

Over HTTP, `POST /api/v1/vizpages` takes `datasource` and `sources`
(`[{ name, columns, numeric, rows }]`).

## What `queryAsync` can do here

| Part of the query | Supported |
|---|---|
| Dimensions, `binSize` | yes |
| `SUM AVG MEDIAN COUNT COUNTD MIN MAX STDEV VAR AGG` | yes (STDEV and VAR are sample, as in Tableau) |
| `YEAR QUARTER MONTH WEEK DAY`, `TRUNC_YEAR` to `TRUNC_DAY` | yes (weeks start Sunday) |
| `sortDirection`, `sortPriority`, `maxDecimalPlaces`, `fieldAlias` | yes |
| Calculated fields (`calculation`) | a subset: arithmetic, comparisons, `AND OR NOT`, `IF/ELSEIF/ELSE`, `IIF`, `CASE`, `ZN`, `IFNULL`, `ISNULL`, `ROUND`, `ABS`, string functions, `DATEPART`, `DATETRUNC`, `DATEDIFF`, and `SUM(...)`-style aggregates such as `SUM([Profit])/SUM([Sales])` |
| Filters | `SET` (with `exclude`), `MATCH`, `QUANTITATIVE_NUMERICAL` (on a row value or an aggregate), `QUANTITATIVE_DATE`, `DATE` (relative, with `anchorDate`), `TOP`, `CONDITION`, `context: true` |
| Filter order | Tableau's: context, then Top N and conditions, then dimension filters, then measure filters |
| Table calculations, `COLLECT`, spatial | no; compute running totals and ranks in `app.js` from the rows |

An unsupported query is rejected with a message that names the problem, such as
`Unknown field "Sales Amt". This data has: ...`. In Tableau itself, a failed query
reaches the app as a generic `internal-error` (reported in tableau/extensions-api
issue #683), so a viz page is a handy place to debug a query.

## What a data app cannot do here

- **The data is a snapshot.** It is your CSV, not a live connection. To refresh it,
  replace the CSV on the viz page; the address stays the same.
- **The data is public.** Anyone with the page address can read the CSV. Do not upload
  anything you would not publish.
- **No outside calls.** The page allows network requests to its own origin only. An
  app that `fetch()`es another site (its `requestedOrigins`) will be blocked.
- Workbook parameters and filters, dialogs and writing back are not available. Settings
  a visitor changes last for that visit only.
- Size: 5 MB per CSV and 8 MB for all of a page's data together once stored. (The
  30 MB you may see in an error message is the page's budget across stored versions,
  not the data limit.)

## Publish from the command line (for your Claude)

`tools/ctab.py` in this repo uploads and publishes from your own account. It is
standard-library Python only. Create an API key at
https://c-tableau.netlify.app/account/#/keys and set it as `CTAB_API_KEY`.

```
python tools/ctab.py upload "My Data App.twbx" --visibility private
python tools/ctab.py status ID                # wait for the review
python tools/ctab.py vizpage publish --name "My App" --extension ID --csv data.csv --datasource "Exact DS_NAME the app looks for" --slug my-app --visibility private
```

The page is then at `https://c-tableau-hosted.netlify.app/v/my-app/?embed=1`.

## Uploading a Tableau Next app build

A Tableau Next data app is a compiled web app (a `dist/` or `build/` folder with an
`index.html`), not a Desktop `.twbx`, so it has no `.trex`. `ctab.py` makes one for
you. No git, no pull request: one file, your own API key.

1. Get the script (Python 3 only):
   - `curl -O https://raw.githubusercontent.com/biochristy-byte/C-Tableau/main/tools/ctab.py`
   - Windows PowerShell: `Invoke-WebRequest -OutFile ctab.py https://raw.githubusercontent.com/biochristy-byte/C-Tableau/main/tools/ctab.py`
2. Make a key at https://c-tableau.netlify.app/account/#/keys and set it:
   `set CTAB_API_KEY=ctab_...` (cmd), `$env:CTAB_API_KEY="ctab_..."` (PowerShell) or `export CTAB_API_KEY=ctab_...`.
3. Build with relative file paths (Vite: `base: './'`; Create React App: `"homepage": "."`),
   because the page is served from a sub-path and `/assets/...` would 404.
4. Upload the build folder, the project folder (it finds `dist/`, `build/` or `out/`) or a zip:

```
python ctab.py upload dist --app
python ctab.py upload my-app-build.zip --app
```

What it does: writes a dashboard-extension `.trex` into the upload (name from
`package.json` `displayName` or `name`, else the folder name; a fresh id; no author, the
server fills that from your account), uploads every file, and prints the extension id.
The upload then sits PENDING under your account. Chris approves it, then it goes live
and can be put on a viz page like any extension (`vizpage publish --extension ID ...`).
Check progress with `python ctab.py status ID`.

Limits and names: 4 MB per file, 300 files and 30 MB in all. File names may use only
letters, numbers and `. _ @ + -`, so hashed names like `index-3fA_b9Zq.js` are fine; a
space or any of `~ $ [ ] ( ) = # %` stops the upload and lists every such file so you can
rename it in the build config. Types outside html, js, mjs, css, json, svg, images,
fonts, csv, txt, map, md (for example `.wasm`) are left out and reported.

A Next app's data calls are handled by the next section.

## Tableau Next source to a viz page (`ctab_next.py`)

Tableau Next compiles data apps on Salesforce's servers, so an author holds only the
SOURCE: `src/app.spec.json` (semantic queries), a React page that calls
`useQuery("<query id>")` from `@analytics/data-app-sdk/react`, plain JS and CSS. That SDK is
not on npm, so `tools/ctab_next.py` builds the source against our own shim. The author's
Claude does every step on the author's machine with the author's key; the skill is
`skills/tableau-next-to-ctableau/SKILL.md`. Shapes and sources:
[`tableau-next-data-apps.md`](tableau-next-data-apps.md).

```
python tools/ctab_next.py build SRC_DIR --out OUT_DIR --csv data.csv [--entry src/pages/X.tsx]
python tools/ctab_next.py check OUT_DIR [--csv data.csv]
python tools/ctab.py upload OUT_DIR --app
python tools/ctab.py vizpage publish --name "My App" --extension ID --csv data.csv --datasource "<sourceName>" --slug my-app
```

- Needs Node 18+. esbuild (pinned 0.25.5) runs through `npx`; React 18.3.1 installs into `~/.ctab-next-cache`. SRC_DIR is never changed.
- `useQuery(id)` runs the spec's query on the viz page's own rows through the stand-in:
  fields without `aggregation` are group-by dimensions, with it (`sum avg count countd min max median`)
  measures; `in` / `notIn` / `equals` / `gte` / `lte` / `between` filters; `limit`. Rows come back keyed by `alias`.
- The semantic names (`Orders.Sub_Category7`) are matched to CSV headers (`Sub-Category`) by dropping the
  object prefix and trailing digits and ignoring case, spaces, dashes and underscores. The table is printed
  and written to `OUT_DIR/ctab-fields.json`; an unmatched or ambiguous field stops the build (RED).
- `check` refuses `.ts/.tsx`, absolute paths, remote script URLs and anything `ctab.py upload` would refuse, and
  reports how many files it examined (RED below 2).
- Proof: `python tools/test_ctab_next.py` (21 checks, Playwright, sums and averages compared with Python, and a
  sabotage where the shim ignores filters must go RED).
- Plain legacy JS that sets globals must do so on `window` (`window.LL = ...`): the bundler wraps every file in a
  function scope, so a bare top-level `var LL` is not global.

## When your data is too big for a viz page

A data app does not hold data. It asks the data source a new question
(`queryAsync`) every time the picture changes: on open, on each zoom or cell-size
change, on each area or date selection, on each hover or click. In Desktop, Hyper
answers. On a viz page, the stand-in answers in the visitor's browser from the page's
data, so that data has to fit in the page.

What we learned taking a 59M-row app (a UK police crime ridge plot) through this:

- **Tableau Public would not hold it either.** Tableau Public caps a workbook at 15M
  rows, and it only runs Exchange extensions listed for Public, so a custom data app
  cannot read a Public workbook's extract. The data has to live with the viz page.
- **Count what the app counts.** Read the app's queries before cutting data. An app
  that counts with `COUNT(1)` counts rows, so a pre-summed CSV (one row per group with
  a count column) gives wrong answers unless the app sums that column instead.
- **Check every field the app touches**, not just the measures: bins built from
  latitude/longitude, hover labels, filters on every query. A summary that drops one
  of them breaks a feature silently.
- **Cutting the extent changes the viz.** A few areas over a few months fits the 8 MB
  limit but can gut an app built for a whole country. Ask the author before trimming.
- **The answer is tile pages**, next section.

## Big data apps: tile pages

Use this when every question the app asks is a count by map cell (a ridge plot, a
heat grid, a hex or square bin map) and the data is millions of rows. The data is split
into small pre-counted files ("tiles"), one set per cell size the app offers, and the
page loads only the tiles for the area on screen. Nothing is sampled: every row is
counted. The full format is ctab-tiles v1 (see `tools/ctab_tiles.py`).

**1. Read the app's queries first.** List every `queryAsync` call: fields, filters,
and which cell sizes it uses (`ROUND([Latitude] / s)`). A tile package answers only
what it was built for:

- It carries latitude and longitude, the dimensions you name, and a row count. Every
  dimension a filter or a chart touches must be named in `--dims` (dates, crime type,
  who reported it). A missing one breaks a feature silently.
- Only `COUNT`, `COUNTD`, `MIN` and `MAX` work on a tile page. `SUM`, `AVG`, `MEDIAN`
  and the like are refused with a clear message. If the app sums a measure, tiles do
  not fit it as built.
- Bins must be written `ROUND([Latitude] / s)` with `s` equal to one of your `--levels`.
  Fields only the hover or detail panel uses (street, area name) go in `--detail`,
  which is available at point grain for the area on screen.

**2. Build the tiles.** `pip install duckdb`, then:

```
python -P tools/ctab_tiles.py build --input data.csv more.csv folder-of-csvs/    --datasource "Exact DS_NAME the app looks for" --lat Latitude --lon Longitude    --dims "Month:date,Crime type,Reported by" --detail "LSOA name,Location"    --levels 1,0.5,0.25,0.1,0.05,0.025,0.01 --tile-for-level "0.025=0.25,0.01=0.25"    --detail-tile 0.1 --month-floor Month --out tiles/
```

- `--input` takes CSV files, folders, globs, or parquet. All inputs must share the
  same column names.
- `--dims` is `Caption` or `Caption:date`. Dates are written `YYYY-MM-DD`; a
  `YYYY-MM` value becomes the 1st. `--month-floor Month` snaps every date in that field
  to the 1st of its month (use it when the app only ever groups by month or coarser).
- `--levels` are the app's cell sizes in degrees. Include every size the app can show.
  `--tile-for-level "0.025=0.25"` sets the tile size in degrees for that level (default 1);
  a smaller tile means more, smaller files.
- Use a fresh, empty `--out` folder outside your repo. Rebuilding into a previous
  tile folder replaces it.

Bins use JavaScript rounding (half up) computed as `x / s`, the same as the viz page,
so a cell on the page holds exactly the rows the app counts for it. Do not hand-roll
this with another tool or a spreadsheet: ties and negative values land in different
cells.

**3. Check it.**

```
python -P tools/ctab_tiles.py check tiles/
```

It re-reads every file and must print `GREEN`. It proves each level's counts add up to
the source row count, every row sits in the right tile, no file passes 4 MB, and prints
a size table (median, 95th percentile, largest tile, total MB). If it reports a tile
over 4 MB, rebuild with a smaller tile for that level or a smaller `--detail-tile`.
One very dense cell (central London in the full UK Crime data: 777,607 crimes in one
0.05-degree cell, a 2.1 MB tile) is why the limit is 4 MB, not 2 MB: shrinking the
detail tile for the whole country to fit one city pushes the file count past 20,000.
The default page limit is 300 MB and 20,000 files. If C-Tableau raised your account's
limit (ask in your Claude room or open a GitHub issue), pass it to the check:
`check tiles/ --package-limit-mb 1024`. Otherwise coarsen or drop the finest level.

**4. Know what you ship.** The tiles are the data. A tile page is link-only like a
private viz page, but anyone with the link can download the tiles, so build only from
data you may publish. Do not put tile folders or source data in a git repo.

Publishing a tile package to a viz page (`vizpage publish --tiles DIR`) is described in
the publish steps once the platform side is live; build and check first, since a
package that does not check GREEN will not be accepted.

## Questions people ask

**"Your extensions read the Marks card, so a data app would find no data on a viz
page."** That was true until 11/27/2026. The page now exposes your CSV as a data source
with `queryAsync`, so `getAllDataSourcesAsync()` finds it.

**"Did you convert the app to Marks card data, or bake the data into the page?"**
Neither. The app runs unchanged. The data lives in the viz page's CSV, and the stand-in
answers the app's queries from it.

**"My app picks its source by name and shows 'no data source found' or the wrong
data."** The **Data source name** on the viz page must match the name the app looks
for, character for character. With no name, the source takes the viz page's title.

**"My app uses `BOUND_DATASOURCE_ID`."** That id comes from Desktop scaffolding. On a
viz page the id is `ctab.` plus the name in lowercase with dashes
(`Sample - Superstore` becomes `ctab.sample-superstore`). Leave `BOUND_DATASOURCE_ID`
empty to take the first source, or match by name instead.
