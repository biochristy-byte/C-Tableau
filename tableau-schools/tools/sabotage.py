"""Proof that each gate can fail. Copies the extension to a temp folder, breaks ONE thing the gate
claims to check, runs the gate there, and requires RED (exit 1 or 2; exit 3 is a SKIP, which is not red).
It then writes the original bytes back into the copy and compares sha256, so the restore is proven
byte-exact, and finally runs every gate on the untouched original and requires green.
The original files are never modified; their hashes are compared before and after the whole run.

  python tools/sabotage.py
"""
import shutil, subprocess, sys, tempfile, pathlib, hashlib

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = pathlib.Path(__file__).resolve().parent.parent
NAME = ROOT.name

# (label, file, old, new, gate command)
SABOTAGES = [
    ('layout: circles inflated 25% after the fit, so they overlap', 'src/js/layout.js',
     "nd.y = nd.y * s + oy; nd.r *= s; });", "nd.y = nd.y * s + oy; nd.r *= s * 1.25; });",
     ['node', 'test/run.js']),
    ('layout: d3 simulation left running (.stop() removed)', 'src/js/layout.js',
     "d3.forceSimulation(nodes).stop()", "d3.forceSimulation(nodes)",
     ['node', 'test/run.js']),
    ('labels: overlap rejection removed (chips may stack)', 'src/js/layout.js',
     "if (hit(left, top, tw, h)) continue;", "",
     ['python', 'test/render_test.py']),
    ('text: label font floor lowered to 11px', 'src/js/render.js',
     "var fs = Math.max(14, s.fontSize), padX = 8", "var fs = 11, padX = 8",
     ['python', 'test/render_test.py']),
    ('contrast: chip colours made mid-grey on mid-grey', 'src/js/render.js',
     "chipBg: inkDark ? '#ffffff' : '#081f33', chipInk: inkDark ? INK_DARK : INK_LIGHT",
     "chipBg: '#8a9299', chipInk: '#6f7880'",
     ['python', 'test/render_test.py']),
    ('smoothness: a 45 ms busy-wait added to every morph frame', 'src/js/render.js',
     "var w0 = performance.now();\n      if (t0 === null)",
     "var w0 = performance.now(); while (performance.now() - w0 < 45) {}\n      if (t0 === null)",
     ['python', 'test/render_test.py']),
    ('smoothness: the whole layout put back inside one animation frame (no slicing)', 'src/js/render.js',
     "if (job.step(self.anim ? SLICE_MOVING : (self.nodes.length ? SLICE_STILL : SLICE_EMPTY)))", "if (job.step(Infinity))",
     ['python', 'test/render_test.py']),
    ('smoothness: the ORIGINAL shape restored (synchronous layout and DOM swap inside draw, right before the morph)', 'src/js/render.js',
     "    global.requestAnimationFrame(slice);   // first slice", "    job.step(Infinity); commit();",
     ['python', 'test/render_test.py']),
    ('jitter: circles nudged 0.01 to 0.02 px every frame after they settle', 'src/js/render.js',
     "this._place(1); this._labels();",
     "this._place(1); this._labels(); (function (self) { (function j() { self.nodes.forEach(function (n) { n.el.setAttribute('cx', (n.x + Math.random() * 0.02).toFixed(2)); }); requestAnimationFrame(j); })(); })(this);",
     ['python', 'test/render_test.py']),
    ('selection: the classList.toggle(undefined) bug put back (every circle toggles)', 'src/js/render.js',
     "var on = !!(sel && ((sel.node && sel.node === n) || (sel.cluster && sel.cluster === n.cl)));",
     "var on = !!sel && ((sel.node && sel.node === n) || (sel.cluster && sel.cluster === n.cl));",
     ['python', 'test/render_test.py']),
    ('stand-in: Colour encoding id misspelled, so the owner mapping no longer matches', 'src/js/app.js',
     "var colorField = has(enc.color) ? enc.color : null;", "var colorField = has(enc.colour) ? enc.colour : null;",
     ['python', 'test/standin_test.py']),
]

def sha(path): return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def tree_hashes(base):
    return {str(p.relative_to(base)): sha(p) for p in sorted(base.rglob('*')) if p.is_file() and not any(x in p.parts for x in ('.git', 'node_modules', 'preview', '__pycache__'))}

def run(cmd, cwd):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    tail = [l for l in (r.stdout + r.stderr).strip().splitlines() if l.strip()][-2:]
    return r.returncode, ' | '.join(tail)

before = tree_hashes(ROOT)
problems = 0
for label, rel, old, new, cmd in SABOTAGES:
    tmp = pathlib.Path(tempfile.mkdtemp(prefix=NAME + '-sab-'))
    work = tmp / NAME
    shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns('.git', 'node_modules', 'preview', '__pycache__'))
    f = work / rel
    original = (ROOT / rel).read_bytes()
    text = original.decode('utf-8')
    if text.count(old) != 1:
        print('BROKEN SABOTAGE (subject found %d times, proves nothing):' % text.count(old), label); problems += 1
        shutil.rmtree(tmp, ignore_errors=True); continue
    f.write_bytes(text.replace(old, new, 1).encode('utf-8'))
    changed = sha(f) != sha(ROOT / rel)
    code, tail = run(cmd, work)
    red = code in (1, 2)
    print('%s  %s\n      exit %d :: %s' % ('RED  ' if red and changed else 'NOT RED', label, code, tail))
    if not (red and changed): problems += 1
    f.write_bytes(original)
    exact = sha(f) == sha(ROOT / rel)
    print('      restored byte-exact (sha256 %s): %s' % (sha(ROOT / rel)[:12], 'yes' if exact else 'NO'))
    if not exact: problems += 1
    shutil.rmtree(tmp, ignore_errors=True)
for cmd in sorted({tuple(s[4]) for s in SABOTAGES}):
    code, tail = run(list(cmd), ROOT)
    print('%s  original: %s\n      exit %d :: %s' % ('GREEN' if code == 0 else 'NOT GREEN', ' '.join(cmd), code, tail))
    if code != 0: problems += 1
after = tree_hashes(ROOT)
same = before == after
print('original tree unchanged by this run (%d files, sha256 compared): %s' % (len(before), 'yes' if same else 'NO'))
if not same: problems += 1
print('sabotage proof:', 'ALL GATES CAN FAIL, EVERY RESTORE IS BYTE-EXACT, THE ORIGINAL IS GREEN' if not problems else '%d PROBLEM(S)' % problems)
sys.exit(1 if problems else 0)
