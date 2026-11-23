"""Sabotage proof for the Neurons gates: break one thing at a time, show the named gate go RED, restore.

  python test/sabotage.py [--only N]

For each entry: hash the file, apply ONE mutation (the old text must occur exactly once, so a drifted
file fails loudly instead of silently mutating nothing), run the gate that is meant to catch it, require
a non-zero exit with a RED line, then put the original bytes back and require the sha256 to match.
At the end every gate must be GREEN on the restored tree. Exit 1 on any failure.
Gates: unit (node test/run.js), D (panel), G (every setting changes the render), F (stand-in), A, B, C, E,
sync (shared/ctab-panel/sync_check.py must list tableau-neurons as ok).
"""
import hashlib, os, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SYNC = ROOT.parent / "shared" / "ctab-panel" / "sync_check.py"
ENV = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
PY = [sys.executable, "test/render.py"]
GATES = {
    "unit": ["node", "test/run.js"],
    "D": PY + ["--only=D"], "G": PY + ["--only=G"], "F": PY + ["--only=F"], "B": PY + ["--only=B"], "E": PY + ["--only=E"],
    "sync": [sys.executable, str(SYNC)],
}

# (what is broken, file, old text, new text, gate that must go RED)
S = [
    # ---- the panel checks (new with ctab-panel) ----
    ("the panel's store no longer redraws (a setting change does not re-render live)", "src/js/neurons.js", "onChange: onChange, log: log", "onChange: function () {}, log: log", "D"),
    ("settings saved under the wrong prefix (the saved strings and the Viz pages flow no longer match)", "src/js/neurons.js", "var PREFIX = 'neurons.';", "var PREFIX = 'nx.';", "D"),
    ("the old panelTheme is no longer carried into the new panel", "src/js/neurons.js", "if (lg.panel.theme && !cur.theme)", "if (false && lg.panel.theme && !cur.theme)", "D"),
    ("a chart tab is dropped from the schema (the panel loses its Hover tab)", "src/js/settings.js", "{ id: 'hover', label: 'Hover' }, ", "", "D"),
    ("chart css shrinks the panel's text under 14px", "src/css/neurons.css", ".nx-title[hidden] { display: none; }", ".nx-title[hidden] { display: none; } .cp-panel, .cp-panel * { font-size: 11px !important; }", "D"),
    ("chart css greys the panel's text under 7:1", "src/css/neurons.css", ".nx-title[hidden] { display: none; }", ".nx-title[hidden] { display: none; } .cp-panel, .cp-panel * { color: #8a8a8a !important; }", "D"),
    ("text size allowed below 14px", "src/js/settings.js", "label: 'Text size', type: 'number', min: 14", "label: 'Text size', type: 'number', min: 9", "unit"),
    ("an old saved key is renamed (a workbook loses its bundling strength)", "src/js/settings.js", "key: 'beta', label: 'Bundling strength (beta)'", "key: 'bundleBeta', label: 'Bundling strength (beta)'", "unit"),
    ("a setting key contains a dot (the Viz pages flow reads the last dot segment)", "src/js/settings.js", "key: 'haloSize', label: 'Halo size'", "key: 'halo.Size', label: 'Halo size'", "unit"),
    # ---- every setting changes the render (G) ----
    ("the weight floor is ignored", "src/js/neurons.js", "minWeight: s.minWeight });", "minWeight: 0 });", "G:minWeight"),
    ("node shape is ignored", "src/js/render.js", "if (settings.nodeShape === 'square')", "if (false)", "G:nodeShape"),
    ("halo size is ignored", "src/js/render.js", "r: rN * settings.haloSize,", "r: rN * 2.2,", "G:haloSize"),
    ("padding is ignored", "src/js/render.js", "var padPx = Math.max(0, Number(settings.padding) || 0);", "var padPx = 0;", "G:padding"),
    ("the readout maximum width is ignored", "src/js/render.js", "this.readout.style.maxWidth = settings.tipMaxW + 'px';", "", "G:tipMaxW"),
    ("the entrance duration and easing are ignored", "src/js/render.js", "settings.animMs + ',' + settings.animEase);", "'700,inout');", "G:animMs"),
    ("the hover fade time is ignored", "src/js/render.js", "var dur = instant || reducedMotion() ? 0 : s.fadeMs;", "var dur = instant || reducedMotion() ? 0 : 280;", "G:fadeMs"),
    ("click-select setting is ignored", "src/js/render.js", "if (!this.settings || !this.settings.clickSelect) return;", "if (!this.settings) return;", "G:clickSelect"),
    ("arc overhang is ignored by the layout", "src/js/layout.js", "var pad = o.arcPad === undefined ? 0.4 : o.arcPad;", "var pad = 0.4;", "unit"),
    # ---- the original gates still see the chart ----
    ("hover no longer dims the other links", "src/js/render.js", "this.layerTo = node && s.linkOpacity > 0 ? Math.min(1, s.dimOpacity / s.linkOpacity) : 1;", "this.layerTo = 1;", "B"),
    ("the stand-in's Source field is no longer picked up", "src/js/neurons.js", "model.srcField = srcF; model.tgtField = tgtF;", "model.srcField = null; model.tgtField = null;", "F"),
    # ---- the vendored panel library ----
    ("the vendored panel library drifts from shared/ctab-panel by one character", "lib/ctab-panel/ctab-panel.css", "/*", "/* ", "sync"),
]


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def cpu():
    r = subprocess.run(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_Processor).LoadPercentage"], capture_output=True, text=True)
    try:
        return int(r.stdout.strip().splitlines()[0])
    except Exception:
        return -1


