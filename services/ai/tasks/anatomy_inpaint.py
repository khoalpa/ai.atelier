"""Anatomy-aware, person-owned masks layered on the existing inpaint task."""
from __future__ import annotations

import base64
import io
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

from prompt_catalog import catalog_value, prompt_template, prompt_text
import character
from character_quality import extremity_review
from services.ai.imaging.segmentation import decode_mask, encode_image
from services.ai.runtime.jobs import update_job
from services.ai.tasks.inpaint import inpaint


def _read_parts(root=None):
    source = Path(root) / 'workspace' / 'prompts.json' if root else Path(__file__).resolve().parents[3] / 'workspace' / 'prompts.json'
    catalog = json.loads(source.read_text(encoding='utf-8'))['featurePresets']['anatomy.parts']
    return {item['id']: item for item in catalog['items']}


PARTS = _read_parts()


def _encode_mask(mask: Image.Image) -> str:
    buffer = io.BytesIO()
    mask.convert("L").save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _settings(body: dict, root=None) -> tuple[str, dict, str]:
    parts = _read_parts(root)
    part = str(body.get("bodyPart") or "right_hand")
    if part not in parts:
        raise ValueError("Bộ phận cơ thể chưa được hỗ trợ")
    mode = str(body.get("anatomyMode") or "strict")
    if mode not in ("safe", "balanced", "strict"):
        raise ValueError("Mức kiểm tra giải phẫu không hợp lệ")
    intent = str(body.get("intent") or "repair")
    if intent not in ("repair", "restore", "reshape", "pose", "custom"):
        raise ValueError("Mục tiêu chỉnh sửa không hợp lệ")
    return part, parts[part], mode


def _part_mask(size, points, spec, mode):
    width, height = size
    pixels = np.zeros((height, width), np.uint8)
    q = np.asarray(points, dtype=float)
    shoulder = np.linalg.norm((q[5, :2] - q[6, :2]) * [width, height]) if min(q[5, 2], q[6, 2]) > .2 else min(width, height) * .13
    mask_settings = spec.get("mask", {})
    scale = float(mask_settings.get(mode, {"safe": .25, "balanced": .32, "strict": .38}[mode]))
    radius = max(int(mask_settings.get("minimumRadius", 14)), round(shoulder * scale))
    for a, b in spec["segments"]:
        if min(q[a, 2], q[b, 2]) < .22:
            continue
        start, end = np.rint(q[[a, b], :2] * [width, height]).astype(int)
        cv2.line(pixels, tuple(start), tuple(end), 255, radius * 2)
    for joint in spec["joints"]:
        if q[joint, 2] > .22:
            center = np.rint(q[joint, :2] * [width, height]).astype(int)
            local_radius = round(radius * float(mask_settings.get("endpointScale", 1.45 if spec["kind"] in ("hand", "foot") else 1.0)))
            if spec["kind"] == "foot":
                ratio = float(mask_settings.get("ellipseRatio", 2.0))
                cv2.ellipse(pixels, tuple(center), (round(local_radius * ratio), local_radius), 0, 0, 360, 255, -1)
            else:
                cv2.circle(pixels, tuple(center), local_radius, 255, -1)
    if not pixels.any():
        raise ValueError("Không thấy đủ khớp của bộ phận đã chọn. Hãy chọn ảnh rõ hơn hoặc bộ phận khác.")
    return pixels


def _protect_others(size, people, selected_id):
    width, height = size
    pixels = np.zeros((height, width), np.uint8)
    for person in people:
        if int(person["id"]) == selected_id:
            continue
        x0, y0, x1, y1 = np.rint(np.asarray(person["box"]) * [width, height, width, height]).astype(int)
        pixels[max(0, y0):min(height, y1), max(0, x0):min(width, x1)] = 255
    return pixels


def preview(body: dict, env: dict) -> dict:
    part, spec, mode = _settings(body, env["ROOT"])
    source, _, source_hash, people, _ = character.inspect_source(body.get("sampleId", ""), env)
    person_id = int(body.get("personId", 0))
    if person_id < 0 or person_id >= len(people):
        raise ValueError("Nhân vật đã chọn không còn trong ảnh")
    points = people[person_id].get("keypoints", [])
    if np.asarray(points).shape != (17, 3):
        raise ValueError("Không đọc được khung xương của nhân vật đã chọn")
    editable = _part_mask(source.size, points, spec, mode)
    protected = _protect_others(source.size, people, person_id)
    if body.get("protectedDetailMask"):
        protected = np.maximum(protected, np.asarray(decode_mask(str(body["protectedDetailMask"]), source.size)))
    editable[protected > 16] = 0
    if not editable.any():
        raise ValueError("Vùng bảo vệ đang che toàn bộ bộ phận cần sửa")
    overlay = np.asarray(source.convert("RGB")).copy()
    overlay[editable > 0] = np.rint(overlay[editable > 0] * .45 + np.array([255, 126, 42]) * .55).astype(np.uint8)
    overlay[protected > 0] = np.rint(overlay[protected > 0] * .55 + np.array([35, 132, 255]) * .45).astype(np.uint8)
    return {
        "ok": True, "sourceSha256": source_hash, "width": source.width, "height": source.height,
        "bodyPart": part, "bodyPartLabel": spec["label"], "personId": person_id,
        "people": people, "editableMask": _encode_mask(Image.fromarray(editable)),
        "protectedMask": _encode_mask(Image.fromarray(protected)), "overlay": encode_image(Image.fromarray(overlay)),
        "maskPixels": int((editable > 0).sum()),
    }


