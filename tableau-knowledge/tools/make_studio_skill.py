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
SKILLS = ["studiomind", "studiomind-audit", "studiomind-setup", "studiomind-polish"]
PROFILE_TEMPLATES = ["profile-skill-template.md", "profile-knowledge-template.md"]
NEVER_FIX = {"D1", "D2", "D3", "D4", "D5", "L1"}          # what the numbers mean, or moving sheets
MIN_AUDIT_CHECKS = 14
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
REPO_URL = "https://github.com/biochristy-byte/C-Tableau/"


def build(out: Path) -> None:
    if out.exists():
        shutil.rmtree(out)
    for name in SKILLS:
        dest = out / "skills" / name
        (dest / "scripts").mkdir(parents=True)
        shutil.copy2(SRC / name / "SKILL.md", dest / "SKILL.md")
        shutil.copy2(A11Y, dest / "scripts" / "a11y_check.py")
    setup_refs = out / "skills" / "studiomind-setup" / "references"
    setup_refs.mkdir()
    for f in PROFILE_TEMPLATES:
        shutil.copy2(SRC / "studiomind-setup" / "references" / f, setup_refs / f)
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
    if len(files) < len(REFERENCES) + 2 * len(SKILLS) + len(PROFILE_TEMPLATES) + 3:
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
        out / "skills" / "studiomind-setup" / "references" / f for f in PROFILE_TEMPLATES] + [
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


def check_expertise(text: str, label: str) -> list:
    errs = [f"{label}: missing heading {h!r}" for h in EXPERTISE_H2 if h not in text]
    errs += [f"{label}: Scope Check missing {b!r}" for b in SCOPE_BULLETS if f"- {b}" not in text]
    if not re.match(r"# \S", text):
        errs.append(f"{label}: does not open with an H1 title")
    if text.lstrip().startswith("---"):
        errs.append(f"{label}: has frontmatter (Tableau expertise files take none)")
    return errs


def gate_expertise(out: Path) -> list:
    text = (out / "knowledge" / "studiomind-house-rules.md").read_text(encoding="utf-8")
    return check_expertise(text, "expertise")


def section(text: str, heading: str) -> str:
    """Body of a markdown section from its heading to the next heading of the same level."""
    level = heading.split(" ")[0]
    m = re.search(r"^" + re.escape(heading) + r"[^\n]*\n(.*?)(?=^" + level + r" |\Z)", text, re.S | re.M)
    return m.group(1) if m else ""


def profile_block(text: str):
    starts, ends = text.count("<!-- profile:start -->"), text.count("<!-- profile:end -->")
    if starts != 1 or ends != 1:
        return None
    return text.split("<!-- profile:start -->")[1].split("<!-- profile:end -->")[0]


def gate_profile(out: Path) -> list:
    """The profile setup writes: its templates, the two-copy rule, the load order, the refusal."""
    errs = []
    sk = out / "skills"
    refs = sk / "studiomind-setup" / "references"
    if (sk / "studiomind-profile").exists():
        errs.append("package ships skills/studiomind-profile: reinstalling would overwrite the author's profile")
    paths = [refs / f for f in PROFILE_TEMPLATES]
    if not all(p.is_file() for p in paths):
        return errs + ["profile templates missing from studiomind-setup/references"]
    skill_t, know_t = (p.read_text(encoding="utf-8") for p in paths)
    fm = frontmatter(skill_t)
    if fm.get("name") != "studiomind-profile" or not NAME_RE.match(fm.get("name", "")):
        errs.append(f"profile skill template: name {fm.get('name')!r} is not 'studiomind-profile'")
    d = fm.get("description", "")
    if not d or len(d) > DESC_SHORT:
        errs.append(f"profile skill template: description length {len(d)} outside 1..{DESC_SHORT}")
    for phrase in ("Load only when", "Do NOT trigger on any user request"):
        if phrase not in d:
            errs.append(f"profile skill template: description lacks {phrase!r}")
    errs += check_expertise(know_t, "profile knowledge template")
    a, b = profile_block(skill_t), profile_block(know_t)
    if a is None or b is None:
        errs.append("profile templates: each needs exactly one profile:start and one profile:end marker")
    else:
        if a != b:
            errs.append("profile templates: the profile blocks differ, so the two copies would drift")
        if len(re.findall(r"^- ", a, re.M)) < 10:
            errs.append(f"profile templates: block has {len(re.findall(r'^- ', a, re.M))} fields, expected 10 or more")
        if re.search(r"waiv", a, re.I):
            errs.append("profile templates: the block stores a waiver; floors are waived per session only")
    for name, t in (("skill", skill_t), ("knowledge", know_t)):
        if "never changes StudioMind's hard rules" not in t:
            errs.append(f"profile {name} template: lacks 'never changes StudioMind's hard rules'")
    setup = (sk / "studiomind-setup" / "SKILL.md").read_text(encoding="utf-8")
    for need in ("skills/studiomind-profile/SKILL.md", "knowledge/studiomind-profile.md",
                 "/reload-skills", "Refuse a line that would weaken a hard rule",
                 "never stores a waiver", "Call a value the author's default only if 2 or more dashboards"):
        if need not in setup:
            errs.append(f"studiomind-setup: lacks {need!r}")
    start = section((sk / "studiomind" / "SKILL.md").read_text(encoding="utf-8"), "## 0. Start of session")
    order = ["`studiomind-profile`", "knowledge/studiomind-profile.md", 'Search knowledge for "studiomind profile"']
    pos = [start.find(s) for s in order]
    if -1 in pos or pos != sorted(pos):
        errs.append("studiomind: section 0 does not try skill, then path, then search for the profile")
    if "studiomind-profile" not in (out / "authoring-override-block.md").read_text(encoding="utf-8"):
        errs.append("override block: does not load studiomind-profile")
    return errs


def gate_polish(out: Path) -> list:
    """Every audit check is either a fix polish may make or one it never makes, never both."""
    row = re.compile(r"^\| ([ADIL]\d) \|", re.M)
    audit = set(row.findall(section((out / "skills" / "studiomind-audit" / "SKILL.md").read_text(encoding="utf-8"), "## Step 3. Run the checks")))
    if len(audit) < MIN_AUDIT_CHECKS:
        return [f"polish: only {len(audit)} audit checks read, expected {MIN_AUDIT_CHECKS}"]
    text = (out / "skills" / "studiomind-polish" / "SKILL.md").read_text(encoding="utf-8")
    fix = set(row.findall(section(text, "## Fixes it may make")))
    never = set(row.findall(section(text, "## Never fixed")))
    errs = []
    if fix & never:
        errs.append(f"polish: {sorted(fix & never)} are in both the fix and never-fixed tables")
    if fix & NEVER_FIX:
        errs.append(f"polish: may fix {sorted(fix & NEVER_FIX)}, which change what the numbers mean")
    if NEVER_FIX - never:
        errs.append(f"polish: never-fixed table lacks {sorted(NEVER_FIX - never)}")
    if audit - fix - never:
        errs.append(f"polish: audit checks {sorted(audit - fix - never)} are in neither table")
    for need in ("File > Save As", "One fix, one OK", "Count before and after every fix",
                 "Re-run that one check", "Never delete a zone", "never remove or change one"):
        if need not in text:
            errs.append(f"polish: lacks {need!r}")
    for tool in ("author-calc", "add-field"):
        if tool in text:
            errs.append(f"polish: names {tool}, but polish never edits calcs or fields")
    return errs


def gate_law(out: Path) -> list:
    """Hard rules stay hard: the profile may change only the defaults."""
    errs = []
    sm = (out / "skills" / "studiomind" / "SKILL.md").read_text(encoding="utf-8")
    talk = section(sm, "## 2. How you talk")
    d, a = talk.find("Defaults (the profile can change these):"), talk.find("Always (hard rules):")
    f = talk.find("No honesty or certainty filler")
    if -1 in (d, a, f) or not d < a < f:
        errs.append("studiomind: the certainty-filler rule is not under 'Always (hard rules)'")
    if "Hard rules and defaults." not in sm:
        errs.append("studiomind: no 'Hard rules and defaults' statement")
    setup = section((out / "skills" / "studiomind-setup" / "SKILL.md").read_text(encoding="utf-8"), "## Hard constraints")
    for need in ("truth in numbers", "safety", "7:1", "10 pt", "Color Blind", "proof before done", "certainty-filler"):
        if need not in setup:
            errs.append(f"studiomind-setup: hard constraints do not name {need!r} as a hard rule")
    return errs


def gate_text(out: Path) -> list:
    errs = []
    for p in authored(out):
        rel = p.relative_to(out).as_posix()
        if not p.is_file():
            errs.append(f"{rel}: missing, so its text was not checked")
            continue
        text = p.read_text(encoding="utf-8")
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
        # The repo's own public URL is the download link; any other use of the account name is not.
        public = text.replace(REPO_URL, "")
        for pat in PRIVATE:
            m = re.search(pat, public)
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
         ("a11y controls", gate_a11y), ("line endings", gate_line_endings),
         ("profile", gate_profile), ("polish limits", gate_polish), ("hard rules", gate_law)]


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
    su = lambda o: o / "skills" / "studiomind-setup" / "SKILL.md"
    po = lambda o: o / "skills" / "studiomind-polish" / "SKILL.md"
    pst = lambda o: o / "skills" / "studiomind-setup" / "references" / "profile-skill-template.md"
    pkt = lambda o: o / "skills" / "studiomind-setup" / "references" / "profile-knowledge-template.md"

    def ship_profile(o):
        d = o / "skills" / "studiomind-profile"
        d.mkdir()
        shutil.copy2(pst(o), d / "SKILL.md")

    def d1_becomes_fixable(o):
        # The original defect shape: polish rewriting a rate formula.
        edit(po(o), "| D1 | Rate math changes the number readers see | The current formula, the `SUM([a]) / SUM([b])` rewrite, and the reason |\n", "")
        edit(po(o), "| A1 | Set the text color", "| D1 | Rewrite the rate as `SUM([a]) / SUM([b])` | none |\n| A1 | Set the text color")

    def filler_becomes_taste(o):
        text = sm(o).read_text(encoding="utf-8")
        filler = re.search(r"- No honesty or certainty filler:.*?State the thing\.\n", text, re.S).group(0)
        text = text.replace(filler, "").replace("Always (hard rules):\n", "Always (hard rules):\n", 1)
        text = text.replace("Defaults (the profile can change these):\n", "Defaults (the profile can change these):\n" + filler, 1)
        sm(o).write_text(text, encoding="utf-8", newline="\n")

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
        ("text rules", "account name off the URL", lambda o: edit(o / "README.md", "no idea\nwho you are", "no idea\nwho biochristy is")),
        ("line endings", "CRLF in a SKILL.md", lambda o: sm(o).write_bytes(sm(o).read_bytes().replace(b"\n", b"\r\n"))),
        ("a11y controls", "contrast script broken", lambda o: (au(o).parent / "scripts" / "a11y_check.py").write_text("import sys; print('PASS 21.00:1'); sys.exit(0)\n", newline="\n")),
        ("frontmatter", "polish has no boundary", lambda o: edit(po(o), "Do NOT trigger", "Skip")),
        ("files named", "profile template missing", lambda o: pkt(o).unlink()),
        ("profile", "profile skill renamed", lambda o: edit(pst(o), "name: studiomind-profile", "name: my-profile")),
        ("profile", "profile auto-triggers", lambda o: edit(pst(o), " Do NOT trigger on any user request.", "")),
        ("profile", "profile copies drift", lambda o: edit(pkt(o), "- Mode: {teach or do}", "- Mode: {do}")),
        ("profile", "profile copy not expertise", lambda o: edit(pkt(o), "- Tags:", "- Labels:")),
        ("profile", "package ships a profile", ship_profile),
        ("profile", "load order loses search", lambda o: edit(sm(o), 'Search knowledge for "studiomind profile"', "Ask the author")),
        ("profile", "remember never refuses", lambda o: edit(su(o), "Refuse a line that would weaken a hard rule", "Save any line the author gives")),
        ("profile", "profile stores a waiver", lambda o: edit(pst(o), "- Rule from the author:", "- Contrast floor: waived\n- Rule from the author:")),
        ("polish limits", "polish may fix rate math", d1_becomes_fixable),
        ("polish limits", "filters left unclassified", lambda o: edit(po(o), "| D5 | Filters belong to the author; never remove or change one | The filter and the title that conflicts with it |\n", "")),
        ("polish limits", "no Save As before fixing", lambda o: edit(po(o), "with File > Save As", "if they like")),
        ("polish limits", "polish edits calcs", lambda o: edit(po(o), "| A2 | Raise the text", "| A2 | Use author-calc to raise the text")),
        ("hard rules", "filler rule made taste", filler_becomes_taste),
        ("hard rules", "setup drops the 7:1 floor", lambda o: edit(su(o), "(7:1 text contrast, ", "(text contrast, ")),
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
