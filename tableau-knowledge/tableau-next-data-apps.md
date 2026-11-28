# Tableau Next data apps: what is public, what we learned from real source

**For Claude, first:** a Tableau Next data app is compiled on Salesforce's servers, so an author
holds only SOURCE (a `src/` folder), never a build. `tools/ctab_next.py` turns that source into a
plain static web app that runs on a C-Tableau viz page. Read this file for the shapes it relies on.

## What the public web says (searched 11/27/2026)

| Question | Finding | Source |
|---|---|---|
| Is `@analytics/data-app-sdk` on npm? | No. `npm view @analytics/data-app-sdk` returns E404, as do `@tableau/data-app-sdk`, `@salesforce/data-app-sdk`, `@analytics/data-app-sdk-react`. The package is injected by the Next build, so there are no public type definitions to read. | npm registry |
| Is `useQuery` / `app.spec.json` documented? | No public page names either. Searches for the package, the hook and the file name return nothing. | web search |
| What is public? | Tableau Data Apps are in beta (Tableau Cloud and Tableau Next); a Semantic Query API (POST, queries a Semantic Data Model rather than tables); a Tableau Next Embedding SDK (a different product). | https://www.tableau.com/blog/what-are-tableau-data-apps , https://developer.salesforce.com/docs/data/semantic-layer/guide/query-api-in-depth-overview.html , https://developer.salesforce.com/docs/analytics/sdk/guide/sdk-overview.html |
| The dev docs page on Tableau Next SDKs | Returned HTTP 403 to an automated fetch. | https://developer.salesforce.com/docs/analytics/tableau-next-isv-dev/guide/tn-apis-sdks.html |

Because nothing is public, the shapes below come from real app source (Celia Fryar's Loss Leader
Basket Analysis, Superstore) and are DESCRIBED here, not copied. If a Next app uses a call this
file does not list, `ctab_next.py` stops with a message naming it; post that message.

## Shapes seen in real source

- `src/app.spec.json`: top level `name`, `label`, `filters: []`, `parameters: []`, `fieldLinks: []`, `queries`.
- One entry of `queries`: `{ id, query: { kind: "semantic", query: { sourceName, fields, filters, limit } }, options: { receiveFiltersFrom, receiveParamsFrom } }`.
  - `fields[]`: `{ field: "Orders.Sales1", alias: "sales", aggregation?: "sum" | "avg" | ... }`. No `aggregation` means a group-by dimension; with one, a measure.
  - `filters[]`: `{ field, filterType: "in", values: [...] }`.
  - `limit`: a row cap (5000 in the sample).
  - Field names are SEMANTIC MODEL names: `Object.Name` plus a numeric suffix (`Sub_Category7`). The data's own header says `Sub-Category`.
- The page (`src/pages/X.tsx`): `import { useQuery } from '@analytics/data-app-sdk/react'`, then `useQuery("<query id>")` once per query. The result carries `loadedOnce` and `result.rows`, each row keyed by the field `alias`. The page waits for both, joins rows, maps alias names to its own column names and calls a plain-JS entry (`LL.start(root, rows)`).
- Plain-JS files (`src/legacy/*.js`) and CSS (`src/styles/*.css`) are side-effect imports of the page.
- No `https://` or `/services/` appears in source: all data goes through `useQuery`.

## How C-Tableau runs it

`ctab_next.py build` bundles the page with esbuild, replaces the two SDK imports with our shim
(`tools/ctab_next_shim/`), and writes `ctab-fields.json` mapping each semantic field to a column
of the CSV. At run time the shim turns each `useQuery(id)` into a query on the viz page's own rows
through the stand-in (`tableau.extensions.workbook.getAllDataSourcesAsync()` then `queryAsync`).
The one place that decides the shapes is the block marked `SDK SHAPES` in
`tools/ctab_next_shim/sdk.js`.

Known approximations (no public reference to check against): the exact hook state beyond
`loadedOnce`, `loading`, `error`, `result.rows`, `refetch`; dates come back as `YYYY-MM-DD` text.
