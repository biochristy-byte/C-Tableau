# StudioMind for Tableau Studio

The Tableau Studio agent starts with Tableau's own skills and nothing else: no house style,
no rules about checking its numbers, no guard against publishing by accident. StudioMind
adds a base layer of rules for every session, plus a read-only audit.

| Piece | What it does | How it runs |
|---|---|---|
| `skills/studiomind` | Rules for working with the author, truth in numbers, safety, design, story and proof, with 14 reference files | Type `/studiomind` at the start of a session; the rules then hold for the whole session |
| `skills/studiomind-audit` | Checks an open workbook against the rules (contrast, type size, rate math, actions, layout) and reports PASS, FAIL or SKIP with counts. Never edits. | `/studiomind-audit` |
| `knowledge/studiomind-house-rules.md` | The short form of the house rules as a Tableau expertise file, which the agent finds by search while authoring | Automatic, when its tags match |
| `authoring-override-block.md` | Optional: makes StudioMind load on every authoring turn | One pasted block, see the file |

## Install

1. Build the package from this repo (needs Python 3):
   ```
   python tableau-knowledge/tools/make_studio_skill.py
   ```
   It writes `dist/tableau-studio/` and `dist/tableau-studio.zip`, and refuses to zip if
   any gate goes RED.
2. Copy `dist/tableau-studio/skills/studiomind` and `dist/tableau-studio/skills/studiomind-audit`
   into `~/Documents/My Tableau Repository/Tableau Agent/skills/`.
3. Copy `dist/tableau-studio/knowledge/studiomind-house-rules.md` into
   `~/Documents/My Tableau Repository/Tableau Agent/knowledge/`.
4. In the Tableau Agent chat, run `/reload-skills`, then type `/` to confirm both skills
   are listed.
5. Optional: follow `authoring-override-block.md` so the rules load on every authoring turn.

Some installs name the root folder `My Tableau Repository (Beta)`. Use whichever one you
have.

## Keep it current

The references are copies of the files in `tableau-knowledge/`. Edit those, then rebuild
and copy again. `python tableau-knowledge/tools/make_studio_skill.py --selftest` breaks
each gate on purpose and confirms it goes RED.

## What the gates check

- Each skill's `name` is kebab-case and equals its folder name (Tableau's skill schema).
- Each description is short, lists at least 4 trigger phrases, and has a "Do NOT trigger"
  boundary (the Skill Creator quality gate).
- Every reference and script a SKILL.md names is in the package.
- The expertise file has every heading and Scope Check line Tableau's format asks for.
- No em or en dashes, no filler words, no emails, local paths or personal names in the five
  files this folder writes. The 14 references are the repo's own files, copied as they are.
- The bundled contrast script fails `#777777` on white (4.48:1) and passes black on white.

## Not yet proven

These skills were checked against Tableau's published skill format, not run inside a live
Tableau Studio session. After installing, run Tableau's `skill-grader-desktop` on each
skill and try `/studiomind-audit` on a sample workbook such as Superstore.
