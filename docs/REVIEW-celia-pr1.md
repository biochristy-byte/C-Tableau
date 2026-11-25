# Review: Celia's PR #1 (Range Dot + settings panel guide) against our ctab-panel

11/24/2026. Reviewed commit `91c0ce6` (celiafryar/C-Tableau-contrib, branch `range-dot-and-panel-guide`).

**Status change during the review:** the PR was merged on GitHub at 21:51 (merge commit `afeba6d`) and pulled into
local main as `c393bca` while this review was running. This review did not do that merge. So the merge-safety
section below is a post-merge audit: what is already on main and what should follow it.

Sources read: `settings-panel-guide/README.md`, `settings-panel-guide.md` (all 1,204 lines), the starter embedded in
the guide (identical to `panel-starter.html` by her own sync rule), `tableau-range-dot/index.html` and `viz.js` (panel
sections), `serve.js`, `Start-RangeDot.bat`, `package.json`, `RangeDot.trex`, `mock-tableau.js`, `make_sample.py`,
`lib/README.md`, the OFL license. Ours: `shared/ctab-panel/ctab-panel.js`, `ctab-panel.css`, `README.md`, the
vendored copies (sync gate), `HANDOFF-new-extensions.md`.

Citation keys: **G** = `settings-panel-guide/settings-panel-guide.md`, **RD** = `tableau-range-dot/index.html`,
**JS** = `shared/ctab-panel/ctab-panel.js`, **CSS** = `shared/ctab-panel/ctab-panel.css`, **RM** = `shared/ctab-panel/README.md`.

---

## 1. Verdict summary

