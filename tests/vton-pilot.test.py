import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import torch
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from vton_pilot import build_inpaint_batch, file_hash, load_dataset

spec=importlib.util.spec_from_file_location('intake',ROOT/'scripts/prepare-couple-tee.py')
intake=importlib.util.module_from_spec(spec); spec.loader.exec_module(intake)
spec=importlib.util.spec_from_file_location('combined',ROOT/'scripts/prepare-vton-combined.py')
combined=importlib.util.module_from_spec(spec); spec.loader.exec_module(combined)

def rejects(call, message):
    try:
        call()
    except ValueError as error:
        assert message in str(error), str(error)
    else:
        raise AssertionError('Expected rejection: '+message)

with tempfile.TemporaryDirectory() as temporary:
    root=Path(temporary)
    for name in ('Áo.jpg','Áo male.jpg','Áo female.jpg'):
        (root/name).touch()
    assert len(intake.discover(root))==1
    (root/'single.jpg').touch();(root/'single female.jpg').touch()
    assert len(intake.discover(root))==2
    (root/'orphan male.jpg').touch()
    rejects(lambda:intake.discover(root),'Incomplete')

with tempfile.TemporaryDirectory() as temporary:
    roots=[Path(temporary)/name for name in ('old','new')]
    manifests=[];catalogs=[]
    for i,root in enumerate(roots):
        root.mkdir()
        Image.new('RGB',(30,40),(50+i,20,30)).save(root/'product.png')
        Image.new('RGB',(30,40),(70+i,40,30)).save(root/'person.png')
        Image.new('L',(30,40),255).save(root/'mask.png')
        split=('validation','train')[i]
        product={'id':f'product-{i}','source':str(root/'product.png'),'sourceSha256':file_hash(root/'product.png'),'split':split}
        row={'id':f'record-{i}','productId':product['id'],'split':split,
             'sourcePersonImage':str(root/'person.png'),'sourceSha256':file_hash(root/'person.png'),
             'productImage':'product.png','personImage':'person.png','maskImage':'mask.png',
             'quality':{'maskReview':'accepted_for_pilot'}}
        row['preparedHashes']={f:file_hash(root/row[f]) for f in ('productImage','personImage','maskImage')}
        manifests.append(row);catalogs.append(product)
    def write_sources():
        for root,row,product in zip(roots,manifests,catalogs):
            (root/'manifest.jsonl').write_text(json.dumps(row)+'\n',encoding='utf-8')
            (root/'products.json').write_text(json.dumps([product]),encoding='utf-8')
    write_sources()
    collected,_=combined.collect_sources(roots)
    assert [r['split'] for _,r in collected]==['validation','train']
    manifests[1]['personImage']=str(roots[1]/'person.png');write_sources()
    rejects(lambda:combined.collect_sources(roots),'relative to the dataset')
    manifests[1]['personImage']='person.png';write_sources()
    manifests[0]['split']='train';write_sources()
    rejects(lambda:combined.collect_sources(roots),'Historical product split')
    manifests[0]['split']='validation';write_sources()
    # Identical decoded pixels with a different file encoding must still be rejected.
    Image.open(roots[0]/'product.png').save(roots[1]/'duplicate.bmp')
    catalogs[1].update(source=str(roots[1]/'duplicate.bmp'),sourceSha256=file_hash(roots[1]/'duplicate.bmp'))
    write_sources();rejects(lambda:combined.collect_sources(roots),'Duplicate product')

with tempfile.TemporaryDirectory() as temporary:
    root=Path(temporary); rows=[]
    for i in range(30):
        name=f'{i}.png'
        Image.new('RGB',(384,512),(i+1,40,100)).save(root/name)
        product=f'product-{i//2}.png'
        Image.new('RGB',(384,512),(i//2+100,50,20)).save(root/product)
        mask=Image.new('L',(384,512)); ImageDraw.Draw(mask).rectangle((100,100,250,250),fill=255)
        mask.save(root/f'mask-{name}')
        row={'id':f'row-{i}','productId':f'product-{i//2}','split':'train' if i<24 else 'validation',
             'category':'upper_body','productImage':product,'personImage':name,'maskImage':f'mask-{name}',
             'provenance':{'synthetic':False},'quality':{'maskReview':'accepted_for_pilot'}}
        row['preparedHashes']={field:file_hash(root/row[field]) for field in ('productImage','personImage','maskImage')}
        rows.append(row)
    def write():
        (root/'manifest.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows),encoding='utf-8')
    write(); assert len(load_dataset(root))==30
    rows[-1]['productId']='product-0'; write()
    rejects(lambda:load_dataset(root),'leaks')
    rows[-1]['productId']='product-14'; rows[0]['quality']['maskReview']='pending'; write()
    rejects(lambda:load_dataset(root),'reviewed')
    rows[0]['quality']['maskReview']='accepted_for_pilot'; write()
    Image.new('RGB',(384,512),'red').save(root/'0.png')
    rejects(lambda:load_dataset(root),'changed after review')
    rows[0]['id']='../unsafe'; write()
    rejects(lambda:load_dataset(root),'safe filename')
    rows[0]['id']='row-0'
    for row in rows:
        for field in ('personImage','maskImage'):
            with Image.open(root/row[field]) as im:
                resized=im.resize((768,1024),Image.Resampling.NEAREST)
            resized.save(root/row[field])
        row['preparedHashes']={field:file_hash(root/row[field]) for field in ('productImage','personImage','maskImage')}
    write();assert len(load_dataset(root))==30
    with Image.open(root/rows[-1]['personImage']) as im:small=im.resize((384,512))
    small.save(root/rows[-1]['personImage'])
    with Image.open(root/rows[-1]['maskImage']) as im:small=im.resize((384,512),Image.Resampling.NEAREST)
    small.save(root/rows[-1]['maskImage'])
    rows[-1]['preparedHashes']={field:file_hash(root/rows[-1][field]) for field in ('productImage','personImage','maskImage')}
    write();rejects(lambda:load_dataset(root),'same geometry')

class Scheduler:
    def add_noise(self,clean,noise,t): return clean+noise
p=torch.ones(1,4,8,6); g=p*2; m=p*3; mask=torch.ones(1,1,8,6)
noise=torch.zeros(1,4,16,6)
x,target=build_inpaint_batch(p,g,m,mask,noise,torch.tensor([3]),Scheduler(),True)
assert x.shape==(1,9,16,6)
assert torch.equal(x[:,:4,:8],p) and torch.equal(x[:,:4,8:],g)
assert (x[:,4,:8]==1).all() and (x[:,4,8:]==0).all()
assert torch.equal(x[:,5:,:8],m) and (x[:,5:,8:]==0).all()
assert target is noise
print('OK: pilot split leakage, reviewed content integrity, intake completeness, and CatVTON conditioning.')
