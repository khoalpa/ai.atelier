"""Estimate visible cosmetic colors from one explicitly selected reference face.

This is a color suggestion, not pigment recovery: illumination and complexion
remain mixed in a photograph. No reference pixels or geometry enter rendering.
"""
import hashlib

import cv2
import numpy as np

import makeup
import image_enhancement as enhancement


def extract(source, points, root):
    masks, _, box = makeup.region_masks(points, source.size)
    rgb = np.asarray(source)
    lab = cv2.cvtColor(rgb.astype(np.float32) / 255, cv2.COLOR_RGB2LAB)

    def samples(name, dark=False):
        hard = np.asarray(masks[name]) > 0
        distance = cv2.distanceTransform(hard.astype(np.uint8), cv2.DIST_L2, 3)
        pixels = lab[hard & (distance > 1)]
        if len(pixels) < 16:
            return None
        lo, hi = np.percentile(pixels[:, 0], (15, 65) if dark else (20, 85))
        return pixels[(pixels[:, 0] >= lo) & (pixels[:, 0] <= hi)]

    skin = samples('base')
    if skin is None:
        raise ValueError('Vùng da tham chiếu chưa đủ rõ. Chọn ảnh lớn hơn, ít bị che khuất.')
    baseline = np.median(skin, axis=0)
    plan = dict(makeup.styles(root)['natural'])
    plan.update(style='natural', renderer='color', parts=[], brow='#59443b',
                skinSmooth=0, preserveFeatures=True, description='', strengths={p: 100 for p in makeup.PARTS})
    measurements = {}
    warnings = ['Màu và độ đậm là gợi ý từ ảnh; ánh sáng và màu da có thể làm kết quả khác ảnh tham chiếu.']
    names = dict(lips='môi', eyes='mí mắt', cheeks='má', brows='chân mày')
    contrasts = []
    for part, key in [('lips', 'lip'), ('eyes', 'eyeshadow'), ('cheeks', 'blush'), ('brows', 'brow')]:
        pixels = samples(part, part == 'brows')
        if pixels is None:
            warnings.append('Chưa đủ chi tiết ở '+names[part]+'; vùng này đã được bỏ chọn.')
            continue
        color = np.median(pixels, axis=0)
        converted = cv2.cvtColor(color.reshape(1, 1, 3).astype(np.float32), cv2.COLOR_LAB2RGB)[0, 0]
        plan[key] = '#' + ''.join(f'{v:02x}' for v in np.rint(converted * 255).clip(0, 255).astype(int))
        plan['parts'].append(part)
        contrast = float(np.linalg.norm(color[1:] - baseline[1:]))
        measurements[part] = dict(pixels=len(pixels), chromaDifference=round(contrast, 2))
        if part != 'brows':
            contrasts.append(contrast)
    if not plan['parts']:
        raise ValueError('Không đọc được các vùng trang điểm. Hãy chọn ảnh rõ hơn.')
    contrast = float(np.median(contrasts)) if contrasts else 0
    plan['intensity'] = 'bold' if contrast > 19 else 'medium' if contrast > 9 else 'light'
    # Estimate only the darkness beside the upper eye opening, not eye pixels.
    liner = lab[np.asarray(masks['_liner']) > 0, 0]
    lids = samples('eyes')
    ratio = float(np.mean(liner < np.median(lids[:, 0]) - 13)) if len(liner) and lids is not None else 0
    plan['eyeliner'] = 'defined' if ratio > .5 else 'thin' if ratio > .2 else 'none'
    plan['finish'] = 'satin'
    plan['prompt'] = 'subtle coordinated lipstick, eyeshadow, blush and neat eyebrows, natural skin texture'
    plan['summary'] = 'Đã gợi ý màu từ khuôn mặt tham chiếu. Kiểm tra màu, kẻ mắt và độ đậm trước khi xem thử.'
    warnings.append('Kẻ mắt được ước lượng theo độ tương phản. Chất son mặc định Mịn nhẹ; bạn có thể đổi bên dưới.')
    return plan, measurements, warnings, box


def analyze(body, env):
    path = env['safe_sample'](str(body.get('sampleId', '')))
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    source, _ = enhancement.load_source(path)
    points = env.get('makeup_landmarks', makeup.landmarks)(source, env['ROOT'])
    faces = []
    for index, face in enumerate(points):
        try:
            _, _, box = makeup.region_masks(face, source.size)
        except ValueError:
            continue
        thumb = source.crop(box); thumb.thumbnail((200, 200))
        faces.append(dict(index=index, box=box, thumbnail=makeup.encode(thumb)))
    if not faces:
        raise ValueError('Chưa nhận diện được khuôn mặt tham chiếu đủ rõ. Chọn ảnh chính diện hoặc nghiêng nhẹ, không che mắt và môi.')
    result = dict(ok=True, faces=faces, sourceSha256=sha)
    if 'faceIndex' not in body:
        return result
    index = body['faceIndex']
    if isinstance(index, bool) or not isinstance(index, int) or not any(f['index'] == index for f in faces):
        raise ValueError('Chọn một khuôn mặt tham chiếu hợp lệ.')
    if body.get('sourceSha256') != sha:
        raise ValueError('Ảnh tham chiếu đã đổi. Hãy nhận diện lại.')
    plan, metrics, warnings, _ = extract(source, points[index], env['ROOT'])
    result.update(plan=plan, measurements=metrics, warnings=warnings, faceIndex=index)
    return result
