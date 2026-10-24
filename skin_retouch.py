"""Selected skin retouching, with local texture donors and optional offline SDXL.

All candidates are composited by image_enhancement; context is never permission
to edit. No skin detector or automatic whole-face reconstruction is used.
"""
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

METHODS = ('skin-smooth', 'skin-heal', 'skin-ai')
MODEL = 'sdxl-inpaint-base-0.1'
MODEL_DIR = 'models/inpainting/stable-diffusion-xl-1.0-inpainting-0.1'
PROMPT = ('Natural healthy skin surface matching the surrounding skin tone, '
          'fine pores, continuous skin texture, same lighting and anatomy, photographic detail')
NEGATIVE = ('scar, wound, mole, dirt, bruise, blemish, plastic skin, waxy skin, '
            'blur, changed anatomy, extra features, text')


def configuration(root):
    folder = Path(root) / MODEL_DIR
    required = ['model_index.json', 'scheduler/scheduler_config.json',
                'tokenizer/vocab.json', 'tokenizer/merges.txt',
                'tokenizer_2/vocab.json', 'tokenizer_2/merges.txt']
    for part in ('unet', 'vae', 'text_encoder', 'text_encoder_2'):
        required.append(part + '/config.json')
        required.append(part + ('/model.safetensors' if part.startswith('text') else '/diffusion_pytorch_model.safetensors'))
    return dict(version=1, model=MODEL, modelReady=all((folder / name).is_file() for name in required))


def options(body, method):
    amount = body.get('skinSmooth', 35 if method == 'skin-smooth' else 0)
    if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not math.isfinite(amount) or not 0 <= amount <= 100:
        raise ValueError('Mức làm mịn da phải từ 0 đến 100.')
    if method == 'skin-smooth' and amount == 0:
        raise ValueError('Chọn mức làm mịn lớn hơn 0.')
    texture = body.get('preserveTexture', True)
    if not isinstance(texture, bool):
        raise ValueError('Lựa chọn giữ vân da không hợp lệ.')
    return dict(skinSmooth=amount, preserveTexture=texture, skinRetouchVersion=1)


def smooth(source, amount, texture=True):
    rgb = np.asarray(source).astype(np.float32)
    # Suppress medium-scale unevenness without discarding all fine texture.
    low = cv2.GaussianBlur(rgb, (0, 0), .85)
    clean = cv2.bilateralFilter(rgb, 9, 24, 4)
    detail = np.clip(rgb - low, -10, 10) * (.65 if texture else 0)
    change = np.clip(clean + detail - rgb, -22, 22) * (amount / 100)
    return Image.fromarray(np.rint(rgb + change).clip(0, 255).astype(np.uint8))


