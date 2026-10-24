"""Fixed held-out image crops; compare layout and refinement with the same seed."""
import argparse
import hashlib
import html
import json
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import numpy as np
from PIL import Image, ImageOps

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sample_catalog import collection_path, project_path, resolve_sample
from outpaint_quality import boundary_diagnostics

CASES=[
    ('studio','samples/characters/c001.png','Continue the textured warm ochre studio wall and floor, matching the existing light and perspective.'),
    ('interior','samples/landscape/opening.png','Continue the same repair shop interior, wooden surfaces and warm lighting; align the existing edges and perspective.'),
    ('portrait','workspace/uploads/chu-khiet-quynh27-6c20c54696e8.jpg','Continue the actual surrounding scene and existing clothing; preserve the person and lighting.'),
    ('fabric','workspace/uploads/chu-khiet-quynh16-29c0939866d5.jpg','Continue the pale blue patterned fabric at the same motif scale and direction; retain the soft seaside background.'),
]


def prepare():
    frozen = collection_path(ROOT, 'outpaint-benchmark')
    if frozen.exists() and (ROOT/'samples/catalog.json').exists():
        records=[]
        prompts={group:prompt for group,_,prompt in CASES}
        for folder in sorted(frozen.iterdir()):
            if not folder.is_dir():continue
            group,side=folder.name.rsplit('-',1)
            with Image.open(folder/'reference.png') as image:w,h=image.size
            with Image.open(folder/'source.png') as image:sw,sh=image.size
            records.append(dict(id=folder.name,group=group,side=side,sampleId=f'outpaint-benchmark/{folder.name}/source.png',
                                width=w,height=h,left=w-sw if side=='left' else 0,top=h-sh if side=='top' else 0,
                                prompt=prompts[group],reference=(folder/'reference.png').relative_to(ROOT).as_posix()))
        return records
    records=[]
    for group,filename,prompt in CASES:
        source=ImageOps.exif_transpose(Image.open(project_path(ROOT, filename))).convert('RGB')
        source.thumbnail((1024,1024),Image.Resampling.LANCZOS)
        w,h=source.size
        for side in ('left','right','top','bottom'):
            dx,dy=max(32,round(w*.15)),max(32,round(h*.15))
            box=(dx if side=='left' else 0,dy if side=='top' else 0,
                 w-dx if side=='right' else w,h-dy if side=='bottom' else h)
            case_id=group+'-'+side
            folder=ROOT/'samples/outpaint-benchmark'/case_id;folder.mkdir(parents=True,exist_ok=True)
            source.crop(box).save(folder/'source.png');source.save(folder/'reference.png')
            records.append(dict(id=case_id,group=group,side=side,sampleId=f'outpaint-benchmark/{case_id}/source.png',
                                width=w,height=h,left=box[0],top=box[1],prompt=prompt,
                                reference=str((folder/'reference.png').relative_to(ROOT))))
    return records


def post(port,body):
    req=Request(f'http://127.0.0.1:{port}/api/outpaint',data=json.dumps(body).encode(),
                headers={'Content-Type':'application/json'},method='POST')
    try:
        with urlopen(req,timeout=7200) as response:result=json.load(response)
    except HTTPError as error:
        raise RuntimeError(error.read().decode('utf-8', errors='replace')) from error
    if not result.get('ok'):raise RuntimeError(result)
    return result


def measure(image,reference,source,g):
    a=np.asarray(image.convert('RGB'),dtype=np.int16)
    truth=np.asarray(reference.convert('RGB'),dtype=np.int16)
    x,y=g['left'],g['top'];w,h=source.size
    new=np.ones(a.shape[:2],dtype=bool);new[y:y+h,x:x+w]=False
    return dict(sourceExact=bool(np.array_equal(a[y:y+h,x:x+w],np.asarray(source))),
                heldOutMAE=round(float(np.abs(a-truth)[new].mean()),4),boundary=boundary_diagnostics(image,g))


def report(folder,records):
    cards=[]
    for row in records:
        if 'error' in row:
            cards.append(f'<article><h2>{html.escape(row["case"])}</h2><p>{html.escape(row["error"])}</p></article>');continue
        images=''.join(f'<figure><img src="{html.escape(name)}"><figcaption>{label}</figcaption></figure>' for name,label in
                       [(row['overview'],'Bố cục'),(row['final'],'Sau hoàn thiện'),(row['reference'],'Ảnh đối chiếu')])
        warnings=''.join(f'<li>{html.escape(warning)}</li>' for warning in row.get('warnings',[]))
        review=f'<p><strong>Nhận xét khi xem ảnh:</strong> {html.escape(row["visualReview"])}</p>' if row.get('visualReview') else ''
        rejected=sum(not check['accepted'] for check in row.get('qualityChecks',[]))
        cards.append(f'<article><h2>{html.escape(row["case"])} · {html.escape(row["model"])} · seed {row["seed"]}</h2><div>{images}</div>{review}<p>Số lượt giữ bản trước do kiểm tra hồi quy: {rejected}.</p><ul>{warnings}</ul><pre>{html.escape(json.dumps(row["metrics"],ensure_ascii=False,indent=2))}</pre></article>')
    text='<!doctype html><meta charset="utf-8"><title>Kiểm chứng mở rộng ảnh</title><style>body{font:16px system-ui;background:#101923;color:#e4eaf2;margin:30px}article{margin-bottom:40px}article>div{display:flex;gap:12px}figure{margin:0;flex:1;min-width:0}img{width:100%}pre{white-space:pre-wrap}figcaption{padding:8px}</style><h1>Kiểm chứng mở rộng ảnh</h1><p>So sánh bố cục và hoàn thiện trên cùng ảnh và seed. Sai lệch với ảnh đối chiếu không phải điểm thẩm mỹ; phần ngoài khung có thể có nhiều cách tiếp nối hợp lý.</p>'+''.join(cards)
    (folder/'report.html').write_text(text,encoding='utf-8')


