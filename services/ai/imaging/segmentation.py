"""AI Atelier: imaging.segmentation."""
from PIL import Image, ImageFilter, ImageOps
from pathlib import Path
import base64
import cv2
import io
import numpy as np
import torch
from services.ai.models.pipelines import _detector, _transformer_detector, load_pose_model, load_predictor
from services.ai.runtime.configuration import POSE_MODEL, ROOT, SAMPLES, device


def safe_sample(sample_id: str) -> Path:
    if sample_id.startswith("uploads/"):
        base = (ROOT / "workspace" / "uploads").resolve()
        relative = sample_id.removeprefix("uploads/")
    else:
        base = SAMPLES.resolve()
        relative = sample_id
    target = (base / relative).resolve()
    if base not in target.parents or not target.is_file():
        raise ValueError("Ảnh nguồn không hợp lệ")
    return target


def encode_mask(mask: np.ndarray) -> str:
    image = Image.fromarray((mask.astype(np.uint8) * 255), mode="L")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def encode_image(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def decode_mask(value: str, size: tuple[int, int]) -> Image.Image:
    prefix = "data:image/png;base64,"
    if not value.startswith(prefix):
        raise ValueError("Mask PNG không hợp lệ")
    raw = base64.b64decode(value[len(prefix):], validate=True)
    return Image.open(io.BytesIO(raw)).convert("L").resize(size, Image.Resampling.NEAREST)


def decode_image(value: str) -> Image.Image:
    prefixes = ("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,")
    prefix = next((item for item in prefixes if value.startswith(item)), None)
    if not prefix:
        raise ValueError("Ảnh trang phục không hợp lệ")
    raw = base64.b64decode(value[len(prefix):], validate=True)
    if len(raw) > 20 * 1024 * 1024:
        raise ValueError("Ảnh trang phục vượt quá 20 MB")
    return Image.open(io.BytesIO(raw)).convert("RGB")


def _box_iou(a, b) -> float:
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, x1 - x0) * max(0, y1 - y0)
    union = max(1, (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection)
    return intersection / union


def _box_overlap_min(a, b) -> float:
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, x1 - x0) * max(0, y1 - y0)
    smaller = max(1, min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])))
    return intersection / smaller


def detect_people_pose(source: Image.Image) -> list[dict]:
    model = load_pose_model()
    results = model.predict(np.asarray(source.convert("RGB")), imgsz=640, conf=0.25, device=0 if device == "cuda" else "cpu", verbose=False)
    people = []
    if not results:
        return people
    result = results[0]
    boxes = result.boxes.xyxy.detach().cpu().numpy() if result.boxes is not None else []
    confidences = result.boxes.conf.detach().cpu().numpy() if result.boxes is not None else []
    xy = result.keypoints.xy.detach().cpu().numpy() if result.keypoints is not None else []
    keypoint_conf = result.keypoints.conf.detach().cpu().numpy() if result.keypoints is not None and result.keypoints.conf is not None else []
    order = np.argsort(-((boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1]))) if len(boxes) else []
    for new_index, index in enumerate(order[:8]):
        points = []
        for point_index, point in enumerate(xy[index]):
            confidence = float(keypoint_conf[index][point_index]) if len(keypoint_conf) else 1.0
            points.append([round(float(point[0]), 1), round(float(point[1]), 1), round(confidence, 4)])
        box = boxes[index]
        people.append({
            "index": new_index, "box": [round(float(value), 1) for value in box],
            "normalizedBox": [round(float(box[0] / source.width), 4), round(float(box[1] / source.height), 4), round(float(box[2] / source.width), 4), round(float(box[3] / source.height), 4)],
            "confidence": round(float(confidences[index]), 4), "keypoints": points, "source": "yolo11n-pose",
        })
    return people


def detect_people(source: Image.Image, use_pose: bool = False) -> list[dict]:
    if use_pose:
        detected = detect_people_pose(source)
        if detected:
            return detected
    rgb = np.asarray(source.convert("RGB"))
    height, width = rgb.shape[:2]
    scale = min(1000 / max(width, height), 1.0)
    small = cv2.resize(rgb, None, fx=scale, fy=scale) if scale < 1 else rgb
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    boxes = []
    face_detector = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    for x, y, w, h in face_detector.detectMultiScale(gray, scaleFactor=1.08, minNeighbors=4, minSize=(24, 24)):
        fx, fy, fw, fh = x / scale, y / scale, w / scale, h / scale
        boxes.append([max(0, fx - 2.0 * fw), max(0, fy - 0.45 * fh), min(width, fx + 3.0 * fw), min(height, fy + 7.6 * fh)])
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
    found, weights = hog.detectMultiScale(cv2.cvtColor(small, cv2.COLOR_RGB2BGR), winStride=(8, 8), padding=(8, 8), scale=1.05)
    for (x, y, w, h), weight in zip(found, weights):
        if float(weight) < 0.2:
            continue
        boxes.append([x / scale, y / scale, (x + w) / scale, (y + h) / scale])
    boxes.sort(key=lambda box: -((box[2] - box[0]) * (box[3] - box[1])))
    merged = []
    for box in boxes:
        if any(_box_iou(box, existing) > 0.25 or _box_overlap_min(box, existing) > 0.55 for existing in merged):
            continue
        merged.append(box)
    if not merged:
        merged = [[width * 0.18, height * 0.05, width * 0.82, height * 0.98]]
    merged.sort(key=lambda box: (box[0], box[1]))
    return [{
        "index": index, "box": [round(float(value), 1) for value in box],
        "normalizedBox": [round(box[0] / width, 4), round(box[1] / height, 4), round(box[2] / width, 4), round(box[3] / height, 4)],
        "source": "local-face-hog" if boxes else "center-fallback",
    } for index, box in enumerate(merged[:8])]


