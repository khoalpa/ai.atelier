"""Live local reference extraction and target-pixel checks on repository fixtures."""
import base64
import hashlib
import io
import json
import sys
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sample_catalog import resolve_sample
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:27866'
OUT=ROOT/'workspace/diagnostics/makeup-reference';OUT.mkdir(parents=True,exist_ok=True)
sys.stdout.reconfigure(encoding='utf-8')
def api(endpoint,body=None):
    req=Request(BASE+'/api/'+endpoint,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
    try:
        with urlopen(req,timeout=180) as response:return json.load(response)
    except HTTPError as error:return json.load(error)
def encode(image):
    buffer=io.BytesIO();image.save(buffer,format='PNG');return 'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()

samples=['outpaint-benchmark/portrait-left/reference.png',
         'synthetic-paired-vton-20261021/images/people/upper-body-01-p1.png',
         'synthetic-paired-vton-20261021/images/people/upper-body-03-p2.png',
         'synthetic-paired-vton-20261021/images/people/overall-05-p3.png']
records=[];fixtures=[]
def sample_path(sample):return ROOT/'workspace'/sample if sample.startswith('uploads/') else resolve_sample(ROOT,sample)
# Full-body fixtures have very small faces. Use their original-resolution head
# crops and record the crop; do not pretend these are additional source people.
for index in range(1,len(samples)):
    original=samples[index];image=Image.open(resolve_sample(ROOT, original)).convert('RGB');w,h=image.size
    crop=(round(w*.25),round(h*.02),round(w*.75),round(h*.38))
    sample='uploads/makeup-reference-portrait-'+str(index)+'.png'
    image.crop(crop).save(sample_path(sample));samples[index]=sample
    fixtures.append(dict(sample=sample,original=original,crop=crop))
for sample in samples:
    path=sample_path(sample);before=hashlib.sha256(path.read_bytes()).hexdigest()
    detected=api('makeup-reference',{'sampleId':sample});assert detected.get('ok'),detected
    result=api('makeup-reference',{'sampleId':sample,'faceIndex':detected['faces'][0]['index'],'sourceSha256':detected['sourceSha256']});assert result.get('ok'),result
    assert set(result['plan']['parts']).issubset({'lips','eyes','brows','cheeks'});assert result['warnings']
    assert hashlib.sha256(path.read_bytes()).hexdigest()==before
    records.append(dict(sample=sample,plan=result['plan'],warnings=result['warnings'],face=detected['faces'][0]['box']))
    print('Reference OK',sample,result['plan']['parts'],flush=True)
plan=records[0]['plan']
target_reports=[]
for sample in samples[1:]:
    before=Image.open(sample_path(sample)).convert('RGB');detected=api('makeup-analyze',{'sampleId':sample});assert detected.get('ok'),detected
    protection=Image.new('L',before.size);x,y,r,b=detected['faces'][0]['box'];ImageDraw.Draw(protection).rectangle((x,y,(x+r)//2,(y+b)//2),fill=255)
    body={**plan,'sampleId':sample,'sourceSha256':detected['sourceSha256'],'faceIndex':detected['faces'][0]['index'],
          'protectedDetailMask':encode(protection),'strengths':{'lips':80,'eyes':0,'cheeks':60,'brows':40},'jobId':'makeup-ref-verify-'+uuid.uuid4().hex[:12]}
    result=api('makeup',body);assert result.get('ok'),result
    assert len(result['results'])==2
    mask=np.array(Image.open(ROOT/result['directory']/'applied_mask.png'))>0
    for item in result['results']:
        output=np.array(Image.open(ROOT/item['file']));original=np.array(before)
        np.testing.assert_array_equal(output[~mask],original[~mask])
        np.testing.assert_array_equal(output[np.asarray(protection)>0],original[np.asarray(protection)>0])
    target_reports.append(dict(sample=sample,directory=result['directory'],results=result['results'],outsideExact=True,protectedExact=True))
    print('Target OK',sample,flush=True)
Image.new('RGB',(300,300),'#c8c8c8').save(ROOT/'workspace/uploads/makeup-reference-no-face.png')
no_face=api('makeup-reference',{'sampleId':'uploads/makeup-reference-no-face.png'});assert not no_face.get('ok') and 'khuôn mặt' in no_face['error']
stale=api('makeup-reference',{'sampleId':samples[0],'faceIndex':0,'sourceSha256':'old'});assert not stale.get('ok')
(OUT/'live-verification.json').write_text(json.dumps(dict(passed=True,fixtures=fixtures,references=records,targets=target_reports,noFaceRejected=True,staleReferenceRejected=True),ensure_ascii=False,indent=2),encoding='utf-8')
print('PASS: 4 reference faces, 3 target images, masks/protection exact, no-face and stale reference errors.')
