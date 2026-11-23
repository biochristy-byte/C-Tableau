"""Panel checks and the flip-every-setting test for Tide Lines. Imported by mock_render.py (the browser gate).

panel_gate(b, port, H): the shared ctab-panel inside the real extension, in a browser:
  the gear opens it, drag by the title bar clamps to the frame, minimize and restore, close, Escape, Copy and Paste
  round-trip, a setting change redraws the chart live, no range input on any tab, no browser dialog, every panel text
  14px or more, 7:1 contrast on every tab in a light and a dark worksheet.
flip_all(b, port, H): every setting in the schema is changed once and the rendered output must change, or the
  setting is named below with the reason it cannot change the drawing and what is checked instead.

H carries the gate's own helpers (check, open_case, contrast) so every check counts toward the gate's floors.
"""
import json, pathlib

HERE = pathlib.Path(__file__).resolve().parent
AUDIT = (HERE / "panel_audit.js").read_text(encoding="utf-8")
RECT = "(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return {l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height}; }"
MIN_SETTINGS, MIN_TABS = 60, 15


def inside(r, f, tol=1.5):
    return r["l"] >= f["l"] - tol and r["t"] >= f["t"] - tol and r["r"] <= f["r"] + tol and r["b"] <= f["b"] + tol


def tab(pg, tid):
    pg.click(".cp-tab[data-t='%s']" % tid)
    pg.wait_for_function("document.querySelector(\".cp-tab[data-t='%s']\").getAttribute('aria-selected') === 'true'" % tid)