def pose_garment_prior(size, category: str, person_box, keypoints=None) -> np.ndarray:
    """Build a conservative category silhouette from pose, used only when SAM is incomplete."""
    width, height = size
    px0, py0, px1, py1 = [float(value) for value in person_box]
    pw, ph = max(1.0, px1 - px0), max(1.0, py1 - py0)
    prior = np.zeros((height, width), dtype=np.uint8)
    reliable = lambda index: bool(keypoints and index < len(keypoints) and keypoints[index][2] > 0.25)
    shoulder_width = pw * 0.42
    if reliable(5) and reliable(6):
        shoulder_width = max(20.0, abs(keypoints[6][0] - keypoints[5][0]))
    thickness = max(10, round(shoulder_width * 0.34))

    if category in ("upper_body", "overall", "full_body") and all(reliable(index) for index in (5, 6, 11, 12)):
        hip_raise = ph * 0.05 if category == "upper_body" else 0.0
        torso = np.asarray([
            [keypoints[5][0], keypoints[5][1]], [keypoints[6][0], keypoints[6][1]],
            [keypoints[12][0], keypoints[12][1] - hip_raise], [keypoints[11][0], keypoints[11][1] - hip_raise],
        ], dtype=np.int32)
        cv2.fillConvexPoly(prior, torso, 255)
        for shoulder, elbow, wrist in ((5, 7, 9), (6, 8, 10)):
            points = [shoulder] + ([elbow] if reliable(elbow) else []) + ([wrist] if reliable(wrist) else [])
            for first, second in zip(points, points[1:]):
                cv2.line(prior, (round(keypoints[first][0]), round(keypoints[first][1])), (round(keypoints[second][0]), round(keypoints[second][1])), 255, thickness)
    elif category in ("upper_body", "overall", "full_body"):
        cv2.rectangle(prior, (round(px0 + pw * 0.27), round(py0 + ph * 0.20)), (round(px0 + pw * 0.73), round(py0 + ph * 0.56)), 255, -1)

    if category in ("lower_body", "overall", "full_body") and all(reliable(index) for index in (11, 12, 13, 14)):
        hips = np.asarray([[keypoints[index][0], keypoints[index][1]] for index in (11, 12, 14, 13)], dtype=np.int32)
        cv2.fillConvexPoly(prior, hips, 255)
        leg_thickness = max(12, round(shoulder_width * 0.30))
        for hip, knee, ankle in ((11, 13, 15), (12, 14, 16)):
            points = [hip, knee] + ([ankle] if reliable(ankle) else [])
            for first, second in zip(points, points[1:]):
                cv2.line(prior, (round(keypoints[first][0]), round(keypoints[first][1])), (round(keypoints[second][0]), round(keypoints[second][1])), 255, leg_thickness)
    elif category == "lower_body":
        cv2.rectangle(prior, (round(px0 + pw * 0.28), round(py0 + ph * 0.43)), (round(px0 + pw * 0.72), round(py0 + ph * 0.95)), 255, -1)
    return prior


def fill_garment_mask_holes(mask: np.ndarray) -> np.ndarray:
    """Fill small enclosed SAM texture gaps, preserving open background channels."""
    binary = (np.asarray(mask) > 0).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(1 - binary, 8)
    limit = max(64, round(int(binary.sum()) * 0.035))
    height, width = binary.shape
    for index in range(1, count):
        x, y, w, h, area = stats[index]
        if x > 0 and y > 0 and x + w < width and y + h < height and area <= limit:
            binary[labels == index] = 1
    return binary


def upper_garment_prompt(size, person_box, keypoints):
    """Pose bounds must include raised sleeves and hems below the hip joints.

    SAM still determines the fabric silhouette. A hip landmark is not a shirt
    boundary, so it must never be used as a hard central cut through the mask.
    """
    if not keypoints or len(keypoints) <= 12:
        return None
    reliable = lambda i: len(keypoints[i]) >= 3 and keypoints[i][2] > .25 and np.isfinite(keypoints[i][:3]).all()
    if not all(reliable(i) for i in (5, 6, 11, 12)):
        return None
    width, height = size
    px0, py0, px1, py1 = person_box
    shoulder = np.mean(np.asarray([keypoints[5][:2], keypoints[6][:2]]), axis=0)
    hip = np.mean(np.asarray([keypoints[11][:2], keypoints[12][:2]]), axis=0)
    torso = float(hip[1] - shoulder[1])
    if torso < (py1-py0)*.1:
        return None
    arm = np.asarray([keypoints[i][:2] for i in range(5,11) if reliable(i)])
    padding = max(8., torso*.18)
    box = np.asarray([max(0., min(px0, arm[:,0].min()-padding)),
                      max(0., min(arm[:,1].min()-padding, shoulder[1]-padding)),
                      min(float(width), max(px1, arm[:,0].max()+padding)),
                      min(float(height), py1, max(keypoints[11][1],keypoints[12][1])+torso*.35)],dtype=np.float32)
    # Interior torso prompts avoid background, collars and trousers even when
    # the person is sitting or the detector's full-height box is imprecise.
    coords = np.asarray([shoulder*.7+hip*.3, shoulder*.35+hip*.65],dtype=np.float32)
    return box, coords


