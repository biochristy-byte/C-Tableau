#!/usr/bin/env python3
"""Self-test for ctab_tiles.py. Run: python -P tools/test_ctab_tiles.py

Generates a 50k-row CSV (ties, negatives, nulls, snap points, odd strings), builds a package, runs `check`,
answers a battery of app-shaped queries from the TILES and from the RAW CSV, and demands identical answers.
Sabotages (each must go RED): round half even; a tampered tile count; a deleted tile.
Also compares the builder's rounding to node's Math.round on edge values (SKIP, not PASS, without node).
"""
import csv, gzip, json, math, os, random, shutil, subprocess, sys, tempfile
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "ctab_tiles.py")
sys.path.insert(0, HERE)
from ctab_tiles import js_round, bin_sql  # noqa: E402

MIN_CHECKS = 40
RES = []


def ck(ok, label):
    RES.append((bool(ok), label))
    print(("  ok   " if ok else "  RED  ") + label)


def run(*args):
    return subprocess.run([sys.executable, "-P", TOOL, *args], capture_output=True, text=True, encoding="utf-8")


def gen_csv(path, n=50000, seed=7):
    rnd = random.Random(seed)
    types = ["Burglary", "Robbery", "Violence, sexual", 'Say "hi"', "Cafeé theft"]
    forces = ["Alpha Police", "Beta Police", "British Transport Police"]
    lsoas = [f"Area {i:03d}A" for i in range(40)] + [""]
    snaps = []
    for _ in range(1200):
        snaps.append((round(rnd.uniform(-3.0, 3.0), 6), round(rnd.uniform(-2.0, 2.0), 6), f"On or near Street {len(snaps)}"))
    # exact ties for s=1, 0.5, 0.25, 0.1, 0.05 and negatives
    ties = [(2.5, 0.5, "Tie A"), (-2.5, -0.5, "Tie B"), (0.25, -0.25, "Tie C"), (-0.75, 1.5, "Tie D"),
            (0.5, 0.0, "Tie E"), (1.5, -1.5, "Tie F"), (-0.125, 0.125, "Tie G"), (0.0, 0.0, "Zero"), (-0.0, 3.5, "Tie H")]
    snaps += ties
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "Month", "Crime type", "Reported by", "Latitude", "Longitude", "LSOA name", "Location", "junk"])
        for i in range(n):
            r = rnd.random()
            if r < 0.015:
                lat = lon = ""
            elif r < 0.017:
                lat, lon = "", "1.25"
            else:
                sp = rnd.choice(snaps) if rnd.random() < 0.9 else (round(rnd.gauss(0, 1.5), 6), round(rnd.gauss(0, 1), 6), "On or near Elsewhere")
                lat, lon = repr(sp[0]), repr(sp[1])
            m = rnd.choice(["2024-01", "2024-02", "2024-03", "2024-04"]) if rnd.random() < 0.7 else f"2024-0{rnd.randint(1, 5)}-{rnd.randint(1, 28):02d}"
            loc = ("On or near Street 1" if rnd.random() < 0.5 else "") if lat == "" else (rnd.choice(snaps)[2] if False else "")
            w.writerow([i, m, rnd.choice(types), rnd.choice(forces), lat, lon, rnd.choice(lsoas), "", "x"])
    # give each row a Location tied to its snap point: rewrite with a second pass (location from coordinates)
    rows = list(csv.reader(open(path, encoding="utf-8", newline="")))
    byxy = {(repr(s[0]), repr(s[1])): s[2] for s in snaps}
    for r in rows[1:]:
        r[7] = byxy.get((r[4], r[5]), "On or near Elsewhere" if r[4] else "")
    with open(path, "w", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerows(rows)


def load_raw(path):
    out = []
    for r in csv.DictReader(open(path, encoding="utf-8", newline="")):
        m = r["Month"]
        month = (m + "-01") if len(m) == 7 else m[:7] + "-01"  # --month-floor
        lat = float(r["Latitude"]) if r["Latitude"] != "" else None
        lon = float(r["Longitude"]) if r["Longitude"] != "" else None
        out.append({"lat": lat, "lon": lon, "Month": month, "Crime type": r["Crime type"] or None,
                    "Reported by": r["Reported by"] or None, "LSOA name": r["LSOA name"] or None, "Location": r["Location"] or None})
    return out


class Tiles:
    """Minimal reader: what the page planner does, in Python."""
    def __init__(self, root):
        self.root = root
        self.man = json.load(open(os.path.join(root, "manifest.json"), encoding="utf-8"))
        self.cache = {}

    def read(self, rel):
        if rel not in self.cache:
            p = os.path.join(self.root, rel + ".json.gz")
            if not os.path.exists(p):
                self.cache[rel] = None
            else:
                d = json.loads(gzip.open(p, "rb").read().decode("utf-8"))
                self.cache[rel] = [dict(zip(d["cols"], r)) for r in d["rows"]]
        return self.cache[rel]

    def files(self, group, tile, box=None):
        base = os.path.join(self.root, group)
        out = []
        for f in os.listdir(base):
            tx, ty = f.split(".")[0].split("_")
            tx, ty = int(tx), int(ty)
            if box:
                la0, la1, lo0, lo1 = box
                if not (tx * tile <= lo1 and (tx + 1) * tile >= lo0 and ty * tile <= la1 and (ty + 1) * tile >= la0):
                    continue
            out.append(f"{group}/{tx}_{ty}")
        return out

    def level_rows(self, i, box=None):
        lv = self.man["levels"][i]
        rows = []
        for rel in self.files(f"L{i}", lv["tile"], box):
            rows += self.read(rel)
        return rows

    def detail_rows(self, box=None):
        rows = []
        for rel in self.files("D", self.man["detail"]["tile"], box):
            rows += self.read(rel)
        return rows

    def null_rows(self):
        return self.read("null/0") or []


def main():
    tmp = tempfile.mkdtemp(prefix="ctab_tiles_test_")
    try:
        data = os.path.join(tmp, "in")
        os.makedirs(data)
        src = os.path.join(data, "crimes.csv")
        gen_csv(src)
        raw = load_raw(src)
        ck(len(raw) == 50000, "generated 50,000 rows")
        S = [1, 0.5, 0.25, 0.1, 0.05, 0.025, 0.01]
        common = ["--datasource", "Test Crime", "--lat", "Latitude", "--lon", "Longitude",
                  "--dims", "Month:date,Crime type,Reported by", "--detail", "LSOA name,Location",
                  "--levels", ",".join(str(x) for x in S), "--tile-for-level", "0.025=0.25,0.01=0.25",
                  "--detail-tile", "0.5", "--month-floor", "Month"]
        out = os.path.join(tmp, "tiles")
        r = run("build", "--input", src, *common, "--out", out)
        ck(r.returncode == 0, "build exits 0" + ("" if r.returncode == 0 else ": " + r.stderr[-300:] + r.stdout[-300:]))
        r = run("check", out)
        last = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-200:]
        ck(r.returncode == 0 and last.startswith("GREEN"), "check is GREEN on a good build: " + last)

        T = Tiles(out)
        man = T.man
        ck(man["rows"] == 50000 and man["datasource"] == "Test Crime", "manifest rows and datasource")
        ck(man["dims"][0] == {"caption": "Month", "type": "DATE"}, "manifest dims typed")
        ck(man["levels"][6] == {"i": 6, "s": 0.01, "tile": 0.25} and man["levels"][0]["tile"] == 1, "manifest levels and tile overrides")

        withxy = [x for x in raw if x["lat"] is not None and x["lon"] is not None]
        nullrows = [x for x in raw if x["lat"] is None or x["lon"] is None]
        ck(sum(x["__n"] for x in T.null_rows()) == len(nullrows), f"null/0 holds exactly the {len(nullrows)} null-coordinate rows")

        # 1. grid counts at each s over the whole map, from the coarsest level that answers
        for i, s in enumerate(S):
            ref = Counter((js_round(x["lat"] / s), js_round(x["lon"] / s)) for x in withxy)
            got = Counter()
            for x in T.level_rows(i):
                got[(js_round(x["Latitude"] / s), js_round(x["Longitude"] / s))] += x["__n"]
            ck(ref == got, f"grid counts at s={s}: {len(ref)} cells identical")

        # 2. grid by crime type and force and month, level 4 (s=0.05)
        s = 0.05
        ref = Counter((js_round(x["lat"] / s), js_round(x["lon"] / s), x["Crime type"], x["Reported by"], x["Month"]) for x in withxy)
        got = Counter()
        for x in T.level_rows(4):
            got[(js_round(x["Latitude"] / s), js_round(x["Longitude"] / s), x["Crime type"], x["Reported by"], x["Month"])] += x["__n"]
        ck(ref == got, "s=0.05 grid x type x force x month identical")

        # 3. box filter (detail tiles intersecting the box), counts by crime type
        box = (-0.6, 0.9, -1.1, 0.7)  # lat0 lat1 lon0 lon1, lat>=a and lat<b
        ref = Counter(x["Crime type"] for x in withxy if box[0] <= x["lat"] < box[1] and box[2] <= x["lon"] < box[3])
        got = Counter()
        for x in T.detail_rows(box):
            if box[0] <= x["Latitude"] < box[1] and box[2] <= x["Longitude"] < box[3]:
                got[x["Crime type"]] += x["__n"]
        ck(ref == got and sum(ref.values()) > 100, f"box filter by crime type identical ({sum(ref.values())} rows)")

        # 4. bin-equality + top-5 detail (Location), several cells including tie cells
        for s, ci, cj in [(0.05, 0, 0), (1, 3, 0), (0.5, 5, -1), (0.25, -3, 2), (0.1, 0, 0)]:
            ref = Counter(x["Location"] for x in withxy if js_round(x["lat"] / s) == ci and js_round(x["lon"] / s) == cj)
            lo0, lo1 = (cj - 0.5) * s, (cj + 0.5) * s
            la0, la1 = (ci - 0.5) * s, (ci + 0.5) * s
            got = Counter()
            for x in T.detail_rows((la0, la1, lo0, lo1)):
                if js_round(x["Latitude"] / s) == ci and js_round(x["Longitude"] / s) == cj:
                    got[x["Location"]] += x["__n"]
            top = lambda c: sorted(c.items(), key=lambda kv: (-kv[1], str(kv[0])))[:5]
            ck(ref == got and top(ref) == top(got), f"bin-equality s={s} cell=({ci},{cj}) top-5 identical ({sum(ref.values())} rows)")

        # 5. TRUNC_MONTH timeline and 6. date range (level 1)
        ref = Counter(x["Month"] for x in withxy)
        got = Counter()
        for x in T.level_rows(1):
            got[x["Month"]] += x["__n"]
        ck(ref == got, "timeline by month identical")
        ref = sum(1 for x in withxy if "2024-02-01" <= x["Month"] <= "2024-03-01" and x["Reported by"] != "British Transport Police")
        got = sum(x["__n"] for x in T.level_rows(2) if "2024-02-01" <= x["Month"] <= "2024-03-01" and x["Reported by"] != "British Transport Police")
        ck(ref == got and ref > 1000, f"date range + scope filter identical ({ref})")

        # 7. scope split over the whole table
        def scope(r):
            return "no coords" if r["lat"] is None or r["lon"] is None else ("btp" if r["Reported by"] == "British Transport Police" else "in scope")
        ref = Counter(scope(x) for x in raw)
        got = Counter()
        for x in T.null_rows():
            got["no coords"] += x["__n"]
        for x in T.level_rows(0):
            got["btp" if x["Reported by"] == "British Transport Police" else "in scope"] += x["__n"]
        ck(ref == got, f"scope split identical {dict(ref)}")

        # 8. qValues / null dims survive
        ref = Counter(x["Crime type"] for x in raw)
        got = Counter()
        for x in T.null_rows():
            got[x["Crime type"]] += x["__n"]
        for x in T.level_rows(0):
            got[x["Crime type"]] += x["__n"]
        ck(ref == got, "values of Crime type (commas, quotes, accents) identical over all rows")
        ref = sum(1 for x in withxy if x["LSOA name"] is None)
        got = sum(x["__n"] for x in T.detail_rows() if x["LSOA name"] is None)
        ck(ref == got and ref > 0, f"empty LSOA name stays null ({ref} rows)")

        # 8b. detail grain, bounds, month floor, sizes, determinism
        ref = Counter((x["lat"], x["lon"], x["Crime type"], x["Month"], x["LSOA name"], x["Location"]) for x in withxy)
        got = Counter()
        for x in T.detail_rows():
            got[(x["Latitude"], x["Longitude"], x["Crime type"], x["Month"], x["LSOA name"], x["Location"])] += x["__n"]
        ck(ref == got, f"detail rows identical at snap-point grain ({len(ref)} distinct rows, raw coordinates)")
        la = [x["lat"] for x in withxy]; lo = [x["lon"] for x in withxy]
        ck(man["bounds"] == [min(la), min(lo), max(la), max(lo)], "manifest bounds equal the raw extent")
        allm = {x["Month"] for r_ in (T.level_rows(0), T.detail_rows()) for x in r_}
        ck(all(m.endswith("-01") and len(m) == 10 for m in allm if m), f"--month-floor: every month is the 1st ({sorted(allm)})")
        ck(set(man["sizes"]) == {f[:-8] for dp, _, fs in os.walk(out) for f in [os.path.relpath(os.path.join(dp, g), out).replace(os.sep, "/") for g in fs] if f != "manifest.json"},
           "manifest sizes list every tile file")
        out2 = os.path.join(tmp, "tiles2")
        run("build", "--input", src, *common, "--out", out2)
        same = all(open(os.path.join(dp, g), "rb").read() == open(os.path.join(out2, os.path.relpath(os.path.join(dp, g), out)), "rb").read()
                   for dp, _, fs in os.walk(out) for g in fs if g != "manifest.json")
        ck(same, "a second build is byte-identical (deterministic tiles)")

        # 9. rounding vs JS Math.round on edge values
        rounding_vs_node(tmp)

        # 10. sabotage: half even
        bad = os.path.join(tmp, "tiles_bad")
        r = run("build", "--input", src, *common, "--round-mode", "half-even", "--out", bad)
        sab = battery_grid(Tiles(bad), withxy, S) if r.returncode == 0 else ["build failed"]
        ck(len(sab) > 0, f"SABOTAGE half-even rounding goes RED ({len(sab)} grid mismatches, e.g. {sab[:2]})")

        # 11. sabotage: tamper one tile's __n, delete one tile, drop an extra file
        for what in ("tamper", "delete", "stray"):
            d = os.path.join(tmp, "t_" + what)
            shutil.copytree(out, d)
            lvdir = os.path.join(d, "L3")
            f = sorted(os.listdir(lvdir))[0]
            fp = os.path.join(lvdir, f)
            if what == "tamper":
                doc = json.loads(gzip.open(fp, "rb").read().decode("utf-8"))
                doc["rows"][0][-1] += 1
                gzip.open(fp, "wb").write(json.dumps(doc).encode("utf-8"))
            elif what == "delete":
                os.remove(fp)
            else:
                open(os.path.join(d, "L3", "notes.txt"), "w").write("x")
            r = run("check", d)
            ck(r.returncode != 0 and "RED" in r.stdout, f"SABOTAGE {what} makes check RED")

        # 12. refuses a foreign non-empty output folder
        r = run("build", "--input", src, *common, "--out", data)
        ck(r.returncode != 0, "build refuses an output folder that holds other files")

        # 13. a >4 MB tile is refused by check
        d = os.path.join(tmp, "t_big")
        shutil.copytree(out, d)
        fp = os.path.join(d, "L0", sorted(os.listdir(os.path.join(d, "L0")))[0])
        doc = json.loads(gzip.open(fp, "rb").read().decode("utf-8"))
        rnd = random.Random(1)
        doc["rows"] = [[0.0, 0.0, "2024-01-01", "x%d" % rnd.getrandbits(40), "y%d" % rnd.getrandbits(40), 1] for _ in range(400000)]
        gzip.open(fp, "wb").write(json.dumps(doc).encode("utf-8"))
        ck(os.path.getsize(fp) > 4 * 1048576, "the oversized test tile is over 4 MB (%d bytes)" % os.path.getsize(fp))
        r = run("check", d)
        ck(r.returncode != 0 and "exceeds the 4 MB" in r.stdout, "check refuses a tile over 4 MB")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    bad = [x for x in RES if not x[0]]
    skipped = [x for x in RES if x[1].startswith("SKIP")]
    n = len(RES)
    if n < MIN_CHECKS:
        print(f"RED: only {n} checks ran, minimum is {MIN_CHECKS}")
        return 1
    print(f"\n{'GREEN' if not bad else 'RED'}: {n - len(bad)}/{n} checks passed (minimum {MIN_CHECKS}){'; SKIPPED: ' + str(len(skipped)) if skipped else ''}")
    return 0 if not bad else 1


