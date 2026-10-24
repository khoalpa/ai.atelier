from helpers.ai_source import read_source
import ast
from pathlib import Path
import numpy as np
import cv2

tree = ast.parse(read_source(Path(__file__).resolve().parents[1] / 'ai_service.py', encoding='utf-8'))
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'fill_garment_mask_holes')
ns = {'np': np, 'cv2': cv2}
exec(compile(ast.Module(body=[fn], type_ignores=[]), '<holes>', 'exec'), ns)
mask = np.zeros((200, 200), dtype=np.uint8)
mask[20:180, 30:170] = 1
mask[40:45, 80:86] = 0  # highlight gap
mask[60:66, 100:108] = 0  # sleeve texture
mask[20:55, 115:135] = 0  # open neckline
mask[100:170, 60:95] = 0  # large intentional opening
fixed = ns['fill_garment_mask_holes'](mask)
assert fixed[42, 82] == 1 and fixed[62, 103] == 1
assert fixed[30, 120] == 0
assert fixed[130, 70] == 0
assert not fixed[:20].any()
assert np.array_equal(ns['fill_garment_mask_holes'](np.zeros_like(mask)), np.zeros_like(mask))
print('OK: shirt highlights filled; neckline, large openings and background preserved.')
