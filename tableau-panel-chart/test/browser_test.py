"""Panel Chart browser gate: the shipping extension code in Chromium, driven through the mock Tableau API.

  python test/browser_test.py [--only render,panel,sheet390,interact,flip,frames,emdash]

Groups:
  render    every chart type in a light and a dark worksheet, plus stress cases (40 bars, long names, 100% stacks,
            horizontal bars, legends on every side, a 300px frame): marks drawn with real size, every chart text 14px
            or more, 7:1 against the color it sits on (computed), no two texts overlap (painted boxes), all inside
            the frame, 0 console errors, no browser dialog, no network request off this machine
  panel     the shared ctab-panel inside the chart: gear, title, tabs, drag clamps, live redraw from a chip and a
            stepper, minimize, copy and paste round trip, Escape; 14px floor, 7:1 and no range input on every tab
            in a light and a dark worksheet
  sheet390  390px wide frames: the panel is a full-frame sheet, every tab reachable and 44px tall, the footer
            inside, nothing scrolls sideways (the shared panel's sheet390 rules)
  interact  hover dims the others and shows a 14px, 7:1 tooltip; click selects in Tableau by category or by mark;
            Send hover to Tableau; the line guide and its multi-series tooltip
  flip      every setting is changed once and the drawing (or the hover, click or transition it controls) must change
  frames    a chart-type morph, a sort and a stack change are timed frame by frame: median <= 18.5 ms,
            p95 <= 40 ms, no frame over 50 ms, more than 30 frames
  emdash    no em dash in any source file or in any text the page renders

Each group prints how many subjects it examined and goes RED below its floor. Last line: GREEN or RED.
"""
import functools, http.server, json, pathlib, socketserver, statistics, sys, threading

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
AUDIT = (HERE / "panel_audit.js").read_text(encoding="utf-8")
EM = chr(0x2014)
RECT = "(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return {l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height}; }"
GROUPS = ["render", "panel", "sheet390", "interact", "flip", "frames", "emdash"]
only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else GROUPS
fails, passes, seen_text = [], [0], []


def check(name, ok, detail=None):
    if ok:
        passes[0] += 1
    else:
        fails.append(name)
        print("RED  %s%s" % (name, ("  " + str(detail)[:300]) if detail is not None else ""))
    return ok


def hexrgb(h):
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def parse_rgb(s):
    if s.startswith("#"):
        return hexrgb(s)
    return [float(x) for x in s[s.index("(") + 1:s.index(")")].split(",")[:3]]


