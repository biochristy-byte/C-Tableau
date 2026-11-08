"""Step 1. probe.py <slug> <base-video> <audio-video> [output-name]

Records the pair in the work dir and prints the stretch ratio, which is the
single number that decides how the retime has to be shaped.
"""
import json, os, sys
from common import probe, work, OUTDIR

if len(sys.argv) < 4:
    raise SystemExit(__doc__)

slug, base, audio = sys.argv[1], sys.argv[2], sys.argv[3]
name = sys.argv[4] if len(sys.argv) > 4 else slug

for p in (base, audio):
    if not os.path.exists(p):
        raise SystemExit(f"missing: {p}")

b, a = probe(base), probe(audio)
ratio = a["duration"] / b["duration"]

print(f"BASE   {os.path.basename(base)}")
print(f"       {b['w']}x{b['h']}  {b['fps']}fps  {b['duration']:.3f}s")
print(f"AUDIO  {os.path.basename(audio)}")
print(f"       {a['duration']:.3f}s  audio_stream={a['has_audio']}")
print(f"\nSTRETCH  {ratio:.2f}x   ({a['duration'] - b['duration']:+.2f}s to absorb)")
if ratio > 1.6:
    print("  -> heavy. Open on a long title/target hold, then stretch the STATIC")
    print("     stretches hard and keep the ACTION stretches at 0.6-0.75x.")
elif ratio > 1.0:
    print("  -> mild. Even 0.7-0.9x playback plus one opening hold will cover it.")
else:
    print("  -> base is LONGER than the narration. Trim dead air or speed up >1x.")

if b["w"] % 2 or b["h"] % 2:
    print(f"\n  WARNING: base is {b['w']}x{b['h']}, odd dimension. libx264 will")
    print("  reject it. Add a crop/scale to even numbers in the plan.")

d = work(slug)
out = os.path.join(OUTDIR, name + ".mp4" if not name.endswith(".mp4") else name)
json.dump({"base": base, "audio": audio, "out": out,
           "total": round(a["duration"], 3),
           "base_end": round(b["duration"], 3),
           "w": b["w"], "h": b["h"],
           "title_freeze_t": 0.5, "title_hold": 0.0, "segs": []},
          open(os.path.join(d, "plan.json"), "w", encoding="utf-8"), indent=1)
print(f"\nwrote {os.path.join(d, 'plan.json')} (segs still empty)")
