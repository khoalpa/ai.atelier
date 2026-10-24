"""Real inference and garment A/B checks for the character upgrade."""
import argparse,json,time,uuid
from pathlib import Path
import requests
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
FOLDER=ROOT/'workspace/diagnostics/character-upgrade'
API='http://127.0.0.1:7860/api/'
def post(route,body):
 r=requests.post(API+route,json=body,timeout=1200);value=r.json()
 if not r.ok or not value.get('ok'):raise RuntimeError(str(value))
 return value

def run(sample,name,**settings):
 a=post('character-analyze',{'sampleId':sample});body=dict(sampleId=sample,sourceSha256=a['sourceSha256'],mode='body',pose='wave',expression='keep',personIds=[0],count=1,seed=43,steps=36,resolution=1024);body.update(settings)
 plan=post('character-preview',body);body.update(planHash=plan['planHash'],targetPoses=plan['targetPoses'],jobId='character-upgrade-'+uuid.uuid4().hex[:12])
 result=post('character-render',body);folder=ROOT/result['directory'];source=np.array(Image.open(folder/'source.png'));mask=np.array(Image.open(folder/'applied_mask.png'))>0
 for item in result['results']:
  pixels=np.array(Image.open(ROOT/item['file']));assert np.array_equal(source[~mask],pixels[~mask]);assert item['metrics']['outsideMaskMaxError']==0
 FOLDER.mkdir(parents=True,exist_ok=True);(FOLDER/(name+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(name,result['directory'],result['durationSeconds'],flush=True)
 return result
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--case',default='left-wave');args=p.parse_args()
 if args.case=='left-wave':run('characters/c001.png','left-wave',handSide='left')
 elif args.case=='handshake':
  a=post('character-analyze',{'sampleId':'uploads/character-verification-pair.png'})
  # Independent expressions are exercised on the same reviewed interaction.
  run('uploads/character-verification-pair.png','handshake-new',**{'mode':'interaction','pose':'handshake','personIds':[0,1],'perPerson':{'0':{'expression':'smile'},'1':{'expression':'serious'}}})
