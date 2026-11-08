# Workflow and QA lessons from long Tableau builds

Process lessons that came out of multi-page builds driven by Claude: what made a
build converge, what wasted a budget, and the gates that caught real defects.
Layout and XML specifics live in [buildout-pipeline.md](buildout-pipeline.md) and
[xml-traps.md](xml-traps.md).

## 1. Review in whole passes, not one defect at a time

A build handed from one builder to the next fixed one gate failure at a time:
fix, rebuild, re-gate, repeat. It burned three builder budgets and never showed
the whole product at once, and a fix on one page broke another unseen.

A pass should be:

1. Render EVERY page and layout.
2. Run EVERY gate.
3. Look at EVERY screenshot, whole (do not crop a phone shot to its device
   width).
4. Write ONE problem list in a review log (a table: page, problem, fix).
5. Make every edit together, rebuild once.
6. Re-look at everything that could be affected, and repeat until a full pass
   finds nothing.

Put this method in every builder brief. Record each pass's result and next list in
the log, and commit at the end of each pass. When a handoff happens, the log
plus a handoff note (cause proven, exact fix, which gate check to add, gotchas)
lets the next builder apply a pass without re-diagnosing.

## 2. Keep the old chart when you swap a chart type

When a chart type changes, the reader wants to see what it replaced, and a swap
can silently drop something the old chart showed. Keep a lineage list (commit,
form, why it changed), regenerate a before-and-after page from version control,
and save a PNG of the old sheet before rebuilding it. Gate: the shot count
matches, no page errors, and neighbouring cards are not pixel-identical.

## 3. Every page ends with its acronym key, and text stays light

Every dashboard page gets a footer text zone that spells out only the acronyms
that page uses. Strangers do not know your abbreviations. Keep a note only if the
chart cannot show it; notes that repeat the chart bury the few caveats that
matter, so keep the density at Viz of the Day level. Mirror an HTML story's copy
gate for the workbook: scan each dashboard's text zones and titles for acronyms,
set a word budget per view, forbid long dashes, and include controls that go red
on purpose.

## 4. Rendered-text gates that caught real defects

These checks read the rendered screenshots and the workbook XML, not just the
design values.

- **Truncation shows as two dots.** A text zone that does not fit its content
  ends in `..`. A ratio floor (rendered width over modelled width) cannot see a
  cut that loses a single word, so add an explicit detector for a trailing `..`
  and a control that reintroduces one. Size footers and pills from their content.
- **Text zones never grow.** They truncate. Give a two-line note about 25 px per
  9 to 10 pt line plus room for a wrap.
- **Wrap models overestimate.** A model that predicted 26 lines when Tableau drew
  24 left 70 px of empty card. Pre-break each block into explicit lines at the
  model's conservative width and insert breaks yourself, so every line fits by
  construction and the card is sized from a known line count. Break word by word,
  carrying each word's font run. Long explicit runs drift (a real 27.5 to 28.4 px
  pitch against a modelled 28), so treat more than four explicit lines as one
  drifting block.
- **Never split an acronym from its meaning** across a line. Lay keys and
  legends out in whole units with explicit breaks, so a swatch is never stranded
  from its label.
- **Contrast is measured on pixels**: every text run against every distinct
  pixel of the image under its zone, tooltips against white, tab captions against
  the flat middle of their pill, plus a catch-all that counts every font-size and
  text-color attribute in the XML so a run cannot hide somewhere new. Faded
  unselected marks need a rendered check too (see the step-list note in
  [xml-traps.md](xml-traps.md)).
- **Every gate needs a control** that goes red on its own defect. Gates that had
  never run turned out to be broken (a copy check that rejected a hidden Phone
  copy, a gap control searching a block with no gap run).
- **Gate designs live in their own page.** Calibration fits, the number-provenance
  gate, the coverage gate, color-vision checks and the HTML-twin gates are in
  [gate-designs.md](gate-designs.md).
