from prompt_catalog import prompt_text, prompt_template, read_catalog, task_prompt
from local_request_security import trusted_request
from service_lifecycle import ServiceLifecycle
from tryon_geometry import fit_geometry, fit_image, restore_image, inward_blend, target_attributes, target_coverage
from tryon_quality import pose_consistency, gate_reasons, candidate_key, repair_is_better, quality_gate
import base64
from contextvars import ContextVar
from functools import wraps
import gc
import hashlib
import io
import json
import os
import shutil
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

import numpy as np
import torch
import cv2
from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent
APP_VERSION = json.loads((ROOT / 'version.json').read_text(encoding='utf-8'))['version']
service_lifecycle = ServiceLifecycle()
SOURCE_REVISION = hashlib.sha256(b''.join((ROOT / name).read_bytes() for name in json.loads((ROOT / 'version.json').read_text(encoding='utf-8'))['aiSources'] if (ROOT / name).is_file())).hexdigest()
SERVICE_STARTED_AT = datetime.now(timezone.utc).isoformat()
CONFIG_FILE = ROOT / "workspace" / "config.json"


def load_local_config():
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8")) if CONFIG_FILE.exists() else {}
    except Exception:
        return {}


LOCAL_CONFIG = load_local_config()


def configured_path(environment_name: str, config_name: str, fallback) -> Path:
    configured = Path(os.environ.get(environment_name) or LOCAL_CONFIG.get(config_name) or fallback).expanduser()
    if configured.exists():
        return configured
    # Older releases stored large pipelines directly below models/. Resolve the
    # same directory name recursively so an upgraded installation keeps working.
    models_root = ROOT / "models"
    if models_root in configured.parents:
        matches = [item for item in models_root.rglob(configured.name) if item.is_dir() and (item / "model_index.json").is_file()]
        if len(matches) == 1:
            return matches[0]
    return configured


def mark_model_config_applied():
    applied_paths = {
        "inpaintModel": str(INPAINT_MODEL.resolve()), "catvtonModel": str(CATVTON_MODEL.resolve()),
        "idmVtonModel": str(IDMVTON_MODEL.resolve()), "idmVtonRoot": str(IDMVTON_ROOT.resolve()), "denseposeScript": str(DENSEPOSE_SCRIPT.resolve()),
        "catvtonBase": str(CATVTON_BASE.resolve()), "catvtonVae": str(CATVTON_VAE.resolve()),
        "poseModel": str(POSE_MODEL.resolve()), "chromaModel": str(CHROMA_ROOT.resolve()),
        "adetailerModel": str(ADETAILER_ROOT.resolve()), "yoloWorldModel": str(YOLO_WORLD_ROOT.resolve()),
        "ipAdapterSdxlModel": str(IP_ADAPTER_SDXL_ROOT.resolve()),
        "controlnetDepthSdxlModel": str(CONTROLNET_DEPTH_SDXL_ROOT.resolve()),
        "controlnetUnionSdxlModel": str(CONTROLNET_UNION_SDXL_ROOT.resolve()),
        "sdxlBaseModel": str(SDXL_BASE.resolve()),
        "groundingDinoModel": str(GROUNDING_DINO_ROOT.resolve()),
        "florenceModel": str(FLORENCE_ROOT.resolve()),
        "birefnetModel": str(BIREFNET_ROOT.resolve()),
    }
    updated = {**LOCAL_CONFIG, "modelRestartRequired": False, "modelAppliedAt": datetime.now(timezone.utc).isoformat(), "modelAppliedPaths": applied_paths}
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(updated, ensure_ascii=False, indent=2), encoding="utf-8")


SAMPLES = ROOT / "samples"
MODELS = ROOT / "models" / "segmentation"
OUTPUTS = ROOT / "workspace" / "outputs"
JOBS_DIR = ROOT / "workspace" / "jobs"
HOST = "127.0.0.1"
PORT = int(os.environ.get("AI_SEGMENT_PORT", "7861"))

MODEL_VARIANT = os.environ.get("SAM2_VARIANT", "tiny")
MODEL_TABLE = {
    "tiny": ("sam2.1_hiera_tiny.pt", "configs/sam2.1/sam2.1_hiera_t.yaml"),
    "small": ("sam2.1_hiera_small.pt", "configs/sam2.1/sam2.1_hiera_s.yaml"),
    "base_plus": ("sam2.1_hiera_base_plus.pt", "configs/sam2.1/sam2.1_hiera_b+.yaml"),
    "large": ("sam2.1_hiera_large.pt", "configs/sam2.1/sam2.1_hiera_l.yaml"),
}

predictor = None
inpaint_pipe = None
tryon_pipe = None
tryon_pipe_model_id = ""
chroma_pipe = None
text_to_image_pipe = None
text_to_image_model_id = ""
pose_model = None
adetailer_model = None
yolo_world_model = None
grounding_dino_model = None
grounding_dino_processor = None
florence_model = None
florence_processor = None
birefnet_model = None
sdxl_control_pipe = None
sdxl_control_mode = "depth"
vision_checker = None
vision_processor = None
job_lock = threading.Lock()
inference_lock = threading.RLock()
jobs = {}
device = "cuda" if torch.cuda.is_available() else "cpu"
INPAINT_MODEL = configured_path("INPAINT_MODEL", "inpaintModel", ROOT / "models" / "text-to-image" / "stable-diffusion-3.5-large")
INPAINT_ARCHITECTURE = str(os.environ.get("INPAINT_ARCHITECTURE") or LOCAL_CONFIG.get("inpaintArchitecture") or "auto").lower()
CATVTON_ROOT = configured_path("CATVTON_ROOT", "catvtonRoot", ROOT / "vendor" / "CatVTON")
IDMVTON_ROOT = configured_path("IDMVTON_ROOT", "idmVtonRoot", ROOT / "vendor" / "IDM-VTON")
IDMVTON_MODEL = configured_path("IDMVTON_MODEL", "idmVtonModel", ROOT / "models" / "tryon" / "IDM-VTON")
DENSEPOSE_SCRIPT = configured_path("DENSEPOSE_SCRIPT", "denseposeScript", ROOT / "models" / "pose" / "densepose" / "densepose_r50_fpn_dl_fixed.torchscript")
CATVTON_MODEL = configured_path("CATVTON_MODEL", "catvtonModel", ROOT / "models" / "tryon" / "CatVTON")
CATVTON_BASE = configured_path("CATVTON_BASE", "catvtonBase", ROOT / "models" / "tryon" / "stable-diffusion-inpainting")
CATVTON_VAE = configured_path("CATVTON_VAE", "catvtonVae", ROOT / "models" / "tryon" / "sd-vae-ft-mse")
POSE_MODEL = configured_path("POSE_MODEL", "poseModel", ROOT / "models" / "pose" / "yolo11n-pose.pt")
ADETAILER_ROOT = configured_path("ADETAILER_MODEL", "adetailerModel", ROOT / "models" / "detection" / "adetailer")
YOLO_WORLD_ROOT = configured_path("YOLO_WORLD_MODEL", "yoloWorldModel", ROOT / "models" / "detection" / "yolo-world")
GROUNDING_DINO_ROOT = configured_path("GROUNDING_DINO_MODEL", "groundingDinoModel", ROOT / "models" / "detection" / "grounding-dino-base")
FLORENCE_ROOT = configured_path("FLORENCE_MODEL", "florenceModel", ROOT / "models" / "vision" / "florence-2-large")
BIREFNET_ROOT = configured_path("BIREFNET_MODEL", "birefnetModel", ROOT / "models" / "segmentation" / "birefnet")
IP_ADAPTER_SDXL_ROOT = configured_path("IP_ADAPTER_SDXL_MODEL", "ipAdapterSdxlModel", ROOT / "models" / "adapters" / "ip-adapter")
CONTROLNET_DEPTH_SDXL_ROOT = configured_path("CONTROLNET_DEPTH_SDXL_MODEL", "controlnetDepthSdxlModel", ROOT / "models" / "controlnet" / "depth-sdxl-1.0-small")
CONTROLNET_UNION_SDXL_ROOT = configured_path("CONTROLNET_UNION_SDXL_MODEL", "controlnetUnionSdxlModel", ROOT / "models" / "controlnet" / "controlnet-union-sdxl-1.0")
SDXL_BASE = configured_path("SDXL_BASE_MODEL", "sdxlBaseModel", ROOT / "models" / "text-to-image" / "stable-diffusion-xl-base-1.0")
LORA_ROOT = configured_path("LORA_ROOT", "loraRoot", ROOT / "models" / "lora")
LORA_REGISTRY = LORA_ROOT / "registry.json"
CHROMA_ROOT = configured_path("CHROMA_ROOT", "chromaModel", ROOT / "models" / "flux" / "chroma1-hd")
active_loras = []


def chroma_required_files() -> list[Path]:
    return [
        CHROMA_ROOT / "Chroma1-HD.safetensors",
        CHROMA_ROOT / "model_index.json",
        CHROMA_ROOT / "scheduler" / "scheduler_config.json",
        CHROMA_ROOT / "transformer" / "config.json",
        CHROMA_ROOT / "text_encoder" / "config.json",
        CHROMA_ROOT / "text_encoder" / "model.safetensors.index.json",
        CHROMA_ROOT / "text_encoder" / "model-00001-of-00002.safetensors",
        CHROMA_ROOT / "text_encoder" / "model-00002-of-00002.safetensors",
        CHROMA_ROOT / "tokenizer" / "tokenizer_config.json",
        CHROMA_ROOT / "tokenizer" / "spiece.model",
        CHROMA_ROOT / "vae" / "config.json",
        CHROMA_ROOT / "vae" / "diffusion_pytorch_model.safetensors",
    ]


