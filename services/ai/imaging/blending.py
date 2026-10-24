"""AI Atelier: imaging.blending."""
from PIL import Image, ImageFilter, ImageOps
from prompt_catalog import prompt_text, prompt_template, read_catalog, task_prompt
import cv2
import numpy as np
import torch
from services.ai.imaging.segmentation import automatic_protected_detail_mask, pose_garment_prior
from services.ai.models.pipelines import load_inpaint_pipe
from services.ai.runtime.tracing import traced_pipeline_call


def mask_strength_policy(mask: Image.Image, person_box=None, category: str = "upper_body", keypoints=None) -> dict:
    coverage = float((np.asarray(mask, dtype=np.uint8) > 16).mean())
    relative_coverage = None
    completeness = None
    if person_box is not None:
        px0, py0, px1, py1 = [int(round(value)) for value in person_box]
        mask_array = np.asarray(mask, dtype=np.uint8) > 16
        person_pixels = max(1, max(0, px1 - px0) * max(0, py1 - py0))
        relative_coverage = float(mask_array[max(0, py0):min(mask.height, py1), max(0, px0):min(mask.width, px1)].sum() / person_pixels)
        prior = pose_garment_prior(mask.size, category, person_box, keypoints) > 0
        if keypoints:
            protected = np.asarray(automatic_protected_detail_mask(Image.new("RGB", mask.size), person_box, keypoints), dtype=np.uint8) > 16
            prior = np.logical_and(prior, ~protected)
        prior_pixels = int(prior.sum())
        completeness = float(np.logical_and(mask_array, prior).sum() / prior_pixels) if prior_pixels else None
    accepted = coverage >= 0.025 and (completeness is None or completeness >= 0.72)
    if coverage < 0.045:
        strength = 0.50
    elif coverage < 0.08:
        strength = 0.60
    else:
        strength = 0.70
    return {"coverage": coverage, "relativePersonCoverage": relative_coverage, "garmentCompleteness": completeness, "accepted": accepted, "recommendedStrength": strength, "minimumCoverage": 0.025, "minimumGarmentCompleteness": 0.72}


def effective_step_policy(requested_steps: int, strength: float, minimum_effective_steps: int = 12, allow_fast_preview: bool = False) -> dict:
    """Guarantee enough denoising work after diffusers truncates timesteps by strength."""
    requested = max(4, min(60, int(requested_steps)))
    bounded_strength = max(0.2, min(1.0, float(strength)))
    minimum = 0 if allow_fast_preview else max(0, min(24, int(minimum_effective_steps)))
    required_total = int(np.ceil(minimum / bounded_strength)) if minimum else requested
    adjusted = max(requested, required_total)
    adjusted = min(60, adjusted)
    effective = max(1, int(adjusted * bounded_strength))
    return {
        "requestedSteps": requested, "adjustedSteps": adjusted, "effectiveSteps": effective,
        "minimumEffectiveSteps": minimum, "autoAdjusted": adjusted != requested,
        "allowFastPreview": bool(allow_fast_preview),
    }


def prepare_dual_inpaint_masks(
    editable_mask: Image.Image,
    protected_mask: Image.Image | None = None,
    generation_expand: int = 24,
    composite_expand: int | None = None,
):
    """Build a generous generation mask and a tighter final-composite mask."""
    generation_expand = max(0, min(64, int(generation_expand)))
    if composite_expand is None:
        composite_expand = min(8, max(2, round(generation_expand * 0.25)))
    composite_expand = max(0, min(generation_expand, int(composite_expand)))

    base = editable_mask.convert("L").point(lambda value: 255 if value > 16 else 0)
    # OpenCV dilation avoids the very expensive large PIL rank filter on 4K masks.
    def dilate(radius):
        return Image.fromarray(cv2.dilate(np.asarray(base), np.ones((radius*2+1, radius*2+1), np.uint8))) if radius else base.copy()
    generation, composite = dilate(generation_expand), dilate(composite_expand)
    if protected_mask is not None:
        protected = np.asarray(protected_mask.convert("L"), dtype=np.uint8) > 16
        generation_array = np.asarray(generation, dtype=np.uint8).copy()
        composite_array = np.asarray(composite, dtype=np.uint8).copy()
        generation_array[protected] = 0
        composite_array[protected] = 0
        generation = Image.fromarray(generation_array, mode="L")
        composite = Image.fromarray(composite_array, mode="L")
    return generation, composite, {
        "generationExpand": generation_expand,
        "compositeExpand": composite_expand,
        "generationPixels": int((np.asarray(generation) > 16).sum()),
        "compositePixels": int((np.asarray(composite) > 16).sum()),
    }


