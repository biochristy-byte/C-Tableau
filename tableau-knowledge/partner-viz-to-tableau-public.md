# From your app to Tableau Public: what we learned on 11/27 and 11/28/2026

On one night, two partners each took their own app from their machine to Tableau Public. Each partner's Claude did every step from that partner's own account.

- **Andy Holt:** a UK Crime ridge plot over 60,914,869 rows, a data app on a **tile page**. Live at https://public.tableau.com/views/UKCrimeMap/UKCrimedata.
- **Celia Fryar:** a Tableau Next app (Loss Leader Basket Analysis, navy), converted with `ctab_next.py`. A public C-Tableau viz page.

This doc is the playbook for the next one, with the traps we hit, in order. Detail lives in the docs it links to.

## The path, start to finish

| Step | Who | How | Doc |
|---|---|---|---|
| 1. Get the tools | Partner's Claude | `git clone https://github.com/biochristy-byte/C-Tableau` (or `git pull`) | this repo |
| 2. API key | Partner | The key lives in a secrets file on their machine (Celia's: `%USERPROFILE%\.secrets\ctab.env`). `python tools/ctab.py me` proves it works. Never paste a key into chat or a room | [`../GETTING-STARTED.md`](../GETTING-STARTED.md) |
| 3. Data | Partner's Claude | A CSV for each data source the app reads. For more than a viz page holds, build **tiles** | [`data-apps-on-tableau-public.md`](data-apps-on-tableau-public.md) |
| 4. Build | Partner's Claude | Data app: the `.twbx`. Tableau Next app: `python tools/ctab_next.py build <app folder> --out <new folder> --csv data.csv`, repeated until GREEN with every field matched | [`tableau-next-data-apps.md`](tableau-next-data-apps.md) |
| 5. Upload | Partner's Claude | `python tools/ctab.py upload <folder> --app`. A later change uses `ctab.py update <id> <folder>`, so the id and the viz page stay the same | [`data-apps-on-tableau-public.md`](data-apps-on-tableau-public.md) |
| 6. Approve | Chris | Admin. Each upload and each new version waits for this | |
| 7. Viz page | Partner's Claude | `ctab.py vizpage publish ... --visibility private`. Open it without `?embed=1` and check the charts and the totals against the source | |
| 8. Go public | Partner says yes | `ctab.py vizpage visibility <slug> public`. A partner who wants every page public can add the line `CTAB_VIZPAGE_VISIBILITY=public` to their `ctab.env`; `--visibility private` still overrides it for a single page | |
| 9. Tableau Public | Partner, in their own Tableau Public sign-in | Connect [`../templates/placeholder.csv`](../templates/placeholder.csv), add a fixed-size dashboard with a Web Page object set to `<page URL>?embed=1`, set Outer Padding to 0 and the shading to the page's background hex, then use File > Save to Tableau Public As. **Never press Ctrl+S** | [`extension-on-tableau-public.md`](extension-on-tableau-public.md) sections 5 and 6, [`never-ctrl-s-on-public.md`](never-ctrl-s-on-public.md) |
| 10. Check | Both Claudes | Open `https://public.tableau.com/views/<Workbook>/<Dashboard>?:showVizHome=no&:embed=y` in a clean browser and confirm the viz draws and the headline number matches | |

## Ground rules that made it work

- **The partner's Claude does every step on the partner's machine and account.** Our side ships tools, docs and skills. We never upload a partner's app or data under our account. The point is a process anyone can repeat.
- **Talk in a shared room.** Each partner's Claude and ours posted in one room. Each post carried its exact command, its full output and what to check next. "Post the full output, then hold until I've read it" stopped an empty build from being uploaded.
- **Acknowledge first, then act.** The other Claude should know its message landed.
- **Measure before you promise.** Speed claims, row counts and totals were quoted only after they were measured on the live page.

## Traps we hit, and the fixes now in the tools

| Trap | What happened | Fixed in |
|---|---|---|
| Uploading a big tile package failed with `DB_ERROR` | The server's file-list check grew with the square of the file count: 12,897 files ran past the 8 s statement timeout | Platform migration 030, set-based. 20,000 files now validate in 0.13 s |
| A Tableau Next spec gave `queries []` | Next spec v1 keeps its queries under `data.queries`, and the build still said GREEN over 0 queries | `ctab_next.py` reads both shapes, and build and check go RED on 0 queries ([`tableau-next-data-apps.md`](tableau-next-data-apps.md)) |
| An upload was listed as "app2" | The generated manifest took its name from the folder | `ctab.py` names a Next build from the spec's `label` |
| Every version showed v1.0.0 | The generated manifest always wrote 1.0.0 | `ctab.py update` writes the next patch version |
| A zipped `.skill` was refused on the skills page | A `.skill` is already a zip, and the page found an archive where it expected `SKILL.md` | The upload page unwraps one level ([`sharing-skills-on-c-tableau.md`](sharing-skills-on-c-tableau.md)) |
| A tile page's map took 20 to 25 s to draw | Each level's tiles carried every month, crime type and force, 4.8M rows, to draw a count per cell | Rollup tiles, see below |
| The Back button covered the app's title | The space it reserves only worked for one app layout | The viz page shell |
| Tableau Public would not save the workbook | Tableau Public needs a data source | [`../templates/placeholder.csv`](../templates/placeholder.csv) |

## Tile pages: what makes them slow, and how to tell

Andy's numbers, measured on the live page before the rollup fix:

- **Bandwidth was the limit, not request count.** 181 tiles (20.7 MB) took 8.4 s at 6 fetches in parallel. Fetching 12 or 24 at once was slower.
- **The bytes went to dimensions the view did not use.** At the 0.05 cell, level L4 held 4,837,123 rows (cell x month x crime type x force). The same tiles summed per cell and force come to 37,380 rows and 0.21 MB.
- **The app's own timer can make a slow load look broken.** Andy's app showed "Still waiting for Tableau..." at 45 s. A slower connection crossed that line while the data was still arriving.
- **Check the counts first.** Query `COUNT(1)` through the page's stand-in, split the way the app scopes it. Andy's page matched exactly: 1,053,267 rows with no coordinates, 380,583 British Transport Police and 59,481,019 in scope, for 60,914,869 in all.

## The fix: rollup tiles (ctab_tiles 1.1)

A tile only needs the dims the query names. So the builder now also writes, for every level, smaller tile sets that drop dims and add up the counts. The page picks the smallest set that holds every dim the query uses. Rollups are on by default. The answers are exact, not sampled.

Andy's map, with the bytes for its first open taken from his real tiles:

| Cell | Before | After | Rows read, before to after |
|---|---|---|---|
| 1 | 1.27 MB | 6.5 KB | 251,890 to 1,158 |
| 0.25 | 4.41 MB | 33.6 KB | 950,682 to 7,589 |
| 0.05 (default) | 20.7 MB | 164 KB | 4,837,123 to 37,380 |
| 0.01 | refused (72 MB, over the 40 MB cap) | 760 KB | refused to 166,364 |

What we learned building it:

- **Use a coarser grid for a rollup than for its level.** Andy already had 12,896 of the 20,000 files a package may hold. Same-grid rollups would have added about 26,000. A rollup tile is the level tile doubled up to 4 times, holding 50,000 rows or fewer (`--rollup-tile-rows`). His rebuilt package came to 18,273 files and 440.5 MB.
- **Skip a rollup that saves little.** On his data, Month + Crime type kept 92 to 98% of its level's rows, so the build skips any set over 75% (`--rollup-max-share`).
- **Keep old pages working.** Rollups go in spare `L7` to `L99` folders. The older page engine ignores them, so a 1.1 package is safe to publish before the new engine is live.
- **One filter change sends five queries.** Each picks its own rollup: the map 164 KB, the total 6.5 KB, the timeline 196 KB, the crime-type bars 35 KB and the force bars 6.5 KB. Before, every one of them read whole tiles.
- **The re-download loop was the cache.** The cache dropped tiles while they were still downloading, and its row count kept tiles it had already dropped. The count only grew, so every later load emptied the cache. Now a tile that is loading, in use, or used by one of the last 12 queries is never dropped, and the cap is 3,000,000 rows (about 207 bytes of memory per decoded row).
- **Decode off the main thread.** All tile work runs in a Web Worker, with a fallback to the main thread. On his L4 tiles, the longest freeze of the page went from 3,251 ms to 35 ms.
- **Prove that it is exact.** Every query was answered from raw rows, from rollups, from full tiles and from an old 1.0 package, and all four agreed: 2,082 checks. Another 86 checks compared against his full levels in DuckDB. Each of 15 deliberate breakages turned the gate red.

### Measured on his live page (11/28/2026, new engine)

Headless Chromium, 1400 x 900, one cold session, home broadband. "Settled" is when the map, the totals and the side panel have all finished and the network has gone quiet.

| Step | Before | After | Bytes after |
|---|---|---|---|
| First open, map drawn | about 37 s (20 to 25 s on a fast line) | 5.6 s | 6.6 MB for the whole first view |
| Cell 0.25 | | under 1 s | 35 KB |
| Cell 0.1 | | 6 s | 90 KB |
| Cell 0.05 (default) | | under 1 s | 53 KB |
| Cell 0.025 | | under 1 s | 340 KB |
| Cell 0.01 | refused (over the 40 MB cap) | under 1 s | 735 KB |
| Cell 0.5 | | 74 s | 41 MB, 523 requests |
| Drag a box on the map | | 93 s | 18.6 MB, 919 requests |

Every total stayed at 59,481,019, and no request failed.

**What is still slow, and why.** The map query is cheap at every cell size: the planner serves it from rollups at 170 to 580 KB. The two slow rows are something else:
- After a cell change, the app's side panel asks for the top 5 `Location` values and the `LSOA name` inside the selected cell. Those are detail fields. They exist only in the raw-row `D` tiles, so a 0.5 cell over London reads 29 to 41 MB of raw rows. Cell 1 settled in under 1 s on 2 MB in the same run. Why its side panel read so little is not checked yet.
- A dragged box filters on raw latitude and longitude, so it also reads `D` tiles.

## The second fix: detail rollups and box edges (ctab_tiles 1.2)

Both slow rows above are fixed in the builder and the page engine. Nothing in the app changes: same queries, same look, same answers.

- **Detail rollups.** For each level, the builder also writes counts per cell, one detail field (`LSOA name` or `Location`) and a subset of the dims. "Top places in this cell" now reads one small set instead of every raw row under the cell.
- **Box edges.** A dragged box snaps to cell boundaries, so a cell is inside the box exactly when its rows are. The one exception is a row sitting on a boundary, where float division can round it into the neighbouring cell (`51.505 / 0.01` is `5150.4999...`). For those rows the builder writes edge tiles: `+n` at the raw point and `-n` at the cell centre. The page then answers the box from the level plus those few rows. Andy has 259 edge rows at cell 1 and 10,008 at cell 0.01. Only COUNT queries take this path; anything else still reads raw rows.
- **Budget order.** Rollups go first, then edges, then detail rollups smallest-first. A set larger than 5% of the detail rows is skipped (`--drollup-max-share 0.05`). A package may hold at most 20,000 files and 100 folders, and Andy's raw tiles alone use 9,187 of those files.
- **The scope filter decides which detail rollups help.** Every query Andy's panel sends carries `[Reported by] <> 'British Transport Police'`. So only detail rollups that keep `Reported by` can answer it. Check what filters an app always sends before choosing `--detail` fields.
- **Memory.** His first 1.2 build peaked at 9.15 GB of RAM. `--memory-limit` (default `4GB`) caps DuckDB and spills to disk instead.

Andy's rebuild, from the folder that holds his data:

```
git pull
python -P tools/ctab_tiles.py build --input andy_rows.parquet --datasource "UK Crime" --lat Latitude --lon Longitude --dims "Month:date,Crime type,Reported by" --detail "LSOA name,Location" --levels 1,0.5,0.25,0.1,0.05,0.025,0.01 --tile 1 --tile-for-level "0.1=0.5,0.05=0.5,0.025=0.25,0.01=0.1" --detail-tile 0.05 --memory-limit 4GB --out tiles12/
python -P tools/ctab_tiles.py check tiles12/ --package-limit-mb 1024
```

It wrote 19,927 files, 501 MB, in 22 minutes, and `check` passed 294 of 294.

### Measured locally (11/28/2026, 1.2 package and engine)

Chromium, his live page HTML, the package served from disk, throttled to 40 Mbps, cold cache.

| Step | 1.1 package, live engine | 1.2 package, new engine |
|---|---|---|
| First open | 5.4 to 5.7 s (6.3 MB) | 2.3 to 2.4 s (988 KB) |
| Cell 1 | 19.7 s | 0.34 s |
| Cell 0.5 | 9.1 s | 0.23 s |
| Cell 0.1 | 3.1 s | 0.23 s |
| Cell 0.01 | | 0.65 s |
| Drag a box | 29.1 s | 0.83 s |
| Zoom out, hover, click | | 0.10 to 0.13 s |

**Exact on his real rows.** The new engine on the 1.2 package and the live engine on the raw `D` tiles answered 1,680 of the app's own query shapes at all 7 cell sizes: with no filter, one force, one crime type and one year. 336 of them were boxes whose edge runs through a real boundary row. All 1,680 matched. With the edge tiles removed, 6 of those 336 boxes went wrong, so the check can fail. 23 were TOP 1 ties, where the two engines named different members with the same count. Total 59,481,019 and box total 4,477,947 both matched.

## Tableau Next apps

- The spec can keep its queries at the top level or under `data.queries`. Both work now.
- The build reports `field map (N of M matched against M CSV columns)`. Wait for every field to match before uploading.
- Footer text written for Next ("Live from the ... semantic model") may not fit a viz page. Reword it in the app source, rebuild, and `update` the same id.
