#!/usr/bin/env python3
"""ctab_tiles.py: build and check a ctab-tiles v1 package (pre-counted map tiles for a C-Tableau viz page).

    python -P tools/ctab_tiles.py build --input data.csv [more.csv | folder | glob | data.parquet] \
        --datasource "UK Crime" --lat Latitude --lon Longitude \
        --dims "Month:date,Crime type,Reported by" --detail "LSOA name,Location" \
        --levels 1,0.5,0.25,0.1,0.05,0.025,0.01 --tile-for-level "0.025=0.25,0.01=0.25" \
        --detail-tile 0.1 --month-floor Month --out tiles/
    python -P tools/ctab_tiles.py check tiles/

Needs: pip install duckdb.  Format contract: see docs "Big data apps: tile pages".
Rounding: bins are ROUND(x / s) with JavaScript Math.round semantics (half up toward +infinity),
evaluated as x / s in float64, exactly as the viz page's stand-in (vds.js) evaluates ROUND([f] / c).
"""
import argparse, glob, gzip, itertools, json, math, os, re, shutil, statistics, sys, tempfile, time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone

TOOL = "ctab_tiles.py 1.2"
FORMAT_MINOR = 2                   # 1.1: per-level rollups (levels[i].rollups); 1.2: detail rollups (levels[i].drollups) and edge tiles (levels[i].edges); an older reader ignores them
EDGE_TOL = 1e-7                    # a raw row this close (in degrees) to a cell boundary (m + 0.5) * s is an EDGE row
MAX_DIRS = 100                     # the upload API accepts L0..L99 (paths L[0-9]{1,2}/...), so rollup sets take the free L numbers
ROLLUP_KMAX = 4                    # a rollup tile is the level tile x 2^k, k <= 4
MAX_TILE_BYTES = 4 * 1024 * 1024   # C-Tableau's per-object limit (raised from 2 MB on 11/27/2026)
MAX_PACKAGE_BYTES = 300 * 1024 * 1024
MAX_FILES = 20000
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TILE_FILE_RE = re.compile(r"^(-?\d+)_(-?\d+)\.json\.gz$")


def js_round(q):
    """Reference JS Math.round for a float64 q (half up toward +infinity)."""
    f = math.floor(q)
    return f + 1 if (q - f) >= 0.5 else f


def qid(name):
    return '"' + name.replace('"', '""') + '"'


def bin_sql(expr, s, mode="js"):
    """SQL for ROUND(expr / s) as a BIGINT. js: Math.round; half-even: banker's rounding (the sabotage)."""
    q = f"(({expr})::DOUBLE / {float(s)!r}::DOUBLE)"
    if mode == "half-even":
        return f"round_even({q}, 0)::BIGINT"
    return f"(floor({q}) + CASE WHEN {q} - floor({q}) >= 0.5 THEN 1 ELSE 0 END)::BIGINT"


def near_sql(expr, s, tol=EDGE_TOL):
    """SQL: expr lies within tol of a cell boundary (m + 0.5) * s, using the same float64 expr / s as bin_sql."""
    q = f"(({expr})::DOUBLE / {float(s)!r}::DOUBLE)"
    return f"(abs({q} - 0.5 - round({q} - 0.5)) * {float(s)!r}::DOUBLE <= {float(tol)!r}::DOUBLE)"


def near_py(x, s, tol=EDGE_TOL):
    """The same test in Python (the check command and the self-test use it)."""
    t = x / s - 0.5
    return abs(t - math.floor(t + 0.5)) * s <= tol


def fnum(x):
    return float(repr(float(x)))


# ---------------------------------------------------------------- build

def parse_dims(spec):
    out = []
    for part in [p for p in (spec or "").split(",") if p.strip()]:
        name, typ = part, "string"
        if ":" in part:
            head, tail = part.rsplit(":", 1)
            if tail.strip().lower() in ("date", "string"):
                name, typ = head, tail
        out.append({"caption": name.strip(), "type": typ.strip().upper()})
    return out


def expand_inputs(items):
    files = []
    for it in items:
        if os.path.isdir(it):
            files += sorted(glob.glob(os.path.join(it, "**", "*.csv"), recursive=True)) or sorted(glob.glob(os.path.join(it, "**", "*.parquet"), recursive=True))
        elif any(c in it for c in "*?["):
            files += sorted(glob.glob(it, recursive=True))
        else:
            files.append(it)
    files = [f for f in files if os.path.isfile(f)]
    if not files:
        sys.exit("ERROR: no input files found")
    return files


def sizes_summary(sizes):
    return len(sizes), sum(sizes.values())


