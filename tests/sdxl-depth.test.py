from helpers.ai_source import read_source
"""Check depth inference, orientation, and delivery to both SDXL ControlNets."""
import ast
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
import torch
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import sd35_depth_control as depth

class Processor:
    @classmethod
    def from_pretrained(cls, path, **options):
        assert options['local_files_only']
        return cls()
    def __call__(self, **options):
        assert options['images'].size == (2, 2)
        return {}

class Estimator:
    @classmethod
    def from_pretrained(cls, path, **options):
        assert options['local_files_only']
        return cls()
    def eval(self):
        return self
    def __call__(self, **options):
        return SimpleNamespace(predicted_depth=torch.tensor([[[0., 1.], [2., 3.]]]))

with patch.dict(sys.modules, {'transformers': SimpleNamespace(AutoImageProcessor=Processor, AutoModelForDepthEstimation=Estimator)}):
    source = Image.new('RGB', (2, 2), 'white')
    direct = np.asarray(depth.depth_image(source, ROOT, invert=False))
    inverted = np.asarray(depth.depth_image(source, ROOT))
    # A uniform source still yields the model's spatial prediction, not luminance.
    assert direct[0, 0, 0] == 0 and direct[1, 1, 0] == 255
    assert inverted[0, 0, 0] == 255 and inverted[1, 1, 0] == 0

tree = ast.parse(read_source(ROOT / 'ai_service.py', encoding='utf-8'))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'sdxl_conditioned_generate')
function.decorator_list = []
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / 'source.png').parent.mkdir(parents=True, exist_ok=True)
    Image.new('RGB', (128, 96)).save(root / 'source.png')
    for mode in ('depth', 'union-depth'):
        calls = []
        generated_depth = Image.new('RGB', (128, 128), 'gray')
        pipe = SimpleNamespace(set_ip_adapter_scale=lambda value: None)
        def call(pipeline, **options):
            calls.append(options)
            return SimpleNamespace(images=[Image.new('RGB', (128, 128))])
        from datetime import datetime, timezone
        import json
        scope = dict(ROOT=root, LOCAL_CONFIG={'depthEstimatorModel': 'depth-local'}, Image=Image,
                     safe_sample=lambda name:root/'source.png', decode_image=lambda value:Image.new('RGB', (10, 10)),
                     _load_sdxl_control_pipe=lambda:pipe, sdxl_control_mode=mode, torch=torch,
                     traced_pipeline_call=call, OUTPUTS=root/'outputs', datetime=SimpleNamespace(now=lambda _:datetime(2026,10,24,tzinfo=timezone.utc)), timezone=timezone,
                     json=json, prompt_history=lambda:[], encode_image=lambda image:'encoded')
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<sdxl>', 'exec'), scope)
        with patch.object(depth, 'depth_image', return_value=generated_depth) as estimate:
            result = scope['sdxl_conditioned_generate']({'prompt':'test', 'negativePrompt':'blur', 'seed':37})
        assert estimate.call_args.args[1] == root/'depth-local'
        assert estimate.call_args.kwargs == {'invert':False}
        assert calls[0]['control_image' if mode=='union-depth' else 'image'] is generated_depth
        assert calls[0]['generator'].initial_seed() == 37
        assert (root/result['depth']).is_file()
print('OK: model depth, SDXL orientation, both conditioning APIs, seed and depth artifact verified.')
