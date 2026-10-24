"""SD3.5 Large depth control with a real monocular depth estimator."""
from pathlib import Path
import gc
import numpy as np
import torch
from PIL import Image

CONTROL_ID = 'controlnet-depth-sd35-large'


def required_paths(root, config):
    root = Path(root).resolve()
    def local_path(value, fallback):
        path = Path(value or root / fallback).expanduser()
        return path if path.is_absolute() else root / path
    return {
        'control': local_path(config.get('controlnetDepthSd35Model'), 'models/controlnet/depth-sd35-large'),
        'depth': local_path(config.get('depthEstimatorModel'), 'models/depth/depth-anything-v2-large'),
        'base': root / 'models/text-to-image/stable-diffusion-3.5-large',
    }


def readiness(root, config):
    paths = required_paths(root, config)
    required = {'control': ['config.json', 'diffusion_pytorch_model.safetensors'],
                'depth': ['config.json', 'preprocessor_config.json', 'model.safetensors'],
                'base': ['model_index.json', 'transformer/config.json']}
    missing = [str(paths[key] / name) for key, files in required.items()
               for name in files if not (paths[key] / name).is_file()]
    return {'ready': not missing, 'missing': missing}


def depth_image(source, model_path, invert=True):
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    processor = AutoImageProcessor.from_pretrained(str(model_path), local_files_only=True)
    model = AutoModelForDepthEstimation.from_pretrained(str(model_path), local_files_only=True).eval()
    with torch.inference_mode():
        prediction = model(**processor(images=source, return_tensors='pt')).predicted_depth
        prediction = torch.nn.functional.interpolate(prediction.unsqueeze(1), size=(source.height, source.width), mode='bicubic', align_corners=False)[0, 0]
        values = prediction.float().numpy()
    # Match the inverted Depth Anything convention recommended by the ControlNet author.
    values = (values - values.min()) / max(float(values.max() - values.min()), 1e-6)
    if invert:
        values = 1.0 - values
    return Image.fromarray((values * 255).clip(0, 255).astype('uint8')).convert('RGB')


def generate(source, body, root, config, call):
    state = readiness(root, config)
    if not state['ready']:
        raise RuntimeError('ControlNet SD3.5 chưa sẵn sàng. Thiếu: ' + ', '.join(state['missing']))
    from diffusers import SD3ControlNetModel, StableDiffusion3ControlNetPipeline
    paths = required_paths(root, config)
    side = max(512, min(1024, int(body.get('maxSide', 768))))
    scale = min(side / max(source.size), 1.0)
    size = tuple(max(64, round(d * scale / 64) * 64) for d in source.size)
    depth = depth_image(source.resize(size, Image.Resampling.LANCZOS), paths['depth'])
    gc.collect()
    cuda = torch.cuda.is_available()
    dtype = torch.bfloat16 if cuda else torch.float32
    controlnet = SD3ControlNetModel.from_pretrained(str(paths['control']), torch_dtype=dtype, local_files_only=True)
    pipe = None
    try:
        pipe = StableDiffusion3ControlNetPipeline.from_pretrained(str(paths['base']), controlnet=controlnet, torch_dtype=dtype, local_files_only=True)
        if cuda:
            if torch.cuda.get_device_properties(0).total_memory < 24 * 1024**3:
                pipe.enable_sequential_cpu_offload()
            else:
                pipe.enable_model_cpu_offload()
        else:
            pipe.to('cpu')
        seed = int(body.get('seed', 42))
        image = call(pipe, prompt=str(body.get('prompt') or ''), negative_prompt=str(body.get('negativePrompt') or ''),
                     control_image=depth, controlnet_conditioning_scale=max(0., min(2., float(body.get('controlScale', .7)))),
                     num_inference_steps=max(10, min(60, int(body.get('steps', 30)))),
                     guidance_scale=max(1., min(12., float(body.get('guidance', 4.5)))),
                     generator=torch.Generator('cpu').manual_seed(seed), width=size[0], height=size[1], max_sequence_length=256).images[0]
        return image, depth, seed
    finally:
        del pipe, controlnet
        gc.collect()
        if cuda:
            torch.cuda.empty_cache()
