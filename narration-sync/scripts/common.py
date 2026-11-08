"""Shared paths, config and ffmpeg helpers for the narration-sync pipeline.

Config lives in narration-sync.config.json (next to the scripts' parent folder), or at the
path in the NARRATION_SYNC_CONFIG environment variable. Every key is optional; the defaults
are neutral. See narration-sync.config.example.json.

  out_dir        where finished videos and the _work folder go (default ~/narration-sync-out)
  asr_fixes      [["heard", "meant"], ...] text replacements applied to the finished captions
                 (proper nouns and product names the speech model keeps getting wrong)
  word_fixes     [[["heard", "words"], ["meant", "words"]], ...] fixes on the word sequence,
                 caught even when the phrase straddles a caption boundary
  whisper_model  faster-whisper model name (default "small")
  device         "cpu" or "cuda" (default "cpu")
  compute_type   faster-whisper compute type (default "int8")
  language       spoken language code (default "en")
"""
import json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULTS = {"out_dir": os.path.join(os.path.expanduser("~"), "narration-sync-out"),
            "asr_fixes": [], "word_fixes": [], "whisper_model": "small",
            "device": "cpu", "compute_type": "int8", "language": "en"}


def load_config():
    cfg = dict(DEFAULTS)
    p = os.environ.get("NARRATION_SYNC_CONFIG") or os.path.join(os.path.dirname(HERE), "narration-sync.config.json")
    if os.path.exists(p):
        cfg.update(json.load(open(p, encoding="utf-8")))
    cfg["out_dir"] = os.path.expanduser(cfg["out_dir"])
    return cfg


CONFIG = load_config()
OUTDIR = CONFIG["out_dir"]
WORKROOT = os.path.join(OUTDIR, "_work")


def work(slug):
    d = os.path.join(WORKROOT, slug)
    os.makedirs(d, exist_ok=True)
    return d


def run(cmd, quiet=True):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("FAILED:", " ".join(str(c) for c in cmd[:12]), "...")
        print(r.stderr[-3000:])
        raise SystemExit(1)
    return r.stdout


def probe(path):
    """duration, width, height, fps for a media file."""
    out = run(["ffprobe", "-v", "error", "-show_entries",
               "format=duration:stream=width,height,codec_type,avg_frame_rate",
               "-of", "json", path])
    d = json.loads(out)
    info = {"duration": float(d["format"]["duration"]), "w": None, "h": None,
            "fps": None, "has_audio": False}
    for s in d.get("streams", []):
        if s.get("codec_type") == "video" and info["w"] is None:
            info["w"], info["h"] = s.get("width"), s.get("height")
            fr = s.get("avg_frame_rate", "0/1")
            try:
                n, dn = fr.split("/")
                info["fps"] = round(float(n) / float(dn), 3) if float(dn) else None
            except Exception:
                pass
        if s.get("codec_type") == "audio":
            info["has_audio"] = True
    return info


def plan_path(slug):
    return os.path.join(work(slug), "plan.json")


def load_plan(slug):
    p = plan_path(slug)
    if not os.path.exists(p):
        raise SystemExit(f"no plan at {p} -- write it before running retime.py")
    return json.load(open(p, encoding="utf-8"))


def even(n):
    """libx264 refuses odd dimensions; every scale must land even."""
    return int(n) - (int(n) % 2)
