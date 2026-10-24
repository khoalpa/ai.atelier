"""Text-to-image planning, exact prompt preflight and source-based finishing.

Planning loads tokenizers only. GPU operations use the service's serialized worker.
"""
import hashlib
import json
import math
import secrets
import time
from importlib.metadata import version as package_version, PackageNotFoundError
from datetime import datetime, timezone
from pathlib import Path

from prompt_catalog import read_catalog
from prompt_limits import preview_tokenizer

VERSION = 2
MAX_PIXELS = 1200000
MAX_SEED = 2147483647
FRAMING = {
    'as-described': '',
    'full-body-hands': ('Wide full-length photograph, head to toe, with space around every person. '
                        'Each person stands with both arms slightly away from the body, '
                        'open hands fully visible beside the thighs. '
                        'Include every face, both hands of each person, and shoes inside the frame. '),
}
FAMILIES = {
    'ChromaPipeline': 'chroma', 'Flux2KleinPipeline': 'klein',
    'StableDiffusion3Pipeline': 'sd35', 'StableDiffusionXLPipeline': 'sdxl',
}


def number(value, label, low, high, integer=False):
    if isinstance(value, bool):
        raise ValueError(f'{label} không hợp lệ.')
    try:
        n = float(value)
    except (ValueError, TypeError):
        raise ValueError(f'{label} không hợp lệ.') from None
    if not math.isfinite(n) or not low <= n <= high or (integer and not n.is_integer()):
        raise ValueError(f'{label} phải từ {low} đến {high}' + (' và là số nguyên.' if integer else '.'))
    return int(n) if integer else n


def dimensions(size, ratio='1:1'):
    size = number(size, 'Độ phân giải', 256, 1024, True)
    if ratio not in ('1:1', '4:5', '2:3', '3:2', '16:9', '9:16'):
        raise ValueError('Tỷ lệ ảnh không được hỗ trợ.')
    a, b = map(int, ratio.split(':'))
    width = max(256, round(size * math.sqrt(a / b) / 32) * 32)
    height = max(256, round(size * math.sqrt(b / a) / 32) * 32)
    return width, height


def model_profile(model_path, model_id):
    index = json.loads((Path(model_path) / 'model_index.json').read_text(encoding='utf-8'))
    family = FAMILIES.get(index.get('_class_name'))
    if not family:
        raise ValueError('Pipeline này chưa hỗ trợ quy trình Ảnh mới.')
    presets = read_catalog()['runtimePresets']['textToImage']
    defaults = {
        'sd35': {'guidance': 4.5, 'steps': {'fast': 16, 'balanced': 28, 'quality': 40}},
        'sdxl': {'guidance': 5.0, 'steps': {'fast': 16, 'balanced': 28, 'quality': 40}},
        'chroma': {'guidance': 3.0, 'steps': {'fast': 12, 'balanced': 28, 'quality': 40}},
        'klein': {'guidance': 1.0, 'steps': {'fast': 4, 'balanced': 4, 'quality': 4}},
    }
    configured = presets.get('profiles', {}).get(family, defaults[family])
    profile = {**defaults[family], **configured}
    profile.update(family=family, pipeline=index['_class_name'], modelId=model_id,
                   supportsNegative=family != 'klein', supportsDetail=family in ('sd35', 'sdxl'),
                   supportsSLG=family == 'sd35', sizes=presets['sizes'])
    return profile


def text(value, label, empty=True):
    if not isinstance(value, str) or len(value) > 16000 or (not empty and not value.strip()):
        raise ValueError(f'{label} phải là văn bản' + (' không trống' if not empty else '') + ', tối đa 16000 ký tự.')
    return value


