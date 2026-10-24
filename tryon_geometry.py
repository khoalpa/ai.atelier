"""Reversible image geometry and explicit target-garment coverage for try-on."""
import cv2
import numpy as np
from PIL import Image, ImageFilter


def fit_geometry(source_size, canvas_size):
    sw, sh = source_size
    cw, ch = canvas_size
    if min(sw, sh, cw, ch) <= 0:
        raise ValueError('Image dimensions must be positive')
    scale = min(cw / sw, ch / sh)
    width, height = max(1, round(sw * scale)), max(1, round(sh * scale))
    left, top = (cw - width) // 2, (ch - height) // 2
    return {'sourceSize': [sw, sh], 'canvasSize': [cw, ch],
            'contentBox': [left, top, left + width, top + height], 'method': 'contain'}


def fit_image(image, geometry, mask=False, fill=(245, 245, 245)):
    if list(image.size) != geometry['sourceSize']:
        raise ValueError('Image and geometry must share the source size')
    box = geometry['contentBox']
    mode = 'L' if mask else 'RGB'
    canvas = Image.new(mode, tuple(geometry['canvasSize']), 0 if mask else fill)
    resized = image.convert(mode).resize((box[2]-box[0], box[3]-box[1]),
                                        Image.Resampling.NEAREST if mask else Image.Resampling.LANCZOS)
    if mask:
        resized = resized.point(lambda x: 255 if x > 16 else 0)
    canvas.paste(resized, (box[0], box[1]))
    return canvas


def restore_image(image, geometry):
    if list(image.size) != geometry['canvasSize']:
        raise ValueError('Generated image does not match its inference canvas')
    return image.crop(tuple(geometry['contentBox'])).resize(tuple(geometry['sourceSize']), Image.Resampling.LANCZOS)


def inward_blend(mask, radius):
    """Feather within the edit region; outside pixels never enter the compositor."""
    hard = np.asarray(mask.convert('L')) > 16
    if not radius:
        return Image.fromarray(hard.astype(np.uint8)*255)
    distance = cv2.distanceTransform(hard.astype(np.uint8), cv2.DIST_L2, 5)
    alpha = np.clip(distance / max(1., float(radius)), 0, 1)
    return Image.fromarray(np.round(alpha*255).astype(np.uint8))


ATTRIBUTE_VALUES = {
    'sleeveLength': {'unknown', 'sleeveless', 'short', 'long'},
    'hemLength': {'unknown', 'hip', 'thigh', 'knee', 'ankle'},
    'silhouette': {'unknown', 'straight', 'a_line', 'trousers'},
    'neckline': {'unknown', 'round', 'v_neck', 'collared'},
    'layering': {'unknown', 'single', 'layered'},
}


def target_attributes(value, category):
    if value is None:
        return {key: 'unknown' for key in ATTRIBUTE_VALUES}
    if not isinstance(value, dict) or set(value) - set(ATTRIBUTE_VALUES):
        raise ValueError('Thuộc tính trang phục không hợp lệ')
    result = {}
    for key, choices in ATTRIBUTE_VALUES.items():
        entry = value.get(key, 'unknown')
        if not isinstance(entry, str) or entry not in choices:
            raise ValueError(f'Thuộc tính {key} không hợp lệ')
        result[key] = entry
    if category == 'lower_body':
        result['sleeveLength'] = result['neckline'] = 'unknown'
    return result


