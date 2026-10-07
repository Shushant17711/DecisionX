#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Backend address. Loopback by default; set DECISIONX_HOST=0.0.0.0 only on a
# trusted network (and set DECISIONX_API_TOKEN when you do).
HOST="${DECISIONX_HOST:-127.0.0.1}"

port_busy() {
  python3 - "$1" <<'EOF'
import socket, sys
s = socket.socket()
try:
    s.bind(("127.0.0.1", int(sys.argv[1])))
except OSError:
    sys.exit(0)  # busy
sys.exit(1)
EOF
}

# Never kill processes we did not start: if a port is taken, say who has it and stop.
busy=0
for port in 3000 8001; do
  if port_busy "$port"; then
    owner="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $1" (pid "$2")"}' | sort -u | tr '\n' ' ' || true)"
    echo "Port $port is already in use${owner:+ by $owner}. Stop it first (or close the other dev server)." >&2
    busy=1
  fi
done
[ "$busy" -eq 0 ] || exit 1

# Reinstall backend deps whenever requirements.txt changes, not only on first run.
REQ=backend/requirements.txt
STAMP=.venv/.requirements.sha256
req_hash="$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$REQ")"
if [ ! -d .venv ]; then
  echo "Creating .venv"
  python3 -m venv .venv
fi
if [ "$(cat "$STAMP" 2>/dev/null || true)" != "$req_hash" ]; then
  echo "Installing backend requirements"
  .venv/bin/pip install -q -r "$REQ"
  echo "$req_hash" > "$STAMP"
fi

[ -d frontend/node_modules ] || (cd frontend && npm install)

# Only ever stops this script's own process group (the two servers below).
cleanup() { trap - EXIT INT TERM; kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd backend && "$ROOT/.venv/bin/python" -m uvicorn main:app --host "$HOST" --port 8001 --reload) &
(cd frontend && npm run dev) &

echo
echo "Frontend  http://localhost:3000"
echo "Backend   http://$HOST:8001/api/health"
echo "Ctrl-C stops both."
wait