def wait_quiet(limit=300):
    """Gates run at CPU under 50% (printed first); hover and frame timing gates flake under load that is not theirs."""
    import time
    t0, c = time.time(), cpu()
    while c >= 50 and time.time() - t0 < limit:
        time.sleep(6)
        c = cpu()
    print("      cpu %d%% before the gate" % c, flush=True)


def run(gate):
    wait_quiet()
    cmd = PY + ["--only=G", "--keys=" + gate[2:]] if gate.startswith("G:") else GATES[gate]
    r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, env=ENV, encoding="utf-8", errors="replace", timeout=900)
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
        if gate == "sync":
            if text.count(old) < 1:
                bad.append("#%d: nothing to break in %s" % (n, rel))
                continue
            mutated = text.replace(old, new, 1)
        else:
            if text.count(old) != 1:
                bad.append("#%d %s: the text to break occurs %d times in %s (expected 1)" % (n, what, text.count(old), rel))
                continue
            mutated = text.replace(old, new)
        try:
            p.write_bytes(mutated.encode("utf-8"))
            code, out = run(gate)
        finally:
            p.write_bytes(orig)
        restored = sha(p) == h0
        reds = [l for l in out.splitlines() if l.startswith("RED") or l.startswith("       - ")]
        ok = code != 0 and any(l.startswith("RED") for l in reds)
        red += ok
        first = next((l for l in reds if l.startswith("       - ")), reds[0] if reds else "no RED line")
        print("%2d. %-8s %-4s | %s | %s | restored byte-exact: %s" % (n, "RED" if ok else "NOT RED", gate, what, first.strip()[:70], restored), flush=True)
        if not ok:
            bad.append("#%d did not go RED under the %s gate: %s" % (n, gate, what))
        if not restored:
            bad.append("#%d file %s NOT restored byte-exact" % (n, rel))
    used = sorted({g.split(":")[0] for (_, _, _, _, g) in S})
    for g in ([] if only else used):
        code, out = run(g)
        last = [l for l in out.splitlines() if l.strip()][-1:] or [""]
        good = code == 0 and any(l.startswith("GREEN") for l in out.splitlines()) and (g != "sync" or "  ok    tableau-neurons" in out)
        print("final %s gate: %s" % (g, last[0][:100]), flush=True)
        if not good:
            bad.append("final %s gate not GREEN" % g)
    if bad:
        print("SABOTAGE FAILED")
        for b in bad:
            print("  - " + b)
        sys.exit(1)
    print("SABOTAGE OK: %d of %d sabotages went RED, every file restored byte-exact, %d gates GREEN after" % (red, len(S) if not only else 1, len(used) if not only else 0))


main()
