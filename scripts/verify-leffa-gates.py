"""Run the two fixed product-fidelity gates against official Leffa DressCode."""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sample_catalog import resolve_sample
LEFFA_ROOT = ROOT / "vendor" / "Leffa"
MODEL_ROOT = ROOT / "models" / "tryon" / "Leffa-DC"
EXPERIMENT_ROOT = ROOT / "workspace" / "diagnostics" / "leffa-gates"
sys.path.insert(0, str(LEFFA_ROOT))

CASES = {
    "upper_body:c002": {
        "garmentCategory": "upper_body",
        "reference": "workspace/references/upper_body/reference.png",
        "mask": "workspace/diagnostics/idm-input-experiment/refined-masks/c002-long-sleeve.png",
        "visualRequirements": [
            "solid cobalt blue body and sleeves",
            "full-length sleeves ending in blue buttoned cuffs",
            "pointed collar and white buttons",
            "no gray forearm panels or lower-body garment changes",
        ],
    },
    "overall:c003": {
        "garmentCategory": "dresses",
        "reference": "workspace/references/overall/reference.png",
        "mask": "workspace/diagnostics/idm-input-experiment/refined-masks/c003-a-line-dress.png",
        "visualRequirements": [
            "solid emerald green short-sleeve dress",
            "round neckline without an added collar",
            "fitted waist and knee-length A-line skirt",
            "no belt, layered skirt, trousers, or long contrasting sleeves",
        ],
    },
}


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


def densepose_labels(image: Image.Image, checkpoint: Path) -> Image.Image:
    """Create the replicated DensePose part-label image expected by Leffa DressCode."""
    import torchvision  # noqa: F401 - registers torchvision::nms for the scripted model
    from torch.nn import functional as functional

    rgb = np.asarray(image.convert("RGB").resize((384, 512)))
    tensor = torch.from_numpy(rgb[:, :, ::-1].copy()).permute(2, 0, 1)
    model = torch.jit.load(str(checkpoint), map_location="cpu").eval()
    with torch.inference_mode():
        boxes, coarse, fine, _, _ = model(tensor)
    if len(boxes) == 0:
        raise ValueError("DensePose did not find a person in the Leffa gate image")

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
            canvas[top:bottom, left:right] = np.where(
                region > 0, region, canvas[top:bottom, left:right]
            )
    return Image.fromarray(np.repeat(canvas[:, :, None], 3, axis=2), mode="RGB")


