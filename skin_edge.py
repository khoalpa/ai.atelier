"""Local, bounded skin/background transition refinement without geometric warps.

The painted mask is an edit permission, not a foreground mask. Two optional
color samples label the sides. Automatic labels are color estimates, not skin
detection. The 50% transition is fixed by a symmetric, monotone tone curve.
"""
import math

import cv2
import numpy as np
from PIL import Image

METHOD = 'skin-edge'
VERSION = 1
MAX_REGION_PIXELS = 4_194_304


def options(body):
    settings = dict(edgeVersion=VERSION, edgeKeepShape=True)
    for key, default, low, high in [('edgeWidth', 16, 3, 48), ('edgeSoftness', 50, 0, 100), ('edgeDecontam', 30, 0, 100)]:
        value = body.get(key, default)
        if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f'Thiết lập viền không hợp lệ: {key} phải từ {low} đến {high}.')
        settings[key] = value
    if body.get('edgeKeepShape', True) is not True:
        raise ValueError('Công cụ làm rõ viền luôn giữ đường nét cơ thể.')
    for key in ('edgeSkinPoint', 'edgeBackgroundPoint'):
        point = body.get(key)
        if point is not None:
            if not isinstance(point, dict) or set(point) != {'x', 'y'}:
                raise ValueError('Điểm tham chiếu viền không hợp lệ.')
            for value in point.values():
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                    raise ValueError('Tọa độ tham chiếu viền không hợp lệ.')
            point = dict(point)
        settings[key] = point
    if (settings['edgeSkinPoint'] is None) != (settings['edgeBackgroundPoint'] is None):
        raise ValueError('Chọn đủ hai điểm Da và Nền, hoặc xóa cả hai để dùng tự động.')
    return settings


def sample_colors(source, settings):
    rgb = np.asarray(source)
    colors = []
    for key in ('edgeSkinPoint', 'edgeBackgroundPoint'):
        point = settings[key]
        if point is None:
            return None
        if point['x'] >= source.width or point['y'] >= source.height:
            raise ValueError('Điểm tham chiếu nằm ngoài ảnh nguồn.')
        x, y = int(point['x']), int(point['y'])
        colors.append(np.median(rgb[max(0, y-2):y+3, max(0, x-2):x+3].reshape(-1, 3), axis=0))
    if np.linalg.norm(colors[0]-colors[1]) < 15:
        raise ValueError('Hai điểm có màu quá gần nhau. Chọn điểm sâu hơn về phía Da và Nền.')
    return np.asarray(colors, dtype=np.float32)