def automatic_garment_mask(source: Image.Image, category: str, person_box=None, keypoints=None, points=None) -> tuple[Image.Image, float]:
    """Create a category-aware garment mask with SAM 2 and conservative body bounds."""
    image = np.asarray(source.convert("RGB"))
    width, height = source.size
    layouts = {
        "upper_body": ((0.03, 0.14, 0.97, 0.62), ((0.50, 0.32), (0.42, 0.37), (0.58, 0.37))),
        "lower_body": ((0.03, 0.38, 0.97, 0.96), ((0.43, 0.64), (0.57, 0.64), (0.50, 0.82))),
        "overall": ((0.03, 0.14, 0.97, 0.96), ((0.50, 0.38), (0.43, 0.66), (0.57, 0.66))),
        "full_body": ((0.03, 0.14, 0.97, 0.96), ((0.50, 0.38), (0.43, 0.66), (0.57, 0.66))),
    }
    bounds, positives = layouts.get(category, layouts["upper_body"])
    if person_box is None:
        person_box = [0, 0, width, height]
    px0, py0, px1, py1 = person_box
    pw, ph = px1 - px0, py1 - py0
    box = np.asarray([px0 + bounds[0] * pw, py0 + bounds[1] * ph, px0 + bounds[2] * pw, py0 + bounds[3] * ph], dtype=np.float32)
    if keypoints and len(keypoints) > 12 and keypoints[11][2] > 0.25 and keypoints[12][2] > 0.25:
        waist_y = float(np.mean([keypoints[11][1], keypoints[12][1]])) - ph * 0.10
        if category == "lower_body":
            box[1] = waist_y
    coords = np.asarray([[px0 + x * pw, py0 + y * ph] for x, y in positives], dtype=np.float32)
    upper_prompt = upper_garment_prompt(source.size, person_box, keypoints) if category == 'upper_body' else None
    if upper_prompt is not None:
        box, coords = upper_prompt
    labels = np.ones(len(coords), dtype=np.int32)
    hints = points or []
    if hints:
        hint_coords = np.asarray([[float(point["x"]), float(point["y"])] for point in hints], dtype=np.float32)
        hint_labels = np.asarray([int(point.get("label", 1)) for point in hints], dtype=np.int32)
        if not np.isfinite(hint_coords).all() or not np.isin(hint_labels, [0, 1]).all():
            raise ValueError("Điểm chọn mask không hợp lệ")
        if (hint_coords[:, 0] < 0).any() or (hint_coords[:, 0] >= width).any() or (hint_coords[:, 1] < 0).any() or (hint_coords[:, 1] >= height).any():
            raise ValueError("Điểm chọn nằm ngoài ảnh")
        if (hint_labels == 1).any():
            coords, labels = hint_coords, hint_labels
        else:
            coords, labels = np.concatenate([coords, hint_coords]), np.concatenate([labels, hint_labels])
    if keypoints:
        negative_points = [[point[0], point[1]] for index, point in enumerate(keypoints) if index in (0, 9, 10) and point[2] > 0.25]
        if category == 'upper_body':
            negative_points += [[point[0], point[1]] for index, point in enumerate(keypoints) if index in (13,14) and point[2] > .25]
        if negative_points:
            coords = np.concatenate([coords, np.asarray(negative_points, dtype=np.float32)])
            labels = np.concatenate([labels, np.zeros(len(negative_points), dtype=np.int32)])
    model = load_predictor()
    with torch.inference_mode(), torch.autocast(device_type=device, dtype=torch.bfloat16, enabled=device == "cuda"):
        model.set_image(image)
        masks, scores, _ = model.predict(point_coords=coords, point_labels=labels, box=box, multimask_output=True)
    x0, y0, x1, y1 = box.astype(int)
    allowed = np.zeros((height, width), dtype=bool)
    allowed[max(0, y0):min(height, y1), max(0, x0):min(width, x1)] = True
    candidates = [np.logical_and(mask, allowed) for mask in masks]
    areas = np.asarray([candidate.mean() for candidate in candidates])
    valid = np.where(areas > 0.025, scores, -1)
    best = int(np.argmax(valid))
    mask = candidates[best].copy()
    # Near-equivalent proposals often disagree only on highlights and folds.
    for index, candidate in enumerate(candidates):
        union = np.logical_or(mask, candidate).sum()
        overlap = np.logical_and(mask, candidate).sum() / max(1, union)
        if index != best and scores[index] >= scores[best] - 0.08 and overlap >= 0.75:
            if category == 'upper_body':
                # A second SAM proposal may include trousers. Only use it to
                # repair nearby fabric edges, not to grow the garment wholesale.
                nearby = cv2.dilate(mask.astype(np.uint8), np.ones((7,7),np.uint8)) > 0
                mask |= candidate & nearby
            else:
                mask |= candidate
    mask = fill_garment_mask_holes(mask).astype(bool)
    trusted_silhouette = mask.copy()
    pose_prior = pose_garment_prior(source.size, category, person_box, keypoints)
    if not keypoints and category in ("upper_body", "overall", "full_body"):
        face_cut = max(0, min(height, int(py0 + 0.21 * ph)))
        mask[:face_cut, :] = False
    if keypoints:
        protection = np.zeros((height, width), dtype=np.uint8)
        shoulder_width = ph * 0.18
        if len(keypoints) > 6 and keypoints[5][2] > 0.25 and keypoints[6][2] > 0.25:
            shoulder_width = max(shoulder_width, abs(keypoints[6][0] - keypoints[5][0]))
        # Hands are excluded by the skin-aware protection below. Large wrist
        # circles would also lock old cuffs and fabric next to the hands.
        for point_index, radius_factor in ((0, 0.28), (1, 0.22), (2, 0.22), (3, 0.18), (4, 0.18)):
            if point_index < len(keypoints) and keypoints[point_index][2] > 0.25:
                cv2.circle(protection, (round(keypoints[point_index][0]), round(keypoints[point_index][1])), max(5, round(shoulder_width * radius_factor)), 255, -1)
        mask[protection > 0] = False
    # A SAM miss should not silently create an empty batch item.
    prior_pixels = int((pose_prior > 0).sum())
    overlap_pixels = int(np.logical_and(mask, pose_prior > 0).sum())
    prior_coverage = float(overlap_pixels / prior_pixels) if prior_pixels else 1.0
    # A narrow SAM strip creates a visible insert. Complete it with the pose
    # silhouette when less than 72% of the expected garment is covered.
    if not hints and prior_pixels and prior_coverage < 0.72:
        mask = np.logical_or(mask, pose_prior > 0)
    elif not hints and mask.mean() < 0.025:
        mask = np.logical_and(allowed, pose_prior > 0) if prior_pixels else allowed
    if keypoints:
        mask[protection > 0] = False
    # Close small holes and extend only a few pixels across shoulder/waist seams.
    # The result remains clipped to the category-aware body box above.
    refined = mask.astype(np.uint8) * 255
    refined = cv2.morphologyEx(refined, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    if category == "upper_body":
        refined = cv2.dilate(refined, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 5)), iterations=1)
    else:
        refined = cv2.dilate(refined, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)), iterations=1)
    refined[~allowed] = 0
    # Pose completion may fill missed fabric, but must not invent rectangular
    # strips of background alongside the arms or legs.
    silhouette = (trusted_silhouette.astype(np.uint8) if category == 'upper_body' else
                  fill_garment_mask_holes(np.logical_or.reduce(np.asarray(masks, dtype=bool), axis=0)))
    silhouette = cv2.dilate(silhouette, np.ones((5, 5), np.uint8), iterations=1)
    refined[silhouette == 0] = 0
    # A combined shirt+trousers prompt can treat pale shirt highlights as
    # background connected to the sleeve edge. Recover the shirt separately.
    if hints and category in ("upper_body", "overall", "full_body") and not any(int(point.get("label", 1)) == 0 for point in hints):
        shirt, _ = automatic_garment_mask(source, "upper_body", person_box, keypoints)
        refined = np.maximum(refined, np.asarray(shirt, dtype=np.uint8))
    for point in hints:
        if int(point.get("label", 1)) == 0:
            cv2.circle(refined, (round(float(point["x"])), round(float(point["y"]))), max(3, round(min(width, height) * 0.008)), 0, -1)
    protected = automatic_protected_detail_mask(source, person_box, keypoints)
    refined[np.asarray(protected) > 0] = 0
    output = Image.fromarray(refined, mode="L")
    return output, float(scores[best])


