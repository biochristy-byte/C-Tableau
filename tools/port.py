#!/usr/bin/env python3
"""Port registry for Tableau viz extensions (standard library only).

Every extension's .trex points at http://localhost:<port>/..., so two
extensions on one port cannot both run. Never hand-pick a port. Ask here.

  python tools/port.py <extension-id>            print its port (assign one if new)
  python tools/port.py --check                   scan every .trex, exit 1 on any problem
  python tools/port.py --apply <id> <folder>     rewrite the folder's port to the registered one

Options: --registry FILE (default <repo>/ports.json), --root DIR (default repo),
--folder NAME and --owner NAME (recorded when a new id is assigned).

A new id starts from a stable hash of the id inside 20000-29999, then steps
forward past any port in the registry or currently in use on this machine. Two
people on different machines who never pulled each other's registry almost
never land on the same port, because the hash depends only on the id.
"""
import argparse
import hashlib
import json
import os
import re
import socket
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LO, HI = 20000, 29999
SKIP_DIRS = {"node_modules", ".git", "lib", "data", "__pycache__"}
TEXT_EXT = {".trex", ".json", ".js", ".mjs", ".ps1", ".bat", ".cmd", ".sh", ".md", ".txt",
            ".py", ".html", ".yml", ".yaml"}
URL_RE = re.compile(r"https?://(?:localhost|127\.0\.0\.1):(\d+)")
ID_RE = re.compile(r"<(?:worksheet|dashboard)-extension\b[^>]*?\bid=\"([^\"]+)\"")


def registry_path(arg):
    return arg or os.path.join(REPO, "ports.json")


def load(path):
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path, reg):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(reg, f, indent=2, sort_keys=True)
        f.write("\n")


def hash_port(ext_id):
    h = int.from_bytes(hashlib.sha256(ext_id.encode("utf-8")).digest()[:8], "big")
    return LO + h % (HI - LO + 1)


def in_use(port):
    """True when something on this machine already holds the port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as c:
        c.settimeout(0.3)
        if c.connect_ex(("127.0.0.1", port)) == 0:
            return True
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            return True
    return False


def get_or_assign(ext_id, reg_file, folder="", owner=""):
    reg = load(reg_file)
    if ext_id in reg:
        return reg[ext_id]["port"], False
    taken = {v["port"] for v in reg.values()}
    port = hash_port(ext_id)
    for _ in range(HI - LO + 1):
        if port not in taken and not in_use(port):
            break
        port = LO + (port - LO + 1) % (HI - LO + 1)
    else:
        raise SystemExit("no free port in %d-%d" % (LO, HI))
    reg[ext_id] = {"port": port, "folder": folder or find_folder(ext_id), "owner": owner or git_user()}
    save(reg_file, reg)
    return port, True


def git_user():
    try:
        return subprocess.run(["git", "config", "user.name"], capture_output=True, text=True,
                              cwd=REPO).stdout.strip() or "unknown"
    except OSError:
        return "unknown"


def walk(root):
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for n in files:
            yield os.path.join(d, n)


def scan_trex(root):
    """Yield (path, id, port) for every .trex that loads from localhost."""
    for p in walk(root):
        if not p.lower().endswith(".trex"):
            continue
        with open(p, encoding="utf-8", errors="replace") as f:
            text = f.read()
        m, u = ID_RE.search(text), URL_RE.search(text)
        if m and u:
            yield p, m.group(1), int(u.group(1))


def find_folder(ext_id, root=REPO):
    for p, i, _ in scan_trex(root):
        if i == ext_id:
            return os.path.basename(os.path.dirname(p))
    return ""


def check(root, reg_file):
    reg = load(reg_file)
    problems, seen = [], {}
    rows = list(scan_trex(root))
    for ext_id, v in reg.items():
        for other, w in reg.items():
            if ext_id < other and v["port"] == w["port"]:
                problems.append("registry: %s and %s both own port %d" % (ext_id, other, v["port"]))
    for p, ext_id, port in rows:
        rel = os.path.relpath(p, root)
        if ext_id not in reg:
            problems.append("%s: id %s is not in the registry (run: python tools/port.py %s)" % (rel, ext_id, ext_id))
        elif reg[ext_id]["port"] != port:
            problems.append("%s: .trex says %d but the registry says %d (run: python tools/port.py --apply %s %s)"
                            % (rel, port, reg[ext_id]["port"], ext_id, os.path.dirname(rel)))
        seen.setdefault(port, set()).add(ext_id)
    for port, ids in sorted(seen.items()):
        if len(ids) > 1:
            problems.append("port %d is used by %d extensions: %s" % (port, len(ids), ", ".join(sorted(ids))))
    return rows, problems


def apply(ext_id, folder, reg_file):
    reg = load(reg_file)
    if ext_id not in reg:
        raise SystemExit("%s is not registered; run: python tools/port.py %s" % (ext_id, ext_id))
    new = reg[ext_id]["port"]
    folder = os.path.abspath(folder)
    olds = set()
    for p in walk(folder):
        if p.lower().endswith(".trex"):
            with open(p, encoding="utf-8", errors="replace") as f:
                olds.update(int(x) for x in URL_RE.findall(f.read()))
    olds.discard(new)
    changed = []
    for p in walk(folder):
        if os.path.splitext(p)[1].lower() not in TEXT_EXT:
            continue
        with open(p, "rb") as f:
            raw = f.read()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        out = text
        for old in olds:
            out = re.sub(r"(?<![\d.])%d(?![\d])" % old, str(new), out)
        if out != text:
            with open(p, "wb") as f:
                f.write(out.encode("utf-8"))
            changed.append(os.path.relpath(p, folder))
    return new, sorted(olds), changed


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("id", nargs="?")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--apply", nargs=2, metavar=("ID", "FOLDER"))
    ap.add_argument("--registry")
    ap.add_argument("--root", default=REPO)
    ap.add_argument("--folder", default="")
    ap.add_argument("--owner", default="")
    a = ap.parse_args(argv)
    reg_file = registry_path(a.registry)
    if a.check:
        rows, problems = check(a.root, reg_file)
        for x in problems:
            print("PROBLEM:", x)
        print("checked %d localhost .trex file(s), %d problem(s)" % (len(rows), len(problems)))
        return 1 if problems else 0
    if a.apply:
        new, olds, changed = apply(a.apply[0], a.apply[1], reg_file)
        print("port %d (was %s); rewrote %d file(s):" % (new, olds or "already correct", len(changed)))
        for c in changed:
            print("  " + c)
        return 0
    if not a.id:
        ap.error("give an extension id, --check, or --apply ID FOLDER")
    port, new = get_or_assign(a.id, reg_file, a.folder, a.owner)
    if new:
        print("assigned %d to %s and wrote %s" % (port, a.id, os.path.basename(reg_file)), file=sys.stderr)
    print(port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