def adaptive_inpaint_context_padding(mask: Image.Image, requested_padding: int = 96, context_ratio: float = 0.30) -> int:
    """Keep enough surrounding pose and lighting context around the edit."""
    requested = max(0, min(256, int(requested_padding)))
    bbox = mask.getbbox()
    if bbox is None:
        return requested
    extent = max(bbox[2] - bbox[0], bbox[3] - bbox[1])
    adaptive = round(extent * max(0.0, min(0.5, float(context_ratio))))
    return max(requested, min(256, adaptive))


def adaptive_local_edge_blend(source: Image.Image, generated: Image.Image, hard_mask: Image.Image, feather_pixels: int = 12):
    """Blend inward from the mask edge and repair only abnormal dark/bright seam pixels."""
    source_array = np.asarray(source.convert("RGB"), dtype=np.uint8)
    generated_array = np.asarray(generated.convert("RGB"), dtype=np.uint8)
    binary = (np.asarray(hard_mask, dtype=np.uint8) > 16).astype(np.uint8)
    feather = max(3, min(32, int(feather_pixels)))
    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    ramp = np.clip(distance / float(feather), 0.0, 1.0)
    alpha = ramp * ramp * (3.0 - 2.0 * ramp) * binary
    # Match only low-frequency color near the boundary; keep new content in
    # the core intact and never copy source texture into the generated region.
    sigma = max(3.0, float(feather))
    ring = np.logical_and(binary > 0, distance <= max(2.0, feather * 0.25)).astype(np.float32)
    weights = cv2.GaussianBlur(ring, (0, 0), sigma)
    delta = source_array.astype(np.float32) - generated_array.astype(np.float32)
    correction = cv2.GaussianBlur(delta * ring[..., None], (0, 0), sigma) / np.maximum(weights[..., None], 1e-6)
    correction = np.clip(correction, -32.0, 32.0)
    fade = np.clip(1.0 - distance / float(feather * 3), 0.0, 1.0)
    fade = fade * fade * (3.0 - 2.0 * fade) * binary
    matched = np.clip(generated_array.astype(np.float32) + correction * fade[..., None], 0, 255)
    initial = np.clip(matched * alpha[..., None] + source_array * (1.0 - alpha[..., None]), 0, 255).astype(np.uint8)

    inner_band = np.logical_and(binary > 0, distance <= feather * 1.75)
    smooth = cv2.GaussianBlur(initial, (0, 0), 3.0)
    luminance = cv2.cvtColor(initial, cv2.COLOR_RGB2GRAY).astype(np.int16)
    smooth_luminance = cv2.cvtColor(smooth, cv2.COLOR_RGB2GRAY).astype(np.int16)
    deviation = np.abs(luminance - smooth_luminance)
    artifact = np.logical_and(inner_band, np.logical_or(deviation > 32, luminance < smooth_luminance - 24)).astype(np.uint8) * 255
    artifact = cv2.morphologyEx(artifact, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    artifact = cv2.dilate(artifact, np.ones((3, 3), np.uint8), iterations=1)
    artifact[binary == 0] = 0
    artifact_pixels = int((artifact > 0).sum())
    if artifact_pixels:
        repaired = cv2.inpaint(initial, artifact, 2.0, cv2.INPAINT_TELEA)
        repair_alpha = cv2.GaussianBlur(artifact, (0, 0), 1.2).astype(np.float32) / 255.0
        initial = np.clip(repaired * repair_alpha[..., None] + initial * (1.0 - repair_alpha[..., None]), 0, 255).astype(np.uint8)
    initial[binary == 0] = source_array[binary == 0]
    band_pixels = int(inner_band.sum())
    metrics = {
        "enabled": True, "featherPixels": feather, "bandPixels": band_pixels,
        "boundaryColorMatch": True, "featherCurve": "smoothstep",
        "artifactPixels": artifact_pixels,
        "artifactRatio": float(artifact_pixels / band_pixels) if band_pixels else 0.0,
    }
    return Image.fromarray(initial, mode="RGB"), Image.fromarray(artifact, mode="L"), metrics


def texture_preserving_core_recovery(image: Image.Image, hard_mask: Image.Image, edge_feather: int = 12, amount: float = 0.65):
    """Recover bounded high-frequency fabric detail strictly inside the stable mask core."""
    array = np.asarray(image.convert("RGB"), dtype=np.uint8)
    binary = (np.asarray(hard_mask, dtype=np.uint8) > 16).astype(np.uint8)
    feather = max(3, min(32, int(edge_feather)))
    gain = max(0.0, min(1.0, float(amount)))
    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    core_alpha = np.clip((distance - feather * 1.5) / max(3.0, feather * 1.5), 0.0, 1.0) * binary
    core = core_alpha >= 0.15
    if not core.any() or gain <= 0.0:
        metrics = {"enabled": gain > 0.0, "amount": gain, "corePixels": int(core.sum()), "laplacianVarianceBefore": 0.0, "laplacianVarianceAfter": 0.0, "detailGain": 0.0}
        return image.copy(), Image.fromarray((core_alpha * 255).astype(np.uint8), mode="L"), metrics

    # Bilateral high-pass retains generated garment edges while avoiding color halos.
    smooth = cv2.bilateralFilter(array, 0, 18, 2.2).astype(np.float32)
    original = array.astype(np.float32)
    high_frequency = np.clip(original - smooth, -18.0, 18.0)
    enhanced = np.clip(original + high_frequency * gain, 0, 255)
    alpha = (core_alpha * gain)[..., None]
    recovered = np.clip(enhanced * alpha + original * (1.0 - alpha), 0, 255).astype(np.uint8)

    gray_before = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    gray_after = cv2.cvtColor(recovered, cv2.COLOR_RGB2GRAY)
    lap_before = cv2.Laplacian(gray_before, cv2.CV_32F)[core]
    lap_after = cv2.Laplacian(gray_after, cv2.CV_32F)[core]
    variance_before = float(lap_before.var()) if lap_before.size else 0.0
    variance_after = float(lap_after.var()) if lap_after.size else 0.0
    metrics = {
        "enabled": True, "amount": gain, "corePixels": int(core.sum()),
        "laplacianVarianceBefore": variance_before, "laplacianVarianceAfter": variance_after,
        "detailGain": float(variance_after / max(variance_before, 1e-6)),
    }
    return Image.fromarray(recovered, mode="RGB"), Image.fromarray((core_alpha * 255).astype(np.uint8), mode="L"), metrics


def detect_core_structural_artifacts(image: Image.Image, hard_mask: Image.Image, edge_feather: int = 12):
    """Find unusually dark, elongated marks inside the stable garment core."""
    array = np.asarray(image.convert("RGB"), dtype=np.uint8)
    gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    binary = (np.asarray(hard_mask, dtype=np.uint8) > 16).astype(np.uint8)
    feather = max(3, min(32, int(edge_feather)))
    distance = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    core = np.logical_and(binary > 0, distance >= feather * 1.5)
    if not core.any():
        return Image.new("L", image.size, 0), {"detected": False, "artifactPixels": 0, "componentCount": 0}

    # A vertical black-hat isolates dark marks relative to nearby fabric while
    # rejecting broad shadows and ordinary low-frequency folds.
    local_close = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (9, 31)))
    response = cv2.subtract(local_close, gray)
    core_values = response[core]
    threshold = max(16.0, float(np.percentile(core_values, 98.5)))
    candidates = np.logical_and(core, response >= threshold).astype(np.uint8) * 255
    candidates = cv2.morphologyEx(candidates, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 9)))

    accepted = np.zeros_like(candidates)
    component_count = 0
    core_y, core_x = np.where(core)
    core_left, core_right = int(core_x.min()), int(core_x.max())
    central_left = core_left + (core_right - core_left) * 0.25
    central_right = core_right - (core_right - core_left) * 0.25
    count, labels, stats, _ = cv2.connectedComponentsWithStats(candidates, 8)
    plausible = []
    for label in range(1, count):
        x, y, width, height, area = [int(value) for value in stats[label]]
        elongated = height >= 22 and height >= width * 1.6 and area >= 12
        compact_mark = 8 <= area <= 180 and height >= 4 and width <= 14
        if elongated and central_left <= x + width * 0.5 <= central_right:
            accepted[labels == label] = 255
            component_count += 1
        elif compact_mark:
            plausible.append((label, x + width * 0.5, y, y + height))
    # A single button or stitch is legitimate. A vertically aligned sequence of
    # dark fragments spanning a larger distance is treated as a broken artifact.
    for label, center_x, top, bottom in plausible:
        aligned = [item for item in plausible if abs(item[1] - center_x) <= 14]
        span = max(item[3] for item in aligned) - min(item[2] for item in aligned)
        if len(aligned) >= 2 and span >= 35:
            accepted[labels == label] = 255
            component_count += 1
    if component_count:
        accepted = cv2.dilate(accepted, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 13)), iterations=1)
        accepted[~core] = 0
    artifact_pixels = int((accepted > 0).sum())
    return Image.fromarray(accepted, mode="L"), {
        "detected": artifact_pixels >= 500, "artifactPixels": artifact_pixels,
        "componentCount": component_count, "responseThreshold": threshold,
    }