def automatic_protected_detail_mask(source: Image.Image, person_box, keypoints=None) -> Image.Image:
    """Protect identity-bearing head/hair and hands inside an editable garment region."""
    width, height = source.size
    px0, py0, px1, py1 = [float(value) for value in person_box]
    pw, ph = max(1.0, px1 - px0), max(1.0, py1 - py0)
    protected = np.zeros((height, width), dtype=np.uint8)
    head_top, head_bottom = py0 - ph * 0.015, py0 + ph * 0.23
    head_x, head_radius = px0 + pw * 0.5, pw * 0.24
    if keypoints and len(keypoints) > 6 and keypoints[5][2] > 0.25 and keypoints[6][2] > 0.25:
        shoulder_y = min(keypoints[5][1], keypoints[6][1])
        head_bottom = max(py0 + ph * 0.10, shoulder_y - ph * 0.025)
        face_points = [point for point in keypoints[:5] if point[2] > 0.25]
        if face_points:
            head_x = float(np.mean([point[0] for point in face_points]))
        head_radius = max(pw * 0.18, abs(keypoints[6][0] - keypoints[5][0]) * 0.54)
    head_center = (round(head_x), round((head_top + head_bottom) / 2))
    head_axes = (max(8, round(head_radius)), max(12, round((head_bottom - head_top) / 2)))
    cv2.ellipse(protected, head_center, head_axes, 0, 0, 360, 255, -1)
    rgb = np.asarray(source.convert("RGB"), dtype=np.uint8)
    ycrcb = cv2.cvtColor(rgb, cv2.COLOR_RGB2YCrCb)
    skin = cv2.inRange(ycrcb, np.asarray([0, 130, 75], dtype=np.uint8), np.asarray([255, 185, 140], dtype=np.uint8))
    warm_skin = (rgb[:, :, 0].astype(np.int16) > rgb[:, :, 1].astype(np.int16) + 5) & (rgb[:, :, 1].astype(np.int16) > rgb[:, :, 2].astype(np.int16) + 2)
    skin[~warm_skin] = 0
    skin = cv2.morphologyEx(skin, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    # Below the face, a geometric oval can contain the old shirt collar.
    # Preserve skin and dark hair here, rather than copying the collar back.
    lower_head = max(0, round(head_top + (head_bottom - head_top) * 0.62))
    head_core = protected.copy()
    head_core[lower_head:] = 0
    hair = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY) < 95
    protected[lower_head:][~((skin > 0) | hair)[lower_head:]] = 0
    if keypoints:
        shoulder_width = ph * 0.18
        if len(keypoints) > 6 and keypoints[5][2] > 0.25 and keypoints[6][2] > 0.25:
            shoulder_width = max(shoulder_width, abs(keypoints[6][0] - keypoints[5][0]))
        for point_index in (9, 10):
            if point_index < len(keypoints) and keypoints[point_index][2] > 0.25:
                hand_region = np.zeros_like(protected)
                wrist = np.asarray(keypoints[point_index][:2], dtype=np.float32)
                cv2.circle(hand_region, tuple(np.round(wrist).astype(int)), max(10, round(shoulder_width * 0.22)), 255, -1)
                elbow_index = point_index - 2
                if keypoints[elbow_index][2] > 0.25:
                    elbow = np.asarray(keypoints[elbow_index][:2], dtype=np.float32)
                    tip = wrist + (wrist - elbow) * 0.45
                    cv2.line(hand_region, tuple(np.round(wrist).astype(int)), tuple(np.round(tip).astype(int)), 255, max(12, round(shoulder_width * 0.28)))
                # Restrict wrist/hand protection to source skin. Large circles
                # otherwise lock old cuffs, elbow fabric and nearby trousers.
                protected[(hand_region > 0) & (skin > 0)] = 255
    # Dark collars/cuffs can satisfy the hair/skin colour tests. Keeping those
    # pixels feeds old fabric back into the model and copies it over the result.
    # Only a confident garment label may unlock them; the head core stays locked.
    import character_quality
    if character_quality.available(ROOT):
        labels, confident = character_quality.parse(source, ROOT)
        fabric = np.isin(labels, [4, 7]) & confident & (head_core == 0)
        protected[fabric] = 0
    return Image.fromarray(protected, mode="L")


