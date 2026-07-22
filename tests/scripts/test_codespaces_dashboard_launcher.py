from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import yaml


PROJECT_ROOT = Path(__file__).resolve().parents[2]
LAUNCHER = PROJECT_ROOT / ".devcontainer" / "start-dashboard.sh"
CONFIG = PROJECT_ROOT / ".devcontainer" / "devcontainer.json"
WORKFLOW = PROJECT_ROOT / ".github" / "workflows" / "mobile-web-build.yml"


def test_codespaces_config_builds_and_privately_forwards_dashboard() -> None:
    config = json.loads(CONFIG.read_text(encoding="utf-8"))

    assert config["postCreateCommand"] == "bash .devcontainer/setup.sh"
    assert config["postStartCommand"] == "bash .devcontainer/start-dashboard.sh"
    assert 9119 in config["forwardPorts"]
    assert config["portsAttributes"]["9119"]["onAutoForward"] == "notify"


def test_codespaces_foreground_launcher_uses_workspace_local_state(tmp_path: Path) -> None:
    repo = tmp_path / "checkout"
    devcontainer = repo / ".devcontainer"
    fake_bin = repo / ".venv-codespaces" / "bin"
    devcontainer.mkdir(parents=True)
    fake_bin.mkdir(parents=True)
    shutil.copy2(LAUNCHER, devcontainer / LAUNCHER.name)

    capture = tmp_path / "capture.txt"
    fake_hermes = fake_bin / "hermes"
    fake_hermes.write_text(
        "#!/bin/sh\n"
        "printf 'HERMES_HOME=%s\\n' \"$HERMES_HOME\" > \"$CAPTURE_FILE\"\n"
        "printf 'ARGS=' >> \"$CAPTURE_FILE\"\n"
        "printf '<%s>' \"$@\" >> \"$CAPTURE_FILE\"\n"
        "printf '\\n' >> \"$CAPTURE_FILE\"\n",
        encoding="utf-8",
    )
    fake_hermes.chmod(0o755)

    env = os.environ.copy()
    env["CAPTURE_FILE"] = str(capture)
    subprocess.run(
        ["bash", str(devcontainer / LAUNCHER.name), "--foreground"],
        cwd=repo,
        env=env,
        check=True,
        text=True,
        capture_output=True,
    )

    values = capture.read_text(encoding="utf-8")
    assert f"HERMES_HOME={repo / '.hermes-codespaces'}" in values
    assert "ARGS=<dashboard><--host><127.0.0.1><--port><9119><--no-open><--skip-build>" in values


def test_mobile_web_workflow_builds_and_uploads_dashboard_archive() -> None:
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    job = workflow["jobs"]["build-web"]
    steps = job["steps"]
    commands = "\n".join(step.get("run", "") for step in steps)

    assert "npm run check --workspace web" in commands
    assert "npm run build --workspace web" in commands
    assert "tar -czf" in commands
    upload = next(step for step in steps if step.get("uses", "").startswith("actions/upload-artifact@"))
    assert upload["with"]["retention-days"] == 14
    assert "hermes-mobile-web" in upload["with"]["name"]
