import ast
from pathlib import Path
import numpy as np

tree = ast.parse((Path(__file__).resolve().parents[1] / 'ai_service.py').read_text(encoding='utf-8'))
fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'garment_category_from_points')
ns = {'np': np}
exec(compile(ast.Module(body=[fn], type_ignores=[]), '<category>', 'exec'), ns)
infer = ns['garment_category_from_points']
person = {'box': [300, 30, 720, 1480]}
point = lambda y, label=1: {'x': 500, 'y': y, 'label': label}
assert infer([point(680)], person, 'upper_body') == 'lower_body'
assert infer([point(420)], person, 'lower_body') == 'upper_body'
assert infer([point(420), point(850)], person, 'upper_body') == 'overall'
assert infer([point(850, 0)], person, 'upper_body') == 'upper_body'
assert infer([], person, 'overall') == 'overall'
assert infer([{'x': 10, 'y': 800}], person, 'upper_body') == 'upper_body'
person['keypoints'] = [[500, 700, 1]] * 17
assert infer([point(680)], person, 'upper_body') == 'lower_body'
print('OK: pants point overrides shirt category; mixed points select overall; negative/background points do not switch category.')
