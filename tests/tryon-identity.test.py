from helpers.ai_source import read_source
"""Protected pixels must survive dilation, feathering, cropping and repairs."""
import ast
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

tree = ast.parse(read_source(Path(__file__).resolve().parents[1] / 'ai_service.py', encoding='utf-8'))
names = {'exclude_protected_pixels', 'restore_protected_pixels'}
namespace = {'np': np, 'Image': Image}
exec(compile(ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names], type_ignores=[]), '<identity>', 'exec'), namespace)
exclude, restore = (namespace[name] for name in ('exclude_protected_pixels', 'restore_protected_pixels'))
protected = Image.new('L', (80, 100), 0)
protected.paste(255, (25, 5, 55, 35))
mask = exclude(Image.new('L', protected.size, 255), protected)
hard = exclude(mask.filter(ImageFilter.MaxFilter(17)), protected)
blend = exclude(hard.filter(ImageFilter.GaussianBlur(5)), protected)
selected = np.asarray(protected) > 0
assert not np.asarray(hard)[selected].any()
assert not np.asarray(blend)[selected].any()
source = Image.fromarray(np.random.default_rng(42).integers(0, 256, (100, 80, 3), dtype=np.uint8))
generated = Image.new('RGB', source.size, 'red')
for candidate in (Image.composite(generated, source, blend), generated):
    output = restore(source, candidate, protected)
    assert np.array_equal(np.asarray(output)[selected], np.asarray(source)[selected])
    assert np.array_equal(np.asarray(output)[~selected], np.asarray(candidate)[~selected])
crop = (15, 0, 65, 90)
crop_mask = exclude(Image.new('L', (50, 90), 255), protected.crop(crop))
assert not np.asarray(crop_mask)[np.asarray(protected.crop(crop)) > 0].any()
print('OK: protected identity is pixel-exact after expansion, blur, crop and postprocessing.')
