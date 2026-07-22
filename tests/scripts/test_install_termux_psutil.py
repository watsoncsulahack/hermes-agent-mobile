from __future__ import annotations

import importlib.util
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
INSTALLER = PROJECT_ROOT / "scripts" / "install-termux-psutil.py"


def _load_installer():
    spec = importlib.util.spec_from_file_location("install_termux_psutil", INSTALLER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_patch_marks_android_as_linux_for_psutil_build_and_runtime(tmp_path: Path) -> None:
    common = tmp_path / "psutil" / "_common.py"
    common.parent.mkdir(parents=True)
    common.write_text(
        'LINUX = sys.platform.startswith("linux")\n',
        encoding="utf-8",
    )

    installer = _load_installer()
    installer.patch_android_platform(tmp_path)

    assert common.read_text(encoding="utf-8") == (
        'LINUX = sys.platform.startswith(("linux", "android"))\n'
    )