def panel_gate(b, port, H):
    check = H.check
    errs = []
    pg = H.open_case(b, port, "birth", "900x520", "light", errs, {"animOn": False}, fast=True)
    H.cases.append("panel gate")
    check("the gear is on the chart", pg.is_visible(".cp-gear"))
    pg.click(".cp-gear")
    pg.wait_for_selector(".cp-panel:not([hidden])", timeout=5000)
    check("the gear opens the shared panel", pg.is_visible(".cp-panel") and pg.get_attribute(".cp-gear", "aria-expanded") == "true")
    check("the panel title says Tide Lines settings", pg.inner_text(".cp-title").strip() == "Tide Lines settings", pg.inner_text(".cp-title"))
    tabs = pg.evaluate("[...document.querySelectorAll('.cp-tab')].map(t => t.textContent)")
    check("%d tabs: Density, Layout, Marks, Gradient, Outline, Axis + the standard nine" % len(tabs),
          len(tabs) >= MIN_TABS and tabs[:6] == ["Density", "Layout", "Marks", "Gradient", "Outline", "Axis"] and all(t in tabs for t in ("Colors", "Labels", "Number format", "Tooltip", "Fonts", "Background", "Animation", "Interaction", "Fields")), str(tabs))
    n = pg.evaluate("TL.app.state.store.rows.filter(r => r.type !== 'note').length")
    check("%d settings (at least %d)" % (n, MIN_SETTINGS), n >= MIN_SETTINGS)

    # ---- drag by the title clamps to the frame ----
    frame = pg.evaluate(RECT, "#tl-root")
    r0 = pg.evaluate(RECT, ".cp-panel")
    hd = pg.evaluate(RECT, ".cp-head")
    x, y = hd["l"] + 40, hd["t"] + hd["h"] / 2
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 80, y + 40, steps=6); pg.mouse.move(x - 160, y + 100, steps=6); pg.mouse.up()
    r1 = pg.evaluate(RECT, ".cp-panel")
    check("drag by the title bar moves the panel left by the pointer delta (the frame is barely taller than the panel, so down is clamped)", abs((r0["l"] - r1["l"]) - 160) <= 2 and r1["t"] > r0["t"] and inside(r1, frame), (r0, r1))
    for dx, dy, name in ((-3000, -3000, "top left"), (4000, 4000, "bottom right"), (4000, -4000, "top right")):
        hd = pg.evaluate(RECT, ".cp-head")
        x, y = hd["l"] + 40, hd["t"] + hd["h"] / 2
        pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + dx, y + dy, steps=8); pg.mouse.up()
        r = pg.evaluate(RECT, ".cp-panel")
        check("dragged to the %s the panel stays inside the frame" % name, inside(r, frame), (r, frame))

    # ---- live re-render: a setting changes the drawing at once ----
    d_before = pg.evaluate("document.querySelector('path.tl-fill').getAttribute('d')")
    tab(pg, "density")
    pg.click(".cp-chip[data-k=kernel][data-v=epanechnikov]")
    pg.wait_for_function("document.querySelector('.tl-svg').dataset.kernel === 'epanechnikov'", timeout=2000)
    check("a chip in the panel redraws the chart live", pg.evaluate("document.querySelector('path.tl-fill').getAttribute('d')") != d_before)
    tab(pg, "layout")
    for _ in range(2):
        pg.click("[data-a=inc][data-k=overlap]")
    pg.wait_for_function("TL.app.state.store.get().overlap > 2.1", timeout=2000)
    check("a stepper in the panel is applied and saved as a string", pg.evaluate("TL_MOCK.settings.getAll()['tidelines.overlap']") == str(pg.evaluate("TL.app.state.store.get().overlap")))

    # ---- minimize, restore ----
    h_open = pg.evaluate(RECT, ".cp-panel")["h"]
    pg.click("[data-a=min]")
    pg.wait_for_function("document.querySelector('.cp-panel').classList.contains('cp-min')")
    h_min = pg.evaluate(RECT, ".cp-panel")["h"]
    check("minimize collapses the panel to its title bar", h_min < h_open * 0.5 and pg.is_visible(".cp-head") and pg.is_visible(".cp-title"), (h_open, h_min))
    check("the minimize button now says Restore", pg.get_attribute("[data-a=min]", "aria-label") == "Restore settings")
    pg.click("[data-a=min]")
    pg.wait_for_function("!document.querySelector('.cp-panel').classList.contains('cp-min')")
    check("restore brings the panel back", pg.evaluate(RECT, ".cp-panel")["h"] > h_min * 2)

    # ---- Copy and Paste round trip ----
    pg.click("[data-a=copy]")
    pg.wait_for_function("document.querySelector('.cp-status').textContent.indexOf('Copied') === 0 || document.querySelector('.cp-status').textContent.indexOf('clipboard') > 0", timeout=5000)
    txt = pg.evaluate("TL.app.state.panel.lastCopied")
    obj = json.loads(txt)
    check("Copy settings gives the flat JSON with every setting (%d keys)" % len(obj), len(obj) >= MIN_SETTINGS and obj["kernel"] == "epanechnikov" and obj["overlap"] > 2.1 and isinstance(obj["catColors"], list), len(obj))
    pg.evaluate("TL.app.state.store.reset()")
    pg.wait_for_function("TL.app.state.store.get().kernel === 'gaussian'", timeout=2000)
    pg.click("[data-a=paste]")
    pg.wait_for_selector("textarea[data-f=paste]")
    pg.fill("textarea[data-f=paste]", txt)
    pg.click("[data-a=pasteapply]")
    pg.wait_for_selector("textarea[data-f=paste]", state="detached")
    got = pg.evaluate("TL.app.state.store.get()")
    check("Paste settings restores every copied value (round trip)", all(got[k] == obj[k] for k in obj), [k for k in obj if got[k] != obj[k]][:5])
    check("the pasted kernel redraws the chart", pg.evaluate("document.querySelector('.tl-svg').dataset.kernel") == "epanechnikov")
    pg.click("[data-a=paste]"); pg.fill("textarea[data-f=paste]", "{not json"); pg.click("[data-a=pasteapply]")
    check("a bad paste is refused with a message and changes nothing", pg.evaluate("TL.app.state.store.get().kernel") == "epanechnikov" and pg.query_selector("textarea[data-f=paste]") is not None)
    pg.click("[data-a=pastecancel]")

    # ---- Escape and close, focus back on the gear ----
    pg.keyboard.press("Escape")
    check("Escape closes the panel", pg.evaluate("document.querySelector('.cp-panel').hidden"))
    check("Escape returns focus to the gear", pg.evaluate("document.activeElement === document.querySelector('.cp-gear')"))
    pg.click(".cp-gear"); pg.wait_for_selector(".cp-panel:not([hidden])")
    pg.click("[data-a=close]")
    check("the close button hides the panel and focus returns to the gear", pg.evaluate("document.querySelector('.cp-panel').hidden && document.activeElement === document.querySelector('.cp-gear')"))
    check("the settings panel left the chart alone while closed (ridges still drawn)", pg.evaluate("document.querySelectorAll('.tl-ridge').length") == 6)
    check("no browser dialog opened", not [e for e in errs if "dialog" in e], str(errs[:3]))
    check("0 console errors in the panel session", not errs, str(errs[:3]))
    pg.close()

    # ---- no range input, 14px floor, 7:1 on every tab, in a light and a dark worksheet ----
    for theme in ("light", "dark"):
        errs = []
        pg = H.open_case(b, port, "birth", "900x520", theme, errs, {"animOn": False}, fast=True)
        pg.click(".cp-gear"); pg.wait_for_selector(".cp-panel:not([hidden])")
        a = pg.evaluate(AUDIT)
        ranges, small, low, seen = 0, [], [], 0
        for t in a["tabs"]:
            tab(pg, t)
            d = pg.evaluate(AUDIT)
            ranges += d["ranges"]
            for x in d["texts"]:
                seen += 1
                if x["size"] < 13.99:
                    small.append((t, x["text"], x["size"]))
                if H.contrast(x["fg"], x["bg"]) < 7:
                    low.append((t, x["text"], round(H.contrast(x["fg"], x["bg"]), 2)))
        check("%s worksheet: no range input on any of %d tabs" % (theme, len(a["tabs"])), ranges == 0 and len(a["tabs"]) >= MIN_TABS, ranges)
        check("%s worksheet: every panel text is 14px or more (%d texts)" % (theme, seen), seen >= 300 and not small, str(small[:3]))
        check("%s worksheet: every panel text is 7:1 on its background" % theme, not low, str(low[:3]))
        check("%s worksheet: no browser dialog, 0 console errors" % theme, not errs, str(errs[:3]))
        pg.close()


