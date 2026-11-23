"""Screenshots of Tide Lines with the settings panel open, for the README and the preview folder.

  python tools/make_panel_previews.py [--out preview]

Writes preview/tide-lines-panel-1280x800.png (desktop, the panel floated over the chart) and
preview/tide-lines-panel-390.png (a phone-width frame: the panel is a full-frame sheet). Both use the real birth-weight
data through the mock Tableau API, entrance animation off so the picture is the settled chart.
"""
import functools, http.server, json, pathlib, socketserver, sys, threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else ROOT / "preview"
out.mkdir(parents=True, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass


srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]
SET = {"tidelines.animOn": "false", "tidelines.showRug": "true", "tidelines.showMean": "true", "tidelines.colorSource": "field"}

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, (w, h, tab) in {"tide-lines-panel-1280x800.png": (1280, 800, "marks"), "tide-lines-panel-390.png": (390, 760, "density")}.items():
        pg = b.new_page(viewport={"width": w + 60, "height": h + 260}, device_scale_factor=1)
        pg.add_init_script("localStorage.setItem('tl-mock-settings', %s)" % json.dumps(json.dumps(SET)))
        pg.goto("http://127.0.0.1:%d/dev/dev.html?fixture=birth&size=%dx%d&theme=light" % (port, w, h))
        pg.wait_for_function("window.TL_READY && document.querySelector('.tl-svg')")
        pg.wait_for_timeout(400)
        pg.click(".cp-gear")
        pg.wait_for_selector(".cp-panel:not([hidden])")
        pg.click(".cp-tab[data-t='%s']" % tab)
        pg.wait_for_timeout(300)
        pg.locator("#stage").screenshot(path=str(out / name))
        print("wrote", out / name)
        pg.close()
    b.close()
srv.shutdown()
