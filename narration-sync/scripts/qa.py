"""Step 6. qa.py <slug> [--width 620] [--cols 3]

Pulls one frame from the RENDERED file at the midpoint of every caption cue and
tiles them. Each tile therefore shows a caption and the action that is supposed
to be under it, so a mismatch is visible instead of inferred.
"""
import os, re, sys
from common import run, work, load_plan, even

slug = sys.argv[1]
args = sys.argv[2:]


def opt(flag, default):
    return args[args.index(flag) + 1] if flag in args else default


plan = load_plan(slug)
d = work(slug)
final = plan["out"]
if not os.path.exists(final):
    raise SystemExit(f"nothing rendered at {final}")

srt = open(os.path.join(d, f"{slug}.srt"), encoding="utf-8").read()


def sec(s):
    h, m, rest = s.split(":")
    ss, ms = rest.split(",")
    return int(h) * 3600 + int(m) * 60 + int(ss) + int(ms) / 1000


cues = []
for b in [b for b in re.split(r"\n\s*\n", srt.strip()) if b.strip()]:
    rows = b.strip().splitlines()
    a, z = [x.strip() for x in rows[1].split("-->")]
    cues.append(((sec(a) + sec(z)) / 2, " ".join(rows[2:])))

qadir = os.path.join(d, "qa")
os.makedirs(qadir, exist_ok=True)
for f in os.listdir(qadir):
    os.remove(os.path.join(qadir, f))

width = even(int(opt("--width", 620)))
cols = int(opt("--cols", 3))
rows_n = 3
per = cols * rows_n

for i, (t, _) in enumerate(cues, 1):
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.3f}", "-i", final, "-frames:v", "1",
         "-vf", f"scale={width}:-2", "-q:v", "3", os.path.join(qadir, f"q_{i:03d}.jpg")])

for s in range(0, len(cues), per):
    chunk = cues[s:s + per]
    seq = os.path.join(qadir, "seq")
    os.makedirs(seq, exist_ok=True)
    for f in os.listdir(seq):
        os.remove(os.path.join(seq, f))
    for j in range(len(chunk)):
        src = os.path.join(qadir, f"q_{s + j + 1:03d}.jpg")
        with open(src, "rb") as a, open(os.path.join(seq, f"s_{j+1:02d}.jpg"), "wb") as b:
            b.write(a.read())
    sheet = os.path.join(qadir, f"qa_{s // per + 1}.jpg")
    run(["ffmpeg", "-y", "-v", "error", "-i", os.path.join(seq, "s_%02d.jpg"),
         "-vf", f"tile={cols}x{rows_n}:margin=4:padding=4:color=red", "-q:v", "3", sheet])
    print(sheet)
    for k, (t, txt) in enumerate(chunk, 1):
        print(f"   cell {k}: t={t:6.2f}  {txt}")
