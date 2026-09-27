#!/usr/bin/env python3
"""Turn an edit plan (JSON) into a finished Loso poster short.

  build.py cut  plan.json <work_dir>                 # ffmpeg: edit.mp4 + bg.mp4
  build.py push plan.json <work_dir> --project ID    # upload + write layers into a Loso project
  build.py all  plan.json <work_dir> --project ID --render

`cut` joins the planned shots (with short dissolves) over the planned sermon
audio, cleans + loudness-normalizes the voice, crops every shot to the card's
video window, and makes a blurred/darkened copy for behind the card.
`push` uploads both to a running Loso (default http://localhost:3000) and
replaces the project's Compositor layers with the poster template: card,
labels, date, big title, video window, badge row, timed captions.
Everything stays editable in Loso afterwards.

Requires: ffmpeg/ffprobe, curl, python3 (stdlib only).
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

W, H = 1080, 1920  # the poster template is laid out for 9:16 1080×1920
XFADE_AUDIO = 0.08


def run(cmd):
    print("  $", " ".join(str(c) for c in cmd[:6]), "…" if len(cmd) > 6 else "")
    subprocess.run(cmd, check=True)


def find_clip(footage: Path, name: str) -> Path:
    for ext in (".MOV", ".mov", ".MP4", ".mp4", ".m4v"):
        p = footage / f"{name}{ext}"
        if p.exists():
            return p
    sys.exit(f"Clip {name} not found in {footage}")


# ---------------------------------------------------------------- cut

def cut(plan, work: Path):
    footage = Path(os.path.expanduser(plan["footage"]))
    fps = plan.get("fps", 30)
    total = plan.get("duration", 30)
    xf = plan.get("crossfade", 0.2)
    win = plan.get("window", {"width": 870, "height": 820})
    ww, wh = win["width"], win["height"]
    parts = work / "parts"
    parts.mkdir(parents=True, exist_ok=True)

    shots, audio = plan["shots"], plan["audio"]
    shot_sum = sum(s["dur"] for s in shots)
    audio_sum = sum(a["to"] - a["from"] for a in audio) - XFADE_AUDIO * (len(audio) - 1)
    print(f"shots cover {shot_sum:.2f}s · audio {audio_sum:.2f}s · target {total}s")
    if shot_sum < total or audio_sum < total - 0.5:
        print("  ! shots/audio shorter than the target — the end will be trimmed or silent")

    # crop height in a 1080-wide frame that matches the window aspect
    crop_h = round(1080 * wh / ww)
    print("Cutting shots…")
    for i, s in enumerate(shots):
        src = find_clip(footage, s["clip"])
        focus = s.get("focus", 0.45)  # vertical centre of the crop, 0=top 1=bottom
        y = f"min(max(0,ih*{focus}-{crop_h}/2),ih-{crop_h})"
        run(["ffmpeg", "-v", "error", "-y", "-ss", str(s["start"]), "-t", str(s["dur"] + xf),
             "-i", str(src), "-an",
             "-vf", f"scale=1080:-2,crop=1080:{crop_h}:0:'{y}',scale={ww}:{wh},fps={fps},setsar=1,"
                    "eq=contrast=1.04:saturation=1.06,format=yuv420p",
             "-c:v", "libx264", "-crf", "17", "-preset", "medium", str(parts / f"v{i}.mp4")])

    print("Cutting audio…")
    for i, a in enumerate(audio):
        src = find_clip(footage, a["clip"])
        run(["ffmpeg", "-v", "error", "-y", "-ss", str(a["from"]), "-to", str(a["to"]), "-i", str(src),
             "-map", "0:a:0", "-ac", "2", "-ar", "48000", str(parts / f"a{i}.wav")])

    # video: chained xfades
    n = len(shots)
    fc, prev, off = [], "[0:v]", 0.0
    for k in range(n - 1):
        off += shots[k]["dur"]
        out = f"[x{k}]" if k < n - 2 else "[vx]"
        fc.append(f"{prev}[{k + 1}:v]xfade=transition=fade:duration={xf}:offset={off:.3f}{out}")
        prev = out
    if n == 1:
        fc.append("[0:v]null[vx]")
    fc.append(f"[vx]trim=0:{total},setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.3,"
              f"fade=t=out:st={total - 0.6}:d=0.6[v]")
    # audio: chained short crossfades, then voice cleanup + loudness
    m = len(audio)
    prev = f"[{n}:a]"
    for k in range(1, m):
        out = f"[ac{k}]"
        fc.append(f"{prev}[{n + k}:a]acrossfade=d={XFADE_AUDIO}{out}")
        prev = out
    fc.append(f"{prev}highpass=f=80,afftdn=nr=10:nf=-40,"
              "acompressor=threshold=-20dB:ratio=3:attack=5:release=120,"
              f"loudnorm=I=-14:TP=-1.5:LRA=9,atrim=0:{total},asetpts=PTS-STARTPTS,"
              f"afade=t=in:st=0:d=0.15,afade=t=out:st={total - 0.7}:d=0.7[a]")

    inputs = []
    for i in range(n):
        inputs += ["-i", str(parts / f"v{i}.mp4")]
    for i in range(m):
        inputs += ["-i", str(parts / f"a{i}.wav")]
    print("Joining…")
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(fc),
         "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "16", "-preset", "slow",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
         str(work / "edit.mp4")])
    print("Background…")
    run(["ffmpeg", "-v", "error", "-y", "-i", str(work / "edit.mp4"), "-an",
         "-vf", f"scale=-2:{H},crop={W}:{H},boxblur=28:2,eq=brightness=-0.22:saturation=0.75,format=yuv420p",
         "-c:v", "libx264", "-crf", "24", "-movflags", "+faststart", str(work / "bg.mp4")])
    print(f"→ {work / 'edit.mp4'}  {work / 'bg.mp4'}")


# ---------------------------------------------------------------- push

def upload(base, path: Path) -> str:
    out = subprocess.run(["curl", "-sf", "-F", f"file=@{path};type=video/mp4", "-F", "kind=compositor",
                          f"{base}/api/assets"], check=True, capture_output=True, text=True).stdout
    return json.loads(out)["asset"]["hash"]


def api(base, method, path, body=None, timeout=60):
    req = urllib.request.Request(f"{base}{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def poster_doc(plan, edit_hash, bg_hash):
    fps = plan.get("fps", 30)
    n = round(plan.get("duration", 30) * fps)
    card = plan["card"]
    win = plan.get("window", {"width": 870, "height": 820})
    font = card.get("font", "Inter")
    paper, ink = card.get("paper", "#f3f2ee"), card.get("ink", "#0b0b0c")

    def base(id, name, x, y, w, h, z, frm=0, dur=n, anim=None):
        d = dict(id=id, name=name, x=x, y=y, width=w, height=h, rotation=0, opacity=1, z=z,
                 durationInFrames=dur, radius=0, borderWidth=0, borderColor="#ffffff")
        d["from"] = frm
        if anim:
            d["anim"] = anim
        return d

    def text(id, name, t, x, y, w, h, z, size, align="left", color=ink, bg=None, **kw):
        d = base(id, name, x, y, w, h, z, **kw)
        d.update(type="text", text=t, fontFamily=font, fontSize=size, color=color, fontWeight=700,
                 italic=False, align=align, backgroundColor=bg)
        return d

    def anim(preset, delay, dur=16):
        return {"preset": preset, "delay": delay, "duration": dur}

    title = card.get("title", "SUNDAY")
    # Inter Bold caps average ≈0.705em; keep the title on one line inside the card
    title_size = min(200, int(860 / (0.705 * max(1, len(title)))))
    vx = (W - win["width"]) // 2
    layers = [
        {**base("bg", "Background (blurred)", 0, 0, W, H, 0), "type": "video", "assetHash": bg_hash,
         "trimStart": 0, "trimEnd": None, "volume": 0, "objectFit": "cover"},
        text("card", "Poster card", "", 84, 300, 912, 1300, 1, 10, bg=paper, anim=anim("rise", 0, 18)),
        text("tl", "Label · left", card.get("left", ""), 120, 326, 440, 44, 2, 22, anim=anim("fade", 8)),
        text("tr", "Label · right", card.get("right", ""), 520, 326, 440, 44, 2, 22, align="right",
             anim=anim("fade", 8)),
        text("date", "Date", card.get("date", ""), 210, 438, 660, 62, 2, 50, anim=anim("rise", 10)),
        text("title", "Title", title, 90, 492, 900, 232, 2, title_size, align="center",
             anim=anim("rise", 12, 20)),
        {**base("main", "Sermon edit", vx, 700, win["width"], win["height"], 3, anim=anim("fade", 6, 14)),
         "type": "video", "assetHash": edit_hash, "trimStart": 0, "trimEnd": None, "volume": 1,
         "objectFit": "cover"},
        text("badges", "Badge row", card.get("badges", ""), vx, 700 + win["height"] + 16, win["width"], 48,
             2, 21, align="center", anim=anim("fade", 14)),
    ]
    cap_y = 700 + win["height"] - 116
    for i, c in enumerate(plan.get("captions", [])):
        fa, fb = round(c["from"] * fps), min(n, round(c["to"] * fps))
        layers.append(text(f"cap{i + 1}", f"Caption {i + 1}", c["text"], 120, cap_y, 840, 92, 4, 36,
                           align="center", color="#ffffff", bg="rgba(8,8,10,0.62)", frm=fa, dur=fb - fa,
                           anim=anim("fade", 0, 4)))
    return {"output": {"width": W, "height": H, "fps": fps, "durationInFrames": n, "background": "#0a0a0b"},
            "layers": layers}


def push(plan, work: Path, project, base, render):
    print("Uploading…")
    edit_hash, bg_hash = upload(base, work / "edit.mp4"), upload(base, work / "bg.mp4")
    doc = poster_doc(plan, edit_hash, bg_hash)
    api(base, "PATCH", f"/api/projects/{project}", {"settings": {"kind": "compositor", "compositor": doc}})
    print(f"→ {len(doc['layers'])} layers written to {base}/project/{project}")
    if render:
        print("Rendering MP4 (first run downloads a headless browser)…")
        r = api(base, "POST", f"/api/projects/{project}/render", timeout=900)
        print(f"→ {base}{r.get('url', '')}  (saved in data/renders/{project}.mp4)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("step", choices=["cut", "push", "all"])
    ap.add_argument("plan")
    ap.add_argument("work")
    ap.add_argument("--project", help="Loso compositor project id (from its URL)")
    ap.add_argument("--base", default="http://localhost:3000")
    ap.add_argument("--render", action="store_true", help="also export the MP4")
    a = ap.parse_args()
    plan = json.load(open(a.plan))
    work = Path(os.path.expanduser(a.work))
    work.mkdir(parents=True, exist_ok=True)
    if a.step in ("cut", "all"):
        cut(plan, work)
    if a.step in ("push", "all"):
        if not a.project:
            sys.exit("--project is required for push (open the project in Loso; the id is in the URL)")
        push(plan, work, a.project, a.base, a.render)


if __name__ == "__main__":
    main()
