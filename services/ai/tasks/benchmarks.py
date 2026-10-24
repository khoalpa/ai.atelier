"""AI Atelier: tasks.benchmarks."""
from PIL import Image, ImageFilter, ImageOps
from datetime import datetime, timezone
from pathlib import Path
from prompt_catalog import prompt_text, prompt_template, read_catalog, task_prompt
import hashlib
import json
import numpy as np
import shutil
from services.ai.imaging.blending import adaptive_local_edge_blend, generative_seam_refine, mask_strength_policy, texture_preserving_core_recovery
from services.ai.imaging.mask_workflows import catvton_dedicated_mask
from services.ai.imaging.references import active_reference_path, normalize_reference, preprocess_garment_image
from services.ai.imaging.scoring import catvton_core_degradation, catvton_geometry_consistency, color_material_consistency, score_tryon_result
from services.ai.imaging.segmentation import automatic_garment_mask, automatic_protected_detail_mask, detect_people, encode_image, safe_sample
from services.ai.models.pipelines import configure_loras, reference_similarity
from services.ai.models import state as model_state
from services.ai.runtime.configuration import OUTPUTS, ROOT, SAMPLES
from services.ai.tasks.inpaint import inpaint
from services.ai.tasks.tryon import batch_tryon, tryon


def catvton_reference_matrix(body: dict) -> dict:
    sample_ids = [str(value) for value in (body.get("sampleIds") or ["characters/c001.png", "characters/c002.png", "characters/c003.png"])[:3]]
    category = str(body.get("category") or "upper_body")
    reference_path = active_reference_path(category)
    manifest_path = ROOT / "workspace" / "references" / f"{category}.json"
    profile_path = ROOT / "workspace" / "review" / "reference-profiles.json"
    if profile_path.is_file():
        profiles = json.loads(profile_path.read_text(encoding="utf-8"))
        profile = profiles.get("profiles", {}).get(category, {})
        if (profile.get("validation") or {}).get("accepted"):
            # Product uploads have their own manifest. Never replace them with
            # a garment extracted from a sample because the legacy file is absent.
            manifest_path = ROOT / str(profile.get("manifest") or "")
            reference_path = ROOT / str(profile.get("reference") or "")
            if not reference_path.is_file() or not manifest_path.is_file():
                raise ValueError("Thiếu ảnh hoặc manifest của reference sản phẩm đã kiểm định")
    if not reference_path.is_file() or not manifest_path.is_file():
        normalize_reference({"garmentSampleId": body.get("garmentSampleId") or "characters/c003.png", "category": category})
    reference = Image.open(reference_path).convert("RGB")
    reference_data = encode_image(reference)
    reference_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    base_seed = int(body.get("seed", 49001))
    mask_mode = str(body.get("maskMode") or "standard")
    rows, skipped = [], []
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output_dir = OUTPUTS / f"catvton_reference_{stamp}"
    output_dir.mkdir(parents=True, exist_ok=False)
    for index, sample_id in enumerate(sample_ids):
        source = Image.open(safe_sample(sample_id)).convert("RGB")
        people = detect_people(source, True)
        if len(people) != 1:
            skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
            continue
        person = people[0]
        if mask_mode == "dedicated":
            mask, mask_score, dedicated_metrics = catvton_dedicated_mask(source, category, person["box"], person.get("keypoints"))
        else:
            mask, mask_score = automatic_garment_mask(source, category, person["box"], person.get("keypoints"))
            dedicated_metrics = {"mode": "standard"}
        protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
        mask_array = np.asarray(mask, dtype=np.uint8).copy()
        mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
        mask = Image.fromarray(mask_array, mode="L")
        policy = mask_strength_policy(mask, person["box"], category, person.get("keypoints"))
        mask_accepted = (
            bool(dedicated_metrics.get("accepted", policy["accepted"]))
            if mask_mode == "dedicated"
            else policy["accepted"]
        )
        if not mask_accepted:
            skipped.append({"sampleId": sample_id, "reason": "mask-quality-gate", "maskScore": mask_score, "maskMode": mask_mode, "dedicatedMask": dedicated_metrics, **policy})
            continue
        seed = base_seed + index
        result = tryon({
            "sampleId": sample_id, "garmentImage": reference_data, "category": category,
            "editableMask": encode_image(mask), "autoMask": False, "usePose": True, "personIndex": 0, "cropPerson": False,
            "preprocessGarment": False, "count": 1, "steps": int(body.get("steps", 10)),
            "guidance": float(body.get("guidance", 2.5)), "seed": seed,
            "maxSide": int(body.get("maxSide", 512)), "expand": 0, "blur": 6,
            "repairSeams": False, "generativeRefine": False, "maxRetries": 0,
            "minimumQuality": 0, "minimumSimilarity": 0, "minimumSeam": 0, "minimumAnatomy": 0,
        })
        generated = Image.open(ROOT / result["selected"]).convert("RGB")
        metrics = score_tryon_result(source, generated, mask)
        metrics["referenceSimilarity"] = reference_similarity(reference, generated, mask)
        target = output_dir / f"{Path(sample_id).stem}_catvton.png"
        generated.save(target)
        mask.save(output_dir / f"{Path(sample_id).stem}_mask.png")
        rows.append({"sampleId": sample_id, "seed": seed, "maskScore": mask_score, "maskMode": mask_mode, "dedicatedMask": dedicated_metrics, **policy, "dedicatedGateAccepted": mask_accepted, "output": str(target.relative_to(ROOT)), "performance": result["performance"], **metrics})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "category": category, "maskMode": mask_mode, "reference": reference_manifest, "sampleCount": len(rows),
        "skippedCount": len(skipped), "skipped": skipped, "rows": rows,
        "catvtonOnly": True, "sameConfiguration": True, "requiresVisualReview": True,
    }
    report_path = ROOT / "workspace" / "review" / f"catvton-reference-matrix-{stamp}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(report_path.relative_to(ROOT)), "directory": str(output_dir.relative_to(ROOT)), **report}


