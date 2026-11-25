"""Build range-dot sample data: one row per person per week (fake people).

The nine load values per week are chosen so the group's min, 25th, median,
75th and max match the original mockup exactly, with Jordan Reyes in the
slot the mockup gave him.
"""
import csv
import sys
from datetime import date, timedelta

out = sys.argv[1]
weeks = [date(2026, 11, 8) + timedelta(days=7 * i) for i in range(8)]
cap = [40, 40, 24, 40, 40, 40, 32, 40]
jordan = [1.05, 0.98, 1.40, 1.12, 0.88, 0.95, 0.60, 0.40]
team = [  # min, p25, median, p75, max
    [.45, .70, .85, .98, 1.18], [.50, .72, .88, 1.00, 1.21], [.40, .75, .95, 1.20, 1.50], [.48, .70, .86, .99, 1.15],
    [.52, .74, .90, 1.02, 1.25], [.45, .70, .84, .96, 1.12], [.30, .50, .62, .75, .90], [.10, .25, .35, .48, .70]]
others = ["Avery Chen", "Morgan Patel", "Riley Okafor", "Casey Nguyen", "Taylor Brooks", "Sam Rivera", "Jamie Castillo", "Quinn Harper"]
ids = {n: "R%03d" % (101 + i) for i, n in enumerate(["Jordan Reyes"] + others)}

rows = []
for w, wk in enumerate(weeks):
    mn, p25, md, p75, mx = team[w]
    # Sorted slots v0..v8: v0 min, v2 p25, v4 median, v6 p75, v8 max.
    slots = [mn, None, p25, None, md, None, p75, None, mx]
    j = jordan[w]
    # Jordan takes the free odd slot his value falls in.
    js = next(i for i in (1, 3, 5, 7) if slots[i - 1] <= j <= slots[i + 1])
    slots[js] = j
    for i in (1, 3, 5, 7):
        if slots[i] is None:
            lo, hi = slots[i - 1], slots[i + 1]
            slots[i] = round(lo + (hi - lo) * (0.35 + 0.1 * ((w + i) % 4)), 2)
    free = [i for i in range(9) if i != js]
    # Rotate who sits in which slot so people move around week to week.
    order = others[w % 8:] + others[:w % 8]
    order = order[::2] + order[1::2] if w % 2 else order
    people = {"Jordan Reyes": slots[js]}
    for name, i in zip(order, free):
        people[name] = slots[i]
    for name in ["Jordan Reyes"] + others:
        load = people[name]
        rows.append({
            "week_start": wk.isoformat(),
            "resource": name,
            "resource_id": ids[name],
            "resource_pool": "Enterprise Apps - Integration",
            "scheduled_hours": round(load * cap[w], 1),
            "capacity_hours": cap[w],
            "load_pct": load,
            "is_selected": "TRUE" if name == "Jordan Reyes" else "FALSE",
        })

with open(out, "w", newline="", encoding="utf-8") as f:
    wr = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    wr.writeheader()
    wr.writerows(rows)
print(len(rows), "rows")

# Check the stats against the mockup.
def q(s, p):
    h = (len(s) - 1) * p
    lo = int(h)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (h - lo)

for w, wk in enumerate(weeks):
    v = sorted(r["load_pct"] for r in rows if r["week_start"] == wk.isoformat())
    got = [v[0], q(v, .25), q(v, .5), q(v, .75), v[-1]]
    ok = all(abs(a - b) < 1e-9 for a, b in zip(got, team[w]))
    print(wk, "ok" if ok else "MISMATCH %s vs %s" % (got, team[w]))
