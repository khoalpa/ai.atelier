"""Compare corrected masks on original geometry without rewriting frozen input."""
import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import numpy as np
from PIL import Image,ImageFilter,ImageDraw,ImageFont
from vton_pilot import file_hash
from tryon_geometry import target_coverage


def audit(baseline,out,cpu=False):
    import ai_service as ai
    if cpu: ai.device='cpu'
    manifest=json.loads((baseline/'cases.json').read_text(encoding='utf-8'))
    out.mkdir(parents=True,exist_ok=False)
    shutil.copytree(baseline/'inputs',out/'inputs')
    cache={};results=[]
    for case in manifest['cases']:
        folder=out/'inputs'/case['id'];source=Image.open(folder/'source.png').convert('RGB')
        protected=Image.open(folder/'protected.png').convert('L');pose=case['pose']
        if case['sourceId'] not in cache:
            cache[case['sourceId']]=ai.automatic_garment_mask(source,'upper_body',pose['box'],pose['keypoints'])
        mask,score=cache[case['sourceId']]
        attrs={**case['targetAttributes']}
        if attrs['neckline']=='high':attrs['neckline']='unknown'
        mask,expected,exposed,info=target_coverage(mask,protected,'upper_body',pose,attrs)
        mask=ai.exclude_protected_pixels(mask.filter(ImageFilter.MaxFilter(17)),protected)
        mask.save(folder/'auto-mask.png');expected.save(folder/'auto-expected.png');exposed.save(folder/'auto-exposed.png')
        preview=Image.composite(Image.new('RGB',source.size,(130,130,130)),source,mask)
        preview.thumbnail((384,512));preview.save(folder/'auto-preview.jpg',quality=90)
        old=(np.array(Image.open(folder/'visible-old-garment.png'))>0)&(np.array(protected)==0)
        selected=np.array(mask)>0
        previous=np.array(Image.open(baseline/'inputs'/case['id']/'auto-mask.png'))>0
        row={'case':case['id'],'oldGarmentPixels':int(old.sum()),
             'missedBefore':int((old&~previous).sum()),'missedAfter':int((old&~selected).sum()),
             'coverageBefore':float((old&previous).sum()/old.sum()),'coverageAfter':float((old&selected).sum()/old.sum()),
             'areaBefore':int(previous.sum()),'areaAfter':int(selected.sum()),
             'protectedPixelsSelected':int((selected&(np.array(protected)>0)).sum())}
        results.append(row)
        Image.fromarray((old&~selected).astype('uint8')*255).save(folder/'auto-missed-old-garment.png')
        case['autoScore']=score;case['autoVisibleGarmentCoverage']=row['coverageAfter']
        case['files']={name:file_hash(folder/name) for name in case['files']}
        print(json.dumps(row),flush=True)
    manifest['revision']=ai.SOURCE_REVISION
    manifest['maskComparisonBaseline']=str(baseline)
    (out/'cases.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (out/'mask-audit.json').write_text(json.dumps({'revision':ai.SOURCE_REVISION,'device':ai.device,
       'referenceIsGroundTruth':False,'cases':results},indent=2)+'\n',encoding='utf-8')
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',17)
    for page in range(2):
        sheet=Image.new('RGB',(4*300,3*415),'white');draw=ImageDraw.Draw(sheet)
        for i,case in enumerate([c for c in manifest['cases'] if c['mode']=='transfer'][page*3:page*3+3]):
            files=[(baseline/'inputs'/case['id']/'source.png','Source'),(baseline/'inputs'/case['id']/'auto-preview.jpg','Before'),
                   (out/'inputs'/case['id']/'auto-preview.jpg','After'),(out/'inputs'/case['id']/'reviewed-preview.jpg','Control')]
            for j,(path,label) in enumerate(files):
                im=Image.open(path).convert('RGB');im.thumbnail((295,370));sheet.paste(im,(j*300,i*415+40))
                draw.text((j*300+4,i*415+3),case['sourceId'],font=font,fill='black');draw.text((j*300+4,i*415+21),label,font=font,fill='black')
        sheet.save(out/f'mask-comparison-{page+1}.jpg',quality=95)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--baseline',type=Path,default=ROOT/'workspace/diagnostics/real-vton-20261022')
    p.add_argument('--output',type=Path,default=ROOT/'workspace/diagnostics/real-vton-fixed-20261022')
    p.add_argument('--cpu',action='store_true');a=p.parse_args();audit(a.baseline.resolve(),a.output.resolve(),a.cpu)
