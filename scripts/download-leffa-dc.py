"""Resume, verify, and atomically install the official Leffa DressCode checkpoint."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import time
from datetime import datetime
from pathlib import Path


os.environ.setdefault("HF_XET_HIGH_PERFORMANCE", "1")
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "3600")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

from huggingface_hub import snapshot_download


ROOT = Path(__file__).resolve().parents[1]
PARTIAL = ROOT / "models" / "tryon" / "Leffa-DC.partial"
FINAL = ROOT / "models" / "tryon" / "Leffa-DC"
STATUS = ROOT / "workspace" / "diagnostics" / "leffa-dc-download.json"
REPO = "franciszzj/Leffa"
REVISION = "61d3390f444506f052feedb0b243cd5369c29c89"
WEIGHT = Path("virtual_tryon_dc.pth")
EXPECTED_SIZE = 7_211_553_158
EXPECTED_SHA256 = "c42a83129b885528457a49f9bb9bcb02b5c96e8c7d007421e29e45c73ce626bf"
REQUIRED_CONFIGS = (
    Path("stable-diffusion-inpainting/scheduler/scheduler_config.json"),
    Path("stable-diffusion-inpainting/unet/config.json"),
    Path("stable-diffusion-inpainting/vae/config.json"),
)


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def directory_bytes(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file()) if path.exists() else 0


def write_status(**values: object) -> None:
    current = {}
    if STATUS.exists():
        try:
            current = json.loads(STATUS.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            current = {}
    current.update(values)
    current.update(updatedAt=now(), partialDirectoryBytes=directory_bytes(PARTIAL))
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATUS.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, STATUS)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(16 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def valid_install(path: Path) -> bool:
    weight = path / WEIGHT
    return (
        weight.is_file()
        and weight.stat().st_size == EXPECTED_SIZE
        and all((path / config).is_file() for config in REQUIRED_CONFIGS)
        and sha256(weight) == EXPECTED_SHA256
    )


def main() -> int:
    if valid_install(FINAL):
        write_status(phase="completed", installedPath=str(FINAL), verified=True,
                     weightBytes=EXPECTED_SIZE, sha256=EXPECTED_SHA256)
        return 0

    PARTIAL.mkdir(parents=True, exist_ok=True)
    write_status(
        phase="downloading",
        startedAt=now(),
        workerPid=os.getpid(),
        repository=REPO,
        revision=REVISION,
        expectedBytes=EXPECTED_SIZE,
        expectedSha256=EXPECTED_SHA256,
        verified=False,
    )
    attempt = 0
    while True:
        attempt += 1
        write_status(phase="downloading", attempt=attempt, lastError=None)
        try:
            snapshot_download(
                repo_id=REPO,
                revision=REVISION,
                local_dir=str(PARTIAL),
                allow_patterns=["virtual_tryon_dc.pth", "stable-diffusion-inpainting/*"],
            )
            weight = PARTIAL / WEIGHT
            if not weight.is_file() or weight.stat().st_size != EXPECTED_SIZE:
                raise RuntimeError("Downloaded Leffa DressCode weight has an unexpected size")
            if not all((PARTIAL / config).is_file() for config in REQUIRED_CONFIGS):
                raise RuntimeError("Downloaded Leffa base configuration is incomplete")
            write_status(phase="verifying", weightBytes=weight.stat().st_size)
            actual_hash = sha256(weight)
            if actual_hash != EXPECTED_SHA256:
                raise RuntimeError(f"Leffa DressCode SHA-256 mismatch: {actual_hash}")

            cache = PARTIAL / ".cache"
            if cache.exists():
                shutil.rmtree(cache)
            manifest = {
                "repository": REPO,
                "revision": REVISION,
                "installedAt": now(),
                "weight": WEIGHT.as_posix(),
                "bytes": EXPECTED_SIZE,
                "sha256": EXPECTED_SHA256,
                "verified": True,
            }
            (PARTIAL / "installation.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            if FINAL.exists():
                raise RuntimeError(f"Destination already exists and was not replaced: {FINAL}")
            os.replace(PARTIAL, FINAL)
            write_status(
                phase="completed",
                completedAt=now(),
                installedPath=str(FINAL),
                verified=True,
                weightBytes=EXPECTED_SIZE,
                sha256=EXPECTED_SHA256,
            )
            return 0
        except Exception as error:
            delay = min(300, 15 * attempt)
            write_status(phase="retrying", lastError=f"{type(error).__name__}: {error}", retryInSeconds=delay)
            time.sleep(delay)


if __name__ == "__main__":
    raise SystemExit(main())
