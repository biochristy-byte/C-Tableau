"""a11y_check.py - contrast, size and fit gates on a built Tableau workbook (or on bare colour pairs).

  Rule A: every piece of text reaches the contrast ratio (default 7:1, WCAG AAA) against the
          ground it ACTUALLY sits on.
  Rule B: no text under a minimum size (default 10 pt); a legend is 11 pt with a 13 pt
          swatch; nothing clips.

Two modes.

1. Colour pairs, no workbook needed:
     python a11y_check.py --pair "#777777" "#ffffff"
     python a11y_check.py --pair "#000000" "#ffffff" --pair "#333" "#eee" --min-ratio 4.5
     python a11y_check.py --pairs-json pairs.json        # [["#777","#fff", 10, "footer"], ...]
   Prints PASS or FAIL for each pair. Exit 1 if any fails.

2. A built workbook (.twb or .twbx):
     python a11y_check.py book.twb
     python a11y_check.py book.twbx --config a11y.json
   It reads the XML Tableau will load, not the generator's constants, so a colour that
   reaches the file by any path is measured. Every text colour in the file must belong to a
   measured pair, or the run is RED (an unmodelled colour is a gate blind spot, not a pass).

Config (JSON, every key optional; see CONFIG_DEFAULTS):
  min_ratio, min_pt, legend_pt, swatch_pt, dash_w, dash_h (px the fixed dashboard is laid
  out in), tooltip_bg, default_ground, min_pairs / min_sized / min_fits (the gate goes RED
  when it examined fewer: an empty parse must not read as a pass), dropdown_px,
  font_path (a .ttf used to measure text; Arial is the stand-in for Tableau Book),
  field_values {"Field": ["every", "value"]} (lets header-width and palette-binding checks
  see your data without this script reading your CSVs), colour_bound_fields ["Field"],
  column_header_fields ["Month"], wrapped_cell_texts ["longest cell text", ...],
  extra_pairs [["#fg", "#bg", pt, "where"]].

What it cannot see: a basemap's own labels and attribution (drawn from tiles) and Tableau's
own UI chrome (dropdown arrow, scrollbar). Those are reported as not measured, never passed.

Text-width model: Tableau renders type about 1.45x its 96 dpi width in sheets and 1.6x in
dashboard text zones on a 150%-scaled display. Those constants (K, K_ZONE) were pinned to
rendered screenshots; calibrate your own (screenshot a zone, count pixels) and change them
if your display differs. Fit checks are estimates, contrast checks are exact.

Requirements: Python 3.9+. Pillow (pip install pillow) is optional: without it text width
falls back to a rough per-character estimate.
"""
import json
import re
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

CONFIG_DEFAULTS = {
    "min_ratio": 7.0, "min_pt": 10, "legend_pt": 11, "swatch_pt": 13,
    "dash_w": 1280, "dash_h": 860, "tooltip_bg": "#ffffff", "default_ground": "#ffffff",
    "min_pairs": 1, "min_sized": 1, "min_fits": 0, "dropdown_px": 175, "font_path": None,
    "field_values": {}, "colour_bound_fields": [], "column_header_fields": [],
    "wrapped_cell_texts": [], "extra_pairs": [],
}
SWATCH = "\u25a0"
PARA = "\u00c6\n"                 # the paragraph-break run Tableau writes in text zones
K, K_ZONE, PAD = 1.45, 1.6, 10
LINE_PX_PER_PT, WRAP_PX_PER_PT = 2.4, 3.0
CFG = dict(CONFIG_DEFAULTS)

# ---------------------------------------------------------------------------- contrast


def norm_hex(h):
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    if not re.fullmatch(r"[0-9a-fA-F]{6}", h):
        raise ValueError(f"not a hex colour: {h!r}")
    return "#" + h.lower()


