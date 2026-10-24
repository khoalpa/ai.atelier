from services.ai.runtime.tracing import trace_generation
"""AI Atelier: tasks.tryon."""
from PIL import Image, ImageFilter, ImageOps
from datetime import datetime, timezone
from pathlib import Path
from services.ai.runtime import metadata
from tryon_geometry import fit_geometry, fit_image, restore_image, inward_blend, target_attributes, target_coverage
from tryon_quality import pose_consistency, gate_reasons, candidate_key, repair_is_better, quality_gate
import json
import numpy as np
import shutil
import time
import torch
from services.ai.imaging.blending import exclude_protected_pixels, generative_seam_refine, reconstruction_edit_mask, repair_local_seams, restore_protected_pixels
from services.ai.imaging.references import preprocess_garment_image
from services.ai.imaging.scoring import catvton_geometry_consistency, color_material_consistency, score_tryon_result
from services.ai.imaging.segmentation import arm_reconstruction_masks, automatic_garment_mask, automatic_protected_detail_mask, decode_image, decode_mask, detect_people, detect_people_pose, encode_image, reference_skin_mask, safe_sample, sleeveless_reference
from services.ai.models.pipelines import load_tryon_pipe, reference_similarity, release_tryon
from services.ai.runtime.configuration import DENSEPOSE_SCRIPT, JOBS_DIR, OUTPUTS, POSE_MODEL, ROOT, device
from services.ai.runtime.jobs import ensure_job_active, update_job
from services.ai.runtime.tracing import prompt_history, traced_pipeline_call


def reconstruct_bare_arms(source, result, person, editable, protected, seed, candidate_path=None):
    mask, preserve = arm_reconstruction_masks(source, person, editable, protected, result)
    pixels = int((np.asarray(mask) > 0).sum())
    if pixels < 128:
        return result, mask, {"applied": False, "pixels": pixels, "reason": "insufficient-arm-region-or-pose"}
    existing_skin = float((reference_skin_mask(source,result,person)>0)[np.asarray(mask)>0].mean())
    if existing_skin >= 0.80:
        return result, mask, {"applied": False, "attempted": False, "pixels": pixels, "skinCoverageBefore": existing_skin, "reason": "arms-already-bare"}
    return result, mask, {"applied": False, "attempted": False, "pixels": pixels, "reason": "arm-repair-model-removed"}


