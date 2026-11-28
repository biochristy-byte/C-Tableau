---
name: tableau-next-to-ctableau
description: Turn a Tableau Next data app's SOURCE folder (src/app.spec.json plus a React page that calls useQuery from @analytics/data-app-sdk/react) into a C-Tableau viz page that can sit in a Tableau Public Web Page object. Use when an author has Next source on their machine and wants it on Tableau Public. Everything runs on the author's own computer with the author's own C-Tableau API key.
---

# Tableau Next source to a C-Tableau viz page

You are Claude on the author's own Windows machine. You do every step yourself. Nothing is built or
uploaded by anyone else, and no one at C-Tableau touches the author's files. The tools are two
Python scripts in the public repo https://github.com/biochristy-byte/C-Tableau (`tools/ctab_next.py`
builds, `tools/ctab.py` uploads).

Background if you need it: `tableau-knowledge/tableau-next-data-apps.md` and
`tableau-knowledge/data-apps-on-tableau-public.md` in that repo.

## Rules

- **The API key.** `ctab.py` reads it itself from `%USERPROFILE%\.secrets\ctab.env`
  (a line `CTAB_API_KEY=ctab_...`). Never type, print, echo, paste or commit the key. Never run a
  command that shows that file. If `ctab.py me` says the key is missing, tell the author to create
  one at https://c-tableau.netlify.app/account/#/keys and save the line in that file themselves.
- **The data stays out of git.** The CSV is the author's data. Never `git add` it.
- **Do not edit the author's source folder.** `ctab_next.py` never changes it, and you must not.
- **No em dashes** in anything you write for the author.

## Step 0: check the machine

Run each line. Expected output is on the right.

| Command | Expected |
|---|---|
| `python --version` | `Python 3.9` or higher |
| `node -v` | `v18` or higher. If it is missing or lower, tell the author to install the LTS from https://nodejs.org, reopen the terminal, and stop until they say it is done. |
| `git --version` | any version (or download the repo zip from GitHub instead) |
| `python tools/ctab.py me` (after step 1) | prints the account's email and no key |

## Step 1: get the tools

```
cd %USERPROFILE%
git clone https://github.com/biochristy-byte/C-Tableau.git
cd C-Tableau
```
Expected: a folder `C-Tableau\tools` holding `ctab.py`, `ctab_next.py` and `ctab_next_shim`.
Already cloned? Run `git pull` in it. Then `python tools/ctab.py me`: expected your account line.
If it prints a missing-key error, see Rules and stop.

## Step 2: find the source

The author gives you a folder (call it `SRC`). Confirm:
- `SRC\src\app.spec.json` exists. Open it and note `queries[].query.query.sourceName` (for example `Superstore`): this is the **data source name**, used in step 6.
- Exactly one page in `SRC\src\pages\*.tsx`. If there are several, ask the author which one is the app.

If there is no `app.spec.json`, post (see "What to post") and stop.

## Step 3: export the data as a CSV

The page asks for fields like `Orders.Sub_Category7`. The CSV needs one column per field the spec uses,
with a header row, in a folder OUTSIDE the source and outside any git repo, for example
`%USERPROFILE%\ctab-work\data.csv`.

- From Tableau Next: open the data source in the data model or a data table, choose to download or export the rows as CSV (all fields the app uses). If the author uses a connector, an export from the underlying table works too.
- Column headers should read like the field names: `Sub-Category` or `Sub Category` both match `Sub_Category7`. The matcher ignores the `Orders.` prefix, trailing digits, case, spaces, dashes and underscores.
- Limits: 5 MB and 200,000 rows per CSV. The data on a viz page is PUBLIC to anyone with the link: ask the author to confirm they are happy to publish these rows.
- Dates as `YYYY-MM-DD` or `M/D/YYYY`.

## Step 4: build

```
python tools/ctab_next.py build "SRC" --out "%USERPROFILE%\ctab-work\app" --csv "%USERPROFILE%\ctab-work\data.csv"
```
Add `--entry src/pages/TheOnePage.tsx` if step 2 had several pages.
The first run installs React into `%USERPROFILE%\.ctab-next-cache` (about a minute, needs internet).

Expected output, in this order:
1. `build: node v..., spec src\app.spec.json, page src\pages\X.tsx, queries [...]`
2. A table `field map (N of N matched ...)`, each field `->` a CSV column. Read it. Wrong match? Edit `ctab-fields.json` in the output folder (the right side is the column name), then run `python tools/ctab_next.py check "%USERPROFILE%\ctab-work\app" --csv "%USERPROFILE%\ctab-work\data.csv"`.
3. `built ...: app.spec.json, ctab-fields.json, index.css, index.html, index.js`
4. `GREEN: 5 files, ... KB`

If you see `RED: these fields have no single CSV column`, the CSV is missing a column or two columns match one field. Fix the CSV header (or the mapping file) and rerun. Do not guess data.

## Step 5: upload

```
python tools/ctab.py upload "%USERPROFILE%\ctab-work\app" --app
```
Expected last lines: `Submitted. id <EXTENSION_ID>  status pending`. Copy that id.
The upload waits for approval by the C-Tableau admin (Chris). Tell the author: "Uploaded, waiting for approval." Check with `python tools/ctab.py status EXTENSION_ID` until it says `approved`. This can take a day; tell the author it is fine to come back later.

## Step 6: publish the viz page

Once approved:
```
python tools/ctab.py vizpage publish --name "My App" --extension EXTENSION_ID --csv "%USERPROFILE%\ctab-work\data.csv" --datasource "Superstore" --slug my-app --visibility private
```
Use the data source name from step 2 for `--datasource`. Expected:
```
Published my-app: 9994 rows, private
Paste this into a Tableau Web Page object:
https://c-tableau-hosted.netlify.app/v/my-app/?embed=1
```
Open that URL in the browser and look: the app should draw. A blank page or an error line means a query failed (see below).

## Step 7: put it in Tableau Public

Tell the author, in this order:
1. In Tableau Public Desktop, on a dashboard, drag a **Web Page** object in and paste the URL. Keep `?embed=1`.
2. Size the object to the app's full width.
3. Publish with **File, Save to Tableau Public As**. Never Ctrl+S.

To refresh the data later: publish the page again with the new CSV and the same `--slug`. The address stays the same.

## What to post if something fails

Post to the author (and, if they ask for help, to the room they named): the command you ran, the **last 15 lines** of its output, and these facts: `python --version`, `node -v`, the `sourceName`, the list of query ids from `app.spec.json`. Never post the key, the CSV rows or the contents of `ctab.env`.

| Message you see | What it means |
|---|---|
| `Node.js is not installed` or `too old` | install Node 18+ from nodejs.org, reopen the terminal |
| `RED: these fields have no single CSV column` | the CSV header lacks a field the app queries |
| `filterType "..." ... is not supported yet` or `aggregation "..." ... not supported` | the app uses a query feature our shim lacks; post the message and the matching part of `app.spec.json` (the shim's mapping is in `tools/ctab_next_shim/sdk.js`, block `SDK SHAPES`) |
| `Cannot pick the page` | pass `--entry src/pages/X.tsx` |
| `check ... RED` listing a `.tsx`, an absolute path or a remote URL | the source loads something we cannot host; post the line |
| `NOT_FOUND` on `vizpage publish` | the upload is not approved yet: wait |
| page is blank | open the browser console (F12) and post the first red error |
