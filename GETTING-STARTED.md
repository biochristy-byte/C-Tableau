# Getting started: Tableau with Claude Code, the C-Tableau way

About 20 minutes of setup. After that, every Claude Code session starts with the design
rules, the recipes and the safety rails already loaded.

## 1. What you need

| Thing | Why | Get it |
|---|---|---|
| Claude Code | the assistant that reads this folder and works with you | claude.com/claude-code |
| Tableau Desktop or Tableau Public Desktop | where the vizzes get built | tableau.com |
| Git | to download this folder and pull updates | git-scm.com |
| Python 3.11 | only for the scripts in `tableau-knowledge/tools/` and `narration-sync/` | python.org |

## 2. Download this folder

Open a terminal and run:

```
git clone https://github.com/biochristy-byte/C-Tableau.git
```

Later, `git pull` inside the folder brings down everything new.

## 3. Give Claude its standing instructions

1. Pick the folder you will do Tableau work in (for example `Documents/Tableau`).
2. Copy `tableau-knowledge/CLAUDE.md.template` into it and rename the copy `CLAUDE.md`.
3. Open the copy and fix the `KNOWLEDGE =` line so it points to where you cloned C-Tableau.

Claude Code reads `CLAUDE.md` at the start of every session in that folder. That is what makes it
work the same way every time.

## 4. Install the slash commands and the skill

Copy these into your Claude folder (on Windows, `C:\Users\<you>\.claude\`), then restart Claude Code.

| Copy | To | Then type |
|---|---|---|
| `tableau-knowledge/claude-command/chart-brainstorm.md` | `.claude/commands/` | `/chart-brainstorm` |
| `tableau-knowledge/claude-command/tableau-scrubs.md` | `.claude/commands/` | `/tableau-scrubs` |
| the whole `narration-sync/` folder | `.claude/skills/` | `/narration-sync` |

### If you mostly use Claude Desktop (the chat app)

The chat app does not load this folder by itself, so give it the knowledge as one skill:

1. In the C-Tableau folder, run `python tableau-knowledge/tools/make_desktop_skill.py`.
   It writes `dist/tableau-craft.zip` and prints GREEN with the number of files packed.
2. In Claude Desktop: Customize > Skills, click +, then Create skill > Upload a skill, and pick that zip.
   If Skills is missing, turn on Code execution and file creation under Settings > Capabilities first.
3. Optional: make a Project called Tableau and paste the "Hard rules" and "How I like answers"
   sections of `tableau-knowledge/CLAUDE.md.template` into its instructions.
4. Ask anything Tableau, for example "brainstorm chart types for..." and the skill loads itself.

After every `git pull`, run step 1 again and re-upload so Desktop has the newest rules.

## 5. First sessions to try

Open Claude Code in your Tableau folder and paste one of these:

- `/chart-brainstorm Which hospital units lose the most nurses in year one? One row per nurse, 4,000 rows, readers are nurse managers.`
  You get four chart ideas, from the safe one to a showpiece, a recommendation, and the build card.
- `/tableau-scrubs Here is my CSV. Tell me what one row is, what is dirty, and what to fix before Tableau.`
- `Read tableau-knowledge/house-style.md and review this dashboard screenshot against every rule.`
- `I want to build a waffle chart with map layers. Walk me through it shelf by shelf.`
- `Check the contrast of white text on #4E79A7.` (Claude runs `tools/a11y_check.py`.)
- `/narration-sync my-tip base.mp4 voice.m4a` to pair a silent screen recording with a voiceover.

## 6. The three rules that save you

1. **Never press Ctrl+S in Tableau Public.** There it publishes to the web. Use File > Save As.
   Claude's GUI scripts refuse that key. See `tableau-knowledge/never-ctrl-s-on-public.md`.
2. **Text contrast 7:1, no text under 10 pt.** Have Claude compute it. Screens and dark modes
   fool the eye.
3. **Grain first.** Before any chart, say what one row is. Most wrong numbers start there.

## 7. Where everything is

| Folder | What is inside |
|---|---|
| `tableau-knowledge/` | design rules, recipes, XML traps, QA and data honesty. Start with its `README.md` |
| `tableau-knowledge/tools/` | tested scripts: build a `.twb`, check contrast, package a `.twbx`, refresh extracts |
| `narration-sync/` | the screen-recording-plus-voiceover skill |
| `tableau-garden-petals/` | the flower-chart viz extension. Double-click `Start-Petals.bat`, then read `START-HERE.txt` |
| `tableau-lollipop/` | the lollipop-chart viz extension. Double-click `Start-Lollipop.bat`, then read `START-HERE.txt` |

## 8. Teach it back

When a session teaches you something (a trick, a trap, a rule from a talk), tell Claude:
"add this to the knowledge folder with where it came from." New house rules continue the numbering.
Commit it, and the next session, yours or anyone's, starts from there.
