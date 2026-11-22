"""Viz pages compatibility gate: drives Tide Lines with the hub's REAL stand-in file.

  python test/standin_test.py

The stand-in (viz-extensions-hub/hosted/public/_vz/standin.js) is loaded unchanged and fed the
birth-weight CSV exactly as the hosted shell would (window.__CTAB_VIZ with dataUrl, encodings,
settings, prefix). Four settings shapes are tried: nested JSON with no prefix (what Copy settings
produces), a flat string map under prefix "tidelines.", a flat map under some other prefix, and
no settings at all. Then the single-file standalone page is built and checked in light and dark,
framed (?embed=1) and solo (the Exit pill must not cover a label).

It also records which Tableau calls the stand-in does NOT provide, so the report can say so.
Exit 1 and RED on any failure; RED too if it examined fewer than MIN_PAGES pages.
"""
import csv, json, pathlib, subprocess, sys, tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import mock_render as M  # noqa: E402  (shared helpers; its main() only runs as a script)
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = M.ROOT
STANDIN = pathlib.Path(r"C:/Users/bioch/projects/viz-extensions-hub/hosted/public/_vz/standin.js")
MIN_PAGES = 7
pages = []

SCRIPTS = ["kde.js", "layout.js", "palettes.js", "schema.js", "render.js", "settings-panel.js", "tidelines.js"]


def dataset():
    rows = list(csv.DictReader(open(ROOT / "example" / "birth-weight.csv", encoding="utf-8")))
    cols = list(rows[0].keys())
    numeric = [c == "Birth weight (g)" for c in cols]
    return {"columns": cols, "numeric": numeric, "rows": [[float(r[c]) if numeric[i] else r[c] for i, c in enumerate(cols)] for r in rows]}


ENC = [{"id": "category", "field": "Mother group"}, {"id": "value", "field": "Birth weight (g)"},
       {"id": "color", "field": "Mother smoked in pregnancy"}, {"id": "label", "field": "Short name"}]


