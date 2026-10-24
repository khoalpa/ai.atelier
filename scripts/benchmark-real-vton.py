"""Controlled real-photo comparison with frozen inputs and full stage capture."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from vton_pilot import file_hash


def write(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def first_generated_image(result):
    from PIL import Image
    result=result.images if hasattr(result,'images') else result
    # CatVTON returns a list; IDM can return (images, auxiliary outputs).
    while isinstance(result,(list,tuple)):
        if not result:raise ValueError('Pipeline returned no image')
        result=result[0]
    if not isinstance(result,Image.Image):raise ValueError('Pipeline did not return a PIL image')
    return result


def load_service_snapshot(snapshot):
    """Freeze service code while retaining configured model/data paths.

    Load the service and IDM adapter from the snapshot; other supporting runtime
    files must still match it byte-for-byte.
    """
    import types
    metadata=json.loads((snapshot/'snapshot.json').read_text(encoding='utf-8'))
    contents=[]
    for name,digest in metadata['files'].items():
        data=(snapshot/name).read_bytes()
        if hashlib.sha256(data).hexdigest()!=digest: raise ValueError('Corrupt runtime snapshot')
        if name not in ('ai_service.py','idm_vton_runtime.py') and file_hash(ROOT/name)!=digest:
            raise ValueError('Supporting runtime changed: '+name)
        contents.append(data)
    if hashlib.sha256(b''.join(contents)).hexdigest()!=metadata['revision']:
        raise ValueError('Snapshot revision mismatch')
    runtime=types.ModuleType('idm_vton_runtime');runtime.__file__=str(ROOT/'idm_vton_runtime.py')
    exec(compile((snapshot/'idm_vton_runtime.py').read_text(encoding='utf-8'),str(snapshot/'idm_vton_runtime.py'),'exec'),runtime.__dict__)
    sys.modules['idm_vton_runtime']=runtime
    module=types.ModuleType('ai_service');module.__file__=str(ROOT/'ai_service.py')
    sys.modules['ai_service']=module
    exec(compile((snapshot/'ai_service.py').read_text(encoding='utf-8'),str(snapshot/'ai_service.py'),'exec'),module.__dict__)
    module.SOURCE_REVISION=metadata['revision']


def prepare(out):
    import cv2
    import numpy as np
    from PIL import Image,ImageOps,ImageDraw,ImageFont
    import ai_service as ai
    from tryon_geometry import target_coverage
    dataset=ROOT/'workspace/training/couple-tee-pilot'
    rows=[json.loads(s) for s in (dataset/'manifest.jsonl').read_text(encoding='utf-8').splitlines()]
    validation=[r for r in rows if r['split']=='validation']
    out.mkdir(parents=True,exist_ok=False)
    cases=[]
    for index,row in enumerate(validation):
        source=ImageOps.exif_transpose(Image.open(row['sourcePersonImage'])).convert('RGB')
        if file_hash(Path(row['sourcePersonImage']))!=row['sourceSha256']:
            raise ValueError('Original photo changed')
        pose=ai.detect_people_pose(source)[0]
        protected=ai.automatic_protected_detail_mask(source,pose['box'],pose['keypoints'])
        auto,score=ai.automatic_garment_mask(source,'upper_body',pose['box'],pose['keypoints'])
        raw=Image.open(dataset/'raw-masks'/f'{row["id"]}.png').convert('L')
        if raw.size!=source.size: raise ValueError('Original mask geometry mismatch')
        radius=max(7,round(min(source.size)*.018))|1
        reviewed=Image.fromarray(cv2.dilate(np.array(raw),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(radius,radius))))
        for mode in ('paired','transfer'):
            target=row if mode=='paired' else validation[(index+2)%len(validation)]
            case_id=row['id']+'-'+mode
            folder=out/'inputs'/case_id; folder.mkdir(parents=True)
            attrs={'sleeveLength':target['attributes']['sleeveLength'],'hemLength':'hip','silhouette':'straight',
                   'neckline':target['attributes']['neckline'],'layering':'single'}
            runtime_attrs={**attrs}
            if runtime_attrs['neckline']=='high':runtime_attrs['neckline']='unknown'
            for name,mask in [('auto',auto),('reviewed',reviewed)]:
                expanded,expected,exposed,info=target_coverage(mask,protected,'upper_body',pose,runtime_attrs)
                expanded=expanded.filter(__import__('PIL.ImageFilter',fromlist=['ImageFilter']).MaxFilter(17))
                expanded=ai.exclude_protected_pixels(expanded,protected)
                expanded.save(folder/f'{name}-mask.png')
                expected.save(folder/f'{name}-expected.png'); exposed.save(folder/f'{name}-exposed.png')
                preview=Image.composite(Image.new('RGB',source.size,(130,130,130)),source,expanded)
                preview.thumbnail((384,512)); preview.save(folder/f'{name}-preview.jpg',quality=90)
            source.save(folder/'source.png'); protected.save(folder/'protected.png'); raw.save(folder/'visible-old-garment.png')
            garment=Image.open(dataset/target['productImage']).convert('RGB'); garment.save(folder/'garment.png')
            auto_arr=np.array(Image.open(folder/'auto-mask.png'))>0
            reviewed_arr=np.array(Image.open(folder/'reviewed-mask.png'))>0
            old=(np.array(raw)>0)&(np.array(protected)==0)
            missed=old&~auto_arr; Image.fromarray(missed.astype('uint8')*255).save(folder/'auto-missed-old-garment.png')
            case={'id':case_id,'mode':mode,'sourceId':row['id'],'targetProductId':target['productId'],
                  'sampleId':str(Path(row['sourcePersonImage']).relative_to(ai.SAMPLES)).replace('\\','/'),
                  'sourceSha256':row['sourceSha256'],'targetAttributes':attrs,'pose':pose,
                  'autoScore':score,'autoVisibleGarmentCoverage':float((auto_arr&old).sum()/max(1,old.sum())),
                  'reviewedVisibleGarmentCoverage':float((reviewed_arr&old).sum()/max(1,old.sum())),
                  'seed':221026+index+(100 if mode=='transfer' else 0),'maskReview':'pending',
                  'files':{name:file_hash(folder/name) for name in ('source.png','garment.png','auto-mask.png','reviewed-mask.png','protected.png','visible-old-garment.png')}}
            cases.append(case)
    write(out/'cases.json',{'revision':ai.SOURCE_REVISION,'cases':cases,'independentTestSet':False,
        'limitations':['Existing validation products have informed experiment selection.','Person identities remain unverified.','Reviewed masks are supervised controls, not ground-truth segmentation.']})
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',17)
    for page in range(2):
        sheet=Image.new('RGB',(6*250,2*390),'white'); draw=ImageDraw.Draw(sheet)
        for i,case in enumerate([c for c in cases if c['mode']=='transfer'][page*3:page*3+3]):
            for j,label in enumerate(('source.png','auto-preview.jpg','reviewed-preview.jpg')):
                x=(i%2)*750+j*250;y=(i//2)*390
                im=Image.open(out/'inputs'/case['id']/label).convert('RGB');im.thumbnail((245,330))
                sheet.paste(im,(x,y+48));draw.text((x+3,y+3),case['sourceId'],font=font,fill='black')
                draw.text((x+3,y+25),label,font=font,fill='black')
        sheet.save(out/f'mask-review-{page+1}.jpg',quality=95)
    print(json.dumps({'prepared':len(cases),'folder':str(out)}),flush=True)


def run(args):
    import numpy as np
    import torch
    from PIL import Image
    import ai_service as ai
    from tryon_geometry import fit_geometry,restore_image
    dataset=args.root.resolve(); manifest=json.loads((dataset/'cases.json').read_text(encoding='utf-8'))
    cases=[c for c in manifest['cases'] if (not args.case or args.case in c['id']) and (not args.mode or c['mode']==args.mode)]
    if not cases: raise ValueError('No matching cases')
    label=f'{args.model}-{args.mask}-{args.max_side}'
    out=dataset/'results'/label;out.mkdir(parents=True,exist_ok=True)
    model_id='idm-vton' if args.model=='idm-vton' else 'catvton'
    checkpoint=ROOT/'workspace/training/couple-tee-run-20261022-extended/attention/model.safetensors'
    signature={'model':args.model,'mask':args.mask,'maxSide':args.max_side,'steps':args.steps,
               'casesSha256':file_hash(dataset/'cases.json'),'revision':ai.SOURCE_REVISION,
               'checkpointSha256':file_hash(checkpoint) if args.model=='adapted' else None}
    if model_id=='idm-vton':
        signature['idmPipelineSha256']=file_hash(ROOT/'vendor/IDM-VTON/src/tryon_pipeline.py')
    config_path=out/'config.json'
    if config_path.is_file() and json.loads(config_path.read_text(encoding='utf-8'))!=signature:
        raise ValueError('Run configuration changed; use a new frozen benchmark root')
    write(config_path,signature)
    if all((out/c['id']/'result.json').is_file() and
           json.loads((out/c['id']/'result.json').read_text(encoding='utf-8')).get('status')=='completed' for c in cases):
        print(json.dumps({'label':label,'status':'already_completed','cases':len(cases)}),flush=True)
        return
    pipe=ai.load_tryon_pipe(model_id)
    if args.model=='adapted':
        from accelerate import load_checkpoint_in_model
        load_checkpoint_in_model(pipe.attn_modules,str(checkpoint.parent))
    original=ai.traced_pipeline_call
    def capture(pipeline,**options):
        for key in ('image','mask','mask_image'):
            if isinstance(options.get(key),Image.Image): options[key].save(current/f'model-{key}.png')
        result=original(pipeline,**options)
        image=first_generated_image(result)
        image.save(current/'model-raw.png')
        return result
    ai.traced_pipeline_call=capture
    try:
        for case in cases:
            current=out/case['id'];current.mkdir(exist_ok=True)
            if (current/'result.json').is_file():
                saved=json.loads((current/'result.json').read_text(encoding='utf-8'))
                if saved.get('status')=='completed': continue
            folder=dataset/'inputs'/case['id']
            for name,digest in case['files'].items():
                if file_hash(folder/name)!=digest: raise ValueError('Frozen input changed: '+name)
            if args.mask=='reviewed' and case['maskReview']!='accepted_for_control':
                raise ValueError('Control mask must be visually reviewed first')
            source=Image.open(folder/'source.png').convert('RGB')
            if file_hash(ai.safe_sample(case['sampleId']))!=case['sourceSha256']:
                raise ValueError('Original input changed')
            garment=Image.open(folder/'garment.png').convert('RGB')
            mask=Image.open(folder/f'{args.mask}-mask.png').convert('L')
            description=('a red and black long-sleeve sports shirt with white printed graphics' if case['targetAttributes']['sleeveLength']=='long'
                         else 'a red and white thin horizontal striped short-sleeve crew-neck t-shirt' if case['targetProductId']=='tee-3039fc7e07'
                         else 'a white short-sleeve crew-neck t-shirt with a navy central silhouette and a circle of navy stars')
            body={'modelId':model_id,'sampleId':case['sampleId'],'category':'upper_body',
                  'garmentImage':ai.encode_image(garment),'editableMask':ai.encode_image(mask),
                  'autoMask':False,'cropPerson':False,'preprocessGarment':False,'reconstructExposedBody':False,
                  'targetGarment':case['targetAttributes'],'garmentDescription':description,
                  'count':1,'twoStage':False,'steps':args.steps,'maxSide':args.max_side,'seed':case['seed'],
                  'guidance':2.0 if model_id=='idm-vton' else 2.5,'expand':0,'blur':5,
                  'repairSeams':False,'generativeRefine':False,'maxRetries':0,'bodyRepairMode':'off'}
            # The diagnostic label can be more specific than the current UI enum.
            # Keep it in cases.json; do not mislabel a high neck as a round neck.
            if body['targetGarment']['neckline']=='high':
                body['targetGarment']={**body['targetGarment'],'neckline':'unknown'}
            started=time.perf_counter()
            if torch.cuda.is_available():torch.cuda.reset_peak_memory_stats()
            write(current/'result.json',{'status':'running','case':case['id']})
            try:
                result=ai.tryon(body)
                final=Image.open(ROOT/result['selected']).convert('RGB');final.save(current/'final.png')
                raw=Image.open(current/'model-raw.png').convert('RGB')
                raw=restore_image(raw,fit_geometry(source.size,raw.size));raw.save(current/'restored-raw.png')
                run_dir=ROOT/result['directory']
                actual_mask=Image.open(run_dir/'editable_mask.png').convert('L');actual_mask.save(current/'actual-mask.png')
                protected=Image.open(run_dir/'protected_identity.png').convert('L');protected.save(current/'protected.png')
                a,b,c=np.array(source),np.array(final),np.array(raw)
                editable=np.array(actual_mask)>0; protect=np.array(protected)>0
                changed=np.any(a!=b,axis=-1); raw_changed=np.any(a!=c,axis=-1)
                old=np.array(Image.open(folder/'visible-old-garment.png'))>0
                paired_mask=(np.array(Image.open(folder/'reviewed-mask.png'))>0)&~protect
                metrics={'outsideMaskChangedPixels':int(changed[~editable].sum()),
                         'protectedChangedPixels':int(changed[protect].sum()),
                         'oldGarmentExcludedPixels':int((old&~editable&~protect).sum()),
                         'oldGarmentRestoredOutsideEditPixels':int((old&~editable&~protect&raw_changed&~changed).sum()),
                         'pairedEditMAE':float(np.abs(b.astype(float)-a)[paired_mask].mean()) if case['mode']=='paired' else None}
                if metrics['outsideMaskChangedPixels'] or metrics['protectedChangedPixels']:
                    raise AssertionError('Compositor violated pixel preservation')
                record={'status':'completed','case':case['id'],'elapsedSeconds':time.perf_counter()-started,
                        'gpuPeakAllocatedMiB':round(torch.cuda.max_memory_allocated()/1048576,1) if torch.cuda.is_available() else None,
                        'runDirectory':result['directory'],'metrics':metrics,'qualityGate':result['qualityGate'],
                        'sourceRevision':ai.SOURCE_REVISION,'diagnosticOnly':True,'structureReview':'pending'}
                write(current/'result.json',record)
                print(json.dumps({'label':label,**record},ensure_ascii=False),flush=True)
            except Exception as error:
                write(current/'result.json',{'status':'failed','case':case['id'],'error':str(error)})
                raise
    finally:
        ai.traced_pipeline_call=original;ai.release_tryon()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['prepare','run'])
    parser.add_argument('--root',type=Path,default=ROOT/'workspace/diagnostics/real-vton-20261022')
    parser.add_argument('--model',choices=['base','adapted','idm-vton','all'],default='base')
    parser.add_argument('--mask',choices=['auto','reviewed'],default='auto')
    parser.add_argument('--max-side',type=int,choices=[512,1024],default=1024)
    parser.add_argument('--steps',type=int,default=30)
    parser.add_argument('--mode',choices=['paired','transfer'])
    parser.add_argument('--case')
    parser.add_argument('--service-snapshot',type=Path)
    args=parser.parse_args()
    if args.service_snapshot: load_service_snapshot(args.service_snapshot.resolve())
    if args.action=='prepare':
        prepare(args.root.resolve())
    elif args.model=='all':
        for model in ('base','adapted','idm-vton'):
            args.model=model
            run(args)
    else:
        run(args)


if __name__=='__main__': main()
