"""Screenshots of the Settings Panel with the panel open, for the README and the preview folder.

  python tools/make_previews.py [--out preview]

Writes, all through the mock dashboard (dev/dev.html):
  preview/settings-panel-1280x800.png         the whole mock dashboard with the panel open on Filters (light)
  preview/settings-panel-1280x800-dark.png    the same in a dark system theme, on Parameters
  preview/settings-panel-390.png              a 390 x 844 zone: the panel is a full-frame sheet, on Parameters
  preview/settings-panel-390-dark.png         the same, dark, on Presets with two saved presets
"""
import functools, http.server, json, pathlib, socketserver, sys, threading, urllib.parse

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else ROOT / "preview"
out.mkdir(parents=True, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass


srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]
SNAP = {"v": 1, "params": {"Metric": "Profit"}, "filters": {}}
PRESETS = json.dumps([{"id": "pa", "name": "Q3 review", "snap": SNAP, "savedAt": "2026-11-20T12:00:00Z"},
                      {"id": "pb", "name": "West only, by profit", "snap": SNAP, "savedAt": "2026-11-22T12:00:00Z"}])

SHOTS = [
    ("settings-panel-1280x800.png", "light", "", "filters", (1312, 840), "#dash", {"x": 0, "y": 0, "width": 1280, "height": 800}),
    ("settings-panel-1280x800-dark.png", "dark", "", "params", (1312, 840), "#dash", {"x": 0, "y": 0, "width": 1280, "height": 800}),
    ("settings-panel-390.png", "light", "&zone=390x844&solo=1", "params", (390, 844), "#zone", None),
    ("settings-panel-390-dark.png", "dark", "&zone=390x844&solo=1", "presets", (390, 844), "#zone", None),
]

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, scheme, extra, tab, (w, h), sel, clip in SHOTS:
        ctx = b.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, device_scale_factor=1)
        pg = ctx.new_page()
        settings = {"sp.presets": PRESETS}
        if not extra:
            settings["sp.panel"] = json.dumps({"w": 400, "h": 700})
        pg.goto("http://127.0.0.1:%d/dev/dev.html?settings=%s%s" % (port, urllib.parse.quote(json.dumps(settings)), extra))
        pg.wait_for_function("window.SP_READY && SP.app.state.panel")
        if not extra:
            pg.evaluate("SP_MOCK.me.position = { x: 860, y: 16 }; SP_MOCK.onZone(SP_MOCK.me)")
            pg.add_style_tag(content="#bar { display: none; } #dash { margin: 0; transform-origin: 0 0; transform: scale(%f); }" % (1280 / 1440))
        pg.click(".cp-gear")
        pg.wait_for_selector(".sp-panel:not([hidden])")
        pg.click(".cp-tab[data-t='%s']" % tab)
        if tab == "filters":
            pg.uncheck("[data-ctl='f:categorical:Region'] input[data-v='South']")
            pg.wait_for_function("SP_MOCK.sheets.every(ws => ws.filters.Region.appliedValues.length === 3)")
        pg.wait_for_timeout(500)
        if clip:
            pg.screenshot(path=str(out / name), clip=clip)
        else:
            pg.locator(sel).screenshot(path=str(out / name))
        print("wrote", out / name)
        ctx.close()
    b.close()
srv.shutdown()
