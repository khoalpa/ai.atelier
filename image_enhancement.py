from prompt_catalog import prompt_text, prompt_template, catalog_value, CatalogMap, read_catalog
"""Offline enhancement and explicitly selected skin retouching; no runtime downloads."""
import base64
import hashlib
import io
import json
import math
import time
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageCms, ImageFilter, ImageOps
import skin_retouch
import skin_edge

VERSION = 1
MAX_PIXELS = 16_777_216
MAX_SIDE = 8192
MODEL_NAME = 'RealESRGAN_x2plus'
MODEL_SHA = '49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb'
LEVELS = CatalogMap("featurePresets", 'enhancement.levels')
PROFILES = CatalogMap("featurePresets", 'enhancement.profiles')


def model_path(root):
    return Path(root) / 'models/enhancement/RealESRGAN_x2plus.pth'


def configuration(root):
    return dict(version=VERSION, maxPixels=MAX_PIXELS, maxSide=MAX_SIDE,
                model=MODEL_NAME, modelReady=model_path(root).is_file(), skin=skin_retouch.configuration(root), edgeVersion=skin_edge.VERSION)


def options(body):
    result = {key: body.get(key, default) for key, default in
              [('method', 'light'), ('level', 'light'), ('profile', 'product'), ('scope', 'all')]}
    for key, allowed in [('method', ('light', 'ai2x', skin_edge.METHOD, *skin_retouch.METHODS)), ('level', LEVELS),
                         ('profile', PROFILES), ('scope', ('all', 'selected'))]:
        if not isinstance(result[key], str) or result[key] not in allowed:
            raise ValueError('Lựa chọn cải thiện ảnh không hợp lệ: ' + key)
    if result['method'] in skin_retouch.METHODS:
        # Never honor an all-image scope for skin, including direct API requests.
        result['scope'] = 'selected'
        result.update(skin_retouch.options(body, result['method']))
    if result['method'] == skin_edge.METHOD:
        result['scope'] = 'selected'
        result.update(skin_edge.options(body))
    result['preview'] = body.get('preview', False)
    if not isinstance(result['preview'], bool):
        raise ValueError('Chế độ xem thử không hợp lệ.')
    result['scale'] = 2 if result['method'] == 'ai2x' else 1
    for key in ('previewX', 'previewY'):
        value = body.get(key, 50)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 100:
            raise ValueError('Vị trí xem thử phải từ 0 đến 100%.')
        result[key] = value
    return result


def load_source(path):
    with Image.open(path) as raw:
        if raw.width * raw.height > MAX_PIXELS or max(raw.size) > MAX_SIDE:
            raise ValueError('Ảnh nguồn vượt giới hạn 16 triệu pixel hoặc 8192 px mỗi chiều.')
        image = ImageOps.exif_transpose(raw)
        if image.mode not in ('RGB', 'RGBA', 'L', 'LA', 'P', 'CMYK'):
            raise ValueError('Hãy chuyển ảnh sang PNG/JPEG/WebP 8 bit trước khi cải thiện.')
        alpha = image.convert('RGBA').getchannel('A') if 'A' in image.getbands() or 'transparency' in image.info else None
        profile = image.info.get('icc_profile')
        if profile:
            try:
                image = ImageCms.profileToProfile(image.convert('CMYK') if image.mode == 'CMYK' else image.convert('RGB'),
                    ImageCms.ImageCmsProfile(io.BytesIO(profile)), ImageCms.createProfile('sRGB'), outputMode='RGB')
            except Exception as error:
                raise ValueError('Không đọc được hồ sơ màu của ảnh; hãy xuất lại ảnh sRGB.') from error
        else:
            image = image.convert('RGB')
        return image.copy(), alpha


