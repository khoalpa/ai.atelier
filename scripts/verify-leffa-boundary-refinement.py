"""Run two fixed Leffa cases with refined boundary masks and unchanged settings."""

from __future__ import annotations

import gc
import importlib.util
import json
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
LEFFA_ROOT = ROOT / "vendor" / "Leffa"
MODEL_ROOT = ROOT / "models" / "tryon" / "Leffa-DC"
POSE_CHECKPOINT = ROOT / "models" / "pose" / "densepose" / "densepose_r50_fpn_dl_fixed.torchscript"
MASK_ROOT = ROOT / "workspace" / "diagnostics" / "leffa-boundary-refinement_20261021-v4"
PREP_ROOT = ROOT / "workspace" / "diagnostics" / "synthetic-vton-reconstruction_20261021-final-inputs-v5"
BASELINE_ROOT = ROOT / "workspace" / "diagnostics" / "synthetic-vton-model-benchmark_20261021"
OUTPUT = MASK_ROOT / "results"
CASE_IDS = ("lower-body-09-p1", "overall-09-p1")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(LEFFA_ROOT))


def load_helpers():
    path = ROOT / "scripts" / "benchmark-synthetic-vton-gates.py"
    spec = importlib.util.spec_from_file_location("synthetic_vton_benchmark", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load benchmark helpers")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_sheet(records: list[dict]) -> Path:
    columns = ("Product", "Target", "Prior mask", "Refined mask", "Baseline", "Refined result")
    cell_width, cell_height, header_height = 330, 470, 54
    sheet = Image.new("RGB", (cell_width * len(columns), header_height + cell_height * len(records)), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, label in enumerate(columns):
        draw.text((index * cell_width + 10, 18), label, fill="black", font=font)
    for row_index, record in enumerate(records):
        case_id = record["id"]
        paths = [
            PREP_ROOT / case_id / "product.png",
            PREP_ROOT / case_id / "source-target.png",
            MASK_ROOT / case_id / "prior-overlay.png",
            MASK_ROOT / case_id / "tight-overlay.png",
            BASELINE_ROOT / "leffa-dc" / case_id / "final.png",
            OUTPUT / case_id / "final.png",
        ]
        y0 = header_height + row_index * cell_height
        draw.text((8, y0 + 7), case_id, fill="black", font=font)
        for column_index, path in enumerate(paths):
            with Image.open(path) as image:
                thumb = ImageOps.contain(image.convert("RGB"), (cell_width - 18, cell_height - 44))
            x = column_index * cell_width + (cell_width - thumb.width) // 2
            y = y0 + 32 + (cell_height - 38 - thumb.height) // 2
            sheet.paste(thumb, (x, y))
    target = OUTPUT / "comparison.jpg"
    sheet.save(target, quality=95, optimize=True)
    return target


def main() -> int:
    helper = load_helpers()
    import ai_service as ai
    import torchvision  # noqa: F401
    from leffa.inference import LeffaInference
    from leffa.model import LeffaModel
    from leffa.transform import LeffaTransform

    OUTPUT.mkdir(parents=True, exist_ok=False)
    cases = {item["id"]: item for item in helper.load_cases()}
    baseline_report = json.loads((BASELINE_ROOT / "leffa-dc-report.json").read_text(encoding="utf-8"))
    baseline = {item["id"]: item for item in baseline_report["cases"]}
    load_started = time.perf_counter()
    model = LeffaModel(
        pretrained_model_name_or_path=str(MODEL_ROOT / "stable-diffusion-inpainting"),
        pretrained_model=str(MODEL_ROOT / "virtual_tryon_dc.pth"),
        dtype="float16",
    )
    inference = LeffaInference(model=model)
    transform = LeffaTransform(height=1024, width=768)
    pose_model = torch.jit.load(str(POSE_CHECKPOINT), map_location="cpu").eval()
    load_seconds = time.perf_counter() - load_started
    records = []
    try:
        for case_id in CASE_IDS:
            case = cases[case_id]
            case_dir = OUTPUT / case_id
            case_dir.mkdir()
            source = Image.open(ROOT / case["sourceTarget"]).convert("RGB")
            product = Image.open(ROOT / case["product"]).convert("RGB")
            mask = Image.open(MASK_ROOT / case_id / "tight-mask.png").convert("L")
            source_canvas, content_box = helper.resize_and_center(source)
            product_canvas, _ = helper.resize_and_center(product)
            mask_canvas = helper.resize_and_center_mask(mask)
            pose = helper.densepose_labels(source_canvas, pose_model)
            mask_canvas.save(case_dir / "model-mask.png")
            pose.save(case_dir / "model-densepose.png")
            started = time.perf_counter()
            record = {
                "id": case_id,
                "category": case["category"],
                "seed": case["seed"],
                "status": "running",
                "baseline": {
                    "automaticPassed": baseline[case_id]["automaticPassed"],
                    "metrics": baseline[case_id]["metrics"],
                    "colorMaterial": baseline[case_id]["colorMaterial"],
                    "geometry": baseline[case_id]["geometry"],
                },
            }
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
                scored = helper.score_case(ai, source, product, final, mask)
                record.update(
                    status="completed",
                    elapsedSeconds=time.perf_counter() - started,
                    peakAllocatedMiB=torch.cuda.max_memory_allocated() / 2 ** 20,
                    selected=(case_dir / "final.png").relative_to(ROOT).as_posix(),
                    **scored,
                )
            except Exception:
                record.update(status="failed", elapsedSeconds=time.perf_counter() - started, error=traceback.format_exc())
            records.append(record)
            print(json.dumps({"case": case_id, "status": record["status"], "passed": record.get("automaticPassed")}), flush=True)
    finally:
        inference = None
        model = None
        pose_model = None
        gc.collect()
        torch.cuda.empty_cache()

    sheet = make_sheet(records) if all(item["status"] == "completed" for item in records) else None
    report = {
        "schemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "model": "leffa-dc",
        "checkpoint": "franciszzj/Leffa virtual_tryon_dc.pth",
        "maskRefinement": MASK_ROOT.relative_to(ROOT).as_posix(),
        "thresholdsChanged": False,
        "configuration": {"steps": 30, "guidance": 2.5, "width": 768, "height": 1024, "repaint": True},
        "loadSeconds": load_seconds,
        "comparison": sheet.relative_to(ROOT).as_posix() if sheet else None,
        "completedCases": sum(item["status"] == "completed" for item in records),
        "passedCases": sum(bool(item.get("automaticPassed")) for item in records),
        "cases": records,
    }
    (OUTPUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"directory": str(OUTPUT.relative_to(ROOT)), "completedCases": report["completedCases"], "passedCases": report["passedCases"]}))
    return 0 if report["completedCases"] == 2 else 1


if __name__ == "__main__":
    raise SystemExit(main())
