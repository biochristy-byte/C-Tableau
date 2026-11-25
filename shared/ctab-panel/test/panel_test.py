"""Playwright test of the ctab-panel demo page (shared/ctab-panel/demo/index.html).

  python test/panel_test.py                 # every group
  python test/panel_test.py --only drag,close   # chosen groups (used by sabotage.py)
  python test/panel_test.py --shots DIR     # also write a few screenshots

Groups: open drag touch minimize persist close escape search conditional reset undo copypaste keyboard
        floor contrast norange sheet sheet390 live list color
        1.1.0: diag machine pin dock revert savestatus copyfmt fonts textsize titles options darkpal action frames
Each group reports how many checks it ran; a group that ran none is RED (a gate must say what it examined),
and so is a full run under MIN_CHECKS. Timing waits poll with generous timeouts, never a fixed sleep as proof.
"""
import argparse, functools, http.server, json, math, pathlib, re, socketserver, sys, threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIN_CHECKS = 340
ALL = ["open", "drag", "touch", "minimize", "persist", "close", "escape", "search", "conditional", "reset", "undo", "copypaste",
       "keyboard", "floor", "contrast", "norange", "sheet", "sheet390", "live", "list", "color",
       "diag", "machine", "pin", "dock", "revert", "savestatus", "copyfmt", "fonts", "textsize", "titles", "options", "darkpal", "action", "frames"]
fails, counts, cur = [], {}, [None]
OFFSEEN = [0]


def check(name, cond, detail=""):
    counts[cur[0]] = counts.get(cur[0], 0) + 1
    if not cond:
        fails.append("[%s] %s%s" % (cur[0], name, (" :: " + str(detail)) if detail != "" else ""))


def serve():
    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a, **k):
            pass
        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()
    handler = functools.partial(H, directory=str(ROOT))
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def lum(c):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def contrast(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


AUDIT = """() => {
  const panel = document.querySelector('.cp-panel');
  const parse = s => { const m = (s || '').match(/[\\d.]+/g) || []; return m.map(Number); };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const m = parse(getComputedStyle(e).backgroundColor);
    if (m.length >= 3 && (m.length < 4 || m[3] === 1)) return m.slice(0, 3); } return [255, 255, 255]; };
  const out = [];
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const alpha = (el, col) => { let a = col.length >= 4 ? col[3] : 1; for (let e = el; e; e = e.parentElement) a *= parseFloat(getComputedStyle(e).opacity); return a; };
  const blend = (el, col, bg) => { const a = alpha(el, col); return [0, 1, 2].map(i => col[i] * a + bg[i] * (1 - a)); };
  panel.querySelectorAll('*').forEach(el => {
    if (!vis(el)) return;
    const tag = el.tagName; let txt = '';
    if (tag === 'INPUT') { if (['checkbox', 'color', 'radio'].includes(el.type)) return; txt = el.value || ''; if (!txt && el.placeholder) { const cs = getComputedStyle(el, '::placeholder'); out.push({ tag: tag + '::placeholder', text: el.placeholder, size: parseFloat(cs.fontSize), fg: parse(cs.color).slice(0, 3), bg: bgOf(el) }); } }
    else if (tag === 'TEXTAREA') { txt = el.value || ''; if (!txt && el.placeholder) { const cs = getComputedStyle(el, '::placeholder'); out.push({ tag: 'TEXTAREA::placeholder', text: el.placeholder, size: parseFloat(cs.fontSize), fg: parse(cs.color).slice(0, 3), bg: bgOf(el) }); } }
    else if (tag === 'SELECT') { txt = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : ''; }
    else { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) txt += n.textContent.trim() + ' '; }
    if (!txt.trim()) return;
    const cs = getComputedStyle(el), bg = bgOf(el), fc = parse(cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color);
    out.push({ tag, text: txt.trim().slice(0, 40), size: parseFloat(cs.fontSize), fg: blend(el, fc, bg), bg: bg, off: !!el.closest('.cp-off') });
  });
  return { texts: out, ranges: document.querySelectorAll('input[type=range]').length, tabs: [...panel.querySelectorAll('.cp-tab')].map(t => t.dataset.t) };
}"""

RECT = "(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return {l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height}; }"


class Ctx:
    def __init__(self, browser, port):
        self.b, self.port, self.pages = browser, port, []

    def page(self, w=900, h=600, query="", touch=False, perms=False, vp=None):
        ctx = self.b.new_context(viewport=vp or {"width": max(w, 320), "height": max(h, 320)}, has_touch=touch,
                                 permissions=["clipboard-read", "clipboard-write"] if perms else [])
        pg = ctx.new_page()
        pg.errs, pg.dialogs = [], []
        pg.on("console", lambda m: pg.errs.append(m.text) if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: pg.errs.append("pageerror " + str(e)))
        pg.on("dialog", lambda d: (pg.dialogs.append(d.type), d.dismiss()))
        pg.add_init_script("window.__dlg = 0; ['alert','confirm','prompt'].forEach(function(n){ window[n] = function(){ window.__dlg++; return n === 'confirm'; }; });")
        pg.goto("http://127.0.0.1:%d/demo/index.html?w=%d&h=%d%s" % (self.port, w, h, query))
        pg.wait_for_function("window.demo && document.querySelector('.cp-gear')", timeout=15000)
        pg.ctx = ctx
        self.pages.append(pg)
        return pg


def open_panel(pg):
    pg.click(".cp-gear")
    pg.wait_for_selector(".cp-panel:not([hidden])", timeout=5000)


def tab(pg, tid):
    pg.click(".cp-tab[data-t='%s']" % tid)
    pg.wait_for_function("document.querySelector(\".cp-tab[data-t='%s']\").getAttribute('aria-selected') === 'true'" % tid)


def val(pg, key):
    return pg.evaluate("(k) => demo.store.get()[k]", key)


def inside(r, f, tol=1.5):
    return r["l"] >= f["l"] - tol and r["t"] >= f["t"] - tol and r["r"] <= f["r"] + tol and r["b"] <= f["b"] + tol


def head_point(pg):
    r = pg.evaluate(RECT, ".cp-head")
    return r["l"] + 40, r["t"] + r["h"] / 2


# ------------------------------------------------------------------ groups

def g_open(c):
    pg = c.page()
    check("panel starts hidden", pg.evaluate("document.querySelector('.cp-panel').hidden"))
    check("gear is visible and collapsed", pg.is_visible(".cp-gear") and pg.get_attribute(".cp-gear", "aria-expanded") == "false")
    open_panel(pg)
    f = pg.evaluate(RECT, "#frame")
    check("panel opens", pg.is_visible(".cp-panel"))
    check("gear hides while open and reports expanded", not pg.is_visible(".cp-gear"))
    check("focus moves into the panel on open", pg.evaluate("document.querySelector('.cp-panel').contains(document.activeElement)"))
    check("panel sits inside the frame", inside(pg.evaluate(RECT, ".cp-panel"), f))
    check("panel is at most 400px wide on a 900px frame", pg.evaluate(RECT, ".cp-panel")["w"] <= 401)
    check("dialog role and label", pg.get_attribute(".cp-panel", "role") == "dialog" and pg.get_attribute(".cp-panel", "aria-label") == "Demo settings")
    check("tabs: Layout, Rings and the nine standard ones plus Panel", len(pg.query_selector_all(".cp-tab")) == 12, len(pg.query_selector_all(".cp-tab")))
    check("first tab selected", pg.get_attribute(".cp-tab[data-t='layout']", "aria-selected") == "true")
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_drag(c):
    pg = c.page(w=900, h=900)
    open_panel(pg)
    f = pg.evaluate(RECT, "#frame")
    r0 = pg.evaluate(RECT, ".cp-panel")
    x, y = head_point(pg)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 100, y + 60, steps=6); pg.mouse.move(x - 200, y + 150, steps=6); pg.mouse.up()
    r1 = pg.evaluate(RECT, ".cp-panel")
    check("drag by the title bar moves the panel left by the pointer delta", abs((r0["l"] - r1["l"]) - 200) <= 2, (r0["l"], r1["l"]))
    check("drag moves the panel down by the pointer delta", abs((r1["t"] - r0["t"]) - 150) <= 2, (r0["t"], r1["t"]))
    x, y = head_point(pg)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(-3000, -3000, steps=8); pg.mouse.up()
    r2 = pg.evaluate(RECT, ".cp-panel")
    check("dragged far up-left clamps to the frame's top-left corner", abs(r2["l"] - f["l"]) <= 1.5 and abs(r2["t"] - f["t"]) <= 1.5, r2)
    x, y = head_point(pg)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(4000, 4000, steps=8); pg.mouse.up()
    r3 = pg.evaluate(RECT, ".cp-panel")
    check("dragged far down-right clamps to the frame's bottom-right corner", abs(r3["r"] - f["r"]) <= 1.5 and abs(r3["b"] - f["b"]) <= 1.5, (r3, f))
    check("never leaves the frame at any extreme", inside(r2, f) and inside(r3, f))
    x, y = head_point(pg)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x + 4000, y - 4000, steps=5); pg.mouse.up()
    check("up-right extreme stays inside", inside(pg.evaluate(RECT, ".cp-panel"), f))
    pos = pg.evaluate("demo.panel.state.x + ',' + demo.panel.state.y")
    check("position is kept in panel state", pos == "%d,%d" % (round(pg.evaluate(RECT, ".cp-panel")["l"] - f["l"]), round(pg.evaluate(RECT, ".cp-panel")["t"] - f["t"])), pos)
    # a press on the minimize button must not start a drag
    b0 = pg.evaluate(RECT, ".cp-panel")
    bx = pg.evaluate(RECT, "[data-a=min]")
    pg.mouse.move(bx["l"] + 8, bx["t"] + 8); pg.mouse.down(); pg.mouse.move(bx["l"] - 60, bx["t"] + 40, steps=4); pg.mouse.up()
    b1 = pg.evaluate(RECT, ".cp-panel")
    check("pressing a title-bar button does not drag", abs(b0["l"] - b1["l"]) < 1.5 and abs(b0["t"] - b1["t"]) < 1.5)
    # keyboard move
    pg.focus(".cp-head")
    l0 = pg.evaluate(RECT, ".cp-panel")["l"]
    pg.keyboard.press("ArrowLeft"); pg.keyboard.press("ArrowLeft")
    l1 = pg.evaluate(RECT, ".cp-panel")["l"]
    check("arrow keys on the focused title bar move the panel 16px per press", abs((l0 - l1) - 32) <= 2 or l1 <= f["l"] + 1, (l0, l1))
    # the frame shrinks: the panel is pulled back in
    pg.evaluate("document.getElementById('frame').style.width = '520px'; document.getElementById('frame').style.height = '420px'")
    pg.wait_for_function("(() => { const r = document.querySelector('.cp-panel').getBoundingClientRect(); return r.right <= 521 && r.bottom <= 421; })()", timeout=5000)
    check("shrinking the frame re-clamps the panel", inside(pg.evaluate(RECT, ".cp-panel"), pg.evaluate(RECT, "#frame")))
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_touch(c):
    pg = c.page(w=900, h=900, touch=True)
    open_panel(pg)
    cdp = pg.ctx.new_cdp_session(pg)
    f = pg.evaluate(RECT, "#frame")

    def swipe(x0, y0, x1, y1, n=8):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y0}]})
        for i in range(1, n + 1):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + (x1 - x0) * i / n, "y": y0 + (y1 - y0) * i / n}]})
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    r0 = pg.evaluate(RECT, ".cp-panel")
    x, y = head_point(pg)
    swipe(x, y, x - 180, y + 120)
    pg.wait_for_timeout(100)
    r1 = pg.evaluate(RECT, ".cp-panel")
    check("touch drag moves the panel left", abs((r0["l"] - r1["l"]) - 180) <= 3, (r0["l"], r1["l"]))
    check("touch drag moves the panel down", abs((r1["t"] - r0["t"]) - 120) <= 3, (r0["t"], r1["t"]))
    x, y = head_point(pg)
    swipe(x, y, -2500, -2500)
    r2 = pg.evaluate(RECT, ".cp-panel")
    check("touch drag far up-left clamps to the frame", abs(r2["l"] - f["l"]) <= 1.5 and abs(r2["t"] - f["t"]) <= 1.5, r2)
    x, y = head_point(pg)
    swipe(x, y, 3500, 3500)
    r3 = pg.evaluate(RECT, ".cp-panel")
    check("touch drag far down-right clamps to the frame", abs(r3["r"] - f["r"]) <= 1.5 and abs(r3["b"] - f["b"]) <= 1.5, (r3, f))
    check("the page did not scroll or pan during the touch drag", pg.evaluate("scrollX === 0 && scrollY === 0"))
    pg.ctx.close()


