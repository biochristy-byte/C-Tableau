---
name: studiomind-polish
description: "Fixes the mechanical items on a StudioMind audit FAIL list one at a time, with the author's OK on each, and re-checks each fix. Trigger on '/studiomind-polish', 'fix what the audit found', 'fix the audit list', 'polish this dashboard', 'apply the audit fixes'. Do NOT trigger for: a new build (the authoring skill), a review with no fixes (studiomind-audit), or changing a calc or rate formula."
---

# StudioMind polish

You fix what `/studiomind-audit` found, one item at a time, and prove each fix. You fix
only mechanical items: colors, sizes, names and text. Anything that touches what the
numbers mean goes back to the author.

## Hard constraints

1. **Work only from a FAIL list from `/studiomind-audit`, run this session on this
   workbook.** Never from memory or an older report. No list: run the audit first.
2. **Before the first fix, ask the author to save a copy** with File > Save As (for
   example `Sales_v2.twbx`) and wait until they say it is done. You never save. In
   Tableau Public, Ctrl+S publishes to the web: say so.
3. **One fix, one OK.** For each item show the check ID, the dashboard and zone, the
   current value, the new value and the tool you will call. Wait for yes.
4. **Change only the attribute the fix names.** Start from the XML you read just before
   the fix and change that one value. Never rebuild the XML from scratch. `apply-dashboard`
   and `apply-worksheet` replace the whole object, so anything you leave out is lost.
5. **Count before and after every fix.** From fresh XML, count the dashboard's zones,
   the worksheets on it, the filters, the actions and the calcs. After the fix, read it
   again and count again. The only allowed change is the one the fix table lists. Any
   other difference: stop, show the before and after counts, and offer two ways back
   (Edit > Undo in Tableau, or re-applying the XML you read before the fix, with the
   author's OK). Do not continue until the author decides.
6. **Re-run that one check on that one item after each fix.** FAIL to PASS: next item.
   Still FAIL: stop that item and report what you measured.
7. Never delete a zone, sheet, calc, filter, action or data source. Never save, publish
   or close the workbook.

## Fixes it may make

| ID | Fix | Allowed count change |
|---|---|---|
| A1 | Set the text color to a darker or lighter step of the same hue that measures 7:1 or better on its ground, with the ratio shown | none |
| A2 | Raise the text to 10 pt, legends to 11 pt | none |
| A3 | Switch the view to a Tableau "Color Blind" palette, keeping the order of the colors | none |
| I1 | Rename the action to say what it does, set a filter action to clear with "Show all values", change Hover to Select | none |
| L2 | Set Automatic or mismatched desktop dashboards to one fixed size: the profile's canvas, or the size most desktop dashboards already use | none |
| L3 | Set the title's font, size, color and band to the treatment most dashboards already use | none |
| L4 | Add the source credit and spell out each acronym in the footer. Ask the author for the source wording and each expansion; never guess one | +1 text zone, only if no footer zone exists |
| L5 | Add one instruction sentence in the control's container or the page's instruction line. The author approves the wording | +1 text zone, only if no instruction zone exists |

## Never fixed

These change what the numbers mean or what the page shows. Report each one with what
you would suggest, and leave the decision and the change to the author.

| ID | Why it stays with the author | What you report |
|---|---|---|
| D1 | Rate math changes the number readers see | The current formula, the `SUM([a]) / SUM([b])` rewrite, and the reason |
| D2 | A number stored as text may feed other sheets | Which fields and sheets use it |
| D3 | Mixed grain needs a decision about the data | The two grains and where they meet |
| D4 | Table calc addressing changes every value in the view | The current and the suggested addressing |
| D5 | Filters belong to the author; never remove or change one | The filter and the title that conflicts with it |
| L1 | Fewer charts per page means moving sheets to a new page | Which charts could move, and to which page |

## Steps

1. **Get the list.** Use this session's audit FAIL list. Split it into the fix table and
   the never-fixed table, and show both. Within the fix table, put accessibility first
   (A1, A2, A3), then actions (I1), then layout (L2 to L5).
2. **Save a copy** (constraint 2).
3. **Fix loop:** for each item, show it (constraint 3), count (constraint 5), apply,
   read back, count, re-check (constraint 6).
4. **Report:**
   - Fixed: N of M, each with its before and after value.
   - Stopped: each item that did not reach PASS, with the measured value.
   - For the author: the never-fixed items with your suggestions.
   - Then recommend running `/studiomind-audit` again on the whole workbook.

## Contrast

To pick an A1 color, run this skill's `scripts/a11y_check.py` by its full path, controls
first: `--pair "#777777" "#ffffff"` must FAIL at 4.48:1 and `--pair "#000000" "#ffffff"`
must PASS at 21.00:1. Then check the new pair. The script takes 3 or 6 digit hex only:
blend an 8-digit `#RRGGBBAA` ground onto the color under it first. With no way to run
the script, compute WCAG relative luminance and show both values and the ratio.

## Common mistakes

- Fixing an item the audit did not list "while you are there".
- Rebuilding a dashboard's XML instead of changing one attribute, which drops zones.
- Reporting a fix as done from the tool's success message without reading it back.
- Choosing a new gray by eye.
- Writing a footer source or acronym expansion the author did not give.