def plan(body, model_path, model_id):
    profile = model_profile(model_path, model_id)
    prompt = text(body.get('prompt', ''), 'Mô tả ảnh', False)
    framing = body.get('framing', 'as-described')
    if not isinstance(framing, str) or framing not in FRAMING:
        raise ValueError('Khung hình không hợp lệ.')
    effective_prompt = FRAMING[framing] + prompt
    negative = text(body.get('negativePrompt', ''), 'Điều cần tránh')
    quality = body.get('quality', 'balanced')
    if quality not in ('fast', 'balanced', 'quality', 'custom'):
        raise ValueError('Mức chất lượng không hợp lệ.')
    level = quality if quality != 'custom' else 'balanced'
    width, height = dimensions(body.get('size', profile['sizes'][level]), body.get('aspectRatio', '1:1'))
    if 'width' in body or 'height' in body:
        width = number(body.get('width'), 'Chiều rộng', 256, 1536, True)
        height = number(body.get('height'), 'Chiều cao', 256, 1536, True)
    if width % 16 or height % 16 or width * height > MAX_PIXELS:
        raise ValueError('Kích thước phải là bội số 16, tổng không quá 1,2 triệu pixel.')
    steps = number(body.get('steps', profile['steps'][level]), 'Số bước', 4, 50, True)
    guidance = number(body.get('guidance', profile['guidance']), 'Mức bám mô tả', 1, 8)
    warnings = []
    if profile['family'] == 'klein':
        if steps != 4 or guidance != 1:
            warnings.append('FLUX.2 klein sử dụng cố định 4 bước và mức bám mô tả 1.')
        if negative:
            warnings.append('Model này không áp dụng Điều cần tránh; hãy diễn đạt yêu cầu trong mô tả chính.')
        steps, guidance = 4, 1.0
    seed = secrets.randbelow(MAX_SEED + 1) if body.get('seed') is None else number(body['seed'], 'Seed', 0, MAX_SEED, True)
    count = number(body.get('count', 2), 'Số phương án', 1, 4, True)
    slg = body.get('skipLayerGuidance', False)
    if not isinstance(slg, bool) or (slg and not profile['supportsSLG']):
        raise ValueError('Hỗ trợ cấu trúc chỉ dùng cho SD3.5.')
    inputs = {'prompt': [effective_prompt]}
    if profile['supportsNegative']:
        inputs['negative_prompt'] = [negative]
    clip = body.get('clipPrompt', '')
    clip_negative = body.get('clipNegativePrompt', '')
    text(clip, 'Mô tả CLIP'); text(clip_negative, 'Điều cần tránh CLIP')
    if profile['family'] == 'sd35':
        inputs.update(prompt=[FRAMING[framing] + clip if clip.strip() else effective_prompt], prompt_2=[FRAMING[framing] + clip if clip.strip() else effective_prompt],
                      prompt_3=[effective_prompt], negative_prompt=[clip_negative if clip_negative.strip() else negative],
                      negative_prompt_2=[clip_negative if clip_negative.strip() else negative], negative_prompt_3=[negative],
                      max_sequence_length=256)
    elif profile['family'] in ('klein', 'chroma'):
        inputs['max_sequence_length'] = 512
    encoders, errors = [], []
    folders = ('tokenizer', 'tokenizer_2', 'tokenizer_3') if profile['family'] == 'sd35' else ('tokenizer', 'tokenizer_2') if profile['family'] == 'sdxl' else ('tokenizer',)
    for index, folder in enumerate(folders):
        tokenizer = preview_tokenizer(str(Path(model_path) / folder))
        suffix = '' if index == 0 else f'_{index + 1}'
        limit = 256 if index == 2 else 512 if profile['family'] in ('klein', 'chroma') else 77
        native = getattr(tokenizer, 'model_max_length', None)
        if isinstance(native, int) and 1 < native < 1000000:
            limit = min(limit, native)
        item = {'name': 'T5' if index == 2 or profile['family'] == 'chroma' else 'Qwen' if profile['family'] == 'klein' else f'CLIP {index+1}', 'limit': limit}
        for prefix in ('prompt', 'negative_prompt'):
            if prefix not in inputs:
                continue
            value = inputs.get(prefix + suffix, inputs[prefix])[0]
            actual = value
            if profile['family'] == 'klein':
                actual = tokenizer.apply_chat_template([{'role': 'user', 'content': value}], tokenize=False, add_generation_prompt=True, enable_thinking=False)
            tokens = len(tokenizer(actual, add_special_tokens=True, truncation=False)['input_ids'])
            item[prefix], item[prefix + 'Tokens'] = value, tokens
            if tokens > limit:
                errors.append(f'{item["name"]} · {"mô tả" if prefix == "prompt" else "điều cần tránh"}: {tokens}/{limit} token. Hãy rút gọn' + (' ô Mô tả ngắn cho CLIP.' if profile['family'] == 'sd35' and index < 2 else ' nội dung.'))
        encoders.append(item)
    return {'ok': True, 'valid': not errors, 'version': VERSION, 'profile': profile, 'encoders': encoders,
            'errors': errors, 'warnings': warnings, 'inputs': inputs, 'prompt': prompt, 'negativePrompt': negative,
            'settings': {'modelId': model_id, 'quality': quality, 'width': width, 'height': height, 'framing': framing,
                         'steps': steps, 'guidance': guidance, 'seed': seed, 'count': count, 'skipLayerGuidance': slg}}


