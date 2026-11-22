"""Capture the hub catalog thumbnail from the standalone build.

  python tools/make_thumbnail.py preview/tide-lines-thumbnail.png

1280 x 790 (the Garden Petals size), opened with ?embed=1 so no Exit pill, captured after the
entrance has settled (2.5 s). Builds the standalone page first if it is missing. Refuses to write a
blank or near-empty image: the picture must hold both the dark background and real colour.
"""
import io, pathlib, subprocess, sys
from playwright.sync_api import sync_playwright
from PIL import Image, ImageStat

ROOT = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "preview" / "tide-lines-thumbnail.png"
page = ROOT / "standalone" / "index.html"
r = subprocess.run([sys.executable, str(ROOT / "tools" / "build_standalone.py"), "--data", str(ROOT / "example" / "birth-weight.csv"),
                    "--category", "Mother group", "--value", "Birth weight (g)", "--color", "Mother smoked in pregnancy", "--label", "Short name",
                    "--settings", str(ROOT / "example" / "dark-settings.json"), "--title", "Birth weight ridgelines", "--expect-rows", "189", "--out", str(page)],
                   capture_output=True, text=True)
if r.returncode:
    sys.exit("RED: build failed\n" + r.stdout + r.stderr)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 790}, device_scale_factor=1)
    pg.goto(page.as_uri() + "?embed=1")
    pg.wait_for_function("document.querySelector('.tl-svg')")
    pg.wait_for_timeout(2500)
    png = pg.screenshot(type="png")
    b.close()
im = Image.open(io.BytesIO(png)).convert("RGB")
mean = sum(ImageStat.Stat(im).mean) / 3
small = im.resize((128, 79))
teal = sum(1 for x in range(128) for y in range(79) if small.getpixel((x, y))[2] > 120 and small.getpixel((x, y))[0] < 200) / (128 * 79)
print("size %s | mean brightness %.1f | colour share %.1f%%" % (im.size, mean, teal * 100))
if im.size != (1280, 790) or mean < 15 or mean > 140 or teal < 0.08:
    sys.exit("RED: thumbnail does not look like the dark ridgeline; not written")
im.save(out, "PNG", optimize=True)
print("wrote", out, out.stat().st_size, "bytes")