def g_minimize(c):
    pg = c.page()
    open_panel(pg)
    full = pg.evaluate(RECT, ".cp-panel")["h"]
    pg.click("[data-a=min]")
    pg.wait_for_function("document.querySelector('.cp-panel').classList.contains('cp-min')")
    m = pg.evaluate(RECT, ".cp-panel")
    check("minimized panel is just the title bar", m["h"] < 80 and m["h"] < full / 4, (m["h"], full))
    check("body, tabs and footer are hidden when minimized", not pg.is_visible(".cp-tabs") and not pg.is_visible(".cp-foot") and not pg.is_visible(".cp-body"))
    check("title bar still visible", pg.is_visible(".cp-head") and pg.is_visible(".cp-title"))
    check("minimize button says Restore", pg.get_attribute("[data-a=min]", "aria-label") == "Restore settings")
    f = pg.evaluate(RECT, "#frame")
    x, y = head_point(pg)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(4000, 4000, steps=6); pg.mouse.up()
    mb = pg.evaluate(RECT, ".cp-panel")
    check("a minimized panel clamps to the frame bottom", abs(mb["b"] - f["b"]) <= 1.5 and inside(mb, f), mb)
    pg.click("[data-a=min]")
    pg.wait_for_function("!document.querySelector('.cp-panel').classList.contains('cp-min')")
    pg.wait_for_timeout(100)
    rb = pg.evaluate(RECT, ".cp-panel")
    check("restoring pulls a panel that would overflow back inside the frame", inside(rb, f), rb)
    check("restored panel shows the body again", pg.is_visible(".cp-body") and pg.is_visible(".cp-foot"))
    pg.ctx.close()


def g_persist(c):
    pg = c.page(query="&persist=1")
    pg.evaluate("localStorage.clear()")
    pg.reload(); pg.wait_for_function("window.demo")
    open_panel(pg)
    x, y = head_point(pg)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 140, y + 90, steps=5); pg.mouse.up()
    tab(pg, "rings")
    pg.click("[data-a=min]")
    pos = pg.evaluate("[demo.panel.state.x, demo.panel.state.y]")
    pg.wait_for_function("localStorage.getItem('ctab:demo.panel')", timeout=5000)
    pg.wait_for_timeout(400)  # well past the 60 ms save debounce
    check("dragging, switching tabs and minimizing never save the workbook", pg.evaluate("demo.fake.saves") == 0 and pg.evaluate("demo.fake.get('demo._panel')") is None,
          (pg.evaluate("demo.fake.saves"), pg.evaluate("demo.fake.get('demo._panel')")))
    pg.reload(); pg.wait_for_function("window.demo")
    open_panel(pg)
    pos2 = pg.evaluate("[demo.panel.state.x, demo.panel.state.y]")
    check("position is remembered across a reload", pos == pos2, (pos, pos2))
    check("minimized state is remembered", pg.evaluate("document.querySelector('.cp-panel').classList.contains('cp-min')"))
    pg.click("[data-a=min]")
    check("last tab is remembered", pg.get_attribute(".cp-tab[data-t='rings']", "aria-selected") == "true")
    saved = pg.evaluate("JSON.parse(localStorage.getItem('ctab:demo.panel'))")
    check("kept per machine in localStorage (ctab:demo.panel) with x, y, min, tab, docked", all(k in saved for k in ("x", "y", "min", "tab", "docked")) and saved["docked"] is False, saved)
    pg.ctx.close()


def g_close(c):
    pg = c.page()
    open_panel(pg)
    pg.click("[data-a=close]")
    check("close button hides the panel", pg.evaluate("document.querySelector('.cp-panel').hidden"))
    check("focus returns to the gear after close", pg.evaluate("document.activeElement === document.querySelector('.cp-gear')"))
    check("gear is back and collapsed", pg.is_visible(".cp-gear") and pg.get_attribute(".cp-gear", "aria-expanded") == "false")
    pg.focus(".cp-gear"); pg.keyboard.press("Enter")
    pg.wait_for_selector(".cp-panel:not([hidden])")
    check("Enter on the gear opens the panel", pg.is_visible(".cp-panel"))
    pg.click("[data-a=close]")
    check("close after keyboard open also returns focus to the gear", pg.evaluate("document.activeElement === document.querySelector('.cp-gear')"))
    pg.ctx.close()


def g_escape(c):
    pg = c.page()
    open_panel(pg)
    pg.keyboard.press("Escape")
    check("Escape closes the panel", pg.evaluate("document.querySelector('.cp-panel').hidden"))
    check("Escape returns focus to the gear", pg.evaluate("document.activeElement === document.querySelector('.cp-gear')"))
    open_panel(pg)
    pg.fill(".cp-q", "ring"); pg.press(".cp-q", "Escape")
    check("Escape from the search box closes the panel", pg.evaluate("document.querySelector('.cp-panel').hidden"))
    open_panel(pg)
    pg.click(".cp-chip[data-v=multi]")
    pg.keyboard.press("Escape")
    check("Escape from a chip closes the panel and focuses the gear", pg.evaluate("document.querySelector('.cp-panel').hidden && document.activeElement === document.querySelector('.cp-gear')"))
    open_panel(pg)
    pg.evaluate("document.activeElement.blur(); document.body.focus()")
    pg.keyboard.press("Escape")
    check("Escape with focus outside the panel still closes it", pg.evaluate("document.querySelector('.cp-panel').hidden"))
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_search(c):
    pg = c.page()
    open_panel(pg)
    n0 = len(pg.query_selector_all(".cp-row"))
    pg.fill(".cp-q", "color")
    pg.wait_for_selector(".cp-count")
    rows = pg.evaluate("[...document.querySelectorAll('.cp-row')].map(r => r.dataset.row)")
    heads = pg.evaluate("[...document.querySelectorAll('.cp-sec')].map(h => h.textContent)")
    check("search filters rows across tabs", 2 <= len(rows) < 40 and len(rows) != n0, (len(rows), n0))
    check("results come from more than one tab", len(set(heads)) >= 3, heads)
    check("a known match is present (ring color)", "ringColor" in rows and "labelColor" in rows, rows)
    check("the match count is shown", re.search(r"\d+ matches", pg.inner_text(".cp-count")) is not None, pg.inner_text(".cp-count"))
    check("no tab looks selected while searching", pg.evaluate("[...document.querySelectorAll('.cp-tab')].every(t => t.getAttribute('aria-selected') === 'false')"))
    pg.fill(".cp-q", "zzzzqq")
    check("no match shows a message", "No setting matches" in pg.inner_text(".cp-empty"))
    pg.fill(".cp-q", "columns")
    found = pg.evaluate("[...document.querySelectorAll('.cp-row')].map(r => r.dataset.row + (r.classList.contains('cp-off') ? '!' : ''))")
    check("search finds a grayed-out row and shows it grayed out", found == ["cols!"], found)
    pg.fill(".cp-q", "")
    tab(pg, "layout")
    pg.click(".cp-chip[data-v=multi]")
    pg.fill(".cp-q", "columns")
    check("the same row is found once its condition is true", pg.evaluate("[...document.querySelectorAll('.cp-row')].map(r => r.dataset.row)").count("cols") == 1)
    pg.fill(".cp-q", "send hover")
    check("search finds by label words", pg.evaluate("[...document.querySelectorAll('.cp-row')].map(r => r.dataset.row)") == ["hoverPush"], pg.evaluate("[...document.querySelectorAll('.cp-row')].map(r => r.dataset.row)"))
    pg.fill(".cp-q", "")
    check("clearing the search brings the tab back", pg.query_selector(".cp-row[data-row=mode]") is not None and pg.get_attribute(".cp-tab[data-t='layout']", "aria-selected") == "true")
    pg.fill(".cp-q", "ring")
    pg.click(".cp-tab[data-t='fonts']")
    check("clicking a tab while searching clears the search and opens it", pg.input_value(".cp-q") == "" and pg.get_attribute(".cp-tab[data-t='fonts']", "aria-selected") == "true")
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_conditional(c):
    pg = c.page()
    open_panel(pg)
    st = lambda k: pg.evaluate("""(k) => { const r = document.querySelector('.cp-row[data-row="' + k + '"]'); if (!r) return null;
      const cs = [...r.querySelectorAll('input,button,select,textarea')];
      return { off: r.classList.contains('cp-off'), aria: r.getAttribute('aria-disabled'), dis: cs.length > 0 && cs.every(e => e.disabled), n: cs.length,
               why: (r.querySelector('.cp-offwhy') || {}).textContent || '', lock: !!r.querySelector('.cp-lock'), op: getComputedStyle(r).opacity }; }""", k)
    a, b = st("cols"), st("bName")
    check("a row whose condition is false is shown grayed out, not removed", a is not None and a["off"] and b is not None and b["off"], (a, b))
    check("its controls are disabled and the row says aria-disabled", a["dis"] and a["n"] >= 3 and a["aria"] == "true", a)
    check("it says in words what turns it on", 'Set "Show as" to "Small multiples" to use this.' in a["why"] and 'Turn on "Show the benchmark" to use this.' in b["why"], (a["why"], b["why"]))
    check("grayed by a lock and outline, never by opacity", a["lock"] and a["op"] == "1", a)
    y0 = pg.evaluate(RECT, ".cp-row[data-row=angle]")["t"]
    pg.click(".cp-chip[data-v=multi]")
    a2 = st("cols")
    check("chip choice turns the Columns row on", a2 and not a2["off"] and not a2["dis"] and a2["aria"] is None, a2)
    y1 = pg.evaluate(RECT, ".cp-row[data-row=angle]")["t"]; hon = pg.evaluate(RECT, ".cp-row[data-row=cols]")["h"]
    check("rows below move less than the 1.0.0 jump (the whole row appearing)", abs(y1 - y0) < 0.75 * hon, (y0, y1, hon))
    check("the help text sits under the row", "Only for small multiples" in pg.inner_text(".cp-row[data-row=cols]"))
    pg.wait_for_function("document.querySelector('#chart').textContent.indexOf('\"mode\": \"multi\"') >= 0", timeout=5000)
    check("chart saw the mode", True)
    pg.check("input[data-k=showB]")
    check("a checkbox turns the Benchmark name row on", not st("bName")["off"])
    check("focus stays on the checkbox after the rows change", pg.evaluate("document.activeElement.getAttribute('data-k')") == "showB")
    pg.uncheck("input[data-k=showB]")
    check("unchecking grays it out again", st("bName")["off"])
    pg.click(".cp-chip[data-v=overlay]")
    check("switching back grays Columns out", st("cols")["off"])
    pg.check("input[data-k=showB]")
    pg.fill("input[data-k=bName]", "Goal")
    check("typing in a conditional text row keeps focus while the chart updates", pg.evaluate("document.activeElement.getAttribute('data-k')") == "bName")
    pg.wait_for_function("document.querySelector('#chart').textContent.indexOf('Goal') >= 0", timeout=5000)
    pg.uncheck("input[data-k=showB]")
    check("a grayed-out row cannot be changed", pg.evaluate("document.querySelector('input[data-k=bName]').disabled") and val(pg, "bName") == "Goal")
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_reset(c):
    pg = c.page()
    open_panel(pg)
    pg.click("[data-a=resettab]")
    check("nothing to reset: inline message, no confirm", "already at its defaults" in pg.inner_text(".cp-status") and pg.query_selector(".cp-extra") is None, pg.inner_text(".cp-status"))
    pg.click("[data-a=inc][data-k=angle]"); pg.click("[data-a=inc][data-k=angle]")
    pg.click(".cp-chip[data-v=multi]")
    check("values changed", val(pg, "angle") == 120 and val(pg, "mode") == "multi", (val(pg, "angle"), val(pg, "mode")))
    pg.click("[data-a=resettab]")
    pg.wait_for_selector(".cp-extra")
    txt = pg.inner_text(".cp-extra")
    check("Reset this tab asks inline, in the panel", "Reset 2 settings on this tab" in txt and pg.evaluate("document.querySelector('.cp-panel').contains(document.querySelector('.cp-extra'))"), txt)
    check("the confirm is an alertdialog region with Yes and Cancel", pg.get_attribute(".cp-extra", "role") == "alertdialog" and pg.query_selector("[data-a=confirmyes]") and pg.query_selector("[data-a=confirmno]") is not None)
    check("focus moves to Cancel (the safe choice)", pg.evaluate("document.activeElement.getAttribute('data-a')") == "confirmno")
    check("nothing has been reset yet", val(pg, "angle") == 120)
    pg.click("[data-a=confirmno]")
    check("Cancel keeps the values and closes the confirm", val(pg, "angle") == 120 and pg.query_selector(".cp-extra") is None)
    check("focus returns to Reset this tab", pg.evaluate("document.activeElement.getAttribute('data-a')") == "resettab")
    pg.click("[data-a=resettab]"); pg.click("[data-a=confirmyes]")
    check("Yes resets this tab to the defaults", val(pg, "angle") == 90 and val(pg, "mode") == "overlay", (val(pg, "angle"), val(pg, "mode")))
    check("a result message is shown", "Reset 2 settings" in pg.inner_text(".cp-status"), pg.inner_text(".cp-status"))
    check("the input on screen shows the default again", pg.input_value("input[data-k=angle]") == "90")
    tab(pg, "rings"); pg.click("[data-a=inc][data-k=ringCount]")
    tab(pg, "layout"); pg.click("[data-a=inc][data-k=angle]")
    pg.click("[data-a=resetall]")
    check("Reset all names every tab", "across every tab" in pg.inner_text(".cp-extra") and "Reset 2 settings" in pg.inner_text(".cp-extra"), pg.inner_text(".cp-extra"))
    pg.press("[data-a=confirmno]", "Escape")
    check("Escape closes the panel even with a confirm open", pg.evaluate("document.querySelector('.cp-panel').hidden"))
    open_panel(pg)
    check("a confirm left open is not shown again after reopening", pg.query_selector(".cp-extra") is None)
    pg.click("[data-a=resetall]"); pg.click("[data-a=confirmyes]")
    check("Reset all restores every tab", val(pg, "angle") == 90 and val(pg, "ringCount") == 4)
    check("no browser dialog was shown or called", not pg.dialogs and pg.evaluate("window.__dlg") == 0, (pg.dialogs, pg.evaluate("window.__dlg")))
    pg.ctx.close()


