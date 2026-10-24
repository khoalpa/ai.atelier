"""Exercise loader memory policy without loading model weights."""
import ast
import os
import sys
import types
from pathlib import Path
from unittest.mock import Mock

source = ast.parse((Path(__file__).resolve().parents[1] / 'ai_service.py').read_text(encoding='utf-8'))
loader = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'load_inpaint_pipe')
vae_memory = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'configure_vae_memory')
for architecture, memory_gb, expected in [('flux', 16, 'sequential'), ('flux', 32, 'model'), ('sdxl', 16, 'model')]:
    pipe = Mock()
    factory = Mock(from_pretrained=Mock(return_value=pipe))
    sys.modules['diffusers'] = types.SimpleNamespace(**{name: factory for name in ['FluxFillPipeline', 'StableDiffusion3InpaintPipeline', 'StableDiffusionInpaintPipeline', 'StableDiffusionXLInpaintPipeline']})
    namespace = dict(Path=Path, os=os, inpaint_pipe=None, INPAINT_MODEL=Path('.'), device='cuda',
                     torch=types.SimpleNamespace(bfloat16='bf16', float16='fp16', cuda=types.SimpleNamespace(get_device_properties=lambda _: types.SimpleNamespace(total_memory=memory_gb * 1024 ** 3))),
                     release_tryon=Mock(), release_text_to_image=Mock(), apply_active_loras=Mock())
    exec(compile(ast.Module(body=[vae_memory, loader], type_ignores=[]), '<loader>', 'exec'), namespace)
    namespace['load_inpaint_pipe'](architecture=architecture)
    assert pipe.enable_sequential_cpu_offload.call_count == (expected == 'sequential')
    assert pipe.enable_model_cpu_offload.call_count == (expected == 'model')
    pipe.enable_vae_tiling.assert_called_once()
    pipe.enable_vae_slicing.assert_called_once()
print('OK: FLUX uses layer offload on 16 GB; larger GPUs and SDXL retain model offload.')
