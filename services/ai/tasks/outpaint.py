from services.ai.runtime.tracing import trace_generation
"""AI Atelier: tasks.outpaint."""
from PIL import Image, ImageFilter, ImageOps
from datetime import datetime, timezone
from pathlib import Path
from prompt_catalog import prompt_text, prompt_template, read_catalog, task_prompt
import cv2
import json
import numpy as np
import time
import torch
from services.ai.imaging.segmentation import automatic_protected_detail_mask, decode_mask, detect_people_pose, encode_image, safe_sample
from services.ai.models.pipelines import birefnet_mask, detect_inpaint_architecture, inpaint_model_entry, load_inpaint_pipe, load_predictor, release_inpaint
from services.ai.models import state as model_state
from services.ai.runtime.configuration import INPAINT_MODEL, OUTPUTS, ROOT, device
from services.ai.runtime.jobs import ensure_job_active, persist_job_request, update_job
from services.ai.runtime.tracing import prompt_history, traced_pipeline_call
from services.ai.tasks.inpaint import resolved_inpaint_profile


def outpaint_pipeline_kwargs(architecture, *, prompt, negative, image, mask, width, height,
                             steps, guidance, generator, callback, prompt_cache=None,
                             control_scale=1.0, strength=1.0):
    """Translate the shared outpaint request to the selected pipeline API."""
    if architecture == "qwen-image-controlnet-inpaint":
        return dict(prompt=prompt, negative_prompt=negative, control_image=image, control_mask=mask,
                    width=width, height=height, num_inference_steps=steps, true_cfg_scale=guidance,
                    controlnet_conditioning_scale=max(0.0, min(1.5, float(control_scale))),
                    generator=generator, callback_on_step_end=callback,
                    callback_on_step_end_tensor_inputs=["latents"])
    result = dict(prompt=prompt, image=image, mask_image=mask, width=width, height=height,
                  strength=strength, num_inference_steps=steps, guidance_scale=guidance,
                  generator=generator, callback_on_step_end=callback,
                  callback_on_step_end_tensor_inputs=["latents"])
    if prompt_cache is not None:
        result['_prompt_cache'] = prompt_cache
    return result


def outpaint_semantics(source, manual=None):
    """Conservative labels: separate SAM clothing, BiRefNet background and identity."""
    foreground = None
    garment = np.zeros((source.height,source.width),dtype=np.uint8)
    protected = np.zeros_like(garment)
    warnings = []
    try:
        foreground = birefnet_mask(source)
    except Exception as error:
        warnings.append("Không tách được nền: "+str(error)[:160])
    try:
        people = detect_people_pose(source)
    except Exception as error:
        people = []
        warnings.append("Không xác định được vùng bảo vệ tự động: "+str(error)[:160])
    for person in people:
        box, points = person['box'], person.get('keypoints')
        protected = np.maximum(protected,np.asarray(automatic_protected_detail_mask(source,box,points)))
    if foreground is None:
        # Unknown foreground: disable background editing rather than guessing.
        foreground = Image.new('L',source.size,255)
        warnings.append("Không có mask nền; bỏ qua sửa nền")
    if not people:
        protected = np.maximum(protected,np.asarray(foreground))
        warnings.append("Không có vùng bảo vệ khuôn mặt đáng tin cậy; chỉ sửa nền")
    protected[np.asarray(foreground)<16]=0
    # Protect visible skin as well as detected head/hair and hands.
    rgb=np.asarray(source.convert('RGB'))
    skin=cv2.inRange(cv2.cvtColor(rgb,cv2.COLOR_RGB2YCrCb),np.array([0,133,77],dtype=np.uint8),np.array([255,173,127],dtype=np.uint8))
    warm=(rgb[:,:,0].astype(np.int16)>rgb[:,:,1].astype(np.int16)+5)&(rgb[:,:,1].astype(np.int16)>rgb[:,:,2].astype(np.int16)+2)
    skin[~warm]=0
    skin[np.asarray(foreground)<16]=0
    protected=np.maximum(protected,skin)
    if manual is not None: protected=np.maximum(protected,np.asarray(manual.convert('L')))
    if people:
        try:
            model=load_predictor()
            with torch.inference_mode(),torch.autocast(device_type=device,dtype=torch.bfloat16,enabled=device=='cuda'):
                model.set_image(rgb.copy())
                for person in people:
                    x0,y0,x1,y1=person['box']
                    # A portrait may cut through clothing at the image boundary.
                    # Do not clip segmentation to the 96% body box used by try-on.
                    x0=0 if x0<source.width*.04 else x0
                    y0=0 if y0<source.height*.04 else y0
                    x1=source.width if x1>source.width*.96 else x1
                    y1=source.height if y1>source.height*.96 else y1
                    valid=(np.asarray(foreground)>223)&(protected==0)
                    allowed=np.zeros_like(valid);allowed[int(y0):int(y1),int(x0):int(x1)]=True
                    valid &= allowed
                    distance=cv2.distanceTransform(valid.astype(np.uint8),cv2.DIST_L2,5)
                    coords=[]
                    for _ in range(3):
                        _,maximum,_,point=cv2.minMaxLoc(distance)
                        if maximum<3: break
                        coords.append(point)
                        cv2.circle(distance,point,max(16,round(min(source.size)*.15)),0,-1)
                    if not coords: continue
                    proposals,scores,_=model.predict(point_coords=np.asarray(coords,dtype=np.float32),
                        point_labels=np.ones(len(coords),dtype=np.int32),box=np.asarray([x0,y0,x1,y1],dtype=np.float32),multimask_output=True)
                    proposals=np.asarray(proposals)>0
                    coverage=np.array([(proposal&valid).sum()/max(1,valid.sum()) for proposal in proposals])
                    best=int(np.argmax(scores+coverage))
                    if scores[best]<.5 or coverage[best]<.2:
                        warnings.append('Mask trang phục thiếu độ tin cậy; bỏ qua vùng này')
                        continue
                    garment=np.maximum(garment,np.uint8(proposals[best]&valid)*255)
        except Exception as error:
            warnings.append('Không tách được trang phục: '+str(error)[:160])
    garment[protected>0]=0
    return foreground,Image.fromarray(garment),Image.fromarray(protected),warnings


