# Tools

Scripts for building, checking and packaging Tableau workbooks from Python, written so a
person and their Claude Code can use them together. Every one runs from a plain
command line. None of them needs your data: the examples use synthetic input.

Tested on Python 3.11. Run `python selftest.py` to prove they all work on your machine. It opens no Tableau window
and prints PASS, FAIL or SKIP per tool.

| Tool | What it does | Example command | Requirements |
|---|---|---|---|
| `twb_lib.py` | Library of builders that emit Tableau workbook XML: datasource blocks, worksheets (KPI tile, bar, stacked, dumbbell, small multiples, text table), tooltips, sorts, filters, palettes, actions, windows, and a dashboard layout engine. Import it from your own generator. | `python twb_lib.py --demo out.twb` (builds one bar sheet into a tiny synthetic workbook and proves it parses) | Python 3.9+, standard library only |
| `make_desktop_skill.py` | Packs the whole knowledge folder into `dist/tableau-craft.zip`, one skill for Claude Desktop or claude.ai. RED if SKILL.md names a missing file. | `python make_desktop_skill.py` | Python 3.9+, standard library only |
| `tableau_inject.py` | The teaching injector. Mutates a Tableau-authored template: adds value aliases, writes one bar sheet per config entry, a flow-container dashboard and the windows block. Read it first to learn the pipeline. | `python tableau_inject.py --template example/mini_template.twb --config example/inject.json --out built.twb` | Python 3.9+, standard library only |
| `a11y_check.py` | Contrast (default 7:1), minimum text size, legend size and clipping gates. Reads the XML Tableau will load. Also checks bare colour pairs. Goes RED if it examined too little. | `python a11y_check.py --pair "#777777" "#ffffff"` (FAIL, 4.48:1) or `python a11y_check.py book.twbx --config a11y.json` | Python 3.9+; `pip install pillow` is optional (better text widths) |
| `load_errors.py` | Opens a workbook in Tableau. If Tableau refuses it, presses the dialog's Copy Error Message button and prints the full schema error list (Tableau masks these in its log). **Drives the GUI.** | `python load_errors.py built.twb` | Windows, Python 3.9+, `pip install pywinauto`, Tableau Desktop or Public Desktop installed |
| `refresh_extracts.py` | Rewrites `.hyper` extracts from CSVs, reusing each extract's existing schema. RED if a CSV lost a column or a total changed. | `python refresh_extracts.py data/sales.csv=extracts/sales.hyper --min-rows=100 --expect-sum=amount=4200` | Python 3.9+, `pip install tableauhyperapi`. Close Tableau first (it locks the file) |
| `package_twbx.py` | Packages a `.twb` into a `.twbx` without the GUI: moves extracts to `Data/extracts/`, background images to `Image/`, optionally embeds custom shapes, then re-opens the zip and proves every reference resolves. | `python package_twbx.py built.twb built.twbx --shapes-dir=shapes` | Python 3.9+, standard library only |
| `selftest.py` | Runs all of the above on synthetic input. | `python selftest.py` | The packages above (a missing one gives SKIP) |

## Windows and the GUI tools

`load_errors.py` is the only tool here that touches the Tableau window. It needs Windows and
a Tableau Desktop or Tableau Public Desktop install. It looks under
`C:/Program Files/Tableau`; pass `--exe=PATH` or set `TABLEAU_EXE` if yours is elsewhere. Every
other tool is plain Python and runs anywhere.

## Never send Ctrl+S

In Tableau Public, Ctrl+S is "Save to Tableau Public", and a remembered sign-in publishes with
no password prompt. A GUI driver once put a broken workbook live this way.

- `load_errors.py` sends no keys at all. Its one keyboard helper, `safe_send_keys`, refuses
  Ctrl+S, Alt+F+S and every other save chord, and `selftest.py` proves it.
- To save locally, use **File > Save As** by hand. Do not teach a driver to do it.
- If you write your own driver, copy the `BANNED` check from `load_errors.py`, or use the
  hardened `tableau-garden-petals/tools/tabdrive.py`, which checks every string before it reaches
  `send_keys` (typing text counts, because `^` means Ctrl).
- `package_twbx.py` exists so you never need a Save keystroke to produce a `.twbx`.
- See [../never-ctrl-s-on-public.md](../never-ctrl-s-on-public.md).

## Notes

- A workbook that is well-formed XML is not a workbook Tableau accepts. `twb_lib.py` and
  `tableau_inject.py` gate well-formedness; `load_errors.py` is the real test.
- `package_twbx.py` does not prove Tableau opens the result either. Open it.
- `a11y_check.py` contrast is exact; its fit checks are estimates from a text-width model
  you should recalibrate on your own display (see its docstring). It never claims to measure
  basemap labels or Tableau's own UI chrome.
- No tool here reads or ships any data. `a11y_check.py` takes field values from a JSON
  config rather than your CSVs.
