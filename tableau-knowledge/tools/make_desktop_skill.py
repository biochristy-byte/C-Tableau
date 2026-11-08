"""Build tableau-craft.zip: the whole knowledge folder as one Claude skill.

Upload the zip in Claude Desktop or claude.ai (Settings > Capabilities > Skills), or unzip
it into ~/.claude/skills/ for Claude Code. It is generated from the repo, so rerun this after
every `git pull` and re-upload.

    python make_desktop_skill.py            # writes ../../dist/tableau-craft.zip
    python make_desktop_skill.py --out x.zip

Goes RED (exit 1) if a reference the SKILL.md names is missing, or if fewer files than
expected were packed.
"""
import argparse
import re
import sys
import zipfile
from pathlib import Path

KNOW = Path(__file__).resolve().parent.parent          # tableau-knowledge/
REPO = KNOW.parent
SKILL_MD = KNOW / "desktop-skill" / "SKILL.md"
MIN_REFERENCES = 15

# Every knowledge file that is prose craft. Tools, templates and this script stay out.
SOURCES = sorted(
    [p for p in KNOW.glob("*.md") if p.name != "README.md"]
    + list((KNOW / "reference").glob("*.md"))
    + list((KNOW / "claude-command").glob("*.md"))
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "dist" / "tableau-craft.zip"))
    out = Path(ap.parse_args().out)

    skill = SKILL_MD.read_text(encoding="utf-8")
    names = {p.name for p in SOURCES}
    if len(names) != len(SOURCES):
        print("RED: two reference files share a name")
        return 1
    named = set(re.findall(r"references/([\w.-]+\.md)", skill))
    missing = sorted(named - names)
    if missing:
        print("RED: SKILL.md names references that do not exist:", ", ".join(missing))
        return 1
    if len(SOURCES) < MIN_REFERENCES:
        print(f"RED: only {len(SOURCES)} reference files found, expected at least {MIN_REFERENCES}")
        return 1

    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("tableau-craft/SKILL.md", skill)
        for p in SOURCES:
            z.write(p, f"tableau-craft/references/{p.name}")

    with zipfile.ZipFile(out) as z:
        listed = z.namelist()
    print(f"GREEN: {out} has SKILL.md + {len(listed) - 1} references "
          f"({out.stat().st_size // 1024} KB); SKILL.md names {len(named)}, all present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