def generative_core_structural_refine(image: Image.Image, hard_mask: Image.Image, seed: int, steps: int, edge_feather: int = 12):
    """Resynthesize only detected core defects and softly composite the small repaired region."""
    defect_mask, metrics = detect_core_structural_artifacts(image, hard_mask, edge_feather)
    if not metrics["detected"]:
        metrics.update({"applied": False, "reason": "no-confident-structural-artifact"})
        return image.copy(), defect_mask, metrics
    refine_mask = defect_mask.filter(ImageFilter.MaxFilter(9)).point(lambda value: 255 if value > 12 else 0)
    max_side = 768
    scale = min(max_side / max(image.size), 1.0)
    width = max(64, round(image.width * scale / 64) * 64)
    height = max(64, round(image.height * scale / 64) * 64)
    generator = torch.Generator(device="cpu").manual_seed(seed + 700000)
    pipe = load_inpaint_pipe()
    with torch.inference_mode():
        generated = traced_pipeline_call(pipe,
            prompt=prompt_text('generative_core_structural_refine.continuous_coherent_woven_garment_fabric_natural_folds'),
            negative_prompt=prompt_text('generative_core_structural_refine.zipper_isolated_buttons_vertical_scratch_tear_stain'),
            image=image.resize((width, height), Image.Resampling.LANCZOS),
            mask_image=refine_mask.resize((width, height), Image.Resampling.NEAREST),
            height=height, width=width, padding_mask_crop=96, strength=0.48,
            num_inference_steps=max(12, min(24, int(steps))), guidance_scale=4.0, generator=generator,
        ).images[0]
    generated = generated.resize(image.size, Image.Resampling.LANCZOS)
    blend = refine_mask.filter(ImageFilter.GaussianBlur(2.0))
    output = Image.composite(generated, image, blend)
    metrics.update({"applied": True, "strength": 0.48, "steps": max(12, min(24, int(steps)))})
    return output, refine_mask, metrics


