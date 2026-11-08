---
name: narration-sync
description: Pair a silent screen recording with a separately recorded narration. Retimes the video segment by segment so each on-screen action lands under the words that describe it, burns readable captions, and QAs the result frame by frame. Use when someone hands you a base screen recording plus a voiceover audio file and wants them married into one video.
argument-hint: "<slug> [base-video] [audio-file] [output-name]"
---

# /narration-sync

A person records the screen silently, then records the voiceover separately. The
two never line up: the narration is usually 1.5x to 3x longer than the footage,
because talking about a click takes longer than clicking. The job is to stretch
the footage unevenly so every action sits under its own sentence.

Deliverables land in the configured `out_dir` (default `~/narration-sync-out/`) as a
`.mp4` with burned captions plus a matching `.srt`. Nothing is uploaded or sent
anywhere; delivery is manual.

## Install

Copy this folder to `~/.claude/skills/narration-sync/` to use it as a Claude Code
skill, or run the scripts straight from here. Requirements:

- Python 3.9+, `pip install faster-whisper pillow`
- `ffmpeg` and `ffprobe` on PATH (built and measured against ffmpeg 8.1)

## Config (optional, neutral defaults)

Copy `narration-sync.config.example.json` to `narration-sync.config.json` (same folder
as this file), or point the `NARRATION_SYNC_CONFIG` environment variable at any JSON
file. Every key is optional.

| Key | Default | What it does |
|---|---|---|
| `out_dir` | `~/narration-sync-out` | Where finished videos and the `_work/<slug>/` folders go |
| `asr_fixes` | `[]` | `[["heard", "meant"]]` replacements on the finished caption text. Put the longest phrase first. Use it for proper nouns and product names the speech model keeps missing, and for the speaker's name |
| `word_fixes` | `[]` | `[[["mark","style"],["mark","tile"]]]` fixes on the word sequence before captions are cut, so a phrase that straddles a caption boundary is still caught. Case-insensitive; the replacement keeps the original's capital and trailing punctuation |
| `whisper_model` | `small` | faster-whisper model name |
| `device` | `cpu` | `cpu` or `cuda` |
| `compute_type` | `int8` | faster-whisper compute type |
| `language` | `en` | Spoken language code |

Keep personal names, accents and recurring misheard phrases in your config, not in the scripts.

Scripts live in `scripts/`. Run them from that folder (they import `common.py` as a sibling).

## The six steps

Do them in order. Do not skip step 3 or step 6.

**1. Probe.** Establishes the stretch ratio, which dictates the whole shape.
```
python probe.py <slug> "<base.mp4>" "<audio.mp4>" "Nice-Output-Name"
```
Writes `<out_dir>/_work/<slug>/plan.json` with empty `segs`.

**2. Transcribe.** Word-level timings are the cut list.
```
python transcribe.py <slug>
```
Read the printed word times. For each on-screen action, note the **cue word**:
the exact word said as that action should appear.

**3. Read the footage.** Never guess what is on screen.
```
python frames.py <slug> --every 1.5 --crop 1000:460:140:30 --width 760
```
Look at every sheet. Build an action map: base timestamp -> what happens. Crop to
the viz area when the app chrome wastes the frame. If a boundary matters (exactly
when a menu opens), re-pull it precisely:
```
python frames.py <slug> --times 11.0,11.4,11.8,12.2 --width 900
```

**4. Write the plan.** Edit `segs` in `plan.json` by hand (schema below).
`title_hold` plus every `out_duration` must sum to the narration length.
`retime.py` refuses to render otherwise, so the arithmetic is checked, not trusted.

**5. Captions, then render.**
```
python captions.py <slug>
python retime.py <slug>
```
`captions.py` prints the SRT. Read it. Any ASR miss that survives goes into
`asr_fixes` or `word_fixes` in your config so the next video inherits the fix.

**6. QA.** One frame per caption, tiled, so a mismatch is visible.
```
python qa.py <slug>
```
Look at every sheet. Confirm each caption sits over the action it describes. Fix
`plan.json` and re-render if not. The author is not the first-pass QA: you are.

## plan.json schema

`probe.py` writes everything except `segs` and `title_hold`; you fill those in.

