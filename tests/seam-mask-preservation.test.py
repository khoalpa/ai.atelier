"""Seam repair cannot spill onto unselected pixels, even after feathering."""
import ast
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageFilter

tree = ast.parse((Path(__file__).resolve().parents[1] / 'ai_service.py').read_text(encoding='utf-8'))
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'repair_local_seams')
scope = dict(np=np, cv2=cv2, Image=Image, ImageFilter=ImageFilter)
exec(compile(ast.Module(body=[fn], type_ignores=[]), '<seam>', 'exec'), scope)
rng = np.random.default_rng(7)
pixels = rng.integers(0, 256, (96, 96, 3), dtype=np.uint8)
source = Image.fromarray(pixels)
mask = np.zeros((96, 96), dtype=np.uint8)
mask[24:72, 24:72] = 255
mask[40:48, 40:48] = 0  # Protected island within selected fabric.
result, repaired_mask, count = scope['repair_local_seams'](source, source, Image.fromarray(mask))
assert count > 0
assert np.array_equal(np.asarray(result)[mask == 0], pixels[mask == 0])
assert not np.asarray(repaired_mask)[mask == 0].any()
empty, _, count = scope['repair_local_seams'](source, source, Image.new('L', source.size))
assert count == 0 and np.array_equal(np.asarray(empty), pixels)
print('OK: seam repair preserves outside pixels and protected holes; empty mask is unchanged.')
