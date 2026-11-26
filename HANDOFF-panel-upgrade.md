# Handoff: ctab-panel 1.1.0 (Celia's panel ideas), 11/24/2026

## Mission
Chris 9:52 PM: "check her settings with ours and make sure ours are as good as hers." The task: build every "hers better" and "missing in ours" item from docs/REVIEW-celia-pr1.md into shared/ctab-panel, re-vendor it to every extension that uses the panel, test and sabotage each feature, then run every extension's gates. Never push.

## Done (commits on main, not pushed)
- f758d77: docs/REVIEW-celia-pr1.md committed.
- 0807448: ctab-panel 1.1.0 (js, css, fonts/, README, demo, tests) plus the 9 vendored copies.
- e2255b5: re-vendored the CSS. The `.cp-tabfoot` rule landed after the first vendor pass, so sync_check was RED for one commit.
- 1b7b9e3: shared/ctab-panel/preview/*.png (light, sheet, grayed rows, dark colors, pinned 1280, diagnostics).

Gate results (last full runs):
- `node test/schema_test.js`: GREEN 308 checks (floor 170)
- `python test/panel_test.py`: GREEN 355 checks in 35 groups (floor 340)
- `python test/sync_test.py`: GREEN 13 checks (fonts cases added)
- `python shared/ctab-panel/sync_check.py`: GREEN, 9 copies match byte for byte, 9 files each. The 4 on the SKIP list are garden-petals, knowledge, lollipop and range-dot.
- `python test/sabotage.py`: 63 sabotages in total.
  - The full run (60 of 63 RED) ended with both gates GREEN and sha256 restored.
  - Three did not go RED at first because their checks could not fail. Each was fixed:
    - Dock: `hidden` lost to `display:inline-flex`, so the sabotage now renames the button.
    - Disabled controls: the sabotage is now an opacity .5 fade.
    - Blocked localStorage: a new panelState fallback check catches it.
  - The rerun of those 3 (`SAB_ONLY=...`) was 3 of 3 RED, and the final gates were GREEN with the files byte-exact.

Status of the 10 items (all in shared/ctab-panel/ctab-panel.js and .css):
1. Diagnostics: done. Panel tab Show/Copy, `CTabPanel.diagButton`, error and unhandledrejection listeners. Tested by groups diag and unit.
2. Per-machine habits and HYDRATE: done. Key `ctab:<prefix>panel`; the 1.0.0 `<prefix>_panel` is hydrated once and kept. Tested by groups persist and machine plus unit.
3. Pin plus accordion and reflow: done. Tested by group pin.
4. Revert to when I opened: done. Tested by group revert.
5. Save-status line: done. Tested by group savestatus.
6. Copy formatting / Copy everything, labeled block, cross-chart paste, last copy: done. Tested by group copyfmt plus unit.
7. Grayed-out rows at 7:1 with a reason line: done. Tested by groups conditional and contrast (opacity- and alpha-aware audit) plus unit.
8. Dock button and double-click toggle: done. Tested by group dock.
9. Inter and Poppins bundled as woff2 with OFL licenses, hashed by sync_check: done. Tested by group fonts and sync_test.
10. Text size chips, panel text size, title placeholders, result-labeled options, dark palettes, one-click setups: done. Tested by groups textsize, titles, options, darkpal and action plus unit.

Smoothness: group frames (rAF during drag, pin and dock), plus a jank sabotage.

## In flight
A Sonnet subagent ("Wire ctab-panel 1.1.0 into extensions", launched by the Opus session) is doing the extension side for depth-lines, neurons, panel-chart, radar, reef, schools, sketchbook and tide-lines:
- info().data and tokens, `version`, `diagButton` on the empty state, `trace`
- standalone rebuilds for radar and tide-lines, plus fonts there
- updating extension tests for the by-design changes
- running ALL gates for the 9 extensions through the turnstile, regenerating previews, and committing per extension

At handoff, uncommitted edits from it were in tableau-*/src, test and preview. Do NOT stage those yourself. Wait for its report or check `git log`.

