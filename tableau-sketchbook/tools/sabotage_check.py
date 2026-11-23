"""Proves the gates can fail. For each sabotage: break one subject, run the gate that must catch it
(expect RED), restore the file BYTE-FOR-BYTE, run the gate again (expect GREEN).
A needle that does not match makes the sabotage itself FAIL (inverted), never a pass.
Run: python tools/sabotage_check.py"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PY = sys.executable
SABOTAGES = [
    ('determinism across a seed', 'src/js/render.js', b'seed = E.seedFor(s.seed, m.ci, m.si, 1);', b'seed = Math.floor(Math.random() * 1e9) + 1;', [[PY, 'test/render_test.py']]),
    ('negative bar height', 'src/js/engine.js', b'm.top = Math.min(m.y, zeroY); m.h = Math.abs(m.y - zeroY);', b'm.top = m.y; m.h = Math.abs(m.y - zeroY);', [['node', 'test/run.js'], [PY, 'test/render_test.py']]),
    ('7:1 ink choice', 'src/js/core.js', b'return contrast(INK_DARK, bg) >= contrast(INK_LIGHT, bg) ? INK_DARK : INK_LIGHT;', b'return INK_DARK;', [['node', 'test/run.js'], [PY, 'test/render_test.py']]),
    ('label overlap', 'src/js/render.js', [(b'this.thinned = HX.thin(order, 6);', b'this.thinned = 0;'), (b'Math.min(16, Math.max(maxChars, 8))', b'99')], [[PY, 'test/render_test.py']]),
    ('14px floor', 'src/js/schema.js', b"min: 14, max: 28", b"min: 8, max: 28", [['node', 'test/run.js']]),
    ('no sliders', 'src/js/schema.js', b"type: 'number', def: 1.2, min: 0, max: 5", b"type: 'range', def: 1.2, min: 0, max: 5", [['node', 'test/run.js']]),
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