- **Straight quotes at the start of a run render as closing quotes.** Write the
  curly characters yourself (U+201C, U+201D), with an editor tool, not a shell
  heredoc.

## 5. The Pages card (year slider with Play)

A Tableau Pages card is a good time control and readers like it. In a dashboard
it failed twice, for reasons that look like a bug in the card:

- **Another zone sat on top of it.** A legend zone that spanned the card's full
  width came later in z-order and swallowed every click. In authoring mode, a
  click selects the TOP zone at that point, so a dead control usually means a
  zone is covering it. Fix by trimming the covering zone, and add a gate that no
  later zone in the same layout intersects the card's rectangle.
- **The year box showed empty** because "Show history controls" squeezed it to
  about 35 px. Turn that off in the card's Customize menu. Tableau writes the
  dashboard zone with `type-v2='currpage'`, `synchronized='1'` and
  `trailctrls='0'`; gate that every currpage zone carries `trailctrls='0'`.
- Ruled out as causes: the animation settings and the worksheet window's card
  strip. Re-adding the field to the Pages shelf with animation on raised an
  internal assert; do not chase it.
- Also: the card's title and icon colors cannot be set from the zone XML, so on a
  dark page it stays a white card.
- Why it matters: a time slider is fine in a dashboard even if your other
  interfaces ban sliders.

## 6. Driving the GUI without ruining the person's day

- **Render loops pop windows.** A render script that launches Tableau 14 times
  needs the foreground and fights the person working on the same screen. Batch
  every source edit first, then run renders only when the person says they have
  stepped away. Pure-Python work and headless browser shots need no wait.
- **Scaled displays: the web is the truth.** At 150 percent display scaling,
  local Tableau scales fonts 1.5x but not the dashboard, while Tableau Public on
  the web draws at 100 percent, so web text measured 0.66x the local width.
  Layouts calibrated on local shots look sparse on the web. Render with the
  executable marked DPI-unaware for the run (an AppCompat registry flag, removed
  afterwards, and removed by hand if a run is killed or the person's own Tableau
  looks blurry), and verify against headless browser shots of the published
  view with `?:showVizHome=no&:embed=y&:device=phone`.
- **A phone layout cannot be screenshotted headlessly. Render it through a
  "gallery" dashboard.** Build an extra dashboard holding the SAME phone zones
  (same sheets, text and phone background PNG) cut into screen-height slices at
  the gaps between cards and laid side by side on one fixed canvas (2 to 3 columns,
  822 or 1221 px wide). Open it in presentation mode (F7), screenshot, and map each
  slice back to page pixels 1:1. Nothing is re-authored, so it proxies the Phone
  device layout. Read the composed sheet whole; never crop to 375. A render script
  for all dashboards launches its own PID, waits until two shots 4 s apart match,
  presses F7 only while Tableau is foreground, shoots, and kills its own PID
  (about 25 min for 14 layouts; run it in the background).
- **Phone proof is a proxy.** Headless shots at `:device=phone` and the gallery are
  not Tableau's Device Preview. Say so in the report.
- **Heredoc `\b` becomes a literal backspace (0x08).** A shell heredoc eats one
  backslash from `\\`; a non-raw Python string or JS template literal then turns
  the surviving `\b` into the BACKSPACE byte. The regex still parses and matches
  nothing, or, unanchored, matches inside other words ("device" matched `/ice/` and
  the wrong petal glowed). Write regex-bearing code with the editor tool, then
  sweep: `grep -c $'\x08' file` must be 0. A non-breaking space in a patch will
  not match inside a heredoc either.
- **Python helpers and import paths.** `python -I` drops the script directory and
  breaks sibling imports (and hides user-site packages, which is its other failure
  for speech-to-text tools). `python -s` skips only the user site; `PYTHONPATH=.
  python` keeps both.
- **Internal Error 6EA18A9E.** Re-adding Year to the Pages shelf with animation ON
  threw it (a logic assert in a page-interval helper). It was not needed for the fix;
  do not chase it. Also, authoring-mode clicks on a dashboard select the TOP zone at
  that point, so a later-in-z-order wide zone silently kills a control.
