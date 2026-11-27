# Designing a Dashboard Page That Is Accurate, Accessible and Consistent

The house defaults for any dashboard page, chart or calc: contrast and size floors, rate math, density, titles, labels, footers and actions.

## Scope Check

- Primary audience: authors building or reviewing a dashboard page in Tableau Studio.
- Authoring outcome improved: pages every reader can read, numbers that stay correct under filters, and a workbook that looks like one product.
- In-scope reason: these choices are made on every page, and the agent's untrained defaults (automatic sizing, light gray text, averaged ratios, default action names) fail them.
- Out-of-scope risk: does not cover data source connection, publishing permissions, or server administration.
- Tags: dashboard, design, layout, accessibility, contrast, color, font size, title, label, tooltip, footer, acronym, action, rate, ratio, percent, calc, story, house style
- Relevant user prompts/search terms: build a dashboard, design this page, make it look good, pick colors, add a title, review this dashboard, is this accessible, calculate a rate, percent of total, add a filter action, tell a story with this data

## When to Use

Use when creating or reviewing any dashboard, any chart that will sit on one, or any calc that produces a rate or a headline number. The StudioMind skill carries the full version with references; this file is the short form the agent can find by search.

## Best Practices

- Text contrast is at least 7:1 against the ground the text actually sits on. Compute it from hex values.
- No text under 10 pt. Legends 11 pt; a legend built from text uses a 13 pt swatch.
- Categorical color from a Tableau "Color Blind" named palette, at most 6 colors per view. More categories means a highlight or a set action.
- Fixed dashboard size, the same for every desktop dashboard in the workbook.
- One title treatment repeated on every page.
- 1 to 4 charts visible at once. More analysis means more pages.
- Type hierarchy by size and gray steps, with 1 or 2 semantic accent colors.
- Direct-label bar and line ends in the format a reader would quote.
- Every filter, parameter or set action, and every filter or parameter card whose effect its own label does not show, gets one instruction sentence in the same container or the page's instruction line.
- A headline number that moves with a filter sits in a bold inline sentence.
- Footer on every page: the data source, and every acronym on that page spelled out.
- Rates are `SUM([a]) / SUM([b])`. Table calcs compute using specific dimensions.
- Number formatting lives on the field's format, never inside a calc.
- Rename every action, clear filter actions with "Show all values", never run an action on Hover.

### When to Say No

- Do not lower contrast or size below the floors to match a brand color. Keep the mark color and set the text in a darker or lighter step of the same hue.
- If asked for a fifth chart on a page, say once that it reads better as a second page, then do what the author chooses.
- Do not state a threshold the author or the data documentation did not give.

## Common Mistakes

- Measuring text against the dashboard background when it sits on a card, a bar or a heat cell.
- Averaging a ratio field (`AVG([Margin %])`) instead of dividing sums.
- Using `STR()` or a concatenated "$" to format a measure that is then summed, sorted or plotted, which turns it into text. Display strings for titles and tooltips are fine.
- Leaving a dashboard on Automatic size, so it reflows differently for every reader.
- Leaving default action names such as "Filter 1", which the next author cannot read.
- Gray note text near 6:1. It passes AA (4.5:1) and still reads as washed out.

## Implementation

1. Before building, write the one sentence the reader should leave with, and find the grain (what one row is).
2. Set the dashboard size once and reuse it.
3. Build the title band and footer first, then place 1 to 4 charts in tiled containers.
4. Pick a colorblind-safe palette and compute each text and ground pair to 7:1.
5. Write rates as `SUM([a]) / SUM([b])` and set table calc addressing explicitly.
6. Name every action, clear filter actions with "Show all values", and add the instruction sentences.
7. Read back the result and check every page in one pass before calling it done.

## Related Expertise

- The `studiomind` skill: full rules, story structure, safety and the reference library.
- The `studiomind-audit` skill: a read-only check of a workbook against these rules.
- The `studiomind-polish` skill: fixes the audit's mechanical items one at a time.
- The `studiomind-setup` skill and the `studiomind-profile` it writes: this author's own defaults.

## Source and Confidence

Distilled from published workbooks by a Tableau instructor and a dashboard designer, an Iron Viz 2026 winner's conference talk, a Tableau user group talk on business preferences for Tableau's agents, and long multi-page builds. Confidence: High for the floors and the rate math (each was measured or caused a real defect); Medium for layout defaults, which the author may override.
