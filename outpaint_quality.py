"""Outpainting quality guards and saved-layout validation, without model loading."""
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def source_fingerprint(source):
    return hashlib.sha256(source.convert('RGB').tobytes()).hexdigest()


def load_layout(root, outputs, reference, source_id, source, geometry):
    if not isinstance(reference, dict) or not isinstance(reference.get('seed'), int) or isinstance(reference['seed'], bool):
        raise ValueError('Phương án bố cục không hợp lệ.')
    directory = (Path(root) / str(reference.get('directory', ''))).resolve()
    if not directory.is_relative_to(Path(outputs).resolve()) or not directory.name.startswith('outpaint_'):
        raise ValueError('Bố cục phải nằm trong thư mục kết quả mở rộng ảnh.')
    metadata = json.loads((directory / 'metadata.json').read_text(encoding='utf-8'))
    if metadata.get('taskType') != 'outpaint' or metadata.get('source') != source_id:
        raise ValueError('Bố cục không thuộc ảnh nguồn đã chọn.')
    if metadata.get('sourceFingerprint') != source_fingerprint(source):
        raise ValueError('Ảnh nguồn đã thay đổi hoặc bố cục chưa có thông tin kiểm chứng; hãy tạo lại bố cục.')
    for name in ('width', 'height', 'left', 'top', 'sourceWidth', 'sourceHeight'):
        if metadata['geometry'].get(name) != geometry[name]:
            raise ValueError('Khung mở rộng khác với bố cục đã lưu.')
    seed = reference['seed']
    if not any(item['seed'] == seed for item in metadata.get('results', [])):
        raise ValueError('Phương án bố cục chưa hoàn tất.')
    filename = (directory / f'overview_seed_{seed}.png').resolve()
    if not filename.is_relative_to(directory):
        raise ValueError('Đường dẫn bố cục không hợp lệ.')
    image = Image.open(filename).convert('RGB')
    if image.size != (geometry['width'], geometry['height']):
        raise ValueError('Kích thước bố cục không hợp lệ.')
    return image, metadata