## Next
1. Collect the subagent's report: per-extension gate lines with counts, sabotage counts, preview paths and commits. If it reported a library bug, fix it in shared, re-vendor all 9, run sync_check, rerun the shared gates and sabotage, then commit.
2. Polish found at the end: in the pinned strip (360 px wide, 44 px buttons) the footer wraps to 4 rows (about 240 px). See preview/panel-pinned-1280.png.
   - Option A: smaller footer buttons when pinned.
   - Option B: a single "Copy and paste" disclosure.
   - My pick: Option A plus making the footer row scroll with the body when pinned.
   - Then rerun panel_test and sabotage.
3. Final report to Chris (bullets): commits, the 10 items with evidence, gate lines, sabotages, sync line, previews, and what is unproven.

## Unproven
Nothing has been tested in real Tableau Desktop, specifically:
- saveAsync rejection text in viewer mode
- localStorage availability inside the Tableau extension frame
- Pin reflow inside a real dashboard zone
- font loading in Tableau's embedded Chromium

## Rule conflicts in tableau-range-dot (Celia's; NOT edited, Chris decides)
- 12 range sliders (rule 3). Our replacement would be typed steppers.
- 19 font declarations at 11 to 13 px (14 px floor).
- Text contrast below 7:1:
  - hint 4.55
  - section header 3.88
  - Apply button 4.12
  - slider value 3.03
  - blank-reason line 2.64
- Grayed rows faded by opacity .45.
- A "-v2" key reset that discards saved settings (rule 4; ours uses HYDRATE).
- Not house-rule items, but bugs:
  - viz.js:49 has literal backspace bytes in `\bcap\b`.
  - serve.js binds every interface and crashes on a malformed URL.
  - Port 8771 clashes with tableau-schools.

## SKIP list verdict
None of the 4 should join by re-vendoring:
- knowledge is a docs folder, not an extension. Consider excluding it from the glob.
- lollipop and garden-petals have their own settings UIs, so joining is a port job (a separate task).
- range-dot is Celia's.

## Memory note
MEMORY_tableau says sliders are OK on Tableau dashboards (Pages slider, 10/28). This task's instruction said no sliders anywhere in the panel, and the panel has none.

## Gotchas
- `node`/`npm` commands are auto-routed through the turnstile. A heredoc inside a routed command gets mangled, and patches silently did not apply twice. Write patch scripts to the scratchpad and run them with python.
- sync_check piped to `tail` hides its exit code. Check `$?`.

## Resume point 11/25 2:45 PM (paused for Chris's Skiffstorm window, resume after 8:30 PM)
Nothing from the extension wiring is committed yet; the 42 files are still uncommitted (snapshot refs/wip/panel-1125 = 22026db). Gate logs: scratchpad/g8/ (summary.txt).
The panel-chart sabotage was killed mid-run with #4 planted; restored by hand and every panel-chart src file matches the snapshot by sha256.

GREEN since the font-wait fix (g8): depth-lines standin 40 and run.js 120; radar run.js 177 and standin 92; reef run.js 192, render 1639, settings 91, standin 96; tide-lines run.js 153; sketchbook render 3271, panel 55, run.js 96; neurons run.js, and sabotage 21 of 21 RED, restored; panel-chart run.js 171416; settings-panel run.js 71.

RED, to fix first:
- tide-lines mock_render and standin: pageerror "Cannot read properties of undefined (reading 'padding')" (fixture empty; nested/no-prefix click). Likely the new _fontWait block in tableau-tide-lines/src/js/render.js (fix_fonts2.py) running a redraw before layout/state exists. Root-cause it.
- radar mock_render: "animation: eased growth is sampled mid-way (intermediate radii seen)". Likely the _fontWait redraw restarting or skipping the growth animation. Check radar render.js _fontWait.
- schools: render_test "stress morph: script cost per frame <= 6 ms :: 7.41" and run.js "2,000 circles settle in under 6000 ms (6542 ms)". Both are timing; CPU was 40 to 44% with other tabs' jobs. Rerun alone at low CPU before touching code (rule 19 if it fails twice on load).

Still to run: sabotages for panel-chart, radar, reef, schools, sketchbook, tide-lines, depth-lines, settings-panel; standalone rebuilds for radar and tide-lines; previews. Then commit per extension until git status is empty.

## Final state 11/25 9:45 PM (extension side)
All 9 extensions are committed; `git status --short` is empty. sync_check GREEN (9 copies match shared/, exit 0).

