"""Small real-image checks using the installed model. Keeps all source files untouched."""
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageOps

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sample_catalog import resolve_sample
import image_enhancement as ie

OUT=ROOT/'workspace/diagnostics/image-enhancement'
OUT.mkdir(parents=True,exist_ok=True)
CASES=[('portrait','outpaint-benchmark/portrait-left/reference.png','portrait'),
       ('fabric','outpaint-benchmark/fabric-left/reference.png','product'),
       ('product','garment/garment_1.png','product'),
       ('interior','outpaint-benchmark/interior-left/reference.png','general')]
records=[]
for name,relative,profile in CASES:
    path=resolve_sample(ROOT, relative);before_hash=hashlib.sha256(path.read_bytes()).hexdigest()
    image=ImageOps.exif_transpose(Image.open(path)).convert('RGB');image.thumbnail((385,321))
    source=OUT/(name+'-input.png');image.save(source)
    protect=Image.new('L',image.size);ImageDraw.Draw(protect).rectangle((10,10,50,50),fill=255)
    import io,base64
    buffer=io.BytesIO();protect.save(buffer,format='PNG')
    mask='data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()
    events=[]
    env=dict(ROOT=ROOT,OUTPUTS=OUT/'results',JOBS_DIR=OUT/'jobs',torch=torch,safe_sample=lambda _:source,
             update_job=lambda *a,**k:events.append(k),ensure_job_active=lambda *_:None,
             persist_job_request=lambda *_:None,release_inpaint=lambda:None,release_tryon=lambda:None,release_text_to_image=lambda:None)
    for method in ('light','ai2x'):
        if torch.cuda.is_available():torch.cuda.reset_peak_memory_stats()
        result=ie.enhance(dict(sampleId=relative,jobId=name+'-'+method,method=method,profile=profile,level='balanced',protectedDetailMask=mask),env)
        item=result['results'][0]
        output=np.asarray(Image.open(ROOT/item['file']));baseline=np.asarray(Image.open(ROOT/item['comparisonFile']))
        keep=np.asarray(protect.resize((item['width'],item['height']),Image.Resampling.NEAREST))>0
        assert np.array_equal(output[keep],baseline[keep])
        assert hashlib.sha256(path.read_bytes()).hexdigest()==before_hash
        record=dict(case=name,method=method,seconds=result['durationSeconds'],width=item['width'],height=item['height'],
                    sourceUnchanged=True,protectedExact=True,metrics=item['metrics'],file=item['file'],before=item['comparisonFile'],
                    peakVramMb=round(torch.cuda.max_memory_allocated()/1048576,1) if torch.cuda.is_available() else 0)
        records.append(record);print(json.dumps(record,ensure_ascii=False),flush=True)
    # Independently compare tile overlap with single-tile inference on one image.
    if name=='fabric':
        single=ie.ai_candidate(image,ROOT,tile=512);tiled=ie.ai_candidate(image,ROOT,tile=128)
        delta=np.abs(np.asarray(single).astype(float)-np.asarray(tiled).astype(float))
        seam={'meanError':float(delta.mean()),'p99Error':float(np.percentile(delta,99)),'maxError':float(delta.max())}
        assert seam['meanError']<1.0,seam
        (OUT/'tile-comparison.json').write_text(json.dumps(seam,indent=2),encoding='utf-8')
(OUT/'verification.json').write_text(json.dumps({'gpu':torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu','cases':records},ensure_ascii=False,indent=2),encoding='utf-8')
print('Verified',len(records),'real-image processing cases.')