def tile_mask(mask, box, canvas_size):
    """Keep an overview context rim in dense tiles; overlapping tiles fill it."""
    local = mask.crop(box).copy()
    values = np.asarray(local)
    if np.count_nonzero(values) / values.size < .9:
        return local
    left, top, right, bottom = box
    rim = max(4, min(32, local.width // 8, local.height // 8))
    if left > 0: local.paste(0, (0, 0, rim, local.height))
    if top > 0: local.paste(0, (0, 0, local.width, rim))
    if right < canvas_size[0]: local.paste(0, (local.width-rim, 0, local.width, local.height))
    if bottom < canvas_size[1]: local.paste(0, (0, local.height-rim, local.width, local.height))
    return local


def exclude_source(mask, geometry, seam_width=0):
    from outpainting import seam_band
    values = np.asarray(mask).copy()
    x, y = geometry['left'], geometry['top']
    values[y:y+geometry['sourceHeight'], x:x+geometry['sourceWidth']] = 0
    if seam_width:
        values[np.asarray(seam_band(geometry, seam_width)) > 0] = 0
    return Image.fromarray(values)


def boundary_diagnostics(image, geometry):
    rgb = np.asarray(image.convert('RGB'), dtype=np.float32)
    x, y = geometry['left'], geometry['top']
    w, h = geometry['sourceWidth'], geometry['sourceHeight']
    sides = {}
    for name, enabled, a, b in (
        ('left', x, rgb[y:y+h, x], rgb[y:y+h, max(0,x-1)]),
        ('right', geometry['right'], rgb[y:y+h, min(rgb.shape[1]-1,x+w)], rgb[y:y+h,x+w-1]),
        ('top', y, rgb[y,x:x+w], rgb[max(0,y-1),x:x+w]),
        ('bottom', geometry['bottom'], rgb[min(rgb.shape[0]-1,y+h),x:x+w], rgb[y+h-1,x:x+w]),
    ):
        if enabled:
            per_pixel = np.abs(a-b).mean(axis=-1)
            sides[name] = {'mean': round(float(per_pixel.mean()), 4),
                           'p95': round(float(np.percentile(per_pixel, 95)), 4)}
    return sides


def final_seam_review(image, geometry):
    """Inspect both the immediate cut and a broad strip of the final image.

    Regression guards compare intermediate images; they cannot certify a bad
    starting layout. These diagnostics flag discontinuity, never approve content.
    """
    rgb = np.asarray(image.convert('RGB'), dtype=np.float32)
    x,y,w,h = (geometry[k] for k in ('left','top','sourceWidth','sourceHeight'))
    sides = {}
    for name, extent, inside, outside in (
        ('left',x,rgb[y:y+h,x:x+w],rgb[y:y+h,:x][:,::-1]),
        ('right',geometry['right'],rgb[y:y+h,x:x+w][:,::-1],rgb[y:y+h,x+w:]),
        ('top',y,rgb[y:y+h,x:x+w].transpose(1,0,2),rgb[:y,x:x+w][::-1].transpose(1,0,2)),
        ('bottom',geometry['bottom'],rgb[y:y+h,x:x+w][::-1].transpose(1,0,2),rgb[y+h:,x:x+w].transpose(1,0,2)),
    ):
        if not extent: continue
        width = min(64, inside.shape[1]//2, outside.shape[1])
        if width < 2: continue
        immediate = float(np.abs(inside[:,0]-outside[:,0]).mean())
        natural = float(np.abs(np.diff(inside[:,:width],axis=1)).mean())
        # Extrapolate the source's broad trend instead of penalizing a smooth gradient.
        near = inside[:,:width].mean(1)
        far = inside[:,width:2*width].mean(1)
        expected = near + (near-far)
        drift = float(np.abs(outside[:,:width].mean(1)-expected).mean())
        source_variation = float(np.abs(inside[:,:width]-near[:,None]).mean())
        reasons=[]
        if immediate > max(6.,natural*3+2): reasons.append('visible-cut')
        if drift > max(14.,source_variation*2+5): reasons.append('broad-colour-band')
        outside_normal = float(np.abs(np.diff(outside[:,:width],axis=1)).mean())
        inside_tangent = float(np.abs(np.diff(inside[:,:width],axis=0)).mean()) if inside.shape[0]>1 else 0.
        outside_tangent = float(np.abs(np.diff(outside[:,:width],axis=0)).mean()) if outside.shape[0]>1 else 0.
        stretched = natural>1.5 and inside_tangent>1.5 and outside_normal<natural*.55 and outside_tangent>inside_tangent*.5
        if stretched: reasons.append('stretched-detail')
        sides[name]=dict(boundaryMAE=round(immediate,3),contextGradient=round(natural,3),
                         broadDrift=round(drift,3),outsideGradient=round(outside_normal,3),reasons=reasons)
    flagged = any(side['reasons'] for side in sides.values())
    return dict(status='needs-review' if flagged else 'unverified', sides=sides,
        message=('Có dấu hiệu lệch màu, kéo giãn chi tiết hoặc đứt đường nối. Xem ở 100%; nếu bố cục sai, tạo bố cục mới trước khi hoàn thiện.'
                 if flagged else 'Chưa thấy đứt đường nối lớn; vẫn cần xem nội dung, tóc và nền ở 100%.'),
        method='final-multiscale-seam-v2')


def choose_refinement(before, candidate, geometry, editable, protected=None, stage='detail'):
    """Reject measurable regressions. This is not a semantic/aesthetic judge."""
    a, b = np.asarray(before.convert('RGB')), np.asarray(candidate.convert('RGB'))
    if a.shape != b.shape or editable.size != before.size:
        raise ValueError('Kích thước ảnh kiểm tra không khớp.')
    allowed = np.asarray(editable) > 0
    locked = np.asarray(protected) > 0 if protected is not None else np.zeros(allowed.shape, dtype=bool)
    if geometry['preserveOriginal']:
        x,y=geometry['left'],geometry['top']
        locked[y:y+geometry['sourceHeight'],x:x+geometry['sourceWidth']] = True
    changed = np.any(a != b, axis=-1)
    scope_error = int(np.count_nonzero(changed & (~allowed | locked)))
    reasons = ['protected-or-outside-mask'] if scope_error else []
    old_edges, new_edges = boundary_diagnostics(before, geometry), boundary_diagnostics(candidate, geometry)
    for side, old in old_edges.items():
        new = new_edges[side]
        if new['mean'] > old['mean'] * 1.12 + .5 or new['p95'] > old['p95'] * 1.2 + 2:
            reasons.append('boundary-' + side)
    # A smaller boundary jump can be obtained by stretching source columns.
    # Reject this newly introduced defect even when the immediate cut improves.
    if stage in ('seam', 'background', 'finish'):
        previous_review = final_seam_review(before, geometry)
        next_review = final_seam_review(candidate, geometry)
        for side, review in next_review['sides'].items():
            if ('stretched-detail' in review['reasons'] and
                    'stretched-detail' not in previous_review['sides'].get(side,{}).get('reasons',[])):
                reasons.append('stretched-detail-' + side)
    stats = {'coarseChange': 0., 'detailBefore': 0., 'detailAfter': 0.}
    bbox = editable.getbbox()
    if bbox:
        # Bound metric memory and compare the same region at the same scale.
        aa, bb = before.crop(bbox), candidate.crop(bbox)
        scale = min(1., 1024 / max(aa.size))
        size = tuple(max(1, round(v*scale)) for v in aa.size)
        av = np.asarray(aa.resize(size, Image.Resampling.LANCZOS), dtype=np.float32)
        bv = np.asarray(bb.resize(size, Image.Resampling.LANCZOS), dtype=np.float32)
        selected = np.asarray(editable.crop(bbox).resize(size, Image.Resampling.NEAREST)) > 0
        low_a, low_b = cv2.GaussianBlur(av,(0,0),3), cv2.GaussianBlur(bv,(0,0),3)
        if selected.any():
            coarse = float(np.abs(low_a-low_b)[selected].mean())
            ea = float(np.abs(av-low_a)[selected].mean())
            eb = float(np.abs(bv-low_b)[selected].mean())
            stats = {'coarseChange':round(coarse,4),'detailBefore':round(ea,4),'detailAfter':round(eb,4)}
            if coarse > (28 if stage == 'seam' else 18): reasons.append('structure-or-colour-drift')
            # Removing a background band/noise is expected to reduce its energy.
            if ea > 2 and eb < ea*.7 and stage not in ('finish','seam','background'): reasons.append('detail-loss')
            if eb > ea*2.5+3: reasons.append('excess-detail-or-noise')
    report = dict(stage=stage, accepted=not reasons, reasons=reasons, scopeErrorPixels=scope_error,
                  boundaryBefore=old_edges,boundaryAfter=new_edges,**stats,
                  note='Heuristic regression checks; visual review is still required.')
    return (candidate if not reasons else before), report


class PromptEmbeddingCache:
    """Job-local CPU cache: preserve model/tokenizer identity and text tracing."""
    def __init__(self, pipe):
        self.pipe, self.values, self.hits, self.misses = pipe, {}, 0, 0

    def apply(self, kwargs):
        # FLUX has no separate negative embedding/CFG branch. Other models keep
        # their native encode path until their exact signatures are supported.
        if type(self.pipe).__name__ != 'FluxFillPipeline' or not hasattr(self.pipe, 'encode_prompt'):
            return kwargs
        text_keys = ('prompt', 'prompt_2', 'max_sequence_length')
        key = tuple(kwargs.get(name, 512 if name == 'max_sequence_length' else None) for name in text_keys)
        if key not in self.values:
            import torch
            with torch.inference_mode():
                embeds, pooled, _ = self.pipe.encode_prompt(prompt=key[0],prompt_2=key[1],
                    device=self.pipe._execution_device,num_images_per_prompt=1,max_sequence_length=key[2])
            self.values[key] = (embeds.detach().cpu(), pooled.detach().cpu())
            self.misses += 1
        else:
            self.hits += 1
        embeds, pooled = self.values[key]
        result = {k:v for k,v in kwargs.items() if k not in ('prompt','prompt_2')}
        result.update(prompt_embeds=embeds.to(self.pipe._execution_device),
                      pooled_prompt_embeds=pooled.to(self.pipe._execution_device))
        return result
