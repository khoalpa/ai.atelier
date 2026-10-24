from services.ai.runtime.tracing import trace_generation
"""AI Atelier: tasks.inpaint."""
from PIL import Image, ImageFilter, ImageOps
from datetime import datetime, timezone
from pathlib import Path
from prompt_catalog import prompt_text, prompt_template, read_catalog, task_prompt
import json
import numpy as np
import time
import torch
from services.ai.imaging.blending import adaptive_inpaint_context_padding, adaptive_local_edge_blend, detect_core_structural_artifacts, effective_step_policy, generative_core_structural_refine, prepare_dual_inpaint_masks, texture_preserving_core_recovery
from services.ai.imaging.segmentation import decode_image, decode_mask, detect_regions, encode_image, safe_sample
from services.ai.models.pipelines import _detector, detect_inpaint_architecture, inpaint_model_entry, load_inpaint_pipe, release_inpaint
from services.ai.models import state as model_state
from services.ai.runtime.configuration import INPAINT_MODEL, OUTPUTS, ROOT, YOLO_WORLD_ROOT, device
from services.ai.runtime.jobs import ensure_job_active, persist_job_request, update_job
from services.ai.runtime.tracing import prompt_history, prompt_trace_context, save_diffusion_preview, traced_pipeline_call


INPAINT_TARGETS = {
    "outfit": "",
    "shirt": "",
    "pants": "",
    "glasses": "",
    "hat": "",
    "jewelry": "",
    "bag": "",
    "shoes": "",
    "custom": "",
}


def resolved_inpaint_profile(entry: dict | None, architecture: str) -> dict:
    profiles = read_catalog()["runtimePresets"]["inpaintProfiles"]
    profile = dict(profiles.get(architecture, profiles["sdxl"]))
    if entry:
        profile.update(read_catalog()["runtimePresets"]["modelInpaintProfiles"].get(entry.get("id"), {}))
    profile["contentStyle"] = str((entry or {}).get("contentStyle") or "general")
    profile["modelId"] = str((entry or {}).get("id") or "default")
    return profile


def build_inpaint_negative_prompt(removal_target: str, fill_mode: str, corrective: bool = False, extra: str = "") -> str:
    """Build a non-conflicting, target-aware list of forbidden outcomes."""
    common = [prompt_text('build_inpaint_negative_prompt.original_object'), prompt_text('build_inpaint_negative_prompt.replacement_object'), prompt_text('build_inpaint_negative_prompt.duplicate_object'), prompt_text('build_inpaint_negative_prompt.visible_inpaint_boundary'), prompt_text('build_inpaint_negative_prompt.abrupt_color_transition'), prompt_text('build_inpaint_negative_prompt.deformed_anatomy'), prompt_text('build_inpaint_negative_prompt.extra_limb'), prompt_text('build_inpaint_negative_prompt.changed_face'), prompt_text('build_inpaint_negative_prompt.blur'), prompt_text('build_inpaint_negative_prompt.artifacts')]
    target_terms = {
        "outfit": [prompt_text('build_inpaint_negative_prompt.outfit'),],
        "shirt": [prompt_text('build_inpaint_negative_prompt.shirt')],
        "pants": [prompt_text('build_inpaint_negative_prompt.pants'), prompt_text('build_inpaint_negative_prompt.trousers')],
        "glasses": [prompt_text('build_inpaint_negative_prompt.glasses')],
        "hat": [prompt_text('build_inpaint_negative_prompt.hat')],
        "jewelry": [prompt_text('build_inpaint_negative_prompt.jewelry')],
        "bag": [prompt_text('build_inpaint_negative_prompt.bag'), prompt_text('build_inpaint_negative_prompt.handbag')],
        "shoes": [prompt_text('build_inpaint_negative_prompt.shoes'), prompt_text('build_inpaint_negative_prompt.footwear')],
        "custom": [prompt_text('build_inpaint_negative_prompt.selected_object')],
    }
    replacement_terms = [prompt_text('build_inpaint_negative_prompt.replacement_garment'), prompt_text('build_inpaint_negative_prompt.new_garment'), prompt_text('build_inpaint_negative_prompt.duplicate_clothing'), prompt_text('build_inpaint_negative_prompt.layered_clothing'), prompt_text('build_inpaint_negative_prompt.transparent_clothing'), prompt_text('build_inpaint_negative_prompt.torn_clothing')]
    if fill_mode == "base_layer":
        common.remove(prompt_text('build_inpaint_negative_prompt.replacement_object'))
        replacement_terms = [prompt_text('build_inpaint_negative_prompt.duplicate_clothing'), prompt_text('build_inpaint_negative_prompt.layered_clothing'), prompt_text('build_inpaint_negative_prompt.transparent_clothing'), prompt_text('build_inpaint_negative_prompt.torn_clothing')]
        target_terms = {key: [prompt_template("remainingOriginal", term=term) for term in terms] for key, terms in target_terms.items()}
    if removal_target in (prompt_text('build_inpaint_negative_prompt.outfit'), prompt_text('build_inpaint_negative_prompt.shirt'), prompt_text('build_inpaint_negative_prompt.pants')):
        if fill_mode != "reconstruct_body":
            common.extend(replacement_terms)
        if fill_mode == "background":
            common.extend([prompt_text('build_inpaint_negative_prompt.person_in_the_cleared_region'), prompt_text('build_inpaint_negative_prompt.body_in_the_cleared_region'), prompt_text('build_inpaint_negative_prompt.clothing_in_the_cleared_region')])
        # base_layer intentionally does not ban generic clothing/base layers.
    values = common + target_terms.get(removal_target, target_terms["custom"])
    if corrective:
        values += [prompt_text('build_inpaint_negative_prompt.any_remaining_collar'), prompt_text('build_inpaint_negative_prompt.any_remaining_button'), prompt_text('build_inpaint_negative_prompt.any_remaining_cuff'), prompt_text('build_inpaint_negative_prompt.any_remaining_sleeve'), prompt_text('build_inpaint_negative_prompt.recreated_original_color'), prompt_text('build_inpaint_negative_prompt.recreated_original_texture'), prompt_text('build_inpaint_negative_prompt.recreated_original_silhouette')]
    values += [item.strip() for item in str(extra or "").split(",") if item.strip()]
    unique = []
    for value in values:
        if value.lower() not in {item.lower() for item in unique}:
            unique.append(value)
    return ", ".join(unique)


