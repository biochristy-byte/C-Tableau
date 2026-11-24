"""Sabotage proof for the ctab-panel gates: break the subject of each test once, show RED, restore the file
byte-exact (sha256 checked), and finish with both gates GREEN.

  python test/sabotage.py

Each entry names the file, the exact text to break (it must occur exactly once, or the sabotage could not
have changed anything and the run aborts), and the gate to run. Exit 0 only if every sabotage went RED, every
restore matched, and the final full run is GREEN.
"""
import hashlib, os, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
JS, CSS, UNIT = "ctab-panel.js", "ctab-panel.css", "test/schema_test.js"
PW = [sys.executable, "test/panel_test.py", "--only"]
NODE = ["node", "test/schema_test.js"]

S = [
    ("drag clamp removed", JS, "Math.max(0, Math.min(hs.w - w, x))", "Math.max(0, x)", PW + ["drag,touch"]),
    ("touch drag ignored (mouse still works)", JS, "if (e.pointerType === 'mouse' && e.button !== 0) return;", "if (e.pointerType !== 'mouse') return;", PW + ["touch"]),
    ("minimize no longer hides the body", CSS, ".cp-panel.cp-min .cp-main { display: none; }", ".cp-panel.cp-min .cp-main { display: block; }", PW + ["minimize"]),
    ("position and minimized state not saved", JS, "try { if (opts.state && opts.state.set) opts.state.set(", "try { if (false && opts.state && opts.state.set) opts.state.set(", PW + ["persist"]),
    ("focus is not returned to the gear", JS, "      gear.focus();\n      if (opts.onToggle) opts.onToggle(false);", "      if (opts.onToggle) opts.onToggle(false);", PW + ["close"]),
    ("Escape no longer closes from inside the panel", JS, "if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }", "if (e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); close(); return; }", PW + ["escape"]),
    ("search matches ANY word instead of every word", JS, "return words.every(function (w) { return h.indexOf(w) >= 0; });", "return words.some(function (w) { return h.indexOf(w) >= 0; });", PW + ["search"]),
    ("when conditions ignored (every row always shown)", JS, "    if (!w) return true;\n    if (typeof w === 'function')", "    return true;\n    if (typeof w === 'function')", PW + ["conditional"]),
    ("Cancel on the reset confirm resets anyway", JS, "if (a === 'confirmno') { mode = 'idle'; confirm = null;", "if (a === 'confirmno') { bulk(defaultsFor(keysOfTab(confirm.tabId)), 'x'); mode = 'idle'; confirm = null;", PW + ["reset"]),
    ("Undo does nothing", JS, "      store.setMany(u.prev);\n      say('Undid '", "      say('Undid '", PW + ["undo"]),
    ("bad-JSON paste message removed", JS, "message: 'That is not valid JSON. Paste the text exactly as Copy settings made it.'", "message: ''", PW + ["copypaste"]),
    ("chips are skipped by Tab (unreachable by keyboard)", JS, "class=\"cp-chip\" data-a=\"chip\"", "class=\"cp-chip\" tabindex=\"-1\" data-a=\"chip\"", PW + ["keyboard"]),
    ("help text drops to 12px", CSS, ".cp-help { grid-column: 1 / 3; color: var(--cp-muted); font-size: 14px; }", ".cp-help { grid-column: 1 / 3; color: var(--cp-muted); font-size: 12px; }", PW + ["floor"]),
    ("muted text loses its 7:1 guarantee", JS, "var muted = ensureContrast(mix(ink, bg, 0.25), [bg, surface], 7.2);", "var muted = mix(ink, bg, 0.6);", PW + ["contrast"]),
    ("a range input appears in number rows", JS, "return lab + '<div class=\"cp-num\">", "return lab + '<input type=\"range\" class=\"x\">' + '<div class=\"cp-num\">", PW + ["norange"]),
    ("a browser confirm() dialog is used for reset", JS, "mode = 'confirm'; confirm = {", "window.confirm('x'); mode = 'confirm'; confirm = {", PW + ["norange,reset"]),
    ("sheet breakpoint moved from 420 to 300", JS, "sheet = hs.w < 420;", "sheet = hs.w < 300;", PW + ["sheet"]),
    ("change notices no longer batched per frame", JS, "if (typeof requestAnimationFrame === 'function') noteTimer = requestAnimationFrame(fire); else noteTimer = setTimeout(fire, 0);", "fire();", PW + ["live"]),
    ("saves no longer debounced", JS, "saveTimer = setTimeout(flush, wait); }", "flush(); }", PW + ["live"]),
    ("list reorder swaps nothing", JS, "var t = merged[i]; merged[i] = merged[j]; merged[j] = t;", "", PW + ["list"]),
    ("invalid hex message removed", JS, "say('Colors are six hex digits like #3cc4d1.', true);", "say('', true);", PW + ["color"]),
    ("gear stays visible while open", JS, "panel.hidden = false; gear.hidden = true;", "panel.hidden = false;", PW + ["open"]),
    ("390 sheet: the old clipping CSS is restored (nowrap tabs, footer scrolls away)", CSS,
     ".cp-panel.cp-sheet .cp-main { overflow: hidden; }" + chr(10) + ".cp-panel.cp-sheet .cp-main > * { flex: none; }" + chr(10) + ".cp-panel.cp-sheet .cp-tabs { flex-wrap: wrap; max-height: 38%; overflow-y: auto; overscroll-behavior: contain; }" + chr(10) + ".cp-panel.cp-sheet .cp-body { flex: 1 1 auto; min-height: 60px; overflow-y: auto; }" + chr(10) + ".cp-panel.cp-sheet .cp-foot { max-height: 40%; overflow-y: auto; }" + chr(10),
     ".cp-panel.cp-sheet .cp-main { overflow-y: auto; }" + chr(10) + ".cp-panel.cp-sheet .cp-main > * { flex: none; }" + chr(10) + ".cp-panel.cp-sheet .cp-body { flex: none; overflow: visible; }" + chr(10) + ".cp-panel.cp-sheet .cp-tabs { flex-wrap: nowrap; overflow-x: auto; }" + chr(10), PW + ["sheet390"]),
    ("390 sheet: tab touch targets shrink back to 30px", CSS, ".cp-panel.cp-sheet .cp-tab, .cp-panel.cp-sheet .cp-btn, .cp-panel.cp-sheet .cp-ib, .cp-panel.cp-sheet .cp-chip { min-height: 44px; }", ".cp-panel.cp-sheet .cp-tab, .cp-panel.cp-sheet .cp-btn, .cp-panel.cp-sheet .cp-ib, .cp-panel.cp-sheet .cp-chip { min-height: 30px; }", PW + ["sheet390"]),
    ("UNIT: number clamp removed", JS, "n = Math.min(row.max, Math.max(row.min, n));", "n = n;", NODE),
    ("UNIT: paste ignores the extension prefix", JS, "if (!byKey[k] && prefix && k.indexOf(prefix) === 0) k = k.slice(prefix.length);", "", NODE),
    ("UNIT: accent loses its contrast guarantee", JS, "var accent = ensureContrast(accentHint || '#0a54a0', [bg, surface], 7.2);", "var accent = accentHint || '#0a54a0';", NODE),
    ("UNIT: store saves on every change", JS, "saveTimer = setTimeout(flush, wait); }", "flush(); }", NODE),
    ("UNIT: mergeList keeps duplicate saved keys", JS, "if (!it || used[s.key]) return;", "if (!it) return;", NODE),
    ("UNIT: dynamic select refuses values from the data", JS, "if (row.dynamic && typeof v === 'string') return v.slice(0, 300);", "", NODE),
    ("UNIT: thousands separator dropped", JS, "if (sep) parts[0] =", "if (false) parts[0] =", NODE),
]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def run(cmd):
    r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900, env=dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1"))
    out = r.stdout + r.stderr
    return r.returncode, out


