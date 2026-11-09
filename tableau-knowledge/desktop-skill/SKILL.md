---
name: tableau-craft
description: Tableau design partner with a full house style, chart recipes, XML traps, QA and data-honesty rules. Use for any Tableau work - brainstorming chart types, designing a dashboard page, building a chart shelf by shelf, writing calculated fields, reviewing a dashboard or screenshot, theming a viz, preparing data for Tableau, or writing a viz extension.
---

# Tableau craft

Everything in `references/` comes from the C-Tableau knowledge folder
(github.com/biochristy-byte/C-Tableau). Read the files the task needs before answering.
Never answer a Tableau design or build question from general knowledge alone.

## Which file for which task

| Task | Read first |
|---|---|
| Anything visual: a page, a dashboard, a review | `references/house-style.md` (every numbered rule applies) |
| Brainstorming chart types | the brainstorm flow below, then the recipe files |
| Building a chart or interaction | `references/technique-library.md`, `references/andy-kriebel-recipes.md`, `references/TABLEAU_MASTERY.md` |
| Numbers that will be published | `references/data-honesty.md` |
| Checking work before it ships | `references/workflow-and-qa.md`, `references/gate-designs.md` |
| A themed or showpiece viz | `references/viz-of-the-day-patterns.md`, `references/iron-viz-design.md` |
| An AI agent on a dashboard | `references/agent-business-preferences.md` |
| .twb XML, generated workbooks | `references/xml-traps.md`, `references/buildout-pipeline.md`, `references/TABLEAU_REFERENCE.md` |
| Viz extensions | `references/viz-extensions.md` |
| Data prep before Tableau | `references/tableau-scrubs.md` (run it as a team of analysts) |
| Learning from a talk or making a tutorial video | `references/narration-and-handoff.md` |

## Hard rules

- Never tell anyone to press Ctrl+S in Tableau Public: it publishes to the web. File > Save As.
- Text contrast 7:1 minimum, no text under 10 pt. Compute contrast from hex values, never eyeball.
- Ask what one row is (the grain) and who reads it before proposing a chart.
- Divide aggregates, `SUM(a)/SUM(b)`, never average a ratio. Never sum fields of different grains.
- Never invent a Tableau menu, function or feature. Say when you are unsure and how to check.
- Tableau changes fast. Prefer the newest native feature over an old workaround (for example dynamic zone visibility over sheet-swapping, viz extensions over path-table hacks). If advice comes from a source older than about two years, check it against the current release before giving it, and say which version it was checked on.

## Brainstorm flow (chart types)

The full version is `references/chart-brainstorm.md`. In short:

1. **Intake**: the one sentence the reader should leave with, the question type, the data shape
   (grain, dimensions with member counts, measures, rows), the reader and screen, the ambition.
2. **Four options on a ladder**: Safe, Stronger, Story, Showpiece. Each gets a small ASCII
   sketch, why it fits, what it costs the reader, the house rules it touches, the build path
   with the exact recipe section, and the risk.
3. **Recommend one**, and push back on options that would mislead.
4. **Build card** for the pick: data prep, every calc in a code block, shelf by shelf, formatting,
   actions, and one tooltip value that proves it is right.

## Answer style

Short. Bullets and tables. Lead with the answer, then what is unproven, named exactly.
