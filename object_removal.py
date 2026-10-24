"""Local object-removal geometry and conservative quality checks; no model loading."""
import math

import cv2
import numpy as np
from PIL import Image


def model_settings(body, profile, architecture):
    """Explicit values win over defaults, including deliberately low strength."""
    limits = {"guidance": (1.0, 50.0 if architecture == "flux" else 12.0),
              "strength": (0.2, 1.0), "steps": (4, 60), "maxSide": (512, 1024)}
    defaults = dict(guidance=profile.get("guidance", 30 if architecture == "flux" else 6),
                    strength=profile.get("strength", 1.0), steps=profile.get("steps", 40),
                    maxSide=profile.get("nativeResolution", 1024))
    values = {}
    for key, (low, high) in limits.items():
        value = float(body.get(key, defaults[key]))
        if not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"{key} phải nằm trong khoảng {low:g}–{high:g}")
        values[key] = int(value) if key in ("steps", "maxSide") else value
    return values


def removal_regions(mask, padding=96, context_ratio=0.30, max_regions=8):
    """Group overlapping context crops at source resolution, before any resize."""
    binary = (np.asarray(mask.convert("L")) > 16).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    boxes = []
    for x, y, width, height, area in stats[1:]:
        if not area:
            continue
        pad = max(int(padding), round(max(width, height) * context_ratio), 32)
        boxes.append((max(0, int(x)-pad), max(0, int(y)-pad),
                      min(mask.width, int(x+width)+pad), min(mask.height, int(y+height)+pad)))
    merged = []
    for box in boxes:
        # Revisit the list: merging two boxes may connect a third context crop.
        again = True
        while again:
            again = False
            for other in merged[:]:
                if box[0] <= other[2] and other[0] <= box[2] and box[1] <= other[3] and other[1] <= box[3]:
                    box = (min(box[0], other[0]), min(box[1], other[1]),
                           max(box[2], other[2]), max(box[3], other[3]))
                    merged.remove(other)
                    again = True
        merged.append(box)
    if len(merged) > max_regions:
        # Bound work without dropping any selected pixels.
        return [(min(b[0] for b in merged), min(b[1] for b in merged),
                 max(b[2] for b in merged), max(b[3] for b in merged))]
    return sorted(merged, key=lambda b: (b[1], b[0]))


def prepare_region(source, mask, box, max_side, erase_conditioning=True):
    crop, selected = source.crop(box), mask.crop(box)
    scale = max_side / max(crop.size)
    size = (max(1, round(crop.width*scale)), max(1, round(crop.height*scale)))
    rgb = np.asarray(crop.resize(size, Image.Resampling.LANCZOS))
    # Max-pooling through BOX keeps thin selections alive when downsampling.
    mode = Image.Resampling.BOX if scale < 1 else Image.Resampling.NEAREST
    binary = np.asarray(selected.resize(size, mode)) > 0
    if erase_conditioning and binary.any():
        # Low-strength img2img starts from image latents. Remove the original
        # object's color/shape there too, rather than asking noise to erase it.
        rgb = cv2.inpaint(rgb, binary.astype(np.uint8)*255, 3, cv2.INPAINT_TELEA) if not binary.all() else np.full_like(rgb, 127)
    pad_x, pad_y = (-size[0]) % 64, (-size[1]) % 64
    image = Image.fromarray(np.pad(rgb, ((0, pad_y), (0, pad_x), (0, 0)), mode="edge"))
    model_mask = Image.fromarray(np.pad(binary.astype(np.uint8)*255, ((0, pad_y), (0, pad_x))))
    return image, model_mask, size


def restore_region(generated, box, unpadded_size):
    return generated.crop((0, 0, *unpadded_size)).resize(
        (box[2]-box[0], box[3]-box[1]), Image.Resampling.LANCZOS)


def blend_removal(source, generated, removal_mask, composite_mask, protected=None):
    """Never reintroduce source pixels inside the object; feather only outside it."""
    core = (np.asarray(removal_mask.convert("L")) > 16).astype(np.uint8)
    allowed = (np.asarray(composite_mask.convert("L")) > 16).astype(np.uint8)
    if protected is not None:
        locked = np.asarray(protected.convert("L")) > 16
        core[locked] = 0
        allowed[locked] = 0
    core &= allowed
    to_core = cv2.distanceTransform(1-core, cv2.DIST_L2, 5)
    # Explicit zero padding also defines the edge when a mask touches the image border.
    to_edge = cv2.distanceTransform(np.pad(allowed, 1), cv2.DIST_L2, 5)[1:-1, 1:-1]
    alpha = to_edge / np.maximum(to_edge + to_core, 1e-6)
    alpha = alpha*alpha*(3-2*alpha)*allowed
    alpha[core > 0] = 1.0
    before = np.asarray(source.convert("RGB"))
    after = np.asarray(generated.convert("RGB"))
    output = np.rint(after*alpha[..., None] + before*(1-alpha[..., None])).clip(0, 255).astype(np.uint8)
    output[allowed == 0] = before[allowed == 0]
    return Image.fromarray(output), Image.new("L", source.size), {
        "enabled": True, "method": "replace-core-feather-outward-v1",
        "corePixels": int(core.sum()), "bandPixels": int((allowed-core).sum()),
        "artifactPixels": 0, "artifactRatio": 0.0, "boundaryColorMatch": False,
    }


