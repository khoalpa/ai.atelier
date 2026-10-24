"""AI Atelier: imaging.scoring."""
from PIL import Image, ImageFilter, ImageOps
import cv2
import numpy as np


def score_tryon_result(source: Image.Image, result: Image.Image, hard_mask: Image.Image) -> dict:
    source_array = np.asarray(source, dtype=np.int16)
    result_array = np.asarray(result, dtype=np.int16)
    mask_array = np.asarray(hard_mask, dtype=np.uint8) > 0
    difference = np.abs(result_array - source_array).mean(axis=2) / 255.0
    outside = ~mask_array
    outside_mae = float(difference[outside].mean()) if outside.any() else 0.0
    face = np.zeros(mask_array.shape, dtype=bool)
    face[:max(1, round(source.height * 0.28)), round(source.width * 0.25):round(source.width * 0.75)] = True
    face_mae = float(difference[face & outside].mean()) if (face & outside).any() else 0.0
    edge_outer = np.asarray(hard_mask.filter(ImageFilter.MaxFilter(11)), dtype=np.uint8) > 0
    edge_inner = np.asarray(hard_mask.filter(ImageFilter.MinFilter(11)), dtype=np.uint8) > 0
    edge = edge_outer ^ edge_inner
    edge_mae = float(difference[edge].mean()) if edge.any() else 0.0
    pixels = np.asarray(result, dtype=np.uint8)[mask_array]
    clipping = float(((pixels < 3) | (pixels > 252)).mean()) if pixels.size else 1.0
    quality = max(0.0, 100.0 * (1.0 - min(1.0, outside_mae * 8 + face_mae * 8 + edge_mae * 0.35 + clipping * 0.25)))
    gray = cv2.cvtColor(np.asarray(result, dtype=np.uint8), cv2.COLOR_RGB2GRAY)
    gradient = cv2.magnitude(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1)) / 255.0
    edge_gradient = float(gradient[edge].mean()) if edge.any() else 0.0
    seam_score = max(0.0, 100.0 * (1.0 - min(1.0, edge_mae * 2.2 + edge_gradient * 0.35 + clipping * 0.12)))
    anatomy_score = max(0.0, 100.0 * (1.0 - min(1.0, face_mae * 25 + outside_mae * 12)))
    texture_continuity = max(0.0, 100.0 * (1.0 - min(1.0, edge_gradient * 0.7)))
    return {
        "outsideMaskMAE": outside_mae, "faceMAE": face_mae, "edgeMAE": edge_mae,
        "clippingRatio": clipping, "edgeGradient": edge_gradient, "qualityScore": quality,
        "seamScore": seam_score, "anatomyScore": anatomy_score, "textureContinuity": texture_continuity,
        # Historical aliases remain readable by old reports. They measure pixel
        # preservation and boundary smoothness, not anatomy or fabric fidelity.
        "preservationScore": anatomy_score, "boundarySmoothness": texture_continuity,
        "metricSemantics": "legacy-pixel-diagnostics",
    }


def catvton_core_degradation(result: Image.Image, hard_mask: Image.Image) -> dict:
    """Measure large smooth/asymmetric failures that edge-only scores can miss."""
    gray = cv2.cvtColor(np.asarray(result.convert("RGB"), dtype=np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    binary = (np.asarray(hard_mask, dtype=np.uint8) > 16).astype(np.uint8)
    core = cv2.erode(binary, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)), iterations=1) > 0
    if not core.any():
        return {"corePixels": 0, "localStdMean": 0.0, "lowTextureRatio": 1.0, "sideImbalance": 1.0, "coreTextureScore": 0.0}
    mean = cv2.blur(gray, (21, 21))
    mean_sq = cv2.blur(gray * gray, (21, 21))
    local_std = np.sqrt(np.maximum(0.0, mean_sq - mean * mean))
    values = local_std[core]
    _, xs = np.where(core)
    midpoint = int((xs.min() + xs.max()) / 2)
    x_grid = np.indices(core.shape)[1]
    left = local_std[np.logical_and(core, x_grid <= midpoint)]
    right = local_std[np.logical_and(core, x_grid > midpoint)]
    left_mean = float(left.mean()) if left.size else 0.0
    right_mean = float(right.mean()) if right.size else 0.0
    imbalance = abs(left_mean - right_mean) / max(1.0, max(left_mean, right_mean))
    low_texture_ratio = float((values < 3.0).mean())
    score = max(0.0, 100.0 * (1.0 - min(1.0, low_texture_ratio * 1.4 + imbalance * 0.65)))
    return {
        "corePixels": int(core.sum()), "localStdMean": float(values.mean()),
        "localStdP10": float(np.percentile(values, 10)), "lowTextureRatio": low_texture_ratio,
        "leftLocalStd": left_mean, "rightLocalStd": right_mean,
        "sideImbalance": float(imbalance), "coreTextureScore": score,
    }