Root causes of the three REDs
- tide-lines "reading 'padding'": the g8 logs were written 30 s before the final render.js edit (log 13:59:51, render.js 14:00:21). The earlier _fontWait redraw passed the wrong arguments. The current code redraws with the stored [model, s, hooks] and passes.
- radar "eased growth sampled mid-way": the first draw is now held until the fonts load (render.js returns before drawing), so the redraw cannot cut off or replay the entrance animation. The g8 failure predated that edit.
- schools stress morph p95 and script cost: not load (it failed at 23% CPU). render.js had two font-load redraw blocks (_fontWait and _fontTried), so a second redraw could land mid-morph. The duplicate _fontTried block is removed.

Gates (g9 logs in the session scratchpad)
- tide-lines: mock_render GREEN 18 cases, 325 checks; standin GREEN 10 pages, 97 checks; run.js GREEN 153.
- radar: mock_render GREEN 28 cases, 352 checks; standin GREEN 9 pages, 92 checks; run.js GREEN 177.
- schools: render_test 3,123,290 subjects, 0 failed; run.js 218 passed; settings_test all 89 settings; standin 111 subjects, 0 failed.
- neurons: run.js GREEN; render.py GREEN 7 gates, 22,620 subjects.
- panel-chart: run.js 171,416 checks; browser_test 332 checks.
- depth-lines: panel_test 53 checks, 91 settings; run.js 120 checks.
- reef (render 1,639; settings 91; standin 96; run.js 192) and sketchbook (render 3,271; panel 55; run.js 96): g8 results, files unchanged since.

Sabotage (src, test and tools sha256 identical before and after; git status unchanged)
- neurons 21 of 21 RED (earlier run)
- panel-chart 20 of 20 RED
- radar 14 of 14 RED
- tide-lines 13 of 13 RED
- STILL OWED: reef (tools/sabotage.py), schools (tools/sabotage.py), sketchbook (tools/sabotage_check.py), depth-lines (tools/sabotage_check.py), settings-panel (test/sabotage.py). The chain was stopped by PID after tide-lines so the hub could build from a clean tree. Run them one at a time after the hub ships.
- The radar and schools-era commit messages lack a blank line before the trailers.

## Sabotage proofs owed, run 11/25-26 (g10)
Each ran alone through the turnstile. `git status --short` empty before and after; sha256 of every src/, test/ and tools/ file identical before and after (logs in the session scratchpad g10/, *.sha.before and *.sha.after).

| Extension | Result | Restored | Gates after |
|---|---|---|---|
| reef | 21 of 21 RED | byte-exact, yes | run.js 192, render 1,639, settings 91, standin 96, all GREEN |
| schools | 24 of 24 RED | byte-exact, yes (46 files) | run.js 218, render, settings 89, standin 111, all GREEN |
| sketchbook | 12 of 12 RED | yes | all gates GREEN |
| depth-lines | 11 of 11 RED | yes | all gates GREEN |
| settings-panel | 20 of 20 RED | yes | unit 71 checks, browser 116 of 116, GREEN |

Test and tool fixes (the first full runs found these; every one was a stale or flaky check, not a gate without teeth)
- reef 08de618 and schools 119062c: the "text drops to 13px" sabotage looked for a stale 14px `.cp-help` line (BROKEN, proved nothing). It now plants 13px over the shipped 1em rule and render_test goes RED (reef `--only 14`, schools `--only 13px`). reef also gained an `--only N` flag.
- sketchbook c53243f and depth-lines b670592: the vendored-panel drift sabotage needle was VERSION 1.0.0; the panel is 1.1.0 (FAIL inverted before).
- sketchbook 115df72 and depth-lines 09a97c5: panel_test read the sketch signature (sketchbook, typed seed) or band count (depth-lines, typed value) right after the store changed, before the redraw landed. The unmodified tree went RED in 3 of 4 and 2 of 3 solo runs. Now it waits for the redraw; 3 and 4 solo runs GREEN.
- reef run 1 also showed several panel sabotages going RED by Playwright timeout rather than a named assertion (drag clamp, minimize). They are RED; a sharper assertion is a possible follow-up.
