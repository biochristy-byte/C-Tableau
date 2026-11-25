"""Sabotage proof for the Panel Chart gates: break one thing at a time, show the named gate go RED, restore.

  python test/sabotage.py [--only N]

For each entry: hash the file, apply ONE mutation (the old text must occur exactly once, so a drifted file fails
loudly instead of silently mutating nothing), run the gate meant to catch it, require a non-zero exit with a RED
line, then put the original bytes back and require the sha256 to match. At the end the unit gate and the full
browser gate must be GREEN on the restored tree. Exit 1 on any failure.
"""
import hashlib, os, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
EM = chr(0x2014)


def gate_cmd(g):
    if g == "unit":
        return ["node", "test/run.js"]
    cmd = [sys.executable, "test/browser_test.py"]
    if ":" in g:
        cmd += ["--only", g.split(":", 1)[1]]
    return cmd


# (what is broken, file, old text, new text, gate that must go RED)
S = [
    ("100% stacking no longer divides by the category total", "src/js/model.js", "if (mode === 'percent') v = sumAbs > 0 ? v / sumAbs * 100 : 0;", "if (mode === 'percent') v = v;", "unit"),
    ("text floor lowered to 9px", "src/js/model.js", "var MIN_FONT = 14;", "var MIN_FONT = 9;", "unit"),
    ("Largest first sorts smallest first", "src/js/model.js", "return mode === 'desc' ? tot[b] - tot[a] : tot[a] - tot[b];", "return tot[a] - tot[b];", "unit"),
    ("bar chart: bars drawn with no height", "src/js/render.js", "w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };", "w: lerp(a.w, b.w, t), h: 0 };", "browser:render"),
    ("line chart: lines drawn empty", "src/js/render.js", "if (m.kind === 'line') n.setAttribute('d', top);", "if (m.kind === 'line') n.setAttribute('d', '');", "browser:render"),
    ("area chart: areas drawn empty", "src/js/render.js", "n.setAttribute('d', top + (bottom ? 'L' + bottom.slice(1) : '') + 'Z');", "n.setAttribute('d', 'M0,0Z');", "browser:render"),
    ("scatter: points drawn with no size", "src/js/render.js", "+g.y.toFixed(2), +g.r.toFixed(2)));", "+g.y.toFixed(2), 0));", "browser:render"),
    ("text color only pushed to 2:1, not 7:1", "src/js/model.js", "[bg], 7);\n    var out", "[bg], 2);\n    var out", "browser:render"),
    ("mark colors no longer lifted to 3:1 (navy on navy)", "src/js/model.js", "var MARK_CONTRAST = 3;", "var MARK_CONTRAST = 1;", "unit"),
    ("value labels no longer avoid each other", "src/js/model.js", "for (var pi = 0; pi < placed.length; pi++) if (hit(b, placed[pi], 1)) return;", "", "browser:render"),
    ("a runtime network call (not sandbox safe)", "src/js/app.js", "  function boot() {\n", "  function boot() {\n    try { fetch('https://example.com/ping').catch(function () {}); } catch (e) { /* sabotage */ }\n", "browser:render"),
    ("the chart frame is fixed at 600px (390 sheet breaks)", "src/css/panelchart.css", "#pc-root { position: relative; width: 100%;", "#pc-root { position: relative; width: 600px;", "browser:sheet390"),
    ("panel title lost", "src/js/app.js", "title: 'Panel Chart settings'", "title: 'Settings'", "browser:panel"),
    ("panel changes no longer redraw the chart live", "src/js/app.js", "onChange: onChange, log: log", "onChange: function () {}, log: log", "browser:panel"),
    ("tooltip text painted in the border color (under 7:1)", "src/js/render.js", "st.background = tk.bg; st.color = tk.ink;", "st.background = tk.bg; st.color = tk.border;", "browser:interact"),
    ("That one mark no longer sends the series", "src/js/app.js", "if (sel[0].ser && m.hasSeries) crit.push", "if (false) crit.push", "browser:interact"),
    ("grid line style ignored (flip test)", "src/js/render.js", "(DASH[l.dash] ? ' stroke-dasharray=\"' + DASH[l.dash] + '\" stroke-linecap=\"round\"' : '')", "''", "browser:flip"),
    ("legend position ignored (flip test)", "src/js/model.js", "var pos = s.legendPos || 'top',", "var pos = 'top',", "browser:flip"),
    ("a 70 ms stall in every transition frame (jank)", "src/js/render.js", "function frame(now) {", "function frame(now) { var _b = performance.now(); while (performance.now() - _b < 70) { /* sabotage */ }", "browser:frames"),
    ("an em dash in a panel label", "src/js/settings.js", "label: 'Chart type'", "label: 'Chart type " + EM + " pick one'", "browser:emdash"),
]


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(gate):
    r = subprocess.run(gate_cmd(gate), cwd=str(ROOT), capture_output=True, text=True, env=ENV, encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


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
            print("%2d. SKIP  %s: old text occurs %d times" % (n, what, text.count(old)))
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
        print("%2d. %-7s %-16s | %s | %s | restored byte-exact: %s" % (n, "RED" if ok else "NOT RED", gate, what, reds[0][:90] if reds else "no RED line", restored), flush=True)
        if not ok:
            bad.append("#%d did not go RED under %s: %s" % (n, gate, what))
        if not restored:
            bad.append("#%d file %s NOT restored byte-exact" % (n, rel))
    for g in ("unit", "browser"):
        code, out = run(g)
        last = [l for l in out.splitlines() if l.strip()][-1:] or [""]
        print("final %s gate: %s" % (g, last[0]), flush=True)
        if code != 0 or "GREEN" not in last[0]:
            bad.append("final %s gate not GREEN" % g)
    if bad:
        print("SABOTAGE FAILED")
        for b in bad:
            print("  - " + b)
        sys.exit(1)
    print("SABOTAGE OK: %d of %d sabotages went RED, every file restored byte-exact, both gates GREEN after" % (red, len(S) if not only else 1))


main()