def sleeveless_reference(garment: Image.Image) -> bool:
    rgb = np.asarray(garment.convert("RGB"), dtype=np.float32)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    foreground = np.linalg.norm(rgb - np.median(border, axis=0), axis=2) > 45
    ys, xs = np.where(foreground)
    if not len(ys):
        return False
    crop = foreground[ys.min():ys.max()+1, xs.min():xs.max()+1]
    # Only auto-enable for unambiguous thin straps above the bodice.
    return float(crop[:max(1, round(crop.shape[0]*0.18))].mean()) < 0.25


def reference_skin_mask(source, image, person):
    rgb = np.asarray(source.convert("RGB"))
    points = person.get("keypoints") or []
    if points and points[0][2] > 0.25:
        x,y = np.round(points[0][:2]).astype(int)
    else:
        x0,y0,x1,y1=person["box"]
        x,y=round((x0+x1)/2),round(y0+(y1-y0)*0.10)
    radius=max(3,round(source.width*0.008))
    patch=rgb[max(0,y-radius):min(source.height,y+radius+1),max(0,x-radius):min(source.width,x+radius+1)]
    if not patch.size:
        return np.zeros((image.height,image.width),dtype=np.uint8)
    reference=np.median(cv2.cvtColor(patch,cv2.COLOR_RGB2LAB).reshape(-1,3),axis=0)
    lab=cv2.cvtColor(np.asarray(image.convert("RGB")),cv2.COLOR_RGB2LAB).astype(np.float32)
    chroma=np.linalg.norm(lab[:,:,1:]-reference[1:],axis=2)
    skin=(chroma<19)&(lab[:,:,0]>reference[0]-48)&(lab[:,:,0]<reference[0]+48)
    return skin.astype(np.uint8)*255


