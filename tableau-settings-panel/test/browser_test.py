"""Browser gate for the Settings Panel dashboard extension, in Chromium against the mock Dashboard Extensions API.

  python test/browser_test.py [--only group,group] [--shots DIR]

Groups (each prints what it examined and has a floor; below the floor is RED, never a silent pass):
  render    the gear, the collapsed zone, open, zone grows, 5 tabs with counts, 0 console errors, no request leaves the page's own server
  params    every parameter control changes the mock workbook (chips, dropdown, toggle, steppers, typed numbers, dates, text)
  filters   every editable filter control changes every worksheet that carries it (keep, exclude, all, none, find, range, dates, relative dates)
  highlight values highlight marks, the field can change, "every sheet" spreads it, Clear clears
  presets   save, apply, rename, delete with an inline confirm, and presets reload from the saved workbook settings
  reset     reset to workbook defaults with an inline confirm puts every changed parameter and filter back
  search    one box finds parameters, filters, sheets and presets across tabs
  keyboard  Enter opens, arrow keys switch tabs and step numbers, Escape closes and focus returns to the gear, title bar moves
  floor     every panel text is 14px or more on every tab, light, dark and custom themes (every list expanded)
  contrast  every panel text is 7:1 on its own background, light, dark and custom
  overlap   no two visible texts in the panel overlap, on every tab, at 1280 and at 390
  sheet390  at 390 wide the panel is a full-frame sheet: every tab reachable and 44px tall, footer inside, nothing scrolls sideways
  frames    rAF frame gaps while opening, switching tabs, searching, scrolling a long list and stepping: median, p95, max
  rules     no range input, no browser dialog, no em dash in any rendered text
"""
import functools, http.server, json, pathlib, socketserver, statistics, sys, threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
GROUPS = ["render", "params", "filters", "highlight", "presets", "reset", "search", "keyboard", "floor", "contrast", "overlap", "sheet390", "frames", "rules"]
ONLY = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else GROUPS
SHOTS = pathlib.Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None
EM = chr(0x2014)
RESULTS = {"pass": 0, "fail": 0}
RECT = "(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return {l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height}; }"
TABS = ["params", "filters", "highlight", "presets", "panel"]


def check(name, ok, detail=None):
    if ok:
        RESULTS["pass"] += 1
        print("ok   " + name)
    else:
        RESULTS["fail"] += 1
        print("FAIL " + name + ("  " + str(detail)[:300] if detail is not None else ""))
    return ok


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass


srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
PORT = srv.server_address[1]
ORIGIN = "http://127.0.0.1:%d/" % PORT


