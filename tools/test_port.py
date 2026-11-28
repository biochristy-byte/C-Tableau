#!/usr/bin/env python3
"""Proof for tools/port.py. Run: python tools/test_port.py   (prints PORTS GREEN or PORTS RED)."""
import json
import os
import shutil
import socket
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import port  # noqa: E402

REAL = os.path.join(port.REPO, "ports.json")
checks = []


def ok(name, cond):
    checks.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)


reg = port.load(REAL)
ok("registry has at least 10 extensions (examined %d)" % len(reg), len(reg) >= 10)

# (a) registered ids return their current port, and the .trex on disk agrees
for ext_id, v in reg.items():
    p, new = port.get_or_assign(ext_id, REAL)
    ok("a: %s returns %d, not newly assigned" % (ext_id, v["port"]), p == v["port"] and not new)
trex = {i: pt for _, i, pt in port.scan_trex(port.REPO)}
ok("a: every registered id has a .trex on disk with its registered port",
   all(trex.get(i) == v["port"] for i, v in reg.items()))

tmp = tempfile.mkdtemp(prefix="portsys_")
try:
    tmp_reg = os.path.join(tmp, "ports.json")
    shutil.copy(REAL, tmp_reg)

    # (b) a new id gets a port outside the registry, inside the range, and it is persisted
    p, new = port.get_or_assign("com.test.vizext.brandnew", tmp_reg, "x", "t")
    taken = {v["port"] for v in reg.values()}
    ok("b: new id gets a port not in the registry (%d)" % p, new and p not in taken)
    ok("b: new port is inside %d-%d" % (port.LO, port.HI), port.LO <= p <= port.HI)
    ok("b: asking again returns the same port", port.get_or_assign("com.test.vizext.brandnew", tmp_reg)[0] == p)
    ok("b: the registry file now holds it", port.load(tmp_reg)["com.test.vizext.brandnew"]["port"] == p)
    ok("b: hash is stable", port.hash_port("abc") == port.hash_port("abc"))

    # (b2) the registry itself pushes a colliding hash forward
    want = port.hash_port("com.test.vizext.hashclash")
    clash_reg = os.path.join(tmp, "clash.json")
    port.save(clash_reg, {"other": {"port": want, "folder": "", "owner": ""}})
    p2, _ = port.get_or_assign("com.test.vizext.hashclash", clash_reg)
    ok("b: hash port already in the registry is skipped (%d -> %d)" % (want, p2), p2 != want)

    # (c) a port held by a live listener is skipped
    target = port.hash_port("com.test.vizext.livelisten")
    srv = socket.socket()
    try:
        srv.bind(("127.0.0.1", target))
        srv.listen(1)
        held = True
    except OSError:
        held = False  # someone else already holds it, which also proves the point
    ok("c: in_use sees the live listener", port.in_use(target))
    live_reg = os.path.join(tmp, "live.json")
    port.save(live_reg, {})
    p3, _ = port.get_or_assign("com.test.vizext.livelisten", live_reg)
    ok("c: live listener port skipped (%d -> %d)" % (target, p3), p3 != target)
    srv.close()
    ok("c: once the listener closes the port reads as free", not port.in_use(target))

    # (d) --check: GREEN on the real repo, RED on a duplicated port in a temp copy
    rc_real = port.main(["--check"])
    ok("d: --check is GREEN on the real repo", rc_real == 0)
    copy = os.path.join(tmp, "repo")
    shutil.copytree(port.REPO, copy, ignore=shutil.ignore_patterns("node_modules", ".git", "dist"))
    shutil.copy(REAL, os.path.join(copy, "ports.json"))
    ok("d: temp copy is GREEN before sabotage",
       port.main(["--check", "--root", copy, "--registry", os.path.join(copy, "ports.json")]) == 0)
    rd = os.path.join(copy, "tableau-range-dot", "RangeDot.trex")
    with open(rd, encoding="utf-8") as f:
        text = f.read()
    with open(rd, "w", encoding="utf-8") as f:
        f.write(text.replace("localhost:%d" % reg["com.xeomatrix.vizext.rangedot"]["port"], "localhost:8771"))
    ok("d: sabotage (RangeDot back on 8771) goes RED",
       port.main(["--check", "--root", copy, "--registry", os.path.join(copy, "ports.json")]) == 1)
    # restore the ORIGINAL shape, and confirm it returns to green
    with open(rd, "w", encoding="utf-8") as f:
        f.write(text)
    ok("d: restored copy is GREEN again",
       port.main(["--check", "--root", copy, "--registry", os.path.join(copy, "ports.json")]) == 0)
    # --apply repairs a drifted folder
    with open(rd, "w", encoding="utf-8") as f:
        f.write(text.replace("localhost:%d" % reg["com.xeomatrix.vizext.rangedot"]["port"], "localhost:8771"))
    port.main(["--apply", "com.xeomatrix.vizext.rangedot", os.path.join(copy, "tableau-range-dot"),
               "--registry", os.path.join(copy, "ports.json")])
    ok("d: --apply puts the registered port back",
       port.main(["--check", "--root", copy, "--registry", os.path.join(copy, "ports.json")]) == 0)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

bad = [n for n, c in checks if not c]
print("PORTS %s: %d checks, %d failed" % ("RED" if bad else "GREEN", len(checks), len(bad)))
sys.exit(1 if bad else 0)
