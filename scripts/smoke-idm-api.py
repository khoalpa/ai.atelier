"""Exercise the application API and verify IDM metadata and protected pixels."""
import base64
import io
import json
from pathlib import Path
from urllib.request import Request, urlopen
from PIL import Image, ImageChops

ROOT=Path(__file__).resolve().parents[1]
source=Image.open(ROOT/'samples/characters/c001.png').convert('RGB')
mask=Image.new('L',source.size,0)
mask.paste(255,(int(source.width*.3),int(source.height*.25),int(source.width*.7),int(source.height*.55)))
garment=source.crop(mask.getbbox())
def encoded(image):
    stream=io.BytesIO()
    image.save(stream,format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(stream.getvalue()).decode()
body=dict(jobId='idm-integration-smoke',modelId='idm-vton',sampleId='characters/c001.png',
          garmentImage=encoded(garment),editableMask=encoded(mask),autoMask=False,
          reconstructExposedBody=False,preprocessGarment=False,count=1,steps=10,
          guidance=2,seed=42,maxSide=512,expand=0,blur=0,maxRetries=0,
          repairSeams=False,generativeRefine=False,bodyRepairMode='off')
request=Request('http://127.0.0.1:7860/api/tryon',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
with urlopen(request,timeout=600) as response:
    result=json.load(response)
assert result['ok'] and result['modelId']=='idm-vton'
directory=ROOT/result['directory']
metadata=json.loads((directory/'metadata.json').read_text(encoding='utf-8'))
assert metadata['modelId']=='idm-vton' and metadata['model']=='IDM-VTON'
selected=Image.open(directory/'selected.png').convert('RGB')
outside=Image.composite(selected,source,ImageChops.invert(mask))
assert ImageChops.difference(outside,source).getbbox() is None
summary={key:result[key] for key in ('ok','modelId','directory','selected','performance')}
summary['outsideMaskPreserved']=True
(ROOT/'workspace/idm-api-smoke.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps(summary,indent=2))
