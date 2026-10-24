"""Resume, verify, and atomically install the official IDM-VTON DressCode UNet."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import threading
import time
from datetime import datetime
from pathlib import Path


# huggingface_hub and hf_xet read these settings while they are imported.
os.environ.setdefault("HF_XET_HIGH_PERFORMANCE", "1")
os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "3600")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")

from huggingface_hub import snapshot_download


ROOT = Path(__file__).resolve().parents[1]
PARTIAL = ROOT / "models" / "tryon" / "IDM-VTON-DC.partial"
FINAL = ROOT / "models" / "tryon" / "IDM-VTON-DC"
STATUS = ROOT / "workspace" / "diagnostics" / "idm-vton-dc-download.json"
LOCK = ROOT / "workspace" / "diagnostics" / "idm-vton-dc-download.lock"
REPO = "yisol/IDM-VTON-DC"
REVISION = "0fcf915a04a97a353678e2f17f89587127fce7f0"
WEIGHT = Path("unet") / "diffusion_pytorch_model.bin"
EXPECTED_SIZE = 11_965_770_219
EXPECTED_SHA256 = "0661a4757f0ef28801f45dc670783e7a9b482b36791c0899ea3839cd5375c1a2"

_status_lock = threading.Lock()
_state: dict[str, object] = {}
_stop_heartbeat = threading.Event()


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def directory_bytes(path: Path) -> int:
    total = 0
    if not path.exists():
        return total
    for item in path.rglob("*"):
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            continue
    return total


def write_status(**changes: object) -> None:
    with _status_lock:
        _state.update(changes)
        _state["updatedAt"] = now()
        _state["partialDirectoryBytes"] = directory_bytes(PARTIAL)
        STATUS.parent.mkdir(parents=True, exist_ok=True)
        temporary = STATUS.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(_state, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, STATUS)


def heartbeat() -> None:
    while not _stop_heartbeat.wait(60):
        write_status()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(16 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def acquire_lock():
    import msvcrt

    LOCK.parent.mkdir(parents=True, exist_ok=True)
    handle = LOCK.open("a+b")
    if handle.tell() == 0:
        handle.write(b"1")
        handle.flush()
    handle.seek(0)
    try:
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        handle.close()
        raise RuntimeError("Another IDM-VTON-DC download worker is already active")
    return handle


def valid_install(root: Path) -> bool:
    weight = root / WEIGHT
    return weight.is_file() and weight.stat().st_size == EXPECTED_SIZE and sha256(weight) == EXPECTED_SHA256


def install_verified_download(weight: Path) -> None:
    weight_bytes = weight.stat().st_size
    for stale in (PARTIAL / "unet").glob("*.download"):
        stale.unlink(missing_ok=True)
    cache = PARTIAL / ".cache"
    if cache.exists():
        shutil.rmtree(cache)

    manifest = {
        "repository": REPO,
        "revision": REVISION,
        "installedAt": now(),
        "weight": str(WEIGHT).replace("\\", "/"),
        "bytes": EXPECTED_SIZE,
        "sha256": EXPECTED_SHA256,
        "verified": True,
    }
    (PARTIAL / "installation.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if FINAL.exists():
        raise RuntimeError(f"Destination already exists and was not replaced: {FINAL}")
    os.replace(PARTIAL, FINAL)
    write_status(
        phase="completed",
        completedAt=now(),
        installedPath=str(FINAL),
        weightBytes=weight_bytes,
        sha256=EXPECTED_SHA256,
        verified=True,
    )


def main() -> int:
    lock_handle = acquire_lock()
    # Keep the handle referenced for the lifetime of the worker so Windows holds the lock.
    if valid_install(FINAL):
        write_status(
            phase="completed",
            completedAt=now(),
            installedPath=str(FINAL),
            weightBytes=EXPECTED_SIZE,
            sha256=EXPECTED_SHA256,
            verified=True,
        )
        return 0

    _state.update(
        {
            "phase": "starting",
            "startedAt": now(),
            "workerPid": os.getpid(),
            "repository": REPO,
            "revision": REVISION,
            "expectedBytes": EXPECTED_SIZE,
            "expectedSha256": EXPECTED_SHA256,
            "installedPath": None,
            "verified": False,
        }
    )
    PARTIAL.mkdir(parents=True, exist_ok=True)
    write_status()
    threading.Thread(target=heartbeat, daemon=True).start()

    attempt = 0
    while True:
        attempt += 1
        write_status(phase="downloading", attempt=attempt, lastError=None)
        try:
            snapshot_download(
                repo_id=REPO,
                revision=REVISION,
                local_dir=str(PARTIAL),
                allow_patterns=["unet/*"],
            )
            weight = PARTIAL / WEIGHT
            if not weight.is_file():
                raise RuntimeError(f"Downloaded snapshot is missing {WEIGHT}")
            actual_size = weight.stat().st_size
            if actual_size != EXPECTED_SIZE:
                weight.unlink(missing_ok=True)
                raise RuntimeError(f"Weight size mismatch: {actual_size} != {EXPECTED_SIZE}")

            write_status(phase="verifying", weightBytes=actual_size)
            actual_sha256 = sha256(weight)
            if actual_sha256 != EXPECTED_SHA256:
                weight.unlink(missing_ok=True)
                raise RuntimeError(f"Weight SHA-256 mismatch: {actual_sha256}")

            install_verified_download(weight)
            return 0
        except Exception as error:  # Keep a resumable worker alive across network failures.
            delay = min(300, 15 * attempt)
            write_status(
                phase="retrying",
                lastError=f"{type(error).__name__}: {error}",
                retryInSeconds=delay,
            )
            time.sleep(delay)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    finally:
        _stop_heartbeat.set()
