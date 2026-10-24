"""AI Atelier: models.pipelines."""
from PIL import Image, ImageFilter, ImageOps
from pathlib import Path
import cv2
import gc
import hashlib
import json
import numpy as np
import os
import torch
from services.ai.models import state as model_state
from services.ai.runtime.configuration import ADETAILER_ROOT, BIREFNET_ROOT, CATVTON_BASE, CATVTON_MODEL, CATVTON_ROOT, CATVTON_VAE, CHROMA_ROOT, CONTROLNET_DEPTH_SDXL_ROOT, CONTROLNET_UNION_SDXL_ROOT, DENSEPOSE_SCRIPT, FLORENCE_ROOT, GROUNDING_DINO_ROOT, IDMVTON_MODEL, IDMVTON_ROOT, INPAINT_ARCHITECTURE, INPAINT_MODEL, IP_ADAPTER_SDXL_ROOT, LORA_REGISTRY, LORA_ROOT, MODELS, MODEL_TABLE, MODEL_VARIANT, POSE_MODEL, ROOT, SDXL_BASE, YOLO_WORLD_ROOT, device


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
        "pipelineLoaded": model_state.chroma_pipe is not None,
        "activated": not missing,
        "loadMode": "on-demand",
        "smokePassed": bool(latest and latest.get("passed")),
        "latestSmoke": str(smoke_reports[0].relative_to(ROOT)) if smoke_reports else "",
        "latest": latest,
    }


def load_chroma_pipe():
    if model_state.chroma_pipe is not None:
        return model_state.chroma_pipe
    missing = [path for path in chroma_required_files() if not path.is_file()]
    if missing:
        raise RuntimeError("Chroma còn thiếu dependency: " + ", ".join(display_model_path(path) for path in missing))
    if not torch.cuda.is_available():
        raise RuntimeError("Chroma1-HD yêu cầu CUDA cho cấu hình phát hành này")
    model_state.inpaint_pipe = None
    model_state.tryon_pipe = None
    model_state.text_to_image_pipe = None
    model_state.text_to_image_model_id = ""
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
    model_state.chroma_pipe = ChromaPipeline.from_pretrained(
        str(CHROMA_ROOT), transformer=transformer, torch_dtype=torch.bfloat16, local_files_only=True
    )
    if torch.cuda.get_device_properties(0).total_memory < 24 * 1024 ** 3:
        # BF16 Chroma's transformer does not fit on a 16 GB GPU as a whole.
        from diffusers.hooks import apply_group_offloading
        model_state.chroma_pipe.transformer.enable_group_offload(onload_device=torch.device('cuda'),
            offload_device=torch.device('cpu'), offload_type='block_level', num_blocks_per_group=2)
        apply_group_offloading(model_state.chroma_pipe.text_encoder, onload_device=torch.device('cuda'),
            offload_device=torch.device('cpu'), offload_type='leaf_level')
        model_state.chroma_pipe.vae.to('cuda')
        model_state.chroma_pipe._atelier_offload = 'group'
    else:
        model_state.chroma_pipe.enable_model_cpu_offload()
        model_state.chroma_pipe._atelier_offload = 'model'
    configure_vae_memory(model_state.chroma_pipe)
    return model_state.chroma_pipe


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
    if model_id == "flux-chroma1-hd":
        return load_chroma_pipe()
    if model_state.text_to_image_pipe is not None and model_state.text_to_image_model_id == model_id:
        return model_state.text_to_image_pipe
    model_path = text_to_image_model_path(model_id)
    if not (model_path / "model_index.json").is_file():
        raise RuntimeError(f"Model {model_id} chưa được tải đầy đủ tại {display_model_path(model_path)}")
    if model_id == "flux-2-klein-4b" and not (model_path / "installation.json").is_file():
        raise RuntimeError("FLUX.2 klein chưa tải xong hoặc chưa được kiểm tra checksum")
    model_state.text_to_image_pipe = None
    model_state.text_to_image_model_id = ""
    model_state.chroma_pipe = model_state.inpaint_pipe = model_state.tryon_pipe = model_state.sdxl_control_pipe = None
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
    model_state.text_to_image_pipe = pipe
    model_state.text_to_image_model_id = model_id
    return model_state.text_to_image_pipe


