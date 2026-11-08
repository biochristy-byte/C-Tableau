"""
twb_lib.py - project-neutral Tableau .twb XML-emitting machinery.

A library of string builders that emit the XML fragments a Tableau workbook needs:
datasource declarations, column and column-instance blocks, worksheets (KPI tile,
bar, stacked bar with light/dark label split, dumbbell, small multiples, text
table), tooltips, sorts, filters, palette rules, quick-filter titles, filter and
brush actions, windows, and a dashboard zone-tree layout engine (Layout, Run).

How it is meant to be used (the injection pipeline):
  1. Author a template in Tableau itself (one datasource, one sheet). Tableau writes
     the valid skeleton for your version, including the extract.
  2. Read the template text with read(), pull the datasource with ds_block().
  3. Build worksheets and dashboards with the builders below, splice them into the
     template text, and write the result.
  4. Gate every fragment with check_xml() before splicing, and open the result in
     Tableau (see load_errors.py) because well-formed XML is not the same as a
     workbook Tableau accepts.

Every builder returns or consumes raw XML fragments in Tableau's own attribute order.
Do not reorder elements or "clean up" attribute quoting: Tableau's XML parser is
picky about several orderings, noted inline (search "TRAP"). Theme constants (FONT,
INK, INK2, MUTE, PANE, BG, GRID, AXIS, SZ_*) are plain module attributes on purpose:
override them before calling a builder (twb_lib.INK = "#222222").

Run `python twb_lib.py --demo out.twb` for a worked example that builds one bar
sheet inside a tiny synthetic workbook and proves it parses as XML.
"""
import math
import os
import re
import sys
import urllib.parse
import uuid as uuidlib
import xml.etree.ElementTree as ET

# ---- theme (override these before calling builders; see module docstring) ---------

FONT = "Tableau Book"
INK = "#333333"
INK2 = "#666666"
MUTE = "#999999"
PANE = "#ffffff"
BG = "#ffffff"
GRID = "#e6e6e6"
AXIS = "#b0b0b0"
SZ_BAN, SZ_LABEL, SZ_AXIS, SZ_HEADER = 30, 9, 8, 9
SZ_KICK, SZ_H2, SZ_TAKE, SZ_NOTE, SZ_NAV = 9, 13, 9, 8, 10


# ---- XML escaping, ids, file loading ------------------------------------------------

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&apos;")


def esc_run(s):
    """The story_layout.py variant of esc(): also escapes quotes. Kept as a separate
    function (not merged into esc()) because it is used for text placed inside <run>
    element CONTENT by Layout.run(), where the source additionally escaped quotes as a
    defensive habit; esc() above is used for XML ATTRIBUTE values throughout the rest of
    this module and must stay exactly as the source had it."""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace("'", "&apos;").replace('"', "&quot;"))


def gen_uuid(seed, prefix="twb"):
    """Deterministic {UUID} for a <simple-id>, stable across rebuilds so re-running the
    generator does not spuriously change every uuid in the file.
    # adapted: the source hardwired its own prefix (a project-specific string); it is now an argument."""
    return "{%s}" % str(uuidlib.uuid5(uuidlib.NAMESPACE_DNS, prefix + "-" + seed)).upper()


def read(p):
    return open(p, encoding="utf-8").read()


load_template = read


# ---- datasource plumbing ------------------------------------------------------------

def ds_block(twb):
    """Pull the first <datasource ...>...</datasource> block out of a Tableau-authored
    .twb (the extraction assumes a single, un-joined datasource per template, one
    template per data grain - author one template per grain in Tableau, then patch it)."""
    return re.search(r"  <datasource .*?</datasource>", twb, re.S).group(0)


def ds_id(block):
    return re.search(r"name='(federated\.[^']+)'", block).group(1)


def ds_caption(block):
    return re.search(r"caption='([^']+)'", block).group(1)


def add_aliases(block, field, mapping):
    # string keys are quoted; the null key is Tableau's bare %null% (form seen in a
    # Tableau-authored datasource)
    aliases = "".join(f"<alias key='{esc(k) if k == '%null%' else '&quot;' + esc(k) + '&quot;'}' value='{esc(v)}' />"
                      for k, v in mapping.items())
    pat = re.compile(r"(<column\b[^>]*\bname='\[" + re.escape(field) + r"\][^>]*?)\s*/>")
    new, n = pat.subn(r"\1><aliases>" + aliases + r"</aliases></column>", block, count=1)
    assert n == 1, f"alias target [{field}] not found"
    return new


def recaption(block, field, caption):
    pat = re.compile(r"(<column\b[^>]*\bcaption=)'[^']*'([^>]*\bname='\[" + re.escape(field) + r"\]')")
    new, n = pat.subn(r"\1'" + esc(caption) + r"'\2", block, count=1)
    assert n == 1, f"recaption target [{field}] not found"
    return new


def set_default_format(block, field, fmt):
    """A field's mark-label number format lives on its datasource <column default-format>
    (a worksheet 'label' text-format rule formats AXIS labels, not mark labels)."""
    pat = re.compile(r"(<column\b[^>]*\bname='\[" + re.escape(field) + r"\]')")
    new, n = pat.subn(r"\1 default-format='" + esc(fmt) + "'", block, count=1)
    assert n == 1, f"default-format target [{field}] not found"
    return new


def has_column(block, field):
    return re.search(r"<column\b[^>]*\bname='\[" + re.escape(field) + r"\]'", block) is not None


def ds_declare(block, calcs=(), palettes=None):
    """calcs: calc <column> xml strings to declare after <aliases/>. palettes: {token:
    mapping} written as ONE datasource <style> after <layout/>, each with a matching
    <column-instance> before <extract>. TRAP (column-instance-before-reference): without
    the instance the color map is inert - a worksheet-level copy of the identical rule is
    parsed without error but silently ignored (verified against Tableau-authored
    workbooks)."""
    if calcs:
        anchor = "      <aliases enabled='yes' />\n"
        assert anchor in block, "aliases anchor"
        block = block.replace(anchor, anchor + "".join("      " + c + "\n" for c in calcs), 1)
    if palettes:
        encs = ""
        insts = ""
        for tok, mapping in palettes.items():
            maps = "".join(f"<map to='{c}'><bucket>&quot;{esc(k)}&quot;</bucket></map>" for k, c in sorted(mapping.items(), key=lambda kv: kv[1]))
            encs += f"<encoding attr='color' field='[{tok}]' type='palette'>{maps}</encoding>"
            m = re.match(r"none:([A-Za-z_0-9]+):nk", tok)
            insts += f"      <column-instance column='[{m.group(1)}]' derivation='None' name='[{tok}]' pivot='key' type='nominal' />\n"
        lay = re.search(r"      <layout [^>]*/>\n", block).group(0)
        block = block.replace(lay, lay + "      <style><style-rule element='mark'>" + encs + "</style-rule></style>\n", 1)
        ext = "      <extract "
        assert ext in block
        block = block.replace(ext, insts + ext, 1)
    return block


# ---- shared XML helpers --------------------------------------------------------------

def base_style_rules(grid=False):
    """Fonts and lines. grid=True keeps light column gridlines and a muted zero line, and
    hides the row field labels ("Hide Field Labels for Rows"; form learned from a
    Tableau-authored file: a worksheet-element format display-field-labels
    scope='rows' value='false'). TRAP (gridline/zeroline spelling): Tableau's own
    element names here are 'gridline' and 'zeroline' - one word each, no hyphen; do not
    "correct" them to 'grid-line'/'zero-line', the rule silently does nothing if you do."""
    fl = "<format attr='display-field-labels' scope='rows' value='false' />" if grid else ""
    if grid == "zero":
        lines = (
            "          <style-rule element='gridline'><format attr='stroke-size' value='0' /><format attr='line-visibility' value='off' /></style-rule>\n"
            f"          <style-rule element='zeroline'><format attr='stroke-color' value='{MUTE}' /><format attr='stroke-size' value='1' /><format attr='line-visibility' value='on' /></style-rule>\n")
    elif grid:
        lines = (
            f"          <style-rule element='gridline'><format attr='stroke-color' scope='cols' value='{GRID}' /><format attr='stroke-size' scope='cols' value='1' /><format attr='line-visibility' scope='cols' value='on' /><format attr='line-visibility' scope='rows' value='off' /></style-rule>\n"
            f"          <style-rule element='zeroline'><format attr='stroke-color' value='{MUTE}' /><format attr='stroke-size' value='1' /><format attr='line-visibility' value='on' /></style-rule>\n")
    else:
        lines = (
            "          <style-rule element='gridline'><format attr='stroke-size' value='0' /><format attr='line-visibility' value='off' /></style-rule>\n"
            "          <style-rule element='zeroline'><format attr='stroke-size' value='0' /><format attr='line-visibility' value='off' /></style-rule>\n")
    return (
        f"          <style-rule element='label'><format attr='font-family' value='{FONT}' /><format attr='font-size' value='{SZ_HEADER}' /><format attr='color' value='{INK}' /></style-rule>\n"
        f"          <style-rule element='datalabel'><format attr='color-mode' value='user' /><format attr='color' value='{INK}' /><format attr='font-family' value='{FONT}' /><format attr='font-size' value='{SZ_LABEL}' /></style-rule>\n"
        f"          <style-rule element='pane'><format attr='background-color' value='{PANE}' /></style-rule>\n"
        f"          <style-rule element='worksheet'><format attr='background-color' value='{PANE}' /><format attr='font-family' value='{FONT}' /><format attr='font-size' value='{SZ_AXIS}' /><format attr='color' value='{INK2}' />{fl}</style-rule>\n"
        "          <style-rule element='dropline'><format attr='line-visibility' value='off' /></style-rule>\n"
        "          <style-rule element='refline'><format attr='line-visibility' value='off' /></style-rule>\n"
        + lines +
        "          <style-rule element='table-div'><format attr='line-visibility' scope='rows' value='off' /><format attr='line-visibility' scope='cols' value='off' /></style-rule>\n")


