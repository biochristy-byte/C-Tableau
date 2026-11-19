"""Build a standalone web page of the Garden Petals extension that runs WITHOUT Tableau.

Why: Tableau Public only runs Tableau-approved extensions, so a workbook that uses your own
extension shows visitors "isn't currently supported". Instead, host this page on any HTTPS
site and put it in a Tableau dashboard as a Web Page object. Full recipe:
tableau-knowledge/extension-on-tableau-public.md

The page holds:
  - the extension's own code (src/land.js, gazetteer.js, engine.js, settings-panel.js, viz.js), inlined
  - a read-only stand-in for the Tableau Extensions API that serves your CSV rows, shaped
    exactly like Tableau's summary data (SUM(Value) etc.), so viz.js runs unchanged
  - your saved settings (the JSON from the panel's Copy settings button)
  - the settings gear and panel; viewer changes last for the visit only
  - an Exit button (top left) shown only when the page is opened on its own; inside a frame
    (a Tableau Web Page object) or with ?embed=1 it stays hidden
  - link-preview tags (og:image) when --url and --image are given

  python tools/build_standalone.py --data example-pisa/pisa_long.csv \
      --settings example-pisa/pisa-dark-settings.json --title "AI Garden" \
      --url https://example.com/vizzes/ai-garden/ --image https://example.com/vizzes/images/ai-garden.jpg \
      --exit-href /vizzes/ --out standalone/ai-garden/index.html
"""
import argparse, csv, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(description="Build a standalone Garden Petals page for a Tableau Web Page object.")
ap.add_argument("--data", required=True, help="long CSV: Country, Metric, Value, Science/Math/Reading Score, Region, Sampling caution, OECD Value")
ap.add_argument("--settings", required=True, help="settings JSON from the panel's Copy settings button")
ap.add_argument("--title", default="AI Garden")
ap.add_argument("--desc", default="91 school systems planted as flowers: students, AI and phones in school, from OECD PISA 2025.")
ap.add_argument("--url", default="", help="public URL of the page (for link previews)")
ap.add_argument("--image", default="", help="public URL of a 1280x790 preview image")
ap.add_argument("--exit-href", default="/", help="where the Exit button goes when the page is opened on its own")
ap.add_argument("--expect-rows", type=int, default=437)
ap.add_argument("--expect-flowers", type=int, default=91)
ap.add_argument("--out", default=os.path.join("standalone", "ai-garden", "index.html"))
ap.add_argument("--viz-title", default="", help="title drawn inside the viz (default: --title)")
ap.add_argument("--poster", default="", help="JPEG still from make_poster.py; the embedded page opens on it (see poster_block)")
args = ap.parse_args()
TITLE, URL, IMAGE, DESC = args.title, args.url, args.image, args.desc


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


# ---- data, in the exact shape Tableau hands the extension ----
COLS = ["Country", "Metric", "SUM(Value)", "SUM(Science Score)", "SUM(Math Score)",
        "SUM(Reading Score)", "Region", "Sampling caution", "OECD Value"]
SRC = {"Country": "Country", "Metric": "Metric", "SUM(Value)": "Value", "SUM(Science Score)": "Science Score",
       "SUM(Math Score)": "Math Score", "SUM(Reading Score)": "Reading Score", "Region": "Region",
       "Sampling caution": "Sampling caution", "OECD Value": "OECD Value"}
