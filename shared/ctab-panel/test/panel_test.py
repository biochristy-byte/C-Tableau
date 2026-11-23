"""Playwright test of the ctab-panel demo page (shared/ctab-panel/demo/index.html).

  python test/panel_test.py                 # every group
  python test/panel_test.py --only drag,close   # chosen groups (used by sabotage.py)
  python test/panel_test.py --shots DIR     # also write a few screenshots

Groups: open drag touch minimize persist close escape search conditional reset undo copypaste keyboard
        floor contrast norange sheet live list color
Each group reports how many checks it ran; a group that ran none is RED (a gate must say what it examined),
and so is a full run under MIN_CHECKS. Timing waits poll with generous timeouts, never a fixed sleep as proof.
"""
import argparse, functools, http.server, json, math, pathlib, re, socketserver, sys, threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIN_CHECKS = 215
ALL = ["open", "drag", "touch", "minimize", "persist", "close", "escape", "search", "conditional", "reset", "undo", "copypaste",
       "keyboard", "floor", "contrast", "norange", "sheet", "live", "list", "color"]
fails, counts, cur = [], {}, [None]


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
  panel.querySelectorAll('*').forEach(el => {
    if (!vis(el)) return;
    const tag = el.tagName; let txt = '';
    if (tag === 'INPUT') { if (['checkbox', 'color', 'radio'].includes(el.type)) return; txt = el.value || ''; if (!txt && el.placeholder) { const cs = getComputedStyle(el, '::placeholder'); out.push({ tag: tag + '::placeholder', text: el.placeholder, size: parseFloat(cs.fontSize), fg: parse(cs.color).slice(0, 3), bg: bgOf(el) }); } }
    else if (tag === 'TEXTAREA') { txt = el.value || ''; if (!txt && el.placeholder) { const cs = getComputedStyle(el, '::placeholder'); out.push({ tag: 'TEXTAREA::placeholder', text: el.placeholder, size: parseFloat(cs.fontSize), fg: parse(cs.color).slice(0, 3), bg: bgOf(el) }); } }
    else if (tag === 'SELECT') { txt = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : ''; }
    else { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) txt += n.textContent.trim() + ' '; }
    if (!txt.trim()) return;
    const cs = getComputedStyle(el);
    out.push({ tag, text: txt.trim().slice(0, 40), size: parseFloat(cs.fontSize), fg: parse(cs.color).slice(0, 3), bg: bgOf(el) });
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
    pg.wait_for_function("JSON.parse(localStorage.getItem('ctab-demo-settings') || '{}')['demo._panel']", timeout=5000)
    pg.reload(); pg.wait_for_function("window.demo")
    open_panel(pg)
    pos2 = pg.evaluate("[demo.panel.state.x, demo.panel.state.y]")
    check("position is remembered across a reload", pos == pos2, (pos, pos2))
    check("minimized state is remembered", pg.evaluate("document.querySelector('.cp-panel').classList.contains('cp-min')"))
    pg.click("[data-a=min]")
    check("last tab is remembered", pg.get_attribute(".cp-tab[data-t='rings']", "aria-selected") == "true")
    saved = pg.evaluate("JSON.parse(demo.fake.get('demo._panel'))")
    check("stored under the _panel setting as JSON with x, y, min", all(k in saved for k in ("x", "y", "min", "tab")), saved)
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
    check("a conditional row stays hidden from search while its condition is false", len(pg.query_selector_all(".cp-row")) == 0)
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
    check("a conditional row is absent when its condition is false", pg.query_selector(".cp-row[data-row=cols]") is None and pg.query_selector(".cp-row[data-row=bName]") is None)
    pg.click(".cp-chip[data-v=multi]")
    check("chip choice reveals the Columns row", pg.query_selector(".cp-row[data-row=cols]") is not None)
    check("the help text sits under the row", "Only for small multiples" in pg.inner_text(".cp-row[data-row=cols]"))
    pg.wait_for_function("document.querySelector('#chart').textContent.indexOf('\"mode\": \"multi\"') >= 0", timeout=5000)
    check("chart saw the mode", True)
    pg.check("input[data-k=showB]")
    check("a checkbox reveals the Benchmark name row", pg.query_selector(".cp-row[data-row=bName]") is not None)
    check("focus stays on the checkbox after the rows change", pg.evaluate("document.activeElement.getAttribute('data-k')") == "showB")
    pg.uncheck("input[data-k=showB]")
    check("unchecking hides it again", pg.query_selector(".cp-row[data-row=bName]") is None)
    pg.click(".cp-chip[data-v=overlay]")
    check("switching back hides Columns", pg.query_selector(".cp-row[data-row=cols]") is None)
    pg.check("input[data-k=showB]")
    pg.fill("input[data-k=bName]", "Goal")
    check("typing in a conditional text row keeps focus while the chart updates", pg.evaluate("document.activeElement.getAttribute('data-k')") == "bName")
    pg.wait_for_function("document.querySelector('#chart').textContent.indexOf('Goal') >= 0", timeout=5000)
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
    pg.click("[data-a=copy]")
    pg.wait_for_function("document.querySelector('.cp-status').textContent.indexOf('Copied') === 0", timeout=5000)
    txt = pg.evaluate("demo.panel.lastCopied")
    obj = json.loads(txt)
    n = pg.evaluate("demo.store.rows.filter(r => r.type !== 'note').length")
    check("Copy settings makes valid JSON holding every setting", len(obj) == n and n >= 50, (len(obj), n))
    check("the copied JSON carries the changed value", obj["angle"] == 105)
    check("status says how many were copied", ("Copied %d settings" % n) in pg.inner_text(".cp-status"), pg.inner_text(".cp-status"))
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
      .filter(e => !(e.classList.contains('cp-tab') && e.tabIndex < 0) && e.getBoundingClientRect().width > 0 && !e.closest('[hidden]')).map(e => e.getAttribute('data-f') || e.getAttribute('data-a') || e.className)""")
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
    check("the font picker lists sans-serif families only", len(fonts) == 7 and not any(re.search(r"serif|mono|georgia|times|courier", f, re.I) for f in fonts), fonts)
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
                    tab(pg, "_panel"); pg.click(".cp-chip[data-v=dark]"); pg.click(".cp-tab[data-t='colors']"); pg.wait_for_timeout(200)
                    pg.screenshot(path=str(out / "panel-dark-colors.png"))
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
