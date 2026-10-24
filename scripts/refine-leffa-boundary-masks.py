"""Create tight, reference-guided masks for two Leffa boundary failures."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
INPUT_ROOT = ROOT / "workspace" / "diagnostics" / "synthetic-vton-reconstruction_20261021-final-inputs-v5"
OUTPUT = ROOT / "workspace" / "diagnostics" / "leffa-boundary-refinement_20261021-v4"
CASES = ("lower-body-09-p1", "overall-09-p1")
sys.path.insert(0, str(ROOT))


def overlay(source: Image.Image, mask: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    tint = Image.new("RGB", source.size, color)
    blended = Image.blend(source.convert("RGB"), tint, 0.52)
    return Image.composite(blended, source.convert("RGB"), mask.convert("L"))


def product_palette(product: Image.Image) -> np.ndarray:
    rgb = np.asarray(product.convert("RGB"), dtype=np.uint8)
    border = np.concatenate((rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]), axis=0).astype(np.float32)
    background = np.median(border, axis=0)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    foreground = np.logical_and(
        np.linalg.norm(rgb.astype(np.float32) - background[None, None, :], axis=2) > 28,
        hsv[:, :, 1] >= 40,
    )
    pixels = rgb[foreground]
    sampled = pixels[np.linspace(0, len(pixels) - 1, min(16000, len(pixels)), dtype=np.int32)]
    lab = cv2.cvtColor(sampled.reshape(-1, 1, 3), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    _, _, centers = cv2.kmeans(
        lab, 5, None,
        (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.25),
        5, cv2.KMEANS_PP_CENTERS,
    )
    return centers


def refine(source: Image.Image, product: Image.Image, prior: Image.Image, protected: Image.Image) -> tuple[Image.Image, dict]:
    import ai_service as ai

    rgb = np.asarray(source.convert("RGB"), dtype=np.uint8)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    centers = product_palette(product)
    distance = np.linalg.norm(lab[:, :, None, :] - centers[None, None, :, :], axis=3).min(axis=2)
    prior_support = np.asarray(prior.convert("L"), dtype=np.uint8) > 16
    search_support = cv2.dilate(
        prior_support.astype(np.uint8),
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (91, 91)),
        iterations=1,
    ) > 0
    protected_array = np.asarray(protected.convert("L"), dtype=np.uint8) > 16
    strong = np.logical_and(search_support, distance <= 30.0)
    foreground = cv2.morphologyEx(
        strong.astype(np.uint8),
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)),
    )
    foreground = cv2.morphologyEx(
        foreground,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)),
    )
    foreground[protected_array] = 0

    # Keep only regions tied to confident reference-color pixels.
    count, components, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    kept = np.zeros_like(foreground)
    for index in range(1, count):
        component = components == index
        seed_overlap = int(np.logical_and(component, strong).sum())
        prior_overlap = int(np.logical_and(component, prior_support).sum())
        if seed_overlap >= max(24, round(int(stats[index, cv2.CC_STAT_AREA]) * 0.008)) and prior_overlap >= 24:
            kept[component] = 1
    kept = cv2.morphologyEx(kept, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    kept = ai.fill_garment_mask_holes(kept).astype(np.uint8)
    kept[protected_array] = 0

    refined = Image.fromarray(kept * 255, mode="L")
    prior_pixels = int(prior_support.sum())
    refined_pixels = int(kept.sum())
    added_pixels = int(np.logical_and(kept > 0, ~prior_support).sum())
    removed_pixels = int(np.logical_and(prior_support, kept == 0).sum())
    return refined, {
        "priorPixels": prior_pixels,
        "refinedPixels": refined_pixels,
        "addedPixels": added_pixels,
        "removedPixels": removed_pixels,
        "retainedRatio": refined_pixels / max(1, prior_pixels),
        "strongSeedPixels": int(strong.sum()),
        "protectedOverlapPixels": int(np.logical_and(kept > 0, protected_array).sum()),
        "bbox": list(refined.getbbox() or ()),
    }


def make_audit(records: list[dict]) -> Path:
    columns = ("Target", "Prior mask", "Refined mask", "Changed area")
    cell_width, cell_height, header_height = 360, 500, 52
    sheet = Image.new("RGB", (len(columns) * cell_width, header_height + len(records) * cell_height), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, label in enumerate(columns):
        draw.text((index * cell_width + 10, 18), label, fill="black", font=font)
    for row_index, record in enumerate(records):
        case_dir = OUTPUT / record["id"]
        paths = [
            case_dir / "source-target.png", case_dir / "prior-overlay.png",
            case_dir / "tight-overlay.png", case_dir / "changed-overlay.png",
        ]
        y0 = header_height + row_index * cell_height
        draw.text((8, y0 + 6), record["id"], fill="black", font=font)
        for column_index, path in enumerate(paths):
            with Image.open(path) as image:
                thumb = ImageOps.contain(image.convert("RGB"), (cell_width - 20, cell_height - 42))
            x = column_index * cell_width + (cell_width - thumb.width) // 2
            y = y0 + 30 + (cell_height - 34 - thumb.height) // 2
            sheet.paste(thumb, (x, y))
    target = OUTPUT / "mask-audit.jpg"
    sheet.save(target, quality=95, optimize=True)
    return target


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=False)
    records = []
    for case_id in CASES:
        source = Image.open(INPUT_ROOT / case_id / "source-target.png").convert("RGB")
        product = Image.open(INPUT_ROOT / case_id / "product.png").convert("RGB")
        prior = Image.open(INPUT_ROOT / case_id / "garment-mask.png").convert("L")
        protected = Image.open(INPUT_ROOT / case_id / "protected-mask.png").convert("L")
        tight, metrics = refine(source, product, prior, protected)
        case_dir = OUTPUT / case_id
        case_dir.mkdir()
        source.save(case_dir / "source-target.png")
        product.save(case_dir / "product.png")
        prior.save(case_dir / "prior-mask.png")
        tight.save(case_dir / "tight-mask.png")
        protected.save(case_dir / "protected-mask.png")
        overlay(source, prior, (255, 40, 40)).save(case_dir / "prior-overlay.png")
        overlay(source, tight, (255, 40, 40)).save(case_dir / "tight-overlay.png")
        prior_array = np.asarray(prior, dtype=np.uint8) > 16
        tight_array = np.asarray(tight, dtype=np.uint8) > 16
        removed = np.logical_and(prior_array, ~tight_array)
        added = np.logical_and(~prior_array, tight_array)
        changed = source.copy()
        changed = overlay(changed, Image.fromarray((removed * 255).astype(np.uint8), mode="L"), (40, 110, 255))
        changed = overlay(changed, Image.fromarray((added * 255).astype(np.uint8), mode="L"), (30, 210, 80))
        changed.save(case_dir / "changed-overlay.png")
        records.append({"id": case_id, **metrics})

    audit = make_audit(records)
    report = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "method": "reference-color seeded GrabCut",
        "sourcePreparation": INPUT_ROOT.relative_to(ROOT).as_posix(),
        "thresholdsChanged": False,
        "cases": records,
        "audit": audit.relative_to(ROOT).as_posix(),
    }
    (OUTPUT / "mask-refinement.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"directory": str(OUTPUT.relative_to(ROOT)), "cases": records}, ensure_ascii=False))


if __name__ == "__main__":
    main()
