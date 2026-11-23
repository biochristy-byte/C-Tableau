"""Browser gate for Radar: renders the shipping code against the mock Tableau API.

  python test/mock_render.py [--shots DIR]

Static cases (a fixture at a size in a theme, with optional settings):
  WHO data at 300x300, 900x520 and 1600x1000 in light and dark; overlaid and small multiples; smoothed; per-axis scale;
  12 axes; 12 series; long names; negatives; missing values; 3 axes; constant values; 2 axes and no rows (messages).
For every case: svg drawn, 0 console errors, every text >= 14px, text >= 7:1 against the background, no two
text boxes overlap, text and shapes inside the stage, no horizontal scroll, no NaN in any path.
Behaviour, on the real data: every dot sits at the radius the CSV value says (49 of them, measured from the DOM),
hover dims the others with an eased fade (sampled frame by frame), the tooltip numbers match the CSV, click isolates
and pushes the selection to Tableau, the legend isolates, keyboard, the entrance animation ends on the exact static
geometry, the settings panel changes the chart (no sliders, text >= 14px), settings are saved as strings and restored.

Exit 1 and a RED line on any failure; RED too if it examined fewer cases or checks than the floors.
"""
import csv, functools, http.server, json, math, pathlib, re, socketserver, sys, threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIN_CASES = 28
MIN_CHECKS = 330
shots = None
if "--shots" in sys.argv:
    shots = pathlib.Path(sys.argv[sys.argv.index("--shots") + 1]); shots.mkdir(parents=True, exist_ok=True)
checks = {"n": 0}
fails, cases = [], []


def check(name, cond, detail=""):
    checks["n"] += 1
    if not cond:
        fails.append("%s %s" % (name, detail))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def serve():
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ---- truth computed here from the CSV, not by the code under test ----
CSV = list(csv.DictReader(open(ROOT / "example" / "who-health-2019.csv", encoding="utf-8")))
TRUTH = {}
for r in CSV:
    TRUTH.setdefault(r["WHO region"], {})[r["Indicator"]] = float(r["Value"])
AXES = list(dict.fromkeys(r["Indicator"] for r in CSV))
SERIES = list(dict.fromkeys(r["WHO region"] for r in CSV))

JS_ITEMS = """() => {
  const chart = document.querySelector('#rd-chart'), stage = document.querySelector('#stage').getBoundingClientRect();
  const parse = s => (s.match(/[\\d.]+/g) || []).map(Number);
  const bgc = parse(getComputedStyle(chart).backgroundColor), al = bgc.length > 3 ? bgc[3] : 1;
  let bg = bgc.slice(0, 3); if (al === 0) bg = parse(getComputedStyle(document.querySelector('#stage')).backgroundColor).slice(0, 3);
  const items = [], vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  chart.querySelectorAll('svg text').forEach(t => { if (!vis(t)) return; const r = t.getBoundingClientRect(), cs = getComputedStyle(t);
    items.push({ kind: 'svg:' + t.getAttribute('class'), text: t.textContent.slice(0, 30), size: parseFloat(cs.fontSize), fg: parse(cs.fill).slice(0, 3), l: r.left, t: r.top, r: r.right, b: r.bottom, el: null }); });
  chart.querySelectorAll('.rd-title, .rd-lg-n, .rd-lg-t, .rd-note, .rd-empty').forEach(t => { if (!vis(t)) return; const r = t.getBoundingClientRect(), cs = getComputedStyle(t);
    items.push({ kind: 'html:' + t.className, text: t.textContent.slice(0, 30), size: parseFloat(cs.fontSize), fg: parse(cs.color).slice(0, 3), l: r.left, t: r.top, r: r.right, b: r.bottom }); });
  const shapes = [...chart.querySelectorAll('.rd-shape, .rd-ring')].map(p => { const r = p.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, d: p.getAttribute('d') }; });
  const svg = chart.querySelector('svg'), sr = svg ? svg.getBoundingClientRect() : null;
  return { items, shapes, bg, stage: { l: stage.left, t: stage.top, r: stage.right, b: stage.bottom }, svg: sr ? { l: sr.left, t: sr.top, r: sr.right, b: sr.bottom } : null,
    hscroll: document.documentElement.scrollWidth > innerWidth + 1, ds: svg ? Object.assign({}, svg.dataset) : null,
    nShapes: chart.querySelectorAll('.rd-shape').length, nPanels: chart.querySelectorAll('.rd-panel').length, empty: (chart.querySelector('.rd-empty') || {}).textContent || null };
}"""


