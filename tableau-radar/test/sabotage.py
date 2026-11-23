"""Sabotage proof for the Radar gates: break one thing at a time, show the named gate go RED, restore.

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
    ("value clamp removed (a value past the outer ring escapes the chart)", "src/js/radar-math.js", "return t < 0 ? 0 : t > 1 ? 1 : t; }", "return t; }", "unit"),
    ("axis angles wrong (spokes bunch into half a circle)", "src/js/radar-math.js", "(dir < 0 ? -1 : 1) * 2 * Math.PI * i / n", "(dir < 0 ? -1 : 1) * Math.PI * i / n", "unit"),
    ("smoothing no longer clamped inside the outer circle", "src/js/radar-math.js", "return d > R ? {", "return d > R * 9 ? {", "unit"),
    ("title/label fitting never shortens text", "src/js/radar-math.js", "(/\\s+$/, '') + ELLIPSIS) > maxW) cut--;", "(/\\s+$/, '') + ELLIPSIS) > maxW + 9999) cut--;", "unit"),
    ("Label shelf ignored (axes keep their short keys)", "src/js/radar-math.js", "if (r.label && a.label === ak)", "if (false && r.label && a.label === ak)", "unit"),
    ("ring value size allowed below 14px", "src/js/settings.js", "label: 'Ring value size', type: 'number', min: 14", "label: 'Ring value size', type: 'number', min: 9", "unit"),
    ("hover no longer dims the other series", "src/css/radar.css", ".rd-svg.rd-focus .rd-s:not(.is-on) { opacity: var(--rd-dim, .25); }", ".rd-svg.rd-focus .rd-s:not(.is-on) { opacity: 1; }", "browser"),
    ("hover fade has no easing (a hard jump)", "src/css/radar.css", ".rd-s { cursor: pointer; transition: opacity var(--rd-ms, .18s) ease;", ".rd-s { cursor: pointer; transition: none;", "browser"),
    ("click-isolate leaves the others visible", "src/css/radar.css", ".rd-svg.rd-iso .rd-s:not(.is-on) { opacity: 0;", ".rd-svg.rd-iso .rd-s:not(.is-on) { opacity: 1;", "browser"),
    ("a same-size ResizeObserver callback redraws the chart (cuts a hover fade short)", "src/js/radar.js", "if (w === lastW && h === lastH) return false;", "", "browser"),
    ("small-multiples titles are not fitted to their cell", "src/js/render.js", "var ttext = M.fitLine(pn.title, tw0, function (t) { return tmeas(t, tsz); });", "var ttext = pn.title;", "browser"),
    ("settings prefix changed (saved and copied keys no longer match the Viz pages flow)", "src/js/radar.js", "var PREFIX = 'radar.';", "var PREFIX = 'rdr.';", "browser"),
    ("legend buttons lose their series key (the Series shelf no longer reaches the legend)", "src/js/render.js", "b.type = 'button'; b.setAttribute('data-key', x.key);", "b.type = 'button'; b.setAttribute('data-k', x.key);", "standin"),
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
