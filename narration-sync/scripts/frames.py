"""Step 3. frames.py <slug> [--every 1.5 | --times 0.5,1.5,2.5] [--crop W:H:X:Y]
                            [--src out] [--cols 3] [--width 700]

Contact sheets of the BASE video (or --src out for the rendered result) so the
action map can be read. Every frame is pulled with an exact -ss seek, never with
fps=1/N sampling, because fps sampling drifts and has already caused two timing
defects.
"""
import os, sys
from common import run, work, load_plan, probe, even

slug = sys.argv[1]
args = sys.argv[2:]


def opt(flag, default=None):
    return args[args.index(flag) + 1] if flag in args else default


plan = load_plan(slug)
src = plan["out"] if opt("--src") == "out" else plan["base"]
d = work(slug)
tag = "out" if opt("--src") == "out" else "base"
sheetdir = os.path.join(d, "frames_" + tag)
os.makedirs(sheetdir, exist_ok=True)
for f in os.listdir(sheetdir):
    os.remove(os.path.join(sheetdir, f))

dur = probe(src)["duration"]
if opt("--times"):
    times = [float(x) for x in opt("--times").split(",")]
else:
    step = float(opt("--every", 1.5))
    times = [round(t, 3) for t in
             [i * step + step / 3 for i in range(int(dur / step) + 1)] if t < dur - 0.05]

crop = opt("--crop")
width = even(int(opt("--width", 700)))
cols = int(opt("--cols", 3))
vf = (f"crop={crop}," if crop else "") + f"scale={width}:-2"

for i, t in enumerate(times, 1):
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.3f}", "-i", src,
         "-frames:v", "1", "-vf", vf, "-q:v", "3",
         os.path.join(sheetdir, f"f_{i:02d}.jpg")])

rows = 4
per = cols * rows
sheets = []
for s in range(0, len(times), per):
    chunk = times[s:s + per]
    seqdir = os.path.join(sheetdir, "seq")
    os.makedirs(seqdir, exist_ok=True)
    for f in os.listdir(seqdir):
        os.remove(os.path.join(seqdir, f))
    for j, _ in enumerate(chunk, 1):
        src_f = os.path.join(sheetdir, f"f_{s + j:02d}.jpg")
        with open(src_f, "rb") as a, open(os.path.join(seqdir, f"s_{j:02d}.jpg"), "wb") as b:
            b.write(a.read())
    sheet = os.path.join(sheetdir, f"sheet_{s // per + 1}.jpg")
    run(["ffmpeg", "-y", "-v", "error", "-i", os.path.join(seqdir, "s_%02d.jpg"),
         "-vf", f"tile={cols}x{rows}:margin=4:padding=4:color=red", "-q:v", "3", sheet])
    sheets.append((sheet, chunk))

for sheet, chunk in sheets:
    print(sheet)
    print("   reading order left-to-right, top-to-bottom, t =",
          ", ".join(f"{t:.2f}" for t in chunk))