def palette_rule(ds, field_token, mapping):
    """Fixed color assignment. field_token is the instance name, e.g. [none:field:nk]."""
    maps = "".join(f"<map to='{c}'><bucket>&quot;{esc(k)}&quot;</bucket></map>" for k, c in mapping.items())
    return (f"          <style-rule element='mark'><encoding attr='color' field='[{ds}].{field_token}' type='palette'>"
            f"{maps}</encoding></style-rule>\n")


def style_block(extra="", grid=False):
    # Tableau-authored order (verified against a Tableau-authored workbook): axis, mark,
    # ... pane, worksheet, lines
    return "<style>\n" + extra + base_style_rules(grid) + "        </style>"


NO_TITLE = "<layout-options><title><formatted-text /></title></layout-options>"


def themeify(ws, name, style_extra="", grid=False, title=False):
    """Swap the empty placeholder <style /> for the themed block. TRAP (<style/> before
    <panes>): worksheet() below emits an empty <style /> in that exact slot, before
    <panes>; this function replaces IT IN PLACE rather than appending a second <style>,
    because Tableau's <table> schema wants exactly one <style>, positioned before
    <panes>. Sheet titles are OFF by default (title=False): a dashboard usually carries
    its own title text zone instead."""
    ws = ws.replace("        <style />", "        " + style_block(style_extra, grid), 1)
    if title:
        lo = ("<layout-options><title><formatted-text>"
              f"<run bold='true' fontcolor='{INK}' fontname='{FONT}' fontsize='12'>{esc(name)}</run>"
              "</formatted-text></title></layout-options>")
    else:
        lo = NO_TITLE
    return ws.replace("      <table>", "      " + lo + "\n      <table>", 1)


def tooltip(rows):
    """rows = list of (label, token). token already includes [ds].[...]."""
    runs = []
    for label, tok in rows:
        runs.append(f"<run fontcolor='{MUTE}' fontname='{FONT}' fontsize='10'>{esc(label)}: </run>")
        runs.append(f"<run bold='true' fontcolor='{INK}' fontname='{FONT}' fontsize='10'><![CDATA[<{tok}>]]></run>")
        runs.append("<run>&#10;</run>")
    return ("<customized-tooltip show-buttons='false'><formatted-text>" + "".join(runs) + "</formatted-text></customized-tooltip>")


# ---- column / column-instance helpers ------------------------------------------------
# TRAP (column-instance-before-reference): every token below (e.g. [none:name:nk]) must
# have a matching <column-instance> declared in the worksheet's <datasource-dependencies>
# (or the datasource's own <column-instance> list for a datasource-level rule) BEFORE
# anything references it. A reference to an undeclared instance is parsed without error
# and simply does nothing - it never raises, so this is easy to ship broken.

def col_dim(name):
    return (f"<column datatype='string' name='[{name}]' role='dimension' type='nominal' />",
            f"<column-instance column='[{name}]' derivation='None' name='[none:{name}:nk]' pivot='key' type='nominal' />")


def col_dim_int(name):
    """integer dimension used as a discrete header ([none:name:ok])."""
    return (f"<column datatype='integer' name='[{name}]' role='dimension' type='quantitative' />",
            f"<column-instance column='[{name}]' derivation='None' name='[none:{name}:ok]' pivot='key' type='ordinal' />")


def col_meas_sum(name, dt="integer"):
    return (f"<column datatype='{dt}' name='[{name}]' role='measure' type='quantitative' />",
            f"<column-instance column='[{name}]' derivation='Sum' name='[sum:{name}:qk]' pivot='key' type='quantitative' />")


def col_meas_min(name, dt="integer"):
    return (f"<column datatype='{dt}' name='[{name}]' role='measure' type='quantitative' />",
            f"<column-instance column='[{name}]' derivation='Min' name='[min:{name}:qk]' pivot='key' type='quantitative' />")


def col_calc(name, caption, formula, dt, role, typ, deriv):
    """Calculated field declared in datasource-dependencies (verified against a
    Tableau-authored workbook). deriv: 'None' (row-level dimension), 'User' (aggregate
    calc), 'Min'."""
    tok = {"None": "none", "User": "usr", "Min": "min"}[deriv]
    suffix = "nk" if typ == "nominal" else "qk"
    return (f"<column caption='{esc(caption)}' datatype='{dt}' name='[{name}]' role='{role}' type='{typ}'>"
            f"<calculation class='tableau' formula='{esc(formula)}' /></column>",
            f"<column-instance column='[{name}]' derivation='{deriv}' name='[{tok}:{name}:{suffix}]' pivot='key' type='{typ}' />")


def manual_sort(ds, dim, order):
    buckets = "".join(f"<bucket>&quot;{esc(v)}&quot;</bucket>" for v in order)
    return (f"<sort class='manual' column='[{ds}].[none:{dim}:nk]' direction='ASC'>"
            f"<dictionary>{buckets}</dictionary></sort>")


def computed_sort(ds, dim, using, direction="DESC"):
    return f"<sort class='computed' column='[{ds}].[none:{dim}:nk]' direction='{direction}' using='[{ds}].[{using}]' />"


def except_filter(ds, dim, values):
    members = "".join(f"<groupfilter function='member' level='[none:{dim}:nk]' member='&quot;{esc(v)}&quot;' />" for v in values)
    return (f"<filter class='categorical' column='[{ds}].[none:{dim}:nk]'>"
            "<groupfilter function='except' user:ui-domain='relevant' user:ui-enumeration='exclusive' user:ui-marker='enumerate'>"
            f"<groupfilter function='level-members' level='[none:{dim}:nk]' />{members}</groupfilter></filter>")


def member_filter(ds, dim, value, quoted=True):
    v = f"&quot;{esc(value)}&quot;" if quoted else value
    return (f"<filter class='categorical' column='[{ds}].[none:{dim}:nk]'>"
            f"<groupfilter function='member' level='[none:{dim}:nk]' member='{v}' /></filter>")


def std_filter(ds, field, group, members=None, context=False):
    """A quick-filter declaration meant to be shared across sheets via filter-group.
    members=None means every value selected (the '(All)' state). context=True makes it a
    context filter (form: <filter ... context='true'>, seen in several Tableau-authored
    public workbooks), which is what lets a FIXED LOD subtotal follow it."""
    if members is None:
        body = f"<groupfilter function='level-members' level='[none:{field}:nk]' user:ui-enumeration='all' user:ui-marker='enumerate' />"
    elif len(members) == 1:
        body = (f"<groupfilter function='member' level='[none:{field}:nk]' member='&quot;{esc(members[0])}&quot;' "
                "user:ui-domain='database' user:ui-enumeration='inclusive' user:ui-marker='enumerate' />")
    else:
        ms = "".join(f"<groupfilter function='member' level='[none:{field}:nk]' member='&quot;{esc(m)}&quot;' />" for m in members)
        body = f"<groupfilter function='union' user:ui-domain='database' user:ui-enumeration='inclusive' user:ui-marker='enumerate'>{ms}</groupfilter>"
    ctx = " context='true'" if context else ""
    return (f"<filter class='categorical' column='[{ds}].[none:{field}:nk]'{ctx} filter-group='{group}'>{body}</filter>", field)


def quick_filter_titles(ds, titles):
    """titles: {field: display title}. Quick-filter card titles (form verified against
    Tableau-authored workbooks).
    # adapted: the field->title mapping was a hardwired dict; now an argument."""
    fmts = "".join(f"<format attr='title' field='[{ds}].[none:{f}:nk]' value='{esc(t)}'>"
                   f"<formatted-text><run fontname='{FONT}' fontsize='9'>{esc(t)}</run></formatted-text></format>"
                   for f, t in titles.items())
    return f"          <style-rule element='quick-filter'>{fmts}</style-rule>\n"


def deps_xml(cols):
    seen, out = set(), []
    for c in cols:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return "\n          ".join(out)


def view_xml(ds, cap, cols, filters, sorts, extra=""):
    """<view> body in Tableau-authored order: datasources, dependencies, filter*, sort*,
    slices, aggregation. filters = list of (xml, dim). TRAP (element order /
    <aggregation value='true'/> last): <aggregation> must be the LAST child of <view> -
    it is emitted last here on purpose, keep it that way."""
    filt_xml = "\n          ".join(f for f, _ in filters)
    slices = ""
    if filters:
        slices = "<slices>" + "".join(f"<column>[{ds}].[none:{d}:nk]</column>" for _, d in filters) + "</slices>"
    return f"""<view>
          <datasources><datasource caption='{cap}' name='{ds}' /></datasources>
          <datasource-dependencies datasource='{ds}'>
          {deps_xml(cols)}
          </datasource-dependencies>
          {filt_xml}
          {sorts}
          {slices}
          {extra}
          <aggregation value='true' />
        </view>"""


def labels_on(extra=""):
    return ("<style><style-rule element='mark'><format attr='mark-labels-show' value='true' />"
            f"<format attr='mark-labels-cull' value='false' />{extra}</style-rule></style>")


def worksheet(name, view, panes, rows, cols):
    """TRAP (element order): inside <table> Tableau wants view, style, panes, rows, cols
    in that order, and exactly one <style> (see themeify(), which replaces the empty
    <style /> below in place rather than appending a second one)."""
    return f"""    <worksheet name='{esc(name)}'>
      <table>
        {view}
        <style />
        <panes>
          {panes}
        </panes>
        <rows>{rows}</rows>
        <cols>{cols}</cols>
      </table>
      <simple-id uuid='{gen_uuid(name)}' />
    </worksheet>"""


def axis_hide(ds, field, scope):
    return f"<format attr='display' class='0' field='[{ds}].[{field}]' scope='{scope}' value='false' />"