def source_result(outputs, name, expected_sha):
    # Only generated results with their sidecars are eligible; never accept paths.
    if not isinstance(name, str) or Path(name).name != name or '/' in name or '\\' in name or not name.endswith('.png'):
        raise ValueError('Mã ảnh nguồn không hợp lệ.')
    directory = (Path(outputs) / 'chroma').resolve()
    path = (directory / name).resolve()
    if path.parent != directory or not path.is_file():
        raise ValueError('Ảnh nguồn không còn tồn tại.')
    metadata = json.loads(path.with_suffix('.json').read_text(encoding='utf-8'))
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if not expected_sha or actual != expected_sha or actual != metadata.get('sha256'):
        raise ValueError('Ảnh nguồn đã thay đổi. Hãy mở lại kết quả trước khi hoàn thiện.')
    if metadata.get('schemaVersion') != VERSION:
        raise ValueError('Ảnh này chưa có dữ liệu để hoàn thiện. Hãy tạo một phương án mới.')
    return path, metadata


def _save(image, output, data):
    image.save(output)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    metadata = {**data, 'schemaVersion': VERSION, 'sha256': digest, 'width': image.width, 'height': image.height}
    output.with_suffix('.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'seed': data['seed'], 'image': '/outputs/chroma/' + output.name, 'source': output.name, 'sha256': digest,
            'width': image.width, 'height': image.height, 'model': data['model'],
            'parentImage': '/outputs/chroma/' + data['parent']['source'] if data.get('parent') else None,
            'canDetail': data.get('family') in ('sd35', 'sdxl'), 'method': data.get('method', 'generate')}


def runtime_info(model_path, env, pipe):
    try:
        diffusers = package_version('diffusers')
    except PackageNotFoundError:
        diffusers = 'unavailable'
    files = {}
    for name in ('model_index.json', 'scheduler/scheduler_config.json'):
        path = Path(model_path) / name
        if path.is_file():
            files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {'sourceRevision': env.get('SOURCE_REVISION'), 'diffusers': diffusers,
            'torch': str(getattr(env['torch'], '__version__', 'unavailable')),
            'modelConfigHashes': files, 'offload': getattr(pipe, '_atelier_offload', 'pipeline-default') if pipe else 'cpu'}


