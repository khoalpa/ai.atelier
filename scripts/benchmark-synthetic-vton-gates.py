"""Benchmark official IDM-VTON DressCode and Leffa DressCode on nine held-out cases."""

from __future__ import annotations

import argparse
import gc
import json
import math
import shutil
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sample_catalog import collection_path, project_path
LEFFA_ROOT = ROOT / "vendor" / "Leffa"
DATASET = collection_path(ROOT, 'synthetic-paired-vton-20261021')
INPUT_ROOT = ROOT / "workspace" / "diagnostics" / "synthetic-vton-reconstruction_20261021-final-inputs-v5"
OUTPUT = ROOT / "workspace" / "diagnostics" / "synthetic-vton-model-benchmark_20261021"
IDM_DC = ROOT / "models" / "tryon" / "IDM-VTON-DC"
LEFFA_DC = ROOT / "models" / "tryon" / "Leffa-DC"
POSE_CHECKPOINT = ROOT / "models" / "pose" / "densepose" / "densepose_r50_fpn_dl_fixed.torchscript"
sys.path.insert(0, str(LEFFA_ROOT))

THRESHOLDS = {
    "colorMaterialAccepted": True,
    "geometryAccepted": True,
    "minimumSeamScore": 80.0,
    "minimumAnatomyScore": 95.0,
    "minimumReferenceSimilarity": 0.6,
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_cases() -> list[dict]:
    preparation = json.loads((INPUT_ROOT / "preparation.json").read_text(encoding="utf-8"))
    specs = json.loads((DATASET / "specs.json").read_text(encoding="utf-8"))
    descriptions = {item["id"]: item["description"] for item in specs["products"]}
    cases = []
    for index, item in enumerate(preparation["cases"]):
        cases.append({
            **item,
            "seed": 61001 + index,
            "description": descriptions[item["productId"]],
        })
    if len(cases) != 9:
        raise RuntimeError(f"Expected 9 prepared cases, found {len(cases)}")
    return cases


def reconstruction_metrics(target: Image.Image, result: Image.Image, mask: Image.Image) -> dict:
    expected = np.asarray(target.convert("RGB"), dtype=np.float32)
    actual = np.asarray(result.convert("RGB"), dtype=np.float32)
    selected = np.asarray(mask.convert("L"), dtype=np.uint8) > 16
    delta = actual[selected] - expected[selected]
    mae = float(np.abs(delta).mean()) if delta.size else 255.0
    rmse = float(np.sqrt(np.square(delta).mean())) if delta.size else 255.0
    psnr = float(20.0 * math.log10(255.0 / max(rmse, 1e-8)))
    return {"maskedMAE255": mae, "maskedRMSE255": rmse, "maskedPSNR": psnr}


def score_case(ai, source: Image.Image, product: Image.Image, result: Image.Image, mask: Image.Image) -> dict:
    metrics = ai.score_tryon_result(source, result, mask)
    metrics["referenceSimilarity"] = ai.reference_similarity(product, result, mask)
    metrics.update(reconstruction_metrics(source, result, mask))
    color = ai.color_material_consistency(product, result, mask)
    geometry = ai.catvton_geometry_consistency(result, mask)
    passed = bool(
        color["accepted"]
        and geometry["accepted"]
        and metrics["seamScore"] >= THRESHOLDS["minimumSeamScore"]
        and metrics["anatomyScore"] >= THRESHOLDS["minimumAnatomyScore"]
        and metrics["referenceSimilarity"] >= THRESHOLDS["minimumReferenceSimilarity"]
    )
    return {"metrics": metrics, "colorMaterial": color, "geometry": geometry, "automaticPassed": passed}


def resize_and_center(image: Image.Image, width: int = 768, height: int = 1024) -> tuple[Image.Image, tuple[int, int, int, int]]:
    rgb = np.asarray(image.convert("RGB"))
    source_height, source_width = rgb.shape[:2]
    scale = min(height / source_height, width / source_width)
    resized_width = int(source_width * scale)
    resized_height = int(source_height * scale)
    resized = cv2.resize(rgb, (resized_width, resized_height), interpolation=cv2.INTER_CUBIC)
    canvas = np.full((height, width, 3), 255, dtype=np.uint8)
    left = (width - resized_width) // 2
    top = (height - resized_height) // 2
    canvas[top:top + resized_height, left:left + resized_width] = resized
    return Image.fromarray(canvas), (left, top, left + resized_width, top + resized_height)


def resize_and_center_mask(mask: Image.Image, width: int = 768, height: int = 1024) -> Image.Image:
    array = np.asarray(mask.convert("L"))
    source_height, source_width = array.shape
    scale = min(height / source_height, width / source_width)
    resized_width = int(source_width * scale)
    resized_height = int(source_height * scale)
    resized = cv2.resize(array, (resized_width, resized_height), interpolation=cv2.INTER_NEAREST)
    canvas = np.zeros((height, width), dtype=np.uint8)
    left = (width - resized_width) // 2
    top = (height - resized_height) // 2
    canvas[top:top + resized_height, left:left + resized_width] = resized
    return Image.fromarray(canvas, mode="L")


def densepose_labels(image: Image.Image, model) -> Image.Image:
    from torch.nn import functional as functional

    rgb = np.asarray(image.convert("RGB").resize((384, 512)))
    tensor = torch.from_numpy(rgb[:, :, ::-1].copy()).permute(2, 0, 1)
    with torch.inference_mode():
        boxes, coarse, fine, _, _ = model(tensor)
    if len(boxes) == 0:
        raise ValueError("DensePose did not find a person")
    canvas = np.zeros((512, 384), dtype=np.uint8)
    for index, box in enumerate(boxes):
        x0, y0, x1, y1 = box.tolist()
        x, y = int(x0), int(y0)
        box_width, box_height = max(int(x1 - x0), 1), max(int(y1 - y0), 1)
        coarse_labels = functional.interpolate(
            coarse[index:index + 1], (box_height, box_width), mode="bilinear", align_corners=False
        ).argmax(1)
        fine_labels = functional.interpolate(
            fine[index:index + 1], (box_height, box_width), mode="bilinear", align_corners=False
        ).argmax(1)
        labels = (fine_labels * (coarse_labels > 0)).squeeze(0).numpy().astype(np.uint8)
        left, top = max(x, 0), max(y, 0)
        right, bottom = min(x + box_width, 384), min(y + box_height, 512)
        if left < right and top < bottom:
            region = labels[top - y:bottom - y, left - x:right - x]
            canvas[top:bottom, left:right] = np.where(region > 0, region, canvas[top:bottom, left:right])
    return Image.fromarray(np.repeat(canvas[:, :, None], 3, axis=2), mode="RGB")


def save_report(model_name: str, records: list[dict], configuration: dict, load_seconds: float) -> None:
    report = {
        "schemaVersion": 1,
        "createdAt": utc_now(),
        "model": model_name,
        "checkpoint": configuration.pop("checkpoint"),
        "inputPreparation": INPUT_ROOT.relative_to(ROOT).as_posix(),
        "mode": "masked self-reconstruction",
        "thresholdsChanged": False,
        "thresholds": THRESHOLDS,
        "configuration": configuration,
        "loadSeconds": load_seconds,
        "requiredCases": 9,
        "completedCases": sum(row["status"] == "completed" for row in records),
        "passedCases": sum(bool(row.get("automaticPassed")) for row in records),
        "cases": records,
    }
    (OUTPUT / f"{model_name}-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def run_idm() -> int:
    import ai_service as ai
    from idm_vton_runtime import load_pipeline

    if not (IDM_DC / "unet" / "diffusion_pytorch_model.bin").is_file():
        raise RuntimeError("IDM-VTON DressCode checkpoint is missing")
    cases = load_cases()
    model_dir = OUTPUT / "idm-vton-dc"
    model_dir.mkdir(parents=True, exist_ok=True)
    original_loader = ai.load_tryon_pipe
    diagnostic_pipe = None
    load_seconds = 0.0

    def diagnostic_loader(model_id="idm-vton"):
        nonlocal diagnostic_pipe, load_seconds
        if diagnostic_pipe is None:
            started = time.perf_counter()
            diagnostic_pipe = load_pipeline(ai.IDMVTON_MODEL, ai.IDMVTON_ROOT, ai.device, unet_model_path=IDM_DC)
            load_seconds = time.perf_counter() - started
        return diagnostic_pipe

    ai.load_tryon_pipe = diagnostic_loader
    records = []
    try:
        for case in cases:
            case_dir = model_dir / case["id"]
            case_dir.mkdir(parents=True, exist_ok=True)
            source = Image.open(project_path(ROOT,case["sourceTarget"])).convert("RGB")
            product = Image.open(project_path(ROOT,case["product"])).convert("RGB")
            mask = Image.open(ROOT / case["mask"]).convert("L")
            started = time.perf_counter()
            record = {
                "id": case["id"], "category": case["category"], "seed": case["seed"],
                "description": case["description"], "status": "running",
            }
            try:
                result = ai.tryon({
                    "modelId": "idm-vton",
                    "sampleId": str(Path(case["sourceTarget"]).relative_to("samples")).replace("\\", "/"),
                    "category": case["category"],
                    "garmentImage": ai.encode_image(product),
                    "editableMask": ai.encode_image(mask),
                    "autoMask": False,
                    "reconstructExposedBody": False,
                    "garmentDescription": case["description"],
                    "seed": case["seed"], "steps": 20, "maxSide": 512, "guidance": 2.5,
                    "count": 1, "expand": 0, "blur": 6, "repairSeams": False,
                    "generativeRefine": False, "maxRetries": 0,
                    "minimumQuality": 0, "minimumSimilarity": 0, "minimumSeam": 0, "minimumAnatomy": 0,
                })
                selected = ROOT / result["selected"]
                final = Image.open(selected).convert("RGB")
                final.save(case_dir / "final.png")
                effective = Image.open(selected.parent / "editable_mask.png").convert("L")
                effective.save(case_dir / "effective-mask.png")
                shutil.copy2(ROOT / case["densepose"], case_dir / "densepose.png")
                record.update(
                    status="completed", elapsedSeconds=time.perf_counter() - started,
                    modelWidth=result.get("width"), modelHeight=result.get("height"),
                    selected=(case_dir / "final.png").relative_to(ROOT).as_posix(),
                    **score_case(ai, source, product, final, effective),
                )
            except Exception:
                record.update(status="failed", elapsedSeconds=time.perf_counter() - started, error=traceback.format_exc())
            records.append(record)
            save_report("idm-vton-dc", records, {
                "checkpoint": "yisol/IDM-VTON-DC", "steps": 20, "guidance": 2.5,
                "maxSide": 512, "blur": 6, "expand": 0,
            }, load_seconds)
            print(json.dumps({"model": "idm-vton-dc", "case": case["id"], "status": record["status"], "passed": record.get("automaticPassed")}), flush=True)
    finally:
        ai.load_tryon_pipe = original_loader
        diagnostic_pipe = None
        ai.release_tryon()
        gc.collect()
        torch.cuda.empty_cache()
    return 0 if all(row["status"] == "completed" for row in records) else 1


def run_leffa() -> int:
    import torchvision  # noqa: F401 - registers torchvision::nms for the scripted model
    import ai_service as ai
    from leffa.inference import LeffaInference
    from leffa.model import LeffaModel
    from leffa.transform import LeffaTransform

    weight = LEFFA_DC / "virtual_tryon_dc.pth"
    base_model = LEFFA_DC / "stable-diffusion-inpainting"
    for required in (weight, base_model / "unet" / "config.json", POSE_CHECKPOINT):
        if not required.is_file():
            raise RuntimeError(f"Required Leffa file is missing: {required}")
    cases = load_cases()
    model_dir = OUTPUT / "leffa-dc"
    model_dir.mkdir(parents=True, exist_ok=True)
    load_started = time.perf_counter()
    model = LeffaModel(
        pretrained_model_name_or_path=str(base_model), pretrained_model=str(weight), dtype="float16"
    )
    inference = LeffaInference(model=model)
    transform = LeffaTransform(height=1024, width=768)
    pose_model = torch.jit.load(str(POSE_CHECKPOINT), map_location="cpu").eval()
    load_seconds = time.perf_counter() - load_started
    records = []
    try:
        for case in cases:
            case_dir = model_dir / case["id"]
            case_dir.mkdir(parents=True, exist_ok=True)
            source = Image.open(project_path(ROOT,case["sourceTarget"])).convert("RGB")
            product = Image.open(project_path(ROOT,case["product"])).convert("RGB")
            mask = Image.open(ROOT / case["mask"]).convert("L")
            source_canvas, content_box = resize_and_center(source)
            product_canvas, _ = resize_and_center(product)
            mask_canvas = resize_and_center_mask(mask)
            pose = densepose_labels(source_canvas, pose_model)
            source_canvas.save(case_dir / "model-source.png")
            product_canvas.save(case_dir / "model-reference.png")
            mask_canvas.save(case_dir / "model-mask.png")
            pose.save(case_dir / "model-densepose.png")
            record = {
                "id": case["id"], "category": case["category"], "seed": case["seed"],
                "description": case["description"], "status": "running",
            }
            started = time.perf_counter()
            try:
                data = transform({
                    "src_image": [source_canvas], "ref_image": [product_canvas],
                    "mask": [mask_canvas], "densepose": [pose],
                })
                torch.cuda.reset_peak_memory_stats()
                output = inference(
                    data, ref_acceleration=False, num_inference_steps=30,
                    guidance_scale=2.5, seed=case["seed"], repaint=True,
                )
                torch.cuda.synchronize()
                raw = output["generated_image"][0].convert("RGB")
                raw.save(case_dir / "raw.png")
                final = raw.crop(content_box).resize(source.size, Image.Resampling.LANCZOS)
                final.save(case_dir / "final.png")
                record.update(
                    status="completed", elapsedSeconds=time.perf_counter() - started,
                    peakAllocatedMiB=torch.cuda.max_memory_allocated() / 2 ** 20,
                    modelWidth=768, modelHeight=1024,
                    selected=(case_dir / "final.png").relative_to(ROOT).as_posix(),
                    **score_case(ai, source, product, final, mask),
                )
            except Exception:
                record.update(status="failed", elapsedSeconds=time.perf_counter() - started, error=traceback.format_exc())
            records.append(record)
            save_report("leffa-dc", records, {
                "checkpoint": "franciszzj/Leffa virtual_tryon_dc.pth",
                "checkpointRevision": "61d3390f444506f052feedb0b243cd5369c29c89",
                "steps": 30, "guidance": 2.5, "width": 768, "height": 1024, "repaint": True,
            }, load_seconds)
            print(json.dumps({"model": "leffa-dc", "case": case["id"], "status": record["status"], "passed": record.get("automaticPassed")}), flush=True)
    finally:
        inference = None
        model = None
        pose_model = None
        gc.collect()
        torch.cuda.empty_cache()
    return 0 if all(row["status"] == "completed" for row in records) else 1


def make_sheet(cases: list[dict]) -> Path:
    columns = ("Product", "Target", "Mask", "IDM-VTON DC", "Leffa DC")
    cell_width, cell_height, header_height = 300, 340, 54
    sheet = Image.new("RGB", (cell_width * len(columns), header_height + cell_height * len(cases)), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, label in enumerate(columns):
        draw.text((index * cell_width + 10, 18), label, fill="black", font=font)
    for row_index, case in enumerate(cases):
        paths = [
            project_path(ROOT,case["product"]), project_path(ROOT,case["sourceTarget"]),
            INPUT_ROOT / case["id"] / "mask-overlay.png",
            OUTPUT / "idm-vton-dc" / case["id"] / "final.png",
            OUTPUT / "leffa-dc" / case["id"] / "final.png",
        ]
        y0 = header_height + row_index * cell_height
        draw.text((8, y0 + 7), case["id"], fill="black", font=font)
        for column_index, path in enumerate(paths):
            with Image.open(path) as image:
                thumb = ImageOps.contain(image.convert("RGB"), (cell_width - 18, cell_height - 46))
            x = column_index * cell_width + (cell_width - thumb.width) // 2
            y = y0 + 34 + (cell_height - 42 - thumb.height) // 2
            sheet.paste(thumb, (x, y))
        draw.line((0, y0 + cell_height - 1, sheet.width, y0 + cell_height - 1), fill="#dddddd")
    target = OUTPUT / "comparison.jpg"
    sheet.save(target, quality=94, optimize=True)
    return target


def aggregate() -> int:
    cases = load_cases()
    reports = {
        name: json.loads((OUTPUT / f"{name}-report.json").read_text(encoding="utf-8"))
        for name in ("idm-vton-dc", "leffa-dc")
    }
    sheet = make_sheet(cases)
    summary = {
        "schemaVersion": 1, "createdAt": utc_now(), "mode": "masked self-reconstruction",
        "thresholdsChanged": False, "thresholds": THRESHOLDS,
        "inputPreparation": INPUT_ROOT.relative_to(ROOT).as_posix(),
        "comparisonSheet": sheet.relative_to(ROOT).as_posix(),
        "models": {
            name: {
                "completedCases": report["completedCases"], "passedCases": report["passedCases"],
                "meanReferenceSimilarity": float(np.mean([row["metrics"]["referenceSimilarity"] for row in report["cases"] if row["status"] == "completed"])),
                "meanMaskedPSNR": float(np.mean([row["metrics"]["maskedPSNR"] for row in report["cases"] if row["status"] == "completed"])),
                "meanSeconds": float(np.mean([row["elapsedSeconds"] for row in report["cases"] if row["status"] == "completed"])),
            }
            for name, report in reports.items()
        },
    }
    (OUTPUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary["models"], ensure_ascii=False), flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", choices=("idm", "leffa", "aggregate"))
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if args.model == "idm":
        return run_idm()
    if args.model == "leffa":
        return run_leffa()
    return aggregate()


if __name__ == "__main__":
    raise SystemExit(main())
