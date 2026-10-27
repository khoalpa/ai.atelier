"""Run minimal offline smoke tests for Qwen-Image inpainting and depth ControlNet."""
import argparse
import base64
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def data_url(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def source_id() -> tuple[str, Image.Image]:
    candidates = sorted((ROOT / "workspace" / "uploads").glob("*"), key=lambda path: path.stat().st_size)
    for path in candidates:
        try:
            image = Image.open(path).convert("RGB")
        except Exception:
            continue
        if min(image.size) >= 256:
            return "uploads/" + path.name, image
    raise RuntimeError("Không tìm thấy ảnh upload tối thiểu 256 px để smoke test")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", choices=("inpaint", "depth", "all"), default="all")
    parser.add_argument("--steps", type=int, default=12)
    args = parser.parse_args()
    import torch
    from services.ai.models.pipelines import release_inpaint, release_qwen_control
    from services.ai.tasks.generate import qwen_depth_generate
    from services.ai.tasks.inpaint import inpaint

    sample_id, source = source_id()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    report = {"schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "sampleId": sample_id, "results": {}}
    if args.task in ("inpaint", "all"):
        mask = Image.new("L", source.size)
        draw = ImageDraw.Draw(mask)
        cx, cy = source.width // 2, source.height // 2
        radius = max(24, min(source.size) // 10)
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=255)
        result = inpaint({
            "jobId": "qwen-inpaint-smoke-" + stamp,
            "sampleId": sample_id,
            "editableMask": data_url(mask),
            "modelId": "qwen-image-controlnet-inpainting",
            "fillMode": "background",
            "removalTarget": "custom",
            "objectLabel": "small object",
            "prompt": "Remove the selected object and reconstruct the surrounding background naturally.",
            "negativePrompt": "object remnants, visible seam, blur, distorted geometry",
            "confirmedPrompts": {"prompt": "Remove the selected object and reconstruct the surrounding background naturally.", "negativePrompt": "object remnants, visible seam, blur, distorted geometry"},
            "count": 1, "steps": args.steps, "minimumEffectiveSteps": args.steps,
            "strength": 1.0, "guidance": 4.0, "maxSide": 512,
            "expand": 8, "blur": 4, "cropPadding": 48,
            "autoRetry": False, "semanticCheck": False, "livePreview": False,
        })
        report["results"]["inpaint"] = {"ok": result["ok"], "directory": result["directory"], "modelId": result["modelId"], "settings": result["effectiveSettings"]}
        release_inpaint()
    if args.task in ("depth", "all"):
        result = qwen_depth_generate({
            "jobId": "qwen-depth-smoke-" + stamp,
            "sampleId": sample_id,
            "prompt": "Preserve the exact camera, depth, perspective and spatial composition; render a natural realistic photograph.",
            "negativePrompt": "changed composition, flattened depth, warped geometry",
            "steps": args.steps, "guidance": 4.0, "controlScale": 0.9,
            "maxSide": 512, "seed": 4242,
        })
        report["results"]["depth"] = {key: result[key] for key in ("ok", "model", "file", "depth", "seed")}
        release_qwen_control()
    report["cuda"] = torch.cuda.is_available()
    target = ROOT / "workspace" / "review" / f"qwen-controlnet-smoke-{stamp}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "report": str(target.relative_to(ROOT)), "results": report["results"]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
