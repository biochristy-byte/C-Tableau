"""Build the StudioMind skills for Tableau Studio from this repo.

Writes dist/tableau-studio/ (ready to copy into My Tableau Repository) and
dist/tableau-studio.zip:

    skills/studiomind/            SKILL.md, references/ (copied from tableau-knowledge), scripts/a11y_check.py
    skills/studiomind-audit/      SKILL.md, scripts/a11y_check.py
    knowledge/studiomind-house-rules.md     (Tableau "expertise" file, found by search)
    authoring-override-block.md   (optional: load StudioMind on every authoring turn)
    README.md

    python make_studio_skill.py              # build + gate, exit 1 on any RED
    python make_studio_skill.py --selftest   # build, then sabotage every gate and confirm each goes RED

References are copied, never edited here: change the file in tableau-knowledge/ and rebuild.
"""
import argparse
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

KNOW = Path(__file__).resolve().parent.parent          # tableau-knowledge/
REPO = KNOW.parent
SRC = KNOW / "studio-skill"
A11Y = KNOW / "tools" / "a11y_check.py"

# Studio edits a live workbook through Tableau's tools, so the XML-generator files stay out.
REFERENCES = [
    "house-style.md", "data-honesty.md", "workflow-and-qa.md", "gate-designs.md",
    "technique-library.md", "andy-kriebel-recipes.md", "iron-viz-design.md",
    "viz-of-the-day-patterns.md", "agent-business-preferences.md", "never-ctrl-s-on-public.md",
    "viz-extensions.md", "reference/TABLEAU_MASTERY.md", "claude-command/chart-brainstorm.md",
    "claude-command/tableau-scrubs.md",
]
SKILLS = ["studiomind", "studiomind-audit"]
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")          # Tableau's skill.schema.json
DESC_MAX = 4096                                             # skill.schema.json maxLength
DESC_SHORT = 500                                            # Skill Creator wants a short description
MIN_TRIGGERS = 4
EXPERTISE_H2 = ["## Scope Check", "## When to Use", "## Best Practices", "## Common Mistakes",
                "## Implementation"]
SCOPE_BULLETS = ["Primary audience:", "Authoring outcome improved:", "In-scope reason:",
                 "Out-of-scope risk:", "Tags:", "Relevant user prompts/search terms:"]
DASHES = ["—", "–"]
BANNED = ["honest", "frankly", "candidly", "truthfully", "obviously", "clearly",
          "of course", "needless to say"]
PRIVATE = [r"[\w.+-]+@[\w-]+\.[\w.]+", r"[A-Za-z]:[\\/]Users[\\/]", r"\bC0[A-Z0-9]{8,}\b",
           r"\b(Chris|Christine|Christy|Celia|Kelsey|Fryar|Oehrke|Pregler|biochristy)\b"]


def build(out: Path) -> None:
    if out.exists():
        shutil.rmtree(out)
    for name in SKILLS:
        dest = out / "skills" / name
        (dest / "scripts").mkdir(parents=True)
        shutil.copy2(SRC / name / "SKILL.md", dest / "SKILL.md")
        shutil.copy2(A11Y, dest / "scripts" / "a11y_check.py")
    refs = out / "skills" / "studiomind" / "references"
    refs.mkdir()
    for rel in REFERENCES:
        shutil.copy2(KNOW / rel, refs / Path(rel).name)
    (out / "knowledge").mkdir()
    shutil.copy2(SRC / "knowledge" / "studiomind-house-rules.md", out / "knowledge")
    shutil.copy2(SRC / "authoring-override-block.md", out)
    shutil.copy2(SRC / "README.md", out)
    # Ship LF only: a Windows checkout can hand us CRLF, and frontmatter parsers differ on it.
    for p in out.rglob("*"):
        if p.suffix in (".md", ".py") and p.is_file():
            p.write_bytes(p.read_bytes().replace(b"\r\n", b"\n"))


def gate_line_endings(out: Path) -> list:
    files = [p for p in out.rglob("*") if p.suffix in (".md", ".py") and p.is_file()]
    if len(files) < len(REFERENCES) + 7:
        return [f"line endings: only {len(files)} text files examined"]
    return [f"{p.relative_to(out).as_posix()}: has CRLF line endings"
            for p in files if b"\r" in p.read_bytes()]


