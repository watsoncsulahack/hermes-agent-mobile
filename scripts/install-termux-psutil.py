#!/usr/bin/env python3
"""Install psutil on Termux by enabling its Linux backend for Android."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import os
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path


VERSION = "7.2.2"
SDIST_URL = "https://files.pythonhosted.org/packages/aa/c6/d1ddf4abb55e93cebc4f2ed8b5d6dbad109ecb8d63748dd2b20ab5e57ebe/psutil-7.2.2.tar.gz"
SDIST_SHA256 = "0746f5f8d406af344fd547f1c8daa5f5c33dbc293bb8d6a16d80b4bb88f59372"
ORIGINAL_PLATFORM_CHECK = 'LINUX = sys.platform.startswith("linux")'
ANDROID_PLATFORM_CHECK = 'LINUX = sys.platform.startswith(("linux", "android"))'


def patch_android_platform(source_root: Path) -> None:
    common = source_root / "psutil" / "_common.py"
    text = common.read_text(encoding="utf-8")
    if ANDROID_PLATFORM_CHECK in text:
        return
    if ORIGINAL_PLATFORM_CHECK not in text:
        raise RuntimeError(f"Unexpected psutil platform check in {common}")
    common.write_text(
        text.replace(ORIGINAL_PLATFORM_CHECK, ANDROID_PLATFORM_CHECK, 1),
        encoding="utf-8",
    )


def installed() -> bool:
    try:
        return importlib.metadata.version("psutil") == VERSION
    except importlib.metadata.PackageNotFoundError:
        return False


def checked_download(destination: Path) -> None:
    if destination.exists():
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        if digest == SDIST_SHA256:
            return
        destination.unlink()

    urllib.request.urlretrieve(SDIST_URL, destination)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    if digest != SDIST_SHA256:
        destination.unlink(missing_ok=True)
        raise RuntimeError(
            f"psutil sdist checksum mismatch: expected {SDIST_SHA256}, got {digest}"
        )


def install(cache_dir: Path) -> None:
    if installed():
        print(f"psutil {VERSION} is already installed")
        return

    cache_dir.mkdir(parents=True, exist_ok=True)
    archive = cache_dir / f"psutil-{VERSION}.tar.gz"
    checked_download(archive)

    with tempfile.TemporaryDirectory(prefix="psutil-android-", dir=cache_dir) as tmp:
        build_dir = Path(tmp)
        with tarfile.open(archive) as bundle:
            bundle.extractall(build_dir, filter="data")
        source = build_dir / f"psutil-{VERSION}"
        patch_android_platform(source)
        subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--no-build-isolation",
                str(source),
            ],
            check=True,
            env=os.environ.copy(),
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(os.environ.get("PIP_CACHE_DIR", ".cache/pip")) / "psutil-android",
    )
    args = parser.parse_args()
    install(args.cache_dir.resolve())


if __name__ == "__main__":
    main()