def lum(c):
    def ch(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def contrast(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


AUDIT = """() => {
  const panel = document.querySelector('.sp-panel');
  const parse = s => { const m = (s || '').match(/[\\d.]+/g) || []; return m.map(Number); };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const m = parse(getComputedStyle(e).backgroundColor);
    if (m.length >= 3 && (m.length < 4 || m[3] === 1)) return m.slice(0, 3); } return [255, 255, 255]; };
  const out = [];
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  panel.querySelectorAll('*').forEach(el => {
    if (!vis(el)) return;
    const tag = el.tagName; let txt = '';
    if (tag === 'INPUT') { if (['checkbox', 'color', 'radio'].includes(el.type)) return; txt = el.value || ''; if (!txt && el.placeholder) { const cs = getComputedStyle(el, '::placeholder'); out.push({ tag: tag + '::placeholder', text: el.placeholder, size: parseFloat(cs.fontSize), fg: parse(cs.color).slice(0, 3), bg: bgOf(el) }); } }
    else if (tag === 'SELECT') { txt = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : ''; }
    else { for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) txt += n.textContent.trim() + ' '; }
    if (!txt.trim()) return;
    const cs = getComputedStyle(el);
    out.push({ tag, text: txt.trim().slice(0, 40), size: parseFloat(cs.fontSize), fg: parse(cs.color).slice(0, 3), bg: bgOf(el) });
  });
  return { texts: out, ranges: document.querySelectorAll('input[type=range]').length };
}"""

OVERLAP = """() => {
  const panel = document.querySelector('.sp-panel'), items = [];
  const clip = (el, r) => { let c = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const q = a.getBoundingClientRect(); c = { l: Math.max(c.l, q.left), t: Math.max(c.t, q.top), r: Math.min(c.r, q.right), b: Math.min(c.b, q.bottom) }; } }
    return c; };
  panel.querySelectorAll('*').forEach(el => {
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return;
    let has = el.tagName === 'INPUT' && el.type === 'text' || el.tagName === 'SELECT';
    if (!has) for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) has = true;
    if (!has) return;
    let r;
    if (el.tagName === 'INPUT' || el.tagName === 'SELECT') r = el.getBoundingClientRect();
    else { const rg = document.createRange(); rg.selectNodeContents(el); r = rg.getBoundingClientRect(); }
    const c = clip(el, r); if (c.r - c.l < 1 || c.b - c.t < 1) return;
    items.push({ el, c, text: (el.value || el.textContent || '').trim().slice(0, 30) });
  });
  const bad = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j]; if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const w = Math.min(a.c.r, b.c.r) - Math.max(a.c.l, b.c.l), h = Math.min(a.c.b, b.c.b) - Math.max(a.c.t, b.c.t);
    if (w > 1.5 && h > 1.5) bad.push([a.text, b.text, Math.round(w), Math.round(h)]);
  }
  return { n: items.length, bad };
}"""


class Ctx:
    def __init__(self, b):
        self.b = b

    def page(self, query="", w=1500, h=960, scheme="light"):
        ctx = self.b.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, device_scale_factor=1)
        pg = ctx.new_page()
        pg.ctx = ctx
        pg.errs, pg.reqs, pg.dialogs = [], [], []
        pg.on("console", lambda m: pg.errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: pg.errs.append(str(e)))
        pg.on("request", lambda r: pg.reqs.append(r.url))
        pg.on("dialog", lambda d: (pg.dialogs.append(d.message), d.dismiss()))
        pg.goto(ORIGIN + "dev/dev.html" + query)
        pg.wait_for_function("window.SP_READY && window.SP && SP.app.state.panel", timeout=15000)
        pg.evaluate("SP_READY")
        return pg


def waitf(pg, expr, ms=5000):
    try:
        pg.wait_for_function(expr, timeout=ms)
        return True
    except Exception:
        return False


def open_panel(pg):
    pg.click(".cp-gear")
    pg.wait_for_selector(".sp-panel:not([hidden])", timeout=5000)
    pg.wait_for_timeout(60)


def tab(pg, t):
    pg.click(".cp-tab[data-t='%s']" % t)
    pg.wait_for_function("document.querySelector(\".cp-tab[data-t='%s']\").getAttribute('aria-selected') === 'true'" % t)


def pv(name):
    return "SP_MOCK.param(%s).currentValue.value" % json.dumps(name)


def ctl(cid):
    return '[data-ctl=%s]' % json.dumps(cid)


def expand_all(pg):
    for _ in range(12):
        b = pg.query_selector(".sp-disc[aria-expanded=false]")
        if not b:
            return
        b.click()
        pg.wait_for_timeout(30)


# ------------------------------------------------------------------------------------------------ groups

def g_render(c):
    pg = c.page()
    check("the gear shows on the dashboard", pg.is_visible(".cp-gear"))
    z = pg.evaluate("[SP_MOCK.me.size.width, SP_MOCK.me.size.height]")
    check("closed, the extension zone is just the gear (56 x 56)", z == [56, 56], z)
    open_panel(pg)
    check("the gear opens the panel titled Dashboard controls", pg.inner_text(".cp-title").strip() == "Dashboard controls")
    ok = waitf(pg, "SP_MOCK.me.size.width === 380 && SP_MOCK.me.size.height === 640", 3000)
    check("open, the floating zone grows to the panel size (380 x 640) and keeps its right edge", ok and pg.evaluate("SP_MOCK.me.position.x + 380") == 1056, pg.evaluate("[SP_MOCK.me.position, SP_MOCK.me.size]"))
    tabs = pg.evaluate("[...document.querySelectorAll('.cp-tab')].map(t => t.textContent)")
    check("5 tabs with live counts: %s" % tabs, tabs == ["Parameters 11", "Filters 8", "Highlight", "Presets 0", "Panel"], tabs)
    n = pg.evaluate("document.querySelectorAll('.sp-ctl').length")
    check("Parameters tab shows all 11 parameter controls", n == 11, n)
    tab(pg, "filters")
    n2 = pg.evaluate("document.querySelectorAll('.sp-ctl').length")
    secs = pg.evaluate("[...document.querySelectorAll('.cp-sec')].map(s => s.textContent)")
    check("Filters tab shows 8 filter controls grouped by sheet, shared ones first: %s" % secs, n2 == 8 and secs == ["On 3 sheets", "Sales by Region", "Profit Trend", "Orders"], (n2, secs))
    pg.click("[data-act=close]")
    check("close shrinks the zone back to the gear", waitf(pg, "SP_MOCK.me.size.width === 56 && SP_MOCK.me.size.height === 56", 3000))
    if SHOTS:
        SHOTS.mkdir(parents=True, exist_ok=True)
        pg.screenshot(path=str(SHOTS / "render.png"))
    foreign = [u for u in pg.reqs if not u.startswith(ORIGIN)]
    check("%d requests, every one to the page's own server (sandbox-ready)" % len(pg.reqs), len(pg.reqs) >= 6 and not foreign, foreign[:3])
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_params(c):
    pg = c.page()
    open_panel(pg)
    done = set()

    def step(cid, name, action, expect_js, label):
        action()
        ok = waitf(pg, expect_js, 4000)
        if check("%s: %s" % (name, label), ok, pg.evaluate(pv(name))):
            done.add(cid)

    step("p:Top N", "Top N", lambda: pg.click(ctl("p:Top N") + " [data-d='1']"), pv("Top N") + " === 11", "the + stepper sends 11")
    step("p:Profit Ratio Target", "Profit Ratio Target", lambda: pg.click(ctl("p:Profit Ratio Target") + " [data-d='-1']"), pv("Profit Ratio Target") + " === 0.1", "the minus stepper sends 0.10")
    step("p:Metric", "Metric", lambda: pg.click(ctl("p:Metric") + " .cp-chip[data-v='Profit']"), pv("Metric") + " === 'Profit'", "a chip sends Profit")
    step("p:Region Focus", "Region Focus", lambda: pg.select_option(ctl("p:Region Focus") + " select", "South and West"), pv("Region Focus") + " === 'South and West'", "the dropdown (8 values) sends South and West")
    step("p:Bucket Size", "Bucket Size", lambda: pg.click(ctl("p:Bucket Size") + " .cp-chip[data-v='50']"), pv("Bucket Size") + " === 50", "a number chip sends 50 as a number")
    step("p:Show Labels", "Show Labels", lambda: pg.click(ctl("p:Show Labels") + " .sp-switch"), pv("Show Labels") + " === false", "the toggle sends false")

    def typed(cid, val):
        sel = ctl(cid) + " input[type=text]"
        pg.fill(sel, val)
        pg.press(sel, "Enter")
    step("p:Title Text", "Title Text", lambda: typed("p:Title Text", "Q3 review"), pv("Title Text") + " === 'Q3 review'", "typed text sends on Enter")
    step("p:Discount Cap", "Discount Cap", lambda: typed("p:Discount Cap", "0.35"), pv("Discount Cap") + " === 0.35", "a typed float keeps 0.35 exactly")
    step("p:Sales Floor", "Sales Floor", lambda: typed("p:Sales Floor", "750"), pv("Sales Floor") + " === 750", "a typed integer sends 750")
    step("p:As Of Month", "As Of Month", lambda: pg.click(ctl("p:As Of Month") + " [data-d='1']"), pv("As Of Month") + " === '2026-07-01'", "the date stepper moves one month")
    step("p:Start Date", "Start Date", lambda: typed("p:Start Date", "2025-07-04"), pv("Start Date") + " === '2025-07-04'", "a typed date sends")
    typed("p:Start Date", "2025-13-40")
    check("a bad date is refused with an inline message and nothing is sent", waitf(pg, "document.querySelector('.cp-status').classList.contains('cp-err')", 2000) and pg.evaluate(pv("Start Date")) == "2025-07-04")
    for _ in range(5):
        pg.click(ctl("p:Top N") + " [data-d='1']")
    ok = waitf(pg, pv("Top N") + " === 16", 4000)
    pg.wait_for_timeout(400)
    sends = pg.evaluate("SP_MOCK.calls.filter(c => c.op === 'changeValueAsync' && c.param === 'Top N').length")
    check("five quick + clicks become one Tableau call (2 calls for Top N in all, value 16)", ok and sends == 2, sends)
    check("the input shows the value Tableau now holds", pg.input_value(ctl("p:Top N") + " input") == "16")
    total = pg.evaluate("document.querySelectorAll('.sp-ctl').length")
    check("every parameter control changed the workbook: %d of %d (floor 11)" % (len(done), total), len(done) == total >= 11, sorted(set(pg.evaluate("[...document.querySelectorAll('.sp-ctl')].map(e => e.dataset.ctl)")) - done))
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_filters(c):
    pg = c.page()
    open_panel(pg)
    tab(pg, "filters")
    done = set()
    every = "SP_MOCK.sheets.every(ws => %s)"

    def step(cid, action, expect_js, label):
        action()
        if check(label, waitf(pg, expect_js, 4000), pg.evaluate("SP_MOCK.calls.slice(-2)")):
            done.add(cid)

    R = ctl("f:categorical:Region")
    step("f:categorical:Region", lambda: pg.uncheck(R + " input[data-v='East']"), every % "!ws.filters.Region.appliedValues.some(d => d.value === 'East') && ws.filters.Region.appliedValues.length === 3", "Region: unchecking East applies to all 3 sheets")
    pg.click(R + " .cp-chip[data-v='exclude']")
    check("Region: Exclude checked flips all 3 sheets to exclude mode", waitf(pg, every % "ws.filters.Region.isExcludeMode"))
    pg.click(R + " [data-act=fall]")
    check("Region: All puts every sheet back to All", waitf(pg, every % "ws.filters.Region.isAllSelected"))
    pg.click(R + " [data-act=fnone]")
    check("Region: None leaves no value", waitf(pg, every % "ws.filters.Region.appliedValues.length === 0"))
    pg.click(R + " [data-act=fall]")
    waitf(pg, every % "ws.filters.Region.isAllSelected")
    step("f:categorical:Category", lambda: pg.uncheck(ctl("f:categorical:Category") + " input[data-v='Furniture']"), "SP_MOCK.sheet('Sales by Region').filters.Category.appliedValues.length === 2", "Category: unchecking Furniture on its one sheet")
    S = ctl("f:categorical:Segment")
    step("f:categorical:Segment", lambda: pg.click(S + " .cp-chip[data-v='keep']"), "!SP_MOCK.sheet('Orders').filters.Segment.isExcludeMode", "Segment: an exclude filter switches to keep")
    C = ctl("f:categorical:Customer")
    check("Customer (233 values) starts collapsed with a summary", pg.get_attribute(C + " .sp-disc", "aria-expanded") == "false" and "All 233" in pg.inner_text(C + " .sp-disc"))
    pg.click(C + " .sp-disc")
    pg.click(C + " [data-act=fnone]")
    waitf(pg, "SP_MOCK.sheet('Orders').filters.Customer.appliedValues.length === 0")
    pg.fill(C + " input[data-in=flq]", "Customer 12")
    n = pg.evaluate("(s) => document.querySelectorAll(s + ' input[data-in=fval]').length", C)
    check("Customer: finding 'Customer 12' narrows 233 values to %d" % n, 0 < n < 15, n)
    first = pg.evaluate("(s) => document.querySelector(s + ' input[data-in=fval]').dataset.v", C)
    step("f:categorical:Customer", lambda: pg.check(C + " input[data-in=fval][data-v='%s']" % first), "SP_MOCK.sheet('Orders').filters.Customer.appliedValues.map(d => d.value).join() === %s" % json.dumps(first), "Customer: checking one found value keeps just it")
    SA = ctl("f:range:Sales")
    lo = pg.evaluate("SP_MOCK.sheet('Orders').filters.Sales.minValue.value")
    step("f:range:Sales", lambda: pg.click(SA + " [data-end=min][data-d='1']"), "SP_MOCK.sheet('Orders').filters.Sales.minValue.value > %s" % lo, "Sales range: + on From raises the minimum by one step")
    pg.fill(SA + " input[data-end=max]", "1500"); pg.press(SA + " input[data-end=max]", "Enter")
    check("Sales range: typing 1500 in To sets the maximum", waitf(pg, "SP_MOCK.sheet('Orders').filters.Sales.maxValue.value === 1500"))
    pg.uncheck(SA + " input[data-in=rnull]")
    check("Sales range: Include empty values off", waitf(pg, "SP_MOCK.sheet('Orders').filters.Sales.includeNullValues === false"))
    pg.click(SA + " [data-act=fclear]")
    check("Sales range: Show everything clears the filter", waitf(pg, "SP_MOCK.calls.some(c => c.op === 'clearFilterAsync' && c.field === 'Sales') && SP_MOCK.sheet('Orders').filters.Sales.includeNullValues === true"))
    OD = ctl("f:range:Order Date")
    d0 = pg.evaluate("SP_MOCK.sheet('Profit Trend').filters['Order Date'].minValue.value.getTime()")
    step("f:range:Order Date", lambda: pg.click(OD + " [data-end=min][data-d='1']"), "SP_MOCK.sheet('Profit Trend').filters['Order Date'].minValue.value.getTime() === %d" % (d0 + 86400000), "Order Date range: + moves the start one day, sent as a Date")
    SH = ctl("f:relative-date:Ship Date")
    rel = "SP_MOCK.sheet('Orders').filters['Ship Date']"
    pg.click(SH + " .cp-chip[data-v='nextn']")
    check("Ship Date: Next N chip", waitf(pg, rel + ".rangeType === 'nextn'"))
    pg.click(SH + " .cp-chip[data-v='weeks']")
    check("Ship Date: Weeks chip", waitf(pg, rel + ".periodType === 'weeks'"))
    pg.click(SH + " [data-act=reln][data-d='1']")
    check("Ship Date: how many steps from 3 to 4", waitf(pg, rel + ".rangeN === 4"))
    step("f:relative-date:Ship Date", lambda: pg.click(SH + " [data-act=rela][data-d='-1']"), rel + ".anchorDate.value.toISOString().slice(0, 10) === '2026-11-17'", "Ship Date: anchor steps back one week (2026-11-17)")
    check("Ship Date reads back in words", "next 4 weeks, counting from 2026-11-17" in pg.inner_text(SH))
    check("the hierarchical filter is listed and says it cannot be edited", "cannot edit" in pg.inner_text(ctl("f:hierarchical:Product")))
    editable = pg.evaluate("[...document.querySelectorAll('.sp-ctl')].filter(e => !e.dataset.ctl.startsWith('f:hierarchical')).length")
    check("every editable filter control changed the workbook: %d of %d (floor 7)" % (len(done), editable), len(done) == editable >= 7, done)
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_highlight(c):
    pg = c.page()
    open_panel(pg)
    tab(pg, "highlight")
    ok = waitf(pg, "document.querySelectorAll('select[data-in=hfield]').length === 3", 6000)
    check("highlight lists the text fields of all 3 sheets", ok and pg.evaluate("document.querySelectorAll('select[data-in=hfield]').length") == 3)
    H = ctl("h:Sales by Region")
    check("short value lists start open, long ones closed (Orders: Order ID has 200+ values)", pg.get_attribute(H + " .sp-disc", "aria-expanded") == "true" and pg.get_attribute(ctl("h:Orders") + " .sp-disc", "aria-expanded") == "false")
    pg.check(H + " input[data-v='East']")
    check("checking East highlights East on Sales by Region", waitf(pg, "SP_MOCK.sheet('Sales by Region').selected && SP_MOCK.sheet('Sales by Region').selected.values.join() === 'East'"))
    pg.select_option(H + " select", "Category")
    pg.check(H + " input[data-v='Technology']")
    check("switching the field to Category and checking Technology", waitf(pg, "SP_MOCK.sheet('Sales by Region').selected && SP_MOCK.sheet('Sales by Region').selected.field === 'Category' && SP_MOCK.sheet('Sales by Region').selected.values.join() === 'Technology'"))
    pg.check("input[data-in=hall]")
    O = ctl("h:Orders")
    pg.select_option(O + " select", "Region")
    if pg.get_attribute(O + " .sp-disc", "aria-expanded") != "true":
        pg.click(O + " .sp-disc")
    pg.check(O + " input[data-v='West']")
    check("with every sheet on, West highlights on all 3 sheets", waitf(pg, "SP_MOCK.sheets.every(ws => ws.selected && ws.selected.field === 'Region' && ws.selected.values.join() === 'West')"))
    check("the reader was released on every sheet", pg.evaluate("SP_MOCK.sheets.every(ws => !ws.open)"))
    pg.click(O + " [data-act=hclear]")
    check("Clear highlight clears the selection everywhere", waitf(pg, "SP_MOCK.sheets.every(ws => ws.selected === null)"))
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_presets(c):
    pg = c.page()
    open_panel(pg)
    pg.click(ctl("p:Metric") + " .cp-chip[data-v='Quantity']")
    waitf(pg, pv("Metric") + " === 'Quantity'")
    tab(pg, "filters")
    pg.uncheck(ctl("f:categorical:Region") + " input[data-v='South']")
    waitf(pg, "SP_MOCK.sheets.every(ws => ws.filters.Region.appliedValues.length === 3)")
    pg.wait_for_timeout(300)
    tab(pg, "presets")
    pg.click("[data-act=psave]")
    check("Save with no name asks for one inline", "Type a name" in pg.inner_text(".cp-status") and not pg.dialogs)
    pg.fill("input[data-in=pname]", "No South, by quantity")
    pg.press("input[data-in=pname]", "Enter")
    check("Enter saves the preset into the workbook settings", waitf(pg, "SP_MOCK.settings['sp.presets'] && JSON.parse(SP_MOCK.settings['sp.presets']).length === 1"))
    check("the Presets tab count reads 1", pg.inner_text(".cp-tab[data-t=presets]") == "Presets 1")
    tab(pg, "params")
    pg.click(ctl("p:Metric") + " .cp-chip[data-v='Sales']")
    waitf(pg, pv("Metric") + " === 'Sales'")
    tab(pg, "filters")
    pg.click(ctl("f:categorical:Region") + " [data-act=fall]")
    waitf(pg, "SP_MOCK.sheets.every(ws => ws.filters.Region.isAllSelected)")
    pg.wait_for_timeout(300)
    tab(pg, "presets")
    pg.click(".sp-preset [data-act=papply]")
    ok = waitf(pg, pv("Metric") + " === 'Quantity' && SP_MOCK.sheets.every(ws => ws.filters.Region.appliedValues.length === 3 && !ws.filters.Region.appliedValues.some(d => d.value === 'South'))", 6000)
    check("Apply brings back the parameter and the filter on every sheet", ok, pg.inner_text(".cp-status"))
    check("the status says what changed", "Applied No South, by quantity: 2 changes" in pg.inner_text(".cp-status"), pg.inner_text(".cp-status"))
    pg.click(".sp-preset [data-act=pren]")
    check("Rename opens an inline field with the name selected", pg.evaluate("document.activeElement.dataset.in") == "prename")
    pg.fill("input[data-in=prename]", "Quantity view")
    pg.press("input[data-in=prename]", "Enter")
    check("Rename saves the new name to the workbook", waitf(pg, "JSON.parse(SP_MOCK.settings['sp.presets'])[0].name === 'Quantity view'"))
    saved = pg.evaluate("JSON.stringify(SP_MOCK.settings)")
    pg.ctx.close()
    pg = c.page("?settings=" + __import__("urllib.parse").parse.quote(saved))
    open_panel(pg)
    tab(pg, "presets")
    check("reopened from the saved settings, the preset is there (travels with the workbook)", pg.inner_text(".sp-preset .sp-pname") == "Quantity view")
    pg.click(".sp-preset [data-act=papply]")
    check("and it applies in the reopened workbook", waitf(pg, pv("Metric") + " === 'Quantity'", 6000))
    pg.click(".sp-preset [data-act=pdel]")
    check("Delete asks inline, with focus on Keep it", pg.evaluate("document.activeElement.dataset.act") == "pdelno" and "Delete Quantity view?" in pg.inner_text(".sp-preset"))
    pg.click("[data-act=pdelno]")
    check("Keep it keeps the preset", pg.query_selector(".sp-preset [data-act=papply]") is not None)
    pg.click(".sp-preset [data-act=pdel]"); pg.click("[data-act=pdelok]")
    check("Yes, delete removes it from the workbook", waitf(pg, "JSON.parse(SP_MOCK.settings['sp.presets']).length === 0"))
    check("no browser dialog in the whole preset flow", not pg.dialogs, pg.dialogs)
    check("0 console errors", not pg.errs, pg.errs[:3])
    pg.ctx.close()


def g_reset(c):
    pg = c.page()
    check("first run captured the workbook defaults into settings", waitf(pg, "!!SP_MOCK.settings['sp.defaults']"))
    open_panel(pg)
    pg.click(ctl("p:Top N") + " [data-d='1']")
    pg.click(ctl("p:Show Labels") + " .sp-switch")
    tab(pg, "filters")
    pg.uncheck(ctl("f:categorical:Category") + " input[data-v='Technology']")
    pg.click(ctl("f:range:Sales") + " [data-end=max][data-d='-1']")
    ok = waitf(pg, pv("Top N") + " === 11 && " + pv("Show Labels") + " === false && SP_MOCK.sheet('Sales by Region').filters.Category.appliedValues.length === 2 && SP_MOCK.sheet('Orders').filters.Sales.maxValue.value < 1999", 5000)
    check("four things changed before the reset", ok)
    pg.wait_for_timeout(400)
    pg.click("[data-act=reset]")
    check("Reset asks inline first, focus on Keep my changes", pg.evaluate("document.activeElement.dataset.act") == "resetno")
    pg.click("[data-act=resetok]")
    back = waitf(pg, pv("Top N") + " === 10 && " + pv("Show Labels") + " === true && SP_MOCK.sheet('Sales by Region').filters.Category.isAllSelected && SP_MOCK.sheet('Orders').filters.Sales.maxValue.value === Math.max(...SP_MOCK.data.map(r => r.Sales))", 6000)
    check("Yes, reset puts every parameter and filter back to the workbook defaults", back, pg.inner_text(".cp-status"))
    check("the status reports 4 changes", "4 changes" in pg.inner_text(".cp-status"), pg.inner_text(".cp-status"))
    pg.ctx.close()


def g_search(c):
    pg = c.page()
    open_panel(pg)
    pg.fill(".cp-q", "ship")
    check("'ship' finds the Ship Date filter from any tab", waitf(pg, "document.querySelector('.cp-count') && document.querySelector('.cp-count').textContent.indexOf('1 match') === 0") and pg.query_selector(ctl("f:relative-date:Ship Date")) is not None)
    pg.fill(".cp-q", "region")
    ids = pg.evaluate("[...document.querySelectorAll('.sp-ctl')].map(e => e.dataset.ctl)")
    check("'region' finds the Region Focus parameter and the Region filter: %s" % ids, "p:Region Focus" in ids and "f:categorical:Region" in ids, ids)
    pg.fill(".cp-q", "orders")
    ids = pg.evaluate("[...document.querySelectorAll('.sp-ctl')].map(e => e.dataset.ctl)")
    check("'orders' finds the filters on the Orders sheet (%d)" % len(ids), len(ids) >= 4 and "f:range:Sales" in ids, ids)
    pg.click(ctl("f:range:Sales") + " [data-end=min][data-d='1']")
    check("a control found by search works in place", waitf(pg, "SP_MOCK.calls.some(c => c.op === 'applyRangeFilterAsync')"))
    pg.fill(".cp-q", "zzzz")
    check("no match says so", "Nothing matches" in pg.inner_text(".cp-body"))
    pg.fill(".cp-q", "")
    check("clearing the search returns to the tab", pg.evaluate("document.querySelector('.cp-tab[aria-selected=true]') !== null"))
    pg.ctx.close()


def g_keyboard(c):
    pg = c.page()
    pg.focus(".cp-gear")
    pg.keyboard.press("Enter")
    check("Enter on the gear opens the panel", waitf(pg, "!document.querySelector('.sp-panel').hidden", 2000))
    pg.focus(".cp-tab[data-t=params]")
    pg.keyboard.press("ArrowRight")
    check("ArrowRight moves to the Filters tab and focuses it", pg.evaluate("document.activeElement.dataset.t") == "filters" and pg.get_attribute(".cp-tab[data-t=filters]", "aria-selected") == "true")
    pg.keyboard.press("End")
    check("End goes to the last tab", pg.evaluate("document.activeElement.dataset.t") == "panel")
    pg.keyboard.press("Home")
    pg.focus(ctl("p:Top N") + " input")
    pg.keyboard.press("ArrowUp")
    check("ArrowUp in a number field steps it up", waitf(pg, pv("Top N") + " === 11"))
    check("focus stays in the field after the redraw", pg.evaluate("document.activeElement.dataset.in") == "pnum")
    pg.keyboard.press("Escape")
    check("Escape closes and focus returns to the gear", pg.evaluate("document.querySelector('.sp-panel').hidden && document.activeElement === document.querySelector('.cp-gear')"))
    pg.ctx.close()
    pg = c.page("?zone=900x700&solo=1")
    open_panel(pg)
    pg.focus(".cp-head")
    x0 = pg.evaluate("SP.app.state.panel.ps.x")
    pg.keyboard.press("ArrowLeft"); pg.keyboard.press("ArrowLeft")
    check("in a 900px zone, two ArrowLeft presses move the panel 32px", pg.evaluate("SP.app.state.panel.ps.x") == x0 - 32, (x0, pg.evaluate("SP.app.state.panel.ps.x")))
    hd = pg.evaluate(RECT, ".cp-head")
    pg.mouse.move(hd["l"] + 60, hd["t"] + 10); pg.mouse.down(); pg.mouse.move(hd["l"] - 3000, hd["t"] + 4000, steps=8); pg.mouse.up()
    r, z = pg.evaluate(RECT, ".sp-panel"), pg.evaluate(RECT, "#sp-root")
    check("dragging far away clamps the panel inside the zone", r["l"] >= z["l"] - 1 and r["b"] <= z["b"] + 1, (r, z))
    pg.click("[data-act=min]")
    check("minimize collapses to the title bar", pg.evaluate("document.querySelector('.sp-panel').classList.contains('cp-min')") and pg.evaluate(RECT, ".sp-panel")["h"] < 80)
    pg.click("[data-act=min]")
    pg.ctx.close()


def each_tab(pg, fn, label):
    seen = 0
    for t in TABS:
        tab(pg, t)
        if t == "highlight":
            waitf(pg, "document.querySelectorAll('select[data-in=hfield]').length === 3", 6000)
        if t in ("filters", "highlight"):
            expand_all(pg)
        seen += fn(t)
    return seen


def theme_pages(c):
    """light (system), dark (system), custom: each opened with the panel up."""
    out = []
    for name, scheme, extra in (("light", "light", ""), ("dark", "dark", ""), ("custom", "light", json.dumps({"sp.panel": json.dumps({"theme": "custom", "customBg": "#3b4a5c", "customInk": "#c8d0d8"})}))):
        q = "?settings=" + __import__("urllib.parse").parse.quote(extra) if extra else ""
        pg = c.page(q, scheme=scheme)
        open_panel(pg)
        out.append((name, pg))
    return out


def g_floor_contrast(c, which):
    for name, pg in theme_pages(c):
        small, low, ranges = [], [], [0]

        def one(t):
            d = pg.evaluate(AUDIT)
            ranges[0] += d["ranges"]
            for x in d["texts"]:
                if x["size"] < 13.99:
                    small.append((t, x["text"], x["size"]))
                cr = contrast(x["fg"], x["bg"])
                if cr < 7:
                    low.append((t, x["text"], round(cr, 2)))
            return len(d["texts"])
        seen = each_tab(pg, one, name)
        if which == "floor":
            check("%s theme: every panel text is 14px or more (%d texts over 5 tabs, floor 300)" % (name, seen), seen >= 300 and not small, small[:3])
        else:
            check("%s theme: every panel text is 7:1 or better on its background (%d texts, floor 300)" % (name, seen), seen >= 300 and not low, low[:3])
        pg.ctx.close()


def g_overlap(c):
    for q, w, label in (("", 1500, "1280-class dashboard"), ("?zone=390x844&solo=1", 390, "390 wide")):
        pg = c.page(q, w=w, h=900)
        open_panel(pg)
        bad, n = [], [0]

        def one(t):
            d = pg.evaluate(OVERLAP)
            bad.extend([(t,) + tuple(b) for b in d["bad"]])
            n[0] += d["n"]
            return d["n"]
        each_tab(pg, one, label)
        check("%s: no two of %d visible texts overlap on any tab (floor 100)" % (label, n[0]), n[0] >= 100 and not bad, bad[:4])
        pg.ctx.close()


def g_sheet390(c):
    examined = 0
    for (w, h) in ((390, 700), (390, 844), (390, 560)):
        pg = c.page("?zone=%dx%d&solo=1" % (w, h), w=w, h=h)
        open_panel(pg)
        pg.wait_for_timeout(200)
        pr, fr, zr = pg.evaluate(RECT, ".sp-panel"), pg.evaluate(RECT, ".cp-foot"), pg.evaluate(RECT, "#sp-root")
        check("%dx%d: the panel is a full-frame sheet" % (w, h), pg.evaluate("document.querySelector('.sp-panel').classList.contains('cp-sheet')") and abs(pr["w"] - zr["w"]) <= 1 and abs(pr["h"] - zr["h"]) <= 1, (pr, zr))
        check("%dx%d: footer fully inside the panel and the viewport" % (w, h), fr["t"] >= pr["t"] - 1 and fr["b"] <= pr["b"] + 1 and fr["r"] <= w + 1 and fr["b"] <= h + 1 and fr["h"] > 20, (fr, pr))
        bad = pg.evaluate("""() => { const row = document.querySelector('.cp-tabs'), bad = [];
          const tabs = [...row.querySelectorAll('.cp-tab')];
          tabs.forEach(t => { t.scrollIntoView({block: 'nearest', inline: 'nearest'}); const r = t.getBoundingClientRect(), q = row.getBoundingClientRect();
            if (!(r.left >= q.left - 1 && r.right <= q.right + 1 && r.top >= q.top - 1 && r.bottom <= q.bottom + 1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1)) bad.push(t.dataset.t);
            if (r.height < 43.5) bad.push(t.dataset.t + ' height ' + r.height); });
          return { n: tabs.length, bad }; }""")
        examined += bad["n"]
        check("%dx%d: every tab reachable in the tab row and 44px tall (%d tabs)" % (w, h, bad["n"]), bad["n"] == 5 and not bad["bad"], bad)
        side = []
        for t in TABS:
            tab(pg, t)
            if t == "filters":
                expand_all(pg)
            if pg.evaluate("document.documentElement.scrollWidth > innerWidth + 1 || (() => { const p = document.querySelector('.sp-panel'), b = document.querySelector('.cp-body'); return p.scrollWidth > p.clientWidth + 1 || b.scrollWidth > b.clientWidth + 1; })()"):
                side.append(t)
            small = pg.evaluate("[...document.querySelectorAll('.sp-panel button:not([hidden]), .sp-panel .cp-step')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 43.5 && !b.closest('.sp-list'); }).map(b => b.textContent.trim() || b.getAttribute('aria-label')).slice(0, 3)")
            if small:
                side.append("%s small targets %s" % (t, small))
        check("%dx%d: nothing scrolls sideways and every button is 44px tall on all 5 tabs" % (w, h), not side, side)
        pg.ctx.close()
    check("390 wide: %d tab buttons examined in all (floor 15)" % examined, examined >= 15, examined)


def g_frames(c):
    pg = c.page()
    pg.evaluate("""() => { window.__gaps = []; window.__rec = true; let last = performance.now();
      const loop = (t) => { if (!window.__rec) return; window.__gaps.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop); }""")
    pg.wait_for_timeout(300)
    open_panel(pg)
    for t in TABS + ["filters"]:
        tab(pg, t)
        pg.wait_for_timeout(120)
    C = ctl("f:categorical:Customer")
    pg.click(C + " .sp-disc")
    pg.wait_for_timeout(150)
    box = pg.evaluate(RECT, C + " .sp-list")
    pg.mouse.move(box["l"] + 40, box["t"] + 40)
    for _ in range(12):
        pg.mouse.wheel(0, 120)
        pg.wait_for_timeout(40)
    pg.click(".cp-q")
    pg.keyboard.type("customer 1", delay=45)
    pg.fill(".cp-q", "")
    tab(pg, "params")
    for _ in range(8):
        pg.click(ctl("p:Top N") + " [data-d='1']")
        pg.wait_for_timeout(60)
    pg.wait_for_timeout(500)
    gaps = pg.evaluate("window.__rec = false, window.__gaps.slice(2)")
    gaps = [g for g in gaps if g > 0]
    med, p95, mx = statistics.median(gaps), sorted(gaps)[max(0, int(len(gaps) * 0.95) - 1)], max(gaps)
    print("  frames: n=%d median %.1f ms, p95 %.1f ms, max %.1f ms over open, 6 tab switches, list scroll, search typing, 8 steps" % (len(gaps), med, p95, mx))
    check("frame pacing: %d frames (floor 60), median %.1f ms (<= 18.5), p95 %.1f ms (<= 40)" % (len(gaps), med, p95), len(gaps) >= 60 and med <= 18.5 and p95 <= 40, (len(gaps), med, p95))
    check("no frame over 50 ms (no jank), longest %.1f ms" % mx, mx <= 50, mx)
    pg.ctx.close()


def g_rules(c):
    pg = c.page()
    open_panel(pg)
    texts, ranges = [], 0
    for t in TABS:
        tab(pg, t)
        if t == "filters":
            expand_all(pg)
        if t == "highlight":
            waitf(pg, "document.querySelectorAll('select[data-in=hfield]').length === 3", 6000)
            expand_all(pg)
        texts.append(pg.evaluate("document.querySelector('.sp-panel').innerText + ' ' + [...document.querySelectorAll('.sp-panel [aria-label], .sp-panel [placeholder], .sp-panel [title], .cp-gear')].map(e => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('placeholder') || '') + ' ' + (e.getAttribute('title') || '')).join(' ')"))
        ranges += pg.evaluate("document.querySelectorAll('input[type=range]').length")
    blob = " ".join(texts)
    check("no em dash in %d characters of rendered text, labels and placeholders over 5 tabs" % len(blob), len(blob) > 3000 and EM not in blob, blob[blob.find(EM) - 30: blob.find(EM) + 10] if EM in blob else None)
    check("no range input (slider) on any tab", ranges == 0, ranges)
    check("no browser dialog", not pg.dialogs, pg.dialogs)
    pg.ctx.close()


def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        c = Ctx(b)
        fns = {"render": g_render, "params": g_params, "filters": g_filters, "highlight": g_highlight, "presets": g_presets, "reset": g_reset,
               "search": g_search, "keyboard": g_keyboard, "floor": lambda c: g_floor_contrast(c, "floor"), "contrast": lambda c: g_floor_contrast(c, "contrast"),
               "overlap": g_overlap, "sheet390": g_sheet390, "frames": g_frames, "rules": g_rules}
        ran = 0
        for g in GROUPS:
            if g not in ONLY:
                continue
            print("--- %s" % g)
            try:
                fns[g](c)
            except Exception as e:
                check("group %s ran to the end" % g, False, repr(e)[:300])
            ran += 1
        b.close()
    srv.shutdown()
    floor = 100 if ONLY == GROUPS else 1
    total = RESULTS["pass"] + RESULTS["fail"]
    if RESULTS["fail"] or RESULTS["pass"] < floor:
        print("RED  browser: %d passed, %d failed over %d groups%s" % (RESULTS["pass"], RESULTS["fail"], ran, "" if RESULTS["pass"] >= floor else " (below the floor of %d checks)" % floor))
        sys.exit(1)
    print("GREEN browser: %d of %d checks passed over %d groups" % (RESULTS["pass"], total, ran))


main()
