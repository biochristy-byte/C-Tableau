# Learning from talks and pairing narration with screen recordings

Two repeatable pipelines I built around Tableau content: turning a recorded
talk into lessons, and marrying a silent screen recording to a separately
recorded voiceover for LinkedIn (a pattern from Celia Fryar's Tableau tips).

## A. Turn a recorded talk into house rules

Worked on a 67 minute video in about six minutes.

1. Extract mono 16 kHz audio into a fresh scratch folder:
   `ffmpeg -i talk.mp4 -vn -ac 1 -ar 16000 audio.wav`.
2. Transcribe with `faster-whisper` (large-v3). On an NVIDIA GPU, install the
   `nvidia-cublas-cu12` and `nvidia-cudnn-cu12` wheels and add their `bin`
   folders to the DLL search path in the script, or you get "cublas64_12.dll
   not found". Do not run Python in isolated mode (`-I`) because it hides the
   user-site package.
3. Write the script with an editor tool, not a shell heredoc: a heredoc eats
   backslashes in the DLL paths.
4. Read the WHOLE transcript. The audio alone misses slides; sample frames with
   ffmpeg if the slides matter.
5. Add the lessons to the house-style file as new, numbered rules (append, never
   renumber), and refresh any indexes that point at it.
6. Paraphrase and credit the speaker. Keep a timestamped transcript privately.

Full examples of the output: [iron-viz-design.md](iron-viz-design.md) and
[agent-business-preferences.md](agent-business-preferences.md).

## B. Pairing a silent screen recording with a narration

Problem: the narration is usually 1.5x to 3x longer than the footage because
talking about a click takes longer than clicking. The job is to stretch the
footage unevenly so each action lands under the sentence that describes it.

### Six steps, all scripted

| Step | Script | Output |
|---|---|---|
| 1. Probe | measure both durations | the stretch ratio, which dictates the whole shape; an empty plan file |
| 2. Transcribe | `faster-whisper` word timings | the cut list; note a cue word per on-screen action |
| 3. Read the footage | contact sheets, exact seek per frame | an action map: base timestamp to what happens |
| 4. Write the plan | by hand | segments: `play(in, out, duration)` or `hold(t, duration)` |
| 5. Captions then render | caption builder, retimer | burned captions plus a matching `.srt` |
| 6. QA | one frame per caption, tiled | a sheet you read to confirm each caption sits over its action |

Do not skip step 3 (never guess what is on screen) or step 6 (the person you
deliver to should not be first-pass QA). The retimer should refuse to render if
the segment durations do not sum to the narration length: check arithmetic, do
not trust it.

### How to shape the retime

- **Open on a hold.** Most recordings open on a title card or a finished target
  view. Freeze it for the whole intro and release on the first word that
  describes an action. It absorbs most of the overrun and reads as deliberate.
- **Split the footage into ACTION and STATIC stretches.** Action (a drag, a menu
  opening, a value populating): keep 0.6x to 0.75x. Static (finished view, idle
  cursor): stretch as hard as needed, 0.2x is fine, and prefer a hard hold over a
  0.1x play. Slow motion on a static stretch is invisible; on a drag it looks
  broken.
- **Cut on the cue word**, using the narration timestamp, not a round number.
- **Expect a redraw lag.** Tableau repaints about a second after the click, so
  landing the payoff on the sentence after the instruction is correct.
- **Never land a payoff on a loading screen.** Check the frames just before and
  after each boundary.
- Strip the footage's audio; only the narration survives. Fix speech-recognition
  errors on proper nouns but keep the speaker's wording. Sans-serif captions,
  mid-bottom, above the player controls. No long dashes in captions. If a number
  cannot be read from the footage, say so instead of inventing it.
- Delivery is manual: the video goes to the speaker by the owner, never sent by
  the tool.

### ffmpeg traps found on the way

| Trap | Fix |
|---|---|
| A Pillow-written PNG overlay reports `sar 0/1`, and libx264 then fails with "height not divisible by 2", while the log shows the right size | `setsar=1` on every input and again after the overlay |
| `pad` with expressions is fine alone and breaks when chained into `overlay` | resolve every dimension to a literal integer in Python first |
| `scale=760:-1` can land on an odd height and the encoder refuses it | `scale=W:-2` with W even |
| `drawtext` can segfault when fontconfig has no default config | render text with Pillow to a transparent PNG and composite |
| `drawbox` evaluates its width once, so it does not animate | slide a pre-rendered strip with `overlay=x='-W+W*t/TOTAL'`, which does evaluate per frame |
| `-pattern_type glob` is unsupported on Windows builds | copy files into a `%02d` sequence before `tile` |
| Contact sheets built with `fps=1/N` plus `tile` drift, and the nth cell is not at `n*N` seconds | pull each frame with its own `-ss T -i file -frames:v 1` and label the time. Real defects came from trusting drifted sheets: a card was 4.5 s later than it looked |
| A file path containing `&` | quote it in the shell and pass it as one argv element from Python, never interpolate into a shell string |