def preview_box(mask):
    # Start on an actual selected spot, including for several distant spots.
    binary = (np.asarray(mask) > 0).astype(np.uint8)
    _, _, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    x, y, w, h, _ = stats[1]
    cw, ch = min(mask.width, 256), min(mask.height, 256)
    left = min(max(0, int(x + w // 2 - cw // 2)), mask.width - cw)
    top = min(max(0, int(y + h // 2 - ch // 2)), mask.height - ch)
    return (left, top, left + cw, top + ch)


def regions(mask, preview=None):
    from object_removal import removal_regions
    boxes = removal_regions(mask, padding=64, context_ratio=.5)
    if preview:
        boxes = [b for b in boxes if b[0] < preview[2] and b[2] > preview[0] and b[1] < preview[3] and b[3] > preview[1]]
    return boxes


def donor_texture(rgb, mask):
    """Use only unselected nearby pixels; never put original defects back."""
    result = np.zeros_like(rgb, dtype=np.float32)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    fine = rgb.astype(np.float32) - cv2.GaussianBlur(rgb.astype(np.float32), (0, 0), 1.2)
    low = cv2.GaussianBlur(rgb.astype(np.float32), (0, 0), 3)
    found = 0
    for label in range(1, count):
        x, y, w, h, _ = stats[label]
        component = labels == label
        ring = (cv2.dilate(component.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0) & ~mask
        if not ring.any():
            continue
        target_color = np.median(low[ring], axis=0)
        # Shift a spot-sized donor over a bounded local grid. Avoid all selected spots.
        step = max(3, min(w, h) // 2)
        reach = min(96, max(w, h) * 3 + 12)
        best = None
        local = component[y:y+h, x:x+w]
        for dy in range(-reach, reach + 1, step):
            for dx in range(-reach, reach + 1, step):
                xx, yy = x + dx, y + dy
                if xx < 0 or yy < 0 or xx + w > rgb.shape[1] or yy + h > rgb.shape[0]:
                    continue
                if mask[max(0, yy-2):yy+h+2, max(0, xx-2):xx+w+2].any():
                    continue
                patch = low[yy:yy+h, xx:xx+w][local]
                score = float(np.abs(np.median(patch, axis=0) - target_color).mean())
                score += float(patch.std(axis=0).mean()) * .25 + math.hypot(dx, dy) * .015
                if best is None or score < best[0]:
                    best = (score, xx, yy)
        if best is not None:
            _, xx, yy = best
            view = result[y:y+h, x:x+w]
            view[local] = np.clip(fine[yy:yy+h, xx:xx+w][local], -12, 12)
            found += 1
    return result, found


def heal(source, mask, settings, active=lambda: None, preview=None):
    rgb = np.asarray(source)
    result = rgb.copy()
    donor_count = 0
    count, _, stats, _ = cv2.connectedComponentsWithStats((np.asarray(mask) > 0).astype(np.uint8), 8)
    if count > 129:
        raise ValueError('Hãy sửa tối đa 128 khuyết điểm mỗi lượt.')
    if np.max(stats[1:, 2:4]) > 256:
        raise ValueError('Vùng xóa khuyết điểm quá rộng. Tô sát từng điểm hoặc chọn Sửa vùng da bằng AI.')
    for box in regions(mask, preview):
        active()
        selected = np.asarray(mask.crop(box)) > 0
        distance = cv2.distanceTransform(np.pad(selected.astype(np.uint8), 1), cv2.DIST_L2, 3)[1:-1, 1:-1]
        if distance.max() > 32 or selected.mean() > .65:
            raise ValueError('Vùng xóa khuyết điểm quá rộng. Tô sát từng điểm hoặc chọn Sửa vùng da bằng AI.')
        patch = np.asarray(source.crop(box))
        radius = {'light': 2, 'balanced': 3, 'strong': 5}[settings['level']]
        filled = cv2.inpaint(patch, selected.astype(np.uint8) * 255, radius, cv2.INPAINT_TELEA).astype(np.float32)
        if settings['preserveTexture']:
            texture, found = donor_texture(patch, selected)
            filled += texture
            donor_count += found
        x, y, right, bottom = box
        view = result[y:bottom, x:right]
        view[selected] = np.rint(filled).clip(0, 255).astype(np.uint8)[selected]
    return Image.fromarray(result), dict(textureDonors=donor_count)


def ai(source, mask, settings, env, active, progress, preview=None):
    from object_removal import prepare_region, restore_region
    if not configuration(env['ROOT'])['modelReady']:
        raise ValueError('Chưa có model sửa da AI trên máy. Có thể dùng Làm mịn hoặc Xóa khuyết điểm nhỏ.')
    torch = env['torch']
    path = Path(env['ROOT']) / MODEL_DIR
    active()
    # A dedicated load also isolates this tool from user-selected LoRA adapters.
    env['release_inpaint']()
    pipe = None
    boxes = regions(mask, preview)
    for box in boxes:
        if (np.asarray(mask.crop(box)) > 0).mean() > .65:
            raise ValueError('Cần chừa da xung quanh để AI tham chiếu. Hãy tô sát vùng cần sửa.')
    strength = {'light': .35, 'balanced': .50, 'strong': .70}[settings['level']]
    steps = math.ceil(16 / strength)
    effective = int(steps * strength)
    generated = source.copy()
    seeds = []
    try:
        pipe = env['load_inpaint_pipe'](lambda *_: active(), path, 'sdxl')
        pipe.unload_lora_weights()
        if not torch.cuda.is_available():
            pipe.to(dtype=torch.float32)
        for index, box in enumerate(boxes):
            active()
            # Heal the defect before diffusion so low strength doesn't retain a scar.
            region, selection, size = prepare_region(source, mask, box, 768)
            def on_step(pipeline, step_index, timestep, kwargs):
                active()
                progress(index * effective + step_index + 1, len(boxes) * effective)
                return kwargs
            prompt = PROMPT if settings['preserveTexture'] else PROMPT.replace('fine pores, ', '')
            # Box-based seed is stable between full runs and cropped previews.
            seed = (42 + box[0] * 73856093 + box[1] * 19349663) % 2147483647
            seeds.append(seed)
            with torch.inference_mode():
                output = env['traced_pipeline_call'](pipe, prompt=prompt, negative_prompt=NEGATIVE,
                    image=region, mask_image=selection, width=region.width, height=region.height,
                    strength=strength, num_inference_steps=steps, guidance_scale=4.5,
                    generator=torch.Generator('cpu').manual_seed(seed),
                    callback_on_step_end=on_step, callback_on_step_end_tensor_inputs=['latents']).images[0]
            active()
            if output.size != region.size:
                raise RuntimeError('Kích thước vùng sửa da AI không đúng; không lưu kết quả.')
            patch = np.asarray(restore_region(output, box, size)).astype(np.float32)
            before = np.asarray(source.crop(box)).astype(np.float32)
            selected = np.asarray(mask.crop(box)) > 0
            ring = (cv2.dilate(selected.astype(np.uint8), np.ones((13, 13), np.uint8)) > 0) & ~selected
            if ring.any():
                patch += np.clip(np.median(before[ring] - patch[ring], axis=0), -16, 16)
            generated.paste(Image.fromarray(np.rint(patch).clip(0, 255).astype(np.uint8)), box[:2])
    finally:
        del pipe
        env['release_inpaint']()
    return generated, dict(aiRegions=len(boxes), regionBoxes=boxes, regionSeeds=seeds, model=MODEL, strength=strength,
                           inferenceSteps=steps, prompt=PROMPT, negativePrompt=NEGATIVE)


def process(source, mask, settings, env, active, progress, preview=None):
    active()
    if settings['method'] == 'skin-smooth':
        result, metrics = smooth(source, settings['skinSmooth'], settings['preserveTexture']), {}
    elif settings['method'] == 'skin-heal':
        result, metrics = heal(source, mask, settings, active, preview)
    else:
        result, metrics = ai(source, mask, settings, env, active, progress, preview)
    if settings['method'] != 'skin-smooth' and settings['skinSmooth']:
        result = smooth(result, settings['skinSmooth'], settings['preserveTexture'])
    active()
    return result, dict(skinRetouch=True, **metrics)
