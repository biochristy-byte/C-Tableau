"""tableau_inject.py - the smallest complete injector: build a multi-worksheet Tableau
dashboard by MUTATING a Tableau-authored template.

Why this approach works:
  - Tableau authors the datasource and a valid skeleton for your version. We keep it verbatim.
  - Data is shaped to the right grain before Tableau sees it, so no in-Tableau filter is needed.
  - The dashboard is a flow container (layout-basic > layout-flow > worksheet leaf zones),
    which is reliable; floating geometry is not.
  - Coordinates are per-myriad (0..100000), absolute, and tile their parent box exactly.

What it does to the template text:
  1. add human-readable value aliases to string columns
  2. replace the <worksheets> block with one bar sheet per entry in the config
  3. insert a <dashboards> block right after </worksheets>
  4. replace the <windows> block (one window per sheet plus one for the dashboard)

    python tableau_inject.py --template template.twb --config inject.json --out built.twb

Config (JSON):
{
  "measure": "amount",                     # SUM of this column is the bar length
  "measure_caption": "Amount",             # optional: rename the measure's caption
  "dashboard": {"name": "My Dashboard", "title": "My Dashboard", "w": 1000, "h": 800},
  "sheets": [{"name": "Headline text", "dim": "category", "color": null}, ...],
  "aliases": {"flag": {"TRUE": "Yes", "FALSE": "No"}},       # optional
  "layout": ["vert", [[["text", "Title"], 0.5],              # (node, weight) pairs
                      [["sheet", "Headline text"], 1.1],
                      [["horz", [["sheet", "A"], ["sheet", "B"]]], 1.2]]],
  "data_dir": "path"                       # optional: repoint the textscan directory and drop
                                           # the embedded extract so Tableau reads the live CSV
}
Sheet names double as displayed titles, so make them the takeaway headline.

The result is well-formed XML, not a proven workbook: open it in Tableau (load_errors.py
prints the full error list if Tableau refuses it). Never save it by sending Ctrl+S; in
Tableau Public that publishes. Use File > Save As by hand.

Requirements: Python 3.9+, standard library only.
"""
import json
import os
import re
import sys
import uuid as uuidlib
import xml.etree.ElementTree as ET


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&apos;")


def gen_uuid(seed):
    """Deterministic, so a rebuild does not change every id in the file."""
    return "{%s}" % str(uuidlib.uuid5(uuidlib.NAMESPACE_DNS, "inject-" + seed)).upper()


def add_value_aliases(twb, field, mapping):
    """Add value aliases to a datasource string column (TRUE -> Yes)."""
    aliases = "".join(f"<alias key='&quot;{k}&quot;' value='{esc(v)}' />" for k, v in mapping.items())
    # the datasource column is self-closing: <column ... name='[field]' ... />
    pat = re.compile(r"(<column\b[^>]*\bname='\[" + re.escape(field) + r"\][^>]*?)\s*/>")
    new, n = pat.subn(lambda m: m.group(1) + "><aliases>" + aliases + "</aliases></column>", twb, count=1)
    return new if n else twb


def datasource_id(twb):
    return re.search(r"<datasource\b[^>]*\bname='(federated\.[^']+)'", twb).group(1)


def datasource_caption(twb):
    m = re.search(r"<datasource\b[^>]*\bcaption='([^']+)'", twb)
    return m.group(1) if m else "data"


def point_at_live_data(twb, data_dir):
    twb = re.sub(r"(<connection class='textscan' directory=)'[^']*'", lambda m: m.group(1) + "'%s'" % data_dir, twb)
    # An embedded .hyper extract holds the OLD data; remove it so Tableau reads the live CSV.
    return re.sub(r"\s*<extract\b.*?</extract>", "", twb, flags=re.S)


