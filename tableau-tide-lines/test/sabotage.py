"""Sabotage proof for the Tide Lines gates: break one thing at a time, show the named gate go RED, restore.

  python test/sabotage.py [--only N]

For each entry: hash the file, apply ONE mutation (the old text must occur exactly once, so a drifted
file fails loudly instead of silently mutating nothing), run the gate that is meant to catch it, require
a non-zero exit with a RED line, then put the original bytes back and require the sha256 to match.
At the end all three gates must be GREEN on the restored tree. Exit 1 on any failure.
"""
import hashlib, os, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
GATES = {"unit": ["node", "test/run.js"], "browser": [sys.executable, "test/mock_render.py"], "standin": [sys.executable, "test/standin_test.py"]}

# (what is broken, file, old text, new text, gate that must go RED)
S = [
    ("bandwidth adjust multiplier dropped (the density no longer follows it)", "src/js/kde.js", " * (opts.bwMult > 0 ? opts.bwMult : 1);", ";", "unit"),
    ("sort by count removed", "src/js/kde.js", "} else if (mode === 'count') {", "} else if (mode === 'countx') {", "unit"),
    ("minimum font lowered below 14px", "src/js/layout.js", "var MIN_FONT = 14;", "var MIN_FONT = 9;", "unit"),
    ("old animate key no longer read (an old workbook loses its look)", "src/js/settings.js", "if (!have('animOn') && have('animate'))", "if (false && have('animate'))", "unit"),
    ("panel title lost (the shared panel is not the one that opens)", "src/js/tidelines.js", "title: 'Tide Lines settings'", "title: 'Settings'", "browser"),
    ("panel changes no longer redraw the chart live", "src/js/tidelines.js", "onChange: onChange, log: log", "onChange: function () {}, log: log", "browser"),
    ("outline strength setting ignored (flip test: output does not change)", "src/js/render.js", "'stroke-opacity': s.outlineOpacity / 100", "'stroke-opacity': 1", "browser"),
    ("names-on-the-right setting ignored (flip test)", "src/js/render.js", "leftSide = s.labelSide !== 'right'", "leftSide = true", "browser"),
    ("highlight-on-hover switch ignored (flip test)", "src/js/render.js", "if (s.hoverOn) {", "if (true) {", "browser"),
    ("click-selects switch ignored (flip test and the old selectEnabled key)", "src/js/render.js", "if (!s.selectOn) return;", "", "browser"),
    ("Send hover to Tableau switch ignored (hover is pushed even when off)", "src/js/tidelines.js", "if (!ws || !s.hoverPush || !s.hoverOn || typeof", "if (!ws || !s.hoverOn || typeof", "browser"),
    ("old saved keys are read but never applied (browser, old workbook)", "src/js/tidelines.js", "if (Object.keys(old).length) store.setMany(old);", "", "browser"),
    ("old bgMatch key no longer read (a viz-page workbook loses its navy background)", "src/js/settings.js", "if (!have('bgMode') && have('bgMatch'))", "if (false && have('bgMatch'))", "standin"),
]


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(gate):
    r = subprocess.run(GATES[gate], cwd=str(ROOT), capture_output=True, text=True, env=ENV, encoding="utf-8", errors="replace")
    out = (r.stdout or "") + (r.stderr or "")
    return r.returncode, out


def main():
    only = int(sys.argv[sys.argv.index("--only") + 1]) if "--only" in sys.argv else None
    bad, red = [], 0
    for n, (what, rel, old, new, gate) in enumerate(S, 1):
        if only and n != only:
            continue
        p = ROOT / rel
        orig = p.read_bytes()
        h0 = sha(p)
        text = orig.decode("utf-8")
        if text.count(old) != 1:
            bad.append("#%d %s: the text to break occurs %d times in %s (expected 1)" % (n, what, text.count(old), rel))
            continue
        try:
            p.write_bytes(text.replace(old, new).encode("utf-8"))
            code, out = run(gate)
        finally:
            p.write_bytes(orig)
        restored = sha(p) == h0
        reds = [l for l in out.splitlines() if l.startswith("RED")]
        ok = code != 0 and bool(reds)
        red += ok
        print("%2d. %-5s %s | %s | %s | restored byte-exact: %s" % (n, "RED" if ok else "NOT RED", gate, what, reds[0][:60] if reds else "no RED line", restored))
        if not ok:
            bad.append("#%d did not go RED under the %s gate: %s" % (n, gate, what))
        if not restored:
            bad.append("#%d file %s NOT restored byte-exact" % (n, rel))
    for g in GATES:
        code, out = run(g)
        last = [l for l in out.splitlines() if l.strip()][-1:] or [""]
        print("final %s gate: %s" % (g, last[0]))
        if code != 0 or "GREEN" not in last[0]:
            bad.append("final %s gate not GREEN" % g)
    if bad:
        print("SABOTAGE FAILED")
        for b in bad:
            print("  - " + b)
        sys.exit(1)
    print("SABOTAGE OK: %d of %d sabotages went RED, every file restored byte-exact, all 3 gates GREEN after" % (red, len(S) if not only else 1))


main()
