"""Compare FLUX offload modes in fresh processes with identical inputs/seeds."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sample_catalog import resolve_sample
OUTPUT = ROOT / 'workspace/diagnostics/outpaint-quality/memory'


def worker(mode):
    os.environ['ATELIER_FLUX_OFFLOAD'] = mode
    sys.path.insert(0, str(ROOT))
    import ai_service as service
    import numpy as np
    import torch
    from PIL import Image
    from outpainting import prepare_canvas, prepare_inference, composite_canvas
    from outpaint_quality import PromptEmbeddingCache
    from prompt_limits import split_flux_prompts
    source = Image.open(resolve_sample(ROOT, 'outpaint-benchmark/studio-left/source.png')).convert('RGB')
    source.thumbnail((320, 384))
    canvas, mask, geometry = prepare_canvas(source, dict(width=source.width+64, height=source.height, left=64))
    model_image, model_mask, crop = prepare_inference(canvas, mask, 512)
    report = dict(mode=mode, passed=False, seeds=[42, 43], steps=4, size=model_image.size)
    began = time.perf_counter()
    try:
        pipe = service.load_inpaint_pipe(model_path=ROOT/'models/inpainting/flux-1-fill-dev', architecture='flux')
        report['loadSeconds'] = round(time.perf_counter()-began, 3)
        cache = PromptEmbeddingCache(pipe)
        text, _ = split_flux_prompts(pipe, 'Continue the warm ochre studio wall and floor, matching the existing light and perspective.')
        report['runs'] = []
        torch.cuda.reset_peak_memory_stats()
        for seed in report['seeds']:
            start = time.perf_counter()
            result = service.traced_pipeline_call(pipe, **text, image=model_image, mask_image=model_mask,
                width=model_image.width, height=model_image.height, strength=1., num_inference_steps=4,
                guidance_scale=30., generator=torch.Generator('cpu').manual_seed(seed), _prompt_cache=cache).images[0]
            final = composite_canvas(source, result.crop(crop), geometry)
            exact = bool(np.array_equal(np.asarray(final.crop((64,0,64+source.width,source.height))),np.asarray(source)))
            final.save(OUTPUT/f'{mode}-{seed}.png')
            report['runs'].append(dict(seed=seed, seconds=round(time.perf_counter()-start,3), sourceExact=exact))
        report.update(cache=dict(hits=cache.hits, misses=cache.misses), peakAllocatedMiB=round(torch.cuda.max_memory_allocated()/1048576),
                      peakReservedMiB=round(torch.cuda.max_memory_reserved()/1048576))
        report['passed'] = all(row['sourceExact'] for row in report['runs']) and cache.hits == 1 and cache.misses == 1
    except Exception as error:
        report['error'] = str(error)
    finally:
        report['seconds'] = round(time.perf_counter()-began,3)
        (OUTPUT/f'{mode}.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(json.dumps(report),flush=True)
    return report['passed']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode',choices=['sequential','group','both'],default='both')
    parser.add_argument('--worker',action='store_true')
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True,exist_ok=True)
    if args.worker:
        sys.exit(0 if worker(args.mode) else 1)
    modes = ['sequential','group'] if args.mode == 'both' else [args.mode]
    passed = True
    for mode in modes:
        result = subprocess.run([sys.executable,'-u',__file__,'--worker','--mode',mode],cwd=ROOT)
        passed = result.returncode == 0 and passed
    if args.mode == 'both' and passed:
        import numpy as np
        from PIL import Image
        comparison = {'note':'Four-step operational check. Concurrent GPU work affects timings; not a visual quality benchmark.'}
        comparison['pixelMAE'] = {str(seed):round(float(np.abs(np.asarray(Image.open(OUTPUT/f'sequential-{seed}.png'),dtype=np.float32)-
                                    np.asarray(Image.open(OUTPUT/f'group-{seed}.png'),dtype=np.float32)).mean()),4) for seed in (42,43)}
        (OUTPUT/'comparison.json').write_text(json.dumps(comparison,indent=2),encoding='utf-8')
    sys.exit(0 if passed else 1)


if __name__ == '__main__':
    main()