NUMERIC = {"SUM(Value)", "SUM(Science Score)", "SUM(Math Score)", "SUM(Reading Score)", "OECD Value"}
rows = []
with open(args.data, encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        out = {}
        for c in COLS:
            v = r[SRC[c]]
            out[c] = (float(v) if v not in ("", None) else None) if c in NUMERIC else v
        rows.append(out)
# Petal colors follow the order petals first arrive. Tableau sent them in this order in
# the original workbook (legend top to bottom), so feed them the same way. Edit for other data.
PETAL_ORDER = [
    "Students in schools with subject-specific digital device guidelines",
    "Students in schools where cell phones are not allowed",
    "Students using AI at least weekly to help them learn",
    "Students reporting no distraction from digital devices",
    "Students learning to assess AI-generated information in class",
]
missing = {r["Metric"] for r in rows} - set(PETAL_ORDER)
if missing:
    sys.exit("RED: metrics not in PETAL_ORDER: %s" % sorted(missing))
rows.sort(key=lambda r: PETAL_ORDER.index(r["Metric"]))
countries = len({r["Country"] for r in rows})
if len(rows) != args.expect_rows or countries != args.expect_flowers:
    sys.exit("RED: expected %d rows and %d flowers, got %d rows and %d" % (args.expect_rows, args.expect_flowers, len(rows), countries))

# ---- settings: one JSON string per section, as Tableau stores them ----
with open(args.settings, encoding="utf-8") as f:
    settings = json.load(f)
settings["title"]["text"] = args.viz_title or TITLE
stored = {"gp." + k: json.dumps(v) for k, v in settings.items()}

SHIM = r"""
(function (global) {
  'use strict';
  var DATA = %(data)s, SETTINGS = %(settings)s;
  function Sheet() { this.listeners = {}; }
  Sheet.prototype.getSummaryDataReaderAsync = function () {
    var cols = DATA.columns, rows = DATA.rows;
    return Promise.resolve({
      pageCount: 1, totalRowCount: rows.length,
      getPageAsync: function () {
        return Promise.resolve({
          columns: cols.map(function (n, i) { return { fieldName: n, index: i, dataType: typeof rows[0][n] === 'number' ? 'float' : 'string' }; }),
          data: rows.map(function (r) { return cols.map(function (c) { var v = r[c]; return { value: v, nativeValue: v, formattedValue: v == null ? '' : String(v) }; }); })
        });
      },
      releaseAsync: function () { return Promise.resolve(); }
    });
  };
  Sheet.prototype.getVisualSpecificationAsync = function () {
    var enc = [['flower', 'Country'], ['petal', 'Metric'], ['length', 'SUM(Value)'], ['score', 'SUM(Science Score)']]
      .map(function (e) { return { id: e[0], fieldEncodingId: e[0] + '-0', type: 'custom', field: { name: e[1], fieldId: 'f-' + e[0] } }; });
    return Promise.resolve({ rowFields: [], columnFields: [], activeMarksSpecificationIndex: 0, marksSpecifications: [{ primitiveType: 'viz-extension', encodings: enc }] });
  };
  Sheet.prototype.addEventListener = function () { return function () {}; };
  var store = Object.assign({}, SETTINGS);
  global.tableau = {
    extensions: {
      initializeAsync: function () { return Promise.resolve(); },
      worksheetContent: { worksheet: new Sheet() },
      settings: {
        getAll: function () { return Object.assign({}, store); },
        get: function (k) { return store[k]; },
        set: function (k, v) { store[k] = String(v); },
        erase: function (k) { delete store[k]; },
        saveAsync: function () { return Promise.resolve(store); },
        addEventListener: function () { return function () {}; }
      },
      environment: { mode: 'viewer', apiVersion: 'standalone', tableauVersion: 'none' }
    },
    TableauEventType: { SummaryDataChanged: 'summary-data-changed', FilterChanged: 'filter-changed', ParameterChanged: 'parameter-changed', SettingsChanged: 'settings-changed' }
  };
})(window);
""" % {"data": json.dumps({"columns": COLS, "rows": rows}, separators=(",", ":")),
       "settings": json.dumps(stored, separators=(",", ":"))}

def embedded_fonts():
    """The fonts as inline @font-face rules (base64 woff2), so the page makes NO outside request.

    Tableau Public's gallery card is a screenshot its own headless browser takes of your page.
    With the Google Fonts stylesheet linked and unreachable, the page never fired `load` and a
    screenshot waited forever "for fonts to load". Fetched once, cached in tools/fonts-cache.css.
    """
    import base64, urllib.request
    cache = os.path.join(ROOT, "tools", "fonts-cache.css")
    if os.path.exists(cache):
        return open(cache, encoding="utf-8").read()
    ua = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"}
    css_url = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Martian+Mono:wght@600&display=swap"
    css = urllib.request.urlopen(urllib.request.Request(css_url, headers=ua), timeout=30).read().decode("utf-8")
    out = []
    for subset, face in re.findall(r"/\* ([\w-]+) \*/\s*(@font-face \{.*?\})", css, re.S):
        if subset not in ("latin", "latin-ext"):
            continue
        url = re.search(r"url\((https://[^)]+\.woff2)\)", face).group(1)
        data = base64.b64encode(urllib.request.urlopen(urllib.request.Request(url, headers=ua), timeout=30).read()).decode()
        out.append(face.replace(url, "data:font/woff2;base64," + data))
    faces = "\n".join(out)
    fams = set(re.findall(r"font-family: '([^']+)'", faces))
    if fams != {"Poppins", "Martian Mono"} or len(out) != 10:
        sys.exit("RED: expected 10 embedded faces (Poppins x4, Martian Mono x1, latin + latin-ext), got %d %s" % (len(out), fams))
    open(cache, "w", encoding="utf-8", newline="\n").write(faces)
    return faces


def poster_block(path):
    """A still of the embedded view, shown until the live canvas has drawn.

    Tableau Public's gallery card is a headless screenshot of the page. An animated canvas
    never reached it (the card stayed a grey placeholder through five publishes, 11/18/2026),
    while a plain HTML page did. So the embedded page opens on this still. For a person the live
    garden replaces it after its first frames (same picture, a 0.25 s fade). An automated
    browser (navigator.webdriver, which headless screenshotters set) keeps the still and the
    engine stays stopped. ?live=1 overrides that for your own Playwright tests.
    """
    if not path:
        return ""
    if not os.path.exists(path):
        sys.exit("RED: --poster file not found: %s (make it with tools/make_poster.py)" % path)
    import base64
    data = base64.b64encode(open(path, "rb").read()).decode()
    return ("<img id=\"dd-poster\" alt=\"\" src=\"data:image/jpeg;base64," + data + "\">\n<script>\n"
            "(function () {\n"
            "  var p = document.getElementById('dd-poster'); if (!p) return;\n"
            "  var bot = navigator.webdriver && !/[?&]live=1/.test(location.search);\n"
            "  function eng() { return window.__gp && window.__gp.engine; }\n"
            "  if (bot) {\n"
            "    var hold = function () { var e = eng(); if (e) e.stop(); };\n"
            "    var k = 0, iv = setInterval(function () { hold(); if (eng() || ++k > 100) clearInterval(iv); }, 50);\n"
            "    document.addEventListener('visibilitychange', hold);\n"
            "    return;\n"
            "  }\n"
            "  var n = 0;\n"
            "  (function wait() {\n"
            "    var s = window.__gp && window.__gp.state;\n"
            "    if (s && s.flowers > 0 && ++n >= 3) { p.style.opacity = '0'; setTimeout(function () { p.remove(); }, 300); return; }\n"
            "    requestAnimationFrame(wait);\n"
            "  })();\n"
            "})();\n</script>")


bg = settings["colors"]["bg"]
page = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(title)s</title>
<meta name="description" content="%(desc)s">
<meta property="og:type" content="website">
<meta property="og:title" content="%(title)s">
<meta property="og:description" content="%(desc)s">
<meta property="og:url" content="%(url)s">
<meta property="og:image" content="%(image)s">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="790">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="%(image)s">
<style>%(fontfaces)s</style>
<style>
  html, body { margin: 0; height: 100%%; overflow: hidden; background: %(bg)s; color-scheme: dark; }
  #root { position: absolute; inset: 0; }
  [hidden] { display: none !important; }
  /* Exit: only when opened on its own page. Styled as a small pill. */
  .dd-exit { display: none; position: fixed; z-index: 60; top: max(10px, env(safe-area-inset-top)); left: max(12px, env(safe-area-inset-left));
    align-items: center; gap: .5em; font: 600 12px/1 'Martian Mono', 'Courier New', ui-monospace, monospace; letter-spacing: .1em; text-transform: uppercase;
    color: #f3f5f7; background: rgba(8, 31, 51, .92); border: 1px solid rgba(60, 196, 209, .6); border-radius: 999px;
    padding: 10px 16px; text-decoration: none; box-shadow: 0 6px 20px rgba(4, 18, 29, .5); }
  .dd-exit:hover, .dd-exit:focus-visible { color: #3cc4d1; border-color: #3cc4d1; }
  .dd-exit:focus-visible { outline: 2px solid #3cc4d1; outline-offset: 3px; }
  html.dd-solo .dd-exit { display: inline-flex; }
  html.dd-solo #root { top: 52px; }
  #dd-poster { position: fixed; inset: 0; width: 100%%; height: 100%%; object-fit: cover; object-position: left top; z-index: 45;
    pointer-events: none; transition: opacity .25s ease; }
  html.dd-solo #dd-poster { display: none; }
</style>
<script>
  (function () { var solo = true; try { solo = window.top === window.self; } catch (e) { solo = false; }
    if (solo && !/[?&]embed=1/.test(location.search)) document.documentElement.classList.add('dd-solo'); })();
</script>
</head>
<body>
<a class="dd-exit" href="%(exit)s" aria-label="Exit"><span aria-hidden="true">&times;</span> Exit</a>
<div id="root" role="img" aria-label="%(title)s: 91 education systems drawn as flowers. Each petal is the share of students for one question about AI and devices in school. Data: OECD PISA 2025."></div>
<script>%(shim)s</script>
<script>%(land)s</script>
<script>%(geo)s</script>
<script>%(engine)s</script>
<script>%(panel)s</script>
<script>%(viz)s</script>
%(poster)s
</body>
</html>
""" % {"title": TITLE, "bg": bg, "shim": SHIM, "land": read("src/land.js"), "geo": read("src/gazetteer.js"),
       "engine": read("src/engine.js"), "panel": read("src/settings-panel.js"), "viz": read("src/viz.js"),
       "desc": DESC, "url": URL, "image": IMAGE, "exit": args.exit_href,
       "fontfaces": embedded_fonts(), "poster": poster_block(args.poster)}

if not (URL and IMAGE):   # no public address yet: leave the link-preview tags out
    page = "\n".join(l for l in page.split("\n") if 'property="og:url"' not in l and "og:image" not in l and "twitter:" not in l)
ext = sorted(set(re.findall(r"""(?:src|href)=["'](https?://[^"']+)""", page)) - {URL, IMAGE})
ext += sorted(set(re.findall(r"""url\(["']?(https?://[^)"']+)""", page)))
if ext:
    sys.exit("RED: the page still requests outside URLs (Tableau Public's card renderer can hang on them): %s" % ext[:5])
os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
with open(args.out, "w", encoding="utf-8", newline="\n") as f:
    f.write(page)
print("built %s: %d bytes, %d rows, %d flowers, title %r" % (args.out, len(page.encode("utf-8")), len(rows), countries, TITLE))
