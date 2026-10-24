from services.ai.runtime.tracing import trace_generation
"""AI Atelier: tasks.generate."""
from PIL import Image, ImageFilter, ImageOps
from datetime import datetime, timezone
from prompt_catalog import prompt_text, prompt_template, read_catalog, task_prompt
import gc
import hashlib
import json
import time
import torch
from services.ai.imaging.segmentation import decode_image, encode_image, safe_sample
from services.ai.models.pipelines import _load_sdxl_control_pipe, load_chroma_pipe, release_text_to_image, text_to_image_model_path
from services.ai.models import state as model_state
from services.ai.runtime.configuration import CHROMA_ROOT, LOCAL_CONFIG, OUTPUTS, ROOT
from services.ai.runtime.factory import task_context
from services.ai.runtime.tracing import prompt_history, traced_pipeline_call


@trace_generation
def chroma_smoke(body: dict) -> dict:
    prompt = str(body.get("prompt") or prompt_text('chroma_smoke.studio_product_photograph_of_a_blue_cotton'))[:600]
    negative = str(body.get("negativePrompt") or prompt_text('chroma_smoke.low_quality_blurry_deformed_text_watermark'))[:400]
    seed = int(body.get("seed", 433))
    steps = max(4, min(50, int(body.get("steps", 8))))
    size = max(256, min(768, int(body.get("size", 512))))
    pipe = load_chroma_pipe()
    torch.cuda.reset_peak_memory_stats()
    started = time.perf_counter()
    image = traced_pipeline_call(pipe,
        prompt=[prompt], negative_prompt=[negative],
        generator=torch.Generator("cpu").manual_seed(seed),
        num_inference_steps=steps, guidance_scale=3.0,
        width=size, height=size, num_images_per_prompt=1,
    ).images[0]
    elapsed = round(time.perf_counter() - started, 3)
    output_dir = OUTPUTS / "chroma-smoke"
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output = output_dir / f"chroma-{stamp}.png"
    image.save(output)
    output.with_suffix(".json").write_text(json.dumps({"promptHistory": prompt_history()}, ensure_ascii=False, indent=2), encoding="utf-8")
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    extrema = image.convert("RGB").getextrema()
    passed = output.stat().st_size > 10_000 and all(high > low for low, high in extrema)
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "passed": passed,
        "model": "flux-chroma1-hd", "seed": seed, "steps": steps, "width": size, "height": size,
        "elapsedSeconds": elapsed, "peakVramMb": round(torch.cuda.max_memory_allocated() / 1048576),
        "output": str(output.relative_to(ROOT)), "sha256": digest, "prompt": prompt, "promptHistory": prompt_history(),
    }
    report_path = ROOT / "workspace" / "review" / f"chroma-smoke-{stamp}.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(report_path.relative_to(ROOT)), **report}


def new_image_plan(body):
    from new_image import plan
    model_id = str(body.get('modelId') or 'flux-2-klein-4b')
    path = CHROMA_ROOT if model_id == 'flux-chroma1-hd' else text_to_image_model_path(model_id)
    return plan(body, path, model_id)


@trace_generation
def chroma_generate(body: dict) -> dict:
    from new_image import generate
    try:
        return generate(body, task_context())
    except torch.cuda.OutOfMemoryError as error:
        release_text_to_image()
        raise RuntimeError('Không đủ bộ nhớ GPU cho cấu hình này. Chọn độ phân giải thấp hơn hoặc FLUX.2 klein; hệ thống không tự hạ chất lượng.') from error


@trace_generation
def sd35_conditioned_generate(body: dict) -> dict:
    from sd35_depth_control import generate
    source = Image.open(safe_sample(str(body.get("sampleId", "")))).convert("RGB")
    model_state.inpaint_pipe = model_state.tryon_pipe = model_state.chroma_pipe = model_state.text_to_image_pipe = model_state.sdxl_control_pipe = None
    model_state.text_to_image_model_id = ""
    gc.collect()
    if torch.cuda.is_available(): torch.cuda.empty_cache()
    image, depth, seed = generate(source, body, ROOT, LOCAL_CONFIG, traced_pipeline_call)
    output_dir = OUTPUTS / datetime.now(timezone.utc).strftime("sd35_depth_%Y%m%dT%H%M%S%fZ")
    output_dir.mkdir(parents=True, exist_ok=False)
    image.save(output_dir / "result.png")
    depth.save(output_dir / "depth.png")
    (output_dir / "metadata.json").write_text(json.dumps({"model": "controlnet-depth-sd35-large", "seed": seed, "promptHistory": prompt_history()}, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "model": "controlnet-depth-sd35-large", "image": encode_image(image), "depth": str((output_dir / "depth.png").relative_to(ROOT)), "file": str((output_dir / "result.png").relative_to(ROOT)), "seed": seed, "promptHistory": prompt_history()}


@trace_generation
def sdxl_conditioned_generate(body: dict) -> dict:
    source = Image.open(safe_sample(str(body.get("sampleId", "")))).convert("RGB")
    reference = decode_image(str(body.get("referenceImage", "")))
    max_side = max(512, min(1024, int(body.get("maxSide", 768))))
    scale = min(max_side / max(source.size), 1.0)
    size = (max(64, round(source.width * scale / 64) * 64), max(64, round(source.height * scale / 64) * 64))
    resized = source.resize(size, Image.Resampling.LANCZOS)
    from sd35_depth_control import depth_image as estimate_depth, required_paths
    depth_path = required_paths(ROOT, LOCAL_CONFIG)['depth']
    # SDXL depth ControlNets expect near objects bright. SD3.5 uses the inverse.
    depth_image = estimate_depth(resized, depth_path, invert=False)
    pipe = _load_sdxl_control_pipe()
    pipe.set_ip_adapter_scale(max(0.0, min(1.5, float(body.get("adapterScale", 0.6)))))
    seed = int(body.get("seed", 42))
    call={"prompt":str(body.get("prompt") or prompt_text('sdxl_conditioned_generate.professional_fashion_photograph_realistic_fabric_and_lighting')),"negative_prompt":str(body.get("negativePrompt") or prompt_text('sdxl_conditioned_generate.blurry_deformed_low_quality_text_watermark')),"ip_adapter_image":reference,"controlnet_conditioning_scale":max(0.0,min(2.0,float(body.get("controlScale",0.7)))),"num_inference_steps":max(10,min(60,int(body.get("steps",30)))),"guidance_scale":max(1.0,min(12.0,float(body.get("guidance",5.0)))),"generator":torch.Generator("cpu").manual_seed(seed),"width":size[0],"height":size[1]}
    if model_state.sdxl_control_mode=="union-depth": call.update(control_image=depth_image,control_mode=1)
    else: call.update(image=depth_image)
    image = traced_pipeline_call(pipe, **call).images[0]
    output_dir = OUTPUTS / datetime.now(timezone.utc).strftime("sdxl_%Y%m%dT%H%M%S%fZ")
    output_dir.mkdir(parents=True, exist_ok=False)
    image.save(output_dir / "result.png"); depth_image.save(output_dir / "depth.png")
    (output_dir / "metadata.json").write_text(json.dumps({"promptHistory": prompt_history()}, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "promptHistory": prompt_history(), "image": encode_image(image), "file": str((output_dir / "result.png").relative_to(ROOT)), "depth": str((output_dir / "depth.png").relative_to(ROOT)), "seed": seed}
