"""Exercise real local character models and save auditable pixel checks.

Run with the application open. --face-only skips the slower body cases.
"""
import argparse
import concurrent.futures
import json
import time
import uuid
from pathlib import Path
import numpy as np
from PIL import Image
import requests

ROOT=Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT))
from sample_catalog import resolve_sample
API='http://127.0.0.1:7860/api/'

def post(route,body,check=True):
    response=requests.post(API+route,json=body,timeout=1200)
    data=response.json()
    if check and (not response.ok or not data.get('ok')):raise RuntimeError(f'{route}: {data}')
    return data

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--face-only',action='store_true');parser.add_argument('--cases',default='');args=parser.parse_args()
    folder=ROOT/'workspace/diagnostics/character'/time.strftime('%Y%m%d-%H%M%S');folder.mkdir(parents=True)
    analysis={};records=[]
    def inspect(sample):
        if sample not in analysis:analysis[sample]=post('character-analyze',dict(sampleId=sample))
        return analysis[sample]
    def request(sample,**settings):
        a=inspect(sample)
        return dict(sampleId=sample,sourceSha256=a['sourceSha256'],mode='face',expression='smile',personIds=[0],count=2,seed=42,**settings)
    def run(name,body):
        if args.cases and name not in args.cases.split(','):return None
        plan=post('character-preview',body)
        body.update(planHash=plan['planHash'],targetPoses=plan['targetPoses'],jobId='verify-character-'+uuid.uuid4().hex[:12])
        result=post('character-render',body)
        destination=ROOT/result['directory'];source=np.array(Image.open(destination/'source.png').convert('RGB'));mask=np.array(Image.open(destination/'applied_mask.png'))>0
        checks=[]
        for item in result['results']:
            pixels=np.array(Image.open(ROOT/item['file']).convert('RGB'))
            assert pixels.shape==source.shape
            assert np.array_equal(pixels[~mask],source[~mask]),'Outside mask changed'
            for person in inspect(body['sampleId'])['people']:
                if person['id'] not in body['personIds']:
                    x,y,r,b=np.rint(np.array(person['box'])*[source.shape[1],source.shape[0],source.shape[1],source.shape[0]]).astype(int)
                    assert np.array_equal(pixels[y:b,x:r],source[y:b,x:r]),'Unselected person changed'
            checks.append(item['metrics'])
        (folder/(name+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
        records.append(dict(case=name,directory=result['directory'],seconds=result['durationSeconds'],variants=len(result['results']),exactOutsideMask=True,metrics=checks))
        print(name,result['durationSeconds'],'seconds',result['directory'],flush=True)
        return result
    sample='characters/c001.png'
    for expression in ('smile','surprised','angry','sad','serious','laugh'):
        body=request(sample);body['expression']=expression;run('face-'+expression,body)
    body=request(sample);body.update(expression='keep',yaw=10,pitch=-5,roll=3,gazeX=-.5);run('head-gaze',body)
    ref='characters/c002.png';a=inspect(ref)
    body=request(sample);body.update(expression='keep',useReferenceExpression=True,referenceId=ref,referenceSha256=a['sourceSha256'],referencePersonId=0);run('reference-expression',body)
    if not args.face_only:
        for name,pose in [('wave','wave'),('read','read'),('sit','sit')]:
            body=request(sample);body.update(mode='body',expression='keep',pose=pose,resolution=1024,steps=36);run(name,body)
        body=request(sample);body.update(mode='body',pose='hold_cup',resolution=768,steps=28);run('cup-with-smile',body)
        combined=ROOT/'workspace/uploads/character-verification-pair.png'
        combined.parent.mkdir(parents=True,exist_ok=True)
        sheet=Image.new('RGB',(1024,768))
        for i,s in enumerate((sample,ref)):sheet.paste(Image.open(resolve_sample(ROOT, s)).resize((512,768)),(i*512,0))
        sheet.save(combined);pair='uploads/'+combined.name
        for name,pose in [('handshake','handshake'),('look-each-other','look_each_other')]:
            body=request(pair);body.update(mode='interaction',pose=pose,expression='keep',personIds=[0,1],resolution=1024,steps=36);run(name,body)
        # Reference pose on one person also verifies exact preservation of the bystander.
        body=request(pair);body.update(mode='body',pose='custom',expression='keep',useReferencePose=True,referenceId=ref,referenceSha256=a['sourceSha256'],referencePersonId=0,resolution=768,steps=28);run('reference-pose-bystander',body)
    # Cancellation must publish nothing; resume replays the persisted plan.
    body=request(sample);body.update(count=4,jobId='verify-character-cancel-'+uuid.uuid4().hex[:12]);plan=post('character-preview',body);body.update(planHash=plan['planHash'],targetPoses=plan['targetPoses'])
    with concurrent.futures.ThreadPoolExecutor() as pool:
        future=pool.submit(post,'character-render',body,False)
        deadline=time.monotonic()+60
        while time.monotonic()<deadline and not future.done():
            state=post('job-status',dict(jobId=body['jobId']),False)
            if state.get('status')=='running' or state.get('job',{}).get('status')=='running':break
            time.sleep(.1)
        post('cancel-job',dict(jobId=body['jobId']));cancelled=future.result()
    state=post('job-status',dict(jobId=body['jobId']),False)
    (folder/'cancellation.json').write_text(json.dumps(dict(response=cancelled,state=state),ensure_ascii=False,indent=2),encoding='utf8')
    assert state.get('status')=='cancelled', 'Cancellation did not reach terminal state'
    assert not state.get('results'), 'Cancellation published partial results'
    resumed=post('resume-job',dict(jobId=body['jobId']))
    assert len(resumed.get('results',[]))==4, 'Resume did not complete all variants'
    (folder/'resume.json').write_text(json.dumps(resumed,ensure_ascii=False,indent=2),encoding='utf8')
    report=dict(cases=records,cancellation=state,resume=resumed,manualReviewRequired=['identity','clothing','fingers','object contact','background seams'])
    (folder/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print('REPORT',folder/'report.json',flush=True)

if __name__=='__main__':main()
