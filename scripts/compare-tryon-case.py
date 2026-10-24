"""Run a paired diagnostic without approving outputs or changing defaults."""
import json
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

def main():
    import numpy as np
    import torch
    from PIL import Image, ImageDraw
    import ai_service as ai

    target = ROOT / 'workspace/diagnostics' / datetime.now(timezone.utc).strftime('tryon-comparison_%Y%m%dT%H%M%SZ')
    target.mkdir(parents=True)
    source = Image.open(ROOT/'samples/characters/c001.png').convert('RGB')
    reference = Image.open(ROOT/'workspace/references/upper_body/reference.png').convert('RGB')
    mask = Image.open(ROOT/'workspace/diagnostics/catvton_20261020T074128Z/requested-mask.png').convert('L')
    for name, image in [('source',source),('reference',reference),('requested-mask',mask)]:
        image.save(target/f'{name}.png')
    body = dict(sampleId='characters/c001.png', category='upper_body', garmentImage=ai.encode_image(reference),
                editableMask=ai.encode_image(mask), autoMask=False, seed=52001, steps=20, maxSide=512,
                count=1, expand=0, blur=6, repairSeams=False, generativeRefine=False, maxRetries=0,
                minimumQuality=0, minimumSimilarity=0, minimumSeam=0, minimumAnatomy=0)
    report = {'case':'c001 / synthetic blue long-sleeve shirt', 'seed':52001,'steps':20,'maxSide':512,
              'guidance':2.5,'diagnosticOnly':True,'models':{}}
    original = ai.traced_pipeline_call
    for model in ['catvton','idm-vton']:
        folder=target/model
        folder.mkdir()
        record={}
        report['models'][model]=record
        def capture(pipe, **options):
            record['dimensions']=[options['width'],options['height']]
            options['image'].save(folder/'model-source.png')
            options.get('mask',options.get('mask_image')).save(folder/'model-mask.png')
            if 'condition_image' in options:
                pipe.check_inputs(options['image'], options['condition_image'], options['mask'],options['width'],options['height'])[1].save(folder/'model-reference.png')
            else:
                options['ip_adapter_image'].save(folder/'model-reference.png')
            torch.cuda.reset_peak_memory_stats()
            start=time.perf_counter()
            result=original(pipe,**options)
            torch.cuda.synchronize()
            record['inferenceSeconds']=time.perf_counter()-start
            record['peakAllocatedMB']=torch.cuda.max_memory_allocated()/2**20
            images=result.images if hasattr(result,'images') else result
            if isinstance(images[0], list):
                images=images[0]
            images[0].save(folder/'raw.png')
            return result
        ai.traced_pipeline_call=capture
        start=time.perf_counter()
        try:
            result=ai.tryon({**body,'modelId':model})
            final=Image.open(ROOT/result['selected']).convert('RGB')
            final.save(folder/'final.png')
            record.update(status='completed', totalSeconds=time.perf_counter()-start, selected=result['selected'],
                          metrics=[{k:v for k,v in row.items() if k not in ('image','mask','preview')} for row in result['results']])
            actual_mask=Image.open((ROOT/result['selected']).parent/'editable_mask.png').convert('L')
            actual_mask.save(folder/'effective-mask.png')
            outside=np.asarray(actual_mask)==0
            record['outsideHardMaskMAE']=float(np.abs(np.asarray(final).astype(float)-np.asarray(source).astype(float))[outside].mean())
        except Exception:
            record.update(status='failed', totalSeconds=time.perf_counter()-start,error=traceback.format_exc())
        finally:
            ai.traced_pipeline_call=original
            ai.release_tryon()
        (target/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({'model':model,**record}),flush=True)
    panels=[('Source',source),('Reference',reference),('Mask',mask.convert('RGB'))]
    for model in report['models']:
        for name in ['raw','final']:
            path=target/model/f'{name}.png'
            if path.exists(): panels.append((f'{model} {name}',Image.open(path).convert('RGB')))
    sheet=Image.new('RGB',(280*len(panels),420),'#eeeeee')
    draw=ImageDraw.Draw(sheet)
    for i,(label,image) in enumerate(panels):
        image.thumbnail((270,380))
        sheet.paste(image,(i*280+(280-image.width)//2,30))
        draw.text((i*280+8,8),label,fill='black')
    sheet.save(target/'comparison.jpg')
    print(str(target),flush=True)

if __name__=='__main__':
    main()
