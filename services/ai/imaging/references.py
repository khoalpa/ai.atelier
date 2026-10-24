"""AI Atelier: imaging.references."""
from PIL import Image, ImageFilter, ImageOps
from datetime import datetime, timezone
from pathlib import Path
import base64
import cv2
import hashlib
import io
import json
import numpy as np
import torch
from services.ai.imaging.segmentation import automatic_garment_mask, automatic_protected_detail_mask, decode_image, detect_people_pose, encode_image, safe_sample
from services.ai.models.pipelines import birefnet_mask, load_predictor
from services.ai.runtime.configuration import POSE_MODEL, ROOT, device


def preprocess_garment_image(garment: Image.Image, category: str = "upper_body", reference_type: str = "auto"):
    """Isolate the central garment and place it on a clean neutral background."""
    rgb = garment.convert("RGB")
    image = np.asarray(rgb)
    width, height = rgb.size
    if reference_type not in ('auto', 'product', 'model'):
        raise ValueError('Loại ảnh mẫu không hợp lệ')
    # A background remover isolates a whole person, not their clothing. Resolve
    # person references before BiRefNet, with an explicit override for products.
    pose_people = detect_people_pose(rgb) if reference_type != 'product' and POSE_MODEL.is_file() else []
    visible_people = [p for p in pose_people if p.get('confidence', 0) >= .4
                      and sum(k[2] >= .4 for k in (p.get('keypoints') or [])[:5]) >= 2]
    if reference_type == 'model' and len(pose_people) != 1:
        raise ValueError('Ảnh người mặc mẫu phải có đúng một người rõ ràng; hãy cắt ảnh hoặc dùng ảnh sản phẩm.')
    chosen_people = pose_people if reference_type == 'model' else visible_people
    if len(chosen_people) > 1:
        raise ValueError('Ảnh mẫu có nhiều người; hãy cắt riêng người mặc trang phục cần dùng.')
    if chosen_people:
        person = chosen_people[0]
        garment_mask, garment_score = automatic_garment_mask(rgb, category, person['box'], person.get('keypoints'))
        coverage = float((np.asarray(garment_mask) > 0).mean())
        bbox = garment_mask.getbbox()
        if not bbox or coverage < .015 or garment_score < .6:
            raise ValueError('Chưa tách được trang phục đủ tin cậy từ người mặc; hãy dùng ảnh sản phẩm rõ hơn.')
        padding = max(8, round(max(width, height)*.035))
        bbox = (max(0,bbox[0]-padding),max(0,bbox[1]-padding),min(width,bbox[2]+padding),min(height,bbox[3]+padding))
        cropped_mask = garment_mask.crop(bbox)
        background = Image.new('RGB', cropped_mask.size, (245,245,245))
        background.paste(rgb.crop(bbox), mask=cropped_mask)
        return background, cropped_mask, coverage, 'model-photo', garment_score
    foreground = birefnet_mask(rgb)
    if foreground is not None:
        binary = foreground.point(lambda value: 255 if value >= 96 else 0)
        coverage = float((np.asarray(binary) > 0).mean())
        bbox = binary.getbbox()
        if bbox and 0.015 <= coverage <= 0.95:
            padding = max(8, round(max(width, height) * 0.035))
            bbox = (max(0, bbox[0] - padding), max(0, bbox[1] - padding), min(width, bbox[2] + padding), min(height, bbox[3] + padding))
            cropped, cropped_mask = rgb.crop(bbox), foreground.crop(bbox).filter(ImageFilter.GaussianBlur(1.0))
            background = Image.new("RGB", cropped.size, (245, 245, 245));background.paste(cropped, mask=cropped_mask)
            return background, cropped_mask, coverage, "birefnet", float(np.asarray(foreground).max() / 255.0)
    if reference_type != 'product' and pose_people and pose_people[0].get("confidence", 0) >= 0.4:
        person = pose_people[0]
        garment_mask, garment_score = automatic_garment_mask(rgb, category, person["box"], person.get("keypoints"))
        coverage = float((np.asarray(garment_mask) > 0).mean())
        bbox = garment_mask.getbbox()
        if bbox and coverage >= 0.015:
            padding = max(8, round(max(width, height) * 0.035))
            bbox = (max(0, bbox[0] - padding), max(0, bbox[1] - padding), min(width, bbox[2] + padding), min(height, bbox[3] + padding))
            cropped = rgb.crop(bbox)
            cropped_mask = garment_mask.crop(bbox).filter(ImageFilter.GaussianBlur(1.2))
            background = Image.new("RGB", cropped.size, (245, 245, 245))
            background.paste(cropped, mask=cropped_mask)
            return background, cropped_mask, coverage, "model-photo", garment_score
    model = load_predictor()
    coords = np.asarray([
        [0.50 * width, 0.50 * height], [0.50 * width, 0.35 * height],
        [0.50 * width, 0.68 * height], [0.03 * width, 0.03 * height],
        [0.97 * width, 0.03 * height], [0.03 * width, 0.97 * height],
        [0.97 * width, 0.97 * height],
    ], dtype=np.float32)
    labels = np.asarray([1, 1, 1, 0, 0, 0, 0], dtype=np.int32)
    with torch.inference_mode(), torch.autocast(device_type=device, dtype=torch.bfloat16, enabled=device == "cuda"):
        model.set_image(image)
        masks, scores, _ = model.predict(point_coords=coords, point_labels=labels, multimask_output=True)
    best = int(np.argmax(scores))
    mask = masks[best]
    coverage = float(mask.mean())
    # Very small masks usually mean the reference is a full model/photo rather
    # than a clean product shot. CatVTON handles that better without cut-out.
    if coverage < 0.18 or coverage > 0.92:
        mask = np.ones((height, width), dtype=bool)
        coverage = 1.0
    mask_image = Image.fromarray(mask.astype(np.uint8) * 255, mode="L").filter(ImageFilter.GaussianBlur(1.2))
    bbox = mask_image.point(lambda value: 255 if value > 32 else 0).getbbox()
    if bbox:
        padding = max(8, round(max(width, height) * 0.04))
        bbox = (max(0, bbox[0] - padding), max(0, bbox[1] - padding), min(width, bbox[2] + padding), min(height, bbox[3] + padding))
        rgb = rgb.crop(bbox)
        mask_image = mask_image.crop(bbox)
    background = Image.new("RGB", rgb.size, (245, 245, 245))
    background.paste(rgb, mask=mask_image)
    return background, mask_image, coverage, "product-photo", float(scores[best])