def g_undo(c):
    pg = c.page()
    open_panel(pg)
    pg.click("[data-a=undo]")
    check("Undo with nothing to undo says so", "Nothing to undo" in pg.inner_text(".cp-status"))
    pg.click("[data-a=inc][data-k=angle]")
    check("stepper changed the value", val(pg, "angle") == 105)
    pg.click("[data-a=undo]")
    check("Undo restores the last change", val(pg, "angle") == 90, val(pg, "angle"))
    check("the input on screen follows the undo", pg.input_value("input[data-k=angle]") == "90")
    check("Undo says what it undid", "Undid" in pg.inner_text(".cp-status"), pg.inner_text(".cp-status"))
    check("the chart re-rendered with the undone value", '"angle": 90' in pg.inner_text("#chart"))
    pg.click(".cp-chip[data-v=multi]"); pg.click("[data-a=inc][data-k=cols]"); pg.click("[data-a=undo]")
    check("Undo goes back one step at a time", val(pg, "cols") == 3 and val(pg, "mode") == "multi")
    pg.click("[data-a=undo]")
    check("then the earlier step", val(pg, "mode") == "overlay")
    pg.click(".cp-chip[data-v=multi]"); pg.click("[data-a=resettab]"); pg.click("[data-a=confirmyes]")
    check("reset worked", val(pg, "mode") == "overlay")
    pg.click("[data-a=undo]")
    check("Undo reverses a whole reset in one step", val(pg, "mode") == "multi")
    pg.fill("input[data-k=angle]", "200"); pg.fill("input[data-k=angle]", "210")
    pg.click("[data-a=undo]")
    check("typing in one field is one undo step, not one per keystroke", val(pg, "angle") == 90, val(pg, "angle"))
    pg.ctx.close()


def g_copypaste(c):
    pg = c.page(perms=True)
    open_panel(pg)
    pg.click("[data-a=inc][data-k=angle]")
    pg.click("[data-a=copy][data-kind=everything]")
    pg.wait_for_function("document.querySelector('.cp-status').textContent.indexOf('Copied') === 0", timeout=5000)
    txt = pg.evaluate("demo.panel.lastCopied")
    obj = json.loads(txt)["settings"]
    n = pg.evaluate("demo.store.rows.filter(r => ['note', 'preview', 'action', 'diag'].indexOf(r.type) < 0).length")
    check("Copy everything makes valid JSON holding every setting", len(obj) == n and n >= 50, (len(obj), n))
    check("the copied JSON carries the changed value", obj["angle"] == 105)
    check("status says how many were copied", ("Copied every setting (%d settings)" % n) in pg.inner_text(".cp-status"), pg.inner_text(".cp-status"))
    try:
        clip = pg.evaluate("navigator.clipboard.readText()")
    except Exception as e:
        clip = "ERR " + str(e)[:80]
    check("the clipboard holds exactly that text", clip.replace(chr(13) + chr(10), chr(10)) == txt, clip[:80])
    check("the list setting is a real array in the JSON", isinstance(obj["axes"], list) and isinstance(obj["catColors"], list))
    pg.click("[data-a=paste]")
    pg.wait_for_selector("textarea[data-f=paste]")
    check("Paste settings opens a box inside the panel", pg.evaluate("document.querySelector('.cp-panel').contains(document.querySelector('textarea[data-f=paste]'))"))
    check("focus is in the paste box", pg.evaluate("document.activeElement.getAttribute('data-f')") == "paste")
    pg.fill("textarea[data-f=paste]", "{this is not json")
    pg.click("[data-a=pasteapply]")
    msg = pg.inner_text(".cp-msg[role=alert]")
    check("bad JSON shows an inline message, not a dialog", "not valid JSON" in msg and not pg.dialogs and pg.evaluate("window.__dlg") == 0, msg)
    check("the message is in an alert region so screen readers read it", pg.get_attribute(".cp-msg", "role") == "alert")
    check("the paste box stays open with the text kept", pg.input_value("textarea[data-f=paste]") == "{this is not json")
    check("nothing changed after the bad paste", val(pg, "angle") == 105)
    pg.fill("textarea[data-f=paste]", "[1,2,3]"); pg.click("[data-a=pasteapply]")
    check("a JSON array is refused with its own message", "JSON object" in pg.inner_text(".cp-msg[role=alert]"))
    pg.fill("textarea[data-f=paste]", '{"zzz": 1}'); pg.click("[data-a=pasteapply]")
    check("only-unknown keys are refused", "No settings" in pg.inner_text(".cp-msg[role=alert]"))
    pg.fill("textarea[data-f=paste]", '{"angle": 45, "mode": "multi", "bogus": 1, "ringCount": "oops"}'); pg.click("[data-a=pasteapply]")
    pg.wait_for_selector("textarea[data-f=paste]", state="detached")
    check("a valid paste applies the good keys", val(pg, "angle") == 45 and val(pg, "mode") == "multi" and val(pg, "ringCount") == 4, (val(pg, "angle"), val(pg, "mode")))
    st = pg.inner_text(".cp-status")
    check("the result message counts applied, unknown and invalid", "Applied 2 settings" in st and "1 unknown" in st and "1 invalid" in st, st)
    pg.click("[data-a=undo]")
    check("a paste is one undo step", val(pg, "angle") == 105 and val(pg, "mode") == "overlay")
    pg.click("[data-a=paste]"); pg.fill("textarea[data-f=paste]", txt); pg.click("[data-a=pasteapply]")
    check("pasting the Copy output back round-trips", val(pg, "angle") == 105)
    pg.click("[data-a=paste]"); pg.click("[data-a=pastecancel]")
    check("Cancel closes the paste box and returns focus", pg.query_selector("textarea[data-f=paste]") is None and pg.evaluate("document.activeElement.getAttribute('data-f')") == "paste-open")
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_keyboard(c):
    pg = c.page()
    pg.focus(".cp-gear"); pg.keyboard.press("Enter")
    pg.wait_for_selector(".cp-panel:not([hidden])")
    expected = pg.evaluate("""() => [...document.querySelectorAll('.cp-panel button, .cp-panel input, .cp-panel select, .cp-panel textarea, .cp-panel [tabindex="0"]')]
      .filter(e => !(e.classList.contains('cp-tab') && e.tabIndex < 0) && !e.disabled && e.getBoundingClientRect().width > 0 && !e.closest('[hidden]')).map(e => e.getAttribute('data-f') || e.getAttribute('data-a') || e.className)""")
    seen = []
    for _ in range(len(expected) + 12):
        pg.keyboard.press("Tab")
        s = pg.evaluate("(() => { const a = document.activeElement; return a && document.querySelector('.cp-panel').contains(a) ? (a.getAttribute('data-f') || a.getAttribute('data-a') || a.className) : null; })()")
        if s is None:
            break
        seen.append(s)
    missing = [e for e in expected if e not in seen]
    check("Tab reaches every control on the first tab (%d of them)" % len(expected), len(expected) >= 15 and not missing, missing[:5])
    check("Tab visits each control once, then leaves the panel", len(seen) == len(set(seen)), seen)
    pg.focus(".cp-tab[aria-selected=true]")
    pg.keyboard.press("ArrowRight")
    check("ArrowRight on a tab selects the next tab", pg.get_attribute(".cp-tab[data-t='rings']", "aria-selected") == "true")
    check("the new tab's button has focus", pg.evaluate("document.activeElement.dataset.t") == "rings")
    pg.keyboard.press("End")
    check("End goes to the last tab", pg.evaluate("document.activeElement.dataset.t") == "_panel")
    pg.keyboard.press("ArrowRight")
    check("ArrowRight wraps to the first", pg.evaluate("document.activeElement.dataset.t") == "layout")
    pg.keyboard.press("Home"); pg.keyboard.press("ArrowLeft")
    check("ArrowLeft wraps to the last", pg.evaluate("document.activeElement.dataset.t") == "_panel")
    check("only the selected tab is a tab stop (roving tabindex)", pg.evaluate("[...document.querySelectorAll('.cp-tab')].filter(t => t.tabIndex === 0).length") == 1)
    tab(pg, "layout")
    pg.focus("input[data-k=angle]"); pg.keyboard.press("ArrowUp")
    check("ArrowUp in a number box steps the setting", val(pg, "angle") == 105, val(pg, "angle"))
    pg.keyboard.type("0"); pg.keyboard.press("Enter")
    check("Enter in a number box commits and leaves it", pg.evaluate("document.activeElement.tagName") != "INPUT" and isinstance(val(pg, "angle"), (int, float)))
    pg.focus(".cp-chip[data-v=multi]"); pg.keyboard.press("Space")
    check("Space presses a chip", val(pg, "mode") == "multi")
    pg.focus("[data-k=sortAxes]"); pg.keyboard.press("ArrowDown")
    check("a select changes by keyboard", val(pg, "sortAxes") == "name", val(pg, "sortAxes"))
    pg.focus("input[data-k=showB]"); pg.keyboard.press("Space")
    check("Space toggles a checkbox", val(pg, "showB") is True)
    check("every control has an accessible name", pg.evaluate("""() => [...document.querySelectorAll('.cp-panel button, .cp-panel input, .cp-panel select, .cp-panel textarea')]
      .filter(e => e.getBoundingClientRect().width > 0).every(e => (e.getAttribute('aria-label') || (e.labels && e.labels.length) || e.textContent.trim() || e.getAttribute('aria-labelledby') || e.title))"""))
    pg.ctx.close()


