"""Tests the sync gate itself against a throwaway tree: match, mismatch, missing file, extra file, skip, empty.
Run: python test/sync_test.py   (RED and exit 1 if the gate misreports any case)"""
import pathlib, shutil, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parent.parent
GATE = HERE / "sync_check.py"
fails, n = [], [0]


def run(root):
    r = subprocess.run([sys.executable, str(GATE), "--root", str(root), "--shared", str(HERE)], capture_output=True, text=True)
    return r.returncode, r.stdout


def check(name, cond, detail=""):
    n[0] += 1
    if not cond:
        fails.append(name + " :: " + str(detail))


def vend(root, ext, js=True, css=True):
    d = root / ext / "lib" / "ctab-panel"
    d.mkdir(parents=True)
    if js: shutil.copyfile(HERE / "ctab-panel.js", d / "ctab-panel.js")
    if css: shutil.copyfile(HERE / "ctab-panel.css", d / "ctab-panel.css")
    shutil.copytree(HERE / "fonts", d / "fonts")
    return d


t = pathlib.Path(tempfile.mkdtemp(prefix="sync-"))
(t / "tableau-none").mkdir()
code, out = run(t)
check("no copies anywhere: SKIP, exit 0, never says GREEN", code == 0 and "SKIP  no extension" in out and "GREEN" not in out, out)
check("the skip list names the extension", "tableau-none" in out)
vend(t, "tableau-a")
code, out = run(t)
check("one exact copy: GREEN, and the other is still on the SKIP list", code == 0 and "GREEN  1 copies" in out and "tableau-none" in out, out)
d = vend(t, "tableau-b")
(d / "ctab-panel.js").write_bytes((d / "ctab-panel.js").read_bytes() + b" ")
code, out = run(t)
check("one changed byte: RED, exit 1, names the extension and file", code == 1 and "RED" in out and "DIFF  tableau-b" in out and "ctab-panel.js differs" in out, out)
(d / "ctab-panel.js").write_bytes((HERE / "ctab-panel.js").read_bytes())
code, out = run(t)
check("restored: GREEN with two copies", code == 0 and "GREEN  2 copies" in out, out)
(d / "ctab-panel.css").unlink()
code, out = run(t)
check("a missing vendored file is RED", code == 1 and "ctab-panel.css missing" in out, out)
shutil.copyfile(HERE / "ctab-panel.css", d / "ctab-panel.css"); (d / "stray.js").write_text("x")
code, out = run(t)
check("an extra file in lib/ctab-panel is RED", code == 1 and "unexpected file stray.js" in out, out)
(d / "stray.js").unlink()
code, out = run(t)
check("clean again: GREEN", code == 0 and "GREEN" in out, out)
check("examined count is reported", "examined 2 of 3" in out, out)
fp = d / "fonts" / "poppins-700.woff2"; good = fp.read_bytes(); fp.write_bytes(good[:-1] + b"x")
code, out = run(t)
check("a changed bundled font is RED", code == 1 and "fonts/poppins-700.woff2 differs" in out, out)
fp.write_bytes(good); (d / "fonts" / "LICENSE-Inter-OFL.txt").unlink()
code, out = run(t)
check("a missing font license is RED", code == 1 and "fonts/LICENSE-Inter-OFL.txt missing" in out, out)
shutil.copyfile(HERE / "fonts" / "LICENSE-Inter-OFL.txt", d / "fonts" / "LICENSE-Inter-OFL.txt"); (d / "fonts" / "extra.woff2").write_bytes(b"x")
code, out = run(t)
check("a stray file in fonts/ is RED", code == 1 and "unexpected file fonts/extra.woff2" in out, out)
(d / "fonts" / "extra.woff2").unlink()
code, out = run(t)
check("clean again with fonts: GREEN", code == 0 and "GREEN  2 copies" in out, out)
shutil.rmtree(t)
if n[0] < 8: fails.append("ran only %d checks" % n[0])
if fails:
    print("RED  %d failed" % len(fails)); [print("  - " + f) for f in fails]; sys.exit(1)
print("GREEN  %d checks" % n[0])
