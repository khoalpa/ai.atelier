"""AI Atelier: runtime.configuration."""
from datetime import datetime, timezone
from pathlib import Path
from service_lifecycle import ServiceLifecycle
import hashlib
import json
import os
import threading
import torch


ROOT = Path(__file__).resolve().parents[3]


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


inference_lock = threading.RLock()


device = "cuda" if torch.cuda.is_available() else "cpu"


INPAINT_MODEL = configured_path("INPAINT_MODEL", "inpaintModel", ROOT / "models" / "controlnet" / "qwen-image-inpainting")


INPAINT_ARCHITECTURE = str(os.environ.get("INPAINT_ARCHITECTURE") or LOCAL_CONFIG.get("inpaintArchitecture") or "auto").lower()


CATVTON_ROOT = configured_path("CATVTON_ROOT", "catvtonRoot", ROOT / "vendor" / "CatVTON")


IDMVTON_ROOT = configured_path("IDMVTON_ROOT", "idmVtonRoot", ROOT / "vendor" / "IDM-VTON")


IDMVTON_MODEL = configured_path("IDMVTON_MODEL", "idmVtonModel", ROOT / "models" / "tryon" / "IDM-VTON")


DENSEPOSE_SCRIPT = configured_path("DENSEPOSE_SCRIPT", "denseposeScript", ROOT / "models" / "pose" / "densepose" / "densepose_r50_fpn_dl_fixed.torchscript")


CATVTON_MODEL = configured_path("CATVTON_MODEL", "catvtonModel", ROOT / "models" / "tryon" / "CatVTON")


CATVTON_BASE = configured_path("CATVTON_BASE", "catvtonBase", ROOT / "models" / "tryon" / "stable-diffusion-inpainting")


CATVTON_VAE = configured_path("CATVTON_VAE", "catvtonVae", ROOT / "models" / "tryon" / "sd-vae-ft-mse")


POSE_MODEL = configured_path("POSE_MODEL", "poseModel", ROOT / "models" / "pose" / "yolo11n-pose.pt")


DWPOSE_ROOT = configured_path("DWPOSE_MODEL", "dwposeModel", ROOT / "models" / "pose" / "dwpose")


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
