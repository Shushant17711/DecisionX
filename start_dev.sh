#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

for port in 3000 8001; do
  pid="$(lsof -ti :"$port" || true)"
  [ -n "$pid" ] && { echo "Freeing port $port (pid $pid)"; kill -9 $pid; }
done

if [ ! -d .venv ]; then
  echo "Creating .venv"
  python3 -m venv .venv
  .venv/bin/pip install -q -r backend/requirements.txt
fi

[ -d frontend/node_modules ] || (cd frontend && npm install)

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

(cd backend && "$ROOT/.venv/bin/python" -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload) &
(cd frontend && npm run dev) &

echo
echo "Frontend  http://localhost:3000"
echo "Backend   http://localhost:8001/api/health"
echo "Ctrl-C stops both."
wait
