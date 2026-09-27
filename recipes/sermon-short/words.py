#!/usr/bin/env python3
"""Print word-level timings for part of a clip, to find clean cut points.

usage: words.py <work_dir> <clip> <from_sec> <to_sec>
e.g.   words.py ~/sermon-work IMG_0734 45 56
"""
import json
import sys
from pathlib import Path

work, clip, a, b = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
data = json.load(open(Path(work) / "tx" / f"{clip}.json"))
for seg in data["segments"]:
    for w in seg.get("words", []):
        if a <= w["start"] <= b:
            print(f"{w['start']:7.2f}-{w['end']:7.2f}  {w['word'].strip()}")