def color_material_consistency(reference: Image.Image, result: Image.Image, hard_mask: Image.Image) -> dict:
    """Compare robust Lab palettes and texture energy without requiring aligned pixels."""
    ref = np.asarray(reference.convert("RGB"), dtype=np.uint8)
    out = np.asarray(result.convert("RGB"), dtype=np.uint8)
    mask = np.asarray(hard_mask, dtype=np.uint8) > 16
    border = np.concatenate((ref[0], ref[-1], ref[:, 0], ref[:, -1]), axis=0).astype(np.float32)
    background = np.median(border, axis=0)
    ref_foreground = np.linalg.norm(ref.astype(np.float32) - background[None, None, :], axis=2) > 25
    ref_pixels = ref[ref_foreground]
    out_pixels = out[mask]
    if len(ref_pixels) < 32 or len(out_pixels) < 32:
        return {"accepted": False, "colorDistance": 100.0, "colorOutlierRatio": 1.0, "materialScore": 0.0, "colorMaterialScore": 0.0, "reason": "insufficient-pixels"}
    def sample_pixels(pixels):
        return pixels[np.linspace(0, len(pixels) - 1, min(12000, len(pixels)), dtype=np.int32)]
    def palette_lab(pixels):
        sampled = sample_pixels(pixels)
        lab = cv2.cvtColor(sampled.reshape(-1, 1, 3), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
        _, labels, centers = cv2.kmeans(lab, 4, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5), 4, cv2.KMEANS_PP_CENTERS)
        counts = np.bincount(labels.ravel(), minlength=4).astype(np.float32)
        return centers, counts / max(1.0, counts.sum()), lab
    ref_centers, ref_weights, _ = palette_lab(ref_pixels)
    out_centers, out_weights, out_lab = palette_lab(out_pixels)
    distances = np.linalg.norm(out_centers[:, None, :] - ref_centers[None, :, :], axis=2)
    color_distance = float(np.sum(out_weights * distances.min(axis=1)))
    pixel_distance = np.linalg.norm(out_lab[:, None, :] - ref_centers[None, :, :], axis=2).min(axis=1)
    outlier_ratio = float((pixel_distance > 38).mean())
    ref_gray = cv2.cvtColor(ref, cv2.COLOR_RGB2GRAY)
    out_gray = cv2.cvtColor(out, cv2.COLOR_RGB2GRAY)
    ref_energy = float(np.mean(np.abs(cv2.Laplacian(ref_gray, cv2.CV_32F)[ref_foreground])))
    out_energy = float(np.mean(np.abs(cv2.Laplacian(out_gray, cv2.CV_32F)[mask])))
    energy_ratio = out_energy / max(1.0, ref_energy)
    material_score = max(0.0, 100.0 * (1.0 - min(1.0, abs(float(np.log(max(0.01, energy_ratio)))) * 0.55)))
    color_score = max(0.0, 100.0 - color_distance * 1.5 - outlier_ratio * 65.0)
    combined = color_score * 0.72 + material_score * 0.28
    accepted = color_distance <= 32 and outlier_ratio <= 0.22 and material_score >= 35
    return {"accepted": accepted, "colorDistance": color_distance, "colorOutlierRatio": outlier_ratio, "referenceTextureEnergy": ref_energy, "resultTextureEnergy": out_energy, "textureEnergyRatio": energy_ratio, "colorScore": color_score, "materialScore": material_score, "colorMaterialScore": combined}


def catvton_geometry_consistency(result: Image.Image, hard_mask: Image.Image) -> dict:
    """Detect large flat failures, asymmetric sleeves, weak silhouette edges and vertical scars."""
    gray = cv2.cvtColor(np.asarray(result.convert("RGB"), dtype=np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    binary = (np.asarray(hard_mask, dtype=np.uint8) > 16).astype(np.uint8)
    core = cv2.erode(binary, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)), iterations=1) > 0
    if not core.any():
        return {"accepted": False, "geometryScore": 0.0, "reason": "empty-core"}
    mean = cv2.blur(gray, (25, 25))
    mean_sq = cv2.blur(gray * gray, (25, 25))
    local_std = np.sqrt(np.maximum(0.0, mean_sq - mean * mean))
    flat = np.logical_and(core, local_std < 2.8).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(flat, 8)
    largest_flat = int(stats[1:, cv2.CC_STAT_AREA].max()) if count > 1 else 0
    largest_flat_ratio = float(largest_flat / max(1, core.sum()))
    gradient = cv2.magnitude(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1)) / 255.0
    _, xs = np.where(core)
    midpoint = int((xs.min() + xs.max()) / 2)
    x_grid = np.indices(core.shape)[1]
    left_values = gradient[np.logical_and(core, x_grid <= midpoint)]
    right_values = gradient[np.logical_and(core, x_grid > midpoint)]
    left_edge = float(left_values.mean()) if left_values.size else 0.0
    right_edge = float(right_values.mean()) if right_values.size else 0.0
    side_imbalance = abs(left_edge - right_edge) / max(0.01, max(left_edge, right_edge))
    blackhat = cv2.morphologyEx(gray.astype(np.uint8), cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (7, 31)))
    core_blackhat = blackhat[core]
    vertical_threshold = max(18.0, float(np.percentile(core_blackhat, 98.0)))
    vertical_ratio = float((core_blackhat >= vertical_threshold).mean())
    outer = cv2.dilate(binary, np.ones((9, 9), np.uint8), iterations=1) > 0
    inner = cv2.erode(binary, np.ones((9, 9), np.uint8), iterations=1) > 0
    boundary = outer ^ inner
    weak_boundary_ratio = float((gradient[boundary] < 0.035).mean()) if boundary.any() else 1.0
    score = max(0.0, 100.0 * (1.0 - min(1.0, largest_flat_ratio * 2.8 + side_imbalance * 0.55 + vertical_ratio * 2.0 + weak_boundary_ratio * 0.28)))
    accepted = largest_flat_ratio <= 0.12 and side_imbalance <= 0.30 and vertical_ratio <= 0.055 and weak_boundary_ratio <= 0.72 and score >= 42
    return {"accepted": accepted, "largestFlatComponentRatio": largest_flat_ratio, "sideEdgeImbalance": float(side_imbalance), "leftEdgeEnergy": left_edge, "rightEdgeEnergy": right_edge, "verticalArtifactRatio": vertical_ratio, "verticalThreshold": vertical_threshold, "weakBoundaryRatio": weak_boundary_ratio, "geometryScore": score}
