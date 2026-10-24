"""Mask regression on all available originals; reference masks are approximate."""
import importlib.util
import argparse
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import numpy as np
from PIL import Image,ImageOps,ImageFilter,ImageDraw,ImageFont


def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=ROOT/'workspace/diagnostics/upper-mask-regression-20261022')
    args=parser.parse_args()
    current=module('current_ai',ROOT/'ai_service.py');current.device='cpu'
    benchmark=module('benchmark',ROOT/'scripts/benchmark-real-vton.py')
    benchmark.load_service_snapshot(ROOT/'workspace/diagnostics/real-vton-20261022/service-snapshot')
    previous=sys.modules['ai_service'];previous.device='cpu'
    predictor=current.load_predictor();previous.predictor=predictor
    original_set=predictor.set_image;last=[None]
    def set_once(array,*args,**kwargs):
        if last[0] is None or not np.array_equal(last[0],array):
            original_set(array,*args,**kwargs);last[0]=array.copy()
    predictor.set_image=set_once
    dataset=ROOT/'workspace/training/couple-tee-pilot';out=args.output.resolve()
    out.mkdir(parents=True,exist_ok=False)
    rows=[json.loads(s) for s in (dataset/'manifest.jsonl').read_text(encoding='utf-8').splitlines() if s.strip()]
    results=[];font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
    for i,row in enumerate(rows):
        source=ImageOps.exif_transpose(Image.open(row['sourcePersonImage'])).convert('RGB')
        pose=current.detect_people_pose(source)[0]
        protected=current.automatic_protected_detail_mask(source,pose['box'],pose['keypoints'])
        ref=(np.array(Image.open(dataset/'raw-masks'/f'{row["id"]}.png'))>0)&(np.array(protected)==0)
        masks=[];record={'id':row['id']}
        for label,ai in [('before',previous),('after',current)]:
            mask,_=ai.automatic_garment_mask(source,'upper_body',pose['box'],pose['keypoints'])
            mask=ai.exclude_protected_pixels(mask.filter(ImageFilter.MaxFilter(17)),protected)
            arr=np.array(mask)>0
            record[label]={'coverage':float((ref&arr).sum()/max(1,ref.sum())),
                           'missed':int((ref&~arr).sum()),'area':int(arr.sum()),
                           'protectedPixels':int((arr&(np.array(protected)>0)).sum())}
            mask.save(out/f'{row["id"]}-{label}.png')
            masks.append(Image.composite(Image.new('RGB',source.size,'gray'),source,mask))
        results.append(record);print(json.dumps(record),flush=True)
        if i%6==0:sheet=Image.new('RGB',(6*260,2*420),'white');draw=ImageDraw.Draw(sheet)
        for j,(label,im) in enumerate(zip(('Source','Before','After'),[source,*masks])):
            x=((i%6)%2)*780+j*260;y=((i%6)//2)*140
            # Three rows, two cases across; each case has source/before/after.
            if i%6==0 and j==0:
                sheet=Image.new('RGB',(1560,1260),'white');draw=ImageDraw.Draw(sheet)
            y=((i%6)//2)*420
            im.thumbnail((255,370));sheet.paste(im,(x,y+45));draw.text((x+3,y+3),row['id'],font=font,fill='black');draw.text((x+3,y+23),label,font=font,fill='black')
        if i%6==5 or i==len(rows)-1:sheet.save(out/f'contact-{i//6+1}.jpg',quality=95)
    (out/'report.json').write_text(json.dumps({'beforeRevision':previous.SOURCE_REVISION,'afterRevision':current.SOURCE_REVISION,
        'referenceIsGroundTruth':False,'device':'cpu','records':results},indent=2)+'\n',encoding='utf-8')
