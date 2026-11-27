# StudioMind for Tableau Studio

The Tableau Studio agent starts with Tableau's own skills and nothing else: no house style,
no rules about checking its numbers, no guard against publishing by accident, and no idea
who you are. StudioMind adds a base layer of rules, learns your style, checks your work and
fixes what it safely can.

| Piece | What it does | How it runs |
|---|---|---|
| `skills/studiomind` | Rules for working with the author, truth in numbers, safety, design, story and proof, with 14 reference files. Loads your profile and greets you with what it knows. | Type `/studiomind` at the start of a session |
| `skills/studiomind-setup` | Reads your open workbook for your canvas, fonts, palette and title style, asks 3 questions, and saves your profile. Also handles "remember this". | `/studiomind-setup`, or say "remember this" |
| `skills/studiomind-audit` | Checks an open workbook against the rules (contrast, type size, rate math, actions, layout) and reports PASS, FAIL, SKIP or WAIVED with counts. Never edits. | `/studiomind-audit` |
| `skills/studiomind-polish` | Fixes the audit's mechanical items (colors, sizes, action names, canvas, titles, footers, instructions) one at a time with your OK, and re-checks each one. Never touches rate math, filters or calcs. | `/studiomind-polish` after an audit |
| `knowledge/studiomind-house-rules.md` | The short form of the house rules as a Tableau expertise file, which the agent finds by search while authoring | Automatic, when its tags match |
| `authoring-override-block.md` | Optional: makes StudioMind and your profile load on every authoring turn | One pasted block, see the file |

## Hard rules and your preferences

Your profile changes StudioMind's defaults: canvas, fonts, palette, teach or do, how it
talks. It never changes the hard rules: truth in numbers, safety, the three floors (7:1
text contrast, 10 pt minimum text, a "Color Blind" palette), proof before done, and no
certainty filler. Ask it to remember "skip the contrast check" and it will say no and why.

## Install

1. Download
   [`tableau-studio.zip`](https://github.com/biochristy-byte/C-Tableau/releases/download/studiomind-v1/tableau-studio.zip)
   and unzip it. (Or build it from this repo with Python 3:
   `python tableau-knowledge/tools/make_studio_skill.py`, which writes
   `dist/tableau-studio/` and refuses to zip if any gate goes RED.)
2. Copy the four folders in `skills/` into
   `~/Documents/My Tableau Repository/Tableau Agent/skills/`.
3. Copy `knowledge/studiomind-house-rules.md` into
   `~/Documents/My Tableau Repository/Tableau Agent/knowledge/`.
4. In the Tableau Agent chat, run `/reload-skills`, then type `/` to confirm all four
   skills are listed.
5. Open a workbook you built and run `/studiomind-setup`. Run `/reload-skills` once more
   when it finishes.
6. Optional: follow `authoring-override-block.md` so the rules load on every authoring turn.

Some installs name the root folder `My Tableau Repository (Beta)`. Use whichever one you
have.

Setup saves your profile to `skills/studiomind-profile/` and
`knowledge/studiomind-profile.md`. The package never ships those, so updating StudioMind
never overwrites your profile. Do not delete them when you update.

## Keep it current

The references are copies of the files in `tableau-knowledge/`. Edit those, then rebuild
and copy again. `python tableau-knowledge/tools/make_studio_skill.py --selftest` breaks
each gate on purpose and confirms it goes RED.

## What the gates check

- Each skill's `name` is kebab-case and equals its folder name (Tableau's skill schema).
- Each description is short, lists at least 4 trigger phrases, and has a "Do NOT trigger"
  boundary (the Skill Creator quality gate).
- Every reference and script a SKILL.md names is in the package.
- The expertise files have every heading and Scope Check line Tableau's format asks for.
- No em or en dashes, no filler words, no emails, local paths or personal names in the
  files this folder writes. The 14 references are the repo's own files, copied as they are.
- The bundled contrast script fails `#777777` on white (4.48:1) and passes black on white.
- Profile: the two profile templates carry the same block, the profile skill never
  triggers on a request, the block stores no waiver, the package ships no profile,
  StudioMind tries skill, then path, then search, and "remember this" refuses a line that
  weakens a hard rule.
- Polish: every audit check is either a fix polish may make or one it never makes; rate
  math, number-as-text, grain, table calc addressing, filters and density are never-fix;
  Save As comes first; it never names a calc-writing tool.
- Hard rules: the certainty-filler rule sits under the hard rules, and setup names every
  floor as hard.

## Not yet proven

These skills were checked against Tableau's published skill format, not run inside a live
Tableau Studio session. Unproven until a live trial:

- one skill loading another (StudioMind loading `studiomind-profile`, setup's Remember)
- a skill writing files (setup prints the profile for you to save if it cannot)
- a skill reading a file outside its own folder (the profile's second load path)
- knowledge search finding the profile (its third load path)
- a newly written skill showing up without `/reload-skills`
- "remember this" refusing a hard-rule change at runtime (the gates check the wording, not
  the agent's behavior)

After installing, run Tableau's `skill-grader-desktop` on each skill and try the four
skills on a sample workbook such as Superstore.