def _prompt(spec, intent, custom):
    goals = catalog_value('featurePresets', 'anatomy.intents')
    goal = (custom.strip() if intent == 'custom' else goals.get(intent)) or goals['repair']
    return prompt_template('anatomy.correction', part=spec['label'].lower(), goal=goal)


def _review(result_image, env, person_id, source_points, spec, mode):
    detected = env["detect_people_pose"](result_image)
    if not detected:
        return {"available": False, "passed": mode != "strict", "score": 0, "issues": ["Không nhận diện được khung xương sau khi sửa."]}
    target = np.asarray(source_points, dtype=float).copy()
    observed = min(detected, key=lambda item: abs(item["box"][0] / result_image.width - target[0, 0]))
    q = np.asarray(observed.get("keypoints", []), dtype=float)
    if q.shape != (17, 3):
        return {"available": False, "passed": mode != "strict", "score": 0, "issues": ["Không đọc được đủ 17 khớp cơ thể."]}
    coverage = float(np.mean(q[list(spec["joints"]), 2] > .22))
    lengths = []
    for a, b in spec["segments"]:
        lengths.append(float(np.linalg.norm(q[a, :2] - q[b, :2])))
    continuous = bool(lengths and min(lengths) > min(result_image.size) * .015)
    issues = []
    if coverage < 1: issues.append("Một số khớp của bộ phận chưa được nhận diện rõ.")
    if not continuous: issues.append("Chuỗi khớp của bộ phận chưa liên tục.")
    extremity = None
    if spec["kind"] in ("hand", "foot"):
        extremity = extremity_review([observed], {person_id: target}, result_image.size, mode)
        issues.extend(item["message"] for item in extremity.get("issues", []) if item.get("part") != "detector")
    score = round(100 * (.65 * coverage + .35 * float(continuous)), 2)
    threshold = float(spec.get("quality", {}).get(mode, {"safe": 65, "balanced": 75, "strict": 90}[mode]))
    extremity_ok = extremity is None or (extremity.get("passed") if extremity.get("available") else mode != "strict")
    passed = score >= threshold and extremity_ok
    return {"available": True, "passed": passed, "score": score, "threshold": threshold,
            "jointCoverage": coverage, "jointContinuity": continuous, "extremity": extremity,
            "issues": list(dict.fromkeys(issues)), "needsVisualReview": True}


def run(body: dict, env: dict) -> dict:
    part, spec, mode = _settings(body, env["ROOT"])
    plan = preview(body, env)
    expected_hash = str(body.get("sourceSha256") or "")
    if expected_hash and expected_hash != plan["sourceSha256"]:
        raise ValueError("Ảnh nguồn đã đổi. Hãy kiểm tra lại vùng giải phẫu trước khi tạo.")
    intent = str(body.get("intent") or "repair")
    request = {
        **body,
        "taskType": "anatomy-inpaint", "processingMode": "anatomy-inpaint",
        "editableMask": plan["editableMask"], "protectedDetailMask": plan["protectedMask"],
        "removalTarget": "custom", "fillMode": "reconstruct_body",
        "prompt": _prompt(spec, intent, str(body.get("prompt") or "")),
        "negativePrompt": ", ".join(filter(None, [str(body.get("negativePrompt") or ""),
            prompt_text('anatomy.negative')])),
        "semanticCheck": False, "structuralRefine": bool(body.get("structuralRefine", True)),
        "expand": int(body.get("expand", 10)), "blur": int(body.get("blur", 8)),
        "count": max(1, min(4, int(body.get("candidateCount", body.get("count", 2))))),
    }
    result = inpaint(request)
    source_points = plan["people"][plan["personId"]]["keypoints"]
    for item in result.get("results", []):
        image = Image.open(io.BytesIO(base64.b64decode(item["image"].split(",", 1)[1]))).convert("RGB")
        item["anatomyReview"] = _review(image, env, plan["personId"], source_points, spec, mode)
        item["bodyPart"] = part
        item["bodyPartLabel"] = spec["label"]
    reviews = [{"seed": item.get("seed"), **item.get("anatomyReview", {})} for item in result.get("results", [])]
    output_dir = Path(env["ROOT"]) / str(result.get("directory") or "")
    if output_dir.is_dir():
        (output_dir / "anatomy_review.json").write_text(json.dumps({
            "schemaVersion": 1, "bodyPart": part, "bodyPartLabel": spec["label"], "personId": plan["personId"],
            "anatomyMode": mode, "intent": intent, "sourceSha256": plan["sourceSha256"], "reviews": reviews,
            "limitations": "Landmark checks reduce obvious failures but do not prove medical or anatomical correctness; visual review is required."
        }, ensure_ascii=False, indent=2), encoding="utf-8")
    passed_count = sum(1 for review in reviews if review.get("passed"))
    if body.get("jobId"):
        update_job(str(body["jobId"])[:80], anatomyPassed=passed_count, anatomyReviewed=len(reviews),
                   _event={"type": "anatomy.reviewed", "message": f"{passed_count}/{len(reviews)} phương án vượt cổng giải phẫu"})
    result.update(taskType="anatomy-inpaint", bodyPart=part, bodyPartLabel=spec["label"], anatomyMode=mode,
                  sourceSha256=plan["sourceSha256"], editableMask=plan["editableMask"], protectedMask=plan["protectedMask"])
    return result
