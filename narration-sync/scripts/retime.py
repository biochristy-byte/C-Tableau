"""Step 5. retime.py <slug>

Renders the plan: an opening freeze, then a list of play/hold segments, then the
narration muxed in and the ASS captions burned. Segment durations must sum to
the narration length exactly; the script refuses to render if they do not.

plan.json shape:
  {"base": "...", "audio": "...", "out": "...", "total": 51.617,
   "base_end": 19.83, "w": 1240, "h": 1074,
   "title_freeze_t": 0.5, "title_hold": 9.6,
   "segs": [["play", 1.2, 3.2, 3.00, "why this cut"],
            ["hold", 19.0, 2.00, "held on the drop"]]}
"""
import os, sys
from common import run, work, load_plan, OUTDIR

slug = sys.argv[1]
plan = load_plan(slug)
d = work(slug)
BASE, AUDIO = plan["base"], plan["audio"]
TOTAL = float(plan["total"])
os.makedirs(OUTDIR, exist_ok=True)

parts = []


def freeze(tag, at, dur):
    png = os.path.join(d, f"{tag}.png")
    out = os.path.join(d, f"{tag}.mp4")
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{at:.3f}", "-i", BASE, "-frames:v", "1", png])
    run(["ffmpeg", "-y", "-v", "error", "-loop", "1", "-t", f"{dur:.3f}", "-i", png,
         "-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "18",
         "-preset", "medium", "-vf", "setsar=1", out])
    return out


hold = float(plan.get("title_hold") or 0)
segs = plan["segs"]
total_planned = hold + sum(float(s[3]) for s in segs)
drift = TOTAL - total_planned
print(f"narration {TOTAL:.3f}s   planned {total_planned:.3f}s   drift {drift:+.3f}s")
if abs(drift) > 0.05:
    raise SystemExit("segment durations must sum to the narration length "
                     f"(off by {drift:+.3f}s). Fix plan.json and rerun.")

if hold > 0:
    parts.append(freeze("p00", float(plan.get("title_freeze_t", 0.5)), hold))
    print(f"  hold  {hold:5.2f}s at base {plan.get('title_freeze_t', 0.5)}  (opening)")

for i, seg in enumerate(segs, 1):
    note = seg[4] if len(seg) > 4 else ""
    if seg[0] == "hold":
        _, atv, _unused, dur = seg[0], float(seg[1]), None, float(seg[3])
        parts.append(freeze(f"p{i:02d}", atv, dur))
        print(f"  hold  {dur:5.2f}s at base {atv:5.2f}          {note}")
        continue
    _, vin, vout, dur = seg[0], float(seg[1]), float(seg[2]), float(seg[3])
    pts = dur / (vout - vin)
    out = os.path.join(d, f"p{i:02d}.mp4")
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{vin:.3f}", "-to", f"{vout:.3f}", "-i", BASE,
         "-an", "-vf", f"setpts={pts:.6f}*PTS,fps=30,setsar=1",
         "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", out])
    parts.append(out)
    flag = "  <-- under 0.35x, check it reads" if 1 / pts < 0.35 else ""
    print(f"  play  base {vin:5.2f}-{vout:5.2f} -> {dur:5.2f}s ({1/pts:.2f}x) {note}{flag}")

lst = os.path.join(d, "list.txt")
open(lst, "w", encoding="utf-8").write(
    "\n".join("file '" + p.replace("\\", "/") + "'" for p in parts) + "\n")
silent = os.path.join(d, "silent.mp4")
run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", silent])

ass = os.path.join(d, f"{slug}.ass")
final = plan["out"]
vf = "[0:v]setsar=1"
if os.path.exists(ass):
    vf = f"[0:v]ass='" + ass.replace("\\", "/").replace(":", "\\:") + "',setsar=1"
run(["ffmpeg", "-y", "-v", "error", "-i", silent, "-i", AUDIO,
     "-filter_complex", vf + "[v]",
     "-map", "[v]", "-map", "1:a:0",
     "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-pix_fmt", "yuv420p",
     "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
     "-movflags", "+faststart", "-shortest", final])

srt = os.path.join(d, f"{slug}.srt")
if os.path.exists(srt):
    dest = os.path.splitext(final)[0] + ".srt"
    open(dest, "w", encoding="utf-8").write(open(srt, encoding="utf-8").read())
    print("->", dest)
print("->", final)
