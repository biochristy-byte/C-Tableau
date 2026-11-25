"""Sync gate: every extension's vendored lib/ctab-panel/ must be a byte-exact copy of shared/ctab-panel/.

  python shared/ctab-panel/sync_check.py [--root C:/Users/bioch/C-Tableau]

For each <root>/tableau-*/ it compares the sha256 of every vendored file (ctab-panel.js, ctab-panel.css and every
file in fonts/, the bundled Inter and Poppins with their OFL licenses) against shared/. Exit 1 (RED) on any mismatch, a missing vendored file, or an unexpected extra file in
lib/ctab-panel/. Extensions that have no lib/ctab-panel/ yet are listed as SKIP, not counted as passing.
If no extension has a copy at all the gate says SKIP (nothing examined) and does not claim a pass.
"""
import argparse, hashlib, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
CORE = ["ctab-panel.js", "ctab-panel.css"]


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(HERE.parent.parent))
    ap.add_argument("--shared", default=str(HERE))
    a = ap.parse_args()
    root, shared = pathlib.Path(a.root), pathlib.Path(a.shared)
    fonts = sorted("fonts/" + x.name for x in (shared / "fonts").iterdir() if x.is_file()) if (shared / "fonts").is_dir() else []
    VENDORED = CORE + fonts
    truth = {}
    for f in VENDORED:
        if not (shared / f).is_file():
            print("RED  shared source is missing: %s" % (shared / f))
            return 1
        truth[f] = sha(shared / f)
    exts = sorted(p for p in root.glob("tableau-*") if p.is_dir())
    ok, bad, skip = [], [], []
    for e in exts:
        lib = e / "lib" / "ctab-panel"
        if not lib.is_dir():
            skip.append(e.name)
            continue
        problems = []
        for f in VENDORED:
            c = lib / f
            if not c.is_file():
                problems.append("%s missing" % f)
            elif sha(c) != truth[f]:
                problems.append("%s differs (copy %s, shared %s)" % (f, sha(c)[:12], truth[f][:12]))
        for extra in sorted(x.relative_to(lib).as_posix() for x in lib.rglob("*") if x.is_file() and x.relative_to(lib).as_posix() not in VENDORED):
            problems.append("unexpected file %s" % extra)
        (bad if problems else ok).append((e.name, problems))
    for n, _ in ok:
        print("  ok    %s" % n)
    for n, pr in bad:
        print("  DIFF  %s: %s" % (n, "; ".join(pr)))
    print("SKIP list (no lib/ctab-panel yet, %d): %s" % (len(skip), ", ".join(skip) if skip else "none"))
    print("examined %d of %d extension folders, %d files each; shared sha256 js %s css %s" % (len(ok) + len(bad), len(exts), len(VENDORED), truth["ctab-panel.js"][:12], truth["ctab-panel.css"][:12]))
    if bad:
        print("RED  %d vendored copies differ from shared/" % len(bad))
        return 1
    if not ok:
        print("SKIP  no extension has a copy yet, so nothing was compared (this is not a pass)")
        return 0
    print("GREEN  %d copies match shared/ byte for byte (%d extensions still on the SKIP list)" % (len(ok), len(skip)))
    return 0


sys.exit(main())
