"""Preview images for the README and the preview folder, from the shipping code through the mock Tableau API.

  python tools/make_previews.py [--out preview]

Writes:
  preview/panel-chart-panel-1280x800.png   the panel floated over a stacked bar chart (desktop)
  preview/panel-chart-panel-390.png        a 390px frame: the panel is a full-frame sheet
  preview/panel-chart-<type>-light.png and -dark.png for bar, line, area and scatter at 900x520
Animation is off so every picture is the settled chart.
"""
import functools, http.server, json, pathlib, socketserver, sys, threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else ROOT / "preview"
out.mkdir(parents=True, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass


srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]


def ser(v):
    return ("true" if v else "false") if isinstance(v, bool) else str(v)


def shoot(b, name, fixture, w, h, theme, st, panel_tab=None, bare=False):
    vp = {"width": w, "height": h} if bare else {"width": w + 60, "height": h + 260}
    pg = b.new_page(viewport=vp, device_scale_factor=1)
    s = {"panelchart.animOn": "false"}
    s.update({"panelchart." + k: ser(v) for k, v in st.items()})
    pg.add_init_script("localStorage.setItem('pc-mock-settings', %s)" % json.dumps(json.dumps(s)))
    pg.goto("http://127.0.0.1:%d/dev/dev.html?fixture=%s&size=%dx%d&theme=%s%s" % (port, fixture, w, h, theme, "&bare=1" if bare else ""))
    pg.wait_for_function("window.PC_READY && window.PC && PC.app && PC.app.state.raw && document.querySelector('.pc-svg') && !PC.app.state.renderer.animating")
    pg.wait_for_timeout(300)
    if panel_tab:
        pg.click(".cp-gear")
        pg.wait_for_selector(".cp-panel:not([hidden])")
        pg.click(".cp-tab[data-t='%s']" % panel_tab)
        pg.wait_for_timeout(300)
    pg.locator("#stage").screenshot(path=str(out / name))
    print("wrote", out / name)
    pg.close()


with sync_playwright() as p:
    b = p.chromium.launch()
    shoot(b, "panel-chart-panel-1280x800.png", "sales", 1280, 800, "light", {"valueLabels": True, "showTitle": True, "titleText": "Sales by region", "subtitleText": "Stacked by product, last twelve months"}, "chart")
    shoot(b, "panel-chart-panel-390.png", "sales", 390, 760, "light", {}, "chart", bare=True)
    TYPES = {"bar": ("sales", {"valueLabels": True}), "line": ("monthly", {"curve": "smooth"}), "area": ("monthly", {"refLine": "avg"}), "scatter": ("scatter", {"trendLine": True})}
    for typ, (fx, extra) in TYPES.items():
        for theme in ("light", "dark"):
            st = {"chartType": typ, "showTitle": True}
            st.update(extra)
            shoot(b, "panel-chart-%s-%s.png" % (typ, theme), fx, 900, 520, theme, st)
    b.close()
srv.shutdown()