def arm_reconstruction_masks(source, person, editable, protected, result=None):
    points = person.get("keypoints") or []
    if len(points) < 13 or any(points[i][2] <= 0.25 for i in (5, 6, 7, 8, 9, 10, 11, 12)):
        return Image.new("L", source.size), protected
    width = max(20, abs(points[5][0] - points[6][0]))
    region = np.zeros((source.height, source.width), dtype=np.uint8)
    for shoulder, elbow, wrist in ((5, 7, 9), (6, 8, 10)):
        for first, second in ((shoulder, elbow), (elbow, wrist)):
            cv2.line(region, tuple(np.round(points[first][:2]).astype(int)), tuple(np.round(points[second][:2]).astype(int)), 255, round(width*0.90))
    torso = np.zeros_like(region)
    cv2.fillConvexPoly(torso, np.asarray([points[i][:2] for i in (5,6,12,11)], dtype=np.int32), 255)
    garment_lock = torso > 0
    if result is not None:
        hsv = cv2.cvtColor(np.asarray(result.convert("RGB")), cv2.COLOR_RGB2HSV)
        colored = (torso > 0) & (hsv[:,:,1] > 100)
        if int(colored.sum()) > 256:
            value_floor=max(80,float(np.percentile(hsv[:,:,2][colored],65))*0.65)
            vivid=colored & (hsv[:,:,2]>value_floor)
            hue = int(np.argmax(np.bincount(hsv[:,:,0][vivid], minlength=180)))
            delta = np.abs(hsv[:,:,0].astype(np.int16)-hue)
            garment_lock = (torso>0) & (np.minimum(delta,180-delta) < 10) & (hsv[:,:,1] > 90) & (hsv[:,:,2]>value_floor)
            garment_lock = cv2.morphologyEx(garment_lock.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((9,9),dtype=np.uint8))>0
    region[garment_lock] = 0
    skin = reference_skin_mask(source,source,person)
    count, labels, stats, _ = cv2.connectedComponentsWithStats((skin > 0).astype(np.uint8), 8)
    clean_skin = np.zeros_like(skin)
    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] >= max(64, round(source.width*source.height*0.0001)):
            clean_skin[labels == index] = 255
    preserve = np.maximum(np.asarray(protected), np.where((region > 0) & (clean_skin > 0), 255, 0).astype(np.uint8))
    silhouette = cv2.morphologyEx((np.asarray(editable)>0).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((17,17), dtype=np.uint8))
    silhouette = fill_garment_mask_holes(silhouette)
    region[silhouette == 0] = 0
    region = cv2.morphologyEx(region, cv2.MORPH_CLOSE, np.ones((17,17), dtype=np.uint8))
    region = cv2.dilate(region, np.ones((7,7),dtype=np.uint8),iterations=1)
    region[garment_lock] = 0
    region[preserve > 0] = 0
    return Image.fromarray(region), Image.fromarray(preserve)


def garment_category_from_points(points, person, fallback: str) -> str:
    positives = [point for point in (points or []) if int(point.get("label", 1)) == 1]
    if not positives:
        return fallback
    x0, y0, x1, y1 = person["box"]
    height = max(1.0, y1 - y0)
    keypoints = person.get("keypoints")
    waist_y = y0 + height * 0.38
    if keypoints and len(keypoints) > 12 and keypoints[11][2] > 0.25 and keypoints[12][2] > 0.25:
        waist_y = float(np.mean([keypoints[11][1], keypoints[12][1]])) - height * 0.10
    # Only points within the selected person's body determine the category.
    ys = [float(point["y"]) for point in positives if x0 <= float(point["x"]) <= x1 and y0 + height * 0.18 <= float(point["y"]) <= y1]
    if not ys:
        return fallback
    above = any(y < waist_y - height * 0.015 for y in ys)
    below = any(y > waist_y + height * 0.015 for y in ys)
    if above and below:
        return "overall"
    return "upper_body" if above else "lower_body" if below else fallback


def refine_object_mask(mask, points, protected):
    binary = fill_garment_mask_holes(mask)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3,3),dtype=np.uint8))
    count, labels, _, _ = cv2.connectedComponentsWithStats(binary, 8)
    selected = set()
    for point in points:
        if int(point.get("label",1)) == 1:
            x,y=round(float(point["x"])),round(float(point["y"]))
            neighborhood=labels[max(0,y-3):min(labels.shape[0],y+4),max(0,x-3):min(labels.shape[1],x+4)]
            selected.update(int(value) for value in np.unique(neighborhood) if value)
    if selected:
        binary=np.isin(labels,list(selected)).astype(np.uint8)
    for point in points:
        if int(point.get("label",1)) == 0:
            cv2.circle(binary,(round(float(point["x"])),round(float(point["y"]))),max(3,round(min(binary.shape)*0.008)),0,-1)
    binary[np.asarray(protected)>0]=0
    return Image.fromarray(binary*255)


