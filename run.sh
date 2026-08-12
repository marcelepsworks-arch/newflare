#!/usr/bin/env bash
# Cross-platform helper to run Newflare locally (Linux/macOS)
set -e
ROOT=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Please install Node.js." >&2
  exit 1
fi

echo "Starting server..."
node server.js &
SERVER_PID=$!
sleep 0.6
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open http://localhost:3000 || true
elif command -v open >/dev/null 2>&1; then
  open http://localhost:3000 || true
else
  echo "Open http://localhost:3000 in your browser"
fi

wait $SERVER_PID
