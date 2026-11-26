---
name: studiomind-audit
description: "Read-only check of the open workbook against the StudioMind rules (contrast, type size, rate math, actions, layout), reported as PASS, FAIL or SKIP with counts. Trigger on '/studiomind-audit', 'audit this dashboard', 'review this dashboard', 'is this ready to share', 'run the accessibility check'. Do NOT trigger for: fixing what it finds, grading a skill (skill-grader-desktop), or data profiling (data-quality-review)."
---

# StudioMind audit

You check one workbook against the StudioMind rules and report what passed, what failed
and what you could not see. You never change the workbook.

## Hard constraints

1. **Read-only, always.** Never call `author-calc`, `add-field`, `apply-worksheet`,
   `apply-dashboard` or any other tool that changes the workbook. Report and stop.
2. **Declare the subject before you check it.** Start the report with what you examined:
   dashboards, sheets, calcs, text and ground pairs.
3. **Count only what you read.** Each check reports how many items it read out of how
   many exist: "PASS (5 of 9 sheets; 4 unreachable)". A check that read nothing is
   **SKIP**, never PASS. A floor the author waived by name this session is **WAIVED**.
4. **Prove the contrast check can fail before you trust it.** Run the two controls in
   Step 3 first. If `#777777` on `#ffffff` does not FAIL, or `#000000` on `#ffffff` does not
   PASS, the check is broken: say so and SKIP A1.
5. **Tag every judgment that is not a measurement** `[Confidence: High]`, `[Medium]` or
   `[Low]`, the way Tableau's own explainer skills do. Measured results (a contrast
   ratio, a font size, a count) need no tag.
6. **If `get-worksheet-xml` fails on a sheet that sits on a dashboard,** retry once, then
   use `list-available-fields` and the dashboard XML for what they show, and mark that
   sheet unreachable for the checks that need its XML (A1, A2, D4, D5).

## Step 1. Inventory

Call `get-workbook-inventory`. List every dashboard and sheet and note the workbook file
location. If there are no dashboards, audit the sheets alone and say so.

## Step 2. Read everything

For each dashboard call `get-dashboard-xml`. For each sheet on it, call
`get-worksheet-xml` and `list-available-fields` (verbosity full, for calc formulas)
together, since sheets do not depend on each other.

## Step 3. Run the checks

| ID | Check | Fails when |
|---|---|---|
| A1 | Text contrast | A text color against the ground it actually sits on (card, title band, bar, cell, tooltip) is under 7:1. |
| A2 | Text size | Text is under 10 pt, or a legend is under 11 pt. Text with no size in the XML is at Tableau's default: list it as "default size, not measured", never PASS. |
| A3 | Palette | A view uses more than 6 categorical colors, or a palette other than a Tableau "Color Blind" named palette. `[Medium]` for any other palette. |
| D1 | Rate math | A rate averages a row-level ratio or divides before aggregating. Expected form: `SUM([a]) / SUM([b])`. `[Medium]` when the row-level ratio may be intended (unit price). |
| D2 | Number as text | A calc turns a measure into text (`STR()`, a concatenated "$" or "%") and that field is then aggregated, sorted, put on an axis or used in place of the number. Text used only in a title, label or tooltip passes. |
| D3 | Mixed grain | A calc or view adds a pre-aggregated total field to row-level values. `[Medium]` unless the field descriptions settle it. |
| D4 | Table calc addressing | A table calc's addressing is not set to Specific Dimensions. `[Medium]` on a single-dimension view. |
| D5 | Filters | List every filter on every sheet. Fail any that narrows a view whose title or caption says it shows the whole data. |
| I1 | Actions | An action keeps a default name ("Filter 1"), runs on Hover, or a filter action clears to anything other than "Show all values". If no tool returns the action list, SKIP I1 and list it under Not seen. |
| L1 | Density | More than 4 charts show at once. Count worksheet zones that draw compared marks; skip legends, filter and parameter cards, text-only sheets and button sheets. With dynamic zone visibility, count each state on its own. |
| L2 | Canvas | A desktop dashboard is sized Automatic, or desktop dashboards use different sizes. Phone dashboards and device layouts are exempt. |
| L3 | Title | Title treatment (font, size, color, band) differs between dashboards. |
| L4 | Footer | A dashboard has no source credit, or uses an acronym its footer does not spell out. |
| L5 | Instructions | A filter, parameter or set action, or a filter or parameter card whose effect its own label does not show, has no instruction sentence in its container or the page's instruction line. `[Medium]` |

**Contrast.** If you have a tool that runs a bundled script, run this skill's
`scripts/a11y_check.py` by its full path, controls first:

```
python <this skill's folder>/scripts/a11y_check.py --pair "#777777" "#ffffff"   # must FAIL (4.48:1)
python <this skill's folder>/scripts/a11y_check.py --pair "#000000" "#ffffff"   # must PASS (21.00:1)
```

Then check every real pair in one call: `--pair FG BG --pair FG BG ...`. The script takes
3 or 6 digit hex only, so first blend any 8-digit `#RRGGBBAA` ground onto the color under
it. Workbook mode (`a11y_check.py <file.twb or .twbx>`) reads the saved file: use it only
after the author confirms the saved file matches what is open. Its RED for "examined too
little" is a coverage finding, not a pass. Text left at Tableau's default color has no
color in the XML: check it by hand and say so. With no way to run the script, compute WCAG
relative luminance for each pair and show both luminance values and the ratio.

## Step 4. Report

1. **Subject line:** "Examined N dashboards, N sheets, N calcs, N text and ground pairs."
2. **Verdict table:** one row per check ID with PASS, FAIL, SKIP or WAIVED, the count read
   out of the count that exists, and the count failed.
3. **Fix list,** most serious first (truth in numbers, then accessibility, then style).
   Each item names the dashboard, the sheet or zone, the measured value, and the fix.
4. **Not seen:** anything the tools could not reach (unreachable sheets, default-styled
   text, basemap labels, Tableau's own UI chrome, sets whose members no tool can list).

End by offering to hand the fix list to an authoring skill. Do not start fixing.

## Common mistakes

- Calling a check PASS when it read nothing (an empty dashboard XML, a failed fetch).
- Measuring text against the dashboard background when it sits on a card or a bar.
- Eyeballing contrast from a screenshot. Compute it.
- Fixing a problem "while you are there". This skill never writes.
