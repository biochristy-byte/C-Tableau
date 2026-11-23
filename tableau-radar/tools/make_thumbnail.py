"""Capture the hub catalog thumbnail from the standalone build.

  python tools/make_thumbnail.py preview/radar-thumbnail.png

1280 x 790 (the Garden Petals size), opened with ?embed=1 so no Exit pill, captured after the
entrance has settled. Builds the standalone page first if it is missing. Refuses to write a
blank or near-empty image: the picture must hold both the dark background and real colour.
"""
import io, pathlib, subprocess, sys
from playwright.sync_api import sync_playwright
from PIL import Image, ImageStat

ROOT = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "preview" / "radar-thumbnail.png"
page = ROOT / "standalone" / "index.html"
r = subprocess.run([sys.executable, str(ROOT / "tools" / "build_standalone.py"), "--data", str(ROOT / "example" / "who-health-2019.csv"),
                    "--axis", "Indicator", "--series", "WHO region", "--value", "Value", "--label", "Indicator long name",
                    "--settings", str(ROOT / "example" / "dark-settings.json"), "--title", "Health indicators by WHO region", "--expect-rows", "49", "--out", str(page)],
                   capture_output=True, text=True)
if r.returncode:
    sys.exit("RED: build failed\n" + r.stdout + r.stderr)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 790}, device_scale_factor=1)
    pg.goto(page.as_uri() + "?embed=1")
    pg.wait_for_function("document.querySelector('.rd-svg')")
    pg.wait_for_function("document.querySelector('.rd-svg').getAttribute('data-anim') === 'done'")
    pg.wait_for_timeout(800)
    png = pg.screenshot(type="png")
    b.close()
im = Image.open(io.BytesIO(png)).convert("RGB")
mean = sum(ImageStat.Stat(im).mean) / 3
small = im.resize((128, 79))
bg = small.getpixel((2, 2))
colour = sum(1 for x in range(128) for y in range(79) if max(abs(small.getpixel((x, y))[i] - bg[i]) for i in range(3)) > 70) / (128 * 79)
print("size %s | mean brightness %.1f | corner %s | colour share %.1f%%" % (im.size, mean, bg, colour * 100))
if im.size != (1280, 790) or mean < 8 or mean > 90 or bg[2] < 20 or colour < 0.05:
    sys.exit("RED: thumbnail does not look like the dark radar; not written")
im.save(out, "PNG", optimize=True)
print("wrote", out, out.stat().st_size, "bytes")
