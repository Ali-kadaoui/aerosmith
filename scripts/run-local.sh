#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f backend/.env ]]; then
  set -a
  source backend/.env
  set +a
fi
api_port="${MEOS_API_PORT:-8018}"
ui_port="${MEOS_UI_PORT:-5188}"
if [[ ! -x backend/.venv/bin/python || ! -x frontend/node_modules/.bin/vite ]]; then
  echo "Install the backend and frontend dependencies as described in README.md."
  exit 1
fi
backend_pid=
frontend_pid=
cleanup() {
  if [[ -n "$frontend_pid" ]]; then kill "$frontend_pid" 2>/dev/null || true; fi
  if [[ -n "$backend_pid" ]]; then kill "$backend_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
(cd backend && exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$api_port") &
backend_pid=$!
for attempt in {1..25}; do
  kill -0 "$backend_pid" 2>/dev/null || exit 1
  if curl -fsS "http://127.0.0.1:$api_port/api/health" >/dev/null 2>&1; then break; fi
  sleep .2
done
kill -0 "$backend_pid" 2>/dev/null || exit 1
curl -fsS "http://127.0.0.1:$api_port/api/health" >/dev/null
(cd frontend && MEOS_API_URL="http://127.0.0.1:$api_port" exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$ui_port" --strictPort) &
frontend_pid=$!
while kill -0 "$backend_pid" 2>/dev/null && kill -0 "$frontend_pid" 2>/dev/null; do sleep 1; done