def audit(pg):
    return pg.evaluate(AUDIT)


def all_tabs_audit(pg, label, minc=7.0, floor_px=14):
    """Visit every tab (plus the footer's paste and confirm views) and test every text: size and contrast."""
    bad_size, bad_con, n = [], [], 0
    a = audit(pg)
    for t in a["tabs"] + ["__paste", "__confirm", "__search"]:
        if t == "__paste":
            pg.click("[data-a=paste]"); pg.wait_for_selector("textarea[data-f=paste]")
            pg.fill("textarea[data-f=paste]", "{bad"); pg.click("[data-a=pasteapply]")
        elif t == "__confirm":
            pg.click("[data-a=pastecancel]"); tab(pg, "layout"); pg.click("[data-a=inc][data-k=angle]"); pg.click("[data-a=resettab]"); pg.wait_for_selector(".cp-extra")
        elif t == "__search":
            pg.click("[data-a=confirmno]"); pg.fill(".cp-q", "color")
        else:
            tab(pg, t)
            if t == "layout":
                pg.click(".cp-chip[data-v=multi]"); pg.check("input[data-k=showB]")
        d = audit(pg)
        for x in d["texts"]:
            n += 1
            OFFSEEN[0] += 1 if x.get("off") else 0
            if x["size"] < floor_px - 0.01:
                bad_size.append((label, t, x["tag"], x["text"], x["size"]))
            cr = contrast(x["fg"], x["bg"])
            if cr < minc:
                bad_con.append((label, t, x["tag"], x["text"], round(cr, 2), x["fg"], x["bg"]))
    pg.fill(".cp-q", "")
    return n, bad_size, bad_con


def g_floor(c):
    pg = c.page()
    open_panel(pg)
    n, bs, bc = all_tabs_audit(pg, "light")
    check("examined at least 400 text elements across all tabs and views", n >= 400, n)
    check("every text is at least 14px on every tab (%d examined)" % n, not bs, bs[:4])
    # the smallest declared sizes in the stylesheet too
    css = (ROOT / "ctab-panel.css").read_text(encoding="utf-8")
    sizes = [float(m) for m in re.findall(r"font(?:-size)?:\s*(?:[0-9]{3}\s+)?(\d+(?:\.\d+)?)px", css)]
    check("no font size under 14px is declared in the stylesheet", sizes and min(sizes) >= 14, sorted(set(sizes)))
    pg.ctx.close()
    pg = c.page(w=300, h=300)
    open_panel(pg)
    n2, bs2, bc2 = all_tabs_audit(pg, "300x300")
    check("every text is at least 14px in the 300x300 sheet (%d examined)" % n2, n2 >= 300 and not bs2, bs2[:4])
    pg.ctx.close()


def g_contrast(c):
    cases = [("light", None, None), ("dark", None, None), ("match white", ("#fdf3ec", "#1b2a2e"), None), ("match dark", ("#0b1f33", "#e8f0f7"), None),
             ("match mid grey", ("#808080", "#808080"), None), ("custom", None, ("#123456", "#123457"))]
    total = 0
    for name, chart, custom in cases:
        pg = c.page()
        open_panel(pg)
        if chart:
            pg.evaluate("(c) => demo.panel.applyAppearance(c[0], c[1])", list(chart))
            tab(pg, "_panel"); pg.click(".cp-chip[data-v=match]")
        elif custom:
            tab(pg, "_panel"); pg.click(".cp-chip[data-v=custom]")
            pg.fill("input.cp-hex[data-k=customBg]", custom[0]); pg.fill("input.cp-hex[data-k=customInk]", custom[1])
        else:
            tab(pg, "_panel"); pg.click(".cp-chip[data-v=%s]" % name)
        theme = pg.get_attribute(".cp-panel", "data-theme")
        check("theme '%s' is applied (data-theme)" % name, theme == name.split()[0], theme)
        n, bs, bc = all_tabs_audit(pg, name, minc=7.0)
        total += n
        check("theme %s: every text is 7:1 or better (%d examined)" % (name, n), n >= 400 and not bc, bc[:4])
        # the gear too, in this theme
        pg.click("[data-a=close]")
        g = pg.evaluate("""() => { const e = document.querySelector('.cp-gear'); const cs = getComputedStyle(e); const p = s => (s.match(/[\\d.]+/g) || []).map(Number).slice(0, 3);
          return { fg: p(cs.color), bg: p(cs.backgroundColor), border: p(cs.borderTopColor) }; }""")
        check("theme %s: the gear icon is at least 3:1 on its own disc" % name, contrast(g["fg"], g["bg"]) >= 3, g)
        check("0 console errors (%s)" % name, not pg.errs, pg.errs[:3])
        pg.ctx.close()
    check("examined thousands of text samples over six themes", total >= 2400, total)
    check("grayed-out rows were part of the 7:1 sweep (%d texts in disabled rows)" % OFFSEEN[0], OFFSEEN[0] >= 30, OFFSEEN[0])


def g_norange(c):
    pg = c.page()
    open_panel(pg)
    ranges = 0
    for t in audit(pg)["tabs"]:
        tab(pg, t)
        ranges += audit(pg)["ranges"]
    check("no input[type=range] on any tab", ranges == 0, ranges)
    check("no range input anywhere in the document", pg.evaluate("document.querySelectorAll('input[type=range]').length") == 0)
    tab(pg, "layout")
    check("number rows are typed inputs with step buttons", pg.evaluate("document.querySelectorAll('input[type=number]').length > 0 && document.querySelectorAll('.cp-step').length > 0"))
    src = (ROOT / "ctab-panel.js").read_text(encoding="utf-8")
    check("the library source never creates a range input", not re.search(r"""type\s*[=:]\s*['"]?range""", src))
    check("the library source never calls alert, confirm or prompt", not re.search(r"(^|[^.\w$])(alert|confirm|prompt)\s*\(", src))
    check("the library source never calls window.alert/confirm/prompt", not re.search(r"window\.(alert|confirm|prompt)\s*\(", src))
    for t in ("layout", "rings", "colors", "interaction"):
        tab(pg, t)
    pg.click("[data-a=resettab]")
    check("no dialog was raised during the whole session", not pg.dialogs and pg.evaluate("window.__dlg") == 0, (pg.dialogs, pg.evaluate("window.__dlg")))
    pg.ctx.close()


