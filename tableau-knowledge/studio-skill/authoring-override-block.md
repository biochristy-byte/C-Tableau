# Optional: make StudioMind load on every authoring turn

Tableau Studio has no always-on instruction file. A skill runs when its description
matches the request or when you type its name. To make StudioMind apply every time the
agent authors, add one block to your override of the built-in `tableau-desktop-authoring`
skill, which Tableau marks as overridable.

## Steps

1. Open `~/Documents/My Tableau Repository/Tableau Agent/skills/.vendored/overridable/`.
   (Some installs name the root folder `My Tableau Repository (Beta)`.)
2. If `Tableau Agent/skills/tableau-desktop-authoring` already exists, you already have an
   override: add the block to it and do not copy over it. Otherwise copy the
   `tableau-desktop-authoring` folder into `Tableau Agent/skills/`, keeping the folder name
   exactly.
3. Open the copied `SKILL.md`. Leave the frontmatter and everything else as it is. Paste
   the block below directly under the frontmatter.
4. In the Tableau Agent chat, run `/reload-skills`.
5. Check that it took: ask the agent "What is the text contrast floor for this workbook?"
   It should answer 7:1. If it does not, type `/studiomind` at the start of each session
   instead.

## The block

```
## Before any authoring step

Load the `studiomind` skill, then the `studiomind-profile` skill if it exists, and follow
them for the rest of this session. StudioMind's safety, truth-in-numbers and design rules
apply to every change you make; the profile changes only its defaults. Where StudioMind
and this skill disagree on how to drive a tool, this skill wins.
```

## After a Tableau Studio update

Your copy overrides Tableau's, so it will not pick up Tableau's own changes to the
authoring skill. After each Studio update, repeat steps 1 to 4 with a fresh copy.
