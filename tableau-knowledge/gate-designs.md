# Gate designs: checks that can fail

[workflow-and-qa.md](workflow-and-qa.md) says every gate needs a control that
goes red. This page holds the designs that earned their keep, so you can copy the
shape rather than rediscover it. Every gate below reports what it examined (a
count of subjects), has a minimum subject floor, and ships with a sabotage control.

## Calibrate how Tableau draws text and marks

Diff a screenshot against the background PNG it sat on: anything not in the baked
PNG is Tableau's ink.

| Fit | How |
|---|---|
| Glyph size | `px(pt) * TEXT_SCALE` |
| Ink box | The PIL glyph bbox for that string at that size |
| First baseline | `BASE0 + BASE1 * size` below the zone top |
| Further lines | `LINE_ADV * size` each |
| Left edge | Text starts `PAD_X` inside the zone |
| Marks | `circle_px_per_size` and `line_px_per_size` from alpha coverage of isolated circles and straight line runs |

- Fit only from zones on clean ground (no chart frame, no zone within 8 px).
- Re-check the fit on every clean zone of every shot. The gate goes RED if a
  model edit stops matching.
- Store the fit in a JSON file, one per display scale (`calibration_150pct.json`).

### Per-word ink metrics, fitted as lines

For text whose size varies a lot (a word cloud), per-point figures from 12 and 20
pt missed a 96 pt word by 9.3 px; antialiasing and hinting add a near-constant 1
to 2 px per edge. Store each ink edge of each word as `a + b * pt`, fitted over
isolated-word shots near the final sizes (115 samples, all within 1.07 px; an
unseen build landed within 1.4 to 1.5 px). A word with no entry fails the layout
check until it is measured.

### Text colour of a line

Use the mean of its brightest 2 percent of glyph pixels, not the line mean:
anti-aliasing pulls the mean down. Search for a legend swatch only inside that
legend's crop and its own colours (a bold 12 pt "o" is solid enough to pass as a
swatch).

## Number-provenance gate

A script recomputes every headline number from the CSVs the workbook reads and
compares it to the value verified last round, so a restyle cannot move the data.

- One line per check: expected, got, PASS, FAIL, or SKIP when an input is missing.
- Every input prints the rows read, with a minimum subject count.
- Each section has a control that restores a known-bad shape and must FAIL (54
  checks and 10 controls at one build).
- Any statistical test used for coloring gets a second implementation.

## Coverage gate (extends rule 39)

A mark-accuracy gate proves marks are right, not that every mark is still drawn.
When a chart is replaced or split, list every series by period the old chart
showed and assert each still appears in a rendered chart AND a table. One swap
turned a 4-line chart into a 2-point radial: 8 values left the page and a
decorative trail implied a straight line through real swings, while the 153-subject
mark gate stayed green. Control: delete one datum's mark; the gate must go red.

## Allowlists that must stay empty

`KNOWN_MISCODED` is an EMPTY set, so the label function goes RED on the first new
miscode instead of passing over a stale allowlist. A gate whose exceptions list can
grow silently is a reporter, not a gate.

## Color checks are computed

- **Color vision.** Simulate protanopia, deuteranopia and tritanopia and report the
  CLOSEST PAIR of categorical colors by color distance (dE). One palette had a pink
  and a slate near-identical for protanopes (distance 1.2); that was flagged to the
  owner rather than shipped silently. A named stock palette does not exempt your
  additions: re-run when you add a fifth to seventh color.
- **State colors.** A selected or hover color must not sit near a data color. An
  amber selected pill `#ffe0b3` was too close to a gold data color and moved to
  `#ffdcc2`. Use the same distance metric.
- **Labels on marks.** If no ink reaches 7:1 on a mark color (nothing did on
  amber), move the label off the mark: print the total past the bar end on a
  dual-axis Text layer. Do not lower the bar.

## HTML companion page gates

For a story page next to the workbook, check computed style, never screenshots (a
debug browser profile repainted 1.24:1 text as legible).

**Contrast walk**

1. Ground is the surface the text is painted on, not the card. A headline token was
   3.32:1 on the white card and 2.57:1 on the page plane it really sat on. List every
   surface a token lands on before choosing it.
2. Walk ancestors starting at the node itself, or white-on-accent chip text
   compares against the page.
3. SVG text over marks has no ancestor ground: `scrollIntoView`, then
   `document.elementsFromPoint`, and take the first opaque `fill` or
   `backgroundColor`.
4. A CSS gradient is a `backgroundImage`: parse its stops and score the worst (the
   centre stop of a radial gradient under centred text, top AND bottom of the text
   box for a vertical one). Only `url()` is a picture.
5. Composite every translucent ancestor background to one opaque color
   (`rgba(255,255,255,.03)` over near-black read 2.50 literally, 7.63 composited).
6. Run both themes, with a floor of 7:1 and 13.33 px, at 3 views by 2 widths.
7. Control: swap one token to low contrast and one label to 11 px; both must go red.
   Quote nodes examined, minimum ratio and the control result.

**Mark gate.** Read each rendered value point from the DOM, convert to SVG space
through the SVG's own transforms, and invert through the axis AS DRAWN by fitting a
line through the rendered gridlines. It must match the data file within 0.5 units.
Read twice, 1.5 s apart, while ambient motion runs: value points may not move more
than 0.01 px (227 subjects, floor 220).

**Copy gate.** Acronym key present, word budget, no long dashes, `MIN_ACRONYMS` floor.

**Page probe.** Console errors, horizontal scroll, and p95 `requestAnimationFrame`
frame time under 20 ms. A hidden tab kills rAF, so confirm `visibilityState` first.

## Radial and unit charts: fixed angle per dot

On a radial chart the reader compares sweep angle. A fixed arc length per dot made
outer rings spend less angle per dot, so two series that rose both ended at the
same clock position and the rise vanished (the grey decline looked steeper).

- One fixed angle per dot across all rings and both sides, sized so the largest
  side ends before 6 o'clock.
- Innermost radius set so its dot spacing still clears 2r; gap between ring bands
  at least 1.5x the band width.
- End-value label at each arc's own tip.
- Gate: sweep angle proportional to count within 1%, exact dot count per side, no
  overlap. Control: delete one dot. This holds in native Tableau too.