def make_writer(con, out, sizes):
    """write_tile(rel, cols, rows) writes one gzip tile and records its size; stream(sql, key_n, cols, prefix) runs an ORDER BY tx,ty
    query whose first two columns are the tile key and writes one file per tile. Returns (write_tile, stream)."""
    def write_tile(rel, cols_, rows):
        path = os.path.join(out, rel + ".json.gz")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        payload = json.dumps({"cols": cols_, "rows": rows}, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        with open(path, "wb") as fh:
            with gzip.GzipFile(fileobj=fh, mode="wb", compresslevel=6, mtime=0) as gz:
                gz.write(payload)
        sizes[rel] = os.path.getsize(path)

    def stream(sql, key_n, cols_, prefix):
        cur = con.execute(sql)
        cur_key, buf, ntiles, nrows = None, [], 0, 0
        while True:
            chunk = cur.fetchmany(200000)
            if not chunk:
                break
            for r in chunk:
                k = (r[0], r[1])
                if k != cur_key:
                    if buf:
                        write_tile(f"{prefix}/{cur_key[0]}_{cur_key[1]}", cols_, buf); ntiles += 1
                    cur_key, buf = k, []
                buf.append(list(r[2:]))
                nrows += 1
        if buf:
            write_tile(f"{prefix}/{cur_key[0]}_{cur_key[1]}", cols_, buf); ntiles += 1
        return ntiles, nrows
    return write_tile, stream


def rollup_plan(spec, captions):
    """The dim subsets to roll up, as tuples of captions in manifest order. spec: "auto" (every proper subset when there are at most
    4 dims, fewest dims first), "none", or sets separated by ";" with dims joined by "+" and "{}" for the cell-only set."""
    spec = (spec or "auto").strip()
    if spec == "none":
        return []
    if spec == "auto":
        if len(captions) > 4:
            print(f"rollups: {len(captions)} dims is more than 4, so no automatic rollups (name the sets with --rollups)", flush=True)
            return []
        out = []
        for r in range(len(captions)):
            for combo in itertools.combinations(captions, r):
                out.append(tuple(combo))
        return out
    out = []
    for part in spec.split(";"):
        part = part.strip()
        if not part:
            continue
        names = [] if part == "{}" else [x.strip() for x in part.split("+") if x.strip()]
        bad = [x for x in names if x not in captions]
        if bad:
            sys.exit(f"ERROR: --rollups names {bad}, which are not in --dims")
        t = tuple(c for c in captions if c in names)
        if len(t) == len(captions):
            sys.exit("ERROR: a rollup must drop at least one dim (that set is the level itself)")
        if t not in out:
            out.append(t)
    return out


def _num(x):
    return int(x) if float(x) == int(x) else float(repr(float(x)))


def pick_grid(con, table, tl, tile_rows):
    """The tile size for a rollup-style set held in `table` (clat, clon, ...): the level tile x 2^k, the coarsest k <= ROLLUP_KMAX whose
    fullest tile holds at most tile_rows rows (0: the level's own grid). Returns (T, number of tiles)."""
    k = 0
    if tile_rows and tile_rows > 0:
        for kk in range(ROLLUP_KMAX, -1, -1):
            T = tl * (2 ** kk)
            mx = con.execute(f"SELECT coalesce(max(c), 0) FROM (SELECT count(*) AS c FROM {table} GROUP BY floor(clon / {T!r}::DOUBLE), floor(clat / {T!r}::DOUBLE))").fetchone()[0]
            if mx <= tile_rows or kk == 0:
                k = kk
                break
    T = _num(tl * (2 ** k))
    nfiles = con.execute(f"SELECT count(*) FROM (SELECT DISTINCT floor(clon / {float(T)!r}::DOUBLE), floor(clat / {float(T)!r}::DOUBLE) FROM {table})").fetchone()[0]
    return T, nfiles


def next_free_dir(level_meta):
    """The next unused L number: the levels take L0.., then every rollup, drollup and edge set."""
    n = len(level_meta)
    for lv in level_meta:
        n += len(lv.get("rollups", [])) + len(lv.get("drollups", [])) + (1 if lv.get("edges", {}).get("dir") else 0)
    return n


def build_rollups(con, level_meta, dims, sets, lat, lon, stream, sizes, explicit=False, tile_rows=50000, max_share=0.75):
    """For every level i (table lv<i>: clat, clon, d0.., n), write each rollup set as its own tile set: the level's rows grouped by the kept
    dims with n summed, so every cell keeps its exact count over any filter on the kept dims. A set takes the next free L number (the
    upload API accepts L0..L99). Its tile is the level tile x 2^k, the coarsest k <= ROLLUP_KMAX whose fullest tile holds at most
    tile_rows rows (0: the level's own grid), which keeps the file count low (Andy's package already holds 12,896 of the 20,000 files).
    In auto mode a set holding more than max_share of the level's rows is skipped: it would save too little to earn its files.
    Sets that would pass MAX_FILES or L99 are skipped with a note. Each kept set is listed in level_meta[i]["rollups"]."""
    caps = [d["caption"] for d in dims]
    next_dir = next_free_dir(level_meta)
    for lv in level_meta:
        i, s, tl = lv["i"], float(lv["s"]), float(lv["tile"])
        base_rows = con.execute(f"SELECT count(*) FROM lv{i}").fetchone()[0]
        for keep in sets:
            kc = [f"d{caps.index(c)}" for c in keep]
            ksel = "".join(", " + c for c in kc)
            con.execute("DROP TABLE IF EXISTS ru")
            con.execute(f"CREATE TABLE ru AS SELECT clat, clon{ksel}, sum(n)::BIGINT AS n FROM lv{i} GROUP BY ALL")
            nr = con.execute("SELECT count(*) FROM ru").fetchone()[0]
            label = "+".join(keep) or "{}"
            if not explicit and base_rows and nr > max_share * base_rows:
                print(f"  rollup L{i} [{label}]: {nr:,} rows is over {max_share:.0%} of the level's {base_rows:,}; skipped", flush=True)
                continue
            T, nfiles = pick_grid(con, "ru", tl, tile_rows)
            if next_dir >= MAX_DIRS or len(sizes) + 1 + nfiles > MAX_FILES:
                print(f"  rollup L{i} [{label}]: skipped, the package would pass {MAX_FILES:,} files or L{MAX_DIRS - 1}", flush=True)
                continue
            d = f"L{next_dir}"
            next_dir += 1
            nt, _ = stream(f"SELECT floor(clon / {float(T)!r}::DOUBLE)::BIGINT AS tx, floor(clat / {float(T)!r}::DOUBLE)::BIGINT AS ty, clat, clon{ksel}, n FROM ru ORDER BY ALL",
                           2, [lat, lon] + list(keep) + ["__n"], d)
            lv.setdefault("rollups", []).append({"dir": d, "dims": list(keep), "tile": T, "rows": nr})
            print(f"  rollup L{i} [{label}] -> {d}: {nr:,} rows ({(nr / base_rows if base_rows else 0):.1%} of the level), {nt} tiles of {T} deg", flush=True)
        con.execute("DROP TABLE IF EXISTS ru")


def build_drollups(con, level_meta, dims, detail_dims, lat, lon, stream, sizes, round_mode, d_rows, tile_rows=50000, max_share=0.05):
    """Format 1.2 detail rollups. For every level and every detail dim E, tile sets grouped by the level's cell, E and a subset of the dims
    ({} and each single dim), __n summed, built from the detail rows (table dtab) with the same bin_sql as the level, so a cell holds the
    level's exact count over any filter on the kept dims. A set holding more than max_share of the detail rows is skipped (it would save
    too little to earn its files), and so is one that would pass MAX_FILES or L99. Each kept set is listed in level_meta[i]["drollups"]
    as {dir, dims, detail: [E], tile, rows}."""
    caps = [d["caption"] for d in dims]
    next_dir = next_free_dir(level_meta)
    sets = [()] + [(c,) for c in caps]
    # Priority under the L99 and MAX_FILES caps: smallest set first, across every level, detail dim and kept dim. A set's row count
    # is what it costs in files and bytes, and an app's panel query usually carries a context filter on some dim (Andy's: Reported by),
    # so only an {E}+dim set can answer it; going small first keeps those cheap sets at every level instead of letting a few bulky
    # ones (cell x Location x Month) take the whole budget. Ties keep the level order.
    jobs = []
    for keep in sets:
        for lv in level_meta:
            s_ = float(lv["s"])
            lb_, ob_ = bin_sql("lat", s_, round_mode), bin_sql("lon", s_, round_mode)
            for j, dd in enumerate(detail_dims):
                kc_ = "".join(", " + f"d{caps.index(c)}" for c in keep)
                cnt = con.execute(f"SELECT count(*) FROM (SELECT DISTINCT {lb_}, {ob_}{kc_}, e{j} FROM dtab)").fetchone()[0]
                jobs.append((cnt, lv["i"], keep, lv, j, dd))
    jobs.sort(key=lambda t: (t[0], t[1]))
    for _cnt, _i, keep, lv, j, dd in jobs:
        i, s, tl = lv["i"], float(lv["s"]), float(lv["tile"])
        lb, ob = bin_sql("lat", s, round_mode), bin_sql("lon", s, round_mode)
        kc = [f"d{caps.index(c)}" for c in keep]
        ksel = "".join(", " + c for c in kc)
        con.execute("DROP TABLE IF EXISTS dr")
        con.execute(f"CREATE TABLE dr AS WITH g AS (SELECT {lb} AS la, {ob} AS lo{ksel}, e{j}, sum(n)::BIGINT AS n FROM dtab GROUP BY ALL) "
                    f"SELECT round(la * {s!r}::DOUBLE, 10) AS clat, round(lo * {s!r}::DOUBLE, 10) AS clon{ksel}, e{j}, n FROM g")
        nr = con.execute("SELECT count(*) FROM dr").fetchone()[0]
        label = "+".join(list(keep) + [dd["caption"]])
        if d_rows and nr > max_share * d_rows:
            print(f"  drollup L{i} [{label}]: {nr:,} rows is over {max_share:.0%} of the detail's {d_rows:,}; skipped", flush=True)
            continue
        T, nfiles = pick_grid(con, "dr", tl, tile_rows)
        if next_dir >= MAX_DIRS or len(sizes) + 1 + nfiles > MAX_FILES:
            print(f"  drollup L{i} [{label}]: skipped, the package would pass {MAX_FILES:,} files or L{MAX_DIRS - 1}", flush=True)
            continue
        d = f"L{next_dir}"
        next_dir += 1
        nt, _ = stream(f"SELECT floor(clon / {float(T)!r}::DOUBLE)::BIGINT AS tx, floor(clat / {float(T)!r}::DOUBLE)::BIGINT AS ty, clat, clon{ksel}, e{j}, n FROM dr ORDER BY ALL",
                       2, [lat, lon] + list(keep) + [dd["caption"], "__n"], d)
        lv.setdefault("drollups", []).append({"dir": d, "dims": list(keep), "detail": [dd["caption"]], "tile": T, "rows": nr})
        print(f"  drollup L{i} [{label}] -> {d}: {nr:,} rows ({(nr / d_rows if d_rows else 0):.1%} of the detail), {nt} tiles of {T} deg", flush=True)
    con.execute("DROP TABLE IF EXISTS dr")


def build_edges(con, level_meta, dims, detail_dims, lat, lon, stream, sizes, round_mode, col_names, tol=EDGE_TOL, drop_neg=False):
    """Format 1.2 edge tiles. Per level, every detail row whose lat or lon lies within tol of a cell boundary (m + 0.5) * s is written TWICE
    with every dim and detail column: at its raw coordinates with +n, and at its cell centre with -n, both keyed by the centre's tile
    (the level's tile). A planner that answers a cell-aligned box from the level adds these rows: the -n cancels the level's count of the
    row, the +n puts it back at its raw point, where the real comparison keeps or drops it. Listed in level_meta[i]["edges"] as
    {dir, tile, rows} (rows: 0 and no dir when the level has none). drop_neg exists only so the self-test can prove the -n half matters."""
    next_dir = next_free_dir(level_meta)
    asel = ", ".join([f"d{k}" for k in range(len(dims))] + [f"e{k}" for k in range(len(detail_dims))])
    asel = (", " + asel) if asel else ""
    for lv in level_meta:
        i, s, tl = lv["i"], float(lv["s"]), float(lv["tile"])
        lb, ob = bin_sql("lat", s, round_mode), bin_sql("lon", s, round_mode)
        con.execute("DROP TABLE IF EXISTS ed")
        con.execute(f"CREATE TABLE ed AS SELECT lat, lon{asel}, n, {lb} AS la, {ob} AS lo FROM dtab WHERE {near_sql('lat', s, tol)} OR {near_sql('lon', s, tol)}")
        nr = con.execute("SELECT count(*) FROM ed").fetchone()[0]
        if nr == 0:
            lv["edges"] = {"rows": 0}
            print(f"  edges L{i}: none", flush=True)
            continue
        nfiles = con.execute(f"SELECT count(*) FROM (SELECT DISTINCT floor(round(lo * {s!r}::DOUBLE, 10) / {tl!r}::DOUBLE), floor(round(la * {s!r}::DOUBLE, 10) / {tl!r}::DOUBLE) FROM ed)").fetchone()[0]
        if next_dir >= MAX_DIRS or len(sizes) + 1 + nfiles > MAX_FILES:   # both halves of a pair are keyed by the centre, so files = centre tiles
            print(f"  edges L{i}: skipped, the package would pass {MAX_FILES:,} files or L{MAX_DIRS - 1} (this level keeps answering boxes from detail tiles)", flush=True)
            continue
        c = f"round(la * {s!r}::DOUBLE, 10)", f"round(lo * {s!r}::DOUBLE, 10)"
        neg = "" if drop_neg else f" UNION ALL SELECT {c[0]}, {c[1]}, {c[0]}, {c[1]}{asel}, -n FROM ed"
        d = f"L{next_dir}"
        next_dir += 1
        nt, _ = stream(f"SELECT floor(clon / {tl!r}::DOUBLE)::BIGINT AS tx, floor(clat / {tl!r}::DOUBLE)::BIGINT AS ty, lat, lon{asel}, n FROM "
                       f"(SELECT {c[0]} AS clat, {c[1]} AS clon, lat, lon{asel}, n FROM ed{neg}) ORDER BY ALL", 2, col_names, d)
        lv["edges"] = {"dir": d, "tile": lv["tile"], "rows": nr * (1 if drop_neg else 2)}
        print(f"  edges L{i} -> {d}: {nr:,} boundary rows x2, {nt} tiles of {tl} deg", flush=True)
    con.execute("DROP TABLE IF EXISTS ed")


def cmd_build(a):
    import duckdb
    t0 = time.time()
    files = expand_inputs(a.input)
    ext = {os.path.splitext(f)[1].lower() for f in files}
    if len(ext) != 1 or ext - {".csv", ".parquet"}:
        sys.exit("ERROR: inputs must be all .csv or all .parquet, got %s" % sorted(ext))
    levels_s = [float(x) for x in a.levels.split(",")]
    if len(set(levels_s)) != len(levels_s):
        sys.exit("ERROR: duplicate level")
    tile_for = {}
    for part in [p for p in (a.tile_for_level or "").split(",") if p.strip()]:
        k, _, v = part.partition("=")
        tile_for[float(k)] = float(v)
    for k in tile_for:
        if k not in levels_s:
            sys.exit(f"ERROR: --tile-for-level names {k}, which is not in --levels")
    dims = parse_dims(a.dims)
    detail_dims = [{"caption": c.strip(), "type": "STRING"} for c in (a.detail or "").split(",") if c.strip()]
    for d in dims:
        if d["type"] not in ("DATE", "STRING"):
            sys.exit("ERROR: dim type must be date or string")
    mf = a.month_floor
    if mf and mf not in [d["caption"] for d in dims if d["type"] == "DATE"]:
        sys.exit("ERROR: --month-floor must name a date dim")
    names = [d["caption"] for d in dims + detail_dims]
    if len(set(names + [a.lat, a.lon])) != len(names) + 2:
        sys.exit("ERROR: duplicate caption among lat, lon, dims, detail")

    out = os.path.abspath(a.out)
    if os.path.exists(out) and os.listdir(out):
        allowed = {"manifest.json", "null", "D"}
        if not all(n in allowed or re.fullmatch(r"L\d+", n) for n in os.listdir(out)):
            sys.exit(f"ERROR: {out} holds files that are not a tile package; use an empty folder")
        for n in os.listdir(out):
            shutil.rmtree(os.path.join(out, n)) if os.path.isdir(os.path.join(out, n)) else os.remove(os.path.join(out, n))
    os.makedirs(out, exist_ok=True)

    work = tempfile.mkdtemp(prefix="ctab_tiles_")
    con = duckdb.connect(os.path.join(work, "work.duckdb"))
    con.execute(f"SET temp_directory='{work.replace(chr(92), '/')}'")
    # DuckDB's own default is 80% of the machine's RAM; a 60M-row build took 9 GB on a shared box on 11/28/2026. Cap it and let it
    # spill to the work folder instead (same answers, a little slower).
    if a.memory_limit and a.memory_limit.lower() != "none":
        con.execute(f"SET memory_limit='{a.memory_limit}'")
    flist = "[" + ",".join("'" + f.replace("\\", "/").replace("'", "''") + "'" for f in files) + "]"
    if ext == {".csv"}:
        reader = f"read_csv({flist}, header=true, all_varchar=true, union_by_name=true, quote='\"', escape='\"')"
    else:
        reader = f"read_parquet({flist}, union_by_name=true)"
    cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {reader} LIMIT 0").fetchall()]
    missing = [c for c in [a.lat, a.lon] + names if c not in cols]
    if missing:
        sys.exit(f"ERROR: columns not found in the input: {missing}. Available: {cols}")

    def cast_txt(c):
        return f"NULLIF(TRIM(CAST({qid(c)} AS VARCHAR)), '')"

    sel = [f"try_cast({cast_txt(a.lat)} AS DOUBLE) AS lat", f"try_cast({cast_txt(a.lon)} AS DOUBLE) AS lon"]
    bad_checks = [(a.lat, f"({cast_txt(a.lat)} IS NOT NULL AND try_cast({cast_txt(a.lat)} AS DOUBLE) IS NULL)"),
                  (a.lon, f"({cast_txt(a.lon)} IS NOT NULL AND try_cast({cast_txt(a.lon)} AS DOUBLE) IS NULL)")]
    for i, d in enumerate(dims):
        c = d["caption"]
        if d["type"] == "DATE":
            t = cast_txt(c)
            dexpr = f"try_cast(CASE WHEN regexp_matches({t}, '^\\d{{4}}-\\d{{2}}$') THEN {t} || '-01' ELSE {t} END AS DATE)"
            if c == mf:
                dexpr = f"date_trunc('month', {dexpr})"
            sel.append(f"strftime({dexpr}, '%Y-%m-%d') AS d{i}")
            bad_checks.append((c, f"({t} IS NOT NULL AND {dexpr} IS NULL)"))
        else:
            sel.append(f"{cast_txt(c)} AS d{i}")
    for j, d in enumerate(detail_dims):
        sel.append(f"{cast_txt(d['caption'])} AS e{j}")
    con.execute(f"CREATE TABLE src AS SELECT {', '.join(sel)} FROM {reader}")
    total = con.execute("SELECT count(*) FROM src").fetchone()[0]
    for c, cond in bad_checks:
        # evaluate on the raw reader, bounded cost: one pass each
        n = con.execute(f"SELECT count(*) FROM {reader} WHERE {cond}").fetchone()[0]
        if n:
            sys.exit(f"ERROR: {n} rows have a value in {c!r} that is not a valid {'number' if c in (a.lat, a.lon) else 'date'}")
    print(f"loaded {total:,} rows from {len(files)} files in {time.time()-t0:.0f}s", flush=True)
    if total == 0:
        sys.exit("ERROR: zero rows")

    dcols = [f"d{i}" for i in range(len(dims))]
    ecols = [f"e{j}" for j in range(len(detail_dims))]
    col_names = [a.lat, a.lon] + [d["caption"] for d in dims] + ["__n"]
    dcol_names = [a.lat, a.lon] + [d["caption"] for d in dims + detail_dims] + ["__n"]
    sizes = {}
    stats = {}

    write_tile, stream = make_writer(con, out, sizes)

    # null rows: aggregated over the dims only
    dsel = ", ".join(dcols)
    nsql = f"SELECT NULL::DOUBLE AS lat, NULL::DOUBLE AS lon{(', ' + dsel) if dcols else ''}, count(*) AS n FROM src WHERE lat IS NULL OR lon IS NULL GROUP BY ALL ORDER BY ALL"
    nrows_null = con.execute(f"SELECT count(*) FROM src WHERE lat IS NULL OR lon IS NULL").fetchone()[0]
    rows = [list(r) for r in con.execute(nsql).fetchall()]
    write_tile("null/0", col_names, rows)

    level_meta = []
    for i, s in enumerate(levels_s):
        tl = tile_for.get(s, a.tile)
        lb, ob = bin_sql("lat", s, a.round_mode), bin_sql("lon", s, a.round_mode)
        # the level is kept as a table (lv<i>) so its rollups are re-aggregated from exactly these rows
        con.execute(f"CREATE TABLE lv{i} AS WITH g AS (SELECT {lb} AS la, {ob} AS lo{(', ' + dsel) if dcols else ''}, count(*) AS n FROM src "
                    f"WHERE lat IS NOT NULL AND lon IS NOT NULL GROUP BY ALL) "
                    f"SELECT round(la * {s!r}::DOUBLE, 10) AS clat, round(lo * {s!r}::DOUBLE, 10) AS clon{(', ' + dsel) if dcols else ''}, n FROM g")
        sql = (f"SELECT floor(clon / {tl!r}::DOUBLE)::BIGINT AS tx, floor(clat / {tl!r}::DOUBLE)::BIGINT AS ty, clat, clon{(', ' + dsel) if dcols else ''}, n FROM lv{i} ORDER BY ALL")
        t1 = time.time()
        nt, nr = stream(sql, 2, col_names, f"L{i}")
        level_meta.append({"i": i, "s": s if s != int(s) else int(s), "tile": tl if tl != int(tl) else int(tl)})
        stats[f"L{i}"] = (nt, nr)
        print(f"level {i} s={s}: {nr:,} rows, {nt} tiles, {time.time()-t1:.0f}s", flush=True)

    dt = a.detail_tile
    allcols = dcols + ecols
    asel = ", ".join(allcols)
    # the detail rows are kept as a table (dtab) so the detail rollups and the edge sets are cut from exactly these rows
    con.execute(f"CREATE TABLE dtab AS SELECT lat, lon{(', ' + asel) if allcols else ''}, count(*) AS n FROM src WHERE lat IS NOT NULL AND lon IS NOT NULL GROUP BY ALL")
    sql = f"SELECT floor(lon / {dt!r}::DOUBLE)::BIGINT AS tx, floor(lat / {dt!r}::DOUBLE)::BIGINT AS ty, lat, lon{(', ' + asel) if allcols else ''}, n FROM dtab ORDER BY ALL"
    t1 = time.time()
    nt, nr = stream(sql, 2, dcol_names, "D")
    stats["D"] = (nt, nr)
    print(f"detail: {nr:,} rows, {nt} tiles, {time.time()-t1:.0f}s", flush=True)

    # rollups: per level, tile sets that drop dims (summing __n), so a query that never names a dim loads far fewer bytes
    rollup_sets = rollup_plan(a.rollups, [d["caption"] for d in dims])
    build_rollups(con, level_meta, dims, rollup_sets, a.lat, a.lon, stream, sizes, explicit=a.rollups not in ("auto", "none"),
                  tile_rows=a.rollup_tile_rows, max_share=a.rollup_max_share)

    # edge tiles (format 1.2): the raw rows that sit on a cell boundary, so a cell-aligned box is answered exactly from a level
    build_edges(con, level_meta, dims, detail_dims, a.lat, a.lon, stream, sizes, a.round_mode, dcol_names, tol=a.edge_tol, drop_neg=a.edge_drop_neg)
    # detail rollups (format 1.2): a query that names a detail field, answered at a level's grid
    if detail_dims and a.drollups != "none":
        build_drollups(con, level_meta, dims, detail_dims, a.lat, a.lon, stream, sizes, a.round_mode, nr, tile_rows=a.rollup_tile_rows, max_share=a.drollup_max_share)

    b = con.execute("SELECT min(lat), min(lon), max(lat), max(lon) FROM src WHERE lat IS NOT NULL AND lon IS NOT NULL").fetchone()
    manifest = {"format": "ctab-tiles", "version": 1, "minor": FORMAT_MINOR, "datasource": a.datasource, "lat": a.lat, "lon": a.lon,
                "dims": dims, "detail_dims": detail_dims, "levels": level_meta,
                "detail": {"tile": dt if dt != int(dt) else int(dt)}, "rows": total,
                "bounds": [fnum(x) for x in b] if b[0] is not None else None,
                "built": datetime.now(timezone.utc).isoformat(timespec="seconds"), "tool": TOOL,
                "sizes": dict(sorted(sizes.items()))}
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, separators=(",", ":"))
    con.close()
    shutil.rmtree(work, ignore_errors=True)
    nfiles, nbytes = len(sizes) + 1, sum(sizes.values())
    print(f"built {nfiles} files, {nbytes/1048576:.1f} MB gzip in {time.time()-t0:.0f}s -> {out}")
    big = [k for k, v in sizes.items() if v > MAX_TILE_BYTES]
    if big:
        print(f"WARNING: {len(big)} tiles exceed 4 MB (e.g. {big[0]}); rebuild with a smaller --tile-for-level / --detail-tile", file=sys.stderr)
    return 0


