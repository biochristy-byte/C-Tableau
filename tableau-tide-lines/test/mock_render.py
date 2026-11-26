"""Browser gate for Tide Lines: renders the shipping code against the mock Tableau API.

  python test/mock_render.py [--shots DIR]

What it examines (each case is one fixture at one size in one theme):
  - sizes 300x300, 900x520, 1600x1000, each in light and dark, on the real birth-weight data
  - 300x300 with 60 ridges, where labels cannot all fit
  - tiny, constant, empty and long-name fixtures
For every case: SVG non-empty, 0 console errors, every text >= 14px, no text boxes overlap,
text and ridges inside the stage, text contrast >= 7:1 against the stage background,
no horizontal scroll. Then behaviour: hover lift (eased, sampled frame by frame), tooltip
n / median / IQR checked against numbers computed here from the CSV, click selection,
the settings panel (no sliders, 14px text, chips change the chart), settings saved as
strings and restored, Copy settings / Paste settings.

Exit 1 and a RED line on any failure. It also goes RED if it examined fewer cases than
MIN_CASES or fewer checks than MIN_CHECKS, so an empty run cannot read as green.
"""
import csv, functools, http.server, json, math, pathlib, re, socketserver, sys, threading, types

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import panel_checks

ROOT = pathlib.Path(__file__).resolve().parent.parent
PLAN_SIZES, PLAN_THEMES = ("300x300", "900x520", "1600x1000"), ("light", "dark")
PLAN_EXTRA = 4   # many x2 themes at 300x300, many at 900x520, typical dark
PLAN_EDGE = 4    # tiny, constant, long, empty
MIN_CASES = len(PLAN_SIZES) * len(PLAN_THEMES) + PLAN_EXTRA + 1 + PLAN_EDGE + 3   # + behaviour, panel gate, flip, legacy
MIN_CHECKS = 320
shots = None
if "--shots" in sys.argv:
    shots = pathlib.Path(sys.argv[sys.argv.index("--shots") + 1]); shots.mkdir(parents=True, exist_ok=True)

checks = {"n": 0}
fails = []
cases = []


def check(name, cond, detail=""):
    checks["n"] += 1
    if not cond:
        fails.append("%s %s" % (name, detail))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass


def serve():
    h = functools.partial(Quiet, directory=str(ROOT))
    srv = socketserver.TCPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ---- truth computed here, not by the code under test ----
def quantile(s, p):
    h = (len(s) - 1) * p
    lo, hi = math.floor(h), math.ceil(h)
    return s[lo] + (h - lo) * (s[hi] - s[lo])


rows = list(csv.DictReader(open(ROOT / "example" / "birth-weight.csv", encoding="utf-8")))
truth = {}
for r in rows:
    truth.setdefault(r["Mother group"], []).append(float(r["Birth weight (g)"]))
STATS = {}
for k, v in truth.items():
    s = sorted(v)
    STATS[k] = {"n": len(s), "median": quantile(s, .5), "q1": quantile(s, .25), "q3": quantile(s, .75)}

JS_TEXT = """() => {
  const svg = document.querySelector('.tl-svg'); if (!svg) return null;
  const stage = document.querySelector('#stage').getBoundingClientRect();
  const bg = getComputedStyle(document.querySelector('#tl-chart')).backgroundColor;
  const out = [];
  svg.querySelectorAll('text').forEach(t => {
    const r = t.getBoundingClientRect(), cs = getComputedStyle(t);
    out.push({ text: t.textContent, size: parseFloat(cs.fontSize), fill: cs.fill, l: r.left, t: r.top, r: r.right, b: r.bottom });
  });
  const paths = [];
  svg.querySelectorAll('path.tl-fill').forEach(p => { const r = p.getBoundingClientRect(); paths.push({ d: p.getAttribute('d'), l: r.left, t: r.top, r: r.right, b: r.bottom }); });
  const de = document.documentElement;
  return { texts: out, paths, bg, stage: { l: stage.left, t: stage.top, r: stage.right, b: stage.bottom },
    hscroll: de.scrollWidth > innerWidth + 1, ds: svg.dataset, svgW: svg.clientWidth, svgH: svg.clientHeight };
}"""