def main():
    if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser()
    parser.add_argument('--prepare-only',action='store_true')
    parser.add_argument('--model',default='sdxl-inpaint-base-0.1')
    parser.add_argument('--limit',type=int,default=4)
    parser.add_argument('--case',dest='case_ids',nargs='+',help='Run named cases instead of the representative selection')
    parser.add_argument('--seeds',type=int,nargs='+',default=[42])
    parser.add_argument('--resolution',type=int,default=512)
    parser.add_argument('--steps',type=int,default=20)
    parser.add_argument('--port',type=int,default=7860)
    parser.add_argument('--output',type=Path,default=ROOT/'workspace/diagnostics/outpaint-quality')
    args=parser.parse_args();folder=args.output.resolve();folder.mkdir(parents=True,exist_ok=True)
    cases=prepare();(folder/'cases.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2),encoding='utf-8')
    if args.prepare_only:print(f'Prepared {len(cases)} fixed cases.');return
    indices=np.linspace(0,len(cases)-1,min(max(1,args.limit),len(cases)),dtype=int)
    if args.case_ids:
        unknown=set(args.case_ids)-{case['id'] for case in cases}
        if unknown:parser.error('Unknown cases: '+', '.join(sorted(unknown)))
        indices=[i for i,case in enumerate(cases) if case['id'] in args.case_ids]
    revision=hashlib.sha256(b''.join((ROOT/name).read_bytes() for name in
        ('ai_service.py','outpainting.py','outpaint_quality.py','workspace/prompts.json'))).hexdigest()[:12]
    summary_file=folder/'summary.json'
    records=json.loads(summary_file.read_text(encoding='utf-8')) if summary_file.exists() else []
    for index in indices:
        case=cases[index]
        for seed in args.seeds:
            key=f'{case["id"]}-{args.model}-{args.resolution}-{args.steps}-{seed}-{revision}'
            if any(row.get('key')==key and 'error' not in row for row in records):continue
            previous_errors=[row for row in records if row.get('key')==key and 'error' in row]
            records=[row for row in records if row.get('key')!=key]
            began=time.perf_counter();entry=dict(key=key,case=case['id'],model=args.model,seed=seed,revision=revision)
            if previous_errors:entry['previousAttempts']=previous_errors
            try:
                body={k:case[k] for k in ('sampleId','width','height','left','top','prompt')}
                body.update(modelId=args.model,seed=seed,count=1,steps=args.steps,maxSide=args.resolution,
                            guidance=30 if 'flux' in args.model else 5,preserveOriginal=True,seamRepair=True,
                            detailPass=True,materialRefine=True,sourceEnhance=False,seamSteps=30,detailSteps=20,
                            fabricSteps=30,overlap=16,seamWidth=40,runMode='layout',jobId='benchmark-'+key+'-layout')
                layout=post(args.port,body)
                final=post(args.port,{**body,'runMode':'refine','jobId':'benchmark-'+key+'-refine',
                                     'refineFrom':dict(directory=layout['directory'],seed=seed)})
                metadata=json.loads((ROOT/final['directory']/'metadata.json').read_text(encoding='utf-8'))
                source=Image.open(resolve_sample(ROOT, case['sampleId'])).convert('RGB')
                truth=Image.open(ROOT/case['reference']).convert('RGB')
                overview=Image.open(ROOT/layout['results'][0]['file']).convert('RGB')
                output=Image.open(ROOT/final['results'][0]['file']).convert('RGB')
                asset=folder/key;asset.mkdir(exist_ok=True)
                for name,image in [('overview',overview),('final',output),('reference',truth)]:image.save(asset/(name+'.png'));entry[name]=f'{key}/{name}.png'
                entry.update(directory=final['directory'],metrics={'overview':measure(overview,truth,source,metadata['geometry']),
                             'final':measure(output,truth,source,metadata['geometry'])},qualityChecks=final['results'][0]['qualityChecks'],
                             warnings=final.get('warnings',[]),embeddingCache=metadata['embeddingCache'],
                             inference=[metadata['modelWidth'],metadata['modelHeight']],memoryMode=metadata['memoryMode'])
                assert entry['metrics']['final']['sourceExact'], 'Source preservation failed'
            except Exception as error:entry['error']=str(error)
            entry['seconds']=round(time.perf_counter()-began,3);records.append(entry)
            summary_file.write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8');report(folder,records)
            print(json.dumps({k:v for k,v in entry.items() if k in ('case','model','seconds','error','metrics','embeddingCache')},ensure_ascii=False),flush=True)
    if any('error' in r for r in records):sys.exit(1)


if __name__=='__main__':main()
