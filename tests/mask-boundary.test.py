from helpers.ai_source import read_source
import ast
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

tree = ast.parse(read_source(Path('ai_service.py'), encoding='utf-8'))
ns = {'np': np, 'cv2': cv2, 'Image': Image}
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'adaptive_local_edge_blend'], type_ignores=[]), '<blend>', 'exec'), ns)
blend = ns['adaptive_local_edge_blend']
source = Image.new('RGB', (160, 160), (100, 120, 140))
generated = Image.new('RGB', source.size, (125, 145, 165))
mask = Image.new('L', source.size)
mask.paste(255, (20, 20, 140, 140))
result, _, metrics = blend(source, generated, mask, 12)
arr = np.asarray(result)
assert np.array_equal(arr[np.asarray(mask) == 0], np.asarray(source)[np.asarray(mask) == 0])
assert np.array_equal(arr[80, 80], np.asarray(generated)[80, 80])
assert abs(int(arr[80, 26, 0]) - 100) < 7
assert metrics['boundaryColorMatch']
empty, _, _ = blend(source, generated, Image.new('L', source.size), 12)
assert np.array_equal(np.asarray(empty), np.asarray(source))
print('OK: boundary color match, unchanged core, exact outside-mask preservation, empty mask.')
