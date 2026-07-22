#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${HERMES_MOBILE_VENV:-$ROOT_DIR/.venv-termux}"
LOCAL_HERMES_HOME="${HERMES_MOBILE_HOME:-$ROOT_DIR/.hermes-local}"
CACHE_DIR="${HERMES_MOBILE_CACHE:-$ROOT_DIR/.cache}"
PORT="${HERMES_MOBILE_PORT:-9120}"

# Keep Hermes state, credentials, Python/npm caches, and generated files inside
# this checkout. An already-installed global Hermes continues to use ~/.hermes.
export HERMES_HOME="$LOCAL_HERMES_HOME"
export XDG_CACHE_HOME="$CACHE_DIR"
export TMPDIR="$CACHE_DIR/tmp"
export PIP_CACHE_DIR="$CACHE_DIR/pip"
export UV_CACHE_DIR="$CACHE_DIR/uv"
export npm_config_cache="$CACHE_DIR/npm"
export CARGO_HOME="$CACHE_DIR/cargo"
export ANDROID_API_LEVEL="${ANDROID_API_LEVEL:-$(getprop ro.build.version.sdk 2>/dev/null || true)}"

mkdir -p \
  "$HERMES_HOME" \
  "$TMPDIR" \
  "$PIP_CACHE_DIR" \
  "$UV_CACHE_DIR" \
  "$npm_config_cache" \
  "$CARGO_HOME"

if [[ ! -x "$VENV_DIR/bin/hermes" ]]; then
  if ! command -v python >/dev/null 2>&1; then
    echo "Python is required. In Termux run:" >&2
    echo "  pkg install -y python" >&2
    exit 1
  fi

  echo "Creating repository-local Hermes environment: $VENV_DIR"
  python -m venv "$VENV_DIR"
  "$VENV_DIR/bin/python" -m pip install --upgrade pip setuptools wheel

  # Upstream psutil rejects sys.platform == "android" even though its Linux
  # backend works on Termux. Install the pinned, checksum-verified source with
  # that platform check patched before resolving Hermes' dependencies.
  "$VENV_DIR/bin/python" "$ROOT_DIR/scripts/install-termux-psutil.py" \
    --cache-dir "$PIP_CACHE_DIR/psutil-android"

  "$VENV_DIR/bin/python" -m pip install \
    -e "$ROOT_DIR[termux,web]" \
    -c "$ROOT_DIR/constraints-termux.txt"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm is required to build the dashboard. In Termux run:" >&2
  echo "  pkg install -y nodejs" >&2
  exit 1
fi

echo "Repository-local Hermes home: $HERMES_HOME"
echo "Mobile dashboard: http://127.0.0.1:$PORT/chat"

exec "$VENV_DIR/bin/hermes" dashboard \
  --host 127.0.0.1 \
  --port "$PORT" \
  --no-open \
  "$@"