def g_sheet(c):
    for (w, h) in ((419, 500), (400, 700), (300, 300)):
        pg = c.page(w=w, h=h)
        open_panel(pg)
        f = pg.evaluate(RECT, "#frame"); r = pg.evaluate(RECT, ".cp-panel")
        check("%dx%d: the panel is a full-frame sheet" % (w, h), pg.evaluate("document.querySelector('.cp-panel').classList.contains('cp-sheet')") and abs(r["l"] - f["l"]) <= 1 and abs(r["t"] - f["t"]) <= 1 and abs(r["w"] - f["w"]) <= 1 and abs(r["h"] - f["h"]) <= 1, (r, f))
        x, y = head_point(pg)
        pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 60, y + 60, steps=4); pg.mouse.up()
        r2 = pg.evaluate(RECT, ".cp-panel")
        check("%dx%d: the sheet does not drag" % (w, h), abs(r2["l"] - r["l"]) < 1 and abs(r2["t"] - r["t"]) < 1)
        check("%dx%d: no horizontal scroll on the page or inside the sheet" % (w, h), pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1 && (() => { const m = document.querySelector('.cp-main'); return m.scrollWidth <= m.clientWidth + 1; })()"))
        pg.evaluate("(() => { const m = document.querySelector('.cp-main'); m.scrollTop = m.scrollHeight; })()")
        fr = pg.evaluate(RECT, ".cp-foot"); pr = pg.evaluate(RECT, ".cp-panel")
        check("%dx%d: scrolled to the end, the footer buttons are on screen" % (w, h), fr["b"] <= pr["b"] + 1 and fr["t"] >= pr["t"], (fr, pr))
        buttons_in = pg.evaluate("[...document.querySelectorAll('.cp-foot .cp-btn')].every(b => { const r = b.getBoundingClientRect(); return r.right <= %d + 1 && r.left >= -1; })" % w)
        check("%dx%d: footer buttons wrap inside the width" % (w, h), buttons_in)
        pg.click("[data-a=close]")
        check("%dx%d: close works and the gear returns" % (w, h), pg.evaluate("document.querySelector('.cp-panel').hidden") and pg.is_visible(".cp-gear"))
        pg.click(".cp-gear")
        pg.click("[data-a=min]")
        check("%dx%d: minimize works on a sheet (title bar only)" % (w, h), pg.evaluate(RECT, ".cp-panel")["h"] < 80)
        pg.ctx.close()
    pg = c.page(w=420, h=500)
    open_panel(pg)
    check("420px wide is still a floating panel", not pg.evaluate("document.querySelector('.cp-panel').classList.contains('cp-sheet')") and pg.evaluate(RECT, ".cp-panel")["w"] <= 405)
    pg.ctx.close()
    pg = c.page(w=1600, h=1000)
    open_panel(pg)
    r = pg.evaluate(RECT, ".cp-panel")
    check("1600x1000: floating, 400px wide, inside the frame, top right", r["w"] <= 401 and inside(r, pg.evaluate(RECT, "#frame")) and r["r"] > 1500)
    pg.ctx.close()


def g_sheet390(c):
    """At 390 wide every tab is reachable inside the tab row and the footer sits fully inside the panel and the viewport."""
    examined = 0
    for (w, h) in ((390, 700), (390, 844), (390, 560)):
        pg = c.page(w=w, h=h)
        open_panel(pg)
        pg.wait_for_function("document.querySelector('.cp-panel.cp-sheet') && document.fonts.status === 'loaded'", timeout=15000)
        pg.wait_for_timeout(250)  # settle, then measure
        vw, vh = pg.evaluate("[innerWidth, innerHeight]")
        pr = pg.evaluate(RECT, ".cp-panel"); fr = pg.evaluate(RECT, ".cp-foot")
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
        check("%dx%d: every tab is reachable in the tab row and 44px tall (%d tabs examined)" % (w, h, n), n >= 6 and not bad["bad"], bad)
        check("%dx%d: the page and the panel never scroll sideways" % (w, h), pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1 && (() => { const p = document.querySelector('.cp-panel'), r = document.querySelector('.cp-tabs'); return p.scrollWidth <= p.clientWidth + 1 && r.scrollWidth <= r.clientWidth + 1; })()"))
        last = pg.evaluate("[...document.querySelectorAll('.cp-tab')].pop().dataset.t")
        tab(pg, last)
        check("%dx%d: the last tab can be opened by a click" % (w, h), pg.evaluate("document.querySelector('.cp-tab[aria-selected=true]').dataset.t") == last)
        pg.ctx.close()
    check("390 wide: %d tab buttons examined in all (floor 18)" % examined, examined >= 18, examined)


def g_live(c):
    pg = c.page()
    open_panel(pg)
    r0 = pg.evaluate("demo.renders()")
    pg.evaluate("(() => { const b = document.querySelector('[data-a=inc][data-k=angle]'); for (let i = 0; i < 6; i++) b.click(); })()")
    pg.wait_for_function("document.querySelector('#chart').textContent.indexOf('\"angle\": 180') >= 0", timeout=5000)
    r1 = pg.evaluate("demo.renders()")
    check("six clicks in one frame redrew the chart at most twice (batched per frame)", 1 <= r1 - r0 <= 2, r1 - r0)
    check("the chart shows the final value", val(pg, "angle") == 180)
    pg.wait_for_function("demo.fake.saves >= 1", timeout=8000)
    pg.wait_for_timeout(500)
    check("the burst of changes made exactly one saveAsync (debounced)", pg.evaluate("demo.fake.saves") == 1, pg.evaluate("demo.fake.saves"))
    check("settings are written under the demo. prefix as strings", pg.evaluate("demo.fake.m['demo.angle']") == "180", pg.evaluate("demo.fake.m['demo.angle']"))
    pg.fill("input[data-k=angle]", "")
    pg.type("input[data-k=angle]", "45", delay=30)
    pg.wait_for_function("demo.store.get().angle === 45", timeout=5000)
    check("typing a number updates live without losing focus", pg.evaluate("document.activeElement.getAttribute('data-k')") == "angle")
    pg.fill("input[data-k=angle]", "99999"); pg.press("input[data-k=angle]", "Enter")
    check("an out-of-range typed value is clamped", val(pg, "angle") == 359 and pg.input_value("input[data-k=angle]") == "359", (val(pg, "angle"), pg.input_value("input[data-k=angle]")))
    pg.fill("input[data-k=angle]", ""); pg.press("input[data-k=angle]", "Enter")
    check("an empty number box falls back to the stored value and says so", pg.input_value("input[data-k=angle]") == "359" and "Type a number" in pg.inner_text(".cp-status"))
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_list(c):
    pg = c.page()
    open_panel(pg)
    names = lambda: pg.evaluate("[...document.querySelectorAll('.cp-row[data-row=axes] .cp-lname')].map(i => i.value)")
    check("the list shows one row per axis", names() == ["Alpha", "Beta", "Gamma"], names())
    pg.click("[data-a=down][data-k=axes][data-i='0']")
    check("down moves an item and the list redraws", names() == ["Beta", "Alpha", "Gamma"], names())
    pg.wait_for_function("(() => { const t = document.querySelector('#chart').textContent; return t.indexOf('Beta:Beta') >= 0 && t.indexOf('Beta:Beta') < t.indexOf('Alpha:Alpha'); })()", timeout=5000)
    check("the chart saw the new order", True)
    pg.click("[data-a=up][data-k=axes][data-i='2']")
    check("up moves an item", names() == ["Beta", "Gamma", "Alpha"], names())
    pg.click("[data-a=up][data-k=axes][data-i='0']")
    check("up on the first item does nothing", names() == ["Beta", "Gamma", "Alpha"])
    pg.fill(".cp-lname[data-i='0']", "Zed")
    pg.wait_for_function("document.querySelector('#chart').textContent.indexOf('Beta:Zed') >= 0", timeout=5000)
    check("renaming reaches the chart", True)
    pg.evaluate("(() => { const i = document.querySelector('.cp-lcol[data-i=\"1\"]'); i.value = '#ff0000'; i.dispatchEvent(new Event('input', { bubbles: true })); })()")
    check("recoloring is stored (hex string)", pg.evaluate("demo.store.get().axes.some(a => a.color === '#ff0000')"))
    pg.uncheck(".cp-lshow[data-i='2']")
    check("the show checkbox stores hidden", pg.evaluate("demo.store.get().axes.some(a => a.hidden === true)"))
    check("each list control has a descriptive accessible name", pg.get_attribute("[data-a=down][data-k=axes][data-i='0']", "aria-label").startswith("Move Zed down"))
    pg.click("[data-a=listreset][data-k=axes]")
    check("Reset names, colors and order restores the data order", names() == ["Alpha", "Beta", "Gamma"] and pg.evaluate("demo.store.get().axes.length") == 0, names())
    tab(pg, "colors")
    check("the Colors tab has the Data Divers palette selected by default", pg.get_attribute(".cp-pal[data-v=datadivers]", "aria-pressed") == "true")
    check("Data Divers plus six colorblind-safe palettes are offered", len(pg.query_selector_all(".cp-pal")) == 7 and pg.inner_text(".cp-pals").count("colorblind-safe") == 6)
    pg.click(".cp-pal[data-v=okabe]")
    check("picking a palette stores it", val(pg, "palette") == "okabe" and pg.get_attribute(".cp-pal[data-v=okabe]", "aria-pressed") == "true")
    check("per-category overrides list the categories", pg.evaluate("[...document.querySelectorAll('.cp-row[data-row=catColors] .cp-lname')].map(i => i.value)") == ["North", "South"])
    tab(pg, "fields")
    opts = pg.evaluate("[...document.querySelectorAll('select[data-k=fieldAxis] option')].map(o => o.textContent)")
    check("the Fields tab offers Auto (with the detected field) and every column", opts == ["Auto (Metric)", "Region", "Metric", "Value"], opts)
    nopts = pg.evaluate("[...document.querySelectorAll('select[data-k=fieldValue] option')].map(o => o.textContent)")
    check("a numeric field row offers only numeric columns", nopts == ["Auto (Value)", "Value"], nopts)
    pg.select_option("select[data-k=fieldAxis]", "Region")
    check("choosing a field stores it", val(pg, "fieldAxis") == "Region")
    tab(pg, "fonts")
    fonts = pg.evaluate("[...document.querySelectorAll('select[data-k=fontFamily] option')].map(o => o.textContent)")
    check("the font picker lists sans-serif families only (Poppins added)", len(fonts) == 8 and "Poppins" in fonts and not any(re.search(r"serif|mono|georgia|times|courier", f, re.I) for f in fonts), fonts)
    pg.ctx.close()


def g_color(c):
    pg = c.page()
    open_panel(pg)
    tab(pg, "rings")
    pg.fill("input.cp-hex[data-k=ringColor]", "#abcdef")
    check("a valid hex in the text box updates the setting and the picker", val(pg, "ringColor") == "#abcdef" and pg.input_value("input[type=color][data-k=ringColor]") == "#abcdef")
    pg.fill("input.cp-hex[data-k=ringColor]", "xyz"); pg.press("input.cp-hex[data-k=ringColor]", "Tab")
    check("an invalid hex shows an inline message and reverts", val(pg, "ringColor") == "#abcdef" and "hex digits" in pg.inner_text(".cp-status") and pg.input_value("input.cp-hex[data-k=ringColor]") == "#abcdef", pg.inner_text(".cp-status"))
    check("the message is styled as an error", "cp-err" in pg.get_attribute(".cp-status", "class"))
    tab(pg, "labels")
    check("an auto color starts empty (auto)", val(pg, "labelColor") == "" and pg.input_value("input.cp-hex[data-k=labelColor]") == "")
    pg.fill("input.cp-hex[data-k=labelColor]", "#112233")
    check("an auto color can be set", val(pg, "labelColor") == "#112233")
    pg.click("[data-a=auto][data-k=labelColor]")
    check("the Auto button clears it", val(pg, "labelColor") == "" and pg.input_value("input.cp-hex[data-k=labelColor]") == "")
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


# ------------------------------------------------------------------ 1.1.0 groups

def hexrgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def clip_text(pg):
    try:
        return pg.evaluate("navigator.clipboard.readText()").replace(chr(13) + chr(10), chr(10))
    except Exception as e:
        return "ERR " + str(e)[:80]


def g_diag(c):
    pg = c.page(perms=True)
    open_panel(pg)
    pg.evaluate("() => { setTimeout(() => { throw new Error('diag boom'); }, 0); Promise.reject(new Error('diag reject')); }")
    pg.wait_for_function("demo.P.errors().length >= 2", timeout=5000)
    pg.click("[data-a=inc][data-k=angle]")
    pg.wait_for_function("demo.store.draws().length >= 1", timeout=5000)
    pg.evaluate("demo.panel.trace({ marks: 42 })")
    tab(pg, "_panel")
    check("the hint warns that sample rows are included", "sample rows" in pg.inner_text(".cp-row[data-row=diag]"))
    pg.click("[data-a=diagshow]")
    rep = json.loads(pg.input_value("textarea[data-f=diagtext]"))
    check("report names the library, extension and its version", rep["library"] == "ctab-panel 1.1.0" and rep["extension"] == "Demo settings" and rep["extensionVersion"] == "demo", rep.get("library"))
    check("report has the view size and pixel ratio", rep["view"]["width"] == 900 and rep["view"]["pixelRatio"] >= 1, rep["view"])
    check("report has the browser", "Chrome" in rep["browser"], rep["browser"][:60])
    check("report has the data received: rows, field names and types", rep["data"]["rows"] == 6 and [f["name"] for f in rep["data"]["fields"]] == ["Region", "Metric", "Value"] and rep["data"]["fields"][2]["type"] == "float", rep["data"])
    check("report keeps at most 4 sample rows, native and formatted", len(rep["data"]["sample"]) == 4 and rep["data"]["sample"][0]["Value"] == {"value": 100, "formatted": "100.0"}, rep["data"]["sample"][:1])
    check("report has the automatic field picks", rep["automaticPicks"] == {"fieldAxis": "Metric", "fieldValue": "Value"}, rep["automaticPicks"])
    check("report has the last draws with their timing", len(rep["draws"]) >= 1 and "ms" in rep["draws"][-1] and "angle" in rep["draws"][-1]["keys"], rep["draws"])
    check("report has the traced mark count", rep["traces"][-1]["marks"] == 42 and rep["traces"][-1]["w"] == 900, rep["traces"])
    kinds = {(e["kind"], e["message"]) for e in rep["errors"]}
    check("report has recent errors: thrown and unhandled rejection", ("error", "diag boom") in kinds or any(k == "error" and "diag boom" in m for k, m in kinds), kinds)
    check("report has the unhandled rejection", ("unhandledrejection", "diag reject") in kinds, kinds)
    check("report has the current settings and panel state", rep["settings"]["angle"] == 105 and rep["panel"]["tab"] == "_panel", rep["panel"])
    pg.click("[data-a=diagcopy]")
    pg.wait_for_function("document.querySelector('.cp-status').textContent.indexOf('Copied the diagnostics') === 0", timeout=5000)
    cl = clip_text(pg)
    check("Copy diagnostics puts the report on the clipboard", cl.startswith("{") and json.loads(cl)["report"] == "C-Tableau diagnostics", cl[:60])
    pg.ctx.close()
    pg = c.page(perms=True, query="&blank=1")
    check("a blank screen offers Copy diagnostics", pg.is_visible("#blank .cp-diagbtn"))
    pg.click("#blank .cp-diagbtn")
    pg.wait_for_function("document.querySelector('#blank .cp-diagbtn').textContent === 'Copied diagnostics'", timeout=5000)
    cl = clip_text(pg)
    try:
        bl = json.loads(cl)
    except Exception:
        bl = {}
    check("the blank-screen report is the full one (settings and data)", bl.get("extension") == "Demo settings" and "angle" in bl.get("settings", {}) and bl.get("data", {}).get("rows") == 6, cl[:80])
    b = pg.evaluate("""() => { const e = document.querySelector('#blank .cp-diagbtn'), cs = getComputedStyle(e), p = s => (s.match(/[\\d.]+/g) || []).map(Number).slice(0, 3);
      return { fg: p(cs.color), bg: p(cs.backgroundColor), size: parseFloat(cs.fontSize), h: e.getBoundingClientRect().height }; }""")
    check("the blank-screen button is 14px or more at 7:1", b["size"] >= 14 and contrast(b["fg"], b["bg"]) >= 7, b)
    pg.ctx.close()


def g_machine(c):
    pg = c.page(h=800, query="&legacy=1")
    check("a 1.0.0 workbook panel state is present in the settings", pg.evaluate("demo.fake.get('demo._panel')") is not None)
    open_panel(pg)
    check("HYDRATE: the saved dark theme is carried over", pg.get_attribute(".cp-panel", "data-theme") == "dark", pg.get_attribute(".cp-panel", "data-theme"))
    st = pg.evaluate("[demo.panel.state.x, demo.panel.state.y, demo.panel.state.tab, demo.panel.state.docked]")
    check("HYDRATE: the saved position and tab are carried over", st == [30, 40, "rings", False], st)
    r = pg.evaluate(RECT, ".cp-panel"); f = pg.evaluate(RECT, "#frame")
    check("HYDRATE: the panel really sits at the saved spot", abs(r["l"] - f["l"] - 30) <= 1.5 and abs(r["t"] - f["t"] - 40) <= 1.5, (r, f))
    check("HYDRATE: now kept on this machine", '"theme":"dark"' in (pg.evaluate("localStorage.getItem('ctab:demo.panel')") or ""))
    check("HYDRATE: the workbook copy is left in place, never deleted", pg.evaluate("demo.fake.get('demo._panel')") is not None)
    check("HYDRATE: carrying it over did not save the workbook", pg.evaluate("demo.fake.saves") == 0)
    pg.ctx.close()
    pg = c.page(query="&nols=1")
    check("blocked storage: localStorage really throws on this page", pg.evaluate("(() => { try { localStorage.getItem('x'); return false; } catch (e) { return true; } })()"))
    open_panel(pg)
    x, y = head_point(pg)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 120, y + 60, steps=4); pg.mouse.up()
    tab(pg, "rings")
    check("blocked storage: panel habits fall back to memory for this visit", pg.evaluate("(() => { try { demo.store.panelState.set({ x: 5, tab: 'rings' }); return demo.store.panelState.get().x === 5; } catch (e) { return 'threw ' + e.message; } })()") is True)
    check("blocked storage: the panel still drags and switches tabs", pg.evaluate("demo.panel.state.docked") is False and pg.get_attribute(".cp-tab[data-t='rings']", "aria-selected") == "true")
    check("blocked storage: 0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def acc_state(pg):
    return pg.evaluate("[...document.querySelectorAll('.cp-acc')].map(b => [b.dataset.t, b.getAttribute('aria-expanded')])")


def g_pin(c):
    pg = c.page(w=1000, h=600, query="&persist=1")
    pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_function("window.demo")
    open_panel(pg)
    f = pg.evaluate(RECT, "#frame"); ch0 = pg.evaluate(RECT, "#chart")
    check("Pin to side is in the header", pg.evaluate("document.querySelector('.cp-head [data-a=pin]').getAttribute('aria-label')") == "Pin to side")
    pg.click("[data-a=pin]")
    pg.wait_for_function("document.querySelector('.cp-panel').classList.contains('cp-pinned')", timeout=5000)
    pg.wait_for_timeout(100)
    r = pg.evaluate(RECT, ".cp-panel"); ch1 = pg.evaluate(RECT, "#chart")
    check("pinned: a full-height strip on the right edge", abs(r["r"] - f["r"]) <= 1 and abs(r["t"] - f["t"]) <= 1 and abs(r["h"] - f["h"]) <= 1 and 355 <= r["w"] <= 361, (r, f))
    check("pinned: the chart reflows narrower and clears the strip", ch1["r"] <= r["l"] + 1 and ch1["w"] <= ch0["w"] - 355, (ch0, ch1, r))
    check("pinned: onLayout told the extension", pg.evaluate("demo.layouts.slice(-1)[0]") == {"reserveRight": 360, "pinned": True}, pg.evaluate("demo.layouts"))
    check("the pin button reports pressed and offers Float", pg.get_attribute("[data-a=pin]", "aria-pressed") == "true" and pg.get_attribute("[data-a=pin]", "aria-label") == "Float the panel")
    acc = acc_state(pg)
    check("pinned: the tabs become accordion headers with aria-expanded", len(acc) == 12 and not pg.is_visible(".cp-tabs") and dict(acc).get("layout") == "true", acc)
    pg.click(".cp-acc[data-t=rings]"); pg.click(".cp-acc[data-t=colors]")
    opened = [t for t, e in acc_state(pg) if e == "true"]
    check("several sections open at once", set(opened) >= {"layout", "rings", "colors"}, opened)
    check("each open section shows its rows", pg.query_selector(".cp-row[data-row=ringCount]") is not None and pg.query_selector(".cp-row[data-row=palette]") is not None and pg.query_selector(".cp-row[data-row=mode]") is not None)
    pg.click(".cp-acc[data-t=layout]")
    st2 = dict(acc_state(pg))
    check("a section collapses on its own, the others stay open", st2["layout"] == "false" and st2["rings"] == "true" and st2["colors"] == "true" and pg.query_selector(".cp-row[data-row=mode]") is None, st2)
    hs = pg.evaluate("[...document.querySelectorAll('.cp-acc')].map(b => b.getBoundingClientRect().height)")
    check("accordion headers are 44px targets", min(hs) >= 43.5, min(hs))
    pg.click("[data-a=inc][data-k=ringCount]")
    check("a setting changes from inside the accordion", val(pg, "ringCount") == 5)
    x, y = head_point(pg)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 200, y + 80, steps=4); pg.mouse.up()
    r2 = pg.evaluate(RECT, ".cp-panel")
    check("a pinned panel does not drag", abs(r2["l"] - r["l"]) < 1 and abs(r2["t"] - r["t"]) < 1, (r, r2))
    pg.wait_for_timeout(150)
    pg.reload(); pg.wait_for_function("window.demo")
    open_panel(pg)
    pg.wait_for_function("document.querySelector('.cp-panel').classList.contains('cp-pinned')", timeout=5000)
    st3 = dict(acc_state(pg))
    check("pinned state and the open sections are remembered on this machine", st3.get("rings") == "true" and st3.get("colors") == "true" and st3.get("layout") == "false", st3)
    pg.click("[data-a=close]")
    ch2 = pg.evaluate(RECT, "#chart")
    check("closing a pinned panel gives the chart its full width back", abs(ch2["w"] - ch0["w"]) <= 1 and pg.evaluate("demo.layouts.slice(-1)[0].reserveRight") == 0, (ch0, ch2))
    open_panel(pg)
    pg.click("[data-a=pin]")
    pg.wait_for_function("!document.querySelector('.cp-panel').classList.contains('cp-pinned')", timeout=5000)
    ch3 = pg.evaluate(RECT, "#chart"); r3 = pg.evaluate(RECT, ".cp-panel")
    check("Float makes it a floating panel again and the chart full width", abs(ch3["w"] - ch0["w"]) <= 1 and r3["w"] <= 401 and pg.is_visible(".cp-tabs"), (ch3, r3))
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()
    for (w, h) in ((700, 500), (1000, 400)):
        pg = c.page(w=w, h=h)
        open_panel(pg)
        check("%dx%d: Pin is unavailable, aria-disabled with the reason in its title" % (w, h), pg.get_attribute("[data-a=pin]", "aria-disabled") == "true" and "760 by 420" in (pg.get_attribute("[data-a=pin]", "title") or ""), pg.get_attribute("[data-a=pin]", "title"))
        pg.click("[data-a=pin]", force=True)  # aria-disabled is still clickable for a person; Playwright would wait
        check("%dx%d: clicking it says why and does not pin" % (w, h), "needs a view at least 760 by 420" in pg.inner_text(".cp-status") and not pg.evaluate("document.querySelector('.cp-panel').classList.contains('cp-pinned')"))
        pg.ctx.close()
    pg = c.page(w=390, h=700)
    open_panel(pg)
    check("390 sheet: the Dock and Pin buttons step aside", not pg.is_visible("[data-a=pin]") and not pg.is_visible("[data-a=dock]"))
    pg.ctx.close()


def g_dock(c):
    pg = c.page(w=1000, h=640)
    open_panel(pg)
    f = pg.evaluate(RECT, "#frame")
    d = pg.evaluate(RECT, ".cp-head [data-a=dock]")
    check("a 36px Dock button sits in the header", d is not None and abs(d["w"] - 36) <= 1 and abs(d["h"] - 36) <= 1 and pg.get_attribute("[data-a=dock]", "aria-label") == "Dock the panel top right", d)
    x, y = head_point(pg)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 300, y + 120, steps=5); pg.mouse.up()
    r1 = pg.evaluate(RECT, ".cp-panel")
    check("dragged away from the corner", r1["r"] < f["r"] - 200, r1)
    pg.click("[data-a=dock]")
    r2 = pg.evaluate(RECT, ".cp-panel")
    corner = lambda r: abs(r["r"] - (f["r"] - 8)) <= 1.5 and abs(r["t"] - (f["t"] + 8)) <= 1.5
    check("Dock returns it to the top right", corner(r2), (r2, f))
    x, y = head_point(pg)
    pg.mouse.dblclick(x, y)
    r3 = pg.evaluate(RECT, ".cp-panel")
    check("double-click on a docked title bar puts it back where it was", abs(r3["l"] - r1["l"]) <= 1.5 and abs(r3["t"] - r1["t"]) <= 1.5, (r1, r3))
    x, y = head_point(pg)
    pg.mouse.dblclick(x, y)
    check("double-click again docks it (a toggle)", corner(pg.evaluate(RECT, ".cp-panel")))
    pg.evaluate("demo.frame.style.width = '900px'")
    pg.wait_for_function("(() => { const p = document.querySelector('.cp-panel').getBoundingClientRect(), f = document.querySelector('#frame').getBoundingClientRect(); return Math.abs(p.right - (f.right - 8)) <= 1.5; })()", timeout=5000)
    check("a docked panel follows the corner when the frame resizes", True)
    pg.evaluate("demo.frame.style.width = '1000px'")
    pg.wait_for_timeout(100)
    pg.click("[data-a=pin]")
    pg.wait_for_function("document.querySelector('.cp-panel').classList.contains('cp-pinned')", timeout=5000)
    x, y = head_point(pg)
    pg.mouse.dblclick(x, y)
    check("double-click on a pinned title bar floats it", not pg.evaluate("document.querySelector('.cp-panel').classList.contains('cp-pinned')"))
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_revert(c):
    pg = c.page()
    open_panel(pg)
    pg.click("[data-a=inc][data-k=angle]"); pg.click(".cp-chip[data-v=multi]")
    tab(pg, "rings"); pg.click("[data-a=inc][data-k=ringCount]")
    pg.click("[data-a=close]"); open_panel(pg)
    pg.click("[data-a=revert]")
    check("Revert restores the settings from when the panel was first opened", (val(pg, "angle"), val(pg, "mode"), val(pg, "ringCount")) == (90, "overlay", 4), (val(pg, "angle"), val(pg, "mode"), val(pg, "ringCount")))
    stt = pg.inner_text(".cp-status")
    check("it says how many and that Undo brings them back", "3 settings" in stt and "Undo" in stt, stt)
    pg.click("[data-a=undo]")
    check("Revert is one undo step", (val(pg, "angle"), val(pg, "mode"), val(pg, "ringCount")) == (105, "multi", 5))
    pg.click("[data-a=revert]"); pg.click("[data-a=revert]")
    check("a second Revert says nothing has changed", "Nothing has changed" in pg.inner_text(".cp-status"), pg.inner_text(".cp-status"))
    pg.wait_for_function("demo.fake.saves >= 1", timeout=5000)
    check("save-as-you-go stays: the revert reached the workbook", pg.evaluate("demo.fake.m['demo.angle']") == "90", pg.evaluate("demo.fake.m['demo.angle']"))
    pg.ctx.close()


