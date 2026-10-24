"""Live comparison, preview/full parity and cancellation on a repository portrait."""
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
OUT=ROOT/'workspace/diagnostics/makeup-comparison';OUT.mkdir(parents=True,exist_ok=True)
sys.stdout.reconfigure(encoding='utf-8')

def api(endpoint,body=None):
    request=Request(BASE+'/api/'+endpoint,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
    try:
        with urlopen(request,timeout=600) as response:return json.load(response)
    except HTTPError as error:return json.load(error)

def encode(image):
    buffer=io.BytesIO();image.save(buffer,format='PNG');return 'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()

def decode(data):return Image.open(io.BytesIO(base64.b64decode(data.split(',',1)[1]))).convert('L')
def job():return 'makeup-compare-verify-'+uuid.uuid4().hex[:12]

sample='outpaint-benchmark/portrait-left/reference.png';source=ROOT/'samples'/sample
before=Image.open(source).convert('RGB');sha=hashlib.sha256(source.read_bytes()).hexdigest()
analysis=api('makeup-analyze',{'sampleId':sample});assert analysis.get('ok'),analysis
face=analysis['faces'][0]
selected=Image.fromarray(np.maximum.reduce([np.array(decode(mask)) for mask in face['regions'].values()]))
# The manual protection crosses the face; both masks must survive choosing a style.
protected=Image.new('L',before.size);ImageDraw.Draw(protected).rectangle((290,250,310,430),fill=255)
body=dict(sampleId=sample,sourceSha256=sha,faceIndex=face['index'],editableMask=encode(selected),protectedDetailMask=encode(protected))
styles=[dict(id=name,name=name,settings={'style':name}) for name in ('natural','artistic','classic')]
result=api('makeup-compare',{**body,'comparisonStyles':styles,'jobId':job()})
assert result.get('ok') and result['status']=='completed' and len(result['results'])==3,result
reports=[]
for item in result['results']:
    folder=(ROOT/item['file']).parent;crop=item['crop'];x,y,r,b=crop
    preview=np.array(Image.open(ROOT/item['file']));baseline=np.array(before.crop(crop))
    allowed=np.array(Image.open(folder/'applied_mask.png'))[y:b,x:r]>0
    np.testing.assert_array_equal(preview[~allowed],baseline[~allowed])
    protected_local=np.asarray(protected)[y:b,x:r]>0
    np.testing.assert_array_equal(preview[protected_local],baseline[protected_local])
    np.testing.assert_array_equal(Image.open(folder/'editable_mask.png'),selected)
    np.testing.assert_array_equal(Image.open(folder/'protected_mask.png'),protected)
    full=api('makeup',{**item['settings'],**body,'plannedDescription':item['settings']['description'],'preview':False,'limitSelection':True,'jobId':job()})
    assert full.get('ok') and len(full['results'])==2,full
    np.testing.assert_array_equal(Image.open(ROOT/full['results'][0]['file']).crop(crop),preview)
    reports.append(dict(style=item['comparisonName'],preview=item['file'],full=full['results'][0]['file'],previewEqualsFull=True,outsideExact=True,protectedExact=True,masksRestored=True))
    print('PASS preview/full and masks:',item['comparisonName'],flush=True)

cancel_id=job()
with ThreadPoolExecutor() as pool:
    future=pool.submit(api,'makeup-compare',{**body,'comparisonStyles':styles,'jobId':cancel_id})
    deadline=time.monotonic()+120
    while time.monotonic()<deadline:
        state=api('job-status',{'jobId':cancel_id})
        if len(state.get('results',[]))==1 and state.get('status')=='running':break
        if future.done():raise AssertionError('Batch completed before cancellation could be tested')
        time.sleep(.1)
    else:raise AssertionError('No first candidate published before timeout')
    assert api('cancel-job',{'jobId':cancel_id}).get('ok')
    cancelled=future.result()
assert cancelled['status']=='cancelled' and len(cancelled['results'])==1,cancelled
assert [entry['status'] for entry in cancelled['comparisonEntries']]==['completed','cancelled','cancelled']
assert (ROOT/cancelled['results'][0]['file']).is_file()
state=api('job-status',{'jobId':cancel_id})
assert state['status']=='cancelled' and len(state['results'])==1,state
assert hashlib.sha256(source.read_bytes()).hexdigest()==sha
report=dict(passed=True,comparisonJob=result['jobId'],cases=reports,cancelJob=cancel_id,cancelKeepsCompleted=True,sourceUnchanged=True)
(OUT/'live-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('PASS: 3 styles including local AI, exact preview/full parity, masks, cancellation and source integrity.',flush=True)
