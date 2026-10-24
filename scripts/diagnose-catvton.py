"""Capture a fixed CatVTON case at each boundary without changing its inputs."""
import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--steps', type=int, default=20)
    parser.add_argument('--max-side', type=int, default=512)
    parser.add_argument('--repeat', action='store_true')
    parser.add_argument('--mask-mode', choices=['dedicated','standard'], default='dedicated')
    parser.add_argument('--compare-condition', action='store_true')
    args = parser.parse_args()
    import numpy as np
    import torch
    from PIL import Image
    from safetensors import safe_open
    import ai_service as ai

    target = ROOT/'workspace/diagnostics'/datetime.now(timezone.utc).strftime('catvton_%Y%m%dT%H%M%SZ')
    target.mkdir(parents=True)
    torch.manual_seed(52001)
    source = Image.open(ROOT/'samples/characters/c001.png').convert('RGB')
    reference = Image.open(ROOT/'workspace/references/upper_body/reference.png').convert('RGB')
    people = ai.detect_people(source, True)
    person = people[0]
    mask, score, mask_info = ai.catvton_dedicated_mask(source, 'upper_body', person['box'], person['keypoints'])
    if args.mask_mode=='standard':
        mask,score=ai.automatic_garment_mask(source,'upper_body',person['box'],person['keypoints'])
        mask_info={'mode':'standard','confidence':score,**ai.mask_strength_policy(mask,person['box'],'upper_body',person['keypoints'])}
    source.save(target/'source.png')
    reference.save(target/'reference.png')
    mask.save(target/'requested-mask.png')

    pipe = ai.load_tryon_pipe()
    checkpoint = ai.CATVTON_MODEL/'mix-48k-1024/attention/model.safetensors'
    state = pipe.attn_modules.state_dict()
    with safe_open(checkpoint, framework='pt', device='cpu') as saved:
        keys = set(saved.keys())
        # state_dict includes aliases from the upstream ModuleList. Check unique
        # parameters so saved shared tensors do not look like missing weights.
        missing = sorted(set(dict(pipe.attn_modules.named_parameters()))-keys)
        unexpected = sorted(keys-set(state))
        mismatches = [key for key in keys & set(state) if not torch.equal(saved.get_tensor(key).to(state[key].dtype), state[key].cpu())]
    report = {'seed':52001,'steps':args.steps,'maxSide':args.max_side,'mask':mask_info,
              'attention':{'checkpoint':str(checkpoint.relative_to(ROOT)),'sha256':hashlib.sha256(checkpoint.read_bytes()).hexdigest(),'keys':len(keys),'missing':missing,'unexpected':unexpected,'mismatches':mismatches},
              'runtime':{'torch':torch.__version__,'dtype':str(pipe.weight_dtype)},'calls':[]}
    original = ai.traced_pipeline_call
    captured = {}
    def capture(pipeline, **options):
        image, garment, hard_mask = pipeline.check_inputs(options['image'],options['condition_image'],options['mask'],options['width'],options['height'])
        image.save(target/'model-source.png')
        garment.save(target/'model-reference.png')
        hard_mask.save(target/'model-mask.png')
        from utils import prepare_image, numpy_to_pil
        with torch.inference_mode():
            tensor=prepare_image(garment).to(pipeline.device,dtype=pipeline.vae.dtype)
            reconstructed=pipeline.vae.decode(pipeline.vae.encode(tensor).latent_dist.mode()).sample
            reconstructed=((reconstructed/2+.5).clamp(0,1).cpu().permute(0,2,3,1).float().numpy())
        reconstruction=numpy_to_pil(reconstructed)[0]
        reconstruction.save(target/'vae-reference-roundtrip.png')
        report['vaeReferenceRoundtripMAE']=float(np.abs(np.asarray(reconstruction).astype(float)-np.asarray(garment).astype(float)).mean())
        inputs = np.asarray(image).copy()
        inputs[np.asarray(hard_mask)>127] = 127
        Image.fromarray(inputs).save(target/'model-masked-source.png')
        result = original(pipeline, **options)
        result[0].save(target/'model-raw.png')
        captured.update(pipe=pipeline, options=options, raw=result[0])
        report['calls'].append({key:options[key] for key in ['width','height','num_inference_steps','guidance_scale']})
        return result
    ai.traced_pipeline_call = capture
    try:
        result = ai.tryon({'sampleId':'characters/c001.png','category':'upper_body','garmentImage':ai.encode_image(reference),
                          'editableMask':ai.encode_image(mask),'autoMask':False,'seed':52001,'steps':args.steps,
                          'maxSide':args.max_side,'count':1,'expand':0,'blur':6,'repairSeams':False,'generativeRefine':False,
                          'maxRetries':0,'minimumQuality':0,'minimumSimilarity':0,'minimumSeam':0,'minimumAnatomy':0})
    finally:
        ai.traced_pipeline_call = original
    final = Image.open(ROOT/result['selected']).convert('RGB')
    final.save(target/'final.png')
    selected = np.asarray(mask)>127
    before = np.asarray(source).astype(float)
    after = np.asarray(final).astype(float)
    report.update(selected=result['selected'],results=[{key:value for key,value in item.items() if key not in ('image','mask','preview')} for item in result['results']],outsideRequestedMaskMAE=float(np.abs(after-before)[~selected].mean()))
    if args.repeat:
        options = dict(captured['options'])
        options['generator'] = torch.Generator(device=ai.device).manual_seed(52001)
        repeated = original(captured['pipe'],**options)[0]
        repeated.save(target/'model-raw-repeat.png')
        report['sameSeedRepeatMAE'] = float(np.abs(np.asarray(repeated).astype(float)-np.asarray(captured['raw']).astype(float)).mean())
    if args.compare_condition:
        options=dict(captured['options'])
        options['generator']=torch.Generator(device=ai.device).manual_seed(52001)
        options['condition_image']=Image.new('RGB',options['condition_image'].size,'white')
        unconditioned=original(captured['pipe'],**options)[0]
        unconditioned.save(target/'model-raw-white-reference.png')
        difference=np.abs(np.asarray(unconditioned).astype(float)-np.asarray(captured['raw']).astype(float))
        input_mask=captured['options']['mask'].resize(unconditioned.size,Image.Resampling.NEAREST)
        report['whiteReferenceAblationInsideMaskMAE']=float(difference[np.asarray(input_mask)>127].mean())
    (target/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'report':str((target/'report.json').relative_to(ROOT)),'attention':report['attention'],'sameSeedRepeatMAE':report.get('sameSeedRepeatMAE')}),flush=True)

if __name__=='__main__':
    main()