def build_inpaint_instruction(removal_target: str, fill_mode: str, architecture: str, user_prompt: str = "", prompt_mode: str = "", forbidden_replacement: str = "") -> tuple[str, str]:
    """Create a target-aware instruction and keep FLUX exclusions in its positive prompt."""
    target = removal_target if removal_target in INPAINT_TARGETS else "custom"
    mode = fill_mode if fill_mode in ('base_layer', 'reconstruct_body', 'background') else "reconstruct_body"
    subject = INPAINT_TARGETS[target]
    if mode in ('base_layer', 'reconstruct_body', 'background'):
        from processing_mode_prompts import processing_mode_prompt
        replacement = processing_mode_prompt(ROOT, mode).strip()
        removal = user_prompt.strip() or prompt_template("removeObject", subject=subject or prompt_template("selectedTarget", target=target.replace("_", " ")))
        preserve = prompt_text('build_inpaint_instruction.strict_inpainting_mode_modify_only_the_area')
        prompt = ' '.join(dict.fromkeys(part for part in (removal, replacement, preserve) if part))
        negative = ', '.join(dict.fromkeys(term.strip() for term in (prompt_text('build_inpaint_instruction.object_remnants'), prompt_text('build_inpaint_instruction.duplicate_objects'), prompt_text('build_inpaint_instruction.visible_seams'), prompt_text('build_inpaint_instruction.color_mismatch'), prompt_text('build_inpaint_negative_prompt.blur'), prompt_text('build_inpaint_negative_prompt.artifacts'), forbidden_replacement if mode != "reconstruct_body" else "") if term.strip()))
        return prompt, negative


def resolve_inpaint_prompts(body: dict, architecture: str = "", profile: dict | None = None) -> dict:
    if body.get("processingMode") == "outfit-description":
        description = str(body.get("prompt") or "").strip()
        if not description:
            raise ValueError("Hãy nhập mô tả trang phục hoặc phụ kiện mới")
        prompt = task_prompt("outfit-description", description=description)
        negative = str(body.get("negativePrompt") or "").strip()
        confirmed = body.get("confirmedPrompts")
        if confirmed is not None:
            if not isinstance(confirmed, dict) or not isinstance(confirmed.get("prompt"), str) or not confirmed["prompt"].strip() or not isinstance(confirmed.get("negativePrompt"), str):
                raise ValueError("Prompt xác nhận không hợp lệ")
            prompt, negative = confirmed["prompt"].strip(), confirmed["negativePrompt"].strip()
        return {"prompt": prompt, "negativePrompt": negative, "generatedNegativePrompt": negative}
    target = str(body.get("removalTarget") or "custom").lower()
    mode = str(body.get("fillMode") or ("reconstruct_body" if target in ("outfit", "shirt", "pants") else "background")).lower()
    forbidden = str(body.get("forbiddenReplacement") or "")
    prompt, generated = build_inpaint_instruction(target, mode, architecture, str(body.get("prompt") or ""), str((profile or {}).get("promptMode") or ""), forbidden)
    negative = build_inpaint_negative_prompt(target, mode, False, ', '.join(filter(None, [forbidden, str(body.get("negativePrompt") or "")]))) or generated
    if mode in ("background", "base_layer", "reconstruct_body"):
        negative = ', '.join(dict.fromkeys(term.strip().lower() for term in (generated + ',' + str(body.get("negativePrompt") or "")).split(',') if term.strip()))
    confirmed = body.get("confirmedPrompts")
    if confirmed is not None:
        if not isinstance(confirmed, dict) or not isinstance(confirmed.get("prompt"), str) or not confirmed["prompt"].strip() or not isinstance(confirmed.get("negativePrompt"), str):
            raise ValueError("Prompt xác nhận không hợp lệ")
        prompt, negative = confirmed["prompt"].strip(), confirmed["negativePrompt"].strip()
    return {"prompt": prompt, "negativePrompt": negative, "generatedNegativePrompt": generated}


