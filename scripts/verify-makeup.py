"""Live verification on the repository portrait: masks, variants, local AI and replay."""
import base64
import hashlib
import io
import json
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:27866'
OUT=ROOT/'workspace/diagnostics/makeup';OUT.mkdir(parents=True,exist_ok=True)
sys.stdout.reconfigure(encoding='utf-8')
def api(endpoint,body=None):
    req=Request(BASE+'/api/'+endpoint,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
    try:
        with urlopen(req,timeout=600) as r:return json.load(r)
    except HTTPError as e:return json.load(e)
def encode(image):
    data=io.BytesIO();image.save(data,format='PNG');return 'data:image/png;base64,'+base64.b64encode(data.getvalue()).decode()

sample='outpaint-benchmark/portrait-left/reference.png';source=ROOT/'samples'/sample
before=Image.open(source).convert('RGB');sha=hashlib.sha256(source.read_bytes()).hexdigest()
config=api('makeup-config');assert config['landmarkReady'] and config['aiReady'],config
analysis=api('makeup-analyze',{'sampleId':sample});assert analysis['ok'] and len(analysis['faces'])==1,analysis
protect=Image.new('L',before.size);ImageDraw.Draw(protect).rectangle((400,305,420,325),fill=255)
base=dict(sampleId=sample,faceIndex=analysis['faces'][0]['index'],sourceSha256=sha,protectedDetailMask=encode(protect),preserveFeatures=True)
records=[]
for name,extra in [('peach',dict(style='peach')),('peach-preview',dict(style='peach',preview=True)),('lips-only',dict(style='classic',parts=['lips'])),('artistic-ai',dict(style='artistic',parts=['lips','eyes','cheeks']))]:
    job='makeup-verify-'+uuid.uuid4().hex[:12]
    result=api('makeup',{**base,**extra,'jobId':job});assert result.get('ok'),result
    folder=ROOT/result['directory'];allowed=np.array(Image.open(folder/'applied_mask.png'))>0
    assert len(result['results'])==2
    for item in result['results']:
        image=np.array(Image.open(ROOT/item['file']));baseline=np.array(Image.open(ROOT/item['comparisonFile']))
        local=allowed if not item['previewOnly'] else allowed[item['crop'][1]:item['crop'][3],item['crop'][0]:item['crop'][2]]
        assert np.array_equal(image[~local],baseline[~local]);assert np.any(image[local]!=baseline[local])
    assert hashlib.sha256(source.read_bytes()).hexdigest()==sha
    state=api('job-status',{'jobId':job});assert state['status']=='completed' and len(state['results'])==2,state
    if not result['previewOnly']:
        chosen=api('select-result',{'directory':result['directory'],'seed':43});assert chosen.get('ok'),chosen
        assert (folder/'selected.png').read_bytes()==(folder/'result_seed_43.png').read_bytes()
    records.append(dict(case=name,jobId=job,directory=result['directory'],seconds=result['durationSeconds'],results=result['results'],outsideExact=True,sourceUnchanged=True))
    (OUT/'live-verification.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
    print(name,result['durationSeconds'],result['directory'],flush=True)
full=Image.open(ROOT/records[0]['results'][0]['file']);preview=records[1]['results'][0]
assert np.array_equal(full.crop(preview['crop']),Image.open(ROOT/preview['file']))
box=(200,145,495,480);sheet=Image.new('RGB',(590,365),'#eeeeee')
sheet.paste(before.crop(box),(0,30));sheet.paste(full.crop(box),(295,30));d=ImageDraw.Draw(sheet);d.text((10,8),'BEFORE',fill='black');d.text((305,8),'PEACH MAKEUP',fill='black');sheet.save(OUT/'comparison.png')
invalid=api('makeup',{**base,'limitSelection':True});assert not invalid['ok']
cancel='makeup-cancel-'+uuid.uuid4().hex[:12]
with ThreadPoolExecutor() as pool:
    future=pool.submit(api,'makeup',{**base,'style':'artistic','jobId':cancel})
    time.sleep(.3);assert api('cancel-job',{'jobId':cancel})['ok']
    result=future.result();assert not result['ok'],result
state=api('job-status',{'jobId':cancel});assert state['status']=='cancelled' and not state.get('results'),state
(OUT/'verification-summary.json').write_text(json.dumps(dict(cases=len(records),outsideExact=True,sourceUnchanged=True,previewEqualsFull=True,selectionSaved=True,cancelNoOutput=True,emptyMaskRejected=True),indent=2),encoding='utf-8')
print('PASS: pixels, preview, variants, selection, cancellation and source integrity.',flush=True)