def main():
    orig = {f: (ROOT / f).read_bytes() for f in (JS, CSS)}
    base = {f: sha(b) for f, b in orig.items()}
    rows, bad = [], []
    try:
        for name, f, old, new, cmd in S:
            text = orig[f].decode("utf-8")
            eol = chr(13) + chr(10) if chr(13) + chr(10) in text else chr(10)
            old, new = old.replace(chr(10), eol), new.replace(chr(10), eol)
            n = text.count(old)
            if n != 1:
                bad.append("%s: target text occurs %d times (needs exactly 1)" % (name, n))
                continue
            (ROOT / f).write_bytes(text.replace(old, new).encode("utf-8"))
            try:
                code, out = run(cmd)
            finally:
                (ROOT / f).write_bytes(orig[f])
            restored = sha((ROOT / f).read_bytes()) == base[f]
            red = code == 1 and "RED" in out
            line = [l for l in out.splitlines() if l.strip().startswith("- ")][:1]
            why = (line[0].strip() if line else out.strip().splitlines()[-1])[:110]
            rows.append((name, red, restored, why.encode("ascii", "replace").decode("ascii")))
            print("%-5s restored=%-5s %s" % ("RED" if red else "NOT RED", restored, name))
            if not red:
                bad.append("%s did not go RED (exit %s)" % (name, code))
            if not restored:
                bad.append("%s: file not restored byte-exact" % name)
    finally:
        for f, b in orig.items():
            (ROOT / f).write_bytes(b)
    print()
    for name, red, restored, why in rows:
        print("  RED=%s  %-52s  caught by: %s" % (red, name, why))
    print()
    c1, o1 = run(NODE)
    c2, o2 = run([sys.executable, "test/panel_test.py"])
    print("final unit gate:  ", o1.strip().splitlines()[-1])
    print("final panel gate: ", o2.strip().splitlines()[-1])
    for f in orig:
        ok = sha((ROOT / f).read_bytes()) == base[f]
        print("sha256 %s %s %s" % (f, base[f][:16], "restored byte-exact" if ok else "MISMATCH"))
        if not ok:
            bad.append(f + " mismatch at the end")
    if c1 or c2:
        bad.append("final gates not green")
    if bad:
        print("SABOTAGE RED: " + "; ".join(bad))
        sys.exit(1)
    print("SABOTAGE OK: %d sabotages all went RED, files restored byte-exact, both gates GREEN" % len(S))


main()