def load_predictor():
    if model_state.predictor is not None:
        return model_state.predictor
    if MODEL_VARIANT not in MODEL_TABLE:
        raise RuntimeError(f"SAM2_VARIANT không hợp lệ: {MODEL_VARIANT}")
    checkpoint_name, config_name = MODEL_TABLE[MODEL_VARIANT]
    checkpoint = MODELS / checkpoint_name
    if not checkpoint.exists():
        raise RuntimeError(f"Thiếu checkpoint: {checkpoint}")
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor

    model = build_sam2(config_name, str(checkpoint), device=device)
    model_state.predictor = SAM2ImagePredictor(model)
    return model_state.predictor


def load_pose_model():
    if model_state.pose_model is None:
        if not POSE_MODEL.is_file():
            raise RuntimeError(f"Thiếu model pose: {POSE_MODEL}")
        from ultralytics import YOLO
        model_state.pose_model = YOLO(str(POSE_MODEL))
    return model_state.pose_model


def birefnet_mask(image: Image.Image) -> Image.Image | None:
    """Return a high-resolution foreground mask when the local BiRefNet is available."""
    if not (BIREFNET_ROOT / "model.safetensors").is_file():
        return None
    if model_state.birefnet_model is None:
        from transformers import AutoModelForImageSegmentation
        model_state.birefnet_model = AutoModelForImageSegmentation.from_pretrained(
            str(BIREFNET_ROOT), trust_remote_code=True, local_files_only=True
        ).to(device).eval()
    resized = image.convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS)
    array = np.asarray(resized, dtype=np.float32) / 255.0
    array = (array - np.asarray([0.485, 0.456, 0.406], dtype=np.float32)) / np.asarray([0.229, 0.224, 0.225], dtype=np.float32)
    tensor = torch.from_numpy(array.transpose(2, 0, 1)).unsqueeze(0).to(device)
    with torch.inference_mode(), torch.autocast(device_type=device, dtype=torch.float16, enabled=device == "cuda"):
        output = model_state.birefnet_model(tensor)
        prediction = output[-1] if isinstance(output, (list, tuple)) else output.logits
        prediction = prediction.sigmoid().float().cpu().squeeze().numpy()
    return Image.fromarray(np.clip(prediction * 255, 0, 255).astype(np.uint8), mode="L").resize(image.size, Image.Resampling.BILINEAR)


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
    if model_state.vision_checker is None:
        from diffusers.pipelines.stable_diffusion.safety_checker import StableDiffusionSafetyChecker
        from transformers import CLIPImageProcessor
        model_state.vision_checker = StableDiffusionSafetyChecker.from_pretrained(
            CATVTON_BASE / "safety_checker", local_files_only=True
        ).to("cpu")
        model_state.vision_checker.eval()
        model_state.vision_processor = CLIPImageProcessor.from_pretrained(CATVTON_BASE / "feature_extractor", local_files_only=True)
    inputs = model_state.vision_processor(images=image.convert("RGB"), return_tensors="pt")
    with torch.inference_mode():
        pooled = model_state.vision_checker.vision_model(inputs.pixel_values)[1]
        embedding = model_state.vision_checker.visual_projection(pooled).float().cpu().numpy()[0]
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
    model_path = model_path or INPAINT_MODEL
    architecture = architecture or detect_inpaint_architecture(model_path)
    if model_state.inpaint_pipe is not None:
        if progress:
            progress("ready", "Model đã có sẵn trong bộ nhớ")
        return model_state.inpaint_pipe
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
    model_state.inpaint_pipe = loaded_pipe
    apply_active_loras()
    if progress:
        progress("ready", "Model đã sẵn sàng")
    return model_state.inpaint_pipe


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
    public_active = [{key: value for key, value in item.items() if key != "path"} for item in model_state.active_loras if item.get("modelPath") == context["path"]]
    return {"ok": True, "root": str(LORA_ROOT), "baseModel": context["family"], "model": context, "adapters": adapters, "active": public_active, "pipelineLoaded": model_state.inpaint_pipe is not None and getattr(model_state.inpaint_pipe, "_atelier_model_path", None) == context["path"]}


