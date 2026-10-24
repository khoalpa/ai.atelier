"""Thirty local sources, with auditable outcomes rather than invented scores.

The manifest distinguishes synthetic and photographic source collections. Results
measure preservation/face detection; fingers, clothing and identity need visual
review. No images are sent outside localhost.
"""
import json
import sys
import time
import uuid
from pathlib import Path
import numpy as np
import requests
from PIL import Image,ImageOps,ImageDraw

ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'workspace/diagnostics/character-upgrade/matrix';API='http://127.0.0.1:7860/api/'
sys.path.insert(0, str(ROOT))
from sample_catalog import resolve_sample, sample_ids


def post(route,body):
    r=requests.post(API+route,json=body,timeout=1200);value=r.json()
    if not r.ok or not value.get('ok'):raise RuntimeError(str(value))
    return value


def main():
    OUT.mkdir(parents=True,exist_ok=True);sources=[]
    for folder,limit in [('characters',3),('portrait',6),('expand',6),('couple_tee',6),('synthetic-paired-vton-20261021/images/people',9)]:
        ids=sample_ids(ROOT, (folder+'/',))
        if 'synthetic' in folder:ids=[s for s in ids if Path(s).name.startswith('upper-body') and s.endswith('p1.png')]
        for sample_id in ids[:limit]:
            p=resolve_sample(ROOT,sample_id)
            sources.append(dict(source=sample_id,collection=folder,sha256=__import__('hashlib').sha256(p.read_bytes()).hexdigest()))
    assert len(sources)==30
    (OUT/'manifest.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2),encoding='utf8');records=[]
    for index,item in enumerate(sources):
        file=OUT/f'{index+1:02d}.json'
        if file.exists():records.append(json.loads(file.read_text(encoding='utf8')));continue
        record={**item,'case':index+1};started=time.time()
        try:
            a=post('character-analyze',{'sampleId':item['source']});faces=[p for p in a['people'] if p.get('faceBox')]
            if not faces:raise ValueError('No face >=48px; input correctly rejected')
            body=dict(sampleId=item['source'],sourceSha256=a['sourceSha256'],personIds=[faces[0]['id']],mode='face',pose='keep',expression=['smile','serious','surprised'][index%3],intensity=.35,count=1,seed=42)
            plan=post('character-preview',body);body.update(planHash=plan['planHash'],targetPoses=plan['targetPoses'],jobId='character-matrix-'+uuid.uuid4().hex[:12]);result=post('character-render',body)
            folder=ROOT/result['directory'];source=np.array(Image.open(folder/'source.png'));mask=np.array(Image.open(folder/'applied_mask.png'))>0;output=result['results'][0];pixels=np.array(Image.open(ROOT/output['file']))
            assert np.array_equal(source[~mask],pixels[~mask]);assert source.shape==pixels.shape
            record.update(status='passed',exactOutsideMask=True,file=output['file'],metrics=output['metrics'],people=len(a['people']),expression=body['expression'])
            # Diagnostic renders stay available through this report and history.
            metadata=json.loads((folder/'metadata.json').read_text(encoding='utf8'));metadata.update(diagnosticOnly=True,previewOnly=True);(folder/'metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf8')
        except Exception as error:record.update(status='rejected-or-failed',error=str(error))
        record['seconds']=round(time.time()-started,2);file.write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf8');records.append(record);print(index+1,record['status'],record['source'],flush=True)
    for record in records:
        if record['source'] in ('portrait/farewell.png','couple_tee/Couple tee local.jpg'):record['expectedRejection']=True
    report=dict(sources=len(records),expectedRejections=sum(bool(r.get('expectedRejection')) and r['status']=='rejected-or-failed' for r in records),passed=sum(r['status']=='passed' for r in records),records=records,scope='source binding, visible face detection, exact pixels outside allowed region, full-size output',visualReviewRequired=['identity','expression realism','clothing','fingers','contact','seams'])
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    sheet=Image.new('RGB',(1200,6*250),'#18212d');draw=ImageDraw.Draw(sheet)
    for index,r in enumerate(records):
        image=Image.open(ROOT/r['file'] if r.get('file') else resolve_sample(ROOT, r['source'])).convert('RGB');image=ImageOps.contain(image,(232,220));x=(index%5)*240;y=(index//5)*250;sheet.paste(image,(x+(240-image.width)//2,y));draw.text((x+8,y+225),f"{index+1:02d} {r['status']}",fill='white')
    sheet.save(OUT/'contact-sheet.jpg');print('REPORT',OUT/'report.json',flush=True)


if __name__=='__main__':main()