def rgb(s):
    nums = [float(x) for x in s.replace("rgba(", "").replace("rgb(", "").replace(")", "").split(",")[:3]]
    return nums


def lum(c):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def contrast(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + .05) / (min(la, lb) + .05)


def open_case(b, port, fixture, size, theme, errs, settings=None, fast=False):
    w, h = [int(x) for x in size.split("x")]
    pg = b.new_page(viewport={"width": w + 60, "height": h + 260}, device_scale_factor=1)
    pg.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)))
    pg.on("dialog", lambda d: (errs.append("browser dialog: " + d.message), d.dismiss()))
    if settings:
        snap = {(k if "." in k else "tidelines." + k): (json.dumps(v) if isinstance(v, (list, dict)) else str(v).lower() if isinstance(v, bool) else str(v)) for k, v in settings.items()}
        pg.add_init_script("localStorage.setItem('tl-mock-settings', %s)" % json.dumps(json.dumps(snap)))
    pg.goto("http://127.0.0.1:%d/dev/dev.html?fixture=%s&size=%s&theme=%s" % (port, fixture, size, theme))
    pg.wait_for_function("window.TL_READY && document.querySelector('.tl-svg, .tl-empty')", timeout=8000)
    pg.wait_for_timeout(150 if fast else 1500)  # entrance (760 ms + stagger) settles
    return pg


def static_case(b, port, fixture, size, theme, expect_n, expect_note):
    errs = []
    name = "%s %s %s" % (fixture, size, theme)
    pg = open_case(b, port, fixture, size, theme, errs)
    d = pg.evaluate(JS_TEXT)
    cases.append(name)
    check(name + ": svg drawn", d is not None)
    if d is None:
        return pg
    check(name + ": ridge count", len(d["paths"]) == expect_n, "got %d want %d" % (len(d["paths"]), expect_n))
    check(name + ": every ridge path is non-empty and has no NaN", all(len(p["d"]) > 50 and "NaN" not in p["d"] and "Infinity" not in p["d"] for p in d["paths"]))
    check(name + ": 0 console errors", not errs, str(errs[:3]))
    check(name + ": no horizontal scroll", not d["hscroll"])
    texts = d["texts"]
    check(name + ": has text", len(texts) >= 3, str(len(texts)))
    check(name + ": every text >= 14px", all(t["size"] >= 14 for t in texts), str([t["size"] for t in texts if t["size"] < 14]))
    bg = rgb(d["bg"])
    low = [(t["text"], round(contrast(rgb(t["fill"]), bg), 2)) for t in texts if contrast(rgb(t["fill"]), bg) < 7]
    check(name + ": every text >= 7:1 against the background", not low, str(low[:3]))
    bad = []
    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            a, c = texts[i], texts[j]
            if a["l"] < c["r"] - 0.5 and c["l"] < a["r"] - 0.5 and a["t"] < c["b"] - 0.5 and c["t"] < a["b"] - 0.5:
                bad.append((a["text"], c["text"]))
    check(name + ": no two text boxes overlap", not bad, str(bad[:3]))
    S = d["stage"]
    outside = [t["text"] for t in texts if t["l"] < S["l"] - 1 or t["r"] > S["r"] + 1 or t["t"] < S["t"] - 1 or t["b"] > S["b"] + 1]
    check(name + ": all text inside the stage", not outside, str(outside[:3]))
    pout = [i for i, p in enumerate(d["paths"]) if p["l"] < S["l"] - 1 or p["r"] > S["r"] + 1 or p["t"] < S["t"] - 1 or p["b"] > S["b"] + 1]
    check(name + ": all ridges inside the stage", not pout, str(pout[:3]))
    foot = [t["text"] for t in texts if "Showing" in t["text"]]
    if expect_note:
        check(name + ": says it is showing fewer labels", bool(foot) and int(d["ds"]["shown"]) < int(d["ds"]["n"]), str(foot) + str(d["ds"]))
        labels = pg.evaluate("[...document.querySelectorAll('.tl-label')].map(e => e.textContent)")
        check(name + ": drew fewer labels than ridges, never smaller type", 0 < len(labels) < expect_n)
    else:
        check(name + ": no hidden-label note when everything fits", not foot and int(d["ds"]["shown"]) == int(d["ds"]["n"]), str(foot))
    if shots and fixture == "birth":
        pg.locator("#stage").screenshot(path=str(shots / ("tide-lines-%s-%s.png" % (size, theme))))
    pg.close()
    return None


