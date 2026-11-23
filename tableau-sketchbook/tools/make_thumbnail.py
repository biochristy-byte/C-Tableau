"""Hub catalog thumbnail (1280 x 790 JPEG) and the preview PNGs, captured from dev/dev.html.

  python tools/make_thumbnail.py            writes previews/thumbnail.jpg and previews/preview-*.png

Captured after the page is ready with ?still=1 (no fade running), on the dark Data Divers
navy. Refuses to write an image that is mostly background, so a blank render never ships
as the catalog picture."""
import functools, http.server, io, json, pathlib, socketserver, sys, threading
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'previews'
OUT.mkdir(exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k):
        pass


h = functools.partial(Quiet, directory=str(ROOT))
srv = socketserver.TCPServer(('127.0.0.1', 0), h)
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:%d/dev/dev.html' % srv.server_address[1]

SHOTS = [
    ('thumbnail.jpg', 1280, 790, 'fx=bars&bg=fbf6e9&still=1&settings=' + json.dumps({'labels': 'value', 'fontSize': 22, 'title': 'Life expectancy in 2023', 'underline': True, 'roughness': 1.6})),
    ('preview-bars-paper.png', 1100, 700, 'fx=bars&bg=fbf6e9&still=1&settings=' + json.dumps({'labels': 'value', 'title': 'Life expectancy in 2023', 'underline': True})),
    ('preview-dots-light.png', 1100, 700, 'fx=life&bg=ffffff&still=1&settings=' + json.dumps({'chartType': 'dot', 'title': 'Six countries, nine years'})),
    ('preview-zigzag-dark.png', 1100, 700, 'fx=negative&bg=081f33&still=1&settings=' + json.dumps({'fillStyle': 'zigzag', 'title': 'Gains and losses, zigzag fill'})),
]
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, w, hh, q in SHOTS:
        pg = b.new_page(viewport={'width': w, 'height': hh}, device_scale_factor=1)
        pg.goto(base + '?' + q)
        pg.wait_for_selector('#sb-root[data-ready="1"]')
        pg.evaluate('document.fonts.ready')
        pg.wait_for_timeout(300)
        png = pg.screenshot()
        pg.close()
        img = Image.open(io.BytesIO(png)).convert('RGB')
        bg = Image.new('RGB', img.size, img.getpixel((2, hh // 2)))
        diff = ImageChops.difference(img, bg).convert('L').point(lambda v: 255 if v > 24 else 0)
        share = sum(diff.tobytes()) / 255 / (w * hh)
        if share < 0.04:
            sys.exit('RED: %s is %.1f%% non-background, refusing to write a blank-looking image' % (name, share * 100))
        if name.endswith('.jpg'):
            img.save(OUT / name, quality=90)
        else:
            img.save(OUT / name)
        print('wrote', name, '%dx%d' % img.size, '%.0f%% non-background' % (share * 100))
    b.close()
srv.shutdown()