def exclude_protected_pixels(mask: Image.Image, protected: Image.Image) -> Image.Image:
    pixels = np.asarray(mask, dtype=np.uint8).copy()
    pixels[np.asarray(protected, dtype=np.uint8) > 0] = 0
    return Image.fromarray(pixels)


def restore_protected_pixels(source: Image.Image, result: Image.Image, protected: Image.Image) -> Image.Image:
    return Image.composite(source, result, protected.point(lambda value: 255 if value > 0 else 0))


def reconstruction_edit_mask(selected: Image.Image, old_clothing: Image.Image, protected: Image.Image):
    """Let CatVTON replace old fabric with either new fabric or newly visible skin."""
    selected_pixels = np.asarray(selected, dtype=np.uint8) > 16
    old_pixels = np.asarray(old_clothing, dtype=np.uint8) > 16
    locked = np.asarray(protected, dtype=np.uint8) > 0
    editable = (selected_pixels | old_pixels) & ~locked
    added = editable & ~selected_pixels
    return Image.fromarray(editable.astype(np.uint8) * 255), Image.fromarray(added.astype(np.uint8) * 255)


def repair_local_seams(source: Image.Image, result: Image.Image, hard_mask: Image.Image):
    """Repair only high-frequency outliers in a narrow garment-boundary band."""
    array = np.asarray(result.convert("RGB"), dtype=np.uint8)
    mask = np.asarray(hard_mask, dtype=np.uint8)
    outer = cv2.dilate(mask, np.ones((11, 11), np.uint8), iterations=1) > 0
    inner = cv2.erode(mask, np.ones((11, 11), np.uint8), iterations=1) > 0
    # A seam repair must never change unselected fabric, skin or background.
    band = (outer ^ inner) & (mask > 0)
    gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    gradient = cv2.magnitude(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1))
    values = gradient[band]
    if not values.size:
        return result, Image.new("L", result.size, 0), 0
    threshold = max(45.0, float(np.percentile(values, 82)))
    artifacts = np.logical_and(band, gradient >= threshold).astype(np.uint8) * 255
    artifacts = cv2.dilate(artifacts, np.ones((3, 3), np.uint8), iterations=1)
    artifacts[mask == 0] = 0
    repaired = cv2.inpaint(array, artifacts, 2.0, cv2.INPAINT_TELEA)
    alpha = Image.fromarray(artifacts, mode="L").filter(ImageFilter.GaussianBlur(1.4))
    alpha = Image.fromarray(np.where(mask > 0, np.asarray(alpha), 0).astype(np.uint8), mode="L")
    output = Image.composite(Image.fromarray(repaired), result, alpha)
    return output, Image.fromarray(artifacts, mode="L"), int((artifacts > 0).sum())