def g_savestatus(c):
    pg = c.page()
    open_panel(pg)
    check("before any change the line says changes save as you go", "save to the workbook as you go" in pg.inner_text(".cp-save"), pg.inner_text(".cp-save"))
    check("the save line is a polite status region", pg.get_attribute(".cp-save", "role") == "status" and pg.get_attribute(".cp-save", "aria-live") == "polite")
    pg.click("[data-a=inc][data-k=angle]")
    pg.wait_for_function("document.querySelector('.cp-save').dataset.state === 'saved'", timeout=5000)
    check("after a change: Saved to the workbook", pg.inner_text(".cp-save") == "Saved to the workbook.", pg.inner_text(".cp-save"))
    pg.ctx.close()
    pg = c.page(query="&nosave=1")
    open_panel(pg)
    pg.click("[data-a=inc][data-k=angle]")
    pg.wait_for_function("document.querySelector('.cp-save').dataset.state === 'failed'", timeout=5000)
    t = pg.inner_text(".cp-save")
    check("a view that cannot save says so plainly", t == "These changes last for this visit only: this view cannot save to the workbook." and "cp-err" in pg.get_attribute(".cp-save", "class"), t)
    w = [x for x in audit(pg)["texts"] if x["text"].startswith("These changes")]
    check("the warning reads at 7:1", w and contrast(w[0]["fg"], w[0]["bg"]) >= 7, w[:1])
    check("the change still applies for this visit", val(pg, "angle") == 105)
    pg.ctx.close()