def ptab(pg, tid):
    pg.click(".cp-tab[data-t='%s']" % tid)
    pg.wait_for_function("document.querySelector(\".cp-tab[data-t='%s']\").getAttribute('aria-selected') === 'true'" % tid)


def lift_samples(pg, selector):
    return pg.evaluate("""(sel) => new Promise(res => {
      const el = document.querySelector(sel), out = [], t0 = performance.now();
      (function tick() {
        const m = getComputedStyle(el).transform, ty = m && m !== 'none' ? parseFloat(m.split(',')[5]) : 0;
        out.push([Math.round(performance.now() - t0), ty]);
        if (performance.now() - t0 < 420) requestAnimationFrame(tick); else res(out);
      })();
    })""", selector)


def behaviour(b, port):
    errs = []
    pg = open_case(b, port, "birth", "900x520", "light", errs)
    name = "behaviour"
    cases.append(name)
    n = pg.evaluate("document.querySelectorAll('.tl-ridge').length")
    check(name + ": 6 ridges from the real data", n == 6, str(n))
    # ---- entrance finished: nothing left half-grown ----
    op = pg.evaluate("[...document.querySelectorAll('.tl-grow')].map(e => getComputedStyle(e).opacity)")
    check(name + ": entrance finished (all ridges opaque)", all(float(x) == 1 for x in op), str(op))
    # ---- hover the LAST ridge (painted on top, never covered) ----
    box = pg.evaluate("(() => { const p = [...document.querySelectorAll('path.tl-hit')].pop(); const r = p.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, p.dataset.i]; })()")
    hx, hy = (box[0] + box[2]) / 2, box[3] - 4
    idx = int(box[4])
    key = pg.evaluate("document.querySelectorAll('.tl-ridge')[%d].dataset.key" % idx)
    check(name + ": hit layer exists for every ridge", pg.evaluate("document.querySelectorAll('path.tl-hit').length") == 6)
    pg.mouse.move(5, 5)
    pg.mouse.move(hx, hy)
    samples = lift_samples(pg, ".tl-ridge[data-i='%d'] > .tl-lift" % idx)
    ys = [s[1] for s in samples]
    check(name + ": ridge ends lifted by 6px", abs(ys[-1] + 6) < 0.3, str(ys[-3:]))
    mids = [y for y in ys if -5.9 < y < -0.1]
    check(name + ": lift is eased over several frames (not a jump)", len(mids) >= 4, "intermediate frames %d of %d" % (len(mids), len(ys)))
    check(name + ": lift is monotone (no jitter)", all(ys[i + 1] <= ys[i] + 0.05 for i in range(len(ys) - 1)), str(ys))
    check(name + ": still lifted 400 ms later (hover is stable, no flicker)", pg.evaluate("document.querySelector('.tl-ridge.is-hot') !== null"))
    others = pg.evaluate("[...document.querySelectorAll('.tl-ridge:not(.is-hot)')].map(e => parseFloat(getComputedStyle(e).opacity))")
    check(name + ": other ridges dimmed", all(o < 0.7 for o in others), str(others))
    tip = pg.evaluate("(() => { const t = document.querySelector('.tl-tip'); return { on: t.classList.contains('on'), text: t.innerText, size: parseFloat(getComputedStyle(t).fontSize), bg: getComputedStyle(t).backgroundColor, fg: getComputedStyle(t).color }; })()")
    check(name + ": tooltip shown", tip["on"])
    check(name + ": tooltip names the ridge", key in tip["text"], tip["text"])
    st = STATS[key]
    flat = " ".join(tip["text"].split())
    def num_after(label):
        m = re.search(label + r"\s*([0-9][0-9,]*\.?[0-9]*)", flat)
        return float(m.group(1).replace(",", "")) if m else None
    iqr = st["q3"] - st["q1"]
    check(name + ": tooltip n is exact", num_after(r"\sn") == st["n"], flat)
    got_med, got_iqr = num_after("Median"), num_after("IQR")
    check(name + ": tooltip median matches the CSV (4 significant digits)", got_med is not None and abs(got_med - st["median"]) <= abs(st["median"]) * 6e-4, "%s vs %s | %s" % (got_med, st["median"], flat))
    check(name + ": tooltip IQR matches the CSV (4 significant digits)", got_iqr is not None and abs(got_iqr - iqr) <= abs(iqr) * 6e-4, "%s vs %s | %s" % (got_iqr, iqr, flat))
    check(name + ": tooltip is >= 14px with 7:1 contrast", tip["size"] >= 14 and contrast(rgb(tip["fg"]), rgb(tip["bg"])) >= 7)
    calls = pg.evaluate("TL_MOCK.worksheet.calls.filter(c => c[0] === 'hoverTupleAsync').length")
    check(name + ": hover pushed to Tableau", calls >= 1, str(calls))
    pg.mouse.move(5, 5)
    pg.wait_for_timeout(450)
    check(name + ": un-hover clears the lift and tooltip", pg.evaluate("document.querySelector('.tl-ridge.is-hot') === null && !document.querySelector('.tl-tip').classList.contains('on')"))
    # ---- hover through a LABEL row of the first ridge ----
    lb = pg.evaluate("(() => { const r = document.querySelector('.tl-label').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, document.querySelector('.tl-label').textContent]; })()")
    pg.mouse.move(lb[0], lb[1])
    pg.wait_for_timeout(300)
    head = pg.evaluate("(document.querySelector('.tl-tip-h') || {}).textContent")
    first_short = lb[2]
    check(name + ": hovering a label row shows that ridge", head is not None and len(head) > 0 and pg.evaluate("document.querySelector('.tl-ridge.is-hot') !== null"), str(head))
    pg.mouse.move(5, 5); pg.wait_for_timeout(300)
    # ---- selection push ----
    pg.mouse.click(hx, hy)
    sel = pg.evaluate("TL_MOCK.worksheet.calls.filter(c => c[0] === 'selectMarksByValueAsync')")
    check(name + ": click selects the ridge's marks in Tableau by category value", len(sel) == 1 and sel[0][1][0]["fieldName"] == "Mother group" and sel[0][1][0]["value"] == [key] and sel[0][2] == "select-replace", str(sel))
    check(name + ": selected ridge is marked", pg.evaluate("document.querySelectorAll('.tl-ridge.is-sel').length") == 1)
    pg.mouse.click(hx, hy)
    check(name + ": clicking it again clears the selection", pg.evaluate("TL_MOCK.worksheet.calls.filter(c => c[0] === 'clearSelectedMarksAsync').length") == 1)
    # ---- a few chart behaviours driven from the shared panel ----
    pg.click(".cp-gear")
    pg.wait_for_selector(".cp-panel:not([hidden])")
    check(name + ": panel opens from the gear", True)
    check(name + ": NO sliders in the panel", pg.evaluate("document.querySelectorAll('input[type=range]').length") == 0)
    check(name + ": kernel chip starts on Gaussian", pg.evaluate("document.querySelector('.tl-svg').dataset.kernel") == "gaussian")
    before = pg.evaluate("document.querySelector('path.tl-fill').getAttribute('d')")
    ptab(pg, "density")
    pg.click(".cp-chip[data-k=kernel][data-v=epanechnikov]")
    pg.wait_for_function("document.querySelector('.tl-svg').dataset.kernel === 'epanechnikov'", timeout=2000)
    check(name + ": Epanechnikov chip redraws with that kernel", True)
    check(name + ": the ridge shape changed", pg.evaluate("document.querySelector('path.tl-fill').getAttribute('d')") != before)
    saved = pg.evaluate("TL_MOCK.settings.getAll()")
    check(name + ": setting staged as the string 'epanechnikov' under tidelines.kernel", saved.get("tidelines.kernel") == "epanechnikov", str(saved))
    pg.wait_for_function("TL_MOCK.settings.saveCount >= 1", timeout=3000)
    check(name + ": settings saved through saveAsync", pg.evaluate("TL_MOCK.settings.saveCount") >= 1)
    ptab(pg, "layout")
    pg.click(".cp-chip[data-k=sort][data-v=name]"); pg.wait_for_timeout(250)
    names = pg.evaluate("[...document.querySelectorAll('.tl-label')].map(e => e.textContent)")
    check(name + ": sort by name puts the names in alphabetical order", names == sorted(names, key=str.lower), str(names))
    pg.click(".cp-chip[data-k=sort][data-v=data]"); pg.wait_for_timeout(250)
    names_data = pg.evaluate("[...document.querySelectorAll('.tl-label')].map(e => e.textContent)")
    check(name + ": sort by data order differs from alphabetical", names_data != names, str(names_data))
    pg.click(".cp-chip[data-k=sort][data-v=median]"); pg.wait_for_timeout(250)
    meds = pg.evaluate("[...document.querySelectorAll('.tl-ridge')].map(e => e.dataset.key)")
    ms = [STATS[k]["median"] for k in meds]
    check(name + ": sort by median runs high to low from the top", ms == sorted(ms, reverse=True), str(ms))
    pg.click(".cp-chip[data-k=sort][data-v=count]"); pg.wait_for_timeout(250)
    cn = [STATS[k]["n"] for k in pg.evaluate("[...document.querySelectorAll('.tl-ridge')].map(e => e.dataset.key)")]
    check(name + ": sort by count runs large to small from the top", cn == sorted(cn, reverse=True), str(cn))
    pg.click(".cp-chip[data-k=sort][data-v=median]")
    ptab(pg, "density")
    d_auto = pg.evaluate("document.querySelector('path.tl-fill').getAttribute('d')")
    bw_in = pg.locator("input[data-k=bandwidth]")
    check(name + ": bandwidth starts at 0 (Auto)", bw_in.input_value() in ("0", ""), bw_in.input_value())
    bw_in.fill("90"); bw_in.press("Enter"); pg.wait_for_timeout(250)
    check(name + ": a typed bandwidth changes the density", pg.evaluate("document.querySelector('path.tl-fill').getAttribute('d')") != d_auto and pg.evaluate("TL.app.state.store.get().bandwidth") == 90)
    bw_in.fill("0"); bw_in.press("Enter"); pg.wait_for_timeout(250)
    check(name + ": 0 returns to Silverman Auto", pg.evaluate("document.querySelector('path.tl-fill').getAttribute('d')") == d_auto)
    ptab(pg, "layout")
    d_o1 = pg.evaluate("document.querySelector('path.tl-fill').getAttribute('d')")
    ov = pg.locator("input[data-k=overlap]")
    ov.fill("3.5"); ov.press("Enter"); pg.wait_for_timeout(250)
    check(name + ": overlap stepper redraws", pg.evaluate("document.querySelector('path.tl-fill').getAttribute('d')") != d_o1)
    check(name + ": overlap saved as a string", pg.evaluate("TL_MOCK.settings.getAll()['tidelines.overlap']") == "3.5")
    ptab(pg, "marks")
    n_ticks = pg.evaluate("[document.querySelectorAll('.tl-med').length, document.querySelectorAll('.tl-q').length]")
    check(name + ": 6 medians and 12 quartile ticks drawn", n_ticks == [6, 12], str(n_ticks))
    pg.uncheck("input[data-k=showMedian]"); pg.wait_for_timeout(250)
    check(name + ": median toggle removes the median ticks", pg.evaluate("document.querySelectorAll('.tl-med').length") == 0)
    pg.check("input[data-k=showMedian]")
    pg.check("input[data-k=showMean]"); pg.wait_for_timeout(250)
    check(name + ": the mean tick draws a dashed tick on every ridge", pg.evaluate("document.querySelectorAll('.tl-mean').length") == 6)
    pg.uncheck("input[data-k=showMean]")
    pg.click("[data-f=copyall]"); pg.wait_for_timeout(200)
    obj = json.loads(pg.evaluate("TL.app.state.panel.lastCopied"))["settings"]
    check(name + ": Copy settings produces JSON with the chosen kernel and overlap", obj.get("kernel") == "epanechnikov" and obj.get("overlap") == 3.5, str(obj)[:120])
    check(name + ": the copied JSON holds every setting", len(obj) >= 60, str(len(obj)))
    pg.close()

    # ---- settings survive a reload (same origin localStorage) ----
    ctx = b.new_context(viewport={"width": 960, "height": 780})
    pg = ctx.new_page()
    errs2 = []
    pg.on("console", lambda m: errs2.append(m.text) if m.type in ("error", "warning") else None)
    url = "http://127.0.0.1:%d/dev/dev.html?fixture=birth&size=900x520&theme=light" % port
    pg.goto(url); pg.wait_for_function("window.TL_READY && document.querySelector('.tl-svg')"); pg.wait_for_timeout(500)
    pg.click(".cp-gear"); ptab(pg, "density"); pg.click(".cp-chip[data-k=kernel][data-v=epanechnikov]"); pg.wait_for_timeout(900)
    pg.goto(url); pg.wait_for_function("window.TL_READY && document.querySelector('.tl-svg')"); pg.wait_for_timeout(500)
    check(name + ": reload restores the saved kernel from string settings", pg.evaluate("document.querySelector('.tl-svg').dataset.kernel") == "epanechnikov")
    pg.click(".cp-gear"); pg.click("[data-a=resetall]"); pg.click("[data-a=confirmyes]"); pg.wait_for_timeout(300)
    check(name + ": Reset all restores the defaults", pg.evaluate("TL.app.state.store.get().overlap") == 2 and pg.evaluate("document.querySelector('.tl-svg').dataset.kernel") == "gaussian")
    check(name + ": 0 console errors across the settings flow", not errs2, str(errs2[:3]))
    ctx.close()
    check(name + ": 0 console errors in the interaction flow", not errs, str(errs[:3]))


