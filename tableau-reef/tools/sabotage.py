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
     "return gap + (parent.depth === 0 ? top : inner); })(root);",
     "return gap + (parent.depth === 0 ? top : inner); })(root); root.each(function (n) { if (n.parent) n.r *= 1.15; });",
     ['node', 'test/run.js']),
    ('labels: overlap rejection removed', 'src/js/layout.js',
     "if (hit(left, top, tw, h)) continue;", "",
     ['python', 'test/render_test.py']),
    ('text: label font floor lowered to 11px', 'src/js/render.js',
     "fs = Math.max(14, s.fontSize), cands", "fs = 11, cands",
     ['python', 'test/render_test.py']),
    ('contrast: chip colours made mid-grey on mid-grey', 'src/js/render.js',
     "chipBg: inkDark ? '#ffffff' : '#081f33', chipInk: chipInk,",
     "chipBg: '#8a9299', chipInk: '#6f7880',",
     ['python', 'test/render_test.py']),
    ('smoothness: a 45 ms busy-wait added to every zoom frame', 'src/js/render.js',
     "var t = (now - t0) / dur, w0 = performance.now();",
     "var t = (now - t0) / dur, w0 = performance.now(); while (performance.now() - w0 < 45) {}",
     ['python', 'test/render_test.py']),
    ('labels: a truncated stub is offered again when the whole name does not fit', 'src/js/render.js',
     "texts.push(name);",
     "texts.push(name); texts.push(name.slice(0, 4) + '...');",
     ['python', 'test/render_test.py']),
    ('single-child chains: folding switched off (unit gate)', 'src/js/layout.js',
     "var data = opts.fold === false ? plain(top) : collapse(plain(top), true);", "var data = plain(top);",
     ['node', 'test/run.js']),
    ('single-child chains: folding switched off (render gate)', 'src/js/layout.js',
     "var data = opts.fold === false ? plain(top) : collapse(plain(top), true);", "var data = plain(top);",
     ['python', 'test/render_test.py']),
    ('crowding: every descendant labelled again, not just the focus level', 'src/js/render.js',
     "[f].concat(f.children || []).forEach(function (n) {", "f.descendants().forEach(function (n) {",
     ['python', 'test/render_test.py']),
    ('stand-in: encoding id renamed so the owner mapping no longer matches', 'src/js/app.js',
     "var LEVEL_IDS = ['level1', 'level2', 'level3'];", "var LEVEL_IDS = ['lvl1', 'lvl2', 'lvl3'];",
     ['python', 'test/standin_test.py']),
    # ---- the shared panel and the settings, added with the ctab-panel migration ----
    ('panel: drag no longer clamped to the frame (lib copy)', 'lib/ctab-panel/ctab-panel.js',
     "return { x: Math.round(Math.max(0, Math.min(hs.w - w, x))), y: Math.round(Math.max(0, Math.min(hs.h - h, y))) };", "return { x: Math.round(x), y: Math.round(y) };",
     ['python', 'test/render_test.py']),
    ('panel: Escape no longer closes it (lib copy)', 'lib/ctab-panel/ctab-panel.js',
     "if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }", "if (e.key === 'EscapeNever') { e.preventDefault(); e.stopPropagation(); close(); return; }",
     ['python', 'test/render_test.py']),
    ('panel: minimize button does nothing (lib copy)', 'lib/ctab-panel/ctab-panel.js',
     "if (a === 'min') { ps.min = !ps.min;", "if (a === 'min') { ps.min = ps.min;",
     ['python', 'test/render_test.py']),
    ('panel: text drops to 13px (lib css copy)', 'lib/ctab-panel/ctab-panel.css',
     ".cp-help { grid-column: 1 / 3; color: var(--cp-muted); font-size: 1em; }", ".cp-help { grid-column: 1 / 3; color: var(--cp-muted); font-size: 13px; }",
     ['python', 'test/render_test.py']),
    ('panel: a setting change no longer re-renders the chart (onChange dropped)', 'src/js/app.js',
     "onChange: function () { redraw(); }, log: log });", "onChange: function () { }, log: log });",
     ['python', 'test/render_test.py']),
    ('settings: the outline style row is not wired to the circles', 'src/js/render.js',
     "if (s.ringStyle === 'dashed') c.setAttribute('stroke-dasharray', '7 5');", "if (false) c.setAttribute('stroke-dasharray', '7 5');",
     ['python', 'test/settings_test.py']),
    ('settings: Levels to draw is ignored by the tree', 'src/js/render.js',
     "var lv = Math.max(1, Math.min(model.levels, s.maxDepth)),", "var lv = Math.max(1, model.levels),",
     ['python', 'test/settings_test.py']),
    ('settings: the Level 3 field picker no longer reaches the tree (stale cache key)', 'src/js/app.js',
     "version: [state.dataVersion, levelFields.join('/'), sizeField || '', colorField || '', colorIsNum].join(':'),", "version: state.dataVersion + ':' + (colorField || '') + ':' + colorIsNum,",
     ['python', 'test/settings_test.py']),
    ('settings: an old workbook font stack is no longer read (legacy fallback gone, unit)', 'src/js/settings.js',
     "var first = v.split(',')[0].trim().toLowerCase();", "var first = 'nothing';",
     ['node', 'test/run.js']),
    ('settings: an old workbook font stack is no longer read (legacy fallback gone, stand-in)', 'src/js/settings.js',
     "if (LEGACY[key]) { var lv = LEGACY[key](function (old) { return st.get(pre + old); }); if (lv !== undefined) return lv; }", "",
     ['python', 'test/standin_test.py']),
    ('settings: standard rows dropped (tooltip, number, title, border, animation rows and the shipped tooltips key vanish)', 'src/js/settings.js',
     "var DROP = { palette: 1, labelLines: 1, valueLabels: 1, valueLabelSize: 1 };", "var DROP = { palette: 1, labelLines: 1, valueLabels: 1, valueLabelSize: 1, tipOn: 1, tipSize: 1, tipSwatch: 1, tipFollow: 1, tipMaxW: 1, numDecimals: 1, numThousands: 1, numCompact: 1, numScale: 1, numPrefix: 1, numSuffix: 1, titleSize: 1, titleWeight: 1, titleText: 1, showTitle: 1, borderOn: 1, borderColor: 1, borderWidth: 1, borderRadius: 1, padding: 1, labelWeight: 1, labelColor: 1, hoverMs: 1, animMs: 1, animEase: 1, dimOthers: 1, hoverOn: 1, hoverPush: 1, paletteReverse: 1, catColors: 1 };",
     ['node', 'test/run.js']),
]
EXTRA = pathlib.Path(__file__).with_name('sabotage_extra.py')
if EXTRA.exists():
    exec(EXTRA.read_text(encoding='utf-8'))

def run(cmd, cwd):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    tail = [l for l in (r.stdout + r.stderr).strip().splitlines() if l.strip()][-2:]
    return r.returncode, ' | '.join(tail)

import hashlib
def tree_hash():
    h = hashlib.sha256()
    for q in sorted(ROOT.rglob('*')):
        if q.is_file() and 'preview' not in q.parts and '__pycache__' not in q.parts and '.git' not in q.parts:
            h.update(str(q.relative_to(ROOT)).encode()); h.update(q.read_bytes())
    return h.hexdigest()
ONLY = None
if '--only' in sys.argv:
    ONLY = int(sys.argv[sys.argv.index('--only') + 1])
    SABOTAGES = [SABOTAGES[ONLY - 1]]
before = tree_hash()
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
after = tree_hash()
print('original tree restored byte-exact (sha256 before == after):', before == after)
if before != after: problems += 1
print('sabotage proof:', 'ALL GATES CAN FAIL AND THE ORIGINAL IS GREEN' if not problems else '%d PROBLEM(S)' % problems)
sys.exit(1 if problems else 0)
