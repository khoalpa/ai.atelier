"""2.6: repeat fixed visual cases through the local API; preserve old outputs."""
import argparse, base64, json, sys, time, uuid
from pathlib import Path
from urllib.request import Request,urlopen
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from object_removal import match_simple_background
from outpaint_quality import final_seam_review
OUT=ROOT/'workspace/diagnostics/background-quality-2.6';OUT.mkdir(parents=True,exist_ok=True)
def save(name,value):
    (OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
def post(route,body):
    with urlopen(Request('http://127.0.0.1:7860/api/'+route,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'}),timeout=1800) as r:return json.load(r)
def live():
    cases=json.loads((ROOT/'workspace/diagnostics/stability-2.5/acceptance-cases.json').read_text(encoding='utf-8'))
    for index in (4,5,6,7):
        case=cases[index];report=OUT/f'live-{index+1}.json'
        if report.exists() and json.loads(report.read_text(encoding='utf-8')).get('ok'):continue
        baseline=ROOT/'workspace'/case['resultUrl'].lstrip('/');meta=json.loads((baseline.parent/'metadata.json').read_text(encoding='utf-8'))
        if case['task']=='inpaint':
            body=dict(sampleId=meta['source'],modelId=meta['modelId'],steps=meta['requestedSteps'],maxSide=meta.get('maxSide',1024 if index==4 else 512),strength=meta['strength'],guidance=meta['guidance'],seed=meta['seed'],count=1,
                fillMode='background',removalTarget='custom',objectLabel='red object',expand=meta['expand'],edgeFeather=meta['edgeFeather'],blur=meta['blur'],autoRetry=False,semanticCheck=False,
                confirmedPrompts=dict(prompt=meta['prompt'],negativePrompt=meta['negativePrompt']),editableMask='data:image/png;base64,'+base64.b64encode((ROOT/'samples'/meta['source']).with_name('mask.png').read_bytes()).decode())
        else:
            body={**meta['request'], 'modelId':'flux-1-fill-dev','maxSide':640,'steps':24,'guidance':30,'overlap':64,'seamWidth':64,'seamSteps':24,'detailPass':False,'materialRefine':False,'sourceEnhance':False,'seamRepair':True,'runMode':'complete'}
        body.update(jobId='background26-'+uuid.uuid4().hex,livePreview=False)
        record=dict(case=case,request=body,baseline=str(baseline.relative_to(ROOT)),startedAt=time.time())
        save(report.name,record);print('START',index+1,body['jobId'],flush=True)
        try:
            response=post(case['task'],body)
            # Keep evidence compact; original pixels remain in output files.
            for result in response.get('results',[]):result.pop('image',None)
            record.update(ok=response.get('ok',False),response=response,seconds=round(time.time()-record['startedAt'],2))
            save(report.name,record);print('DONE',index+1,record['ok'],record['seconds'],response.get('directory'),flush=True)
        except Exception as e:
            record.update(ok=False,error=str(e));save(report.name,record);raise
def benchmark():
    records=[]
    for f in sorted((ROOT/'workspace/diagnostics/object-removal-benchmark').glob('*.json')):
        try:record=json.loads(f.read_text(encoding='utf-8'))
        except ValueError:continue
        if not record.get('directory') or not record.get('case'):continue
        folder=ROOT/record['directory'];case=record['case'];data=ROOT/'samples'/case['source'];old=folder/f"result_seed_{case['seed']}.png"
        if not old.exists():continue
        source=Image.open(data).convert('RGB');before=Image.open(old).convert('RGB');mask=Image.open(folder/'editable_mask.png').convert('L')
        after,check=match_simple_background(source,before,mask)
        clean=np.asarray(Image.open(data.with_name('clean.png')).convert('RGB')).astype(float);selected=np.asarray(Image.open(data.with_name('mask.png')).convert('L'))>16
        a,b=np.asarray(before).astype(float),np.asarray(after).astype(float);outside=np.asarray(mask)==0
        records.append(dict(case=case['id'],model=record['model'],applied=check['applied'],beforeMAE=round(float(np.abs(a-clean)[selected].mean()),4),afterMAE=round(float(np.abs(b-clean)[selected].mean()),4),outsideUnchanged=bool(np.array_equal(a[outside],b[outside]))))
    save('paired-benchmark.json',dict(kind='saved-output-postprocess-only',cases=records,groundTruthUsedForFitting=False))
    print(json.dumps(dict(cases=len(records),applied=sum(r['applied'] for r in records),improved=sum(r['afterMAE']<r['beforeMAE'] for r in records),regressed=sum(r['afterMAE']>r['beforeMAE']+.01 for r in records),outsideUnchanged=all(r['outsideUnchanged'] for r in records))),flush=True)
def report():
    rows=[]
    for index in (7,8):
        file=OUT/f'live-{index}.json'
        if not file.exists():continue
        record=json.loads(file.read_text(encoding='utf-8'))
        if not record.get('ok'):continue
        old=ROOT/record['baseline'];new=ROOT/record['response']['directory']/old.name
        meta=json.loads((new.parent/'metadata.json').read_text(encoding='utf-8'))
        geometry=meta['geometry'];source=np.asarray(Image.open(ROOT/'samples'/meta['source']).convert('RGB'))
        image=Image.open(new).convert('RGB');x,y=geometry['left'],geometry['top']
        before=Image.open(old).convert('RGB')
        rows.append(dict(case=index,output=str(new.relative_to(ROOT)),sourceExact=bool(np.array_equal(np.asarray(image)[y:y+source.shape[0],x:x+source.shape[1]],source)),
            before=final_seam_review(before,geometry),after=final_seam_review(image,geometry),
            note='Final diagnostic rechecked after inference with v2; model was not rerun for this check.'))
    save('outpaint-final-review.json',rows)
    print(json.dumps(rows))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--live',action='store_true');p.add_argument('--report',action='store_true');a=p.parse_args();live() if a.live else report() if a.report else benchmark()
