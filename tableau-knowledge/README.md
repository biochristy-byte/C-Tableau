# Tableau knowledge for Claude Code

What I learned building Tableau dashboards, workbooks and viz extensions with
Claude Code, written down so your Claude can start where mine ended. It is
mostly things that fail silently: Tableau does not log an error, the feature just
does not happen.

Point your Claude at this folder and say "read tableau-knowledge/README.md, then
help me build a dashboard."

## Read in this order

| File | What it is | Read it when |
|---|---|---|
| [`house-style.md`](house-style.md) | 47 dashboard design rules (layout, color, type, text contrast, interactivity, story, data honesty) with where each came from | before designing any page |
| [`buildout-pipeline.md`](buildout-pipeline.md) | How Claude builds a workbook when there is no authoring API: Tableau authors a template, a script injects charts, you publish. Includes GUI-driving lessons and gating | before generating a `.twb` |
| [`xml-traps.md`](xml-traps.md) | The `.twb` XML catalogue: load failures, the silent traps, and verified fragments for buttons, actions, filters, maps, colors, DZV | when XML loads but renders wrong, or does not load |
| [`technique-library.md`](technique-library.md) | Chart and interaction recipes (map layers as a canvas, dashboard-level set actions, zoom without an extension) and calc pitfalls | before building a chart or interaction |
| [`viz-extensions.md`](viz-extensions.md) | Viz extension hard limits, what was proven (including the Tableau Public test: loads for the author, blocked for viewers), the manifest `email=""` rule, and the gotchas found only in real Tableau | before writing an extension |
| [`andy-kriebel-recipes.md`](andy-kriebel-recipes.md) | Step-by-step recipes from a public Tableau channel: map-layer drawing (bar, donut, waffle, calendar, gauge), set actions, dynamic zone visibility, KPI cards, calc fundamentals | before building any chart or interaction beyond the basics |
| [`iron-viz-design.md`](iron-viz-design.md) | An Iron Viz winner's approach: mood board, background first, custom shapes, one-parameter accordion, tiny Prep data sources, speed | before designing a showpiece or a story dashboard |
| [`agent-business-preferences.md`](agent-business-preferences.md) | How to write the rules file for Tableau Cloud and Next agents (and any AI agent over data) | before putting an AI agent on a dashboard or semantic model |
| [`viz-of-the-day-patterns.md`](viz-of-the-day-patterns.md) | How themed Viz of the Day winners carry a theme without bending the data, plus how to pull the public archive | before theming a dashboard |
| [`workflow-and-qa.md`](workflow-and-qa.md) | Whole-pass review, acronym footers, rendered-text gates, the Pages card, driving the GUI politely, scaled-display truth | before a multi-page build or any render loop |
| [`data-honesty.md`](data-honesty.md) | What a chart may claim: quote provenance (`verbatim` flag), significance before color, naming categories by what happened, collecting every published number, weighted survey data | before charting survey, scraped or sensitive-incident data |
| [`gate-designs.md`](gate-designs.md) | Gate designs that can fail: text and mark calibration, number-provenance, coverage, color-vision, HTML-twin contrast and mark gates, fixed-angle radial charts | before writing a QA gate or a render check |
| [`narration-and-handoff.md`](narration-and-handoff.md) | Turning a recorded talk into rules, and pairing a silent screen recording with a voiceover (retime plan, ffmpeg traps) | when you learn from a video or make a tutorial video |
| [`never-ctrl-s-on-public.md`](never-ctrl-s-on-public.md) | Why Ctrl+S in Tableau Public publishes, and how to make a driver refuse it | before any GUI automation |
| [`tools/`](tools/README.md) | The scripts that go with these pages (generators, gates, drivers), what each does and what it needs | before writing your own generator or gate |
| [`tableau-vizard-recipes.md`](tableau-vizard-recipes.md) | Recipes distilled from a public Tableau tutorial channel (interactive resume, toggle switch, Makeover Monday builds, shape file maps, dendrogram, Sankey, tiled hex map). Coming later | before building a chart those videos cover |
| [`claude-command/chart-brainstorm.md`](claude-command/chart-brainstorm.md) | A `/chart-brainstorm` slash command: four chart options from safe to showpiece, a recommendation, and a shelf-by-shelf build card | whenever you are choosing a chart |
| [`desktop-skill/`](desktop-skill/SKILL.md) | The same knowledge as one skill for Claude Desktop or claude.ai: run `tools/make_desktop_skill.py`, upload the zip | if you work in Claude chat instead of Claude Code |
| [`CLAUDE.md.template`](CLAUDE.md.template) | Standing instructions to copy into your working folder as `CLAUDE.md` | once, at setup |
| [`claude-command/tableau-scrubs.md`](claude-command/tableau-scrubs.md) | A `/tableau-scrubs` slash command: a data-prep and analysis team that asks about grain and audience first | whenever you start a Tableau job |
| [`reference/`](reference) | A 40+ chart-type reference and the `.twb`/`.twbx` file format primer | as a lookup |

The code that goes with it:

- [`../tableau-garden-petals/`](../tableau-garden-petals/README.md) is a full viz
  extension with a strict mock of the Extensions API, a packager, and Tableau
  drivers that refuse save keystrokes.
- [`../tableau-lollipop/`](../tableau-lollipop/README.md) is a smaller one with
  84 settings.

New here? Start with [`../GETTING-STARTED.md`](../GETTING-STARTED.md).

## Install the slash commands

Copy `claude-command/tableau-scrubs.md` and `claude-command/chart-brainstorm.md` into `~/.claude/commands/`
(on Windows, `C:\Users\<you>\.claude\commands\`) and restart Claude Code. Then:

```
/tableau-scrubs a dashboard on clinic wait times, one row per visit
```

## Make Claude keep the house style

Add this to your `CLAUDE.md`:

```
For any Tableau work, read tableau-knowledge/house-style.md and
tableau-knowledge/never-ctrl-s-on-public.md first. Text contrast is 7:1 minimum,
no text under 10 pt. Never send Ctrl+S to Tableau Public. I click publish.
```

## How reliable is it

Every XML fragment and trap was proved by loading a generated file into Tableau
Public 2026.1 (build `2026.1.1`) and reading the screen or Tableau's own save.
Tableau changes between builds, so when something here disagrees with your
version, trust your build: make the change once in the GUI, Save As a scratch
`.twbx`, and diff. Items marked "not proven" really are untested.

## Credits

Technique notes come from Andy Kriebel's public VizWiz channel. Design rules
come from public Tableau Public workbooks and conference talks, read for their
structure. Go to the originals for the full craft. Tableau and Tableau Public are
trademarks of Salesforce. Nothing here is affiliated with or endorsed by them.