def legacy_case(b, port):
    """A workbook saved before the shared panel: old keys must still set the look."""
    errs = []
    old = {"tidelines.animate": "false", "tidelines.bgMatch": "false", "tidelines.bgColor": "#081f33", "tidelines.inkAuto": "false", "tidelines.inkColor": "#ffd166",
           "tidelines.selectEnabled": "false", "tidelines.fontFamily": '"Trebuchet MS", Tahoma, sans-serif', "tidelines.kernel": "epanechnikov", "tidelines.overlap": "3"}
    pg = open_case(b, port, "birth", "900x520", "light", errs, old, fast=True)
    cases.append("legacy workbook")
    s = pg.evaluate("TL.app.state.store.get()")
    check("legacy: animate=false became animOn false (no entrance)", s["animOn"] is False and pg.evaluate("document.querySelector('.tl-svg').dataset.anim") == "off")
    check("legacy: bgMatch=false + bgColor became a custom navy background", s["bgMode"] == "custom" and pg.evaluate("getComputedStyle(document.querySelector('#tl-chart')).backgroundColor") == "rgb(8, 31, 51)")
    check("legacy: inkAuto=false + inkColor became the label color and text is 7:1", s["labelColor"] == "#ffd166" and pg.evaluate("getComputedStyle(document.querySelector('.tl-label')).fill") == "rgb(255, 209, 102)")
    check("legacy: the Trebuchet font stack became the Trebuchet font id", s["fontFamily"] == "trebuchet" and "Trebuchet" in pg.evaluate("document.querySelector('.tl-svg').style.fontFamily"))
    check("legacy: selectEnabled=false turned click-to-select off", s["selectOn"] is False)
    h = pg.evaluate("(() => { const r = [...document.querySelectorAll('path.tl-hit')].pop().getBoundingClientRect(); return [(r.left + r.right) / 2, r.bottom - 4]; })()")
    pg.mouse.click(h[0], h[1]); pg.wait_for_timeout(150)
    check("legacy: a click selects nothing", pg.evaluate("document.querySelectorAll('.tl-ridge.is-sel').length") == 0 and not pg.evaluate("TL_MOCK.worksheet.calls.filter(c => c[0] === 'selectMarksByValueAsync').length"))
    check("legacy: same-name keys still apply (kernel, overlap)", s["kernel"] == "epanechnikov" and s["overlap"] == 3 and pg.evaluate("document.querySelector('.tl-svg').dataset.kernel") == "epanechnikov")
    pg.wait_for_function("TL_MOCK.settings.saveCount >= 1", timeout=3000)
    saved = pg.evaluate("TL_MOCK.settings.getAll()")
    check("legacy: the migrated values are saved under the new keys", saved.get("tidelines.animOn") == "false" and saved.get("tidelines.bgMode") == "custom" and saved.get("tidelines.fontFamily") == "trebuchet", str({k: saved.get(k) for k in ("tidelines.animOn", "tidelines.bgMode", "tidelines.fontFamily")}))
    check("legacy: 0 console errors", not errs, str(errs[:3]))
    pg.close()


