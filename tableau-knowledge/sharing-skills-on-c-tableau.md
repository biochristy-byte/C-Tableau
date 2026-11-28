# Sharing a Claude skill on C-Tableau

The C-Tableau skills shelf (https://c-tableau.netlify.app/skills/) holds free Claude skills for Tableau work. Anyone with a C-Tableau account can share one. Read this before you help someone upload one.

## What a skill is, as the upload page sees it

A skill is a folder with a file named exactly `SKILL.md` at its top, plus any scripts or reference files it uses:

```
my-skill/
  SKILL.md          required, at the top of the folder
  reference.md      optional
  scripts/run.py    optional
```

`SKILL.md` starts with a front matter block:

```
---
name: my-skill
description: What the skill does and when Claude should use it.
---
```

- `name`: lowercase letters, numbers and single hyphens, up to 64 characters. It can't contain "anthropic" or "claude".
- `description`: required, up to 1,024 characters, no HTML or XML tags.
- `SKILL.md` must be under 256 KB. Move long material into reference files.
- Limits for the whole skill: 500 files and 30 MB unpacked.

## How to upload

1. Sign in at https://c-tableau.netlify.app/account/ and open **My skills**, then **Share a skill** (`#/skill-upload`).
2. Pick **one** of these. Leave the other box empty:
   - **The skill folder**: the folder that holds `SKILL.md`, not a folder above it.
   - **A file**: a `.zip` of that folder, a `.skill` file, or a lone `SKILL.md`.
3. Click **Submit for approval**. Chris reviews every skill, and you hear by email. An approved skill appears on the shelf. To share a new version, upload the same skill again; once approved, it replaces the old one.

## What the page refuses, and why

A reviewer has to be able to read every file, so the page refuses program and archive files inside a skill: exe, dll, so, dylib, msi, scr, com, jar, bin, app, dmg, pkg, deb, rpm, iso, zip, tar, gz, tgz, bz2, xz, 7z, rar and **skill**. File names may use letters, numbers, spaces, dot, dash, underscore, `@` and `+`.

It skips these quietly: hidden files and folders (names starting with a dot), `node_modules`, `__pycache__`, `__MACOSX`, `Thumbs.db` and `desktop.ini`.

## The trap: a packed skill inside a zip (seen 11/28/2026)

A `.skill` file is already a packed skill: it's a zip holding `<name>/SKILL.md` and the rest. If someone zips their `.skill` file, or zips a folder that holds the `.skill` next to the source, the page reads the outer zip, finds an archive instead of `SKILL.md`, and shows two errors:

- "Program and archive files cannot ride in a skill ...: <name>.skill"
- "No SKILL.md found."

**Fix:** upload the `.skill` file itself, in the file box, or upload the source folder. Never wrap a `.skill` in another zip.

Since 11/28/2026 the page handles these shapes itself:
- A zip that holds exactly one `.skill` or `.zip` and no `SKILL.md` is opened one level, with a note saying so. Deeper nesting is refused with a message that says what to pick.
- A packed copy sitting beside the real skill files is left out, with the note "Left out <name>: a packed copy of a skill".
- A `SKILL.md` one folder down is used as the skill root, and any files outside that folder are listed as left out. Two candidate folders are refused by name.
- If both pick boxes are filled, the page uses the one changed last and says which.
Uploading the `.skill` itself or the source folder is still the cleanest route.

## Checklist for a Claude helping someone share a skill

- Find `SKILL.md`. The folder that directly contains it is the skill folder.
- Check the front matter `name` and `description` against the rules above before uploading.
- Look for `.zip`, `.skill`, `.exe` and other blocked files inside the folder. Move them out, or ship their readable source instead.
- If the person already has a `.skill` file, upload that file as is.
- Leave one of the two pick boxes empty.
- Never put an API key, password or private data in a skill. Everything in it is readable by the reviewer and, once approved, by anyone who downloads it.