def inpaint_removal_check(source: Image.Image, result: Image.Image, mask: Image.Image, removal_target: str) -> dict:
    """Pixel change is diagnostic only; it cannot certify object removal."""
    from object_removal import visual_change
    return visual_change(source, result, mask)


def semantic_inpaint_residual_check(result: Image.Image, mask: Image.Image, removal_target: str, fill_mode: str, object_label: str = "") -> dict:
    """Return explicit unavailable state; callers must not interpret it as a pass."""
    class_map = {
        "outfit": [prompt_text('detection.outfit.default.collared_outfit'), prompt_text('detection.outfit.default.buttoned_clothing'), prompt_text('detection.outfit.default.long_sleeved_garment')],
        "shirt": ([prompt_text('detection.shirt.base_layer.collared_shirt'), prompt_text('detection.shirt.base_layer.button-down_shirt'), prompt_text('detection.shirt.base_layer.blouse_with_sleeves')] if fill_mode == "base_layer" else [prompt_text('detection.shirt.default.shirt'), prompt_text('detection.shirt.default.blouse'), prompt_text('detection.shirt.default.top')]),
        "pants": [prompt_text('detection.pants.default.pants'), prompt_text('detection.pants.default.trousers'), prompt_text('detection.pants.default.skirt')], "glasses": [prompt_text('detection.glasses.default.glasses')], "hat": [prompt_text('detection.hat.default.hat')],
        "jewelry": [prompt_text('detection.jewelry.default.necklace'), prompt_text('detection.jewelry.default.jewelry')], "bag": [prompt_text('detection.bag.default.handbag'), prompt_text('detection.bag.default.bag')], "shoes": [prompt_text('detection.shoes.default.shoes'), prompt_text('detection.shoes.default.footwear')],
    }
    classes = class_map.get(removal_target) or [term.strip()[:80] for term in object_label.split(",") if term.strip()][:8]
    checkpoint = next(iter(YOLO_WORLD_ROOT.rglob("yolov8x-worldv2.pt")), None) if YOLO_WORLD_ROOT.exists() else None
    clip_file = ROOT / "weights" / "clip" / "ViT-B-32.pt"
    if not classes or checkpoint is None or not clip_file.is_file():
        return {"available": False, "detected": False, "method": "yolo-world-cpu", "reason": "detector-unavailable"}
    try:
        model = _detector("yolo-world")
        model.set_classes(classes)
        selected = np.asarray(mask.convert("L"), dtype=np.uint8) > 16
        box = mask.getbbox()
        if box is None:
            return {"available": False, "detected": False, "method": "yolo-world-cpu", "reason": "empty-mask"}
        xoff, yoff = max(0, box[0]-96), max(0, box[1]-96)
        crop = result.crop((xoff, yoff, min(result.width, box[2]+96), min(result.height, box[3]+96)))
        prediction = model.predict(np.asarray(crop)[:, :, ::-1].copy(), conf=0.24, verbose=False, device="cpu")[0]
        matches = []
        if prediction.boxes is not None:
            for box in prediction.boxes:
                x0, y0, x1, y1 = [max(0, int(round(value))) for value in box.xyxy[0].detach().cpu().tolist()]
                x0, x1, y0, y1 = x0+xoff, x1+xoff, y0+yoff, y1+yoff
                x1, y1 = min(result.width, x1), min(result.height, y1)
                if x1 <= x0 or y1 <= y0:
                    continue
                overlap = float(selected[y0:y1, x0:x1].sum() / max(1, min(selected.sum(), (x1-x0)*(y1-y0))))
                if overlap >= 0.18:
                    class_id = int(box.cls[0].item())
                    matches.append({"label": str(prediction.names.get(class_id, class_id)), "confidence": round(float(box.conf[0].item()), 4), "maskOverlap": round(overlap, 4)})
        return {"available": True, "detected": bool(matches), "method": "yolo-world-cpu", "matches": matches}
    except Exception as error:
        return {"available": False, "detected": False, "method": "yolo-world-cpu", "reason": str(error)[:240]}


