# C-Tableau

Everything Chris and Claude learned building Tableau dashboards and viz extensions,
plus two working extensions you can run. Free, MIT licensed.

## Get updates

- New extensions and fixes ship often. On GitHub, click **Watch** (top right), then **Custom**, then check
  **Releases**. You get an email for each new release without the noise of every commit. Choose **All Activity**
  instead if you want every change.
- Downloaded an extension's `.trex` from c-tableau.netlify.app? Your workbook loads it from that site, so most fixes
  reach you on their own. You only need a new `.trex` when a release note says so.
- Running an extension from this folder with its `Start-*.bat`? That `.trex` loads from your own computer
  (localhost), so fixes arrive only when you run `git pull` and restart the Start window.
- Star the repo to find it again later.

| I want to | Go to |
| --- | --- |
| Set up Claude for Tableau in 20 minutes | [`GETTING-STARTED.md`](GETTING-STARTED.md): standing instructions, slash commands, the Claude Desktop skill, first prompts |
| Brainstorm chart types with Claude | [`/chart-brainstorm`](tableau-knowledge/claude-command/chart-brainstorm.md): four options from safe to showpiece, each with its build recipe |
| Have Claude design or build Tableau work well | [`tableau-knowledge/`](tableau-knowledge/README.md). Point your Claude at it and say "read tableau-knowledge/README.md, then help me build a dashboard." |
| Rebuild the flower garden dashboard (MM 2026 week 44, PISA and AI) | [`tableau-garden-petals/example-pisa/`](tableau-garden-petals/example-pisa/README.md): data script, exact dark settings, shelf-by-shelf steps (design inspired by *In Full Bloom* by Külli Esko) |
| Use or copy a viz extension | [`tableau-garden-petals/`](tableau-garden-petals/README.md) (flowers, three views) or [`tableau-lollipop/`](tableau-lollipop/README.md) (84 settings) |
| Chart anything with a full settings panel | [`tableau-panel-chart/`](tableau-panel-chart/README.md): a viz extension for bar, line, area and scatter where the floating ctab-panel is the feature |
| Put every parameter, filter, highlight and preset in one floating gear on a dashboard | [`tableau-settings-panel/`](tableau-settings-panel/README.md): a dashboard extension, no network calls, presets saved in the workbook |
| Show your own viz extension on Tableau Public (hosted page in a Web Page object) | [`tableau-knowledge/extension-on-tableau-public.md`](tableau-knowledge/extension-on-tableau-public.md): build, test, host, thumbnail, dashboard steps, publish |
| Put a Tableau data app (`scaffold-data-app`, `queryAsync`) on Tableau Public | [`tableau-knowledge/data-apps-on-tableau-public.md`](tableau-knowledge/data-apps-on-tableau-public.md): upload the `.twbx`, give the viz page a CSV per data source, type the data source name. The app runs unchanged |
| Host a viz extension online | **c-tableau.netlify.app**: 3 extensions free, then C-Tableau Unlimited for $2 once (unlimited hosting plus every public community extension) |
| Submit an extension to the Tableau Exchange | [`tableau-garden-petals/exchange/`](tableau-garden-petals/exchange/SUBMISSION.md): manifest, icon, screenshots, privacy policy, terms and the contributor email |
| Pair a silent screen recording with a voiceover | [`narration-sync/`](narration-sync/SKILL.md), a Claude skill |
| Use the tested scripts (build a `.twb`, check contrast, package a `.twbx`) | [`tableau-knowledge/tools/`](tableau-knowledge/tools/README.md) |
| Stop a Tableau Public workbook from being published by accident | [`tableau-knowledge/never-ctrl-s-on-public.md`](tableau-knowledge/never-ctrl-s-on-public.md) |

Not included: Tableau's own Extensions API library (each extension's `lib/README.md` says how to
get it) and the Makeover Monday data (the PISA recipe says how to reshape it).

One thing to know before you publish: Tableau Public only runs Tableau-approved extensions, so a
workbook that uses your own self-hosted extension shows visitors "isn't currently supported". Tested
11/05/2026: it loads and renders in Tableau Public Desktop 2026.1 (Add Extension > Access Local Viz
Extensions) while you author, and Public Desktop refuses a manifest whose `author` has no `email`
attribute, so ship `email=""`. Details: [`viz-extensions.md`](tableau-knowledge/viz-extensions.md).
To show an extension on Tableau Public anyway, run it as a hosted web page inside a dashboard Web
Page object: [`extension-on-tableau-public.md`](tableau-knowledge/extension-on-tableau-public.md).