def apply_active_loras():
    if model_state.inpaint_pipe is None:
        return
    model_state.inpaint_pipe.unload_lora_weights()
    selected_loras = [item for item in model_state.active_loras if item.get("modelPath") == getattr(model_state.inpaint_pipe, "_atelier_model_path", None)]
    for selected in selected_loras:
        model_state.inpaint_pipe.load_lora_weights(str(selected["path"]), adapter_name=selected["id"])
    if selected_loras:
        model_state.inpaint_pipe.set_adapters([item["id"] for item in selected_loras], adapter_weights=[item["weight"] for item in selected_loras])


def configure_loras(body: dict) -> dict:
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
    previous = model_state.active_loras
    model_state.active_loras = [item for item in model_state.active_loras if item.get("modelPath") != context["path"]] + selected
    try:
        apply_active_loras()
    except Exception:
        model_state.active_loras = previous
        release_inpaint()
        raise
    return {"ok": True, "active": [{key: value for key, value in item.items() if key != "path"} for item in selected], "pipelineLoaded": model_state.inpaint_pipe is not None}


def release_inpaint():
    if model_state.inpaint_pipe is not None:
        del model_state.inpaint_pipe
        model_state.inpaint_pipe = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def release_tryon():
    model_state.tryon_pipe_model_id = ""
    if model_state.tryon_pipe is not None:
        del model_state.tryon_pipe
        model_state.tryon_pipe = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def release_text_to_image():
    model_state.text_to_image_pipe = None
    model_state.text_to_image_model_id = ""
    model_state.chroma_pipe = None
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
    if model_id not in ("catvton", "idm-vton"):
        raise ValueError(f"Model thay trang phục không được hỗ trợ: {model_id}")
    if model_state.tryon_pipe is not None and model_state.tryon_pipe_model_id != model_id:
        release_tryon()
    if model_state.tryon_pipe is not None:
        return model_state.tryon_pipe
    if model_id == "idm-vton":
        if not DENSEPOSE_SCRIPT.is_file():
            raise RuntimeError("Thiếu DensePose TorchScript cho IDM-VTON. Chạy scripts/setup-idm-vton.ps1.")
        release_inpaint()
        release_text_to_image()
        from idm_vton_runtime import load_pipeline
        model_state.tryon_pipe = load_pipeline(IDMVTON_MODEL, IDMVTON_ROOT, device)
        model_state.tryon_pipe_model_id = model_id
        return model_state.tryon_pipe
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
    model_state.tryon_pipe = CatVTONPipeline(
        base_ckpt=str(CATVTON_BASE), attn_ckpt=str(CATVTON_MODEL),
        attn_ckpt_version="mix", weight_dtype=torch.bfloat16,
        device=device, use_tf32=True,
    )
    model_state.tryon_pipe_model_id = model_id
    return model_state.tryon_pipe


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
            "adetailer": {"ready": ADETAILER_ROOT.exists(), "loaded": model_state.adetailer_model is not None, "capability": "face-hand-person detection and detail mask"},
            "yolo-world": {"ready": YOLO_WORLD_ROOT.exists() and clip_file.is_file(), "loaded": model_state.yolo_world_model is not None, "capability": "open-vocabulary detection", "clipReady": clip_file.is_file()},
            "grounding-dino-base": {"ready": (GROUNDING_DINO_ROOT / "config.json").is_file(), "loaded": model_state.grounding_dino_model is not None, "capability": "text-to-box with SAM mask refinement"},
            "florence-2-large": {"ready": (FLORENCE_ROOT / "config.json").is_file(), "loaded": model_state.florence_model is not None, "capability": "vision grounding with SAM mask refinement"},
            "birefnet": {"ready": (BIREFNET_ROOT / "model.safetensors").is_file(), "loaded": model_state.birefnet_model is not None, "capability": "garment and foreground extraction"},
            "ip-adapter-sdxl": {"ready": bool(adapter_file and sdxl_ready), "filesReady": bool(adapter_file), "baseReady": sdxl_ready, "loaded": model_state.sdxl_control_pipe is not None, "missing": [str(item) for item in sdxl_files if not item.is_file()]},
            "controlnet-depth-sdxl-small": {"ready": control_file.is_file() and sdxl_ready, "filesReady": control_file.is_file(), "baseReady": sdxl_ready, "loaded": model_state.sdxl_control_pipe is not None, "missing": [str(item) for item in sdxl_files if not item.is_file()]},
            "controlnet-union-sdxl-1.0": {"ready": union_file.is_file() and sdxl_ready, "filesReady": union_file.is_file(), "baseReady": sdxl_ready, "loaded": model_state.sdxl_control_pipe is not None and model_state.sdxl_control_mode == "union-depth", "missing": [str(item) for item in sdxl_files if not item.is_file()]},
        },
    }