def normalize_garment_reference(garment: Image.Image, category: str = "upper_body"):
    """Create a clean garment-only reference and measurable contamination report."""
    rgb = garment.convert("RGB")
    people = detect_people_pose(rgb) if POSE_MODEL.is_file() else []
    if len(people) > 1:
        raise ValueError('Hãy cắt riêng người mặc trang phục cần dùng làm mẫu.')
    person = people[0] if people else None
    if person:
        mask, score = automatic_garment_mask(rgb, category, person["box"], person.get("keypoints"))
        protected = automatic_protected_detail_mask(rgb, person["box"], person.get("keypoints"))
        array = np.asarray(mask, dtype=np.uint8).copy()
        array[np.asarray(protected, dtype=np.uint8) > 16] = 0
        mask = Image.fromarray(array, mode="L")
        person_box = person["box"]
        keypoints = person.get("keypoints") or []
    else:
        processed, mask, _, _, score = preprocess_garment_image(rgb, category)
        coverage = float((np.asarray(mask) > 16).mean())
        return processed, mask, {"score": score, "people": 0, "mode": "product-fallback", "coverage": coverage, "faceContamination": 0.0, "lowerBodyContaminationBeforeCrop": 0.0, "lowerBodyContamination": 0.0, "accepted": 0.18 <= coverage <= 0.92}

    mask_array = np.asarray(mask, dtype=np.uint8) > 16
    px0, py0, px1, py1 = [int(round(value)) for value in person_box]
    ph = max(1, py1 - py0)
    hip_values = [keypoints[index][1] for index in (11, 12) if index < len(keypoints) and keypoints[index][2] > 0.25]
    lower_start = round(float(np.mean(hip_values)) - ph * 0.13) if hip_values else round(py0 + ph * 0.48)
    protected_array = np.asarray(protected, dtype=np.uint8) > 16
    face_contamination = float((mask_array & protected_array).sum() / max(1, mask_array.sum()))
    lower_contamination = float(mask_array[max(0, lower_start):].sum() / max(1, mask_array.sum()))
    # Never shorten cuffs or hems to make a contamination score pass. A pose
    # estimate cannot distinguish a long shirt from trousers; retain pixels and
    # flag the uncertain cutout for review instead.
    lower_contamination_after = float(mask_array[max(0, lower_start):].sum() / max(1, mask_array.sum()))
    cleaned_mask = Image.fromarray(mask_array.astype(np.uint8) * 255, mode="L")
    bbox = cleaned_mask.getbbox()
    if not bbox:
        raise ValueError("Không tách được trang phục khỏi ảnh tham chiếu")
    padding = max(8, round(max(rgb.size) * 0.025))
    bbox = (max(0, bbox[0] - padding), max(0, bbox[1] - padding), min(rgb.width, bbox[2] + padding), min(rgb.height, bbox[3] + padding))
    crop = rgb.crop(bbox)
    crop_mask = cleaned_mask.crop(bbox).filter(ImageFilter.GaussianBlur(1.0))
    normalized = Image.new("RGB", crop.size, (245, 245, 245))
    normalized.paste(crop, mask=crop_mask)
    final_coverage = float((np.asarray(crop_mask) > 16).mean())
    metrics = {
        "score": float(score), "people": len(people), "mode": "pose-sam-cutout",
        "coverage": final_coverage, "faceContamination": face_contamination,
        "lowerBodyContaminationBeforeCrop": lower_contamination,
        "lowerBodyContamination": lower_contamination_after, "bbox": list(bbox),
        "accepted": final_coverage >= 0.18 and face_contamination <= 0.01 and (category != 'upper_body' or lower_contamination_after <= 0.20),
        "requiresVisualReview": True,
    }
    return normalized, crop_mask, metrics


