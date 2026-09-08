#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Runs the birthday ranker AND a public Cloudflare "quick tunnel", keeps both
# alive, and stops this Mac from sleeping while it runs.
#
#   ./run-public.sh
#
# Cloudflared prints a line like:
#   https://random-words-1234.trycloudflare.com
# That is the link to share. It stays valid as long as THIS process keeps
# running. If the tunnel process restarts, the URL changes (see README).
#
# Votes are written to ./data/data.json  (survives restarts).
# Press Ctrl+C to stop the app and the tunnel.
# ---------------------------------------------------------------------------
set -uo pipefail
cd "$(dirname "$0")"

export PORT="${PORT:-3000}"
export DATA_DIR="${DATA_DIR:-$PWD/data}"
mkdir -p "$DATA_DIR"

echo "==> data dir: $DATA_DIR"
echo "==> starting app on http://localhost:$PORT"

# keep the Node app alive
( while true; do
    node server.js
    echo "!! server exited (code $?), restarting in 2s" >&2
    sleep 2
  done ) &
APP_PID=$!

# wait until it answers
until curl -sf -o /dev/null "http://localhost:$PORT"; do sleep 1; done
echo "==> app is up"

# keep the tunnel alive
( while true; do
    cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT"
    echo "!! tunnel exited (code $?), restarting in 3s" >&2
    sleep 3
  done ) &
TUN_PID=$!

cleanup() { echo; echo "==> stopping"; kill "$APP_PID" "$TUN_PID" 2>/dev/null; exit 0; }
trap cleanup INT TERM

# on macOS, hold off sleep for as long as this script runs
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -s -w $$ &
fi

wait