def _detector(kind: str):
    from ultralytics import YOLO, YOLOWorld
    if kind == "yolo-world":
        if model_state.yolo_world_model is None:
            model_state.yolo_world_model = YOLOWorld(str(_first_file(YOLO_WORLD_ROOT, "yolov8x-worldv2.pt")))
        return model_state.yolo_world_model
    if model_state.adetailer_model is None:
        model_state.adetailer_model = YOLO(str(_first_file(ADETAILER_ROOT, "face_yolov8n.pt")))
    return model_state.adetailer_model


def _transformer_detector(kind: str):
    from transformers import AutoModelForCausalLM, AutoModelForZeroShotObjectDetection, AutoProcessor
    dtype = torch.float16 if device == "cuda" else torch.float32
    if kind == "grounding-dino":
        if model_state.grounding_dino_model is None:
            model_state.grounding_dino_processor = AutoProcessor.from_pretrained(str(GROUNDING_DINO_ROOT), local_files_only=True)
            model_state.grounding_dino_model = AutoModelForZeroShotObjectDetection.from_pretrained(str(GROUNDING_DINO_ROOT), local_files_only=True, torch_dtype=dtype).to(device).eval()
        return model_state.grounding_dino_model, model_state.grounding_dino_processor
    if model_state.florence_model is None:
        model_state.florence_processor = AutoProcessor.from_pretrained(str(FLORENCE_ROOT), trust_remote_code=True, local_files_only=True)
        model_state.florence_model = AutoModelForCausalLM.from_pretrained(str(FLORENCE_ROOT), trust_remote_code=True, local_files_only=True, torch_dtype=dtype).to(device).eval()
    return model_state.florence_model, model_state.florence_processor


def _load_sdxl_control_pipe():
    if model_state.sdxl_control_pipe is not None:
        return model_state.sdxl_control_pipe
    status = runtime_model_status()["models"]
    if not status["ip-adapter-sdxl"]["ready"] or not status["controlnet-depth-sdxl-small"]["ready"]:
        raise RuntimeError("IP-Adapter/ControlNet đã được tích hợp nhưng còn thiếu Stable Diffusion XL Base 1.0 tại models/text-to-image/stable-diffusion-xl-base-1.0")
    model_state.inpaint_pipe = model_state.tryon_pipe = model_state.chroma_pipe = model_state.text_to_image_pipe = None
    model_state.text_to_image_model_id = ""
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
    model_state.sdxl_control_pipe = pipe
    model_state.sdxl_control_mode = "union-depth" if union_ready else "depth"
    return pipe
