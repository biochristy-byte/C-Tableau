"""Proof that each gate can fail. Copies the extension to a temp folder, breaks ONE thing the gate
claims to check, runs the gate there, and requires a non-zero exit (RED). Then runs the same gate on
the untouched original and requires green. The original files are never modified.

  python tools/sabotage.py
"""
import shutil, subprocess, sys, tempfile, pathlib

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = pathlib.Path(__file__).resolve().parent.parent
NAME = ROOT.name

# (label, file, old, new, gate command)
SABOTAGES = [
    ('packing: children inflated 15%, so circles overlap', 'src/js/layout.js',
     "d3.pack().size([SPAN, SPAN]).padding(gap)(root);",
     "d3.pack().size([SPAN, SPAN]).padding(gap)(root); root.each(function (n) { if (n.parent) n.r *= 1.15; });",
     ['node', 'test/run.js']),
    ('labels: overlap rejection removed', 'src/js/layout.js',
     "if (hit(left, top, tw, h)) continue;", "",
     ['python', 'test/render_test.py']),
    ('text: label font floor lowered to 11px', 'src/js/render.js',
     "fs = Math.max(14, s.fontSize), cands", "fs = 11, cands",
     ['python', 'test/render_test.py']),
    ('contrast: chip colours made mid-grey on mid-grey', 'src/js/render.js',
     "chipBg: inkDark ? '#ffffff' : '#081f33', chipInk: inkDark ? INK_DARK : INK_LIGHT",
     "chipBg: '#8a9299', chipInk: '#6f7880'",
     ['python', 'test/render_test.py']),
    ('smoothness: a 45 ms busy-wait added to every zoom frame', 'src/js/render.js',
     "var t = (now - t0) / dur, w0 = performance.now();",
     "var t = (now - t0) / dur, w0 = performance.now(); while (performance.now() - w0 < 45) {}",
     ['python', 'test/render_test.py']),
    ('stand-in: encoding id renamed so the owner mapping no longer matches', 'src/js/app.js',
     "var LEVEL_IDS = ['level1', 'level2', 'level3'];", "var LEVEL_IDS = ['lvl1', 'lvl2', 'lvl3'];",
     ['python', 'test/standin_test.py']),
]
EXTRA = pathlib.Path(__file__).with_name('sabotage_extra.py')
if EXTRA.exists():
    exec(EXTRA.read_text(encoding='utf-8'))

def run(cmd, cwd):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    tail = [l for l in (r.stdout + r.stderr).strip().splitlines() if l.strip()][-2:]
    return r.returncode, ' | '.join(tail)

problems = 0
for label, rel, old, new, cmd in SABOTAGES:
    tmp = pathlib.Path(tempfile.mkdtemp(prefix=NAME + '-sab-'))
    work = tmp / NAME
    shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns('.git', 'node_modules', 'preview'))
    f = work / rel
    text = f.read_text(encoding='utf-8')
    if old not in text:
        print('BROKEN SABOTAGE (subject not found, proves nothing):', label); problems += 1; continue
    f.write_text(text.replace(old, new, 1), encoding='utf-8')
    code, tail = run(cmd, work)
    red = code != 0
    print('%s  %s\n      exit %d :: %s' % ('RED  ' if red else 'NOT RED', label, code, tail))
    if not red: problems += 1
    shutil.rmtree(tmp, ignore_errors=True)
for cmd in sorted({tuple(s[4]) for s in SABOTAGES}):
    code, tail = run(list(cmd), ROOT)
    print('%s  restored original: %s\n      exit %d :: %s' % ('GREEN' if code == 0 else 'NOT GREEN', ' '.join(cmd), code, tail))
    if code != 0: problems += 1
print('sabotage proof:', 'ALL GATES CAN FAIL AND THE ORIGINAL IS GREEN' if not problems else '%d PROBLEM(S)' % problems)
sys.exit(1 if problems else 0)