def generate(body, env):
    torch = env['torch']
    from PIL import Image, ImageFilter
    started = time.perf_counter()
    job_id = str(body.get('jobId', ''))[:80]
    update, active = env['update_job'], env['ensure_job_active']
    update(job_id, status='running', stage='text-validating', taskType='text-to-image', device=env['device'],
           gpuMemoryMb=round(torch.cuda.get_device_properties(0).total_memory / 1048576) if torch.cuda.is_available() else 0,
           _event={'type': 'text.started', 'message': 'Đang kiểm tra đầy đủ mô tả và cấu hình'})
    active(job_id)
    mode = body.get('runMode', 'generate')
    if mode not in ('generate', 'refine'):
        raise ValueError('Chế độ tạo ảnh không hợp lệ.')
    source, parent, method = None, None, 'generate'
    request = dict(body)
    if mode == 'refine':
        source, parent = source_result(env['OUTPUTS'], body.get('source'), body.get('sourceSha'))
        method = body.get('method', 'upscale')
        if method not in ('upscale', 'detail'):
            raise ValueError('Cách hoàn thiện không hợp lệ.')
        request = {**parent['request'], 'seed': parent['seed'], 'count': 1, 'skipLayerGuidance': False}
        if method == 'detail':
            if parent.get('family') not in ('sd35', 'sdxl'):
                raise ValueError('Model này hỗ trợ phóng lớn giữ bố cục. Dùng Chỉnh sửa tiếp để sửa từng vùng.')
            request.update(steps=40)
    model_id = str(request.get('modelId') or 'flux-2-klein-4b')
    model_path = env['CHROMA_ROOT'] if model_id == 'flux-chroma1-hd' else env['text_to_image_model_path'](model_id)
    prepared = plan(request, model_path, model_id)
    if not prepared['valid']:
        raise ValueError(' '.join(prepared['errors']))
    cfg, profile = prepared['settings'], prepared['profile']
    if method == 'detail':
        target = dimensions(1024, request.get('aspectRatio', '1:1'))
        ratio = cfg['width'] / cfg['height']
        target = (round(1024 * math.sqrt(ratio) / 16) * 16, round(1024 / math.sqrt(ratio) / 16) * 16)
        cfg.update(width=target[0], height=target[1])
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()
    load_started = time.perf_counter()
    pipe = None
    update(job_id, stage='text-model-loading', model=model_id, totalVariants=cfg['count'], totalSteps=cfg['steps'],
           totalWorkSteps=cfg['count'] * cfg['steps'], width=cfg['width'], height=cfg['height'],
           _event={'type': 'model.loading', 'message': 'Đang chuẩn bị hoàn thiện ảnh' if source else f'Đang nạp {model_id}'})
    if method != 'upscale':
        pipe = env['load_text_to_image_pipe'](model_id)
    if method == 'detail':
        # The wrapper shares component objects; re-enable offload and discard wrappers afterwards.
        from diffusers import StableDiffusion3Img2ImgPipeline, StableDiffusionXLImg2ImgPipeline
        cls = StableDiffusion3Img2ImgPipeline if profile['family'] == 'sd35' else StableDiffusionXLImg2ImgPipeline
        try:
            pipe.remove_all_hooks()
            pipe = cls(**pipe.components)
            if env['device'] == 'cuda':
                pipe.enable_model_cpu_offload()
            env['configure_vae_memory'](pipe)
        except Exception:
            env['release_text_to_image']()
            raise
    loading = time.perf_counter() - load_started
    runtime = runtime_info(model_path, env, pipe)
    active(job_id)
    output_dir = Path(env['OUTPUTS']) / 'chroma'
    output_dir.mkdir(parents=True, exist_ok=True)
    # Clock resolution on Windows can give consecutive generations the same
    # timestamp. Never let a refinement overwrite its source image.
    import uuid
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + uuid.uuid4().hex[:12]
    results, inference_started = [], time.perf_counter()
    try:
        for index in range(cfg['count']):
            active(job_id)
            seed = (cfg['seed'] + index) % (MAX_SEED + 1)
            total_steps = cfg['steps'] if method != 'detail' else max(1, int(cfg['steps'] * .2))
            if method == 'upscale':
                total_steps = 1
            update(job_id, stage='text-generating', currentVariant=index+1, currentStep=0,
                   totalSteps=total_steps, totalWorkSteps=cfg['count']*total_steps, completedSteps=index*total_steps, seed=seed,
                   _event={'type': 'variant.started', 'message': f'Đang xử lý phương án {index+1}/{cfg["count"]}'})
            preview_path = Path(env['JOBS_DIR']) / 'previews' / f'new-image-{stamp}-{index}.jpg'
            def callback(pipeline, step_index, timestep, kwargs):
                active(job_id)
                completed = min(total_steps, int(step_index)+1)
                extra = {}
                if body.get('livePreview', True) and (completed == total_steps or completed % max(4, total_steps//3) == 0):
                    if env['save_diffusion_preview'](pipeline, kwargs.get('latents'), preview_path, cfg['width'], cfg['height']):
                        extra['preview'] = {'file': str(preview_path.relative_to(env['ROOT'])), 'step': completed, 'variant': index+1}
                update(job_id, currentStep=completed, completedSteps=index*total_steps+completed,
                       currentVramMb=round(torch.cuda.memory_allocated()/1048576, 1) if torch.cuda.is_available() else 0, **extra)
                return kwargs
            if method == 'upscale':
                with Image.open(source) as original:
                    if original.width * original.height * 4 > 5000000:
                        raise ValueError('Ảnh hoàn thiện tối đa 5 triệu pixel. Hãy chọn lại bản bố cục.')
                    image = original.convert('RGB').resize((original.width*2, original.height*2), Image.Resampling.LANCZOS)
                    image = image.filter(ImageFilter.UnsharpMask(radius=1, percent=35, threshold=3))
            else:
                extra = {}
                if method == 'detail':
                    with Image.open(source) as original:
                        extra.update(image=original.convert('RGB').resize((cfg['width'], cfg['height']), Image.Resampling.LANCZOS), strength=.2)
                elif cfg['skipLayerGuidance']:
                    extra.update(skip_guidance_layers=[7, 8, 9], skip_layer_guidance_scale=2.8)
                image = env['traced_pipeline_call'](pipe, **prepared['inputs'], **extra,
                    generator=torch.Generator('cpu').manual_seed(seed), num_inference_steps=cfg['steps'],
                    guidance_scale=cfg['guidance'], width=cfg['width'], height=cfg['height'], num_images_per_prompt=1,
                    callback_on_step_end=callback, callback_on_step_end_tensor_inputs=['latents']).images[0]
            active(job_id)
            output = output_dir / f'chroma-{stamp}-seed-{seed}.png'
            update(job_id, stage='text-saving', completedSteps=(index+1)*total_steps,
                   _event={'type': 'image.decoded', 'message': f'Đang lưu phương án {index+1}'})
            data = {'model': model_id, 'family': profile['family'], 'seed': seed, 'method': method,
                    'request': {**request, **cfg, 'prompt': prepared['prompt'], 'negativePrompt': prepared['negativePrompt']},
                    'parent': {'source': source.name, 'sha256': parent['sha256']} if source else None,
                    'promptHistory': env['prompt_history'](), 'settings': cfg,
                    'runtime': runtime,
                    'note': 'Phóng lớn nội suy và tăng nét nhẹ; không sinh thêm chi tiết bằng AI.' if method == 'upscale' else ''}
            result = _save(image, output, data)
            results.append(result)
            update(job_id, currentStep=total_steps, completedSteps=(index+1)*total_steps,
                   preview={'file': str(output.relative_to(env['ROOT'])), 'step': total_steps,
                            'variant': index+1, 'updatedAt': datetime.now(timezone.utc).isoformat()},
                   _result={'kind': 'text-to-image', 'file': str(output.relative_to(env['ROOT'])), **result},
                   _event={'type': 'variant.completed', 'message': f'Đã lưu phương án {index+1}'})
    finally:
        if method == 'detail':
            # Shared hooks must never be reused by the cached text-to-image pipeline.
            env['release_text_to_image']()
    inference = round(time.perf_counter() - inference_started, 3)
    elapsed = round(time.perf_counter() - started, 3)
    report = {'schemaVersion': VERSION, 'createdAt': datetime.now(timezone.utc).isoformat(),
              'model': model_id, **cfg, 'prompt': prepared['prompt'], 'negativePrompt': prepared['negativePrompt'],
              'negativePromptApplied': profile['supportsNegative'] and method != 'upscale',
              'method': method, 'elapsedSeconds': elapsed, 'totalSeconds': elapsed,
              'runtime': runtime,
              'inferenceSeconds': inference, 'loadingSeconds': round(loading, 3), 'warnings': prepared['warnings'],
              'width': results[0]['width'], 'height': results[0]['height'],
              'peakVramMb': round(torch.cuda.max_memory_allocated()/1048576) if torch.cuda.is_available() else 0,
              'promptHistory': env['prompt_history'](), 'results': results}
    report_path = Path(env['ROOT']) / 'workspace' / 'review' / f'chroma-generate-{stamp}.json'
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    update(job_id, status='completed', stage='done', currentVariant=cfg['count'], durationSeconds=elapsed,
           inferenceSeconds=inference, loadingSeconds=round(loading, 3), peakVramMb=report['peakVramMb'],
           report=str(report_path.relative_to(env['ROOT'])),
           _event={'type': 'job.completed', 'message': f'Hoàn tất trong {elapsed:.1f} giây, gồm {loading:.1f} giây nạp model'})
    return {'ok': True, 'report': str(report_path.relative_to(env['ROOT'])), **report}