def read_mask(value, size, default=0):
    if value in (None, ''):
        return Image.new('L', size, default)
    if not isinstance(value, str) or not value.startswith('data:image/png;base64,') or len(value) > 24 * 1024 * 1024:
        raise ValueError('Vùng chọn phải là mask PNG hợp lệ.')
    try:
        data = base64.b64decode(value.split(',', 1)[1], validate=True)
        with Image.open(io.BytesIO(data)) as mask:
            if mask.size != size:
                raise ValueError('Kích thước mask không khớp ảnh nguồn.')
            return mask.convert('L').point(lambda x: 255 if x >= 128 else 0)
    except ValueError:
        raise
    except Exception as error:
        raise ValueError('Không đọc được vùng chọn.') from error


def allowed_mask(body, size, settings):
    selected = read_mask(body.get('editableMask'), size) if settings['scope'] == 'selected' else Image.new('L', size, 255)
    protected = read_mask(body.get('protectedDetailMask'), size)
    allowed = (np.asarray(selected) > 0) & (np.asarray(protected) == 0)
    if not allowed.any():
        raise ValueError('Chưa có vùng được phép cải thiện. Tô vùng đỏ hoặc kiểm tra vùng bảo vệ.')
    return Image.fromarray(allowed.astype(np.uint8) * 255), protected


def light_candidate(source, settings):
    rgb = np.asarray(source)
    ycc = cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb)
    luma = ycc[:, :, 0].astype(np.float32)
    clean = cv2.bilateralFilter(luma, 5, 10, 2)
    detail = clean - cv2.GaussianBlur(clean, (0, 0), 1.0)
    gain = LEVELS[settings['level']] * PROFILES[settings['profile']][0]
    delta = ((clean - luma) * .45 + detail * .7) * gain
    cap = 4 + 8 * gain
    ycc[:, :, 0] = np.rint(np.clip(luma + np.clip(delta, -cap, cap), 0, 255)).astype(np.uint8)
    return Image.fromarray(cv2.cvtColor(ycc, cv2.COLOR_YCrCb2RGB))


def tile_boxes(width, height, tile=256, overlap=32):
    def starts(length):
        return list(range(0, max(1, length - overlap), tile - overlap))
    return [(x, y, min(x + tile, width), min(y + tile, height)) for y in starts(height) for x in starts(width)]


def ai_candidate(source, root, active=lambda: None, progress=lambda i, n: None, tile=256):
    import torch
    from vendor.enhance.rrdbnet_arch import RRDBNet
    checkpoint = model_path(root)
    if not checkpoint.is_file():
        raise ValueError('Thiếu model AI 2×. Chạy scripts/setup-enhancement.ps1 để chuẩn bị model.')
    if hashlib.sha256(checkpoint.read_bytes()).hexdigest() != MODEL_SHA:
        raise ValueError('Model AI 2× không khớp checksum. Hãy cài lại model đã kiểm chứng.')
    active()
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = RRDBNet(3, 3, scale=2, num_feat=64, num_block=23, num_grow_ch=32)
    weights = torch.load(checkpoint, map_location='cpu', weights_only=True)
    model.load_state_dict(weights['params_ema'], strict=True)
    del weights
    model.eval().to(device)
    # FP32 avoids overflow and keeps the same numeric path on CPU and GPU.
    width, height = source.size
    rgb = np.asarray(source)
    accum = np.zeros((height * 2, width * 2, 3), dtype=np.float32)
    weight_sum = np.zeros((height * 2, width * 2, 1), dtype=np.float32)
    boxes = tile_boxes(width, height, tile)
    try:
        with torch.inference_mode():
            for index, (x0, y0, x1, y1) in enumerate(boxes):
                active()
                # Even context origins preserve pixel-unshuffle phase across tiles.
                left, top = max(0, x0 - 32) // 2 * 2, max(0, y0 - 32) // 2 * 2
                right, bottom = min(width, x1 + 32), min(height, y1 + 32)
                patch = rgb[top:bottom, left:right]
                ph, pw = patch.shape[:2]
                patch = np.pad(patch, ((0, ph % 2), (0, pw % 2), (0, 0)), mode='edge')
                tensor = torch.from_numpy(patch.copy()).permute(2, 0, 1).float().unsqueeze(0).div_(255).to(device)
                prediction = model(tensor)[0].clamp_(0, 1).permute(1, 2, 0).cpu().numpy() * 255
                prediction = prediction[(y0-top)*2:(y1-top)*2, (x0-left)*2:(x1-left)*2]
                h, w = prediction.shape[:2]
                wy, wx = np.ones(h, np.float32), np.ones(w, np.float32)
                ramp = np.linspace(.01, 1, min(64, h), dtype=np.float32)
                if y0: wy[:len(ramp)] *= ramp
                if y1 < height: wy[-len(ramp):] *= ramp[::-1]
                ramp = np.linspace(.01, 1, min(64, w), dtype=np.float32)
                if x0: wx[:len(ramp)] *= ramp
                if x1 < width: wx[-len(ramp):] *= ramp[::-1]
                weight = (wy[:, None] * wx[None, :])[:, :, None]
                accum[y0*2:y1*2, x0*2:x1*2] += prediction * weight
                weight_sum[y0*2:y1*2, x0*2:x1*2] += weight
                del tensor, prediction
                progress(index + 1, len(boxes))
        active()
        if not np.all(weight_sum > 0):
            raise RuntimeError('Ảnh chưa được xử lý đầy đủ; không lưu kết quả thiếu vùng.')
        return Image.fromarray(np.rint(accum / weight_sum).clip(0, 255).astype(np.uint8))
    finally:
        del model
        if device == 'cuda': torch.cuda.empty_cache()


