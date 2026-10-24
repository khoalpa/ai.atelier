"""Build 24 explicit workflow cases; distinguish fixtures from model quality results."""
from pathlib import Path
import hashlib
import io
import json
import sys
import numpy as np
from PIL import Image, ImageFilter, ImageOps

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from sample_catalog import resolve_sample


def main():
    home=ROOT/'samples';catalog=json.loads((home/'catalog.json').read_text(encoding='utf-8'))
    assets={a['id']:a for a in catalog['assets']};aliases=json.loads((home/'aliases.json').read_text(encoding='utf-8'))
    cases=[]
    def case(id,task,source,checks,**extra):
        value={'id':id,'task':task,'sourceId':source,'sourceSha256':assets[source]['sha256'],
               'checks':checks,'qualityReview':'not-run','evaluationScope':'regression case; demo-visible sources are not independent holdouts',**extra}
        cases.append(value)
        return value
    def derived(name,image,parent,description):
        relative='testing/cases/v2/'+name;target=home/relative;target.parent.mkdir(parents=True,exist_ok=True);image.save(target)
        digest=hashlib.sha256(target.read_bytes()).hexdigest()
        provenance={**assets[parent]['provenance'],'derivedFrom':parent,'modifications':description}
        assets[relative]={'id':relative,'path':relative,'storage':'samples','label':name,'group':'Kiểm thử',
                         'roles':['fixture'],'tasks':[],'sha256':digest,'width':image.width,'height':image.height,
                         'bytes':target.stat().st_size,'provenance':provenance}
        aliases['aliases'][relative]=relative
        return relative
    for index,(person,garment,focus) in enumerate([
        ('01','01','vertical-stripes'),('03','02','body-build-and-checks'),('05','03','seated-folds'),
        ('06','04','crossed-arm-occlusion'),('07','01','bag-occlusion'),('08','02','three-quarter-pose')],1):
        reference=f'demo/garments/garment-{garment}.png'
        case(f'tryon-{index:02d}','tryon',f'demo/people/people-{person}.png',
             ['preserve face and hands','retain target pattern and garment construction','no garment outside person'],
             referenceId=reference,referenceSha256=assets[reference]['sha256'],focus=focus,
             settings={'category':'lower_body'if garment=='03'else'overall'if garment=='02'else'upper_body','autoMask':True})
    for key in ['01-flat-1','04-flat-4','07-flat-7','18-tiles-2']:
        prefix=f'object-removal-benchmark/{key}/'
        case('removal-'+key,'inpaint',prefix+'source.png',['outside-mask pixels unchanged','masked error improves over input'],
             maskId=prefix+'mask.png',referenceId=prefix+'clean.png',metric='masked-MAE and outside-mask maximum error')
    for index,(parent,side) in enumerate([('nature-mountain.jpg','left'),('nature-forest.jpg','right'),('nature-lake.jpg','top'),('interior-hall.jpg','bottom')],1):
        # Extension is taken from the catalog, not guessed from upstream titles.
        prefix='demo/scenes/'+parent.rsplit('.',1)[0]
        parent=next(key for key in assets if key.startswith(prefix+'.'))
        with Image.open(resolve_sample(ROOT,parent)) as image:full=ImageOps.exif_transpose(image).convert('RGB');full.thumbnail((1024,1024))
        w,h=full.size;dx,dy=round(w*.15),round(h*.15)
        box=(dx if side=='left'else 0,dy if side=='top'else 0,w-dx if side=='right'else w,h-dy if side=='bottom'else h)
        source=derived(f'outpaint-{index}/source.png',full.crop(box),parent,'EXIF orientation applied; resized to at most 1024 px; 15% edge crop for deterministic test')
        reference=derived(f'outpaint-{index}/reference.png',full,parent,'EXIF orientation applied and resized to at most 1024 px for deterministic test')
        case(f'outpaint-{index:02d}','outpaint',source,['original crop pixels preserved at stated offset','boundary continuity reviewed','target dimensions match'],
             referenceId=reference,settings={'width':w,'height':h,'left':box[0],'top':box[1]},metric='boundary diagnostics; full reference similarity is diagnostic only')
    for suffix,task,source,focus in [
        ('glasses','makeup','demo/faces/face-02.png','glasses preserved'),('profile','makeup','demo/faces/face-04.png','placement on angled face'),
        ('two-people','character','demo/people/scene-people-01.png','only selected person changes'),('occlusion','character','demo/people/scene-people-02.png','overlapping person preserved')]:
        case('portrait-'+suffix,task,source,['preserve identity','preserve unselected regions',focus],requiresVisualReview=True)
    parent=next(key for key in assets if key.startswith('demo/scenes/nature-field.'))
    with Image.open(resolve_sample(ROOT,parent)) as im:clean=ImageOps.exif_transpose(im).convert('RGB');clean.thumbnail((1024,1024))
    reference=derived('enhancement/reference.png',clean,parent,'Resized to at most 1024 px; deterministic enhancement reference')
    rng=np.random.default_rng(24025)
    noise=Image.fromarray(np.clip(np.asarray(clean,dtype=np.float32)+rng.normal(0,12,(*clean.size[::-1],3)),0,255).astype('uint8'))
    stream=io.BytesIO();clean.save(stream,'JPEG',quality=20);stream.seek(0);jpeg=Image.open(stream).convert('RGB')
    for kind,image in [('noise',noise),('blur',clean.filter(ImageFilter.GaussianBlur(1.1))),('jpeg',jpeg)]:
        source=derived(f'enhancement/{kind}.png',image,parent,f'Deterministic {kind} degradation; noise seed 24025; blur sigma 1.1; JPEG quality 20 as applicable')
        case('enhance-'+kind,'enhance',source,['dimensions preserved','no invented content','compare error and edge artifacts against reference'],referenceId=reference,settings={'method':'light','profile':'balanced','level':'balanced'})
    source='demo/objects/object-05.png'
    case('background-alpha','background',source,['transparent edge retained','no opaque rectangular background'],expectedAlphaRange=[0,255])
    case('export-png-alpha','manual',source,['PNG exports RGBA','alpha retained','output dimensions match'],settings={'format':'png','width':512,'height':512})
    case('export-jpeg','manual','demo/people/people-01.png',['JPEG exports RGB','background flattened','output dimensions match'],settings={'format':'jpeg','width':512,'height':768})
    assert len(cases)==24
    manifest={'schemaVersion':1,'cases':cases,'note':'Prepared inputs and criteria only. Passing fixture validation is not a claim that AI output quality passed.'}
    folder=home/'testing/cases';folder.mkdir(parents=True,exist_ok=True)
    (folder/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    catalog['assets']=list(assets.values())
    for name,value in [('aliases.json',aliases),('catalog.json',catalog)]:
        tmp=home/(name+'.tmp');tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');tmp.replace(home/name)
    print(json.dumps({'cases':len(cases),'derivedInputs':sum(key.startswith('testing/cases/v2/') for key in assets)}))


if __name__=='__main__':main()
