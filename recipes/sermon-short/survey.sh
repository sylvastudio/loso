#!/usr/bin/env bash
# Survey a folder of raw clips so you (or Claude) can plan an edit:
#   - contact sheet per clip (one frame every 2s, left→right, top→bottom)
#   - word-timestamped transcript per clip (local Whisper)
#   - transcripts.txt: every sentence with its in/out time
#
# usage: recipes/sermon-short/survey.sh <footage_dir> <work_dir>
set -euo pipefail

FOOTAGE="${1:?footage folder}"
WORK="${2:?work folder}"
MODEL="${WHISPER_MODEL:-small}"
mkdir -p "$WORK/sheets" "$WORK/audio" "$WORK/tx"

shopt -s nullglob nocaseglob
clips=("$FOOTAGE"/*.{mov,mp4,m4v})
[ ${#clips[@]} -gt 0 ] || { echo "No .mov/.mp4 clips in $FOOTAGE"; exit 1; }

for f in "${clips[@]}"; do
  b=$(basename "${f%.*}")
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  printf "%-16s %6.1fs\n" "$b" "$dur"
  # contact sheet: 8 columns, 2s per frame (autorotates phone footage)
  ffmpeg -v error -y -i "$f" \
    -vf "fps=1/2,scale=216:-2,tile=8x4:padding=4:color=white" -frames:v 1 "$WORK/sheets/$b.jpg"
  # 16k mono audio for Whisper
  ffmpeg -v error -y -i "$f" -map 0:a:0 -ac 1 -ar 16000 "$WORK/audio/$b.wav"
done

echo "Transcribing with Whisper ($MODEL)…"
for w in "$WORK"/audio/*.wav; do
  if command -v mlx_whisper >/dev/null; then          # Apple Silicon, fast
    mlx_whisper "$w" --model "mlx-community/whisper-$MODEL-mlx" \
      --word-timestamps True --output-format json --output-dir "$WORK/tx" >/dev/null
  elif command -v whisper >/dev/null; then            # openai-whisper
    whisper "$w" --model "$MODEL" --word_timestamps True \
      --output_format json --output_dir "$WORK/tx" >/dev/null
  else
    echo "Install mlx-whisper (pip install mlx-whisper) or openai-whisper"; exit 1
  fi
done

python3 - "$WORK" > "$WORK/transcripts.txt" <<'EOF'
import json, sys, pathlib
work = pathlib.Path(sys.argv[1])
for f in sorted((work / "tx").glob("*.json")):
    print(f"== {f.stem}")
    for s in json.load(open(f))["segments"]:
        print(f"{s['start']:7.2f}-{s['end']:7.2f}  {s['text'].strip()}")
    print()
EOF
echo "Done → $WORK/sheets/*.jpg and $WORK/transcripts.txt"
