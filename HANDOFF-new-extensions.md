# Handoff: two new C-Tableau extensions (11/24/2026, written 9:40 PM)

## Standing constraints (coordinator, 9:24 PM, from Chris)
- Celia is pushing settings-panel fixes to the GitHub repo. Until her push is merged: do NOT edit `shared/ctab-panel`,
  do NOT re-vendor, do NOT touch any other `tableau-*` folder. Work only in `tableau-settings-panel/` and
  `tableau-panel-chart/`. Commit, never push. After the merge, both extensions must adopt her panel changes (specifics to come).
- Nothing in `shared/` or other extensions has been edited by this session.

## Done
- **tableau-settings-panel** (dashboard extension, port 8777), commit `febc55f` on main.
  - `node test/run.js`: GREEN 71 checks (11 params, 8 filter controls, 10 files scanned).
  - `python test/browser_test.py`: GREEN 116 of 116 over 14 groups (floor and contrast 656 to 661 texts per theme over
    3 themes; overlap 127 and 144 texts; sheet390 15 tab buttons; frames n=286, median 16.7, p95 16.7, max 16.8 ms).
  - `python test/sabotage.py`: 20 of 20 RED over three runs (17, then 3 after a CRLF anchor fix, then #10 and #17
    again after the highlight change), every file restored byte-exact, final gates GREEN.
  - Previews: `tableau-settings-panel/preview/settings-panel-{1280x800,1280x800-dark,390,390-dark}.png`.
- Repo `README.md` (UNCOMMITTED): two rows for the new extensions, plus a "Get updates" section the coordinator asked for.
  The second bullet was checked against the manifests: every repo `.trex` loads from localhost (8765 to 8778); only the
  hub's `.trex` files (c-tableau.netlify.app) and `garden-petals/exchange` load from a site. So the section says
  hub downloads update on their own, repo copies need `git pull`.
  Commit it: `git add README.md && git commit -m "..." -- README.md` (with the two trailer lines).

## In flight
- **tableau-panel-chart** DONE: commit `bd53b92`. unit GREEN 171414 checks; browser GREEN 332 checks; sabotage 20 of 20 RED,
  byte-exact; previews in `tableau-panel-chart/preview/` (panel 1280x800 and 390, 4 types x light/dark). Its lock dir
  vanished mid-run once (likely regress.sh racing it): check the lock handling before trusting interleaved runs.
- Regression `bash <scratchpad>/regress.sh > <scratchpad>/regress.out`, scratchpad =
  `C:/Users/bioch/AppData/Local/Temp/claude/01dcc376ad19c55a/45c1ea43-8799-4fac-b240-5ea1bba01f12/scratchpad`.
  It takes `scratchpad/browser.lock` (mkdir) per gate. Results so far: 27 gate runs exit 0 (shared panel 4 gates,
  lollipop, tide-lines 3, radar 3, depth-lines 4, sketchbook 4, neurons 2, reef 4, schools unit).
  **One failure**: `tableau-schools python test/render_test.py` exit 1 at CPU 62%: "waiting for locator(".sc-c") to be
  visible" (a timeout). It was still waiting on the lock for schools settings_test and standin_test.

## Next
1. Wait for the regression to finish (`grep REGRESSION regress.out`).
2. Rerun `cd tableau-schools && python test/render_test.py` alone when CPU is under 50%. If it fails a second time with
   CPU over 50%, apply the CPU-stall rule: one Slack post via say-slack.py (`--channel help`), then pause.
   This session changed nothing in tableau-schools or shared/, so a real failure would predate this work.
3. README.md is committed (see git log). Finish the regression: schools settings_test and standin_test, then panel-chart and settings-panel gates once more.
4. Report both extensions as not yet loaded in real Tableau Desktop.

## Gotchas
- Python text-mode writes on Windows turn LF into CRLF and break sabotage anchors: write bytes.
- Commit with `git commit -- <path>` so another agent's staged files never ride along.
- Foreground Bash waits are cut at about 180 s; use run_in_background or Monitor.