def frontmatter(text: str) -> dict:
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    fm = {}
    for line in m.group(1).splitlines():
        k, _, v = line.partition(":")
        fm[k.strip()] = v.strip().strip('"')
    return fm


def authored(out: Path) -> list:
    """Files this repo writes for Studio (references are gated by their own repo checks)."""
    return [out / "skills" / n / "SKILL.md" for n in SKILLS] + [
        out / "knowledge" / "studiomind-house-rules.md", out / "authoring-override-block.md",
        out / "README.md"]


def gate_frontmatter(out: Path) -> list:
    errs = []
    for name in SKILLS:
        fm = frontmatter((out / "skills" / name / "SKILL.md").read_text(encoding="utf-8"))
        n, d = fm.get("name", ""), fm.get("description", "")
        if not NAME_RE.match(n):
            errs.append(f"{name}: name {n!r} is not kebab-case")
        if n != name:
            errs.append(f"{name}: name {n!r} does not equal folder name")
        if not d or len(d) > DESC_MAX:
            errs.append(f"{name}: description length {len(d)} outside 1..{DESC_MAX}")
        if len(d) > DESC_SHORT:
            errs.append(f"{name}: description {len(d)} chars, over the short limit {DESC_SHORT}")
        triggers = re.findall(r"'([^']+)'", d)
        if len(triggers) < MIN_TRIGGERS:
            errs.append(f"{name}: {len(triggers)} trigger phrases, need {MIN_TRIGGERS}")
        if "Do NOT trigger" not in d:
            errs.append(f"{name}: description has no 'Do NOT trigger' boundary")
    return errs


def gate_files_named(out: Path) -> list:
    errs = []
    for name in SKILLS:
        root = out / "skills" / name
        text = (root / "SKILL.md").read_text(encoding="utf-8")
        for kind in ("references", "scripts"):
            for f in set(re.findall(kind + r"/([\w.-]+\.(?:md|py))", text)):
                if not (root / kind / f).is_file():
                    errs.append(f"{name}: SKILL.md names {kind}/{f}, not in the package")
    have = len(list((out / "skills" / "studiomind" / "references").glob("*.md")))
    if have < len(REFERENCES):
        errs.append(f"studiomind: {have} references packaged, expected {len(REFERENCES)}")
    return errs


def gate_expertise(out: Path) -> list:
    text = (out / "knowledge" / "studiomind-house-rules.md").read_text(encoding="utf-8")
    errs = [f"expertise: missing heading {h!r}" for h in EXPERTISE_H2 if h not in text]
    errs += [f"expertise: Scope Check missing {b!r}" for b in SCOPE_BULLETS if f"- {b}" not in text]
    if not re.match(r"# \S", text):
        errs.append("expertise: does not open with an H1 title")
    if text.lstrip().startswith("---"):
        errs.append("expertise: has frontmatter (Tableau expertise files take none)")
    return errs


def gate_text(out: Path) -> list:
    errs = []
    for p in authored(out):
        text = p.read_text(encoding="utf-8")
        rel = p.relative_to(out).as_posix()
        for d in DASHES:
            if d in text:
                errs.append(f"{rel}: contains U+{ord(d):04X} dash")
        # The skill lists the banned words once, on purpose; scan everything outside that list.
        # File names (data-honesty.md) are not prose either.
        scan = re.sub(r"No honesty or certainty filler:.*?State the thing\.", "", text, flags=re.S)
        scan = re.sub(r"[\w/.-]+\.md\b", "", scan)
        for w in BANNED:
            if re.search(r"\b" + w, scan, re.I):
                errs.append(f"{rel}: uses banned word {w!r}")
        for pat in PRIVATE:
            m = re.search(pat, text)
            if m:
                errs.append(f"{rel}: private-looking text {m.group(0)!r}")
    return errs


def gate_a11y(out: Path) -> list:
    errs = []
    for name in SKILLS:
        script = out / "skills" / name / "scripts" / "a11y_check.py"
        bad = subprocess.run([sys.executable, str(script), "--pair", "#777777", "#ffffff"],
                             capture_output=True, text=True)
        good = subprocess.run([sys.executable, str(script), "--pair", "#000000", "#ffffff"],
                              capture_output=True, text=True)
        if bad.returncode != 1 or "4.48:1" not in bad.stdout:
            errs.append(f"{name}: control #777777 on #ffffff did not FAIL at 4.48:1")
        if good.returncode != 0 or "21.00:1" not in good.stdout:
            errs.append(f"{name}: control #000000 on #ffffff did not PASS at 21.00:1")
    return errs


