"""Write previews/*.png and the hub catalog thumbnail from the real extension code.

  python tools/make_previews.py

Renders test/page.html (the shipping scripts against the mock Tableau API) in headless Chromium:
  previews/neurons-dark.png    1200 x 700, AVA hovered, outgoing amber and incoming aqua
  previews/neurons-light.png   1200 x 700, white worksheet, resting
  previews/neurons-small.png   300 x 300, labels off, note explains why
  previews/thumb-neurons.webp  480 x 300 for the hub catalog (cropped from the dark preview)
Refuses to write an image that is mostly empty.
"""
import sys, io, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "test"))
import render
from playwright.sync_api import sync_playwright
from PIL import Image, ImageStat

OUT = render.ROOT / "previews"
OUT.mkdir(exist_ok=True)


def shot(b, base, w, h, bg, hover, path):
    errs = []
    ctx, pg = render.new_page(b, "%s/test/page.html?w=%d&h=%d&fx=worm%s" % (base, w, h, ("&bg=" + bg) if bg else ""), w, h, errs)
    render.wait_idle(pg, 1400)
    if hover:
        bb = pg.locator('.nx-node[data-id="%s"] .nx-dot' % hover).bounding_box()
        pg.mouse.move(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)
        pg.wait_for_timeout(1200)
    sx = pg.evaluate("() => [scrollX, scrollY, document.getElementById('stage').scrollLeft, document.getElementById('stage').scrollTop]")
    assert sx == [0, 0, 0, 0], "page scrolled: %s" % sx
    png = pg.screenshot(type="png")
    ctx.close()
    assert not errs, errs
    im = Image.open(io.BytesIO(png)).convert("RGB")
    st = ImageStat.Stat(im)
    spread = sum(st.stddev) / 3
    if spread < 15:
        sys.exit("RED: %s is nearly flat (stddev %.1f); not written" % (path.name, spread))
    im.save(path, "PNG", optimize=True)
    print("wrote", path.name, im.size, "stddev %.1f" % spread)
    return im


srv, base = render.serve()
with sync_playwright() as p:
    b = p.chromium.launch()
    dark = shot(b, base, 1200, 700, None, "AVA", OUT / "neurons-dark.png")
    shot(b, base, 1200, 700, "ffffff", None, OUT / "neurons-light.png")
    shot(b, base, 300, 300, None, None, OUT / "neurons-small.png")
    b.close()
srv.shutdown()
w, h = dark.size
cw = int(h * 480 / 300)
left = (w - cw) // 2
thumb = dark.crop((left, 0, left + cw, h)).resize((480, 300), Image.LANCZOS)
thumb.save(OUT / "thumb-neurons.webp", "WEBP", quality=88)
print("wrote thumb-neurons.webp", thumb.size, (OUT / "thumb-neurons.webp").stat().st_size, "bytes")