def segment_object_mask(body: dict) -> dict:
    from PIL import ImageOps
    source=ImageOps.exif_transpose(Image.open(safe_sample(str(body.get("sampleId",""))))).convert("RGB")
    points=body.get("points") or []
    if not points or len(points)>64 or not any(int(p.get("label",1))==1 for p in points):
        raise ValueError("Cần ít nhất một điểm chọn; tối đa 64 điểm mỗi lượt")
    coords=np.asarray([[float(p["x"]),float(p["y"])] for p in points],dtype=np.float32)
    labels=np.asarray([int(p.get("label",1)) for p in points],dtype=np.int32)
    if not np.isfinite(coords).all() or not np.isin(labels,[0,1]).all() or (coords<0).any() or (coords[:,0]>=source.width).any() or (coords[:,1]>=source.height).any():
        raise ValueError("Điểm chọn mask không hợp lệ hoặc nằm ngoài ảnh")
    coords=np.round(coords).astype(np.int32)
    coords[:,0]=np.clip(coords[:,0],0,source.width-1);coords[:,1]=np.clip(coords[:,1],0,source.height-1)
    points=[{"x":int(x),"y":int(y),"label":int(label)} for (x,y),label in zip(coords,labels)]
    protected=decode_mask(str(body["protectedDetailMask"]),source.size) if body.get("protectedDetailMask") else Image.new("L",source.size)
    model=load_predictor()
    with torch.inference_mode(),torch.autocast(device_type=device,dtype=torch.bfloat16,enabled=device=="cuda"):
        model.set_image(np.asarray(source))
        masks,scores,_=model.predict(point_coords=coords,point_labels=labels,multimask_output=True)
        def rank(index):
            agreement=float((np.asarray(masks[index])[coords[:,1],coords[:,0]]==(labels>0)).mean())
            return agreement*2+float(scores[index])
        best=max(range(len(masks)),key=rank)
        combined=np.asarray(masks[best],dtype=bool).copy()
        for index,candidate in enumerate(masks):
            union=np.logical_or(combined,candidate).sum()
            if scores[index]>=scores[best]-.08 and np.logical_and(combined,candidate).sum()/max(1,union)>=.80 and rank(index)>=rank(best)-.08:
                combined|=np.asarray(candidate,dtype=bool)
        # A disconnected second object needs its own positive prompt.
        for index in np.flatnonzero(labels==1)[:8]:
            x,y=coords[index]
            if combined[y,x]:
                continue
            local_coords=np.concatenate([coords[index:index+1],coords[labels==0]])
            local_labels=np.concatenate([np.ones(1,dtype=np.int32),labels[labels==0]])
            extra,confidence,_=model.predict(point_coords=local_coords,point_labels=local_labels,multimask_output=True)
            valid=[i for i in range(len(extra)) if extra[i][y,x]]
            if valid:combined|=np.asarray(extra[max(valid,key=lambda i:float(confidence[i]))],dtype=bool)
    mask=refine_object_mask(combined,points,protected)
    if mask.getbbox() is None:
        raise ValueError("Vùng chọn trống hoặc nằm hoàn toàn trong vùng bảo vệ")
    return {"ok":True,"mask":encode_image(mask),"score":float(scores[best]),"coverage":float((np.asarray(mask)>0).mean()),"protectedMask":encode_image(protected),"device":device}


def analyze_people(body: dict) -> dict:
    source = Image.open(safe_sample(str(body.get("sampleId", "")))).convert("RGB")
    return {"ok": True, "people": detect_people(source, bool(body.get("usePose"))), "width": source.width, "height": source.height, "device": device, "poseAvailable": POSE_MODEL.is_file()}


def _boxes_to_sam_mask(source: Image.Image, boxes) -> Image.Image:
    combined = np.zeros((source.height, source.width), dtype=np.uint8)
    if not boxes:
        return Image.fromarray(combined, mode="L")
    segmenter = load_predictor();segmenter.set_image(np.asarray(source))
    for box in boxes:
        masks, scores, _ = segmenter.predict(box=np.asarray(box, dtype=np.float32), multimask_output=True)
        combined[np.asarray(masks[int(np.argmax(scores))], dtype=bool)] = 255
    return Image.fromarray(combined, mode="L")


def transformer_detect_regions(source: Image.Image, kind: str, classes: list[str], confidence: float) -> dict:
    if not classes:
        raise ValueError("Hãy nhập ít nhất một tên đối tượng")
    model, processor = _transformer_detector(kind)
    items, boxes = [], []
    if kind == "grounding-dino":
        text = ". ".join(classes) + "."
        inputs = processor(images=source, text=text, return_tensors="pt").to(device)
        with torch.inference_mode(): outputs = model(**inputs)
        result = processor.post_process_grounded_object_detection(outputs, inputs.input_ids, threshold=confidence, text_threshold=confidence, target_sizes=[source.size[::-1]])[0]
        for index, (box, score, label) in enumerate(zip(result["boxes"], result["scores"], result["labels"])):
            coords = [round(float(value)) for value in box.tolist()];boxes.append(coords);items.append({"index":index,"label":str(label),"confidence":float(score),"box":coords})
    else:
        task = "<OPEN_VOCABULARY_DETECTION>";prompt = task + ', '.join(classes)
        inputs = processor(text=prompt, images=source, return_tensors="pt").to(device)
        with torch.inference_mode(): generated = model.generate(input_ids=inputs["input_ids"], pixel_values=inputs["pixel_values"], max_new_tokens=512, num_beams=3)
        text = processor.batch_decode(generated, skip_special_tokens=False)[0]
        parsed = processor.post_process_generation(text, task=task, image_size=source.size).get(task, {})
        for index, (box, label) in enumerate(zip(parsed.get("bboxes", []), parsed.get("bboxes_labels", parsed.get("labels", [])))):
            coords = [round(float(value)) for value in box];boxes.append(coords);items.append({"index":index,"label":str(label),"confidence":1.0,"box":coords})
    combined = np.zeros((source.height, source.width), dtype=np.uint8)
    for item in items:
        single = _boxes_to_sam_mask(source, [item["box"]])
        item["mask"] = encode_image(single)
        combined = np.maximum(combined, np.asarray(single))
    return {"items":items,"mask":Image.fromarray(combined, mode="L")}