@trace_generation
def inpaint(body: dict) -> dict:
    from object_removal import (model_settings, removal_regions, prepare_region, restore_region,
                                blend_removal, assess_removal, boundary_metric, removal_rank)
    started_at = time.perf_counter()
    job_id = str(body.get("jobId", ""))[:80]
    request_file = persist_job_request(job_id, "inpaint", body)
    update_job(job_id, status="running", stage="inpaint-validating", taskType="inpaint", device=device,
               gpuMemoryMb=round(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)) if torch.cuda.is_available() else 0,
               resumable=bool(request_file), requestFile=str(request_file.relative_to(ROOT)) if request_file else None,
               _event={"type":"inpaint.started", "message":"Đang kiểm tra ảnh và mask"})
    ensure_job_active(job_id)
    source = ImageOps.exif_transpose(Image.open(safe_sample(str(body.get("sampleId", ""))))).convert("RGB")
    mask = decode_mask(str(body.get("editableMask", "")), source.size)
    protected = None
    protected_value = str(body.get("protectedDetailMask", ""))
    if protected_value:
        protected = decode_mask(protected_value, source.size)
        pixels = np.asarray(mask).copy()
        pixels[np.asarray(protected) > 16] = 0
        mask = Image.fromarray(pixels)
    if mask.getbbox() is None:
        raise ValueError("Mask đang trống; hãy chọn phụ kiện cần xóa")
    update_job(job_id, stage="inpaint-preparing-mask", sourceWidth=source.width, sourceHeight=source.height, _event={"type":"mask.preparing", "message":"Đang mở rộng và làm mềm vùng chỉnh sửa"})
    expand = max(0, min(64, int(body.get("expand", 24))))
    blur = max(0, min(32, int(body.get("blur", 16))))
    requested_mode = body.get("fillMode") or ("reconstruct_body" if body.get("removalTarget") in ("outfit", "shirt", "pants") else "background")
    composite_expand = body.get("compositeExpand")
    if composite_expand is None and requested_mode == "background" and body.get("processingMode") != "outfit-description":
        composite_expand = min(expand, blur)
    generation_mask, composite_mask, dual_mask_metrics = prepare_dual_inpaint_masks(
        mask, protected, expand, composite_expand
    )
    if generation_mask.getbbox() is None:
        raise ValueError("Vùng bảo vệ đang che toàn bộ mask chỉnh sửa")
    edge_feather = max(3, min(32, int(body.get("edgeFeather", max(6, blur)))))

    max_side = max(512, min(1024, int(body.get("maxSide", 768))))
    scale = min(max_side / max(source.size), 1.0)
    width = max(64, round(source.width * scale / 64) * 64)
    height = max(64, round(source.height * scale / 64) * 64)
    model_image = source.resize((width, height), Image.Resampling.LANCZOS)
    model_mask = generation_mask.resize((width, height), Image.Resampling.NEAREST)

    removal_target = str(body.get("removalTarget") or "custom").lower()
    fill_mode = str(body.get("fillMode") or ("reconstruct_body" if removal_target in ("outfit", "shirt", "pants") else "background")).lower()
    forbidden_replacement = str(body.get("forbiddenReplacement") or "")
    seed = int(body.get("seed", 42))
    count = max(1, min(4, int(body.get("count", 1))))
    strength = max(0.2, min(1.0, float(body.get("strength", 0.65))))
    step_policy = effective_step_policy(
        int(body.get("steps", 20)), strength, int(body.get("minimumEffectiveSteps", 12)),
        body.get("allowFastPreview", False) is True,
    )
    steps = step_policy["adjustedSteps"]
    guidance = float(body.get("guidance", 4.5))
    requested_crop_padding = max(0, min(256, int(body.get("cropPadding", 96))))
    crop_padding = adaptive_inpaint_context_padding(model_mask, requested_crop_padding, body.get("contextRatio", 0.30))
    selected_model_id = str(body.get("modelId") or "")
    selected_entry = inpaint_model_entry(selected_model_id or None)
    selected_model_path = INPAINT_MODEL if selected_entry is None else Path(str(selected_entry.get("path") or ""))
    if selected_entry is not None and not selected_model_path.is_absolute():
        selected_model_path = ROOT / selected_model_path
    selected_architecture = detect_inpaint_architecture(selected_model_path, selected_entry.get("architecture") if selected_entry else None)
    if selected_architecture not in ("sd3", "sd35", "sdxl", "sd15", "sd2", "flux"):
        raise ValueError(f"Kiến trúc inpainting chưa được hỗ trợ: {selected_architecture}")
    if model_state.inpaint_pipe is not None and (getattr(model_state.inpaint_pipe, "_atelier_model_path", None) != str(selected_model_path.resolve()) or getattr(model_state.inpaint_pipe, "_atelier_architecture", None) != selected_architecture):
        release_inpaint()
    model_was_loaded = model_state.inpaint_pipe is not None
    def report_model_load(phase, message):
        update_job(job_id, stage=f"inpaint-model-{phase}", modelLoaded=model_was_loaded or phase == "ready", _event={"type":f"model.{phase}", "message":message})
    architecture = selected_architecture
    profile = resolved_inpaint_profile(selected_entry, architecture)
    use_model_profile = body.get("useModelProfile", True) is not False
    settings = model_settings(body, profile if use_model_profile else {}, architecture)
    max_side, strength, guidance = settings["maxSide"], settings["strength"], settings["guidance"]
    step_policy = effective_step_policy(settings["steps"], strength, int(body.get("minimumEffectiveSteps", 12)), body.get("allowFastPreview", False) is True)
    steps = step_policy["adjustedSteps"]
    local_removal = fill_mode == "background" and body.get("processingMode") != "outfit-description"
    settings["requestedSteps"], settings["steps"] = settings["steps"], steps
    if local_removal:
        # Crop at original resolution for every model; FLUX has no padding_mask_crop.
        boxes = removal_regions(generation_mask, requested_crop_padding, float(body.get("contextRatio", 0.30)))
        region_inputs = [(box, *prepare_region(source, generation_mask, box, max_side)) for box in boxes]
        width, height = region_inputs[0][1].size
    else:
        scale = min(max_side / max(source.size), 1.0)
        width = max(64, round(source.width * scale / 64) * 64)
        height = max(64, round(source.height * scale / 64) * 64)
        model_image = source.resize((width, height), Image.Resampling.LANCZOS)
        model_mask = generation_mask.resize((width, height), Image.Resampling.NEAREST)
        crop_padding = adaptive_inpaint_context_padding(model_mask, requested_crop_padding, body.get("contextRatio", 0.30))
        region_inputs = [(None, model_image, model_mask, (width, height))]
    semantic_enabled = body.get("processingMode") != "outfit-description" and body.get("semanticCheck", True) is True
    object_label = str(body.get("objectLabel") or "")[:640]
    semantic_before = semantic_inpaint_residual_check(source, mask, removal_target, fill_mode, object_label) if semantic_enabled else {"available": False, "reason": "disabled"}
    resolved = resolve_inpaint_prompts(body, architecture, profile)
    prompt, generated_negative = resolved["prompt"], resolved["generatedNegativePrompt"]
    prompt_trace_context.get()["resolvedSources"] = {"assembledPrompt": prompt, "generatedNegativePrompt": generated_negative, "profile": profile}
    negative = resolved["negativePrompt"]
    update_job(job_id, stage="inpaint-model-loading", model=selected_entry.get("name") if selected_entry else "Default", modelId=selected_model_id or None, modelLoaded=model_was_loaded, inpaintArchitecture=architecture, _event={"type":"model.loading", "message":"Model đã có trong bộ nhớ" if model_was_loaded else f"Bắt đầu nạp model {architecture.upper()}"})
    pipe = load_inpaint_pipe(report_model_load, selected_model_path, architecture)
    pipe._atelier_model_path = str(selected_model_path.resolve())
    pipe._atelier_architecture = architecture
    update_job(job_id, currentVramMb=round(torch.cuda.memory_allocated() / (1024 * 1024), 1) if torch.cuda.is_available() else 0)
    results = []
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    run_id = f"inpaint_{Path(str(body.get('sampleId'))).stem}_{stamp}"
    run_dir = OUTPUTS / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    composite_mask.save(run_dir / "editable_mask.png")
    mask.save(run_dir / "removal_mask.png")
    generation_mask.save(run_dir / "generation_mask.png")
    if protected is not None:
        protected.save(run_dir / "protected_mask.png")
    garment_removal = removal_target in ("outfit", "shirt", "pants")
    requested_retries = int(body.get("maxAutoRetries", profile.get("maximumRetries", 1)))
    max_auto_retries = max(0, min(2, requested_retries)) if body.get("processingMode") != "outfit-description" and body.get("autoRetry", True) is not False else 0
    maximum_attempts = count + max_auto_retries
    attempted_variants = 0
    completed_work = 0
    for index in range(maximum_attempts):
        if index >= count and not any(item["removalCheck"].get("retryRecommended") for item in sorted(results, key=removal_rank)[:count]):
            break
        ensure_job_active(job_id)
        attempted_variants += 1
        run_seed = seed + index
        generator = torch.Generator(device="cpu").manual_seed(run_seed)
        retrying = index >= count
        attempt_prompt = prompt + (prompt_text('inpaint.this_is_a_corrective_retry_make_the') if retrying and body.get("confirmedPrompts") is None else "")
        attempt_negative = build_inpaint_negative_prompt(removal_target, fill_mode, retrying, ", ".join(filter(None, [forbidden_replacement, str(body.get("negativePrompt") or "")])))
        if body.get("processingMode") == "outfit-description" or body.get("confirmedPrompts") is not None or fill_mode in ("background", "base_layer", "reconstruct_body"):
            attempt_negative = negative
        if retrying and body.get("confirmedPrompts") is None and fill_mode in ("background", "base_layer", "reconstruct_body"):
            attempt_prompt = prompt + prompt_text('inpaint.match_the_surrounding_surface_continuously_across_the')
        elif retrying and body.get("confirmedPrompts") is None and not bool(profile.get("supportsNegativePrompt", architecture != "flux")):
            attempt_prompt += prompt_template("correctiveExclusions", negative=attempt_negative)
        retry_increment = float(profile.get("retryStrengthIncrement", 0.08))
        attempt_strength = strength if body.get("confirmedPrompts") is not None else min(1.0, strength + (retry_increment if retrying else 0.0))
        region_steps = max(1, int(steps * attempt_strength))
        effective_steps = region_steps * len(region_inputs)
        planned_work = completed_work + (maximum_attempts-index)*effective_steps
        update_job(job_id, stage="inpaint-generating", currentVariant=index + 1, totalVariants=maximum_attempts, currentStep=0, totalSteps=effective_steps, completedSteps=completed_work, totalWorkSteps=planned_work, seed=run_seed, autoRetry=retrying, _event={"type":"variant.started", "message":f"{'Tự thử lại' if retrying else 'Bắt đầu phương án'} {index + 1}/{maximum_attempts} · seed {run_seed}", "seed":run_seed})
        preview_interval = max(2, effective_steps // 6)
        preview_path = run_dir / f"preview_seed_{run_seed}.jpg"
        def on_step_end(pipeline, step_index, timestep, callback_kwargs):
            ensure_job_active(job_id)
            completed_step = region_index * region_steps + min(region_steps, int(step_index) + 1)
            vram = round(torch.cuda.memory_allocated() / (1024 * 1024), 1) if torch.cuda.is_available() and (completed_step == 1 or completed_step == effective_steps or completed_step % 3 == 0) else None
            progress_change = {"currentVramMb":vram} if vram is not None else {}
            if body.get("livePreview", True) is not False and (completed_step == 1 or completed_step == effective_steps or completed_step % preview_interval == 0):
                if save_diffusion_preview(pipeline, callback_kwargs.get("latents"), preview_path, region_image.width, region_image.height):
                    progress_change["preview"] = {"file":str(preview_path.relative_to(ROOT)), "step":completed_step,
                                                  "variant":index + 1, "updatedAt":datetime.now(timezone.utc).isoformat()}
            update_job(job_id, stage="inpaint-generating", currentVariant=index + 1, totalVariants=maximum_attempts, currentStep=completed_step, totalSteps=effective_steps, completedSteps=completed_work + completed_step, totalWorkSteps=planned_work, seed=run_seed, regionIndex=region_index+1, regionCount=len(region_inputs), **progress_change)
            return callback_kwargs
        generated = source.copy()
        for region_index, (region_box, region_image, region_mask, unpadded_size) in enumerate(region_inputs):
            ensure_job_active(job_id)
            call_kwargs = {
                "prompt": attempt_prompt, "image": region_image, "mask_image": region_mask, "height": region_image.height, "width": region_image.width,
                "strength": attempt_strength, "num_inference_steps": steps, "guidance_scale": guidance, "generator": generator,
                "callback_on_step_end": on_step_end, "callback_on_step_end_tensor_inputs": ["latents"],
            }
            if not bool(profile.get("supportsNegativePrompt", architecture != "flux")):
                call_kwargs["prompt_2"] = attempt_prompt
                if architecture == "flux" and fill_mode in ("base_layer", "reconstruct_body", "background"):
                    from prompt_limits import split_flux_prompts
                    text_inputs, budget_info = split_flux_prompts(pipe, attempt_prompt)
                    call_kwargs.update(text_inputs)
                    prompt_trace_context.get()["resolvedSources"] = {**prompt_trace_context.get().get("resolvedSources", {}), **budget_info}
            else:
                call_kwargs.update({"negative_prompt": attempt_negative, "padding_mask_crop": None if local_removal else crop_padding or None})
            with torch.inference_mode():
                patch = traced_pipeline_call(pipe, **call_kwargs).images[0]
            if region_box is not None:
                generated.paste(restore_region(patch, region_box, unpadded_size), region_box[:2])
            else:
                generated = patch.resize(source.size, Image.Resampling.LANCZOS)
        completed_work += effective_steps
        update_job(job_id, stage="inpaint-blending", postprocessPhase="edge-blend", currentVariant=index + 1, totalVariants=maximum_attempts, currentStep=effective_steps, totalSteps=effective_steps, completedSteps=completed_work, totalWorkSteps=planned_work, seed=run_seed, _event={"type":"blend.started", "message":f"Đang ghép biên phương án {index + 1}"})
        generated = generated.resize(source.size, Image.Resampling.LANCZOS)
        if local_removal:
            from object_removal import match_simple_background
            generated, background_match = match_simple_background(source, generated, composite_mask, protected)
            composited, edge_artifacts, edge_metrics = blend_removal(source, generated, mask, composite_mask, protected)
            edge_metrics['backgroundMatch'] = background_match
        else:
            composited, edge_artifacts, edge_metrics = adaptive_local_edge_blend(source, generated, composite_mask, edge_feather)
        texture_baseline = composited.copy()
        texture_amount = max(0.0, min(1.0, float(body.get("textureRecoveryAmount", 0.65))))
        texture_enabled = body.get("textureRecovery", not local_removal) is not False
        update_job(job_id, stage="inpaint-texture-recovery", postprocessPhase="texture-recovery", _event={"type":"postprocess.texture.started", "message":f"Đang phục hồi chi tiết ảnh phương án {index + 1}"})
        composited, texture_core, texture_metrics = texture_preserving_core_recovery(
            composited, composite_mask, edge_feather, texture_amount if texture_enabled else 0.0
        )
        structural_baseline = composited.copy()
        structural_enabled = body.get("structuralRefine", False) is True and not local_removal
        if local_removal:
            structural_mask = Image.new("L", source.size)
            structural_metrics = {"detected": False, "applied": False, "reason": "garment-only-check", "artifactPixels": 0}
        elif structural_enabled:
            update_job(job_id, stage="inpaint-structural-refine", postprocessPhase="structural-refine", _event={"type":"postprocess.structure.started", "message":f"Đang tinh chỉnh cấu trúc phương án {index + 1}"})
            composited, structural_mask, structural_metrics = generative_core_structural_refine(
                composited, composite_mask, run_seed, int(body.get("structuralSteps", 14)), edge_feather
            )
        else:
            update_job(job_id, stage="inpaint-structural-analysis", postprocessPhase="structural-analysis", _event={"type":"postprocess.structure.started", "message":f"Đang kiểm tra lỗi cấu trúc phương án {index + 1}"})
            structural_mask, structural_metrics = detect_core_structural_artifacts(composited, composite_mask, edge_feather)
            structural_metrics.update({"applied": False, "reason": "disabled"})
        source_array = np.asarray(source, dtype=np.int16)
        result_array = np.asarray(composited, dtype=np.int16)
        outside = np.asarray(composite_mask, dtype=np.uint8) == 0
        outside_mae = float(np.abs(result_array - source_array)[outside].mean() / 255.0) if outside.any() else 0.0
        removal_check = inpaint_removal_check(source, composited, mask, removal_target)
        removal_check["structuralArtifact"] = structural_metrics
        if garment_removal and not local_removal and structural_metrics.get("detected"):
            removal_check["accepted"] = False
            removal_check["status"] = "residual-structure"
            removal_check["statusLabel"] = "Còn đường may, cúc hoặc cấu trúc giống trang phục"
            removal_check["retryRecommended"] = True
        if semantic_enabled:
            semantic_check = semantic_inpaint_residual_check(composited, mask, removal_target, fill_mode, object_label)
            removal_check = assess_removal(removal_check, semantic_before, semantic_check, outside_mae)
        removal_check["boundaryError"] = boundary_metric(source, composited, composite_mask)
        output_name = f"result_seed_{run_seed}.png"
        texture_baseline_name = f"texture_baseline_seed_{run_seed}.png"
        texture_baseline.save(run_dir / texture_baseline_name)
        structural_baseline_name = f"structural_baseline_seed_{run_seed}.png"
        structural_baseline.save(run_dir / structural_baseline_name)
        update_job(job_id, stage="inpaint-saving", postprocessPhase="saving-images", _event={"type":"postprocess.saving", "message":f"Đang lưu ảnh phương án {index + 1}"})
        composited.save(run_dir / output_name)
        edge_artifacts.save(run_dir / f"edge_artifacts_seed_{run_seed}.png")
        texture_core.save(run_dir / f"texture_core_seed_{run_seed}.png")
        structural_mask.save(run_dir / f"structural_artifacts_seed_{run_seed}.png")
        results.append({"seed": run_seed, "image": encode_image(composited), "outsideMaskMAE": outside_mae, "removalCheck": removal_check, "autoRetry": retrying, "effectiveStrength": attempt_strength, "negativePromptApplied": bool(profile.get("supportsNegativePrompt", architecture != "flux")), "edgeBlend": edge_metrics, "textureRecovery": texture_metrics, "textureBaseline": str((run_dir / texture_baseline_name).relative_to(ROOT)), "structuralRefine": structural_metrics, "structuralBaseline": str((run_dir / structural_baseline_name).relative_to(ROOT))})
        update_job(job_id, stage="inpaint-variant-complete", currentVariant=index + 1, totalVariants=maximum_attempts, _result={"kind":"inpaint", "sampleId":str(body.get("sampleId")), "seed":run_seed, "file":str((run_dir / output_name).relative_to(ROOT)), "outsideMaskMAE":round(outside_mae,6), "removalCheck":removal_check, "edgePixels":int(edge_metrics.get("edgePixels",0) or 0)}, _event={"type":"variant.completed", "message":f"Phương án {index + 1}/{maximum_attempts} đã hoàn tất · {removal_check['statusLabel']} · seed {run_seed}", "seed":run_seed})
    results.sort(key=removal_rank)
    results = results[:count]
    update_job(job_id, stage="inpaint-saving", postprocessPhase="saving-metadata", _event={"type":"saving.started", "message":"Đang lưu metadata và chuẩn bị màn hình so sánh"})
    lora_metadata = [{key: value for key, value in item.items() if key != "path"} for item in model_state.active_loras if item.get("modelPath") == str(selected_model_path.resolve())]
    metadata = {
        "promptHistory": prompt_history(),
        "schemaVersion": 1, "runId": run_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": str(body.get("sampleId")), "prompt": prompt,
        "processingMode": body.get("processingMode", "inpaint"),
        "removalTarget": removal_target, "fillMode": fill_mode, "forbiddenReplacement": forbidden_replacement,
        "negativePrompt": negative, "negativePromptApplied": bool(profile.get("supportsNegativePrompt", architecture != "flux")), "negativePromptStrategy": "direct" if bool(profile.get("supportsNegativePrompt", architecture != "flux")) else "merged-into-positive" if "Avoid these failure modes:" in prompt else "unused", "seed": seed, "count": count,
        "steps": steps, "requestedSteps": step_policy["requestedSteps"], "effectiveSteps": step_policy["effectiveSteps"],
        "minimumEffectiveSteps": step_policy["minimumEffectiveSteps"], "stepsAutoAdjusted": step_policy["autoAdjusted"],
        "strength": strength, "guidance": guidance,
        "expand": expand, "blur": blur, "edgeFeather": edge_feather,
        "requestedCropPadding": requested_crop_padding, "cropPadding": crop_padding,
        "dualMask": dual_mask_metrics, "contextRatio": float(body.get("contextRatio", 0.30)),
        "textureRecovery": texture_enabled, "textureRecoveryAmount": texture_amount,
        "structuralRefine": structural_enabled, "structuralSteps": int(body.get("structuralSteps", 14)),
        "model": str(selected_model_path), "modelId": selected_model_id or None, "modelName": selected_entry.get("name") if selected_entry else "Default", "inpaintArchitecture": architecture, "device": device,
        "modelProfile": profile, "useModelProfile": use_model_profile,
        "modelWidth": width, "modelHeight": height,
        "sourceWidth": source.width, "sourceHeight": source.height,
        "localRemoval": local_removal, "objectLabel": object_label,
        "removalConditioning": "local-prefill-v1" if local_removal else "original",
        "regions": [{"box": box, "modelSize": list(image.size), "unpaddedSize": list(size)} for box, image, _, size in region_inputs],
        "semanticBefore": semantic_before,
        "totalEffectiveSteps": completed_work,
        "loras": lora_metadata,
        "removalChecks": [{"seed": item["seed"], **item["removalCheck"]} for item in results],
        "autoRetry": {"enabled": max_auto_retries > 0, "maximum": max_auto_retries, "attemptedVariants": attempted_variants},
    }
    (run_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    passed_count = sum(1 for item in results if item["removalCheck"]["accepted"])
    # Keep the requested model even when no candidate passes validation.
    duration_seconds = round(time.perf_counter() - started_at, 3)
    peak_vram_mb = round(torch.cuda.max_memory_allocated() / (1024 * 1024), 1) if torch.cuda.is_available() else 0.0
    update_job(job_id, status="completed", stage="done", currentVariant=attempted_variants, totalVariants=attempted_variants, completedSteps=completed_work, totalWorkSteps=completed_work, durationSeconds=duration_seconds, peakVramMb=peak_vram_mb, directory=str(run_dir.relative_to(ROOT)), _event={"type":"job.completed", "message":f"Đã tạo {count} phương án; {passed_count}/{count} vượt kiểm tra nhận diện; cần xem lại chất lượng nền. {duration_seconds:.1f} giây"})
    return {"ok": True, "promptHistory": prompt_history(), "results": results, "width": source.width, "height": source.height, "device": device, "directory": str(run_dir.relative_to(ROOT)), "modelId": selected_model_id or None, "modelName": selected_entry.get("name") if selected_entry else "Default", "loras": lora_metadata, "stepPolicy": step_policy, "removalTarget": removal_target, "fillMode": fill_mode, "removalPassed": passed_count, "attemptedVariants": attempted_variants, "regionCount": len(region_inputs), "effectiveSettings": settings}


def adetailer_refine(body: dict) -> dict:
    detected = detect_regions({**body, "model": "adetailer", "padding": body.get("padding", 12)})
    if not detected["count"]:
        raise ValueError("ADetailer không tìm thấy khuôn mặt để tinh chỉnh")
    if "faceIndices" in body:
        selected = set(int(index) for index in body["faceIndices"])
        faces = [item for item in detected["detections"] if item["index"] in selected]
        if not faces:
            raise ValueError("Hãy chọn ít nhất một khuôn mặt")
        combined = np.zeros((detected["height"], detected["width"]), dtype=np.uint8)
        for face in faces:
            combined = np.maximum(combined, np.asarray(decode_image(face["mask"]).convert("L")))
        detected["mask"] = encode_image(Image.fromarray(combined, mode="L"))
        detected["count"] = len(faces)
    request = {**body, "editableMask": detected["mask"], "prompt": body.get("prompt") or prompt_text('adetailer_refine.highly_detailed_natural_face_preserve_identity_realistic'), "negativePrompt": body.get("negativePrompt") or prompt_text('adetailer_refine.changed_identity_deformed_face_extra_eyes_blur'), "strength": body.get("strength", 0.35), "count": body.get("count", 1), "expand": 0, "blur": body.get("blur", 4)}
    result = inpaint(request)
    result["detector"] = {key: value for key, value in detected.items() if key != "mask"}
    return result