# ---------------------------------------------------------------- check

def _check_file(args):
    """Validate one tile file. Returns (rel, bytes, rows, sumn, errors, ext, cells). kinds: null, L (a level, rollup or detail rollup),
    D (detail), E (an edge set: signed __n, every +n row within EDGE_TOL of a boundary, every -n row at its cell centre, each cell's rows net 0).
    For D, ext also carries, per level that has edges, [rows, sum n] of the rows within EDGE_TOL of a boundary (the edge set must hold them all)."""
    root, rel, kind, i, s, tile, expect_cols, ndims, dim_types, latc, lonc = args[:11]
    edge_levels = args[11] if len(args) > 11 else []
    path = os.path.join(root, rel.replace("/", os.sep) + ".json.gz")
    errs, sumn, nrows = [], 0, 0
    ext = [None, None, None, None] + [[0, 0] for _ in edge_levels]  # minlat minlon maxlat maxlon (detail), then edge-level near counts
    net = {} if kind == "E" else None
    cells = {} if kind == "L" else None   # (lat, lon) -> sum(__n): a rollup must hold exactly its level's count in every cell
    size = os.path.getsize(path)
    try:
        with gzip.open(path, "rb") as fh:
            doc = json.loads(fh.read().decode("utf-8"))
    except Exception as e:
        return rel, size, 0, 0, [f"{rel}: does not parse ({e})"], ext, cells
    if not isinstance(doc, dict) or doc.get("cols") != expect_cols or not isinstance(doc.get("rows"), list):
        return rel, size, 0, 0, [f"{rel}: cols are {doc.get('cols') if isinstance(doc, dict) else '?'}, expected {expect_cols}"], ext, cells
    if size > MAX_TILE_BYTES:
        errs.append(f"{rel}: {size/1048576:.2f} MB exceeds the 4 MB per-object limit")
    m = TILE_FILE_RE.match(os.path.basename(path)) if kind != "null" else None
    tx = int(m.group(1)) if m else None
    ty = int(m.group(2)) if m else None
    ncol = len(expect_cols)
    for r in doc["rows"]:
        nrows += 1
        if len(errs) >= 5:
            break
        if not isinstance(r, list) or len(r) != ncol:
            errs.append(f"{rel}: bad row {str(r)[:80]}"); continue
        n = r[-1]
        if not isinstance(n, int) or isinstance(n, bool) or (n == 0 if kind == "E" else n < 1):
            errs.append(f"{rel}: bad __n {n!r}"); continue
        sumn += n
        la, lo = r[0], r[1]
        for k, t in enumerate(dim_types):
            v = r[2 + k]
            if t == "DATE" and v is not None and not (isinstance(v, str) and DATE_RE.match(v)):
                errs.append(f"{rel}: date not YYYY-MM-DD: {v!r}")
        if kind == "null":
            if la is not None or lo is not None:
                errs.append(f"{rel}: null tile holds coordinates")
            continue
        if not isinstance(la, (int, float)) or not isinstance(lo, (int, float)) or isinstance(la, bool) or isinstance(lo, bool):
            errs.append(f"{rel}: null or non-numeric coordinate in a coordinate tile"); continue
        if kind == "L":
            ba, bo = js_round(la / s), js_round(lo / s)
            if round(ba * s, 10) != la or round(bo * s, 10) != lo:
                errs.append(f"{rel}: ({la},{lo}) is not a cell centre of s={s}"); continue
            cells[(la, lo)] = cells.get((la, lo), 0) + n
        if kind == "E":
            cla, clo = round(js_round(la / s) * s, 10), round(js_round(lo / s) * s, 10)
            if math.floor(clo / tile) != tx or math.floor(cla / tile) != ty:
                errs.append(f"{rel}: row ({la},{lo}) belongs to another tile (edge tiles are keyed by the cell centre)")
            if n > 0 and not (near_py(la, s) or near_py(lo, s)):
                errs.append(f"{rel}: +{n} row ({la},{lo}) is not within {EDGE_TOL} of a cell boundary")
            if n < 0 and (la, lo) != (cla, clo):
                errs.append(f"{rel}: {n} row ({la},{lo}) is not at its cell centre ({cla},{clo})")
            key = (cla, clo, tuple(r[2:-1]))
            net[key] = net.get(key, 0) + n
            continue
        if math.floor(lo / tile) != tx or math.floor(la / tile) != ty:
            errs.append(f"{rel}: row ({la},{lo}) belongs to another tile")
        if kind == "D":
            for k, (_, es) in enumerate(edge_levels):
                if near_py(la, es) or near_py(lo, es):
                    ext[4 + k][0] += 1; ext[4 + k][1] += n
            ext[0] = la if ext[0] is None or la < ext[0] else ext[0]
            ext[1] = lo if ext[1] is None or lo < ext[1] else ext[1]
            ext[2] = la if ext[2] is None or la > ext[2] else ext[2]
            ext[3] = lo if ext[3] is None or lo > ext[3] else ext[3]
    if kind == "E" and not errs:
        bad = [k for k, v in net.items() if v != 0]
        if bad:
            errs.append(f"{rel}: {len(bad)} cells whose edge rows do not net to zero (e.g. {bad[0][:2]} nets {net[bad[0]]})")
    return rel, size, nrows, sumn, errs, ext, cells