def detect_regions(body: dict) -> dict:
    from PIL import ImageOps
    source = ImageOps.exif_transpose(Image.open(safe_sample(str(body.get("sampleId", ""))))).convert("RGB")
    kind = str(body.get("model", "adetailer"))
    if kind not in ("adetailer", "yolo-world", "grounding-dino", "florence-2"):
        raise ValueError("Model phát hiện không được hỗ trợ")
    classes = [str(item).strip() for item in (body.get("classes") or []) if str(item).strip()][:32]
    confidence = max(0.05, min(0.95, float(body.get("confidence", 0.25))))
    if kind in ("grounding-dino", "florence-2"):
        detected = transformer_detect_regions(source, kind, classes, confidence)
        mask, items = detected["mask"], detected["items"]
        for item in items:
            single = decode_image(item["mask"]).convert("L")
            pad = max(0, min(64, int(body.get("padding", 8))))
            if pad:
                single = Image.fromarray(cv2.dilate(np.asarray(single), np.ones((pad*2+1, pad*2+1), np.uint8)), mode="L")
            item["mask"] = encode_image(single)
        padding = max(0, min(64, int(body.get("padding", 8))))
        if padding and np.asarray(mask).any(): mask=Image.fromarray(cv2.dilate(np.asarray(mask),np.ones((padding*2+1,padding*2+1),np.uint8)),mode="L")
        return {"ok":True,"model":kind,"width":source.width,"height":source.height,"detections":items,"mask":encode_image(mask),"count":len(items),"warning":""}
    model = _detector(kind)
    class_warning = ""
    if kind == "yolo-world":
        if not classes:
            raise ValueError("YOLO-World cần ít nhất một tên đối tượng")
        try:
            model.set_classes(classes)
        except (ImportError, RuntimeError) as error:
            # Some offline Windows builds have no compatible CLIP/torchvision
            # binary. The checkpoint still carries its default vocabulary.
            class_warning = f"Dùng từ vựng tích hợp của checkpoint vì CLIP không khả dụng: {error}"
    prediction = model.predict(np.asarray(source)[:, :, ::-1].copy(), conf=confidence, verbose=False, device=0 if device == "cuda" else "cpu")[0]
    items, combined = [], np.zeros((source.height, source.width), dtype=np.uint8)
    names = prediction.names
    if prediction.boxes is not None:
        for index, box in enumerate(prediction.boxes):
            xyxy = [max(0, int(round(value))) for value in box.xyxy[0].detach().cpu().tolist()]
            xyxy[2], xyxy[3] = min(source.width, xyxy[2]), min(source.height, xyxy[3])
            class_id = int(box.cls[0].item())
            score = float(box.conf[0].item())
            x0, y0, x1, y1 = xyxy
            label = str(names.get(class_id, class_id))
            if kind == "yolo-world" and class_warning and classes and not any(term.lower() in label.lower() or label.lower() in term.lower() for term in classes):
                continue
            if kind == "yolo-world":
                # A detector box is only a SAM prompt, never the final erase mask.
                single = np.asarray(_boxes_to_sam_mask(source, [xyxy])).copy()
                if not single.any():
                    raise ValueError("Không tách được đường viền vật thể. Hãy chọn bằng điểm AI hoặc tô vùng thủ công.")
            else:
                single = np.zeros_like(combined)
                single[y0:y1, x0:x1] = 255
            combined = np.maximum(combined, single)
            pad = max(0, min(64, int(body.get("padding", 8))))
            if pad:
                single = cv2.dilate(single, np.ones((pad*2+1, pad*2+1), np.uint8))
            items.append({"index": index, "label": label, "confidence": score, "box": xyxy, "mask": encode_image(Image.fromarray(single, mode="L"))})
    padding = max(0, min(64, int(body.get("padding", 8))))
    if padding and combined.any():
        combined = cv2.dilate(combined, np.ones((padding * 2 + 1, padding * 2 + 1), np.uint8))
    mask = Image.fromarray(combined, mode="L")
    return {"ok": True, "model": kind, "maskMethod": "yolo-world+sam" if kind == "yolo-world" else "box", "width": source.width, "height": source.height, "detections": items, "mask": encode_image(mask), "count": len(items), "warning": class_warning}