def bar_extra(ds, measure, palette=None, hide_axis=False, ticks=True, axis_title=None):
    s = "          <style-rule element='axis'>\n"
    if hide_axis:
        s += f"            {axis_hide(ds, f'sum:{measure}:qk', 'cols')}\n"
    if ticks:
        s += f"            <format attr='tick-color' value='{AXIS}' />\n"
    if axis_title is not None:
        s += f"            <format attr='title' class='0' field='[{ds}].[sum:{measure}:qk]' scope='cols' value='{esc(axis_title)}' />\n"
    s += "          </style-rule>\n"
    if palette:
        s += palette_rule(ds, *palette)
    return s


# ---- worksheet builders ---------------------------------------------------------------

def ban_ws(ds, cap, name, filters=None, order=None):
    """BAN / hero row: label on Cols (header hidden), big value + unit on Text, source
    under it. Datasource schema is fixed: label / unit / source / value.
    # adapted: the manual sort order for [label] was a hardwired list of statistic
    labels; now the optional `order` argument (omit for no explicit sort)."""
    val = f"[{ds}].[sum:value:qk]"
    cols = list(col_dim("label")) + list(col_dim("unit")) + list(col_dim("source")) + list(col_meas_sum("value", "real"))
    tip = tooltip([("Statistic", f"[{ds}].[none:label:nk]"), ("Value", val),
                   ("Source", f"[{ds}].[none:source:nk]")])
    label = (
        "<customized-label><formatted-text>"
        f"<run bold='true' fontcolor='{INK}' fontname='{FONT}' fontsize='{SZ_BAN}'><![CDATA[<{val}>]]></run>"
        f"<run bold='true' fontcolor='{INK}' fontname='{FONT}' fontsize='14'><![CDATA[<[{ds}].[none:unit:nk]>]]></run>"
        "<run>&#10;</run>"
        f"<run fontcolor='{INK2}' fontname='{FONT}' fontsize='12'><![CDATA[<[{ds}].[none:label:nk]>]]></run>"
        "<run>&#10;</run>"
        f"<run fontcolor='{MUTE}' fontname='{FONT}' fontsize='10'><![CDATA[<[{ds}].[none:source:nk]>]]></run>"
        "</formatted-text></customized-label>")
    sort_xml = manual_sort(ds, "label", order) if order else ""
    view = view_xml(ds, cap, cols, filters or [], sort_xml)
    pane = f"""<pane selection-relaxation-option='selection-relaxation-allow'>
            <view><breakdown value='auto' /></view>
            <mark class='Text' />
            <encodings>
              <text column='{val}' />
              <text column='[{ds}].[none:unit:nk]' />
              <text column='[{ds}].[none:label:nk]' />
              <text column='[{ds}].[none:source:nk]' />
            </encodings>
            {tip}
            {label}
            <style>
              <style-rule element='cell'><format attr='text-align-default' value='false' /><format attr='text-align' value='left' /><format attr='vertical-align' value='top' /><format attr='text-orientation' value='0' /></style-rule>
              <style-rule element='mark'><format attr='mark-labels-show' value='true' /><format attr='mark-labels-cull' value='false' /></style-rule>
            </style>
          </pane>"""
    return worksheet(name, view, pane, "", f"[{ds}].[none:label:nk]")


def ban_extra(ds):
    return (
        "          <style-rule element='header'>\n"
        f"            <format attr='display' class='0' field='[{ds}].[none:label:nk]' scope='cols' value='false' />\n"
        "          </style-rule>\n")


def ban_tile_ws(ds, cap, name, label):
    """One tile per sheet, filtered to a single labeled row (no header, single cell): a
    Text mark that does not fit its cell prints '####', so the value+unit text must stay
    short - put any longer caption in a dashboard text zone next to the tile instead of
    trying to fit it into this sheet."""
    val = f"[{ds}].[sum:value:qk]"
    txt = col_calc("Calculation_bantext", "Value (text)",
                   "STR(INT(SUM([value]))) + IIF(SUM([value]) - INT(SUM([value])) >= 0.05, '.' + STR(INT(ROUND((SUM([value]) - INT(SUM([value]))) * 10))), '')",
                   "string", "measure", "nominal", "User")
    cols = (list(col_dim("label")) + list(col_dim("unit")) + list(col_dim("source"))
            + list(col_meas_sum("value", "real")) + list(txt))
    tip = tooltip([("Statistic", f"[{ds}].[none:label:nk]"), ("Value", val),
                   ("Source", f"[{ds}].[none:source:nk]")])
    lab = (
        "<customized-label><formatted-text>"
        f"<run bold='true' fontcolor='{INK}' fontname='{FONT}' fontsize='{SZ_BAN}'><![CDATA[<[{ds}].[usr:Calculation_bantext:nk]>]]></run>"
        f"<run bold='true' fontcolor='{INK}' fontname='{FONT}' fontsize='14'><![CDATA[<[{ds}].[none:unit:nk]>]]></run>"
        "</formatted-text></customized-label>")
    filters = [(member_filter(ds, "label", label), "label")]
    view = view_xml(ds, cap, cols, filters, "")
    pane = f"""<pane selection-relaxation-option='selection-relaxation-allow'>
            <view><breakdown value='auto' /></view>
            <mark class='Text' />
            <encodings>
              <text column='[{ds}].[usr:Calculation_bantext:nk]' />
              <text column='[{ds}].[none:unit:nk]' />
              <text column='[{ds}].[none:label:nk]' />
              <text column='[{ds}].[none:source:nk]' />
            </encodings>
            {tip}
            {lab}
            <style>
              <style-rule element='cell'><format attr='text-align-default' value='false' /><format attr='text-align' value='left' /><format attr='vertical-align' value='top' /><format attr='text-orientation' value='0' /></style-rule>
              <style-rule element='mark'><format attr='mark-labels-show' value='true' /><format attr='mark-labels-cull' value='false' /></style-rule>
            </style>
          </pane>"""
    return worksheet(name, view, pane, "", "")


def ban_tile_extra(ds):
    return "          <style-rule element='cell'><format attr='wrap' value='on' /></style-rule>\n"


def bar_ws(ds, cap, name, dim, measure, color=None, lod=None, col_dim_name=None,
           sort=None, filt="", filt_dim=None, tip_rows=None, filters=None, labels=True,
           text_measure=None, col_order=None):
    """Horizontal bar chart (already fully generic in the source - kept verbatim). dim on
    Rows, sum:measure on Cols. Optional: color dim, lod (Detail) dim, a nesting Cols dim
    (col_dim_name, placed BEFORE the measure: small multiples). sort: None (computed DESC
    by the measure), or a manual order list for dim. filters: list of (filter xml, dim)
    in addition to the legacy filt/filt_dim pair. labels: mark labels on (text =
    text_measure or the measure)."""
    none_dim = f"[{ds}].[none:{dim}:nk]"
    sum_meas = f"[{ds}].[sum:{measure}:qk]"
    cols = list(col_dim(dim)) + list(col_meas_sum(measure))
    enc = []
    if color:
        cols += list(col_dim(color))
        enc.append(f"<color column='[{ds}].[none:{color}:nk]' />")
    if lod:
        cols += list(col_dim(lod))
        enc.append(f"<lod column='[{ds}].[none:{lod}:nk]' />")
    if col_dim_name:
        cols += list(col_dim(col_dim_name))
    if labels:
        tm = text_measure or sum_meas
        m = re.match(r"\[[^\]]+\]\.\[sum:([a-z_0-9]+):qk\]", tm)
        if m:
            cols += list(col_meas_sum(m.group(1)))
        enc.append(f"<text column='{tm}' />")
    for _, tok in (tip_rows or []):
        m = re.match(r"\[[^\]]+\]\.\[(sum|none|min):([a-z_0-9]+):[nq]k\]", tok)
        if m and m.group(1) == "sum":
            cols += list(col_meas_sum(m.group(2)))
        elif m and m.group(1) == "min":
            cols += list(col_meas_min(m.group(2)))
        elif m:
            cols += list(col_dim(m.group(2)))
    all_filters = list(filters or [])
    if filt:
        all_filters.append((filt, filt_dim))
    for _, fd in all_filters:
        cols += list(col_dim(fd))
    if sort is None:
        sort_xml = f"<sort class='computed' column='{none_dim}' direction='DESC' using='{sum_meas}' />"
    else:
        sort_xml = manual_sort(ds, dim, sort)
    if col_dim_name:
        sort_xml += manual_sort(ds, col_dim_name, col_order or [])
    enc_xml = ("<encodings>" + "".join(enc) + "</encodings>") if enc else ""
    tip = tooltip(tip_rows) if tip_rows else ""
    lab = labels_on() if labels else ""
    cols_shelf = (f"([{ds}].[none:{col_dim_name}:nk] / {sum_meas})" if col_dim_name else sum_meas)
    view = view_xml(ds, cap, cols, all_filters, sort_xml)
    pane = f"""<pane selection-relaxation-option='selection-relaxation-allow'>
            <view><breakdown value='auto' /></view>
            <mark class='Bar' />
            {enc_xml}
            {tip}
            {lab}
          </pane>"""
    return worksheet(name, view, pane, none_dim, cols_shelf)


