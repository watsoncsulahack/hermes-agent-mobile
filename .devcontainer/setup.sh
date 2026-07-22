#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv-codespaces"
HERMES_HOME="$ROOT_DIR/.hermes-codespaces"

mkdir -p "$HERMES_HOME"

if [[ ! -x "$VENV_DIR/bin/hermes" ]]; then
  python -m venv "$VENV_DIR"
  "$VENV_DIR/bin/python" -m pip install --upgrade pip setuptools wheel
  "$VENV_DIR/bin/python" -m pip install -e "$ROOT_DIR[web]"
fi

cd "$ROOT_DIR"
npm ci --ignore-scripts --no-audit --no-fund
npm run build --workspace web

printf 'Cloud build ready. Hermes environment: %s\n' "$VENV_DIR"
printf 'The dashboard starts automatically on private forwarded port 9119.\n'
