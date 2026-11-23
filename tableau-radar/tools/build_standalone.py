"""Build ONE html page of Radar that runs without Tableau.

Tableau Public only runs Tableau-approved extensions, so a workbook using this one shows
viewers "isn't currently supported". Host this page on any HTTPS site instead and put it
in a dashboard Web Page object (recipe: tableau-knowledge/extension-on-tableau-public.md).

The page holds the extension's own code and styles, the shared settings panel, your CSV as
Tableau-shaped summary data, your saved settings (the JSON from the panel's Copy settings
button), and the C-Tableau stand-in for the Tableau Extensions API. The stand-in is the hub's
one shared, reviewed file (viz-extensions-hub/hosted/public/_vz/standin.js): it is read, never edited.

  python tools/build_standalone.py --data example/who-health-2019.csv \
      --axis "Indicator" --series "WHO region" --value "Value" --label "Indicator long name" \
      --settings example/dark-settings.json --out standalone/index.html
"""
import argparse, base64, csv, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HUB_STANDIN = r"C:/Users/bioch/projects/viz-extensions-hub/hosted/public/_vz/standin.js"
SCRIPTS = ["radar-math.js", "settings.js", "render.js", "radar.js"]

ap = argparse.ArgumentParser()
ap.add_argument("--data", required=True)
ap.add_argument("--axis", required=True)
ap.add_argument("--value", required=True)
ap.add_argument("--series", default="")
ap.add_argument("--label", default="")
ap.add_argument("--settings", default="")
ap.add_argument("--title", default="Radar")
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
for need in (a.axis, a.value) + tuple(x for x in (a.series, a.label) if x):
    if need not in cols:
        sys.exit("RED: column %r not in %s" % (need, cols))
if not raw or (a.expect_rows and len(raw) != a.expect_rows):
    sys.exit("RED: expected %s rows, got %d" % (a.expect_rows or "some", len(raw)))


def num(v):
    try:
        return float(v)
    except ValueError:
        return None


dims = {a.axis, a.series, a.label}
numeric = [c == a.value or (c not in dims and all(num(r[c]) is not None for r in raw)) for c in cols]
rows = [[num(r[c]) if numeric[i] else r[c] for i, c in enumerate(cols)] for r in raw]
enc = [{"id": "axis", "field": a.axis}, {"id": "value", "field": a.value}]
if a.series:
    enc.append({"id": "series", "field": a.series})
if a.label:
    enc.append({"id": "label", "field": a.label})
settings = json.loads(read(a.settings)) if a.settings else {}

data = json.dumps({"columns": cols, "numeric": numeric, "rows": rows}, separators=(",", ":"))
data_url = "data:application/json;base64," + base64.b64encode(data.encode("utf-8")).decode("ascii")
cfg = {"dataUrl": data_url, "encodings": enc, "settings": settings, "prefix": "", "title": a.title, "home": "/"}

css = read(os.path.join(ROOT, "lib", "ctab-panel", "ctab-panel.css")) + "\n" + read(os.path.join(ROOT, "src", "css", "radar.css"))
js = "/* ---- ctab-panel ---- */\n" + read(os.path.join(ROOT, "lib", "ctab-panel", "ctab-panel.js")) + "\n" + \
    "\n".join("/* ---- %s ---- */\n%s" % (s, read(os.path.join(ROOT, "src", "js", s))) for s in SCRIPTS)
standin = read(a.standin)
if "__CTAB_VIZ" not in standin or "worksheetContent" not in standin:
    sys.exit("RED: %s does not look like the C-Tableau stand-in" % a.standin)
# settings.js needs CTabPanel as a global in the browser: it is, because ctab-panel.js ran first as a classic script.
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
#rd-root { position: absolute; inset: 0; }
</style>
</head>
<body>
<div id="root"><div id="rd-root"><div id="rd-chart"></div></div></div>
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

bad = re.findall(r"(?:src|href)=\"(https?:[^\"]+)\"", html)
if bad:
    sys.exit("RED: page would load outside URLs: %s" % bad)
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
with open(a.out, "w", encoding="utf-8", newline="\n") as f:
    f.write(html)
print("wrote %s (%d bytes, %d rows, %d columns)" % (a.out, len(html.encode("utf-8")), len(rows), len(cols)))