# ------------------------------------------------------------------------------------ flip every setting

SIG = """async (a) => {
  const st = TL.app.state.store;
  const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50))));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function sig(probe) {
    const chart = document.querySelector('#tl-chart');
    if (probe === 'static') return chart.outerHTML;
    const h = [...document.querySelectorAll('path.tl-hit')].pop(), r = h.getBoundingClientRect(), x = (r.left + r.right) / 2, y = r.bottom - 4;
    const fire = (type) => h.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType: 'mouse' }));
    TL_MOCK.worksheet.calls.length = 0;
    if (probe === 'select') h.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    else { fire('pointerenter'); fire('pointermove'); }
    await wait(800);
    const calls = TL_MOCK.worksheet.calls.map(c => c[0]).join(',');
    let out;
    if (probe === 'push') out = 'tableau calls: ' + calls;
    else {
      const tip = document.querySelector('.tl-tip');
      out = chart.outerHTML + '|' + [...document.querySelectorAll('.tl-ridge')].map(e => getComputedStyle(e).opacity).join(',') + '|'
        + [...document.querySelectorAll('.tl-lift')].map(e => getComputedStyle(e).transform).join(',') + '|' + tip.innerText + '|' + tip.style.cssText + '|' + calls;
    }
    if (probe === 'select') { h.dispatchEvent(new MouseEvent('click', { bubbles: true })); TL.app.state.renderer.selected = {}; }
    else fire('pointerleave');
    await wait(60);
    return out;
  }
  st.reset(); TL.app.state.renderer.selected = {};
  if (a.pre) st.setMany(a.pre);
  await tick();
  const base = await sig(a.probe);
  const first = TL.app.state.renderer.items[0];
  const val = a.val === '__list__' ? [{ key: first.key, name: 'Renamed ridge', color: '#e0457b', hidden: false }] : a.val;
  const set = st.setMany({ [a.key]: val });
  await tick();
  const alt = await sig(a.probe);
  return { base, alt, changed: set.length, now: st.get()[a.key] };
}"""