| | Count |
|---|---|
| Items compared | **58** (plus 2 not applicable: Range Dot's band editor and data-app "editions") |
| Ours matches | **23** |
| Hers better | **7** |
| Ours better | **16** |
| Missing in ours | **12** |

**What this means:** the two panels share their core: a gear, a floating panel that can be dragged and clamped, tabs,
live preview, a validated paste and a clipboard fallback. Ours is ahead on rules and rigor: the 14 px floor, 7:1
contrast in four themes, no sliders, a schema engine, search, undo, reset with a confirm, keyboard support and
automated tests with sabotage. Hers is ahead on **workflow features we lack**: diagnostics, pin to the side with an
accordion, panel habits kept per machine, copying formatting apart from data-tied settings, a save-status line, and
fonts bundled in the extension. Closing those 12 gaps, plus the 7 "hers better" items, puts ours past hers on every
row.

**Merge safety:** nothing in it is unsafe to have on main. It touches no existing file, makes no outbound network
calls, adds no dependencies, and the font license is OFL. There are **four follow-ups**, all in her files: a port
clash with tableau-schools (8771), `serve.js` binding every network interface, one malformed URL crashing
`serve.js`, and a regex in `viz.js:49` holding literal backspace bytes. Details are in section 5.

---

## 2. Side-by-side comparison

Verdicts: **M** ours matches, **H** hers better, **O** ours better, **X** missing in ours.

### Layout, floating, docking

| # | Her item (evidence) | Ours (evidence) | Verdict | Why |
|---|---|---|---|---|
| 1 | Gear fixed top right opens and closes the panel (G:19) | Gear top right, 40 px, `aria-haspopup`, hidden while open (JS:502-505, 912; CSS:3) | M | Same placement. Ours is a 40 px target against her 30 px. |
| 2 | Panel floats over the chart, no dimming overlay (G:20) | No overlay; absolute panel over the host (CSS:8-11) | M | |
| 3 | A click outside does not close it (G:24) | No outside-click handler; only close, Escape (JS:818, 896, 906) | M | |
| 4 | Drag by title bar, pointer capture (G:25; starter G:540-565) | Pointer events with capture and pointer id, mouse/pen/touch (JS:568-584) | M | |
| 5 | Cannot be dragged out of reach (G:26, 569-579) | Clamped to the host on every move and resize (JS:541-549, 558-566) | M | |
| 6 | **Dock** button in the header, plus double-click the title bar, returns it to the corner and forgets the position (G:25, 768) | Only a "Put the panel back top right" button on the Panel tab (JS:490, 599, 826) | **H** | Hers takes one click from where your eyes already are. Ours means switching tabs first. |
| 7 | **Pin to side**: a full-height strip on the right, the chart reflows narrower, **Float** undoes it (G:27, 769-779) | None | **X** | For long tuning sessions a floating panel always covers part of the chart. |
| 8 | Pinned, the groups become an **accordion** with several open at once and `aria-expanded` headers, and the open set is remembered (G:28, 781-789) | None | **X** | |
| 9 | A small view cannot pin (under 720x420 in the starter, 760 in Range Dot); Pin is disabled with a tooltip saying why (G:775) | Under 420 px wide the panel becomes a full-frame sheet that scrolls as one, with 44 px targets (CSS:82-96; JS:551-557) | O | In a small dashboard zone, hers still floats a 400 px panel. Ours turns into a usable sheet. |
| 10 | Position, pinned state and open sections are kept **per machine in localStorage, not saved with the settings** (G:29, 852) | Panel state (x, y, minimized, tab, theme) is written into **workbook settings** as `prefix_panel`, and every write schedules `saveAsync` (JS:526, 470-471) | **H** | In ours, dragging the panel dirties the workbook, and one author's panel spot follows the workbook to every viewer. These are a person's habits, not part of the chart. |
| 11 | Only the panes scroll; the title bar and buttons stay in view (G:30) | `.cp-body` scrolls, head and foot fixed (CSS:31, 74) | M | |
| 12 | Tabs group rows and wrap (G:31, 946) | Tabs wrap (CSS:28) | M | |
| 13 | Tab order: what the chart is made of, then values, titles, colors, fonts, with fields and tools last (G:946) | Extension tabs first, then Colors, Labels, Number format, Tooltip, Fonts, Background, Animation, Interaction, Fields, Panel (JS:347-348) | M | |

### Change model, reset, validation

| # | Her item (evidence) | Ours (evidence) | Verdict | Why |
|---|---|---|---|---|
| 14 | Live preview about 40 ms after an edit (G:21, 737-741) | Change notices batched to one per animation frame (JS:443-447) | M | Ours runs about 16 ms. |
| 15 | **Apply** saves; **Cancel** and **Escape** restore the applied settings (draft model, G:22, 37-52) | Saves as you go, with an undo stack (100 deep, typing coalesced). Escape only closes (JS:738-743, 789-795, 896) | **H** | Ours cannot back out of a whole session in one move; undoing 15 edits takes 15 clicks. Her Part 2 makes the same save-as-you-go choice as ours but has no undo at all (G:1056). The fix is one "Revert" button (section 3, change 4), not a switch to drafts. |
| 16 | **Reset to defaults** changes the draft only, with a note (G:23) | "Reset this tab" and "Reset all" with an inline confirm that counts the settings and says "You can still Undo" (JS:838-851) | O | Ours is scoped, counted, confirmed and reversible. |
| 17 | Rows that do not apply are **grayed out, not hidden**, so the panel does not jump (G:34, 680-687) | `when` rows are removed from the list (JS:248-262, 687) | **H** | Her reason holds: when a check box hides rows, everything below shifts under the pointer. Her way of graying (opacity 0.45) breaks our 7:1 rule, so ours must gray differently (change 7). |
| 18 | No panel text under 13 px (G:35) | Never under 14 px, tested (CSS:1-2, 11, 37; RM:66) | O | Range Dot itself breaks her 13 px floor: 19 declarations at 11 to 13 px (RD:59, 67, 90, 94, 123, 136, 144, 157, 160, 165-177, 194). |
| 19 | Sliders for continuous values: starter `rng-barwidth`, `rng-gap`; Range Dot has **12 range inputs** (RD:271-549); Part 2 has a text-size slider (G:1164) | Typed stepper with minus and plus, min, max, step and unit, and no range input anywhere (JS:604-608; tested RM:66) | O | **Rule 3 conflict.** Do not adopt. |
| 20 | An emptied number box does not jump to zero (G:422, 992) | `if (t.value === '') return;` (JS:867) | M | |
| 21 | A saved value is checked again where it is used, e.g. decimals clamped before `toFixed` (G:833) | Every number is clamped to min and max and rounded to the step precision on load, paste and edit (JS:190-199) | O | Ours does it once, for every number, at the door. Hers does it case by case. |
| 22 | `withDefaults`: merge over the defaults, bring back to type, drop unknown keys (G:359-372, 827-831) | Per-type `coerce`: select must be a listed option, hex is validated, lists normalized; unknown keys skipped (JS:186-239, 428-437) | O | Hers keeps any string for a select. Ours rejects values the control cannot show. |
| 23 | All settings as one JSON string under one key (G:825) | One string per key under `prefix + key`, and one `saveAsync` per 400 ms burst (JS:456, 438-442; RM:42) | M | A different choice made on purpose: the Viz pages flow reads flat keys. The write count matches hers. |
| 24 | A failed save never stops the chart (G:850) | `saveAsync` errors caught and logged (JS:440) | M | |
| 25 | A **save-status line**: "Saved to the workbook" or "Saved in this browser only (viewing mode)" (G:1030-1051) | A rejected save goes only to `log` (JS:440); the panel says nothing | **X** | A viewer on Server without edit rights changes settings, they vanish on reload, and nothing told them. |

### Copy, paste, portability

| # | Her item (evidence) | Ours (evidence) | Verdict | Why |
|---|---|---|---|---|
| 26 | **Copy formatting** vs **Copy everything**: data-tied keys (`DATA_BOUND`) are left out of a formatting copy (G:32, 910-915) | Copy settings copies every settable key, including field picks and per-category colors (JS:796-799) | **X** | Pasting our copy onto another sheet also pastes the first sheet's field choices and category colors. |
| 27 | The block is labeled `{chart, kind, copied, settings}`; paste refuses a block from a different chart and says why (G:916) | A flat map; unknown keys skipped and counted (JS:288-302) | **H** | Ours cannot say where a paste came from. A Radar copy pasted into Lollipop applies the shared standard-tab keys without saying so. (That cross-chart transfer is worth keeping; see change 6.) |
| 28 | Paste accepts a bare settings object too (G:916) | Accepts the flat map with or without the prefix, or a dotted key (JS:279-291) | M | |
| 29 | Pasted values go into the draft and preview; nothing is kept until Apply (G:918) | Paste applies at once and can be undone (JS:831-836) | M | Undo gives the same safety. |
| 30 | "Use the last copy on this machine": the copy also goes to localStorage, because embedded frames block the clipboard (G:919) | None | **X** | Our fallback opens a box you copy from by hand. Hers skips the clipboard entirely between sheets of the same extension. |
| 31 | Clipboard fallback chain, the result shown on the button, never ask for Ctrl+C inside Tableau (G:921) | Clipboard API, then `execCommand`, then a box with the text, plus a status message (JS:796-812) | M | |
| 32 | Bad paste refused with a message, nothing changes (G:990) | Three distinct messages, nothing applied (JS:282-285, 298, 834) | M | |

### Diagnostics and resilience

| # | Her item (evidence) | Ours (evidence) | Verdict | Why |
|---|---|---|---|---|
| 33 | **Diagnostics** report as JSON: name and version, view, browser, data received (rows, fields, sample, native and formatted values), automatic picks, the last draws, errors, settings, the draft (G:33, 923-942) | None in `shared/` (only `tableau-garden-petals` has its own) | **X** | Her strongest idea. An extension inside Tableau has no console, so every remote bug report starts with guessing. |
| 34 | The same Diagnostics button on the empty or error screen (G:938; RD:216) | None | **X** | Diagnostics matter most when the chart is blank. |
| 35 | `window` `error` and `unhandledrejection` listeners feed the error list (G:933; RD viz.js:1468-1469) | None in `shared/`; only garden-petals viz.js | **X** | |

### Richer settings patterns

| # | Her item (evidence) | Ours (evidence) | Verdict | Why |
|---|---|---|---|---|
| 36 | Per-item lists keyed by name, a "Reset these" button, and an empty state that says what would fill it (G:862-871) | `list` row: keyed, merged with live items, rename, recolor, hide and reorder, "Reset names, colors and order", and "Nothing to list yet. Add the field to the shelf first." (JS:306-319, 647-658) | O | Ours adds rename, hide and reorder. |
| 37 | Automatic with an override, showing what Auto picked (G:891-897) | `Auto (Region)` as the first field option (JS:642-645) | M | |
| 38 | **Title placeholders** `{top}`, `{n}`, `{value}` that refill when filters change (G:899-901) | `titleText` is plain text (JS:381) | **X** | A title written once stays true after a filter. |
| 39 | **One-click setup** buttons that write several settings at once, then preview (G:884-888; RD:263) | No row type for it | **X** | |
| 40 | A hint line under a row (G:903-906) | `help` under every row (JS:664) | M | |
| 41 | Segmented buttons, not dropdowns, for 2 to 4 choices (G:1139) | `chips` with `aria-pressed` (JS:619-622) | M | |
| 42 | **Label an option with its result**: `$2.3M` and `$2,326,553`, not "Compact" and "Full" (G:1140) | Partly: "Short form (1.2K, 3.4M)", "100 (percent)"; but "Comma / Space / None", "Regular / Bold" (JS:360, 367-369) | **H** | Hers applies the rule everywhere. Ours names the separator instead of showing `1,234,567`. |
| 43 | Palettes as buttons with color chips (G:1141) | Palette buttons with a color strip and a "colorblind-safe" tag (JS:636-640) | M | |

### Look, fonts, theming

| # | Her item (evidence) | Ours (evidence) | Verdict | Why |
|---|---|---|---|---|
| 44 | The panel is always light (G:1167); fixed colors in the starter | Light, dark, match the chart, or custom, and every color is forced to 7:1 (JS:115-150, 487-489, 530-537) | O | Measured on her starter colors: hint `#6b7280` 4.55:1, section header `#2f7ed8` 3.88:1, Apply and active tab (white on `#2f7ed8`) 4.12:1, Range Dot slider value 3.03:1, Range Dot blank-reason line 2.64:1. All are below our 7:1. |
| 45 | **Text size and density as settings** (G:955, 1146-1164) | Sizes are set one element at a time (JS:359, 364, 374, 382); no global scale, no density | **X** | Charts read at a distance (meetings, wall screens) need one control that scales everything. Hers is a slider, so ours uses chips (change 10). |
| 46 | **Each palette has a dark variant**, swapped in when the theme is dark (G:1165) | One color set per palette (JS:37-45) | **X** | A palette tuned for a white page loses contrast on a dark worksheet. |
| 47 | Versioned storage key; "change to `-v2` and old saves are ignored" (G:1189) | Per-key `coerce`, so old saves load and invalid keys fall back to the default (JS:428-437) | O | **Rule 4 conflict:** her `-v2` route throws away saved work. Ours keeps it, and a real schema change gets a HYDRATE migration. |
| 48 | **Bundled font**: Poppins, 4 weights, offline, OFL, and offered as a font choice (RD:7-15, 536) | The default font is named "Worksheet font (Inter)" (JS:24), but Inter ships only in `tableau-depth-lines/lib/fonts` and `tableau-sketchbook/lib/fonts`. In the other 10 extensions it quietly falls back to Segoe UI. No Poppins choice. | **H** | Hers renders the same on every machine. In most of our extensions, ours names a font that is not there. |

### Accessibility, architecture, process

| # | Her item (evidence) | Ours (evidence) | Verdict | Why |
|---|---|---|---|---|
| 49 | Part 2: `role=dialog`, tablist with `aria-selected`, radiogroup, focus moves, visible focus outlines, labeled gear. She notes her starter lacks the roles and focus moves (G:1191-1198) | Dialog with label; tablist with arrow, Home and End keys and roving tabindex; chips with `aria-pressed`; focus into the panel on open and back to the gear on close; 3 px outlines; `role=status` live region; alertdialog for the reset confirm (JS:503-515, 670, 896-903, 910-921; CSS:80) | O | Ours meets her own Part 2 list, and her starter does not. |
| 50 | Pure drawing code: `draw(data, cfg)`, never reading shared state (G:52) | Renderers read `store.get()` at draw time (RM:57) | M | With save-as-you-go and no draft, this is her Part 2 model (G:1202), and it is sound. A Revert button needs no draft. |
| 51 | Three edits per setting by hand, or "a schema once past about 60 settings" (G:791-821, 953) | Schema engine with `standard()` tabs; one line per setting; a sync gate over 9 vendored copies (RM:24-42; `sync_check.py`) | O | Her guide's README sends repo builders to ours. |
| 52 | 21-step manual test list (G:970-995) | `schema_test.js`, `panel_test.py` in Chromium, `sync_test.py`, and `sabotage.py` with 28 sabotages restored byte for byte (RM:61-70) | O | Ours proves itself on every run. Hers depends on a person running it. |
| 53 | A gear that fades when the pointer is elsewhere, so it stays out of screenshots (G:956) | Opacity 0.82, full on hover or focus (CSS:4-5) | M | |
| 54 | No separate window or dialog for settings (G:966) | No browser dialogs anywhere (JS:10) | M | |

### Ours only (her guide has no counterpart)

| # | Ours (evidence) | Verdict |
|---|---|---|
| 55 | Search across every tab (JS:513, 270-277, 675-685) | O |
| 56 | Minimize to the title bar (JS:511, 819) | O |
| 57 | Arrow keys on the focused title bar move the panel 16 px (JS:585-590) | O |
| 58 | Undo stack, 100 deep, typing coalesced (JS:738-743, 789-795) | O |

Not counted: her editable threshold-band list (Range Dot only, G:873-882) and data-app editions from a preset file
(G:1169-1189). Neither applies to a shared panel library.

---

## 3. Change list: bring ours up to hers, then past it

Ranked by what each one does for a person using our extensions. Unless marked, every change goes in
`shared/ctab-panel/` (js, css, README, demo, tests and a sabotage for each), then a re-vendor into all 9
`tableau-*/lib/ctab-panel/` copies (tableau-settings-panel and tableau-panel-chart included), with `sync_check.py`
GREEN. The HANDOFF freeze on `shared/` was "until her push is merged". It is merged, and her PR touched nothing in
`shared/`, so this list is the "specifics to come" for adopting her panel ideas.

| Rank | Change | Items | Files | Rule notes |
|---|---|---|---|---|
| 1 | **Diagnostics.** A Diagnostics section on the Panel tab: Show, then Copy (same clipboard chain). The report is JSON with name and version, view size and pixel ratio, browser, data received (rows, field names and types, 4 sample rows with native and formatted values), `info().auto` picks, the last 6 draws (new `panel.trace({w,h,marks})`), the last 20 errors (`create()` installs `error` and `unhandledrejection` listeners), settings and panel state. Export `CTabPanel.diagButton(host)` for blank and error screens. The hint warns that sample rows are included. | 33, 34, 35 | shared + each extension: one `trace()` call per draw, one `diagButton` on its empty state | 14 px, 7:1, no dialogs: all met by reusing `cp-` classes |
| 2 | **Panel habits per machine.** Move x, y, minimized, tab, theme (and pinned and open sections from change 3) to `localStorage` under `ctab:<prefix>panel`, with try/catch and an in-memory fallback. Stop writing `_panel` to the workbook, so dragging no longer calls `saveAsync`. **HYDRATE:** on first load, if `prefix_panel` exists in the workbook and localStorage is empty, copy it over once, so nobody loses a chosen theme (rule 4). | 10 | shared only | Rule 4: migration, never a wipe |
| 3 | **Pin to side and accordion.** A header button, "Pin to side" or "Float". Pinned: a full-height strip 360 px wide on the right, and a new `opts.onLayout({ reserveRight })` callback that each extension uses to redraw narrower. The tabs become accordion headers (real buttons with `aria-expanded`, several open at once, the open set remembered per change 2). Pin is disabled with a stated reason when the host is under 760x420. The existing under-420 px sheet stays. | 7, 8 | shared + each extension's resize path (confirm each redraws on `onLayout`) | 44 px targets on the strip, as on the sheet |
| 4 | **Revert, which beats both her Cancel and her Part 2.** Keep save-as-you-go and undo. Add **"Revert to when I opened"** to the footer: `open()` takes a snapshot, and Revert restores it in one `bulk()`, which can itself be undone. A person gets her one-click back-out, ours keeps live saving, and nothing is ever lost. If Chris wants her exact draft model too, it can be an `opts.mode: 'draft'` option later. | 15 | shared only | |
| 5 | **Save-status line.** The store reports `saveAsync` results to the panel through the existing `role=status` line: "Saved to the workbook", or on rejection "These changes last for this visit only: this view cannot save to the workbook." | 25 | shared only | Plain words, no em dash |
| 6 | **Copy formatting, Copy everything, a labeled block, and the last copy.** A row flag `data: true` (`field` and `list` rows get it by default). Copy formatting leaves those out; Copy everything keeps them. The block is `{ chart: <prefix>, name, kind, copied, settings }`. **Going past hers:** instead of refusing a block from another C-Tableau chart, apply the shared standard-tab keys and say so ("From Radar: applied 31 shared formatting settings, skipped 4 only Radar has"), because our 12 extensions share `standard()` and a look should move between chart types. Also write the copy to localStorage and offer "Use the last copy on this machine". That works across sheets of the same extension; extensions on different ports are different origins and cannot share it. | 26, 27, 30 | shared only | |
| 7 | **Gray out, do not hide.** Rows whose `when` fails render disabled (`aria-disabled`, controls disabled) with a help line at full 7:1 saying what turns them on ("Turn on Show labels to use this"). Disabled state is shown with a dashed border and a lock glyph, **not opacity**: her 0.45 opacity takes `#555` text to about 2:1. A per-row `hideWhenOff: true` remains for rows that only add clutter. Search lists disabled rows too. | 17 | shared + panel_test 14 px and 7:1 sweeps extended to disabled rows | **7:1 conflict in her method, avoided** |
| 8 | **Dock in the header, plus double-click the title bar.** A 36 px icon button labeled "Dock the panel top right". Double-click on the head resets the position. The Panel-tab button stays. | 6 | shared only | |
| 9 | **Bundle the fonts.** Put `inter-latin-wght-normal.woff2` (OFL, already in depth-lines) and Poppins (OFL, from Celia's assets; convert the 4 TTFs, 632 KB, to woff2) in `shared/ctab-panel/fonts/`, with `@font-face` in `ctab-panel.css` using relative URLs. Add "Poppins" to `FONTS`. Extend `sync_check.py` to hash the font files. | 48 | shared + re-vendor (fonts folder) | Sans-serif only rule kept |
| 10 | **Text size and density, without a slider.** On the standard Fonts tab: Text size as chips (100%, 115%, 130%, 145%) that scale every chart text size upward only, so the 14 px floor holds; Density as chips (Comfortable, Compact). Optionally the same text size on the Panel tab for the panel itself. | 45 | shared + each renderer multiplies its sizes by `textScale` | **Rule 3: her text-size slider replaced by chips** |
| 11 | **Title placeholders.** `titleText` accepts `{n}`, `{top}`, `{total}` and any `info().tokens` an extension supplies, and the help line lists those available. | 38 | shared + each extension supplies its tokens | |
| 12 | **Option labels show their result.** Thousands chips read `1,234,567`, `1 234 567`, `1234567`; a live "Shows as 12,345.6" line under the Number format tab; weight chips drawn in their own weight. | 42 | shared only | |
| 13 | **Dark palette variants.** Each palette gets a `dark` set, used when the chart background is dark (`bestInk` is light), with a 3:1 non-text contrast check against the background in `schema_test.js`. | 46 | shared only | 7:1 stays for text; marks use WCAG 3:1 |
| 14 | **An `action` row type for one-click setups.** `{ type: 'action', label, apply(settings, info) -> values }` runs through `bulk()`, so it can be undone and it reports in the status line. The content is per extension. | 39 | shared + extensions that want presets | |

### House-rule conflicts in her guide (do not adopt)

| Her item | Rule | Our equivalent |
|---|---|---|
| Range inputs: starter `rng-barwidth`, `rng-gap` (G:187-192); 12 in Range Dot (RD:271-549); text-size slider (G:1164) | Rule 3, no sliders | Typed stepper (our `number` row), chips for scale |
| 13 px floor (G:35); Range Dot goes down to 11 px (19 declarations) | 14 px floor | 14 px |
| Colors under 7:1: hint 4.55, section 3.88, Apply 4.12, slider value 3.03, diag line 2.64, Reset 6.15, reset note 5.85 | 7:1 text contrast | Our `tokens()` forces 7:1 |
| Grayed rows at opacity 0.45 (G:132) | 7:1 | Change 7: disabled styling without a fade |
| "Change the key to `-v2` and old saves are ignored" (G:1189) | Rule 4, never wipe saved work | Per-key coerce plus a HYDRATE migration |
| Em dashes | Rule 2 | **0 found** in her 16 text files (U+2014 and U+2013; the positive control printed True) |

**Range Dot itself** is now on main with 12 sliders and text down to 11 px. It is Celia's extension (id
`com.xeomatrix.vizext.rangedot`), so this review proposes no edit to it. Chris decides whether the house rules apply
to a contributed extension. If they do, the clean route is a follow-up PR to Celia: steppers for the 12 ranges and a
14 px floor.

---

## 4. Proof of the comparison

| Check | Result |
|---|---|
| Guide read in full | 1,204 of 1,204 lines (two reads: 1-991, 992-1205) |
| Our panel | ctab-panel.js lines 186-262, 279-480, 480-665, 673-933 read; css 1-98; README 1-70 |
| Sync gate | `python shared/ctab-panel/sync_check.py`: `GREEN 9 copies match shared/ byte for byte (4 extensions still on the SKIP list)`; tableau-range-dot is on the SKIP list (it has its own panel) |
| Contrast numbers | WCAG relative luminance, computed in Python on her hex values; control `#14202e` on `#fff` = 16.46 |
| Inter bundling | `find -iname "*inter*.woff*"`: 2 hits (depth-lines, sketchbook) across 12 extensions |

---

## 5. Merge-safety code review (post-merge)

**Verdict: safe as merged. No change is required for safety. Four follow-ups should land soon, in her files.**

| File | What it does | Findings |
|---|---|---|
| `Start-RangeDot.bat` (14 lines) | `cd /d "%~dp0"`, checks that `node` exists, runs `node serve.js`, pauses | Nothing beyond that. Safe. |
| `serve.js` (74 lines) | Node built-ins only (`http`, `fs`, `path`). Reads files under its own folder and answers GET with them; no writes, no child processes, no outbound calls. Default port **8771**, or `argv[2]` | **(a) Binds every interface.** `server.listen(PORT)` has no host; measured: `0.0.0.0:18771` and `[::]:18771` LISTENING. Anyone on the same Wi-Fi can read the folder while it runs. Fix: `server.listen(PORT, '127.0.0.1')`, with the `.trex` left at `localhost` (Chromium tries both loopback addresses). *Unproven: that Tableau Desktop loads it after this change; test once.* Ours binds loopback only (`Start-PanelChart.ps1:34`, HttpListener `http://localhost:$Port/`). **(b) One bad URL kills the server.** `decodeURIComponent` on `/%E0%A4%A` throws outside any try; measured: the request returned 000, then `/` returned 000 too, and the log ends with a Node stack trace. Fix: wrap it and return 400. **(c) Path traversal is contained:** `/..%2F..%2FREADME.md` served Range Dot's own README, and `/..%5C..%5Ctableau-schools%5Cschools.trex` returned 404. Hardening: compare against `ROOT + path.sep`. **(d) It serves dotfiles** (`/.gitignore` returned 200, and `.claude/` would be served if it existed, which her `.gitignore` expects). That matters only with (a); deny names starting with `.` |
| Port | | **(e) Clash: 8771 is already tableau-schools** (`tableau-schools/schools.trex:10`, `Start-Schools.ps1:4`). The two cannot be served at once; the second start fails with EADDRINUSE. Ports in use across the repo: 8765, 8767, 8770 to 8778. Free: 8766, 8768, 8769, 8779. Suggest Range Dot moves to **8779** (`RangeDot.trex:10`, `serve.js:17`, her README lines 25 and 106), by agreement with Celia, since her README is what her users follow. |
| `package.json` | `private`, no dependencies, one script: `start: node serve.js` | Safe. |
| `RangeDot.trex` | Worksheet extension, `source-location` `http://localhost:8771/index.html`, `min-api-version` 1.1, 4 encodings, **no `<permissions>` element** (does not ask for full data) | Safe. Author XeoMatrix, empty email, empty `<icon/>`. |
| `mock-tableau.js` | Preview stand-in: `fetch('./sample-data/sample.csv')` (same folder) and localStorage | Safe. |
| `sample-data/make_sample.py` | `csv`, `sys`, `datetime`; writes one CSV | Safe. |
| `viz.js` (2,474 lines) | Range Dot itself | **(f) Bug: line 49 holds two literal backspace bytes** (0x08) where `\bcap\b` was meant: `re: /note|capacity|\x08cap\x08|availab|.../i`. A field named exactly "Cap" can never auto-match the note role. This is the exact pattern in our memory guards. Fix: retype `\bcap\b`. Tooltip HTML passes data values through `escapeHtml`; the mark color goes into a `style` attribute unescaped, and only a person pasting their own settings can reach it (self-only, low). |
| `lib/README.md` | Tells the user to download `tableau.extensions.1.latest.js` from tableau/extensions-api | Not vendored, so Range Dot stays blank in Tableau until that is done by hand. Our other extensions vendor the `.min.js`. Suggest vendoring it for consistency. |
| Fonts | Poppins Regular, Medium, SemiBold, Bold TTF, 155 to 160 KB each (632 KB), plus `LICENSE-Poppins-OFL.txt` (SIL OFL 1.1, Poppins Project Authors) | License fine. Optional: woff2 cuts the size by about half. |
| Remote URLs | Only in docs: github.com/tableau/extensions-api (lib README), itfoundry/Poppins and scripts.sil.org (license) | No runtime remote loads; fonts bundled offline. |
| Sizes | viz.js 115 KB, index.html 39 KB, guide 68 KB, starter 34 KB, preview.png 43 KB; 21 files, +5,952 lines | Fine. |
| Em dashes | 0 U+2014, 0 U+2013 in 16 text files (5 binaries skipped) | Her copy already follows rule 2. |
| Existing files touched | None (`git diff --stat 91c0ce6^ 91c0ce6`: only `settings-panel-guide/` and `tableau-range-dot/`) | |

### Follow-ups, in order
1. Port 8771 clash with tableau-schools (e). Agree a port with Celia; 8779 is free.
2. `serve.js`: bind 127.0.0.1 (a), catch the URL decode (b), deny dotfiles (d), `ROOT + path.sep` (c).
3. `viz.js:49` backspace bytes (f).
4. Vendor the Tableau extensions library like the other extensions.
5. Chris's call: whether the no-slider and 14 px rules apply to Range Dot (a PR to Celia if yes).