def lum(c):
    def ch(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(x) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def ser(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (list, dict)):
        return json.dumps(v)
    return str(v)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass


srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
PORT = srv.server_address[1]
ORIGIN = "http://127.0.0.1:%d" % PORT

SETTLE = """async () => {
  const R = PC.app.state.renderer;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t0 = performance.now();
  while (R.animating && performance.now() - t0 < 6000) await new Promise(r => setTimeout(r, 20));
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
  return !R.animating;
}"""


def open_case(b, fixture="sales", size=(900, 520), theme="light", settings=None, errs=None, bare=False):
    w, h = size
    vp = {"width": w, "height": h} if bare else {"width": w + 60, "height": h + 260}
    pg = b.new_page(viewport=vp, device_scale_factor=1)
    errs = errs if errs is not None else []
    pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: %s" % e))
    pg.on("dialog", lambda d: (errs.append("dialog: " + d.message), d.dismiss()))
    pg.on("request", lambda r: errs.append("network off this machine: " + r.url) if not r.url.startswith(ORIGIN) and not r.url.startswith("data:") else None)
    st = {"panelchart.animOn": "false"}
    for k, v in (settings or {}).items():
        st["panelchart." + k] = ser(v)
    pg.add_init_script("localStorage.setItem('pc-mock-settings', %s)" % json.dumps(json.dumps(st)))
    pg.goto("%s/dev/dev.html?fixture=%s&size=%dx%d&theme=%s%s" % (ORIGIN, fixture, w, h, theme, "&bare=1" if bare else ""))
    pg.wait_for_function("window.PC_READY && window.PC && PC.app && PC.app.state.raw && document.querySelector('.pc-svg')", timeout=15000)
    pg.evaluate(SETTLE)
    pg.errs = errs
    return pg


CHART_AUDIT = """() => {
  const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const texts = [...document.querySelectorAll('#pc-chart text.pc-text')].filter(vis).map(t => {
    const r = t.getBoundingClientRect();
    return { text: [...t.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(''), kind: t.dataset.kind, size: parseFloat(getComputedStyle(t).fontSize), fill: t.getAttribute('fill'), bg: t.dataset.bg, l: r.left, t: r.top, r: r.right, b: r.bottom };
  });
  const st = document.querySelector('#stage').getBoundingClientRect();
  const marks = [...document.querySelectorAll('#pc-chart .pc-mark')].map(m => { const b = m.getBBox(); return { cls: m.getAttribute('class'), w: b.width, h: b.height, d: (m.getAttribute('d') || '').length, disp: getComputedStyle(m).display }; });
  const empty = document.querySelector('.pc-empty');
  return { texts, marks, stage: { l: st.left, t: st.top, r: st.right, b: st.bottom }, empty: empty && !empty.hidden ? empty.textContent : '', body: document.querySelector('#pc-chart').innerText };
}"""


def audit_chart(pg, tag, expect=None, min_texts=5):
    a = pg.evaluate(CHART_AUDIT)
    texts, s = a["texts"], a["stage"]
    seen_text.extend(t["text"] for t in texts)
    check("%s: chart drew (no empty message)" % tag, not a["empty"], a["empty"])
    check("%s: %d chart texts examined (floor %d)" % (tag, len(texts), min_texts), len(texts) >= min_texts)
    small = [(t["text"], t["size"]) for t in texts if t["size"] < 13.99]
    check("%s: every chart text is 14px or more" % tag, not small, small[:3])
    low = [(t["text"], t["fill"], t["bg"], round(contrast(hexrgb(t["fill"]), hexrgb(t["bg"])), 2)) for t in texts if contrast(hexrgb(t["fill"]), hexrgb(t["bg"])) < 7]
    check("%s: every chart text is 7:1 on its own background" % tag, not low, low[:3])
    out = [t["text"] for t in texts if t["l"] < s["l"] - 1 or t["r"] > s["r"] + 1 or t["t"] < s["t"] - 1 or t["b"] > s["b"] + 1]
    check("%s: every chart text is inside the frame" % tag, not out, out[:3])
    hits, pairs = [], 0
    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            p, q = texts[i], texts[j]
            pairs += 1
            if p["l"] < q["r"] - 0.5 and q["l"] < p["r"] - 0.5 and p["t"] < q["b"] - 0.5 and q["t"] < p["b"] - 0.5:
                hits.append((p["text"], q["text"]))
    check("%s: no two chart texts overlap (%d pairs)" % (tag, pairs), not hits, hits[:3])
    marks = [m for m in a["marks"] if m["disp"] != "none"]
    flat = [m["cls"] for m in marks if (("pc-bar" in m["cls"] or "pc-point" in m["cls"] or "pc-dot" in m["cls"]) and (m["w"] < 0.5 or m["h"] < 0.5)) or (("pc-line" in m["cls"] or "pc-area" in m["cls"]) and (m["w"] < 2 or m["d"] < 10))]
    check("%s: every mark has real size (%d marks)" % (tag, len(marks)), marks and not flat, flat[:3])
    if expect:
        for cls, n in expect.items():
            got = sum(1 for m in marks if ("pc-" + cls) in m["cls"].split())
            check("%s: %d %s marks (expected %d)" % (tag, got, cls, n), got == n)
    check("%s: 0 console errors, no dialog, no network off this machine" % tag, not pg.errs, pg.errs[:3])
    return len(texts), pairs, len(marks)


def waited(pg, js, timeout):
    """wait_for_function that returns False on timeout, so the check that follows names what failed."""
    try:
        pg.wait_for_function(js, timeout=timeout)
        return True
    except Exception:
        return False


def tab(pg, tid):
    pg.click(".cp-tab[data-t='%s']" % tid)
    pg.wait_for_function("document.querySelector(\".cp-tab[data-t='%s']\").getAttribute('aria-selected') === 'true'" % tid)


# ----------------------------------------------------------------------------------------------- render

def g_render(b):
    n_cases, n_text, n_pairs, n_marks = 0, 0, 0, 0
    BASE = {"bar": ("sales", {"bar": 21}), "line": ("monthly", {"line": 4, "dot": 35}), "area": ("monthly", {"area": 4}), "scatter": ("scatter", {"point": 245})}
    cases = []
    for typ, (fx, exp) in BASE.items():
        for theme in ("light", "dark"):
            cases.append(("%s %s" % (typ, theme), fx, (900, 520), theme, {"chartType": typ, "valueLabels": typ != "scatter", "showTitle": True}, exp))
    cases += [
        ("horizontal bars with value labels", "sales", (900, 520), "light", {"orientation": "horizontal", "stack": "group", "valueLabels": True}, {"bar": 21}),
        ("100% stacked bars, labels inside", "sales", (900, 520), "light", {"stack": "percent", "valueLabels": True}, {"bar": 21}),
        ("100% stacked bars, dark", "sales", (900, 520), "dark", {"stack": "percent", "valueLabels": True, "palette": "okabe"}, {"bar": 21}),
        ("side by side bars", "sales", (900, 520), "light", {"stack": "group", "valueLabels": True}, {"bar": 21}),
        ("40 bars with value labels (thinned)", "many", (900, 520), "light", {"valueLabels": True}, {"bar": 40}),
        ("40 bars across, 390 frame", "many", (390, 700), "light", {"orientation": "horizontal", "valueLabels": True}, {"bar": 40}),
        ("long names wrapped", "long", (900, 520), "light", {"valueLabels": True}, {"bar": 15}),
        ("long names across", "long", (900, 520), "dark", {"orientation": "horizontal", "valueLabels": True}, {"bar": 15}),
        ("losses below zero", "negative", (900, 520), "light", {"stack": "group", "valueLabels": True}, {"bar": 21}),
        ("legend on the right", "sales", (900, 520), "light", {"legendPos": "right", "legendSwatch": "circle"}, {"bar": 21}),
        ("legend at the bottom, title and subtitle", "monthly", (900, 520), "light", {"chartType": "line", "legendPos": "bottom", "showTitle": True, "titleAlign": "center", "subtitleText": "Every store, every month, by product"}, {"line": 4}),
        ("a low-contrast text color is lifted to 7:1", "sales", (900, 520), "light", {"labelColor": "#8fa7b8", "valueLabels": True, "stack": "group"}, {"bar": 21}),
        ("custom background", "sales", (900, 520), "light", {"bgMode": "custom", "bgColor": "#2b4a63", "valueLabels": True}, {"bar": 21}),
        ("scatter with trend lines", "scatter", (900, 520), "dark", {"chartType": "scatter", "trendLine": True, "pointShape": "diamond"}, {"point": 245, "trend": 3}),
        ("area stacked, average line", "monthly", (900, 520), "light", {"chartType": "area", "refLine": "avg", "valueLabels": True}, {"area": 4}),
        ("300px frame", "sales", (300, 300), "light", {"valueLabels": True}, {"bar": 21}),
        ("1600x1000", "sales", (1600, 1000), "dark", {"valueLabels": True, "labelSize": 18, "showTitle": True}, {"bar": 21}),
        ("big labels", "monthly", (900, 520), "light", {"chartType": "line", "labelSize": 22, "valueLabels": True, "valueLabelSize": 18}, {"line": 4}),
    ]
    for (tag, fx, size, theme, st, exp) in cases:
        pg = open_case(b, fx, size, theme, st)
        t, p, m = audit_chart(pg, tag, exp, min_texts=8 if size[0] > 300 else 4)
        n_cases += 1; n_text += t; n_pairs += p; n_marks += m
        pg.close()
    pg = open_case(b, "empty")
    check("no rows: says what to drop on the shelves", "Drop a dimension" in pg.inner_text(".pc-empty") and not pg.errs, pg.errs[:2])
    pg.close()
    check("render: %d cases (floor 24), %d texts (floor 700), %d text pairs (floor 14000), %d marks (floor 1100)" % (n_cases, n_text, n_pairs, n_marks),
          n_cases >= 24 and n_text >= 700 and n_pairs >= 14000 and n_marks >= 1100)


# ----------------------------------------------------------------------------------------------- panel

def g_panel(b):
    pg = open_case(b)
    errs = pg.errs
    check("the gear is on the chart", pg.is_visible(".cp-gear"))
    pg.click(".cp-gear")
    pg.wait_for_selector(".cp-panel:not([hidden])", timeout=5000)
    check("the gear opens the shared panel", pg.is_visible(".cp-panel") and pg.get_attribute(".cp-gear", "aria-expanded") == "true")
    check("the panel title says Panel Chart settings", pg.inner_text(".cp-title").strip() == "Panel Chart settings", pg.inner_text(".cp-title"))
    tabs = pg.evaluate("[...document.querySelectorAll('.cp-tab')].map(t => t.textContent)")
    check("%d tabs: the eight chart tabs then the standard ones" % len(tabs), len(tabs) >= 15 and tabs[:8] == ["Chart", "Bars", "Lines", "Points", "Axes", "Grid", "Legend", "Title"] and all(t in tabs for t in ("Colors", "Labels", "Number format", "Tooltip", "Fonts", "Background", "Animation", "Interaction", "Fields")), tabs)
    n = pg.evaluate("PC.app.state.store.rows.filter(r => r.type !== 'note').length")
    check("%d settings (at least 60)" % n, n >= 60)
    frame = pg.evaluate(RECT, "#pc-root")
    for dx, dy, name in ((-3000, -3000, "top left"), (4000, 4000, "bottom right")):
        hd = pg.evaluate(RECT, ".cp-head")
        x, y = hd["l"] + 40, hd["t"] + hd["h"] / 2
        pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + dx, y + dy, steps=8); pg.mouse.up()
        r = pg.evaluate(RECT, ".cp-panel")
        check("dragged to the %s the panel stays inside the chart frame" % name, r["l"] >= frame["l"] - 1.5 and r["t"] >= frame["t"] - 1.5 and r["r"] <= frame["r"] + 1.5 and r["b"] <= frame["b"] + 1.5, (r, frame))
    tab(pg, "chart")
    pg.click(".cp-chip[data-k=chartType][data-v=line]")
    ok = waited(pg, "document.querySelector('.pc-svg').dataset.type === 'line' && document.querySelectorAll('.pc-line').length === 3", 3000)
    check("a chip in the panel redraws the chart live (bars became lines)", ok and pg.evaluate("document.querySelectorAll('path.pc-line').length") == 3)
    tab(pg, "lines")
    for _ in range(3):
        pg.click("[data-a=inc][data-k=lineWidth]")
    pg.wait_for_function("PC.app.state.store.get().lineWidth === 4", timeout=3000)
    pg.evaluate(SETTLE)
    check("a stepper is applied to the drawing and saved as a string", pg.evaluate("document.querySelector('path.pc-line').getAttribute('stroke-width')") == "4" and pg.evaluate("PC_MOCK.settings.getAll()['panelchart.lineWidth']") == "4")
    h_open = pg.evaluate(RECT, ".cp-panel")["h"]
    pg.click("[data-a=min]")
    pg.wait_for_function("document.querySelector('.cp-panel').classList.contains('cp-min')")
    check("minimize collapses the panel to its title bar", pg.evaluate(RECT, ".cp-panel")["h"] < h_open * 0.5)
    pg.click("[data-a=min]")
    pg.click("[data-a=copy]")
    pg.wait_for_function("PC.app.state.panel.lastCopied.length > 10", timeout=5000)
    txt = pg.evaluate("PC.app.state.panel.lastCopied")
    obj = json.loads(txt)
    check("Copy settings gives every setting as flat JSON (%d keys)" % len(obj), len(obj) >= 60 and obj["chartType"] == "line" and obj["lineWidth"] == 4)
    pg.evaluate("PC.app.state.store.reset()")
    pg.wait_for_function("PC.app.state.store.get().chartType === 'bar'", timeout=3000)
    pg.click("[data-a=paste]")
    pg.fill("textarea[data-f=paste]", txt)
    pg.click("[data-a=pasteapply]")
    pg.wait_for_selector("textarea[data-f=paste]", state="detached")
    got = pg.evaluate("PC.app.state.store.get()")
    check("Paste settings restores every copied value", all(got[k] == obj[k] for k in obj), [k for k in obj if got[k] != obj[k]][:5])
    pg.evaluate(SETTLE)
    check("the pasted chart type is drawn", pg.evaluate("document.querySelector('.pc-svg').dataset.type") == "line")
    pg.keyboard.press("Escape")
    check("Escape closes the panel and focus returns to the gear", pg.evaluate("document.querySelector('.cp-panel').hidden && document.activeElement === document.querySelector('.cp-gear')"))
    check("panel session: 0 console errors, no dialog", not errs, errs[:3])
    pg.close()
    for theme in ("light", "dark"):
        pg = open_case(b, theme=theme)
        pg.click(".cp-gear"); pg.wait_for_selector(".cp-panel:not([hidden])")
        a = pg.evaluate(AUDIT)
        ranges, small, low, seen = 0, [], [], 0
        for t in a["tabs"]:
            tab(pg, t)
            d = pg.evaluate(AUDIT)
            ranges += d["ranges"]
            for x in d["texts"]:
                seen += 1
                seen_text.append(x["text"])
                if x["size"] < 13.99:
                    small.append((t, x["text"], x["size"]))
                if contrast(x["fg"], x["bg"]) < 7:
                    low.append((t, x["text"], round(contrast(x["fg"], x["bg"]), 2)))
        check("%s worksheet: no range input on any of %d tabs" % (theme, len(a["tabs"])), ranges == 0 and len(a["tabs"]) >= 16, ranges)
        check("%s worksheet: every panel text is 14px or more (%d texts, floor 400)" % (theme, seen), seen >= 400 and not small, small[:3])
        check("%s worksheet: every panel text is 7:1 on its background" % theme, not low, low[:3])
        check("%s worksheet: 0 console errors" % theme, not pg.errs, pg.errs[:3])
        pg.close()