def stacked_ws(ds, cap, name, dim, color_dim, measure, filters=None, tip_rows=None):
    """Stacked bar with the ROW TOTAL printed at the bar end: a dual axis (fold +
    synchronized) whose second pane is an invisible Circle mark at SUM(measure) carrying
    a left-aligned mark label (a point-mark label trick, not a native "total label"
    feature). Segment labels stay on in pane 1.
    TRAP: the segment-count calc below only prints where a group has more than one color
    segment, so a single-segment bar does not print its count twice next to the bar-end
    total (that duplicate showed up in testing without this guard).
    # adapted: dim/color_dim/measure were hardwired to one project's field names; now
    arguments."""
    total = col_calc("Calculation_total", f"{measure} (total)", f"SUM([{measure}])",
                     "integer", "measure", "quantitative", "User")
    seg = col_calc("Calculation_seglbl", f"{measure} (segment)",
                   f"IF MIN({{FIXED [{dim}] : COUNTD([{color_dim}])}}) > 1 THEN SUM([{measure}]) END",
                   "integer", "measure", "quantitative", "User")
    cols = (list(col_dim(dim)) + list(col_dim(color_dim)) + list(col_meas_sum(measure))
            + list(total) + list(seg))
    filters = list(filters or [])
    for _, fd in filters:
        cols += list(col_dim(fd))
    sorts = computed_sort(ds, dim, f"sum:{measure}:qk", "DESC")
    tip = tooltip(tip_rows) if tip_rows else tooltip([
        (dim, f"[{ds}].[none:{dim}:nk]"), (color_dim, f"[{ds}].[none:{color_dim}:nk]"),
        (measure, f"[{ds}].[sum:{measure}:qk]")])
    view = view_xml(ds, cap, cols, filters, sorts)
    label = ("<customized-label><formatted-text>"
             f"<run bold='true' fontcolor='{INK}' fontname='{FONT}' fontsize='{SZ_LABEL}'><![CDATA[<[{ds}].[usr:Calculation_total:qk]>]]></run>"
             "</formatted-text></customized-label>")
    panes = f"""<pane selection-relaxation-option='selection-relaxation-allow'>
            <view><breakdown value='auto' /></view>
            <mark class='Bar' />
          </pane>
          <pane id='1' selection-relaxation-option='selection-relaxation-allow' x-axis-name='[{ds}].[sum:{measure}:qk]'>
            <view><breakdown value='auto' /></view>
            <mark class='Bar' />
            <encodings>
              <color column='[{ds}].[none:{color_dim}:nk]' />
              <text column='[{ds}].[usr:Calculation_seglbl:qk]' />
            </encodings>
            {tip}
            {labels_on()}
          </pane>
          <pane id='2' selection-relaxation-option='selection-relaxation-allow' x-axis-name='[{ds}].[usr:Calculation_total:qk]'>
            <view><breakdown value='auto' /></view>
            <mark class='Circle' />
            <encodings>
              <text column='[{ds}].[usr:Calculation_total:qk]' />
            </encodings>
            <customized-tooltip show-buttons='false'><formatted-text /></customized-tooltip>
            {label}
            <style>
              <style-rule element='cell'><format attr='text-align-default' value='false' /><format attr='vertical-align' value='center' /><format attr='text-orientation' value='0' /><format attr='text-align' value='left' /></style-rule>
              <style-rule element='mark'><format attr='size' value='0.25' /><format attr='mark-labels-show' value='true' /><format attr='mark-labels-cull' value='false' /><format attr='mark-color' value='{PANE}' /><format attr='has-stroke' value='false' /></style-rule>
            </style>
          </pane>"""
    rows = f"[{ds}].[none:{dim}:nk]"
    cols_shelf = f"([{ds}].[sum:{measure}:qk] + [{ds}].[usr:Calculation_total:qk])"
    return worksheet(name, view, panes, rows, cols_shelf)


def stacked_extra(ds, dim, color_dim, color_map, measure, axis_max, header_width=200,
                  axis_title=None, titles=None):
    """axis_max: fixed axis ceiling - the source hand-tuned this to its widest stacked
    total plus headroom for the bar-end total label; recompute it for your own data's max.
    titles: optional {field: display title} passed to quick_filter_titles()."""
    return (
        "          <style-rule element='axis'>\n"
        f"            <encoding attr='space' class='0' field='[{ds}].[sum:{measure}:qk]' field-type='quantitative' major-origin='0.0' major-show='true' major-spacing='20.0' max='{axis_max}' min='0.0' minor-show='false' range-type='fixed' scope='cols' type='space' />\n"
        f"            <encoding attr='space' class='0' field='[{ds}].[usr:Calculation_total:qk]' field-type='quantitative' fold='true' scope='cols' synchronized='true' type='space' />\n"
        f"            <format attr='display' class='0' field='[{ds}].[usr:Calculation_total:qk]' scope='cols' value='false' />\n"
        f"            <format attr='display' class='0' field='[{ds}].[sum:{measure}:qk]' scope='cols' value='false' />\n"
        f"            <format attr='tick-color' value='{AXIS}' />\n"
        + (f"            <format attr='title' class='0' field='[{ds}].[sum:{measure}:qk]' scope='cols' value='{esc(axis_title)}' />\n" if axis_title else "")
        + "          </style-rule>\n"
        + palette_rule(ds, f"[none:{color_dim}:nk]", color_map)
        + (quick_filter_titles(ds, titles) if titles else "")
        + f"          <style-rule element='header'><format attr='width' field='[{ds}].[none:{dim}:nk]' value='{header_width}' /></style-rule>\n")


# NOTE (from an earlier build): a <style-rule element='label'> with a display/value='false'
# format hides the whole ROW/COLUMN HEADER for that field ("Show Header"), not the field
# label above it. The field label is hidden separately via the worksheet-element format
# display-field-labels scope='rows'|'cols' value='false' (see base_style_rules() above and
# small_multiples_pct_extra() below).

def dumbbell_ws(ds, cap, name, group_dim, series_dim, series_a, series_b, pct_measure,
               n_measure, group_n_measure, pct_label_measure, sort_field, axis_max=90.0):
    """Dot plot / dumbbell (the "circle/scatter marks" pattern): group_dim on Rows;
    pct_measure on Cols twice as a dual axis (synchronized): a Line mark with series_dim
    on Path on the primary pane, Circle marks colored by series_dim on the secondary pane
    (drawn on top). Label = one FIXED-LOD calc comparing series_a vs series_b, printed
    once per group on the larger dot only (blank on the smaller one via ISNULL on
    pct_label_measure), left-aligned so it sits to the right of that dot.
    # adapted: group_dim/series_dim/measures and the two compared series values were
    hardwired to one project's two-cohort comparison; all are now arguments."""
    dot = col_calc("Calculation_pct_dot", f"{pct_measure} (dots)", f"SUM([{pct_measure}])",
                   "integer", "measure", "quantitative", "User")
    lbl = col_calc("Calculation_gaplbl", f"{series_a} vs {series_b}",
                   f"IIF(ISNULL([{pct_label_measure}]), NULL, "
                   f"STR({{FIXED [{group_dim}] : MAX(IIF([{series_dim}] = '{series_a}', [{pct_measure}], NULL))}}) + "
                   "'% vs ' + "
                   f"STR({{FIXED [{group_dim}] : MAX(IIF([{series_dim}] = '{series_b}', [{pct_measure}], NULL))}}) + '%')",
                   "string", "dimension", "nominal", "None")
    cols = (list(col_dim(group_dim)) + list(col_dim(series_dim)) + list(col_meas_sum(pct_measure))
            + list(col_meas_sum(n_measure)) + list(col_meas_sum(group_n_measure)) + list(col_meas_sum(pct_label_measure))
            + list(col_meas_min(sort_field)) + list(dot) + list(lbl))
    sorts = computed_sort(ds, group_dim, f"min:{sort_field}:qk", "ASC")
    tip = tooltip([(group_dim, f"[{ds}].[none:{group_dim}:nk]"),
                   (series_dim, f"[{ds}].[none:{series_dim}:nk]"),
                   (pct_measure, f"[{ds}].[sum:{pct_measure}:qk]"),
                   (n_measure, f"[{ds}].[sum:{n_measure}:qk]"),
                   (group_n_measure, f"[{ds}].[sum:{group_n_measure}:qk]")])
    view = view_xml(ds, cap, cols, [], sorts)
    panes = f"""<pane selection-relaxation-option='selection-relaxation-allow'>
            <view><breakdown value='auto' /></view>
            <mark class='Circle' />
          </pane>
          <pane id='1' selection-relaxation-option='selection-relaxation-allow' x-axis-name='[{ds}].[sum:{pct_measure}:qk]'>
            <view><breakdown value='auto' /></view>
            <mark class='Line' />
            <encodings>
              <path column='[{ds}].[none:{series_dim}:nk]' />
            </encodings>
            {tip}
            <style>
              <style-rule element='mark'><format attr='mark-color' value='{AXIS}' /><format attr='size' value='2' /><format attr='mark-labels-show' value='false' /></style-rule>
            </style>
          </pane>
          <pane id='2' selection-relaxation-option='selection-relaxation-allow' x-axis-name='[{ds}].[usr:Calculation_pct_dot:qk]'>
            <view><breakdown value='auto' /></view>
            <mark class='Circle' />
            <encodings>
              <color column='[{ds}].[none:{series_dim}:nk]' />
              <text column='[{ds}].[none:Calculation_gaplbl:nk]' />
            </encodings>
            {tip}
            <style>
              <style-rule element='cell'><format attr='text-align-default' value='false' /><format attr='vertical-align' value='center' /><format attr='text-orientation' value='0' /><format attr='text-align' value='right' /></style-rule>
              <style-rule element='mark'><format attr='mark-labels-show' value='true' /><format attr='mark-labels-cull' value='false' /><format attr='size' value='3' /><format attr='has-stroke' value='false' /></style-rule>
            </style>
          </pane>"""
    rows = f"[{ds}].[none:{group_dim}:nk]"
    cols_shelf = f"([{ds}].[sum:{pct_measure}:qk] + [{ds}].[usr:Calculation_pct_dot:qk])"
    return worksheet(name, view, panes, rows, cols_shelf)