def display_model_path(path: Path) -> str:
    """Return a stable display path even when a configured model lives outside ROOT."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def chroma_status() -> dict:
    missing = [display_model_path(path) for path in chroma_required_files() if not path.is_file()]
    smoke_reports = sorted((ROOT / "workspace" / "review").glob("chroma-smoke-*.json"), reverse=True)
    latest = json.loads(smoke_reports[0].read_text(encoding="utf-8")) if smoke_reports else None
    return {
        "ok": True,
        "root": str(CHROMA_ROOT),
        "dependenciesReady": not missing,
        "missing": missing,
        "pipelineLoaded": chroma_pipe is not None,
        "activated": not missing,
        "loadMode": "on-demand",
        "smokePassed": bool(latest and latest.get("passed")),
        "latestSmoke": str(smoke_reports[0].relative_to(ROOT)) if smoke_reports else "",
        "latest": latest,
    }


def load_chroma_pipe():
    global chroma_pipe, inpaint_pipe, tryon_pipe, text_to_image_pipe, text_to_image_model_id
    if chroma_pipe is not None:
        return chroma_pipe
    missing = [path for path in chroma_required_files() if not path.is_file()]
    if missing:
        raise RuntimeError("Chroma còn thiếu dependency: " + ", ".join(display_model_path(path) for path in missing))
    if not torch.cuda.is_available():
        raise RuntimeError("Chroma1-HD yêu cầu CUDA cho cấu hình phát hành này")
    inpaint_pipe = None
    tryon_pipe = None
    text_to_image_pipe = None
    text_to_image_model_id = ""
    gc.collect()
    torch.cuda.empty_cache()
    from diffusers import ChromaPipeline, ChromaTransformer2DModel
    transformer = ChromaTransformer2DModel.from_single_file(
        str(CHROMA_ROOT / "Chroma1-HD.safetensors"),
        config=str(CHROMA_ROOT),
        subfolder="transformer",
        torch_dtype=torch.bfloat16,
        local_files_only=True,
    )
    chroma_pipe = ChromaPipeline.from_pretrained(
        str(CHROMA_ROOT), transformer=transformer, torch_dtype=torch.bfloat16, local_files_only=True
    )
    if torch.cuda.get_device_properties(0).total_memory < 24 * 1024 ** 3:
        # BF16 Chroma's transformer does not fit on a 16 GB GPU as a whole.
        from diffusers.hooks import apply_group_offloading
        chroma_pipe.transformer.enable_group_offload(onload_device=torch.device('cuda'),
            offload_device=torch.device('cpu'), offload_type='block_level', num_blocks_per_group=2)
        apply_group_offloading(chroma_pipe.text_encoder, onload_device=torch.device('cuda'),
            offload_device=torch.device('cpu'), offload_type='leaf_level')
        chroma_pipe.vae.to('cuda')
        chroma_pipe._atelier_offload = 'group'
    else:
        chroma_pipe.enable_model_cpu_offload()
        chroma_pipe._atelier_offload = 'model'
    configure_vae_memory(chroma_pipe)
    return chroma_pipe


def text_to_image_model_path(model_id: str) -> Path:
    paths = {
        "sdxl-base-1.0": SDXL_BASE,
        "sd35-medium": ROOT / "models" / "text-to-image" / "stable-diffusion-3.5-medium",
    }
    if model_id in paths:
        configured = paths[model_id]
        manually_copied = ROOT / "models" / configured.name
        return configured if configured.exists() or not manually_copied.exists() else manually_copied
    registry_path = ROOT / "models" / "registry.json"
    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        entry = next((item for item in registry.get("models", []) if item.get("id") == model_id and item.get("kind") == "text-to-image"), None)
    except Exception:
        entry = None
    if not entry:
        raise ValueError(f"Model tạo ảnh không được đăng ký hoặc không tương thích: {model_id}")
    configured = Path(str(entry.get("path") or ""))
    resolved = configured if configured.is_absolute() else ROOT / configured
    if not resolved.resolve().is_relative_to((ROOT / "models").resolve()):
        raise ValueError("Đường dẫn model tạo ảnh phải nằm trong thư mục models")
    return resolved


def load_text_to_image_pipe(model_id: str):
    global text_to_image_pipe, text_to_image_model_id, chroma_pipe, inpaint_pipe, tryon_pipe, sdxl_control_pipe
    if model_id == "flux-chroma1-hd":
        return load_chroma_pipe()
    if text_to_image_pipe is not None and text_to_image_model_id == model_id:
        return text_to_image_pipe
    model_path = text_to_image_model_path(model_id)
    if not (model_path / "model_index.json").is_file():
        raise RuntimeError(f"Model {model_id} chưa được tải đầy đủ tại {display_model_path(model_path)}")
    if model_id == "flux-2-klein-4b" and not (model_path / "installation.json").is_file():
        raise RuntimeError("FLUX.2 klein chưa tải xong hoặc chưa được kiểm tra checksum")
    text_to_image_pipe = None
    text_to_image_model_id = ""
    chroma_pipe = inpaint_pipe = tryon_pipe = sdxl_control_pipe = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    from diffusers import DiffusionPipeline
    klein = model_id == "flux-2-klein-4b"
    dtype = (torch.bfloat16 if klein or model_id == "sd35-medium" else torch.float16) if device == "cuda" else torch.float32
    load_kwargs = {"torch_dtype": dtype, "local_files_only": True}
    if device == "cuda" and not klein and any(model_path.rglob("*.fp16.safetensors")):
        load_kwargs["variant"] = "fp16"
    pipe = DiffusionPipeline.from_pretrained(str(model_path), **load_kwargs)
    if device == "cuda" and klein:
        pipe.enable_model_cpu_offload()
        configure_vae_memory(pipe)
    elif device == "cuda" and model_id != "sd35-medium":
        pipe.to("cuda")
    elif device == "cuda":
        pipe.enable_model_cpu_offload()
    configure_vae_memory(pipe)
    text_to_image_pipe = pipe
    text_to_image_model_id = model_id
    return text_to_image_pipe


# Request-local trace: every inference attempt is recorded; concurrent requests stay isolated.
prompt_trace_context = ContextVar("prompt_trace", default=None)


def trace_generation(function):
    @wraps(function)
    def wrapped(body):
        context = {"body": body, "history": [], "jobId": str(body.get("jobId") or "")}
        token = prompt_trace_context.set(context)
        try:
            return function(body)
        finally:
            prompt_trace_context.reset(token)
    return wrapped


def prompt_history():
    context = prompt_trace_context.get()
    return list(context["history"]) if context else []


def traced_pipeline_call(pipe, **kwargs):
    prompt_cache = kwargs.pop('_prompt_cache', None)
    from prompt_limits import validate_prompt_limits
    token_budget = validate_prompt_limits(pipe, kwargs)
    context = prompt_trace_context.get()
    if context is not None:
        body = context["body"]
        job_id = context["jobId"]
        with job_lock:
            state = dict(jobs.get(job_id, {}))
        fields = {key: kwargs[key] for key in ("prompt", "prompt_2", "prompt_3", "negative_prompt", "negative_prompt_2", "negative_prompt_3") if key in kwargs}
        generator = kwargs.get("generator")
        entry = {
            "sequence": len(context["history"]) + 1,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "stage": state.get("stage", "generation"), "sampleId": body.get("sampleId"),
            "model": str(getattr(pipe, "_atelier_model_path", None) or state.get("model") or type(pipe).__name__),
            "pipeline": type(pipe).__name__,
            "seed": int(generator.initial_seed()) if hasattr(generator, "initial_seed") else state.get("seed"),
            "autoRetry": bool(state.get("autoRetry", False)),
            "userPrompt": str(body.get("prompt") or ""),
            "userNegativePrompt": str(body.get("negativePrompt") or ""),
            "sources": {key: body[key] for key in ("modelId", "removalTarget", "fillMode", "forbiddenReplacement", "processingMode", "presetId") if key in body},
            "prompts": fields,
            "tokenBudget": token_budget,
            "negativePromptStrategy": "direct" if "negative_prompt" in fields else "merged-into-positive" if "Avoid these failure modes:" in str(fields.get("prompt", "")) else "unused",
            "resolvedSources": context.get("resolvedSources", {}),
            "parameters": {key: kwargs[key] for key in ("num_inference_steps", "guidance_scale", "strength", "width", "height") if key in kwargs},
        }
        context["history"].append(entry)
        # Persist before inference so failures and cancellation retain the actual call.
        update_job(job_id, _prompt=entry)
    return pipe(**(prompt_cache.apply(kwargs) if prompt_cache is not None else kwargs))


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
        return generate(body, globals())
    except torch.cuda.OutOfMemoryError as error:
        release_text_to_image()
        raise RuntimeError('Không đủ bộ nhớ GPU cho cấu hình này. Chọn độ phân giải thấp hơn hoặc FLUX.2 klein; hệ thống không tự hạ chất lượng.') from error


def update_job(job_id: str, **changes):
    if not job_id:
        return
    with job_lock:
        now = datetime.now(timezone.utc).isoformat()
        event = changes.pop("_event", None)
        result = changes.pop("_result", None)
        prompt_entry = changes.pop("_prompt", None)
        previous = jobs.get(job_id, {})
        state = {**previous, **changes, "updatedAt": now}
        if changes.get("status") == "running" and not state.get("startedAt"):
            state["startedAt"] = now
        events = list(previous.get("events", []))
        stage_changed = changes.get("stage") and changes.get("stage") != previous.get("stage")
        status_changed = changes.get("status") and changes.get("status") != previous.get("status")
        if event or stage_changed or status_changed:
            payload = event if isinstance(event, dict) else {}
            events.append({"sequence": int(previous.get("eventSequence", 0)) + 1, "timestamp": now, "type": payload.get("type", "stage.changed" if stage_changed else "status.changed"), "message": payload.get("message", str(changes.get("stage") or changes.get("status") or "Đã cập nhật")), **{key:value for key,value in payload.items() if key not in ("type", "message")}})
            state["eventSequence"] = events[-1]["sequence"]
        state["events"] = events[-100:]
        results = list(changes.get("results", previous.get("results", [])))
        if isinstance(result, dict):
            result_key = (result.get("sampleId"), result.get("seed"), result.get("file"))
            results = [item for item in results if (item.get("sampleId"), item.get("seed"), item.get("file")) != result_key]
            results.append({"timestamp": now, **result})
        state["results"] = results[-48:]
        state["promptHistory"] = list(previous.get("promptHistory", [])) + ([prompt_entry] if prompt_entry else [])
        jobs[job_id] = state
        JOBS_DIR.mkdir(parents=True, exist_ok=True)
        safe_id = "".join(character for character in job_id if character.isalnum() or character in "-_")
        if safe_id:
            target = JOBS_DIR / f"{safe_id}.json"
            target.write_text(json.dumps({"jobId": job_id, **jobs[job_id]}, ensure_ascii=False, indent=2), encoding="utf-8")


def load_persisted_jobs():
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    for path in JOBS_DIR.glob("*.json"):
        if path.name.endswith(".request.json") or path.name.endswith(".checkpoint.json"):
            continue
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
            job_id = str(state.pop("jobId"))
            if state.get("status") in ("running", "cancelling"):
                state.update(status="interrupted", resumable=bool(state.get("requestFile")), stage="restart-required")
            jobs[job_id] = state
            path.write_text(json.dumps({"jobId": job_id, **state}, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            continue


def job_health(state: dict) -> dict:
    if state.get("status") not in ("running", "cancelling"):
        return {"stalled": False}
    try:
        updated = datetime.fromisoformat(str(state.get("updatedAt", "")).replace("Z", "+00:00"))
        stale_seconds = max(0, int((datetime.now(timezone.utc) - updated).total_seconds()))
    except (TypeError, ValueError):
        stale_seconds = 0
    threshold = max(120, int(os.environ.get("AI_JOB_STALL_SECONDS", "300")))
    return {"stalled": stale_seconds >= threshold, "staleSeconds": stale_seconds, "stallThresholdSeconds": threshold}


def persist_job_request(job_id: str, task_type: str, body: dict) -> Path | None:
    """Persist a local replay request so interrupted generation can be restarted safely."""
    safe_job_id = "".join(character for character in job_id if character.isalnum() or character in "-_")
    if not safe_job_id:
        return None
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    request_file = JOBS_DIR / f"{safe_job_id}.request.json"
    request = {**body, "jobId": job_id, "taskType": task_type}
    request.pop("resume", None)
    request_file.write_text(json.dumps(request, ensure_ascii=False, indent=2), encoding="utf-8")
    return request_file


def job_cancelled(job_id: str) -> bool:
    with job_lock:
        return bool(job_id and jobs.get(job_id, {}).get("cancelRequested"))


def ensure_job_active(job_id: str):
    if job_cancelled(job_id):
        update_job(job_id, status="cancelled")
        raise RuntimeError("Tác vụ đã được hủy tại điểm dừng an toàn")


def save_diffusion_preview(pipe, latents, target: Path, width: int, height: int) -> bool:
    """Decode a best-effort preview without changing the active generation state."""
    try:
        preview_latents = latents.detach()
        if preview_latents.ndim == 3 and hasattr(pipe, "_unpack_latents"):
            preview_latents = pipe._unpack_latents(preview_latents, height, width, pipe.vae_scale_factor)
        if preview_latents.ndim != 4 or not hasattr(pipe, "vae"):
            return False
        scaling = float(getattr(pipe.vae.config, "scaling_factor", 1.0) or 1.0)
        shift = getattr(pipe.vae.config, "shift_factor", None)
        preview_latents = preview_latents / scaling
        if shift is not None:
            preview_latents = preview_latents + float(shift)
        with torch.inference_mode():
            decoded = pipe.vae.decode(preview_latents, return_dict=False)[0]
            image = pipe.image_processor.postprocess(decoded, output_type="pil")[0]
        image.thumbnail((384, 384), Image.Resampling.LANCZOS)
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, format="JPEG", quality=82, optimize=True)
        return True
    except Exception:
        return False


def load_predictor():
    global predictor
    if predictor is not None:
        return predictor
    if MODEL_VARIANT not in MODEL_TABLE:
        raise RuntimeError(f"SAM2_VARIANT không hợp lệ: {MODEL_VARIANT}")
    checkpoint_name, config_name = MODEL_TABLE[MODEL_VARIANT]
    checkpoint = MODELS / checkpoint_name
    if not checkpoint.exists():
        raise RuntimeError(f"Thiếu checkpoint: {checkpoint}")
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    model = build_sam2(config_name, str(checkpoint), device=device)
    predictor = SAM2ImagePredictor(model)
    return predictor


def safe_sample(sample_id: str) -> Path:
    if sample_id.startswith("uploads/"):
        base = (ROOT / "workspace" / "uploads").resolve()
        relative = sample_id.removeprefix("uploads/")
    else:
        base = SAMPLES.resolve()
        relative = sample_id
    target = (base / relative).resolve()
    if base not in target.parents or not target.is_file():
        raise ValueError("Ảnh nguồn không hợp lệ")
    return target


def encode_mask(mask: np.ndarray) -> str:
    image = Image.fromarray((mask.astype(np.uint8) * 255), mode="L")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def encode_image(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def decode_mask(value: str, size: tuple[int, int]) -> Image.Image:
    prefix = "data:image/png;base64,"
    if not value.startswith(prefix):
        raise ValueError("Mask PNG không hợp lệ")
    raw = base64.b64decode(value[len(prefix):], validate=True)
    return Image.open(io.BytesIO(raw)).convert("L").resize(size, Image.Resampling.NEAREST)


def decode_image(value: str) -> Image.Image:
    prefixes = ("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,")
    prefix = next((item for item in prefixes if value.startswith(item)), None)
    if not prefix:
        raise ValueError("Ảnh trang phục không hợp lệ")
    raw = base64.b64decode(value[len(prefix):], validate=True)
    if len(raw) > 20 * 1024 * 1024:
        raise ValueError("Ảnh trang phục vượt quá 20 MB")
    return Image.open(io.BytesIO(raw)).convert("RGB")


def _box_iou(a, b) -> float:
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, x1 - x0) * max(0, y1 - y0)
    union = max(1, (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection)
    return intersection / union


def _box_overlap_min(a, b) -> float:
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, x1 - x0) * max(0, y1 - y0)
    smaller = max(1, min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])))
    return intersection / smaller


def load_pose_model():
    global pose_model
    if pose_model is None:
        if not POSE_MODEL.is_file():
            raise RuntimeError(f"Thiếu model pose: {POSE_MODEL}")
        from ultralytics import YOLO
        pose_model = YOLO(str(POSE_MODEL))
    return pose_model


def detect_people_pose(source: Image.Image) -> list[dict]:
    model = load_pose_model()
    results = model.predict(np.asarray(source.convert("RGB")), imgsz=640, conf=0.25, device=0 if device == "cuda" else "cpu", verbose=False)
    people = []
    if not results:
        return people
    result = results[0]
    boxes = result.boxes.xyxy.detach().cpu().numpy() if result.boxes is not None else []
    confidences = result.boxes.conf.detach().cpu().numpy() if result.boxes is not None else []
    xy = result.keypoints.xy.detach().cpu().numpy() if result.keypoints is not None else []
    keypoint_conf = result.keypoints.conf.detach().cpu().numpy() if result.keypoints is not None and result.keypoints.conf is not None else []
    order = np.argsort(-((boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1]))) if len(boxes) else []
    for new_index, index in enumerate(order[:8]):
        points = []
        for point_index, point in enumerate(xy[index]):
            confidence = float(keypoint_conf[index][point_index]) if len(keypoint_conf) else 1.0
            points.append([round(float(point[0]), 1), round(float(point[1]), 1), round(confidence, 4)])
        box = boxes[index]
        people.append({
            "index": new_index, "box": [round(float(value), 1) for value in box],
            "normalizedBox": [round(float(box[0] / source.width), 4), round(float(box[1] / source.height), 4), round(float(box[2] / source.width), 4), round(float(box[3] / source.height), 4)],
            "confidence": round(float(confidences[index]), 4), "keypoints": points, "source": "yolo11n-pose",
        })
    return people


def detect_people(source: Image.Image, use_pose: bool = False) -> list[dict]:
    if use_pose:
        detected = detect_people_pose(source)
        if detected:
            return detected
    rgb = np.asarray(source.convert("RGB"))
    height, width = rgb.shape[:2]
    scale = min(1000 / max(width, height), 1.0)
    small = cv2.resize(rgb, None, fx=scale, fy=scale) if scale < 1 else rgb
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    boxes = []
    face_detector = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    for x, y, w, h in face_detector.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=4, minSize=(24, 24)):
        fx, fy, fw, fh = x / scale, y / scale, w / scale, h / scale
        boxes.append([max(0, fx - 2.0 * fw), max(0, fy - 0.45 * fh), min(width, fx + 3.0 * fw), min(height, fy + 7.6 * fh)])
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
    found, weights = hog.detectMultiScale(cv2.cvtColor(small, cv2.COLOR_RGB2BGR), winStride=(8, 8), padding=(8, 8), scale=1.05)
    for (x, y, w, h), weight in zip(found, weights):
        if float(weight) < 0.2:
            continue
        boxes.append([x / scale, y / scale, (x + w) / scale, (y + h) / scale])
    boxes.sort(key=lambda box: -((box[2] - box[0]) * (box[3] - box[1])))
    merged = []
    for box in boxes:
        if any(_box_iou(box, existing) > 0.25 or _box_overlap_min(box, existing) > 0.55 for existing in merged):
            continue
        merged.append(box)
    if not merged:
        merged = [[width * 0.18, height * 0.05, width * 0.82, height * 0.98]]
    merged.sort(key=lambda box: (box[0], box[1]))
    return [{
        "index": index, "box": [round(float(value), 1) for value in box],
        "normalizedBox": [round(box[0] / width, 4), round(box[1] / height, 4), round(box[2] / width, 4), round(box[3] / height, 4)],
        "source": "local-face-hog" if boxes else "center-fallback",
    } for index, box in enumerate(merged[:8])]


def pose_garment_prior(size, category: str, person_box, keypoints=None) -> np.ndarray:
    """Build a conservative category silhouette from pose, used only when SAM is incomplete."""
    width, height = size
    px0, py0, px1, py1 = [float(value) for value in person_box]
    pw, ph = max(1.0, px1 - px0), max(1.0, py1 - py0)
    prior = np.zeros((height, width), dtype=np.uint8)
    reliable = lambda index: bool(keypoints and index < len(keypoints) and keypoints[index][2] > 0.25)
    shoulder_width = pw * 0.42
    if reliable(5) and reliable(6):
        shoulder_width = max(20.0, abs(keypoints[6][0] - keypoints[5][0]))
    thickness = max(10, round(shoulder_width * 0.34))

    if category in ("upper_body", "overall", "full_body") and all(reliable(index) for index in (5, 6, 11, 12)):
        hip_raise = ph * 0.05 if category == "upper_body" else 0.0
        torso = np.asarray([
            [keypoints[5][0], keypoints[5][1]], [keypoints[6][0], keypoints[6][1]],
            [keypoints[12][0], keypoints[12][1] - hip_raise], [keypoints[11][0], keypoints[11][1] - hip_raise],
        ], dtype=np.int32)
        cv2.fillConvexPoly(prior, torso, 255)
        for shoulder, elbow, wrist in ((5, 7, 9), (6, 8, 10)):
            points = [shoulder] + ([elbow] if reliable(elbow) else []) + ([wrist] if reliable(wrist) else [])
            for first, second in zip(points, points[1:]):
                cv2.line(prior, (round(keypoints[first][0]), round(keypoints[first][1])), (round(keypoints[second][0]), round(keypoints[second][1])), 255, thickness)
    elif category in ("upper_body", "overall", "full_body"):
        cv2.rectangle(prior, (round(px0 + pw * 0.27), round(py0 + ph * 0.20)), (round(px0 + pw * 0.73), round(py0 + ph * 0.56)), 255, -1)

    if category in ("lower_body", "overall", "full_body") and all(reliable(index) for index in (11, 12, 13, 14)):
        hips = np.asarray([[keypoints[index][0], keypoints[index][1]] for index in (11, 12, 14, 13)], dtype=np.int32)
        cv2.fillConvexPoly(prior, hips, 255)
        leg_thickness = max(12, round(shoulder_width * 0.30))
        for hip, knee, ankle in ((11, 13, 15), (12, 14, 16)):
            points = [hip, knee] + ([ankle] if reliable(ankle) else [])
            for first, second in zip(points, points[1:]):
                cv2.line(prior, (round(keypoints[first][0]), round(keypoints[first][1])), (round(keypoints[second][0]), round(keypoints[second][1])), 255, leg_thickness)
    elif category == "lower_body":
        cv2.rectangle(prior, (round(px0 + pw * 0.28), round(py0 + ph * 0.43)), (round(px0 + pw * 0.72), round(py0 + ph * 0.95)), 255, -1)
    return prior


def fill_garment_mask_holes(mask: np.ndarray) -> np.ndarray:
    """Fill small enclosed SAM texture gaps, preserving open background channels."""
    binary = (np.asarray(mask) > 0).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(1 - binary, 8)
    limit = max(64, round(int(binary.sum()) * 0.035))
    height, width = binary.shape
    for index in range(1, count):
        x, y, w, h, area = stats[index]
        if x > 0 and y > 0 and x + w < width and y + h < height and area <= limit:
            binary[labels == index] = 1
    return binary


def upper_garment_prompt(size, person_box, keypoints):
    """Pose bounds must include raised sleeves and hems below the hip joints.

    SAM still determines the fabric silhouette. A hip landmark is not a shirt
    boundary, so it must never be used as a hard central cut through the mask.
    """
    if not keypoints or len(keypoints) <= 12:
        return None
    reliable = lambda i: len(keypoints[i]) >= 3 and keypoints[i][2] > .25 and np.isfinite(keypoints[i][:3]).all()
    if not all(reliable(i) for i in (5, 6, 11, 12)):
        return None
    width, height = size
    px0, py0, px1, py1 = person_box
    shoulder = np.mean(np.asarray([keypoints[5][:2], keypoints[6][:2]]), axis=0)
    hip = np.mean(np.asarray([keypoints[11][:2], keypoints[12][:2]]), axis=0)
    torso = float(hip[1] - shoulder[1])
    if torso < (py1-py0)*.1:
        return None
    arm = np.asarray([keypoints[i][:2] for i in range(5,11) if reliable(i)])
    padding = max(8., torso*.18)
    box = np.asarray([max(0., min(px0, arm[:,0].min()-padding)),
                      max(0., min(arm[:,1].min()-padding, shoulder[1]-padding)),
                      min(float(width), max(px1, arm[:,0].max()+padding)),
                      min(float(height), py1, max(keypoints[11][1],keypoints[12][1])+torso*.35)],dtype=np.float32)
    # Interior torso prompts avoid background, collars and trousers even when
    # the person is sitting or the detector's full-height box is imprecise.
    coords = np.asarray([shoulder*.7+hip*.3, shoulder*.35+hip*.65],dtype=np.float32)
    return box, coords


def automatic_garment_mask(source: Image.Image, category: str, person_box=None, keypoints=None, points=None) -> tuple[Image.Image, float]:
    """Create a category-aware garment mask with SAM 2 and conservative body bounds."""
    image = np.asarray(source.convert("RGB"))
    width, height = source.size
    layouts = {
        "upper_body": ((0.03, 0.14, 0.97, 0.62), ((0.50, 0.32), (0.42, 0.37), (0.58, 0.37))),
        "lower_body": ((0.03, 0.38, 0.97, 0.96), ((0.43, 0.64), (0.57, 0.64), (0.50, 0.82))),
        "overall": ((0.03, 0.14, 0.97, 0.96), ((0.50, 0.38), (0.43, 0.66), (0.57, 0.66))),
        "full_body": ((0.03, 0.14, 0.97, 0.96), ((0.50, 0.38), (0.43, 0.66), (0.57, 0.66))),
    }
    bounds, positives = layouts.get(category, layouts["upper_body"])
    if person_box is None:
        person_box = [0, 0, width, height]
    px0, py0, px1, py1 = person_box
    pw, ph = px1 - px0, py1 - py0
    box = np.asarray([px0 + bounds[0] * pw, py0 + bounds[1] * ph, px0 + bounds[2] * pw, py0 + bounds[3] * ph], dtype=np.float32)
    if keypoints and len(keypoints) > 12 and keypoints[11][2] > 0.25 and keypoints[12][2] > 0.25:
        waist_y = float(np.mean([keypoints[11][1], keypoints[12][1]])) - ph * 0.10
        if category == "lower_body":
            box[1] = waist_y
    coords = np.asarray([[px0 + x * pw, py0 + y * ph] for x, y in positives], dtype=np.float32)
    upper_prompt = upper_garment_prompt(source.size, person_box, keypoints) if category == 'upper_body' else None
    if upper_prompt is not None:
        box, coords = upper_prompt
    labels = np.ones(len(coords), dtype=np.int32)
    hints = points or []
    if hints:
        hint_coords = np.asarray([[float(point["x"]), float(point["y"])] for point in hints], dtype=np.float32)
        hint_labels = np.asarray([int(point.get("label", 1)) for point in hints], dtype=np.int32)
        if not np.isfinite(hint_coords).all() or not np.isin(hint_labels, [0, 1]).all():
            raise ValueError("Điểm chọn mask không hợp lệ")
        if (hint_coords[:, 0] < 0).any() or (hint_coords[:, 0] >= width).any() or (hint_coords[:, 1] < 0).any() or (hint_coords[:, 1] >= height).any():
            raise ValueError("Điểm chọn nằm ngoài ảnh")
        if (hint_labels == 1).any():
            coords, labels = hint_coords, hint_labels
        else:
            coords, labels = np.concatenate([coords, hint_coords]), np.concatenate([labels, hint_labels])
    if keypoints:
        negative_points = [[point[0], point[1]] for index, point in enumerate(keypoints) if index in (0, 9, 10) and point[2] > 0.25]
        if category == 'upper_body':
            negative_points += [[point[0], point[1]] for index, point in enumerate(keypoints) if index in (13,14) and point[2] > .25]
        if negative_points:
            coords = np.concatenate([coords, np.asarray(negative_points, dtype=np.float32)])
            labels = np.concatenate([labels, np.zeros(len(negative_points), dtype=np.int32)])
    model = load_predictor()
    with torch.inference_mode(), torch.autocast(device_type=device, dtype=torch.bfloat16, enabled=device == "cuda"):
        model.set_image(image)
        masks, scores, _ = model.predict(point_coords=coords, point_labels=labels, box=box, multimask_output=True)
    x0, y0, x1, y1 = box.astype(int)
    allowed = np.zeros((height, width), dtype=bool)
    allowed[max(0, y0):min(height, y1), max(0, x0):min(width, x1)] = True
    candidates = [np.logical_and(mask, allowed) for mask in masks]
    areas = np.asarray([candidate.mean() for candidate in candidates])
    valid = np.where(areas > 0.025, scores, -1)
    best = int(np.argmax(valid))
    mask = candidates[best].copy()
    # Near-equivalent proposals often disagree only on highlights and folds.
    for index, candidate in enumerate(candidates):
        union = np.logical_or(mask, candidate).sum()
        overlap = np.logical_and(mask, candidate).sum() / max(1, union)
        if index != best and scores[index] >= scores[best] - 0.08 and overlap >= 0.75:
            if category == 'upper_body':
                # A second SAM proposal may include trousers. Only use it to
                # repair nearby fabric edges, not to grow the garment wholesale.
                nearby = cv2.dilate(mask.astype(np.uint8), np.ones((7,7),np.uint8)) > 0
                mask |= candidate & nearby
            else:
                mask |= candidate
    mask = fill_garment_mask_holes(mask).astype(bool)
    trusted_silhouette = mask.copy()
    pose_prior = pose_garment_prior(source.size, category, person_box, keypoints)
    if not keypoints and category in ("upper_body", "overall", "full_body"):
        face_cut = max(0, min(height, int(py0 + 0.21 * ph)))
        mask[:face_cut, :] = False
    if keypoints:
        protection = np.zeros((height, width), dtype=np.uint8)
        shoulder_width = ph * 0.18
        if len(keypoints) > 6 and keypoints[5][2] > 0.25 and keypoints[6][2] > 0.25:
            shoulder_width = max(shoulder_width, abs(keypoints[6][0] - keypoints[5][0]))
        # Hands are excluded by the skin-aware protection below. Large wrist
        # circles would also lock old cuffs and fabric next to the hands.
        for point_index, radius_factor in ((0, 0.28), (1, 0.22), (2, 0.22), (3, 0.18), (4, 0.18)):
            if point_index < len(keypoints) and keypoints[point_index][2] > 0.25:
                cv2.circle(protection, (round(keypoints[point_index][0]), round(keypoints[point_index][1])), max(5, round(shoulder_width * radius_factor)), 255, -1)
        mask[protection > 0] = False
    # A SAM miss should not silently create an empty batch item.
    prior_pixels = int((pose_prior > 0).sum())
    overlap_pixels = int(np.logical_and(mask, pose_prior > 0).sum())
    prior_coverage = float(overlap_pixels / prior_pixels) if prior_pixels else 1.0
    # A narrow SAM strip creates a visible insert. Complete it with the pose
    # silhouette when less than 72% of the expected garment is covered.
    if not hints and prior_pixels and prior_coverage < 0.72:
        mask = np.logical_or(mask, pose_prior > 0)
    elif not hints and mask.mean() < 0.025:
        mask = np.logical_and(allowed, pose_prior > 0) if prior_pixels else allowed
    if keypoints:
        mask[protection > 0] = False
    # Close small holes and extend only a few pixels across shoulder/waist seams.
    # The result remains clipped to the category-aware body box above.
    refined = mask.astype(np.uint8) * 255
    refined = cv2.morphologyEx(refined, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    if category == "upper_body":
        refined = cv2.dilate(refined, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 5)), iterations=1)
    else:
        refined = cv2.dilate(refined, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)), iterations=1)
    refined[~allowed] = 0
    # Pose completion may fill missed fabric, but must not invent rectangular
    # strips of background alongside the arms or legs.
    silhouette = (trusted_silhouette.astype(np.uint8) if category == 'upper_body' else
                  fill_garment_mask_holes(np.logical_or.reduce(np.asarray(masks, dtype=bool), axis=0)))
    silhouette = cv2.dilate(silhouette, np.ones((5, 5), np.uint8), iterations=1)
    refined[silhouette == 0] = 0
    # A combined shirt+trousers prompt can treat pale shirt highlights as
    # background connected to the sleeve edge. Recover the shirt separately.
    if hints and category in ("upper_body", "overall", "full_body") and not any(int(point.get("label", 1)) == 0 for point in hints):
        shirt, _ = automatic_garment_mask(source, "upper_body", person_box, keypoints)
        refined = np.maximum(refined, np.asarray(shirt, dtype=np.uint8))
    for point in hints:
        if int(point.get("label", 1)) == 0:
            cv2.circle(refined, (round(float(point["x"])), round(float(point["y"]))), max(3, round(min(width, height) * 0.008)), 0, -1)
    protected = automatic_protected_detail_mask(source, person_box, keypoints)
    refined[np.asarray(protected) > 0] = 0
    output = Image.fromarray(refined, mode="L")
    return output, float(scores[best])


def catvton_dedicated_mask(source: Image.Image, category: str, person_box, keypoints=None):
    """Pose-first CatVTON mask that excludes the waistband and identity details."""
    if category != "upper_body" or not keypoints:
        mask, score = automatic_garment_mask(source, category, person_box, keypoints)
        return mask, score, {"mode": "standard-fallback", "waistLeakage": None}
    width, height = source.size
    px0, py0, px1, py1 = [float(value) for value in person_box]
    ph = max(1.0, py1 - py0)
    reliable = lambda index: index < len(keypoints) and keypoints[index][2] > 0.25
    if not all(reliable(index) for index in (5, 6, 11, 12)):
        mask, score = automatic_garment_mask(source, category, person_box, keypoints)
        return mask, score, {"mode": "standard-fallback", "waistLeakage": None}
    shoulder_width = max(20.0, abs(keypoints[6][0] - keypoints[5][0]))
    sleeve_thickness = max(14, round(shoulder_width * 0.42))
    hip_y = float(np.mean([keypoints[11][1], keypoints[12][1]]))
    hem_y = max(float(max(keypoints[5][1], keypoints[6][1]) + ph * 0.16), hip_y - ph * 0.13)
    dedicated = np.zeros((height, width), dtype=np.uint8)
    torso = np.asarray([
        [keypoints[5][0] - shoulder_width * 0.12, keypoints[5][1] - ph * 0.015],
        [keypoints[6][0] + shoulder_width * 0.12, keypoints[6][1] - ph * 0.015],
        [keypoints[12][0] + shoulder_width * 0.16, hem_y],
        [keypoints[11][0] - shoulder_width * 0.16, hem_y],
    ], dtype=np.int32)
    cv2.fillConvexPoly(dedicated, torso, 255)
    for shoulder, elbow, wrist in ((5, 7, 9), (6, 8, 10)):
        points = [shoulder] + ([elbow] if reliable(elbow) else []) + ([wrist] if reliable(wrist) else [])
        for first, second in zip(points, points[1:]):
            cv2.line(dedicated, (round(keypoints[first][0]), round(keypoints[first][1])), (round(keypoints[second][0]), round(keypoints[second][1])), 255, sleeve_thickness)
    # Keep the pose silhouette dense enough to replace short sleeves, while
    # subtracting head, hands, and a small safety band above the waistband.
    dedicated = cv2.morphologyEx(dedicated, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    protected = np.asarray(automatic_protected_detail_mask(source, person_box, keypoints), dtype=np.uint8) > 16
    dedicated[protected] = 0
    center_left = max(0, round(px0 + (px1 - px0) * 0.10))
    center_right = min(width, round(px0 + (px1 - px0) * 0.90))
    dedicated[max(0, round(hem_y)):, center_left:center_right] = 0
    mask = Image.fromarray(dedicated, mode="L")
    pixels = dedicated > 16
    waist_band_start = max(0, round(hip_y - ph * 0.08))
    waist_leakage = float(pixels[waist_band_start:, center_left:center_right].sum() / max(1, pixels.sum()))
    hand_overlap = float(np.logical_and(pixels, protected).sum() / max(1, pixels.sum()))
    metrics = {
        "mode": "pose-dedicated", "hemY": round(hem_y, 1),
        "coverage": float(pixels.mean()), "waistLeakage": waist_leakage,
        "protectedOverlap": hand_overlap, "accepted": pixels.mean() >= 0.025 and waist_leakage <= 0.005 and hand_overlap <= 0.001,
    }
    policy = mask_strength_policy(mask, person_box, category, keypoints)
    if not policy['accepted']:
        fallback, confidence = automatic_garment_mask(source, category, person_box, keypoints)
        fallback = exclude_protected_pixels(fallback, Image.fromarray(protected.astype(np.uint8) * 255))
        fallback_policy = mask_strength_policy(fallback, person_box, category, keypoints)
        if confidence >= 0.8 and fallback_policy['accepted']:
            return fallback, confidence, {"mode":"standard-coverage-fallback","accepted":True,"protectedOverlap":0.0,"waistLeakage":None,"dedicatedMask":metrics,"dedicatedPolicy":policy,"policy":fallback_policy}
        metrics['accepted'] = False
        metrics['coveragePolicy'] = policy
    return mask, 1.0, metrics


def mask_strength_policy(mask: Image.Image, person_box=None, category: str = "upper_body", keypoints=None) -> dict:
    coverage = float((np.asarray(mask, dtype=np.uint8) > 16).mean())
    relative_coverage = None
    completeness = None
    if person_box is not None:
        px0, py0, px1, py1 = [int(round(value)) for value in person_box]
        mask_array = np.asarray(mask, dtype=np.uint8) > 16
        person_pixels = max(1, max(0, px1 - px0) * max(0, py1 - py0))
        relative_coverage = float(mask_array[max(0, py0):min(mask.height, py1), max(0, px0):min(mask.width, px1)].sum() / person_pixels)
        prior = pose_garment_prior(mask.size, category, person_box, keypoints) > 0
        if keypoints:
            protected = np.asarray(automatic_protected_detail_mask(Image.new("RGB", mask.size), person_box, keypoints), dtype=np.uint8) > 16
            prior = np.logical_and(prior, ~protected)
        prior_pixels = int(prior.sum())
        completeness = float(np.logical_and(mask_array, prior).sum() / prior_pixels) if prior_pixels else None
    accepted = coverage >= 0.025 and (completeness is None or completeness >= 0.72)
    if coverage < 0.045:
        strength = 0.50
    elif coverage < 0.08:
        strength = 0.60
    else:
        strength = 0.70
    return {"coverage": coverage, "relativePersonCoverage": relative_coverage, "garmentCompleteness": completeness, "accepted": accepted, "recommendedStrength": strength, "minimumCoverage": 0.025, "minimumGarmentCompleteness": 0.72}


def effective_step_policy(requested_steps: int, strength: float, minimum_effective_steps: int = 12, allow_fast_preview: bool = False) -> dict:
    """Guarantee enough denoising work after diffusers truncates timesteps by strength."""
    requested = max(4, min(60, int(requested_steps)))
    bounded_strength = max(0.2, min(1.0, float(strength)))
    minimum = 0 if allow_fast_preview else max(0, min(24, int(minimum_effective_steps)))
    required_total = int(np.ceil(minimum / bounded_strength)) if minimum else requested
    adjusted = max(requested, required_total)
    adjusted = min(60, adjusted)
    effective = max(1, int(adjusted * bounded_strength))
    return {
        "requestedSteps": requested, "adjustedSteps": adjusted, "effectiveSteps": effective,
        "minimumEffectiveSteps": minimum, "autoAdjusted": adjusted != requested,
        "allowFastPreview": bool(allow_fast_preview),
    }


def prepare_dual_inpaint_masks(
    editable_mask: Image.Image,
    protected_mask: Image.Image | None = None,
    generation_expand: int = 24,
    composite_expand: int | None = None,
):
    """Build a generous generation mask and a tighter final-composite mask."""
    generation_expand = max(0, min(64, int(generation_expand)))
    if composite_expand is None:
        composite_expand = min(8, max(2, round(generation_expand * 0.25)))
    composite_expand = max(0, min(generation_expand, int(composite_expand)))

    base = editable_mask.convert("L").point(lambda value: 255 if value > 16 else 0)
    # OpenCV dilation avoids the very expensive large PIL rank filter on 4K masks.
    def dilate(radius):
        return Image.fromarray(cv2.dilate(np.asarray(base), np.ones((radius*2+1, radius*2+1), np.uint8))) if radius else base.copy()
    generation, composite = dilate(generation_expand), dilate(composite_expand)
    if protected_mask is not None:
        protected = np.asarray(protected_mask.convert("L"), dtype=np.uint8) > 16
        generation_array = np.asarray(generation, dtype=np.uint8).copy()
        composite_array = np.asarray(composite, dtype=np.uint8).copy()
        generation_array[protected] = 0
        composite_array[protected] = 0
        generation = Image.fromarray(generation_array, mode="L")
        composite = Image.fromarray(composite_array, mode="L")
    return generation, composite, {
        "generationExpand": generation_expand,
        "compositeExpand": composite_expand,
        "generationPixels": int((np.asarray(generation) > 16).sum()),
        "compositePixels": int((np.asarray(composite) > 16).sum()),
    }


def adaptive_inpaint_context_padding(mask: Image.Image, requested_padding: int = 96, context_ratio: float = 0.30) -> int:
    """Keep enough surrounding pose and lighting context around the edit."""
    requested = max(0, min(256, int(requested_padding)))
    bbox = mask.getbbox()
    if bbox is None:
        return requested
    extent = max(bbox[2] - bbox[0], bbox[3] - bbox[1])
    adaptive = round(extent * max(0.0, min(0.5, float(context_ratio))))
    return max(requested, min(256, adaptive))


def adaptive_local_edge_blend(source: Image.Image, generated: Image.Image, hard_mask: Image.Image, feather_pixels: int = 12):
    """Blend inward from the mask edge and repair only abnormal dark/bright seam pixels."""
    source_array = np.asarray(source.convert("RGB"), dtype=np.uint8)
    generated_array = np.asarray(generated.convert("RGB"), dtype=np.uint8)
    binary = (np.asarray(hard_mask, dtype=np.uint8) > 16).astype(np.uint8)
    feather = max(3, min(32, int(feather_pixels)))
    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    ramp = np.clip(distance / float(feather), 0.0, 1.0)
    alpha = ramp * ramp * (3.0 - 2.0 * ramp) * binary
    # Match only low-frequency color near the boundary; keep new content in
    # the core intact and never copy source texture into the generated region.
    sigma = max(3.0, float(feather))
    ring = np.logical_and(binary > 0, distance <= max(2.0, feather * 0.25)).astype(np.float32)
    weights = cv2.GaussianBlur(ring, (0, 0), sigma)
    delta = source_array.astype(np.float32) - generated_array.astype(np.float32)
    correction = cv2.GaussianBlur(delta * ring[..., None], (0, 0), sigma) / np.maximum(weights[..., None], 1e-6)
    correction = np.clip(correction, -32.0, 32.0)
    fade = np.clip(1.0 - distance / float(feather * 3), 0.0, 1.0)
    fade = fade * fade * (3.0 - 2.0 * fade) * binary
    matched = np.clip(generated_array.astype(np.float32) + correction * fade[..., None], 0, 255)
    initial = np.clip(matched * alpha[..., None] + source_array * (1.0 - alpha[..., None]), 0, 255).astype(np.uint8)

    inner_band = np.logical_and(binary > 0, distance <= feather * 1.75)
    smooth = cv2.GaussianBlur(initial, (0, 0), 3.0)
    luminance = cv2.cvtColor(initial, cv2.COLOR_RGB2GRAY).astype(np.int16)
    smooth_luminance = cv2.cvtColor(smooth, cv2.COLOR_RGB2GRAY).astype(np.int16)
    deviation = np.abs(luminance - smooth_luminance)
    artifact = np.logical_and(inner_band, np.logical_or(deviation > 32, luminance < smooth_luminance - 24)).astype(np.uint8) * 255
    artifact = cv2.morphologyEx(artifact, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    artifact = cv2.dilate(artifact, np.ones((3, 3), np.uint8), iterations=1)
    artifact[binary == 0] = 0
    artifact_pixels = int((artifact > 0).sum())
    if artifact_pixels:
        repaired = cv2.inpaint(initial, artifact, 2.0, cv2.INPAINT_TELEA)
        repair_alpha = cv2.GaussianBlur(artifact, (0, 0), 1.2).astype(np.float32) / 255.0
        initial = np.clip(repaired * repair_alpha[..., None] + initial * (1.0 - repair_alpha[..., None]), 0, 255).astype(np.uint8)
    initial[binary == 0] = source_array[binary == 0]
    band_pixels = int(inner_band.sum())
    metrics = {
        "enabled": True, "featherPixels": feather, "bandPixels": band_pixels,
        "boundaryColorMatch": True, "featherCurve": "smoothstep",
        "artifactPixels": artifact_pixels,
        "artifactRatio": float(artifact_pixels / band_pixels) if band_pixels else 0.0,
    }
    return Image.fromarray(initial, mode="RGB"), Image.fromarray(artifact, mode="L"), metrics


def texture_preserving_core_recovery(image: Image.Image, hard_mask: Image.Image, edge_feather: int = 12, amount: float = 0.65):
    """Recover bounded high-frequency fabric detail strictly inside the stable mask core."""
    array = np.asarray(image.convert("RGB"), dtype=np.uint8)
    binary = (np.asarray(hard_mask, dtype=np.uint8) > 16).astype(np.uint8)
    feather = max(3, min(32, int(edge_feather)))
    gain = max(0.0, min(1.0, float(amount)))
    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    core_alpha = np.clip((distance - feather * 1.5) / max(3.0, feather * 1.5), 0.0, 1.0) * binary
    core = core_alpha >= 0.15
    if not core.any() or gain <= 0.0:
        metrics = {"enabled": gain > 0.0, "amount": gain, "corePixels": int(core.sum()), "laplacianVarianceBefore": 0.0, "laplacianVarianceAfter": 0.0, "detailGain": 0.0}
        return image.copy(), Image.fromarray((core_alpha * 255).astype(np.uint8), mode="L"), metrics

    # Bilateral high-pass retains generated garment edges while avoiding color halos.
    smooth = cv2.bilateralFilter(array, 0, 18, 2.2).astype(np.float32)
    original = array.astype(np.float32)
    high_frequency = np.clip(original - smooth, -18.0, 18.0)
    enhanced = np.clip(original + high_frequency * gain, 0, 255)
    alpha = (core_alpha * gain)[..., None]
    recovered = np.clip(enhanced * alpha + original * (1.0 - alpha), 0, 255).astype(np.uint8)

    gray_before = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    gray_after = cv2.cvtColor(recovered, cv2.COLOR_RGB2GRAY)
    lap_before = cv2.Laplacian(gray_before, cv2.CV_32F)[core]
    lap_after = cv2.Laplacian(gray_after, cv2.CV_32F)[core]
    variance_before = float(lap_before.var()) if lap_before.size else 0.0
    variance_after = float(lap_after.var()) if lap_after.size else 0.0
    metrics = {
        "enabled": True, "amount": gain, "corePixels": int(core.sum()),
        "laplacianVarianceBefore": variance_before, "laplacianVarianceAfter": variance_after,
        "detailGain": float(variance_after / max(variance_before, 1e-6)),
    }
    return Image.fromarray(recovered, mode="RGB"), Image.fromarray((core_alpha * 255).astype(np.uint8), mode="L"), metrics


def detect_core_structural_artifacts(image: Image.Image, hard_mask: Image.Image, edge_feather: int = 12):
    """Find unusually dark, elongated marks inside the stable garment core."""
    array = np.asarray(image.convert("RGB"), dtype=np.uint8)
    gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    binary = (np.asarray(hard_mask, dtype=np.uint8) > 16).astype(np.uint8)
    feather = max(3, min(32, int(edge_feather)))
    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    core = np.logical_and(binary > 0, distance >= feather * 1.5)
    if not core.any():
        return Image.new("L", image.size, 0), {"detected": False, "artifactPixels": 0, "componentCount": 0}

    # A vertical black-hat isolates dark marks relative to nearby fabric while
    # rejecting broad shadows and ordinary low-frequency folds.
    local_close = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 31)))
    response = cv2.subtract(local_close, gray)
    core_values = response[core]
    threshold = max(16.0, float(np.percentile(core_values, 98.5)))
    candidates = np.logical_and(core, response >= threshold).astype(np.uint8) * 255
    candidates = cv2.morphologyEx(candidates, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 9)))

    accepted = np.zeros_like(candidates)
    component_count = 0
    core_y, core_x = np.where(core)
    core_left, core_right = int(core_x.min()), int(core_x.max())
    central_left = core_left + (core_right - core_left) * 0.25
    central_right = core_right - (core_right - core_left) * 0.25
    count, labels, stats, _ = cv2.connectedComponentsWithStats(candidates, 8)
    plausible = []
    for label in range(1, count):
        x, y, width, height, area = [int(value) for value in stats[label]]
        elongated = height >= 22 and height >= width * 1.6 and area >= 12
        compact_mark = 8 <= area <= 180 and height >= 4 and width <= 14
        if elongated and central_left <= x + width * 0.5 <= central_right:
            accepted[labels == label] = 255
            component_count += 1
        elif compact_mark:
            plausible.append((label, x + width * 0.5, y, y + height))
    # A single button or stitch is legitimate. A vertically aligned sequence of
    # dark fragments spanning a larger distance is treated as a broken artifact.
    for label, center_x, top, bottom in plausible:
        aligned = [item for item in plausible if abs(item[1] - center_x) <= 14]
        span = max(item[3] for item in aligned) - min(item[2] for item in aligned)
        if len(aligned) >= 2 and span >= 35:
            accepted[labels == label] = 255
            component_count += 1
    if component_count:
        accepted = cv2.dilate(accepted, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 13)), iterations=1)
        accepted[~core] = 0
    artifact_pixels = int((accepted > 0).sum())
    return Image.fromarray(accepted, mode="L"), {
        "detected": artifact_pixels >= 500, "artifactPixels": artifact_pixels,
        "componentCount": component_count, "responseThreshold": threshold,
    }


def generative_core_structural_refine(image: Image.Image, hard_mask: Image.Image, seed: int, steps: int, edge_feather: int = 12):
    """Resynthesize only detected core defects and softly composite the small repaired region."""
    defect_mask, metrics = detect_core_structural_artifacts(image, hard_mask, edge_feather)
    if not metrics["detected"]:
        metrics.update({"applied": False, "reason": "no-confident-structural-artifact"})
        return image.copy(), defect_mask, metrics
    refine_mask = defect_mask.filter(ImageFilter.MaxFilter(9)).point(lambda value: 255 if value > 12 else 0)
    max_side = 768
    scale = min(max_side / max(image.size), 1.0)
    width = max(64, round(image.width * scale / 64) * 64)
    height = max(64, round(image.height * scale / 64) * 64)
    generator = torch.Generator(device="cpu").manual_seed(seed + 700000)
    pipe = load_inpaint_pipe()
    with torch.inference_mode():
        generated = traced_pipeline_call(pipe, 
            prompt=prompt_text('generative_core_structural_refine.continuous_coherent_woven_garment_fabric_natural_folds'),
            negative_prompt=prompt_text('generative_core_structural_refine.zipper_isolated_buttons_vertical_scratch_tear_stain'),
            image=image.resize((width, height), Image.Resampling.LANCZOS),
            mask_image=refine_mask.resize((width, height), Image.Resampling.NEAREST),
            height=height, width=width, padding_mask_crop=96, strength=0.48,
            num_inference_steps=max(12, min(24, int(steps))), guidance_scale=4.0, generator=generator,
        ).images[0]
    generated = generated.resize(image.size, Image.Resampling.LANCZOS)
    blend = refine_mask.filter(ImageFilter.GaussianBlur(2.0))
    output = Image.composite(generated, image, blend)
    metrics.update({"applied": True, "strength": 0.48, "steps": max(12, min(24, int(steps)))})
    return output, refine_mask, metrics


def automatic_protected_detail_mask(source: Image.Image, person_box, keypoints=None) -> Image.Image:
    """Protect identity-bearing head/hair and hands inside an editable garment region."""
    width, height = source.size
    px0, py0, px1, py1 = [float(value) for value in person_box]
    pw, ph = max(1.0, px1 - px0), max(1.0, py1 - py0)
    protected = np.zeros((height, width), dtype=np.uint8)
    head_top, head_bottom = py0 - ph * 0.015, py0 + ph * 0.23
    head_x, head_radius = px0 + pw * 0.5, pw * 0.24
    if keypoints and len(keypoints) > 6 and keypoints[5][2] > 0.25 and keypoints[6][2] > 0.25:
        shoulder_y = min(keypoints[5][1], keypoints[6][1])
        head_bottom = max(py0 + ph * 0.10, shoulder_y - ph * 0.025)
        face_points = [point for point in keypoints[:5] if point[2] > 0.25]
        if face_points:
            head_x = float(np.mean([point[0] for point in face_points]))
        head_radius = max(pw * 0.18, abs(keypoints[6][0] - keypoints[5][0]) * 0.54)
    head_center = (round(head_x), round((head_top + head_bottom) / 2))
    head_axes = (max(8, round(head_radius)), max(12, round((head_bottom - head_top) / 2)))
    cv2.ellipse(protected, head_center, head_axes, 0, 0, 360, 255, -1)
    rgb = np.asarray(source.convert("RGB"), dtype=np.uint8)
    ycrcb = cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb)
    skin = cv2.inRange(ycrcb, np.asarray([0, 130, 75], dtype=np.uint8), np.asarray([255, 185, 140], dtype=np.uint8))
    warm_skin = (rgb[:, :, 0].astype(np.int16) > rgb[:, :, 1].astype(np.int16) + 5) & (rgb[:, :, 1].astype(np.int16) > rgb[:, :, 2].astype(np.int16) + 2)
    skin[~warm_skin] = 0
    skin = cv2.morphologyEx(skin, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    # Below the face, a geometric oval can contain the old shirt collar.
    # Preserve skin and dark hair here, rather than copying the collar back.
    lower_head = max(0, round(head_top + (head_bottom - head_top) * 0.62))
    head_core = protected.copy()
    head_core[lower_head:] = 0
    hair = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY) < 95
    protected[lower_head:][~((skin > 0) | hair)[lower_head:]] = 0
    if keypoints:
        shoulder_width = ph * 0.18
        if len(keypoints) > 6 and keypoints[5][2] > 0.25 and keypoints[6][2] > 0.25:
            shoulder_width = max(shoulder_width, abs(keypoints[6][0] - keypoints[5][0]))
        for point_index in (9, 10):
            if point_index < len(keypoints) and keypoints[point_index][2] > 0.25:
                hand_region = np.zeros_like(protected)
                wrist = np.asarray(keypoints[point_index][:2], dtype=np.float32)
                cv2.circle(hand_region, tuple(np.round(wrist).astype(int)), max(10, round(shoulder_width * 0.22)), 255, -1)
                elbow_index = point_index - 2
                if keypoints[elbow_index][2] > 0.25:
                    elbow = np.asarray(keypoints[elbow_index][:2], dtype=np.float32)
                    tip = wrist + (wrist - elbow) * 0.45
                    cv2.line(hand_region, tuple(np.round(wrist).astype(int)), tuple(np.round(tip).astype(int)), 255, max(12, round(shoulder_width * 0.28)))
                # Restrict wrist/hand protection to source skin. Large circles
                # otherwise lock old cuffs, elbow fabric and nearby trousers.
                protected[(hand_region > 0) & (skin > 0)] = 255
    # Dark collars/cuffs can satisfy the hair/skin colour tests. Keeping those
    # pixels feeds old fabric back into the model and copies it over the result.
    # Only a confident garment label may unlock them; the head core stays locked.
    import character_quality
    if character_quality.available(ROOT):
        labels, confident = character_quality.parse(source, ROOT)
        fabric = np.isin(labels, [4, 7]) & confident & (head_core == 0)
        protected[fabric] = 0
    return Image.fromarray(protected, mode="L")


def sleeveless_reference(garment: Image.Image) -> bool:
    rgb = np.asarray(garment.convert("RGB"), dtype=np.float32)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    foreground = np.linalg.norm(rgb - np.median(border, axis=0), axis=2) > 45
    ys, xs = np.where(foreground)
    if not len(ys):
        return False
    crop = foreground[ys.min():ys.max()+1, xs.min():xs.max()+1]
    # Only auto-enable for unambiguous thin straps above the bodice.
    return float(crop[:max(1, round(crop.shape[0]*0.18))].mean()) < 0.25


def reference_skin_mask(source, image, person):
    rgb = np.asarray(source.convert("RGB"))
    points = person.get("keypoints") or []
    if points and points[0][2] > 0.25:
        x,y = np.round(points[0][:2]).astype(int)
    else:
        x0,y0,x1,y1=person["box"]
        x,y=round((x0+x1)/2),round(y0+(y1-y0)*0.10)
    radius=max(3,round(source.width*0.008))
    patch=rgb[max(0,y-radius):min(source.height,y+radius+1),max(0,x-radius):min(source.width,x+radius+1)]
    if not patch.size:
        return np.zeros((image.height,image.width),dtype=np.uint8)
    reference=np.median(cv2.cvtColor(patch,cv2.COLOR_RGB2LAB).reshape(-1,3),axis=0)
    lab=cv2.cvtColor(np.asarray(image.convert("RGB")),cv2.COLOR_RGB2LAB).astype(np.float32)
    chroma=np.linalg.norm(lab[:,:,1:]-reference[1:],axis=2)
    skin=(chroma<19)&(lab[:,:,0]>reference[0]-48)&(lab[:,:,0]<reference[0]+48)
    return skin.astype(np.uint8)*255


def arm_reconstruction_masks(source, person, editable, protected, result=None):
    points = person.get("keypoints") or []
    if len(points) < 13 or any(points[i][2] <= 0.25 for i in (5, 6, 7, 8, 9, 10, 11, 12)):
        return Image.new("L", source.size), protected
    width = max(20, abs(points[5][0] - points[6][0]))
    region = np.zeros((source.height, source.width), dtype=np.uint8)
    for shoulder, elbow, wrist in ((5, 7, 9), (6, 8, 10)):
        for first, second in ((shoulder, elbow), (elbow, wrist)):
            cv2.line(region, tuple(np.round(points[first][:2]).astype(int)), tuple(np.round(points[second][:2]).astype(int)), 255, round(width*0.90))
    torso = np.zeros_like(region)
    cv2.fillConvexPoly(torso, np.asarray([points[i][:2] for i in (5,6,12,11)], dtype=np.int32), 255)
    garment_lock = torso > 0
    if result is not None:
        hsv = cv2.cvtColor(np.asarray(result.convert("RGB")), cv2.COLOR_RGB2HSV)
        colored = (torso > 0) & (hsv[:,:,1] > 100)
        if int(colored.sum()) > 256:
            value_floor=max(80,float(np.percentile(hsv[:,:,2][colored],65))*0.65)
            vivid=colored & (hsv[:,:,2]>value_floor)
            hue = int(np.argmax(np.bincount(hsv[:,:,0][vivid], minlength=180)))
            delta = np.abs(hsv[:,:,0].astype(np.int16)-hue)
            garment_lock = (torso>0) & (np.minimum(delta,180-delta) < 10) & (hsv[:,:,1] > 90) & (hsv[:,:,2]>value_floor)
            garment_lock = cv2.morphologyEx(garment_lock.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((9,9),dtype=np.uint8))>0
    region[garment_lock] = 0
    skin = reference_skin_mask(source,source,person)
    count, labels, stats, _ = cv2.connectedComponentsWithStats((skin > 0).astype(np.uint8), 8)
    clean_skin = np.zeros_like(skin)
    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] >= max(64, round(source.width*source.height*0.0001)):
            clean_skin[labels == index] = 255
    preserve = np.maximum(np.asarray(protected), np.where((region > 0) & (clean_skin > 0), 255, 0).astype(np.uint8))
    silhouette = cv2.morphologyEx((np.asarray(editable)>0).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((17,17), dtype=np.uint8))
    silhouette = fill_garment_mask_holes(silhouette)
    region[silhouette == 0] = 0
    region = cv2.morphologyEx(region, cv2.MORPH_CLOSE, np.ones((17,17), dtype=np.uint8))
    region = cv2.dilate(region, np.ones((7,7),dtype=np.uint8),iterations=1)
    region[garment_lock] = 0
    region[preserve > 0] = 0
    return Image.fromarray(region), Image.fromarray(preserve)


def reconstruct_bare_arms(source, result, person, editable, protected, seed, candidate_path=None):
    mask, preserve = arm_reconstruction_masks(source, person, editable, protected, result)
    pixels = int((np.asarray(mask) > 0).sum())
    if pixels < 128:
        return result, mask, {"applied": False, "pixels": pixels, "reason": "insufficient-arm-region-or-pose"}
    existing_skin = float((reference_skin_mask(source,result,person)>0)[np.asarray(mask)>0].mean())
    if existing_skin >= 0.80:
        return result, mask, {"applied": False, "attempted": False, "pixels": pixels, "skinCoverageBefore": existing_skin, "reason": "arms-already-bare"}
    return result, mask, {"applied": False, "attempted": False, "pixels": pixels, "reason": "arm-repair-model-removed"}


def birefnet_mask(image: Image.Image) -> Image.Image | None:
    """Return a high-resolution foreground mask when the local BiRefNet is available."""
    global birefnet_model
    if not (BIREFNET_ROOT / "model.safetensors").is_file():
        return None
    if birefnet_model is None:
        from transformers import AutoModelForImageSegmentation
        birefnet_model = AutoModelForImageSegmentation.from_pretrained(
            str(BIREFNET_ROOT), trust_remote_code=True, local_files_only=True
        ).to(device).eval()
    resized = image.convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)
    array = np.asarray(resized, dtype=np.float32) / 255.0
    array = (array - np.asarray([0.485, 0.456, 0.406], dtype=np.float32)) / np.asarray([0.229, 0.224, 0.225], dtype=np.float32)
    tensor = torch.from_numpy(array.transpose(2, 0, 1)).unsqueeze(0).to(device)
    with torch.inference_mode(), torch.autocast(device_type=device, dtype=torch.float16, enabled=device == "cuda"):
        output = birefnet_model(tensor)
        prediction = output[-1] if isinstance(output, (list, tuple)) else output.logits
        prediction = prediction.sigmoid().float().cpu().squeeze().numpy()
    return Image.fromarray(np.clip(prediction * 255, 0, 255).astype(np.uint8), mode="L").resize(image.size, Image.Resampling.BILINEAR)


def exclude_protected_pixels(mask: Image.Image, protected: Image.Image) -> Image.Image:
    pixels = np.asarray(mask, dtype=np.uint8).copy()
    pixels[np.asarray(protected, dtype=np.uint8) > 0] = 0
    return Image.fromarray(pixels)


def restore_protected_pixels(source: Image.Image, result: Image.Image, protected: Image.Image) -> Image.Image:
    return Image.composite(source, result, protected.point(lambda value: 255 if value > 0 else 0))


def reconstruction_edit_mask(selected: Image.Image, old_clothing: Image.Image, protected: Image.Image):
    """Let CatVTON replace old fabric with either new fabric or newly visible skin."""
    selected_pixels = np.asarray(selected, dtype=np.uint8) > 16
    old_pixels = np.asarray(old_clothing, dtype=np.uint8) > 16
    locked = np.asarray(protected, dtype=np.uint8) > 0
    editable = (selected_pixels | old_pixels) & ~locked
    added = editable & ~selected_pixels
    return Image.fromarray(editable.astype(np.uint8) * 255), Image.fromarray(added.astype(np.uint8) * 255)


def preprocess_garment_image(garment: Image.Image, category: str = "upper_body", reference_type: str = "auto"):
    """Isolate the central garment and place it on a clean neutral background."""
    rgb = garment.convert("RGB")
    image = np.asarray(rgb)
    width, height = rgb.size
    if reference_type not in ('auto', 'product', 'model'):
        raise ValueError('Loại ảnh mẫu không hợp lệ')
    # A background remover isolates a whole person, not their clothing. Resolve
    # person references before BiRefNet, with an explicit override for products.
    pose_people = detect_people_pose(rgb) if reference_type != 'product' and POSE_MODEL.is_file() else []
    visible_people = [p for p in pose_people if p.get('confidence', 0) >= .4
                      and sum(k[2] >= .4 for k in (p.get('keypoints') or [])[:5]) >= 2]
    if reference_type == 'model' and len(pose_people) != 1:
        raise ValueError('Ảnh người mặc mẫu phải có đúng một người rõ ràng; hãy cắt ảnh hoặc dùng ảnh sản phẩm.')
    chosen_people = pose_people if reference_type == 'model' else visible_people
    if len(chosen_people) > 1:
        raise ValueError('Ảnh mẫu có nhiều người; hãy cắt riêng người mặc trang phục cần dùng.')
    if chosen_people:
        person = chosen_people[0]
        garment_mask, garment_score = automatic_garment_mask(rgb, category, person['box'], person.get('keypoints'))
        coverage = float((np.asarray(garment_mask) > 0).mean())
        bbox = garment_mask.getbbox()
        if not bbox or coverage < .015 or garment_score < .6:
            raise ValueError('Chưa tách được trang phục đủ tin cậy từ người mặc; hãy dùng ảnh sản phẩm rõ hơn.')
        padding = max(8, round(max(width, height)*.035))
        bbox = (max(0,bbox[0]-padding),max(0,bbox[1]-padding),min(width,bbox[2]+padding),min(height,bbox[3]+padding))
        cropped_mask = garment_mask.crop(bbox)
        background = Image.new('RGB', cropped_mask.size, (245,245,245))
        background.paste(rgb.crop(bbox), mask=cropped_mask)
        return background, cropped_mask, coverage, 'model-photo', garment_score
    foreground = birefnet_mask(rgb)
    if foreground is not None:
        binary = foreground.point(lambda value: 255 if value >= 96 else 0)
        coverage = float((np.asarray(binary) > 0).mean())
        bbox = binary.getbbox()
        if bbox and 0.015 <= coverage <= 0.95:
            padding = max(8, round(max(width, height) * 0.035))
            bbox = (max(0, bbox[0] - padding), max(0, bbox[1] - padding), min(width, bbox[2] + padding), min(height, bbox[3] + padding))
            cropped, cropped_mask = rgb.crop(bbox), foreground.crop(bbox).filter(ImageFilter.GaussianBlur(1.0))
            background = Image.new("RGB", cropped.size, (245, 245, 245));background.paste(cropped, mask=cropped_mask)
            return background, cropped_mask, coverage, "birefnet", float(np.asarray(foreground).max() / 255.0)
    if reference_type != 'product' and pose_people and pose_people[0].get("confidence", 0) >= 0.4:
        person = pose_people[0]
        garment_mask, garment_score = automatic_garment_mask(rgb, category, person["box"], person.get("keypoints"))
        coverage = float((np.asarray(garment_mask) > 0).mean())
        bbox = garment_mask.getbbox()
        if bbox and coverage >= 0.015:
            padding = max(8, round(max(width, height) * 0.035))
            bbox = (max(0, bbox[0] - padding), max(0, bbox[1] - padding), min(width, bbox[2] + padding), min(height, bbox[3] + padding))
            cropped = rgb.crop(bbox)
            cropped_mask = garment_mask.crop(bbox).filter(ImageFilter.GaussianBlur(1.2))
            background = Image.new("RGB", cropped.size, (245, 245, 245))
            background.paste(cropped, mask=cropped_mask)
            return background, cropped_mask, coverage, "model-photo", garment_score
    model = load_predictor()
    coords = np.asarray([
        [0.50 * width, 0.50 * height], [0.50 * width, 0.35 * height],
        [0.50 * width, 0.68 * height], [0.03 * width, 0.03 * height],
        [0.97 * width, 0.03 * height], [0.03 * width, 0.97 * height],
        [0.97 * width, 0.97 * height],
    ], dtype=np.float32)
    labels = np.asarray([1, 1, 1, 0, 0, 0, 0], dtype=np.int32)
    with torch.inference_mode(), torch.autocast(device_type=device, dtype=torch.bfloat16, enabled=device == "cuda"):
        model.set_image(image)
        masks, scores, _ = model.predict(point_coords=coords, point_labels=labels, multimask_output=True)
    best = int(np.argmax(scores))
    mask = masks[best]
    coverage = float(mask.mean())
    # Very small masks usually mean the reference is a full model/photo rather
    # than a clean product shot. CatVTON handles that better without cut-out.
    if coverage < 0.18 or coverage > 0.92:
        mask = np.ones((height, width), dtype=bool)
        coverage = 1.0
    mask_image = Image.fromarray(mask.astype(np.uint8) * 255, mode="L").filter(ImageFilter.GaussianBlur(1.2))
    bbox = mask_image.point(lambda value: 255 if value > 32 else 0).getbbox()
    if bbox:
        padding = max(8, round(max(width, height) * 0.04))
        bbox = (max(0, bbox[0] - padding), max(0, bbox[1] - padding), min(width, bbox[2] + padding), min(height, bbox[3] + padding))
        rgb = rgb.crop(bbox)
        mask_image = mask_image.crop(bbox)
    background = Image.new("RGB", rgb.size, (245, 245, 245))
    background.paste(rgb, mask=mask_image)
    return background, mask_image, coverage, "product-photo", float(scores[best])


def normalize_garment_reference(garment: Image.Image, category: str = "upper_body"):
    """Create a clean garment-only reference and measurable contamination report."""
    rgb = garment.convert("RGB")
    people = detect_people_pose(rgb) if POSE_MODEL.is_file() else []
    if len(people) > 1:
        raise ValueError('Hãy cắt riêng người mặc trang phục cần dùng làm mẫu.')
    person = people[0] if people else None
    if person:
        mask, score = automatic_garment_mask(rgb, category, person["box"], person.get("keypoints"))
        protected = automatic_protected_detail_mask(rgb, person["box"], person.get("keypoints"))
        array = np.asarray(mask, dtype=np.uint8).copy()
        array[np.asarray(protected, dtype=np.uint8) > 16] = 0
        mask = Image.fromarray(array, mode="L")
        person_box = person["box"]
        keypoints = person.get("keypoints") or []
    else:
        processed, mask, _, _, score = preprocess_garment_image(rgb, category)
        coverage = float((np.asarray(mask) > 16).mean())
        return processed, mask, {"score": score, "people": 0, "mode": "product-fallback", "coverage": coverage, "faceContamination": 0.0, "lowerBodyContaminationBeforeCrop": 0.0, "lowerBodyContamination": 0.0, "accepted": 0.18 <= coverage <= 0.92}

    mask_array = np.asarray(mask, dtype=np.uint8) > 16
    px0, py0, px1, py1 = [int(round(value)) for value in person_box]
    ph = max(1, py1 - py0)
    hip_values = [keypoints[index][1] for index in (11, 12) if index < len(keypoints) and keypoints[index][2] > 0.25]
    lower_start = round(float(np.mean(hip_values)) - ph * 0.13) if hip_values else round(py0 + ph * 0.48)
    protected_array = np.asarray(protected, dtype=np.uint8) > 16
    face_contamination = float((mask_array & protected_array).sum() / max(1, mask_array.sum()))
    lower_contamination = float(mask_array[max(0, lower_start):].sum() / max(1, mask_array.sum()))
    # Never shorten cuffs or hems to make a contamination score pass. A pose
    # estimate cannot distinguish a long shirt from trousers; retain pixels and
    # flag the uncertain cutout for review instead.
    lower_contamination_after = float(mask_array[max(0, lower_start):].sum() / max(1, mask_array.sum()))
    cleaned_mask = Image.fromarray(mask_array.astype(np.uint8) * 255, mode="L")
    bbox = cleaned_mask.getbbox()
    if not bbox:
        raise ValueError("Không tách được trang phục khỏi ảnh tham chiếu")
    padding = max(8, round(max(rgb.size) * 0.025))
    bbox = (max(0, bbox[0] - padding), max(0, bbox[1] - padding), min(rgb.width, bbox[2] + padding), min(rgb.height, bbox[3] + padding))
    crop = rgb.crop(bbox)
    crop_mask = cleaned_mask.crop(bbox).filter(ImageFilter.GaussianBlur(1.0))
    normalized = Image.new("RGB", crop.size, (245, 245, 245))
    normalized.paste(crop, mask=crop_mask)
    final_coverage = float((np.asarray(crop_mask) > 16).mean())
    metrics = {
        "score": float(score), "people": len(people), "mode": "pose-sam-cutout",
        "coverage": final_coverage, "faceContamination": face_contamination,
        "lowerBodyContaminationBeforeCrop": lower_contamination,
        "lowerBodyContamination": lower_contamination_after, "bbox": list(bbox),
        "accepted": final_coverage >= 0.18 and face_contamination <= 0.01 and (category != 'upper_body' or lower_contamination_after <= 0.20),
        "requiresVisualReview": True,
    }
    return normalized, crop_mask, metrics


def normalize_reference(body: dict) -> dict:
    sample_id = str(body.get("garmentSampleId") or body.get("sampleId") or "characters/c003.png")
    category = str(body.get("category") or "upper_body")
    if category not in ("upper_body", "lower_body", "overall"):
        raise ValueError("Loại trang phục không hợp lệ")
    source = Image.open(safe_sample(sample_id)).convert("RGB")
    normalized, mask, metrics = normalize_garment_reference(source, category)
    reference_dir = ROOT / "workspace" / "references"
    reference_dir.mkdir(parents=True, exist_ok=True)
    image_path = reference_dir / f"{category}.png"
    mask_path = reference_dir / f"{category}_mask.png"
    manifest_path = reference_dir / f"{category}.json"
    normalized.save(image_path)
    mask.save(mask_path)
    manifest = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceSampleId": sample_id, "category": category,
        "image": str(image_path.relative_to(ROOT)), "mask": str(mask_path.relative_to(ROOT)),
        "metrics": metrics,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "manifest": str(manifest_path.relative_to(ROOT)), **manifest}


def validate_product_reference(body: dict) -> dict:
    value = str(body.get("image") or body.get("garmentImage") or "")
    category = str(body.get("category") or "upper_body")
    if category not in ("upper_body", "lower_body", "overall"):
        raise ValueError("Loại trang phục không hợp lệ")
    prefix = next((item for item in ("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,") if value.startswith(item)), None)
    if not prefix:
        raise ValueError("Ảnh tham chiếu phải là PNG, JPEG hoặc WebP")
    raw = base64.b64decode(value[len(prefix):], validate=True)
    if not raw or len(raw) > 20 * 1024 * 1024:
        raise ValueError("Ảnh tham chiếu không hợp lệ hoặc vượt quá 20 MB")
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    array = np.asarray(image, dtype=np.uint8)
    height, width = array.shape[:2]
    border = np.concatenate((array[0], array[-1], array[:, 0], array[:, -1]), axis=0).astype(np.float32)
    background = np.median(border, axis=0)
    background_std = float(np.mean(np.std(border, axis=0)))
    distance = np.linalg.norm(array.astype(np.float32) - background[None, None, :], axis=2)
    foreground = (distance > 30).astype(np.uint8)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count > 1:
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        foreground = (labels == largest).astype(np.uint8)
    coverage = float(foreground.mean())
    edge_touch = float(np.concatenate((foreground[0], foreground[-1], foreground[:, 0], foreground[:, -1])).mean())
    gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    laplacian = cv2.Laplacian(gray, cv2.CV_32F)
    sharpness = float(laplacian[foreground > 0].var()) if foreground.any() else 0.0
    people = detect_people_pose(image) if POSE_MODEL.is_file() else []
    pixels = array[foreground > 0]
    if len(pixels) > 12000:
        pixels = pixels[np.linspace(0, len(pixels) - 1, 12000, dtype=np.int32)]
    palette = []
    if len(pixels) >= 3:
        samples = pixels.astype(np.float32)
        _, labels_k, centers = cv2.kmeans(samples, 3, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5), 3, cv2.KMEANS_PP_CENTERS)
        counts = np.bincount(labels_k.ravel(), minlength=3)
        for index in np.argsort(counts)[::-1]:
            palette.append({"rgb": [int(round(value)) for value in centers[index]], "ratio": float(counts[index] / counts.sum())})
    reasons = []
    if width < 256 or height < 256: reasons.append("Kích thước tối thiểu là 256 × 256")
    if people: reasons.append("Phát hiện người hoặc pose trong ảnh sản phẩm")
    if coverage < 0.08 or coverage > 0.85: reasons.append("Coverage sản phẩm phải nằm trong khoảng 0,08–0,85")
    if background_std > 35: reasons.append("Nền không đủ đồng nhất")
    if edge_touch > 0.08: reasons.append("Sản phẩm chạm mép ảnh quá nhiều")
    if sharpness < 25: reasons.append("Ảnh sản phẩm thiếu độ nét")
    metrics = {"width": width, "height": height, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "peopleDetected": len(people), "backgroundRgb": [int(round(value)) for value in background], "backgroundStd": background_std, "foregroundCoverage": coverage, "edgeTouchRatio": edge_touch, "sharpness": sharpness, "dominantPalette": palette}
    return {"ok": True, "accepted": not reasons, "category": category, "reasons": reasons, "metrics": metrics}


def active_reference_path(category: str) -> Path:
    profile_path = ROOT / "workspace" / "review" / "reference-profiles.json"
    if profile_path.is_file():
        try:
            profile = json.loads(profile_path.read_text(encoding="utf-8")).get("profiles", {}).get(category, {})
            candidate = ROOT / str(profile.get("reference")) if profile.get("reference") else None
            if profile.get("specializedReferenceRequired") is False and (profile.get("validation") or {}).get("accepted") and candidate and candidate.is_file():
                return candidate
        except Exception:
            pass
    return ROOT / "workspace" / "references" / f"{category}.png"


def catvton_reference_matrix(body: dict) -> dict:
    sample_ids = [str(value) for value in (body.get("sampleIds") or ["characters/c001.png", "characters/c002.png", "characters/c003.png"])[:3]]
    category = str(body.get("category") or "upper_body")
    reference_path = active_reference_path(category)
    manifest_path = ROOT / "workspace" / "references" / f"{category}.json"
    profile_path = ROOT / "workspace" / "review" / "reference-profiles.json"
    if profile_path.is_file():
        profiles = json.loads(profile_path.read_text(encoding="utf-8"))
        profile = profiles.get("profiles", {}).get(category, {})
        if (profile.get("validation") or {}).get("accepted"):
            # Product uploads have their own manifest. Never replace them with
            # a garment extracted from a sample because the legacy file is absent.
            manifest_path = ROOT / str(profile.get("manifest") or "")
            reference_path = ROOT / str(profile.get("reference") or "")
            if not reference_path.is_file() or not manifest_path.is_file():
                raise ValueError("Thiếu ảnh hoặc manifest của reference sản phẩm đã kiểm định")
    if not reference_path.is_file() or not manifest_path.is_file():
        normalize_reference({"garmentSampleId": body.get("garmentSampleId") or "characters/c003.png", "category": category})
    reference = Image.open(reference_path).convert("RGB")
    reference_data = encode_image(reference)
    reference_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    base_seed = int(body.get("seed", 49001))
    mask_mode = str(body.get("maskMode") or "standard")
    rows, skipped = [], []
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output_dir = OUTPUTS / f"catvton_reference_{stamp}"
    output_dir.mkdir(parents=True, exist_ok=False)
    for index, sample_id in enumerate(sample_ids):
        source = Image.open(safe_sample(sample_id)).convert("RGB")
        people = detect_people(source, True)
        if len(people) != 1:
            skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
            continue
        person = people[0]
        if mask_mode == "dedicated":
            mask, mask_score, dedicated_metrics = catvton_dedicated_mask(source, category, person["box"], person.get("keypoints"))
        else:
            mask, mask_score = automatic_garment_mask(source, category, person["box"], person.get("keypoints"))
            dedicated_metrics = {"mode": "standard"}
        protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
        mask_array = np.asarray(mask, dtype=np.uint8).copy()
        mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
        mask = Image.fromarray(mask_array, mode="L")
        policy = mask_strength_policy(mask, person["box"], category, person.get("keypoints"))
        mask_accepted = (
            bool(dedicated_metrics.get("accepted", policy["accepted"]))
            if mask_mode == "dedicated"
            else policy["accepted"]
        )
        if not mask_accepted:
            skipped.append({"sampleId": sample_id, "reason": "mask-quality-gate", "maskScore": mask_score, "maskMode": mask_mode, "dedicatedMask": dedicated_metrics, **policy})
            continue
        seed = base_seed + index
        result = tryon({
            "sampleId": sample_id, "garmentImage": reference_data, "category": category,
            "editableMask": encode_image(mask), "autoMask": False, "usePose": True, "personIndex": 0, "cropPerson": False,
            "preprocessGarment": False, "count": 1, "steps": int(body.get("steps", 10)),
            "guidance": float(body.get("guidance", 2.5)), "seed": seed,
            "maxSide": int(body.get("maxSide", 512)), "expand": 0, "blur": 6,
            "repairSeams": False, "generativeRefine": False, "maxRetries": 0,
            "minimumQuality": 0, "minimumSimilarity": 0, "minimumSeam": 0, "minimumAnatomy": 0,
        })
        generated = Image.open(ROOT / result["selected"]).convert("RGB")
        metrics = score_tryon_result(source, generated, mask)
        metrics["referenceSimilarity"] = reference_similarity(reference, generated, mask)
        target = output_dir / f"{Path(sample_id).stem}_catvton.png"
        generated.save(target)
        mask.save(output_dir / f"{Path(sample_id).stem}_mask.png")
        rows.append({"sampleId": sample_id, "seed": seed, "maskScore": mask_score, "maskMode": mask_mode, "dedicatedMask": dedicated_metrics, **policy, "dedicatedGateAccepted": mask_accepted, "output": str(target.relative_to(ROOT)), "performance": result["performance"], **metrics})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "category": category, "maskMode": mask_mode, "reference": reference_manifest, "sampleCount": len(rows),
        "skippedCount": len(skipped), "skipped": skipped, "rows": rows,
        "catvtonOnly": True, "sameConfiguration": True, "requiresVisualReview": True,
    }
    report_path = ROOT / "workspace" / "review" / f"catvton-reference-matrix-{stamp}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(report_path.relative_to(ROOT)), "directory": str(output_dir.relative_to(ROOT)), **report}


def catvton_dedicated_mask_matrix(body: dict) -> dict:
    return catvton_reference_matrix({**body, "maskMode": "dedicated", "seed": int(body.get("seed", 50001))})


def score_tryon_result(source: Image.Image, result: Image.Image, hard_mask: Image.Image) -> dict:
    source_array = np.asarray(source, dtype=np.int16)
    result_array = np.asarray(result, dtype=np.int16)
    mask_array = np.asarray(hard_mask, dtype=np.uint8) > 0
    difference = np.abs(result_array - source_array).mean(axis=2) / 255.0
    outside = ~mask_array
    outside_mae = float(difference[outside].mean()) if outside.any() else 0.0
    face = np.zeros(mask_array.shape, dtype=bool)
    face[:max(1, round(source.height * 0.28)), round(source.width * 0.25):round(source.width * 0.75)] = True
    face_mae = float(difference[face & outside].mean()) if (face & outside).any() else 0.0
    edge_outer = np.asarray(hard_mask.filter(ImageFilter.MaxFilter(11)), dtype=np.uint8) > 0
    edge_inner = np.asarray(hard_mask.filter(ImageFilter.MinFilter(11)), dtype=np.uint8) > 0
    edge = edge_outer ^ edge_inner
    edge_mae = float(difference[edge].mean()) if edge.any() else 0.0
    pixels = np.asarray(result, dtype=np.uint8)[mask_array]
    clipping = float(((pixels < 3) | (pixels > 252)).mean()) if pixels.size else 1.0
    quality = max(0.0, 100.0 * (1.0 - min(1.0, outside_mae * 8 + face_mae * 8 + edge_mae * 0.35 + clipping * 0.25)))
    gray = cv2.cvtColor(np.asarray(result, dtype=np.uint8), cv2.COLOR_RGB2GRAY)
    gradient = cv2.magnitude(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1)) / 255.0
    edge_gradient = float(gradient[edge].mean()) if edge.any() else 0.0
    seam_score = max(0.0, 100.0 * (1.0 - min(1.0, edge_mae * 2.2 + edge_gradient * 0.35 + clipping * 0.12)))
    anatomy_score = max(0.0, 100.0 * (1.0 - min(1.0, face_mae * 25 + outside_mae * 12)))
    texture_continuity = max(0.0, 100.0 * (1.0 - min(1.0, edge_gradient * 0.7)))
    return {
        "outsideMaskMAE": outside_mae, "faceMAE": face_mae, "edgeMAE": edge_mae,
        "clippingRatio": clipping, "edgeGradient": edge_gradient, "qualityScore": quality,
        "seamScore": seam_score, "anatomyScore": anatomy_score, "textureContinuity": texture_continuity,
        # Historical aliases remain readable by old reports. They measure pixel
        # preservation and boundary smoothness, not anatomy or fabric fidelity.
        "preservationScore": anatomy_score, "boundarySmoothness": texture_continuity,
        "metricSemantics": "legacy-pixel-diagnostics",
    }


def catvton_core_degradation(result: Image.Image, hard_mask: Image.Image) -> dict:
    """Measure large smooth/asymmetric failures that edge-only scores can miss."""
    gray = cv2.cvtColor(np.asarray(result.convert("RGB"), dtype=np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    binary = (np.asarray(hard_mask, dtype=np.uint8) > 16).astype(np.uint8)
    core = cv2.erode(binary, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)), iterations=1) > 0
    if not core.any():
        return {"corePixels": 0, "localStdMean": 0.0, "lowTextureRatio": 1.0, "sideImbalance": 1.0, "coreTextureScore": 0.0}
    mean = cv2.blur(gray, (21, 21))
    mean_sq = cv2.blur(gray * gray, (21, 21))
    local_std = np.sqrt(np.maximum(0.0, mean_sq - mean * mean))
    values = local_std[core]
    _, xs = np.where(core)
    midpoint = int((xs.min() + xs.max()) / 2)
    x_grid = np.indices(core.shape)[1]
    left = local_std[np.logical_and(core, x_grid <= midpoint)]
    right = local_std[np.logical_and(core, x_grid > midpoint)]
    left_mean = float(left.mean()) if left.size else 0.0
    right_mean = float(right.mean()) if right.size else 0.0
    imbalance = abs(left_mean - right_mean) / max(1.0, max(left_mean, right_mean))
    low_texture_ratio = float((values < 3.0).mean())
    score = max(0.0, 100.0 * (1.0 - min(1.0, low_texture_ratio * 1.4 + imbalance * 0.65)))
    return {
        "corePixels": int(core.sum()), "localStdMean": float(values.mean()),
        "localStdP10": float(np.percentile(values, 10)), "lowTextureRatio": low_texture_ratio,
        "leftLocalStd": left_mean, "rightLocalStd": right_mean,
        "sideImbalance": float(imbalance), "coreTextureScore": score,
    }


def color_material_consistency(reference: Image.Image, result: Image.Image, hard_mask: Image.Image) -> dict:
    """Compare robust Lab palettes and texture energy without requiring aligned pixels."""
    ref = np.asarray(reference.convert("RGB"), dtype=np.uint8)
    out = np.asarray(result.convert("RGB"), dtype=np.uint8)
    mask = np.asarray(hard_mask, dtype=np.uint8) > 16
    border = np.concatenate((ref[0], ref[-1], ref[:, 0], ref[:, -1]), axis=0).astype(np.float32)
    background = np.median(border, axis=0)
    ref_foreground = np.linalg.norm(ref.astype(np.float32) - background[None, None, :], axis=2) > 25
    ref_pixels = ref[ref_foreground]
    out_pixels = out[mask]
    if len(ref_pixels) < 32 or len(out_pixels) < 32:
        return {"accepted": False, "colorDistance": 100.0, "colorOutlierRatio": 1.0, "materialScore": 0.0, "colorMaterialScore": 0.0, "reason": "insufficient-pixels"}
    def sample_pixels(pixels):
        return pixels[np.linspace(0, len(pixels) - 1, min(12000, len(pixels)), dtype=np.int32)]
    def palette_lab(pixels):
        sampled = sample_pixels(pixels)
        lab = cv2.cvtColor(sampled.reshape(-1, 1, 3), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
        _, labels, centers = cv2.kmeans(lab, 4, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5), 4, cv2.KMEANS_PP_CENTERS)
        counts = np.bincount(labels.ravel(), minlength=4).astype(np.float32)
        return centers, counts / max(1.0, counts.sum()), lab
    ref_centers, ref_weights, _ = palette_lab(ref_pixels)
    out_centers, out_weights, out_lab = palette_lab(out_pixels)
    distances = np.linalg.norm(out_centers[:, None, :] - ref_centers[None, :, :], axis=2)
    color_distance = float(np.sum(out_weights * distances.min(axis=1)))
    pixel_distance = np.linalg.norm(out_lab[:, None, :] - ref_centers[None, :, :], axis=2).min(axis=1)
    outlier_ratio = float((pixel_distance > 38).mean())
    ref_gray = cv2.cvtColor(ref, cv2.COLOR_RGB2GRAY)
    out_gray = cv2.cvtColor(out, cv2.COLOR_RGB2GRAY)
    ref_energy = float(np.mean(np.abs(cv2.Laplacian(ref_gray, cv2.CV_32F)[ref_foreground])))
    out_energy = float(np.mean(np.abs(cv2.Laplacian(out_gray, cv2.CV_32F)[mask])))
    energy_ratio = out_energy / max(1.0, ref_energy)
    material_score = max(0.0, 100.0 * (1.0 - min(1.0, abs(float(np.log(max(0.01, energy_ratio)))) * 0.55)))
    color_score = max(0.0, 100.0 - color_distance * 1.5 - outlier_ratio * 65.0)
    combined = color_score * 0.72 + material_score * 0.28
    accepted = color_distance <= 32 and outlier_ratio <= 0.22 and material_score >= 35
    return {"accepted": accepted, "colorDistance": color_distance, "colorOutlierRatio": outlier_ratio, "referenceTextureEnergy": ref_energy, "resultTextureEnergy": out_energy, "textureEnergyRatio": energy_ratio, "colorScore": color_score, "materialScore": material_score, "colorMaterialScore": combined}


def catvton_geometry_consistency(result: Image.Image, hard_mask: Image.Image) -> dict:
    """Detect large flat failures, asymmetric sleeves, weak silhouette edges and vertical scars."""
    gray = cv2.cvtColor(np.asarray(result.convert("RGB"), dtype=np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    binary = (np.asarray(hard_mask, dtype=np.uint8) > 16).astype(np.uint8)
    core = cv2.erode(binary, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)), iterations=1) > 0
    if not core.any():
        return {"accepted": False, "geometryScore": 0.0, "reason": "empty-core"}
    mean = cv2.blur(gray, (25, 25))
    mean_sq = cv2.blur(gray * gray, (25, 25))
    local_std = np.sqrt(np.maximum(0.0, mean_sq - mean * mean))
    flat = np.logical_and(core, local_std < 2.8).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(flat, 8)
    largest_flat = int(stats[1:, cv2.CC_STAT_AREA].max()) if count > 1 else 0
    largest_flat_ratio = float(largest_flat / max(1, core.sum()))
    gradient = cv2.magnitude(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1)) / 255.0
    _, xs = np.where(core)
    midpoint = int((xs.min() + xs.max()) / 2)
    x_grid = np.indices(core.shape)[1]
    left_values = gradient[np.logical_and(core, x_grid <= midpoint)]
    right_values = gradient[np.logical_and(core, x_grid > midpoint)]
    left_edge = float(left_values.mean()) if left_values.size else 0.0
    right_edge = float(right_values.mean()) if right_values.size else 0.0
    side_imbalance = abs(left_edge - right_edge) / max(0.01, max(left_edge, right_edge))
    blackhat = cv2.morphologyEx(gray.astype(np.uint8), cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (7, 31)))
    core_blackhat = blackhat[core]
    vertical_threshold = max(18.0, float(np.percentile(core_blackhat, 98.0)))
    vertical_ratio = float((core_blackhat >= vertical_threshold).mean())
    outer = cv2.dilate(binary, np.ones((9, 9), np.uint8), iterations=1) > 0
    inner = cv2.erode(binary, np.ones((9, 9), np.uint8), iterations=1) > 0
    boundary = outer ^ inner
    weak_boundary_ratio = float((gradient[boundary] < 0.035).mean()) if boundary.any() else 1.0
    score = max(0.0, 100.0 * (1.0 - min(1.0, largest_flat_ratio * 2.8 + side_imbalance * 0.55 + vertical_ratio * 2.0 + weak_boundary_ratio * 0.28)))
    accepted = largest_flat_ratio <= 0.12 and side_imbalance <= 0.30 and vertical_ratio <= 0.055 and weak_boundary_ratio <= 0.72 and score >= 42
    return {"accepted": accepted, "largestFlatComponentRatio": largest_flat_ratio, "sideEdgeImbalance": float(side_imbalance), "leftEdgeEnergy": left_edge, "rightEdgeEnergy": right_edge, "verticalArtifactRatio": vertical_ratio, "verticalThreshold": vertical_threshold, "weakBoundaryRatio": weak_boundary_ratio, "geometryScore": score}


def catvton_geometry_audit(body: dict) -> dict:
    requested = str(body.get("report") or "")
    candidates = sorted((ROOT / "workspace" / "review").glob("catvton-retry-matrix-*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    source_path = ROOT / requested if requested else (candidates[0] if candidates else None)
    if not source_path or not source_path.is_file():
        raise ValueError("Không tìm thấy báo cáo retry để audit")
    report = json.loads(source_path.read_text(encoding="utf-8"))
    reference = Image.open(active_reference_path("upper_body")).convert("RGB")
    rows = []
    for row in report.get("rows", []):
        sample_id = str(row["sampleId"])
        output_dir = ROOT / Path(row["candidates"][0]["output"]).parent
        mask = Image.open(output_dir / f"{Path(sample_id).stem}_mask.png").convert("L")
        audited = []
        for candidate in row.get("candidates", []):
            result = Image.open(ROOT / candidate["output"]).convert("RGB")
            color = candidate.get("colorMaterial") or color_material_consistency(reference, result, mask)
            geometry = catvton_geometry_consistency(result, mask)
            accepted = bool(color["accepted"] and geometry["accepted"])
            adjusted = float(candidate.get("selectionScore", 0)) * 0.72 + color["colorMaterialScore"] * 0.13 + geometry["geometryScore"] * 0.15
            audited.append({**candidate, "colorMaterial": color, "geometry": geometry, "combinedGateAccepted": accepted, "adjustedSelectionScore": adjusted})
        eligible = [item for item in audited if item["combinedGateAccepted"]]
        selected = max(eligible, key=lambda item: item["adjustedSelectionScore"]) if eligible else None
        rows.append({"sampleId": sample_id, "candidateCount": len(audited), "eligibleCount": len(eligible), "promotionEligible": selected is not None, "promoted": False, "selected": selected, "candidates": audited})
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    audited_report = {"schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "sourceReport": str(source_path.relative_to(ROOT)), "rows": rows, "promotionEligibleCount": sum(row["promotionEligible"] for row in rows), "promotedCount": 0, "requiresVisualReview": True}
    target = ROOT / "workspace" / "review" / f"catvton-geometry-audit-{stamp}.json"
    target.write_text(json.dumps(audited_report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **audited_report}


def qualify_product_reference(body: dict) -> dict:
    category = str(body.get("category") or "upper_body")
    if category not in ("upper_body", "lower_body", "overall"):
        raise ValueError("Loại trang phục không hợp lệ")
    profile_path = ROOT / "workspace" / "review" / "reference-profiles.json"
    profiles = json.loads(profile_path.read_text(encoding="utf-8")) if profile_path.is_file() else {"schemaVersion": 1, "profiles": {}}
    profile = profiles.get("profiles", {}).get(category, {})
    if not (profile.get("validation") or {}).get("accepted"):
        raise ValueError("Reference chưa qua cổng kiểm định sản phẩm")
    reference_path = ROOT / str(profile.get("reference") or "")
    if not reference_path.is_file():
        raise ValueError("Không tìm thấy tệp reference đã kiểm định")
    reference_sha256 = hashlib.sha256(reference_path.read_bytes()).hexdigest()
    validation_sha256 = str((profile.get("validation") or {}).get("metrics", {}).get("sha256") or "")
    if not validation_sha256 or reference_sha256 != validation_sha256:
        raise ValueError("Checksum reference không khớp kết quả kiểm định; hãy nhập lại ảnh sản phẩm")
    qualification_samples = ["characters/c001.png", "characters/c002.png", "characters/c003.png"]
    matrix = catvton_reference_matrix({
        # Qualification is intentionally immutable: callers cannot replace or
        # duplicate the three canonical smoke cases.
        "sampleIds": qualification_samples,
        "category": category, "maskMode": "dedicated", "seed": int(body.get("seed", 52001)),
        "steps": int(body.get("steps", 20)), "maxSide": int(body.get("maxSide", 512)),
    })
    reference = Image.open(reference_path).convert("RGB")
    evaluated = []
    for row in matrix.get("rows", []):
        output = Image.open(ROOT / row["output"]).convert("RGB")
        mask_path = ROOT / matrix["directory"] / f"{Path(row['sampleId']).stem}_mask.png"
        mask = Image.open(mask_path).convert("L")
        color = color_material_consistency(reference, output, mask)
        geometry = catvton_geometry_consistency(output, mask)
        passed = bool(color["accepted"] and geometry["accepted"] and row["seamScore"] >= 80 and row["anatomyScore"] >= 95 and row["referenceSimilarity"] >= 0.60)
        evaluated.append({"sampleId": row["sampleId"], "output": row["output"], "passed": passed, "colorMaterial": color, "geometry": geometry, "seamScore": row["seamScore"], "anatomyScore": row["anatomyScore"], "referenceSimilarity": row["referenceSimilarity"]})
    passed = len(evaluated) == 3 and all(item["passed"] for item in evaluated)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    report = {"schemaVersion": 2, "createdAt": datetime.now(timezone.utc).isoformat(), "category": category, "reference": str(reference_path.relative_to(ROOT)), "referenceSha256": reference_sha256, "validationSha256": validation_sha256, "qualificationSamples": qualification_samples, "matrixReport": matrix["report"], "passed": passed, "passedCount": sum(item["passed"] for item in evaluated), "requiredCount": 3, "items": evaluated, "requiresVisualReview": True}
    target = ROOT / "workspace" / "review" / f"reference-qualification-{category}-{stamp}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    profile.update({"status": "qualified" if passed else "failed-smoke", "specializedReferenceRequired": not passed, "qualificationReport": str(target.relative_to(ROOT)), "qualifiedAt": datetime.now(timezone.utc).isoformat() if passed else None})
    profiles.setdefault("profiles", {})[category] = profile
    profiles["updatedAt"] = datetime.now(timezone.utc).isoformat()
    profile_path.write_text(json.dumps(profiles, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def catvton_color_audit(body: dict) -> dict:
    requested = str(body.get("report") or "")
    candidates = sorted((ROOT / "workspace" / "review").glob("catvton-retry-matrix-*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    source_path = ROOT / requested if requested else (candidates[0] if candidates else None)
    if not source_path or not source_path.is_file():
        raise ValueError("Không tìm thấy báo cáo retry để audit")
    report = json.loads(source_path.read_text(encoding="utf-8"))
    reference_path = active_reference_path("upper_body")
    reference = Image.open(reference_path).convert("RGB")
    rows = []
    for row in report.get("rows", []):
        sample_id = str(row["sampleId"])
        output_dir = ROOT / Path(row["candidates"][0]["output"]).parent
        mask_path = output_dir / f"{Path(sample_id).stem}_mask.png"
        mask = Image.open(mask_path).convert("L")
        audited = []
        for candidate in row.get("candidates", []):
            result = Image.open(ROOT / candidate["output"]).convert("RGB")
            consistency = color_material_consistency(reference, result, mask)
            adjusted = float(candidate.get("selectionScore", 0)) * 0.82 + consistency["colorMaterialScore"] * 0.18
            audited.append({**candidate, "colorMaterial": consistency, "adjustedSelectionScore": adjusted})
        eligible = [item for item in audited if item["colorMaterial"]["accepted"]]
        selected = max(eligible, key=lambda item: item["adjustedSelectionScore"]) if eligible else None
        rows.append({"sampleId": sample_id, "candidateCount": len(audited), "eligibleCount": len(eligible), "promotionEligible": selected is not None, "promoted": False, "selected": selected, "candidates": audited})
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    audited_report = {"schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "sourceReport": str(source_path.relative_to(ROOT)), "reference": str(reference_path.relative_to(ROOT)), "rows": rows, "promotionEligibleCount": sum(row["promotionEligible"] for row in rows), "promotedCount": 0, "requiresVisualReview": True}
    target = ROOT / "workspace" / "review" / f"catvton-color-audit-{stamp}.json"
    target.write_text(json.dumps(audited_report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **audited_report}


def catvton_retry_matrix(body: dict) -> dict:
    sample_ids = [str(value) for value in (body.get("sampleIds") or ["characters/c002.png", "characters/c003.png"])[:3]]
    seeds_per_sample = max(1, min(3, int(body.get("seedsPerSample", 3))))
    step_values = [max(10, min(40, int(value))) for value in (body.get("stepValues") or [10, 20])[:3]]
    base_seed = int(body.get("seed", 51001))
    max_side = int(body.get("maxSide", 512))
    reference_path = active_reference_path("upper_body")
    if not reference_path.is_file():
        normalize_reference({"garmentSampleId": "characters/c003.png", "category": "upper_body"})
    reference = Image.open(reference_path).convert("RGB")
    garment_data = encode_image(reference)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output_dir = OUTPUTS / f"catvton_retry_{stamp}"
    output_dir.mkdir(parents=True, exist_ok=False)
    rows, skipped = [], []
    for sample_index, sample_id in enumerate(sample_ids):
        source = Image.open(safe_sample(sample_id)).convert("RGB")
        people = detect_people(source, True)
        if len(people) != 1:
            skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
            continue
        person = people[0]
        mask, _, mask_metrics = catvton_dedicated_mask(source, "upper_body", person["box"], person.get("keypoints"))
        if not mask_metrics.get("accepted"):
            skipped.append({"sampleId": sample_id, "reason": "dedicated-mask-gate", "metrics": mask_metrics})
            continue
        candidates = []
        for steps in step_values:
            for seed_index in range(seeds_per_sample):
                seed = base_seed + sample_index * 100 + seed_index
                result = tryon({
                    "sampleId": sample_id, "garmentImage": garment_data, "category": "upper_body",
                    "editableMask": encode_image(mask), "autoMask": False, "usePose": True, "personIndex": 0,
                    "cropPerson": False, "preprocessGarment": False, "count": 1, "steps": steps,
                    "guidance": float(body.get("guidance", 2.5)), "seed": seed, "maxSide": max_side,
                    "expand": 0, "blur": 6, "repairSeams": False, "generativeRefine": False,
                    "maxRetries": 0, "minimumQuality": 0, "minimumSimilarity": 0,
                    "minimumSeam": 0, "minimumAnatomy": 0,
                })
                image = Image.open(ROOT / result["selected"]).convert("RGB")
                metrics = score_tryon_result(source, image, mask)
                metrics["referenceSimilarity"] = reference_similarity(reference, image, mask)
                core = catvton_core_degradation(image, mask)
                consistency = color_material_consistency(reference, image, mask)
                geometry = catvton_geometry_consistency(image, mask)
                selection_score = (
                    metrics["qualityScore"] * 0.13 + metrics["seamScore"] * 0.15 +
                    metrics["anatomyScore"] * 0.14 + metrics["referenceSimilarity"] * 100 * 0.22 +
                    metrics["textureContinuity"] * 0.08 + core["coreTextureScore"] * 0.10 +
                    consistency["colorMaterialScore"] * 0.12 + geometry["geometryScore"] * 0.06
                )
                filename = f"{Path(sample_id).stem}_s{seed}_n{steps}.png"
                image.save(output_dir / filename)
                candidates.append({"seed": seed, "steps": steps, "output": str((output_dir / filename).relative_to(ROOT)), "selectionScore": float(selection_score), "performance": result["performance"], **metrics, "coreDegradation": core, "colorMaterial": consistency, "geometry": geometry})
        eligible = [item for item in candidates if item["colorMaterial"]["accepted"] and item["geometry"]["accepted"]]
        selected = max(eligible or candidates, key=lambda item: item["selectionScore"])
        shutil.copyfile(ROOT / selected["output"], output_dir / f"{Path(sample_id).stem}_selected.png")
        mask.save(output_dir / f"{Path(sample_id).stem}_mask.png")
        rows.append({"sampleId": sample_id, "mask": mask_metrics, "candidateCount": len(candidates), "eligibleCount": len(eligible), "promotionAllowed": bool(eligible), "selected": selected, "candidates": candidates})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "sampleCount": len(rows),
        "skippedCount": len(skipped), "skipped": skipped, "seedsPerSample": seeds_per_sample,
        "stepValues": step_values, "rows": rows,
        "selectionWeights": {"quality": 0.13, "seam": 0.15, "anatomy": 0.14, "referenceSimilarity": 0.22, "textureContinuity": 0.08, "coreTexture": 0.10, "colorMaterial": 0.12, "geometry": 0.06},
        "requiresVisualReview": True,
    }
    report_path = ROOT / "workspace" / "review" / f"catvton-retry-matrix-{stamp}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(report_path.relative_to(ROOT)), "directory": str(output_dir.relative_to(ROOT)), **report}


def repair_local_seams(source: Image.Image, result: Image.Image, hard_mask: Image.Image):
    """Repair only high-frequency outliers in a narrow garment-boundary band."""
    array = np.asarray(result.convert("RGB"), dtype=np.uint8)
    mask = np.asarray(hard_mask, dtype=np.uint8)
    outer = cv2.dilate(mask, np.ones((11, 11), np.uint8), iterations=1) > 0
    inner = cv2.erode(mask, np.ones((11, 11), np.uint8), iterations=1) > 0
    # A seam repair must never change unselected fabric, skin or background.
    band = (outer ^ inner) & (mask > 0)
    gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    gradient = cv2.magnitude(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1))
    values = gradient[band]
    if not values.size:
        return result, Image.new("L", result.size, 0), 0
    threshold = max(45.0, float(np.percentile(values, 82)))
    artifacts = np.logical_and(band, gradient >= threshold).astype(np.uint8) * 255
    artifacts = cv2.dilate(artifacts, np.ones((3, 3), np.uint8), iterations=1)
    artifacts[mask == 0] = 0
    repaired = cv2.inpaint(array, artifacts, 2.0, cv2.INPAINT_TELEA)
    alpha = Image.fromarray(artifacts, mode="L").filter(ImageFilter.GaussianBlur(1.4))
    alpha = Image.fromarray(np.where(mask > 0, np.asarray(alpha), 0).astype(np.uint8), mode="L")
    output = Image.composite(Image.fromarray(repaired), result, alpha)
    return output, Image.fromarray(artifacts, mode="L"), int((artifacts > 0).sum())


def generative_seam_refine(source: Image.Image, result: Image.Image, hard_mask: Image.Image, seed: int, steps: int, region: str = "auto"):
    """Use SD3.5 only on a narrow anomalous garment boundary band."""
    _, defect_mask, defect_pixels = repair_local_seams(source, result, hard_mask)
    if defect_pixels < 32:
        return result, defect_mask, defect_pixels
    refine_array = np.asarray(defect_mask.filter(ImageFilter.MaxFilter(9)), dtype=np.uint8)
    bbox = hard_mask.getbbox()
    if bbox and region in ("collar", "sleeves", "waist"):
        x0, y0, x1, y1 = bbox
        region_array = np.zeros_like(refine_array)
        if region == "collar":
            region_array[y0:min(y1, y0 + max(1, round((y1 - y0) * 0.32))), x0:x1] = 255
        elif region == "waist":
            region_array[max(y0, y1 - max(1, round((y1 - y0) * 0.30))):y1, x0:x1] = 255
        else:
            edge_width = max(1, round((x1 - x0) * 0.28))
            region_array[y0:y1, x0:min(x1, x0 + edge_width)] = 255
            region_array[y0:y1, max(x0, x1 - edge_width):x1] = 255
        refine_array[region_array == 0] = 0
    refine_mask = Image.fromarray(refine_array, mode="L").point(lambda value: 255 if value > 12 else 0)
    defect_pixels = int((np.asarray(refine_mask) > 0).sum())
    if defect_pixels < 32:
        return result, refine_mask, defect_pixels
    blend_mask = refine_mask.filter(ImageFilter.GaussianBlur(2.0))
    max_side = 768
    scale = min(max_side / max(result.size), 1.0)
    width = max(64, round(result.width * scale / 64) * 64)
    height = max(64, round(result.height * scale / 64) * 64)
    pipe = load_inpaint_pipe()
    generator = torch.Generator(device="cpu").manual_seed(seed)
    with torch.inference_mode():
        generated = traced_pipeline_call(pipe, 
            prompt=prompt_text('generative_seam_refine.repair_the_garment_seam_only_coherent_fabric'),
            negative_prompt=prompt_text('generative_seam_refine.changed_face_changed_body_exposed_skin_distorted'),
            image=result.resize((width, height), Image.Resampling.LANCZOS),
            mask_image=refine_mask.resize((width, height), Image.Resampling.NEAREST),
            height=height, width=width, padding_mask_crop=64, strength=0.55,
            num_inference_steps=max(12, min(30, steps)), guidance_scale=4.0, generator=generator,
        ).images[0]
    generated = generated.resize(result.size, Image.Resampling.LANCZOS)
    return Image.composite(generated, result, blend_mask), refine_mask, defect_pixels


def visual_descriptor(image: Image.Image) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB").resize((96, 96), Image.Resampling.BILINEAR))
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    features = []
    for channel, bins, limit in ((0, 18, 180), (1, 16, 256), (2, 16, 256)):
        hist = cv2.calcHist([hsv], [channel], None, [bins], [0, limit]).reshape(-1)
        features.extend(hist / max(1.0, hist.sum()))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 60, 160)
    features.extend([edges.mean() / 255.0, gray.mean() / 255.0, gray.std() / 128.0])
    vector = np.asarray(features, dtype=np.float32)
    return vector / max(float(np.linalg.norm(vector)), 1e-8)


def clip_embedding(image: Image.Image) -> np.ndarray:
    global vision_checker, vision_processor
    if vision_checker is None:
        from transformers import CLIPImageProcessor
        vision_checker = StableDiffusionSafetyChecker.from_pretrained(
            CATVTON_BASE / "safety_checker", local_files_only=True
        ).to("cpu")
        vision_checker.eval()
        vision_processor = CLIPImageProcessor.from_pretrained(CATVTON_BASE / "feature_extractor", local_files_only=True)
    inputs = vision_processor(images=image.convert("RGB"), return_tensors="pt")
    with torch.inference_mode():
        pooled = vision_checker.vision_model(inputs.pixel_values)[1]
        embedding = vision_checker.visual_projection(pooled).float().cpu().numpy()[0]
    return embedding / max(float(np.linalg.norm(embedding)), 1e-8)


def reference_similarity(garment: Image.Image, result: Image.Image, mask: Image.Image) -> float:
    bbox = mask.getbbox()
    crop = result.crop(bbox) if bbox else result
    appearance = float(np.clip(np.dot(visual_descriptor(garment), visual_descriptor(crop)), 0.0, 1.0))
    try:
        semantic = float(np.clip(np.dot(clip_embedding(garment), clip_embedding(crop)), 0.0, 1.0))
    except Exception:
        semantic = appearance
    return float(0.7 * semantic + 0.3 * appearance)


def inpaint_model_entry(model_id: str | None = None):
    registry_path = ROOT / "models" / "registry.json"
    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    except Exception:
        registry = {"models": []}
    entries = [item for item in registry.get("models", []) if item.get("kind") == "inpaint"]
    if not model_id:
        configured = str(INPAINT_MODEL.resolve())
        return next((item for item in entries if (ROOT / item["path"]).resolve() == Path(configured)), None)
    entry = next((item for item in entries if item.get("id") == model_id), None)
    if not entry:
        raise ValueError(f"Model Inpainting chưa đăng ký: {model_id}")
    model_path = Path(str(entry.get("path") or ""))
    model_path = model_path if model_path.is_absolute() else ROOT / model_path
    if not model_path.resolve().is_relative_to((ROOT / "models").resolve()):
        raise ValueError("Đường dẫn model Inpainting phải nằm trong thư mục models")
    if not model_path.is_dir() or not (model_path / "model_index.json").is_file():
        raise RuntimeError(f"Model Inpainting chưa sẵn sàng: {display_model_path(model_path)}")
    return entry


def detect_inpaint_architecture(model_path: Path, architecture: str | None = None) -> str:
    """Resolve the configured inpaint family without requiring network access."""
    requested_architecture = (architecture or INPAINT_ARCHITECTURE).lower()
    if requested_architecture != "auto":
        return requested_architecture
    index_path = model_path / "model_index.json"
    try:
        model_class = str(json.loads(index_path.read_text(encoding="utf-8")).get("_class_name", "")).lower()
    except Exception:
        model_class = ""
    if "stablediffusionxl" in model_class:
        return "sdxl"
    if model_class in ("stablediffusioninpaintpipeline", "stablediffusionpipeline"):
        return "sd15"
    if "stablediffusion3" in model_class:
        return "sd35"
    if "fluxfill" in model_class:
        return "flux"
    return "sd35"


def configure_vae_memory(pipe):
    # Diffusers pipelines expose these optimizations under different APIs.
    for pipeline_method, vae_method in (("enable_vae_tiling", "enable_tiling"), ("enable_vae_slicing", "enable_slicing")):
        enable = getattr(pipe, pipeline_method, None)
        if not callable(enable):
            enable = getattr(getattr(pipe, "vae", None), vae_method, None)
        if callable(enable):
            enable()


def load_inpaint_pipe(progress=None, model_path: Path | None = None, architecture: str | None = None):
    global inpaint_pipe
    model_path = model_path or INPAINT_MODEL
    architecture = architecture or detect_inpaint_architecture(model_path)
    if inpaint_pipe is not None:
        if progress:
            progress("ready", "Model đã có sẵn trong bộ nhớ")
        return inpaint_pipe
    if not model_path.exists():
        raise RuntimeError(f"Thiếu model inpainting: {model_path}")
    if progress:
        progress("release", "Đang giải phóng model khác để chuẩn bị bộ nhớ")
    release_tryon()
    release_text_to_image()
    from diffusers import FluxFillPipeline, StableDiffusion3InpaintPipeline, StableDiffusionInpaintPipeline, StableDiffusionXLInpaintPipeline

    pipeline_classes = {
        "sd3": StableDiffusion3InpaintPipeline,
        "sd35": StableDiffusion3InpaintPipeline,
        "sdxl": StableDiffusionXLInpaintPipeline,
        "sd15": StableDiffusionInpaintPipeline,
        "sd2": StableDiffusionInpaintPipeline,
        "flux": FluxFillPipeline,
    }
    pipeline_class = pipeline_classes.get(architecture)
    if pipeline_class is None:
        raise RuntimeError(f"Kiến trúc inpainting chưa được hỗ trợ: {architecture}")

    if progress:
        progress("disk", f"Đang đọc model {architecture.upper()} từ ổ đĩa")
    dtype = torch.bfloat16 if architecture in ("sd3", "sd35", "flux") else torch.float16
    loaded_pipe = pipeline_class.from_pretrained(
        str(model_path), torch_dtype=dtype, local_files_only=True
    )
    if device == "cuda":
        if progress:
            progress("gpu", "Đang cấu hình model cho GPU")
        # FLUX Fill's transformer alone exceeds a 16 GB card in bfloat16.
        # Move individual layers instead of the entire transformer to CUDA.
        if architecture == "flux" and os.environ.get('ATELIER_FLUX_OFFLOAD','auto') == 'group':
            from diffusers.hooks import apply_group_offloading
            loaded_pipe.transformer.enable_group_offload(onload_device=torch.device('cuda'),
                offload_device=torch.device('cpu'),offload_type='block_level',num_blocks_per_group=2)
            for encoder in (loaded_pipe.text_encoder,loaded_pipe.text_encoder_2):
                apply_group_offloading(encoder,onload_device=torch.device('cuda'),offload_device=torch.device('cpu'),
                                      offload_type='leaf_level')
            loaded_pipe.vae.to('cuda')
            loaded_pipe._atelier_offload='group'
        elif architecture == "flux" and torch.cuda.get_device_properties(0).total_memory < 32 * 1024 ** 3:
            loaded_pipe.enable_sequential_cpu_offload()
            loaded_pipe._atelier_offload='sequential'
        else:
            loaded_pipe.enable_model_cpu_offload()
        configure_vae_memory(loaded_pipe)
    else:
        loaded_pipe.to("cpu")
    loaded_pipe._atelier_model_path = str(model_path.resolve())
    loaded_pipe._atelier_architecture = architecture
    inpaint_pipe = loaded_pipe
    apply_active_loras()
    if progress:
        progress("ready", "Model đã sẵn sàng")
    return inpaint_pipe


def read_lora_registry() -> dict:
    if not LORA_REGISTRY.exists():
        return {"schemaVersion": 1, "baseModel": "stable-diffusion-3.5-large", "adapters": []}
    data = json.loads(LORA_REGISTRY.read_text(encoding="utf-8"))
    if not isinstance(data.get("adapters", []), list):
        raise ValueError("Registry LoRA không hợp lệ")
    return data


def lora_file(entry: dict) -> Path:
    relative = Path(str(entry.get("file", "")))
    target = (LORA_ROOT / relative).resolve()
    root = LORA_ROOT.resolve()
    if root not in target.parents or target.suffix.lower() != ".safetensors":
        raise ValueError(f"Đường dẫn LoRA không hợp lệ: {relative}")
    return target


def lora_checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def lora_family(value: str) -> str:
    value = str(value).lower().replace("_", "-")
    aliases = {"sd35": "sd35-large", "sd3": "sd35-large", "stable-diffusion-3.5-large": "sd35-large", "sd3.5-large": "sd35-large", "stable-diffusion-3.5-medium": "sd35-medium", "sd3.5-medium": "sd35-medium", "sdxl-base-v1-0": "sdxl", "sdxl": "sdxl", "sd15": "sd15", "sd-1.5": "sd15", "sd-v1": "sd15", "stable-diffusion-v1-5": "sd15", "flux": "flux"}
    return aliases.get(value, value)


def lora_model_context(model_id=None):
    entry = inpaint_model_entry(model_id)
    model_path = Path(entry["path"]) if entry else INPAINT_MODEL
    if not model_path.is_absolute():
        model_path = ROOT / model_path
    architecture = detect_inpaint_architecture(model_path, entry.get("architecture") if entry else None)
    family = lora_family(architecture)
    if family == "sd35-large":
        config_path = model_path / "transformer" / "config.json"
        if config_path.is_file():
            config = json.loads(config_path.read_text(encoding="utf-8"))
            family = "sd35-medium" if config.get("num_layers") == 24 else family
    return {"id": entry["id"] if entry else "default", "name": entry.get("name", "Model mặc định") if entry else "Model mặc định", "family": family, "path": str(model_path.resolve())}


def lora_matches(entry, context):
    allowed = entry.get("compatibleModelIds")
    if allowed:
        return context["id"] in allowed
    return lora_family(entry.get("baseModel", "")) == context["family"]


def lora_status(model_id=None) -> dict:
    registry = read_lora_registry()
    context = lora_model_context(model_id)
    adapters = []
    for entry in registry.get("adapters", []):
        try:
            target = lora_file(entry)
            exists = target.is_file()
            expected = str(entry.get("sha256", "")).lower()
            valid = bool(exists and expected and lora_checksum(target) == expected)
        except Exception:
            exists, valid = False, False
        compatible = lora_matches(entry, context)
        adapters.append({**entry, "available": exists, "checksumValid": valid, "compatible": compatible, "usable": bool(exists and valid and compatible and entry.get("enabled", True))})
    public_active = [{key: value for key, value in item.items() if key != "path"} for item in active_loras if item.get("modelPath") == context["path"]]
    return {"ok": True, "root": str(LORA_ROOT), "baseModel": context["family"], "model": context, "adapters": adapters, "active": public_active, "pipelineLoaded": inpaint_pipe is not None and getattr(inpaint_pipe, "_atelier_model_path", None) == context["path"]}


def apply_active_loras():
    if inpaint_pipe is None:
        return
    inpaint_pipe.unload_lora_weights()
    selected_loras = [item for item in active_loras if item.get("modelPath") == getattr(inpaint_pipe, "_atelier_model_path", None)]
    for selected in selected_loras:
        inpaint_pipe.load_lora_weights(str(selected["path"]), adapter_name=selected["id"])
    if selected_loras:
        inpaint_pipe.set_adapters([item["id"] for item in selected_loras], adapter_weights=[item["weight"] for item in selected_loras])


def configure_loras(body: dict) -> dict:
    global active_loras
    context = lora_model_context(body.get("modelId"))
    requested = body.get("adapters") or []
    if not isinstance(requested, list) or len(requested) > 2:
        raise ValueError("Mỗi lượt chỉ hỗ trợ tối đa hai LoRA")
    registry = read_lora_registry()
    entries = {str(entry.get("id")): entry for entry in registry.get("adapters", [])}
    selected = []
    for request in requested:
        adapter_id = str(request.get("id", ""))
        entry = entries.get(adapter_id)
        if not entry or not entry.get("enabled", True):
            raise ValueError(f"LoRA chưa đăng ký hoặc đã tắt: {adapter_id}")
        if not lora_matches(entry, context):
            raise ValueError(f"LoRA không tương thích với {context['name']}: {adapter_id}")
        target = lora_file(entry)
        if not target.is_file():
            raise ValueError(f"Thiếu tệp LoRA: {adapter_id}")
        expected = str(entry.get("sha256", "")).lower()
        if not expected or lora_checksum(target) != expected:
            raise ValueError(f"Checksum LoRA không hợp lệ: {adapter_id}")
        weight = max(0.0, min(1.5, float(request.get("weight", entry.get("recommendedWeight", 0.75)))))
        selected.append({"id": adapter_id, "weight": weight, "sha256": expected, "path": target, "modelPath": context["path"]})
    previous = active_loras
    active_loras = [item for item in active_loras if item.get("modelPath") != context["path"]] + selected
    try:
        apply_active_loras()
    except Exception:
        active_loras = previous
        release_inpaint()
        raise
    return {"ok": True, "active": [{key: value for key, value in item.items() if key != "path"} for item in selected], "pipelineLoaded": inpaint_pipe is not None}


def release_inpaint():
    global inpaint_pipe
    if inpaint_pipe is not None:
        del inpaint_pipe
        inpaint_pipe = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def release_tryon():
    global tryon_pipe, tryon_pipe_model_id
    tryon_pipe_model_id = ""
    if tryon_pipe is not None:
        del tryon_pipe
        tryon_pipe = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def release_text_to_image():
    global text_to_image_pipe, text_to_image_model_id, chroma_pipe
    text_to_image_pipe = None
    text_to_image_model_id = ""
    chroma_pipe = None
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def tryon_model_files() -> tuple[Path, ...]:
    return (
        CATVTON_MODEL / "mix-48k-1024" / "attention" / "model.safetensors",
        CATVTON_BASE / "unet" / "config.json",
        CATVTON_BASE / "unet" / "diffusion_pytorch_model.fp16.safetensors",
        CATVTON_BASE / "scheduler" / "scheduler_config.json",
        CATVTON_VAE / "config.json",
        CATVTON_VAE / "diffusion_pytorch_model.bin",
    )


def load_tryon_pipe(model_id="catvton"):
    global tryon_pipe, tryon_pipe_model_id
    if model_id not in ("catvton", "idm-vton"):
        raise ValueError(f"Model thay trang phục không được hỗ trợ: {model_id}")
    if tryon_pipe is not None and tryon_pipe_model_id != model_id:
        release_tryon()
    if tryon_pipe is not None:
        return tryon_pipe
    if model_id == "idm-vton":
        if not DENSEPOSE_SCRIPT.is_file():
            raise RuntimeError("Thiếu DensePose TorchScript cho IDM-VTON. Chạy scripts/setup-idm-vton.ps1.")
        release_inpaint()
        release_text_to_image()
        from idm_vton_runtime import load_pipeline
        tryon_pipe = load_pipeline(IDMVTON_MODEL, IDMVTON_ROOT, device)
        tryon_pipe_model_id = model_id
        return tryon_pipe
    required = tryon_model_files()
    missing = [str(item) for item in required if not item.exists()]
    if missing:
        raise RuntimeError("Thiếu model CatVTON: " + ", ".join(missing))
    release_inpaint()
    release_text_to_image()
    import sys
    if str(CATVTON_ROOT) not in sys.path:
        sys.path.insert(0, str(CATVTON_ROOT))
    os.environ["CATVTON_VAE_PATH"] = str(CATVTON_VAE)
    os.environ["CATVTON_UNET_VARIANT"] = "fp16"
    os.environ["HF_HUB_OFFLINE"] = "1"
    from model.pipeline import CatVTONPipeline
    tryon_pipe = CatVTONPipeline(
        base_ckpt=str(CATVTON_BASE), attn_ckpt=str(CATVTON_MODEL),
        attn_ckpt_version="mix", weight_dtype=torch.bfloat16,
        device=device, use_tf32=True,
    )
    tryon_pipe_model_id = model_id
    return tryon_pipe


@trace_generation
def tryon(body: dict) -> dict:
    model_id = str(body.get("modelId") or "catvton")
    if model_id not in ("catvton", "idm-vton"):
        raise ValueError(f"Model thay trang phục không được hỗ trợ: {model_id}")
    started_at = time.perf_counter()
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()
    job_id = str(body.get("jobId", ""))[:80]
    update_job(job_id, status="running", stage="preparing")
    ensure_job_active(job_id)
    original_source = Image.open(safe_sample(str(body.get("sampleId", "")))).convert("RGB")
    source = original_source
    garment = decode_image(str(body.get("garmentImage", "")))
    category = str(body.get("category", "upper_body"))
    if category not in ('upper_body', 'lower_body', 'overall', 'full_body'):
        raise ValueError('Loại trang phục không hợp lệ')
    attributes = target_attributes(body.get('targetGarment'), category)
    thresholds = {
        'minimumQuality': max(0., min(100., float(body.get('minimumQuality',75)))),
        'minimumSimilarity': max(0., min(1., float(body.get('minimumSimilarity',.55)))),
        'minimumSeam': max(0., min(100., float(body.get('minimumSeam',65)))),
        'minimumAnatomy': max(0., min(100., float(body.get('minimumAnatomy',90)))),
    }
    minimum_quality, minimum_similarity, minimum_seam, minimum_anatomy = thresholds.values()
    def passes_gate(item):
        return not gate_reasons(item, thresholds)
    garment_description = None
    garment_negative_description = None
    if model_id == "idm-vton":
        from idm_vton_runtime import description_for, negative_description_for
        garment_description = description_for(category, body.get("garmentDescription") or None)
        garment_negative_description = negative_description_for(body.get("garmentNegativeDescription"))
    auto_mask_score = None
    update_job(job_id, stage="detecting-people", _event={"type":"analysis.started", "message":"Đang phát hiện nhân vật"})
    # Identity protection applies to manual masks and every person in the image.
    people = detect_people(original_source, POSE_MODEL.is_file())
    identity_array = np.zeros((original_source.height, original_source.width), dtype=np.uint8)
    for person in people:
        identity_array = np.maximum(identity_array, np.asarray(automatic_protected_detail_mask(original_source, person["box"], person.get("keypoints")), dtype=np.uint8))
    original_protected = Image.fromarray(identity_array)
    if body.get("protectedDetailMask"):
        user_protected = decode_mask(str(body["protectedDetailMask"]), original_source.size)
        original_protected = Image.fromarray(np.maximum(identity_array, np.asarray(user_protected, dtype=np.uint8)))
    person_index = max(0, min(len(people) - 1, int(body.get("personIndex", 0)))) if people else None
    person_box = people[person_index]["box"] if person_index is not None else None
    person_keypoints = people[person_index].get("keypoints") if person_index is not None else None
    crop_box = None
    if body.get("cropPerson") and person_box and (body.get("autoMask") or not body.get("editableMask")):
        x0, y0, x1, y1 = person_box
        padding = round(max(x1 - x0, y1 - y0) * 0.08)
        crop_box = (max(0, int(x0 - padding)), max(0, int(y0 - padding)), min(original_source.width, int(x1 + padding)), min(original_source.height, int(y1 + padding)))
        source = original_source.crop(crop_box)
        person_box = [0, 0, source.width, source.height]
        if person_keypoints:
            person_keypoints = [[point[0] - crop_box[0], point[1] - crop_box[1], point[2]] for point in person_keypoints]
    update_job(job_id, stage="creating-mask", _event={"type":"mask.started", "message":"Đang tạo vùng trang phục"})
    if body.get("autoMask") or not body.get("editableMask"):
        mask, auto_mask_score = automatic_garment_mask(source, category, person_box, person_keypoints)
    else:
        mask = decode_mask(str(body.get("editableMask", "")), source.size)
    protected = original_protected.crop(crop_box) if crop_box else original_protected
    reconstruct_body = bool(body.get("reconstructExposedBody", True))
    reconstruction_added = Image.new("L", source.size, 0)
    if reconstruct_body:
        ensure_job_active(job_id)
        update_job(job_id, stage="reconstructing-body-mask", _event={"type": "mask.reconstruction", "message": "Đang bổ sung vùng quần áo cũ để tái tạo phần cơ thể mới lộ ra"})
        if body.get("autoMask") or not body.get("editableMask"):
            old_clothing = mask
        else:
            old_clothing, _ = automatic_garment_mask(source, category, person_box, person_keypoints)
        mask, reconstruction_added = reconstruction_edit_mask(mask, old_clothing, protected)
    target_person = {'box': person_box, 'keypoints': person_keypoints} if person_box else None
    # Manual regions remain exact when body reconstruction is disabled.
    coverage_attributes = attributes if reconstruct_body or body.get('autoMask') else None
    mask, expected_garment, exposed_region, coverage_info = target_coverage(mask, protected, category, target_person, coverage_attributes)
    mask = exclude_protected_pixels(mask, protected)
    if mask.getbbox() is None:
        raise ValueError("Mask trang phục đang trống")
    expand = max(0, min(32, int(body.get("expand", 8))))
    blur = max(0, min(24, int(body.get("blur", 5))))
    hard_mask = mask.filter(ImageFilter.MaxFilter(expand * 2 + 1)) if expand else mask
    hard_mask = hard_mask.point(lambda value: 255 if value > 16 else 0)
    hard_mask = exclude_protected_pixels(hard_mask, protected)
    blend_mask = inward_blend(hard_mask, blur)
    blend_mask = exclude_protected_pixels(blend_mask, protected)

    max_side = max(512, min(1024, int(body.get("maxSide", 1024))))
    from idm_vton_runtime import canvas_size
    # Both published try-on models use a 3:4 canvas. Padding, not stretching,
    # places the selected person and reference in this coordinate system.
    width, height = canvas_size(max_side)
    count = max(1, min(4, int(body.get("count", 1))))
    steps = max(10, min(60, int(body.get("steps", 35))))
    guidance = max(0.5, min(7.5, float(body.get("guidance", 2.5))))
    requested_weights = body.get("scoreWeights") or {}
    score_weights = {
        "visualQuality": float(requested_weights.get("visualQuality", 0.35)),
        "referenceSimilarity": float(requested_weights.get("referenceSimilarity", 0.25)),
        "seamScore": float(requested_weights.get("seamScore", 0.15)),
        "anatomyScore": float(requested_weights.get("anatomyScore", 0.15)),
        "textureContinuity": float(requested_weights.get("textureContinuity", 0.10)),
    }
    weight_total = max(0.0001, sum(max(0.0, value) for value in score_weights.values()))
    score_weights = {key: max(0.0, value) / weight_total for key, value in score_weights.items()}
    def add_ranking_score(metrics):
        metrics["rankingScore"] = (
            metrics["qualityScore"] * score_weights["visualQuality"] +
            metrics["referenceSimilarity"] * 100 * score_weights["referenceSimilarity"] +
            metrics["seamScore"] * score_weights["seamScore"] +
            metrics["anatomyScore"] * score_weights["anatomyScore"] +
            metrics["textureContinuity"] * score_weights["textureContinuity"]
        )
    seed = int(body.get("seed", 42))
    garment_coverage = None
    garment_mode = None
    garment_mask_score = None
    if body.get("preprocessGarment"):
        garment, _, garment_coverage, garment_mode, garment_mask_score = preprocess_garment_image(garment, category, str(body.get('referenceType','auto')))

    update_job(job_id, stage="loading-model", _event={"type":"model.loading", "message":"Đang nạp model tạo ảnh"})
    pose_image = None
    if model_id == "idm-vton":
        from idm_vton_runtime import densepose_image
        update_job(job_id, stage="densepose", modelId=model_id)
        pose_image = densepose_image(fit_image(source, fit_geometry(source.size, (width,height))), DENSEPOSE_SCRIPT)
    pipe = load_tryon_pipe(model_id)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    run_id = f"tryon_{Path(str(body.get('sampleId'))).stem}_{stamp}"
    run_dir = OUTPUTS / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    garment.save(run_dir / "garment.png")
    original_protected.save(run_dir / "protected_identity.png")
    saved_reconstruction = Image.new("L", original_source.size, 0)
    if crop_box:
        saved_reconstruction.paste(reconstruction_added, crop_box)
    else:
        saved_reconstruction = reconstruction_added
    saved_reconstruction.save(run_dir / "body_reconstruction_mask.png")
    saved_mask = Image.new("L", original_source.size, 0)
    if crop_box:
        saved_mask.paste(hard_mask, crop_box)
    else:
        saved_mask = hard_mask
    saved_mask.save(run_dir / "editable_mask.png")
    scoring_mask = saved_mask if crop_box else hard_mask
    for name, local_mask in (('expected_garment_mask.png',expected_garment),('exposed_region_mask.png',exposed_region)):
        full_mask = Image.new('L', original_source.size, 0)
        if crop_box:
            full_mask.paste(local_mask, crop_box)
        else:
            full_mask = local_mask
        full_mask.save(run_dir/name)

    seed_progress = 0
    repair_mode = str(body.get("bodyRepairMode", "off"))
    requires_bare_arms = reconstruct_body and category in ("upper_body", "overall", "full_body") and person_index is not None and (repair_mode == "arms" or (repair_mode == "auto" and sleeveless_reference(garment)))
    def audit_bare_arms(image):
        if not requires_bare_arms:
            return {"required": False, "passed": True}
        region, _ = arm_reconstruction_masks(original_source, people[person_index], scoring_mask, original_protected, image)
        selected = np.asarray(region) > 0
        coverage = float((reference_skin_mask(original_source, image, people[person_index]) > 0)[selected].mean()) if selected.any() else 0.0
        return {"required": True, "passed": coverage >= 0.75, "skinCoverage": coverage, "minimumSkinCoverage": 0.75}
    def assess_candidate(image):
        metrics = score_tryon_result(original_source, image, scoring_mask)
        metrics['referenceSimilarity'] = reference_similarity(garment, image, scoring_mask)
        metrics['colorMaterial'] = color_material_consistency(garment, image, scoring_mask)
        metrics['geometry'] = catvton_geometry_consistency(image, scoring_mask)
        result_people = detect_people_pose(image) if POSE_MODEL.is_file() else []
        metrics['poseConsistency'] = pose_consistency(people[person_index] if person_index is not None else None, result_people)
        metrics['targetCoverage'] = coverage_info
        metrics['bodyAudit'] = audit_bare_arms(image)
        metrics['qualityScore'] = (metrics['preservationScore']*.30 + metrics['seamScore']*.25
                                   + metrics['colorMaterial']['colorMaterialScore']*.25
                                   + metrics['geometry']['geometryScore']*.20)
        metrics['metricSemantics'] = 'tryon-quality-v2'
        metrics['qualityGate'] = quality_gate(metrics, thresholds)
        add_ranking_score(metrics)
        return metrics
    def preserve_regions(image):
        image = Image.composite(image, original_source, scoring_mask)
        return restore_protected_pixels(original_source, image, original_protected)
    # Two finalists reduce the chance of a low-resolution ranking hiding a better
    # full-resolution result. Four preview candidates still cost only two finals.
    finalist_count = min(2,count) if bool(body.get('twoStage')) and count > 1 else 0
    estimated_seeds = count + max(0, min(3, int(body.get("maxRetries", 1)))) + finalist_count
    def generate_candidate(run_seed: int, run_width: int, run_height: int, run_steps: int, prefix: str):
        nonlocal seed_progress
        ensure_job_active(job_id)
        update_job(job_id, stage=prefix, seed=run_seed)
        generator = torch.Generator(device=device).manual_seed(run_seed)
        if model_id == "idm-vton":
            from idm_vton_runtime import generate
            def on_idm_step(pipeline, step_index, timestep, callback_kwargs):
                ensure_job_active(job_id)
                update_job(job_id, stage=prefix, step=step_index + 1, totalSteps=run_steps, modelId=model_id)
                return callback_kwargs
            generated = generate(pipe, source, garment, hard_mask, pose_image, category,
                                 traced_pipeline_call, num_inference_steps=run_steps,
                                 garment_description=garment_description,
                                 garment_negative_description=garment_negative_description,
                                 guidance_scale=guidance, height=run_height, width=run_width,
                                 generator=generator, callback_on_step_end=on_idm_step)
        else:
            from catvton_inputs import prepare_inputs
            model_source, model_mask = prepare_inputs(source, hard_mask, (run_width, run_height))
            generated = traced_pipeline_call(pipe,
                image=model_source, condition_image=garment, mask=model_mask,
                num_inference_steps=run_steps, guidance_scale=guidance,
                height=run_height, width=run_width, generator=generator,
            )[0]
            generated = restore_image(generated, fit_geometry(source.size,(run_width,run_height)))
        seed_progress += 1
        update_job(job_id, completedSeeds=seed_progress, totalSeeds=estimated_seeds)
        update_job(job_id, stage="scoring", seed=run_seed, _event={"type":"scoring.started", "message":f"Đang chấm điểm seed {run_seed}", "seed":run_seed})
        composited_work = Image.composite(generated, source, blend_mask)
        if crop_box:
            composited = original_source.copy()
            composited.paste(composited_work, crop_box)
        else:
            composited = composited_work
        composited = restore_protected_pixels(original_source, composited, original_protected)
        output_name = f"{prefix}_seed_{run_seed}.png"
        composited.save(run_dir / output_name)
        metrics = assess_candidate(composited)
        seam_repair = {"attempted": False, "accepted": False, "pixels": 0}
        if body.get("repairSeams", True):
            seam_repair["attempted"] = True
            repaired, repair_mask, repair_pixels = repair_local_seams(original_source, composited, scoring_mask)
            repaired = preserve_regions(repaired)
            repaired_metrics = assess_candidate(repaired)
            seam_repair["pixels"] = repair_pixels
            if repair_is_better(metrics, repaired_metrics, thresholds):
                composited, metrics = repaired, repaired_metrics
                seam_repair["accepted"] = True
                repair_mask.save(run_dir / f"seam_mask_seed_{run_seed}.png")
                composited.save(run_dir / output_name)
        metrics["seamRepair"] = seam_repair
        metrics["bodyAudit"] = audit_bare_arms(composited)
        if not metrics["bodyAudit"]["passed"]:
            metrics["rankingScore"] -= 25 * (1 - metrics["bodyAudit"]["skinCoverage"])
        update_job(job_id, _result={
            "kind": "seed", "sampleId": str(body.get("sampleId")), "seed": run_seed,
            "file": str((run_dir / output_name).relative_to(ROOT)), "stage": prefix,
            "qualityScore": round(float(metrics["qualityScore"]), 2),
            "referenceSimilarity": round(float(metrics["referenceSimilarity"]), 4),
            "seamScore": round(float(metrics["seamScore"]), 2),
            "anatomyScore": round(float(metrics["anatomyScore"]), 2),
        }, _event={"type":"seed.completed", "message":f"Seed {run_seed} hoàn tất", "seed":run_seed, "sampleId":str(body.get("sampleId"))})
        return {"seed": run_seed, "image": encode_image(composited), "file": output_name, **metrics}

    two_stage = bool(body.get("twoStage")) and count > 1
    if two_stage:
        preview_width, preview_height = canvas_size(512)
        preview_steps = max(10, min(20, int(body.get("previewSteps", 10))))
        candidates = [generate_candidate(seed + index, preview_width, preview_height, preview_steps, "preview") for index in range(count)]
        finalists = sorted(candidates, key=lambda item: candidate_key(item,thresholds), reverse=True)[:finalist_count]
        results = [generate_candidate(item['seed'], width, height, steps, 'result') for item in finalists]
        best = max(results, key=lambda item: candidate_key(item,thresholds))
    else:
        candidates = []
        results = [generate_candidate(seed + index, width, height, steps, "result") for index in range(count)]
        best = max(results, key=lambda item: candidate_key(item,thresholds))
    retry_count = 0
    max_retries = max(0, min(3, int(body.get("maxRetries", 1))))
    while not passes_gate(best) and retry_count < max_retries:
        ensure_job_active(job_id)
        retry_seed = seed + count + retry_count
        retry = generate_candidate(retry_seed, width, height, min(60, steps + 5), "retry")
        results.append(retry)
        if candidate_key(retry,thresholds) > candidate_key(best,thresholds):
            best = retry
        retry_count += 1
    generative_refine = {"attempted": False, "accepted": False, "pixels": 0}
    if body.get("generativeRefine", True) and best["seamScore"] < minimum_seam and not best["seamRepair"]["accepted"]:
        ensure_job_active(job_id)
        update_job(job_id, stage="generative-seam-refine", seed=best["seed"])
        generative_refine["attempted"] = True
        refine_region = str(body.get("refineRegion", "auto"))
        refined, refine_mask, refine_pixels = generative_seam_refine(original_source, Image.open(run_dir / best["file"]).convert("RGB"), scoring_mask, best["seed"] + 900000, min(24, steps), refine_region)
        refined = preserve_regions(refined)
        refined_metrics = assess_candidate(refined)
        generative_refine["pixels"] = refine_pixels
        if repair_is_better(best, refined_metrics, thresholds):
            refine_mask.save(run_dir / f"generative_seam_mask_seed_{best['seed']}.png")
            refined.save(run_dir / best["file"])
            best.update({"image": encode_image(refined), **refined_metrics})
            generative_refine["accepted"] = True
        best["generativeRefine"] = generative_refine
    body_repair = {"applied": False, "reason": "disabled-or-not-sleeveless"}
    if reconstruct_body and category in ("upper_body", "overall", "full_body") and person_index is not None and (repair_mode == "arms" or (repair_mode == "auto" and sleeveless_reference(garment))):
        ensure_job_active(job_id)
        update_job(job_id, stage="repairing-exposed-arms", _event={"type": "body.repair", "message": "Đang sửa vùng tay áo cũ và tái tạo tay trần"})
        # No further CatVTON candidates are generated after this point.
        pipe = None
        release_tryon()
        repaired, repair_mask, body_repair = reconstruct_bare_arms(original_source, Image.open(run_dir / best["file"]).convert("RGB"), people[person_index], scoring_mask, original_protected, best["seed"], run_dir / "exposed_arms_candidate.png")
        ensure_job_active(job_id)
        if body_repair["applied"]:
            repaired = preserve_regions(repaired)
            repaired_metrics = assess_candidate(repaired)
            if set(gate_reasons(repaired_metrics,thresholds)) <= set(gate_reasons(best,thresholds)) and repaired_metrics['referenceSimilarity'] >= best['referenceSimilarity']-.02:
                repair_mask.save(run_dir / "exposed_arms_repair_mask.png")
                repaired.save(run_dir / best["file"])
                best.update({"image": encode_image(repaired), **repaired_metrics})
            else:
                body_repair.update(applied=False, reason='quality-regression')
    best["bodyAudit"] = audit_bare_arms(Image.open(run_dir / best["file"]).convert("RGB"))
    best['qualityGate'] = quality_gate(best,thresholds)
    quality_passed = passes_gate(best)
    update_job(job_id, stage="saving", _event={"type":"saving.started", "message":"Đang lưu kết quả và metadata"})
    shutil.copyfile(run_dir / best["file"], run_dir / "selected.png")
    duration_seconds = round(time.perf_counter() - started_at, 3)
    peak_vram_mb = round(torch.cuda.max_memory_allocated() / (1024 * 1024), 1) if torch.cuda.is_available() else 0.0
    metadata = {
        "promptHistory": prompt_history(),
        "schemaVersion": 1, "runId": run_id, "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": str(body.get("sampleId")), "category": category, "seed": seed,
        "count": count, "steps": steps, "guidance": guidance,
        "expand": expand, "blur": blur, "modelId": model_id, "model": "IDM-VTON" if model_id == "idm-vton" else "CatVTON mix-48k-1024",
        "garmentDescription": garment_description,
        "garmentNegativeDescription": garment_negative_description,
        "license": "CC-BY-NC-SA-4.0", "device": device,
        "modelWidth": width, "modelHeight": height,
        "inputGeometry": fit_geometry(source.size,(width,height)),
        "targetCoverage": coverage_info, "referenceType": body.get('referenceType','auto'),
        "qualityVersion": 2, "requiresVisualReview": True,
        "autoMask": bool(body.get("autoMask") or not body.get("editableMask")),
        "autoMaskScore": auto_mask_score, "garmentCoverage": garment_coverage,
        "identityProtection": {"enabled": True, "protectedPixels": int((np.asarray(original_protected) > 0).sum()), "mask": "protected_identity.png"},
        "bodyReconstruction": {"enabled": reconstruct_body, "method": f"{model_id}-complete-old-clothing-mask", "addedPixels": int((np.asarray(saved_reconstruction) > 0).sum()), "mask": "body_reconstruction_mask.png"},
        "bodyRepair": body_repair,
        "bodyAudit": best["bodyAudit"],
        "garmentMode": garment_mode, "garmentMaskScore": garment_mask_score,
        "personIndex": person_index, "detectedPeople": len(people),
        "cropPerson": bool(crop_box), "cropBox": crop_box, "usePose": bool(body.get("usePose")),
        "selectedSeed": best["seed"], "selectedQualityScore": best["qualityScore"],
        "results": [{key: value for key, value in item.items() if key != "image"} for item in results],
        "twoStage": two_stage, "previewCandidates": [{k: item[k] for k in ("seed", "qualityScore", "referenceSimilarity")} for item in candidates],
        "qualityGate": best['qualityGate'],
        "repairSeams": bool(body.get("repairSeams", True)), "retryCount": retry_count,
        "generativeRefine": generative_refine,
        "refineRegion": str(body.get("refineRegion", "auto")),
        "selectedMetrics": {key: best[key] for key in ("qualityScore", "rankingScore", "referenceSimilarity", "seamScore", "anatomyScore", "textureContinuity", "preservationScore", "colorMaterial", "geometry", "poseConsistency", "metricSemantics")},
        "performance": {"durationSeconds": duration_seconds, "peakVramMb": peak_vram_mb},
        "scoreWeights": score_weights,
    }
    (run_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    response = {
        "ok": True, "promptHistory": prompt_history(), "results": results, "width": width, "height": height, "device": device,
        "directory": str(run_dir.relative_to(ROOT)), "selectedSeed": best["seed"], "modelId": model_id,
        "selected": str((run_dir / "selected.png").relative_to(ROOT)), "autoMaskScore": auto_mask_score,
        "garmentCoverage": garment_coverage, "garmentMode": garment_mode, "garmentMaskScore": garment_mask_score,
        "candidates": [{k: item[k] for k in ("seed", "qualityScore", "referenceSimilarity")} for item in candidates],
        "qualityGate": best['qualityGate'], "targetCoverage": coverage_info,
        "retryCount": retry_count,
        "bodyReconstruction": metadata["bodyReconstruction"],
        "bodyRepair": body_repair,
        "bodyAudit": best["bodyAudit"],
        "generativeRefine": generative_refine,
        "performance": {"durationSeconds": duration_seconds, "peakVramMb": peak_vram_mb},
    }
    if body.get("batchMode"):
        update_job(job_id, stage="batch-item-complete", directory=str(run_dir.relative_to(ROOT)))
    else:
        update_job(job_id, status="completed", stage="done", directory=str(run_dir.relative_to(ROOT)), _event={"type":"job.completed", "message":"Đã hoàn tất tạo kết quả"})
    return response


def garment_category_from_points(points, person, fallback: str) -> str:
    positives = [point for point in (points or []) if int(point.get("label", 1)) == 1]
    if not positives:
        return fallback
    x0, y0, x1, y1 = person["box"]
    height = max(1.0, y1 - y0)
    keypoints = person.get("keypoints")
    waist_y = y0 + height * 0.38
    if keypoints and len(keypoints) > 12 and keypoints[11][2] > 0.25 and keypoints[12][2] > 0.25:
        waist_y = float(np.mean([keypoints[11][1], keypoints[12][1]])) - height * 0.10
    # Only points within the selected person's body determine the category.
    ys = [float(point["y"]) for point in positives if x0 <= float(point["x"]) <= x1 and y0 + height * 0.18 <= float(point["y"]) <= y1]
    if not ys:
        return fallback
    above = any(y < waist_y - height * 0.015 for y in ys)
    below = any(y > waist_y + height * 0.015 for y in ys)
    if above and below:
        return "overall"
    return "upper_body" if above else "lower_body" if below else fallback


def refine_object_mask(mask, points, protected):
    binary = fill_garment_mask_holes(mask)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3,3),dtype=np.uint8))
    count, labels, _, _ = cv2.connectedComponentsWithStats(binary, 8)
    selected = set()
    for point in points:
        if int(point.get("label",1)) == 1:
            x,y=round(float(point["x"])),round(float(point["y"]))
            neighborhood=labels[max(0,y-3):min(labels.shape[0],y+4),max(0,x-3):min(labels.shape[1],x+4)]
            selected.update(int(value) for value in np.unique(neighborhood) if value)
    if selected:
        binary=np.isin(labels,list(selected)).astype(np.uint8)
    for point in points:
        if int(point.get("label",1)) == 0:
            cv2.circle(binary,(round(float(point["x"])),round(float(point["y"]))),max(3,round(min(binary.shape)*0.008)),0,-1)
    binary[np.asarray(protected)>0]=0
    return Image.fromarray(binary*255)


def segment_object_mask(body: dict) -> dict:
    from PIL import ImageOps
    source=ImageOps.exif_transpose(Image.open(safe_sample(str(body.get("sampleId",""))))).convert("RGB")
    points=body.get("points") or []
    if not points or len(points)>64 or not any(int(p.get("label",1))==1 for p in points):
        raise ValueError("Cần ít nhất một điểm chọn; tối đa 64 điểm mỗi lượt")
    coords=np.asarray([[float(p["x"]),float(p["y"])] for p in points],dtype=np.float32)
    labels=np.asarray([int(p.get("label",1)) for p in points],dtype=np.int32)
    if not np.isfinite(coords).all() or not np.isin(labels,[0,1]).all() or (coords<0).any() or (coords[:,0]>=source.width).any() or (coords[:,1]>=source.height).any():
        raise ValueError("Điểm chọn mask không hợp lệ hoặc nằm ngoài ảnh")
    coords=np.round(coords).astype(np.int32)
    coords[:,0]=np.clip(coords[:,0],0,source.width-1);coords[:,1]=np.clip(coords[:,1],0,source.height-1)
    points=[{"x":int(x),"y":int(y),"label":int(label)} for (x,y),label in zip(coords,labels)]
    protected=decode_mask(str(body["protectedDetailMask"]),source.size) if body.get("protectedDetailMask") else Image.new("L",source.size)
    model=load_predictor()
    with torch.inference_mode(),torch.autocast(device_type=device,dtype=torch.bfloat16,enabled=device=="cuda"):
        model.set_image(np.asarray(source))
        masks,scores,_=model.predict(point_coords=coords,point_labels=labels,multimask_output=True)
        def rank(index):
            agreement=float((np.asarray(masks[index])[coords[:,1],coords[:,0]]==(labels>0)).mean())
            return agreement*2+float(scores[index])
        best=max(range(len(masks)),key=rank)
        combined=np.asarray(masks[best],dtype=bool).copy()
        for index,candidate in enumerate(masks):
            union=np.logical_or(combined,candidate).sum()
            if scores[index]>=scores[best]-.08 and np.logical_and(combined,candidate).sum()/max(1,union)>=.80 and rank(index)>=rank(best)-.08:
                combined|=np.asarray(candidate,dtype=bool)
        # A disconnected second object needs its own positive prompt.
        for index in np.flatnonzero(labels==1)[:8]:
            x,y=coords[index]
            if combined[y,x]:
                continue
            local_coords=np.concatenate([coords[index:index+1],coords[labels==0]])
            local_labels=np.concatenate([np.ones(1,dtype=np.int32),labels[labels==0]])
            extra,confidence,_=model.predict(point_coords=local_coords,point_labels=local_labels,multimask_output=True)
            valid=[i for i in range(len(extra)) if extra[i][y,x]]
            if valid:combined|=np.asarray(extra[max(valid,key=lambda i:float(confidence[i]))],dtype=bool)
    mask=refine_object_mask(combined,points,protected)
    if mask.getbbox() is None:
        raise ValueError("Vùng chọn trống hoặc nằm hoàn toàn trong vùng bảo vệ")
    return {"ok":True,"mask":encode_image(mask),"score":float(scores[best]),"coverage":float((np.asarray(mask)>0).mean()),"protectedMask":encode_image(protected),"device":device}


def auto_mask(body: dict) -> dict:
    source = Image.open(safe_sample(str(body.get("sampleId", "")))).convert("RGB")
    category = str(body.get("category", "upper_body"))
    if category not in ("upper_body", "lower_body", "overall", "full_body"):
        raise ValueError("Loại trang phục không hợp lệ")
    people = detect_people(source, POSE_MODEL.is_file())
    person_index = max(0, min(len(people) - 1, int(body.get("personIndex", 0))))
    person = people[person_index]
    if body.get("inferCategoryFromPoints"):
        category = garment_category_from_points(body.get("points"), person, category)
    protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
    if body.get("protectedDetailMask"):
        user_protected = decode_mask(str(body["protectedDetailMask"]), source.size)
        protected = Image.fromarray(np.maximum(np.asarray(protected), np.asarray(user_protected)))
    mask, score = automatic_garment_mask(source, category, person["box"], person.get("keypoints"), body.get("points"))
    mask_array = np.asarray(mask, dtype=np.uint8).copy()
    mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
    mask = Image.fromarray(mask_array, mode="L")
    policy = mask_strength_policy(mask, person["box"], category, person.get("keypoints"))
    mask, target, exposed, coverage_info = target_coverage(mask, protected, category, person, body.get('targetGarment'))
    return {"ok": True, "mask": encode_image(mask), "protectedMask": encode_image(protected), "score": score, **policy,
            "targetCoverage": coverage_info, "targetMask": encode_image(target), "exposedMask": encode_image(exposed),
            "category": category, "people": people, "personIndex": person_index, "device": device}


def preprocess_garment(body: dict) -> dict:
    garment = decode_image(str(body.get("garmentImage", "")))
    processed, mask, coverage, mode, score = preprocess_garment_image(garment, str(body.get("category", "upper_body")), str(body.get('referenceType','auto')))
    return {"ok": True, "image": encode_image(processed), "mask": encode_image(mask), "coverage": coverage, "mode": mode, "score": score, "device": device}


def analyze_people(body: dict) -> dict:
    source = Image.open(safe_sample(str(body.get("sampleId", "")))).convert("RGB")
    return {"ok": True, "people": detect_people(source, bool(body.get("usePose"))), "width": source.width, "height": source.height, "device": device, "poseAvailable": POSE_MODEL.is_file()}


def regression_audit(body: dict) -> dict:
    category = str(body.get("category", "upper_body"))
    weak_threshold = float(body.get("weakThreshold", 0.65 if body.get("usePose") else 0.75))
    sample_ids = sorted(str(path.relative_to(SAMPLES)).replace("\\", "/") for path in SAMPLES.rglob("*") if path.suffix.lower() in (".png", ".jpg", ".jpeg"))
    items = []
    for sample_id in sample_ids:
        source = Image.open(safe_sample(sample_id)).convert("RGB")
        people = detect_people(source, bool(body.get("usePose")))
        person = people[0]
        mask, score = automatic_garment_mask(source, category, person["box"], person.get("keypoints"))
        coverage = float((np.asarray(mask) > 0).mean())
        landscape = source.width > source.height
        reasons = []
        if landscape:
            reasons.append("landscape")
        if len(people) > 1:
            reasons.append("multiple_people")
        if person["source"] == "center-fallback":
            reasons.append("detector_fallback")
        if score < weak_threshold or coverage < 0.02:
            reasons.append("weak_mask")
        items.append({
            "sampleId": sample_id, "width": source.width, "height": source.height,
            "orientation": "landscape" if landscape else "portrait", "people": people,
            "maskScore": score, "maskCoverage": coverage, "needsManualReview": bool(reasons), "reasons": reasons,
        })
    stamp = datetime.now(timezone.utc).strftime("audit_%Y%m%dT%H%M%S%fZ")
    report_dir = OUTPUTS / stamp
    report_dir.mkdir(parents=True, exist_ok=False)
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "category": category,
        "detector": "yolo11n-pose" if body.get("usePose") else "haar-hog", "weakThreshold": weak_threshold,
        "total": len(items), "passed": sum(not item["needsManualReview"] for item in items),
        "manualReview": sum(item["needsManualReview"] for item in items), "items": items,
    }
    report_path = report_dir / "regression-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(report_path.relative_to(ROOT)), **report}


def batch_tryon(body: dict) -> dict:
    job_id = str(body.get("jobId", ""))[:80]
    safe_job_id = "".join(character for character in job_id if character.isalnum() or character in "-_")
    request_file = JOBS_DIR / f"{safe_job_id}.request.json" if safe_job_id else None
    checkpoint_file = JOBS_DIR / f"{safe_job_id}.checkpoint.json" if safe_job_id else None
    if request_file and not body.get("resume"):
        JOBS_DIR.mkdir(parents=True, exist_ok=True)
        request_file.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    update_job(job_id, status="running", stage="batch-preparing", resumable=bool(request_file), requestFile=str(request_file.relative_to(ROOT)) if request_file else None)
    sample_ids = list(dict.fromkeys(str(item) for item in (body.get("sampleIds") or [])))
    if not sample_ids:
        raise ValueError("Chưa chọn ảnh cho chế độ hàng loạt")
    maximum = 23 if body.get("benchmark") else 12
    if len(sample_ids) > maximum:
        raise ValueError(f"Mỗi lượt hàng loạt tối đa {maximum} ảnh")
    garment = decode_image(str(body.get("garmentImage", "")))
    processed, _, garment_coverage, garment_mode, garment_mask_score = preprocess_garment_image(garment, str(body.get("category", "upper_body")), str(body.get('referenceType','auto')))
    encoded_garment = encode_image(processed)
    checkpoint = {}
    if body.get("resume") and checkpoint_file and checkpoint_file.exists():
        checkpoint = json.loads(checkpoint_file.read_text(encoding="utf-8"))
    items = list(checkpoint.get("items", []))
    errors = list(checkpoint.get("errors", []))
    skipped = list(checkpoint.get("skipped", []))
    processed = set(checkpoint.get("processed", []))
    def save_checkpoint(sample_id=None):
        if sample_id:
            processed.add(sample_id)
        if checkpoint_file:
            checkpoint_file.write_text(json.dumps({"processed": sorted(processed), "items": items, "errors": errors, "skipped": skipped}, ensure_ascii=False, indent=2), encoding="utf-8")
    minimum_confidence = max(0.0, min(1.0, float(body.get("minimumConfidence", 0.75))))
    for index, sample_id in enumerate(sample_ids):
        if sample_id in processed:
            continue
        ensure_job_active(job_id)
        update_job(job_id, stage="batch-item", current=index + 1, total=len(sample_ids), sampleId=sample_id)
        request = {
            **body, "sampleId": sample_id, "garmentImage": encoded_garment,
            "editableMask": "", "protectedDetailMask": "", "autoMask": True,
            "preprocessGarment": False, "cropPerson": bool(body.get("cropPerson", True)),
            "seed": int(body.get("seed", 42)) + index * 100,
            "batchMode": True,
        }
        try:
            audit_source = Image.open(safe_sample(sample_id)).convert("RGB")
            audit_people = detect_people(audit_source, bool(body.get("usePose")))
            audit_index = max(0, min(len(audit_people) - 1, int(body.get("personIndex", 0))))
            _, audit_score = automatic_garment_mask(audit_source, str(body.get("category", "upper_body")), audit_people[audit_index]["box"], audit_people[audit_index].get("keypoints"))
            if body.get("onlyConfident", True) and audit_score < minimum_confidence:
                skipped.append({"sampleId": sample_id, "maskScore": audit_score, "reason": "below_confidence_threshold"})
                save_checkpoint(sample_id)
                continue
            result = tryon(request)
            best = next(item for item in result['results'] if item['seed'] == result['selectedSeed'])
            if body.get("onlyQualityPassed", True) and not result["qualityGate"]["passed"]:
                skipped.append({
                    "sampleId": sample_id, "qualityScore": best["qualityScore"],
                    "referenceSimilarity": best["referenceSimilarity"], "reason": "quality_gate",
                })
                save_checkpoint(sample_id)
                continue
            items.append({
                "sampleId": sample_id, "directory": result["directory"], "selected": result["selected"],
                "selectedSeed": result["selectedSeed"], "qualityScore": best["qualityScore"],
                "outsideMaskMAE": best["outsideMaskMAE"], "edgeMAE": best["edgeMAE"],
                "autoMaskScore": result["autoMaskScore"], "referenceSimilarity": best["referenceSimilarity"],
                "seamScore": best["seamScore"], "anatomyScore": best["anatomyScore"],
                "textureContinuity": best["textureContinuity"], "category": str(body.get("category", "upper_body")),
                "preservationScore": best['preservationScore'], "qualityGate": result['qualityGate'],
                "colorMaterial": best['colorMaterial'], "geometry": best['geometry'], "poseConsistency": best['poseConsistency'],
                "durationSeconds": result["performance"]["durationSeconds"], "peakVramMb": result["performance"]["peakVramMb"],
            })
            update_job(job_id, current=index + 1, total=len(sample_ids), _result={
                "kind":"image", "sampleId":sample_id, "seed":result["selectedSeed"],
                "file":result["selected"], "qualityScore":round(float(best["qualityScore"]),2),
                "referenceSimilarity":round(float(best["referenceSimilarity"]),4),
                "seamScore":round(float(best["seamScore"]),2), "anatomyScore":round(float(best["anatomyScore"]),2),
            }, _event={"type":"image.completed", "message":f"Đã hoàn tất ảnh {index + 1}/{len(sample_ids)}", "sampleId":sample_id})
            save_checkpoint(sample_id)
        except Exception as error:
            errors.append({"sampleId": sample_id, "error": str(error)})
            if "Tác vụ đã được hủy" not in str(error):
                save_checkpoint(sample_id)
            else:
                raise
    report_id = datetime.now(timezone.utc).strftime("batch_%Y%m%dT%H%M%S%fZ")
    report_dir = OUTPUTS / report_id
    report_dir.mkdir(parents=True, exist_ok=False)
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "category": str(body.get("category", "upper_body")), "garmentCoverage": garment_coverage,
        "garmentMode": garment_mode, "garmentMaskScore": garment_mask_score,
        "requested": len(sample_ids), "completed": len(items), "failed": len(errors), "skipped": len(skipped),
        "minimumConfidence": minimum_confidence, "items": items, "errors": errors, "skippedItems": skipped,
        "performance": {
            "totalDurationSeconds": round(sum(item.get("durationSeconds", 0) for item in items), 3),
            "averageDurationSeconds": round(sum(item.get("durationSeconds", 0) for item in items) / max(1, len(items)), 3),
            "peakVramMb": max((item.get("peakVramMb", 0) for item in items), default=0),
        },
    }
    (report_dir / "batch-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    update_job(job_id, status="completed", stage="done", report=str((report_dir / "batch-report.json").relative_to(ROOT)), current=len(sample_ids), total=len(sample_ids), _event={"type":"job.completed", "message":f"Hoàn tất {len(items)}/{len(sample_ids)} ảnh"})
    return {"ok": True, "report": str((report_dir / "batch-report.json").relative_to(ROOT)), **report}


def resume_job(body: dict) -> dict:
    job_id = str(body.get("jobId", ""))[:80]
    safe_job_id = "".join(character for character in job_id if character.isalnum() or character in "-_")
    request_file = JOBS_DIR / f"{safe_job_id}.request.json"
    if not safe_job_id or not request_file.exists():
        raise ValueError("Tác vụ không có điểm kiểm tra để tiếp tục")
    request = json.loads(request_file.read_text(encoding="utf-8"))
    request.update(jobId=job_id, resume=True)
    task_type = str(request.get("taskType") or "batch-tryon")
    if task_type == "character":
        from character import run
        update_job(job_id, cancelRequested=False, status="running", error=None, results=[])
        return run(request, globals())
    if task_type == "makeup":
        if request.get("comparisonStyles"):
            from makeup_comparison import run
        else:
            from makeup import run
        update_job(job_id, cancelRequested=False, status="running", error=None, results=[])
        return run(request, globals())
    if task_type == "enhance":
        from image_enhancement import enhance
        update_job(job_id, cancelRequested=False, status="running", error=None, results=[])
        return enhance(request, globals())
    if task_type == "outpaint":
        update_job(job_id, cancelRequested=False, status="running", error=None)
        return outpaint(request)
    if task_type == "inpaint":
        # Diffusion schedulers cannot safely resume from an arbitrary latent step.
        # Replay the saved request with the same seed instead.
        update_job(job_id, cancelRequested=False, status="running", stage="inpaint-validating",
                   resumable=True, error=None,
                   _event={"type":"job.resumed", "message":"Đang chạy lại Inpainting từ đầu với cùng cấu hình và seed"})
        return inpaint(request)
    update_job(job_id, cancelRequested=False, status="running", error=None)
    return batch_tryon(request)


def benchmark(body: dict) -> dict:
    if not body.get("garmentImage"):
        raise ValueError("Benchmark cần ảnh trang phục tham chiếu")
    sample_ids = sorted(str(path.relative_to(SAMPLES)).replace("\\", "/") for path in SAMPLES.rglob("*") if path.suffix.lower() in (".png", ".jpg", ".jpeg"))
    active_file = ROOT / "workspace" / "review" / "active-score-weights.json"
    proposed_file = ROOT / "workspace" / "review" / "score-weights.json"
    weights_file = active_file if active_file.exists() else proposed_file
    calibrated_weights = {}
    if weights_file.exists():
        try:
            calibrated_weights = json.loads(weights_file.read_text(encoding="utf-8")).get("weights", {})
        except Exception:
            calibrated_weights = {}
    fixed = {
        **body, "benchmark": True, "sampleIds": sample_ids, "count": 2, "steps": 35,
        "guidance": 2.5, "maxSide": 960, "twoStage": True, "previewSteps": 10,
        "maxRetries": 1, "repairSeams": True, "generativeRefine": True,
        "usePose": True, "cropPerson": True, "onlyConfident": False,
        "onlyQualityPassed": False, "minimumQuality": 75, "minimumSimilarity": 0.55,
        "minimumSeam": 65, "minimumAnatomy": 90,
        "scoreWeights": calibrated_weights,
    }
    result = batch_tryon(fixed)
    result["benchmarkConfig"] = {key: fixed[key] for key in ("count", "steps", "guidance", "maxSide", "twoStage", "previewSteps", "maxRetries")}
    report_path = ROOT / result["report"]
    if report_path.exists():
        saved_report = json.loads(report_path.read_text(encoding="utf-8"))
        saved_report.update(benchmark=True, benchmarkConfig=result["benchmarkConfig"], benchmarkProvenance=body.get("benchmarkProvenance", {}))
        report_path.write_text(json.dumps(saved_report, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


INPAINT_TARGETS = {
    "outfit": "",
    "shirt": "",
    "pants": "",
    "glasses": "",
    "hat": "",
    "jewelry": "",
    "bag": "",
    "shoes": "",
    "custom": "",
}



def resolved_inpaint_profile(entry: dict | None, architecture: str) -> dict:
    profiles = read_catalog()["runtimePresets"]["inpaintProfiles"]
    profile = dict(profiles.get(architecture, profiles["sdxl"]))
    if entry:
        profile.update(read_catalog()["runtimePresets"]["modelInpaintProfiles"].get(entry.get("id"), {}))
    profile["contentStyle"] = str((entry or {}).get("contentStyle") or "general")
    profile["modelId"] = str((entry or {}).get("id") or "default")
    return profile


def build_inpaint_negative_prompt(removal_target: str, fill_mode: str, corrective: bool = False, extra: str = "") -> str:
    """Build a non-conflicting, target-aware list of forbidden outcomes."""
    common = [prompt_text('build_inpaint_negative_prompt.original_object'), prompt_text('build_inpaint_negative_prompt.replacement_object'), prompt_text('build_inpaint_negative_prompt.duplicate_object'), prompt_text('build_inpaint_negative_prompt.visible_inpaint_boundary'), prompt_text('build_inpaint_negative_prompt.abrupt_color_transition'), prompt_text('build_inpaint_negative_prompt.deformed_anatomy'), prompt_text('build_inpaint_negative_prompt.extra_limb'), prompt_text('build_inpaint_negative_prompt.changed_face'), prompt_text('build_inpaint_negative_prompt.blur'), prompt_text('build_inpaint_negative_prompt.artifacts')]
    target_terms = {
        "outfit": [prompt_text('build_inpaint_negative_prompt.outfit'),],
        "shirt": [prompt_text('build_inpaint_negative_prompt.shirt')],
        "pants": [prompt_text('build_inpaint_negative_prompt.pants'), prompt_text('build_inpaint_negative_prompt.trousers')],
        "glasses": [prompt_text('build_inpaint_negative_prompt.glasses')], 
        "hat": [prompt_text('build_inpaint_negative_prompt.hat')],
        "jewelry": [prompt_text('build_inpaint_negative_prompt.jewelry')], 
        "bag": [prompt_text('build_inpaint_negative_prompt.bag'), prompt_text('build_inpaint_negative_prompt.handbag')],
        "shoes": [prompt_text('build_inpaint_negative_prompt.shoes'), prompt_text('build_inpaint_negative_prompt.footwear')], 
        "custom": [prompt_text('build_inpaint_negative_prompt.selected_object')],
    }
    replacement_terms = [prompt_text('build_inpaint_negative_prompt.replacement_garment'), prompt_text('build_inpaint_negative_prompt.new_garment'), prompt_text('build_inpaint_negative_prompt.duplicate_clothing'), prompt_text('build_inpaint_negative_prompt.layered_clothing'), prompt_text('build_inpaint_negative_prompt.transparent_clothing'), prompt_text('build_inpaint_negative_prompt.torn_clothing')]
    if fill_mode == "base_layer":
        common.remove(prompt_text('build_inpaint_negative_prompt.replacement_object'))
        replacement_terms = [prompt_text('build_inpaint_negative_prompt.duplicate_clothing'), prompt_text('build_inpaint_negative_prompt.layered_clothing'), prompt_text('build_inpaint_negative_prompt.transparent_clothing'), prompt_text('build_inpaint_negative_prompt.torn_clothing')]
        target_terms = {key: [prompt_template("remainingOriginal", term=term) for term in terms] for key, terms in target_terms.items()}
    if removal_target in (prompt_text('build_inpaint_negative_prompt.outfit'), prompt_text('build_inpaint_negative_prompt.shirt'), prompt_text('build_inpaint_negative_prompt.pants')):
        if fill_mode != "reconstruct_body":
            common.extend(replacement_terms)
        if fill_mode == "background":
            common.extend([prompt_text('build_inpaint_negative_prompt.person_in_the_cleared_region'), prompt_text('build_inpaint_negative_prompt.body_in_the_cleared_region'), prompt_text('build_inpaint_negative_prompt.clothing_in_the_cleared_region')])
        # base_layer intentionally does not ban generic clothing/base layers.
    values = common + target_terms.get(removal_target, target_terms["custom"])
    if corrective:
        values += [prompt_text('build_inpaint_negative_prompt.any_remaining_collar'), prompt_text('build_inpaint_negative_prompt.any_remaining_button'), prompt_text('build_inpaint_negative_prompt.any_remaining_cuff'), prompt_text('build_inpaint_negative_prompt.any_remaining_sleeve'), prompt_text('build_inpaint_negative_prompt.recreated_original_color'), prompt_text('build_inpaint_negative_prompt.recreated_original_texture'), prompt_text('build_inpaint_negative_prompt.recreated_original_silhouette')]
    values += [item.strip() for item in str(extra or "").split(",") if item.strip()]
    unique = []
    for value in values:
        if value.lower() not in {item.lower() for item in unique}:
            unique.append(value)
    return ", ".join(unique)


def build_inpaint_instruction(removal_target: str, fill_mode: str, architecture: str, user_prompt: str = "", prompt_mode: str = "", forbidden_replacement: str = "") -> tuple[str, str]:
    """Create a target-aware instruction and keep FLUX exclusions in its positive prompt."""
    target = removal_target if removal_target in INPAINT_TARGETS else "custom"
    mode = fill_mode if fill_mode in ('base_layer', 'reconstruct_body', 'background') else "reconstruct_body"
    subject = INPAINT_TARGETS[target]
    if mode in ('base_layer', 'reconstruct_body', 'background'):
        from processing_mode_prompts import processing_mode_prompt
        replacement = processing_mode_prompt(ROOT, mode).strip()
        removal = user_prompt.strip() or prompt_template("removeObject", subject=subject or prompt_template("selectedTarget", target=target.replace("_", " ")))
        preserve = prompt_text('build_inpaint_instruction.strict_inpainting_mode_modify_only_the_area')
        prompt = ' '.join(dict.fromkeys(part for part in (removal, replacement, preserve) if part))
        negative = ', '.join(dict.fromkeys(term.strip() for term in (prompt_text('build_inpaint_instruction.object_remnants'), prompt_text('build_inpaint_instruction.duplicate_objects'), prompt_text('build_inpaint_instruction.visible_seams'), prompt_text('build_inpaint_instruction.color_mismatch'), prompt_text('build_inpaint_negative_prompt.blur'), prompt_text('build_inpaint_negative_prompt.artifacts'), forbidden_replacement if mode != "reconstruct_body" else "") if term.strip()))
        return prompt, negative


def resolve_inpaint_prompts(body: dict, architecture: str = "", profile: dict | None = None) -> dict:
    if body.get("processingMode") == "outfit-description":
        description = str(body.get("prompt") or "").strip()
        if not description:
            raise ValueError("Hãy nhập mô tả trang phục hoặc phụ kiện mới")
        prompt = task_prompt("outfit-description", description=description)
        negative = str(body.get("negativePrompt") or "").strip()
        confirmed = body.get("confirmedPrompts")
        if confirmed is not None:
            if not isinstance(confirmed, dict) or not isinstance(confirmed.get("prompt"), str) or not confirmed["prompt"].strip() or not isinstance(confirmed.get("negativePrompt"), str):
                raise ValueError("Prompt xác nhận không hợp lệ")
            prompt, negative = confirmed["prompt"].strip(), confirmed["negativePrompt"].strip()
        return {"prompt": prompt, "negativePrompt": negative, "generatedNegativePrompt": negative}
    target = str(body.get("removalTarget") or "custom").lower()
    mode = str(body.get("fillMode") or ("reconstruct_body" if target in ("outfit", "shirt", "pants") else "background")).lower()
    forbidden = str(body.get("forbiddenReplacement") or "")
    prompt, generated = build_inpaint_instruction(target, mode, architecture, str(body.get("prompt") or ""), str((profile or {}).get("promptMode") or ""), forbidden)
    negative = build_inpaint_negative_prompt(target, mode, False, ', '.join(filter(None, [forbidden, str(body.get("negativePrompt") or "")]))) or generated
    if mode in ("background", "base_layer", "reconstruct_body"):
        negative = ', '.join(dict.fromkeys(term.strip().lower() for term in (generated + ',' + str(body.get("negativePrompt") or "")).split(',') if term.strip()))
    confirmed = body.get("confirmedPrompts")
    if confirmed is not None:
        if not isinstance(confirmed, dict) or not isinstance(confirmed.get("prompt"), str) or not confirmed["prompt"].strip() or not isinstance(confirmed.get("negativePrompt"), str):
            raise ValueError("Prompt xác nhận không hợp lệ")
        prompt, negative = confirmed["prompt"].strip(), confirmed["negativePrompt"].strip()
    return {"prompt": prompt, "negativePrompt": negative, "generatedNegativePrompt": generated}


def inpaint_removal_check(source: Image.Image, result: Image.Image, mask: Image.Image, removal_target: str) -> dict:
    """Pixel change is diagnostic only; it cannot certify object removal."""
    from object_removal import visual_change
    return visual_change(source, result, mask)


def semantic_inpaint_residual_check(result: Image.Image, mask: Image.Image, removal_target: str, fill_mode: str, object_label: str = "") -> dict:
    """Return explicit unavailable state; callers must not interpret it as a pass."""
    class_map = {
        "outfit": [prompt_text('detection.outfit.default.collared_outfit'), prompt_text('detection.outfit.default.buttoned_clothing'), prompt_text('detection.outfit.default.long_sleeved_garment')],
        "shirt": ([prompt_text('detection.shirt.base_layer.collared_shirt'), prompt_text('detection.shirt.base_layer.button-down_shirt'), prompt_text('detection.shirt.base_layer.blouse_with_sleeves')] if fill_mode == "base_layer" else [prompt_text('detection.shirt.default.shirt'), prompt_text('detection.shirt.default.blouse'), prompt_text('detection.shirt.default.top')]),
        "pants": [prompt_text('detection.pants.default.pants'), prompt_text('detection.pants.default.trousers'), prompt_text('detection.pants.default.skirt')], "glasses": [prompt_text('detection.glasses.default.glasses')], "hat": [prompt_text('detection.hat.default.hat')],
        "jewelry": [prompt_text('detection.jewelry.default.necklace'), prompt_text('detection.jewelry.default.jewelry')], "bag": [prompt_text('detection.bag.default.handbag'), prompt_text('detection.bag.default.bag')], "shoes": [prompt_text('detection.shoes.default.shoes'), prompt_text('detection.shoes.default.footwear')],
    }
    classes = class_map.get(removal_target) or [term.strip()[:80] for term in object_label.split(",") if term.strip()][:8]
    checkpoint = next(iter(YOLO_WORLD_ROOT.rglob("yolov8x-worldv2.pt")), None) if YOLO_WORLD_ROOT.exists() else None
    clip_file = ROOT / "weights" / "clip" / "ViT-B-32.pt"
    if not classes or checkpoint is None or not clip_file.is_file():
        return {"available": False, "detected": False, "method": "yolo-world-cpu", "reason": "detector-unavailable"}
    try:
        model = _detector("yolo-world")
        model.set_classes(classes)
        selected = np.asarray(mask.convert("L"), dtype=np.uint8) > 16
        box = mask.getbbox()
        if box is None:
            return {"available": False, "detected": False, "method": "yolo-world-cpu", "reason": "empty-mask"}
        xoff, yoff = max(0, box[0]-96), max(0, box[1]-96)
        crop = result.crop((xoff, yoff, min(result.width, box[2]+96), min(result.height, box[3]+96)))
        prediction = model.predict(np.asarray(crop)[:, :, ::-1].copy(), conf=0.24, verbose=False, device="cpu")[0]
        matches = []
        if prediction.boxes is not None:
            for box in prediction.boxes:
                x0, y0, x1, y1 = [max(0, int(round(value))) for value in box.xyxy[0].detach().cpu().tolist()]
                x0, x1, y0, y1 = x0+xoff, x1+xoff, y0+yoff, y1+yoff
                x1, y1 = min(result.width, x1), min(result.height, y1)
                if x1 <= x0 or y1 <= y0:
                    continue
                overlap = float(selected[y0:y1, x0:x1].sum() / max(1, min(selected.sum(), (x1-x0)*(y1-y0))))
                if overlap >= 0.18:
                    class_id = int(box.cls[0].item())
                    matches.append({"label": str(prediction.names.get(class_id, class_id)), "confidence": round(float(box.conf[0].item()), 4), "maskOverlap": round(overlap, 4)})
        return {"available": True, "detected": bool(matches), "method": "yolo-world-cpu", "matches": matches}
    except Exception as error:
        return {"available": False, "detected": False, "method": "yolo-world-cpu", "reason": str(error)[:240]}


def outpaint_semantics(source, manual=None):
    """Conservative labels: separate SAM clothing, BiRefNet background and identity."""
    foreground = None
    garment = np.zeros((source.height,source.width),dtype=np.uint8)
    protected = np.zeros_like(garment)
    warnings = []
    try:
        foreground = birefnet_mask(source)
    except Exception as error:
        warnings.append("Không tách được nền: "+str(error)[:160])
    try:
        people = detect_people_pose(source)
    except Exception as error:
        people = []
        warnings.append("Không xác định được vùng bảo vệ tự động: "+str(error)[:160])
    for person in people:
        box, points = person['box'], person.get('keypoints')
        protected = np.maximum(protected,np.asarray(automatic_protected_detail_mask(source,box,points)))
    if foreground is None:
        # Unknown foreground: disable background editing rather than guessing.
        foreground = Image.new('L',source.size,255)
        warnings.append("Không có mask nền; bỏ qua sửa nền")
    if not people:
        protected = np.maximum(protected,np.asarray(foreground))
        warnings.append("Không có vùng bảo vệ khuôn mặt đáng tin cậy; chỉ sửa nền")
    protected[np.asarray(foreground)<16]=0
    # Protect visible skin as well as detected head/hair and hands.
    rgb=np.asarray(source.convert('RGB'))
    skin=cv2.inRange(cv2.cvtColor(rgb,cv2.COLOR_RGB2YCrCb),np.array([0,133,77],dtype=np.uint8),np.array([255,173,127],dtype=np.uint8))
    warm=(rgb[:,:,0].astype(np.int16)>rgb[:,:,1].astype(np.int16)+5)&(rgb[:,:,1].astype(np.int16)>rgb[:,:,2].astype(np.int16)+2)
    skin[~warm]=0
    skin[np.asarray(foreground)<16]=0
    protected=np.maximum(protected,skin)
    if manual is not None: protected=np.maximum(protected,np.asarray(manual.convert('L')))
    if people:
        try:
            model=load_predictor()
            with torch.inference_mode(),torch.autocast(device_type=device,dtype=torch.bfloat16,enabled=device=='cuda'):
                model.set_image(rgb.copy())
                for person in people:
                    x0,y0,x1,y1=person['box']
                    # A portrait may cut through clothing at the image boundary.
                    # Do not clip segmentation to the 96% body box used by try-on.
                    x0=0 if x0<source.width*.04 else x0
                    y0=0 if y0<source.height*.04 else y0
                    x1=source.width if x1>source.width*.96 else x1
                    y1=source.height if y1>source.height*.96 else y1
                    valid=(np.asarray(foreground)>223)&(protected==0)
                    allowed=np.zeros_like(valid);allowed[int(y0):int(y1),int(x0):int(x1)]=True
                    valid &= allowed
                    distance=cv2.distanceTransform(valid.astype(np.uint8),cv2.DIST_L2,5)
                    coords=[]
                    for _ in range(3):
                        _,maximum,_,point=cv2.minMaxLoc(distance)
                        if maximum<3: break
                        coords.append(point)
                        cv2.circle(distance,point,max(16,round(min(source.size)*.15)),0,-1)
                    if not coords: continue
                    proposals,scores,_=model.predict(point_coords=np.asarray(coords,dtype=np.float32),
                        point_labels=np.ones(len(coords),dtype=np.int32),box=np.asarray([x0,y0,x1,y1],dtype=np.float32),multimask_output=True)
                    proposals=np.asarray(proposals)>0
                    coverage=np.array([(proposal&valid).sum()/max(1,valid.sum()) for proposal in proposals])
                    best=int(np.argmax(scores+coverage))
                    if scores[best]<.5 or coverage[best]<.2:
                        warnings.append('Mask trang phục thiếu độ tin cậy; bỏ qua vùng này')
                        continue
                    garment=np.maximum(garment,np.uint8(proposals[best]&valid)*255)
        except Exception as error:
            warnings.append('Không tách được trang phục: '+str(error)[:160])
    garment[protected>0]=0
    return foreground,Image.fromarray(garment),Image.fromarray(protected),warnings


@trace_generation
def outpaint(body: dict) -> dict:
    from outpainting import (prepare_canvas, prepare_inference, composite_canvas, integer, detail_regions,
                            PatchAccumulator, seam_band, semantic_seam_masks, repair_regions,
                            multiband_background, restore_source_core, seam_metrics, feather_seam_result,
                            preserve_fabric_texture, equalize_background_seams,
                            material_detail_masks, finish_materials, background_reference_mask)
    from outpaint_quality import (choose_refinement, exclude_source, tile_mask, load_layout,
                                  source_fingerprint, PromptEmbeddingCache)
    from PIL import ImageOps
    started = time.perf_counter()
    job_id = str(body.get("jobId", ""))[:80]
    source = ImageOps.exif_transpose(Image.open(safe_sample(str(body.get("sampleId", ""))))).convert("RGB")
    canvas_image, mask, geometry = prepare_canvas(source, body)
    run_mode = body.get('runMode', 'complete')
    if run_mode not in ('complete', 'layout', 'refine'):
        raise ValueError('Chế độ mở rộng ảnh không hợp lệ.')
    saved_layout = None
    if run_mode == 'refine':
        saved_layout, layout_metadata = load_layout(ROOT, OUTPUTS, body.get('refineFrom'),
                                                    str(body.get('sampleId', '')), source, geometry)
    count = integer(body.get("count", 1), "Số phương án", 1, 4)
    steps = integer(body.get("steps", 30), "Số bước", 4, 80)
    seed = integer(body.get("seed", 42), "Seed", 0, 2147483647)
    if saved_layout is not None:
        count, seed = 1, integer(body['refineFrom']['seed'], 'Seed', 0, 2147483647)
    if seed + count - 1 > 2147483647:
        raise ValueError('Seed cuối vượt giới hạn; hãy giảm seed hoặc số phương án.')
    max_side = integer(body.get("maxSide", 768), "Độ phân giải AI", 512, 1024)
    guidance = float(body.get("guidance", 5))
    if not np.isfinite(guidance) or not 1 <= guidance <= 30:
        raise ValueError("Guidance phải từ 1 đến 30")
    user_prompt = str(body.get("prompt") or "").strip()
    user_negative = str(body.get("negativePrompt") or "").strip()
    if max(len(user_prompt), len(user_negative)) > 16000:
        raise ValueError("Mô tả quá dài; tối đa 16000 ký tự")
    prompt = " ".join(filter(None, [task_prompt("outpaint"), user_prompt]))
    negative = ", ".join(filter(None, [task_prompt("outpaint", "negative"), user_negative]))
    model_id = str(body.get("modelId") or "")
    entry = inpaint_model_entry(model_id or None)
    model_path = Path(str(entry["path"])) if entry else INPAINT_MODEL
    if not model_path.is_absolute():
        model_path = ROOT / model_path
    architecture = detect_inpaint_architecture(model_path, entry.get("architecture") if entry else None)
    if architecture not in ("sd3", "sd35", "sdxl", "sd15", "sd2", "flux"):
        raise ValueError("Model chưa hỗ trợ Outpainting")
    if architecture=='flux':
        from prompt_limits import split_flux_prompts
    profile = resolved_inpaint_profile(entry, architecture)
    if "steps" not in body:
        steps = 50 if architecture == "flux" else 30
    if "guidance" not in body:
        guidance = 30.0 if architecture == "flux" else 5.0
    if "maxSide" not in body and architecture == "flux":
        max_side = 1024
    max_side = min(max_side, int(profile.get("nativeResolution", 1024)))
    detail = body.get("detailPass", False)
    if not isinstance(detail, bool):
        raise ValueError("Chế độ tăng chi tiết không hợp lệ")
    material_refine=body.get('materialRefine',False)
    source_enhance=body.get('sourceEnhance',False)
    background_continuity=body.get('backgroundContinuity',False)
    if not isinstance(background_continuity,bool):
        raise ValueError('Chế độ đồng bộ nền không hợp lệ')
    if background_continuity and not geometry['preserveOriginal']:
        raise ValueError('Bật Giữ nguyên ảnh gốc để đồng bộ nền hẹp')
    if not isinstance(material_refine,bool) or not isinstance(source_enhance,bool):
        raise ValueError('Chế độ hoàn thiện chất liệu không hợp lệ')
    if source_enhance and geometry['preserveOriginal']:
        raise ValueError('Tắt Giữ nguyên ảnh gốc trước khi bật Hoàn thiện ảnh gốc')
    material_refine=material_refine and detail
    fabric_steps=integer(body.get('fabricSteps',40),'Số bước phục hồi vải',10,60)
    fabric_strength=.45
    effective_fabric_steps=max(1,fabric_steps-int(fabric_steps*(1-fabric_strength))
                               if architecture=='flux' else int(fabric_steps*fabric_strength))
    detail_steps = integer(body.get("detailSteps", 20), "Số bước tăng chi tiết", 4, 50)
    detail_strength = .35
    effective_detail_steps = max(1, detail_steps - int(detail_steps * (1 - detail_strength))
                                 if architecture == "flux" else int(detail_steps * detail_strength))
    seam = body.get('seamRepair',False)
    if not isinstance(seam,bool): raise ValueError('Chế độ sửa đường nối không hợp lệ')
    if run_mode == 'layout':
        detail = material_refine = source_enhance = seam = False
    seam_width = integer(body.get('seamWidth',48),'Dải sửa đường nối',8,128)
    requested_seam_width=seam_width
    seam_width=min(seam_width,max(1,source.width//4) if geometry['left'] or geometry['right'] else seam_width,
                   max(1,source.height//4) if geometry['top'] or geometry['bottom'] else seam_width)
    seam_steps = integer(body.get('seamSteps',40),'Số bước sửa đường nối',4,80)
    seam_strength = .4
    effective_seam_steps = max(1,seam_steps-int(seam_steps*(1-seam_strength))
                               if architecture=='flux' else int(seam_steps*seam_strength))
    protected = Image.new('L',source.size,0)
    manual = decode_mask(str(body['protectedDetailMask']),source.size) if body.get('protectedDetailMask') and (seam or source_enhance or material_refine) else None
    if manual is not None: protected=manual.copy()
    semantic_warnings, semantic_masks, seam_work = [], {}, []
    foreground = garment = None
    if seam or source_enhance:
        foreground,garment,protected,semantic_warnings = outpaint_semantics(source,manual)
    if background_continuity and foreground is None:
        foreground=birefnet_mask(source)
    if seam:
        semantic_masks = semantic_seam_masks(geometry,seam_width,foreground,garment,protected)
        seam_work = [(kind,box,region_mask) for kind,region_mask in semantic_masks.items()
                     for box in repair_regions(region_mask,max_side)]
    layout_steps = 0 if saved_layout is not None else steps
    regions = []
    variant_steps = layout_steps + len(seam_work)*effective_seam_steps
    # Reserve an upper bound until generated-image labels reveal the real work.
    estimated_tiles=(int(np.ceil(max(0,geometry['width']-max_side)/max(1,max_side*3//4)))+1)*(
                     int(np.ceil(max(0,geometry['height']-max_side)/max(1,max_side*3//4)))+1)
    estimated_variant_steps=variant_steps+estimated_tiles*((effective_detail_steps if detail else 0)+
                                                          (effective_fabric_steps if material_refine else 0))
    variant_steps=estimated_variant_steps
    model_image, model_mask, model_crop = prepare_inference(canvas_image, mask, max_side)
    width, height = model_image.size
    request_file = persist_job_request(job_id, "outpaint", body)
    update_job(job_id, status="running", taskType="outpaint", stage="inpaint-validating",
               sourceId=str(body.get("sampleId", "")), width=geometry["width"], height=geometry["height"],
               totalVariants=count, totalWorkSteps=count * variant_steps, modelId=model_id,
               warnings=semantic_warnings,
               seamRepair=seam,detailPass=detail,materialRefine=material_refine,sourceEnhance=source_enhance,
               model=entry.get("name") if entry else "Default", resumable=bool(request_file),
               requestFile=str(request_file.relative_to(ROOT)) if request_file else None,
               _event={"type":"outpaint.started", "message":"Đang chuẩn bị khung mở rộng ảnh"})
    ensure_job_active(job_id)
    if inpaint_pipe is not None and (getattr(inpaint_pipe, "_atelier_model_path", None) != str(model_path.resolve()) or getattr(inpaint_pipe, "_atelier_architecture", None) != architecture):
        release_inpaint()
    def report(phase, message):
        ensure_job_active(job_id)
        update_job(job_id, stage="inpaint-model-loading", _event={"type":"model.loading", "message":message})
    try:
        pipe = load_inpaint_pipe(report, model_path, architecture)
    except Exception as error:
        if "out of memory" in str(error).lower():
            release_inpaint()
            raise ValueError("GPU hết bộ nhớ khi nạp model. Hãy chọn model nhỏ hơn hoặc đóng ứng dụng đang dùng GPU.") from error
        raise
    pipe._atelier_model_path = str(model_path.resolve())
    pipe._atelier_architecture = architecture
    embedding_cache = PromptEmbeddingCache(pipe)
    supports_negative = bool(profile.get("supportsNegativePrompt", architecture != "flux"))
    if not supports_negative and negative:
        prompt += " " + prompt_template("correctiveExclusions", negative=negative)
    stage_prompts = {}
    requested_stages = []
    if body.get('seamRepair', False): requested_stages += ['outpaint.seam.background', 'outpaint.seam.garment']
    if body.get('detailPass', False): requested_stages += ['outpaint.detail']
    if body.get('detailPass', False) and body.get('materialRefine', False): requested_stages += ['outpaint.material']
    for key in requested_stages:
        text = ' '.join(filter(None, [task_prompt(key), user_prompt]))
        if not supports_negative and negative:
            text += ' ' + prompt_template('correctiveExclusions', negative=negative)
        stage_prompts[key] = text
    # Validate all requested passes before generating a layout, including the
    # later finish of a layout-only request. Never silently discard user text.
    from prompt_limits import validate_prompt_limits
    for key, text in {'outpaint': prompt, **stage_prompts}.items():
        inputs = {'prompt': text}
        if supports_negative: inputs['negative_prompt'] = negative
        elif architecture == 'flux': inputs.update(split_flux_prompts(pipe, text)[0])
        else: inputs['prompt_2'] = text
        try:
            validate_prompt_limits(pipe, inputs)
        except ValueError as error:
            raise ValueError(f'Hướng dẫn bước {key} quá dài: {error}') from error
    ensure_job_active(job_id)
    run_dir = OUTPUTS / ("outpaint_" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    run_dir.mkdir(parents=True, exist_ok=False)
    canvas_image.save(run_dir / "source_canvas.png")
    mask.save(run_dir / "generation_mask.png")
    if seam or source_enhance:
        foreground.save(run_dir/'foreground_mask.png');garment.save(run_dir/'garment_mask.png')
        protected.save(run_dir/'protected_mask.png')
        for kind,region_mask in semantic_masks.items(): region_mask.save(run_dir/f'seam_{kind}_mask.png')
    metadata = dict(schemaVersion=2, taskType="outpaint", source=str(body.get("sampleId")),
                    sourceFingerprint=source_fingerprint(source),runMode=run_mode,
                    refineFrom=body.get('refineFrom') if saved_layout is not None else None,
                    request={k:v for k,v in body.items() if k not in ('jobId','refineFrom','runMode')},
                    qualityPolicy='conservative-regression-guards-v1',
                    inferenceGeometry='rectangular-pixel-budget',
                    memoryMode=getattr(pipe,'_atelier_offload','model'),
                    createdAt=datetime.now(timezone.utc).isoformat(), geometry=geometry,
                    prompt=prompt, negativePrompt=negative, userPrompt=user_prompt,
                    modelId=model_id, model=str(model_path), architecture=architecture,
                    modelWidth=width, modelHeight=height, modelCrop=list(model_crop), seed=seed, count=count, steps=steps,
                    guidance=guidance, strength=1.0, negativePromptApplied=supports_negative,
                    detailPass=detail, detailSteps=detail_steps, detailStrength=detail_strength,
                    materialRefine=material_refine,sourceEnhance=source_enhance,
                    fabricSteps=fabric_steps,fabricStrength=fabric_strength,
                    effectiveFabricSteps=effective_fabric_steps,materialVariants=[],
                    effectiveDetailSteps=effective_detail_steps, detailRegions=[list(box) for box in regions],
                    seamRepair=seam,seamWidth=seam_width,requestedSeamWidth=requested_seam_width,
                    seamSteps=seam_steps,seamStrength=seam_strength,
                    semanticWarnings=semantic_warnings,patchCompositing='immutable-base-normalized-weights',
                    seamBlend='multiband-background-and-feathered-semantic-band',
                    garmentTexture='single-patch-detail-donor-and-original-source-frequencies',
                    seamRegions=[{'kind':kind,'box':list(box)} for kind,box,_ in seam_work],
                    compositing="semantic-seam-multiband-and-protected-core" if seam else "source-paste-with-additive-edge-colour-match",
                    results=[], status="running")
    metadata_path = run_dir / "metadata.json"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    results = []
    completed_work=0
    try:
        for index in range(count):
            ensure_job_active(job_id)
            variant_steps=estimated_variant_steps
            run_seed = seed + index
            quality_checks = []
            variant_protected = protected.copy()
            update_job(job_id, stage="inpaint-generating", currentVariant=index + 1,
                       currentStep=0, totalSteps=variant_steps, completedSteps=completed_work, seed=run_seed)
            pass_offset, pass_steps = 0, steps
            def on_step(pipeline, step_index, timestep, callback_kwargs):
                ensure_job_active(job_id)
                done = pass_offset + min(pass_steps, int(step_index) + 1)
                update_job(job_id, currentStep=done, completedSteps=completed_work + done)
                return callback_kwargs
            kwargs = dict(prompt=prompt, image=model_image, mask_image=model_mask, width=width, height=height,
                          strength=1.0, num_inference_steps=steps, guidance_scale=guidance,
                          generator=torch.Generator(device="cpu").manual_seed(run_seed),
                          callback_on_step_end=on_step, callback_on_step_end_tensor_inputs=["latents"],
                          _prompt_cache=embedding_cache)
            if supports_negative:
                kwargs.update(negative_prompt=negative, padding_mask_crop=None)
            else:
                kwargs["prompt_2"] = prompt
                if architecture == "flux":
                    from prompt_limits import split_flux_prompts
                    text_inputs, _ = split_flux_prompts(pipe, prompt)
                    kwargs.update(text_inputs)
            if saved_layout is None:
                with torch.inference_mode():
                    generated = traced_pipeline_call(pipe, **kwargs).images[0]
                result = composite_canvas(source, generated.crop(model_crop), {**geometry,'preserveOriginal':True} if seam or run_mode=='layout' else geometry)
            else:
                result = saved_layout.copy()
                result.paste(source,(geometry['left'],geometry['top']))
            ensure_job_active(job_id)
            update_job(job_id, stage="outpaint-layout-ready")
            overview_metrics = seam_metrics(source,result,geometry,protected)
            result.save(run_dir / f"overview_seed_{run_seed}.png")
            protected_canvas = Image.new('L',result.size,0)
            protected_canvas.paste(protected,(geometry['left'],geometry['top']))
            def guarded(before, candidate, editable, phase, locked=None):
                chosen, check = choose_refinement(before,candidate,geometry,editable,
                                                  locked if locked is not None else protected_canvas,phase)
                quality_checks.append(check)
                if not check['accepted']:
                    labels={'seam':'sửa đường nối','background':'tăng chi tiết nền','garment':'phục hồi vải','finish':'hoàn thiện'}
                    warning=f"Giữ bản trước bước {labels.get(phase,phase)} vì phát hiện thay đổi bất lợi."
                    if warning not in semantic_warnings: semantic_warnings.append(warning)
                    update_job(job_id,warnings=semantic_warnings)
                return chosen
            def process_tiles(base, work, phase, offset, schedule_steps, strength, effective_steps):
                nonlocal pass_offset,pass_steps
                accumulator=PatchAccumulator(base)
                for region_index,(kind,box,region_mask) in enumerate(work):
                    ensure_job_active(job_id)
                    pass_offset,pass_steps=offset+region_index*effective_steps,effective_steps
                    update_job(job_id,stage=phase,detailRegion=region_index+1,totalDetailRegions=len(work),
                               _event={'type':'outpaint.seam' if phase=='outpaint-seam-repair' else 'outpaint.detail',
                                       'message':f"{'Sửa đường nối' if phase=='outpaint-seam-repair' else 'Tăng chi tiết'} {kind} · {region_index+1}/{len(work)}"})
                    local_mask=tile_mask(region_mask,box,base.size)
                    tile_image,inference_mask,tile_crop=prepare_inference(base.crop(box),local_mask,max_side)
                    prompt_key=('outpaint.seam.'+kind if phase=='outpaint-seam-repair' else
                                'outpaint.material' if phase=='outpaint-material-refine' else 'outpaint.detail')
                    tile_prompt=stage_prompts[prompt_key]
                    tile_kwargs=dict(kwargs,image=tile_image,mask_image=inference_mask,width=tile_image.width,height=tile_image.height,
                                     strength=strength,prompt=tile_prompt,num_inference_steps=schedule_steps,
                                     generator=torch.Generator(device='cpu').manual_seed(run_seed+offset*100+region_index))
                    if architecture=='flux': tile_kwargs.update(split_flux_prompts(pipe,tile_prompt)[0])
                    elif not supports_negative: tile_kwargs['prompt_2']=tile_prompt
                    with torch.inference_mode(): patch=traced_pipeline_call(pipe,**tile_kwargs).images[0]
                    ensure_job_active(job_id)
                    accumulator.add(patch.crop(tile_crop),box,local_mask,preserve_texture=kind=='garment')
                return accumulator.finish()
            seam_editable=Image.new('L',canvas_image.size,0)
            if seam_work:
                before_seam=result.copy()
                result=process_tiles(before_seam,seam_work,'outpaint-seam-repair',layout_steps,seam_steps,seam_strength,effective_seam_steps)
                result=multiband_background(before_seam,result,semantic_masks['background'])
                seam_editable=Image.fromarray(np.maximum(np.asarray(semantic_masks['background']),np.asarray(semantic_masks['garment'])))
                result=restore_source_core(source,result,geometry,seam_editable,protected,seam_width)
                result=feather_seam_result(before_seam,result,seam_editable,min(24,max(1,seam_width//2)))
                result=preserve_fabric_texture(source,before_seam,result,geometry,semantic_masks['garment'],protected)
                result=equalize_background_seams(result,geometry,semantic_masks['background'],max(4,seam_width-8),
                                                background_reference_mask(geometry,foreground,protected))
                result=guarded(before_seam,result,seam_editable,'seam')
                result.save(run_dir/f'seam_repaired_seed_{run_seed}.png')
            repaired_metrics=seam_metrics(source,result,geometry,protected,seam_editable if seam else None)
            if detail or material_refine or source_enhance:
                ensure_job_active(job_id)
                update_job(job_id,stage='outpaint-material-refine',
                           _event={'type':'outpaint.material-analysis','message':'Nhận diện vải, nền và vùng cần bảo vệ trên ảnh mới'})
                manual_canvas=Image.new('L',result.size,0)
                manual_canvas.paste(protected,(geometry['left'],geometry['top']))
                full_fg,full_garment,full_protected,variant_warnings=outpaint_semantics(result,manual_canvas)
                ensure_job_active(job_id)
                for warning in variant_warnings:
                    if warning not in semantic_warnings: semantic_warnings.append(warning)
                materials=material_detail_masks(geometry,full_fg,full_garment,full_protected)
                background_mask=exclude_source(materials['background'],geometry,seam_width if seam else 0)
                fabric_mask=materials['garment'] if material_refine else exclude_source(materials['garment'],geometry,seam_width if seam else 0)
                background_regions=detail_regions(background_mask,max_side,include_generated=True) if detail else []
                fabric_regions=detail_regions(fabric_mask,max_side,include_generated=True) if detail else []
                if material_refine and not fabric_regions:
                    warning='Không có vùng vải mới đủ tin cậy; bỏ qua phục hồi vải, vẫn xử lý nền nếu nhận diện được.'
                    if warning not in variant_warnings: variant_warnings.append(warning)
                    if warning not in semantic_warnings: semantic_warnings.append(warning)
                for kind,label in materials.items(): label.save(run_dir/f'material_{kind}_seed_{run_seed}.png')
                full_fg.save(run_dir/f'material_foreground_seed_{run_seed}.png')
                full_garment.save(run_dir/f'material_full_garment_seed_{run_seed}.png')
                full_protected.save(run_dir/f'material_protected_seed_{run_seed}.png')
                cloth_steps=fabric_steps if material_refine else detail_steps
                cloth_strength=fabric_strength if material_refine else detail_strength
                cloth_effective=effective_fabric_steps if material_refine else effective_detail_steps
                variant_steps=layout_steps+len(seam_work)*effective_seam_steps+len(background_regions)*effective_detail_steps+len(fabric_regions)*cloth_effective
                metadata['detailRegions']=[list(box) for box in background_regions]
                update_job(job_id,totalSteps=variant_steps,totalWorkSteps=completed_work+variant_steps+(count-index-1)*estimated_variant_steps,
                           warnings=semantic_warnings)
                if background_regions:
                    background_base=result.copy()
                    refined=process_tiles(background_base,[('background',box,background_mask) for box in background_regions],
                        'inpaint-texture-recovery',layout_steps+len(seam_work)*effective_seam_steps,
                        detail_steps,detail_strength,effective_detail_steps)
                    result=guarded(background_base,refined,background_mask,'background',full_protected)
                    result.save(run_dir/f'background_refined_seed_{run_seed}.png')
                if fabric_regions:
                    material_base=result.copy()
                    repaired=process_tiles(material_base,[('garment',box,fabric_mask) for box in fabric_regions],
                        'outpaint-material-refine' if material_refine else 'inpaint-texture-recovery',
                        layout_steps+len(seam_work)*effective_seam_steps+len(background_regions)*effective_detail_steps,
                        cloth_steps,cloth_strength,cloth_effective)
                    result=guarded(material_base,feather_seam_result(material_base,repaired,fabric_mask,4),
                                   fabric_mask,'garment',full_protected)
                source_box=(geometry['left'],geometry['top'],geometry['left']+source.width,geometry['top']+source.height)
                variant_protected=Image.fromarray(np.maximum(np.asarray(protected),np.asarray(full_protected.crop(source_box))))
                result.paste(Image.composite(source,result.crop(source_box),variant_protected.point(lambda value:255 if value else 0)),
                             (geometry['left'],geometry['top']))
                result.save(run_dir/f'before_finish_seed_{run_seed}.png')
                finish_base=result.copy()
                finished=finish_materials(result,full_fg,full_garment,full_protected,geometry,source_enhance)
                finishing_allowed=((np.asarray(full_fg)<32)|((np.asarray(full_fg)>223)&(np.asarray(full_garment)>127)))&(np.asarray(full_protected)==0)
                finishing_mask=Image.fromarray(np.uint8(finishing_allowed)*255)
                if not source_enhance: finishing_mask=exclude_source(finishing_mask,geometry)
                result=guarded(finish_base,finished,finishing_mask,'finish',full_protected)
                metadata['materialVariants'].append(dict(seed=run_seed,fabricRegions=[list(box) for box in fabric_regions],
                    backgroundRegions=[list(box) for box in background_regions],
                    warnings=variant_warnings,sourceEnhance=source_enhance))
            if seam:
                # Source pixels were restored once after seam repair. Detail masks
                # exclude the entire source and the repair strip, so no second blend.
                result.save(run_dir/f'detail_seed_{run_seed}.png')
            ensure_job_active(job_id)
            update_job(job_id, stage="inpaint-blending")
            continuity_info={'applied':False,'reason':'disabled'}
            if background_continuity and run_mode!='layout':
                from outpainting import continue_background_texture
                continued,continuity_info=continue_background_texture(source,result,geometry,foreground,birefnet_mask(result))
                if continuity_info['applied']:
                    continued.save(run_dir/f'background_continuity_candidate_seed_{run_seed}.png')
                    allowed_background=exclude_source(Image.new('L',result.size,255),geometry)
                    result=guarded(result,continued,allowed_background,'background')
                    if not quality_checks[-1]['accepted']:
                        continuity_info.update(applied=False,reason='quality-regression')
            region = result.crop((geometry["left"], geometry["top"], geometry["left"] + source.width, geometry["top"] + source.height))
            original_mae = float(np.abs(np.asarray(region, dtype=np.int16) - np.asarray(source, dtype=np.int16)).mean())
            filename = f"result_seed_{run_seed}.png"
            result.save(run_dir / filename)
            from outpaint_quality import final_seam_review
            final_review = final_seam_review(result, geometry)
            saved = dict(seed=run_seed, file=str((run_dir / filename).relative_to(ROOT)), originalRegionMAE=original_mae,
                         backgroundContinuity=continuity_info,
                         finalReview=final_review,
                         layoutOnly=run_mode=='layout',qualityChecks=quality_checks,
                         sourceEnhanced=source_enhance,materialRefined=material_refine,
                         diagnostics={'overview':overview_metrics,'seamRepaired':repaired_metrics,
                                      'final':seam_metrics(source,result,geometry,variant_protected,seam_editable if seam else None)})
            results.append({**saved, "image":encode_image(result)})
            completed_work+=variant_steps
            metadata["results"].append(saved)
            metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
            update_job(job_id, stage="inpaint-variant-complete", _result={"kind":"outpaint", "sampleId":str(body.get("sampleId")), **saved},
                       _event={"type":"variant.completed", "message":f"Đã mở rộng phương án {index + 1}/{count} · seed {run_seed}"})
        metadata["promptHistory"] = prompt_history()
        metadata['embeddingCache']={'hits':embedding_cache.hits,'misses':embedding_cache.misses}
        metadata["status"] = "completed"
        metadata["durationSeconds"] = round(time.perf_counter() - started, 3)
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        update_job(job_id, status="completed", stage="done", directory=str(run_dir.relative_to(ROOT)),
                   currentStep=variant_steps, totalSteps=variant_steps,
                   completedSteps=completed_work,totalWorkSteps=completed_work, durationSeconds=metadata["durationSeconds"],
                   _event={"type":"job.completed", "message":f"Đã tạo {count} phương án mở rộng ảnh"})
        return dict(ok=True, results=results, directory=str(run_dir.relative_to(ROOT)),
                    runMode=run_mode,request=metadata['request'],
                    width=geometry["width"], height=geometry["height"], geometry=geometry,
                    warnings=semantic_warnings,seamRegionCount=len(seam_work),
                    modelName=entry.get("name") if entry else "Default")
    except Exception as error:
        metadata.update(status="cancelled" if "hủy" in str(error).lower() else "failed", error=str(error))
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        if "out of memory" in str(error).lower():
            release_inpaint()
            raise ValueError("GPU hết bộ nhớ. Hãy giảm độ phân giải AI xuống 512 hoặc 640 px rồi thử lại.") from error
        raise


@trace_generation
def inpaint(body: dict) -> dict:
    from object_removal import (model_settings, removal_regions, prepare_region, restore_region,
                                blend_removal, assess_removal, boundary_metric, removal_rank)
    started_at = time.perf_counter()
    job_id = str(body.get("jobId", ""))[:80]
    request_file = persist_job_request(job_id, "inpaint", body)
    update_job(job_id, status="running", stage="inpaint-validating", taskType="inpaint", device=device,
               gpuMemoryMb=round(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)) if torch.cuda.is_available() else 0,
               resumable=bool(request_file), requestFile=str(request_file.relative_to(ROOT)) if request_file else None,
               _event={"type":"inpaint.started", "message":"Đang kiểm tra ảnh và mask"})
    ensure_job_active(job_id)
    source = ImageOps.exif_transpose(Image.open(safe_sample(str(body.get("sampleId", ""))))).convert("RGB")
    mask = decode_mask(str(body.get("editableMask", "")), source.size)
    protected = None
    protected_value = str(body.get("protectedDetailMask", ""))
    if protected_value:
        protected = decode_mask(protected_value, source.size)
        pixels = np.asarray(mask).copy()
        pixels[np.asarray(protected) > 16] = 0
        mask = Image.fromarray(pixels)
    if mask.getbbox() is None:
        raise ValueError("Mask đang trống; hãy chọn phụ kiện cần xóa")
    update_job(job_id, stage="inpaint-preparing-mask", sourceWidth=source.width, sourceHeight=source.height, _event={"type":"mask.preparing", "message":"Đang mở rộng và làm mềm vùng chỉnh sửa"})
    expand = max(0, min(64, int(body.get("expand", 24))))
    blur = max(0, min(32, int(body.get("blur", 16))))
    requested_mode = body.get("fillMode") or ("reconstruct_body" if body.get("removalTarget") in ("outfit", "shirt", "pants") else "background")
    composite_expand = body.get("compositeExpand")
    if composite_expand is None and requested_mode == "background" and body.get("processingMode") != "outfit-description":
        composite_expand = min(expand, blur)
    generation_mask, composite_mask, dual_mask_metrics = prepare_dual_inpaint_masks(
        mask, protected, expand, composite_expand
    )
    if generation_mask.getbbox() is None:
        raise ValueError("Vùng bảo vệ đang che toàn bộ mask chỉnh sửa")
    edge_feather = max(3, min(32, int(body.get("edgeFeather", max(6, blur)))))

    max_side = max(512, min(1024, int(body.get("maxSide", 768))))
    scale = min(max_side / max(source.size), 1.0)
    width = max(64, round(source.width * scale / 64) * 64)
    height = max(64, round(source.height * scale / 64) * 64)
    model_image = source.resize((width, height), Image.Resampling.LANCZOS)
    model_mask = generation_mask.resize((width, height), Image.Resampling.NEAREST)

    removal_target = str(body.get("removalTarget") or "custom").lower()
    fill_mode = str(body.get("fillMode") or ("reconstruct_body" if removal_target in ("outfit", "shirt", "pants") else "background")).lower()
    forbidden_replacement = str(body.get("forbiddenReplacement") or "")
    seed = int(body.get("seed", 42))
    count = max(1, min(4, int(body.get("count", 1))))
    strength = max(0.2, min(1.0, float(body.get("strength", 0.65))))
    step_policy = effective_step_policy(
        int(body.get("steps", 20)), strength, int(body.get("minimumEffectiveSteps", 12)),
        body.get("allowFastPreview", False) is True,
    )
    steps = step_policy["adjustedSteps"]
    guidance = float(body.get("guidance", 4.5))
    requested_crop_padding = max(0, min(256, int(body.get("cropPadding", 96))))
    crop_padding = adaptive_inpaint_context_padding(model_mask, requested_crop_padding, body.get("contextRatio", 0.30))
    selected_model_id = str(body.get("modelId") or "")
    selected_entry = inpaint_model_entry(selected_model_id or None)
    selected_model_path = INPAINT_MODEL if selected_entry is None else Path(str(selected_entry.get("path") or ""))
    if selected_entry is not None and not selected_model_path.is_absolute():
        selected_model_path = ROOT / selected_model_path
    selected_architecture = detect_inpaint_architecture(selected_model_path, selected_entry.get("architecture") if selected_entry else None)
    if selected_architecture not in ("sd3", "sd35", "sdxl", "sd15", "sd2", "flux"):
        raise ValueError(f"Kiến trúc inpainting chưa được hỗ trợ: {selected_architecture}")
    if inpaint_pipe is not None and (getattr(inpaint_pipe, "_atelier_model_path", None) != str(selected_model_path.resolve()) or getattr(inpaint_pipe, "_atelier_architecture", None) != selected_architecture):
        release_inpaint()
    model_was_loaded = inpaint_pipe is not None
    def report_model_load(phase, message):
        update_job(job_id, stage=f"inpaint-model-{phase}", modelLoaded=model_was_loaded or phase == "ready", _event={"type":f"model.{phase}", "message":message})
    architecture = selected_architecture
    profile = resolved_inpaint_profile(selected_entry, architecture)
    use_model_profile = body.get("useModelProfile", True) is not False
    settings = model_settings(body, profile if use_model_profile else {}, architecture)
    max_side, strength, guidance = settings["maxSide"], settings["strength"], settings["guidance"]
    step_policy = effective_step_policy(settings["steps"], strength, int(body.get("minimumEffectiveSteps", 12)), body.get("allowFastPreview", False) is True)
    steps = step_policy["adjustedSteps"]
    local_removal = fill_mode == "background" and body.get("processingMode") != "outfit-description"
    settings["requestedSteps"], settings["steps"] = settings["steps"], steps
    if local_removal:
        # Crop at original resolution for every model; FLUX has no padding_mask_crop.
        boxes = removal_regions(generation_mask, requested_crop_padding, float(body.get("contextRatio", 0.30)))
        region_inputs = [(box, *prepare_region(source, generation_mask, box, max_side)) for box in boxes]
        width, height = region_inputs[0][1].size
    else:
        scale = min(max_side / max(source.size), 1.0)
        width = max(64, round(source.width * scale / 64) * 64)
        height = max(64, round(source.height * scale / 64) * 64)
        model_image = source.resize((width, height), Image.Resampling.LANCZOS)
        model_mask = generation_mask.resize((width, height), Image.Resampling.NEAREST)
        crop_padding = adaptive_inpaint_context_padding(model_mask, requested_crop_padding, body.get("contextRatio", 0.30))
        region_inputs = [(None, model_image, model_mask, (width, height))]
    semantic_enabled = body.get("processingMode") != "outfit-description" and body.get("semanticCheck", True) is True
    object_label = str(body.get("objectLabel") or "")[:640]
    semantic_before = semantic_inpaint_residual_check(source, mask, removal_target, fill_mode, object_label) if semantic_enabled else {"available": False, "reason": "disabled"}
    resolved = resolve_inpaint_prompts(body, architecture, profile)
    prompt, generated_negative = resolved["prompt"], resolved["generatedNegativePrompt"]
    prompt_trace_context.get()["resolvedSources"] = {"assembledPrompt": prompt, "generatedNegativePrompt": generated_negative, "profile": profile}
    negative = resolved["negativePrompt"]
    update_job(job_id, stage="inpaint-model-loading", model=selected_entry.get("name") if selected_entry else "Default", modelId=selected_model_id or None, modelLoaded=model_was_loaded, inpaintArchitecture=architecture, _event={"type":"model.loading", "message":"Model đã có trong bộ nhớ" if model_was_loaded else f"Bắt đầu nạp model {architecture.upper()}"})
    pipe = load_inpaint_pipe(report_model_load, selected_model_path, architecture)
    pipe._atelier_model_path = str(selected_model_path.resolve())
    pipe._atelier_architecture = architecture
    update_job(job_id, currentVramMb=round(torch.cuda.memory_allocated() / (1024 * 1024), 1) if torch.cuda.is_available() else 0)
    results = []
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    run_id = f"inpaint_{Path(str(body.get('sampleId'))).stem}_{stamp}"
    run_dir = OUTPUTS / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    composite_mask.save(run_dir / "editable_mask.png")
    mask.save(run_dir / "removal_mask.png")
    generation_mask.save(run_dir / "generation_mask.png")
    if protected is not None:
        protected.save(run_dir / "protected_mask.png")
    garment_removal = removal_target in ("outfit", "shirt", "pants")
    requested_retries = int(body.get("maxAutoRetries", profile.get("maximumRetries", 1)))
    max_auto_retries = max(0, min(2, requested_retries)) if body.get("processingMode") != "outfit-description" and body.get("autoRetry", True) is not False else 0
    maximum_attempts = count + max_auto_retries
    attempted_variants = 0
    completed_work = 0
    for index in range(maximum_attempts):
        if index >= count and not any(item["removalCheck"].get("retryRecommended") for item in sorted(results, key=removal_rank)[:count]):
            break
        ensure_job_active(job_id)
        attempted_variants += 1
        run_seed = seed + index
        generator = torch.Generator(device="cpu").manual_seed(run_seed)
        retrying = index >= count
        attempt_prompt = prompt + (prompt_text('inpaint.this_is_a_corrective_retry_make_the') if retrying and body.get("confirmedPrompts") is None else "")
        attempt_negative = build_inpaint_negative_prompt(removal_target, fill_mode, retrying, ", ".join(filter(None, [forbidden_replacement, str(body.get("negativePrompt") or "")])))
        if body.get("processingMode") == "outfit-description" or body.get("confirmedPrompts") is not None or fill_mode in ("background", "base_layer", "reconstruct_body"):
            attempt_negative = negative
        if retrying and body.get("confirmedPrompts") is None and fill_mode in ("background", "base_layer", "reconstruct_body"):
            attempt_prompt = prompt + prompt_text('inpaint.match_the_surrounding_surface_continuously_across_the')
        elif retrying and body.get("confirmedPrompts") is None and not bool(profile.get("supportsNegativePrompt", architecture != "flux")):
            attempt_prompt += prompt_template("correctiveExclusions", negative=attempt_negative)
        retry_increment = float(profile.get("retryStrengthIncrement", 0.08))
        attempt_strength = strength if body.get("confirmedPrompts") is not None else min(1.0, strength + (retry_increment if retrying else 0.0))
        region_steps = max(1, int(steps * attempt_strength))
        effective_steps = region_steps * len(region_inputs)
        planned_work = completed_work + (maximum_attempts-index)*effective_steps
        update_job(job_id, stage="inpaint-generating", currentVariant=index + 1, totalVariants=maximum_attempts, currentStep=0, totalSteps=effective_steps, completedSteps=completed_work, totalWorkSteps=planned_work, seed=run_seed, autoRetry=retrying, _event={"type":"variant.started", "message":f"{'Tự thử lại' if retrying else 'Bắt đầu phương án'} {index + 1}/{maximum_attempts} · seed {run_seed}", "seed":run_seed})
        preview_interval = max(2, effective_steps // 6)
        preview_path = run_dir / f"preview_seed_{run_seed}.jpg"
        def on_step_end(pipeline, step_index, timestep, callback_kwargs):
            ensure_job_active(job_id)
            completed_step = region_index * region_steps + min(region_steps, int(step_index) + 1)
            vram = round(torch.cuda.memory_allocated() / (1024 * 1024), 1) if torch.cuda.is_available() and (completed_step == 1 or completed_step == effective_steps or completed_step % 3 == 0) else None
            progress_change = {"currentVramMb":vram} if vram is not None else {}
            if body.get("livePreview", True) is not False and (completed_step == 1 or completed_step == effective_steps or completed_step % preview_interval == 0):
                if save_diffusion_preview(pipeline, callback_kwargs.get("latents"), preview_path, region_image.width, region_image.height):
                    progress_change["preview"] = {"file":str(preview_path.relative_to(ROOT)), "step":completed_step,
                                                  "variant":index + 1, "updatedAt":datetime.now(timezone.utc).isoformat()}
            update_job(job_id, stage="inpaint-generating", currentVariant=index + 1, totalVariants=maximum_attempts, currentStep=completed_step, totalSteps=effective_steps, completedSteps=completed_work + completed_step, totalWorkSteps=planned_work, seed=run_seed, regionIndex=region_index+1, regionCount=len(region_inputs), **progress_change)
            return callback_kwargs
        generated = source.copy()
        for region_index, (region_box, region_image, region_mask, unpadded_size) in enumerate(region_inputs):
            ensure_job_active(job_id)
            call_kwargs = {
                "prompt": attempt_prompt, "image": region_image, "mask_image": region_mask, "height": region_image.height, "width": region_image.width,
                "strength": attempt_strength, "num_inference_steps": steps, "guidance_scale": guidance, "generator": generator,
                "callback_on_step_end": on_step_end, "callback_on_step_end_tensor_inputs": ["latents"],
            }
            if not bool(profile.get("supportsNegativePrompt", architecture != "flux")):
                call_kwargs["prompt_2"] = attempt_prompt
                if architecture == "flux" and fill_mode in ("base_layer", "reconstruct_body", "background"):
                    from prompt_limits import split_flux_prompts
                    text_inputs, budget_info = split_flux_prompts(pipe, attempt_prompt)
                    call_kwargs.update(text_inputs)
                    prompt_trace_context.get()["resolvedSources"] = {**prompt_trace_context.get().get("resolvedSources", {}), **budget_info}
            else:
                call_kwargs.update({"negative_prompt": attempt_negative, "padding_mask_crop": None if local_removal else crop_padding or None})
            with torch.inference_mode():
                patch = traced_pipeline_call(pipe, **call_kwargs).images[0]
            if region_box is not None:
                generated.paste(restore_region(patch, region_box, unpadded_size), region_box[:2])
            else:
                generated = patch.resize(source.size, Image.Resampling.LANCZOS)
        completed_work += effective_steps
        update_job(job_id, stage="inpaint-blending", postprocessPhase="edge-blend", currentVariant=index + 1, totalVariants=maximum_attempts, currentStep=effective_steps, totalSteps=effective_steps, completedSteps=completed_work, totalWorkSteps=planned_work, seed=run_seed, _event={"type":"blend.started", "message":f"Đang ghép biên phương án {index + 1}"})
        generated = generated.resize(source.size, Image.Resampling.LANCZOS)
        if local_removal:
            from object_removal import match_simple_background
            generated, background_match = match_simple_background(source, generated, composite_mask, protected)
            composited, edge_artifacts, edge_metrics = blend_removal(source, generated, mask, composite_mask, protected)
            edge_metrics['backgroundMatch'] = background_match
        else:
            composited, edge_artifacts, edge_metrics = adaptive_local_edge_blend(source, generated, composite_mask, edge_feather)
        texture_baseline = composited.copy()
        texture_amount = max(0.0, min(1.0, float(body.get("textureRecoveryAmount", 0.65))))
        texture_enabled = body.get("textureRecovery", not local_removal) is not False
        update_job(job_id, stage="inpaint-texture-recovery", postprocessPhase="texture-recovery", _event={"type":"postprocess.texture.started", "message":f"Đang phục hồi chi tiết ảnh phương án {index + 1}"})
        composited, texture_core, texture_metrics = texture_preserving_core_recovery(
            composited, composite_mask, edge_feather, texture_amount if texture_enabled else 0.0
        )
        structural_baseline = composited.copy()
        structural_enabled = body.get("structuralRefine", False) is True and not local_removal
        if local_removal:
            structural_mask = Image.new("L", source.size)
            structural_metrics = {"detected": False, "applied": False, "reason": "garment-only-check", "artifactPixels": 0}
        elif structural_enabled:
            update_job(job_id, stage="inpaint-structural-refine", postprocessPhase="structural-refine", _event={"type":"postprocess.structure.started", "message":f"Đang tinh chỉnh cấu trúc phương án {index + 1}"})
            composited, structural_mask, structural_metrics = generative_core_structural_refine(
                composited, composite_mask, run_seed, int(body.get("structuralSteps", 14)), edge_feather
            )
        else:
            update_job(job_id, stage="inpaint-structural-analysis", postprocessPhase="structural-analysis", _event={"type":"postprocess.structure.started", "message":f"Đang kiểm tra lỗi cấu trúc phương án {index + 1}"})
            structural_mask, structural_metrics = detect_core_structural_artifacts(composited, composite_mask, edge_feather)
            structural_metrics.update({"applied": False, "reason": "disabled"})
        source_array = np.asarray(source, dtype=np.int16)
        result_array = np.asarray(composited, dtype=np.int16)
        outside = np.asarray(composite_mask, dtype=np.uint8) == 0
        outside_mae = float(np.abs(result_array - source_array)[outside].mean() / 255.0) if outside.any() else 0.0
        removal_check = inpaint_removal_check(source, composited, mask, removal_target)
        removal_check["structuralArtifact"] = structural_metrics
        if garment_removal and not local_removal and structural_metrics.get("detected"):
            removal_check["accepted"] = False
            removal_check["status"] = "residual-structure"
            removal_check["statusLabel"] = "Còn đường may, cúc hoặc cấu trúc giống trang phục"
            removal_check["retryRecommended"] = True
        if semantic_enabled:
            semantic_check = semantic_inpaint_residual_check(composited, mask, removal_target, fill_mode, object_label)
            removal_check = assess_removal(removal_check, semantic_before, semantic_check, outside_mae)
        removal_check["boundaryError"] = boundary_metric(source, composited, composite_mask)
        output_name = f"result_seed_{run_seed}.png"
        texture_baseline_name = f"texture_baseline_seed_{run_seed}.png"
        texture_baseline.save(run_dir / texture_baseline_name)
        structural_baseline_name = f"structural_baseline_seed_{run_seed}.png"
        structural_baseline.save(run_dir / structural_baseline_name)
        update_job(job_id, stage="inpaint-saving", postprocessPhase="saving-images", _event={"type":"postprocess.saving", "message":f"Đang lưu ảnh phương án {index + 1}"})
        composited.save(run_dir / output_name)
        edge_artifacts.save(run_dir / f"edge_artifacts_seed_{run_seed}.png")
        texture_core.save(run_dir / f"texture_core_seed_{run_seed}.png")
        structural_mask.save(run_dir / f"structural_artifacts_seed_{run_seed}.png")
        results.append({"seed": run_seed, "image": encode_image(composited), "outsideMaskMAE": outside_mae, "removalCheck": removal_check, "autoRetry": retrying, "effectiveStrength": attempt_strength, "negativePromptApplied": bool(profile.get("supportsNegativePrompt", architecture != "flux")), "edgeBlend": edge_metrics, "textureRecovery": texture_metrics, "textureBaseline": str((run_dir / texture_baseline_name).relative_to(ROOT)), "structuralRefine": structural_metrics, "structuralBaseline": str((run_dir / structural_baseline_name).relative_to(ROOT))})
        update_job(job_id, stage="inpaint-variant-complete", currentVariant=index + 1, totalVariants=maximum_attempts, _result={"kind":"inpaint", "sampleId":str(body.get("sampleId")), "seed":run_seed, "file":str((run_dir / output_name).relative_to(ROOT)), "outsideMaskMAE":round(outside_mae,6), "removalCheck":removal_check, "edgePixels":int(edge_metrics.get("edgePixels",0) or 0)}, _event={"type":"variant.completed", "message":f"Phương án {index + 1}/{maximum_attempts} đã hoàn tất · {removal_check['statusLabel']} · seed {run_seed}", "seed":run_seed})
    results.sort(key=removal_rank)
    results = results[:count]
    update_job(job_id, stage="inpaint-saving", postprocessPhase="saving-metadata", _event={"type":"saving.started", "message":"Đang lưu metadata và chuẩn bị màn hình so sánh"})
    lora_metadata = [{key: value for key, value in item.items() if key != "path"} for item in active_loras if item.get("modelPath") == str(selected_model_path.resolve())]
    metadata = {
        "promptHistory": prompt_history(),
        "schemaVersion": 1, "runId": run_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": str(body.get("sampleId")), "prompt": prompt,
        "processingMode": body.get("processingMode", "inpaint"),
        "removalTarget": removal_target, "fillMode": fill_mode, "forbiddenReplacement": forbidden_replacement,
        "negativePrompt": negative, "negativePromptApplied": bool(profile.get("supportsNegativePrompt", architecture != "flux")), "negativePromptStrategy": "direct" if bool(profile.get("supportsNegativePrompt", architecture != "flux")) else "merged-into-positive" if "Avoid these failure modes:" in prompt else "unused", "seed": seed, "count": count,
        "steps": steps, "requestedSteps": step_policy["requestedSteps"], "effectiveSteps": step_policy["effectiveSteps"],
        "minimumEffectiveSteps": step_policy["minimumEffectiveSteps"], "stepsAutoAdjusted": step_policy["autoAdjusted"],
        "strength": strength, "guidance": guidance,
        "expand": expand, "blur": blur, "edgeFeather": edge_feather,
        "requestedCropPadding": requested_crop_padding, "cropPadding": crop_padding,
        "dualMask": dual_mask_metrics, "contextRatio": float(body.get("contextRatio", 0.30)),
        "textureRecovery": texture_enabled, "textureRecoveryAmount": texture_amount,
        "structuralRefine": structural_enabled, "structuralSteps": int(body.get("structuralSteps", 14)),
        "model": str(selected_model_path), "modelId": selected_model_id or None, "modelName": selected_entry.get("name") if selected_entry else "Default", "inpaintArchitecture": architecture, "device": device,
        "modelProfile": profile, "useModelProfile": use_model_profile,
        "modelWidth": width, "modelHeight": height,
        "sourceWidth": source.width, "sourceHeight": source.height,
        "localRemoval": local_removal, "objectLabel": object_label,
        "removalConditioning": "local-prefill-v1" if local_removal else "original",
        "regions": [{"box": box, "modelSize": list(image.size), "unpaddedSize": list(size)} for box, image, _, size in region_inputs],
        "semanticBefore": semantic_before,
        "totalEffectiveSteps": completed_work,
        "loras": lora_metadata,
        "removalChecks": [{"seed": item["seed"], **item["removalCheck"]} for item in results],
        "autoRetry": {"enabled": max_auto_retries > 0, "maximum": max_auto_retries, "attemptedVariants": attempted_variants},
    }
    (run_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    passed_count = sum(1 for item in results if item["removalCheck"]["accepted"])
    # Keep the requested model even when no candidate passes validation.
    duration_seconds = round(time.perf_counter() - started_at, 3)
    peak_vram_mb = round(torch.cuda.max_memory_allocated() / (1024 * 1024), 1) if torch.cuda.is_available() else 0.0
    update_job(job_id, status="completed", stage="done", currentVariant=attempted_variants, totalVariants=attempted_variants, completedSteps=completed_work, totalWorkSteps=completed_work, durationSeconds=duration_seconds, peakVramMb=peak_vram_mb, directory=str(run_dir.relative_to(ROOT)), _event={"type":"job.completed", "message":f"Đã tạo {count} phương án; {passed_count}/{count} vượt kiểm tra nhận diện; cần xem lại chất lượng nền. {duration_seconds:.1f} giây"})
    return {"ok": True, "promptHistory": prompt_history(), "results": results, "width": source.width, "height": source.height, "device": device, "directory": str(run_dir.relative_to(ROOT)), "modelId": selected_model_id or None, "modelName": selected_entry.get("name") if selected_entry else "Default", "loras": lora_metadata, "stepPolicy": step_policy, "removalTarget": removal_target, "fillMode": fill_mode, "removalPassed": passed_count, "attemptedVariants": attempted_variants, "regionCount": len(region_inputs), "effectiveSettings": settings}


def lora_ab_test(body: dict) -> dict:
    if not active_loras:
        raise ValueError("Hãy kích hoạt ít nhất một LoRA trước khi chạy A/B")
    saved = [{"id": item["id"], "weight": item["weight"]} for item in active_loras]
    configure_loras({"adapters": []})
    baseline = inpaint(body)
    configure_loras({"adapters": saved})
    candidate = inpaint(body)
    seed = int(body.get("seed", 42))
    baseline_file = str((ROOT / baseline["directory"] / f"result_seed_{seed}.png").relative_to(ROOT))
    candidate_file = str((ROOT / candidate["directory"] / f"result_seed_{seed}.png").relative_to(ROOT))
    baseline_mae = float(baseline["results"][0]["outsideMaskMAE"])
    candidate_mae = float(candidate["results"][0]["outsideMaskMAE"])
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "sampleId": body.get("sampleId"),
        "seed": seed, "baseline": {"output": baseline_file, "outsideMaskMAE": baseline_mae},
        "candidate": {"output": candidate_file, "outsideMaskMAE": candidate_mae, "loras": candidate["loras"]},
        "sameSeed": True, "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"lora-ab-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def lora_ab_matrix(body: dict) -> dict:
    """Run one baseline and several LoRA weights per sample with automatic body masks."""
    requested_samples = body.get("sampleIds") or []
    if requested_samples:
        sample_ids = [str(value) for value in requested_samples[:5]]
    else:
        preferred = sorted(
            str(path.relative_to(SAMPLES)).replace("\\", "/")
            for path in SAMPLES.rglob("*")
            if path.suffix.lower() in (".png", ".jpg", ".jpeg") and path.parent.name in ("characters", "portrait")
        )
        sample_ids = preferred[:5]
    if not sample_ids:
        raise ValueError("Không có ảnh mẫu để chạy ma trận LoRA")
    weights = [max(0.0, min(1.5, float(value))) for value in (body.get("weights") or [0.4, 0.6, 0.8])]
    weights = list(dict.fromkeys(weights))[:3]
    adapter_id = str(body.get("adapterId") or (active_loras[0]["id"] if active_loras else ""))
    if not adapter_id:
        raise ValueError("Hãy chọn một LoRA trước khi chạy ma trận")
    saved = [{"id": item["id"], "weight": item["weight"]} for item in active_loras]
    category = str(body.get("category", "upper_body"))
    base_seed = int(body.get("seed", 42001))
    rows = []
    skipped = []
    try:
        for index, sample_id in enumerate(sample_ids):
            source = Image.open(safe_sample(sample_id)).convert("RGB")
            people = detect_people(source, True)
            person = people[0]
            mask, mask_score = automatic_garment_mask(source, category, person["box"], person.get("keypoints"))
            protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
            mask_array = np.asarray(mask, dtype=np.uint8).copy()
            mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
            mask = Image.fromarray(mask_array, mode="L")
            policy = mask_strength_policy(mask, person["box"], category, person.get("keypoints"))
            if not policy["accepted"]:
                skipped.append({"sampleId": sample_id, "reason": "mask-coverage-below-minimum", "maskScore": mask_score, **policy})
                continue
            request = {
                "sampleId": sample_id, "editableMask": encode_image(mask),
                "protectedDetailMask": encode_image(protected),
                "prompt": str(body.get("prompt") or prompt_text('lora_ab_matrix.photorealistic_tailored_navy_cotton_jacket_realistic_woven')),
                "negativePrompt": str(body.get("negativePrompt") or prompt_text('lora_ab_matrix.changed_face_changed_identity_deformed_anatomy_exposed')),
                "seed": base_seed + index, "count": 1,
                "steps": int(body.get("steps", 4)), "strength": float(body.get("strength", policy["recommendedStrength"])),
                "guidance": float(body.get("guidance", 4.5)), "expand": int(body.get("expand", 4)),
                "blur": int(body.get("blur", 6)), "cropPadding": int(body.get("cropPadding", 64)),
                "maxSide": int(body.get("maxSide", 512)),
            }
            configure_loras({"adapters": []})
            baseline = inpaint(request)
            baseline_file = str((ROOT / baseline["directory"] / f"result_seed_{request['seed']}.png").relative_to(ROOT))
            candidates = []
            for weight in weights:
                configure_loras({"adapters": [{"id": adapter_id, "weight": weight}]})
                candidate = inpaint(request)
                output = str((ROOT / candidate["directory"] / f"result_seed_{request['seed']}.png").relative_to(ROOT))
                candidates.append({"weight": weight, "output": output, "outsideMaskMAE": candidate["results"][0]["outsideMaskMAE"], "edgeBlend": candidate["results"][0]["edgeBlend"]})
            rows.append({
                "sampleId": sample_id, "seed": request["seed"], "maskScore": mask_score,
                "maskCoverage": policy["coverage"], "recommendedStrength": policy["recommendedStrength"],
                "baseline": {"output": baseline_file, "outsideMaskMAE": baseline["results"][0]["outsideMaskMAE"]},
                "candidates": candidates,
            })
    finally:
        configure_loras({"adapters": saved})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "adapterId": adapter_id, "category": category, "weights": weights,
        "sampleCount": len(rows), "skippedCount": len(skipped), "skipped": skipped, "sameSeedWithinRow": True, "rows": rows,
        "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"lora-matrix-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def lora_strength_matrix(body: dict) -> dict:
    """Tune inpaint strength on three single-person samples before a full LoRA matrix."""
    sample_ids = [str(value) for value in (body.get("sampleIds") or [
        "characters/c001.png", "characters/c002.png", "characters/c003.png"
    ])[:3]]
    strengths = [max(0.2, min(1.0, float(value))) for value in (body.get("strengths") or [0.5, 0.6, 0.7])]
    strengths = list(dict.fromkeys(strengths))[:3]
    adapter_id = str(body.get("adapterId") or (active_loras[0]["id"] if active_loras else ""))
    adapter_weight = max(0.0, min(1.5, float(body.get("adapterWeight", 0.6))))
    if not adapter_id:
        raise ValueError("Hãy chọn một LoRA trước khi hiệu chỉnh strength")
    saved = [{"id": item["id"], "weight": item["weight"]} for item in active_loras]
    rows, skipped = [], []
    try:
        configure_loras({"adapters": [{"id": adapter_id, "weight": adapter_weight}]})
        for index, sample_id in enumerate(sample_ids):
            source = Image.open(safe_sample(sample_id)).convert("RGB")
            people = detect_people(source, True)
            if len(people) != 1:
                skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
                continue
            person = people[0]
            mask, mask_score = automatic_garment_mask(source, "upper_body", person["box"], person.get("keypoints"))
            protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
            mask_array = np.asarray(mask, dtype=np.uint8).copy()
            mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
            mask = Image.fromarray(mask_array, mode="L")
            policy = mask_strength_policy(mask, person["box"], "upper_body", person.get("keypoints"))
            if not policy["accepted"]:
                skipped.append({"sampleId": sample_id, "reason": "mask-coverage-below-minimum", "maskScore": mask_score, **policy})
                continue
            seed = int(body.get("seed", 43001)) + index
            candidates = []
            for strength in strengths:
                request = {
                    "sampleId": sample_id, "editableMask": encode_image(mask), "protectedDetailMask": encode_image(protected),
                    "prompt": str(body.get("prompt") or prompt_text('lora_strength_matrix.photorealistic_tailored_navy_cotton_jacket_coherent_single')),
                    "negativePrompt": str(body.get("negativePrompt") or prompt_text('lora_strength_matrix.duplicate_clothing_double_jacket_split_torso_changed')),
                    "seed": seed, "count": 1, "steps": int(body.get("steps", 4)), "strength": strength,
                    "guidance": float(body.get("guidance", 4.5)), "expand": 0, "blur": int(body.get("blur", 8)),
                    "cropPadding": int(body.get("cropPadding", 64)), "maxSide": int(body.get("maxSide", 512)),
                }
                result = inpaint(request)
                output = str((ROOT / result["directory"] / f"result_seed_{seed}.png").relative_to(ROOT))
                candidates.append({"strength": strength, "output": output, "outsideMaskMAE": result["results"][0]["outsideMaskMAE"], "edgeBlend": result["results"][0]["edgeBlend"]})
            rows.append({"sampleId": sample_id, "seed": seed, "maskScore": mask_score, **policy, "candidates": candidates})
    finally:
        configure_loras({"adapters": saved})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "adapterId": adapter_id,
        "adapterWeight": adapter_weight, "strengths": strengths, "sampleCount": len(rows),
        "skippedCount": len(skipped), "skipped": skipped, "rows": rows, "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"lora-strength-matrix-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def texture_recovery_matrix(body: dict) -> dict:
    """Generate one deterministic result per sample and compare core recovery against its exact pre-filter image."""
    sample_ids = [str(value) for value in (body.get("sampleIds") or [
        "characters/c001.png", "characters/c002.png", "characters/c003.png"
    ])[:3]]
    saved = [{"id": item["id"], "weight": item["weight"]} for item in active_loras]
    adapter_id = str(body.get("adapterId") or (active_loras[0]["id"] if active_loras else ""))
    adapter_weight = max(0.0, min(1.5, float(body.get("adapterWeight", 0.6))))
    if adapter_id:
        configure_loras({"adapters": [{"id": adapter_id, "weight": adapter_weight}]})
    rows, skipped = [], []
    try:
        for index, sample_id in enumerate(sample_ids):
            source = Image.open(safe_sample(sample_id)).convert("RGB")
            people = detect_people(source, True)
            if len(people) != 1:
                skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
                continue
            person = people[0]
            mask, mask_score = automatic_garment_mask(source, "upper_body", person["box"], person.get("keypoints"))
            protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
            mask_array = np.asarray(mask, dtype=np.uint8).copy()
            mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
            mask = Image.fromarray(mask_array, mode="L")
            policy = mask_strength_policy(mask, person["box"], "upper_body", person.get("keypoints"))
            if not policy["accepted"]:
                skipped.append({"sampleId": sample_id, "reason": "mask-coverage-below-minimum", "maskScore": mask_score, **policy})
                continue
            seed = int(body.get("seed", 44001)) + index
            request = {
                "sampleId": sample_id, "editableMask": encode_image(mask), "protectedDetailMask": encode_image(protected),
                "prompt": str(body.get("prompt") or prompt_text('texture_recovery_matrix.photorealistic_tailored_navy_cotton_jacket_coherent_single')),
                "negativePrompt": str(body.get("negativePrompt") or prompt_text('lora_strength_matrix.duplicate_clothing_double_jacket_split_torso_changed')),
                "seed": seed, "count": 1, "steps": int(body.get("steps", 4)),
                "strength": float(body.get("strength", policy["recommendedStrength"])),
                "guidance": float(body.get("guidance", 4.5)), "expand": 0, "blur": int(body.get("blur", 8)),
                "cropPadding": int(body.get("cropPadding", 64)), "maxSide": int(body.get("maxSide", 512)),
                "textureRecovery": True, "textureRecoveryAmount": float(body.get("textureRecoveryAmount", 0.65)),
            }
            result = inpaint(request)
            item = result["results"][0]
            rows.append({
                "sampleId": sample_id, "seed": seed, "maskScore": mask_score, **policy,
                "baseline": item["textureBaseline"],
                "candidate": str((ROOT / result["directory"] / f"result_seed_{seed}.png").relative_to(ROOT)),
                "coreMask": str((ROOT / result["directory"] / f"texture_core_seed_{seed}.png").relative_to(ROOT)),
                "outsideMaskMAE": item["outsideMaskMAE"], "textureRecovery": item["textureRecovery"],
            })
    finally:
        configure_loras({"adapters": saved})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "adapterId": adapter_id or None, "adapterWeight": adapter_weight if adapter_id else None,
        "sampleCount": len(rows), "skippedCount": len(skipped), "skipped": skipped, "rows": rows,
        "sameGenerationWithinRow": True, "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"texture-recovery-matrix-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def structural_refine_matrix(body: dict) -> dict:
    """A/B detected core-structure repair on three deterministic upper-body samples."""
    sample_ids = [str(value) for value in (body.get("sampleIds") or [
        "characters/c001.png", "characters/c002.png", "characters/c003.png"
    ])[:3]]
    saved = [{"id": item["id"], "weight": item["weight"]} for item in active_loras]
    adapter_id = str(body.get("adapterId") or (active_loras[0]["id"] if active_loras else ""))
    adapter_weight = max(0.0, min(1.5, float(body.get("adapterWeight", 0.6))))
    if adapter_id:
        configure_loras({"adapters": [{"id": adapter_id, "weight": adapter_weight}]})
    rows, skipped = [], []
    try:
        for index, sample_id in enumerate(sample_ids):
            source = Image.open(safe_sample(sample_id)).convert("RGB")
            people = detect_people(source, True)
            if len(people) != 1:
                skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
                continue
            person = people[0]
            mask, mask_score = automatic_garment_mask(source, "upper_body", person["box"], person.get("keypoints"))
            protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
            mask_array = np.asarray(mask, dtype=np.uint8).copy()
            mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
            mask = Image.fromarray(mask_array, mode="L")
            policy = mask_strength_policy(mask, person["box"], "upper_body", person.get("keypoints"))
            if not policy["accepted"]:
                skipped.append({"sampleId": sample_id, "reason": "mask-coverage-below-minimum", "maskScore": mask_score, **policy})
                continue
            seed = int(body.get("seed", 45001)) + index
            request = {
                "sampleId": sample_id, "editableMask": encode_image(mask), "protectedDetailMask": encode_image(protected),
                "prompt": str(body.get("prompt") or prompt_text('texture_recovery_matrix.photorealistic_tailored_navy_cotton_jacket_coherent_single')),
                "negativePrompt": str(body.get("negativePrompt") or prompt_text('structural_refine_matrix.duplicate_clothing_double_jacket_split_torso_changed')),
                "seed": seed, "count": 1, "steps": int(body.get("steps", 4)),
                "strength": float(body.get("strength", policy["recommendedStrength"])),
                "guidance": float(body.get("guidance", 4.5)), "expand": 0, "blur": int(body.get("blur", 8)),
                "cropPadding": int(body.get("cropPadding", 64)), "maxSide": int(body.get("maxSide", 512)),
                "textureRecovery": True, "textureRecoveryAmount": float(body.get("textureRecoveryAmount", 0.65)),
                "structuralRefine": True, "structuralSteps": int(body.get("structuralSteps", 14)),
            }
            result = inpaint(request)
            item = result["results"][0]
            rows.append({
                "sampleId": sample_id, "seed": seed, "maskScore": mask_score, **policy,
                "baseline": item["structuralBaseline"],
                "candidate": str((ROOT / result["directory"] / f"result_seed_{seed}.png").relative_to(ROOT)),
                "artifactMask": str((ROOT / result["directory"] / f"structural_artifacts_seed_{seed}.png").relative_to(ROOT)),
                "outsideMaskMAE": item["outsideMaskMAE"], "structuralRefine": item["structuralRefine"],
            })
    finally:
        configure_loras({"adapters": saved})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "adapterId": adapter_id or None, "adapterWeight": adapter_weight if adapter_id else None,
        "sampleCount": len(rows), "skippedCount": len(skipped), "skipped": skipped, "rows": rows,
        "sameInitialGenerationWithinRow": True, "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"structural-refine-matrix-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def effective_step_matrix(body: dict) -> dict:
    """Compare minimum effective denoising targets while keeping seed and strength fixed."""
    sample_ids = [str(value) for value in (body.get("sampleIds") or [
        "characters/c001.png", "characters/c002.png", "characters/c003.png"
    ])[:3]]
    targets = [max(4, min(24, int(value))) for value in (body.get("effectiveSteps") or [12, 16, 20])]
    targets = list(dict.fromkeys(targets))[:3]
    strength = max(0.2, min(1.0, float(body.get("strength", 0.5))))
    saved = [{"id": item["id"], "weight": item["weight"]} for item in active_loras]
    adapter_id = str(body.get("adapterId") or (active_loras[0]["id"] if active_loras else ""))
    adapter_weight = max(0.0, min(1.5, float(body.get("adapterWeight", 0.6))))
    if adapter_id:
        configure_loras({"adapters": [{"id": adapter_id, "weight": adapter_weight}]})
    rows, skipped = [], []
    try:
        for index, sample_id in enumerate(sample_ids):
            source = Image.open(safe_sample(sample_id)).convert("RGB")
            people = detect_people(source, True)
            if len(people) != 1:
                skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
                continue
            person = people[0]
            mask, mask_score = automatic_garment_mask(source, "upper_body", person["box"], person.get("keypoints"))
            protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
            mask_array = np.asarray(mask, dtype=np.uint8).copy()
            mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
            mask = Image.fromarray(mask_array, mode="L")
            policy = mask_strength_policy(mask, person["box"], "upper_body", person.get("keypoints"))
            if not policy["accepted"]:
                skipped.append({"sampleId": sample_id, "reason": "mask-coverage-below-minimum", "maskScore": mask_score, **policy})
                continue
            seed = int(body.get("seed", 46001)) + index
            candidates = []
            for target_effective in targets:
                requested_total = int(np.ceil(target_effective / strength))
                request = {
                    "sampleId": sample_id, "editableMask": encode_image(mask), "protectedDetailMask": encode_image(protected),
                    "prompt": str(body.get("prompt") or prompt_text('texture_recovery_matrix.photorealistic_tailored_navy_cotton_jacket_coherent_single')),
                    "negativePrompt": str(body.get("negativePrompt") or prompt_text('lora_strength_matrix.duplicate_clothing_double_jacket_split_torso_changed')),
                    "seed": seed, "count": 1, "steps": requested_total, "minimumEffectiveSteps": target_effective,
                    "strength": strength, "guidance": float(body.get("guidance", 4.5)), "expand": 0,
                    "blur": int(body.get("blur", 8)), "cropPadding": int(body.get("cropPadding", 64)),
                    "maxSide": int(body.get("maxSide", 512)), "textureRecovery": True,
                    "textureRecoveryAmount": float(body.get("textureRecoveryAmount", 0.65)), "structuralRefine": False,
                }
                result = inpaint(request)
                output = str((ROOT / result["directory"] / f"result_seed_{seed}.png").relative_to(ROOT))
                candidates.append({"targetEffectiveSteps": target_effective, "output": output, "stepPolicy": result["stepPolicy"], "outsideMaskMAE": result["results"][0]["outsideMaskMAE"]})
            rows.append({"sampleId": sample_id, "seed": seed, "maskScore": mask_score, **policy, "candidates": candidates})
    finally:
        configure_loras({"adapters": saved})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "adapterId": adapter_id or None, "adapterWeight": adapter_weight if adapter_id else None,
        "strength": strength, "effectiveStepTargets": targets, "sampleCount": len(rows),
        "skippedCount": len(skipped), "skipped": skipped, "rows": rows,
        "sameSeedWithinRow": True, "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"effective-step-matrix-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def hybrid_tryon_compare(body: dict) -> dict:
    """Compare CatVTON, SD3.5 text inpaint, and CatVTON followed by local SD3.5 refinement."""
    sample_ids = [str(value) for value in (body.get("sampleIds") or ["characters/c001.png"])[:3]]
    garment_sample_id = str(body.get("garmentSampleId") or "characters/c003.png")
    garment_image = Image.open(safe_sample(garment_sample_id)).convert("RGB")
    garment_data = encode_image(garment_image)
    base_seed = int(body.get("seed", 48001))
    rows, skipped = [], []
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    compare_dir = OUTPUTS / f"hybrid_compare_{stamp}"
    compare_dir.mkdir(parents=True, exist_ok=False)
    processed_garment, _, _, _, _ = preprocess_garment_image(garment_image, "upper_body")
    for index, sample_id in enumerate(sample_ids):
        source = Image.open(safe_sample(sample_id)).convert("RGB")
        people = detect_people(source, True)
        if len(people) != 1:
            skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
            continue
        person = people[0]
        mask, mask_score = automatic_garment_mask(source, "upper_body", person["box"], person.get("keypoints"))
        protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
        mask_array = np.asarray(mask, dtype=np.uint8).copy()
        mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
        mask = Image.fromarray(mask_array, mode="L")
        policy = mask_strength_policy(mask, person["box"], "upper_body", person.get("keypoints"))
        if not policy["accepted"]:
            skipped.append({"sampleId": sample_id, "reason": "mask-quality-gate", "maskScore": mask_score, **policy})
            continue
        seed = base_seed + index
        cat = tryon({
            "sampleId": sample_id, "garmentImage": garment_data, "category": "upper_body",
            "autoMask": True, "usePose": True, "personIndex": 0, "cropPerson": False,
            "preprocessGarment": True, "count": 1, "steps": int(body.get("catvtonSteps", 20)),
            "guidance": float(body.get("catvtonGuidance", 2.5)), "seed": seed,
            "maxSide": int(body.get("maxSide", 512)), "expand": 0, "blur": 6,
            "repairSeams": False, "generativeRefine": False, "maxRetries": 0,
            "minimumQuality": 0, "minimumSimilarity": 0, "minimumSeam": 0, "minimumAnatomy": 0,
        })
        cat_path = ROOT / cat["selected"]
        cat_image = Image.open(cat_path).convert("RGB")
        cat_metrics = score_tryon_result(source, cat_image, mask)
        cat_metrics["referenceSimilarity"] = reference_similarity(processed_garment, cat_image, mask)

        sd = inpaint({
            "sampleId": sample_id, "editableMask": encode_image(mask), "protectedDetailMask": encode_image(protected),
            "prompt": str(body.get("prompt") or prompt_text('hybrid_tryon_compare.photorealistic_tailored_garment_matching_the_reference_coherent')),
            "negativePrompt": prompt_text('hybrid_tryon_compare.duplicate_clothing_split_torso_changed_face_deformed'),
            "seed": seed, "count": 1, "steps": int(body.get("sdSteps", 20)), "minimumEffectiveSteps": 12,
            "strength": float(body.get("sdStrength", 0.6)), "guidance": float(body.get("sdGuidance", 4.5)),
            "expand": 0, "blur": 8, "cropPadding": 64, "maxSide": int(body.get("maxSide", 512)),
            "textureRecovery": True, "structuralRefine": False,
        })
        sd_path = ROOT / sd["directory"] / f"result_seed_{seed}.png"
        sd_image = Image.open(sd_path).convert("RGB")
        sd_metrics = score_tryon_result(source, sd_image, mask)
        sd_metrics["referenceSimilarity"] = reference_similarity(processed_garment, sd_image, mask)

        hybrid_image, hybrid_mask, refine_pixels = generative_seam_refine(source, cat_image, mask, seed + 900000, int(body.get("hybridSteps", 12)))
        hybrid_image, _, edge_metrics = adaptive_local_edge_blend(source, hybrid_image, mask, 12)
        hybrid_image, _, texture_metrics = texture_preserving_core_recovery(hybrid_image, mask, 12, 0.65)
        hybrid_metrics = score_tryon_result(source, hybrid_image, mask)
        hybrid_metrics["referenceSimilarity"] = reference_similarity(processed_garment, hybrid_image, mask)

        prefix = Path(sample_id).stem
        cat_target = compare_dir / f"{prefix}_catvton.png"
        sd_target = compare_dir / f"{prefix}_sd35.png"
        hybrid_target = compare_dir / f"{prefix}_hybrid.png"
        shutil.copyfile(cat_path, cat_target)
        shutil.copyfile(sd_path, sd_target)
        hybrid_image.save(hybrid_target)
        hybrid_mask.save(compare_dir / f"{prefix}_hybrid_refine_mask.png")
        mask.save(compare_dir / f"{prefix}_garment_mask.png")
        rows.append({
            "sampleId": sample_id, "seed": seed, "maskScore": mask_score, **policy,
            "catvton": {"output": str(cat_target.relative_to(ROOT)), "performance": cat["performance"], **cat_metrics},
            "sd35": {"output": str(sd_target.relative_to(ROOT)), "stepPolicy": sd["stepPolicy"], **sd_metrics},
            "hybrid": {"output": str(hybrid_target.relative_to(ROOT)), "refinePixels": refine_pixels, "edgeBlend": edge_metrics, "textureRecovery": texture_metrics, **hybrid_metrics},
        })
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "garmentSampleId": garment_sample_id, "sampleCount": len(rows), "skippedCount": len(skipped),
        "skipped": skipped, "rows": rows, "sameSeedWithinRow": True, "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"hybrid-tryon-compare-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), "directory": str(compare_dir.relative_to(ROOT)), **report}


def _first_file(root: Path, name: str) -> Path:
    matches = list(root.rglob(name)) if root.exists() else []
    if not matches:
        raise RuntimeError(f"Thiếu checkpoint {name} trong {root}")
    return matches[0]


def runtime_model_status() -> dict:
    adapter_file = next(iter(IP_ADAPTER_SDXL_ROOT.rglob("ip-adapter_sdxl.bin")), None) if IP_ADAPTER_SDXL_ROOT.exists() else None
    control_file = CONTROLNET_DEPTH_SDXL_ROOT / "diffusion_pytorch_model.safetensors"
    union_file = CONTROLNET_UNION_SDXL_ROOT / "diffusion_pytorch_model.safetensors"
    sdxl_files = (
        SDXL_BASE / "model_index.json", SDXL_BASE / "unet" / "config.json",
        SDXL_BASE / "unet" / "diffusion_pytorch_model.fp16.safetensors",
        SDXL_BASE / "vae" / "diffusion_pytorch_model.fp16.safetensors",
        SDXL_BASE / "text_encoder" / "model.fp16.safetensors",
        SDXL_BASE / "text_encoder_2" / "model.fp16.safetensors",
    )
    sdxl_ready = all(item.is_file() for item in sdxl_files)
    clip_file = ROOT / "weights" / "clip" / "ViT-B-32.pt"
    return {
        "ok": True,
        "models": {
            "adetailer": {"ready": ADETAILER_ROOT.exists(), "loaded": adetailer_model is not None, "capability": "face-hand-person detection and detail mask"},
            "yolo-world": {"ready": YOLO_WORLD_ROOT.exists() and clip_file.is_file(), "loaded": yolo_world_model is not None, "capability": "open-vocabulary detection", "clipReady": clip_file.is_file()},
            "grounding-dino-base": {"ready": (GROUNDING_DINO_ROOT / "config.json").is_file(), "loaded": grounding_dino_model is not None, "capability": "text-to-box with SAM mask refinement"},
            "florence-2-large": {"ready": (FLORENCE_ROOT / "config.json").is_file(), "loaded": florence_model is not None, "capability": "vision grounding with SAM mask refinement"},
            "birefnet": {"ready": (BIREFNET_ROOT / "model.safetensors").is_file(), "loaded": birefnet_model is not None, "capability": "garment and foreground extraction"},
            "ip-adapter-sdxl": {"ready": bool(adapter_file and sdxl_ready), "filesReady": bool(adapter_file), "baseReady": sdxl_ready, "loaded": sdxl_control_pipe is not None, "missing": [str(item) for item in sdxl_files if not item.is_file()]},
            "controlnet-depth-sdxl-small": {"ready": control_file.is_file() and sdxl_ready, "filesReady": control_file.is_file(), "baseReady": sdxl_ready, "loaded": sdxl_control_pipe is not None, "missing": [str(item) for item in sdxl_files if not item.is_file()]},
            "controlnet-union-sdxl-1.0": {"ready": union_file.is_file() and sdxl_ready, "filesReady": union_file.is_file(), "baseReady": sdxl_ready, "loaded": sdxl_control_pipe is not None and sdxl_control_mode == "union-depth", "missing": [str(item) for item in sdxl_files if not item.is_file()]},
        },
    }


def _detector(kind: str):
    global adetailer_model, yolo_world_model
    from ultralytics import YOLO, YOLOWorld
    if kind == "yolo-world":
        if yolo_world_model is None:
            yolo_world_model = YOLOWorld(str(_first_file(YOLO_WORLD_ROOT, "yolov8x-worldv2.pt")))
        return yolo_world_model
    if adetailer_model is None:
        adetailer_model = YOLO(str(_first_file(ADETAILER_ROOT, "face_yolov8n.pt")))
    return adetailer_model


def _transformer_detector(kind: str):
    global grounding_dino_model, grounding_dino_processor, florence_model, florence_processor
    from transformers import AutoModelForCausalLM, AutoModelForZeroShotObjectDetection, AutoProcessor
    dtype = torch.float16 if device == "cuda" else torch.float32
    if kind == "grounding-dino":
        if grounding_dino_model is None:
            grounding_dino_processor = AutoProcessor.from_pretrained(str(GROUNDING_DINO_ROOT), local_files_only=True)
            grounding_dino_model = AutoModelForZeroShotObjectDetection.from_pretrained(str(GROUNDING_DINO_ROOT), local_files_only=True, torch_dtype=dtype).to(device).eval()
        return grounding_dino_model, grounding_dino_processor
    if florence_model is None:
        florence_processor = AutoProcessor.from_pretrained(str(FLORENCE_ROOT), trust_remote_code=True, local_files_only=True)
        florence_model = AutoModelForCausalLM.from_pretrained(str(FLORENCE_ROOT), trust_remote_code=True, local_files_only=True, torch_dtype=dtype).to(device).eval()
    return florence_model, florence_processor


def _boxes_to_sam_mask(source: Image.Image, boxes) -> Image.Image:
    combined = np.zeros((source.height, source.width), dtype=np.uint8)
    if not boxes:
        return Image.fromarray(combined, mode="L")
    segmenter = load_predictor();segmenter.set_image(np.asarray(source))
    for box in boxes:
        masks, scores, _ = segmenter.predict(box=np.asarray(box, dtype=np.float32), multimask_output=True)
        combined[np.asarray(masks[int(np.argmax(scores))], dtype=bool)] = 255
    return Image.fromarray(combined, mode="L")


def transformer_detect_regions(source: Image.Image, kind: str, classes: list[str], confidence: float) -> dict:
    if not classes:
        raise ValueError("Hãy nhập ít nhất một tên đối tượng")
    model, processor = _transformer_detector(kind)
    items, boxes = [], []
    if kind == "grounding-dino":
        text = ". ".join(classes) + "."
        inputs = processor(images=source, text=text, return_tensors="pt").to(device)
        with torch.inference_mode(): outputs = model(**inputs)
        result = processor.post_process_grounded_object_detection(outputs, inputs.input_ids, threshold=confidence, text_threshold=confidence, target_sizes=[source.size[::-1]])[0]
        for index, (box, score, label) in enumerate(zip(result["boxes"], result["scores"], result["labels"])):
            coords = [round(float(value)) for value in box.tolist()];boxes.append(coords);items.append({"index":index,"label":str(label),"confidence":float(score),"box":coords})
    else:
        task = "<OPEN_VOCABULARY_DETECTION>";prompt = task + ', '.join(classes)
        inputs = processor(text=prompt, images=source, return_tensors="pt").to(device)
        with torch.inference_mode(): generated = model.generate(input_ids=inputs["input_ids"], pixel_values=inputs["pixel_values"], max_new_tokens=512, num_beams=3)
        text = processor.batch_decode(generated, skip_special_tokens=False)[0]
        parsed = processor.post_process_generation(text, task=task, image_size=source.size).get(task, {})
        for index, (box, label) in enumerate(zip(parsed.get("bboxes", []), parsed.get("bboxes_labels", parsed.get("labels", [])))):
            coords = [round(float(value)) for value in box];boxes.append(coords);items.append({"index":index,"label":str(label),"confidence":1.0,"box":coords})
    combined = np.zeros((source.height, source.width), dtype=np.uint8)
    for item in items:
        single = _boxes_to_sam_mask(source, [item["box"]])
        item["mask"] = encode_image(single)
        combined = np.maximum(combined, np.asarray(single))
    return {"items":items,"mask":Image.fromarray(combined, mode="L")}


def detect_regions(body: dict) -> dict:
    from PIL import ImageOps
    source = ImageOps.exif_transpose(Image.open(safe_sample(str(body.get("sampleId", ""))))).convert("RGB")
    kind = str(body.get("model", "adetailer"))
    if kind not in ("adetailer", "yolo-world", "grounding-dino", "florence-2"):
        raise ValueError("Model phát hiện không được hỗ trợ")
    classes = [str(item).strip() for item in (body.get("classes") or []) if str(item).strip()][:32]
    confidence = max(0.05, min(0.95, float(body.get("confidence", 0.25))))
    if kind in ("grounding-dino", "florence-2"):
        detected = transformer_detect_regions(source, kind, classes, confidence)
        mask, items = detected["mask"], detected["items"]
        for item in items:
            single = decode_image(item["mask"]).convert("L")
            pad = max(0, min(64, int(body.get("padding", 8))))
            if pad:
                single = Image.fromarray(cv2.dilate(np.asarray(single), np.ones((pad*2+1, pad*2+1), np.uint8)), mode="L")
            item["mask"] = encode_image(single)
        padding = max(0, min(64, int(body.get("padding", 8))))
        if padding and np.asarray(mask).any(): mask=Image.fromarray(cv2.dilate(np.asarray(mask),np.ones((padding*2+1,padding*2+1),np.uint8)),mode="L")
        return {"ok":True,"model":kind,"width":source.width,"height":source.height,"detections":items,"mask":encode_image(mask),"count":len(items),"warning":""}
    model = _detector(kind)
    class_warning = ""
    if kind == "yolo-world":
        if not classes:
            raise ValueError("YOLO-World cần ít nhất một tên đối tượng")
        try:
            model.set_classes(classes)
        except (ImportError, RuntimeError) as error:
            # Some offline Windows builds have no compatible CLIP/torchvision
            # binary. The checkpoint still carries its default vocabulary.
            class_warning = f"Dùng từ vựng tích hợp của checkpoint vì CLIP không khả dụng: {error}"
    prediction = model.predict(np.asarray(source)[:, :, ::-1].copy(), conf=confidence, verbose=False, device=0 if device == "cuda" else "cpu")[0]
    items, combined = [], np.zeros((source.height, source.width), dtype=np.uint8)
    names = prediction.names
    if prediction.boxes is not None:
        for index, box in enumerate(prediction.boxes):
            xyxy = [max(0, int(round(value))) for value in box.xyxy[0].detach().cpu().tolist()]
            xyxy[2], xyxy[3] = min(source.width, xyxy[2]), min(source.height, xyxy[3])
            class_id = int(box.cls[0].item())
            score = float(box.conf[0].item())
            x0, y0, x1, y1 = xyxy
            label = str(names.get(class_id, class_id))
            if kind == "yolo-world" and class_warning and classes and not any(term.lower() in label.lower() or label.lower() in term.lower() for term in classes):
                continue
            if kind == "yolo-world":
                # A detector box is only a SAM prompt, never the final erase mask.
                single = np.asarray(_boxes_to_sam_mask(source, [xyxy])).copy()
                if not single.any():
                    raise ValueError("Không tách được đường viền vật thể. Hãy chọn bằng điểm AI hoặc tô vùng thủ công.")
            else:
                single = np.zeros_like(combined)
                single[y0:y1, x0:x1] = 255
            combined = np.maximum(combined, single)
            pad = max(0, min(64, int(body.get("padding", 8))))
            if pad:
                single = cv2.dilate(single, np.ones((pad*2+1, pad*2+1), np.uint8))
            items.append({"index": index, "label": label, "confidence": score, "box": xyxy, "mask": encode_image(Image.fromarray(single, mode="L"))})
    padding = max(0, min(64, int(body.get("padding", 8))))
    if padding and combined.any():
        combined = cv2.dilate(combined, np.ones((padding * 2 + 1, padding * 2 + 1), np.uint8))
    mask = Image.fromarray(combined, mode="L")
    return {"ok": True, "model": kind, "maskMethod": "yolo-world+sam" if kind == "yolo-world" else "box", "width": source.width, "height": source.height, "detections": items, "mask": encode_image(mask), "count": len(items), "warning": class_warning}


def adetailer_refine(body: dict) -> dict:
    detected = detect_regions({**body, "model": "adetailer", "padding": body.get("padding", 12)})
    if not detected["count"]:
        raise ValueError("ADetailer không tìm thấy khuôn mặt để tinh chỉnh")
    if "faceIndices" in body:
        selected = set(int(index) for index in body["faceIndices"])
        faces = [item for item in detected["detections"] if item["index"] in selected]
        if not faces:
            raise ValueError("Hãy chọn ít nhất một khuôn mặt")
        combined = np.zeros((detected["height"], detected["width"]), dtype=np.uint8)
        for face in faces:
            combined = np.maximum(combined, np.asarray(decode_image(face["mask"]).convert("L")))
        detected["mask"] = encode_image(Image.fromarray(combined, mode="L"))
        detected["count"] = len(faces)
    request = {**body, "editableMask": detected["mask"], "prompt": body.get("prompt") or prompt_text('adetailer_refine.highly_detailed_natural_face_preserve_identity_realistic'), "negativePrompt": body.get("negativePrompt") or prompt_text('adetailer_refine.changed_identity_deformed_face_extra_eyes_blur'), "strength": body.get("strength", 0.35), "count": body.get("count", 1), "expand": 0, "blur": body.get("blur", 4)}
    result = inpaint(request)
    result["detector"] = {key: value for key, value in detected.items() if key != "mask"}
    return result


@trace_generation
def sd35_conditioned_generate(body: dict) -> dict:
    global inpaint_pipe, tryon_pipe, chroma_pipe, text_to_image_pipe, text_to_image_model_id, sdxl_control_pipe
    from sd35_depth_control import generate
    source = Image.open(safe_sample(str(body.get("sampleId", "")))).convert("RGB")
    inpaint_pipe = tryon_pipe = chroma_pipe = text_to_image_pipe = sdxl_control_pipe = None
    text_to_image_model_id = ""
    gc.collect()
    if torch.cuda.is_available(): torch.cuda.empty_cache()
    image, depth, seed = generate(source, body, ROOT, LOCAL_CONFIG, traced_pipeline_call)
    output_dir = OUTPUTS / datetime.now(timezone.utc).strftime("sd35_depth_%Y%m%dT%H%M%S%fZ")
    output_dir.mkdir(parents=True, exist_ok=False)
    image.save(output_dir / "result.png")
    depth.save(output_dir / "depth.png")
    (output_dir / "metadata.json").write_text(json.dumps({"model": "controlnet-depth-sd35-large", "seed": seed, "promptHistory": prompt_history()}, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "model": "controlnet-depth-sd35-large", "image": encode_image(image), "depth": str((output_dir / "depth.png").relative_to(ROOT)), "file": str((output_dir / "result.png").relative_to(ROOT)), "seed": seed, "promptHistory": prompt_history()}


def _load_sdxl_control_pipe():
    global sdxl_control_pipe, sdxl_control_mode, inpaint_pipe, tryon_pipe, chroma_pipe, text_to_image_pipe, text_to_image_model_id
    if sdxl_control_pipe is not None:
        return sdxl_control_pipe
    status = runtime_model_status()["models"]
    if not status["ip-adapter-sdxl"]["ready"] or not status["controlnet-depth-sdxl-small"]["ready"]:
        raise RuntimeError("IP-Adapter/ControlNet đã được tích hợp nhưng còn thiếu Stable Diffusion XL Base 1.0 tại models/text-to-image/stable-diffusion-xl-base-1.0")
    inpaint_pipe = tryon_pipe = chroma_pipe = text_to_image_pipe = None
    text_to_image_model_id = ""
    gc.collect()
    if torch.cuda.is_available(): torch.cuda.empty_cache()
    union_ready=(CONTROLNET_UNION_SDXL_ROOT / "diffusion_pytorch_model.safetensors").is_file()
    from diffusers import ControlNetModel, ControlNetUnionModel, StableDiffusionXLControlNetPipeline, StableDiffusionXLControlNetUnionPipeline
    dtype = torch.float16 if device == "cuda" else torch.float32
    controlnet_class=ControlNetUnionModel if union_ready else ControlNetModel
    pipeline_class=StableDiffusionXLControlNetUnionPipeline if union_ready else StableDiffusionXLControlNetPipeline
    control_root=CONTROLNET_UNION_SDXL_ROOT if union_ready else CONTROLNET_DEPTH_SDXL_ROOT
    control_variant = "fp16" if device == "cuda" and (control_root / "diffusion_pytorch_model.fp16.safetensors").is_file() else None
    controlnet = controlnet_class.from_pretrained(str(control_root), torch_dtype=dtype, local_files_only=True, variant=control_variant)
    pipe = pipeline_class.from_pretrained(
        str(SDXL_BASE), controlnet=controlnet, torch_dtype=dtype,
        local_files_only=True, variant="fp16"
    )
    snapshot = next(IP_ADAPTER_SDXL_ROOT.glob("snapshots/*"))
    pipe.load_ip_adapter(str(snapshot), subfolder="sdxl_models", weight_name="ip-adapter_sdxl.bin", local_files_only=True)
    if device == "cuda": pipe.enable_model_cpu_offload()
    else: pipe.to("cpu")
    sdxl_control_pipe = pipe
    sdxl_control_mode = "union-depth" if union_ready else "depth"
    return pipe


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
    if sdxl_control_mode=="union-depth": call.update(control_image=depth_image,control_mode=1)
    else: call.update(image=depth_image)
    image = traced_pipeline_call(pipe, **call).images[0]
    output_dir = OUTPUTS / datetime.now(timezone.utc).strftime("sdxl_%Y%m%dT%H%M%S%fZ")
    output_dir.mkdir(parents=True, exist_ok=False)
    image.save(output_dir / "result.png"); depth_image.save(output_dir / "depth.png")
    (output_dir / "metadata.json").write_text(json.dumps({"promptHistory": prompt_history()}, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "promptHistory": prompt_history(), "image": encode_image(image), "file": str((output_dir / "result.png").relative_to(ROOT)), "depth": str((output_dir / "depth.png").relative_to(ROOT)), "seed": seed}


def serialized_inference(function):
    @wraps(function)
    def wrapped(self):
        # Control requests must remain responsive while inference holds the lock.
        if self.path in ("/prepare-restart", "/cancel-restart", "/cancel-job", "/job-status", "/inpaint-prompts", "/new-image-plan"):
            return function(self)
        try:
            with service_lifecycle.request():
                with inference_lock:
                    return function(self)
        except RuntimeError as error:
            return self.reply(503, {"ok": False, "error": str(error)})
    return wrapped


class Handler(BaseHTTPRequestHandler):
    def reply(self, status: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            missing_tryon = [str(path.relative_to(ROOT)) for path in tryon_model_files() if not path.is_file()]
            return self.reply(200, {
                "ok": True,
                "revision": SOURCE_REVISION,
                "outpaintVersion": 2,
                "newImageVersion": 2,
                "enhanceVersion": 1,
                "characterVersion": 1,
                "manualCutoutVersion": 1, "version": APP_VERSION, "lifecycleVersion": 1, **service_lifecycle.status(),
                "character": __import__("character").configuration(ROOT),
                "makeupVersion": 1,
                "makeup": __import__("makeup").configuration(ROOT),
                "enhancement": __import__("image_enhancement").configuration(ROOT),
                "startedAt": SERVICE_STARTED_AT,
                "pid": os.getpid(),
                "device": device,
                "variant": MODEL_VARIANT,
                "inpaintModel": str(INPAINT_MODEL),
                "inpaintAvailable": INPAINT_MODEL.exists(),
                "tryonAvailable": not missing_tryon,
                "tryonMissing": missing_tryon,
                "poseAvailable": POSE_MODEL.is_file(),
                "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
                "gpuMemoryMb": round(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)) if torch.cuda.is_available() else 0,
                "diskFreeGb": round(shutil.disk_usage(ROOT).free / (1024 ** 3), 2),
                "modelsReady": INPAINT_MODEL.exists() and not missing_tryon and POSE_MODEL.is_file(),
            })
        if urlsplit(self.path).path == "/lora-status":
            try:
                return self.reply(200, lora_status(parse_qs(urlsplit(self.path).query).get("modelId", [None])[0]))
            except Exception as error:
                return self.reply(400, {"ok": False, "error": str(error)})
        if self.path == "/chroma-status":
            return self.reply(200, chroma_status())
        if self.path == "/runtime-model-status":
            return self.reply(200, runtime_model_status())
        self.reply(404, {"ok": False, "error": "Không tìm thấy endpoint"})

    @trusted_request(PORT)
    @serialized_inference
    def do_POST(self):
        if self.path not in ("/prepare-restart", "/cancel-restart", "/manual-cutout", "/character-regenerate", "/character-analyze", "/character-preview", "/character-render", "/makeup-compare", "/makeup-reference", "/makeup", "/makeup-analyze", "/enhance", "/new-image-plan", "/sd35-conditioned-generate", "/outpaint", "/inpaint-prompts", "/segment", "/analyze-people", "/auto-mask", "/preprocess-garment", "/validate-product-reference", "/qualify-product-reference", "/normalize-garment-reference", "/catvton-reference-matrix", "/catvton-dedicated-mask-matrix", "/catvton-retry-matrix", "/catvton-color-audit", "/catvton-geometry-audit", "/chroma-smoke", "/chroma-generate", "/inpaint", "/tryon", "/batch-tryon", "/regression-audit", "/cancel-job", "/job-status", "/resume-job", "/benchmark", "/lora-configure", "/lora-ab-test", "/lora-ab-matrix", "/lora-strength-matrix", "/texture-recovery-matrix", "/structural-refine-matrix", "/effective-step-matrix", "/hybrid-tryon-compare", "/detect-regions", "/adetailer-refine", "/sdxl-conditioned-generate"):
            return self.reply(404, {"ok": False, "error": "Không tìm thấy endpoint"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            max_payload = 30 * 1024 * 1024 if self.path in ("/inpaint", "/resume-job", "/tryon", "/batch-tryon", "/preprocess-garment", "/validate-product-reference", "/benchmark", "/lora-ab-test", "/lora-ab-matrix", "/lora-strength-matrix") else 2 * 1024 * 1024
            if self.path in ("/character-preview", "/character-render", "/makeup-compare", "/makeup", "/enhance", "/segment", "/auto-mask", "/inpaint-prompts"):
                max_payload = 30 * 1024 * 1024
            if length > max_payload:
                raise ValueError("Payload quá lớn")
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.path in ("/prepare-restart", "/cancel-restart"):
                if body.get("confirm") is not True:
                    return self.reply(400, {"ok": False, "error": "Thiếu xác nhận."})
                try:
                    return self.reply(200, service_lifecycle.prepare() if self.path == "/prepare-restart" else service_lifecycle.cancel(body.get("token")))
                except RuntimeError as error:
                    return self.reply(409, {"ok": False, "error": str(error)})
            if self.path == "/manual-cutout":
                from background_edit import cutout
                release_inpaint()
                release_tryon()
                release_text_to_image()
                return self.reply(200, cutout(body, ROOT, birefnet_mask))
            if self.path == "/new-image-plan":
                return self.reply(200, new_image_plan(body))
            if self.path == "/inpaint-prompts":
                entry = inpaint_model_entry(str(body.get('modelId') or '') or None)
                path = Path(entry['path']) if entry else INPAINT_MODEL
                if not path.is_absolute():
                    path = ROOT / path
                architecture = detect_inpaint_architecture(path, entry.get('architecture') if entry else None)
                resolved = resolve_inpaint_prompts(body, architecture, resolved_inpaint_profile(entry, architecture))
                from prompt_limits import preview_encoder_prompts
                try:
                    resolved['encoders'] = preview_encoder_prompts(path, architecture, resolved['prompt'], resolved['negativePrompt'], str(body.get('fillMode') or 'background'))
                except Exception:
                    resolved['encoders'] = []
                    resolved['tokenError'] = 'Không thể đọc tokenizer của model. Chưa xác định được số token.'
                return self.reply(200, {"ok": True, **resolved})
            if self.path == "/cancel-job":
                job_id = str(body.get("jobId", ""))[:80]
                if not job_id:
                    raise ValueError("Thiếu mã tác vụ")
                with job_lock:
                    previous = dict(jobs.get(job_id, {}))
                terminal = previous.get("status") in ("completed", "cancelled", "failed")
                if terminal:
                    return self.reply(200, {"ok": True, "jobId": job_id, "status": previous.get("status"), "alreadyFinished": True})
                # A request can arrive before the worker has initialized its state.
                # Keep a cancellation tombstone so startup cannot erase the request.
                status = "cancelling" if previous.get("status") == "running" else "cancelled"
                update_job(job_id, cancelRequested=True, status=status, stage="cancelled" if status == "cancelled" else previous.get("stage", "preparing"),
                           _event={"type":"job.cancel.requested", "message":"Đã nhận yêu cầu hủy an toàn"})
                return self.reply(200, {"ok": True, "jobId": job_id, "status": status})
            if self.path == "/job-status":
                job_id = str(body.get("jobId", ""))[:80]
                with job_lock:
                    state = dict(jobs.get(job_id, {"status": "unknown"}))
                return self.reply(200, {"ok": True, "jobId": job_id, **state, **job_health(state)})
            if self.path == "/resume-job":
                return self.reply(200, resume_job(body))
            if self.path == "/benchmark":
                return self.reply(200, benchmark(body))
            if self.path == "/chroma-smoke":
                return self.reply(200, chroma_smoke(body))
            if self.path == "/chroma-generate":
                return self.reply(200, chroma_generate(body))
            if self.path == "/detect-regions":
                return self.reply(200, detect_regions(body))
            if self.path == "/adetailer-refine":
                return self.reply(200, adetailer_refine(body))
            if self.path == "/sd35-conditioned-generate":
                return self.reply(200, sd35_conditioned_generate(body))
            if self.path == "/sdxl-conditioned-generate":
                return self.reply(200, sdxl_conditioned_generate(body))
            if self.path == "/lora-configure":
                return self.reply(200, configure_loras(body))
            if self.path == "/lora-ab-test":
                return self.reply(200, lora_ab_test(body))
            if self.path == "/lora-ab-matrix":
                return self.reply(200, lora_ab_matrix(body))
            if self.path == "/lora-strength-matrix":
                return self.reply(200, lora_strength_matrix(body))
            if self.path == "/texture-recovery-matrix":
                return self.reply(200, texture_recovery_matrix(body))
            if self.path == "/structural-refine-matrix":
                return self.reply(200, structural_refine_matrix(body))
            if self.path == "/effective-step-matrix":
                return self.reply(200, effective_step_matrix(body))
            if self.path == "/hybrid-tryon-compare":
                return self.reply(200, hybrid_tryon_compare(body))
            if self.path == "/normalize-garment-reference":
                return self.reply(200, normalize_reference(body))
            if self.path == "/validate-product-reference":
                return self.reply(200, validate_product_reference(body))
            if self.path == "/qualify-product-reference":
                return self.reply(200, qualify_product_reference(body))
            if self.path == "/catvton-reference-matrix":
                return self.reply(200, catvton_reference_matrix(body))
            if self.path == "/catvton-dedicated-mask-matrix":
                return self.reply(200, catvton_dedicated_mask_matrix(body))
            if self.path == "/catvton-retry-matrix":
                return self.reply(200, catvton_retry_matrix(body))
            if self.path == "/catvton-color-audit":
                return self.reply(200, catvton_color_audit(body))
            if self.path == "/catvton-geometry-audit":
                return self.reply(200, catvton_geometry_audit(body))
            if self.path == "/character-regenerate":
                from character_workflow import regenerate
                return self.reply(200, regenerate(body, globals()))
            if self.path in ("/character-analyze", "/character-preview", "/character-render"):
                import character
                handler={"/character-analyze":character.analyze,"/character-preview":character.plan,"/character-render":character.run}[self.path]
                return self.reply(200, handler(body, globals()))
            if self.path == "/makeup-compare":
                from makeup_comparison import run
                return self.reply(200, run(body, globals()))
            if self.path == "/makeup-reference":
                from makeup_reference import analyze
                return self.reply(200, analyze(body, globals()))
            if self.path == "/makeup-analyze":
                from makeup import analyze
                return self.reply(200, analyze(body, globals()))
            if self.path == "/makeup":
                from makeup import run
                return self.reply(200, run(body, globals()))
            if self.path == "/enhance":
                from image_enhancement import enhance
                return self.reply(200, enhance(body, globals()))
            if self.path == "/outpaint":
                return self.reply(200, outpaint(body))
            if self.path == "/inpaint":
                return self.reply(200, inpaint(body))
            if self.path == "/tryon":
                return self.reply(200, tryon(body))
            if self.path == "/batch-tryon":
                return self.reply(200, batch_tryon(body))
            if self.path == "/auto-mask":
                return self.reply(200, auto_mask(body))
            if self.path == "/analyze-people":
                return self.reply(200, analyze_people(body))
            if self.path == "/preprocess-garment":
                return self.reply(200, preprocess_garment(body))
            if self.path == "/regression-audit":
                return self.reply(200, regression_audit(body))
            self.reply(200, segment_object_mask(body))
        except Exception as error:
            failed_job_id = str(locals().get("body", {}).get("jobId", ""))[:80]
            if failed_job_id and self.path not in ("/job-status", "/cancel-job"):
                update_job(failed_job_id, status="cancelled" if "hủy" in str(error).lower() else "failed", stage="cancelled" if "hủy" in str(error).lower() else "failed", error=str(error), _event={"type":"job.failed", "message":str(error)})
            self.reply(400, {"ok": False, "error": str(error)})

    def log_message(self, fmt, *args):
        print(f"[SAM2] {self.address_string()} - {fmt % args}")


if __name__ == "__main__":
    print(f"SAM 2 service: http://{HOST}:{PORT} · device={device} · variant={MODEL_VARIANT}")
    load_predictor()
    load_persisted_jobs()
    mark_model_config_applied()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

