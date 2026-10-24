"""Prepare nine held-out synthetic reconstruction gates for IDM-VTON and Leffa."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sample_catalog import collection_path
DATASET = collection_path(ROOT, 'synthetic-paired-vton-20261021')
OUTPUT = ROOT / "workspace" / "diagnostics" / "synthetic-vton-reconstruction_20261021-final-inputs-v5"

PRODUCTS = {
    "upper_body": "upper-body-09",
    "lower_body": "lower-body-09",
    "overall": "overall-09",
}


def overlay(source: Image.Image, mask: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    tint = Image.new("RGB", source.size, color)
    blended = Image.blend(source.convert("RGB"), tint, 0.52)
    return Image.composite(blended, source.convert("RGB"), mask.convert("L"))


def reference_guided_mask(
    source: Image.Image,
    product: Image.Image,
    automatic: Image.Image,
    protected: Image.Image,
    category: str,
    person_box: list[float],
    keypoints: list[list[float]] | None,
) -> tuple[Image.Image, dict]:
    """Use reference colors as seeds for the full connected garment region."""
    import cv2

    source_rgb = np.asarray(source.convert("RGB"), dtype=np.uint8)
    product_rgb = np.asarray(product.convert("RGB"), dtype=np.uint8)
    border = np.concatenate(
        (product_rgb[0], product_rgb[-1], product_rgb[:, 0], product_rgb[:, -1]), axis=0
    ).astype(np.float32)
    background = np.median(border, axis=0)
    foreground = np.linalg.norm(product_rgb.astype(np.float32) - background[None, None, :], axis=2) > 28
    reference_pixels = product_rgb[foreground]
    if len(reference_pixels) < 128:
        raise ValueError("Product foreground is too small for a reference-guided mask")
    sampled = reference_pixels[
        np.linspace(0, len(reference_pixels) - 1, min(12000, len(reference_pixels)), dtype=np.int32)
    ]
    sampled_lab = cv2.cvtColor(sampled.reshape(-1, 1, 3), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
    _, _, centers = cv2.kmeans(
        sampled_lab,
        4,
        None,
        (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.35),
        4,
        cv2.KMEANS_PP_CENTERS,
    )
    source_lab = cv2.cvtColor(source_rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    color_distance = np.linalg.norm(source_lab[:, :, None, :] - centers[None, None, :, :], axis=3).min(axis=2)

    height, width = color_distance.shape
    x0, y0, x1, y1 = [float(value) for value in person_box]
    pw, ph = max(1.0, x1 - x0), max(1.0, y1 - y0)
    bounds = {
        "upper_body": (0.08, 0.12, 0.92, 0.60),
        "lower_body": (0.08, 0.36, 0.92, 0.82),
        "overall": (0.06, 0.12, 0.94, 0.84),
    }[category]
    allowed = np.zeros((height, width), dtype=np.uint8)
    left = max(0, round(x0 + bounds[0] * pw))
    top = max(0, round(y0 + bounds[1] * ph))
    right = min(width, round(x0 + bounds[2] * pw))
    bottom = min(height, round(y0 + bounds[3] * ph))
    allowed[top:bottom, left:right] = 1

    structural = allowed.copy()
    reliable = lambda index: bool(keypoints and index < len(keypoints) and keypoints[index][2] > 0.25)
    if all(reliable(index) for index in (5, 6, 11, 12, 13, 14)):
        shoulder_width = max(20.0, abs(keypoints[6][0] - keypoints[5][0]))
        structural = np.zeros_like(allowed)
        shoulders = sorted([keypoints[5], keypoints[6]], key=lambda point: point[0])
        hips = sorted([keypoints[11], keypoints[12]], key=lambda point: point[0])
        knees = sorted([keypoints[13], keypoints[14]], key=lambda point: point[0])
        if category == "upper_body":
            torso = np.asarray([
                [shoulders[0][0] - shoulder_width * 0.18, shoulders[0][1] - ph * 0.025],
                [shoulders[1][0] + shoulder_width * 0.18, shoulders[1][1] - ph * 0.025],
                [hips[1][0] + shoulder_width * 0.28, hips[1][1] + ph * 0.015],
                [hips[0][0] - shoulder_width * 0.28, hips[0][1] + ph * 0.015],
            ], dtype=np.int32)
            cv2.fillConvexPoly(structural, torso, 1)
        elif category == "lower_body":
            waist_y = float(np.mean([hips[0][1], hips[1][1]])) - ph * 0.10
            knee_y = float(np.mean([knees[0][1], knees[1][1]])) + ph * 0.035
            skirt = np.asarray([
                [hips[0][0] - shoulder_width * 0.30, waist_y],
                [hips[1][0] + shoulder_width * 0.30, waist_y],
                [knees[1][0] + shoulder_width * 0.50, knee_y],
                [knees[0][0] - shoulder_width * 0.50, knee_y],
            ], dtype=np.int32)
            cv2.fillConvexPoly(structural, skirt, 1)
        else:
            torso = np.asarray([
                [shoulders[0][0] - shoulder_width * 0.18, shoulders[0][1] - ph * 0.025],
                [shoulders[1][0] + shoulder_width * 0.18, shoulders[1][1] - ph * 0.025],
                [hips[1][0] + shoulder_width * 0.22, hips[1][1]],
                [hips[0][0] - shoulder_width * 0.22, hips[0][1]],
            ], dtype=np.int32)
            cv2.fillConvexPoly(structural, torso, 1)
            knee_y = float(np.mean([knees[0][1], knees[1][1]])) + ph * 0.04
            skirt = np.asarray([
                [hips[0][0] - shoulder_width * 0.24, hips[0][1] - ph * 0.02],
                [hips[1][0] + shoulder_width * 0.24, hips[1][1] - ph * 0.02],
                [knees[1][0] + shoulder_width * 1.75, knee_y],
                [knees[0][0] - shoulder_width * 1.75, knee_y],
            ], dtype=np.int32)
            cv2.fillConvexPoly(structural, skirt, 1)
            for shoulder_index, elbow_index in ((5, 7), (6, 8)):
                shoulder = np.asarray(keypoints[shoulder_index][:2], dtype=np.float32)
                elbow = np.asarray(keypoints[elbow_index][:2], dtype=np.float32)
                end = shoulder + (elbow - shoulder) * 0.48
                cv2.line(
                    structural,
                    tuple(np.rint(shoulder).astype(int)),
                    tuple(np.rint(end).astype(int)),
                    1,
                    max(12, round(shoulder_width * 0.38)),
                )
        structural[allowed == 0] = 0

    auto = (np.asarray(automatic.convert("L"), dtype=np.uint8) > 16).astype(np.uint8)
    auto_support = cv2.dilate(auto, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)), iterations=1)
    seeds = np.logical_and.reduce((color_distance <= 32.0, structural > 0, auto_support > 0)).astype(np.uint8)
    seeds = cv2.morphologyEx(seeds, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    if int(seeds.sum()) < 96:
        raise ValueError("Reference-guided mask found too few garment color seeds")

    # Limit the vertical extent to the garment colors so a skirt/dress component
    # cannot leak into bare legs that touch the automatic garment region.
    seed_rows = np.flatnonzero(seeds.any(axis=1))
    vertical = np.zeros_like(structural)
    row_pad = max(5, round(ph * 0.012))
    seed_top = max(0, int(seed_rows.min()) - row_pad)
    seed_bottom = min(height, int(seed_rows.max()) + row_pad + 1)
    vertical[seed_top:seed_bottom] = 1

    candidate = np.logical_and(
        np.logical_or(auto_support > 0, seeds > 0),
        np.logical_and(structural > 0, vertical > 0),
    ).astype(np.uint8)
    candidate = cv2.morphologyEx(candidate, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
    candidate = ai_fill_mask_holes(candidate)

    count, labels, stats, _ = cv2.connectedComponentsWithStats(candidate, 8)
    if count <= 1:
        raise ValueError("Reference-guided mask found no garment component")
    keep = np.zeros_like(candidate)
    for index in range(1, count):
        component = labels == index
        seed_overlap = int(np.logical_and(component, seeds > 0).sum())
        if seed_overlap >= max(32, round(int(stats[index, cv2.CC_STAT_AREA]) * 0.01)):
            keep[labels == index] = 1
    if not keep.any():
        raise ValueError("Reference-guided mask found no component connected to garment colors")
    keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    keep = ai_fill_mask_holes(keep)
    keep = cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)), iterations=1)
    keep[structural == 0] = 0
    keep[vertical == 0] = 0
    keep[np.asarray(protected.convert("L"), dtype=np.uint8) > 16] = 0
    mask = Image.fromarray(keep * 255, mode="L")
    person_pixels = max(1.0, (x1 - x0) * (y1 - y0))
    relative_coverage = float((keep > 0).sum() / person_pixels)
    return mask, {
        "paletteCentersLab": [[round(float(value), 3) for value in center] for center in centers],
        "colorDistanceThreshold": 32.0,
        "meanAcceptedColorDistance": float(color_distance[keep > 0].mean()) if (keep > 0).any() else None,
        "colorSeedPixels": int(seeds.sum()),
        "verticalSeedRange": [seed_top, seed_bottom],
        "allowedBox": [left, top, right, bottom],
        "relativePersonCoverage": relative_coverage,
        "accepted": bool(relative_coverage >= 0.045),
    }


def ai_fill_mask_holes(mask: np.ndarray) -> np.ndarray:
    import ai_service as ai

    return ai.fill_garment_mask_holes(mask).astype(np.uint8)


def make_sheet(rows: list[dict]) -> Path:
    columns = ("Product", "Source / target", "Automatic mask", "Refined mask", "Protected", "DensePose")
    cell_width, cell_height, header_height = 300, 340, 54
    sheet = Image.new("RGB", (cell_width * len(columns), header_height + cell_height * len(rows)), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, label in enumerate(columns):
        draw.text((index * cell_width + 10, 18), label, fill="black", font=font)
    for row_index, record in enumerate(rows):
        case_dir = OUTPUT / record["id"]
        paths = [
            case_dir / "product.png",
            case_dir / "source-target.png",
            case_dir / "automatic-mask-overlay.png",
            case_dir / "mask-overlay.png",
            case_dir / "protected-overlay.png",
            case_dir / "densepose.png",
        ]
        y0 = header_height + row_index * cell_height
        draw.text((8, y0 + 7), record["id"], fill="black", font=font)
        for column_index, path in enumerate(paths):
            with Image.open(path) as image:
                thumb = ImageOps.contain(image.convert("RGB"), (cell_width - 18, cell_height - 46))
            x = column_index * cell_width + (cell_width - thumb.width) // 2
            y = y0 + 34 + (cell_height - 42 - thumb.height) // 2
            sheet.paste(thumb, (x, y))
        draw.line((0, y0 + cell_height - 1, sheet.width, y0 + cell_height - 1), fill="#dddddd")
    target = OUTPUT / "input-audit.jpg"
    sheet.save(target, quality=92, optimize=True)
    return target


def main() -> None:
    import ai_service as ai
    from idm_vton_runtime import densepose_image

    OUTPUT.mkdir(parents=True, exist_ok=False)
    records = []
    for category, product_id in PRODUCTS.items():
        for variant in range(1, 4):
            case_id = f"{product_id}-p{variant}"
            case_dir = OUTPUT / case_id
            case_dir.mkdir()
            source_path = DATASET / "images" / "people" / f"{case_id}.png"
            product_path = DATASET / "images" / "products" / f"{product_id}.png"
            source = Image.open(source_path).convert("RGB")
            product = Image.open(product_path).convert("RGB")
            people = ai.detect_people(source, True)
            if not people:
                raise RuntimeError(f"No person detected for {case_id}")
            person = max(people, key=lambda item: (item["box"][2] - item["box"][0]) * (item["box"][3] - item["box"][1]))
            automatic_mask, confidence = ai.automatic_garment_mask(
                source, category, person["box"], person.get("keypoints")
            )
            protected = ai.automatic_protected_detail_mask(
                source, person["box"], person.get("keypoints")
            )
            automatic_mask = ai.exclude_protected_pixels(automatic_mask, protected).point(lambda value: 255 if value > 16 else 0)
            mask, reference_mask = reference_guided_mask(
                source, product, automatic_mask, protected, category, person["box"], person.get("keypoints")
            )
            policy = ai.mask_strength_policy(mask, person["box"], category, person.get("keypoints"))
            automatic_policy = ai.mask_strength_policy(
                automatic_mask, person["box"], category, person.get("keypoints")
            )
            pose = densepose_image(source, ai.DENSEPOSE_SCRIPT)

            source.save(case_dir / "source-target.png")
            product.save(case_dir / "product.png")
            automatic_mask.save(case_dir / "automatic-mask.png")
            mask.save(case_dir / "garment-mask.png")
            protected.save(case_dir / "protected-mask.png")
            pose.save(case_dir / "densepose.png")
            overlay(source, automatic_mask, (255, 40, 40)).save(case_dir / "automatic-mask-overlay.png")
            overlay(source, mask, (255, 40, 40)).save(case_dir / "mask-overlay.png")
            overlay(source, protected, (30, 110, 255)).save(case_dir / "protected-overlay.png")

            mask_array = np.asarray(mask, dtype=np.uint8) > 16
            protected_array = np.asarray(protected, dtype=np.uint8) > 16
            records.append({
                "id": case_id,
                "category": category,
                "productId": product_id,
                "variant": variant,
                "sourceTarget": source_path.relative_to(ROOT).as_posix(),
                "product": product_path.relative_to(ROOT).as_posix(),
                "directory": case_dir.relative_to(ROOT).as_posix(),
                "mask": (case_dir / "garment-mask.png").relative_to(ROOT).as_posix(),
                "densepose": (case_dir / "densepose.png").relative_to(ROOT).as_posix(),
                "personBox": person["box"],
                "maskConfidence": float(confidence),
                "automaticMaskPolicy": automatic_policy,
                "maskPolicy": policy,
                "referenceMask": reference_mask,
                "automaticMaskPixels": int((np.asarray(automatic_mask, dtype=np.uint8) > 16).sum()),
                "maskPixels": int(mask_array.sum()),
                "protectedOverlapPixels": int(np.logical_and(mask_array, protected_array).sum()),
            })

    audit_path = make_sheet(records)
    report = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "dataset": DATASET.relative_to(ROOT).as_posix(),
        "mode": "masked self-reconstruction",
        "purpose": "Validate preprocessing and product reconstruction before any synthetic fine-tune smoke run.",
        "thresholdsChanged": False,
        "requiredCases": 9,
        "preparedCases": len(records),
        "allMasksAccepted": all(row["referenceMask"]["accepted"] for row in records),
        "allProtectedOverlapZero": all(row["protectedOverlapPixels"] == 0 for row in records),
        "inputAudit": audit_path.relative_to(ROOT).as_posix(),
        "cases": records,
    }
    (OUTPUT / "preparation.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({
        "directory": str(OUTPUT.relative_to(ROOT)),
        "preparedCases": len(records),
        "allMasksAccepted": report["allMasksAccepted"],
        "allProtectedOverlapZero": report["allProtectedOverlapZero"],
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
