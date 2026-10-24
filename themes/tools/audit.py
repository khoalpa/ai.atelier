"""Consolidate rollout history and verify the final deployed file inventory."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def audit() -> None:
    records = {}
    for manifest in sorted((ROOT / "deployment").glob("20*.json")):
        for item in json.loads(manifest.read_text(encoding="utf-8"))["changes"]:
            if item["path"] in records:
                records[item["path"]]["sha256"] = item["sha256"]
            else:
                records[item["path"]] = dict(item)
    for item in records.values():
        path = Path(item["path"])
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise RuntimeError(f"Modified since rollout: {path}")
        if item["backup"] and not Path(item["backup"]).is_file():
            raise RuntimeError(f"Missing rollback copy: {item['backup']}")
    (ROOT / "deployment/initial-rollout.json").write_text(json.dumps({"version": "1.0.0", "changes": list(records.values())}, indent=2), encoding="utf-8")
    print(f"PASS: {len(records)} deployed files match inventory; initial-rollout.json can restore the complete rollout")


if __name__ == "__main__":
    audit()
