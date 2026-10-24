"""AI Atelier: imaging.mask_workflows."""
from PIL import Image, ImageFilter, ImageOps
from tryon_geometry import fit_geometry, fit_image, restore_image, inward_blend, target_attributes, target_coverage
import cv2
import numpy as np
from services.ai.imaging.blending import exclude_protected_pixels, mask_strength_policy
from services.ai.imaging.segmentation import automatic_garment_mask, automatic_protected_detail_mask, decode_mask, detect_people, encode_image, garment_category_from_points, safe_sample
from services.ai.runtime.configuration import POSE_MODEL, device


def catvton_dedicated_mask(source: Image.Image, category: str, person_box, keypoints=None):
    """Pose-first CatVTON mask that excludes the waistband and identity details."""
    if category != "upper_body" or not keypoints:
        mask, score = automatic_garment_mask(source, category, person_box, keypoints)
        return mask, score, {"mode": "standard-fallback", "waistLeakage": None}
    width, height = source.size
    px0, py0, px1, py1 = [float(value) for value in person_box]
    ph = max(1.0, py1 - py0)
    reliable = lambda index: index < len(keypoints) and keypoints[index][2] > 0.25
    if not all(reliable(index) for index in (5, 6, 11, 12)):
        mask, score = automatic_garment_mask(source, category, person_box, keypoints)
        return mask, score, {"mode": "standard-fallback", "waistLeakage": None}
    shoulder_width = max(20.0, abs(keypoints[6][0] - keypoints[5][0]))
    sleeve_thickness = max(14, round(shoulder_width * 0.42))
    hip_y = float(np.mean([keypoints[11][1], keypoints[12][1]]))
    hem_y = max(float(max(keypoints[5][1], keypoints[6][1]) + ph * 0.16), hip_y - ph * 0.13)
    dedicated = np.zeros((height, width), dtype=np.uint8)
    torso = np.asarray([
        [keypoints[5][0] - shoulder_width * 0.12, keypoints[5][1] - ph * 0.015],
        [keypoints[6][0] + shoulder_width * 0.12, keypoints[6][1] - ph * 0.015],
        [keypoints[12][0] + shoulder_width * 0.16, hem_y],
        [keypoints[11][0] - shoulder_width * 0.16, hem_y],
    ], dtype=np.int32)
    cv2.fillConvexPoly(dedicated, torso, 255)
    for shoulder, elbow, wrist in ((5, 7, 9), (6, 8, 10)):
        points = [shoulder] + ([elbow] if reliable(elbow) else []) + ([wrist] if reliable(wrist) else [])
        for first, second in zip(points, points[1:]):
            cv2.line(dedicated, (round(keypoints[first][0]), round(keypoints[first][1])), (round(keypoints[second][0]), round(keypoints[second][1])), 255, sleeve_thickness)
    # Keep the pose silhouette dense enough to replace short sleeves, while
    # subtracting head, hands, and a small safety band above the waistband.
    dedicated = cv2.morphologyEx(dedicated, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    protected = np.asarray(automatic_protected_detail_mask(source, person_box, keypoints), dtype=np.uint8) > 16
    dedicated[protected] = 0
    center_left = max(0, round(px0 + (px1 - px0) * 0.10))
    center_right = min(width, round(px0 + (px1 - px0) * 0.90))
    dedicated[max(0, round(hem_y)):, center_left:center_right] = 0
    mask = Image.fromarray(dedicated, mode="L")
    pixels = dedicated > 16
    waist_band_start = max(0, round(hip_y - ph * 0.08))
    waist_leakage = float(pixels[waist_band_start:, center_left:center_right].sum() / max(1, pixels.sum()))
    hand_overlap = float(np.logical_and(pixels, protected).sum() / max(1, pixels.sum()))
    metrics = {
        "mode": "pose-dedicated", "hemY": round(hem_y, 1),
        "coverage": float(pixels.mean()), "waistLeakage": waist_leakage,
        "protectedOverlap": hand_overlap, "accepted": pixels.mean() >= 0.025 and waist_leakage <= 0.005 and hand_overlap <= 0.001,
    }
    policy = mask_strength_policy(mask, person_box, category, keypoints)
    if not policy['accepted']:
        fallback, confidence = automatic_garment_mask(source, category, person_box, keypoints)
        fallback = exclude_protected_pixels(fallback, Image.fromarray(protected.astype(np.uint8) * 255))
        fallback_policy = mask_strength_policy(fallback, person_box, category, keypoints)
        if confidence >= 0.8 and fallback_policy['accepted']:
            return fallback, confidence, {"mode":"standard-coverage-fallback","accepted":True,"protectedOverlap":0.0,"waistLeakage":None,"dedicatedMask":metrics,"dedicatedPolicy":policy,"policy":fallback_policy}
        metrics['accepted'] = False
        metrics['coveragePolicy'] = policy
    return mask, 1.0, metrics


def auto_mask(body: dict) -> dict:
    source = Image.open(safe_sample(str(body.get("sampleId", "")))).convert("RGB")
    category = str(body.get("category", "upper_body"))
    if category not in ("upper_body", "lower_body", "overall", "full_body"):
        raise ValueError("Loại trang phục không hợp lệ")
    people = detect_people(source, POSE_MODEL.is_file())
    person_index = max(0, min(len(people) - 1, int(body.get("personIndex", 0))))
    person = people[person_index]
    if body.get("inferCategoryFromPoints"):
        category = garment_category_from_points(body.get("points"), person, category)
    protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
    if body.get("protectedDetailMask"):
        user_protected = decode_mask(str(body["protectedDetailMask"]), source.size)
        protected = Image.fromarray(np.maximum(np.asarray(protected), np.asarray(user_protected)))
    mask, score = automatic_garment_mask(source, category, person["box"], person.get("keypoints"), body.get("points"))
    mask_array = np.asarray(mask, dtype=np.uint8).copy()
    mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
    mask = Image.fromarray(mask_array, mode="L")
    policy = mask_strength_policy(mask, person["box"], category, person.get("keypoints"))
    mask, target, exposed, coverage_info = target_coverage(mask, protected, category, person, body.get('targetGarment'))
    return {"ok": True, "mask": encode_image(mask), "protectedMask": encode_image(protected), "score": score, **policy,
            "targetCoverage": coverage_info, "targetMask": encode_image(target), "exposedMask": encode_image(exposed),
            "category": category, "people": people, "personIndex": person_index, "device": device}
