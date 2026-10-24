"""Run local SAM/pose weights against the three garment categories."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ai_service as a
import numpy as np
from PIL import Image

out = a.ROOT / 'workspace/review/auto-mask-preview'
out.mkdir(exist_ok=True)
source = Image.open(a.ROOT / 'samples/characters/c001.png').convert('RGB')
for category in ('upper_body', 'lower_body', 'overall'):
    points = [{'x': 560, 'y': 410, 'label': 1}, {'x': 550, 'y': 850, 'label': 1}, {'x': 400, 'y': 750, 'label': 0}] if category == 'overall' else []
    r = a.auto_mask({'sampleId': 'characters/c001.png', 'category': category, 'points': points})
    mask = a.decode_mask(r['mask'], source.size)
    protected = a.decode_mask(r['protectedMask'], source.size)
    assert not np.logical_and(np.asarray(mask) > 0, np.asarray(protected) > 0).any()
    assert r['coverage'] > 0.025
    if points:
        assert np.asarray(mask)[750, 400] == 0
    if category == 'upper_body':
        assert not np.asarray(mask)[900:].any()
        shirt_pixels = np.asarray(mask) > 0
    if category == 'lower_body':
        assert not np.asarray(mask)[:550].any()
    Image.composite(Image.new('RGB', source.size, (255, 50, 50)), source, mask.point(lambda x: 100 if x > 0 else 0)).save(out / (category + '.png'))
    print(category, 'coverage=', round(r['coverage'], 3), 'accepted=', r['accepted'], 'bbox=', mask.getbbox(), flush=True)

# Regression: a pants click must override the previously selected shirt type.
r = a.auto_mask({'sampleId': 'characters/c001.png', 'category': 'upper_body', 'inferCategoryFromPoints': True, 'points': [{'x': 500, 'y': 680, 'label': 1}]})
assert r['category'] == 'lower_body'
mask = a.decode_mask(r['mask'], source.size)
pixels = np.asarray(mask)
assert not pixels[:550].any()
assert (pixels[900:1350] > 0).sum() > 20000
print('OK: pants click with shirt setting selects both trouser legs.', flush=True)

r = a.auto_mask({'sampleId': 'characters/c001.png', 'category': 'overall', 'inferCategoryFromPoints': True, 'points': [{'x': 506, 'y': 448, 'label': 1}, {'x': 488, 'y': 656, 'label': 1}]})
mask = a.decode_mask(r['mask'], source.size)
pixels = np.asarray(mask)
assert (pixels[350:550, 580:630] > 0).mean() > 0.9
assert (pixels[shirt_pixels] > 0).all()
protected = a.decode_mask(r['protectedMask'], source.size)
assert not np.logical_and(pixels > 0, np.asarray(protected) > 0).any()
Image.composite(Image.new('RGB', source.size, (255, 50, 50)), source, mask.point(lambda x: 100 if x > 0 else 0)).save(out / 'shirt-completeness.png')
print('OK: screenshot point pair covers right shoulder/chest without unprotected texture holes.', flush=True)