def g_copyfmt(c):
    pg = c.page(perms=True)
    open_panel(pg)
    pg.click("[data-a=inc][data-k=angle]")
    tab(pg, "fields"); pg.select_option("select[data-k=fieldAxis]", "Region")
    pg.click("[data-a=copy][data-kind=formatting]")
    pg.wait_for_function("document.querySelector('.cp-status').textContent.indexOf('Copied the formatting') === 0", timeout=5000)
    blk = json.loads(pg.evaluate("demo.panel.lastCopied"))
    check("Copy formatting makes a labeled block", blk["ctab"] == 1 and blk["chart"] == "demo." and blk["name"] == "Demo settings" and blk["kind"] == "formatting" and re.match(r"\d{4}-\d\d-\d\dT", blk["copied"]), {k: blk[k] for k in blk if k != "settings"})
    sv = blk["settings"]
    check("Copy formatting leaves out field picks and per-item lists", "fieldAxis" not in sv and "axes" not in sv and "catColors" not in sv and sv.get("palette") == "datadivers" and sv.get("angle") == 105, sorted(sv)[:8])
    check("the clipboard holds that block", clip_text(pg) == pg.evaluate("demo.panel.lastCopied"))
    pg.click("[data-a=copy][data-kind=everything]")
    pg.wait_for_function("document.querySelector('.cp-status').textContent.indexOf('Copied every setting') === 0", timeout=5000)
    blk2 = json.loads(pg.evaluate("demo.panel.lastCopied"))
    check("Copy everything keeps the field picks and lists", blk2["kind"] == "everything" and blk2["settings"]["fieldAxis"] == "Region" and isinstance(blk2["settings"]["axes"], list))
    check("the copy is also kept on this machine", pg.evaluate("localStorage.getItem('ctab:lastcopy')") == pg.evaluate("demo.panel.lastCopied"))
    pg.select_option("select[data-k=fieldAxis]", ""); tab(pg, "layout"); pg.click("[data-a=dec][data-k=angle]")
    pg.click("[data-a=paste]")
    meta = pg.inner_text(".cp-foot")
    check("the paste box offers the last copy on this machine, with where it came from", pg.is_visible("[data-a=pastelast]") and "Demo settings, everything" in meta, meta[-120:])
    pg.click("[data-a=pastelast]")
    stt = pg.inner_text(".cp-status")
    check("Use the last copy applies it and reports its source", val(pg, "fieldAxis") == "Region" and val(pg, "angle") == 105 and stt.startswith("From Demo settings (everything, copied "), stt)
    radar = {"ctab": 1, "chart": "radar.", "name": "Radar settings", "kind": "everything", "copied": "2026-11-24T21:00:00Z",
             "settings": {"labelSize": 20, "palette": "okabe", "angle": 10, "fieldAxis": "Metric", "spokes": 3}}
    pg.click("[data-a=paste]"); pg.fill("textarea[data-f=paste]", json.dumps(radar)); pg.click("[data-a=pasteapply]")
    stt = pg.inner_text(".cp-status")
    check("from another chart type only the shared looks move over", val(pg, "labelSize") == 20 and val(pg, "palette") == "okabe" and val(pg, "angle") == 105 and val(pg, "fieldAxis") == "Region",
          (val(pg, "labelSize"), val(pg, "palette"), val(pg, "angle"), val(pg, "fieldAxis")))
    check("and the message says where it came from and what it skipped", "From Radar settings (everything, copied 11/24/2026" in stt and "applied 2 shared settings" in stt and "Skipped 3 only that chart has" in stt, stt)
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_fonts(c):
    pg = c.page()
    open_panel(pg)
    res = pg.evaluate("""async () => { await Promise.all(['400 14px Poppins', '700 14px Poppins', '600 14px Poppins', '14px Inter'].map(f => document.fonts.load(f)));
      await document.fonts.ready; return [...document.fonts].map(f => [f.family.replace(/"/g, ''), String(f.weight), f.status]); }""")
    loaded = [(fam, w) for fam, w, st in res if st == "loaded"]
    check("Inter loads from the bundled file", any(fam == "Inter" for fam, w in loaded), res)
    check("Poppins 400, 600 and 700 load from the bundled files", all(("Poppins", w) in loaded for w in ("400", "600", "700")), res)
    check("no bundled font failed to load", not [x for x in res if x[2] == "error"], res)
    fonts = sorted(x.name for x in (ROOT / "fonts").iterdir())
    check("the font folder holds both OFL licenses and five woff2 files", "LICENSE-Inter-OFL.txt" in fonts and "LICENSE-Poppins-OFL.txt" in fonts and len([x for x in fonts if x.endswith(".woff2")]) == 5, fonts)
    check("every woff2 file really is WOFF2", all((ROOT / "fonts" / x).read_bytes()[:4] == b"wOF2" for x in fonts if x.endswith(".woff2")))
    check("both licenses are the SIL Open Font License", all("SIL OPEN FONT LICENSE" in (ROOT / "fonts" / x).read_text(encoding="utf-8", errors="replace").upper() for x in fonts if x.startswith("LICENSE")))
    tab(pg, "fonts")
    opts = pg.evaluate("[...document.querySelectorAll('select[data-k=fontFamily] option')].map(o => o.textContent)")
    check("Poppins is a font choice", "Poppins" in opts, opts)
    pg.select_option("select[data-k=fontFamily]", "poppins")
    check("choosing it stores poppins", val(pg, "fontFamily") == "poppins")
    check("the panel itself renders in Inter", pg.evaluate("getComputedStyle(document.querySelector('.cp-panel')).fontFamily").startswith("Inter"))
    pg.ctx.close()


