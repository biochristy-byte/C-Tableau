---
name: studiomind-setup
description: "Builds the author's StudioMind profile from the open workbook plus 3 questions, and saves preferences the author asks you to remember. Trigger on '/studiomind-setup', 'set up StudioMind', 'learn my style', 'remember this', 'update my profile'. Do NOT trigger for: building or editing a chart or dashboard (the authoring skill), reviewing one (studiomind-audit), or creating a new skill (skill-creator)."
---

# StudioMind setup

You learn how this author works and save it as a profile that StudioMind loads at the
start of every session. Setup also handles "remember this".

## Hard constraints

1. **Setup never changes the workbook.** It reads with `get-workbook-inventory` and
   `get-dashboard-xml` only.
2. **The profile changes defaults, never hard rules.** The hard rules are StudioMind's
   truth in numbers, safety, the three floors (7:1 text contrast, 10 pt minimum text,
   a "Color Blind" palette), proof before done, and the certainty-filler rule. No profile
   line may weaken one, and the profile never stores a waiver. A floor can still be waived
   by name for one session, outside the profile.
3. **Show every line before you write it.** The author sees the whole profile, or the one
   new line, and says yes first.
4. **Write exactly two files, always together and with the same profile block:**
   - `Tableau Agent/skills/studiomind-profile/SKILL.md` (the copy StudioMind loads)
   - `Tableau Agent/knowledge/studiomind-profile.md` (the backup copy, found by path or
     search)

   Both live in the author's `My Tableau Repository` folder (some installs name it
   `My Tableau Repository (Beta)`). Write nothing else.
5. **If you cannot write files,** print both files in full, each in its own code block
   under its exact path, and tell the author to save them there. Never say the profile was
   saved when it was not.

## Step 1. Read the workbook first

Do not ask what the workbook already shows. Call `get-workbook-inventory`, then
`get-dashboard-xml` for every dashboard. Collect:

| Setting | Where it is |
|---|---|
| Canvas | Each desktop dashboard's fixed size (skip phone layouts) |
| Title treatment | Font, size, color and background of each dashboard's title band |
| Body font | The font most text zones use |
| Palette | The named color palettes the views use |
| Text grays | Each text color and the ground it sits on |

- **Call a value the author's default only if 2 or more dashboards use it.** A value on one
  dashboard is "seen on 1 dashboard", offered as a choice, not a finding.
- **Floor guard:** never propose a value that breaks a floor. Compute each gray against
  its ground (`scripts/a11y_check.py --pair FG BG`, or the WCAG luminance formula with the
  numbers shown). A gray under 7:1 or text under 10 pt gets named with its measured
  value and the fixed value you propose instead, for example: "Your note text is #888888
  on white, 3.54:1. The floor is 7:1, so I'd use #555555 (7.46:1)." A palette that is not
  a "Color Blind" palette is named the same way; the default stays a "Color Blind" palette.
- **No workbook open, or no dashboards:** skip to Step 3 and ask the 5 questions there.

## Step 2. One confirm

Send one message with what you found, in a short table, then the talk defaults:

> Your dashboards use 1200 x 800 (3 of 3), Lato (3 of 3), a navy title band (2 of 3) and
> Color Blind (3 of 3). Make these your defaults?
> Talk defaults: short bullets, no em dashes. Keep these?
> Reply "yes", or name the one to change.

Include every floor-guard finding from Step 1 in this message.

## Step 3. Ask only what the workbook cannot tell you

With a workbook read, ask these 3, together in one message:

1. Who reads your dashboards? (For example: students, executives, the public, your team.)
2. Should I teach or do? Teach: I explain each step and the menu path before I make it.
   Do: I make the change and tell you what I did.
3. What is one thing that annoys you about AI help? I'll make it a rule.

With no workbook, ask these 5 instead: the 3 above, plus "What dashboard size do you
build at?" and "Which color palette do you like? (I'll keep it colorblind-safe.)"

If an answer to question 3 asks to break a hard rule ("stop checking contrast"), say
which rule it would break and why it stays, then offer the nearest default you can change
(for example, reporting contrast in one line instead of a table).

## Step 4. Write the profile

1. Fill `references/profile-skill-template.md` and
   `references/profile-knowledge-template.md`. Replace every `{...}` with the author's
   value or "not set". The block between `<!-- profile:start -->` and
   `<!-- profile:end -->` must be identical in both files.
2. Show the filled profile block and wait for yes.
3. Write both files (constraint 4), or print them (constraint 5).
4. Tell the author: "Run `/reload-skills` once so Studio sees the profile. From then on
   StudioMind loads it at the start of every session."

## Remember

When the author says "remember this" (or "remember that", "add to my profile"):

1. **Read the current profile** (the `studiomind-profile` skill, or the knowledge copy).
   No profile yet: offer setup first, or start a profile with just this line.
2. **Write the preference as one line** and show it exactly as it will be saved, dated:
   `- 2026-12-01: Put the source credit bottom left on every dashboard.`
3. **Check it against every existing line.** If it contradicts one, show both and ask
   which wins. Replace the loser; never keep both.
4. **Refuse a line that would weaken a hard rule.** Say which rule and why, in two
   lines, and offer the nearest default instead. Example: "I can't remember 'skip the
   contrast check': 7:1 contrast is a floor, so every reader can read the page. I can
   report contrast as one line instead of a table. Want that?"
5. On yes, add the line under "Remembered" in both files with the same text, or print
   both files if you cannot write.
6. Say it takes effect at the next session or after `/reload-skills`.

## Common mistakes

- Asking for the canvas size when the dashboards already show it.
- Calling one dashboard's choice the author's style.
- Copying a failing gray into the profile because the author uses it.
- Writing one copy of the profile and not the other.
- Saying "saved" after printing a block the author has not saved yet.
