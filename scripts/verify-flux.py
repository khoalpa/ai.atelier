"""Run real local GPU smoke checks and retain images and measurements."""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import ai_service as service
from prompt_catalog import prompt_text
from PIL import Image, ImageDraw, ImageStat
import torch

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('model', choices=['fill', 'klein'])
    args = parser.parse_args()
    output = ROOT / 'workspace/review/flux-validation'
    output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    report = {'model': args.model, 'passed': False, 'gpu': torch.cuda.get_device_name(0)}
    try:
        if args.model == 'klein':
            result = service.chroma_generate({'modelId': 'flux-2-klein-4b', 'prompt': prompt_text('verifyFlux.klein'), 'steps': 4, 'size': 512, 'seed': 433, 'count': 1, 'livePreview': False, 'jobId': 'flux-klein-validation'})
            report['result'] = result
            image_path = service.OUTPUTS / result['results'][0]['image'].removeprefix('/outputs/')
        else:
            pipe = service.load_inpaint_pipe(model_path=ROOT / 'models/inpainting/flux-1-fill-dev', architecture='flux')
            image = Image.new('RGB', (512, 512), '#dddddd')
            ImageDraw.Draw(image).rectangle((160, 100, 352, 410), fill='#2255aa')
            mask = Image.new('L', image.size, 0)
            ImageDraw.Draw(mask).rectangle((160, 100, 352, 410), fill=255)
            image.save(output / 'fill-input.png')
            mask.save(output / 'fill-mask.png')
            image_path = output / 'fill-output.png'
            generated = service.traced_pipeline_call(pipe, prompt=prompt_text('verifyFlux.fill'), image=image, mask_image=mask, width=512, height=512, num_inference_steps=8, guidance_scale=4.5, generator=torch.Generator('cpu').manual_seed(433)).images[0]
            generated.save(image_path)
        image = Image.open(image_path).convert('RGB')
        report.update(image=str(image_path), size=list(image.size), channelStddev=ImageStat.Stat(image).stddev,
                      peakVramMb=round(torch.cuda.max_memory_allocated()/1048576))
        report['passed'] = image.size == (512, 512) and max(report['channelStddev']) > 5
        if not report['passed']:
            raise RuntimeError('Blank or invalid output image')
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        report['elapsedSeconds'] = round(time.perf_counter()-started, 2)
        (output / (args.model + '.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
