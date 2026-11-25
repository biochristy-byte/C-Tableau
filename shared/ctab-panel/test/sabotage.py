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
    ("position and minimized state not saved", JS, "if (opts.state && opts.state.set) opts.state.set({ theme: ps.theme", "if (false && opts.state && opts.state.set) opts.state.set({ theme: ps.theme", PW + ["persist"]),
    ("focus is not returned to the gear", JS, "      gear.focus();\n      if (opts.onToggle) opts.onToggle(false);", "      if (opts.onToggle) opts.onToggle(false);", PW + ["close"]),
    ("Escape no longer closes from inside the panel", JS, "if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }", "if (e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); close(); return; }", PW + ["escape"]),
    ("search matches ANY word instead of every word", JS, "return words.every(function (w) { return h.indexOf(w) >= 0; });", "return words.some(function (w) { return h.indexOf(w) >= 0; });", PW + ["search"]),
    ("when conditions ignored (every row always shown)", JS, "    if (!w) return true;\n    if (typeof w === 'function')", "    return true;\n    if (typeof w === 'function')", PW + ["conditional"]),
    ("Cancel on the reset confirm resets anyway", JS, "if (a === 'confirmno') { mode = 'idle'; confirm = null;", "if (a === 'confirmno') { bulk(defaultsFor(keysOfTab(confirm.tabId)), 'x'); mode = 'idle'; confirm = null;", PW + ["reset"]),
    ("Undo does nothing", JS, "      store.setMany(u.prev);\n      say('Undid '", "      say('Undid '", PW + ["undo"]),
    ("bad-JSON paste message removed", JS, "message: 'That is not valid JSON. Paste the text exactly as Copy settings made it.'", "message: ''", PW + ["copypaste"]),
    ("chips are skipped by Tab (unreachable by keyboard)", JS, "class=\"cp-chip\" data-a=\"chip\"", "class=\"cp-chip\" tabindex=\"-1\" data-a=\"chip\"", PW + ["keyboard"]),
    ("help text drops to 12px", CSS, ".cp-help { grid-column: 1 / 3; color: var(--cp-muted); font-size: 1em; }", ".cp-help { grid-column: 1 / 3; color: var(--cp-muted); font-size: .86em; }", PW + ["floor"]),
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
    # ---- 1.1.0: one sabotage per new feature; where 1.0.0 had a shape, the sabotage restores that shape
    ("diagnostics: unhandled rejections no longer recorded", JS, "win.addEventListener('unhandledrejection',", "win.addEventListener('x-unhandledrejection',", PW + ["diag"]),
    ("diagnostics: the report drops the settings", JS, "save: store.saveState ? store.saveState() : 'unknown', settings: JSON.parse(JSON.stringify(s)),", "save: store.saveState ? store.saveState() : 'unknown', settings: {},", PW + ["diag"]),
    ("diagnostics: sample rows not capped at 4", JS, "data.sample = (inf.data.sample || []).slice(0, 4)", "data.sample = (inf.data.sample || []).slice(0, 40)", PW + ["diag"]),
    ("panel habits written to the workbook again (1.0.0 shape)", JS, "set: function (obj) { lsSet(machineKey, JSON.stringify(obj)); }", "set: function (obj) { lsSet(machineKey, JSON.stringify(obj)); if (st) { try { st.set(panelKey, JSON.stringify(obj)); } catch (e) { log(e); } later(); } }", PW + ["persist"]),
    ("HYDRATE dropped: a 1.0.0 saved theme and spot are ignored", JS, "if (legacy) {", "if (false && legacy) {", PW + ["machine"]),
    ("blocked localStorage is not caught", JS, "try { var v = G.localStorage.getItem(k); if (v !== null && v !== undefined) return v; } catch (e) { /* blocked */ }", "var v = G.localStorage.getItem(k); if (v !== null && v !== undefined) return v;", PW + ["machine"]),
    ("pinned: the chart no longer reflows", JS, "          el.style[prop] = px + 'px';\n", "", PW + ["pin"]),
    ("accordion: opening one section closes the others", JS, "if (at >= 0) ps.open.splice(at, 1); else ps.open.push(tid);", "if (at >= 0) ps.open.splice(at, 1); else ps.open = [tid];", PW + ["pin"]),
    ("pin allowed on a view under 760 wide", JS, "var PIN_W = 360, PIN_MIN_W = 760,", "var PIN_W = 360, PIN_MIN_W = 600,", PW + ["pin"]),
    ("Dock button gone from the header (1.0.0 shape)", JS, "'<button type=\"button\" class=\"cp-ib cp-hd\" data-a=\"dock\" data-f=\"dock\"", "'<button type=\"button\" class=\"cp-ib cp-hd\" data-a=\"nodock\" data-f=\"nodock\"", PW + ["dock"]),
    ("double-click on the title bar does nothing", JS, "head.addEventListener('dblclick', function (e) {", "head.addEventListener('x-dblclick', function (e) {", PW + ["dock"]),
    ("Revert does nothing", JS, "var nR = Object.keys(back).length ? bulk(back, 'the revert') : 0;", "var nR = 0;", PW + ["revert"]),
    ("Revert snapshot retaken on every open", JS, "if (!openSnap) openSnap = JSON.parse", "openSnap = JSON.parse", PW + ["revert"]),
    ("a rejected save is reported as saved (1.0.0 silence)", JS, "function (e) { log('saveAsync rejected', e); saved('failed', e); }", "function (e) { log('saveAsync rejected', e); saved('saved', e); }", PW + ["savestatus"]),
    ("Copy formatting keeps field picks (1.0.0 shape)", JS, "settable(rows).forEach(function (r) { if (kind === 'formatting' && isData(r)) return; o[r.key] = s[r.key]; });", "settable(rows).forEach(function (r) { o[r.key] = s[r.key]; });", PW + ["copyfmt"]),
    ("a paste from another chart applies its own keys too", JS, "if (cross && (!row || !row.std || isData(row))) { other.push(k0); return; }", "", PW + ["copyfmt"]),
    ("the last copy is not kept on this machine", JS, "lsSet(LASTCOPY, lastCopied);", "", PW + ["copyfmt"]),
    ("grayed rows are hidden again (1.0.0 shape)", JS, "function shownRows(rows, s, info) { return rows.filter(function (r) { return !r.hideWhenOff || isVisible(r, s, info); }); }", "function shownRows(rows, s, info) { return rows.filter(function (r) { return isVisible(r, s, info); }); }", PW + ["conditional"]),
    ("grayed rows faded with opacity .45 (her guide's method)", CSS, ".cp-row.cp-off { border: 1px dashed var(--cp-border); border-radius: 8px; padding: 4px 6px; background: var(--cp-surface); }", ".cp-row.cp-off { border: 1px dashed var(--cp-border); border-radius: 8px; padding: 4px 6px; background: var(--cp-surface); opacity: .45; }", PW + ["contrast"]),
    ("disabled controls faded to half opacity", CSS, "border-style: dashed; opacity: 1; cursor: not-allowed; }", "border-style: dashed; opacity: .5; cursor: not-allowed; }", PW + ["contrast"]),
    ("bundled Poppins 700 path broken", CSS, 'src: url("fonts/poppins-700.woff2")', 'src: url("fonts/missing-700.woff2")', PW + ["fonts"]),
    ("Text size no longer scales chart text", JS, "var scaled = isFinite(scale) && scale > 1 && scale <= 3;", "var scaled = false;", PW + ["textsize"]),
    ("Panel text size ignored (fixed 14px)", CSS, "font-size: var(--cp-fs, 14px);", "font-size: 14px;", PW + ["textsize"]),
    ("title placeholders not filled", JS, "var titled = !!tokensFn &&", "var titled = false &&", PW + ["titles"]),
    ("thousands chips named instead of shown (1.0.0 labels)", JS, "opts: CH([['comma', '1,234,567'], ['space', '1 234 567'], ['none', '1234567']])", "opts: CH([['comma', 'Comma'], ['space', 'Space'], ['none', 'None']])", PW + ["options"]),
    ("the number preview goes stale after a typed change", JS, "      refreshPreviews();\n      return true;", "      return true;", PW + ["options"]),
    ("no dark palette variant (1.0.0 colors on dark)", JS, "c = isDarkBg(b) ? darkVariant(c, b) : c.slice();", "c = c.slice();", PW + ["darkpal"]),
    ("a one-click setup bypasses Undo", JS, "var nA = bulk(vals, '\"' + row.label + '\"');", "var nA = store.setMany(vals).length;", PW + ["action"]),
    ("dragging blocks the main thread (choppy)", JS, "      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 2)", "      var t9 = Date.now(); while (Date.now() - t9 < 60) { /* jank */ }\n      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 2)", PW + ["frames"]),
    ("UNIT: HYDRATE dropped", JS, "if (legacy) {", "if (false && legacy) {", NODE),
    ("UNIT: cross-chart paste applies field picks", JS, "if (cross && (!row || !row.std || isData(row))) { other.push(k0); return; }", "", NODE),
    ("UNIT: dark palettes miss 3:1", JS, "function darkVariant(colors, bg) { return colors.map(function (c) { return ensureContrast(c, [bg], 3); }); }", "function darkVariant(colors, bg) { return colors.map(function (c) { return ensureContrast(c, [bg], 1.5); }); }", NODE),
]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def run(cmd):
    r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900, env=dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1"))
    out = r.stdout + r.stderr
    return r.returncode, out


def main():
    only = os.environ.get("SAB_ONLY", "")
    if only:
        S[:] = [x for x in S if any(w in x[0] for w in only.split("|"))]
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
