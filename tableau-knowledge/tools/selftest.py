"""selftest.py - run every tool in this folder on synthetic input. Opens no Tableau window.

    python selftest.py

Prints one line per tool: PASS, FAIL, or SKIP (a missing optional package is SKIP, never
PASS). Exit 0 only if nothing failed and at least one tool ran.
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC")
results = []


def run(*args):
    return subprocess.run([sys.executable, "-I"] + list(args), capture_output=True, text=True, cwd=HERE)


def record(name, ok, detail=""):
    results.append((name, "PASS" if ok else "FAIL"))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def skip(name, why):
    results.append((name, "SKIP"))
    print(f"SKIP  {name}  {why}")


def main():
    tmp = tempfile.mkdtemp(prefix="tools_selftest_")
    p = lambda n: os.path.join(tmp, n).replace(os.sep, "/")  # noqa: E731

    r = run("twb_lib.py", "--demo", p("demo.twb"))
    ok = r.returncode == 0 and len(list(ET.parse(p("demo.twb")).getroot().iter("worksheet"))) == 1
    record("twb_lib", ok, "emitted a .twb with 1 worksheet that parses as XML")

    cfg = {"measure": "amount", "dashboard": {"name": "D", "w": 800, "h": 600},
           "sheets": [{"name": "S1", "dim": "category"}, {"name": "S2", "dim": "category", "color": "flag"}],
           "layout": ["vert", [[["sheet", "S1"], 1], [["sheet", "S2"], 1]]]}
    json.dump(cfg, open(p("c.json"), "w"))
    r = run("tableau_inject.py", "--template", os.path.join(HERE, "example", "mini_template.twb"),
            "--config", p("c.json"), "--out", p("built.twb"))
    root = ET.parse(p("built.twb")).getroot() if r.returncode == 0 else None
    ok = root is not None and [w.get("name") for w in root.iter("worksheet")] == ["S1", "S2"] \
        and len(list(root.iter("dashboard"))) == 1
    record("tableau_inject", ok, "2 sheets and 1 dashboard injected into the example template")

    r1 = run("a11y_check.py", "--pair", "#777", "#fff")
    r2 = run("a11y_check.py", "--pair", "#000", "#fff")
    record("a11y_check", r1.returncode == 1 and "FAIL" in r1.stdout and r2.returncode == 0 and "PASS" in r2.stdout,
           "#777 on #fff -> FAIL, black on white -> PASS")

    open(p("e.hyper"), "wb").write(b"HYPER")
    open(p("bg.png"), "wb").write(PNG)
    open(p("w.twb"), "w").write(
        "<?xml version='1.0' encoding='utf-8' ?>\n<workbook><datasource><extract>"
        f"<connection dbname='{p('e.hyper')}' /></extract></datasource>"
        f"<dashboard><format param='{p('bg.png')}' type-v2='bitmap' /></dashboard></workbook>\n")
    r = run("package_twbx.py", p("w.twb"), p("w.twbx"), "--min-extracts=1")
    names = zipfile.ZipFile(p("w.twbx")).namelist() if r.returncode == 0 else []
    record("package_twbx", "w.twb" in names and "Data/extracts/e.hyper" in names and "Image/bg.png" in names,
           f"zip lists {names}")

    try:
        import tableauhyperapi  # noqa: F401
        have_hyper = True
    except ImportError:
        have_hyper = False
    if have_hyper:
        code = (
            "from tableauhyperapi import *\n"
            f"td=TableDefinition(TableName('Extract','Extract'),[TableDefinition.Column('n',SqlType.text()),"
            "TableDefinition.Column('q',SqlType.big_int())])\n"
            "with HyperProcess(Telemetry.DO_NOT_SEND_USAGE_DATA_TO_TABLEAU) as h:\n"
            f" with Connection(h.endpoint,'{p('t.hyper')}',CreateMode.CREATE_AND_REPLACE) as c:\n"
            "  c.catalog.create_schema('Extract'); c.catalog.create_table(td)\n"
            "  with Inserter(c,td) as i: i.add_row(['old',9]); i.execute()\n")
        subprocess.run([sys.executable, "-c", code], check=True)
        open(p("t.csv"), "w").write("n,q\na,1\nb,2\n")
        r = run("refresh_extracts.py", f"{p('t.csv')}={p('t.hyper')}", "--expect-sum=q=3", "--force")
        bad = run("refresh_extracts.py", f"{p('t.csv')}={p('t.hyper')}", "--expect-sum=q=4", "--force")
        record("refresh_extracts", r.returncode == 0 and "GREEN" in r.stdout and bad.returncode == 1,
               "rewrote 2 rows; SUM(q)=3 GREEN, a wrong expectation RED")
    else:
        skip("refresh_extracts", "pip install tableauhyperapi to run it")

    sys.path.insert(0, HERE)
    import load_errors
    ok = load_errors.is_save_keystroke("^s") and not load_errors.is_save_keystroke("{ENTER}")
    try:
        load_errors.safe_send_keys("^s")
        ok = False
    except SystemExit:
        pass
    skip("load_errors (GUI part)", "needs Tableau installed; only the Ctrl+S refusal is tested")
    record("load_errors save-key guard", ok, "^s refused, {ENTER} allowed")

    failed = [n for n, s in results if s == "FAIL"]
    ran = [n for n, s in results if s == "PASS"]
    print(f"{len(ran)} passed, {len(failed)} failed, {len(results) - len(ran) - len(failed)} skipped")
    return 1 if failed or not ran else 0


if __name__ == "__main__":
    sys.exit(main())