# ----------------------------------------------------------------------------------------------- 390

def g_sheet390(b):
    examined = 0
    for (w, h) in ((390, 700), (390, 844), (390, 560)):
        pg = open_case(b, "sales", (w, h), "light", {}, bare=True)
        pg.click(".cp-gear")
        if not check("%dx%d: the panel turns into the full-frame sheet" % (w, h), waited(pg, "document.querySelector('.cp-panel.cp-sheet') && document.fonts.status === 'loaded'", 8000)):
            pg.close()
            continue
        pg.wait_for_timeout(250)
        vw, vh = pg.evaluate("[innerWidth, innerHeight]")
        pr = pg.evaluate(RECT, ".cp-panel"); fr = pg.evaluate(RECT, ".cp-foot"); rr = pg.evaluate(RECT, "#pc-root")
        check("%dx%d: the panel is a full-frame sheet" % (w, h), abs(pr["l"] - rr["l"]) <= 1 and abs(pr["t"] - rr["t"]) <= 1 and abs(pr["w"] - rr["w"]) <= 1 and abs(pr["h"] - rr["h"]) <= 1 and abs(rr["w"] - w) <= 1, (pr, rr))
        check("%dx%d: footer rect is fully inside the panel and the viewport" % (w, h),
              fr["t"] >= pr["t"] - 1 and fr["b"] <= pr["b"] + 1 and fr["l"] >= -1 and fr["r"] <= vw + 1 and fr["b"] <= vh + 1 and fr["h"] > 20, (fr, pr, vw, vh))
        bad = pg.evaluate("""() => {
          const row = document.querySelector('.cp-tabs'), rr = row.getBoundingClientRect(), bad = [];
          const tabs = [...row.querySelectorAll('.cp-tab')];
          tabs.forEach(t => {
            const tr = t.getBoundingClientRect();
            const x0 = tr.left - rr.left + row.scrollLeft, y0 = tr.top - rr.top + row.scrollTop;
            const inExtentX = x0 >= -1 && x0 + tr.width <= row.scrollWidth + 1;
            const inExtentY = y0 >= -1 && y0 + tr.height <= row.scrollHeight + 1;
            t.scrollIntoView({block: 'nearest', inline: 'nearest'});
            const r = t.getBoundingClientRect(), q = row.getBoundingClientRect();
            const shown = r.left >= q.left - 1 && r.right <= q.right + 1 && r.top >= q.top - 1 && r.bottom <= q.bottom + 1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
            if (!inExtentX || !inExtentY || !shown) bad.push(t.dataset.t);
            if (r.height < 43.5) bad.push(t.dataset.t + ' height ' + r.height);
          });
          return { n: tabs.length, bad };
        }""")
        n = bad["n"]; examined += n
        check("%dx%d: every tab is reachable in the tab row and 44px tall (%d tabs examined)" % (w, h, n), n >= 16 and not bad["bad"], bad)
        check("%dx%d: the page and the panel never scroll sideways" % (w, h), pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1 && (() => { const p = document.querySelector('.cp-panel'), r = document.querySelector('.cp-tabs'); return p.scrollWidth <= p.clientWidth + 1 && r.scrollWidth <= r.clientWidth + 1; })()"))
        last = pg.evaluate("[...document.querySelectorAll('.cp-tab')].pop().dataset.t")
        tab(pg, last)
        check("%dx%d: the last tab can be opened by a click" % (w, h), pg.evaluate("document.querySelector('.cp-tab[aria-selected=true]').dataset.t") == last)
        pg.keyboard.press("Escape")
        audit_chart(pg, "%dx%d chart behind the sheet" % (w, h), {"bar": 21})
        pg.close()
    check("390 wide: %d tab buttons examined in all (floor 48)" % examined, examined >= 48, examined)


# ----------------------------------------------------------------------------------------------- interaction

HOVER = """async ([sel, i]) => {
  const R = PC.app.state.renderer, ov = document.querySelector('.pc-overlay'), m = R.L.marks.filter(x => x.g)[i];
  const box = document.querySelector('.pc-svg').getBoundingClientRect();
  let x, y;
  if (m && R.L.type !== 'line' && R.L.type !== 'area') { x = box.left + m.g.x + (m.g.w || 0) / 2; y = box.top + m.g.y + (m.g.h || 0) / 2; }
  else { x = box.left + R.L.plot.l + R.L.band * (i + 0.5); y = box.top + (R.L.plot.t + R.L.plot.b) / 2; }
  ov.dispatchEvent(new PointerEvent(sel, { bubbles: true, clientX: x, clientY: y, pointerType: 'mouse' }));
  if (sel === 'pointermove') ov.dispatchEvent(new MouseEvent('click', { bubbles: false, clientX: -9999, clientY: -9999 })) && false;
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  return [x, y];
}"""
HOVER = HOVER.replace("  if (sel === 'pointermove') ov.dispatchEvent(new MouseEvent('click', { bubbles: false, clientX: -9999, clientY: -9999 })) && false;\n", "")


def g_interact(b):
    pg = open_case(b, "sales", settings={"hoverPush": True, "hoverMs": 0})
    pg.evaluate("PC_MOCK.worksheet.calls.length = 0")
    x, y = pg.evaluate(HOVER, ["pointermove", 4])
    tip = pg.evaluate("(() => { const t = document.querySelector('.pc-tip'); const cs = getComputedStyle(t); const n = t.querySelector('.pc-tip-n'); return { shown: !t.hidden, text: t.innerText, size: parseFloat(cs.fontSize), fg: cs.color, bg: cs.backgroundColor, mfg: n ? getComputedStyle(n).color : cs.color }; })()")
    seen_text.append(tip["text"])
    check("hover shows the tooltip with the category and value", tip["shown"] and "Region:" in tip["text"], tip["text"])
    check("tooltip text is 14px or more", tip["size"] >= 14, tip["size"])
    check("tooltip text and its muted names are 7:1", contrast(parse_rgb(tip["fg"]), parse_rgb(tip["bg"])) >= 7 and contrast(parse_rgb(tip["mfg"]), parse_rgb(tip["bg"])) >= 7, tip)
    check("hover dims the other bars", pg.evaluate("document.querySelectorAll('.pc-bar.pc-dim').length") >= 15)
    check("Send hover to Tableau calls hoverTupleAsync", any(c[0] == "hoverTupleAsync" for c in pg.evaluate("PC_MOCK.worksheet.calls")))
    pg.evaluate(HOVER, ["click", 4])
    calls = [c for c in pg.evaluate("PC_MOCK.worksheet.calls") if c[0] == "selectMarksByValueAsync"]
    check("a click selects that category in Tableau", calls and calls[-1][1][0]["fieldName"] == "Region" and len(calls[-1][1]) == 1, calls[-1:])
    pg.evaluate("PC.app.state.store.set('selectBy', 'mark')"); pg.evaluate(SETTLE)
    pg.evaluate(HOVER, ["click", 4])
    calls = [c for c in pg.evaluate("PC_MOCK.worksheet.calls") if c[0] == "selectMarksByValueAsync"]
    check("That one mark sends the series value too", calls and len(calls[-1][1]) == 2 and calls[-1][1][1]["fieldName"] == "Product", calls[-1:])
    pg.evaluate("PC.app.state.store.set('selectOn', false)"); pg.evaluate(SETTLE)
    pg.evaluate("PC_MOCK.worksheet.calls.length = 0"); pg.evaluate(HOVER, ["click", 2])
    check("with Click selects off, a click sends nothing", not [c for c in pg.evaluate("PC_MOCK.worksheet.calls") if c[0].startswith("select")])
    check("interaction session: 0 console errors", not pg.errs, pg.errs[:3])
    pg.close()
    pg = open_case(b, "monthly", settings={"chartType": "line"})
    pg.evaluate(HOVER, ["pointermove", 5])
    check("line hover: the guide line appears", pg.evaluate("document.querySelector('.pc-cross').getAttribute('visibility')") == "visible")
    t = pg.inner_text(".pc-tip")
    check("line hover: the tooltip lists all three series at that month", all(p in t for p in ("Coffee", "Pastry", "Sandwich")) and "Jun" in t, t)
    pg.close()


# ----------------------------------------------------------------------------------------------- flip every setting

SIG = """async (probe) => {
  const R = PC.app.state.renderer, chart = document.querySelector('#pc-chart');
  const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))));
  const t0 = performance.now();
  while (R.animating && performance.now() - t0 < 6000) await new Promise(r => setTimeout(r, 20));
  await tick();
  let sig = chart.outerHTML + JSON.stringify(R.lastTween);
  if (probe) {
    PC_MOCK.worksheet.calls.length = 0;
    const ov = document.querySelector('.pc-overlay'), box = document.querySelector('.pc-svg').getBoundingClientRect(), L = R.L;
    const m = L.marks.filter(x => x.g)[2];
    let x, y;
    if (L.type === 'line' || L.type === 'area' || !m) { x = box.left + L.plot.l + L.band * 2.5; y = box.top + (L.plot.t + L.plot.b) / 2; }
    else { x = box.left + m.g.x + (m.g.w || 0) / 2; y = box.top + m.g.y + (m.g.h || 0) / 2; }
    ov.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerType: 'mouse' }));
    await tick();
    sig += '|hover|' + chart.outerHTML + JSON.stringify(PC_MOCK.worksheet.calls);
    ov.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    await tick();
    sig += '|click|' + chart.outerHTML + JSON.stringify(PC_MOCK.worksheet.calls);
    ov.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    R.selected = null; R.leave(true);
    PC_MOCK.worksheet.calls.length = 0;
  }
  return sig;
}"""
APPLY = """async (o) => { const st = PC.app.state.store; st.reset(); st.setMany(o); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }"""
# Sandwich has no March rows in the fixtures, so its line and area break into two pieces (4 marks for 3 series).
# settings whose whole job is interactive: their probe adds a hover and a click to the signature
INTERACTIVE = {"tab": ("tooltip", "interaction"), "keys": ("hoverMs",)}
CONTEXT = {
    "bars": {"chartType": "bar"}, "lines": {"chartType": "line"}, "points": {"chartType": "scatter"},
}
KEY_CONTEXT = {
    "groupGap": {"stack": "group"}, "zeroBase": {"chartType": "line", "stack": "group"}, "gapMode": {"chartType": "line", "__fx": "monthly"},
    "labelLines": {"__fx": "long"}, "fieldX": {"chartType": "scatter"}, "crosshair": {"chartType": "line", "__fx": "monthly"},
    "areaOpacity": {"chartType": "area"}, "areaLine": {"chartType": "area"}, "trendLine": {"chartType": "scatter"},
    "barOpacity": {"chartType": "bar"}, "valueLabelSize": {"valueLabels": True}, "animMs": {"animOn": True}, "animEase": {"animOn": True},
    "selectBy": {"selectOn": True}, "subtitleSize": {"subtitleText": "Flip subtitle"},
}
FLIP = {"topN": 3, "bgMode": "transparent", "catColors": [{"key": "Coffee", "name": "Flip", "color": "#7a3e9d", "hidden": False}],
        "catOrder": [{"key": "Harbor", "name": "Flip harbor", "color": "#7a3e9d", "hidden": False}],
        "fieldCategory": "Product", "fieldValue": "Profit", "fieldColor": "Month", "fieldX": "Units"}
EXEMPT = {}


def flip_value(r):
    k, t, d = r["key"], r["type"], r.get("def")
    if k in FLIP:
        return FLIP[k]
    if t == "check":
        return not d
    if t in ("chips", "select"):
        return [o["value"] for o in r["opts"] if o["value"] != d][0]
    if t == "number":
        return r["min"] if d != r["min"] else r["max"]
    if t == "text":
        return "Flip text"
    if t == "color":
        return "#7a3e9d"
    if t == "palette":
        return "okabe"
    if t == "font":
        return "verdana"
    return None


def g_flip(b):
    pages = {}
    rows = [r for r in json.loads(open_flip_rows(b)) if r["type"] != "note"]
    changed, missing = 0, []
    for r in rows:
        k = r["key"]
        if k in EXEMPT:
            continue
        ctx = dict(CONTEXT.get(r["tab"], {}))
        ctx.update(KEY_CONTEXT.get(k, {}))
        w = r.get("when")
        for cond in ([w] if isinstance(w, dict) else (w or [])):
            if cond["key"] in ctx:
                continue
            if "eq" in cond:
                ctx[cond["key"]] = cond["eq"]
            elif "in" in cond:
                ctx[cond["key"]] = cond["in"][0]
            elif cond.get("truthy"):
                ctx[cond["key"]] = True
        fx = ctx.pop("__fx", "sales")
        if fx not in pages:
            pages[fx] = open_case(b, fx)
        pg = pages[fx]
        probe = r["tab"] in INTERACTIVE["tab"] or k in INTERACTIVE["keys"]
        pg.evaluate(APPLY, ctx)
        a = pg.evaluate(SIG, probe)
        nv = flip_value(r)
        o = dict(ctx); o[k] = nv
        pg.evaluate(APPLY, o)
        now = pg.evaluate("(k) => PC.app.state.store.get()[k]", k)
        bsig = pg.evaluate(SIG, probe)
        if a != bsig and json.dumps(now) == json.dumps(nv):
            changed += 1
        else:
            missing.append("%s (%s -> %s)%s" % (k, r.get("def"), nv, "" if json.dumps(now) == json.dumps(nv) else " not stored"))
    errs = []
    for pg in pages.values():
        errs += pg.errs
        pg.close()
    check("flip: every setting changes the drawing or the interaction it controls (%d of %d changed, floor 90)" % (changed, len(rows) - len(EXEMPT)), not missing and changed >= 90, missing)
    check("flip: 0 console errors over %d settings" % len(rows), not errs, errs[:3])


def open_flip_rows(b):
    pg = open_case(b)
    rows = pg.evaluate("JSON.stringify(PC.settings.prepared.rows)")
    pg.close()
    return rows


# ----------------------------------------------------------------------------------------------- frames

FRAMES = """async ([key, value]) => {
  const R = PC.app.state.renderer, st = PC.app.state.store, ts = [];
  let on = true;
  const loop = t => { ts.push(t); if (on) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  await new Promise(r => setTimeout(r, 300));
  const f0 = R.frames, t0 = performance.now();
  st.set(key, value);
  await new Promise(r => { const w = () => { if (performance.now() - t0 > 120 && !R.animating) r(); else setTimeout(w, 15); }; w(); });
  on = false;
  const seg = ts.filter(t => t >= t0), gaps = [];
  for (let i = 1; i < seg.length; i++) gaps.push(seg[i] - seg[i - 1]);
  return { gaps, frames: R.frames - f0, ms: performance.now() - t0 };
}"""


def g_frames(b):
    pg = open_case(b, "sales", settings={"animOn": True, "animMs": 900, "valueLabels": True})
    total = 0
    for key, val, what in (("chartType", "line", "bars morph into lines"), ("chartType", "area", "lines morph into areas"), ("chartType", "bar", "areas morph into bars"),
                           ("sort", "desc", "bars re-sort"), ("stack", "group", "stacked bars spread side by side"), ("orientation", "horizontal", "bars turn across")):
        r = pg.evaluate(FRAMES, [key, val])
        g = r["gaps"]
        if len(g) < 2:
            check("%s: frames recorded" % what, False, r)
            continue
        med, p95, mx = statistics.median(g), sorted(g)[max(0, int(len(g) * 0.95) - 1)], max(g)
        total += len(g)
        print("  %s: %d frames, median %.1f ms, p95 %.1f ms, max %.1f ms" % (what, len(g), med, p95, mx))
        check("%s: smooth (median %.1f <= 18.5, p95 %.1f <= 40, max %.1f <= 50, %d frames > 30)" % (what, med, p95, mx, len(g)), len(g) > 30 and med <= 18.5 and p95 <= 40 and mx <= 50)
    check("frames: %d frame gaps examined (floor 200)" % total, total >= 200)
    check("frames: 0 console errors", not pg.errs, pg.errs[:3])
    pg.close()


# ----------------------------------------------------------------------------------------------- em dash

def g_emdash(b):
    files = [p for p in ROOT.rglob("*") if p.is_file() and p.suffix in (".js", ".html", ".css", ".trex", ".md", ".txt", ".ps1", ".bat", ".py", ".json") and "lib" not in p.relative_to(ROOT).parts and "__pycache__" not in p.parts]
    bad = [str(p.relative_to(ROOT)) for p in files if EM in p.read_text(encoding="utf-8", errors="replace")]
    check("no em dash in any of %d source files (floor 15)" % len(files), len(files) >= 15 and not bad, bad)
    lib_bad = EM in (ROOT / "lib/ctab-panel/ctab-panel.js").read_text(encoding="utf-8")
    check("no em dash in the vendored panel", not lib_bad)
    own = []
    for typ, fx in (("bar", "sales"), ("line", "monthly"), ("area", "monthly"), ("scatter", "scatter")):
        pg = open_case(b, fx, settings={"chartType": typ, "showTitle": True, "valueLabels": True, "subtitleText": "Subtitle"})
        own.extend(t["text"] for t in pg.evaluate(CHART_AUDIT)["texts"])
        pg.close()
    pg = open_case(b, "sales")
    pg.click(".cp-gear")
    tabs = pg.evaluate("[...document.querySelectorAll('.cp-tab')].map(t => t.dataset.t)")
    for t in tabs:
        tab(pg, t)
        own.extend(x["text"] for x in pg.evaluate(AUDIT)["texts"])
        own.append(pg.inner_text(".cp-panel"))
    pg.close()
    hits = [t for t in own + seen_text if EM in t]
    check("no em dash in any of %d rendered texts (floor 400, plus %d seen by other groups)" % (len(own), len(seen_text)), len(own) >= 400 and not hits, hits[:3])


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        for g in GROUPS:
            if g in only:
                n0, f0 = passes[0], len(fails)
                try:
                    globals()["g_" + g](b)
                except Exception as e:  # a group that cannot finish is a failure, never a silent pass
                    check("%s: the group ran to the end" % g, False, "%s: %s" % (type(e).__name__, str(e).splitlines()[0] if str(e) else ""))
                    for ctx in b.contexts:
                        for pg in ctx.pages:
                            pg.close()
                print("%-8s %d checks, %d RED" % (g, passes[0] - n0 + len(fails) - f0, len(fails) - f0))
        b.close()
    srv.shutdown()
    if fails:
        print("RED: browser gate, %d failed of %d checks (%s)" % (len(fails), len(fails) + passes[0], ",".join(only)))
        sys.exit(1)
    print("GREEN: browser gate, %d checks passed (%s)" % (passes[0], ",".join(only)))


main()