def restore_from_canvas(image: Image.Image, box: tuple[int, int, int, int], size: tuple[int, int]) -> Image.Image:
    return image.crop(box).resize(size, Image.Resampling.LANCZOS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("category", choices=["upper_body", "overall"])
    parser.add_argument("sample", choices=["c002", "c003"])
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--guidance", type=float, default=2.5)
    parser.add_argument("--repaint", action=argparse.BooleanOptionalAction, default=True)
    args = parser.parse_args()
    key = f"{args.category}:{args.sample}"
    if key not in CASES:
        raise SystemExit(f"Unsupported controlled case: {key}")
    case = CASES[key]

    weight = MODEL_ROOT / "virtual_tryon_dc.pth"
    base_model = MODEL_ROOT / "stable-diffusion-inpainting"
    pose_checkpoint = ROOT / "models" / "pose" / "densepose" / "densepose_r50_fpn_dl_fixed.torchscript"
    for required in (weight, base_model / "unet/config.json", base_model / "vae/config.json", pose_checkpoint):
        if not required.is_file():
            raise SystemExit(f"Required file is missing: {required}")

    from leffa.inference import LeffaInference
    from leffa.model import LeffaModel
    from leffa.transform import LeffaTransform
    import ai_service as ai

    prior = json.loads((ROOT / "workspace/diagnostics/idm-input-experiment/report.json").read_text(encoding="utf-8"))
    baseline = next(
        row for row in prior["cases"]
        if row["category"] == args.category and row["sample"] == args.sample and row["variant"] == "description-and-mask"
    )
    seed = int(baseline["seed"])
    target = EXPERIMENT_ROOT / datetime.now(timezone.utc).strftime(f"{args.category}-{args.sample}-%Y%m%dT%H%M%SZ")
    target.mkdir(parents=True)
    source = Image.open(resolve_sample(ROOT, f"characters/{args.sample}.png")).convert("RGB")
    reference = Image.open(ROOT / case["reference"]).convert("RGB")
    mask = Image.open(ROOT / case["mask"]).convert("L")
    source_canvas, content_box = resize_and_center(source)
    reference_canvas, _ = resize_and_center(reference)
    mask_canvas = resize_and_center_mask(mask)
    densepose = densepose_labels(source_canvas, pose_checkpoint)
    source_canvas.save(target / "model-source.png")
    reference_canvas.save(target / "model-reference.png")
    mask_canvas.save(target / "model-mask.png")
    densepose.save(target / "model-densepose.png")

    record = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "category": args.category,
        "sample": args.sample,
        "garmentCategory": case["garmentCategory"],
        "seed": seed,
        "steps": args.steps,
        "guidance": args.guidance,
        "repaint": args.repaint,
        "modelWidth": 768,
        "modelHeight": 1024,
        "maskPath": case["mask"],
        "referencePath": case["reference"],
        "checkpoint": "franciszzj/Leffa virtual_tryon_dc.pth",
        "checkpointRevision": "61d3390f444506f052feedb0b243cd5369c29c89",
        "visualRequirements": case["visualRequirements"],
        "thresholdsChanged": False,
        "defaultChanged": False,
    }
    started = time.perf_counter()
    model = None
    inference = None
    try:
        load_started = time.perf_counter()
        model = LeffaModel(
            pretrained_model_name_or_path=str(base_model),
            pretrained_model=str(weight),
            dtype="float16",
        )
        inference = LeffaInference(model=model)
        record["loadSeconds"] = time.perf_counter() - load_started
        transform = LeffaTransform(height=1024, width=768)
        data = transform({
            "src_image": [source_canvas],
            "ref_image": [reference_canvas],
            "mask": [mask_canvas],
            "densepose": [densepose],
        })
        torch.cuda.reset_peak_memory_stats()
        inference_started = time.perf_counter()
        output = inference(
            data,
            ref_acceleration=False,
            num_inference_steps=args.steps,
            guidance_scale=args.guidance,
            seed=seed,
            repaint=args.repaint,
        )
        torch.cuda.synchronize()
        record["inferenceSeconds"] = time.perf_counter() - inference_started
        record["peakAllocatedMiB"] = torch.cuda.max_memory_allocated() / 2 ** 20
        raw = output["generated_image"][0].convert("RGB")
        raw.save(target / "raw.png")
        final = restore_from_canvas(raw, content_box, source.size)
        final.save(target / "final.png")

        metrics = ai.score_tryon_result(source, final, mask)
        metrics["referenceSimilarity"] = ai.reference_similarity(reference, final, mask)
        color = ai.color_material_consistency(reference, final, mask)
        geometry = ai.catvton_geometry_consistency(final, mask)
        automatic_passed = bool(
            color["accepted"]
            and geometry["accepted"]
            and metrics["seamScore"] >= 80
            and metrics["anatomyScore"] >= 95
            and metrics["referenceSimilarity"] >= 0.6
        )
        record.update(
            status="completed",
            totalSeconds=time.perf_counter() - started,
            metrics=metrics,
            colorMaterial=color,
            geometry=geometry,
            automaticPassed=automatic_passed,
        )
    except Exception:
        record.update(status="failed", totalSeconds=time.perf_counter() - started, error=traceback.format_exc())
    finally:
        del inference
        del model
        torch.cuda.empty_cache()

    (target / "report.json").write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "directory": str(target.relative_to(ROOT)),
        "status": record["status"],
        "automaticPassed": record.get("automaticPassed"),
        "similarity": record.get("metrics", {}).get("referenceSimilarity"),
    }, ensure_ascii=False), flush=True)
    return 0 if record["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
