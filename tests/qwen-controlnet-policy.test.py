import ast
import json
from pathlib import Path


root = Path(__file__).resolve().parents[1]
registry = json.loads((root / "models" / "registry.json").read_text(encoding="utf-8"))
models = {item["id"]: item for item in registry["models"]}

inpaint = models["qwen-image-controlnet-inpainting"]
depth = models["qwen-image-controlnet-union"]
assert inpaint["architecture"] == "qwen-image-controlnet-inpaint"
assert inpaint["pipeline"] == "QwenImageControlNetInpaintPipeline"
assert depth["pipeline"] == "QwenImageControlNetPipeline"
assert inpaint["textEncoder"] == depth["textEncoder"] == "qwen"
assert inpaint["baseModelPath"] == depth["baseModelPath"] == "models/qwen/qwen-image"

pipelines = (root / "services" / "ai" / "models" / "pipelines.py").read_text(encoding="utf-8")
generate = (root / "services" / "ai" / "tasks" / "generate.py").read_text(encoding="utf-8")
inpaint_task = (root / "services" / "ai" / "tasks" / "inpaint.py").read_text(encoding="utf-8")
ast.parse(pipelines)
ast.parse(generate)
ast.parse(inpaint_task)
assert "QwenImageControlNetInpaintPipeline" in pipelines
assert 'pipe._atelier_offload = "group"' in pipelines
assert '"control_mask": region_mask' in inpaint_task
assert "def qwen_depth_generate" in generate
assert "controlnet_conditioning_scale" in generate
print("OK: Qwen inpainting and depth pipelines share the Qwen base and enforce low-VRAM offload.")