```json
{
  "base": "C:/path/base.mp4",
  "audio": "C:/path/narration.mp4",
  "out": "<out_dir>/Nice-Output-Name.mp4",
  "total": 51.617,
  "base_end": 19.83,
  "w": 1240,
  "h": 1074,
  "title_freeze_t": 0.5,
  "title_hold": 9.6,
  "segs": [
    ["play", 1.2, 3.2, 3.00, "why this cut"],
    ["hold", 19.0, null, 2.00, "held on the drop"]
  ]
}
```

| Field | Meaning |
|---|---|
| `base`, `audio` | Source files. The base video's own audio is always dropped; only the narration audio survives |
| `out` | Final `.mp4`. The `.srt` is written beside it |
| `total` | Narration length in seconds (measured by `probe.py`). The finished video must equal it |
| `base_end` | Base video length in seconds. For reference when choosing `play` ranges |
| `w`, `h` | Base video size. Caption size and margins are derived from `h` and `w`, so the burn-in is deterministic. Both must be even |
| `title_freeze_t` | Base timestamp of the frame frozen for the opening hold (default 0.5) |
| `title_hold` | Seconds the opening frame is held before segment 1. 0 means no opening hold |
| `segs` | Ordered list of segments, below |

Segment kinds. Positions: index 0 kind, 1 base time in, 2 base time out, 3 output
duration, 4 free-text note (printed during render, not used for anything else).

| Kind | Shape | Effect |
|---|---|---|
| `play` | `["play", base_in, base_out, out_duration, "note"]` | Plays base seconds `base_in` to `base_out`, stretched or squeezed to fill `out_duration`. The speed shown is `(base_out - base_in) / out_duration`; `retime.py` flags anything under 0.35x |
| `hold` | `["hold", base_t, null, out_duration, "note"]` | Freezes the frame at `base_t` for `out_duration`. Index 2 is unused and must be present (`null`) |

Rule checked at render time: `title_hold + sum(out_duration) == total` within 0.05 s.

## How to shape the retime

The whole craft is in step 4.

**Open on a hold.** Almost every one of these opens on a title card or a
finished "here is the target" view. Freeze it for the entire intro and release
on the first word that describes an actual action. This absorbs most of the
overrun in one move and it reads as deliberate rather than slow.

**Split the base into ACTION and STATIC stretches.**

| Stretch | Example | Rate |
|---|---|---|
| Action | a drag, a menu opening, a value populating | keep 0.6x to 0.75x |
| Static | finished view, idle cursor, nothing moving | stretch as hard as needed, 0.2x is fine |

Slow motion on a static stretch is invisible. Slow motion on a drag looks broken.
Spend the spare time where nothing is happening. When a stretch is truly frozen,
prefer a hard `hold` over a 0.1x play.

**Cut on the cue word.** Segment boundaries in the output timeline should be the
narration timestamps from step 2, not round numbers. If the speaker says "change
the mark type to square" at 29.2, the dropdown must be opening at 29.2.

**Expect a redraw lag.** Tableau repaints a second after the click. Landing the
payoff on the sentence *after* the instruction is correct, not late.

**Watch for loading screens.** Never land a payoff shot on one; pull the frames
around the boundary and check.

## Standing constraints

- Sans-serif captions only, mid-bottom, above a player's chrome. The ASS style sets
  `MARGIN_V = H * 0.143` (about 14% of the frame height up from the bottom, which
  clears LinkedIn's player controls). Do not lower it.
- Caption font size is `H / 31.8`; side margins are 16% of the width; 42 characters
  per line, 3.2 s per caption at most, 0.9 s at least.
- Base video audio is always stripped; only the narration file's audio survives.
- Fix ASR errors on proper nouns and product names but keep the speaker's wording
  otherwise. Captions match what was said.
- Verify on-screen text before quoting it in copy. If a number cannot be read from
  the footage, say so rather than inventing it.
- Never delete or overwrite a delivered file in `out_dir` without saying so.

## Gotchas

`references/ffmpeg-gotchas.md` has the full list, all of them measured. The four
that cost the most time:

1. `setsar=1` on every input and after every overlay, or libx264 gets an
   off-by-one height and fails.
2. `drawtext` can segfault when fontconfig has no default config. Render text in
   Pillow to PNG instead.
3. `-pattern_type glob` is unsupported on Windows builds. Copy to a `%02d`
   sequence before tiling.
4. Contact sheets built with `fps=1/N` drift. Always exact-seek per frame.
