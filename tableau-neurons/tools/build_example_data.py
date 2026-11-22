"""Build data/celegans-connectome.csv: one row per link (Group, Source, Target, Weight, SourceGroup, TargetGroup).

Inputs (public, MIT-licensed OpenWorm ConnectomeToolbox mirror of published data):
  herm_full_edgelist.csv  Cook et al. 2019, Nature 571:63-71, hermaphrodite chemical synapses
  all_cell_info.csv       WormAtlas cell names and types
  python tools/build_example_data.py <dir with the two files> [min_weight]
Neurons are merged into classes (left/right pairs, numbered sets such as DA1..DA9), synapse counts are summed,
self-links are dropped, and a link is kept when its summed weight is at least min_weight (default 5).
"""
import csv, sys, re, collections, pathlib

src = pathlib.Path(sys.argv[1])
MIN_W = int(sys.argv[2]) if len(sys.argv) > 2 else 5
out = pathlib.Path(__file__).resolve().parent.parent / "data" / "celegans-connectome.csv"

def group_of(t):
    t = t.lower()
    if "muscle" in t or "epithel" in t or "gland" in t or "sheath" in t or "marginal" in t or "structural" in t or "glr" in t or "linker" in t or "canal" in t:
        return None
    if t.startswith("male"):
        return None
    if t.startswith("pharyngeal"):
        return "Pharynx"
    if "motor" in t:
        return "Motor"
    if "interneuron" in t:
        return "Interneuron"
    if any(k in t for k in ("sensory", "amphid", "phasmid", "cephalic", "touch", "o2", "nocicept")):
        return "Sensory"
    return None

cells = {}
for r in csv.DictReader(open(src / "all_cell_info.csv", encoding="utf-8")):
    g = group_of(r["Type"])
    if g: cells[r["Cell name"].strip()] = g

edges = []
for r in csv.DictReader(open(src / "herm_full_edgelist.csv")):
    if r["Type"].strip() != "chemical": continue
    a, b = r["Source"].strip(), r["Target"].strip()
    if a in cells and b in cells: edges.append((a, b, int(r["Weight"])))
names = sorted({x for e in edges for x in e[:2]})

def klass(n):
    base = n
    if len(base) > 2 and base[-1] in "LR" and (base[:-1] + ("R" if base[-1] == "L" else "L")) in names:
        base = base[:-1]
    m = re.match(r"^([A-Za-z]{2,})(\d+)$", base)
    if m:
        sib = {x for x in names if re.match(r"^" + m.group(1) + r"\d+$", x)}
        if len(sib) >= 4: base = m.group(1)
    return base

cls = {n: klass(n) for n in names}
grp = {}
for n in names: grp.setdefault(cls[n], cells[n])
w = collections.Counter()
for a, b, x in edges:
    if cls[a] != cls[b]: w[(cls[a], cls[b])] += x
rows = sorted(((s, t, v) for (s, t), v in w.items() if v >= MIN_W), key=lambda r: (grp[r[0]], r[0], -r[2], r[1]))
used = {x for r in rows for x in r[:2]}
out.parent.mkdir(exist_ok=True)
with open(out, "w", newline="", encoding="utf-8") as f:
    cw = csv.writer(f)
    cw.writerow(["Group", "Source", "Target", "Synapses", "TargetGroup"])
    for s, t, v in rows: cw.writerow([grp[s], s, t, v, grp[t]])
print("neuron classes", len(used), "links", len(rows), "groups", dict(collections.Counter(grp[u] for u in used)), "->", out)