def match_simple_background(source, generated, editable, protected=None):
    """Continue only locally predictable colour/parallel texture across a hole.

    Fit from unselected source context, validate on a separate surrounding ring,
    and abstain on texture, borders, protected holes or insufficient context.
    No clean/reference image is used and no pixels outside editable are changed.
    """
    rgb = np.asarray(source.convert('RGB'), dtype=np.float32)
    output = np.asarray(generated.convert('RGB')).copy()
    allowed = np.asarray(editable.convert('L')) > 16
    locked = np.asarray(protected.convert('L')) > 0 if protected is not None else np.zeros(allowed.shape, bool)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(allowed.astype(np.uint8), 8)
    repairs = []
    for label, (x, y, w, h, area) in enumerate(stats[1:], 1):
        x, y, w, h = map(int, (x, y, w, h))
        pad = 12
        if (area < 16 or area > allowed.size * .25 or area < w*h*.5 or
                x < pad or y < pad or x+w+pad > source.width or y+h+pad > source.height):
            continue
        box = (slice(y-pad, y+h+pad), slice(x-pad, x+w+pad))
        local, selected = rgb[box], allowed[box]
        # Never read through a second selection or bridge a protected island.
        ring = np.ones(selected.shape, bool); ring[pad:-pad, pad:-pad] = False
        if np.any(selected & ring) or np.any(locked[box]):
            continue
        hh, ww = selected.shape
        yy, xx = np.mgrid[:hh, :ww]
        training = (xx < 3) | (xx >= ww-3) | (yy < 3) | (yy >= hh-3)
        validation = ring & ~training
        design = np.stack((np.ones_like(xx), xx/ww, yy/hh), -1)
        coeff = np.linalg.lstsq(design[training], local[training], rcond=None)[0]
        candidates = [('plane', design @ coeff)]
        # Opposite strips are donors; inner strips and perpendicular edges are
        # withheld to detect incompatible shading, perspective and texture.
        left, right = local[:, :3].mean(1), local[:, -3:].mean(1)
        t = ((np.arange(ww)-1)/(ww-3))[None, :, None]
        candidates.append(('horizontal', left[:, None]*(1-t)+right[:, None]*t))
        top, bottom = local[:3].mean(0), local[-3:].mean(0)
        t = ((np.arange(hh)-1)/(hh-3))[:, None, None]
        candidates.append(('vertical', top[None]*(1-t)+bottom[None]*t))
        accepted = []
        for method, prediction in candidates:
            error = np.abs(prediction-local)[validation]
            mean, p95 = float(error.mean()), float(np.percentile(error, 95))
            if mean <= 1.2 and p95 <= 3 and prediction.min() >= -1 and prediction.max() <= 256:
                accepted.append((mean, method, prediction, p95))
        if not accepted:
            continue
        mean, method, prediction, p95 = min(accepted, key=lambda item:item[0])
        active = (labels[box] == label) & ~locked[box]
        patch = output[box]
        patch[active] = np.rint(prediction[active]).clip(0, 255).astype(np.uint8)
        repairs.append(dict(method=method, pixels=int(active.sum()), validationMAE=round(mean, 4),
                            validationP95=round(p95, 4), box=[x,y,w,h]))
    return Image.fromarray(output), dict(method='validated-source-context-v1', applied=bool(repairs),
        regions=repairs, note='Predictable local background only; visual review is still required.')


def visual_change(source, result, mask):
    selected = np.asarray(mask.convert("L")) > 16
    if not selected.any():
        return {"accepted": False, "status": "invalid-mask", "statusLabel": "Mask không hợp lệ",
                "changedPixelRatio": 0.0, "meanChange": 0.0, "retryRecommended": False}
    delta = np.abs(np.asarray(result.convert("RGB"), dtype=np.int16) -
                   np.asarray(source.convert("RGB"), dtype=np.int16)).mean(axis=2)[selected]/255.0
    unchanged = float(delta.mean()) < 0.002
    return {"accepted": False, "status": "unchanged" if unchanged else "unverified",
            "statusLabel": "Vùng chọn gần như chưa thay đổi" if unchanged else "Đã tạo ảnh · cần kiểm tra trực quan",
            "changedPixelRatio": round(float((delta > 0.10).mean()), 4),
            "meanChange": round(float(delta.mean()), 4), "retryRecommended": unchanged,
            "method": "visual-change-diagnostic-v2"}


def assess_removal(check, before, after, outside_mae=0.0):
    check = {**check, "semanticBefore": before, "semantic": after}
    if outside_mae > 0:
        check.update(accepted=False, status="preservation-failed", statusLabel="Vùng ngoài mask bị thay đổi", retryRecommended=False)
    elif after.get("available") and after.get("detected"):
        check.update(accepted=False, status="residual", statusLabel="Bộ nhận diện còn thấy vật thể", retryRecommended=True)
    elif before.get("available") and before.get("detected") and after.get("available") and check["status"] == "unverified":
        check.update(accepted=True, status="detector-passed", statusLabel="Không còn phát hiện vật thể · cần xem lại nền", retryRecommended=False)
    # Absence without a positive source detection is not proof of removal.
    return check


def boundary_metric(source, result, mask):
    """Boundary error is a ranking diagnostic, never a semantic acceptance gate."""
    a, b = np.asarray(source, dtype=np.float32), np.asarray(result, dtype=np.float32)
    m = np.asarray(mask) > 16
    errors = []
    for axis in (0, 1):
        crossing = np.diff(m.astype(np.int8), axis=axis) != 0
        if crossing.any():
            errors.append(np.abs(np.diff(b, axis=axis)-np.diff(a, axis=axis))[crossing].mean())
    return round(float(np.mean(errors))/255.0, 6) if errors else 0.0


def removal_rank(item):
    check = item["removalCheck"]
    tier = 3 if check.get("status") in ("preservation-failed", "invalid-mask") else 0 if check.get("accepted") else 2 if check.get("retryRecommended") else 1
    return (tier, item.get("outsideMaskMAE", 0.0), check.get("boundaryError", 0.0), item["seed"])
