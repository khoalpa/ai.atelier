import ast
from pathlib import Path


root = Path(__file__).resolve().parents[1]
source_path = root / 'services' / 'ai' / 'tasks' / 'outpaint.py'
tree = ast.parse(source_path.read_text(encoding='utf-8'))
helper = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'outpaint_pipeline_kwargs')
namespace = {}
exec(compile(ast.Module(body=[helper], type_ignores=[]), str(source_path), 'exec'), namespace)

marker = object()
kwargs = namespace['outpaint_pipeline_kwargs'](
    'qwen-image-controlnet-inpaint', prompt='continue the scene', negative='seam', image='canvas', mask='mask',
    width=768, height=512, steps=30, guidance=4, generator=marker, callback=marker, control_scale=2,
    prompt_cache=marker, strength=.35)
assert kwargs['control_image'] == 'canvas' and kwargs['control_mask'] == 'mask'
assert kwargs['true_cfg_scale'] == 4 and kwargs['controlnet_conditioning_scale'] == 1.5
assert kwargs['negative_prompt'] == 'seam'
for forbidden in ('image', 'mask_image', 'strength', 'guidance_scale', '_prompt_cache'):
    assert forbidden not in kwargs

source = source_path.read_text(encoding='utf-8')
assert '"qwen-image-controlnet-inpaint")' in source
print('OK: Outpainting maps canvas and mask to the Qwen ControlNet API.')