def catvton_dedicated_mask_matrix(body: dict) -> dict:
    return catvton_reference_matrix({**body, "maskMode": "dedicated", "seed": int(body.get("seed", 50001))})


def catvton_geometry_audit(body: dict) -> dict:
    requested = str(body.get("report") or "")
    candidates = sorted((ROOT / "workspace" / "review").glob("catvton-retry-matrix-*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    source_path = ROOT / requested if requested else (candidates[0] if candidates else None)
    if not source_path or not source_path.is_file():
        raise ValueError("Không tìm thấy báo cáo retry để audit")
    report = json.loads(source_path.read_text(encoding="utf-8"))
    reference = Image.open(active_reference_path("upper_body")).convert("RGB")
    rows = []
    for row in report.get("rows", []):
        sample_id = str(row["sampleId"])
        output_dir = ROOT / Path(row["candidates"][0]["output"]).parent
        mask = Image.open(output_dir / f"{Path(sample_id).stem}_mask.png").convert("L")
        audited = []
        for candidate in row.get("candidates", []):
            result = Image.open(ROOT / candidate["output"]).convert("RGB")
            color = candidate.get("colorMaterial") or color_material_consistency(reference, result, mask)
            geometry = catvton_geometry_consistency(result, mask)
            accepted = bool(color["accepted"] and geometry["accepted"])
            adjusted = float(candidate.get("selectionScore", 0)) * 0.72 + color["colorMaterialScore"] * 0.13 + geometry["geometryScore"] * 0.15
            audited.append({**candidate, "colorMaterial": color, "geometry": geometry, "combinedGateAccepted": accepted, "adjustedSelectionScore": adjusted})
        eligible = [item for item in audited if item["combinedGateAccepted"]]
        selected = max(eligible, key=lambda item: item["adjustedSelectionScore"]) if eligible else None
        rows.append({"sampleId": sample_id, "candidateCount": len(audited), "eligibleCount": len(eligible), "promotionEligible": selected is not None, "promoted": False, "selected": selected, "candidates": audited})
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    audited_report = {"schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "sourceReport": str(source_path.relative_to(ROOT)), "rows": rows, "promotionEligibleCount": sum(row["promotionEligible"] for row in rows), "promotedCount": 0, "requiresVisualReview": True}
    target = ROOT / "workspace" / "review" / f"catvton-geometry-audit-{stamp}.json"
    target.write_text(json.dumps(audited_report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **audited_report}


def qualify_product_reference(body: dict) -> dict:
    category = str(body.get("category") or "upper_body")
    if category not in ("upper_body", "lower_body", "overall"):
        raise ValueError("Loại trang phục không hợp lệ")
    profile_path = ROOT / "workspace" / "review" / "reference-profiles.json"
    profiles = json.loads(profile_path.read_text(encoding="utf-8")) if profile_path.is_file() else {"schemaVersion": 1, "profiles": {}}
    profile = profiles.get("profiles", {}).get(category, {})
    if not (profile.get("validation") or {}).get("accepted"):
        raise ValueError("Reference chưa qua cổng kiểm định sản phẩm")
    reference_path = ROOT / str(profile.get("reference") or "")
    if not reference_path.is_file():
        raise ValueError("Không tìm thấy tệp reference đã kiểm định")
    reference_sha256 = hashlib.sha256(reference_path.read_bytes()).hexdigest()
    validation_sha256 = str((profile.get("validation") or {}).get("metrics", {}).get("sha256") or "")
    if not validation_sha256 or reference_sha256 != validation_sha256:
        raise ValueError("Checksum reference không khớp kết quả kiểm định; hãy nhập lại ảnh sản phẩm")
    qualification_samples = ["characters/c001.png", "characters/c002.png", "characters/c003.png"]
    matrix = catvton_reference_matrix({
        # Qualification is intentionally immutable: callers cannot replace or
        # duplicate the three canonical smoke cases.
        "sampleIds": qualification_samples,
        "category": category, "maskMode": "dedicated", "seed": int(body.get("seed", 52001)),
        "steps": int(body.get("steps", 20)), "maxSide": int(body.get("maxSide", 512)),
    })
    reference = Image.open(reference_path).convert("RGB")
    evaluated = []
    for row in matrix.get("rows", []):
        output = Image.open(ROOT / row["output"]).convert("RGB")
        mask_path = ROOT / matrix["directory"] / f"{Path(row['sampleId']).stem}_mask.png"
        mask = Image.open(mask_path).convert("L")
        color = color_material_consistency(reference, output, mask)
        geometry = catvton_geometry_consistency(output, mask)
        passed = bool(color["accepted"] and geometry["accepted"] and row["seamScore"] >= 80 and row["anatomyScore"] >= 95 and row["referenceSimilarity"] >= 0.60)
        evaluated.append({"sampleId": row["sampleId"], "output": row["output"], "passed": passed, "colorMaterial": color, "geometry": geometry, "seamScore": row["seamScore"], "anatomyScore": row["anatomyScore"], "referenceSimilarity": row["referenceSimilarity"]})
    passed = len(evaluated) == 3 and all(item["passed"] for item in evaluated)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    report = {"schemaVersion": 2, "createdAt": datetime.now(timezone.utc).isoformat(), "category": category, "reference": str(reference_path.relative_to(ROOT)), "referenceSha256": reference_sha256, "validationSha256": validation_sha256, "qualificationSamples": qualification_samples, "matrixReport": matrix["report"], "passed": passed, "passedCount": sum(item["passed"] for item in evaluated), "requiredCount": 3, "items": evaluated, "requiresVisualReview": True}
    target = ROOT / "workspace" / "review" / f"reference-qualification-{category}-{stamp}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    profile.update({"status": "qualified" if passed else "failed-smoke", "specializedReferenceRequired": not passed, "qualificationReport": str(target.relative_to(ROOT)), "qualifiedAt": datetime.now(timezone.utc).isoformat() if passed else None})
    profiles.setdefault("profiles", {})[category] = profile
    profiles["updatedAt"] = datetime.now(timezone.utc).isoformat()
    profile_path.write_text(json.dumps(profiles, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def catvton_color_audit(body: dict) -> dict:
    requested = str(body.get("report") or "")
    candidates = sorted((ROOT / "workspace" / "review").glob("catvton-retry-matrix-*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    source_path = ROOT / requested if requested else (candidates[0] if candidates else None)
    if not source_path or not source_path.is_file():
        raise ValueError("Không tìm thấy báo cáo retry để audit")
    report = json.loads(source_path.read_text(encoding="utf-8"))
    reference_path = active_reference_path("upper_body")
    reference = Image.open(reference_path).convert("RGB")
    rows = []
    for row in report.get("rows", []):
        sample_id = str(row["sampleId"])
        output_dir = ROOT / Path(row["candidates"][0]["output"]).parent
        mask_path = output_dir / f"{Path(sample_id).stem}_mask.png"
        mask = Image.open(mask_path).convert("L")
        audited = []
        for candidate in row.get("candidates", []):
            result = Image.open(ROOT / candidate["output"]).convert("RGB")
            consistency = color_material_consistency(reference, result, mask)
            adjusted = float(candidate.get("selectionScore", 0)) * 0.82 + consistency["colorMaterialScore"] * 0.18
            audited.append({**candidate, "colorMaterial": consistency, "adjustedSelectionScore": adjusted})
        eligible = [item for item in audited if item["colorMaterial"]["accepted"]]
        selected = max(eligible, key=lambda item: item["adjustedSelectionScore"]) if eligible else None
        rows.append({"sampleId": sample_id, "candidateCount": len(audited), "eligibleCount": len(eligible), "promotionEligible": selected is not None, "promoted": False, "selected": selected, "candidates": audited})
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    audited_report = {"schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "sourceReport": str(source_path.relative_to(ROOT)), "reference": str(reference_path.relative_to(ROOT)), "rows": rows, "promotionEligibleCount": sum(row["promotionEligible"] for row in rows), "promotedCount": 0, "requiresVisualReview": True}
    target = ROOT / "workspace" / "review" / f"catvton-color-audit-{stamp}.json"
    target.write_text(json.dumps(audited_report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **audited_report}


def catvton_retry_matrix(body: dict) -> dict:
    sample_ids = [str(value) for value in (body.get("sampleIds") or ["characters/c002.png", "characters/c003.png"])[:3]]
    seeds_per_sample = max(1, min(3, int(body.get("seedsPerSample", 3))))
    step_values = [max(10, min(40, int(value))) for value in (body.get("stepValues") or [10, 20])[:3]]
    base_seed = int(body.get("seed", 51001))
    max_side = int(body.get("maxSide", 512))
    reference_path = active_reference_path("upper_body")
    if not reference_path.is_file():
        normalize_reference({"garmentSampleId": "characters/c003.png", "category": "upper_body"})
    reference = Image.open(reference_path).convert("RGB")
    garment_data = encode_image(reference)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output_dir = OUTPUTS / f"catvton_retry_{stamp}"
    output_dir.mkdir(parents=True, exist_ok=False)
    rows, skipped = [], []
    for sample_index, sample_id in enumerate(sample_ids):
        source = Image.open(safe_sample(sample_id)).convert("RGB")
        people = detect_people(source, True)
        if len(people) != 1:
            skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
            continue
        person = people[0]
        mask, _, mask_metrics = catvton_dedicated_mask(source, "upper_body", person["box"], person.get("keypoints"))
        if not mask_metrics.get("accepted"):
            skipped.append({"sampleId": sample_id, "reason": "dedicated-mask-gate", "metrics": mask_metrics})
            continue
        candidates = []
        for steps in step_values:
            for seed_index in range(seeds_per_sample):
                seed = base_seed + sample_index * 100 + seed_index
                result = tryon({
                    "sampleId": sample_id, "garmentImage": garment_data, "category": "upper_body",
                    "editableMask": encode_image(mask), "autoMask": False, "usePose": True, "personIndex": 0,
                    "cropPerson": False, "preprocessGarment": False, "count": 1, "steps": steps,
                    "guidance": float(body.get("guidance", 2.5)), "seed": seed, "maxSide": max_side,
                    "expand": 0, "blur": 6, "repairSeams": False, "generativeRefine": False,
                    "maxRetries": 0, "minimumQuality": 0, "minimumSimilarity": 0,
                    "minimumSeam": 0, "minimumAnatomy": 0,
                })
                image = Image.open(ROOT / result["selected"]).convert("RGB")
                metrics = score_tryon_result(source, image, mask)
                metrics["referenceSimilarity"] = reference_similarity(reference, image, mask)
                core = catvton_core_degradation(image, mask)
                consistency = color_material_consistency(reference, image, mask)
                geometry = catvton_geometry_consistency(image, mask)
                selection_score = (
                    metrics["qualityScore"] * 0.13 + metrics["seamScore"] * 0.15 +
                    metrics["anatomyScore"] * 0.14 + metrics["referenceSimilarity"] * 100 * 0.22 +
                    metrics["textureContinuity"] * 0.08 + core["coreTextureScore"] * 0.10 +
                    consistency["colorMaterialScore"] * 0.12 + geometry["geometryScore"] * 0.06
                )
                filename = f"{Path(sample_id).stem}_s{seed}_n{steps}.png"
                image.save(output_dir / filename)
                candidates.append({"seed": seed, "steps": steps, "output": str((output_dir / filename).relative_to(ROOT)), "selectionScore": float(selection_score), "performance": result["performance"], **metrics, "coreDegradation": core, "colorMaterial": consistency, "geometry": geometry})
        eligible = [item for item in candidates if item["colorMaterial"]["accepted"] and item["geometry"]["accepted"]]
        selected = max(eligible or candidates, key=lambda item: item["selectionScore"])
        shutil.copyfile(ROOT / selected["output"], output_dir / f"{Path(sample_id).stem}_selected.png")
        mask.save(output_dir / f"{Path(sample_id).stem}_mask.png")
        rows.append({"sampleId": sample_id, "mask": mask_metrics, "candidateCount": len(candidates), "eligibleCount": len(eligible), "promotionAllowed": bool(eligible), "selected": selected, "candidates": candidates})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "sampleCount": len(rows),
        "skippedCount": len(skipped), "skipped": skipped, "seedsPerSample": seeds_per_sample,
        "stepValues": step_values, "rows": rows,
        "selectionWeights": {"quality": 0.13, "seam": 0.15, "anatomy": 0.14, "referenceSimilarity": 0.22, "textureContinuity": 0.08, "coreTexture": 0.10, "colorMaterial": 0.12, "geometry": 0.06},
        "requiresVisualReview": True,
    }
    report_path = ROOT / "workspace" / "review" / f"catvton-retry-matrix-{stamp}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(report_path.relative_to(ROOT)), "directory": str(output_dir.relative_to(ROOT)), **report}


def regression_audit(body: dict) -> dict:
    category = str(body.get("category", "upper_body"))
    weak_threshold = float(body.get("weakThreshold", 0.65 if body.get("usePose") else 0.75))
    sample_ids = sorted(str(path.relative_to(SAMPLES)).replace("\\", "/") for path in SAMPLES.rglob("*") if path.suffix.lower() in (".png", ".jpg", ".jpeg"))
    items = []
    for sample_id in sample_ids:
        source = Image.open(safe_sample(sample_id)).convert("RGB")
        people = detect_people(source, bool(body.get("usePose")))
        person = people[0]
        mask, score = automatic_garment_mask(source, category, person["box"], person.get("keypoints"))
        coverage = float((np.asarray(mask) > 0).mean())
        landscape = source.width > source.height
        reasons = []
        if landscape:
            reasons.append("landscape")
        if len(people) > 1:
            reasons.append("multiple_people")
        if person["source"] == "center-fallback":
            reasons.append("detector_fallback")
        if score < weak_threshold or coverage < 0.02:
            reasons.append("weak_mask")
        items.append({
            "sampleId": sample_id, "width": source.width, "height": source.height,
            "orientation": "landscape" if landscape else "portrait", "people": people,
            "maskScore": score, "maskCoverage": coverage, "needsManualReview": bool(reasons), "reasons": reasons,
        })
    stamp = datetime.now(timezone.utc).strftime("audit_%Y%m%dT%H%M%S%fZ")
    report_dir = OUTPUTS / stamp
    report_dir.mkdir(parents=True, exist_ok=False)
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "category": category,
        "detector": "yolo11n-pose" if body.get("usePose") else "haar-hog", "weakThreshold": weak_threshold,
        "total": len(items), "passed": sum(not item["needsManualReview"] for item in items),
        "manualReview": sum(item["needsManualReview"] for item in items), "items": items,
    }
    report_path = report_dir / "regression-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(report_path.relative_to(ROOT)), **report}


def benchmark(body: dict) -> dict:
    if not body.get("garmentImage"):
        raise ValueError("Benchmark cần ảnh trang phục tham chiếu")
    sample_ids = sorted(str(path.relative_to(SAMPLES)).replace("\\", "/") for path in SAMPLES.rglob("*") if path.suffix.lower() in (".png", ".jpg", ".jpeg"))
    active_file = ROOT / "workspace" / "review" / "active-score-weights.json"
    proposed_file = ROOT / "workspace" / "review" / "score-weights.json"
    weights_file = active_file if active_file.exists() else proposed_file
    calibrated_weights = {}
    if weights_file.exists():
        try:
            calibrated_weights = json.loads(weights_file.read_text(encoding="utf-8")).get("weights", {})
        except Exception:
            calibrated_weights = {}
    fixed = {
        **body, "benchmark": True, "sampleIds": sample_ids, "count": 2, "steps": 35,
        "guidance": 2.5, "maxSide": 960, "twoStage": True, "previewSteps": 10,
        "maxRetries": 1, "repairSeams": True, "generativeRefine": True,
        "usePose": True, "cropPerson": True, "onlyConfident": False,
        "onlyQualityPassed": False, "minimumQuality": 75, "minimumSimilarity": 0.55,
        "minimumSeam": 65, "minimumAnatomy": 90,
        "scoreWeights": calibrated_weights,
    }
    result = batch_tryon(fixed)
    result["benchmarkConfig"] = {key: fixed[key] for key in ("count", "steps", "guidance", "maxSide", "twoStage", "previewSteps", "maxRetries")}
    report_path = ROOT / result["report"]
    if report_path.exists():
        saved_report = json.loads(report_path.read_text(encoding="utf-8"))
        saved_report.update(benchmark=True, benchmarkConfig=result["benchmarkConfig"], benchmarkProvenance=body.get("benchmarkProvenance", {}))
        report_path.write_text(json.dumps(saved_report, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def lora_ab_test(body: dict) -> dict:
    if not model_state.active_loras:
        raise ValueError("Hãy kích hoạt ít nhất một LoRA trước khi chạy A/B")
    saved = [{"id": item["id"], "weight": item["weight"]} for item in model_state.active_loras]
    configure_loras({"adapters": []})
    baseline = inpaint(body)
    configure_loras({"adapters": saved})
    candidate = inpaint(body)
    seed = int(body.get("seed", 42))
    baseline_file = str((ROOT / baseline["directory"] / f"result_seed_{seed}.png").relative_to(ROOT))
    candidate_file = str((ROOT / candidate["directory"] / f"result_seed_{seed}.png").relative_to(ROOT))
    baseline_mae = float(baseline["results"][0]["outsideMaskMAE"])
    candidate_mae = float(candidate["results"][0]["outsideMaskMAE"])
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "sampleId": body.get("sampleId"),
        "seed": seed, "baseline": {"output": baseline_file, "outsideMaskMAE": baseline_mae},
        "candidate": {"output": candidate_file, "outsideMaskMAE": candidate_mae, "loras": candidate["loras"]},
        "sameSeed": True, "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"lora-ab-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def lora_ab_matrix(body: dict) -> dict:
    """Run one baseline and several LoRA weights per sample with automatic body masks."""
    requested_samples = body.get("sampleIds") or []
    if requested_samples:
        sample_ids = [str(value) for value in requested_samples[:5]]
    else:
        preferred = sorted(
            str(path.relative_to(SAMPLES)).replace("\\", "/")
            for path in SAMPLES.rglob("*")
            if path.suffix.lower() in (".png", ".jpg", ".jpeg") and path.parent.name in ("characters", "portrait")
        )
        sample_ids = preferred[:5]
    if not sample_ids:
        raise ValueError("Không có ảnh mẫu để chạy ma trận LoRA")
    weights = [max(0.0, min(1.5, float(value))) for value in (body.get("weights") or [0.4, 0.6, 0.8])]
    weights = list(dict.fromkeys(weights))[:3]
    adapter_id = str(body.get("adapterId") or (model_state.active_loras[0]["id"] if model_state.active_loras else ""))
    if not adapter_id:
        raise ValueError("Hãy chọn một LoRA trước khi chạy ma trận")
    saved = [{"id": item["id"], "weight": item["weight"]} for item in model_state.active_loras]
    category = str(body.get("category", "upper_body"))
    base_seed = int(body.get("seed", 42001))
    rows = []
    skipped = []
    try:
        for index, sample_id in enumerate(sample_ids):
            source = Image.open(safe_sample(sample_id)).convert("RGB")
            people = detect_people(source, True)
            person = people[0]
            mask, mask_score = automatic_garment_mask(source, category, person["box"], person.get("keypoints"))
            protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
            mask_array = np.asarray(mask, dtype=np.uint8).copy()
            mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
            mask = Image.fromarray(mask_array, mode="L")
            policy = mask_strength_policy(mask, person["box"], category, person.get("keypoints"))
            if not policy["accepted"]:
                skipped.append({"sampleId": sample_id, "reason": "mask-coverage-below-minimum", "maskScore": mask_score, **policy})
                continue
            request = {
                "sampleId": sample_id, "editableMask": encode_image(mask),
                "protectedDetailMask": encode_image(protected),
                "prompt": str(body.get("prompt") or prompt_text('lora_ab_matrix.photorealistic_tailored_navy_cotton_jacket_realistic_woven')),
                "negativePrompt": str(body.get("negativePrompt") or prompt_text('lora_ab_matrix.changed_face_changed_identity_deformed_anatomy_exposed')),
                "seed": base_seed + index, "count": 1,
                "steps": int(body.get("steps", 4)), "strength": float(body.get("strength", policy["recommendedStrength"])),
                "guidance": float(body.get("guidance", 4.5)), "expand": int(body.get("expand", 4)),
                "blur": int(body.get("blur", 6)), "cropPadding": int(body.get("cropPadding", 64)),
                "maxSide": int(body.get("maxSide", 512)),
            }
            configure_loras({"adapters": []})
            baseline = inpaint(request)
            baseline_file = str((ROOT / baseline["directory"] / f"result_seed_{request['seed']}.png").relative_to(ROOT))
            candidates = []
            for weight in weights:
                configure_loras({"adapters": [{"id": adapter_id, "weight": weight}]})
                candidate = inpaint(request)
                output = str((ROOT / candidate["directory"] / f"result_seed_{request['seed']}.png").relative_to(ROOT))
                candidates.append({"weight": weight, "output": output, "outsideMaskMAE": candidate["results"][0]["outsideMaskMAE"], "edgeBlend": candidate["results"][0]["edgeBlend"]})
            rows.append({
                "sampleId": sample_id, "seed": request["seed"], "maskScore": mask_score,
                "maskCoverage": policy["coverage"], "recommendedStrength": policy["recommendedStrength"],
                "baseline": {"output": baseline_file, "outsideMaskMAE": baseline["results"][0]["outsideMaskMAE"]},
                "candidates": candidates,
            })
    finally:
        configure_loras({"adapters": saved})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "adapterId": adapter_id, "category": category, "weights": weights,
        "sampleCount": len(rows), "skippedCount": len(skipped), "skipped": skipped, "sameSeedWithinRow": True, "rows": rows,
        "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"lora-matrix-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def lora_strength_matrix(body: dict) -> dict:
    """Tune inpaint strength on three single-person samples before a full LoRA matrix."""
    sample_ids = [str(value) for value in (body.get("sampleIds") or [
        "characters/c001.png", "characters/c002.png", "characters/c003.png"
    ])[:3]]
    strengths = [max(0.2, min(1.0, float(value))) for value in (body.get("strengths") or [0.5, 0.6, 0.7])]
    strengths = list(dict.fromkeys(strengths))[:3]
    adapter_id = str(body.get("adapterId") or (model_state.active_loras[0]["id"] if model_state.active_loras else ""))
    adapter_weight = max(0.0, min(1.5, float(body.get("adapterWeight", 0.6))))
    if not adapter_id:
        raise ValueError("Hãy chọn một LoRA trước khi hiệu chỉnh strength")
    saved = [{"id": item["id"], "weight": item["weight"]} for item in model_state.active_loras]
    rows, skipped = [], []
    try:
        configure_loras({"adapters": [{"id": adapter_id, "weight": adapter_weight}]})
        for index, sample_id in enumerate(sample_ids):
            source = Image.open(safe_sample(sample_id)).convert("RGB")
            people = detect_people(source, True)
            if len(people) != 1:
                skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
                continue
            person = people[0]
            mask, mask_score = automatic_garment_mask(source, "upper_body", person["box"], person.get("keypoints"))
            protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
            mask_array = np.asarray(mask, dtype=np.uint8).copy()
            mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
            mask = Image.fromarray(mask_array, mode="L")
            policy = mask_strength_policy(mask, person["box"], "upper_body", person.get("keypoints"))
            if not policy["accepted"]:
                skipped.append({"sampleId": sample_id, "reason": "mask-coverage-below-minimum", "maskScore": mask_score, **policy})
                continue
            seed = int(body.get("seed", 43001)) + index
            candidates = []
            for strength in strengths:
                request = {
                    "sampleId": sample_id, "editableMask": encode_image(mask), "protectedDetailMask": encode_image(protected),
                    "prompt": str(body.get("prompt") or prompt_text('lora_strength_matrix.photorealistic_tailored_navy_cotton_jacket_coherent_single')),
                    "negativePrompt": str(body.get("negativePrompt") or prompt_text('lora_strength_matrix.duplicate_clothing_double_jacket_split_torso_changed')),
                    "seed": seed, "count": 1, "steps": int(body.get("steps", 4)), "strength": strength,
                    "guidance": float(body.get("guidance", 4.5)), "expand": 0, "blur": int(body.get("blur", 8)),
                    "cropPadding": int(body.get("cropPadding", 64)), "maxSide": int(body.get("maxSide", 512)),
                }
                result = inpaint(request)
                output = str((ROOT / result["directory"] / f"result_seed_{seed}.png").relative_to(ROOT))
                candidates.append({"strength": strength, "output": output, "outsideMaskMAE": result["results"][0]["outsideMaskMAE"], "edgeBlend": result["results"][0]["edgeBlend"]})
            rows.append({"sampleId": sample_id, "seed": seed, "maskScore": mask_score, **policy, "candidates": candidates})
    finally:
        configure_loras({"adapters": saved})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(), "adapterId": adapter_id,
        "adapterWeight": adapter_weight, "strengths": strengths, "sampleCount": len(rows),
        "skippedCount": len(skipped), "skipped": skipped, "rows": rows, "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"lora-strength-matrix-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def texture_recovery_matrix(body: dict) -> dict:
    """Generate one deterministic result per sample and compare core recovery against its exact pre-filter image."""
    sample_ids = [str(value) for value in (body.get("sampleIds") or [
        "characters/c001.png", "characters/c002.png", "characters/c003.png"
    ])[:3]]
    saved = [{"id": item["id"], "weight": item["weight"]} for item in model_state.active_loras]
    adapter_id = str(body.get("adapterId") or (model_state.active_loras[0]["id"] if model_state.active_loras else ""))
    adapter_weight = max(0.0, min(1.5, float(body.get("adapterWeight", 0.6))))
    if adapter_id:
        configure_loras({"adapters": [{"id": adapter_id, "weight": adapter_weight}]})
    rows, skipped = [], []
    try:
        for index, sample_id in enumerate(sample_ids):
            source = Image.open(safe_sample(sample_id)).convert("RGB")
            people = detect_people(source, True)
            if len(people) != 1:
                skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
                continue
            person = people[0]
            mask, mask_score = automatic_garment_mask(source, "upper_body", person["box"], person.get("keypoints"))
            protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
            mask_array = np.asarray(mask, dtype=np.uint8).copy()
            mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
            mask = Image.fromarray(mask_array, mode="L")
            policy = mask_strength_policy(mask, person["box"], "upper_body", person.get("keypoints"))
            if not policy["accepted"]:
                skipped.append({"sampleId": sample_id, "reason": "mask-coverage-below-minimum", "maskScore": mask_score, **policy})
                continue
            seed = int(body.get("seed", 44001)) + index
            request = {
                "sampleId": sample_id, "editableMask": encode_image(mask), "protectedDetailMask": encode_image(protected),
                "prompt": str(body.get("prompt") or prompt_text('texture_recovery_matrix.photorealistic_tailored_navy_cotton_jacket_coherent_single')),
                "negativePrompt": str(body.get("negativePrompt") or prompt_text('lora_strength_matrix.duplicate_clothing_double_jacket_split_torso_changed')),
                "seed": seed, "count": 1, "steps": int(body.get("steps", 4)),
                "strength": float(body.get("strength", policy["recommendedStrength"])),
                "guidance": float(body.get("guidance", 4.5)), "expand": 0, "blur": int(body.get("blur", 8)),
                "cropPadding": int(body.get("cropPadding", 64)), "maxSide": int(body.get("maxSide", 512)),
                "textureRecovery": True, "textureRecoveryAmount": float(body.get("textureRecoveryAmount", 0.65)),
            }
            result = inpaint(request)
            item = result["results"][0]
            rows.append({
                "sampleId": sample_id, "seed": seed, "maskScore": mask_score, **policy,
                "baseline": item["textureBaseline"],
                "candidate": str((ROOT / result["directory"] / f"result_seed_{seed}.png").relative_to(ROOT)),
                "coreMask": str((ROOT / result["directory"] / f"texture_core_seed_{seed}.png").relative_to(ROOT)),
                "outsideMaskMAE": item["outsideMaskMAE"], "textureRecovery": item["textureRecovery"],
            })
    finally:
        configure_loras({"adapters": saved})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "adapterId": adapter_id or None, "adapterWeight": adapter_weight if adapter_id else None,
        "sampleCount": len(rows), "skippedCount": len(skipped), "skipped": skipped, "rows": rows,
        "sameGenerationWithinRow": True, "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"texture-recovery-matrix-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def structural_refine_matrix(body: dict) -> dict:
    """A/B detected core-structure repair on three deterministic upper-body samples."""
    sample_ids = [str(value) for value in (body.get("sampleIds") or [
        "characters/c001.png", "characters/c002.png", "characters/c003.png"
    ])[:3]]
    saved = [{"id": item["id"], "weight": item["weight"]} for item in model_state.active_loras]
    adapter_id = str(body.get("adapterId") or (model_state.active_loras[0]["id"] if model_state.active_loras else ""))
    adapter_weight = max(0.0, min(1.5, float(body.get("adapterWeight", 0.6))))
    if adapter_id:
        configure_loras({"adapters": [{"id": adapter_id, "weight": adapter_weight}]})
    rows, skipped = [], []
    try:
        for index, sample_id in enumerate(sample_ids):
            source = Image.open(safe_sample(sample_id)).convert("RGB")
            people = detect_people(source, True)
            if len(people) != 1:
                skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
                continue
            person = people[0]
            mask, mask_score = automatic_garment_mask(source, "upper_body", person["box"], person.get("keypoints"))
            protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
            mask_array = np.asarray(mask, dtype=np.uint8).copy()
            mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
            mask = Image.fromarray(mask_array, mode="L")
            policy = mask_strength_policy(mask, person["box"], "upper_body", person.get("keypoints"))
            if not policy["accepted"]:
                skipped.append({"sampleId": sample_id, "reason": "mask-coverage-below-minimum", "maskScore": mask_score, **policy})
                continue
            seed = int(body.get("seed", 45001)) + index
            request = {
                "sampleId": sample_id, "editableMask": encode_image(mask), "protectedDetailMask": encode_image(protected),
                "prompt": str(body.get("prompt") or prompt_text('texture_recovery_matrix.photorealistic_tailored_navy_cotton_jacket_coherent_single')),
                "negativePrompt": str(body.get("negativePrompt") or prompt_text('structural_refine_matrix.duplicate_clothing_double_jacket_split_torso_changed')),
                "seed": seed, "count": 1, "steps": int(body.get("steps", 4)),
                "strength": float(body.get("strength", policy["recommendedStrength"])),
                "guidance": float(body.get("guidance", 4.5)), "expand": 0, "blur": int(body.get("blur", 8)),
                "cropPadding": int(body.get("cropPadding", 64)), "maxSide": int(body.get("maxSide", 512)),
                "textureRecovery": True, "textureRecoveryAmount": float(body.get("textureRecoveryAmount", 0.65)),
                "structuralRefine": True, "structuralSteps": int(body.get("structuralSteps", 14)),
            }
            result = inpaint(request)
            item = result["results"][0]
            rows.append({
                "sampleId": sample_id, "seed": seed, "maskScore": mask_score, **policy,
                "baseline": item["structuralBaseline"],
                "candidate": str((ROOT / result["directory"] / f"result_seed_{seed}.png").relative_to(ROOT)),
                "artifactMask": str((ROOT / result["directory"] / f"structural_artifacts_seed_{seed}.png").relative_to(ROOT)),
                "outsideMaskMAE": item["outsideMaskMAE"], "structuralRefine": item["structuralRefine"],
            })
    finally:
        configure_loras({"adapters": saved})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "adapterId": adapter_id or None, "adapterWeight": adapter_weight if adapter_id else None,
        "sampleCount": len(rows), "skippedCount": len(skipped), "skipped": skipped, "rows": rows,
        "sameInitialGenerationWithinRow": True, "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"structural-refine-matrix-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def effective_step_matrix(body: dict) -> dict:
    """Compare minimum effective denoising targets while keeping seed and strength fixed."""
    sample_ids = [str(value) for value in (body.get("sampleIds") or [
        "characters/c001.png", "characters/c002.png", "characters/c003.png"
    ])[:3]]
    targets = [max(4, min(24, int(value))) for value in (body.get("effectiveSteps") or [12, 16, 20])]
    targets = list(dict.fromkeys(targets))[:3]
    strength = max(0.2, min(1.0, float(body.get("strength", 0.5))))
    saved = [{"id": item["id"], "weight": item["weight"]} for item in model_state.active_loras]
    adapter_id = str(body.get("adapterId") or (model_state.active_loras[0]["id"] if model_state.active_loras else ""))
    adapter_weight = max(0.0, min(1.5, float(body.get("adapterWeight", 0.6))))
    if adapter_id:
        configure_loras({"adapters": [{"id": adapter_id, "weight": adapter_weight}]})
    rows, skipped = [], []
    try:
        for index, sample_id in enumerate(sample_ids):
            source = Image.open(safe_sample(sample_id)).convert("RGB")
            people = detect_people(source, True)
            if len(people) != 1:
                skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
                continue
            person = people[0]
            mask, mask_score = automatic_garment_mask(source, "upper_body", person["box"], person.get("keypoints"))
            protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
            mask_array = np.asarray(mask, dtype=np.uint8).copy()
            mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
            mask = Image.fromarray(mask_array, mode="L")
            policy = mask_strength_policy(mask, person["box"], "upper_body", person.get("keypoints"))
            if not policy["accepted"]:
                skipped.append({"sampleId": sample_id, "reason": "mask-coverage-below-minimum", "maskScore": mask_score, **policy})
                continue
            seed = int(body.get("seed", 46001)) + index
            candidates = []
            for target_effective in targets:
                requested_total = int(np.ceil(target_effective / strength))
                request = {
                    "sampleId": sample_id, "editableMask": encode_image(mask), "protectedDetailMask": encode_image(protected),
                    "prompt": str(body.get("prompt") or prompt_text('texture_recovery_matrix.photorealistic_tailored_navy_cotton_jacket_coherent_single')),
                    "negativePrompt": str(body.get("negativePrompt") or prompt_text('lora_strength_matrix.duplicate_clothing_double_jacket_split_torso_changed')),
                    "seed": seed, "count": 1, "steps": requested_total, "minimumEffectiveSteps": target_effective,
                    "strength": strength, "guidance": float(body.get("guidance", 4.5)), "expand": 0,
                    "blur": int(body.get("blur", 8)), "cropPadding": int(body.get("cropPadding", 64)),
                    "maxSide": int(body.get("maxSide", 512)), "textureRecovery": True,
                    "textureRecoveryAmount": float(body.get("textureRecoveryAmount", 0.65)), "structuralRefine": False,
                }
                result = inpaint(request)
                output = str((ROOT / result["directory"] / f"result_seed_{seed}.png").relative_to(ROOT))
                candidates.append({"targetEffectiveSteps": target_effective, "output": output, "stepPolicy": result["stepPolicy"], "outsideMaskMAE": result["results"][0]["outsideMaskMAE"]})
            rows.append({"sampleId": sample_id, "seed": seed, "maskScore": mask_score, **policy, "candidates": candidates})
    finally:
        configure_loras({"adapters": saved})
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "adapterId": adapter_id or None, "adapterWeight": adapter_weight if adapter_id else None,
        "strength": strength, "effectiveStepTargets": targets, "sampleCount": len(rows),
        "skippedCount": len(skipped), "skipped": skipped, "rows": rows,
        "sameSeedWithinRow": True, "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"effective-step-matrix-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), **report}


def hybrid_tryon_compare(body: dict) -> dict:
    """Compare CatVTON, SD3.5 text inpaint, and CatVTON followed by local SD3.5 refinement."""
    sample_ids = [str(value) for value in (body.get("sampleIds") or ["characters/c001.png"])[:3]]
    garment_sample_id = str(body.get("garmentSampleId") or "characters/c003.png")
    garment_image = Image.open(safe_sample(garment_sample_id)).convert("RGB")
    garment_data = encode_image(garment_image)
    base_seed = int(body.get("seed", 48001))
    rows, skipped = [], []
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    compare_dir = OUTPUTS / f"hybrid_compare_{stamp}"
    compare_dir.mkdir(parents=True, exist_ok=False)
    processed_garment, _, _, _, _ = preprocess_garment_image(garment_image, "upper_body")
    for index, sample_id in enumerate(sample_ids):
        source = Image.open(safe_sample(sample_id)).convert("RGB")
        people = detect_people(source, True)
        if len(people) != 1:
            skipped.append({"sampleId": sample_id, "reason": "requires-single-person", "people": len(people)})
            continue
        person = people[0]
        mask, mask_score = automatic_garment_mask(source, "upper_body", person["box"], person.get("keypoints"))
        protected = automatic_protected_detail_mask(source, person["box"], person.get("keypoints"))
        mask_array = np.asarray(mask, dtype=np.uint8).copy()
        mask_array[np.asarray(protected, dtype=np.uint8) > 16] = 0
        mask = Image.fromarray(mask_array, mode="L")
        policy = mask_strength_policy(mask, person["box"], "upper_body", person.get("keypoints"))
        if not policy["accepted"]:
            skipped.append({"sampleId": sample_id, "reason": "mask-quality-gate", "maskScore": mask_score, **policy})
            continue
        seed = base_seed + index
        cat = tryon({
            "sampleId": sample_id, "garmentImage": garment_data, "category": "upper_body",
            "autoMask": True, "usePose": True, "personIndex": 0, "cropPerson": False,
            "preprocessGarment": True, "count": 1, "steps": int(body.get("catvtonSteps", 20)),
            "guidance": float(body.get("catvtonGuidance", 2.5)), "seed": seed,
            "maxSide": int(body.get("maxSide", 512)), "expand": 0, "blur": 6,
            "repairSeams": False, "generativeRefine": False, "maxRetries": 0,
            "minimumQuality": 0, "minimumSimilarity": 0, "minimumSeam": 0, "minimumAnatomy": 0,
        })
        cat_path = ROOT / cat["selected"]
        cat_image = Image.open(cat_path).convert("RGB")
        cat_metrics = score_tryon_result(source, cat_image, mask)
        cat_metrics["referenceSimilarity"] = reference_similarity(processed_garment, cat_image, mask)

        sd = inpaint({
            "sampleId": sample_id, "editableMask": encode_image(mask), "protectedDetailMask": encode_image(protected),
            "prompt": str(body.get("prompt") or prompt_text('hybrid_tryon_compare.photorealistic_tailored_garment_matching_the_reference_coherent')),
            "negativePrompt": prompt_text('hybrid_tryon_compare.duplicate_clothing_split_torso_changed_face_deformed'),
            "seed": seed, "count": 1, "steps": int(body.get("sdSteps", 20)), "minimumEffectiveSteps": 12,
            "strength": float(body.get("sdStrength", 0.6)), "guidance": float(body.get("sdGuidance", 4.5)),
            "expand": 0, "blur": 8, "cropPadding": 64, "maxSide": int(body.get("maxSide", 512)),
            "textureRecovery": True, "structuralRefine": False,
        })
        sd_path = ROOT / sd["directory"] / f"result_seed_{seed}.png"
        sd_image = Image.open(sd_path).convert("RGB")
        sd_metrics = score_tryon_result(source, sd_image, mask)
        sd_metrics["referenceSimilarity"] = reference_similarity(processed_garment, sd_image, mask)

        hybrid_image, hybrid_mask, refine_pixels = generative_seam_refine(source, cat_image, mask, seed + 900000, int(body.get("hybridSteps", 12)))
        hybrid_image, _, edge_metrics = adaptive_local_edge_blend(source, hybrid_image, mask, 12)
        hybrid_image, _, texture_metrics = texture_preserving_core_recovery(hybrid_image, mask, 12, 0.65)
        hybrid_metrics = score_tryon_result(source, hybrid_image, mask)
        hybrid_metrics["referenceSimilarity"] = reference_similarity(processed_garment, hybrid_image, mask)

        prefix = Path(sample_id).stem
        cat_target = compare_dir / f"{prefix}_catvton.png"
        sd_target = compare_dir / f"{prefix}_sd35.png"
        hybrid_target = compare_dir / f"{prefix}_hybrid.png"
        shutil.copyfile(cat_path, cat_target)
        shutil.copyfile(sd_path, sd_target)
        hybrid_image.save(hybrid_target)
        hybrid_mask.save(compare_dir / f"{prefix}_hybrid_refine_mask.png")
        mask.save(compare_dir / f"{prefix}_garment_mask.png")
        rows.append({
            "sampleId": sample_id, "seed": seed, "maskScore": mask_score, **policy,
            "catvton": {"output": str(cat_target.relative_to(ROOT)), "performance": cat["performance"], **cat_metrics},
            "sd35": {"output": str(sd_target.relative_to(ROOT)), "stepPolicy": sd["stepPolicy"], **sd_metrics},
            "hybrid": {"output": str(hybrid_target.relative_to(ROOT)), "refinePixels": refine_pixels, "edgeBlend": edge_metrics, "textureRecovery": texture_metrics, **hybrid_metrics},
        })
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "garmentSampleId": garment_sample_id, "sampleCount": len(rows), "skippedCount": len(skipped),
        "skipped": skipped, "rows": rows, "sameSeedWithinRow": True, "requiresVisualReview": True,
    }
    target = ROOT / "workspace" / "review" / f"hybrid-tryon-compare-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "report": str(target.relative_to(ROOT)), "directory": str(compare_dir.relative_to(ROOT)), **report}
