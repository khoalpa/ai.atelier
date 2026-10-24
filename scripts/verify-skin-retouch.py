"""Live local API checks on a portrait and a clearly labeled synthetic scar fixture."""
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
from PIL import Image, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sample_catalog import resolve_sample
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:27862'
OUT = ROOT/'workspace/diagnostics/skin-retouch'
OUT.mkdir(parents=True, exist_ok=True)


def api(endpoint, body=None):
    request = Request(BASE+'/api/'+endpoint, data=json.dumps(body).encode() if body is not None else None,
                      headers={'Content-Type':'application/json'})
    try:
        with urlopen(request, timeout=600) as response: return json.load(response)
    except HTTPError as error: return json.load(error)


def encode(mask):
    stream=io.BytesIO(); mask.save(stream, format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode()


source_id = 'outpaint-benchmark/portrait-left/reference.png'
source_path = resolve_sample(ROOT, source_id)
original_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
source = ImageOps.exif_transpose(Image.open(source_path)).convert('RGB')
assert source.size == (745, 1024), source.size
protect = Image.new('L', source.size)
pd = ImageDraw.Draw(protect)
pd.rectangle((205, 190, 407, 282), fill=255); pd.rectangle((235, 365, 342, 420), fill=255)
spot = Image.new('L', source.size); ImageDraw.Draw(spot).ellipse((403, 308, 416, 321), fill=255)
area = Image.new('L', source.size); ImageDraw.Draw(area).ellipse((350, 285, 438, 377), fill=255)
scar = Image.new('L', source.size); ImageDraw.Draw(scar).ellipse((350, 308, 402, 368), fill=255)
fixture = source.copy(); layer = Image.new('RGBA', source.size); d=ImageDraw.Draw(layer)
d.line([(369, 322), (380, 338), (377, 349)], fill=(90, 38, 28, 210), width=5)
d.line([(365, 322), (376, 338), (373, 349)], fill=(244, 202, 177, 225), width=4)
fixture=Image.alpha_composite(fixture.convert('RGBA'), layer.filter(ImageFilter.GaussianBlur(1))).convert('RGB')
fixture_name = 'skin-retouch-test-synthetic-scar.png'
fixture_path = ROOT/'workspace/uploads'/fixture_name
fixture.save(fixture_path); fixture.save(OUT/'synthetic-scar-input.png')
records=[]
config=api('enhance-config'); assert config['skin']['version']==1 and config['skin']['modelReady'], config
cases=[('natural-mole', 'skin-heal', source_id, spot, False, 0),
       ('cheek-smoothing', 'skin-smooth', source_id, area, False, 55),
       ('synthetic-scar', 'skin-ai', 'uploads/'+fixture_name, scar, False, 0),
       ('synthetic-scar-preview', 'skin-ai', 'uploads/'+fixture_name, scar, True, 0)]
for name, method, sample, mask, preview, amount in cases:
    job='enhance-skin-'+uuid.uuid4().hex[:12]
    body=dict(jobId=job, sampleId=sample, method=method, level='balanced', scope='selected',
              editableMask=encode(mask), protectedDetailMask=encode(protect), skinSmooth=amount,
              preserveTexture=True, preview=preview)
    result=api('enhance', body); assert result.get('ok'), result
    item=result['results'][0]; state=api('job-status', {'jobId':job})
    assert state['status']=='completed' and state['results'][-1]['file']==item['file'], state
    actual=np.array(Image.open(ROOT/item['file'])); before=np.array(Image.open(ROOT/item['comparisonFile']))
    allowed=np.asarray(Image.open(ROOT/result['directory']/'editable_mask.png'))>0
    assert actual.shape==before.shape and np.array_equal(actual[~allowed], before[~allowed])
    assert hashlib.sha256(source_path.read_bytes()).hexdigest()==original_hash
    assert np.any(actual[allowed]!=before[allowed])
    if not preview:
        chosen=api('select-result', {'directory':result['directory'], 'seed':0}); assert chosen.get('ok'), chosen
        assert (ROOT/result['directory']/'selected.png').read_bytes()==(ROOT/item['file']).read_bytes()
    record=dict(case=name, method=method, preview=preview, jobId=job, sourceUnchanged=True,
                outsideExact=True, seconds=result['durationSeconds'], file=item['file'],
                comparison=item['comparisonFile'], crop=item['crop'], metrics=result['metrics'])
    records.append(record)
    (OUT/'live-verification.json').write_text(json.dumps(dict(cases=records), ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False), flush=True)
    if not preview:
        box=(320, 285, 455, 390)
        a=Image.fromarray(before).crop(box).resize((405,315)); b=Image.fromarray(actual).crop(box).resize((405,315))
        sheet=Image.new('RGB',(810,345),'#eeeeee'); sheet.paste(a,(0,30));sheet.paste(b,(405,30))
        text=ImageDraw.Draw(sheet);text.text((10,8),'BEFORE',fill='black');text.text((415,8),'AFTER - '+name,fill='black')
        sheet.save(OUT/(name+'-comparison.png'))

full=np.array(Image.open(ROOT/records[2]['file'])); preview=np.array(Image.open(ROOT/records[3]['file']))
x,y,r,b=records[3]['crop']; difference=np.abs(full[y:b,x:r].astype(float)-preview)
assert difference.mean()<.1, difference.mean()
bad=api('enhance', dict(jobId='enhance-skin-empty-'+uuid.uuid4().hex[:8],sampleId=source_id,method='skin-ai',scope='all'))
assert not bad.get('ok'), bad
job='enhance-skin-cancel-'+uuid.uuid4().hex[:10]
with ThreadPoolExecutor(max_workers=1) as pool:
    future=pool.submit(api,'enhance',dict(jobId=job,sampleId=source_id,method='skin-ai',editableMask=encode(scar)))
    deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        state=api('job-status', {'jobId':job})
        if state.get('stage')=='enhance-processing':break
        time.sleep(.3)
    cancelled=api('cancel-job', {'jobId':job}); assert cancelled.get('ok'), cancelled
    response=future.result(180);state=api('job-status', {'jobId':job})
    assert state['status']=='cancelled' and not state.get('results'),state
report=dict(cases=records,previewFullMeanError=float(difference.mean()),emptySelectionRejected=True,
            cancellation={'jobId':job,'status':state['status'],'publishedResults':0})
(OUT/'live-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('Verified live skin repair, preview, exact preservation, selection and cancellation.',flush=True)