def composite(source, candidate, allowed, settings):
    baseline = source.resize(candidate.size, Image.Resampling.LANCZOS)
    base = np.asarray(baseline).astype(np.float32)
    change = np.asarray(candidate).astype(np.float32) - base
    if settings['method'] == 'ai2x':
        before_ycc = cv2.cvtColor(np.asarray(baseline), cv2.COLOR_RGB2YCrCb).astype(np.float32)
        after_ycc = cv2.cvtColor(np.asarray(candidate), cv2.COLOR_RGB2YCrCb).astype(np.float32)
        gain = LEVELS[settings['level']] * PROFILES[settings['profile']][0]
        delta = np.clip(after_ycc - before_ycc, -32, 32) * gain
        delta[:, :, 1:] *= PROFILES[settings['profile']][1]
        adjusted = cv2.cvtColor(np.rint(before_ycc + delta).clip(0, 255).astype(np.uint8), cv2.COLOR_YCrCb2RGB)
        change = adjusted.astype(np.float32) - base
    hard = np.asarray(allowed.resize(candidate.size, Image.Resampling.NEAREST)) > 0
    # Feather inward only; outside/protected pixels are copied exactly from baseline.
    if hard.all(): alpha = np.ones(hard.shape, np.float32)
    else:
        distance = cv2.distanceTransform(np.pad(hard.astype(np.uint8), 1), cv2.DIST_L2, 3)[1:-1, 1:-1]
        # Tiny blemishes must be fully replaced; feather only the inside edge.
        feather = settings.get('feather', 1 if settings['method'] in ('skin-heal', 'skin-ai') else 3 * settings['scale'])
        alpha = np.minimum(distance / feather, 1)
    output = np.rint(base + change * alpha[:, :, None]).clip(0, 255).astype(np.uint8)
    output[~hard] = base[~hard].astype(np.uint8)
    # Avoid introducing clipped channel values absent from the baseline.
    output[(base > 0) & (output == 0)] = 1
    output[(base < 255) & (output == 255)] = 254
    outside = float(np.max(np.abs(output[~hard].astype(np.int16) - base[~hard]))) if (~hard).any() else 0.0
    metrics = dict(outsideMaskMaxError=outside, changedFraction=float(np.mean(np.any(output != base, axis=2))),
                   meanAbsoluteChange=float(np.abs(output.astype(np.float32)-base).mean()),
                   preservationReference='source' if settings['scale'] == 1 else 'lanczos-2x', requiresVisualReview=True)
    if outside != 0: raise RuntimeError('Kiểm tra vùng bảo vệ không đạt; không công bố kết quả.')
    return baseline, Image.fromarray(output), metrics


