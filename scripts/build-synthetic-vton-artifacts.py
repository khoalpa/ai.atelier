from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "samples" / "synthetic-paired-vton-20261021"
PRODUCTS = DATASET / "images" / "products"
PEOPLE = DATASET / "images" / "people"
PREVIEWS = DATASET / "previews"
SPECS_PATH = DATASET / "specs.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_png(path: Path) -> dict:
    if not path.is_file():
        raise FileNotFoundError(path)
    with Image.open(path) as image:
        image.verify()
    with Image.open(path) as image:
        width, height = image.size
        if image.format != "PNG":
            raise ValueError(f"Expected PNG: {path}")
        if width < 768 or height < 1024:
            raise ValueError(f"Image below 768x1024: {path} ({width}x{height})")
    return {
        "width": width,
        "height": height,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def build_contact_sheet(category: str, products: list[dict]) -> Path:
    cell_width = 300
    cell_height = 340
    header_height = 54
    canvas = Image.new(
        "RGB", (cell_width * 4, header_height + cell_height * len(products)), "white"
    )
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    headings = ("Product", "Person 1", "Person 2", "Person 3")
    for column, heading in enumerate(headings):
        draw.text((column * cell_width + 12, 18), heading, fill="black", font=font)

    for row, product in enumerate(products):
        product_id = product["id"]
        image_paths = [PRODUCTS / f"{product_id}.png"] + [
            PEOPLE / f"{product_id}-p{variant}.png" for variant in range(1, 4)
        ]
        y0 = header_height + row * cell_height
        draw.text((8, y0 + 8), product_id, fill="black", font=font)
        for column, image_path in enumerate(image_paths):
            with Image.open(image_path) as source:
                thumb = ImageOps.contain(source.convert("RGB"), (cell_width - 20, cell_height - 46))
            x = column * cell_width + (cell_width - thumb.width) // 2
            y = y0 + 34 + (cell_height - 42 - thumb.height) // 2
            canvas.paste(thumb, (x, y))
        draw.line((0, y0 + cell_height - 1, canvas.width, y0 + cell_height - 1), fill="#dddddd")

    output = PREVIEWS / f"{category.replace('_', '-')}-contact-sheet.jpg"
    canvas.save(output, quality=92, optimize=True)
    return output


def main() -> None:
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    specs = json.loads(SPECS_PATH.read_text(encoding="utf-8"))
    products = specs["products"]
    if len(products) != 30:
        raise ValueError(f"Expected 30 products, found {len(products)}")

    records = []
    files = {}
    for product in products:
        product_id = product["id"]
        product_path = PRODUCTS / f"{product_id}.png"
        files[product_path.relative_to(DATASET).as_posix()] = inspect_png(product_path)
        for variant in range(1, 4):
            pair_id = f"{product_id}-p{variant}"
            person_path = PEOPLE / f"{pair_id}.png"
            files[person_path.relative_to(DATASET).as_posix()] = inspect_png(person_path)
            record = {
                "id": pair_id,
                "productId": product_id,
                "personVariant": variant,
                "category": product["category"],
                "split": product["split"],
                "productImage": product_path.relative_to(DATASET).as_posix(),
                "personImage": person_path.relative_to(DATASET).as_posix(),
                "labels": {
                    key: product[key]
                    for key in ("color", "sleeveLength", "neckline", "hemLength")
                    if key in product
                },
                "description": product["description"],
                "provenance": {
                    "synthetic": True,
                    "generator": "OpenAI ImageGen",
                    "adultFictionalPerson": True,
                    "humanConsent": "not_applicable_synthetic",
                    "commercialUse": "subject_to_applicable_generation_terms",
                },
            }
            records.append(record)

    if len(records) != 90:
        raise ValueError(f"Expected 90 pairs, found {len(records)}")

    manifest_path = DATASET / "manifest.jsonl"
    manifest_text = "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records)
    manifest_path.write_text(manifest_text, encoding="utf-8")

    preview_paths = []
    for category in ("upper_body", "lower_body", "overall"):
        preview_paths.append(build_contact_sheet(category, [p for p in products if p["category"] == category]))

    category_counts = Counter(record["category"] for record in records)
    split_counts = Counter(record["split"] for record in records)
    status = {
        "datasetId": specs["datasetId"],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "provenance": "photorealistic synthetic",
        "counts": {
            "products": len(products),
            "pairs": len(records),
            "productImages": len(list(PRODUCTS.glob("*.png"))),
            "personImages": len(list(PEOPLE.glob("*.png"))),
            "categories": dict(sorted(category_counts.items())),
            "splits": dict(sorted(split_counts.items())),
        },
        "validation": {
            "allFilesReadablePng": True,
            "allImagesAtLeast768x1024": True,
            "productLeakageAcrossSplits": False,
            "manifestSha256": sha256(manifest_path),
        },
        "usage": {
            "readyForSyntheticPipelineTesting": True,
            "readyForProductionFineTune": False,
            "reason": "Synthetic data cannot replace licensed real paired photographs with recorded consent for production fine-tuning.",
        },
        "previews": [path.relative_to(DATASET).as_posix() for path in preview_paths],
        "files": files,
    }
    (DATASET / "dataset-status.json").write_text(
        json.dumps(status, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(json.dumps({key: status[key] for key in ("counts", "validation", "usage")}, indent=2))


if __name__ == "__main__":
    main()
