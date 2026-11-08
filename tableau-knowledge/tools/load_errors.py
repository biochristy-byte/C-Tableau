"""load_errors.py - open a workbook, and if Tableau refuses it, press the dialog's own
"Copy Error Message" button and print the full schema (XSD) error list.

Tableau masks the detail in its log.txt (error-details=["*****"]), so the dialog is
the only place the messages exist.

SAFETY. This script never sends Ctrl+S, Alt+F+S or any other save or publish
keystroke. In Tableau Public, Ctrl+S is "Save to Tableau Public" and a remembered
sign-in publishes with no password prompt. The only input it makes is one mouse
click on the error dialog's Copy button. The keyboard helper below is the single
path to send_keys and it refuses anything that could save or publish. To save a
workbook locally, use File > Save As by hand.

It never kills Tableau. Close Tableau yourself first (an already-open Tableau
usually opens the file in the running instance, which is fine, but a stale error
dialog from an earlier attempt can be misread).

    python load_errors.py <workbook.twb|twbx> [--wait=40] [--exe=PATH]

Exit 0 = the workbook loaded. Exit 1 = it did not; the errors are printed.
Exit 2 = neither an error dialog nor a workbook window appeared.

Requirements: Windows, Python 3.9+, pip install pywinauto. Tableau Desktop or
Tableau Public Desktop installed. The exe is found under C:/Program Files/Tableau,
or pass --exe or set TABLEAU_EXE.
"""
import glob
import os
import subprocess
import sys
import time

DIALOG = "Unable to complete action"
TITLE_PREFIXES = ("Tableau Public - ", "Tableau - ")

# Keystrokes that could save or publish, after lowercasing and dropping spaces. send_keys
# reads ^ as Ctrl and % as Alt. Anything that CONTAINS one of these is refused.
BANNED = ("^s", "%fs", "^%s", "^+s", "{vk_control down}s", "{ctrl down}s")


def is_save_keystroke(keys):
    k = keys.replace(" ", "").lower()
    return any(b.replace(" ", "") in k for b in BANNED)


def safe_send_keys(keys):
    """The only keyboard path in this file. Save and publish chords are refused."""
    if is_save_keystroke(keys):
        raise SystemExit(f"REFUSED: {keys!r} can save or publish. Do that by hand (File > Save As).")
    from pywinauto.keyboard import send_keys
    send_keys(keys)


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def find_exe(explicit=None):
    cands = [explicit, os.environ.get("TABLEAU_EXE")]
    for pat in (r"C:\Program Files\Tableau\Tableau Public *\bin\tabpublic.exe",
                r"C:\Program Files\Tableau\Tableau 20*\bin\tableau.exe"):
        cands += sorted(glob.glob(pat), reverse=True)
    for c in cands:
        if c and os.path.exists(c):
            return c
    raise SystemExit("Tableau executable not found. Pass --exe=PATH or set TABLEAU_EXE.")


def clipboard():
    r = subprocess.run(["powershell", "-NoProfile", "-Command", "Get-Clipboard -Raw"],
                       capture_output=True, text=True)
    return r.stdout


def parse_errors(txt):
    """Split the copied text into distinct, ordered error lines."""
    seen = []
    for part in txt.replace("Error(", "\nError(").split("\n"):
        part = part.strip()
        if part and part not in seen:
            seen.append(part)
    return seen


def windows():
    from pywinauto import Desktop
    res = []
    for w in Desktop(backend="win32").windows():
        try:
            t = w.window_text()
        except Exception:
            continue
        if t.strip():
            res.append((t, w))
    return res


def find(title_pred, timeout, poll=2):
    t0 = time.time()
    while time.time() - t0 < timeout:
        for t, w in windows():
            try:
                if title_pred(t) and w.is_visible() and w.rectangle().width() > 200:
                    return t, w
            except Exception:
                continue
        time.sleep(poll)
    return None, None


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    import ctypes
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)   # before pywinauto: click coords stay true
    except Exception:
        pass
    from pywinauto import Application, mouse

    book = os.path.abspath(args[0])
    wait = next((int(a.split("=")[1]) for a in argv if a.startswith("--wait=")), 40)
    exe = find_exe(next((a.split("=", 1)[1] for a in argv if a.startswith("--exe=")), None))
    subprocess.Popen([exe, book])
    log("opening", os.path.basename(book))
    _t, dlg = find(lambda x: x == DIALOG, timeout=wait)
    if not dlg:
        t2, win = find(lambda x: x.startswith(TITLE_PREFIXES), timeout=20)
        if win:
            log("LOADED:", t2)
            return 0
        log("no error dialog and no workbook window; look at the screen")
        return 2
    log("load refused; asking the dialog for its text")
    # The dialog can sit BEHIND another app's window, and a blind coordinate click then
    # lands in whatever is on top. Focus first, then click.
    try:
        dlg.set_focus()
    except Exception as e:
        log("set_focus failed:", e)
    time.sleep(1.2)
    r = dlg.rectangle()
    clicked = False
    try:
        app = Application(backend="uia").connect(handle=dlg.handle, timeout=10)
        app.window(handle=dlg.handle).child_window(title_re=".*Copy Error.*").click_input()
        clicked = True
    except Exception as e:
        log("uia route failed:", type(e).__name__, e)
    if not clicked:
        # fallback: the Copy button sits bottom right of this fixed-layout dialog
        mouse.click(coords=(r.right - 141, r.bottom - 37))
    time.sleep(1.5)
    lines = parse_errors(clipboard())
    print("---- load errors ----")
    for ln in lines:
        print(ln)
    print("---- %d distinct lines ----" % len(lines))
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