@trace_generation
def tryon(body: dict) -> dict:
    model_id = str(body.get("modelId") or "catvton")
    if model_id not in ("catvton", "idm-vton"):
        raise ValueError(f"Model thay trang phục không được hỗ trợ: {model_id}")
    started_at = time.perf_counter()
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()
    job_id = str(body.get("jobId", ""))[:80]
    update_job(job_id, status="running", stage="preparing")
    ensure_job_active(job_id)
    original_source = Image.open(safe_sample(str(body.get("sampleId", "")))).convert("RGB")
    source = original_source
    garment = decode_image(str(body.get("garmentImage", "")))
    category = str(body.get("category", "upper_body"))
    if category not in ('upper_body', 'lower_body', 'overall', 'full_body'):
        raise ValueError('Loại trang phục không hợp lệ')
    attributes = target_attributes(body.get('targetGarment'), category)
    thresholds = {
        'minimumQuality': max(0., min(100., float(body.get('minimumQuality',75)))),
        'minimumSimilarity': max(0., min(1., float(body.get('minimumSimilarity',.55)))),
        'minimumSeam': max(0., min(100., float(body.get('minimumSeam',65)))),
        'minimumAnatomy': max(0., min(100., float(body.get('minimumAnatomy',90)))),
    }
    minimum_quality, minimum_similarity, minimum_seam, minimum_anatomy = thresholds.values()
    def passes_gate(item):
        return not gate_reasons(item, thresholds)
    garment_description = None
    garment_negative_description = None
    if model_id == "idm-vton":
        from idm_vton_runtime import description_for, negative_description_for
        garment_description = description_for(category, body.get("garmentDescription") or None)
        garment_negative_description = negative_description_for(body.get("garmentNegativeDescription"))
    auto_mask_score = None
    update_job(job_id, stage="detecting-people", _event={"type":"analysis.started", "message":"Đang phát hiện nhân vật"})
    # Identity protection applies to manual masks and every person in the image.
    people = detect_people(original_source, POSE_MODEL.is_file())
    identity_array = np.zeros((original_source.height, original_source.width), dtype=np.uint8)
    for person in people:
        identity_array = np.maximum(identity_array, np.asarray(automatic_protected_detail_mask(original_source, person["box"], person.get("keypoints")), dtype=np.uint8))
    original_protected = Image.fromarray(identity_array)
    if body.get("protectedDetailMask"):
        user_protected = decode_mask(str(body["protectedDetailMask"]), original_source.size)
        original_protected = Image.fromarray(np.maximum(identity_array, np.asarray(user_protected, dtype=np.uint8)))
    person_index = max(0, min(len(people) - 1, int(body.get("personIndex", 0)))) if people else None
    person_box = people[person_index]["box"] if person_index is not None else None
    person_keypoints = people[person_index].get("keypoints") if person_index is not None else None
    crop_box = None
    if body.get("cropPerson") and person_box and (body.get("autoMask") or not body.get("editableMask")):
        x0, y0, x1, y1 = person_box
        padding = round(max(x1 - x0, y1 - y0) * 0.08)
        crop_box = (max(0, int(x0 - padding)), max(0, int(y0 - padding)), min(original_source.width, int(x1 + padding)), min(original_source.height, int(y1 + padding)))
        source = original_source.crop(crop_box)
        person_box = [0, 0, source.width, source.height]
        if person_keypoints:
            person_keypoints = [[point[0] - crop_box[0], point[1] - crop_box[1], point[2]] for point in person_keypoints]
    update_job(job_id, stage="creating-mask", _event={"type":"mask.started", "message":"Đang tạo vùng trang phục"})
    if body.get("autoMask") or not body.get("editableMask"):
        mask, auto_mask_score = automatic_garment_mask(source, category, person_box, person_keypoints)
    else:
        mask = decode_mask(str(body.get("editableMask", "")), source.size)
    protected = original_protected.crop(crop_box) if crop_box else original_protected
    reconstruct_body = bool(body.get("reconstructExposedBody", True))
    reconstruction_added = Image.new("L", source.size, 0)
    if reconstruct_body:
        ensure_job_active(job_id)
        update_job(job_id, stage="reconstructing-body-mask", _event={"type": "mask.reconstruction", "message": "Đang bổ sung vùng quần áo cũ để tái tạo phần cơ thể mới lộ ra"})
        if body.get("autoMask") or not body.get("editableMask"):
            old_clothing = mask
        else:
            old_clothing, _ = automatic_garment_mask(source, category, person_box, person_keypoints)
        mask, reconstruction_added = reconstruction_edit_mask(mask, old_clothing, protected)
    target_person = {'box': person_box, 'keypoints': person_keypoints} if person_box else None
    # Manual regions remain exact when body reconstruction is disabled.
    coverage_attributes = attributes if reconstruct_body or body.get('autoMask') else None
    mask, expected_garment, exposed_region, coverage_info = target_coverage(mask, protected, category, target_person, coverage_attributes)
    mask = exclude_protected_pixels(mask, protected)
    if mask.getbbox() is None:
        raise ValueError("Mask trang phục đang trống")
    expand = max(0, min(32, int(body.get("expand", 8))))
    blur = max(0, min(24, int(body.get("blur", 5))))
    hard_mask = mask.filter(ImageFilter.MaxFilter(expand * 2 + 1)) if expand else mask
    hard_mask = hard_mask.point(lambda value: 255 if value > 16 else 0)
    hard_mask = exclude_protected_pixels(hard_mask, protected)
    blend_mask = inward_blend(hard_mask, blur)
    blend_mask = exclude_protected_pixels(blend_mask, protected)

    max_side = max(512, min(1024, int(body.get("maxSide", 1024))))
    from idm_vton_runtime import canvas_size
    # Both published try-on models use a 3:4 canvas. Padding, not stretching,
    # places the selected person and reference in this coordinate system.
    width, height = canvas_size(max_side)
    count = max(1, min(4, int(body.get("count", 1))))
    steps = max(10, min(60, int(body.get("steps", 35))))
    guidance = max(0.5, min(7.5, float(body.get("guidance", 2.5))))
    requested_weights = body.get("scoreWeights") or {}
    score_weights = {
        "visualQuality": float(requested_weights.get("visualQuality", 0.35)),
        "referenceSimilarity": float(requested_weights.get("referenceSimilarity", 0.25)),
        "seamScore": float(requested_weights.get("seamScore", 0.15)),
        "anatomyScore": float(requested_weights.get("anatomyScore", 0.15)),
        "textureContinuity": float(requested_weights.get("textureContinuity", 0.10)),
    }
    weight_total = max(0.0001, sum(max(0.0, value) for value in score_weights.values()))
    score_weights = {key: max(0.0, value) / weight_total for key, value in score_weights.items()}
    def add_ranking_score(metrics):
        metrics["rankingScore"] = (
            metrics["qualityScore"] * score_weights["visualQuality"] +
            metrics["referenceSimilarity"] * 100 * score_weights["referenceSimilarity"] +
            metrics["seamScore"] * score_weights["seamScore"] +
            metrics["anatomyScore"] * score_weights["anatomyScore"] +
            metrics["textureContinuity"] * score_weights["textureContinuity"]
        )
    seed = int(body.get("seed", 42))
    garment_coverage = None
    garment_mode = None
    garment_mask_score = None
    if body.get("preprocessGarment"):
        garment, _, garment_coverage, garment_mode, garment_mask_score = preprocess_garment_image(garment, category, str(body.get('referenceType','auto')))

    update_job(job_id, stage="loading-model", _event={"type":"model.loading", "message":"Đang nạp model tạo ảnh"})
    pose_image = None
    if model_id == "idm-vton":
        from idm_vton_runtime import densepose_image
        update_job(job_id, stage="densepose", modelId=model_id)
        pose_image = densepose_image(fit_image(source, fit_geometry(source.size, (width,height))), DENSEPOSE_SCRIPT)
    pipe = load_tryon_pipe(model_id)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    run_id = f"tryon_{Path(str(body.get('sampleId'))).stem}_{stamp}"
    run_dir = OUTPUTS / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    garment.save(run_dir / "garment.png")
    original_protected.save(run_dir / "protected_identity.png")
    saved_reconstruction = Image.new("L", original_source.size, 0)
    if crop_box:
        saved_reconstruction.paste(reconstruction_added, crop_box)
    else:
        saved_reconstruction = reconstruction_added
    saved_reconstruction.save(run_dir / "body_reconstruction_mask.png")
    saved_mask = Image.new("L", original_source.size, 0)
    if crop_box:
        saved_mask.paste(hard_mask, crop_box)
    else:
        saved_mask = hard_mask
    saved_mask.save(run_dir / "editable_mask.png")
    scoring_mask = saved_mask if crop_box else hard_mask
    for name, local_mask in (('expected_garment_mask.png',expected_garment),('exposed_region_mask.png',exposed_region)):
        full_mask = Image.new('L', original_source.size, 0)
        if crop_box:
            full_mask.paste(local_mask, crop_box)
        else:
            full_mask = local_mask
        full_mask.save(run_dir/name)

    seed_progress = 0
    repair_mode = str(body.get("bodyRepairMode", "off"))
    requires_bare_arms = reconstruct_body and category in ("upper_body", "overall", "full_body") and person_index is not None and (repair_mode == "arms" or (repair_mode == "auto" and sleeveless_reference(garment)))
    def audit_bare_arms(image):
        if not requires_bare_arms:
            return {"required": False, "passed": True}
        region, _ = arm_reconstruction_masks(original_source, people[person_index], scoring_mask, original_protected, image)
        selected = np.asarray(region) > 0
        coverage = float((reference_skin_mask(original_source, image, people[person_index]) > 0)[selected].mean()) if selected.any() else 0.0
        return {"required": True, "passed": coverage >= 0.75, "skinCoverage": coverage, "minimumSkinCoverage": 0.75}
    def assess_candidate(image):
        metrics = score_tryon_result(original_source, image, scoring_mask)
        metrics['referenceSimilarity'] = reference_similarity(garment, image, scoring_mask)
        metrics['colorMaterial'] = color_material_consistency(garment, image, scoring_mask)
        metrics['geometry'] = catvton_geometry_consistency(image, scoring_mask)
        result_people = detect_people_pose(image) if POSE_MODEL.is_file() else []
        metrics['poseConsistency'] = pose_consistency(people[person_index] if person_index is not None else None, result_people)
        metrics['targetCoverage'] = coverage_info
        metrics['bodyAudit'] = audit_bare_arms(image)
        metrics['qualityScore'] = (metrics['preservationScore']*.30 + metrics['seamScore']*.25
                                   + metrics['colorMaterial']['colorMaterialScore']*.25
                                   + metrics['geometry']['geometryScore']*.20)
        metrics['metricSemantics'] = 'tryon-quality-v2'
        metrics['qualityGate'] = quality_gate(metrics, thresholds)
        add_ranking_score(metrics)
        return metrics
    def preserve_regions(image):
        image = Image.composite(image, original_source, scoring_mask)
        return restore_protected_pixels(original_source, image, original_protected)
    # Two finalists reduce the chance of a low-resolution ranking hiding a better
    # full-resolution result. Four preview candidates still cost only two finals.
    finalist_count = min(2,count) if bool(body.get('twoStage')) and count > 1 else 0
    estimated_seeds = count + max(0, min(3, int(body.get("maxRetries", 1)))) + finalist_count
    def generate_candidate(run_seed: int, run_width: int, run_height: int, run_steps: int, prefix: str):
        nonlocal seed_progress
        ensure_job_active(job_id)
        update_job(job_id, stage=prefix, seed=run_seed)
        generator = torch.Generator(device=device).manual_seed(run_seed)
        if model_id == "idm-vton":
            from idm_vton_runtime import generate
            def on_idm_step(pipeline, step_index, timestep, callback_kwargs):
                ensure_job_active(job_id)
                update_job(job_id, stage=prefix, step=step_index + 1, totalSteps=run_steps, modelId=model_id)
                return callback_kwargs
            generated = generate(pipe, source, garment, hard_mask, pose_image, category,
                                 traced_pipeline_call, num_inference_steps=run_steps,
                                 garment_description=garment_description,
                                 garment_negative_description=garment_negative_description,
                                 guidance_scale=guidance, height=run_height, width=run_width,
                                 generator=generator, callback_on_step_end=on_idm_step)
        else:
            from catvton_inputs import prepare_inputs
            model_source, model_mask = prepare_inputs(source, hard_mask, (run_width, run_height))
            generated = traced_pipeline_call(pipe,
                image=model_source, condition_image=garment, mask=model_mask,
                num_inference_steps=run_steps, guidance_scale=guidance,
                height=run_height, width=run_width, generator=generator,
            )[0]
            generated = restore_image(generated, fit_geometry(source.size,(run_width,run_height)))
        seed_progress += 1
        update_job(job_id, completedSeeds=seed_progress, totalSeeds=estimated_seeds)
        update_job(job_id, stage="scoring", seed=run_seed, _event={"type":"scoring.started", "message":f"Đang chấm điểm seed {run_seed}", "seed":run_seed})
        composited_work = Image.composite(generated, source, blend_mask)
        if crop_box:
            composited = original_source.copy()
            composited.paste(composited_work, crop_box)
        else:
            composited = composited_work
        composited = restore_protected_pixels(original_source, composited, original_protected)
        output_name = f"{prefix}_seed_{run_seed}.png"
        composited.save(run_dir / output_name)
        metrics = assess_candidate(composited)
        seam_repair = {"attempted": False, "accepted": False, "pixels": 0}
        if body.get("repairSeams", True):
            seam_repair["attempted"] = True
            repaired, repair_mask, repair_pixels = repair_local_seams(original_source, composited, scoring_mask)
            repaired = preserve_regions(repaired)
            repaired_metrics = assess_candidate(repaired)
            seam_repair["pixels"] = repair_pixels
            if repair_is_better(metrics, repaired_metrics, thresholds):
                composited, metrics = repaired, repaired_metrics
                seam_repair["accepted"] = True
                repair_mask.save(run_dir / f"seam_mask_seed_{run_seed}.png")
                composited.save(run_dir / output_name)
        metrics["seamRepair"] = seam_repair
        metrics["bodyAudit"] = audit_bare_arms(composited)
        if not metrics["bodyAudit"]["passed"]:
            metrics["rankingScore"] -= 25 * (1 - metrics["bodyAudit"]["skinCoverage"])
        update_job(job_id, _result={
            "kind": "seed", "sampleId": str(body.get("sampleId")), "seed": run_seed,
            "file": str((run_dir / output_name).relative_to(ROOT)), "stage": prefix,
            "qualityScore": round(float(metrics["qualityScore"]), 2),
            "referenceSimilarity": round(float(metrics["referenceSimilarity"]), 4),
            "seamScore": round(float(metrics["seamScore"]), 2),
            "anatomyScore": round(float(metrics["anatomyScore"]), 2),
        }, _event={"type":"seed.completed", "message":f"Seed {run_seed} hoàn tất", "seed":run_seed, "sampleId":str(body.get("sampleId"))})
        return {"seed": run_seed, "image": encode_image(composited), "file": output_name, **metrics}

    two_stage = bool(body.get("twoStage")) and count > 1
    if two_stage:
        preview_width, preview_height = canvas_size(512)
        preview_steps = max(10, min(20, int(body.get("previewSteps", 10))))
        candidates = [generate_candidate(seed + index, preview_width, preview_height, preview_steps, "preview") for index in range(count)]
        finalists = sorted(candidates, key=lambda item: candidate_key(item,thresholds), reverse=True)[:finalist_count]
        results = [generate_candidate(item['seed'], width, height, steps, 'result') for item in finalists]
        best = max(results, key=lambda item: candidate_key(item,thresholds))
    else:
        candidates = []
        results = [generate_candidate(seed + index, width, height, steps, "result") for index in range(count)]
        best = max(results, key=lambda item: candidate_key(item,thresholds))
    retry_count = 0
    max_retries = max(0, min(3, int(body.get("maxRetries", 1))))
    while not passes_gate(best) and retry_count < max_retries:
        ensure_job_active(job_id)
        retry_seed = seed + count + retry_count
        retry = generate_candidate(retry_seed, width, height, min(60, steps + 5), "retry")
        results.append(retry)
        if candidate_key(retry,thresholds) > candidate_key(best,thresholds):
            best = retry
        retry_count += 1
    generative_refine = {"attempted": False, "accepted": False, "pixels": 0}
    if body.get("generativeRefine", True) and best["seamScore"] < minimum_seam and not best["seamRepair"]["accepted"]:
        ensure_job_active(job_id)
        update_job(job_id, stage="generative-seam-refine", seed=best["seed"])
        generative_refine["attempted"] = True
        refine_region = str(body.get("refineRegion", "auto"))
        refined, refine_mask, refine_pixels = generative_seam_refine(original_source, Image.open(run_dir / best["file"]).convert("RGB"), scoring_mask, best["seed"] + 900000, min(24, steps), refine_region)
        refined = preserve_regions(refined)
        refined_metrics = assess_candidate(refined)
        generative_refine["pixels"] = refine_pixels
        if repair_is_better(best, refined_metrics, thresholds):
            refine_mask.save(run_dir / f"generative_seam_mask_seed_{best['seed']}.png")
            refined.save(run_dir / best["file"])
            best.update({"image": encode_image(refined), **refined_metrics})
            generative_refine["accepted"] = True
        best["generativeRefine"] = generative_refine
    body_repair = {"applied": False, "reason": "disabled-or-not-sleeveless"}
    if reconstruct_body and category in ("upper_body", "overall", "full_body") and person_index is not None and (repair_mode == "arms" or (repair_mode == "auto" and sleeveless_reference(garment))):
        ensure_job_active(job_id)
        update_job(job_id, stage="repairing-exposed-arms", _event={"type": "body.repair", "message": "Đang sửa vùng tay áo cũ và tái tạo tay trần"})
        # No further CatVTON candidates are generated after this point.
        pipe = None
        release_tryon()
        repaired, repair_mask, body_repair = reconstruct_bare_arms(original_source, Image.open(run_dir / best["file"]).convert("RGB"), people[person_index], scoring_mask, original_protected, best["seed"], run_dir / "exposed_arms_candidate.png")
        ensure_job_active(job_id)
        if body_repair["applied"]:
            repaired = preserve_regions(repaired)
            repaired_metrics = assess_candidate(repaired)
            if set(gate_reasons(repaired_metrics,thresholds)) <= set(gate_reasons(best,thresholds)) and repaired_metrics['referenceSimilarity'] >= best['referenceSimilarity']-.02:
                repair_mask.save(run_dir / "exposed_arms_repair_mask.png")
                repaired.save(run_dir / best["file"])
                best.update({"image": encode_image(repaired), **repaired_metrics})
            else:
                body_repair.update(applied=False, reason='quality-regression')
    best["bodyAudit"] = audit_bare_arms(Image.open(run_dir / best["file"]).convert("RGB"))
    best['qualityGate'] = quality_gate(best,thresholds)
    quality_passed = passes_gate(best)
    update_job(job_id, stage="saving", _event={"type":"saving.started", "message":"Đang lưu kết quả và metadata"})
    shutil.copyfile(run_dir / best["file"], run_dir / "selected.png")
    duration_seconds = round(time.perf_counter() - started_at, 3)
    peak_vram_mb = round(torch.cuda.max_memory_allocated() / (1024 * 1024), 1) if torch.cuda.is_available() else 0.0
    metadata = {
        "promptHistory": prompt_history(),
        "schemaVersion": 1, "runId": run_id, "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": str(body.get("sampleId")), "category": category, "seed": seed,
        "count": count, "steps": steps, "guidance": guidance,
        "expand": expand, "blur": blur, "modelId": model_id, "model": "IDM-VTON" if model_id == "idm-vton" else "CatVTON mix-48k-1024",
        "garmentDescription": garment_description,
        "garmentNegativeDescription": garment_negative_description,
        "license": "CC-BY-NC-SA-4.0", "device": device,
        "modelWidth": width, "modelHeight": height,
        "inputGeometry": fit_geometry(source.size,(width,height)),
        "targetCoverage": coverage_info, "referenceType": body.get('referenceType','auto'),
        "qualityVersion": 2, "requiresVisualReview": True,
        "autoMask": bool(body.get("autoMask") or not body.get("editableMask")),
        "autoMaskScore": auto_mask_score, "garmentCoverage": garment_coverage,
        "identityProtection": {"enabled": True, "protectedPixels": int((np.asarray(original_protected) > 0).sum()), "mask": "protected_identity.png"},
        "bodyReconstruction": {"enabled": reconstruct_body, "method": f"{model_id}-complete-old-clothing-mask", "addedPixels": int((np.asarray(saved_reconstruction) > 0).sum()), "mask": "body_reconstruction_mask.png"},
        "bodyRepair": body_repair,
        "bodyAudit": best["bodyAudit"],
        "garmentMode": garment_mode, "garmentMaskScore": garment_mask_score,
        "personIndex": person_index, "detectedPeople": len(people),
        "cropPerson": bool(crop_box), "cropBox": crop_box, "usePose": bool(body.get("usePose")),
        "selectedSeed": best["seed"], "selectedQualityScore": best["qualityScore"],
        "results": [{key: value for key, value in item.items() if key != "image"} for item in results],
        "twoStage": two_stage, "previewCandidates": [{k: item[k] for k in ("seed", "qualityScore", "referenceSimilarity")} for item in candidates],
        "qualityGate": best['qualityGate'],
        "repairSeams": bool(body.get("repairSeams", True)), "retryCount": retry_count,
        "generativeRefine": generative_refine,
        "refineRegion": str(body.get("refineRegion", "auto")),
        "selectedMetrics": {key: best[key] for key in ("qualityScore", "rankingScore", "referenceSimilarity", "seamScore", "anatomyScore", "textureContinuity", "preservationScore", "colorMaterial", "geometry", "poseConsistency", "metricSemantics")},
        "performance": {"durationSeconds": duration_seconds, "peakVramMb": peak_vram_mb},
        "scoreWeights": score_weights,
    }
    (run_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    response = {
        "ok": True, "promptHistory": prompt_history(), "results": results, "width": width, "height": height, "device": device,
        "directory": str(run_dir.relative_to(ROOT)), "selectedSeed": best["seed"], "modelId": model_id,
        "selected": str((run_dir / "selected.png").relative_to(ROOT)), "autoMaskScore": auto_mask_score,
        "garmentCoverage": garment_coverage, "garmentMode": garment_mode, "garmentMaskScore": garment_mask_score,
        "candidates": [{k: item[k] for k in ("seed", "qualityScore", "referenceSimilarity")} for item in candidates],
        "qualityGate": best['qualityGate'], "targetCoverage": coverage_info,
        "retryCount": retry_count,
        "bodyReconstruction": metadata["bodyReconstruction"],
        "bodyRepair": body_repair,
        "bodyAudit": best["bodyAudit"],
        "generativeRefine": generative_refine,
        "performance": {"durationSeconds": duration_seconds, "peakVramMb": peak_vram_mb},
    }
    if body.get("batchMode"):
        update_job(job_id, stage="batch-item-complete", directory=str(run_dir.relative_to(ROOT)))
    else:
        update_job(job_id, status="completed", stage="done", directory=str(run_dir.relative_to(ROOT)), _event={"type":"job.completed", "message":"Đã hoàn tất tạo kết quả"})
    return response


def batch_tryon(body: dict) -> dict:
    job_id = str(body.get("jobId", ""))[:80]
    safe_job_id = "".join(character for character in job_id if character.isalnum() or character in "-_")
    request_file = JOBS_DIR / f"{safe_job_id}.request.json" if safe_job_id else None
    checkpoint_file = JOBS_DIR / f"{safe_job_id}.checkpoint.json" if safe_job_id else None
    if request_file and not body.get("resume"):
        JOBS_DIR.mkdir(parents=True, exist_ok=True)
        metadata.write(request_file, body)
    update_job(job_id, status="running", stage="batch-preparing", resumable=bool(request_file), requestFile=str(request_file.relative_to(ROOT)) if request_file else None)
    sample_ids = list(dict.fromkeys(str(item) for item in (body.get("sampleIds") or [])))
    if not sample_ids:
        raise ValueError("Chưa chọn ảnh cho chế độ hàng loạt")
    maximum = 23 if body.get("benchmark") else 12
    if len(sample_ids) > maximum:
        raise ValueError(f"Mỗi lượt hàng loạt tối đa {maximum} ảnh")
    garment = decode_image(str(body.get("garmentImage", "")))
    processed, _, garment_coverage, garment_mode, garment_mask_score = preprocess_garment_image(garment, str(body.get("category", "upper_body")), str(body.get('referenceType','auto')))
    encoded_garment = encode_image(processed)
    checkpoint = {}
    if body.get("resume") and checkpoint_file and metadata.exists(checkpoint_file):
        checkpoint = metadata.read(checkpoint_file)
    items = list(checkpoint.get("items", []))
    errors = list(checkpoint.get("errors", []))
    skipped = list(checkpoint.get("skipped", []))
    processed = set(checkpoint.get("processed", []))
    def save_checkpoint(sample_id=None):
        if sample_id:
            processed.add(sample_id)
        if checkpoint_file:
            metadata.write(checkpoint_file, {"processed": sorted(processed), "items": items, "errors": errors, "skipped": skipped})
    minimum_confidence = max(0.0, min(1.0, float(body.get("minimumConfidence", 0.75))))
    for index, sample_id in enumerate(sample_ids):
        if sample_id in processed:
            continue
        ensure_job_active(job_id)
        update_job(job_id, stage="batch-item", current=index + 1, total=len(sample_ids), sampleId=sample_id)
        request = {
            **body, "sampleId": sample_id, "garmentImage": encoded_garment,
            "editableMask": "", "protectedDetailMask": "", "autoMask": True,
            "preprocessGarment": False, "cropPerson": bool(body.get("cropPerson", True)),
            "seed": int(body.get("seed", 42)) + index * 100,
            "batchMode": True,
        }
        try:
            audit_source = Image.open(safe_sample(sample_id)).convert("RGB")
            audit_people = detect_people(audit_source, bool(body.get("usePose")))
            audit_index = max(0, min(len(audit_people) - 1, int(body.get("personIndex", 0))))
            _, audit_score = automatic_garment_mask(audit_source, str(body.get("category", "upper_body")), audit_people[audit_index]["box"], audit_people[audit_index].get("keypoints"))
            if body.get("onlyConfident", True) and audit_score < minimum_confidence:
                skipped.append({"sampleId": sample_id, "maskScore": audit_score, "reason": "below_confidence_threshold"})
                save_checkpoint(sample_id)
                continue
            result = tryon(request)
            best = next(item for item in result['results'] if item['seed'] == result['selectedSeed'])
            if body.get("onlyQualityPassed", True) and not result["qualityGate"]["passed"]:
                skipped.append({
                    "sampleId": sample_id, "qualityScore": best["qualityScore"],
                    "referenceSimilarity": best["referenceSimilarity"], "reason": "quality_gate",
                })
                save_checkpoint(sample_id)
                continue
            items.append({
                "sampleId": sample_id, "directory": result["directory"], "selected": result["selected"],
                "selectedSeed": result["selectedSeed"], "qualityScore": best["qualityScore"],
                "outsideMaskMAE": best["outsideMaskMAE"], "edgeMAE": best["edgeMAE"],
                "autoMaskScore": result["autoMaskScore"], "referenceSimilarity": best["referenceSimilarity"],
                "seamScore": best["seamScore"], "anatomyScore": best["anatomyScore"],
                "textureContinuity": best["textureContinuity"], "category": str(body.get("category", "upper_body")),
                "preservationScore": best['preservationScore'], "qualityGate": result['qualityGate'],
                "colorMaterial": best['colorMaterial'], "geometry": best['geometry'], "poseConsistency": best['poseConsistency'],
                "durationSeconds": result["performance"]["durationSeconds"], "peakVramMb": result["performance"]["peakVramMb"],
            })
            update_job(job_id, current=index + 1, total=len(sample_ids), _result={
                "kind":"image", "sampleId":sample_id, "seed":result["selectedSeed"],
                "file":result["selected"], "qualityScore":round(float(best["qualityScore"]),2),
                "referenceSimilarity":round(float(best["referenceSimilarity"]),4),
                "seamScore":round(float(best["seamScore"]),2), "anatomyScore":round(float(best["anatomyScore"]),2),
            }, _event={"type":"image.completed", "message":f"Đã hoàn tất ảnh {index + 1}/{len(sample_ids)}", "sampleId":sample_id})
            save_checkpoint(sample_id)
        except Exception as error:
            errors.append({"sampleId": sample_id, "error": str(error)})
            if "Tác vụ đã được hủy" not in str(error):
                save_checkpoint(sample_id)
            else:
                raise
    report_id = datetime.now(timezone.utc).strftime("batch_%Y%m%dT%H%M%S%fZ")
    report_dir = OUTPUTS / report_id
    report_dir.mkdir(parents=True, exist_ok=False)
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "category": str(body.get("category", "upper_body")), "garmentCoverage": garment_coverage,
        "garmentMode": garment_mode, "garmentMaskScore": garment_mask_score,
        "requested": len(sample_ids), "completed": len(items), "failed": len(errors), "skipped": len(skipped),
        "minimumConfidence": minimum_confidence, "items": items, "errors": errors, "skippedItems": skipped,
        "performance": {
            "totalDurationSeconds": round(sum(item.get("durationSeconds", 0) for item in items), 3),
            "averageDurationSeconds": round(sum(item.get("durationSeconds", 0) for item in items) / max(1, len(items)), 3),
            "peakVramMb": max((item.get("peakVramMb", 0) for item in items), default=0),
        },
    }
    (report_dir / "batch-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    update_job(job_id, status="completed", stage="done", report=str((report_dir / "batch-report.json").relative_to(ROOT)), current=len(sample_ids), total=len(sample_ids), _event={"type":"job.completed", "message":f"Hoàn tất {len(items)}/{len(sample_ids)} ảnh"})
    return {"ok": True, "report": str((report_dir / "batch-report.json").relative_to(ROOT)), **report}
