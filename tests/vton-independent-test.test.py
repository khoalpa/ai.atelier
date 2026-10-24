import importlib.util
import json
import tempfile
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('validator',ROOT/'scripts/validate-vton-paired-dataset.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);rows=[]
    for i,split in enumerate(('train','validation','test')):
        for kind,size in [('product',(768,768)),('person',(768,1024))]:
            Image.new('RGB',size,(30+i*30,20,100)).save(root/f'{kind}-{i}.png')
        rows.append({'id':f'row-{i}','split':split,'category':'upper_body','productId':f'product-{i}',
                     'personId':f'person-{i}','productImage':f'product-{i}.png','personImage':f'person-{i}.png',
                     'attributes':{'sleeveLength':'long','neckline':'round','hemLength':'hip','layering':'single'},
                     'quality':{'frontView':True,'fullGarmentVisible':True,'severeOcclusion':False},
                     'provenance':{'source':'test-fixture','synthetic':False,'consentRecorded':True,'commercialUseAllowed':True}})
    def check(history=()):
        (root/'manifest.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows),encoding='utf-8')
        return v.validate(root,1,1,('upper_body',),1,history)
    assert check()['readyForFineTune']
    assert not v.validate(root,1,1)['readyForFineTune']  # full-category default remains strict
    rows[2]['personId']=None
    assert 'record.identity' in {i['code'] for i in check()['issues']}
    rows[2]['personId']='person-2';rows[2]['personImage']='person-0.png'
    assert 'split.image_leakage' in {i['code'] for i in check()['issues']}
    rows[2]['personImage']='person-2.png'
    history=root/'history.jsonl'
    history.write_text(json.dumps({'id':'old','productId':'product-2','personIdentity':None})+'\n')
    codes={i['code'] for i in check([history])['issues']}
    assert {'history.person_unverified','test.previously_seen'} <= codes
    history.write_text(json.dumps({'id':'old','productId':'different-product','personId':'different-person'})+'\n')
    assert check([history])['readyForFineTune']
print('OK: scoped readiness, unknown identities, content leakage and previously seen test records.')