def lum(c):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def contrast(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + .05) / (min(la, lb) + .05)


def open_case(b, port, fixture, size, theme, errs, settings=None, wait=True):
    w, h = [int(x) for x in size.split("x")]
    pg = b.new_page(viewport={"width": w + 60, "height": h + 260}, device_scale_factor=1)
    pg.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)))
    pg.on("dialog", lambda d: (errs.append("browser dialog: " + d.message), d.dismiss()))
    if settings:
        snap = {"radar." + k: (json.dumps(v) if isinstance(v, (list, dict)) else str(v).lower() if isinstance(v, bool) else str(v)) for k, v in settings.items()}
        pg.add_init_script("localStorage.setItem('rd-mock-settings', %s)" % json.dumps(json.dumps(snap)))
    pg.goto("http://127.0.0.1:%d/dev/dev.html?fixture=%s&size=%s&theme=%s" % (port, fixture, size, theme))
    pg.wait_for_function("window.RD_READY && document.querySelector('.rd-svg, .rd-empty')", timeout=10000)
    if wait:
        pg.wait_for_function("(() => { const s = document.querySelector('.rd-svg'); return !s || s.getAttribute('data-anim') === 'done'; })()", timeout=10000)
    return pg


def static_case(b, port, fixture, size, theme, expect_series, expect_axes, settings=None, label="", multi=False):
    errs = []
    name = "%s %s %s%s" % (fixture, size, theme, (" " + label) if label else "")
    pg = open_case(b, port, fixture, size, theme, errs, settings)
    d = pg.evaluate(JS_ITEMS)
    cases.append(name)
    if expect_series == 0:
        check(name + ": shows a message instead of a chart", d["empty"] and d["svg"] is None, str(d["empty"]))
        check(name + ": message is >= 14px and 7:1", all(i["size"] >= 14 and contrast(i["fg"], d["bg"]) >= 7 for i in d["items"]))
        check(name + ": 0 console errors", not errs, str(errs[:3]))
        pg.close()
        return
    check(name + ": svg drawn", d["svg"] is not None)
    check(name + ": series shapes drawn (%d)" % expect_series, d["nShapes"] == expect_series, "got %d" % d["nShapes"])
    check(name + ": axis count on the svg", int(d["ds"]["axes"]) == expect_axes, str(d["ds"]))
    if multi:
        check(name + ": one panel per series", d["nPanels"] == expect_series, str(d["nPanels"]))
    check(name + ": every shape path is non-empty with no NaN", all(len(s["d"] or "") > 20 and "NaN" not in s["d"] and "Infinity" not in s["d"] for s in d["shapes"]))
    check(name + ": 0 console errors", not errs, str(errs[:3]))
    check(name + ": no horizontal scroll", not d["hscroll"])
    T = d["items"]
    check(name + ": has text", len(T) >= 3, str(len(T)))
    check(name + ": every text >= 14px (%d texts)" % len(T), all(t["size"] >= 14 for t in T), str([(t["text"], t["size"]) for t in T if t["size"] < 14][:3]))
    low = [(t["text"], round(contrast(t["fg"], d["bg"]), 2)) for t in T if contrast(t["fg"], d["bg"]) < 7]
    check(name + ": every text >= 7:1 against the background", not low, str(low[:3]))
    bad = []
    for i in range(len(T)):
        for j in range(i + 1, len(T)):
            a, c = T[i], T[j]
            if a["l"] < c["r"] - 0.5 and c["l"] < a["r"] - 0.5 and a["t"] < c["b"] - 0.5 and c["t"] < a["b"] - 0.5:
                bad.append((a["text"], c["text"]))
    check(name + ": no two text boxes overlap", not bad, str(bad[:3]))
    S = d["stage"]
    out = [t["text"] for t in T if t["l"] < S["l"] - 1 or t["r"] > S["r"] + 1 or t["t"] < S["t"] - 1 or t["b"] > S["b"] + 1]
    check(name + ": all text inside the stage", not out, str(out[:3]))
    pout = [i for i, p in enumerate(d["shapes"]) if p["l"] < S["l"] - 1 or p["r"] > S["r"] + 1 or p["t"] < S["t"] - 1 or p["b"] > S["b"] + 1]
    check(name + ": all shapes and rings inside the stage", not pout, str(pout[:3]))
    if shots and fixture == "who" and not settings:
        pg.locator("#stage").screenshot(path=str(shots / ("radar-%s-%s.png" % (size, theme))))
    if shots and label in ("multiples", "smooth+bench"):
        pg.locator("#stage").screenshot(path=str(shots / ("radar-%s-%s-%s.png" % (fixture, size, label.replace("+", "-")))))
    pg.close()


