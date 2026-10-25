#!/usr/bin/env bash
# Download the English auto-captions (json3) of Balatro University videos, no video.
# yt-dlp reads the info json (to a temp dir; it is ~4 MB), and the captions are fetched with curl
# from the URL in it, since yt-dlp's own caption requests get HTTP 429. Keeps a small meta file.
#
#   tools/bu/fetch.sh VIDEO_ID [VIDEO_ID ...]
set -uo pipefail
cd "$(dirname "$0")/../.."
out=data/bu/captions
mkdir -p "$out"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/bu.XXXXXX")
ua="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
for id in "$@"; do
  [ -s "$out/$id.en.json3" ] && { echo "have $id"; continue; }
  for attempt in 1 2 3; do
    PYTHONPATH=tools/roffle/.vendor python3 -m yt_dlp --js-runtimes node --socket-timeout 60 --no-progress \
      --skip-download --write-info-json --no-write-playlist-metafiles -o "$tmp/%(id)s.%(ext)s" -- "$id" >/dev/null && break
    echo "retrying $id ($attempt)" >&2
    sleep 10
  done
  [ -f "$tmp/$id.info.json" ] || { echo "FAILED $id" >&2; continue; }
  url=$(python3 - "$tmp/$id.info.json" "$out/$id.meta.json" <<'PY'
import json, sys
info = json.load(open(sys.argv[1]))
keep = {k: info.get(k) for k in ("id", "title", "duration", "upload_date", "channel", "description", "webpage_url")}
json.dump(keep, open(sys.argv[2], "w"), indent=1)
ac = info.get("automatic_captions") or {}
print(next(f["url"] for f in ac.get("en-orig", ac.get("en", [])) if f["ext"] == "json3"))
PY
)
  curl -s -A "$ua" -o "$out/$id.en.json3" "$url" || echo "no captions for $id" >&2
  [ -s "$out/$id.en.json3" ] && echo "ok $id" || echo "EMPTY $id" >&2
  sleep 4
done
rm -rf "$tmp"
