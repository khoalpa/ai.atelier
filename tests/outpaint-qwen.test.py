import ast
from pathlib import Path


root = Path(__file__).resolve().parents[1]
source_path = root / 'services' / 'ai' / 'tasks' / 'outpaint.py'
tree = ast.parse(source_path.read_text(encoding='utf-8'))
helpers = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ('outpaint_pipeline_kwargs','effective_seam_width')]
namespace = {}
exec(compile(ast.Module(body=helpers, type_ignores=[]), str(source_path), 'exec'), namespace)

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

geometry=dict(left=38,right=38,top=38,bottom=38)
assert namespace['effective_seam_width'](48,geometry) == 19
assert namespace['effective_seam_width'](48,dict(left=128,right=0,top=0,bottom=0)) == 32

source = source_path.read_text(encoding='utf-8')
assert '"qwen-image-controlnet-inpaint")' in source
print('OK: Outpainting maps canvas and mask to the Qwen ControlNet API.')