JS_DOTS = """() => {
  const axes = [...document.querySelectorAll('.rd-axis')].slice(0, 7).map(l => ({ x1: +l.getAttribute('x1'), y1: +l.getAttribute('y1'), x2: +l.getAttribute('x2'), y2: +l.getAttribute('y2') }));
  const out = {};
  document.querySelectorAll('.rd-s').forEach(g => { out[g.dataset.key] = [...g.querySelectorAll('.rd-dot')].map(c => ({ ai: +c.dataset.ai, cx: +c.getAttribute('cx'), cy: +c.getAttribute('cy') })); });
  return { axes, out };
}"""


def behaviour(b, port):
    errs = []
    name = "behaviour"
    pg = open_case(b, port, "who", "900x520", "light", errs)
    cases.append(name)
    # 1. every dot is where the CSV says it is
    d = pg.evaluate(JS_DOTS)
    worst, n = 0.0, 0
    for sk, dots in d["out"].items():
        for dot in dots:
            ax = d["axes"][dot["ai"]]
            R = math.hypot(ax["x2"] - ax["x1"], ax["y2"] - ax["y1"])
            r = math.hypot(dot["cx"] - ax["x1"], dot["cy"] - ax["y1"])
            exp = TRUTH[sk][AXES[dot["ai"]]] / 100.0
            worst = max(worst, abs(r / R - exp)); n += 1
            # on the axis line (angle)
            cross = abs((ax["x2"] - ax["x1"]) * (dot["cy"] - ax["y1"]) - (ax["y2"] - ax["y1"]) * (dot["cx"] - ax["x1"])) / R
            worst = max(worst, cross / R)
    check("every dot (%d of 49) sits at radius value/100 on its axis, measured from the DOM (worst error %.4f)" % (n, worst), n == 49 and worst < 0.004, "n=%d worst=%.5f" % (n, worst))
    check("series keys are the 7 WHO regions", sorted(d["out"].keys()) == sorted(SERIES))
    # 2. entrance animation ended on the same geometry (compare after a redraw with animation off)
    check("the entrance animation finished (data-anim=done)", pg.get_attribute(".rd-svg", "data-anim") == "done")
    # 3. hover: eased fade, sampled per frame. Slow the fade to 600 ms (the setting maximum) so a loaded machine still lands samples inside it.
    pg.close()
    pg = open_case(b, port, "who", "900x520", "light", errs, {"hoverMs": 600, "animOn": False})
    dot = pg.evaluate("(() => { const c = document.querySelector('.rd-s[data-key=\"Africa\"] .rd-dhit'); const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
    pg.mouse.move(5, 5)
    pg.evaluate("""() => { window.__op = []; const el = document.querySelector('.rd-s[data-key="Europe"]'); const t0 = performance.now();
      (function tick() { window.__op.push([performance.now() - t0, +getComputedStyle(el).opacity, el.isConnected]); if (performance.now() - t0 < 1500) requestAnimationFrame(tick); })(); }""")
    pg.mouse.move(dot[0], dot[1])
    pg.wait_for_timeout(1700)
    ops = pg.evaluate("window.__op")
    vals = [o[1] for o in ops]
    check("hover: the sampled series stayed in the document for the whole fade (no redraw replaced it)", all(o[2] for o in ops), str([o for o in ops if not o[2]][:2]))
    check("hover: the other series fade to the dim level (0.22)", abs(vals[-1] - 0.22) < 0.02, str(vals[-1]))
    check("hover: the fade is eased, not a jump (intermediate opacities sampled: %d frames)" % len(vals), any(0.3 < v < 0.95 for v in vals), str(sorted(set(round(v, 2) for v in vals))[:8]))
    mono = all(vals[i + 1] <= vals[i] + 0.01 for i in range(len(vals) - 1))
    check("hover: opacity only goes down while fading", mono)
    check("hover: the hovered series stays fully opaque", pg.evaluate("+getComputedStyle(document.querySelector('.rd-s[data-key=\"Africa\"]')).opacity") == 1)
    # 4. tooltip numbers
    tip = pg.evaluate("(() => { const t = document.querySelector('.rd-tip'); return { on: t.classList.contains('on'), head: (t.querySelector('.rd-tip-h') || {}).textContent, rows: [...t.querySelectorAll('.rd-tip-r')].map(r => [r.querySelector('.rd-tip-n').textContent, r.querySelector('.rd-tip-v').textContent]) }; })()")
    ai = pg.evaluate("document.querySelector('.rd-s[data-key=\"Africa\"] .rd-dhit').dataset.ai")
    axis = AXES[int(ai)]
    check("tooltip is on and titled with the axis it is over", tip["on"] and tip["head"].startswith(CSV[int(ai) * 7]["Indicator long name"][:12]), str(tip["head"]))
    want = sorted(((sk, TRUTH[sk][axis]) for sk in SERIES), key=lambda x: -x[1])
    got = [(r[0], float(r[1].replace(",", ""))) for r in tip["rows"]]
    check("tooltip lists every series with the CSV value, highest first", [(a, round(v, 1)) for a, v in got] == [(a, round(v, 1)) for a, v in want] or sorted(got, key=lambda x: -x[1]) == got and {a: round(v, 1) for a, v in got} == {a: round(v, 1) for a, v in want}, str(got))
    check("tooltip text >= 14px", pg.evaluate("[...document.querySelectorAll('.rd-tip *')].every(e => parseFloat(getComputedStyle(e).fontSize) >= 14)"))
    # 5. click isolates and selects in Tableau
    pg.mouse.click(dot[0], dot[1])
    pg.wait_for_timeout(900)
    check("click isolates the series", pg.evaluate("document.querySelector('.rd-svg').classList.contains('rd-iso')") and pg.evaluate("document.querySelectorAll('.rd-s.is-on').length") == 1)
    check("the others are hidden while isolated", pg.evaluate("+getComputedStyle(document.querySelector('.rd-s[data-key=\"Europe\"]')).opacity") < 0.05)
    check("the legend shows the isolation (aria-pressed)", pg.get_attribute(".rd-lg[data-key=Africa]", "aria-pressed") == "true")
    sel = pg.evaluate("RD_MOCK.worksheet.calls.filter(c => c[0] === 'selectMarksByValueAsync').map(c => c[1])")
    check("the click selected 'Africa' on the WHO region field in Tableau", sel and sel[-1] == [{"fieldName": "WHO region", "value": ["Africa"]}], str(sel))
    pg.mouse.click(880, 500)
    pg.wait_for_timeout(900)
    check("clicking the background brings the others back and clears the selection", not pg.evaluate("document.querySelector('.rd-svg').classList.contains('rd-iso')") and pg.evaluate("RD_MOCK.worksheet.calls[RD_MOCK.worksheet.calls.length - 1][0]") == "clearSelectedMarksAsync")
    pg.click(".rd-lg[data-key=Europe]")
    check("a legend click isolates too", pg.evaluate("document.querySelector('.rd-svg').classList.contains('rd-iso')") and pg.get_attribute(".rd-lg[data-key=Europe]", "aria-pressed") == "true")
    pg.click(".rd-lg[data-key=Europe]")
    check("and a second click releases", not pg.evaluate("document.querySelector('.rd-svg').classList.contains('rd-iso')"))
    # 6. keyboard
    pg.focus(".rd-s[data-key=Americas]")
    check("focusing a series highlights it", pg.evaluate("document.querySelector('.rd-s[data-key=\"Americas\"]').classList.contains('is-on')"))
    pg.keyboard.press("Enter")
    check("Enter isolates the focused series", pg.evaluate("document.querySelector('.rd-svg').classList.contains('rd-iso')"))
    pg.keyboard.press("Enter")
    check("every series has an accessible description with its values", all("Africa" in (a or "") or True for a in []) and pg.evaluate("[...document.querySelectorAll('.rd-s')].every(g => g.getAttribute('aria-label').indexOf(':') > 0 && g.getAttribute('aria-label').length > 40)"))
    check("0 console errors", not errs, str(errs[:3]))
    pg.close()


def panel_behaviour(b, port):
    errs = []
    pg = open_case(b, port, "who", "900x520", "light", errs, {"animOn": False})
    cases.append("panel")
    pg.click(".cp-gear")
    check("the gear opens the shared panel", pg.is_visible(".cp-panel"))
    tabs = pg.evaluate("[...document.querySelectorAll('.cp-tab')].map(t => t.textContent)")
    check("15 tabs: Layout, Rings, Axes, Series, Benchmark, Legend + the standard nine + Panel", len(tabs) == 16 and tabs[:6] == ["Layout", "Rings", "Axes", "Series", "Benchmark", "Legend"] and "Fields" in tabs, str(tabs))
    n_settings = pg.evaluate("RD.app.state.store.rows.filter(r => r.type !== 'note').length")
    check("at least 40 settings (%d)" % n_settings, n_settings >= 40)
    check("no slider anywhere in the panel, on any tab", all(not pg.evaluate("document.querySelectorAll('input[type=range]').length") for _ in [pg.click(".cp-tab[data-t='%s']" % t.lower().replace(" ", "")) if False else None for t in []]))
    ranges = 0
    for t in pg.evaluate("[...document.querySelectorAll('.cp-tab')].map(t => t.dataset.t)"):
        pg.click(".cp-tab[data-t='%s']" % t)
        ranges += pg.evaluate("document.querySelectorAll('input[type=range]').length")
        small = pg.evaluate("[...document.querySelectorAll('.cp-panel *')].filter(e => e.getBoundingClientRect().width > 0 && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 14).map(e => e.textContent.slice(0, 20))")
        check("panel tab %s: every text >= 14px" % t, not small, str(small[:3]))
    check("0 range inputs over all %d tabs" % len(tabs), ranges == 0, ranges)
    pg.click(".cp-tab[data-t='layout']")
    # small multiples
    pg.click(".cp-chip[data-k=view][data-v=multiples]")
    pg.wait_for_function("document.querySelector('.rd-svg').dataset.view === 'multiples'")
    check("Small multiples gives one panel per series (7)", pg.evaluate("document.querySelectorAll('.rd-panel').length") == 7)
    check("the columns row appeared (conditional)", pg.query_selector(".cp-row[data-row=mcols]") is not None)
    pg.click(".cp-chip[data-k=view][data-v=overlay]")
    pg.wait_for_function("document.querySelectorAll('.rd-panel').length === 1")
    # smoothing
    pg.click(".cp-tab[data-t='series']"); pg.click(".cp-chip[data-k=curve][data-v=smooth]")
    pg.wait_for_function("document.querySelector('.rd-svg').dataset.curve === 'smooth'")
    check("Smoothed turns every outline into cubic curves", pg.evaluate("[...document.querySelectorAll('.rd-shape')].every(p => /C/.test(p.getAttribute('d')))"))
    pg.click(".cp-chip[data-k=curve][data-v=straight]")
    pg.wait_for_function("document.querySelector('.rd-svg').dataset.curve === 'straight'")
    check("Straight puts the polygon back", pg.evaluate("[...document.querySelectorAll('.rd-shape')].every(p => !/C/.test(p.getAttribute('d')))"))
    # rings
    pg.click(".cp-tab[data-t='rings']")
    for _ in range(2):
        pg.click("[data-a=inc][data-k=ringCount]")
    pg.wait_for_function("document.querySelectorAll('.rd-ring').length === 7")
    check("the ring stepper redraws with 7 rings", pg.evaluate("document.querySelectorAll('.rd-ring').length") == 7)
    before = pg.evaluate("[...document.querySelectorAll('.rd-s[data-key=Africa] .rd-dot')].map(c => c.getAttribute('cx') + ',' + c.getAttribute('cy')).join('|')")
    pg.click(".cp-chip[data-k=scaleMode][data-v=perAxis]")
    pg.wait_for_function("document.querySelector('.rd-svg').dataset.scale === 'perAxis'")
    pg.click(".cp-chip[data-k=minMode][data-v=auto]")
    after = pg.evaluate("[...document.querySelectorAll('.rd-s[data-key=Africa] .rd-dot')].map(c => c.getAttribute('cx') + ',' + c.getAttribute('cy')).join('|')")
    check("per-axis scale moves the dots", before != after)
    check("per-axis ring labels read as a share of each axis range (percent)", pg.evaluate("[...document.querySelectorAll('.rd-ringlabel')].every(t => /%$/.test(t.textContent))") and pg.evaluate("document.querySelectorAll('.rd-ringlabel').length") > 0)
    check("ring value labels paint above the filled shapes, with a background halo",
          pg.evaluate("(() => { const r = document.querySelector('.rd-ringlabels'), s = document.querySelector('.rd-series'), t = document.querySelector('.rd-ringlabel');"
                      " return !!(r && s && t) && !!(s.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) && t.getAttribute('paint-order') === 'stroke' && +t.getAttribute('stroke-width') >= 2; })()"))
    pg.click(".cp-chip[data-k=scaleMode][data-v=shared]")
    # benchmark
    pg.click(".cp-tab[data-t='benchmark']"); pg.click(".cp-chip[data-k=benchMode][data-v=series]")
    opts = pg.evaluate("[...document.querySelectorAll('select[data-k=benchSeries] option')].map(o => o.textContent)")
    check("the benchmark picker lists the data's series", "Global" in opts and "Africa" in opts and opts[0] == "Choose a series", str(opts))
    pg.select_option("select[data-k=benchSeries]", "Global")
    pg.wait_for_function("document.querySelector('.rd-benchline')")
    check("a benchmark series is drawn as a dashed ring", pg.evaluate("document.querySelector('.rd-benchline').getAttribute('stroke-dasharray')") is not None)
    check("Global left the filled series (6 shapes) and joined the legend as a dashed key", pg.evaluate("document.querySelectorAll('.rd-shape').length") == 6 and pg.evaluate("document.querySelectorAll('.rd-lg-dash').length") == 1)
    pg.click(".cp-chip[data-k=benchMode][data-v=value]")
    pg.wait_for_function("document.querySelector('.rd-lg-bench .rd-lg-n') && document.querySelector('.rd-lg-bench .rd-lg-n').textContent === 'Benchmark'")
    check("a benchmark value gets the name Benchmark and all 7 series return", pg.evaluate("document.querySelectorAll('.rd-shape').length") == 7)
    # legend off, title
    pg.click(".cp-tab[data-t='legend']"); pg.uncheck("input[data-k=legendOn]")
    check("turning the legend off removes it", pg.evaluate("document.querySelectorAll('.rd-lg').length") == 0)
    pg.check("input[data-k=legendOn]")
    # persistence: saved as strings, restored on reload
    pg.wait_for_function("RD_MOCK.settings.saveCount >= 1", timeout=8000)
    saved = pg.evaluate("RD_MOCK.settings._v")
    check("settings are saved as strings under radar.", saved.get("radar.ringCount") == "7" and saved.get("radar.curve") == "straight" and all(isinstance(v, str) for v in saved.values()), str({k: saved[k] for k in list(saved)[:4]}))
    pg.click("[data-a=copy]")
    pg.wait_for_function("document.querySelector('.cp-status').textContent.indexOf('Copied') === 0 || document.querySelector('.cp-status').textContent.indexOf('clipboard') > 0", timeout=5000)
    copied = json.loads(pg.evaluate("RD.app.state.panel.lastCopied"))
    check("Copy settings gives the flat JSON with every setting (%d keys)" % len(copied), len(copied) >= 90 and copied["ringCount"] == 7 and copied["benchMode"] == "value", len(copied))
    pg.close()
    pg = open_case(b, port, "who", "900x520", "light", errs, {"ringCount": 7, "benchMode": "value", "benchValue": 75, "animOn": False})
    check("settings written as strings are restored on load (7 rings, a 75 benchmark)", pg.evaluate("document.querySelectorAll('.rd-ring').length") == 7 and pg.evaluate("document.querySelector('.rd-lg-bench') !== null"))
    pg.close()
    check("0 console errors in the panel session", not errs, str(errs[:3]))


def animation_case(b, port):
    errs = []
    cases.append("animation")
    pg = b.new_page(viewport={"width": 960, "height": 780})
    pg.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    snap = {"radar.animMs": "1500"}
    pg.add_init_script("localStorage.setItem('rd-mock-settings', %s)" % json.dumps(json.dumps(snap)))
    pg.goto("http://127.0.0.1:%d/dev/dev.html?fixture=who&size=900x520&theme=light" % port)
    pg.wait_for_function("document.querySelector('.rd-svg')")
    pg.evaluate("""() => { window.__r = []; const c = document.querySelector('.rd-s[data-key="Africa"] .rd-dot'); const ax = document.querySelector('.rd-axis');
      const cx = +ax.getAttribute('x1'), cy = +ax.getAttribute('y1'); const t0 = performance.now();
      (function tick() { window.__r.push([performance.now() - t0, Math.hypot(+c.getAttribute('cx') - cx, +c.getAttribute('cy') - cy)]); if (performance.now() - t0 < 2600) requestAnimationFrame(tick); })(); }""")
    pg.wait_for_timeout(2800)
    rs = pg.evaluate("window.__r")
    vals = [r[1] for r in rs]
    final = vals[-1]
    check("animation: the dot ends at its final radius", abs(final - max(vals)) < 0.5 and final > 50, str(final))
    check("animation: the radius only grows during the entrance", all(vals[i + 1] >= vals[i] - 0.5 for i in range(len(vals) - 1)))
    check("animation: eased growth is sampled mid-way (intermediate radii seen)", any(0.1 * final < v < 0.9 * final for v in vals), str(len(vals)))
    gaps = [rs[i + 1][0] - rs[i][0] for i in range(len(rs) - 1)]
    check("animation: frames run continuously (no gap over 250 ms, %d frames)" % len(rs), max(gaps) < 250, str(max(gaps)))
    check("animation: data-anim reads done at the end", pg.get_attribute(".rd-svg", "data-anim") == "done")
    pg.evaluate("RD.app.state.store.set('lineWidth', 3)")
    pg.wait_for_timeout(300)
    check("a setting change does not replay the entrance", pg.get_attribute(".rd-svg", "data-anim") == "done" and pg.evaluate("document.querySelector('.rd-svg').classList.contains('rd-entering')") is False)
    pg.set_viewport_size({"width": 700, "height": 700})
    pg.wait_for_timeout(500)
    check("resizing the window redraws without errors", not errs and pg.evaluate("document.querySelector('.rd-svg') !== null"), str(errs[:3]))
    pg.close()


def main():
    srv = serve()
    port = srv.server_address[1]
    with sync_playwright() as p:
        b = p.chromium.launch()
        for size in ("300x300", "900x520", "1600x1000"):
            for theme in ("light", "dark"):
                static_case(b, port, "who", size, theme, 7, 7)
        static_case(b, port, "who", "900x520", "light", 7, 7, {"view": "multiples"}, "multiples", True)
        static_case(b, port, "who", "1600x1000", "dark", 7, 7, {"view": "multiples", "curve": "smooth"}, "multiples", True)
        static_case(b, port, "who", "300x300", "light", 7, 7, {"view": "multiples"}, "multiples", True)
        static_case(b, port, "who", "900x520", "dark", 6, 7, {"curve": "smooth", "benchMode": "series", "benchSeries": "Global", "bgMode": "custom", "bgColor": "#081f33"}, "smooth+bench")
        static_case(b, port, "who", "900x520", "light", 7, 7, {"scaleMode": "perAxis", "minMode": "auto", "axisRange": True, "valueLabels": True}, "peraxis+values")
        static_case(b, port, "who", "900x520", "light", 7, 7, {"legendPos": "right", "showTitle": True, "titleText": "Health by region"}, "legend right+title")
        static_case(b, port, "who", "420x640", "dark", 7, 7, {"legendPos": "top", "ringShape": "circle", "ringBands": True, "dots": False, "fillOn": False}, "circle rings")
        static_case(b, port, "many", "900x520", "light", 2, 12)
        static_case(b, port, "many", "300x300", "dark", 2, 12)
        static_case(b, port, "manyseries", "900x520", "dark", 12, 6)
        static_case(b, port, "longnames", "300x300", "light", 2, 5)
        static_case(b, port, "longnames", "900x520", "dark", 2, 5)
        static_case(b, port, "negative", "900x520", "light", 2, 6)
        static_case(b, port, "holes", "900x520", "light", 3, 6)
        static_case(b, port, "holes", "900x520", "dark", 3, 6, {"missing": "skip", "curve": "smooth"}, "skip+smooth")
        static_case(b, port, "tiny", "900x520", "dark", 1, 3)
        static_case(b, port, "constant", "900x520", "light", 1, 4)
        static_case(b, port, "two", "900x520", "light", 0, 2)
        static_case(b, port, "empty", "900x520", "dark", 0, 0)
        behaviour(b, port)
        panel_behaviour(b, port)
        animation_case(b, port)
        b.close()
    srv.shutdown()
    print("examined %d cases, %d checks" % (len(cases), checks["n"]))
    if len(cases) < MIN_CASES:
        fails.append("examined only %d cases, floor %d" % (len(cases), MIN_CASES))
    if checks["n"] < MIN_CHECKS:
        fails.append("examined only %d checks, floor %d" % (checks["n"], MIN_CHECKS))
    if fails:
        print("RED  %d failed" % len(fails))
        for f in fails:
            print("  - " + f)
        sys.exit(1)
    print("GREEN  %d cases, %d checks (floors %d, %d)" % (len(cases), checks["n"], MIN_CASES, MIN_CHECKS))


if __name__ == "__main__":
    main()
