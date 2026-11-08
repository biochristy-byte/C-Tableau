# ffmpeg gotchas

All of these were hit and measured while building narrated screen-recording
videos. ffmpeg 8.1, Windows 11, Git Bash and PowerShell.

## Encoding

**`sar 0/1` off-by-one.** A Pillow-written PNG used as an overlay input reports
`sar:0/1`. Chained into `overlay`, libx264 receives `1080x1081` and fails with
"height not divisible by 2". The filter graph logs 1080x1080 the whole way, so
the error message points nowhere useful. Fix: explicit `setsar=1` on both
inputs and again after the overlay.

**`pad` with expressions breaks when chained into `overlay`.**
`pad=1080:1080:(ow-iw)/2:34+(700-ih)/2` is correct standalone and produces the
off-by-one when followed by `overlay`. Resolve every dimension to a literal
integer in Python before building the filter string.

**Odd scale heights.** `scale=760:-1` can land on an odd height and mjpeg
refuses it ("ff_frame_thread_encoder_init failed"). Always `scale=W:-2`, and
make W even too.

## Filters

**`drawtext` segfaults.** Fontconfig cannot load a default config in some builds.
Avoid it. Render all text in Pillow to a transparent PNG and composite.

**`drawbox` does not animate.** `drawbox=w='1080*t/26':t=fill` evaluates width
once, at the first frame. `overlay`'s `x` DOES evaluate per frame, so slide a
pre-rendered strip in with `overlay=x='-1080+1080*t/TOTAL'` instead.

**`-pattern_type glob` is not supported.** Copy files into a `%02d` sequence in
a temp dir before `tile`.

## Frame accuracy

**Contact sheets built with `fps=1/N` + `tile` drift.** The nth cell is not at
`n*N` seconds. Two timing defects came from trusting them. Always pull each
frame with its own `-ss T -i file -frames:v 1` and label the times explicitly.
`frames.py` does this.

Timing errors that got caught this way and are worth remembering as a pattern:
a closing card started at base 157.5s not 153s; a dialog opened at base 25s not
30s; a drop frame was base 19.0 not 19.6 (19.4 was already the loading screen).

**Watch for loading screens.** A stretch of a few tenths of a second can be a
white Tableau loading screen. Never land a payoff shot on one.

## Shell

**Windows PowerShell 5.1 has no `&&`.** Use `;` or `if ($?) { }`. The Bash tool is
Git Bash and handles loops, globs and greps fine.

**Paths with `&` in them** (`A&B Quick Table - ...mp4`) must be quoted in Bash
and passed as a single argv element from Python. Never interpolate them into a
shell string.