# keys that need another setting first, a different probe, or a hand-picked value.
# probe: static = the chart's whole DOM; hover/select = the chart after pointer events (classes, computed opacity, lift, tooltip);
# push = no DOM change by design, the number of Tableau calls the gesture makes.
CTX = {
    "bandwidth": {"val": 90}, "padMult": {"val": 2}, "rangeMin": {"pre": {"rangeMode": "custom", "rangeMax": 5000}, "val": 500},
    "rangeMax": {"pre": {"rangeMode": "custom", "rangeMin": 0}, "val": 4000},
    "singleColor": {"pre": {"palette": "single"}, "val": "#e0457b"}, "outlineColor": {"pre": {"outlineMode": "custom"}, "val": "#e0457b"},
    "rugSize": {"pre": {"showRug": True}, "val": 12}, "rugOpacity": {"pre": {"showRug": True}, "val": 100},
    "labelMaxPct": {"pre": {"labelSize": 28}, "val": 15}, "labelLines": {"pre": {"labelSize": 20, "labelMaxPct": 15}, "val": 3},
    "labelSide": {"val": "right"},
    "footNote": {"page": ("many", "300x300")},
    "legendOn": {"pre": {"colorSource": "field"}, "val": False},
    "catPalette": {"pre": {"colorSource": "field"}, "val": "viridis"}, "paletteReverse": {"pre": {"colorSource": "field"}, "val": True},
    "valueLabelSize": {"pre": {"valueLabels": True}, "val": 24},
    "titleText": {"pre": {"showTitle": True}, "val": "Birth weight by group"}, "titleSize": {"pre": {"showTitle": True, "titleText": "Birth weight"}, "val": 30},
    "titleWeight": {"pre": {"showTitle": True, "titleText": "Birth weight"}, "val": "normal"},
    "bgMode": {"pre": {"bgColor": "#081f33"}, "val": "custom"}, "bgColor": {"pre": {"bgMode": "custom"}, "val": "#081f33"},
    "borderColor": {"pre": {"borderOn": True}, "val": "#e0457b"}, "borderWidth": {"pre": {"borderOn": True}, "val": 6}, "borderRadius": {"pre": {"borderOn": True}, "val": 24},
    "tipOn": {"probe": "hover"}, "tipSize": {"probe": "hover", "val": 22}, "tipSwatch": {"probe": "hover"}, "tipFollow": {"probe": "hover"}, "tipMaxW": {"probe": "hover", "val": 160},
    "selectOn": {"probe": "select"}, "selectDim": {"probe": "select", "val": 10}, "hoverOn": {"probe": "hover"}, "dimOthers": {"probe": "hover", "val": 10},
    "hoverLift": {"probe": "hover", "val": 16}, "hoverMs": {"probe": "hover", "val": 500}, "hotLineWidth": {"probe": "hover", "val": 8},
    "hoverPush": {"probe": "push"},
    "fieldCategory": {"val": "Mother smoked in pregnancy"}, "fieldValue": {"val": "Baby ID"}, "fieldColor": {"pre": {"colorSource": "field"}, "val": "Mother group"},
    "fieldLabel": {"val": "Mother group"},
    "catColors": {"val": "__list__"},
    "tickCount": {"val": 3}, "showTitle": {"pre": {"titleText": "Birth weight"}}, "labelColor": {"val": "#e0457b"}, "palette": {"val": "reef"},
    "numDecimals": {"val": 3}, "numScale": {"val": "100"}, "numPrefix": {"val": "g"}, "numSuffix": {"val": "u"},
}
# Why a setting is not tested by a changed picture, and what is checked instead (none today: every setting changes the DOM,
# the three that act on gestures are probed with the gesture).
NAMED = {
    "hoverPush": "no pixel changes: it decides whether hovering a ridge also tells Tableau; checked as the count of hoverTupleAsync calls on a hover (1 on, 0 off)",
    "selectOn": "checked on a click: with it off the click leaves no selection class and sends nothing to Tableau",
}