def g_textsize(c):
    pg = c.page()
    open_panel(pg)
    tab(pg, "fonts")
    sz = pg.evaluate("[...document.querySelectorAll('.cp-chip[data-k=textScale]')].map(b => parseFloat(getComputedStyle(b).fontSize))")
    check("Text size is stepped buttons that preview their own size", sz == [14, 16, 18, 20], sz)
    check("no slider anywhere", pg.evaluate("document.querySelectorAll('input[type=range]').length") == 0)
    pg.click('.cp-chip[data-k=textScale][data-v="1.3"]')
    pg.wait_for_function("document.querySelector('#chart').textContent.indexOf('\"labelSize\": 18') >= 0", timeout=5000)
    check("at 130% the chart gets 18px labels while 14 stays stored", pg.evaluate("[demo.store.get().labelSize, demo.store.raw().labelSize, demo.store.get().titleSize]") == [18, 14, 23])
    check("the steppers still show what was typed", pg.input_value("input[data-k=titleSize]") == "18")
    tab(pg, "_panel")
    pg.click('.cp-chip[data-k=uiScale][data-v="1.3"]')
    fs = pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.cp-row .cp-lab, .cp-row .cp-help')).fontSize)")
    check("Panel text size scales the panel text (130% is 18.2px)", abs(fs - 18.2) < 0.25, fs)
    small = [x for x in audit(pg)["texts"] if x["size"] < 14 - 0.01]
    check("nothing in the scaled panel is under 14px", not small, small[:3])
    pg.ctx.close()


def g_titles(c):
    pg = c.page()
    open_panel(pg)
    tab(pg, "fonts")
    check("the title box shows a placeholder example", "{top}" in (pg.get_attribute("input[data-k=titleText]", "placeholder") or ""))
    pg.check("input[data-k=showTitle]")
    pg.fill("input[data-k=titleText]", "Top {top} of {n} ({total}) {nope}")
    pg.wait_for_function("document.querySelector('#chart').textContent.indexOf('Top Alpha of 6 (1,250) {nope}') >= 0", timeout=5000)
    check("placeholders fill from the chart, unknown ones stay as typed", True)
    check("the box keeps what was typed", pg.input_value("input[data-k=titleText]") == "Top {top} of {n} ({total}) {nope}")
    check("the help lists the placeholders this chart offers", "This chart offers {n}, {top}, {total}." in pg.inner_text(".cp-row[data-row=titleText]"), pg.inner_text(".cp-row[data-row=titleText]"))
    pg.ctx.close()


def g_options(c):
    pg = c.page()
    open_panel(pg)
    tab(pg, "numbers")
    labs = pg.evaluate("[...document.querySelectorAll('.cp-chip[data-k=numThousands]')].map(b => b.textContent)")
    check("thousands chips show their result", labs == ["1,234,567", "1 234 567", "1234567"], labs)
    pv = lambda: pg.inner_text("[data-preview=numPreview]")
    check("a live line shows the format", pv() == "Shows as 12,345.6 and -0.5", pv())
    pg.click("[data-a=inc][data-k=numDecimals]")
    pg.wait_for_function("document.querySelector('[data-preview=numPreview]').textContent.indexOf('12,345.60') >= 0", timeout=3000)
    check("it follows the decimals", True)
    pg.click(".cp-chip[data-k=numThousands][data-v=space]")
    check("it follows the separator", "12 345.60" in pv(), pv())
    pg.fill("input[data-k=numPrefix]", "$")
    check("it follows typed text at once", pv() == "Shows as $12 345.60 and -$0.50", pv())
    tab(pg, "labels")
    wts = pg.evaluate("[...document.querySelectorAll('.cp-chip[data-k=labelWeight]')].map(b => getComputedStyle(b).fontWeight)")
    check("weight chips are drawn in their own weight", wts == ["400", "700"], wts)
    pg.ctx.close()


def g_darkpal(c):
    pg = c.page()
    open_panel(pg)
    tab(pg, "colors")
    orig = pg.evaluate("demo.P.PALETTES[0].colors")
    r0 = pg.evaluate("demo.renders()")
    pg.evaluate("demo.panel.applyAppearance('#0b1f33', '#e8f0f7')")
    pg.wait_for_function("demo.renders() > %d" % r0, timeout=5000)
    check("a chart turning dark redraws once with the dark palette", True)
    bad = []
    for p in pg.evaluate("demo.P.PALETTES.map(p => p.id)"):
        for col in pg.evaluate("(id) => demo.P.paletteColors(id)", p):
            if contrast(hexrgb(col), hexrgb("#0b1f33")) < 3:
                bad.append((p, col))
    check("every palette color reaches 3:1 on the dark chart", not bad, bad[:4])
    check("the palette buttons show the dark variant", "dark variant" in pg.inner_text(".cp-pals"))
    strip = pg.evaluate("getComputedStyle(document.querySelectorAll('.cp-pal')[0].querySelectorAll('i')[1]).backgroundColor")
    dv = pg.evaluate("demo.P.paletteColors('datadivers')[1]")
    check("the swatch strip draws the dark colors", strip == "rgb(%d, %d, %d)" % tuple(hexrgb(dv)), (strip, dv))
    pg.evaluate("demo.panel.applyAppearance('#ffffff', '#14202e')")
    check("back on white the palette is the original", pg.evaluate("demo.P.paletteColors('datadivers')") == orig)
    pg.ctx.close()


def g_action(c):
    pg = c.page()
    open_panel(pg)
    tab(pg, "fonts")
    pg.click("[data-a=action][data-k=setupMeeting]")
    got = [val(pg, k) for k in ("textScale", "labelWeight", "titleWeight", "labelsOn")]
    check("one click sets several settings", got == ["1.3", "bold", "bold", True], got)
    check("it reports in the status line", pg.inner_text(".cp-status").startswith('Applied "Set up for a meeting room": 2 settings changed'), pg.inner_text(".cp-status"))
    pg.click("[data-a=undo]")
    check("Undo takes the whole setup back in one step", [val(pg, k) for k in ("textScale", "labelWeight")] == ["1", "normal"])
    pg.ctx.close()


def g_frames(c):
    """Smoothness: rAF frame times while dragging, pinning, floating and docking. Hidden tabs freeze rAF, so check visibility first."""
    pg = c.page(w=1000, h=640)
    open_panel(pg)
    check("the page is visible (rAF runs)", pg.evaluate("document.visibilityState") == "visible")
    pg.evaluate("window.__ft = []; (function loop(t) { window.__ft.push(t); if (window.__ft.length < 260) requestAnimationFrame(loop); })(performance.now())")
    x, y = head_point(pg)
    pg.mouse.move(x, y); pg.mouse.down()
    for i in range(40):
        pg.mouse.move(x - i * 6, y + i * 3)
    pg.mouse.up()
    pg.click("[data-a=pin]"); pg.click("[data-a=pin]"); pg.click("[data-a=dock]")
    pg.wait_for_function("window.__ft.length >= 260", timeout=20000)
    ft = pg.evaluate("window.__ft")
    d = sorted(ft[i + 1] - ft[i] for i in range(len(ft) - 1))
    med, p95, mx = d[len(d) // 2], d[int(len(d) * 0.95)], d[-1]
    check("frames n=%d median %.1f p95 %.1f max %.1f ms: median at 60 fps and p95 under 34 ms" % (len(d), med, p95, mx), len(d) >= 200 and med <= 20 and p95 <= 34, (med, p95, mx))
    pg.ctx.close()


GROUPS = {n: globals()["g_" + n] for n in ALL}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--shots", default="")
    a = ap.parse_args()
    chosen = [g for g in a.only.split(",") if g] or ALL
    for g in chosen:
        if g not in GROUPS:
            print("unknown group", g); sys.exit(2)
    srv = serve()
    port = srv.server_address[1]
    with sync_playwright() as p:
        b = p.chromium.launch()
        c = Ctx(b, port)
        for g in chosen:
            cur[0] = g
            counts.setdefault(g, 0)
            try:
                GROUPS[g](c)
            except Exception as e:
                fails.append("[%s] group crashed: %s" % (g, str(e).splitlines()[0][:200]))
            print("  group %-12s %3d checks" % (g, counts[g]))
        if a.shots:
            out = pathlib.Path(a.shots); out.mkdir(parents=True, exist_ok=True)
            for name, query, size in (("light", "&open=1", (900, 640)), ("sheet", "&open=1", (300, 300))):
                pg = c.page(w=size[0], h=size[1], query=query)
                pg.wait_for_timeout(300); pg.screenshot(path=str(out / ("panel-%s.png" % name)))
                if name == "light":
                    tab(pg, "labels"); pg.uncheck("input[data-k=labelsOn]"); pg.wait_for_timeout(200)
                    pg.screenshot(path=str(out / "panel-grayed-rows.png"))
                    tab(pg, "_panel"); pg.click(".cp-chip[data-v=dark]"); pg.click(".cp-tab[data-t='colors']"); pg.wait_for_timeout(200)
                    pg.screenshot(path=str(out / "panel-dark-colors.png"))
                pg.ctx.close()
            pg = c.page(w=1280, h=800, query="&open=1")
            pg.click("[data-a=pin]"); pg.click(".cp-acc[data-t=rings]"); pg.wait_for_timeout(300)
            pg.screenshot(path=str(out / "panel-pinned-1280.png"))
            pg.ctx.close()
            for name, query, size in (("diag", "&open=1", (900, 640)),):
                pg = c.page(w=size[0], h=size[1], query=query)
                tab(pg, "_panel"); pg.click("[data-a=diagshow]"); pg.wait_for_timeout(200)
                pg.screenshot(path=str(out / "panel-diagnostics.png"))
                pg.ctx.close()
        b.close()
    srv.shutdown()
    total = sum(counts[g] for g in chosen)
    print("examined %d checks in %d groups" % (total, len(chosen)))
    empty = [g for g in chosen if counts.get(g, 0) == 0]
    for g in empty:
        fails.append("[%s] group ran 0 checks" % g)
    if len(chosen) == len(ALL) and total < MIN_CHECKS:
        fails.append("examined only %d checks, floor %d" % (total, MIN_CHECKS))
    if fails:
        print("RED  %d failed" % len(fails))
        for f in fails:
            print("  - " + f)
        sys.exit(1)
    print("GREEN  %d checks in %d groups (floor %d)" % (total, len(chosen), MIN_CHECKS))


main()
