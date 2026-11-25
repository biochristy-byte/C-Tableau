# Settings panel guide

Instructions a person can hand to their Claude to build a robust settings panel for a custom chart: a Tableau viz extension, a data app, or any embedded visualization.

**Building an extension in this repo? Use [`shared/ctab-panel/`](../shared/ctab-panel/README.md).** That is the shared panel library here, with a schema, tests and a sync check. This guide is something different: the design ideas behind a panel, the reasons for each, and a single-file starter for someone working outside this repo.

| File | What it is |
| --- | --- |
| `settings-panel-guide.md` | **The file to share.** The behavior contract, the design idea, a full starter, patterns, and a test list. It stands alone. |
| `panel-starter.html` | The same starter that is embedded in the guide, as a file. Open it in a browser to try the panel. |

## Where it came from

- **Part 1** is the panel in Range Dot ([`tableau-range-dot/`](../tableau-range-dot/README.md)). The starter is a small, generic version of that panel with five sample bars standing in for the chart.
- **Part 2** is the panel in a Tableau data app, an executive summary page. Its code in the guide is excerpted from that app.

## Status

- Part 1's starter was tested in a browser: live preview, Cancel, Apply and reload, Reset, Escape, drag and clamp, Dock, dependent rows, pin to side with the accordion, the small-view fallback, copy formatting and paste, the diagnostics report, an emptied number box, and a 13 px minimum text size.
- Pin to side and the accordion are also in Range Dot (v1.1.0) and confirmed inside Tableau Desktop 2026.3, on a worksheet and a dashboard. The formatting-only copy and "use the last copy on this machine" exist only in the starter and have not been run inside Tableau.
- Part 2 was written from the data app's source. Its excerpts were checked against that source, not run as a separate file.

## Keeping the two files in step

The code block in the guide must match `panel-starter.html`. After changing the starter, paste it into the guide again.
