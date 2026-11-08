"""refresh_extracts.py - rewrite .hyper extracts from CSVs, reusing each extract's schema.

A workbook that reads a .hyper extract does not change on screen when you regenerate its
CSV. Tableau's Data > Refresh Extract does the job by hand; this does it from the command
line so a data change is one command and so a gate can fail.

The schema is READ OUT of the existing extract and reused verbatim: same column names,
same order, same types. A CSV that no longer carries one of those columns is RED, not a
silently narrower extract. Blank CSV cells become NULL, as Tableau's own text scan does.

    python refresh_extracts.py data/sales.csv=extracts/sales.hyper [more pairs ...]
        [--min-rows=N]            RED if any rewritten extract has fewer rows (default 1)
        [--expect-sum=COL=VALUE]  RED if SUM(COL) over every extract that has COL differs
                                  (repeatable); read back out of the .hyper, not the CSV
        [--force]                 run even if Tableau looks open (it holds the .hyper lock)

Each pair is csv=hyper. The extract must already exist (author it once in Tableau).
Exit 0 = GREEN, exit 1 = RED, exit 2 = bad usage.

Requirements: Python 3.9+, pip install tableauhyperapi. Windows, macOS or Linux (the
Tableau-open check uses `tasklist` and is skipped elsewhere).
"""
import csv
import datetime as dt
import os
import shutil
import subprocess
import sys
from pathlib import Path

from tableauhyperapi import (Connection, CreateMode, HyperProcess, Inserter, SqlType,
                             TableDefinition, TableName, Telemetry)


def convert(value, sqltype):
    """CSV text -> the type this column already had. Blank is NULL."""
    v = (value or "").strip()
    if v == "":
        return None
    tag = sqltype.tag
    if tag == SqlType.date().tag:
        return dt.date.fromisoformat(v)
    if tag == SqlType.time().tag:
        h, m = v.split(":")[:2]
        return dt.time(int(h), int(m))
    if tag == SqlType.big_int().tag or tag == SqlType.int().tag or tag == SqlType.small_int().tag:
        return int(float(v))
    if tag == SqlType.double().tag:
        return float(v)
    if tag == SqlType.bool().tag:
        return v.lower() in ("1", "true", "yes", "t")
    return v


def rewrite(hyper, csv_path, out_path, red):
    """Read the schema out of out_path, write csv_path into a fresh file beside it, then
    swap it in. Returns (rows, columns)."""
    with Connection(hyper.endpoint, str(out_path)) as c:
        definition = c.catalog.get_table_definition(c.catalog.get_table_names("Extract")[0])
    cols = [col.name.unescaped for col in definition.columns]
    # the name that comes back is qualified with the OLD database, so rebuild a bare one
    table = TableName("Extract", "Extract")
    definition = TableDefinition(table, definition.columns)

    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    missing = [c for c in cols if rows and c not in rows[0]]
    if missing:
        red.append(f"{csv_path.name} is missing {len(missing)} extract columns: {missing}")
        return rows, cols

    tmp = out_path.parent / (out_path.stem + "_new.hyper")
    if tmp.exists():
        tmp.unlink()
    with Connection(hyper.endpoint, str(tmp), create_mode=CreateMode.CREATE_AND_REPLACE) as c:
        c.catalog.create_schema("Extract")
        c.catalog.create_table(definition)
        with Inserter(c, definition) as ins:
            for r in rows:
                ins.add_row([convert(r[col.name.unescaped], col.type) for col in definition.columns])
            ins.execute()
        written = c.execute_scalar_query(f"SELECT COUNT(*) FROM {table}")
    if written != len(rows):
        red.append(f"{out_path.name}: wrote {written} of {len(rows)} CSV rows")
        return rows, cols
    shutil.move(str(tmp), str(out_path))
    return rows, cols


def tableau_running():
    if os.name != "nt":
        return False
    # plain tasklist, no /FI: Git Bash rewrites a leading-slash argument into a path
    out = subprocess.run(["tasklist"], capture_output=True, text=True).stdout.lower()
    return "tabpublic.exe" in out or "tableau.exe" in out


def main(argv):
    pairs, min_rows, sums, force = [], 1, {}, False
    for a in argv:
        if a == "--force":
            force = True
        elif a.startswith("--min-rows="):
            min_rows = int(a.split("=", 1)[1])
        elif a.startswith("--expect-sum="):
            col, val = a.split("=", 2)[1:]
            sums[col] = float(val)
        elif a.startswith("--"):
            print(__doc__)
            return 2
        elif "=" in a:
            c, h = a.split("=", 1)
            pairs.append((Path(c), Path(h)))
        else:
            print(__doc__)
            return 2
    if not pairs:
        print(__doc__)
        return 2
    if tableau_running() and not force:
        print("Tableau is open and holds the .hyper lock. Close it first, or pass --force.")
        return 2
    for c, h in pairs:
        for p in (c, h):
            if not p.exists():
                print(f"missing {p}")
                return 2
    red, rowcount = [], 0
    with HyperProcess(Telemetry.DO_NOT_SEND_USAGE_DATA_TO_TABLEAU) as hyper:
        for csv_path, hyper_path in pairs:
            rows, cols = rewrite(hyper, csv_path, hyper_path, red)
            rowcount += len(rows)
            print(f"subjects: {hyper_path.name} <- {csv_path.name}, {len(rows)} rows x {len(cols)} columns")
        # read the numbers back OUT of the files just written, not out of the CSVs
        got = {k: 0.0 for k in sums}
        seen = {k: 0 for k in sums}
        for _c, hyper_path in pairs:
            with Connection(hyper.endpoint, str(hyper_path)) as c:
                table = c.catalog.get_table_names("Extract")[0]
                n = c.execute_scalar_query(f"SELECT COUNT(*) FROM {table}")
                if n < min_rows:
                    red.append(f"{hyper_path.name}: {n} rows, under the {min_rows} floor")
                names = {col.name.unescaped for col in c.catalog.get_table_definition(table).columns}
                for col in sums:
                    if col in names:
                        got[col] += c.execute_scalar_query(f'SELECT COALESCE(SUM("{col}"), 0) FROM {table}')
                        seen[col] += 1
        for col, want in sums.items():
            if not seen[col]:
                red.append(f"--expect-sum column {col!r} is in no extract")
            elif abs(got[col] - want) > 1e-9:
                red.append(f"SUM({col}) is {got[col]}, expected {want}")
            else:
                print(f"  SUM({col}) = {got[col]:g} as expected")
    # positive control, below every gate: if this line does not print, nothing above ran
    print(f"control: {len(pairs)} extracts examined, {rowcount} rows total")
    if red:
        print("RED")
        for r in red:
            print("  -", r)
        return 1
    for _c, hyper_path in pairs:
        print(f"GREEN -> {hyper_path} ({os.path.getsize(hyper_path):,} B)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