def cmd_check(a):
    root = os.path.abspath(a.dir)
    results = []

    def chk(ok, label, detail=""):
        results.append((bool(ok), label, detail))
        if not ok:
            print(f"  RED  {label} {detail}")

    mp = os.path.join(root, "manifest.json")
    if not os.path.isfile(mp):
        print("RED: no manifest.json"); return 1
    man = json.load(open(mp, encoding="utf-8"))
    chk(man.get("format") == "ctab-tiles" and man.get("version") == 1 and man.get("minor", 0) in (0, 1, 2), "manifest format/version (1.0, 1.1 or 1.2)")
    for key in ("datasource", "lat", "lon", "dims", "detail_dims", "levels", "detail", "rows", "bounds", "built", "tool"):
        chk(key in man, f"manifest has {key}")
    levels = man["levels"]
    dims, ddims = man["dims"], man["detail_dims"]
    chk([l["i"] for l in levels] == list(range(len(levels))) and len(levels) > 0, "levels numbered 0..n-1")
    chk(all(d["type"] in ("DATE", "STRING") for d in dims + ddims), "dim types are DATE or STRING")
    caps = [man["lat"], man["lon"]] + [d["caption"] for d in dims + ddims]
    chk(len(set(caps)) == len(caps), "captions unique")
    cols = [man["lat"], man["lon"]] + [d["caption"] for d in dims] + ["__n"]
    dcols = [man["lat"], man["lon"]] + [d["caption"] for d in dims + ddims] + ["__n"]
    dim_types = [d["type"] for d in dims]
    ddim_types = dim_types + ["STRING"] * len(ddims)
    # rollup sets (format 1.1): dir -> (level, kept dims, tile). Each is a proper subset of the dims, in manifest order, on its own L number.
    rolls, dim_caps = {}, [d["caption"] for d in dims]
    for lv in levels:
        for ru in lv.get("rollups") or []:
            d, keep = ru.get("dir"), ru.get("dims")
            ok = (isinstance(d, str) and re.fullmatch(r"L\d{1,2}", d) and int(d[1:]) >= len(levels) and d not in rolls and isinstance(keep, list)
                  and keep == [c for c in dim_caps if c in keep] and len(keep) < len(dim_caps) and isinstance(ru.get("tile"), (int, float)) and ru["tile"] > 0)
            chk(ok, f"rollup {d} of L{lv['i']} is well formed", str(ru)[:120])
            if ok:
                rolls[d] = (lv, keep, float(ru["tile"]))

    # detail rollups and edge sets (format 1.2). A drollup: a proper subset of the dims plus ONE detail dim. An edge set: one per level at most.
    drolls, edges, edge_info = {}, {}, []
    ddim_caps = [d["caption"] for d in ddims]
    used = set(rolls) | {f"L{lv['i']}" for lv in levels}
    for lv in levels:
        for ru in lv.get("drollups") or []:
            d, keep, det = ru.get("dir"), ru.get("dims"), ru.get("detail")
            ok = (isinstance(d, str) and re.fullmatch(r"L\d{1,2}", d) and int(d[1:]) >= len(levels) and d not in used and isinstance(keep, list)
                  and keep == [c for c in dim_caps if c in keep] and len(keep) < len(dim_caps) + 1 and isinstance(det, list) and len(det) == 1 and det[0] in ddim_caps
                  and isinstance(ru.get("tile"), (int, float)) and ru["tile"] > 0 and isinstance(ru.get("rows"), int) and ru["rows"] > 0)
            chk(ok, f"drollup {d} of L{lv['i']} is well formed", str(ru)[:120])
            if ok:
                used.add(d)
                drolls[d] = (lv, keep, det[0], float(ru["tile"]), ru["rows"])
        ed = lv.get("edges")
        if "edges" in lv:
            ok = isinstance(ed, dict) and isinstance(ed.get("rows"), int) and ed["rows"] >= 0 and (
                (ed["rows"] == 0 and "dir" not in ed) or (ed["rows"] > 0 and ed["rows"] % 2 == 0 and isinstance(ed.get("dir"), str) and re.fullmatch(r"L\d{1,2}", ed["dir"])
                 and int(ed["dir"][1:]) >= len(levels) and ed["dir"] not in used and isinstance(ed.get("tile"), (int, float)) and ed["tile"] > 0))
            chk(ok, f"edges of L{lv['i']} are well formed", str(ed)[:120])
            if ok:
                edge_info.append((lv, ed.get("dir"), ed["rows"]))
                if ed["rows"] > 0:
                    used.add(ed["dir"])
                    edges[ed["dir"]] = (lv, float(ed["tile"]), ed["rows"])
    edge_levels = [(f"L{lv['i']}", float(lv["s"])) for lv, _, _ in edge_info]

    # inventory: every file on disk is a known tile, and every manifest size matches
    on_disk = {}
    for dp, _, fs in os.walk(root):
        for f in fs:
            full = os.path.join(dp, f)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if rel != "manifest.json":
                on_disk[rel] = os.path.getsize(full)
    jobs, unknown = [], []
    for rel in on_disk:
        base = rel[:-len(".json.gz")] if rel.endswith(".json.gz") else None
        parts = rel.split("/")
        if base is None or len(parts) != 2:
            unknown.append(rel); continue
        d, fn = parts
        if d == "null" and fn == "0.json.gz":
            jobs.append((root, base, "null", None, None, None, cols, len(dims), dim_types, man["lat"], man["lon"]))
        elif d == "D" and TILE_FILE_RE.match(fn):
            jobs.append((root, base, "D", None, None, man["detail"]["tile"], dcols, len(dims), ddim_types, man["lat"], man["lon"], edge_levels))
        elif d in drolls and TILE_FILE_RE.match(fn):
            lv, keep, det, rt, _ = drolls[d]
            jobs.append((root, base, "L", lv["i"], float(lv["s"]), rt, [man["lat"], man["lon"]] + keep + [det, "__n"], len(keep) + 1,
                         [dim_types[dim_caps.index(c)] for c in keep] + ["STRING"], man["lat"], man["lon"]))
        elif d in edges and TILE_FILE_RE.match(fn):
            lv, et, _ = edges[d]
            jobs.append((root, base, "E", lv["i"], float(lv["s"]), et, dcols, len(dims), ddim_types, man["lat"], man["lon"]))
        elif d in rolls and TILE_FILE_RE.match(fn):
            lv, keep, rt = rolls[d]
            jobs.append((root, base, "L", lv["i"], float(lv["s"]), rt, [man["lat"], man["lon"]] + keep + ["__n"], len(keep),
                         [dim_types[dim_caps.index(c)] for c in keep], man["lat"], man["lon"]))
        elif re.fullmatch(r"L\d+", d) and TILE_FILE_RE.match(fn) and int(d[1:]) < len(levels):
            lv = levels[int(d[1:])]
            jobs.append((root, base, "L", lv["i"], float(lv["s"]), float(lv["tile"]), cols, len(dims), dim_types, man["lat"], man["lon"]))
        else:
            unknown.append(rel)
    chk(not unknown, "no unexpected files", str(unknown[:3]))
    chk("null/0.json.gz" in on_disk, "null/0.json.gz exists")
    chk(any(j[2] == "D" for j in jobs) or man["rows"] == 0, "detail tiles exist")
    chk(len(on_disk) + 1 <= MAX_FILES, f"file count {len(on_disk)+1} within {MAX_FILES}")
    lim = int(a.package_limit_mb * 1048576) if getattr(a, 'package_limit_mb', None) else MAX_PACKAGE_BYTES
    chk(sum(on_disk.values()) <= lim, f"package {sum(on_disk.values())/1048576:.1f} MB within {lim/1048576:.0f} MB",
        "(300 MB is the default per-page limit; if C-Tableau raised your account's limit, pass --package-limit-mb with it)")
    if "sizes" in man:
        chk(all(on_disk.get(k + ".json.gz") == v for k, v in man["sizes"].items()) and len(man["sizes"]) == len(on_disk),
            "manifest sizes match the files on disk")

    per = {}  # group -> dict
    errors = []
    keep_cells = {f"L{lv['i']}" for lv, _, _ in rolls.values()} | set(rolls) | {f"L{lv['i']}" for lv, *_ in drolls.values()} | set(drolls)
    with ProcessPoolExecutor(max_workers=min(16, os.cpu_count() or 4)) as ex:
        for rel, size, nrows, sumn, errs, ext, cells in ex.map(_check_file, jobs, chunksize=16):
            g = rel.split("/")[0]
            p = per.setdefault(g, {"sizes": [], "rows": 0, "n": 0, "ext": [None] * 4, "cells": {}})
            p["sizes"].append(size); p["rows"] += nrows; p["n"] += sumn
            if cells and g in keep_cells:
                pc = p["cells"]
                for ck, cn in cells.items():
                    pc[ck] = pc.get(ck, 0) + cn
            if g == "D":
                p.setdefault("near", [[0, 0] for _ in edge_levels])
                for k in range(len(edge_levels)):
                    p["near"][k][0] += ext[4 + k][0]; p["near"][k][1] += ext[4 + k][1]
                for k in range(4):
                    if ext[k] is not None:
                        e = p["ext"][k]
                        p["ext"][k] = ext[k] if e is None else (min(e, ext[k]) if k < 2 else max(e, ext[k]))
            errors += errs
    chk(not errors, f"every tile parses and every row is valid ({len(errors)} problems)", "; ".join(errors[:5]))
    null_n = per.get("null", {"n": 0})["n"]
    for lv in levels:
        g = f"L{lv['i']}"
        n = per.get(g, {"n": 0})["n"]
        chk(n + null_n == man["rows"], f"{g}: sum(__n) {n:,} + null {null_n:,} == rows {man['rows']:,}")
    for d, (lv, keep, rt) in sorted(rolls.items(), key=lambda kv: int(kv[0][1:])):
        rp, lp = per.get(d, {"n": 0, "cells": {}}), per.get(f"L{lv['i']}", {"cells": {}})
        chk(rp["n"] + null_n == man["rows"], f"{d} (L{lv['i']} rollup [{'+'.join(keep) or '{}'}]): sum(__n) {rp['n']:,} + null {null_n:,} == rows {man['rows']:,}")
        chk(rp["cells"] == lp["cells"], f"{d}: every cell holds exactly L{lv['i']}'s count", f"{len(rp['cells']):,} cells vs {len(lp['cells']):,}")
    for d, (lv, keep, det, rt, nrows_m) in sorted(drolls.items(), key=lambda kv: int(kv[0][1:])):
        rp, lp = per.get(d, {"n": 0, "cells": {}, "rows": 0}), per.get(f"L{lv['i']}", {"cells": {}})
        chk(rp["n"] + null_n == man["rows"], f"{d} (L{lv['i']} drollup [{'+'.join(keep + [det])}]): sum(__n) {rp['n']:,} + null {null_n:,} == rows {man['rows']:,}")
        chk(rp["cells"] == lp["cells"], f"{d}: every cell holds exactly L{lv['i']}'s count", f"{len(rp['cells']):,} cells vs {len(lp['cells']):,}")
        chk(rp["rows"] == nrows_m, f"{d}: {rp['rows']:,} rows on disk == {nrows_m:,} listed in the manifest")
    for k, (lv, d, nrows_m) in enumerate(edge_info):   # edge_levels follows the same order; a level with no edge set must have no boundary rows
        ep = per.get(d, {"n": 0, "rows": 0}) if d else {"n": 0, "rows": 0}
        chk(ep["n"] == 0, f"L{lv['i']} edges: signed sum(__n) {ep['n']:,} == 0")
        chk(ep["rows"] == nrows_m, f"L{lv['i']} edges: {ep['rows']:,} rows on disk == {nrows_m:,} listed in the manifest")
        near = per.get("D", {}).get("near", [[0, 0]] * len(edge_info))[k]
        chk(near[0] * 2 == ep["rows"], f"L{lv['i']} edges: hold every detail row within {EDGE_TOL} of a boundary (twice)", f"{near[0]:,} such detail rows x2 vs {ep['rows']:,}")
    dn = per.get("D", {"n": 0})["n"]
    chk(dn + null_n == man["rows"], f"D: sum(__n) {dn:,} + null {null_n:,} == rows {man['rows']:,}")
    if man["bounds"] and "D" in per:
        e = per["D"]["ext"]
        chk(e == man["bounds"], "bounds equal the detail extent", f"{e} vs {man['bounds']}")

    # size table
    print(f"\n{'group':<10}{'tiles':>7}{'rows':>13}{'median KB':>11}{'p95 KB':>9}{'max KB':>9}{'total MB':>10}")
    allb = 0
    order = ["null"] + [f"L{l['i']}" for l in levels] + sorted(set(rolls) | set(drolls) | set(edges), key=lambda d: int(d[1:])) + ["D"]
    for g in order:
        p = per.get(g)
        if not p:
            continue
        kb = sorted(x / 1024 for x in p["sizes"])
        p95 = kb[min(len(kb) - 1, math.ceil(0.95 * len(kb)) - 1)]
        tot = sum(p["sizes"]); allb += tot
        label = g if not g.startswith("L") else (f"{g} s={levels[int(g[1:])]['s']}" if g not in rolls and g not in drolls and g not in edges else
                                                 f"{g} <L{(rolls.get(g) or drolls.get(g) or edges.get(g))[0]['i']}{'e' if g in edges else 'd' if g in drolls else ''}")
        print(f"{label:<10}{len(kb):>7}{p['rows']:>13,}{statistics.median(kb):>11.1f}{p95:>9.1f}{kb[-1]:>9.1f}{tot/1048576:>10.2f}")
    print(f"{'TOTAL':<10}{sum(len(p['sizes']) for p in per.values()):>7}{'':>13}{'':>11}{'':>9}{'':>9}{allb/1048576:>10.2f}")
    bad = [r for r in results if not r[0]]
    print(f"\n{'GREEN' if not bad else 'RED'}: {len(results) - len(bad)}/{len(results)} checks passed, {len(jobs)} tile files examined")
    return 0 if not bad else 1