def shell(cfg, solo_root=True):
    tags = "\n".join('<script src="/src/js/%s"></script>' % s for s in SCRIPTS)
    return """<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/src/css/tidelines.css">
<style>#root{position:absolute;inset:0}</style></head><body>
<div id="root"><div id="tl-root"><div id="tl-chart"></div></div></div>
<script>window.__CTAB_VIZ = %s;</script>
<script src="/__vz/standin.js"></script>
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
        pg.wait_for_function("document.querySelector('.tl-svg')", timeout=8000)
    except Exception:
        print("NO SVG", name, errs, pg.evaluate("document.body.innerHTML.slice(0,300)"))
        raise
    pg.wait_for_timeout(1500)
    pages.append(name)
    return pg, errs


def verify(pg, errs, name, kernel, sort_name=False):
    n = pg.evaluate("document.querySelectorAll('path.tl-fill').length")
    M.check(name + ": 6 ridges drawn from the stand-in's rows", n == 6, str(n))
    M.check(name + ": 0 console errors", not errs, str(errs[:3]))
    M.check(name + ": settings reached the chart (kernel %s)" % kernel, pg.evaluate("document.querySelector('.tl-svg').dataset.kernel") == kernel)
    labels = pg.evaluate("[...document.querySelectorAll('.tl-label')].map(e => e.firstChild.textContent)")
    M.check(name + ": the Label shelf text is used for ridge names", all(", " in l and "mothers" not in l for l in labels) and len(labels) == 6, str(labels))
    if sort_name:
        M.check(name + ": sort setting applied (alphabetical)", labels == sorted(labels, key=str.lower), str(labels))
    M.check(name + ": colour shelf is wired (By field would colour by smoking)", pg.evaluate("TL.app.state.model.hasColor") is True)
    # hover and click run against the stand-in's no-op methods without raising
    box = pg.evaluate("(() => { const p = [...document.querySelectorAll('path.tl-hit')].pop(); const r = p.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
    pg.mouse.move((box[0] + box[2]) / 2, box[3] - 4)
    pg.wait_for_timeout(350)
    M.check(name + ": hover works with the stand-in (tooltip on)", pg.evaluate("document.querySelector('.tl-tip').classList.contains('on')"))
    pg.mouse.click((box[0] + box[2]) / 2, box[3] - 4)
    pg.wait_for_timeout(150)
    M.check(name + ": click selects without error", pg.evaluate("document.querySelectorAll('.tl-ridge.is-sel').length") == 1 and not errs, str(errs[:3]))
    d = pg.evaluate(M.JS_TEXT.replace("document.querySelector('#stage').getBoundingClientRect()", "document.documentElement.getBoundingClientRect()").replace("document.querySelector('#tl-chart')", "document.querySelector('#tl-chart')"))
    M.check(name + ": every text >= 14px", all(t["size"] >= 14 for t in d["texts"]))
    M.check(name + ": no horizontal scroll", not d["hscroll"])
    bg = M.rgb(d["bg"])
    M.check(name + ": text >= 7:1", all(M.contrast(M.rgb(t["fill"]), bg) >= 7 for t in d["texts"]))
    return d


def main():
    srv = M.serve()
    port = srv.server_address[1]
    assert STANDIN.exists(), "stand-in not found: %s" % STANDIN
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context()
        copied = {"kernel": "epanechnikov", "overlap": 3, "sort": "name", "showMedian": True}
        pg, errs = load(ctx, port, "nested settings, no prefix", {"encodings": ENC, "settings": copied, "prefix": "", "title": "Birth weight"})
        verify(pg, errs, "nested/no-prefix", "epanechnikov", sort_name=True)
        missing = pg.evaluate("['selectTuplesAsync','hoverTupleAsync','selectMarksByValueAsync','clearSelectedMarksAsync','applyFilterAsync'].filter(m => typeof tableau.extensions.worksheetContent.worksheet[m] !== 'function')")
        print("stand-in lacks:", missing)
        M.check("stand-in lacks selectTuplesAsync and hoverTupleAsync (known, guarded in our code)", set(missing) >= {"selectTuplesAsync", "hoverTupleAsync"}, str(missing))
        M.check("every call Tide Lines makes unguarded exists on the stand-in", all(pg.evaluate("typeof tableau.extensions.worksheetContent.worksheet.%s" % m) == "function" for m in ("getSummaryDataReaderAsync", "getVisualSpecificationAsync", "addEventListener", "selectMarksByValueAsync", "clearSelectedMarksAsync")) and pg.evaluate("typeof tableau.extensions.settings.get") == "function")
        # the panel works and the JSON it copies is what the stand-in reads back
        pg.click(".tl-gear"); pg.click(".tl-chip[data-value='gaussian']"); pg.wait_for_timeout(250)
        pg.click("text=Copy settings"); pg.wait_for_timeout(150)
        out = json.loads(pg.evaluate("TL.app.state.panel.lastCopied"))
        M.check("panel works on a viz page and Copy settings sees the visitor's change", out["kernel"] == "gaussian" and out["overlap"] == 3, str(out)[:100])
        pg.close()
        # the copied JSON, fed back, reproduces the chart
        pg, errs = load(ctx, port, "round trip", {"encodings": ENC, "settings": out, "prefix": "", "title": "t"})
        verify(pg, errs, "round-trip", "gaussian", sort_name=True)
        M.check("round trip: every copied setting survives the stand-in", pg.evaluate("TL.app.state.settings.overlap") == 3 and pg.evaluate("TL.app.state.settings.sort") == "name")
        pg.close()
        flat = {"tidelines.kernel": "epanechnikov", "tidelines.sort": "name", "tidelines.overlap": "3"}
        pg, errs = load(ctx, port, "flat prefix tidelines.", {"encodings": ENC, "settings": flat, "prefix": "", "title": "t"})
        verify(pg, errs, "flat/tidelines.", "epanechnikov", sort_name=True)
        pg.close()
        other = {"viz7.kernel": "epanechnikov", "viz7.sort": "name"}
        pg, errs = load(ctx, port, "flat other prefix", {"encodings": ENC, "settings": other, "prefix": "", "title": "t"})
        verify(pg, errs, "flat/other-prefix", "epanechnikov", sort_name=True)
        pg.close()
        pg, errs = load(ctx, port, "no settings", {"encodings": ENC, "settings": {}, "prefix": "", "title": "t"})
        verify(pg, errs, "no-settings", "gaussian")
        pg.close()
        ctx.close()

        # ---- the single-file standalone page ----
        out_dir = pathlib.Path(tempfile.mkdtemp(prefix="tide-standalone-"))
        page = out_dir / "index.html"
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "build_standalone.py"), "--data", str(ROOT / "example" / "birth-weight.csv"),
                            "--category", "Mother group", "--value", "Birth weight (g)", "--color", "Mother smoked in pregnancy", "--label", "Short name",
                            "--settings", str(ROOT / "example" / "dark-settings.json"), "--expect-rows", "189", "--out", str(page)], capture_output=True, text=True)
        M.check("standalone builds", r.returncode == 0, r.stdout + r.stderr)
        for query, label in (("?embed=1", "framed"), ("", "solo")):
            for size in ((900, 520), (300, 300)):
                ctx2 = b.new_context(viewport={"width": size[0], "height": size[1]})
                pg = ctx2.new_page(); errs2 = []
                pg.on("console", lambda m: errs2.append(m.text) if m.type in ("error", "warning") else None)
                pg.on("pageerror", lambda e: errs2.append(str(e)))
                pg.goto(page.as_uri() + query)
                pg.wait_for_function("document.querySelector('.tl-svg')", timeout=8000); pg.wait_for_timeout(1500)
                name = "standalone %s %dx%d" % (label, size[0], size[1])
                pages.append(name)
                d = pg.evaluate("""() => { const svg = document.querySelector('.tl-svg'); const out = [];
                  svg.querySelectorAll('text').forEach(t => { const r = t.getBoundingClientRect(); out.push([t.textContent, r.left, r.top, r.right, r.bottom, parseFloat(getComputedStyle(t).fontSize), getComputedStyle(t).fill]); });
                  const pill = document.querySelector('.ctab-exit'); const pr = pill ? pill.getBoundingClientRect() : null;
                  return { n: document.querySelectorAll('path.tl-fill').length, texts: out, pill: pr ? [pr.left, pr.top, pr.right, pr.bottom] : null,
                    bg: getComputedStyle(document.querySelector('#tl-chart')).backgroundColor, hscroll: document.documentElement.scrollWidth > innerWidth + 1 }; }""")
                M.check(name + ": 6 ridges", d["n"] == 6, str(d["n"]))
                M.check(name + ": dark background from the saved settings", d["bg"] == "rgb(8, 31, 51)", d["bg"])
                M.check(name + ": 0 console errors", not errs2, str(errs2[:3]))
                M.check(name + ": text >= 14px and 7:1", all(t[5] >= 14 and M.contrast(M.rgb(t[6]), M.rgb(d["bg"])) >= 7 for t in d["texts"]))
                M.check(name + ": no horizontal scroll", not d["hscroll"])
                if label == "framed":
                    M.check(name + ": no Exit pill when framed", d["pill"] is None)
                else:
                    M.check(name + ": Exit pill present when solo", d["pill"] is not None)
                    if d["pill"]:
                        hit = [t[0] for t in d["texts"] if t[1] < d["pill"][2] and d["pill"][0] < t[3] and t[2] < d["pill"][3] and d["pill"][1] < t[4]]
                        M.check(name + ": Exit pill covers no label or tick text", not hit, str(hit))
                if size == (900, 520) and label == "framed" and M.shots:
                    pg.screenshot(path=str(M.shots / "tide-lines-standalone-dark.png"))
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