def dumbbell_extra(ds, pct_measure, series_dim, color_map, pct_label_measure, group_dim,
                   axis_max=90.0, header_width=175, axis_title="share (%)"):
    return (
        "          <style-rule element='axis'>\n"
        f"            <encoding attr='space' class='0' field='[{ds}].[sum:{pct_measure}:qk]' field-type='quantitative' major-origin='0.0' major-show='true' major-spacing='30.0' max='{axis_max}' min='0.0' minor-show='false' range-type='fixed' scope='cols' type='space' />\n"
        f"            <encoding attr='space' class='0' field='[{ds}].[usr:Calculation_pct_dot:qk]' field-type='quantitative' fold='true' scope='cols' synchronized='true' type='space' />\n"
        f"            <format attr='display' class='0' field='[{ds}].[usr:Calculation_pct_dot:qk]' scope='cols' value='false' />\n"
        f"            <format attr='tick-color' value='{AXIS}' />\n"
        f"            <format attr='title' class='0' field='[{ds}].[sum:{pct_measure}:qk]' scope='cols' value='{esc(axis_title)}' />\n"
        "          </style-rule>\n"
        + palette_rule(ds, f"[none:{series_dim}:nk]", color_map)
        + f"          <style-rule element='label'><format attr='text-format' field='[{ds}].[sum:{pct_label_measure}:qk]' value='c0&quot;%&quot;' /></style-rule>\n"
        f"          <style-rule element='header'><format attr='width' field='[{ds}].[none:{group_dim}:nk]' value='{header_width}' /></style-rule>\n")


def stacked_label_split_ws(ds, cap, name, category_dim, measure, dark_values, filters=None,
                           extra_filter=None):
    """Single stacked bar whose mark labels are split across two identical dual-axis
    panes so pane 1 can print its labels in ink and pane 2 (the members named in
    dark_values) in white - Tableau has no per-segment label color, so the bar is drawn
    TWICE (dual axis, synchronized, second axis hidden) and each pane's
    <style-rule element='datalabel'> owns one label color. This is the closest analog in
    the source to a "100% stacked bar" (it is NOT built with a Tableau table
    calculation - no true table-calc-based 100% stack exists in the two source files).
    filters: list of (filter xml, dim) already built (e.g. std_filter()). extra_filter:
    an optional (filter xml, dim) tuple applied first (e.g. a boolean pre-filter that
    keeps only one cohort).
    # adapted: category_dim/measure/dark_values and the extra boolean pre-filter were
    hardwired to one project's field names and literal category values; all now
    arguments."""
    dark_list = "(" + ", ".join(f"'{v}'" for v in dark_values) + ")"
    light_lbl = col_calc("Calculation_intlight", f"{measure} (light segments)",
                         f"IF MIN([{category_dim}]) IN {dark_list} THEN NULL ELSE SUM([{measure}]) END",
                         "integer", "measure", "quantitative", "User")
    dark_lbl = col_calc("Calculation_intdark", f"{measure} (dark segments)",
                        f"IF MIN([{category_dim}]) IN {dark_list} THEN SUM([{measure}]) END",
                        "integer", "measure", "quantitative", "User")
    twin = col_calc("Calculation_intent2", f"{measure} (label layer)", f"SUM([{measure}])",
                    "integer", "measure", "quantitative", "User")
    cols = list(col_dim(category_dim)) + list(col_meas_sum(measure)) + list(light_lbl) + list(dark_lbl) + list(twin)
    filters = list(filters or [])
    if extra_filter:
        filters = [extra_filter] + filters
    for _, fd in filters:
        cols += list(col_dim(fd))
    tip = tooltip([(category_dim, f"[{ds}].[none:{category_dim}:nk]"),
                   (measure, f"[{ds}].[sum:{measure}:qk]")])
    view = view_xml(ds, cap, cols, filters, "")
    panes = f"""<pane selection-relaxation-option='selection-relaxation-allow'>
            <view><breakdown value='auto' /></view>
            <mark class='Bar' />
          </pane>
          <pane id='1' selection-relaxation-option='selection-relaxation-allow' x-axis-name='[{ds}].[sum:{measure}:qk]'>
            <view><breakdown value='auto' /></view>
            <mark class='Bar' />
            <encodings>
              <color column='[{ds}].[none:{category_dim}:nk]' />
              <text column='[{ds}].[usr:Calculation_intlight:qk]' />
            </encodings>
            {tip}
            <style>
              <style-rule element='datalabel'><format attr='color-mode' value='user' /><format attr='color' value='{INK}' /></style-rule>
              <style-rule element='mark'><format attr='mark-labels-show' value='true' /><format attr='mark-labels-cull' value='false' /></style-rule>
            </style>
          </pane>
          <pane id='2' selection-relaxation-option='selection-relaxation-allow' x-axis-name='[{ds}].[usr:Calculation_intent2:qk]'>
            <view><breakdown value='auto' /></view>
            <mark class='Bar' />
            <encodings>
              <color column='[{ds}].[none:{category_dim}:nk]' />
              <text column='[{ds}].[usr:Calculation_intdark:qk]' />
            </encodings>
            {tip}
            <style>
              <style-rule element='datalabel'><format attr='color-mode' value='user' /><format attr='color' value='#ffffff' /></style-rule>
              <style-rule element='mark'><format attr='mark-labels-show' value='true' /><format attr='mark-labels-cull' value='false' /></style-rule>
            </style>
          </pane>"""
    cols_shelf = f"([{ds}].[sum:{measure}:qk] + [{ds}].[usr:Calculation_intent2:qk])"
    return worksheet(name, view, panes, "", cols_shelf)


def stacked_label_split_extra(ds, category_dim, color_map, measure, sort_order=None):
    """sort_order: category values in the desired LEFT-TO-RIGHT display order. TRAP:
    Tableau draws the FIRST member of a manual color sort OUTERMOST (the far end of the
    bar), so this reverses sort_order before handing it to manual_sort() - verified on a
    real build; without the reversal the first category in sort_order ends up at the
    wrong end of the bar."""
    sort_xml = manual_sort(ds, category_dim, list(reversed(sort_order))) if sort_order else ""
    # the axis is hidden, so the single bar fills the zone: a stacked-to-100%-looking bar
    # without an actual Tableau table calc (the source data is already summed/normalized)
    return (
        sort_xml,
        "          <style-rule element='axis'>\n"
        f"            <encoding attr='space' class='0' field='[{ds}].[usr:Calculation_intent2:qk]' field-type='quantitative' fold='true' scope='cols' synchronized='true' type='space' />\n"
        f"            <format attr='display' class='0' field='[{ds}].[sum:{measure}:qk]' scope='cols' value='false' />\n"
        f"            <format attr='display' class='0' field='[{ds}].[usr:Calculation_intent2:qk]' scope='cols' value='false' />\n"
        "          </style-rule>\n"
        + palette_rule(ds, f"[none:{category_dim}:nk]", color_map)
        + f"          <style-rule element='datalabel'><format attr='color-mode' value='automatic' /><format attr='font-family' value='{FONT}' /><format attr='font-size' value='{SZ_LABEL}' /></style-rule>\n")


def small_multiples_pct_ws(ds, cap, name, row_dim, col_dim_name, pct_measure, n_measure,
                           group_n_measure, is_top_field, row_order, col_head_order,
                           top_label="Top group", other_label="Other"):
    """Percent-of-group small multiples: col_dim_name (with its group size folded into
    the header caption via a calc, e.g. "0-2 yrs   n=37") across Cols, row_dim down Rows
    in a fixed order, one color highlighting each column's top row (is_top_field, a
    pre-computed boolean) against a shared fixed axis. This is the closest analog in the
    source to a "100% stacked bar via table calc": the percentage in pct_measure is
    pre-aggregated by the caller's data pipeline, NOT computed by a Tableau table
    calculation - no true table-calc-based emitter exists in the two source files.
    col_head_order must already be the same strings the header calc will produce, e.g.
    [f"{v}   n={counts[v]}" for v in col_order].
    # adapted: row_dim/col_dim_name/measures/is_top_field and the two label captions
    were hardwired; all now arguments."""
    bandhead = col_calc("Calculation_bandhead", f"{col_dim_name} (n)",
                        f"[{col_dim_name}] + '   n=' + STR([{group_n_measure}])",
                        "string", "dimension", "nominal", "None")
    topcalc = col_calc("Calculation_top", "Top group",
                       f"IF [{is_top_field}] THEN '{top_label}' ELSE '{other_label}' END",
                       "string", "dimension", "nominal", "None")
    cols = (list(col_dim(row_dim)) + list(col_dim(col_dim_name)) + list(col_meas_sum(pct_measure))
            + list(col_meas_sum(n_measure)) + list(col_meas_sum(group_n_measure)) + list(topcalc) + list(bandhead)
            + [f"<column datatype='boolean' name='[{is_top_field}]' role='dimension' type='nominal' />"])
    sorts = manual_sort(ds, row_dim, row_order) + manual_sort(ds, "Calculation_bandhead", col_head_order)
    tip = tooltip([(col_dim_name, f"[{ds}].[none:{col_dim_name}:nk]"),
                   (row_dim, f"[{ds}].[none:{row_dim}:nk]"),
                   (pct_measure, f"[{ds}].[sum:{pct_measure}:qk]"),
                   (n_measure, f"[{ds}].[sum:{n_measure}:qk]"),
                   (group_n_measure, f"[{ds}].[sum:{group_n_measure}:qk]")])
    view = view_xml(ds, cap, cols, [], sorts)
    pane = f"""<pane selection-relaxation-option='selection-relaxation-allow'>
            <view><breakdown value='auto' /></view>
            <mark class='Bar' />
            <encodings>
              <color column='[{ds}].[none:Calculation_top:nk]' />
              <lod column='[{ds}].[none:{col_dim_name}:nk]' />
              <text column='[{ds}].[sum:{pct_measure}:qk]' />
            </encodings>
            {tip}
            {labels_on()}
          </pane>"""
    rows = f"[{ds}].[none:{row_dim}:nk]"
    cols_shelf = f"([{ds}].[none:Calculation_bandhead:nk] / [{ds}].[sum:{pct_measure}:qk])"
    return worksheet(name, view, pane, rows, cols_shelf)


