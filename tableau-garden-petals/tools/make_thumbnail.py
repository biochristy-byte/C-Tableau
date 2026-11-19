"""Capture a gallery thumbnail and link-preview image from a standalone build.

  python tools/make_thumbnail.py OUT.jpg                     standalone/ai-garden/index.html
  python tools/make_thumbnail.py OUT.jpg standalone/my-viz   another build folder

1280 x 790, page opened with ?embed=1 so the Exit button stays out of the picture, captured
after the flowers have grown in and settled (6 s). Refuses to write a mostly-white or
mostly-empty image, so a dark viz never ships a blank or light placeholder thumbnail.
"""
import sys, threading, http.server, socketserver, functools, pathlib, io

from playwright.sync_api import sync_playwright
from PIL import Image, ImageStat

ROOT = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]).resolve()
folder = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else ROOT / "standalone" / "ai-garden"
if not (folder / "index.html").exists():
    sys.exit("SKIP: no %s; build first" % (folder / "index.html"))
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(folder.parent))
h.log_message = lambda *a, **k: None
srv = socketserver.TCPServer(("127.0.0.1", 0), h)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = "http://127.0.0.1:%d/%s/?embed=1&live=1" % (srv.server_address[1], folder.name)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 790}, device_scale_factor=1)
    pg.goto(url)
    pg.evaluate("() => document.fonts.ready")
    pg.wait_for_timeout(6000)
    png = pg.screenshot(type="png")
    b.close()
srv.shutdown()

im = Image.open(io.BytesIO(png)).convert("RGB")
mean = sum(ImageStat.Stat(im).mean) / 3
small = im.resize((128, 79))
light = sum(1 for x in range(128) for y in range(79) if sum(small.getpixel((x, y))) > 600) / (128 * 79)
print("size %s | mean brightness %.1f | near-white share %.1f%%" % (im.size, mean, light * 100))
if im.size != (1280, 790) or mean > 120 or light > 0.10 or mean < 12:
    sys.exit("RED: thumbnail does not look like a dark viz; not written")
im.save(out, "JPEG", quality=88, optimize=True, progressive=True)
print("wrote", out, out.stat().st_size, "bytes")
