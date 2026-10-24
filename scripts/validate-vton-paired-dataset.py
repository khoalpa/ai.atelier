"""Validate owned, real paired images before a VTON fine-tuning run is allowed."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = ROOT / "workspace" / "training" / "vton-paired"
CATEGORIES = ("upper_body", "lower_body", "overall")
SPLITS = ("train", "validation", "test")
ATTRIBUTE_VALUES = {
    "sleeveLength": {"sleeveless", "short", "elbow", "three_quarter", "long", "not_applicable"},
    "neckline": {"crew", "round", "v_neck", "collared", "square", "sweetheart", "high", "strapless", "other", "not_applicable"},
    "hemLength": {"waist", "hip", "thigh", "knee", "midi", "ankle", "full", "not_applicable"},
    "layering": {"single", "layered"},
}
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{2,63}$")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(4 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def safe_path(dataset: Path, value: object) -> Path | None:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = (dataset / value).resolve()
    return candidate if candidate.is_relative_to(dataset.resolve()) else None


def inspect_image(path: Path, kind: str) -> dict[str, object]:
    with Image.open(path) as image:
        image.verify()
    with Image.open(path) as image:
        width, height = image.size
        mode = image.mode
    if kind == "product" and min(width, height) < 512:
        raise ValueError("product image must be at least 512 px on both axes")
    if kind == "person" and (width < 512 or height < 768 or height <= width):
        raise ValueError("person image must be portrait and at least 512x768")
    return {"width": width, "height": height, "mode": mode, "sha256": sha256(path)}


def validate_record(dataset: Path, record: object, line: int, issues: list[dict[str, object]]) -> dict[str, object] | None:
    def issue(code: str, message: str) -> None:
        issues.append({"severity": "error", "code": code, "line": line, "recordId": record.get("id") if isinstance(record, dict) else None, "message": message})

    if not isinstance(record, dict):
        issue("record.type", "Record must be a JSON object")
        return None
    required = ("id", "split", "category", "productId", "personId", "productImage", "personImage", "attributes", "quality", "provenance")
    for key in required:
        if key not in record:
            issue("record.missing", f"Missing required field: {key}")
    if any(key not in record for key in required):
        return None
    valid_identity = True
    if not isinstance(record["id"], str) or not ID_PATTERN.fullmatch(record["id"]):
        issue("record.id", "id must contain 3-64 lowercase letters, digits, underscores, or hyphens")
        valid_identity = False
    for name in ("productId", "personId"):
        if not isinstance(record[name], str) or not ID_PATTERN.fullmatch(record[name]):
            issue("record.identity", f"{name} must be a supplied, non-empty stable ID; do not infer person IDs from appearance")
            valid_identity = False
    if not valid_identity:
        return None
    if record["split"] not in SPLITS:
        issue("record.split", f"split must be one of: {', '.join(SPLITS)}")
    if record["category"] not in CATEGORIES:
        issue("record.category", f"category must be one of: {', '.join(CATEGORIES)}")

    attributes = record["attributes"]
    if not isinstance(attributes, dict):
        issue("attributes.type", "attributes must be an object")
    else:
        for name, allowed in ATTRIBUTE_VALUES.items():
            if attributes.get(name) not in allowed:
                issue(f"attributes.{name}", f"Invalid or missing {name}")
        if record["category"] in ("upper_body", "overall"):
            if attributes.get("sleeveLength") == "not_applicable" or attributes.get("neckline") == "not_applicable":
                issue("attributes.structure", "Upper-body and overall records require sleeve and neckline labels")
        if record["category"] in ("lower_body", "overall") and attributes.get("hemLength") == "not_applicable":
            issue("attributes.hem", "Lower-body and overall records require a hem-length label")

    quality = record["quality"]
    expected_quality = {"frontView": True, "fullGarmentVisible": True, "severeOcclusion": False}
    if not isinstance(quality, dict) or any(quality.get(key) is not value for key, value in expected_quality.items()):
        issue("quality.capture", "Pair must be front view, show the full garment, and have no severe occlusion")

    provenance = record["provenance"]
    if not isinstance(provenance, dict):
        issue("provenance.type", "provenance must be an object")
    else:
        if provenance.get("synthetic") is not False:
            issue("provenance.synthetic", "Generated or synthetic person targets are not accepted")
        if provenance.get("consentRecorded") is not True:
            issue("provenance.consent", "Recorded person consent is required")
        if provenance.get("commercialUseAllowed") is not True:
            issue("provenance.rights", "Commercial-use rights are required")
        if not isinstance(provenance.get("source"), str) or len(provenance["source"].strip()) < 3:
            issue("provenance.source", "A concrete data source is required")

    inspected = {}
    for field, kind in (("productImage", "product"), ("personImage", "person")):
        path = safe_path(dataset, record[field])
        if path is None:
            issue("image.path", f"{field} must stay inside the dataset directory")
            continue
        if not path.is_file():
            issue("image.missing", f"Missing {field}: {record[field]}")
            continue
        try:
            inspected[field] = inspect_image(path, kind)
        except Exception as error:
            issue("image.invalid", f"Invalid {field}: {error}")
    if inspected.get("productImage", {}).get("sha256") == inspected.get("personImage", {}).get("sha256"):
        issue("image.same", "Product and worn-person images must be different files")

    return {
        "id": record["id"],
        "split": record["split"],
        "category": record["category"],
        "productId": str(record["productId"]),
        "personId": str(record["personId"]),
        "images": inspected,
    }


def validate(dataset: Path, minimum_train: int, minimum_validation: int,
             categories=CATEGORIES, minimum_test=0, seen_manifests=()) -> dict[str, object]:
    categories = tuple(categories)
    if not categories or any(c not in CATEGORIES for c in categories):
        raise ValueError("Invalid category scope")
    manifest = dataset / "manifest.jsonl"
    issues: list[dict[str, object]] = []
    records: list[dict[str, object]] = []
    received_records = 0
    if not manifest.is_file():
        issues.append({"severity": "blocking", "code": "manifest.missing", "message": "manifest.jsonl has not been supplied"})
    else:
        for line_number, raw in enumerate(manifest.read_text(encoding="utf-8").splitlines(), start=1):
            if not raw.strip():
                continue
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError as error:
                issues.append({"severity": "error", "code": "manifest.json", "line": line_number, "message": str(error)})
                continue
            if isinstance(parsed, dict):
                received_records += 1
            checked = validate_record(dataset, parsed, line_number, issues)
            if checked is not None:
                records.append(checked)

    ids = Counter(record["id"] for record in records)
    for record_id, count in ids.items():
        if count > 1:
            issues.append({"severity": "error", "code": "record.duplicate", "recordId": record_id, "message": "Duplicate record id"})
    for field in ("productId", "personId"):
        split_map: dict[str, set[str]] = defaultdict(set)
        for record in records:
            split_map[record[field]].add(record["split"])
        for value, splits in split_map.items():
            if len(splits) > 1:
                issues.append({"severity": "error", "code": "split.leakage", field: value, "message": f"{field} appears in multiple splits: {sorted(splits)}"})

    image_splits = defaultdict(set)
    for record in records:
        for info in record['images'].values():
            image_splits[info['sha256']].add(record['split'])
    for digest, splits in image_splits.items():
        if len(splits) > 1:
            issues.append({'severity':'error', 'code':'split.image_leakage', 'sha256':digest,
                           'message':'Identical image content appears in multiple splits'})

    # The old validation set was used to select experiments. It cannot become
    # an independent test set merely by renaming its split or its files.
    seen_products, seen_people, seen_photos = set(), set(), set()
    for history_path in seen_manifests:
        history_path = Path(history_path)
        for raw in history_path.read_text(encoding='utf-8').splitlines():
            if not raw.strip():
                continue
            old = json.loads(raw)
            seen_products.add(old.get('productId'))
            person_id = old.get('personId') or old.get('personIdentity')
            if not person_id:
                issues.append({'severity':'error', 'code':'history.person_unverified',
                               'recordId':old.get('id'), 'message':'Supply historical person IDs before claiming person-independent testing'})
            else:
                seen_people.add(person_id)
            seen_photos.update(v for v in old.get('preparedHashes',{}).values() if isinstance(v,str))
            if old.get('sourceSha256'):
                seen_photos.add(old['sourceSha256'])
            for field in ('productImage','personImage'):
                value = old.get(field)
                if isinstance(value,str) and (history_path.parent/value).is_file():
                    seen_photos.add(sha256(history_path.parent/value))
    for record in records:
        if record['split'] == 'test' and (record['productId'] in seen_products or record['personId'] in seen_people or
                any(info['sha256'] in seen_photos for info in record['images'].values())):
            issues.append({'severity':'error','code':'test.previously_seen','recordId':record['id'],
                           'message':'Test product, person or photo was already used in an earlier experiment'})
        if record['category'] not in categories:
            issues.append({'severity':'error','code':'category.out_of_scope','recordId':record['id'],
                           'message':'Record category is outside the requested training scope'})

    counts = {split: {category: 0 for category in categories} for split in SPLITS}
    for record in records:
        if record["split"] in SPLITS and record["category"] in categories:
            counts[record["split"]][record["category"]] += 1
    missing_counts = []
    for category in categories:
        if counts["train"][category] < minimum_train:
            missing_counts.append({"split": "train", "category": category, "required": minimum_train, "actual": counts["train"][category]})
        if counts["validation"][category] < minimum_validation:
            missing_counts.append({"split": "validation", "category": category, "required": minimum_validation, "actual": counts["validation"][category]})
        if counts['test'][category] < minimum_test:
            missing_counts.append({'split':'test','category':category,'required':minimum_test,'actual':counts['test'][category]})

    errors = [issue for issue in issues if issue["severity"] == "error"]
    ready = not errors and not missing_counts and manifest.is_file()
    if errors:
        state = "invalid"
    elif ready:
        state = "ready"
    else:
        state = "needs_data"
    return {
        "schemaVersion": 2,
        "checkedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "datasetRoot": str(dataset),
        "manifest": str(manifest),
        "state": state,
        "readyForFineTune": ready,
        "realPairedRecords": len(records),
        "receivedRecords": received_records,
        "scope": list(categories),
        "historicalManifests": [str(p) for p in seen_manifests],
        "minimums": {"trainPerCategory": minimum_train, "validationPerCategory": minimum_validation, 'testPerCategory':minimum_test},
        "counts": counts,
        "missingCounts": missing_counts,
        "issues": issues,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--minimum-train-per-category", type=int, default=24)
    parser.add_argument("--minimum-validation-per-category", type=int, default=6)
    parser.add_argument('--categories', nargs='+', choices=CATEGORIES, default=list(CATEGORIES))
    parser.add_argument('--minimum-test-per-category', type=int, default=0)
    parser.add_argument('--seen-manifest', type=Path, action='append', default=[])
    parser.add_argument("--require-ready", action="store_true")
    parser.add_argument("--write-status", action=argparse.BooleanOptionalAction, default=True)
    args = parser.parse_args()
    dataset = args.dataset.resolve()
    result = validate(dataset, max(args.minimum_train_per_category, 1), max(args.minimum_validation_per_category, 1),
                      args.categories, max(args.minimum_test_per_category,0), args.seen_manifest)
    if args.write_status:
        dataset.mkdir(parents=True, exist_ok=True)
        (dataset / "dataset-status.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "state": result["state"],
        "readyForFineTune": result["readyForFineTune"],
        "realPairedRecords": result["realPairedRecords"],
        "receivedRecords": result["receivedRecords"],
        "missingSlots": sum(item["required"] - item["actual"] for item in result["missingCounts"]),
        "errors": sum(issue["severity"] == "error" for issue in result["issues"]),
    }, ensure_ascii=False))
    return 0 if result["readyForFineTune"] or not args.require_ready else 2


if __name__ == "__main__":
    raise SystemExit(main())