def small_multiples_pct_extra(ds, row_dim, pct_measure, color_map, axis_max=60.0,
                              axis_spacing=25.0, header_width=170, axis_title="share (%)"):
    return (
        "          <style-rule element='worksheet'><format attr='display-field-labels' scope='cols' value='false' /></style-rule>\n"
        "          <style-rule element='axis'>\n"
        f"            <encoding attr='space' class='0' field='[{ds}].[sum:{pct_measure}:qk]' field-type='quantitative' major-origin='0.0' major-show='true' major-spacing='{axis_spacing}' max='{axis_max}' min='0.0' minor-show='false' range-type='fixed' scope='cols' type='space' />\n"
        f"            <format attr='display' class='0' field='[{ds}].[sum:{pct_measure}:qk]' scope='cols' value='false' />\n"
        f"            <format attr='tick-color' value='{AXIS}' />\n"
        f"            <format attr='title' class='0' field='[{ds}].[sum:{pct_measure}:qk]' scope='cols' value='{esc(axis_title)}' />\n"
        "          </style-rule>\n"
        + palette_rule(ds, "[none:Calculation_top:nk]", color_map)
        + f"          <style-rule element='label'><format attr='text-format' field='[{ds}].[sum:{pct_measure}:qk]' value='c0&quot;%&quot;' /></style-rule>\n"
        f"          <style-rule element='header'><format attr='width' field='[{ds}].[none:{row_dim}:nk]' value='{header_width}' /></style-rule>\n")


def text_table_ws(ds, cap, name, text_field, row_fields, filters=None, tip_rows=None):
    """Text table: row_fields is a list of (field_name, kind) with kind 'nk' for a
    nominal string dimension (col_dim()) or 'ok' for an integer/ordinal header
    (col_dim_int()), nested on Rows in the given order; the full text_field on Text with
    wrap on. Two rows with identical row_fields values never merge into one as long as at
    least one row_field is unique per record (the source used a hidden id column for
    this - include one of your own if the same trap applies to your data).
    filters: list of (filter xml, dim) already built, e.g. std_filter().
    # adapted: the row_fields list, its widths and the text field were a hardwired
    8-column schema; now arguments (widths moved to text_table_extra())."""
    cols = list(col_dim(text_field))
    row_tokens = []
    for fname, kind in row_fields:
        if kind == "ok":
            cols += list(col_dim_int(fname))
            row_tokens.append(f"[{ds}].[none:{fname}:ok]")
        else:
            cols += list(col_dim(fname))
            row_tokens.append(f"[{ds}].[none:{fname}:nk]")
    filters = list(filters or [])
    for _, fd in filters:
        cols += list(col_dim(fd))
    tip = tooltip(tip_rows) if tip_rows else tooltip([(text_field, f"[{ds}].[none:{text_field}:nk]")])
    view = view_xml(ds, cap, cols, filters, "")
    pane = f"""<pane selection-relaxation-option='selection-relaxation-allow'>
            <view><breakdown value='auto' /></view>
            <mark class='Text' />
            <encodings>
              <text column='[{ds}].[none:{text_field}:nk]' />
            </encodings>
            {tip}
            <style>
              <style-rule element='cell'><format attr='text-align-default' value='false' /><format attr='text-align' value='left' /><format attr='vertical-align' value='top' /><format attr='text-orientation' value='0' /><format attr='wrap' value='on' /></style-rule>
              <style-rule element='mark'><format attr='mark-labels-show' value='true' /><format attr='mark-labels-cull' value='false' /></style-rule>
            </style>
          </pane>"""
    rows = "(" + " / ".join(row_tokens) + ")"
    return worksheet(name, view, pane, rows, "")


def text_table_extra(ds, row_widths, cell_width, row_height, titles=None):
    """row_widths: {(field_name, kind): width_px}, kind matching the tuples passed to
    text_table_ws's row_fields. cell_width: the wrapped text column's width - keep the
    row-header widths' sum plus cell_width under your fixed sheet/dashboard width minus a
    scrollbar allowance, or the sheet scrolls sideways (the source budgeted this
    explicitly to avoid exactly that)."""
    w = "".join(f"<format attr='width' field='[{ds}].[none:{f}:{k}]' value='{v}' />"
                for (f, k), v in row_widths.items())
    return (
        "          <style-rule element='header'>\n"
        f"            {w}\n"
        "          </style-rule>\n"
        f"          <style-rule element='cell'><format attr='width' value='{cell_width}' /><format attr='height' value='{row_height}' /><format attr='wrap' value='on' /></style-rule>\n"
        "          <style-rule element='worksheet'><format attr='display-field-labels' scope='rows' value='false' /></style-rule>\n"
        + (quick_filter_titles(ds, titles) if titles else ""))


# ---- legacy dashboard layout tree (ZoneBuilder / ZB) -----------------------------------

class ZB:
    """A simpler, weight-based dashboard zone-tree builder kept for reference (the
    fixed-pixel Layout class below superseded it for anything that needs empirically
    exact heights, but ZB's proportional-weight <layout-flow> splitting is still the
    quickest way to lay out a dashboard that does not need pixel-perfect zones)."""
    def __init__(self): self.id = 0; self.lines = []
    def nid(self): self.id += 1; return self.id
    def emit(self, node, x, y, w, h):
        kind = node[0]
        if kind == "sheet":
            self.lines.append(f"<zone h='{h}' id='{self.nid()}' name='{esc(node[1])}' w='{w}' x='{x}' y='{y}' />"); return
        if kind == "legend":
            _, sheet, param = node
            self.lines.append(f"<zone h='{h}' id='{self.nid()}' name='{esc(sheet)}' pane-specification-id='1' param='{param}' type='color' w='{w}' x='{x}' y='{y}' />"); return
        if kind == "text":
            _, text, size, color, font = node
            self.lines.append(f"<zone h='{h}' id='{self.nid()}' type='text' w='{w}' x='{x}' y='{y}'>"
                f"<formatted-text><run fontname='{font}' fontcolor='{color}' fontsize='{size}'>{esc(text)}</run></formatted-text></zone>"); return
        norm = [(c, 1.0) if isinstance(c[0], str) else (c[0], c[1]) for c in node[1]]
        total = sum(w for _, w in norm)
        zid = self.nid(); param = "vert" if kind == "vert" else "horz"
        self.lines.append(f"<zone h='{h}' id='{zid}' param='{param}' type='layout-flow' w='{w}' x='{x}' y='{y}'>")
        span = h if kind == "vert" else w; used = 0
        for i, (ch, wt) in enumerate(norm):
            seg = (span - used) if i == len(norm) - 1 else int(span * wt / total)
            if kind == "vert": self.emit(ch, x, y + used, w, seg)
            else: self.emit(ch, x + used, y, seg, h)
            used += seg
        self.lines.append("</zone>")


# ---- actions ----------------------------------------------------------------------------

def tsl(s):
    return urllib.parse.quote(s, safe="")


def filter_action(n, caption, src_dash, src_sheet, target_ds, mapping, target_dash, target_sheet,
                  target_dash_sheets, on_empty="all"):
    """Dashboard filter action: selecting marks on src_sheet filters target_sheet by
    mapping = [(target_field, source_field)] (both internal field names, no datasource
    prefix). Built on a verified real-world tsl: link expression whose target tokens are
    url-escaped, plus tsc:tsl-filter with the OTHER sheets on the target dashboard
    excluded (target_dash_sheets, minus target_sheet and src_sheet) so the action does not
    also try to filter them. on-empty: what the target shows once the selection clears -
    'all' ("Show all values") is the verified choice; 'none' left the target view EMPTY
    after a second click on the source mark in testing.
    # adapted: target_dash_sheets was a global per-dashboard sheet-list lookup; now an
    argument."""
    pairs = "&".join(f"{tsl(f'[{target_ds}].[{tf}]')}~s0=<[{sf}]~na>" for tf, sf in mapping)
    expr = f"tsl:{tsl(target_dash)}?{pairs}"
    exclude = ",".join(s for s in target_dash_sheets if s not in (target_sheet, src_sheet))
    return f"""    <action caption='{esc(caption)}' name='[Action{n}]'>
      <activation auto-clear='true' type='on-select' />
      <source dashboard='{esc(src_dash)}' type='sheet' worksheet='{esc(src_sheet)}' />
      <link caption='{esc(caption)}' delimiter=',' escape='\\' expression='{esc(expr)}' include-null='true' multi-select='true' url-escape='true' />
      <command command='tsc:tsl-filter'>
        <param name='exclude' value='{esc(exclude)}' />
        <param name='on-empty' value='{on_empty}' />
        <param name='target' value='{esc(target_dash)}' />
      </command>
    </action>"""


def brush_action(n, caption, src_dash, src_sheet, dash_sheets):
    """An on-hover highlight (tsc:brush) from src_sheet, every other sheet on src_dash
    excluded so nothing else on the dashboard dims along with it.
    # adapted: dash_sheets was a global per-dashboard sheet-list lookup; now an
    argument."""
    excl = esc(",".join(sh for sh in dash_sheets if sh != src_sheet))
    return f"""    <action caption='{esc(caption)}' name='[Action{n}]'>
      <activation auto-clear='true' type='on-hover' />
      <source dashboard='{esc(src_dash)}' type='sheet' worksheet='{esc(src_sheet)}' />
      <command command='tsc:brush'>
        <param name='exclude' value='{excl}' />
        <param name='special-fields' value='all' />
        <param name='target' value='{esc(src_dash)}' />
      </command>
    </action>"""


def wrap_actions(action_xmls):
    return "  <actions>\n" + "\n".join(action_xmls) + "\n  </actions>"


# ---- windows -----------------------------------------------------------------------------

def worksheet_window(name):
    return f"""    <window class='worksheet' maximized='false' name='{esc(name)}'>
      <cards>
        <edge name='left'><strip size='160'><card type='pages' /><card type='filters' /><card type='marks' /></strip></edge>
        <edge name='top'><strip size='2147483647'><card type='columns' /></strip><strip size='2147483647'><card type='rows' /></strip><strip size='31'><card type='title' /></strip></edge>
      </cards>
      <simple-id uuid='{gen_uuid(name + '-win')}' />
    </window>"""


