"""Proves the gates can fail. For each sabotage: break one subject, run the gate that must catch it
(expect RED), restore the file BYTE-FOR-BYTE, run the gate again (expect GREEN).
A needle that does not match makes the sabotage itself FAIL (inverted), never a pass.
Run: python tools/sabotage_check.py"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PY = sys.executable
PANEL = [PY, 'test/panel_test.py']
SABOTAGES = [
    ('exact band count', 'src/js/engine.js', b'for (var i = 0; i < levels; i++) {', b'for (var i = 0; i < levels - 1; i++) {', [['node', 'test/run.js']]),
    ('ring closing check', 'src/js/engine.js', b'return ring.length >= 4 && a[0] === b[0] && a[1] === b[1];', b'return ring.length >= 4;', [['node', 'test/run.js']]),
    ('7:1 ink choice', 'src/js/core.js', b'return contrast(INK_DARK, bg) >= contrast(INK_LIGHT, bg) ? INK_DARK : INK_LIGHT;', b'return INK_DARK;', [['node', 'test/run.js'], [PY, 'test/render_test.py']]),
    ('label overlap', 'src/js/render.js', [(b'this.thinned = HX.thin(order, 8);', b'this.thinned = 0;'), (b'tickN(Math.floor(pw / (fs * 5)))', b'tickN(Math.floor(pw / 11))')], [[PY, 'test/render_test.py']]),
    ('14px floor (chart text can drop under 14px)', 'src/js/render.js', b'var fs = s.labelSize, labels = s.labelsOn;', b'var fs = Math.min(9, s.labelSize), labels = s.labelsOn;', [[PY, 'test/render_test.py']]),
    # --- the ctab-panel migration
    ('a setting stops changing the render (hover dim ignored)', 'src/js/render.js', b"chart.style.setProperty('--dl-dim', String(s.dimOthers / 100));", b"chart.style.setProperty('--dl-dim', '1');", [PANEL + ['--only', 'flip']]),
    ('hover is pushed to Tableau even when the setting is off', 'src/js/depth-lines.js', b'if (!ws || !s.hoverOn || !s.hoverPush || id === lastHover) return;', b'if (!ws || id === lastHover) return;', [PANEL + ['--only', 'flip']]),
    ('old fontSize key no longer read as a fallback', 'src/js/settings.js', b'{ labelSize: n, titleSize: Math.round(n * 1.3) }', b'{ labelSize: 14, titleSize: 18 }', [['node', 'test/run.js'], PANEL + ['--only', 'legacy']]),
    ('panel no longer clamps to the frame (vendored copy)', 'lib/ctab-panel/ctab-panel.js', b'return { x: Math.round(Math.max(0, Math.min(hs.w - w, x))), y: Math.round(Math.max(0, Math.min(hs.h - h, y))) };', b'return { x: Math.round(x), y: Math.round(y) };', [PANEL + ['--only', 'panel']]),
    ('the vendored panel drifts from shared/ (one byte changed)', 'lib/ctab-panel/ctab-panel.js', b"var VERSION = '1.0.0';", b"var VERSION = '1.0.1';", [[PY, '../shared/ctab-panel/sync_check.py', '--root', '..']]),
    ('three standard tabs dropped (the panel is no longer the standard set)', 'src/js/settings.js', b'var std = CP.standard({', b"var std = CP.standard({ skip: ['tooltip', 'animation', 'numbers'],", [['node', 'test/run.js']]),
]
SEL = [a for a in sys.argv[1:]]


def run(cmd):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    last = (r.stdout.strip().splitlines() or ['(no output)'])[0]
    return r.returncode, last


rows, bad = [], 0
for item in SABOTAGES:
    name, rel, needle, gates = item[0], item[1], item[2], item[-1]
    repl = item[3] if len(item) == 5 else None
    if SEL and name not in SEL:
        continue
    p = ROOT / rel
    orig = p.read_bytes()
    edits = needle if isinstance(needle, list) else [(needle, repl)]
    miss = [e[0] for e in edits if orig.count(e[0]) != 1]
    if miss:
        rows.append((name, 'FAIL (inverted): needle did not match exactly once: %r' % miss[0][:50], '')); bad += 1; continue
    try:
        mod = orig
        for a, b in edits:
            mod = mod.replace(a, b)
        p.write_bytes(mod)
        reds = [run(g) for g in gates]
    finally:
        p.write_bytes(orig)
    assert p.read_bytes() == orig
    greens = [run(g) for g in gates]
    ok = any(c != 0 for c, _ in reds) and all(c == 0 for c, _ in greens)
    bad += 0 if ok else 1
    rows.append((name, 'RED  ' + ' | '.join(l[:90] for c, l in reds if c != 0) if any(c != 0 for c, _ in reds) else 'NOT RED (gate cannot fail here)', 'GREEN ' + ' | '.join(l[:70] for _, l in greens)))
for n, r, g in rows:
    print('%-26s sabotaged: %s\n%-26s restored:  %s' % (n, r, '', g))
print('SABOTAGE CHECK:', 'all %d gates able to fail' % len(rows) if not bad else '%d PROBLEM(S)' % bad)
sys.exit(1 if bad else 0)