def lum(h):
    h = norm_hex(h).lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4  # noqa: E731
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def mix(a, b, t):
    pa = [int(norm_hex(a).lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    pb = [int(norm_hex(b).lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(pa, pb))


# ------------------------------------------------------------------------------- width
_fonts = {}
_FONT_CANDIDATES = ["C:/Windows/Fonts/arial.ttf", "/Library/Fonts/Arial.ttf",
                    "/System/Library/Fonts/Supplemental/Arial.ttf",
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
_BOLD = {"arial.ttf": "arialbd.ttf", "Arial.ttf": "Arial Bold.ttf", "DejaVuSans.ttf": "DejaVuSans-Bold.ttf"}


def _font(pt, bold):
    key = (pt, bold)
    if key in _fonts:
        return _fonts[key]
    f = None
    try:
        from PIL import ImageFont
        for cand in ([CFG["font_path"]] if CFG["font_path"] else []) + _FONT_CANDIDATES:
            p = Path(cand)
            if bold and p.name in _BOLD:
                p = p.with_name(_BOLD[p.name])
            if p.exists():
                f = ImageFont.truetype(str(p), round(pt * 4 / 3))
                break
    except ImportError:
        pass
    _fonts[key] = f
    return f


def raw_px(text, pt, bold=False):
    f = _font(pt, bold)
    if f is not None:
        return f.getlength(text)
    return len(text) * pt * (4 / 3) * (0.58 if bold else 0.52)   # rough fallback


def text_px(text, pt, bold=False, k=K):
    return k * raw_px(text, pt, bold)


def need_px(text, pt, bold=False, k=K):
    return text_px(text, pt, bold, k) + PAD


def wrap_lines(text, pt, width):
    lines = 0
    for para in text.split("\n"):
        cur, n = "", 1
        for word in para.split(" "):
            trial = (cur + " " + word).strip()
            if cur and text_px(trial, pt, k=K_ZONE) > width:
                n += 1
                cur = word
            else:
                cur = trial
        lines += n
    return lines


def calibration():
    """Self-checks that go RED if the maths or the width model drifts."""
    p = []
    if abs(ratio("#777777", "#ffffff") - 4.48) > 0.01 or abs(ratio("#000000", "#ffffff") - 21) > 1e-9:
        p.append("calibration: the WCAG contrast math does not reproduce 4.48:1 and 21:1")
    if not need_px("a much longer line of header text", 9) > need_px("short", 9):
        p.append("calibration: a longer string must need more width than a shorter one")
    if not need_px("same text", 12, True) > need_px("same text", 9):
        p.append("calibration: a larger bold size must need more width than a smaller regular one")
    return p


# ------------------------------------------------------------------------------- check


class Audit:
    def __init__(self):
        self.pairs, self.sized, self.fits, self.exempt, self.problems = [], [], [], [], []

    def pair(self, fg, bg, pt, where):
        r = ratio(fg, bg)
        self.pairs.append((r, fg.lower(), bg.lower(), pt, where))
        if r < CFG["min_ratio"]:
            self.problems.append(f"contrast {r:.2f}:1 {fg} on {bg} at {pt} pt: {where}")

    def size(self, pt, where, floor=None):
        floor = CFG["min_pt"] if floor is None else floor
        self.sized.append((pt, where))
        if pt < floor:
            self.problems.append(f"size {pt} pt under {floor} pt: {where}")

    def fit(self, need, have, where):
        self.fits.append((need, have, where))
        if need > have:
            self.problems.append(f"clips: needs {need:.0f} px, has {have:.0f} px: {where}")


def _fmt(rule, attr):
    for f in rule.findall("format"):
        if f.get("attr") == attr and f.get("field") is None and f.get("scope") is None:
            return f.get("value")
    return None


def _field_name(token):
    m = re.search(r"\[(?:none|usr|sum|pcto:sum):([^:\]]+):(?:nk|qk)\]$", token or "")
    return m.group(1) if m else None


def _values(field):
    return set(CFG["field_values"].get(field, []))


def check(twb):
    a = Audit()
    a.problems += calibration()
    for fg, bg, pt, where in CFG["extra_pairs"]:
        a.pair(norm_hex(fg), norm_hex(bg), pt, where)
    root = ET.fromstring(twb.split("?>", 1)[1] if twb.lstrip().startswith("<?xml") else twb)
    palettes = {p.get("name"): [c.text for c in p.findall("color")] for p in root.iter("color-palette")}
    # the datasource-level assignment is the one Tableau paints from
    ds_maps = {}
    for ds in root.iter("datasource"):
        for enc in ds.findall("style/style-rule/encoding"):
            ds_maps.setdefault(_field_name(enc.get("field")), {}).update(
                {m.findtext("bucket"): m.get("to") for m in enc.findall("map")})
    col_headers, sheet_w = {}, {}
    ground0 = CFG["default_ground"]

    for ws in root.iter("worksheet"):
        name = ws.get("name")
        table = ws.find("table")
        if table is None:
            continue
        rules = {}
        style = table.find("style")
        for rule in (style.findall("style-rule") if style is not None else []):
            rules.setdefault(rule.get("element"), []).append(rule)
        bg = next((v for r in rules.get("worksheet", []) if (v := _fmt(r, "background-color"))), ground0)
        maps = {}
        for r in rules.get("mark", []):
            for enc in r.findall("encoding"):
                if enc.get("type") == "palette":
                    ws_map = {m.findtext("bucket"): m.get("to") for m in enc.findall("map")}
                    fld = _field_name(enc.get("field"))
                    dsm = ds_maps.get(fld, {})
                    for k_, v_ in ws_map.items():
                        if k_ in dsm and dsm[k_].lower() != v_.lower():
                            a.problems.append(f"{name}: {fld} {k_} is {v_} on the sheet but {dsm[k_]} on the datasource")
                    maps[enc.get("field")] = sorted(set(ws_map.values()) | set(dsm.values()))
                elif enc.get("type") == "interpolated":
                    ends = palettes.get(enc.get("palette"), [])
                    if len(ends) == 2:       # the ramp's interior is a lerp, so sample it
                        ends = [mix(ends[0], ends[1], t / 10) for t in range(11)]
                    maps[enc.get("field")] = ends
        for el in ("worksheet", "label", "header"):
            for r in rules.get(el, []):
                c, s = _fmt(r, "color"), _fmt(r, "font-size")
                if s:
                    a.size(int(s), f"{name}: {el} text")
                if c:
                    a.pair(c, bg, int(s or CFG["min_pt"]), f"{name}: {el} text")
        dl_color, dl_size = None, CFG["min_pt"]
        for r in rules.get("datalabel", []):
            if _fmt(r, "color-mode") == "user":
                dl_color = _fmt(r, "color")
            dl_size = int(_fmt(r, "font-size") or CFG["min_pt"])
        for pane in table.iter("pane"):
            markel = pane.find("mark")
            mark = markel.get("class") if markel is not None else "Automatic"
            enc = pane.find("encodings")
            color_f = text_f = None
            if enc is not None:
                ce, te = enc.find("color"), enc.find("text")
                color_f = ce.get("column") if ce is not None else None
                text_f = te.get("column") if te is not None else None
            fills = maps.get(color_f, []) if color_f else []
            cfld = _field_name(color_f) if color_f else None
            if color_f and ":nk]" in color_f:
                bound = ds_maps.get(cfld, {})
                vals = _values(cfld) if cfld in CFG["colour_bound_fields"] else set()
                missing = sorted(v for v in vals if f'"{v}"' not in bound)
                if cfld in CFG["colour_bound_fields"] and (not bound or missing):
                    a.problems.append(f"{name}: colour field {cfld} is not bound at datasource level"
                                      f"{' for ' + ', '.join(missing) if missing else ''}: Tableau will paint its default palette")
            if color_f and not fills:
                a.problems.append(f"{name}: colour field {color_f} has no palette to measure")
            shown = any(f.get("attr") == "mark-labels-show" and f.get("value") == "true" for f in pane.iter("format"))
            for run in pane.findall("customized-tooltip/formatted-text/run"):
                if run.get("fontsize"):
                    a.size(int(run.get("fontsize")), f"{name}: tooltip")
                    if run.get("fontcolor"):
                        a.pair(run.get("fontcolor"), CFG["tooltip_bg"], int(run.get("fontsize")),
                               f"{name}: tooltip '{(run.text or '').strip()[:30]}'")
            if not shown:
                continue
            runs = [r for r in pane.findall("customized-label/formatted-text/run") if r.get("fontsize")]
            labels = ([(r.get("fontcolor"), int(r.get("fontsize"))) for r in runs]
                      if runs else ([(dl_color, dl_size)] if text_f else []))
            for fg, pt in labels:
                a.size(pt, f"{name}: mark label")
                where = f"{name}: {mark} mark label"
                if fg is None and not (mark in ("Text", "Automatic") and fills):
                    a.problems.append(f"{where}: automatic label ink (no user colour set)")
                    continue
                if mark in ("Text", "Automatic"):
                    for c in ([fg] if fg else fills):     # the colour encoding paints the TEXT itself
                        a.pair(c, bg, pt, where)
                elif mark in ("Bar", "Square") and fills:
                    for c in fills:                       # the label sits ON each fill
                        a.pair(fg, c, pt, where + f" on fill {c}")
                else:                                     # beside the mark, on the pane
                    a.pair(fg, bg, pt, where)

        hsize = next((int(s) for r in rules.get("label", []) if (s := _fmt(r, "font-size"))), CFG["min_pt"])
        for r in rules.get("header", []):
            for f in r.findall("format"):
                if f.get("attr") == "width" and f.get("field"):
                    fld = _field_name(f.get("field"))
                    vals = _values(fld) | {fld}
                    longest = max(vals, key=lambda v: need_px(v, hsize))
                    a.fit(need_px(longest, hsize), int(f.get("value")), f"{name}: header '{fld}' ('{longest[:40]}')")
        cols_shelf = table.findtext("cols") or ""
        one_col = re.fullmatch(r"\[[^\]]+\]\.\[none:([^:\]]+):nk\]", cols_shelf.strip())
        if one_col and table.findtext("rows") and one_col.group(1) in CFG["column_header_fields"]:
            col_headers[name] = one_col.group(1)
        for r in rules.get("cell", []):
            w, h = _fmt(r, "width"), _fmt(r, "height")
            if w and h and CFG["wrapped_cell_texts"]:
                worst = max(CFG["wrapped_cell_texts"], key=lambda t: wrap_lines(t, CFG["min_pt"], int(w) - PAD))
                n = wrap_lines(worst, CFG["min_pt"], int(w) - PAD)
                a.fit(n * WRAP_PX_PER_PT * CFG["min_pt"], int(h), f"{name}: wrapped cell, {n} lines at {w} px")

    for db in root.iter("dashboard"):
        dname = db.get("name")
        dbg, qf = ground0, {}
        dstyle = db.find("style")
        for rule in (dstyle.findall("style-rule") if dstyle is not None else []):
            if rule.get("element") == "dashboard":
                dbg = _fmt(rule, "background-color") or dbg
            if rule.get("element") in ("quick-filter", "quick-filter-title"):
                qf[rule.get("element")] = (_fmt(rule, "color"), _fmt(rule, "font-size"))

        def walk(z, ground):
            zs = z.find("zone-style")
            own = next((f.get("value") for f in zs.findall("format") if f.get("attr") == "background-color"), None) \
                if zs is not None else None
            g = own or ground
            wpx = int(z.get("w", 0)) * CFG["dash_w"] / 100000
            hpx = int(z.get("h", 0)) * CFG["dash_h"] / 100000
            kind = z.get("type-v2")
            if kind == "text":
                paras, cur = [], []
                for run in z.findall("formatted-text/run"):
                    t = run.text or ""
                    if t == PARA:
                        paras.append(cur)
                        cur = []
                        continue
                    if not run.get("fontsize") or not t.strip():
                        continue
                    pt = int(run.get("fontsize"))
                    where = f"{dname}: text '{t.strip()[:34]}'"
                    if t.strip() == SWATCH:
                        a.size(pt, where + " (swatch)", CFG["swatch_pt"])
                        a.exempt.append((run.get("fontcolor"), g, where))
                    else:
                        a.size(pt, where)
                        if run.get("fontcolor"):
                            a.pair(run.get("fontcolor"), g, pt, where)
                    cur.append((t, pt, run.get("bold") == "true"))
                paras.append(cur)
                if any(t.strip() == SWATCH for p_ in paras for t, _pt, _b in p_):   # a legend
                    for p_ in paras:
                        for t, pt, b in p_:
                            if not b and t.strip() != SWATCH:
                                a.size(pt, f"{dname}: legend label '{t.strip()}'", CFG["legend_pt"])
                need_w = max((sum(text_px(t, pt, b, K_ZONE) for t, pt, b in p_) + PAD for p_ in paras if p_), default=0)
                need_h = sum(max(pt for _t, pt, _b in p_) * LINE_PX_PER_PT for p_ in paras if p_)
                label = " ".join(t for p_ in paras for t, _pt, _b in p_).strip()[:40]
                a.fit(need_w, wpx, f"{dname}: text zone width '{label}'")
                a.fit(need_h, hpx, f"{dname}: text zone height '{label}'")
            elif kind == "filter":
                cap = _field_name(z.get("param")) or "filter"
                c, s = qf.get("quick-filter-title", (None, None))
                if c and s:
                    a.pair(c, g, int(s), f"{dname}: filter title '{cap}'")
                bc, bs = qf.get("quick-filter", (None, None))
                if bc and bs:
                    a.pair(bc, g, int(bs), f"{dname}: filter body '{cap}'")
                for _c, s2 in (qf.get("quick-filter-title", (0, 0)), qf.get("quick-filter", (0, 0))):
                    if s2:
                        a.size(int(s2), f"{dname}: filter '{cap}'")
                if z.get("show-title") != "false" and s:
                    a.fit(need_px(cap, int(s)) + CFG["dropdown_px"], wpx, f"{dname}: filter '{cap}' title beside its dropdown")
            elif z.get("name") and kind is None:
                sheet_w[z.get("name")] = wpx
            for k in z.findall("zone"):
                walk(k, g)

        for top in db.find("zones").findall("zone"):
            walk(top, dbg)
        if not qf and any(z.get("type-v2") == "filter" for z in db.iter("zone")):
            a.problems.append(f"{dname}: quick filters carry no colour or size of their own")
    _sheet_fits(a, root, sheet_w, col_headers)

    forms = {}
    for c in root.iter("column"):
        calc = c.find("calculation")
        if calc is not None and c.get("name"):
            forms.setdefault(c.get("name"), set()).add(calc.get("formula"))
    for n_, fs_ in forms.items():
        if len(fs_) > 1:
            a.problems.append(f"calc {n_} is declared with {len(fs_)} different formulas; Tableau keeps one for every sheet")
    for m in re.finditer(r"fontsize='(\d+)'", twb):
        if int(m.group(1)) < CFG["min_pt"]:
            a.problems.append(f"raw sweep: fontsize {m.group(1)} at offset {m.start()}")
    for m in re.finditer(r"attr='font-size'[^>]*value='(\d+)'", twb):
        if int(m.group(1)) < CFG["min_pt"]:
            a.problems.append(f"raw sweep: font-size {m.group(1)} at offset {m.start()}")
    measured = {fg for _r, fg, _bg, _pt, _w in a.pairs} | {e[0].lower() for e in a.exempt if e[0]}
    for c in {x.lower() for x in re.findall(r"fontcolor='(#[0-9a-fA-F]{6})'", twb)}:
        if c not in measured:
            a.problems.append(f"raw sweep: text colour {c} is in the file but no pair measured it")
    return a


def _sheet_fits(a, root, sheet_w, col_headers):
    for ws in root.iter("worksheet"):
        n = ws.get("name")
        if n not in sheet_w:
            continue
        wpx = sheet_w[n] - 8          # the sheet zone's 4 px margin, both sides
        if n in col_headers and _values(col_headers[n]):
            vals = _values(col_headers[n])
            row_w = sum(int(f.get("value")) for f in ws.iter("format") if f.get("attr") == "width" and f.get("field"))
            longest = max(vals, key=lambda v: need_px(v, CFG["min_pt"]))
            a.fit(need_px(longest, CFG["min_pt"]), (wpx - row_w) / len(vals), f"{n} column header '{longest}'")
        for run in ws.findall(".//customized-label/formatted-text/run"):
            t = (run.text or "").strip()
            if run.get("fontsize") and t and not t.startswith("<"):
                a.fit(need_px(t, int(run.get("fontsize")), True), wpx, f"{n} big-number caption '{t}'")


def report(a, label=""):
    lines = [f"a11y {label}: {len(a.pairs)} text/ground pairs, {len(a.sized)} sized runs, "
             f"{len(a.fits)} fit checks, {len(a.exempt)} swatches (non-text, size only)"]
    for r, fg, bg, pt, w in sorted(a.pairs)[:5]:
        lines.append(f"   {r:5.2f}:1  {fg} on {bg}  {pt} pt  {w}")
    if a.sized:
        smallest = min(a.sized)
        lines.append(f"   smallest text {smallest[0]} pt ({smallest[1]})")
    for need, have, w in sorted(a.fits, key=lambda f: f[1] - f[0])[:3]:
        lines.append(f"   tightest fit {have - need:+.0f} px  {w}")
    for n, floor, what in [(len(a.pairs), CFG["min_pairs"], "pairs"), (len(a.sized), CFG["min_sized"], "sized runs"),
                           (len(a.fits), CFG["min_fits"], "fit checks")]:
        if n < floor:
            a.problems.append(f"only {n} {what} examined, floor {floor}: the gate saw too little")
    return lines


def controls(twb):
    """Sabotage the book in ways that must go RED. A control that finds nothing to change
    is reported as NOT APPLICABLE, never as a pass."""
    cases = [
        ("a text colour swapped to #bbbbbb", "contrast",
         lambda t: re.sub(r"fontcolor='#[0-9a-fA-F]{6}'", "fontcolor='#bbbbbb'", t, count=1)),
        ("a run shrunk to 6 pt", "size",
         lambda t: re.sub(r"fontsize='\d+'", "fontsize='6'", t, count=1)),
    ]
    out, bad = [], []
    for what, kind, sab in cases:
        t2 = sab(twb)
        if t2 == twb:
            out.append(f"   control '{what}': NOT APPLICABLE (nothing in this book to sabotage)")
            continue
        hits = [p for p in check(t2).problems if kind in p]
        out.append(f"   control '{what}': {len(hits)} {kind} finding(s) -> "
                   f"{'FAILED as it must' if hits else 'PASSED, so the gate is blind'}")
        if not hits:
            bad.append(f"control '{what}' was not caught")
    return out, bad


def load(path):
    path = Path(path)
    if path.suffix == ".twbx":
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.endswith(".twb"))
            return z.read(name).decode("utf-8")
    return path.read_text(encoding="utf-8")


def run_pairs(pairs):
    """pairs: [(fg, bg, pt, label)]. Returns exit code."""
    probs = calibration()
    bad = 0
    print(f"checking {len(pairs)} pair(s) at {CFG['min_ratio']}:1")
    for fg, bg, pt, label in pairs:
        r = ratio(fg, bg)
        ok = r >= CFG["min_ratio"]
        bad += not ok
        print(f"  {'PASS' if ok else 'FAIL'}  {r:5.2f}:1  {norm_hex(fg)} on {norm_hex(bg)}"
              f"{'  ' + str(pt) + ' pt' if pt else ''}{'  ' + label if label else ''}")
    for p in probs:
        print("  CALIBRATION RED:", p)
    return 1 if bad or probs else 0


def main(argv):
    pos, pairs, i = [], [], 0
    while i < len(argv):
        a = argv[i]
        if a == "--pair":
            pairs.append((argv[i + 1], argv[i + 2], 0, ""))
            i += 3
        elif a in ("--config", "--pairs-json", "--min-ratio", "--min-pt"):
            v = argv[i + 1]
            if a == "--config":
                CFG.update(json.loads(Path(v).read_text(encoding="utf-8")))
            elif a == "--pairs-json":
                pairs += [(p[0], p[1], p[2] if len(p) > 2 else 0, p[3] if len(p) > 3 else "")
                          for p in json.loads(Path(v).read_text(encoding="utf-8"))]
            elif a == "--min-ratio":
                CFG["min_ratio"] = float(v)
            else:
                CFG["min_pt"] = int(v)
            i += 2
        elif a.startswith("--"):
            print(__doc__)
            return 2
        else:
            pos.append(a)
            i += 1
    if pairs and not pos:
        return run_pairs(pairs)
    if not pos:
        print(__doc__)
        return 2
    twb = load(pos[0])
    a = check(twb)
    for line in report(a, Path(pos[0]).name):
        print(line)
    ctl, bad = controls(twb)
    for line in ctl:
        print(line)
    print("   not measured: basemap labels and attribution (tile text, not in the file); "
          "Tableau's own dropdown and scrollbar chrome")
    if a.problems or bad:
        print("RED")
        for p in a.problems + bad:
            print("  -", p)
        return 1
    print(f"GREEN: every text pair {CFG['min_ratio']:g}:1 or better, nothing under {CFG['min_pt']} pt, nothing clips")
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
