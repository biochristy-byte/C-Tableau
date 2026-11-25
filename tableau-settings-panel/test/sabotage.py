"""Sabotage proof for the Settings Panel gates: break one thing at a time, show the named gate go RED, restore.

  python test/sabotage.py [--only N,N]

For each entry: hash the file, apply ONE mutation (the old text must occur exactly once, so a drifted file fails
loudly instead of silently mutating nothing), run the gate meant to catch it (browser gates run only the named
group, which is what makes 20 sabotages affordable), require a non-zero exit with a RED line, put the original
bytes back and require the sha256 to match. At the end the unit gate and the FULL browser gate must be GREEN on the
restored tree. Exit 1 on any failure.
"""
import hashlib, os, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
EM = chr(0x2014)


def gate(name):
    if name == "unit":
        return ["node", "test/run.js"]
    return [sys.executable, "test/browser_test.py"] + (["--only", name.split(":", 1)[1]] if ":" in name else [])


# (what is broken, file, old text, new text, gate that must go RED)
S = [
    ("a shared filter is applied to the first sheet only", "src/js/model.js", "function each(copies, fn) { return Promise.all(copies.map(", "function each(copies, fn) { return Promise.all(copies.slice(0, 1).map(", "unit"),
    ("presets forget filters (capture skips them)", "src/js/model.js", "      if (g.unsupported) return;\n      if (g.type === 'categorical')", "      if (true) return;\n      if (g.type === 'categorical')", "unit"),
    ("a yes/no parameter gets chips instead of a toggle", "src/js/model.js", "if (dt === 'bool') { c.control = 'toggle';", "if (dt === 'boolx') { c.control = 'toggle';", "unit"),
    ("search ignores the query", "src/js/model.js", "q = words(q).trim(); if (!q) return true;", "q = words(q).trim(); return true;", "unit"),
    ("an em dash in a button label", "src/js/panel.js", "Save as preset</button>", "Save " + EM + " preset</button>", "unit"),
    ("a network call at startup (not sandbox-safe)", "src/js/app.js", "  function boot() {\n", "  function boot() {\n    try { fetch('https://example.com/ping'); } catch (e) { /* sabotage */ }\n", "unit"),
    ("parameter chips change the panel but never call Tableau", "src/js/panel.js", "if (act === 'pchip') { c.value = v; queue(c.id, 0, function () { return M.setParam(c, v); }", "if (act === 'pchip') { c.value = v; queue(c.id, 0, function () { return null; }", "browser:params"),
    ("steppers send every click (no batching)", "src/js/panel.js", "queue(c.id, 250, function () { return M.setParam(c, v); }", "queue(c.id + Math.random(), 250, function () { return M.setParam(c, v); }", "browser:params"),
    ("the relative date anchor stepper does nothing", "src/js/panel.js", "if (act === 'rela') { c.anchor = M.addPeriod(c.anchor, c.period, d);", "if (act === 'rela') { c.anchor = M.addPeriod(c.anchor, c.period, 0);", "browser:filters"),
    ("highlight on every sheet only highlights one", "src/js/panel.js", "return ws.name === sheet || (S.hlAll &&", "return ws.name === sheet || (false &&", "browser:highlight"),
    ("presets are kept in memory but never saved to the workbook", "src/js/panel.js", "return M.savePresets(st, S.presets); }).then(function () { say(msg); }", "return null; }).then(function () { say(msg); }", "browser:presets"),
    ("first run no longer captures the workbook defaults", "src/js/app.js", "if (!M.loadDefaults(st)) {", "if (false) {", "browser:reset"),
    ("the zone never grows when the panel opens", "src/js/app.js", "    if (!z || !z.isFloating) return;\n", "    if (!z || !z.isFloating || open) return;\n", "browser:render"),
    ("Escape no longer closes the panel", "src/js/panel.js", "        close(); return;\n      }\n      if (e.key === 'Enter' && k === 'pname')", "        return;\n      }\n      if (e.key === 'Enter' && k === 'pname')", "browser:keyboard"),
    ("list values drop to 12px", "src/css/sp.css", ".sp-item { min-height: 32px; font-weight: 400; }", ".sp-item { min-height: 32px; font-weight: 400; font-size: 12px; }", "browser:floor"),
    ("a filter summary in a pale grey (under 7:1)", "src/css/sp.css", ".sp-sum { flex: none; color: var(--cp-ink); font-weight: 400; }", ".sp-sum { flex: none; color: #8a96a3; font-weight: 400; }", "browser:contrast"),
    ("the filter caret slides under its name", "src/css/sp.css", ".sp-caret { width: 14px; flex: none; color: var(--cp-ink); }", ".sp-caret { width: 14px; flex: none; color: var(--cp-ink); margin-right: -40px; }", "browser:overlap"),
    ("the sheet layout never kicks in at 390", "src/js/panel.js", "S.sheet = hostSize().w < 420;", "S.sheet = hostSize().w < 300;", "browser:sheet390"),
    ("a 70 ms busy loop on every redraw (jank)", "src/js/panel.js", "      renders++;\n", "      renders++; var t0 = performance.now(); while (performance.now() - t0 < 70) { /* sabotage */ }\n", "browser:frames"),
    ("a slider sneaks into the Panel tab", "src/js/panel.js", "out += '<div class=\"cp-sec\">Position</div>", "out += '<input type=\"range\" aria-label=\"Size\">' + '<div class=\"cp-sec\">Position</div>", "browser:rules"),
]


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(g):
    r = subprocess.run(gate(g), cwd=str(ROOT), capture_output=True, text=True, env=ENV, encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def main():
    only = [int(x) for x in sys.argv[sys.argv.index("--only") + 1].split(",")] if "--only" in sys.argv else None
    bad, red = [], 0
    for n, (what, rel, old, new, g) in enumerate(S, 1):
        if only and n not in only:
            continue
        p = ROOT / rel
        orig = p.read_bytes()
        h0 = sha(p)
        text = orig.decode("utf-8")
        if text.count(old) != 1:
            bad.append("#%d %s: the text to break occurs %d times in %s (expected 1)" % (n, what, text.count(old), rel))
            print("%2d. SKIP  %s: anchor occurs %d times" % (n, what, text.count(old)))
            continue
        try:
            p.write_bytes(text.replace(old, new).encode("utf-8"))
            code, out = run(g)
        finally:
            p.write_bytes(orig)
        restored = sha(p) == h0
        reds = [l for l in out.splitlines() if l.startswith("RED")]
        fails = [l for l in out.splitlines() if l.startswith("FAIL")]
        ok = code != 0 and bool(reds)
        red += ok
        print("%2d. %-7s %-17s | %s | %s | restored byte-exact: %s" % (n, "RED" if ok else "NOT RED", g, what, (fails[0] if fails else reds[0] if reds else "no RED line")[:90], restored))
        if not ok:
            bad.append("#%d did not go RED under %s: %s" % (n, g, what))
        if not restored:
            bad.append("#%d file %s NOT restored byte-exact" % (n, rel))
    for g in ("unit", "browser"):
        code, out = run(g)
        last = [l for l in out.splitlines() if l.strip()][-1:] or [""]
        print("final %s gate: %s" % (g, last[0]))
        if code != 0 or not last[0].startswith("GREEN"):
            bad.append("final %s gate not GREEN" % g)
    if bad:
        print("SABOTAGE FAILED")
        for b in bad:
            print("  - " + b)
        sys.exit(1)
    print("SABOTAGE OK: %d of %d sabotages went RED, every file restored byte-exact, both gates GREEN after" % (red, len(only) if only else len(S)))


main()
