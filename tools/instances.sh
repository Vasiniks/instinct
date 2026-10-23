#!/bin/bash
# Extra Balatro instances for batch runs, each with its own BlindDeck port.
#
#   tools/instances.sh start 3            # ports 12350-12352, the first with a window to watch
#   tools/instances.sh start 3 12360 0    # ports 12360-12362, all headless
#   tools/instances.sh status
#   tools/instances.sh stop
#
# Each instance saves to its own folder, Application Support/BalatroBot-<n> (BALATROBOT_IDENTITY,
# read by the patched BlindDeck mod), seeded with a copy of your profile 2 and played on it, so bot
# runs never touch your settings, stats or saves. (A separate HOME would do it too, but Balatro
# looks for Steam under HOME and quits.) `start` still backs your folder up first, in case.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.instances"
GAME="$HOME/Library/Application Support/Steam/steamapps/common/Balatro"
SAVE="$HOME/Library/Application Support/Balatro"

start() {
  local n="${1:-2}" base="${2:-12350}" visible="${3:-1}"
  mkdir -p "$DIR"
  local backup="$SAVE/instinct-backup-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$backup"
  cp -R "$SAVE/settings.jkr" "$SAVE/1" "$SAVE/2" "$SAVE/3" "$backup/" 2>/dev/null || true
  echo "profile backed up to $backup"
  for ((i = 0; i < n; i++)); do
    local port=$((base + i)) log="$DIR/$((i + 1)).log"
    if curl -s -m 1 -o /dev/null "http://127.0.0.1:$port" 2>/dev/null; then
      echo "port $port already answers; skipping"
      continue
    fi
    local bot="$HOME/Library/Application Support/BalatroBot-$((i + 1))"
    mkdir -p "$bot/2"
    [ -f "$bot/settings.jkr" ] || cp "$SAVE/settings.jkr" "$bot/settings.jkr"
    for f in profile.jkr meta.jkr; do [ -f "$bot/2/$f" ] || [ ! -f "$SAVE/2/$f" ] || cp "$SAVE/2/$f" "$bot/2/$f"; done
    # The first `visible` instances get a window; the rest run headless. All run fast.
    # Variables are exported here and love is started directly: macOS strips DYLD_* variables when
    # they pass through a system binary such as env or nohup, and then Lovely (and the mods) never load.
    (
      cd "$GAME"
      export DYLD_INSERT_LIBRARIES="$GAME/liblovely.dylib" BALATROBOT_PORT=$port
      export BALATROBOT_IDENTITY="BalatroBot-$((i + 1))" BALATROBOT_PROFILE=2
      # Handy's animation skip at "everything": the game state jumps straight to the result.
      export BALATROBOT_ANIMATION_SKIP=4
      if ((i < visible)); then
        # Fast even with a window: at normal speed with every animation skipped, pack and buy
        # calls waited out BlindDeck's 15 s timeout.
        export BALATROBOT_HEADLESS=0 BALATROBOT_FAST=1
      else
        export BALATROBOT_HEADLESS=1 BALATROBOT_FAST=1 BALATROBOT_NO_SHADERS=1
      fi
      ./Balatro.app/Contents/MacOS/love >"$log" 2>&1 &
      echo $! >"$DIR/$((i + 1)).pid"
    )
    echo "instance $((i + 1)): port $port, pid $(cat "$DIR/$((i + 1)).pid")$( ((i < visible)) && echo ", with a window")"
  done
}

status() {
  for pid in "$DIR"/*.pid; do
    [ -f "$pid" ] || continue
    if kill -0 "$(cat "$pid")" 2>/dev/null; then echo "$(basename "$pid" .pid): pid $(cat "$pid") running"; else echo "$(basename "$pid" .pid): stopped"; fi
  done
}

stop() {
  for pid in "$DIR"/*.pid; do
    [ -f "$pid" ] || continue
    kill "$(cat "$pid")" 2>/dev/null && echo "stopped $(basename "$pid" .pid)" || true
    rm -f "$pid"
  done
}

case "${1:-}" in
  start) start "${2:-2}" "${3:-12350}" "${4:-1}" ;;
  status) status ;;
  stop) stop ;;
  *) echo "usage: $0 start [count] [base-port] [visible] | status | stop" >&2; exit 1 ;;
esac
