"""Step 4. captions.py <slug>

Word timings -> SRT -> ASR fixes -> ASS. Caption geometry is derived from the
BASE video's real resolution so the burn-in size is deterministic instead of
whatever libass guesses.
"""
import json, os, re, sys
from common import work, load_plan, CONFIG

MAXCH = 42          # chars per caption line
MAXDUR = 3.2        # seconds per caption
MINDUR = 0.9

# Text fixes come from the config (asr_fixes, word_fixes); the defaults are empty.
# FIX entries are applied in order, so list the longest phrase first. WORDFIX matches the
# word sequence case-insensitively, ignoring trailing punctuation, before cues are built,
# so a phrase that straddles a cue boundary still gets caught.
FIX = [tuple(p) for p in CONFIG["asr_fixes"]]
WORDFIX = [(list(s), list(d)) for s, d in CONFIG["word_fixes"]]


def ts(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")


def build_srt(slug, d):
    segs = json.load(open(os.path.join(d, f"{slug}.json"), encoding="utf-8"))
    words = []
    for s in segs:
        for w in s["words"]:
            words.append({"w": w["w"].strip(), "s": w["s"], "e": w["e"]})

    def bare(s):
        return s.strip(".,!?;:\"'").lower()

    for src, dst in WORDFIX:
        n = len(src)
        for i in range(len(words) - n + 1):
            if [bare(words[i + k]["w"]) for k in range(n)] != src:
                continue
            for k in range(n):
                old = words[i + k]["w"]
                tail = old[len(old.rstrip(".,!?;:\"'")):]
                rep = dst[k]
                if old[:1].isupper():
                    rep = rep[:1].upper() + rep[1:]
                words[i + k]["w"] = rep + tail
            print(f"  wordfix: {' '.join(src)} -> {' '.join(dst)} @ {words[i]['s']:.2f}s")

    cues, cur = [], []

    def flush():
        if not cur:
            return
        cues.append({"s": cur[0]["s"], "e": cur[-1]["e"],
                     "t": " ".join(x["w"] for x in cur)})
        cur.clear()

    for w in words:
        # whisper splits "system-generated" into "system" + "-generated"; glue it back
        if cur and w["w"].startswith("-"):
            cur[-1]["w"] += w["w"]
            cur[-1]["e"] = w["e"]
            continue
        cand = (" ".join(x["w"] for x in cur) + " " + w["w"]).strip()
        too_long = len(cand) > MAXCH
        too_slow = cur and (w["e"] - cur[0]["s"]) > MAXDUR
        gap = cur and (w["s"] - cur[-1]["e"]) > 0.6
        if cur and (too_long or too_slow or gap):
            flush()
        cur.append(w)
        if w["w"].endswith((".", "?", "!")) and len(" ".join(x["w"] for x in cur)) > 18:
            flush()
    flush()

    for i, c in enumerate(cues):
        if c["e"] - c["s"] < MINDUR:
            c["e"] = c["s"] + MINDUR
        if i + 1 < len(cues) and c["e"] > cues[i + 1]["s"]:
            c["e"] = max(c["s"] + 0.4, cues[i + 1]["s"] - 0.03)

    text = "\n".join(f"{i}\n{ts(c['s'])} --> {ts(c['e'])}\n{c['t']}\n"
                     for i, c in enumerate(cues, 1))
    for a, b in FIX:
        text = text.replace(a, b)
    path = os.path.join(d, f"{slug}.srt")
    open(path, "w", encoding="utf-8").write(text)
    return path, len(cues), text


def header(W, H):
    FONTSIZE = round(H / 31.8)
    MARGIN_V = round(H * 0.143)   # clears LinkedIn's player chrome
    MARGIN_LR = round(W * 0.16)
    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Arial,{FONTSIZE},&H00FFFFFF,&H00FFFFFF,&H4A000000,&H00000000,-1,0,0,0,100,100,0,0,3,6,0,2,{MARGIN_LR},{MARGIN_LR},{MARGIN_V},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def at(s):
    h, m, rest = s.split(":")
    sec, ms = rest.split(",")
    total = int(h) * 3600 + int(m) * 60 + int(sec) + int(ms) / 1000
    return f"{int(total // 3600):d}:{int(total % 3600 // 60):02d}:{total % 60:05.2f}"


slug = sys.argv[1]
plan = load_plan(slug)
d = work(slug)
srt, n, text = build_srt(slug, d)
print(f"{n} cues -> {srt}")

lines = []
for b in [b for b in re.split(r"\n\s*\n", text.strip()) if b.strip()]:
    rows = b.strip().splitlines()
    a, z = [x.strip() for x in rows[1].split("-->")]
    body = " ".join(rows[2:]).strip().replace("{", "(").replace("}", ")")
    lines.append(f"Dialogue: 0,{at(a)},{at(z)},Cap,,0,0,0,,{body}")

ass = os.path.join(d, f"{slug}.ass")
open(ass, "w", encoding="utf-8").write(
    header(plan["w"], plan["h"]) + "\n".join(lines) + "\n")
print(f"wrote {ass}  (PlayRes {plan['w']}x{plan['h']})")
print("\n" + text)
