from helpers.ai_source import read_source
"""Reconstruction includes old fabric, respecting explicit and identity protection."""
import ast
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

root = Path(__file__).resolve().parents[1]
tree = ast.parse(read_source(root / 'ai_service.py', encoding='utf-8'))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'reconstruction_edit_mask')
namespace = {'np': np, 'Image': Image}
exec(compile(ast.Module(body=[function], type_ignores=[]), '<reconstruction>', 'exec'), namespace)
selected = Image.new('L', (100, 120), 0)
selected.paste(255, (30, 40, 70, 65))
old = Image.new('L', selected.size, 0)
old.paste(255, (20, 25, 80, 100))  # sleeves and trouser legs outside the small manual selection
protected = Image.new('L', selected.size, 0)
protected.paste(255, (35, 10, 65, 35))  # head
protected.paste(255, (20, 55, 30, 70))  # explicitly protected hand
result, added = namespace['reconstruction_edit_mask'](selected, old, protected)
r, a, p = np.asarray(result), np.asarray(added), np.asarray(protected)>0
assert r[80, 50] == 255  # old trousers can be reconstructed below a shorter new garment
assert r[45, 25] == 255  # old sleeve can become visible skin
assert r[50, 50] == 255 and a[50, 50] == 0  # original selection remains
assert a[80, 50] == 255
assert not r[p].any() and not a[p].any()
assert r[110, 50] == 0  # background stays outside the edit
auto, auto_added = namespace['reconstruction_edit_mask'](old, old, protected)
assert not np.asarray(auto_added).any()
assert np.array_equal(np.asarray(auto), np.where(p, 0, np.asarray(old)))
html = read_source(root / 'app/public/index.html', encoding='utf-8')
js = read_source(root / 'app/public/app.js', encoding='utf-8')
assert 'id="reconstructExposedBodyToggle" type="checkbox"' in html and 'id="reconstructExposedBodyToggle" type="checkbox" role="switch" checked' in html
assert js.count("reconstructExposedBody:$('reconstructExposedBodyToggle').checked") == 2
head_function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'automatic_protected_detail_mask')
namespace['cv2'] = cv2
namespace['ROOT'] = root
exec(compile(ast.Module(body=[head_function], type_ignores=[]), '<head>', 'exec'), namespace)
points = [[50, 20, 1.0] for _ in range(17)]
points[5], points[6] = [30, 40, 1.0], [70, 40, 1.0]
points[9], points[10] = [20, 80, 1.0], [80, 80, 1.0]
test_source = Image.new('RGB', (100, 150), (120, 150, 195))
test_source.paste((205, 150, 115), (12, 73, 29, 100))
identity = np.asarray(namespace['automatic_protected_detail_mask'](test_source, [10, 5, 90, 145], points))
assert identity[20, 50] == 255
assert identity[50, 50] == 0  # collar/chest must remain editable for a lower neckline
assert identity[80, 20] == 255
assert identity[80, 30] == 0  # adjacent blue cuff is editable, even inside wrist circle
print('OK: old sleeve/leg coverage added, background/head/hands protected; single and batch controls wired.')