def windows_xml(sheet_names, pages, sheets_per_page, scrolling_sheets=(), maximized_page=None):
    """One window per worksheet plus one per dashboard page. sheet_names: every worksheet
    name. pages: dashboard page names, in order. sheets_per_page: {page: [sheet names]}.
    scrolling_sheets: sheet names that must NOT get an entire-view zoom (a long text
    table needs to scroll - an entire-view zoom on it squashes hundreds of rows into the
    zone). maximized_page: the one dashboard window opened maximized - only one may be,
    or a GUI "Save As" keeps whichever page happened to be showing last, not the one you
    picked here.
    # adapted: sheet_names/pages/sheets_per_page/scrolling_sheets/maximized_page were
    global lookups (SHEETS/PAGES/ON_PAGE/T_QUOTE/PAGE_OVERVIEW); all now arguments."""
    wins = [worksheet_window(s) for s in sheet_names]
    for page in pages:
        zoom = "<zoom type='entire-view' />"
        vps = "\n        ".join(
            f"<viewpoint name='{esc(s)}'>{'' if s in scrolling_sheets else zoom}</viewpoint>"
            for s in sheets_per_page[page])
        wins.append(f"""    <window class='dashboard' maximized='{'true' if page == maximized_page else 'false'}' name='{esc(page)}'>
      <viewpoints>
        {vps}
      </viewpoints>
      <active id='-1' />
      <simple-id uuid='{gen_uuid(page + '-win')}' />
    </window>""")
    return "  <windows source-height='30'>\n" + "\n".join(wins) + "\n  </windows>"


def workbook_style(font=None):
    return f"  <style>\n    <style-rule element='all'><format attr='font-family' value='{font or FONT}' /></style-rule>\n  </style>\n"


def ensure_button_manifest(workbook_xml):
    """Nav buttons (<button> inside a dashboard-object zone) only pass Tableau's schema
    check when the document-format-change-manifest declares the button feature; without
    these two lines the load fails with "no declaration found for element 'button'"
    (found the hard way on a real build). Idempotent: a no-op if already present."""
    if "<BasicButtonObject />" not in workbook_xml:
        workbook_xml = workbook_xml.replace(
            "    <AnimationOnByDefault />\n",
            "    <AnimationOnByDefault />\n    <BasicButtonObject />\n    <BasicButtonObjectTextSupport />\n", 1)
    assert "<BasicButtonObjectTextSupport />" in workbook_xml
    return workbook_xml


def check_xml(label, xml):
    """Well-formedness gate for an XML fragment (wrapped so the user: namespace
    resolves). Exits the process with a clear label on failure - call this after building
    every worksheet/dashboard/action fragment, before splicing it into the workbook."""
    wrapped = f"<root xmlns:user='http://www.tableausoftware.com/xml/user'>{xml}</root>"
    try:
        ET.fromstring(wrapped)
    except ET.ParseError as e:
        sys.exit(f"XML not well-formed in {label}: {e}")


# =========================================================================================
# Dashboard zone-tree machinery (from story_layout.py)
# =========================================================================================

# Fixed dashboard canvas. Override before building if you need a different size/padding
# (same reassign-the-module-constant pattern noted in the module docstring).
DASH_W, DASH_H = 1200, 900
PAD = 24            # outer padding
GAP = 12            # between blocks
INNER = DASH_W - 2 * PAD

# TEXT METRICS (empirically calibrated by measuring rendered dashboards in presentation
# mode, full-resolution screenshots, on a 150% Windows display-scaling machine): Tableau
# lays a fixed dashboard out in DEVICE pixels (1200 x 900 physical at 150% scaling) but
# renders type at the system DPI, so on that machine a point is 2 px of glyph and a line
# is about 2.4 px per pt; a regular character is about 0.87 px per pt wide, bold 1.1, bold
# capitals 1.3. On a 100%-scaled machine or the web the same type is 1.5x smaller relative
# to the layout. These constants are calibrated for the higher-DPI case; re-measure them
# (screenshot a zone at a known width/point-size and count pixels) if your rendering
# environment differs - do not assume they transfer to a different DPI unchanged.
PX_PT = 2.4         # line height per pt (single line)
PX_PT_WRAP = 3.0    # per line once the zone wraps (a 3-line 8pt zone needed 80px at this rate)
CH_REG, CH_BOLD, CH_CAPS = 0.93, 1.1, 1.3   # px per character per pt
H_NAV = 36          # nav-button zone height


def esc_layout(s):
    """Alias of esc_run(), kept under this name too since story_layout.py's own top-level
    esc() is what Layout.run() below actually calls."""
    return esc_run(s)


class Run(str):
    """A <run> with its measured width (px, for the calibrated machine above) and size,
    used for line-wrap fitting."""
    w = 0.0
    pt = 0
    nl = False


