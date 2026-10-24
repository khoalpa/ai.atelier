"""GPU check of refinement using an existing outpainting overview.

Reuse the expensive overview pass, but execute the production orchestration
and every detail pass with the real model. Result metadata records this reuse.
Usage: python scripts/verify_outpaint_refinement.py EXISTING_JOB_ID
"""
import json
import argparse
from pathlib import Path
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import ai_service as service
from PIL import Image
import outpainting
from outpainting import prepare_inference

parser=argparse.ArgumentParser()
parser.add_argument('job_id')
parser.add_argument('--seam-repair',action='store_true')
parser.add_argument('--allow-edge-edit',action='store_true')
parser.add_argument('--skip-detail',action='store_true')
parser.add_argument('--base-result',action='store_true')
parser.add_argument('--seam-steps',type=int,default=40)
parser.add_argument('--material-refine',action='store_true')
parser.add_argument('--source-enhance',action='store_true')
parser.add_argument('--baseline',type=Path)
options=parser.parse_args()
job_id = options.job_id
if not job_id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in job_id):
    raise ValueError('Invalid job ID')
state = json.loads((ROOT/'workspace/jobs'/f'{job_id}.json').read_text(encoding='utf-8'))
request = json.loads((ROOT/'workspace/jobs'/f'{job_id}.request.json').read_text(encoding='utf-8'))
directory = (ROOT/state['results'][0]['file']).parent
overview = directory/f"{'result' if options.base_result else 'overview'}_seed_{request.get('seed',42)}.png"
if options.baseline: overview=options.baseline.resolve()
mask = Image.open(directory/'generation_mask.png')
request.update(jobId=job_id+('-materials' if options.material_refine else '-seam' if options.seam_repair else '-refined'), count=1, detailPass=not options.skip_detail,
               seamRepair=options.seam_repair,seamSteps=options.seam_steps,
               materialRefine=options.material_refine,sourceEnhance=options.source_enhance)
if options.allow_edge_edit: request['preserveOriginal']=False
original_call = service.traced_pipeline_call
first = True
original_composite=outpainting.composite_canvas
first_composite=True

def reuse_exact_overview(source,generated,geometry):
    global first_composite
    if first_composite:
        first_composite=False
        baseline=Image.open(overview).convert('RGB')
        if not options.baseline: baseline.paste(source,(geometry['left'],geometry['top']))
        return baseline
    return original_composite(source,generated,geometry)

def reuse_overview(pipe, **kwargs):
    global first
    if first:
        first = False
        image, _, _ = prepare_inference(Image.open(overview).convert('RGB'), mask, kwargs['width'])
        kwargs['callback_on_step_end'](pipe, kwargs['num_inference_steps']-1, 0, {})
        return SimpleNamespace(images=[image])
    return original_call(pipe, **kwargs)

service.traced_pipeline_call = reuse_overview
outpainting.composite_canvas = reuse_exact_overview
result = service.outpaint(request)
metadata_file = ROOT/result['directory']/'metadata.json'
metadata = json.loads(metadata_file.read_text(encoding='utf-8'))
metadata.update(validationMode='reused-exact-baseline-real-repair-passes', validationOverviewSource=str(overview.relative_to(ROOT)))
metadata_file.write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:result[k] for k in ('ok','directory','width','height')},ensure_ascii=False))