- **Foreground guard.** Every scripted click or key first checks that Tableau is
  the foreground window and refuses to send otherwise. One calibration click once
  landed in a terminal the person was typing in.
- **Save As by mouse.** Open the File menu with the keyboard, then CLICK
  "Save As..." (the `a` accelerator is ambiguous with "Save to Tableau Public
  As..."), then drive the Win32 dialog: set the filename edit box, click Save.
  Never send Ctrl+S ([never-ctrl-s-on-public.md](never-ctrl-s-on-public.md)).
- **Diffing big workbooks.** A Python `difflib` on two 1 MB `.twb` files times
  out; use `git diff --no-index`. Patches containing a non-breaking space fail to
  match in a shell heredoc: use an editor tool.
- **Resizing a finished design.** Keep one scale factor applied in one place
  (all geometry through `s()`, fonts through `pt()`). Mark sizes in Tableau are
  absolute pixels and do not grow with the dashboard, so re-measure them from
  screenshots: a shape's width is linear in its size value, a circle's area goes
  with the square. A locked map frame needs no change if the zone keeps its
  aspect ratio. Regenerate shell art at native size rather than scaling the old
  PNG.

## 7. Packaging without the GUI, and its limit

You can write the `.twbx` from a script: rewrite each extract path to
`Data/extracts/<name>.hyper`, each background image path to `Image/<name>.png`,
and embed the custom shapes as base64 in the `<external><shapes>` block. In one
project the extracts came out byte-identical to the GUI-saved package. Mark the
claim "unproven" until Tableau actually opens the packaged file, and render it in
Tableau before the person publishes. If you re-run a build after adding a column
to a source CSV, re-author the template first, because the workbook reads the
template's extract, not the CSV.

## 8. Publishing hygiene

The person clicks Publish; Claude never does, unless the owner explicitly says
"publish" (see the exception below). Before the click: all pages
rendered in Tableau first, the published view checked in a headless browser, and
a list of what is still unproven (for example, base-map labels drawn by Tableau on
map tiles that XML cannot hide without base-layer ids from a GUI save).

**The explicit-permission exception.** Two workbooks were published at the owner's
word. The route: File menu, press Down 7 times to "Save to Tableau Public As...",
Enter (send it WITHOUT re-focusing the window, since refocusing closes the menu),
type the title, click Save. The remembered session means no sign-in prompt, and
re-publishing over the same title overwrites the same URL. Presentation mode (F7)
hides the menu bar, so press Esc before the keys. Only the owner can delete a
published viz, so a wrong publish cannot be undone by the tool.
[never-ctrl-s-on-public.md](never-ctrl-s-on-public.md) stays the default.

## 9. Verify the published view in a clean browser, and in forced dark mode

Never judge the published page from the author's own browser: its auto dark mode
changes what you see. Render the live view (`?:showVizHome=no&:embed=y`) in a clean
Playwright browser for true colors, AND with `--blink-settings=forceDarkModeEnabled=true`
(about 40 s per load, `:refresh=yes`).

- Edge `enable-force-dark` and Chrome Auto Dark Mode repaint dark TEXT light but
  leave a baked PNG card alone, so a light card plus auto-lightened text reads
  washed out (a reader's real complaint).
- What fixed it: a full dark theme. Dark baked cards (for example `#15233d`), light
  inks, chart colors lifted for the dark ground, a heat ramp that brightens with
  share, and the active nav pill as white text on a mid blue with a white ring
  (navy text on white gets repainted pale).
- Tooltips keep DARK inks because Tableau draws them on white; gate that
  separately.
- A hidden axis ruler turns into a white line on a dark card (see
  [xml-traps.md](xml-traps.md)).
- Known and unfixable here: under force dark, Tableau's own radio widget turns the
  selected dot light, so "All" can read as unselected.
