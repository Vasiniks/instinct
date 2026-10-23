#!/usr/bin/env bash
# Download Roffle Lite videos (720p video only) and their English auto-captions.
# yt-dlp's own caption download gets HTTP 429 from YouTube, so captions are fetched with curl from
# the URLs in the info json instead. A failed video is retried, then skipped; the rest still run.
#
#   tools/roffle/fetch.sh VIDEO_ID [VIDEO_ID ...]
set -uo pipefail
cd "$(dirname "$0")/../.."
out=data/roffle/videos
mkdir -p "$out"
ua="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
for id in "$@"; do
  for attempt in 1 2 3; do
    PYTHONPATH=tools/roffle/.vendor python3 -m yt_dlp --js-runtimes node --socket-timeout 60 --retries 10 --fragment-retries 10 --no-progress \
      -f "bv*[height<=720][vcodec^=avc1]/bv*[height<=720]" --write-info-json --no-write-playlist-metafiles \
      -o "$out/%(id)s.%(ext)s" -- "$id" && break
    echo "retrying $id ($attempt)" >&2
    sleep 10
  done
  [ -f "$out/$id.mp4" ] || { echo "FAILED $id" >&2; continue; }
  url=$(python3 -c "
import json
ac = json.load(open('$out/$id.info.json'))['automatic_captions']
print(next(f['url'] for f in ac.get('en-orig', ac.get('en', [])) if f['ext'] == 'json3'))")
  curl -s -A "$ua" -o "$out/$id.en.json3" "$url" || echo "no captions for $id" >&2
  sleep 4
done
