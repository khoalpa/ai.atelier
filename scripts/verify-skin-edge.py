"""Local endpoint verification. A supplied image remains untouched; its copy is a test source."""
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

import numpy as np
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import image_enhancement as enhancement

OUT = ROOT/'workspace/diagnostics/skin-edge'
OUT.mkdir(parents=True, exist_ok=True)


def encoded(image):
    buffer = io.BytesIO(); image.save(buffer, format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()


def main():
    path = Path(sys.argv[1])
    base = sys.argv[2] if len(sys.argv)>2 else None
    original_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    source = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    if source.size != (1062, 1040):
        raise ValueError('This fixture expects the supplied 1062 x 1040 shoulder crop.')
    copied = ROOT/'workspace/uploads/skin-edge-example.png'; source.save(copied)
    mask = Image.new('L', source.size)
    points = [(0,180),(125,285),(253,371),(345,430),(440,468),(556,554),(680,640),(752,718),(814,807),(836,885),(829,965),(817,1039)]
    ImageDraw.Draw(mask).line(points, fill=255, width=100, joint='curve')
    protected = Image.new('L', source.size); ImageDraw.Draw(protected).rectangle((300,380,370,470),fill=255)
    mask.save(OUT/'selection.png'); protected.save(OUT/'protection.png')
    records=[]
    def api(endpoint, body=None):
        req=Request(base+'/api/'+endpoint, data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
        try:
            with urlopen(req, timeout=120) as response:return json.load(response)
        except HTTPError as error:return json.load(error)
    env=dict(ROOT=ROOT, OUTPUTS=OUT/'runs', JOBS_DIR=OUT/'jobs',safe_sample=lambda _:copied,
             ensure_job_active=lambda *_:None,persist_job_request=lambda *_:None,update_job=lambda *a,**kw:None)
    for name, preview, manual in [('auto',False,False),('guided',False,True),('preview',True,True)]:
        body=dict(sampleId='uploads/skin-edge-example.png', jobId='enhance-edge-'+uuid.uuid4().hex[:12], method='skin-edge',
                  scope='selected', editableMask=encoded(mask), protectedDetailMask=encoded(protected),
                  level='balanced', edgeWidth=24, edgeSoftness=45, edgeDecontam=40, preview=preview)
        if manual:body.update(edgeSkinPoint={'x':400,'y':720}, edgeBackgroundPoint={'x':750,'y':380})
        result=api('enhance',body) if base else enhancement.enhance(body,env)
        assert result.get('ok'),result
        item=result['results'][0]
        before=np.array(Image.open(ROOT/item['comparisonFile']));after=np.array(Image.open(ROOT/item['file']))
        allowed=np.array(Image.open(ROOT/result['directory']/'editable_mask.png'))>0
        band=np.array(Image.open(ROOT/item['edgeBandFile']))>0
        assert np.array_equal(before[~allowed],after[~allowed])
        assert np.array_equal(before[~band],after[~band])
        assert np.any(before!=after)
        assert hashlib.sha256(path.read_bytes()).hexdigest()==original_hash
        if base:
            state=api('job-status',{'jobId':body['jobId']});assert state['status']=='completed' and state['results'][-1]['file']==item['file']
            if not preview:
                chosen=api('select-result',{'directory':result['directory'],'seed':0});assert chosen.get('ok'),chosen
        records.append(dict(case=name,jobId=body['jobId'],seconds=result['durationSeconds'],file=item['file'],comparison=item['comparisonFile'],overlay=item['edgeOverlayFile'],crop=item['crop'],metrics=item['metrics']))
        print(json.dumps(records[-1],ensure_ascii=False),flush=True)
        if name=='guided':
            # Keep the original and processed crop at the same scale for visual inspection.
            box=(420,450,910,980)
            sheet=Image.new('RGB',(980,560),'#eeeeee');sheet.paste(Image.fromarray(before).crop(box),(0,30));sheet.paste(Image.fromarray(after).crop(box),(490,30))
            draw=ImageDraw.Draw(sheet);draw.text((12,8),'BEFORE',fill='black');draw.text((502,8),'AFTER',fill='black');sheet.save(OUT/'comparison.png')
    full=np.array(Image.open(ROOT/records[1]['file']));preview=np.array(Image.open(ROOT/records[2]['file']))
    x,y,r,b=records[2]['crop'];assert np.array_equal(full[y:b,x:r],preview)
    report=dict(cases=records,sourceUnchanged=True,outsideSelectionExact=True,outsideBandExact=True,previewMatchesFull=True)
    if base:
        invalid=api('enhance',dict(sampleId=body['sampleId'],method='skin-edge',scope='all',jobId='edge-invalid-'+uuid.uuid4().hex[:8]))
        assert not invalid.get('ok'), invalid
        report['emptySelectionRejected']=True
        cancel_body={**body,'preview':False,'jobId':'enhance-edge-cancel-'+uuid.uuid4().hex[:10]}
        with ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(api,'enhance',cancel_body)
            deadline=time.monotonic()+10
            while time.monotonic()<deadline:
                state=api('job-status',{'jobId':cancel_body['jobId']})
                if state.get('status')=='running':break
                time.sleep(.03)
            cancelled=api('cancel-job',{'jobId':cancel_body['jobId']});assert cancelled.get('ok'),cancelled
            future.result(30)
            state=api('job-status',{'jobId':cancel_body['jobId']})
            assert state['status']=='cancelled' and not state.get('results'),state
            report['cancelledWithoutOutput']=True
    (OUT/('live-verification.json' if base else 'verification.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')


if __name__=='__main__':main()
