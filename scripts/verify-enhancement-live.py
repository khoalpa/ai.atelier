"""Exercise local HTTP, real GPU, cancellation and stored results without feedback labels."""
import base64
import hashlib
import io
import json
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from PIL import Image, ImageDraw
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:27860'
OUT=ROOT/'workspace/diagnostics/image-enhancement'
OUT.mkdir(parents=True,exist_ok=True)
def api(endpoint,body=None):
    request=Request(BASE+'/api/'+endpoint,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
    try:
        with urlopen(request,timeout=180) as response:return json.load(response)
    except HTTPError as error:return json.load(error)
def encode(mask):
    stream=io.BytesIO();mask.save(stream,format='PNG');return 'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode()
source='outpaint-benchmark/studio-left/source.png';path=ROOT/'samples'/source
before=hashlib.sha256(path.read_bytes()).hexdigest();size=Image.open(path).size
protect=Image.new('L',size);ImageDraw.Draw(protect).rectangle((size[0]//4,0,size[0]*3//4,size[1]//3),fill=255)
selected=Image.new('L',size);ImageDraw.Draw(selected).rectangle((20,20,size[0]-21,size[1]-21),fill=255)
config=api('enhance-config');assert config['serviceReady'] and config['modelReady'],config
records=[]
for method,preview in [('light',False),('ai2x',True),('ai2x',False)]:
    job='enhance-live-'+uuid.uuid4().hex[:12]
    body=dict(jobId=job,sampleId=source,method=method,profile='portrait',level='balanced',scope='selected',
              editableMask=encode(selected),protectedDetailMask=encode(protect),preview=preview,previewX=100,previewY=100)
    result=api('enhance',body);assert result.get('ok'),result
    item=result['results'][0];state=api('job-status',{'jobId':job})
    assert state['status']=='completed' and state['results'][-1]['file']==item['file']
    actual=np.asarray(Image.open(ROOT/item['file']));reference=np.asarray(Image.open(ROOT/item['comparisonFile']))
    allowed=np.asarray(Image.open(ROOT/result['directory']/'editable_mask.png').resize((item['width'],item['height']),Image.Resampling.NEAREST))>0
    assert np.array_equal(actual[~allowed],reference[~allowed])
    assert hashlib.sha256(path.read_bytes()).hexdigest()==before
    if not preview:
        chosen=api('select-result',{'directory':result['directory'],'seed':0});assert chosen.get('ok'),chosen
        assert (ROOT/result['directory']/'selected.png').read_bytes()==(ROOT/item['file']).read_bytes()
    records.append({'jobId':job,'method':method,'preview':preview,'seconds':result['durationSeconds'],'file':item['file'],
                    'width':item['width'],'height':item['height'],'protectedExact':True,'device':result['device']})
    print(records[-1],flush=True)
job='enhance-cancel-'+uuid.uuid4().hex[:12]
with ThreadPoolExecutor(max_workers=1) as pool:
    future=pool.submit(api,'enhance',dict(jobId=job,sampleId=source,method='ai2x'))
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        state=api('job-status',{'jobId':job})
        if state.get('status')=='running':break
        time.sleep(.1)
    cancelled=api('cancel-job',{'jobId':job});assert cancelled.get('ok'),cancelled
    response=future.result(60);state=api('job-status',{'jobId':job})
    assert state['status']=='cancelled' and not state.get('results'),state
bad=api('enhance',dict(jobId='enhance-invalid-'+uuid.uuid4().hex[:8],sampleId='../README.md'))
assert not bad.get('ok'),bad
(OUT/'live-verification.json').write_text(json.dumps(dict(base=BASE,cases=records,cancellation={'jobId':job,'status':state['status'],'publishedResults':0},invalidPathRejected=True),ensure_ascii=False,indent=2),encoding='utf-8')
print('Verified live processing, selection, stored jobs, cancellation and path rejection.')
