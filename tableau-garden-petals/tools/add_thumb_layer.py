"""Put a still of the page UNDER the Web Page object in the published AI Garden workbook.

Tableau Public draws profile thumbnails on its servers and skips Web Page objects, so a
dashboard that is one Web Page object gets a blank thumbnail. With a picture floating
underneath and the Web Page floating on top (both full canvas), viewers see only the live
page and the server's thumbnail shows the picture.

  python tools/add_thumb_layer.py AIGarden-published.twbx ai-garden-thumb.png "AI Garden.twbx"
"""
import re, sys, zipfile
import xml.etree.ElementTree as ET

src, png, out = sys.argv[1], sys.argv[2], sys.argv[3]
zin = zipfile.ZipFile(src)
twb_name = [n for n in zin.namelist() if n.endswith(".twb")][0]
t = zin.read(twb_name).decode("utf-8")

dash_start = t.index("<dashboard ")
zones_start = t.index("<zones>", dash_start)
zones_end = t.index("</zones>", zones_start) + len("</zones>")
default_zones = t[zones_start:zones_end]
web = re.search(r"<zone [^>]*type-v2='web'[^>]*>.*?</zone>", default_zones, re.S)
assert web, "no Web Page zone in the default layout"
url = re.search(r"param='([^']+)'", web.group(0)).group(1)
root = re.search(r"<zone h='100000' id='(\d+)' type-v2='layout-basic' w='100000' x='0' y='0'>", default_zones)
assert root, "default layout root not found"

style = ("<zone-style><format attr='border-color' value='#000000' /><format attr='border-style' value='none' />"
         "<format attr='border-width' value='0' /><format attr='margin' value='0' /></zone-style>")
new_zones = (
    "<zones>"
    f"<zone h='100000' id='{root.group(1)}' type-v2='layout-basic' w='100000' x='0' y='0' />"
    f"<zone h='100000' id='7' is-scaled='1' param='Image/{png.split('/')[-1]}' type-v2='bitmap' w='100000' x='0' y='0'>{style}</zone>"
    f"<zone forceUpdate='' h='100000' id='3' param='{url}' type-v2='web' w='100000' x='0' y='0'>{style}</zone>"
    "</zones>"
)
t2 = t[:zones_start] + new_zones + t[zones_end:]
ET.fromstring(t2.split("?>", 1)[1] if t2.startswith("<?xml") else t2)

zones_xml = t2[t2.index("<dashboard "):t2.index("<devicelayouts>")]
order = re.findall(r"type-v2='([\w-]+)'", zones_xml)
assert order == ["layout-basic", "bitmap", "web"], order

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for n in zin.namelist():
        z.writestr(n, t2.encode("utf-8") if n == twb_name else zin.read(n))
    z.write(png, "Image/" + png.split("/")[-1])
with zipfile.ZipFile(out) as z:
    names = z.namelist()
    assert "Image/" + png.split("/")[-1] in names
print("wrote", out, "| zones:", " < ".join(order), "| web url:", url, "| members:", names)