def target_coverage(mask, protected, category, person, attributes):
    """Add user-specified coverage, retaining old clothing to allow its removal.

    The target map is a pose prior, never a claim of semantic segmentation.
    Uncertain joints leave the original region intact and require review.
    """
    attributes = target_attributes(attributes, category)
    old = np.asarray(mask.convert('L')) > 16
    keep = np.asarray(protected.convert('L')) > 16
    expected = np.zeros(old.shape, np.uint8)
    points = (person or {}).get('keypoints') or []
    active = any(attributes[k] != 'unknown' for k in ('sleeveLength', 'hemLength', 'silhouette'))
    info = {'attributes': attributes, 'applied': False, 'warnings': [], 'method': 'explicit-attributes-pose-prior'}
    def valid(*indices):
        return all(i < len(points) and len(points[i]) >= 3 and points[i][2] >= .4
                   and np.isfinite(points[i]).all() for i in indices)
    def point(index):
        return np.array(points[index][:2], dtype=float)
    def polygon(vertices):
        cv2.fillPoly(expected, [np.rint(vertices).astype(np.int32)], 255)
    if active and valid(5, 6, 11, 12):
        shoulders = sorted([point(5), point(6)], key=lambda p: p[0])
        hips = sorted([point(11), point(12)], key=lambda p: p[0])
        span = max(10., np.linalg.norm(shoulders[0]-shoulders[1]))
        center = (hips[0]+hips[1])/2
        upper = category in ('upper_body', 'overall', 'full_body')
        if upper:
            polygon([shoulders[0], shoulders[1], hips[1], hips[0]])
            sleeve = attributes['sleeveLength']
            for shoulder, elbow, wrist in ((5, 7, 9), (6, 8, 10)):
                required = (shoulder, elbow, wrist) if sleeve == 'long' else (shoulder, elbow)
                if sleeve in ('long', 'short') and valid(*required):
                    start, bend = point(shoulder), point(elbow)
                    finish = point(wrist) if sleeve == 'long' else start + (bend-start)*.65
                    path = [start, bend, finish] if sleeve == 'long' else [start, finish]
                    cv2.polylines(expected, [np.rint(path).astype(np.int32)], False, 255, max(8, round(span*.30)))
                elif sleeve in ('long', 'short'):
                    info['warnings'].append('Thiếu điểm vai/tay tin cậy; cần kiểm tra vùng tay áo.')
        hem = attributes['hemLength']
        if category in ('upper_body', 'lower_body', 'overall', 'full_body') and hem in ('thigh', 'knee', 'ankle'):
            indices = (15, 16) if hem == 'ankle' else (13, 14)
            if valid(*indices):
                bottom = (point(indices[0])+point(indices[1]))/2
                if hem == 'thigh':
                    bottom = center+(bottom-center)*.5
                if attributes['silhouette'] == 'trousers':
                    for hip, knee, ankle in ((11, 13, 15), (12, 14, 16)):
                        end = ankle if hem == 'ankle' else knee
                        if valid(hip, knee, end):
                            finish = point(end) if hem != 'thigh' else point(hip)+(point(knee)-point(hip))*.5
                            path = [point(hip), point(knee), finish] if hem == 'ankle' else [point(hip), finish]
                            cv2.polylines(expected, [np.rint(path).astype(np.int32)], False, 255, max(8, round(span*.45)))
                else:
                    half = max(span*.55, abs(hips[0][0]-hips[1][0])*.65)
                    if attributes['silhouette'] == 'a_line':
                        half *= 1.45
                    polygon([hips[0], hips[1], bottom+[half,0], bottom+[-half,0]])
            else:
                info['warnings'].append('Thiếu điểm chân tin cậy; cần kiểm tra chiều dài trang phục.')
        # Explicitly unknown parts keep the old edit region. A sleeve-only choice
        # must not shrink the scoring area to a torso polygon for a dress.
        info['applied'] = bool(expected.any())
    elif active:
        info['warnings'].append('Chưa đủ tư thế tin cậy để mở rộng vùng theo mẫu; hãy kiểm tra vùng thủ công.')
    expected[keep] = 0
    edit = (old | (expected > 0)) & ~keep
    added = edit & ~old
    exposed = old & ~(expected > 0) & ~keep if info['applied'] else np.zeros_like(old)
    info.update(addedPixels=int(added.sum()), expectedPixels=int((expected > 0).sum()),
                requiresVisualReview=True)
    return (Image.fromarray(edit.astype(np.uint8)*255), Image.fromarray(expected),
            Image.fromarray(exposed.astype(np.uint8)*255), info)
