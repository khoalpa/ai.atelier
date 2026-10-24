"""Reproducible paired, synthetic removal benchmark. No photos or people required.

Creates 40 cases with known clean backgrounds. Runs the real inpaint orchestration
for both installed model families. Ground-truth errors are diagnostics, not a
claim of photographic quality. Reruns resume completed cases.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DATA = ROOT/'samples/object-removal-benchmark'
OUT = ROOT/'workspace/diagnostics/object-removal-benchmark'


def prepare():
    DATA.mkdir(parents=True, exist_ok=True)
    cases = []
    names = ['flat', 'gradient', 'tiles', 'wood', 'lines']
    prompts = ['A continuous matte beige wall.', 'A continuous softly lit gray wall.',
               'Continuous pale square floor tiles with straight gray grout lines.',
               'A continuous light wooden tabletop with horizontal grain.',
               'A continuous pale blue wall with evenly spaced thin horizontal lines.']
    for texture in range(5):
        for variant in range(8):
            number = texture*8+variant
            width, height = (960, 640) if variant != 7 else (1920, 1280)
            y, x = np.mgrid[:height, :width]
            base = np.empty((height, width, 3), dtype=np.float32)
            base[:] = [194, 185, 168] if texture in (0, 3) else [190, 199, 208]
            if texture == 1: base += ((x/width+y/height)*25-25)[..., None]
            if texture == 2: base[(x % 80 < 3) | (y % 80 < 3)] -= 55
            if texture == 3: base += (np.sin(y*.17+x*.003)*8+np.sin(y*.49)*3)[..., None]
            if texture == 4: base[y % 44 < 2] -= 45
            clean = Image.fromarray(base.clip(0, 255).astype(np.uint8))
            source, mask = clean.copy(), Image.new('L', clean.size)
            draw, select = ImageDraw.Draw(source), ImageDraw.Draw(mask)
            # Center, tiny, near-border, cable, shadow, low contrast, disconnected, high resolution.
            box = [width//2-55, height//2-70, width//2+55, height//2+70]
            color = (190, 35, 35)
            if variant == 1: box = [450, 300, 466, 318]
            if variant == 2: box = [0, 180, 90, 330]
            if variant == 3:
                line = [(180, 210), (340, 360), (590, 240), (760, 390)]
                draw.line(line, fill=(22, 25, 27), width=4); select.line(line, fill=255, width=8)
            else:
                if variant == 4:
                    shadow = [box[0]+15, box[3]-20, box[2]+60, box[3]+25]
                    draw.ellipse(shadow, fill=(90, 88, 85)); select.ellipse(shadow, fill=255)
                if variant == 5: color = tuple(int(v)+8 for v in base[height//2,width//2])
                draw.rounded_rectangle(box, radius=12, fill=color)
                select.rounded_rectangle(box, radius=12, fill=255)
                if variant == 6:
                    box2 = [70, 60, 110, 100]
                    draw.ellipse(box2, fill=(40, 70, 170)); select.ellipse(box2, fill=255)
            case_id = f'{number+1:02d}-{names[texture]}-{variant+1}'
            folder = DATA/case_id; folder.mkdir(exist_ok=True)
            for name, image in [('source', source), ('mask', mask), ('clean', clean)]: image.save(folder/f'{name}.png')
            cases.append({'id':case_id, 'source':str((folder/'source.png').relative_to(ROOT/'samples')).replace('\\','/'),
                          'prompt':prompts[texture], 'seed':82000+number, 'category':names[texture], 'variant':variant})
    (DATA/'manifest.json').write_text(json.dumps({'synthetic':True,'cases':cases},indent=2),encoding='utf-8')
    return cases


def measure(clean, source, result, mask, composite):
    a, b, s = (np.asarray(image, dtype=np.float32) for image in (clean, result, source))
    selected, outside = np.asarray(mask)>16, np.asarray(composite)==0
    error = np.abs(a-b).mean(axis=2)
    source_error = float(np.abs(a-s).mean(axis=2)[selected].mean())
    mae = float(error[selected].mean())
    return {'maskedMAE':round(mae,4), 'inputMaskedMAE':round(source_error,4),
            'improvedOverInput':mae < source_error,
            'outsideMaxDifference':int(np.abs(b-s)[outside].max()) if outside.any() else 0}


def run(args):
    global OUT
    OUT = ROOT/args.output
    cases = prepare()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.prepare_only:
        print(json.dumps({'cases':len(cases),'manifest':str(DATA/'manifest.json')})); return
    import ai_service as service
    configs = [('sdxl-inpaint-base-0.1', 6.0, .9), ('flux-1-fill-dev', 30.0, 1.0)]
    if args.model: configs = [item for item in configs if item[0] == args.model]
    for model_id, guidance, strength in configs:
        if args.guidance is not None:
            guidance = args.guidance
        selected_cases = cases if args.limit >= len(cases) else [cases[int(i)] for i in np.linspace(0, len(cases)-1, max(1,args.limit))]
        for case in selected_cases:
            report_path = OUT/f'{model_id}-{case["id"]}.json'
            if report_path.exists() and not args.force: continue
            started = time.perf_counter()
            folder = DATA/case['id']; mask = Image.open(folder/'mask.png').convert('L')
            request = dict(sampleId=case['source'], editableMask=service.encode_image(mask),
                fillMode='background', removalTarget='custom', modelId=model_id,
                prompt=case['prompt'], negativePrompt='', confirmedPrompts={'prompt':case['prompt'],'negativePrompt':''},
                seed=case['seed'], steps=args.steps, strength=strength, guidance=guidance,
                maxSide=args.resolution, count=1, expand=24, blur=16, cropPadding=96,
                autoRetry=False, semanticCheck=False, livePreview=False,
                jobId=f'object-benchmark-{model_id}-{case["id"]}')
            try:
                result = service.inpaint(request)
                run_dir = ROOT/result['directory']
                image = Image.open(run_dir/f'result_seed_{case["seed"]}.png').convert('RGB')
                source = Image.open(folder/'source.png').convert('RGB')
                clean = Image.open(folder/'clean.png').convert('RGB')
                composite = Image.open(run_dir/'editable_mask.png').convert('L')
                report = {'case':case, 'model':model_id, 'revision':service.SOURCE_REVISION, 'directory':str(run_dir.relative_to(ROOT)),
                          'settings':result['effectiveSettings'], 'regionCount':result['regionCount'],
                          **measure(clean,source,image,mask,composite)}
            except Exception as error:
                report = {'case':case,'model':model_id,'error':str(error)}
            report['seconds'] = round(time.perf_counter()-started,3)
            report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps({k:report.get(k) for k in ['model','maskedMAE','outsideMaxDifference','seconds','error']} | {'case':case['id']}),flush=True)
            if report.get('error'): raise RuntimeError(report['error'])
        service.release_inpaint()
    reports = [json.loads(p.read_text(encoding='utf-8')) for p in OUT.glob('*.json') if p.name != 'summary.json']
    summary = {'createdAt':datetime.now(timezone.utc).isoformat(), 'synthetic':True,
               'limitation':'Known synthetic backgrounds; not a photographic acceptance benchmark.', 'models':{}}
    for model_id, _, _ in configs:
        rows = [r for r in reports if r.get('model') == model_id and 'maskedMAE' in r]
        if rows: summary['models'][model_id] = {'cases':len(rows),'medianMaskedMAE':float(np.median([r['maskedMAE'] for r in rows])),
            'medianSeconds':float(np.median([r['seconds'] for r in rows])), 'improvedOverInput':sum(r['improvedOverInput'] for r in rows),
            'outsidePreserved':sum(r['outsideMaxDifference']==0 for r in rows)}
    (OUT/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps(summary),flush=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--prepare-only',action='store_true')
    parser.add_argument('--model',choices=['sdxl-inpaint-base-0.1','flux-1-fill-dev'])
    parser.add_argument('--limit',type=int,default=40)
    parser.add_argument('--steps',type=int,default=24)
    parser.add_argument('--resolution',type=int,default=512)
    parser.add_argument('--force',action='store_true')
    parser.add_argument('--guidance',type=float)
    parser.add_argument('--output',default='workspace/diagnostics/object-removal-benchmark')
    run(parser.parse_args())
