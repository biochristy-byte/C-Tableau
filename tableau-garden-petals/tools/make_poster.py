"""Capture the still an embedded standalone page opens on (build_standalone.py --poster).

Tableau Public's gallery card is a headless screenshot of your Web Page object's page, and an
animated canvas never reached it. With a poster, the page opens on this still; a person's
browser swaps in the live canvas after its first frames, an automated browser keeps the still.

  python tools/make_poster.py OUT.jpg                      standalone/ai-garden, 1400 x 900
  python tools/make_poster.py OUT.jpg standalone/my-viz 1200 800

Capture at your dashboard's exact size, then rebuild with --poster OUT.jpg.
"""
import functools, http.server, os, pathlib, sys, threading
from playwright.sync_api import sync_playwright
from PIL import Image, ImageStat

ROOT = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]).resolve()
folder = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else ROOT / "standalone" / "ai-garden"
W, H = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (1400, 900)
if not (folder / "index.html").exists():
    sys.exit("SKIP: no %s; build first" % (folder / "index.html"))
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(folder.parent))
h.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = "http://127.0.0.1:%d/%s/?embed=1&live=1" % (srv.server_address[1], folder.name)
tmp = str(out) + ".png"
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": W, "height": H})
    pg.goto(url)
    pg.wait_for_function("() => window.__gp && window.__gp.state && window.__gp.state.flowers > 0", timeout=20000)
    pg.wait_for_function("() => !document.getElementById('dd-poster')", timeout=20000)   # the live canvas, never an old poster
    pg.wait_for_timeout(6000)
    pg.screenshot(path=tmp)
    b.close()
srv.shutdown()
im = Image.open(tmp).convert("RGB")
mean = sum(ImageStat.Stat(im).mean) / 3
colors = len(set(im.resize((140, 90)).getdata()))
os.remove(tmp)
if im.size != (W, H) or mean > 200 or colors < 500:
    sys.exit("RED: poster looks wrong (size %s, mean %.1f, %d colors)" % (im.size, mean, colors))
im.save(out, quality=88, optimize=True)
print("wrote %s: %dx%d, mean %.1f, %d colors, %d KB" % (out, W, H, mean, colors, os.path.getsize(out) // 1024))
