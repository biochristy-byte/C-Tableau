"""Viz pages compatibility gate: drives Radar with the hub's REAL stand-in file.

  python test/standin_test.py [--shots DIR]

The stand-in (viz-extensions-hub/hosted/public/_vz/standin.js) is loaded unchanged and fed the WHO CSV
exactly as the hosted shell would (window.__CTAB_VIZ with dataUrl, encodings, settings, prefix). Five
settings shapes are tried: nested JSON with no prefix (what Copy settings produces), a flat string map
under prefix "radar.", a flat map under some other prefix, a round trip of the JSON the panel copies,
and no settings at all. Then the single-file standalone page is built and checked in dark, framed
(?embed=1) and solo (the Exit pill must not cover a label), at two sizes.

It also records which Tableau calls the stand-in does NOT provide, so the report can say so.
Exit 1 and RED on any failure; RED too if it examined fewer than MIN_PAGES pages.
"""
import csv, json, pathlib, subprocess, sys, tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import mock_render as M  # noqa: E402  (shared helpers; its main() only runs as a script)
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = M.ROOT
STANDIN = pathlib.Path(r"C:/Users/bioch/projects/viz-extensions-hub/hosted/public/_vz/standin.js")
MIN_PAGES = 9
pages = []

SCRIPTS = ["radar-math.js", "settings.js", "render.js", "radar.js"]


def dataset():
    rows = list(csv.DictReader(open(ROOT / "example" / "who-health-2019.csv", encoding="utf-8")))
    cols = list(rows[0].keys())
    numeric = [c == "Value" for c in cols]
    return {"columns": cols, "numeric": numeric, "rows": [[float(r[c]) if numeric[i] else r[c] for i, c in enumerate(cols)] for r in rows]}


ENC = [{"id": "axis", "field": "Indicator"}, {"id": "value", "field": "Value"},
       {"id": "series", "field": "WHO region"}, {"id": "label", "field": "Indicator long name"}]


def shell(cfg):
    tags = "\n".join('<script src="/src/js/%s"></script>' % s for s in SCRIPTS)
    return """<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/lib/ctab-panel/ctab-panel.css">
<link rel="stylesheet" href="/src/css/radar.css"><style>#root{position:absolute;inset:0}</style></head><body>
<div id="root"><div id="rd-root"><div id="rd-chart"></div></div></div>
<script>window.__CTAB_VIZ = %s;</script>
<script src="/__vz/standin.js"></script>
<script src="/lib/ctab-panel/ctab-panel.js"></script>
%s</body></html>""" % (json.dumps(cfg), tags)


def load(ctx, port, name, cfg, size=(900, 520), query="?embed=1"):
    pg = ctx.new_page()
    pg.set_viewport_size({"width": size[0], "height": size[1]})
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)))
    data = json.dumps(dataset())
    cfg = dict(cfg, dataUrl="/__data/viz.json")
    pg.route("**/__vz/standin.js", lambda r: r.fulfill(status=200, content_type="application/javascript", body=STANDIN.read_text(encoding="utf-8")))
    pg.route("**/__data/viz.json", lambda r: r.fulfill(status=200, content_type="application/json", body=data))
    pg.route("**/__page/index.html*", lambda r: r.fulfill(status=200, content_type="text/html", body=shell(cfg)))
    pg.goto("http://127.0.0.1:%d/__page/index.html%s" % (port, query))
    try:
        pg.wait_for_function("document.querySelector('.rd-svg')", timeout=8000)
        pg.wait_for_function("document.querySelector('.rd-svg').getAttribute('data-anim') === 'done'", timeout=8000)
    except Exception:
        print("NO SVG", name, errs, pg.evaluate("document.body.innerHTML.slice(0,300)"))
        raise
    pages.append(name)
    return pg, errs


def texts(pg, root_sel):
    return pg.evaluate("""(sel) => { const out = [], parse = s => (s.match(/[\\d.]+/g) || []).map(Number);
      document.querySelectorAll(sel + ' svg text, ' + sel + ' .rd-lg-n, ' + sel + ' .rd-title, ' + sel + ' .rd-note').forEach(t => { const r = t.getBoundingClientRect(), cs = getComputedStyle(t);
        if (r.width > 0 && r.height > 0) out.push({ t: t.textContent.slice(0, 30), size: parseFloat(cs.fontSize), fg: parse(cs.fill && cs.fill !== 'none' && t.namespaceURI.indexOf('svg') > 0 ? cs.fill : cs.color).slice(0, 3), l: r.left, tp: r.top, r: r.right, b: r.bottom }); });
      let chart = document.querySelector(sel), bg = parse(getComputedStyle(chart).backgroundColor); if (bg.length > 3 && bg[3] === 0) bg = parse(getComputedStyle(document.body).backgroundColor);
      return { items: out, bg: bg.slice(0, 3), hscroll: document.documentElement.scrollWidth > innerWidth + 1 }; }""", root_sel)


