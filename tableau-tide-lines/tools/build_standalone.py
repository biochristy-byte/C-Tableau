"""Build ONE html page of Tide Lines that runs without Tableau.

Tableau Public only runs Tableau-approved extensions, so a workbook using this one shows
viewers "isn't currently supported". Host this page on any HTTPS site instead and put it
in a dashboard Web Page object (recipe: tableau-knowledge/extension-on-tableau-public.md).

The page holds the extension's own code and styles, your CSV as Tableau-shaped summary
data, your saved settings (the JSON from the panel's Copy settings button), and the
C-Tableau stand-in for the Tableau Extensions API. The stand-in is the hub's one shared,
reviewed file (viz-extensions-hub/hosted/public/_vz/standin.js): it is read, never edited.

  python tools/build_standalone.py --data example/birth-weight.csv \
      --category "Mother group" --value "Birth weight (g)" --color "Mother smoked in pregnancy" \
      --label "Short name" --settings example/dark-settings.json --out standalone/index.html
"""
import argparse, base64, csv, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUB_STANDIN = r"C:/Users/bioch/projects/viz-extensions-hub/hosted/public/_vz/standin.js"
SCRIPTS = ["kde.js", "layout.js", "palettes.js", "settings.js", "render.js", "tidelines.js"]
PANEL = os.path.join(ROOT, "lib", "ctab-panel")

ap = argparse.ArgumentParser()
ap.add_argument("--data", required=True)
ap.add_argument("--category", required=True)
ap.add_argument("--value", required=True)
ap.add_argument("--color", default="")
ap.add_argument("--label", default="")
ap.add_argument("--settings", default="")
ap.add_argument("--title", default="Tide Lines")
ap.add_argument("--standin", default=HUB_STANDIN)
ap.add_argument("--out", default=os.path.join("standalone", "index.html"))
ap.add_argument("--expect-rows", type=int, default=0, help="refuse to build if the CSV has a different row count")
a = ap.parse_args()


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


with open(a.data, encoding="utf-8-sig", newline="") as f:
    rd = csv.DictReader(f)
    cols = rd.fieldnames
    raw = list(rd)
for need in (a.category, a.value) + tuple(x for x in (a.color, a.label) if x):
    if need not in cols:
        sys.exit("RED: column %r not in %s" % (need, cols))
if not raw or (a.expect_rows and len(raw) != a.expect_rows):
    sys.exit("RED: expected %s rows, got %d" % (a.expect_rows or "some", len(raw)))


def num(v):
    try:
        return float(v)
    except ValueError:
        return None


dims = {a.category, a.color, a.label}
numeric = [c == a.value or (c not in dims and all(num(r[c]) is not None for r in raw)) for c in cols]
rows = [[num(r[c]) if numeric[i] else r[c] for i, c in enumerate(cols)] for r in raw]
enc = [{"id": "category", "field": a.category}, {"id": "value", "field": a.value}]
if a.color:
    enc.append({"id": "color", "field": a.color})
if a.label:
    enc.append({"id": "label", "field": a.label})
settings = json.loads(read(a.settings)) if a.settings else {}

# the standin fetches dataUrl; inline it as a data: URL so the page is a single file
import base64
data = json.dumps({"columns": cols, "numeric": numeric, "rows": rows}, separators=(",", ":"))
data_url = "data:application/json;base64," + base64.b64encode(data.encode("utf-8")).decode("ascii")
cfg = {"dataUrl": data_url, "encodings": enc, "settings": settings, "prefix": "", "title": a.title, "home": "/"}

css = read(os.path.join(PANEL, "ctab-panel.css")) + "\n" + read(os.path.join(ROOT, "src", "css", "tidelines.css"))

# The library CSS points at fonts/*.woff2 by a relative url, which would 404 beside a single hosted page.
# Embed them, so the page stays one file and Inter and Poppins render the same everywhere.
def _embed_fonts(css_text, fonts_dir):
    def one(m):
        with open(os.path.join(fonts_dir, m.group(1)), "rb") as fh:
            return 'url("data:font/woff2;base64,%s")' % base64.b64encode(fh.read()).decode("ascii")
    out = re.sub(r'url\("fonts/([^"]+\.woff2)"\)', one, css_text)
    if re.search(r'url\("fonts/', out):
        sys.exit("RED: a font url in the panel CSS was not embedded")
    return out


css = _embed_fonts(css, os.path.join(PANEL, "fonts"))
js = "/* ---- ctab-panel.js ---- */\n" + read(os.path.join(PANEL, "ctab-panel.js")) + "\n" + "\n".join("/* ---- %s ---- */\n%s" % (s, read(os.path.join(ROOT, "src", "js", s))) for s in SCRIPTS)
standin = read(a.standin)
if "__CTAB_VIZ" not in standin or "worksheetContent" not in standin:
    sys.exit("RED: %s does not look like the C-Tableau stand-in" % a.standin)

html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>%(title)s</title>
<style>
%(css)s
html, body { overflow: hidden; }
#root { position: absolute; inset: 0; }
</style>
</head>
<body>
<div id="root"><div id="tl-root"><div id="tl-chart"></div></div></div>
<script>window.__CTAB_VIZ = %(cfg)s;</script>
<script>
%(standin)s
</script>
<script>
%(js)s
</script>
</body>
</html>
""" % {"title": a.title, "css": css, "cfg": json.dumps(cfg), "standin": standin, "js": js}

# no outside URL may be loaded at runtime: only data: and same-page references
import re
bad = [m for m in re.findall(r"(?:src|href)=\"(https?:[^\"]+)\"", html)]
if bad:
    sys.exit("RED: page would load outside URLs: %s" % bad)
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
with open(a.out, "w", encoding="utf-8", newline="\n") as f:
    f.write(html)
print("wrote %s (%d bytes, %d rows, %d columns)" % (a.out, len(html.encode("utf-8")), len(rows), len(cols)))