GATES = [("frontmatter", gate_frontmatter), ("files named", gate_files_named),
         ("expertise format", gate_expertise), ("text rules", gate_text),
         ("a11y controls", gate_a11y), ("line endings", gate_line_endings)]


def run_gates(out: Path, quiet: bool = False) -> dict:
    results = {}
    for label, fn in GATES:
        errs = fn(out)
        results[label] = errs
        if not quiet:
            print(f"  {'GREEN' if not errs else 'RED  '} {label}")
            for e in errs:
                print(f"         - {e}")
    return results


def edit(p: Path, old: str, new: str) -> None:
    text = p.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"selftest setup: {old!r} not found in {p}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")


def selftest() -> int:
    """Each sabotage must turn exactly its own gate RED, and the clean build must be GREEN."""
    sm = lambda o: o / "skills" / "studiomind" / "SKILL.md"
    au = lambda o: o / "skills" / "studiomind-audit" / "SKILL.md"
    kn = lambda o: o / "knowledge" / "studiomind-house-rules.md"
    cases = [
        ("frontmatter", "name differs from folder", lambda o: edit(sm(o), "name: studiomind", "name: StudioMind")),
        ("frontmatter", "no Do NOT boundary", lambda o: edit(au(o), "Do NOT trigger", "Skip")),
        ("files named", "reference missing", lambda o: (sm(o).parent / "references" / "house-style.md").unlink()),
        ("files named", "script missing", lambda o: (au(o).parent / "scripts" / "a11y_check.py").rename(au(o).parent / "scripts" / "x.py")),
        ("expertise format", "Scope Check heading gone", lambda o: edit(kn(o), "## Scope Check", "## Scope")),
        ("expertise format", "Tags bullet gone", lambda o: edit(kn(o), "- Tags:", "- Labels:")),
        ("text rules", "em dash", lambda o: edit(sm(o), "# StudioMind", "# StudioMind — base")),
        ("text rules", "banned word", lambda o: edit(au(o), "You never change", "You clearly never change")),
        ("text rules", "email address", lambda o: edit(kn(o), "## Implementation", "## Implementation\n\nmail someone@example.com")),
        ("text rules", "personal name", lambda o: edit(sm(o), "A base layer", "Celia's base layer")),
        ("line endings", "CRLF in a SKILL.md", lambda o: sm(o).write_bytes(sm(o).read_bytes().replace(b"\n", b"\r\n"))),
        ("a11y controls", "contrast script broken", lambda o: (au(o).parent / "scripts" / "a11y_check.py").write_text("import sys; print('PASS 21.00:1'); sys.exit(0)\n", newline="\n")),
    ]
    tmp = Path(tempfile.mkdtemp(prefix="studiomind-selftest-"))
    try:
        clean = tmp / "clean"
        build(clean)
        base = run_gates(clean, quiet=True)
        if any(base.values()):
            print("RED: the clean build is not GREEN, so the sabotage results mean nothing")
            run_gates(clean)
            return 1
        print(f"clean build GREEN on all {len(GATES)} gates")
        failures = 0
        for i, (gate, what, sabotage) in enumerate(cases):
            o = tmp / f"s{i}"
            shutil.copytree(clean, o)
            sabotage(o)
            res = run_gates(o, quiet=True)
            red = [g for g, e in res.items() if e]
            ok = gate in red
            failures += not ok
            print(f"  {'caught' if ok else 'MISSED'}  {what:26s} -> RED on {', '.join(red) or 'nothing'}")
        # Restore check: the clean copy is still GREEN after all sabotage ran on copies.
        if any(run_gates(clean, quiet=True).values()):
            print("RED: clean build changed during the selftest")
            return 1
        print(f"{'GREEN' if not failures else 'RED'}: {len(cases) - failures} of {len(cases)} sabotages caught")
        return 1 if failures else 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(REPO / "dist" / "tableau-studio"))
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        return selftest()
    out = Path(args.out)
    build(out)
    files = [p for p in out.rglob("*") if p.is_file()]
    print(f"built {out} ({len(files)} files)")
    results = run_gates(out)
    if any(results.values()):
        print("RED: not zipped")
        return 1
    zpath = out.with_suffix(".zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, p.relative_to(out).as_posix())
    print(f"GREEN: {zpath} ({len(files)} files, {zpath.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