def enhance(body, env):
    started = time.perf_counter()
    settings = options(body)
    is_skin = settings['method'] in skin_retouch.METHODS
    is_edge = settings['method'] == skin_edge.METHOD
    model_name = (skin_retouch.MODEL if settings['method'] == 'skin-ai' else settings['method']) if is_skin else (MODEL_NAME if settings['scale'] == 2 else 'cpu-light')
    if is_edge: model_name = 'cpu-skin-edge'
    job_id = str(body.get('jobId', ''))[:80]
    update = lambda **kw: env['update_job'](job_id, **kw)
    active = lambda: env['ensure_job_active'](job_id)
    active()
    path = env['safe_sample'](str(body.get('sampleId', '')))
    source_sha = hashlib.sha256(path.read_bytes()).hexdigest()
    source, alpha = load_source(path)
    allowed, protected = allowed_mask(body, source.size, settings)
    original_size = source.size
    update(status='running', taskType='enhance', stage='enhance-validating', sourceId=body['sampleId'],
           model=model_name, previewOnly=settings['preview'], skinRetouch=is_skin,
           enhancementApplied=True, totalVariants=1, completedSteps=0, totalWorkSteps=1,
           _event={'type': 'enhance.started', 'message': 'Đang chuẩn bị vùng cải thiện'})
    env['persist_job_request'](job_id, 'enhance', body)
    crop, preview_local = None, None
    if settings['preview'] and is_skin:
        crop = skin_retouch.preview_box(allowed)
        preview_local = crop
        # Retain full components and their original context for matching previews.
    elif settings['preview'] and not is_edge:
        w, h = source.size
        cw, ch = min(w, 256), min(h, 256)
        x = int(round((w-cw)*settings['previewX']/100))
        y = int(round((h-ch)*settings['previewY']/100))
        crop = (x, y, x+cw, y+ch)
        if not allowed.crop(crop).getbbox(): raise ValueError('Vùng xem thử nằm ngoài vùng được phép sửa. Chọn vị trí khác.')
        # Read surrounding context but only display the requested preview window.
        context = (max(0,x-32)//2*2, max(0,y-32)//2*2, min(w,x+cw+32), min(h,y+ch+32))
        preview_local = (x-context[0], y-context[1], x+cw-context[0], y+ch-context[1])
        source, allowed, protected = source.crop(context), allowed.crop(context), protected.crop(context)
        if alpha: alpha = alpha.crop(context)
    output_size = (crop[2]-crop[0], crop[3]-crop[1]) if crop else source.size
    width, height = (value*settings['scale'] for value in output_size)
    if width*height > MAX_PIXELS or max(width, height) > MAX_SIDE:
        raise ValueError('Ảnh đầu ra vượt giới hạn 16 triệu pixel hoặc 8192 px mỗi chiều. Hãy dùng ảnh nguồn nhỏ hơn.')
    gpu = env.get('torch')
    uses_gpu = settings['method'] in ('ai2x', 'skin-ai') and gpu is not None and gpu.cuda.is_available()
    if uses_gpu: gpu.cuda.reset_peak_memory_stats()
    update(width=width, height=height, stage='enhance-processing', device='cuda' if uses_gpu else 'cpu',
           gpuMemoryMb=round(gpu.cuda.get_device_properties(0).total_memory/1048576) if uses_gpu else 0)
    active()
    skin_metrics, artifacts = {}, {}
    if is_edge:
        candidate, skin_metrics, artifacts = skin_edge.process(source, allowed, settings, active,
            lambda i, n: update(stage='enhance-processing', completedSteps=i, totalWorkSteps=n))
        if settings['preview']:
            crop = preview_local = skin_edge.preview_box(artifacts['edge_band.png'])
            width, height = crop[2]-crop[0], crop[3]-crop[1]
            update(width=width, height=height)
    elif is_skin:
        if settings['method'] == 'skin-ai': update(stage='enhance-model-loading')
        candidate, skin_metrics = skin_retouch.process(source, allowed, settings, env, active,
            lambda i, n: update(stage='enhance-processing', completedSteps=i, totalWorkSteps=n), crop)
    elif settings['method'] == 'ai2x':
        update(stage='enhance-model-loading')
        for name in ('release_inpaint', 'release_tryon', 'release_text_to_image'):
            env[name]()
        candidate = env.get('enhancement_ai', ai_candidate)(source, env['ROOT'], active,
            lambda i, n: update(stage='enhance-processing', completedSteps=i, totalWorkSteps=n))
    else:
        candidate = light_candidate(source, settings)
    active()
    update(stage='enhance-checking')
    if candidate.size != (source.width*settings['scale'], source.height*settings['scale']):
        raise RuntimeError('Kích thước ảnh xử lý không đúng; không công bố kết quả.')
    baseline, result, metrics = composite(source, candidate, allowed, settings)
    metrics.update(skin_metrics)
    if alpha:
        out_alpha = alpha.resize(result.size, Image.Resampling.LANCZOS)
        baseline.putalpha(out_alpha); result.putalpha(out_alpha); source.putalpha(alpha)
    if preview_local:
        output_box=tuple(value*settings['scale'] for value in preview_local)
        source, allowed, protected=source.crop(preview_local), allowed.crop(preview_local), protected.crop(preview_local)
        baseline, result=baseline.crop(output_box), result.crop(output_box)
        artifacts = {name: image.crop(preview_local) for name, image in artifacts.items()}
        delta=np.abs(np.asarray(result).astype(np.float32)-np.asarray(baseline))
        metrics.update(changedFraction=float(np.mean(np.any(delta>0,axis=2))),meanAbsoluteChange=float(delta.mean()))
    active()
    folder = env['OUTPUTS'] / 'enhance' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:12])
    relative = lambda p: p.relative_to(env['ROOT']).as_posix()
    item = dict(kind='enhance', seed=0, sampleId=body['sampleId'], file=relative(folder/'result_seed_0.png'),
                comparisonFile=relative(folder/'comparison.png'), width=width, height=height,
                previewOnly=settings['preview'], enhancementApplied=True, settings=settings, metrics=metrics,
                crop=crop, sourceSize=original_size)
    if is_edge:
        item.update(edgeOverlayFile=relative(folder/'edge_overlay.png'), edgeBandFile=relative(folder/'edge_band.png'))
    report = dict(ok=True, version=VERSION, taskType='enhance', directory=relative(folder), results=[item],
                  source=body['sampleId'], sourceSha256=source_sha, settings=settings, enhancementApplied=True,
                  model=model_name,
                  modelSha256=MODEL_SHA if settings['scale']==2 else None,
                  width=width, height=height, metrics=metrics, previewOnly=settings['preview'],
                  durationSeconds=round(time.perf_counter()-started, 3),
                  device='cuda' if uses_gpu else 'cpu',
                  peakVramMb=round(gpu.cuda.max_memory_allocated()/1048576,1) if uses_gpu else 0)
    # Publish the entire run at once. Cancelled writes never enter the image library.
    env['JOBS_DIR'].mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='enhance-', dir=env['JOBS_DIR']) as staging:
        stage = Path(staging)
        source.save(stage/'source.png'); baseline.save(stage/'comparison.png')
        allowed.save(stage/'editable_mask.png'); protected.save(stage/'protected_mask.png')
        result.save(stage/'result_seed_0.png')
        for name, artifact in artifacts.items(): artifact.save(stage/name)
        report['durationSeconds']=round(time.perf_counter()-started,3)
        (stage/'metadata.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        active()
        folder.parent.mkdir(parents=True, exist_ok=True)
        stage.rename(folder)
    update(status='completed', stage='done', completedSteps=1, totalWorkSteps=1,
           durationSeconds=report['durationSeconds'], peakVramMb=report['peakVramMb'], _result=item,
           _event={'type': 'enhance.completed', 'message': 'Đã lưu bản xem thử' if settings['preview'] else 'Đã lưu ảnh cải thiện; hãy so sánh trước khi dùng'})
    return report
