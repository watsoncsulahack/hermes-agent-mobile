from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
LAUNCHER = PROJECT_ROOT / "scripts" / "run-termux-dashboard-local.sh"


def test_launcher_uses_only_repo_local_runtime_paths(tmp_path: Path) -> None:
    repo = tmp_path / "checkout"
    scripts = repo / "scripts"
    fake_bin = repo / ".venv-termux" / "bin"
    scripts.mkdir(parents=True)
    fake_bin.mkdir(parents=True)
    shutil.copy2(LAUNCHER, scripts / LAUNCHER.name)

    capture = tmp_path / "capture.txt"
    fake_hermes = fake_bin / "hermes"
    fake_hermes.write_text(
        "#!/bin/sh\n"
        "{\n"
        "  printf 'HERMES_HOME=%s\\n' \"$HERMES_HOME\"\n"
        "  printf 'PIP_CACHE_DIR=%s\\n' \"$PIP_CACHE_DIR\"\n"
        "  printf 'npm_config_cache=%s\\n' \"$npm_config_cache\"\n"
        "  printf 'XDG_CACHE_HOME=%s\\n' \"$XDG_CACHE_HOME\"\n"
        "  printf 'TMPDIR=%s\\n' \"$TMPDIR\"\n"
        "  printf 'ARGS='\n"
        "  printf '<%s>' \"$@\"\n"
        "  printf '\\n'\n"
        "} > \"$CAPTURE_FILE\"\n",
        encoding="utf-8",
    )
    fake_hermes.chmod(0o755)

    env = os.environ.copy()
    env["CAPTURE_FILE"] = str(capture)
    env["HERMES_HOME"] = str(tmp_path / "existing-global-hermes")
    subprocess.run(
        ["bash", str(scripts / LAUNCHER.name), "--skip-build"],
        cwd=repo,
        env=env,
        check=True,
        text=True,
        capture_output=True,
    )

    values = capture.read_text(encoding="utf-8")
    assert f"HERMES_HOME={repo / '.hermes-local'}" in values
    assert f"PIP_CACHE_DIR={repo / '.cache' / 'pip'}" in values
    assert f"npm_config_cache={repo / '.cache' / 'npm'}" in values
    assert f"XDG_CACHE_HOME={repo / '.cache'}" in values
    assert f"TMPDIR={repo / '.cache' / 'tmp'}" in values
    assert "ARGS=<dashboard><--host><127.0.0.1><--port><9120><--no-open><--skip-build>" in values
    assert "existing-global-hermes" not in values
