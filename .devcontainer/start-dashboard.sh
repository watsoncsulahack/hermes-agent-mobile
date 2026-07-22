#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv-codespaces"
LOCAL_HERMES_HOME="$ROOT_DIR/.hermes-codespaces"
PID_FILE="$ROOT_DIR/.codespaces-dashboard.pid"
LOG_FILE="$ROOT_DIR/.codespaces-dashboard.log"
COMMAND=(
  "$VENV_DIR/bin/hermes" dashboard
  --host 127.0.0.1
  --port 9119
  --no-open
  --skip-build
)

if [[ ! -x "${COMMAND[0]}" ]]; then
  echo "Codespaces environment is not ready. Run: bash .devcontainer/setup.sh" >&2
  exit 1
fi

mkdir -p "$LOCAL_HERMES_HOME"
export HERMES_HOME="$LOCAL_HERMES_HOME"

if [[ "${1:-}" == "--foreground" ]]; then
  exec "${COMMAND[@]}"
fi

if [[ -f "$PID_FILE" ]]; then
  pid="$(<"$PID_FILE")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "Hermes dashboard is already running (PID $pid)."
    exit 0
  fi
  rm -f "$PID_FILE"
fi

nohup "${COMMAND[@]}" >"$LOG_FILE" 2>&1 </dev/null &
pid=$!
printf '%s\n' "$pid" >"$PID_FILE"

for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:9119/api/status >/dev/null 2>&1; then
    echo "Hermes dashboard is ready on private Codespaces port 9119."
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Hermes dashboard failed to start. See $LOG_FILE" >&2
    exit 1
  fi
  sleep 1
done

echo "Hermes dashboard is still starting. Follow $LOG_FILE for progress."