@trace_generation
def outpaint(body: dict) -> dict:
    from outpainting import (prepare_canvas, prepare_inference, composite_canvas, integer, detail_regions,
                            PatchAccumulator, seam_band, semantic_seam_masks, repair_regions,
                            multiband_background, restore_source_core, seam_metrics, feather_seam_result,
                            preserve_fabric_texture, equalize_background_seams,
                            material_detail_masks, finish_materials, background_reference_mask)
    from outpaint_quality import (choose_refinement, exclude_source, tile_mask, load_layout,
                                  source_fingerprint, PromptEmbeddingCache)
    from PIL import ImageOps
    started = time.perf_counter()
    job_id = str(body.get("jobId", ""))[:80]
    source = ImageOps.exif_transpose(Image.open(safe_sample(str(body.get("sampleId", ""))))).convert("RGB")
    canvas_image, mask, geometry = prepare_canvas(source, body)
    run_mode = body.get('runMode', 'complete')
    if run_mode not in ('complete', 'layout', 'refine'):
        raise ValueError('Chế độ mở rộng ảnh không hợp lệ.')
    saved_layout = None
    if run_mode == 'refine':
        saved_layout, layout_metadata = load_layout(ROOT, OUTPUTS, body.get('refineFrom'),
                                                    str(body.get('sampleId', '')), source, geometry)
    count = integer(body.get("count", 1), "Số phương án", 1, 4)
    steps = integer(body.get("steps", 30), "Số bước", 4, 80)
    seed = integer(body.get("seed", 42), "Seed", 0, 2147483647)
    if saved_layout is not None:
        count, seed = 1, integer(body['refineFrom']['seed'], 'Seed', 0, 2147483647)
    if seed + count - 1 > 2147483647:
        raise ValueError('Seed cuối vượt giới hạn; hãy giảm seed hoặc số phương án.')
    max_side = integer(body.get("maxSide", 768), "Độ phân giải AI", 512, 1024)
    guidance = float(body.get("guidance", 5))
    if not np.isfinite(guidance) or not 1 <= guidance <= 30:
        raise ValueError("Guidance phải từ 1 đến 30")
    user_prompt = str(body.get("prompt") or "").strip()
    user_negative = str(body.get("negativePrompt") or "").strip()
    if max(len(user_prompt), len(user_negative)) > 16000:
        raise ValueError("Mô tả quá dài; tối đa 16000 ký tự")
    prompt = " ".join(filter(None, [task_prompt("outpaint"), user_prompt]))
    negative = ", ".join(filter(None, [task_prompt("outpaint", "negative"), user_negative]))
    model_id = str(body.get("modelId") or "")
    entry = inpaint_model_entry(model_id or None)
    model_path = Path(str(entry["path"])) if entry else INPAINT_MODEL
    if not model_path.is_absolute():
        model_path = ROOT / model_path
    architecture = detect_inpaint_architecture(model_path, entry.get("architecture") if entry else None)
    if architecture not in ("sd3", "sd35", "sdxl", "sd15", "sd2", "flux", "qwen-image-controlnet-inpaint"):
        raise ValueError("Model chưa hỗ trợ Outpainting")
    if architecture=='flux':
        from prompt_limits import split_flux_prompts
    profile = resolved_inpaint_profile(entry, architecture)
    if "steps" not in body:
        steps = int(profile.get("steps", 50 if architecture == "flux" else 30))
    if "guidance" not in body:
        guidance = float(profile.get("guidance", 30.0 if architecture == "flux" else 5.0))
    if "maxSide" not in body:
        max_side = int(profile.get("nativeResolution", 1024 if architecture == "flux" else max_side))
    max_side = min(max_side, int(profile.get("nativeResolution", 1024)))
    detail = body.get("detailPass", False)
    if not isinstance(detail, bool):
        raise ValueError("Chế độ tăng chi tiết không hợp lệ")
    material_refine=body.get('materialRefine',False)
    source_enhance=body.get('sourceEnhance',False)
    background_continuity=body.get('backgroundContinuity',False)
    if not isinstance(background_continuity,bool):
        raise ValueError('Chế độ đồng bộ nền không hợp lệ')
    if background_continuity and not geometry['preserveOriginal']:
        raise ValueError('Bật Giữ nguyên ảnh gốc để đồng bộ nền hẹp')
    if not isinstance(material_refine,bool) or not isinstance(source_enhance,bool):
        raise ValueError('Chế độ hoàn thiện chất liệu không hợp lệ')
    if source_enhance and geometry['preserveOriginal']:
        raise ValueError('Tắt Giữ nguyên ảnh gốc trước khi bật Hoàn thiện ảnh gốc')
    material_refine=material_refine and detail
    fabric_steps=integer(body.get('fabricSteps',40),'Số bước phục hồi vải',10,60)
    fabric_strength=.45
    effective_fabric_steps=max(1,fabric_steps-int(fabric_steps*(1-fabric_strength))
                               if architecture=='flux' else int(fabric_steps*fabric_strength))
    detail_steps = integer(body.get("detailSteps", 20), "Số bước tăng chi tiết", 4, 50)
    detail_strength = .35
    effective_detail_steps = max(1, detail_steps - int(detail_steps * (1 - detail_strength))
                                 if architecture == "flux" else int(detail_steps * detail_strength))
    seam = body.get('seamRepair',False)
    if not isinstance(seam,bool): raise ValueError('Chế độ sửa đường nối không hợp lệ')
    if run_mode == 'layout':
        detail = material_refine = source_enhance = seam = False
    seam_width = integer(body.get('seamWidth',48),'Dải sửa đường nối',8,128)
    requested_seam_width=seam_width
    seam_width=min(seam_width,max(1,source.width//4) if geometry['left'] or geometry['right'] else seam_width,
                   max(1,source.height//4) if geometry['top'] or geometry['bottom'] else seam_width)
    seam_steps = integer(body.get('seamSteps',40),'Số bước sửa đường nối',4,80)
    seam_strength = .4
    effective_seam_steps = max(1,seam_steps-int(seam_steps*(1-seam_strength))
                               if architecture=='flux' else int(seam_steps*seam_strength))
    protected = Image.new('L',source.size,0)
    manual = decode_mask(str(body['protectedDetailMask']),source.size) if body.get('protectedDetailMask') and (seam or source_enhance or material_refine) else None
    if manual is not None: protected=manual.copy()
    semantic_warnings, semantic_masks, seam_work = [], {}, []
    foreground = garment = None
    if seam or source_enhance:
        foreground,garment,protected,semantic_warnings = outpaint_semantics(source,manual)
    if background_continuity and foreground is None:
        foreground=birefnet_mask(source)
    if seam:
        semantic_masks = semantic_seam_masks(geometry,seam_width,foreground,garment,protected)
        seam_work = [(kind,box,region_mask) for kind,region_mask in semantic_masks.items()
                     for box in repair_regions(region_mask,max_side)]
    layout_steps = 0 if saved_layout is not None else steps
    regions = []
    variant_steps = layout_steps + len(seam_work)*effective_seam_steps
    # Reserve an upper bound until generated-image labels reveal the real work.
    estimated_tiles=(int(np.ceil(max(0,geometry['width']-max_side)/max(1,max_side*3//4)))+1)*(
                     int(np.ceil(max(0,geometry['height']-max_side)/max(1,max_side*3//4)))+1)
    estimated_variant_steps=variant_steps+estimated_tiles*((effective_detail_steps if detail else 0)+
                                                          (effective_fabric_steps if material_refine else 0))
    variant_steps=estimated_variant_steps
    model_image, model_mask, model_crop = prepare_inference(canvas_image, mask, max_side)
    width, height = model_image.size
    request_file = persist_job_request(job_id, "outpaint", body)
    update_job(job_id, status="running", taskType="outpaint", stage="inpaint-validating",
               sourceId=str(body.get("sampleId", "")), width=geometry["width"], height=geometry["height"],
               totalVariants=count, totalWorkSteps=count * variant_steps, modelId=model_id,
               warnings=semantic_warnings,
               seamRepair=seam,detailPass=detail,materialRefine=material_refine,sourceEnhance=source_enhance,
               model=entry.get("name") if entry else "Default", resumable=bool(request_file),
               requestFile=str(request_file.relative_to(ROOT)) if request_file else None,
               _event={"type":"outpaint.started", "message":"Đang chuẩn bị khung mở rộng ảnh"})
    ensure_job_active(job_id)
    if model_state.inpaint_pipe is not None and (getattr(model_state.inpaint_pipe, "_atelier_model_path", None) != str(model_path.resolve()) or getattr(model_state.inpaint_pipe, "_atelier_architecture", None) != architecture):
        release_inpaint()
    def report(phase, message):
        ensure_job_active(job_id)
        update_job(job_id, stage="inpaint-model-loading", _event={"type":"model.loading", "message":message})
    try:
        pipe = load_inpaint_pipe(report, model_path, architecture)
    except Exception as error:
        if "out of memory" in str(error).lower():
            release_inpaint()
            raise ValueError("GPU hết bộ nhớ khi nạp model. Hãy chọn model nhỏ hơn hoặc đóng ứng dụng đang dùng GPU.") from error
        raise
    pipe._atelier_model_path = str(model_path.resolve())
    pipe._atelier_architecture = architecture
    embedding_cache = PromptEmbeddingCache(pipe)
    supports_negative = bool(profile.get("supportsNegativePrompt", architecture != "flux"))
    if not supports_negative and negative:
        prompt += " " + prompt_template("correctiveExclusions", negative=negative)
    stage_prompts = {}
    requested_stages = []
    if body.get('seamRepair', False): requested_stages += ['outpaint.seam.background', 'outpaint.seam.garment']
    if body.get('detailPass', False): requested_stages += ['outpaint.detail']
    if body.get('detailPass', False) and body.get('materialRefine', False): requested_stages += ['outpaint.material']
    for key in requested_stages:
        text = ' '.join(filter(None, [task_prompt(key), user_prompt]))
        if not supports_negative and negative:
            text += ' ' + prompt_template('correctiveExclusions', negative=negative)
        stage_prompts[key] = text
    # Validate all requested passes before generating a layout, including the
    # later finish of a layout-only request. Never silently discard user text.
    from prompt_limits import validate_prompt_limits
    for key, text in {'outpaint': prompt, **stage_prompts}.items():
        inputs = {'prompt': text}
        if supports_negative: inputs['negative_prompt'] = negative
        elif architecture == 'flux': inputs.update(split_flux_prompts(pipe, text)[0])
        else: inputs['prompt_2'] = text
        try:
            validate_prompt_limits(pipe, inputs)
        except ValueError as error:
            raise ValueError(f'Hướng dẫn bước {key} quá dài: {error}') from error
    ensure_job_active(job_id)
    run_dir = OUTPUTS / ("outpaint_" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
    run_dir.mkdir(parents=True, exist_ok=False)
    canvas_image.save(run_dir / "source_canvas.png")
    mask.save(run_dir / "generation_mask.png")
    if seam or source_enhance:
        foreground.save(run_dir/'foreground_mask.png');garment.save(run_dir/'garment_mask.png')
        protected.save(run_dir/'protected_mask.png')
        for kind,region_mask in semantic_masks.items(): region_mask.save(run_dir/f'seam_{kind}_mask.png')
    metadata = dict(schemaVersion=2, taskType="outpaint", source=str(body.get("sampleId")),
                    sourceFingerprint=source_fingerprint(source),runMode=run_mode,
                    refineFrom=body.get('refineFrom') if saved_layout is not None else None,
                    request={k:v for k,v in body.items() if k not in ('jobId','refineFrom','runMode')},
                    qualityPolicy='conservative-regression-guards-v1',
                    inferenceGeometry='rectangular-pixel-budget',
                    memoryMode=getattr(pipe,'_atelier_offload','model'),
                    createdAt=datetime.now(timezone.utc).isoformat(), geometry=geometry,
                    prompt=prompt, negativePrompt=negative, userPrompt=user_prompt,
                    modelId=model_id, model=str(model_path), architecture=architecture,
                    modelWidth=width, modelHeight=height, modelCrop=list(model_crop), seed=seed, count=count, steps=steps,
                    guidance=guidance, strength=1.0, negativePromptApplied=supports_negative,
                    detailPass=detail, detailSteps=detail_steps, detailStrength=detail_strength,
                    materialRefine=material_refine,sourceEnhance=source_enhance,
                    fabricSteps=fabric_steps,fabricStrength=fabric_strength,
                    effectiveFabricSteps=effective_fabric_steps,materialVariants=[],
                    effectiveDetailSteps=effective_detail_steps, detailRegions=[list(box) for box in regions],
                    seamRepair=seam,seamWidth=seam_width,requestedSeamWidth=requested_seam_width,
                    seamSteps=seam_steps,seamStrength=seam_strength,
                    semanticWarnings=semantic_warnings,patchCompositing='immutable-base-normalized-weights',
                    seamBlend='multiband-background-and-feathered-semantic-band',
                    garmentTexture='single-patch-detail-donor-and-original-source-frequencies',
                    seamRegions=[{'kind':kind,'box':list(box)} for kind,box,_ in seam_work],
                    compositing="semantic-seam-multiband-and-protected-core" if seam else "source-paste-with-additive-edge-colour-match",
                    results=[], status="running")
    metadata_path = run_dir / "metadata.json"
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    results = []
    completed_work=0
    try:
        for index in range(count):
            ensure_job_active(job_id)
            variant_steps=estimated_variant_steps
            run_seed = seed + index
            quality_checks = []
            variant_protected = protected.copy()
            update_job(job_id, stage="inpaint-generating", currentVariant=index + 1,
                       currentStep=0, totalSteps=variant_steps, completedSteps=completed_work, seed=run_seed)
            pass_offset, pass_steps = 0, steps
            def on_step(pipeline, step_index, timestep, callback_kwargs):
                ensure_job_active(job_id)
                done = pass_offset + min(pass_steps, int(step_index) + 1)
                update_job(job_id, currentStep=done, completedSteps=completed_work + done)
                return callback_kwargs
            kwargs = outpaint_pipeline_kwargs(architecture,prompt=prompt,negative=negative,image=model_image,
                          mask=model_mask,width=width,height=height,steps=steps,guidance=guidance,
                          generator=torch.Generator(device="cpu").manual_seed(run_seed),callback=on_step,
                          prompt_cache=embedding_cache,control_scale=body.get('controlScale',1.0))
            if architecture == "qwen-image-controlnet-inpaint":
                pass
            elif supports_negative:
                kwargs.update(negative_prompt=negative, padding_mask_crop=None)
            else:
                kwargs["prompt_2"] = prompt
                if architecture == "flux":
                    from prompt_limits import split_flux_prompts
                    text_inputs, _ = split_flux_prompts(pipe, prompt)
                    kwargs.update(text_inputs)
            if saved_layout is None:
                with torch.inference_mode():
                    generated = traced_pipeline_call(pipe, **kwargs).images[0]
                result = composite_canvas(source, generated.crop(model_crop), {**geometry,'preserveOriginal':True} if seam or run_mode=='layout' else geometry)
            else:
                result = saved_layout.copy()
                result.paste(source,(geometry['left'],geometry['top']))
            ensure_job_active(job_id)
            update_job(job_id, stage="outpaint-layout-ready")
            overview_metrics = seam_metrics(source,result,geometry,protected)
            result.save(run_dir / f"overview_seed_{run_seed}.png")
            protected_canvas = Image.new('L',result.size,0)
            protected_canvas.paste(protected,(geometry['left'],geometry['top']))
            def guarded(before, candidate, editable, phase, locked=None):
                chosen, check = choose_refinement(before,candidate,geometry,editable,
                                                  locked if locked is not None else protected_canvas,phase)
                quality_checks.append(check)
                if not check['accepted']:
                    labels={'seam':'sửa đường nối','background':'tăng chi tiết nền','garment':'phục hồi vải','finish':'hoàn thiện'}
                    warning=f"Giữ bản trước bước {labels.get(phase,phase)} vì phát hiện thay đổi bất lợi."
                    if warning not in semantic_warnings: semantic_warnings.append(warning)
                    update_job(job_id,warnings=semantic_warnings)
                return chosen
            def process_tiles(base, work, phase, offset, schedule_steps, strength, effective_steps):
                nonlocal pass_offset,pass_steps
                accumulator=PatchAccumulator(base)
                for region_index,(kind,box,region_mask) in enumerate(work):
                    ensure_job_active(job_id)
                    pass_offset,pass_steps=offset+region_index*effective_steps,effective_steps
                    update_job(job_id,stage=phase,detailRegion=region_index+1,totalDetailRegions=len(work),
                               _event={'type':'outpaint.seam' if phase=='outpaint-seam-repair' else 'outpaint.detail',
                                       'message':f"{'Sửa đường nối' if phase=='outpaint-seam-repair' else 'Tăng chi tiết'} {kind} · {region_index+1}/{len(work)}"})
                    local_mask=tile_mask(region_mask,box,base.size)
                    tile_image,inference_mask,tile_crop=prepare_inference(base.crop(box),local_mask,max_side)
                    prompt_key=('outpaint.seam.'+kind if phase=='outpaint-seam-repair' else
                                'outpaint.material' if phase=='outpaint-material-refine' else 'outpaint.detail')
                    tile_prompt=stage_prompts[prompt_key]
                    tile_kwargs=outpaint_pipeline_kwargs(architecture,prompt=tile_prompt,negative=negative,
                                     image=tile_image,mask=inference_mask,width=tile_image.width,height=tile_image.height,
                                     steps=schedule_steps,guidance=guidance,strength=strength,callback=on_step,
                                     prompt_cache=embedding_cache,control_scale=body.get('controlScale',1.0),
                                     generator=torch.Generator(device='cpu').manual_seed(run_seed+offset*100+region_index))
                    if supports_negative and architecture != "qwen-image-controlnet-inpaint":
                        tile_kwargs.update(negative_prompt=negative,padding_mask_crop=None)
                    if architecture=='flux': tile_kwargs.update(split_flux_prompts(pipe,tile_prompt)[0])
                    elif not supports_negative: tile_kwargs['prompt_2']=tile_prompt
                    with torch.inference_mode(): patch=traced_pipeline_call(pipe,**tile_kwargs).images[0]
                    ensure_job_active(job_id)
                    accumulator.add(patch.crop(tile_crop),box,local_mask,preserve_texture=kind=='garment')
                return accumulator.finish()
            seam_editable=Image.new('L',canvas_image.size,0)
            if seam_work:
                before_seam=result.copy()
                result=process_tiles(before_seam,seam_work,'outpaint-seam-repair',layout_steps,seam_steps,seam_strength,effective_seam_steps)
                result=multiband_background(before_seam,result,semantic_masks['background'])
                seam_editable=Image.fromarray(np.maximum(np.asarray(semantic_masks['background']),np.asarray(semantic_masks['garment'])))
                result=restore_source_core(source,result,geometry,seam_editable,protected,seam_width)
                result=feather_seam_result(before_seam,result,seam_editable,min(24,max(1,seam_width//2)))
                result=preserve_fabric_texture(source,before_seam,result,geometry,semantic_masks['garment'],protected)
                result=equalize_background_seams(result,geometry,semantic_masks['background'],max(4,seam_width-8),
                                                background_reference_mask(geometry,foreground,protected))
                result=guarded(before_seam,result,seam_editable,'seam')
                result.save(run_dir/f'seam_repaired_seed_{run_seed}.png')
            repaired_metrics=seam_metrics(source,result,geometry,protected,seam_editable if seam else None)
            if detail or material_refine or source_enhance:
                ensure_job_active(job_id)
                update_job(job_id,stage='outpaint-material-refine',
                           _event={'type':'outpaint.material-analysis','message':'Nhận diện vải, nền và vùng cần bảo vệ trên ảnh mới'})
                manual_canvas=Image.new('L',result.size,0)
                manual_canvas.paste(protected,(geometry['left'],geometry['top']))
                full_fg,full_garment,full_protected,variant_warnings=outpaint_semantics(result,manual_canvas)
                ensure_job_active(job_id)
                for warning in variant_warnings:
                    if warning not in semantic_warnings: semantic_warnings.append(warning)
                materials=material_detail_masks(geometry,full_fg,full_garment,full_protected)
                background_mask=exclude_source(materials['background'],geometry,seam_width if seam else 0)
                fabric_mask=materials['garment'] if material_refine else exclude_source(materials['garment'],geometry,seam_width if seam else 0)
                background_regions=detail_regions(background_mask,max_side,include_generated=True) if detail else []
                fabric_regions=detail_regions(fabric_mask,max_side,include_generated=True) if detail else []
                if material_refine and not fabric_regions:
                    warning='Không có vùng vải mới đủ tin cậy; bỏ qua phục hồi vải, vẫn xử lý nền nếu nhận diện được.'
                    if warning not in variant_warnings: variant_warnings.append(warning)
                    if warning not in semantic_warnings: semantic_warnings.append(warning)
                for kind,label in materials.items(): label.save(run_dir/f'material_{kind}_seed_{run_seed}.png')
                full_fg.save(run_dir/f'material_foreground_seed_{run_seed}.png')
                full_garment.save(run_dir/f'material_full_garment_seed_{run_seed}.png')
                full_protected.save(run_dir/f'material_protected_seed_{run_seed}.png')
                cloth_steps=fabric_steps if material_refine else detail_steps
                cloth_strength=fabric_strength if material_refine else detail_strength
                cloth_effective=effective_fabric_steps if material_refine else effective_detail_steps
                variant_steps=layout_steps+len(seam_work)*effective_seam_steps+len(background_regions)*effective_detail_steps+len(fabric_regions)*cloth_effective
                metadata['detailRegions']=[list(box) for box in background_regions]
                update_job(job_id,totalSteps=variant_steps,totalWorkSteps=completed_work+variant_steps+(count-index-1)*estimated_variant_steps,
                           warnings=semantic_warnings)
                if background_regions:
                    background_base=result.copy()
                    refined=process_tiles(background_base,[('background',box,background_mask) for box in background_regions],
                        'inpaint-texture-recovery',layout_steps+len(seam_work)*effective_seam_steps,
                        detail_steps,detail_strength,effective_detail_steps)
                    result=guarded(background_base,refined,background_mask,'background',full_protected)
                    result.save(run_dir/f'background_refined_seed_{run_seed}.png')
                if fabric_regions:
                    material_base=result.copy()
                    repaired=process_tiles(material_base,[('garment',box,fabric_mask) for box in fabric_regions],
                        'outpaint-material-refine' if material_refine else 'inpaint-texture-recovery',
                        layout_steps+len(seam_work)*effective_seam_steps+len(background_regions)*effective_detail_steps,
                        cloth_steps,cloth_strength,cloth_effective)
                    result=guarded(material_base,feather_seam_result(material_base,repaired,fabric_mask,4),
                                   fabric_mask,'garment',full_protected)
                source_box=(geometry['left'],geometry['top'],geometry['left']+source.width,geometry['top']+source.height)
                variant_protected=Image.fromarray(np.maximum(np.asarray(protected),np.asarray(full_protected.crop(source_box))))
                result.paste(Image.composite(source,result.crop(source_box),variant_protected.point(lambda value:255 if value else 0)),
                             (geometry['left'],geometry['top']))
                result.save(run_dir/f'before_finish_seed_{run_seed}.png')
                finish_base=result.copy()
                finished=finish_materials(result,full_fg,full_garment,full_protected,geometry,source_enhance)
                finishing_allowed=((np.asarray(full_fg)<32)|((np.asarray(full_fg)>223)&(np.asarray(full_garment)>127)))&(np.asarray(full_protected)==0)
                finishing_mask=Image.fromarray(np.uint8(finishing_allowed)*255)
                if not source_enhance: finishing_mask=exclude_source(finishing_mask,geometry)
                result=guarded(finish_base,finished,finishing_mask,'finish',full_protected)
                metadata['materialVariants'].append(dict(seed=run_seed,fabricRegions=[list(box) for box in fabric_regions],
                    backgroundRegions=[list(box) for box in background_regions],
                    warnings=variant_warnings,sourceEnhance=source_enhance))
            if seam:
                # Source pixels were restored once after seam repair. Detail masks
                # exclude the entire source and the repair strip, so no second blend.
                result.save(run_dir/f'detail_seed_{run_seed}.png')
            ensure_job_active(job_id)
            update_job(job_id, stage="inpaint-blending")
            continuity_info={'applied':False,'reason':'disabled'}
            if background_continuity and run_mode!='layout':
                from outpainting import continue_background_texture
                continued,continuity_info=continue_background_texture(source,result,geometry,foreground,birefnet_mask(result))
                if continuity_info['applied']:
                    continued.save(run_dir/f'background_continuity_candidate_seed_{run_seed}.png')
                    allowed_background=exclude_source(Image.new('L',result.size,255),geometry)
                    result=guarded(result,continued,allowed_background,'background')
                    if not quality_checks[-1]['accepted']:
                        continuity_info.update(applied=False,reason='quality-regression')
            region = result.crop((geometry["left"], geometry["top"], geometry["left"] + source.width, geometry["top"] + source.height))
            original_mae = float(np.abs(np.asarray(region, dtype=np.int16) - np.asarray(source, dtype=np.int16)).mean())
            filename = f"result_seed_{run_seed}.png"
            result.save(run_dir / filename)
            from outpaint_quality import final_seam_review
            final_review = final_seam_review(result, geometry)
            saved = dict(seed=run_seed, file=str((run_dir / filename).relative_to(ROOT)), originalRegionMAE=original_mae,
                         backgroundContinuity=continuity_info,
                         finalReview=final_review,
                         layoutOnly=run_mode=='layout',qualityChecks=quality_checks,
                         sourceEnhanced=source_enhance,materialRefined=material_refine,
                         diagnostics={'overview':overview_metrics,'seamRepaired':repaired_metrics,
                                      'final':seam_metrics(source,result,geometry,variant_protected,seam_editable if seam else None)})
            results.append({**saved, "image":encode_image(result)})
            completed_work+=variant_steps
            metadata["results"].append(saved)
            metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
            update_job(job_id, stage="inpaint-variant-complete", _result={"kind":"outpaint", "sampleId":str(body.get("sampleId")), **saved},
                       _event={"type":"variant.completed", "message":f"Đã mở rộng phương án {index + 1}/{count} · seed {run_seed}"})
        metadata["promptHistory"] = prompt_history()
        metadata['embeddingCache']={'hits':embedding_cache.hits,'misses':embedding_cache.misses}
        metadata["status"] = "completed"
        metadata["durationSeconds"] = round(time.perf_counter() - started, 3)
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        update_job(job_id, status="completed", stage="done", directory=str(run_dir.relative_to(ROOT)),
                   currentStep=variant_steps, totalSteps=variant_steps,
                   completedSteps=completed_work,totalWorkSteps=completed_work, durationSeconds=metadata["durationSeconds"],
                   _event={"type":"job.completed", "message":f"Đã tạo {count} phương án mở rộng ảnh"})
        return dict(ok=True, results=results, directory=str(run_dir.relative_to(ROOT)),
                    runMode=run_mode,request=metadata['request'],
                    width=geometry["width"], height=geometry["height"], geometry=geometry,
                    warnings=semantic_warnings,seamRegionCount=len(seam_work),
                    modelName=entry.get("name") if entry else "Default")
    except Exception as error:
        metadata.update(status="cancelled" if "hủy" in str(error).lower() else "failed", error=str(error))
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        if "out of memory" in str(error).lower():
            release_inpaint()
            raise ValueError("GPU hết bộ nhớ. Hãy giảm độ phân giải AI xuống 512 hoặc 640 px rồi thử lại.") from error
        raise