def normalize_reference(body: dict) -> dict:
    sample_id = str(body.get("garmentSampleId") or body.get("sampleId") or "characters/c003.png")
    category = str(body.get("category") or "upper_body")
    if category not in ("upper_body", "lower_body", "overall"):
        raise ValueError("Loại trang phục không hợp lệ")
    source = Image.open(safe_sample(sample_id)).convert("RGB")
    normalized, mask, metrics = normalize_garment_reference(source, category)
    reference_dir = ROOT / "workspace" / "references"
    reference_dir.mkdir(parents=True, exist_ok=True)
    image_path = reference_dir / f"{category}.png"
    mask_path = reference_dir / f"{category}_mask.png"
    manifest_path = reference_dir / f"{category}.json"
    normalized.save(image_path)
    mask.save(mask_path)
    manifest = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceSampleId": sample_id, "category": category,
        "image": str(image_path.relative_to(ROOT)), "mask": str(mask_path.relative_to(ROOT)),
        "metrics": metrics,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "manifest": str(manifest_path.relative_to(ROOT)), **manifest}


def validate_product_reference(body: dict) -> dict:
    value = str(body.get("image") or body.get("garmentImage") or "")
    category = str(body.get("category") or "upper_body")
    if category not in ("upper_body", "lower_body", "overall"):
        raise ValueError("Loại trang phục không hợp lệ")
    prefix = next((item for item in ("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,") if value.startswith(item)), None)
    if not prefix:
        raise ValueError("Ảnh tham chiếu phải là PNG, JPEG hoặc WebP")
    raw = base64.b64decode(value[len(prefix):], validate=True)
    if not raw or len(raw) > 20 * 1024 * 1024:
        raise ValueError("Ảnh tham chiếu không hợp lệ hoặc vượt quá 20 MB")
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    array = np.asarray(image, dtype=np.uint8)
    height, width = array.shape[:2]
    border = np.concatenate((array[0], array[-1], array[:, 0], array[:, -1]), axis=0).astype(np.float32)
    background = np.median(border, axis=0)
    background_std = float(np.mean(np.std(border, axis=0)))
    distance = np.linalg.norm(array.astype(np.float32) - background[None, None, :], axis=2)
    foreground = (distance > 30).astype(np.uint8)
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count > 1:
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        foreground = (labels == largest).astype(np.uint8)
    coverage = float(foreground.mean())
    edge_touch = float(np.concatenate((foreground[0], foreground[-1], foreground[:, 0], foreground[:, -1])).mean())
    gray = cv2.cvtColor(array, cv2.COLOR_RGB2GRAY)
    laplacian = cv2.Laplacian(gray, cv2.CV_32F)
    sharpness = float(laplacian[foreground > 0].var()) if foreground.any() else 0.0
    people = detect_people_pose(image) if POSE_MODEL.is_file() else []
    pixels = array[foreground > 0]
    if len(pixels) > 12000:
        pixels = pixels[np.linspace(0, len(pixels) - 1, 12000, dtype=np.int32)]
    palette = []
    if len(pixels) >= 3:
        samples = pixels.astype(np.float32)
        _, labels_k, centers = cv2.kmeans(samples, 3, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5), 3, cv2.KMEANS_PP_CENTERS)
        counts = np.bincount(labels_k.ravel(), minlength=3)
        for index in np.argsort(counts)[::-1]:
            palette.append({"rgb": [int(round(value)) for value in centers[index]], "ratio": float(counts[index] / counts.sum())})
    reasons = []
    if width < 256 or height < 256: reasons.append("Kích thước tối thiểu là 256 × 256")
    if people: reasons.append("Phát hiện người hoặc pose trong ảnh sản phẩm")
    if coverage < 0.08 or coverage > 0.85: reasons.append("Coverage sản phẩm phải nằm trong khoảng 0,08–0,85")
    if background_std > 35: reasons.append("Nền không đủ đồng nhất")
    if edge_touch > 0.08: reasons.append("Sản phẩm chạm mép ảnh quá nhiều")
    if sharpness < 25: reasons.append("Ảnh sản phẩm thiếu độ nét")
    metrics = {"width": width, "height": height, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "peopleDetected": len(people), "backgroundRgb": [int(round(value)) for value in background], "backgroundStd": background_std, "foregroundCoverage": coverage, "edgeTouchRatio": edge_touch, "sharpness": sharpness, "dominantPalette": palette}
    return {"ok": True, "accepted": not reasons, "category": category, "reasons": reasons, "metrics": metrics}


def active_reference_path(category: str) -> Path:
    profile_path = ROOT / "workspace" / "review" / "reference-profiles.json"
    if profile_path.is_file():
        try:
            profile = json.loads(profile_path.read_text(encoding="utf-8")).get("profiles", {}).get(category, {})
            candidate = ROOT / str(profile.get("reference")) if profile.get("reference") else None
            if profile.get("specializedReferenceRequired") is False and (profile.get("validation") or {}).get("accepted") and candidate and candidate.is_file():
                return candidate
        except Exception:
            pass
    return ROOT / "workspace" / "references" / f"{category}.png"


def preprocess_garment(body: dict) -> dict:
    garment = decode_image(str(body.get("garmentImage", "")))
    processed, mask, coverage, mode, score = preprocess_garment_image(garment, str(body.get("category", "upper_body")), str(body.get('referenceType','auto')))
    return {"ok": True, "image": encode_image(processed), "mask": encode_image(mask), "coverage": coverage, "mode": mode, "score": score, "device": device}