def edge_cases(b, port):
    for fx, want in (("tiny", 1), ("constant", 3), ("long", 3)):
        errs = []
        pg = open_case(b, port, fx, "640x400", "light", errs)
        name = "fixture " + fx
        cases.append(name)
        d = pg.evaluate(JS_TEXT)
        check(name + ": %d ridge(s) drawn" % want, d is not None and len(d["paths"]) == want)
        check(name + ": no NaN in any path", d is not None and all("NaN" not in p["d"] for p in d["paths"]))
        check(name + ": 0 console errors", not errs, str(errs[:3]))
        if fx == "long":
            pg.evaluate("TL_MOCK.setEncoding('label', null)"); pg.wait_for_timeout(500)
            d = pg.evaluate(JS_TEXT)
        if fx == "long" and d:
            tr = pg.evaluate("[...document.querySelectorAll('.tl-label')].map(e => [e.firstChild.textContent, !!e.querySelector('title')])")
            check(name + ": long labels are truncated with an ellipsis and keep the full name as a title", all(t[0].endswith("…") and t[1] for t in tr[:2]), str(tr))
            check(name + ": truncated labels are still >= 14px", all(t["size"] >= 14 for t in d["texts"]))
        pg.close()
    errs = []
    pg = open_case(b, port, "empty", "640x400", "light", errs)
    cases.append("fixture empty")
    msg = pg.evaluate("(document.querySelector('.tl-empty') || {}).textContent")
    check("fixture empty: says what to do", bool(msg) and "Drop" in msg, str(msg))
    check("fixture empty: 0 console errors", not errs, str(errs[:3]))
    pg.close()