def worksheet_xml(ds, caption, spec, measure):
    name, dim, color = spec["name"], spec["dim"], spec.get("color")
    none_dim = f"[{ds}].[none:{dim}:nk]"
    sum_meas = f"[{ds}].[sum:{measure}:qk]"
    deps = [
        f"<column datatype='string' name='[{dim}]' role='dimension' type='nominal' />",
        f"<column datatype='integer' name='[{measure}]' role='measure' type='quantitative' />",
        f"<column-instance column='[{dim}]' derivation='None' name='[none:{dim}:nk]' pivot='key' type='nominal' />",
        f"<column-instance column='[{measure}]' derivation='Sum' name='[sum:{measure}:qk]' pivot='key' type='quantitative' />",
    ]
    color_enc = ""
    if color:
        deps.insert(2, f"<column datatype='string' name='[{color}]' role='dimension' type='nominal' />")
        deps.append(f"<column-instance column='[{color}]' derivation='None' name='[none:{color}:nk]' pivot='key' type='nominal' />")
        color_enc = f"\n            <encodings>\n              <color column='[{ds}].[none:{color}:nk]' />\n            </encodings>"
    deps_xml = "\n          ".join(deps)
    sort = f"<sort class='computed' column='{none_dim}' direction='DESC' using='{sum_meas}' />"
    # element order inside <table> is view, style, panes, rows, cols; <aggregation> is last in <view>
    return f"""    <worksheet name='{esc(name)}'>
      <table>
        <view>
          <datasources>
            <datasource caption='{caption}' name='{ds}' />
          </datasources>
          <datasource-dependencies datasource='{ds}'>
          {deps_xml}
          </datasource-dependencies>
          {sort}
          <aggregation value='true' />
        </view>
        <style />
        <panes>
          <pane selection-relaxation-option='selection-relaxation-allow'>
            <view>
              <breakdown value='auto' />
            </view>
            <mark class='Bar' />{color_enc}
          </pane>
        </panes>
        <rows>{none_dim}</rows>
        <cols>{sum_meas}</cols>
      </table>
      <simple-id uuid='{gen_uuid(name)}' />
    </worksheet>"""


class ZoneBuilder:
    """Splits a box among children by weight. The last child takes the remainder, so the
    children always tile the parent exactly (no gap, no overlap)."""

    def __init__(self):
        self.id = 0
        self.lines = []

    def nid(self):
        self.id += 1
        return self.id

    def emit(self, node, x, y, w, h):
        kind = node[0]
        if kind == "sheet":
            self.lines.append(f"<zone h='{h}' id='{self.nid()}' name='{esc(node[1])}' w='{w}' x='{x}' y='{y}' />")
            return
        if kind == "text":
            self.lines.append(
                f"<zone h='{h}' id='{self.nid()}' type='text' w='{w}' x='{x}' y='{y}'>"
                f"<formatted-text><run bold='true' fontname='Tableau Bold' fontsize='18'>{esc(node[1])}</run>"
                f"</formatted-text></zone>")
            return
        norm = []
        for c in node[1]:
            norm.append((c, 1.0) if isinstance(c[0], str) else (c[0], c[1]))   # bare node or (node, weight)
        total = sum(wt for _, wt in norm)
        param = "vert" if kind == "vert" else "horz"
        self.lines.append(f"<zone h='{h}' id='{self.nid()}' param='{param}' type='layout-flow' w='{w}' x='{x}' y='{y}'>")
        span = h if kind == "vert" else w
        used = 0
        for i, (child, wt) in enumerate(norm):
            seg = (span - used) if i == len(norm) - 1 else int(span * wt / total)
            if kind == "vert":
                self.emit(child, x, y + used, w, seg)
            else:
                self.emit(child, x + used, y, seg, h)
            used += seg
        self.lines.append("</zone>")


def dashboard_xml(ds, caption, dash, layout):
    zb = ZoneBuilder()
    zb.lines.append(f"<zone h='100000' id='{zb.nid()}' type='layout-basic' w='100000' x='0' y='0'>")
    zb.emit(layout, 0, 0, 100000, 100000)
    zb.lines.append("</zone>")
    zones = "\n        ".join(zb.lines)
    w, h, name = dash.get("w", 1000), dash.get("h", 800), esc(dash["name"])
    return f"""  <dashboards>
    <dashboard name='{name}'>
      <style />
      <size maxheight='{h}' maxwidth='{w}' minheight='{h}' minwidth='{w}' sizing-mode='fixed' />
      <datasources>
        <datasource caption='{caption}' name='{ds}' />
      </datasources>
      <zones>
        {zones}
      </zones>
      <simple-id uuid='{gen_uuid(dash["name"])}' />
    </dashboard>
  </dashboards>"""


