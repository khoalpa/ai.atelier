"""Run one fixed IDM case after conditioning changes, without promoting it."""
import argparse
import json
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

CASES = {
    'overall:c003': 'a solid emerald green linen knee-length A-line dress with a round neckline, short sleeves, a fitted waist and a flared skirt',
    'upper_body:c002': 'a solid cobalt blue cotton Oxford button-front shirt with a pointed collar, white buttons, full-length long sleeves and buttoned cuffs',
}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('category', choices=['overall', 'upper_body'])
    parser.add_argument('sample', choices=['c002', 'c003'])
    parser.add_argument('--steps', type=int, default=20)
    parser.add_argument('--guidance', type=float, default=2.5)
    parser.add_argument('--max-side', type=int, default=512, choices=[512, 960, 1024])
    parser.add_argument('--mask-file')
    parser.add_argument('--description')
    parser.add_argument('--negative-description')
    parser.add_argument('--dresscode-checkpoint', action='store_true')
    args = parser.parse_args()
    key = f'{args.category}:{args.sample}'
    if key not in CASES:
        raise SystemExit(f'Unsupported controlled case: {key}')

    import numpy as np
    import torch
    from PIL import Image
    import ai_service as ai
    original_loader = ai.load_tryon_pipe
    diagnostic_pipe = None
    if args.dresscode_checkpoint:
        from idm_vton_runtime import load_pipeline
        dc_path = ROOT/'models/tryon/IDM-VTON-DC'
        if not (dc_path/'unet/diffusion_pytorch_model.bin').is_file():
            raise SystemExit('DressCode checkpoint is not installed')
        def diagnostic_loader(model_id='idm-vton'):
            nonlocal diagnostic_pipe
            if diagnostic_pipe is None:
                diagnostic_pipe = load_pipeline(ai.IDMVTON_MODEL, ai.IDMVTON_ROOT, ai.device, unet_model_path=dc_path)
            return diagnostic_pipe
        ai.load_tryon_pipe = diagnostic_loader

    prior_root = ROOT/'workspace/diagnostics/idm-input-experiment'
    prior = json.loads((prior_root/'report.json').read_text(encoding='utf-8'))
    baseline = next(row for row in prior['cases'] if row['category']==args.category and row['sample']==args.sample and row['variant']=='description-and-mask')
    target = prior_root/datetime.now(timezone.utc).strftime(f'conditioning-fixed-{args.category}-{args.sample}-%Y%m%dT%H%M%SZ')
    target.mkdir()
    source = Image.open(ROOT/f'samples/characters/{args.sample}.png').convert('RGB')
    reference = Image.open(ROOT/f'workspace/references/{args.category}/reference.png').convert('RGB')
    mask_path = Path(args.mask_file) if args.mask_file else prior_root/args.category/'candidate-mask.png'
    if not mask_path.is_absolute():
        mask_path = ROOT/mask_path
    mask = Image.open(mask_path).convert('L')
    description = args.description or CASES[key]
    record = {'createdAt':datetime.now(timezone.utc).isoformat(),'category':args.category,'sample':args.sample,
              'seed':baseline['seed'],'steps':args.steps,'maxSide':args.max_side,'guidance':args.guidance,
              'maskPath':str(mask_path.relative_to(ROOT)),
              'garmentDescription':description,'checkpoint':'yisol/IDM-VTON-DC' if args.dresscode_checkpoint else 'yisol/IDM-VTON',
              'garmentNegativeDescription':args.negative_description,
              'thresholdsChanged':False,'defaultChanged':False}
    original = ai.traced_pipeline_call
    def capture(pipe, **options):
        options['image'].save(target/'model-source.png')
        options['mask_image'].save(target/'model-mask.png')
        pose = options['pose_img'][0].detach().float().cpu().permute(1,2,0).numpy()
        Image.fromarray(np.uint8(np.clip((pose+1)*127.5,0,255))).save(target/'model-densepose.png')
        torch.cuda.reset_peak_memory_stats()
        start=time.perf_counter()
        result=original(pipe,**options)
        torch.cuda.synchronize()
        record['inferenceSeconds']=time.perf_counter()-start
        record['peakAllocatedMiB']=torch.cuda.max_memory_allocated()/2**20
        (result.images if hasattr(result,'images') else result[0])[0].save(target/'raw.png')
        return result
    ai.traced_pipeline_call=capture
    started=time.perf_counter()
    try:
        result=ai.tryon(dict(modelId='idm-vton',sampleId=f'characters/{args.sample}.png',category=args.category,
            garmentImage=ai.encode_image(reference),editableMask=ai.encode_image(mask),autoMask=False,
            garmentDescription=description,seed=baseline['seed'],steps=args.steps,maxSide=args.max_side,guidance=args.guidance,
            garmentNegativeDescription=args.negative_description,
            count=1,expand=0,blur=6,repairSeams=False,generativeRefine=False,maxRetries=0,
            minimumQuality=0,minimumSimilarity=0,minimumSeam=0,minimumAnatomy=0))
        final=Image.open(ROOT/result['selected']).convert('RGB')
        final.save(target/'final.png')
        effective=Image.open((ROOT/result['selected']).parent/'editable_mask.png').convert('L')
        effective.save(target/'effective-mask.png')
        metrics=ai.score_tryon_result(source,final,effective)
        metrics['referenceSimilarity']=ai.reference_similarity(reference,final,effective)
        color=ai.color_material_consistency(reference,final,effective)
        geometry=ai.catvton_geometry_consistency(final,effective)
        passed=bool(color['accepted'] and geometry['accepted'] and metrics['seamScore']>=80 and metrics['anatomyScore']>=95 and metrics['referenceSimilarity']>=.6)
        record.update(status='completed',selected=result['selected'],modelWidth=result['width'],modelHeight=result['height'],
                      totalSeconds=time.perf_counter()-started,metrics=metrics,colorMaterial=color,geometry=geometry,
                      automaticPassed=passed,prior={k:baseline[k] for k in ['selected','metrics','colorMaterial','geometry','automaticPassed']})
    except Exception:
        record.update(status='failed',error=traceback.format_exc())
    finally:
        ai.traced_pipeline_call=original
        ai.load_tryon_pipe=original_loader
        if diagnostic_pipe is not None:
            del diagnostic_pipe
        ai.release_tryon()
    (target/'report.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'directory':str(target.relative_to(ROOT)),'status':record['status'],'automaticPassed':record.get('automaticPassed'),
                      'similarity':record.get('metrics',{}).get('referenceSimilarity')},ensure_ascii=False),flush=True)

if __name__=='__main__':
    main()