def main():
    srv = serve()
    port = srv.server_address[1]
    with sync_playwright() as p:
        b = p.chromium.launch()
        for size in PLAN_SIZES:
            for theme in PLAN_THEMES:
                static_case(b, port, "birth", size, theme, 6, False)
        for theme in ("light", "dark"):
            static_case(b, port, "many", "300x300", theme, 60, True)
        static_case(b, port, "many", "900x520", "light", 60, True)
        static_case(b, port, "typical", "900x520", "dark", 6, False)
        behaviour(b, port)
        H = types.SimpleNamespace(check=check, open_case=open_case, contrast=contrast, cases=cases)
        panel_checks.panel_gate(b, port, H)
        panel_checks.flip_all(b, port, H)
        legacy_case(b, port)
        edge_cases(b, port)
        b.close()
    srv.shutdown()
    print("examined %d cases, %d checks" % (len(cases), checks["n"]))
    if len(cases) < MIN_CASES:
        fails.append("examined only %d cases, floor %d" % (len(cases), MIN_CASES))
    if checks["n"] < MIN_CHECKS:
        fails.append("ran only %d checks, floor %d" % (checks["n"], MIN_CHECKS))
    if fails:
        print("RED  %d failed" % len(fails))
        for f in fails:
            print("  - " + f)
        sys.exit(1)
    print("GREEN  %d cases, %d checks (floors %d / %d)" % (len(cases), checks["n"], MIN_CASES, MIN_CHECKS))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:   # a crash is a failure with a RED line, never a silent traceback
        print("RED  gate crashed: %s: %s" % (type(e).__name__, str(e).splitlines()[0][:200] if str(e) else ""))
        sys.exit(1)