def worksheet_window(name):
    return f"""    <window class='worksheet' maximized='false' name='{esc(name)}'>
      <cards>
        <edge name='left'>
          <strip size='160'>
            <card type='pages' />
            <card type='filters' />
            <card type='marks' />
          </strip>
        </edge>
        <edge name='top'>
          <strip size='2147483647'><card type='columns' /></strip>
          <strip size='2147483647'><card type='rows' /></strip>
          <strip size='31'><card type='title' /></strip>
        </edge>
      </cards>
    </window>"""


def windows_xml(sheets, dash):
    vps = "\n        ".join(f"<viewpoint name='{esc(s['name'])}' />" for s in sheets)
    dwin = f"""    <window class='dashboard' maximized='true' name='{esc(dash["name"])}'>
      <viewpoints>
        {vps}
      </viewpoints>
      <active id='-1' />
      <simple-id uuid='{gen_uuid(dash["name"] + "-win")}' />
    </window>"""
    wins = [worksheet_window(s["name"]) for s in sheets] + [dwin]
    return "  <windows source-height='30'>\n" + "\n".join(wins) + "\n  </windows>"


def build(twb, cfg):
    for field, mapping in cfg.get("aliases", {}).items():
        twb = add_value_aliases(twb, field, mapping)
    measure = cfg["measure"]
    if cfg.get("measure_caption"):
        twb = re.sub(r"caption='[^']*'( datatype='[a-z]+' name='\[" + re.escape(measure) + r"\]')",
                     lambda m: "caption='%s'%s" % (esc(cfg["measure_caption"]), m.group(1)), twb)
    if cfg.get("data_dir"):
        twb = point_at_live_data(twb, cfg["data_dir"])
    ds, cap = datasource_id(twb), datasource_caption(twb)
    sheets, dash = cfg["sheets"], cfg["dashboard"]
    ws_block = "  <worksheets>\n" + "\n".join(worksheet_xml(ds, cap, s, measure) for s in sheets) + "\n  </worksheets>"
    if not re.search(r"  <worksheets>.*?  </worksheets>", twb, flags=re.S):
        raise SystemExit("RED: the template has no <worksheets> block (two-space indent, as Tableau writes it)")
    out = re.sub(r"  <worksheets>.*?  </worksheets>", lambda _: ws_block, twb, flags=re.S)
    out = out.replace("  </worksheets>\n", "  </worksheets>\n" + dashboard_xml(ds, cap, dash, cfg["layout"]) + "\n", 1)
    if not re.search(r"  <windows.*?</windows>", out, flags=re.S):
        raise SystemExit("RED: the template has no <windows> block")
    out = re.sub(r"  <windows.*?</windows>", lambda _: windows_xml(sheets, dash), out, flags=re.S)
    return out, ds


def main(argv):
    flags = {a: argv[i + 1] for i, a in enumerate(argv[:-1]) if a in ("--template", "--config", "--out")}
    if not all(k in flags for k in ("--template", "--config", "--out")):
        print(__doc__)
        return 2
    cfg = json.load(open(flags["--config"], encoding="utf-8"))
    twb = open(flags["--template"], encoding="utf-8").read()
    out, ds = build(twb, cfg)
    ET.fromstring(out.split("?>", 1)[1] if out.lstrip().startswith("<?xml") else out)   # well-formedness gate
    with open(flags["--out"], "w", encoding="utf-8") as f:
        f.write(out)
    print("datasource:", ds)
    print("sheets    :", [s["name"] for s in cfg["sheets"]])
    print("dashboard :", cfg["dashboard"]["name"])
    print("wrote", flags["--out"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