def battery_grid(T, withxy, S):
    mism = []
    for i, s in enumerate(S):
        ref = Counter((js_round(x["lat"] / s), js_round(x["lon"] / s)) for x in withxy)
        got = Counter()
        for x in T.level_rows(i):
            got[(js_round(x["Latitude"] / s), js_round(x["Longitude"] / s))] += x["__n"]
        if ref != got:
            mism.append(f"s={s}")
    return mism


def rounding_vs_node(tmp):
    import duckdb
    vals = []
    for s in (1, 0.5, 0.25, 0.1, 0.05, 0.025, 0.01):
        for k in range(-40, 41):
            for h in (-0.5, 0.0, 0.5, 0.49999999999999994, -0.49999999999999994):
                vals.append(((k + h) * s, s))
    rnd = random.Random(3)
    for _ in range(3000):
        vals.append((round(rnd.uniform(-9, 9), 6), rnd.choice([1, 0.5, 0.25, 0.1, 0.05, 0.025, 0.01])))
    vals += [(2.5, 1), (-2.5, 1), (0.5, 1), (-0.5, 1), (0.025, 0.05), (0.075, 0.05), (-0.025, 0.05), (1e-300, 1)]
    con = duckdb.connect()
    con.execute("CREATE TABLE v(x DOUBLE, s DOUBLE)")
    con.executemany("INSERT INTO v VALUES (?, ?)", vals)
    # one query per distinct s because bin_sql inlines s as a literal, as the builder does
    got = {}
    for s in sorted({v[1] for v in vals}):
        for x, b in con.execute(f"SELECT x, {bin_sql('x', s)} FROM v WHERE s = {float(s)!r}").fetchall():
            got[(x, s)] = b
    ref_py = {(x, s): js_round(x / s) for x, s in vals}
    ck(all(got[k] == ref_py[k] for k in ref_py), f"SQL bins equal the Python JS-round reference on {len(ref_py)} edge values")
    # half-even must differ somewhere, or the sabotage is not a sabotage
    he = {}
    for s in sorted({v[1] for v in vals}):
        for x, b in con.execute(f"SELECT x, {bin_sql('x', s, 'half-even')} FROM v WHERE s = {float(s)!r}").fetchall():
            he[(x, s)] = b
    ck(any(he[k] != ref_py[k] for k in ref_py), "half-even differs from JS rounding on the edge values (sabotage is real)")
    node = shutil.which("node")
    if not node:
        ck(False, "SKIP node not found: SQL vs real Math.round not run")
        return
    inp = json.dumps([[x, s] for x, s in vals])
    js = "const a=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(a.map(([x,s])=>Math.round(x/s))))"
    r = subprocess.run([node, "-e", js], input=inp, capture_output=True, text=True)
    nodeout = json.loads(r.stdout)
    ok = all(got[(x, s)] == nodeout[i] or (nodeout[i] == 0 and got[(x, s)] == 0) for i, (x, s) in enumerate(vals))
    ck(ok and len(nodeout) == len(vals), f"SQL bins equal node Math.round(x/s) on {len(vals)} values (incl. exact .5 ties, negatives)")


if __name__ == "__main__":
    sys.exit(main())
