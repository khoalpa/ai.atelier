"""Attach byte progress reporting to a downloader started by an older app process."""
import argparse
import json
import time
from pathlib import Path


def directory_size(path: Path) -> int:
    total = 0
    for item in path.rglob("*") if path.exists() else []:
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            pass
    return total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--status", required=True)
    parser.add_argument("--partial", required=True)
    parser.add_argument("--total", required=True, type=int)
    args = parser.parse_args()
    status, partial = Path(args.status), Path(args.partial)
    while True:
        try:
            data = json.loads(status.read_text(encoding="utf-8"))
        except Exception:
            break
        if data.get("status") not in {"starting", "running"}:
            break
        received = directory_size(partial)
        data.update(bytesDownloaded=received, totalBytes=args.total, percent=round(min(99.9, received * 100 / args.total), 1), updatedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        temporary = status.with_suffix(".monitor.tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(status)
        time.sleep(1)


if __name__ == "__main__":
    main()