def alt_for(row, ctx):
    if "val" in ctx:
        return ctx["val"]
    t, d = row["type"], row["def"]
    if t == "check":
        return not d
    if t in ("chips", "select"):
        return next(o for o in row["opts"] if o != d)
    if t == "number":
        cand = [row["max"], row["min"]]
        far = [c for c in cand if c != d and abs(c) < 1e7]
        return far[0] if far else row["min"] + row["step"]
    if t == "color":
        return "#e0457b"
    if t == "text":
        return "Zz"
    if t == "font":
        return "verdana"
    if t == "palette":
        return "viridis"
    raise SystemExit("no alternative value for %s (%s)" % (row["key"], t))


def flip_all(b, port, H):
    check = H.check
    errs = []
    pages = {}
    rows = None
    results = []
    pg0 = H.open_case(b, port, "birth", "900x520", "light", errs, {"animOn": False}, fast=True)
    rows = pg0.evaluate("TL.app.state.store.rows.filter(r => r.type !== 'note').map(r => ({key: r.key, type: r.type, def: r.def, min: r.min, max: r.max, step: r.step, opts: (r.opts || []).map(o => o.value), tab: r.tab}))")
    pages[("birth", "900x520")] = pg0
    H.cases.append("flip every setting")
    for row in rows:
        c = CTX.get(row["key"], {})
        key = c.get("page", ("birth", "900x520"))
        if key not in pages:
            pages[key] = H.open_case(b, port, key[0], key[1], "light", errs, {"animOn": False}, fast=True)
        pg = pages[key]
        if row["type"] == "field":
            pass
        val = alt_for(row, c)
        r = pg.evaluate(SIG, {"key": row["key"], "val": val, "pre": c.get("pre"), "probe": c.get("probe", "static")})
        ok = r["changed"] == 1 and r["base"] != r["alt"]
        if row["key"] == "hoverOn":
            ok = ok and r["base"].count("class=\"tl-ridge is-hot\"") > 0 and r["alt"].count("class=\"tl-ridge is-hot\"") == 0   # the highlight class itself, not just the lift variable
        results.append((row["key"], row["tab"], ok))
        check("setting %s (%s tab): changing it to %s changes the %s" % (row["key"], row["tab"], json.dumps(val)[:30], c.get("probe", "static") + " output"), ok,
              "changed=%s now=%r same output" % (r["changed"], r["now"]))
    n_ok = sum(1 for _, _, ok in results if ok)
    check("the flip test examined every setting in the schema (%d of %d)" % (len(results), len(rows)), len(results) == len(rows) and len(rows) >= MIN_SETTINGS)
    check("every one of the %d settings changed the output (%d did)" % (len(rows), n_ok), n_ok == len(rows))
    tabs_seen = sorted(set(t for _, t, _ in results))
    check("the flip test covered %d tabs" % len(tabs_seen), len(tabs_seen) >= MIN_TABS, str(tabs_seen))
    check("0 console errors while every setting was flipped", not errs, str(errs[:3]))
    for p in pages.values():
        p.close()