class Layout:
    """Builds a fixed-size Tableau dashboard's <zone> tree from a small layout DSL (see
    the sheet/text/filter/nav/horz/vert/empty node builders below), converting px
    coordinates to the myriad (0..100000)-of-canvas-size units Tableau serializes.

    # adapted from story_layout.py: the source's Layout also owned four hardcoded
    page-content methods (header, filter_row, page_overview, page_why, page_where,
    page_words) that assembled ONE workbook's literal titles, subtitles, quick-filter
    fields and column widths - those are page CONTENT built on top of this machinery,
    not the machinery itself, and are not included here (see the module docstring).
    dashboard_xml(), pages() and budget() were adapted accordingly: they now take the
    fully-assembled content node list / fixed-height totals as arguments instead of
    calling those removed methods internally.
    """

    def __init__(self, H, ids, sheets, colors, gen_uuid):
        """H: a headline/data dict the caller's own content-building code may consult
        (opaque to this class - kept only because pages()/dashboard_xml() pass it
        through unchanged in the original). ids: datasource ids by key. sheets: dict of
        sheet names by role, opaque to this class. colors: dict with at least INK, INK2,
        MUTE, PULL (used by nav_zone's default palette) and BG (used by dashboard_xml).
        gen_uuid: an id function, e.g. this module's gen_uuid()."""
        self.H, self.ids, self.S, self.C, self.gen_uuid = H, ids, sheets, colors, gen_uuid
        self._id = 0
        self.aligns = []
        self.measured = []      # (lines, width, text head) for a build report
        self.sheet_h = {}

    # ---- run / node helpers -------------------------------------------------

    def run(self, text, size, color=None, bold=False, caps=False):
        c = color or self.C["INK"]
        b = " bold='true'" if bold else ""
        r = Run(f"<run{b} fontcolor='{c}' fontname='{FONT}' fontsize='{size}'>{esc_run(text)}</run>")
        r.w = len(text) * size * (CH_CAPS if caps else CH_BOLD if bold else CH_REG)
        r.pt = size
        return r

    def NL(self):
        r = Run("<run>&#10;</run>")
        r.nl = True
        return r

    @staticmethod
    def lines_for(runs, w):
        """Lines a list of runs needs in a zone w px wide: greedy per line, forced at NL."""
        lines, used = 1, 0.0
        for r in runs:
            if r.nl:
                lines, used = lines + 1, 0.0
                continue
            used += r.w
            if r.endswith("\n</run>"):
                lines, used = lines + 1, 0.0
                continue
            while used > w:
                lines += 1
                used -= w
        return lines

    def text(self, runs, w=INNER, align=None, min_lines=1):
        """A text zone whose height is measured from its runs at width w."""
        runs = runs if isinstance(runs, list) else [runs]
        lines = max(min_lines, self.lines_for(runs, w))
        pt = max(r.pt for r in runs if not r.nl)
        # one line: 2.4 px/pt + 4; wrapped: 2.6 px/pt per line + 8 (a 4-line 8pt zone lost
        # its last line at the tighter rate in an earlier build - both margins are from
        # that measurement pass, not guesses)
        h = math.ceil(PX_PT * pt) + 4 if lines == 1 else math.ceil(PX_PT_WRAP * pt * lines) + 8
        self.measured.append((lines, w, "".join(r for r in runs)[:60]))
        return ("text", runs, align, h)

    def kicker(self, s, w=INNER):
        return self.text(self.run(s.upper(), SZ_KICK, self.C["MUTE"], bold=True, caps=True), w)

    def h2(self, parts, size=SZ_H2, w=INNER):
        """parts: list of str or (str,) for a bold accent-colored number/phrase."""
        runs = []
        for p in parts:
            if isinstance(p, tuple):
                runs.append(self.run(p[0], size, self.C["PULL"], bold=True))
            else:
                runs.append(self.run(p, size, self.C["INK"], bold=True))
        return self.text(runs, w)

    def take(self, s, w=INNER):
        return self.text(self.run(s, SZ_TAKE, self.C["INK2"]), w)

    def note(self, s, w=INNER):
        return self.text(self.run(s, SZ_NOTE, self.C["INK2"]), w)

    def legend(self, pairs, w=INNER, tail=""):
        """inline color legend: [(label, hex), ...] as colored square glyph + label runs."""
        runs = []
        for label, hexc in pairs:
            runs.append(self.run("■ ", SZ_NOTE, hexc, bold=True))
            runs.append(self.run(label + "   ", SZ_NOTE, self.C["INK2"]))
        if tail:
            runs.append(self.run(tail, SZ_NOTE, self.C["MUTE"]))
        return self.text(runs, w)

    def sheet(self, name, h):
        return ("sheet", name, h)

    def filt(self, sheet, param, mode, w):
        return ("filter", sheet, param, mode, w)

    def nav(self, page, current):
        return ("nav", page, current, H_NAV)

    def horz(self, children, h=None):
        """children: list of (node, width_px); h defaults to the tallest child"""
        if h is None:
            h = max(self.height(c) for c, _ in children)
        return ("horz", children, h)

    def vert(self, children):
        return ("vert", children, sum(self.height(c) for c in children))

    def empty(self, h):
        return ("empty", h)

    def height(self, node):
        return node[-1] if node[0] != "vert" else node[2]

    def budget(self, fixed_total):
        """px left for one flexible sheet once everything else on the page (padding,
        header, filter row, gaps, other fixed sheets) is accounted for.
        # adapted: the source computed header + filter-row heights internally via its
        now-removed header()/filter_row() methods; the caller now sums its own fixed
        nodes' heights (via height()) and passes the total directly."""
        return DASH_H - 2 * PAD - fixed_total

    # ---- zone-tree emission -------------------------------------------------

    def nid(self):
        self._id += 1
        return self._id

    def zstyle(self, extra=""):
        return ("<zone-style><format attr='border-style' value='none' /><format attr='margin' value='0' />"
                f"<format attr='padding' value='0' />{extra}</zone-style>")

    def nav_zone(self, fx, Hm, zid, Wm, X, Yy, page, current):
        """Navigation button object. window-id = the target dashboard window's simple-id,
        which the caller generates as gen_uuid(page + '-win') (see windows_xml() above,
        which uses the same convention)."""
        uuid = self.gen_uuid(page + "-win")
        bg = self.C["PULL"] if current else "#e3e2dc"
        fg = "#ffffff" if current else self.C["INK2"]
        return (f"<zone {fx}h='{Hm}' id='{zid}' type-v2='dashboard-object' w='{Wm}' x='{X}' y='{Yy}'>"
                f"<button action='tabdoc:goto-sheet window-id=&quot;{uuid}&quot;' button-type='text'>"
                "<button-visual-state>"
                f"<caption>{esc_run(page)}</caption>"
                f"<button-caption-font-style fontcolor='{fg}' fontname='{FONT}' fontsize='{SZ_NAV}' />"
                f"<format attr='background-color' value='{bg}' />"
                "</button-visual-state></button>"
                "<zone-style><format attr='border-color' value='#000000' /><format attr='border-style' value='none' />"
                "<format attr='border-width' value='0' /><format attr='margin' value='4' /></zone-style>"
                "</zone>")

    def emit(self, node, x, y, w, h, out, fixed_axis):
        """x,y,w,h in px. fixed_axis: 'h' or 'w' tells which dimension the parent flow
        fixes. TRAP (element order): a horz/vert layout-flow zone must close with its own
        <zone-style> as its LAST child, after every emitted grandchild zone - build the
        children list first, then append zstyle(), exactly as below."""
        W, Ht = DASH_W, DASH_H
        X, Yy = round(100000 * x / W), round(100000 * y / Ht)
        Wm, Hm = round(100000 * w / W), round(100000 * h / Ht)
        fx = f"fixed-size='{h if fixed_axis == 'h' else w}' is-fixed='true' "
        kind = node[0]
        zid = self.nid()
        if kind == "sheet":
            out.append(f"<zone {fx}h='{Hm}' id='{zid}' name='{esc_run(node[1])}' show-title='false' w='{Wm}' x='{X}' y='{Yy}'>"
                       f"{self.zstyle()}</zone>")
        elif kind == "text":
            _, runs, align, _h = node
            if align:
                self.aligns.append((zid, align))
            out.append(f"<zone {fx}forceUpdate='true' h='{Hm}' id='{zid}' type-v2='text' w='{Wm}' x='{X}' y='{Yy}'>"
                       f"<formatted-text>{''.join(runs)}</formatted-text>{self.zstyle()}</zone>")
        elif kind == "empty":
            out.append(f"<zone {fx}h='{Hm}' id='{zid}' type-v2='empty' w='{Wm}' x='{X}' y='{Yy}'>{self.zstyle()}</zone>")
        elif kind == "filter":
            _, sheet, param, mode, _w = node
            out.append(f"<zone {fx}h='{Hm}' id='{zid}' mode='{mode}' name='{esc_run(sheet)}' param='{param}' "
                       f"type-v2='filter' w='{Wm}' x='{X}' y='{Yy}'>{self.zstyle()}</zone>")
        elif kind == "nav":
            _, page, current, _h = node
            out.append(self.nav_zone(fx, Hm, zid, Wm, X, Yy, page, current))
        elif kind in ("vert", "horz"):
            out.append(f"<zone {fx}h='{Hm}' id='{zid}' param='{kind}' type-v2='layout-flow' w='{Wm}' x='{X}' y='{Yy}'>")
            if kind == "vert":
                cy = y
                for ch in node[1]:
                    ch_h = self.height(ch)
                    self.emit(ch, x, cy, w, ch_h, out, "h")
                    cy += ch_h
            else:
                cx = x
                for ch, cw in node[1]:
                    self.emit(ch, cx, y, cw, h, out, "w")
                    cx += cw
            out.append(f"{self.zstyle()}</zone>")
        else:
            raise ValueError(kind)

    def sheets_in(self, node, acc):
        k = node[0]
        if k in ("sheet", "filter"):
            acc.append(node[1])
        elif k == "vert":
            for ch in node[1]:
                self.sheets_in(ch, acc)
        elif k == "horz":
            for ch, _ in node[1]:
                self.sheets_in(ch, acc)
        return acc

    def dashboard_xml(self, page, sources, content_nodes):
        """content_nodes: the FULL top-level node list for this dashboard page - this
        module ships no header/filter-row builder, so the caller assembles those (if
        wanted) into the list it passes here, using budget() to size the flexible sheet
        against them.
        # adapted: the source built `content` from a hardcoded
        [self.header(page), empty(GAP), self.filter_row(page), empty(GAP)] + body_nodes;
        the caller now supplies that whole list directly."""
        self.aligns = []
        content = self.vert(content_nodes)
        content_h = self.height(content)
        total = content_h + 2 * PAD
        assert total <= DASH_H, f"{page}: content {content_h} + padding exceeds {DASH_H}"
        fill = DASH_H - total
        page_node = self.vert([
            self.empty(PAD),
            self.horz([(self.empty(PAD), PAD), (content, INNER), (self.empty(PAD), PAD)], content_h),
            self.empty(PAD + fill),
        ])
        out = []
        root = self.nid()
        out.append(f"<zone h='100000' id='{root}' type-v2='layout-basic' w='100000' x='0' y='0'>")
        self.emit(page_node, 0, 0, DASH_W, DASH_H, out, "h")
        out.append(f"<zone-style><format attr='border-style' value='none' />"
                   f"<format attr='background-color' value='{self.C['BG']}' /></zone-style>")
        out.append("</zone>")
        zones = "\n        ".join(out)
        dsrc = "\n        ".join(f"<datasource caption='{c}' name='{i}' />" for i, c in sources)
        aligns = "".join(f"<format attr='text-align' id='dash-text_{zid}' value='{a}' />" for zid, a in self.aligns)
        xml = f"""    <dashboard name='{esc_run(page)}'>
      <style>
        <style-rule element='dashboard'><format attr='background-color' value='{self.C['BG']}' /></style-rule>
        <style-rule element='dash-text'><format attr='vertical-align' value='top' />{aligns}</style-rule>
        <style-rule element='quick-filter'><format attr='font-family' value='{FONT}' /><format attr='font-size' value='9' /></style-rule>
        <style-rule element='quick-filter-title'><format attr='font-family' value='{FONT}' /><format attr='font-size' value='9' /><format attr='color' value='{self.C['INK']}' /></style-rule>
      </style>
      <size maxheight='{DASH_H}' maxwidth='{DASH_W}' minheight='{DASH_H}' minwidth='{DASH_W}' sizing-mode='fixed' />
      <datasources>
        {dsrc}
      </datasources>
      <zones>
        {zones}
      </zones>
      <simple-id uuid='{self.gen_uuid(page)}' />
    </dashboard>"""
        on_page = sorted(set(self.sheets_in(content, [])))
        return xml, content_h + 2 * PAD, on_page

    def pages(self, sources, page_specs):
        """page_specs: [(page_name, content_nodes)], content_nodes already fully built
        (see dashboard_xml). Returns [(page name, dashboard xml, content height incl.
        padding, sheets on the page)].
        # adapted: the source hardcoded its own 4 page-builder methods and a module-level
        PAGES list here; both are now supplied by the caller via page_specs."""
        self.sheet_h = {}
        return [(p, *self.dashboard_xml(p, sources, nodes)) for p, nodes in page_specs]


# =========================================================================================
# Worked example (python twb_lib.py --demo out.twb)
# =========================================================================================

_DEMO_TEMPLATE = """<?xml version='1.0' encoding='utf-8' ?>
<workbook original-version='18.1' version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <datasources>
  <datasource caption='Sample' inline='true' name='federated.demo0000000000000000000000000' version='18.1'>
    <connection class='federated'>
      <named-connections>
        <named-connection caption='sample' name='textscan.demo'>
          <connection class='textscan' directory='.' filename='sample.csv' />
        </named-connection>
      </named-connections>
    </connection>
    <column datatype='string' name='[category]' role='dimension' type='nominal' />
    <column datatype='integer' name='[amount]' role='measure' type='quantitative' />
  </datasource>
  </datasources>
  <worksheets>
  </worksheets>
  <windows source-height='30'>
  </windows>
</workbook>
"""


def demo(out_path):
    """Build one horizontal bar sheet (category on Rows, SUM(amount) on Cols) into the
    synthetic template above and write it. The XML must parse; whether Tableau opens
    it is a separate question, answered only by opening it."""
    twb = _DEMO_TEMPLATE
    block = ds_block(twb)
    ds, cap = ds_id(block), ds_caption(block)
    sheet = bar_ws(ds, cap, "Amount by category", "category", "amount")
    check_xml("demo sheet", sheet)
    empty = "  <worksheets>" + chr(10) + "  </worksheets>"
    twb = twb.replace(empty, "  <worksheets>" + chr(10) + sheet + chr(10) + "  </worksheets>")
    ET.fromstring(twb.split("?>", 1)[1])
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(twb)
    return out_path


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--demo":
        print("wrote", demo(sys.argv[2]))
    else:
        print(__doc__)
