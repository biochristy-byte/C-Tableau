"""Step 2. transcribe.py <slug>

faster-whisper (model, device and language from the config; default small on CPU), word timestamps, VAD off (VAD eats the first
syllable of a soft opener). Writes <work>/<slug>.json and prints every segment
with per-word start times, which is what the retime is actually cut against.
"""
import json, os, sys
from faster_whisper import WhisperModel
from common import work, load_plan, CONFIG

slug = sys.argv[1]
plan = load_plan(slug)
d = work(slug)

model = WhisperModel(CONFIG["whisper_model"], device=CONFIG["device"],
                     compute_type=CONFIG["compute_type"])
segments, info = model.transcribe(plan["audio"], word_timestamps=True,
                                  vad_filter=False, language=CONFIG["language"])
data = []
for s in segments:
    data.append({
        "start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip(),
        "words": [{"w": w.word, "s": round(w.start, 3), "e": round(w.end, 3)}
                  for w in (s.words or [])],
    })
    print(f"--- {s.start:6.2f} {s.text.strip()}", flush=True)
    print("   ", " ".join(f"{w.word.strip()}@{w.start:.1f}" for w in (s.words or [])),
          flush=True)

json.dump(data, open(os.path.join(d, f"{slug}.json"), "w", encoding="utf-8"), indent=1)
print(f"\nWROTE {os.path.join(d, slug + '.json')}  ({len(data)} segments)")
print("Read the word times above and pick the CUE WORD for each on-screen action.")