def generative_seam_refine(source: Image.Image, result: Image.Image, hard_mask: Image.Image, seed: int, steps: int, region: str = "auto"):
    """Use SD3.5 only on a narrow anomalous garment boundary band."""
    _, defect_mask, defect_pixels = repair_local_seams(source, result, hard_mask)
    if defect_pixels < 32:
        return result, defect_mask, defect_pixels
    refine_array = np.asarray(defect_mask.filter(ImageFilter.MaxFilter(9)), dtype=np.uint8)
    bbox = hard_mask.getbbox()
    if bbox and region in ("collar", "sleeves", "waist"):
        x0, y0, x1, y1 = bbox
        region_array = np.zeros_like(refine_array)
        if region == "collar":
            region_array[y0:min(y1, y0 + max(1, round((y1 - y0) * 0.32))), x0:x1] = 255
        elif region == "waist":
            region_array[max(y0, y1 - max(1, round((y1 - y0) * 0.30))):y1, x0:x1] = 255
        else:
            edge_width = max(1, round((x1 - x0) * 0.28))
            region_array[y0:y1, x0:min(x1, x0 + edge_width)] = 255
            region_array[y0:y1, max(x0, x1 - edge_width):x1] = 255
        refine_array[region_array == 0] = 0
    refine_mask = Image.fromarray(refine_array, mode="L").point(lambda value: 255 if value > 12 else 0)
    defect_pixels = int((np.asarray(refine_mask) > 0).sum())
    if defect_pixels < 32:
        return result, refine_mask, defect_pixels
    blend_mask = refine_mask.filter(ImageFilter.GaussianBlur(2.0))
    max_side = 768
    scale = min(max_side / max(result.size), 1.0)
    width = max(64, round(result.width * scale / 64) * 64)
    height = max(64, round(result.height * scale / 64) * 64)
    pipe = load_inpaint_pipe()
    generator = torch.Generator(device="cpu").manual_seed(seed)
    with torch.inference_mode():
        generated = traced_pipeline_call(pipe,
            prompt=prompt_text('generative_seam_refine.repair_the_garment_seam_only_coherent_fabric'),
            negative_prompt=prompt_text('generative_seam_refine.changed_face_changed_body_exposed_skin_distorted'),
            image=result.resize((width, height), Image.Resampling.LANCZOS),
            mask_image=refine_mask.resize((width, height), Image.Resampling.NEAREST),
            height=height, width=width, padding_mask_crop=64, strength=0.55,
            num_inference_steps=max(12, min(30, steps)), guidance_scale=4.0, generator=generator,
        ).images[0]
    generated = generated.resize(result.size, Image.Resampling.LANCZOS)
    return Image.composite(generated, result, blend_mask), refine_mask, defect_pixels