def automatic_colors(rgb, selected):
    # Deterministic two-color fit in the brush neighborhood; no fixed skin tone.
    neighborhood = cv2.dilate(selected.astype(np.uint8), np.ones((25, 25), np.uint8)) > 0
    pixels = rgb[neighborhood].reshape(-1, 3)[::max(1, int(neighborhood.sum())//12000)]
    center = pixels.mean(axis=0)
    _, _, axes = np.linalg.svd(pixels-center, full_matrices=False)
    projection = (pixels-center) @ axes[0]
    colors = np.array([np.median(pixels[projection <= np.percentile(projection, 20)], axis=0),
                       np.median(pixels[projection >= np.percentile(projection, 80)], axis=0)])
    for _ in range(6):
        labels = np.linalg.norm(pixels[:, None]-colors[None], axis=2).argmin(axis=1)
        if any(not np.any(labels == k) for k in (0, 1)):
            raise ValueError('Chưa tìm thấy hai phía đường biên. Tô phủ sang cả da và nền rồi thử lại.')
        colors = np.array([np.median(pixels[labels == k], axis=0) for k in (0, 1)])
    # This is only a fallback for assigning spill removal to the warmer side.
    warmth = colors[:, 0]-colors[:, 2]
    return colors[np.argsort(-warmth)], abs(float(warmth[0]-warmth[1])) >= 12


def project(rgb, foreground, background):
    direction = foreground-background
    return np.sum((rgb-background)*direction, axis=2) / np.maximum(np.sum(direction*direction, axis=2), 1)


def nearest_colors(rgb, core):
    if not core.any():
        raise ValueError('Chưa có đủ màu tham chiếu hai phía. Tô rộng hơn hoặc chọn lại điểm Da và Nền.')
    _, labels = cv2.distanceTransformWithLabels((~core).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    palette = np.zeros((int(labels.max())+1, 3), np.float32)
    palette[labels[core]] = rgb[core]
    return palette[labels]


def refine_region(source, selected, settings, colors=None):
    base = np.asarray(source).astype(np.float32)
    low = cv2.GaussianBlur(base, (0, 0), 1.2)
    automatic = colors is None
    if automatic:
        colors, side_confident = automatic_colors(low, selected)
    else:
        side_confident = True
    contrast = float(np.linalg.norm(colors[0]-colors[1]))
    if contrast < 15:
        raise ValueError('Màu da và nền quá gần nhau để xác định viền. Chọn hai điểm tham chiếu rõ hơn.')
    initial = project(low, colors[0][None, None], colors[1][None, None])
    foreground = nearest_colors(low, initial >= .92)
    background = nearest_colors(low, initial <= .08)
    matte = np.clip(project(low, foreground, background), 0, 1)
    inside = (matte >= .5).astype(np.uint8)
    # Reflect context avoids inventing a border at the image boundary.
    inner = cv2.distanceTransform(inside, cv2.DIST_L2, 3)
    outer = cv2.distanceTransform(1-inside, cv2.DIST_L2, 3)
    distance = np.maximum(inner, outer)
    width = settings['edgeWidth']
    band = selected & (distance <= width)
    contour = (cv2.dilate(inside, np.ones((3, 3), np.uint8)) != cv2.erode(inside, np.ones((3, 3), np.uint8))) & selected
    if not contour.any():
        raise ValueError('Vùng tô chưa cắt qua đường biên. Tô một dải phủ cả da và nền.')
    # A monotone symmetric curve fixes alpha=.5; no resampling or silhouette shift.
    gamma = 1.3 + (1-settings['edgeSoftness']/100)*1.7
    shaped = matte**gamma / np.maximum(matte**gamma + (1-matte)**gamma, 1e-8)
    strength = {'light': .45, 'balanced': .72, 'strong': 1}[settings['level']]
    taper = np.maximum(0, 1-(distance/width)**2)**2
    direction = foreground-background
    residual = low-(matte[..., None]*foreground+(1-matte[..., None])*background)
    # Reject texture/details that don't lie on a two-color transition.
    confidence = np.clip(1-np.linalg.norm(residual, axis=2)/max(12, contrast*.45), 0, 1)
    change = (shaped-matte)[..., None]*direction*strength
    if settings['edgeDecontam'] and side_confident:
        # Remove background chroma on the skin side, anchored to the same midpoint.
        luma = np.sum(direction*np.array([.299, .587, .114], np.float32), axis=2)
        chroma = direction-luma[..., None]
        spill = np.maximum(matte-.5, 0)*(1-matte)*2*(settings['edgeDecontam']/100)
        change += spill[..., None]*chroma
    change *= (taper*confidence*band)[..., None]
    cap = {'light': 16, 'balanced': 26, 'strong': 38}[settings['level']]
    change = np.clip(change, -cap, cap)
    # No newly introduced bright/dark rim beyond the local two-side colors.
    lower = np.minimum(base, np.minimum(foreground, background))
    upper = np.maximum(base, np.maximum(foreground, background))
    output = np.minimum(np.maximum(base+change, lower), upper)
    output[~band] = base[~band]
    output = np.rint(output).clip(0, 255).astype(np.uint8)
    return output, band, contour, dict(sideSource='automatic-color' if automatic else 'two-points',
        spillApplied=bool(settings['edgeDecontam'] and side_confident), contrast=round(contrast, 2))


def process(source, allowed, settings, active=lambda: None, progress=lambda i, n: None):
    from object_removal import removal_regions
    active()
    colors = sample_colors(source, settings)
    boxes = removal_regions(allowed, padding=max(64, int(settings['edgeWidth']*3)), context_ratio=.15)
    if any((b[2]-b[0])*(b[3]-b[1]) > MAX_REGION_PIXELS for b in boxes):
        raise ValueError('Vùng phân tích viền quá lớn. Hãy chia đường viền thành các đoạn nhỏ hơn.')
    result = np.asarray(source).copy()
    band = np.zeros((source.height, source.width), np.uint8)
    contour = band.copy()
    diagnostics = []
    for i, box in enumerate(boxes):
        active()
        selected = np.asarray(allowed.crop(box)) > 0
        patch, local_band, local_contour, stats = refine_region(source.crop(box), selected, settings, colors)
        x, y, r, b = box
        result[y:b, x:r] = patch
        band[y:b, x:r] = local_band.astype(np.uint8)*255
        contour[y:b, x:r] = local_contour.astype(np.uint8)*255
        diagnostics.append(stats)
        progress(i+1, len(boxes))
    active()
    overlay = np.zeros((source.height, source.width, 4), np.uint8)
    overlay[contour > 0] = (255, 210, 30, 220)
    metrics = dict(skinEdge=True, geometryResampled=False, edgeBandPixels=int((band > 0).sum()),
                   edgeRegions=diagnostics, requiresVisualReview=True)
    artifacts = {'edge_band.png': Image.fromarray(band), 'edge_overlay.png': Image.fromarray(overlay)}
    return Image.fromarray(result), metrics, artifacts


def preview_box(band):
    # Center on a detected edge pixel, not the empty center of a curved stroke.
    y, x = np.nonzero(np.asarray(band) > 0)
    if not len(x):
        raise ValueError('Không có đường biên trong vùng đã tô.')
    k = len(x)//2
    w, h = min(band.width, 256), min(band.height, 256)
    left = min(max(0, int(x[k]-w//2)), band.width-w)
    top = min(max(0, int(y[k]-h//2)), band.height-h)
    return (left, top, left+w, top+h)