def main():
    ap = argparse.ArgumentParser(description="Build and check ctab-tiles v1 packages")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--input", nargs="+", required=True)
    b.add_argument("--datasource", required=True)
    b.add_argument("--lat", required=True)
    b.add_argument("--lon", required=True)
    b.add_argument("--dims", default="")
    b.add_argument("--detail", default="")
    b.add_argument("--levels", default="1,0.5,0.25,0.1,0.05,0.025,0.01")
    b.add_argument("--tile", type=float, default=1.0, help="default tile size (degrees) for levels without an override")
    b.add_argument("--tile-for-level", default="")
    b.add_argument("--detail-tile", type=float, default=0.1)
    b.add_argument("--month-floor", default=None)
    b.add_argument("--rollups", default="auto", help='auto (every proper subset of --dims, up to 4 dims), none, or sets like "{};Reported by;Crime type+Reported by"')
    b.add_argument("--rollup-tile-rows", type=int, default=50000, help="most rows per rollup tile when picking its grid (0: the level's own grid)")
    b.add_argument("--rollup-max-share", type=float, default=0.75, help="auto mode skips a rollup holding more than this share of its level's rows")
    b.add_argument("--drollups", choices=["auto", "none"], default="auto", help="detail rollups: per level, tile sets grouped by one detail dim and at most one dim (auto), or none")
    b.add_argument("--drollup-max-share", type=float, default=0.05, help="auto mode skips a detail rollup holding more than this share of the detail rows (a bigger one saves too little next to the detail tiles; on UK Crime, cell x Month x Location was 46%%)")
    b.add_argument("--edge-tol", type=float, default=EDGE_TOL, help="degrees from a cell boundary that make a raw row an edge row (the self-test sets 0 to prove it matters)")
    b.add_argument("--edge-drop-neg", action="store_true", help="self-test only: leave the -n half of every edge pair out (WRONG on purpose)")
    b.add_argument("--round-mode", choices=["js", "half-even"], default="js", help="js is correct; half-even exists only so the self-test can prove it goes RED")
    b.add_argument("--memory-limit", default="4GB", help="DuckDB memory cap for the build, e.g. 4GB or 8GB (none: DuckDB's default of 80%% of RAM); past it DuckDB spills to disk")
    b.add_argument("--out", required=True)
    c = sub.add_parser("check")
    c.add_argument("dir")
    c.add_argument("--package-limit-mb", type=float, default=None, help="your account's per-page tile limit if an admin raised it (default 300)")
    a = ap.parse_args()
    sys.exit(cmd_build(a) if a.cmd == "build" else cmd_check(a))


if __name__ == "__main__":
    main()