def verify(pg, errs, name, curve, rings=None, shapes=7):
    d = pg.evaluate("({ n: document.querySelectorAll('.rd-shape').length, ds: Object.assign({}, document.querySelector('.rd-svg').dataset), rings: document.querySelectorAll('.rd-ring').length })")
    M.check(name + ": %d series drawn from the stand-in's rows" % shapes, d["n"] == shapes, str(d["n"]))
    M.check(name + ": 7 axes", d["ds"]["axes"] == "7", str(d["ds"]))
    M.check(name + ": 0 console errors", not errs, str(errs[:3]))
    M.check(name + ": settings reached the chart (curve %s)" % curve, d["ds"]["curve"] == curve, str(d["ds"]))
    if rings:
        M.check(name + ": ring count setting applied (%d)" % rings, d["rings"] == rings, str(d["rings"]))
    labels = pg.evaluate("[...document.querySelectorAll('.rd-label')].map(e => e.textContent)")
    M.check(name + ": the Label shelf text names the axes (long names, not the short keys)", len(labels) >= 5 and any("Universal" in l or "health" in l.lower() for l in labels), str(labels[:3]))
    M.check(name + ": the Series shelf is wired (WHO regions in the legend)", pg.evaluate("[...document.querySelectorAll('.rd-lg[data-key]')].map(b => b.dataset.key).includes('Europe')"))
    # hover fades the others, click isolates, both run against the stand-in's no-op Tableau methods without raising
    box = pg.evaluate("(() => { const c = document.querySelector('.rd-s[data-key=\"Africa\"] .rd-dhit'); const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
    pg.mouse.move(box[0], box[1])
    pg.wait_for_function("document.querySelector('.rd-svg').classList.contains('rd-focus')", timeout=3000)
    M.check(name + ": hover highlights a series with the stand-in", pg.evaluate("document.querySelectorAll('.rd-s.is-on').length") == 1 and pg.evaluate("document.querySelector('.rd-tip').classList.contains('on')"))
    pg.mouse.click(box[0], box[1])
    pg.wait_for_function("document.querySelector('.rd-svg').classList.contains('rd-iso')", timeout=3000)
    M.check(name + ": click isolates without error", not errs, str(errs[:3]))
    pg.mouse.click(5, 5)
    d = texts(pg, "#rd-chart")
    M.check(name + ": every text >= 14px (%d texts)" % len(d["items"]), len(d["items"]) >= 5 and all(t["size"] >= 14 for t in d["items"]))
    M.check(name + ": no horizontal scroll", not d["hscroll"])
    low = [(t["t"], round(M.contrast(t["fg"], d["bg"]), 2)) for t in d["items"] if M.contrast(t["fg"], d["bg"]) < 7]
    M.check(name + ": text >= 7:1", not low, str(low[:3]))


def main():
    srv = M.serve()
    port = srv.server_address[1]
    assert STANDIN.exists(), "stand-in not found: %s" % STANDIN
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context()
        copied = {"curve": "smooth", "ringCount": 6, "benchMode": "series", "benchSeries": "Global"}
        pg, errs = load(ctx, port, "nested settings, no prefix", {"encodings": ENC, "settings": copied, "prefix": "", "title": "WHO"})
        verify(pg, errs, "nested/no-prefix", "smooth", 6, 6)
        M.check("the benchmark series (Global) is drawn as a dashed ring, not a shape", pg.evaluate("document.querySelectorAll('.rd-benchline').length") == 1 and pg.evaluate("document.querySelectorAll('.rd-shape').length") == 6)
        missing = pg.evaluate("['selectTuplesAsync','hoverTupleAsync','selectMarksByValueAsync','clearSelectedMarksAsync','applyFilterAsync'].filter(m => typeof tableau.extensions.worksheetContent.worksheet[m] !== 'function')")
        print("stand-in lacks:", missing)
        M.check("stand-in lacks hoverTupleAsync (known, guarded in our code)", "hoverTupleAsync" in missing, str(missing))
        M.check("every call Radar makes unguarded exists on the stand-in", all(pg.evaluate("typeof tableau.extensions.worksheetContent.worksheet.%s" % m) == "function" for m in ("getSummaryDataReaderAsync", "getVisualSpecificationAsync", "addEventListener", "selectMarksByValueAsync", "clearSelectedMarksAsync")) and pg.evaluate("typeof tableau.extensions.settings.get") == "function")
        # the panel works and the JSON it copies is what the stand-in reads back
        pg.click(".cp-gear"); pg.click(".cp-tab[data-t='series']"); pg.click(".cp-chip[data-k=curve][data-v=straight]")
        pg.wait_for_function("document.querySelector('.rd-svg').dataset.curve === 'straight'")
        pg.click("[data-f=copyall]"); pg.wait_for_timeout(150)
        out = json.loads(pg.evaluate("RD.app.state.panel.lastCopied"))["settings"]
        M.check("panel works on a viz page and Copy settings sees the visitor's change", out["curve"] == "straight" and out["ringCount"] == 6, str({k: out.get(k) for k in ("curve", "ringCount")}))
        pg.close()
        pg, errs = load(ctx, port, "round trip", {"encodings": ENC, "settings": out, "prefix": "", "title": "t"})
        verify(pg, errs, "round-trip", "straight", 6, 6)
        M.check("round trip: every copied setting survives the stand-in", pg.evaluate("RD.app.state.store.get().ringCount") == 6 and pg.evaluate("RD.app.state.store.get().benchSeries") == "Global")
        pg.close()
        flat = {"radar.curve": "smooth", "radar.ringCount": "4"}
        pg, errs = load(ctx, port, "flat prefix radar.", {"encodings": ENC, "settings": flat, "prefix": "", "title": "t"})
        verify(pg, errs, "flat/radar.", "smooth", 4)
        pg.close()
        other = {"viz7.curve": "smooth", "viz7.ringCount": "4"}
        pg, errs = load(ctx, port, "flat other prefix", {"encodings": ENC, "settings": other, "prefix": "", "title": "t"})
        verify(pg, errs, "flat/other-prefix", "smooth", 4)
        pg.close()
        pg, errs = load(ctx, port, "no settings", {"encodings": ENC, "settings": {}, "prefix": "", "title": "t"})
        verify(pg, errs, "no-settings", "straight", 5)
        pg.close()
        ctx.close()

        # ---- the single-file standalone page ----
        out_dir = pathlib.Path(tempfile.mkdtemp(prefix="radar-standalone-"))
        page = out_dir / "index.html"
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "build_standalone.py"), "--data", str(ROOT / "example" / "who-health-2019.csv"),
                            "--axis", "Indicator", "--series", "WHO region", "--value", "Value", "--label", "Indicator long name",
                            "--settings", str(ROOT / "example" / "dark-settings.json"), "--expect-rows", "49", "--out", str(page)], capture_output=True, text=True)
        M.check("standalone builds", r.returncode == 0, r.stdout + r.stderr)
        for query, label in (("?embed=1", "framed"), ("", "solo")):
            for size in ((900, 520), (300, 300)):
                ctx2 = b.new_context(viewport={"width": size[0], "height": size[1]})
                pg = ctx2.new_page(); errs2 = []
                pg.on("console", lambda m: errs2.append(m.text) if m.type in ("error", "warning") else None)
                pg.on("pageerror", lambda e: errs2.append(str(e)))
                pg.goto(page.as_uri() + query)
                pg.wait_for_function("document.querySelector('.rd-svg')", timeout=8000)
                pg.wait_for_function("document.querySelector('.rd-svg').getAttribute('data-anim') === 'done'", timeout=8000)
                name = "standalone %s %dx%d" % (label, size[0], size[1])
                pages.append(name)
                d = texts(pg, "#rd-chart")
                pill = pg.evaluate("(() => { const p = document.querySelector('.ctab-exit'); if (!p) return null; const r = p.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
                n = pg.evaluate("document.querySelectorAll('.rd-shape').length")
                M.check(name + ": 6 series shapes plus a dashed Global benchmark", n == 6 and pg.evaluate("document.querySelectorAll('.rd-benchline').length") == 1, str(n))
                M.check(name + ": dark background from the saved settings", d["bg"] == [8, 31, 51], str(d["bg"]))
                M.check(name + ": 0 console errors", not errs2, str(errs2[:3]))
                M.check(name + ": text >= 14px and 7:1", all(t["size"] >= 14 and M.contrast(t["fg"], d["bg"]) >= 7 for t in d["items"]), str([(t["t"], t["size"]) for t in d["items"] if t["size"] < 14][:3]))
                M.check(name + ": no horizontal scroll", not d["hscroll"])
                if label == "framed":
                    M.check(name + ": no Exit pill when framed", pill is None)
                else:
                    M.check(name + ": Exit pill present when solo", pill is not None)
                    if pill:
                        hit = [t["t"] for t in d["items"] if t["l"] < pill[2] and pill[0] < t["r"] and t["tp"] < pill[3] and pill[1] < t["b"]]
                        M.check(name + ": Exit pill covers no label or title text", not hit, str(hit))
                if size == (900, 520) and label == "framed" and M.shots:
                    pg.screenshot(path=str(M.shots / "radar-standalone-dark.png"))
                ctx2.close()
        b.close()
    srv.shutdown()
    print("examined %d pages, %d checks" % (len(pages), M.checks["n"]))
    if len(pages) < MIN_PAGES:
        M.fails.append("examined only %d pages, floor %d" % (len(pages), MIN_PAGES))
    if M.fails:
        print("RED  %d failed" % len(M.fails))
        for f in M.fails:
            print("  - " + f)
        sys.exit(1)
    print("GREEN  %d pages, %d checks (floor %d)" % (len(pages), M.checks["n"], MIN_PAGES))


main()
