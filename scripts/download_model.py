import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import threading
import urllib.parse
import urllib.request
from pathlib import Path


def write_status(path: Path, **change):
    current = {}
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        pass
    current.update(change, updatedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def directory_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return total
    for item in path.rglob("*"):
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            pass
    return total


def monitor_directory_progress(partial: Path, status: Path, total: int, stop: threading.Event):
    while not stop.wait(0.75):
        received = directory_size(partial)
        percent = round(min(99.9, received * 100 / total), 1) if total else None
        write_status(status, stage="downloading", bytesDownloaded=received, totalBytes=total, percent=percent, message="Đang tải model từ Hugging Face")


def clean_stale_huggingface_cache(partial: Path):
    """Remove abandoned locks/empty attempts while preserving downloaded bytes."""
    cache = partial / ".cache" / "huggingface" / "download"
    if not cache.exists():
        return
    for item in cache.rglob("*"):
        try:
            if item.is_file() and (item.name.endswith(".lock") or (item.name.endswith(".incomplete") and item.stat().st_size == 0)):
                item.unlink()
        except OSError:
            pass


def download_huggingface(source: str, partial: Path, status: Path, allow_patterns=None):
    # hf-xet can deadlock after an interrupted Windows download. Standard HTTP
    # is slower but resumes reliably and keeps the UI heartbeat responsive.
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    from huggingface_hub import HfApi, get_token, snapshot_download

    repo_id = source.split("huggingface.co/", 1)[1].strip("/").split("/tree/", 1)[0]
    token = os.environ.get("HF_TOKEN") or get_token()
    clean_stale_huggingface_cache(partial)
    info = HfApi(token=token).model_info(repo_id, files_metadata=True)
    selected = list(info.siblings or [])
    if allow_patterns:
        import fnmatch
        selected = [file for file in selected if any(fnmatch.fnmatch(file.rfilename, pattern) for pattern in allow_patterns)]
    total = sum(int(file.size or 0) for file in selected)
    received = directory_size(partial)
    percent = round(min(99.9, received * 100 / total), 1) if total else None
    write_status(status, stage="downloading", bytesDownloaded=received, totalBytes=total, percent=percent, message=f"Đang tải snapshot {repo_id}")
    stop = threading.Event()
    monitor = threading.Thread(target=monitor_directory_progress, args=(partial, status, total, stop), daemon=True)
    monitor.start()
    try:
        if repo_id == 'black-forest-labs/FLUX.2-klein-4B':
            import importlib.util
            spec = importlib.util.spec_from_file_location('install_flux_klein', Path(__file__).with_name('install-flux-klein.py'))
            installer = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(installer)
            installer.TARGET = partial
            installer.main()
            return
        snapshot_download(
            repo_id=repo_id,
            local_dir=str(partial),
            token=token,
            local_dir_use_symlinks=False,
            resume_download=True,
            max_workers=1,
            allow_patterns=allow_patterns or None,
        )
    finally:
        stop.set()
        monitor.join(timeout=2)


def download_civitai(source: str, partial: Path, status: Path):
    query = urllib.parse.parse_qs(urllib.parse.urlparse(source).query)
    version_id = (query.get("modelVersionId") or [None])[0]
    if not version_id:
        raise RuntimeError("Trang Civitai không có modelVersionId")
    url = f"https://civitai.com/api/download/models/{version_id}"
    token = os.environ.get("CIVITAI_API_TOKEN")
    if token:
        url += "?token=" + urllib.parse.quote(token)
    partial.mkdir(parents=True, exist_ok=True)
    target = partial / f"model-{version_id}.safetensors"
    request = urllib.request.Request(url, headers={"User-Agent": "AI-Atelier/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response, target.open("wb") as output:
        total = int(response.headers.get("Content-Length") or 0)
        received = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
            received += len(chunk)
            percent = round(received * 100 / total, 1) if total else None
            write_status(status, stage="downloading", bytesDownloaded=received, totalBytes=total, percent=percent, message="Đang tải checkpoint Civitai")


def download_ollama(source: str, partial: Path, status: Path):
    model = source.split("ollama://", 1)[1].strip()
    if not model or any(char in model for char in "\\/ \t\r\n"):
        raise RuntimeError("Tên model Ollama không hợp lệ")
    executable = shutil.which("ollama")
    if not executable:
        local_app = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe"
        executable = str(local_app) if local_app.exists() else None
    if not executable:
        raise RuntimeError("Chưa cài Ollama hoặc ollama.exe chưa có trong PATH")
    write_status(status, stage="downloading", message=f"Đang tải model Ollama {model}")
    result = subprocess.run([executable, "pull", model], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "Ollama pull thất bại").strip()[-1000:])
    partial.mkdir(parents=True, exist_ok=True)
    (partial / "ollama-model.json").write_text(json.dumps({"model": model, "runtime": executable}, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--id", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--status", required=True)
    parser.add_argument("--include", action="append", default=[])
    args = parser.parse_args()
    target, status = Path(args.target).resolve(), Path(args.status).resolve()
    partial = target.with_name(target.name + ".partial")
    write_status(status, id=args.id, status="running", stage="preparing", source=args.source, target=str(target), percent=0, message="Đang chuẩn bị tải model")
    try:
        if target.exists():
            raise RuntimeError("Thư mục đích đã tồn tại")
        partial.mkdir(parents=True, exist_ok=True)
        if args.source.startswith("ollama://"):
            download_ollama(args.source, partial, status)
        elif "huggingface.co/" in args.source:
            download_huggingface(args.source, partial, status, args.include)
        elif "civitai.com/" in args.source:
            download_civitai(args.source, partial, status)
        else:
            raise RuntimeError("Nguồn model chưa được hỗ trợ")
        partial.replace(target)
        write_status(status, status="completed", stage="completed", percent=100, message="Tải model hoàn tất")
    except Exception as error:
        write_status(status, status="failed", stage="failed", error=str(error), message=f"Tải model thất bại: {error}")
        raise


if __name__ == "__main__":
    main()
