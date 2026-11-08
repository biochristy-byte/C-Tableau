"""package_twbx.py - package a built .twb into a .twbx WITHOUT driving the Tableau GUI.

It does what File > Save As .twbx does:
  - each extract's dbname becomes the relative 'Data/extracts/<name>.hyper' and the
    .hyper file travels inside the zip
  - each dashboard background's bitmap param becomes the relative 'Image/<name>.png'
    and the PNG travels inside
  - every custom shape the workbook uses (optional, --shapes-dir) is embedded as
    base64 in <external><shapes> just before </workbook>
Then it re-opens the zip and asserts that every reference resolves to a member and
that the twb parses.

    python package_twbx.py in.twb out.twbx [--shapes-dir DIR] [--min-extracts N]

Not proven by this script: that Tableau opens the result. Only opening it in Tableau
proves that (see load_errors.py). Never drive the GUI to save: a package built here
needs no Save keystroke at all.

--shapes-dir DIR : folder that holds shape PNGs. A shape is any quoted 'Folder/name.png'
                   token in the twb whose file exists at DIR/Folder/name.png.
--min-extracts N : go RED when fewer than N extracts are found (default 0 = none needed).
"""
import base64
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile


def package(twb_path, out_path, shapes_dir=None, min_extracts=0):
    xml = open(twb_path, encoding="utf-8").read()
    members = {}

    hypers = sorted(set(re.findall(r"dbname='([^']+\.hyper)'", xml)))
    if len(hypers) < min_extracts:
        raise SystemExit(f"RED: found {len(hypers)} extracts, expected at least {min_extracts}")
    for p in hypers:
        rel = "Data/extracts/" + os.path.basename(p)
        if not os.path.exists(p):
            raise SystemExit(f"RED: extract not found on disk: {p}")
        members[rel] = open(p, "rb").read()
        xml = xml.replace(f"dbname='{p}'", f"dbname='{rel}'")

    pngs = sorted(set(re.findall(r"param='([^']+\.png)' type-v2='bitmap'", xml)))
    for p in pngs:
        rel = "Image/" + os.path.basename(p)
        if not os.path.exists(p):
            raise SystemExit(f"RED: background image not found on disk: {p}")
        members[rel] = open(p, "rb").read()
        xml = xml.replace(f"param='{p}'", f"param='{rel}'")

    shapes = []
    if shapes_dir:
        shapes = sorted({n for n in re.findall(r"'([A-Za-z0-9_ -]+/[A-Za-z0-9_. -]+\.png)'", xml)
                         if os.path.exists(os.path.join(shapes_dir, n))})
        if shapes:
            if "<external>" in xml:
                raise SystemExit("RED: the twb already has an <external> block")
            block = "  <external>\n    <shapes>\n" + "".join(
                "      <shape name='%s'>%s</shape>\n" % (
                    n, base64.b64encode(open(os.path.join(shapes_dir, n), "rb").read()).decode())
                for n in shapes) + "    </shapes>\n  </external>\n"
            if not xml.rstrip().endswith("</workbook>"):
                raise SystemExit("RED: the twb does not end with </workbook>")
            xml = xml.rstrip()[:-len("</workbook>")] + block + "</workbook>\n"

    body = xml.split("?>", 1)[1] if xml.lstrip().startswith("<?xml") else xml
    ET.fromstring(body)
    if re.search(r"(dbname|param)='[A-Za-z]:[/\\]", xml):
        raise SystemExit("RED: an absolute extract or image path survived")

    twb_name = os.path.splitext(os.path.basename(out_path))[0] + ".twb"
    tmp = out_path + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(twb_name, xml.encode("utf-8"))
        for k in sorted(members, key=lambda k: (not k.startswith("Data"), k)):
            z.writestr(k, members[k])

    with zipfile.ZipFile(tmp) as z:
        names = set(z.namelist())
        t = z.read(twb_name).decode("utf-8")
        refs = re.findall(r"dbname='([^']+\.hyper)'", t) + re.findall(r"param='([^']+\.png)'", t)
        missing = [r for r in refs if r not in names]
        if missing:
            raise SystemExit(f"RED: references with no member: {missing}")
        if z.testzip() is not None:
            raise SystemExit("RED: zip failed its CRC test")
    os.replace(tmp, out_path)
    print(f"wrote {out_path}: {len(names)} members ({len(hypers)} extracts, {len(pngs)} backgrounds, "
          f"twb), {len(shapes)} shapes embedded, {len(refs)} references all resolve")
    return sorted(names)


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    opts = {a.split("=", 1)[0]: a.split("=", 1)[1] for a in argv if a.startswith("--") and "=" in a}
    if len(args) != 2:
        print(__doc__)
        return 2
    package(args[0], args[1], opts.get("--shapes-dir"), int(opts.get("--min-extracts", 0)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
