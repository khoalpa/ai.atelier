"""Validate image bytes, legacy aliases, dataset splits, and workflow fixtures."""
from pathlib import Path
import hashlib
import json
import sys
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from sample_catalog import resolve_sample, collection_path


def validate(root, expected_demo=64):
    root=Path(root);home=root/'samples'
    data=json.loads((home/'catalog.json').read_text(encoding='utf-8'))
    assets={a['id']:a for a in data['assets']}
    assert len(assets)==len(data['assets']),'Duplicate asset ID'
    demo=[a for a in assets.values()if 'demo'in a['roles']]
    assert len(demo)==expected_demo
    for item in assets.values():
        file=resolve_sample(root,item['id'])
        assert hashlib.sha256(file.read_bytes()).hexdigest()==item['sha256'],item['id']
        with Image.open(file) as image:
            image.verify()
        if 'demo'in item['roles']:
            assert item['storage']!='archive'and item['provenance']['redistributable']
            assert (home/item['thumbnail']).is_file()
    aliases=json.loads((home/'aliases.json').read_text(encoding='utf-8'))['aliases']
    for key,target in aliases.items():
        assert target in assets,key
        assert resolve_sample(root,key)==resolve_sample(root,target),key
    manifest=json.loads((home/'testing/cases/manifest.json').read_text(encoding='utf-8'))
    assert len(manifest['cases'])==24
    results=[]
    for case in manifest['cases']:
        source=assets[case['sourceId']]
        assert source['sha256']==case['sourceSha256'],case['id']
        for name in ('referenceId','maskId'):
            if name in case:assert case[name]in assets,case['id']
        if case['task']=='inpaint':
            with Image.open(resolve_sample(root,case['maskId']))as mask:
                values=np.asarray(mask.convert('L'));assert values.shape==(source['height'],source['width']);assert values.min()==0 and values.max()==255
        if case['task']=='outpaint':
            with Image.open(resolve_sample(root,case['referenceId']))as ref,Image.open(resolve_sample(root,case['sourceId']))as image:
                settings=case['settings'];x,y=settings['left'],settings['top']
                assert ref.size==(settings['width'],settings['height'])
                assert np.array_equal(np.asarray(ref.crop((x,y,x+image.width,y+image.height))),np.asarray(image))
        if case['task']=='enhance':
            with Image.open(resolve_sample(root,case['sourceId']))as image,Image.open(resolve_sample(root,case['referenceId']))as ref:
                assert image.size==ref.size
                assert not np.array_equal(np.asarray(image),np.asarray(ref))
        if case['id']=='background-alpha':
            with Image.open(resolve_sample(root,case['sourceId']))as image:assert image.mode=='RGBA'and image.getextrema()[-1]==(0,255)
        results.append({'id':case['id'],'inputValidation':'passed','aiQualityReview':case['qualityReview']})
    dataset=collection_path(root,'synthetic-paired-vton-20261021')
    pairs=[json.loads(line)for line in (dataset/'manifest.jsonl').read_text(encoding='utf-8').splitlines()if line.strip()]
    splits={}
    for pair in pairs:
        splits.setdefault(pair['productId'],set()).add(pair['split'])
        assert (dataset/pair['productImage']).is_file()and(dataset/pair['personImage']).is_file()
    assert len(pairs)==90 and all(len(values)==1 for values in splits.values())
    return {'assets':len(assets),'demo':len(demo),'aliases':len(aliases),'workflowCases':results,'syntheticPairs':len(pairs),'datasetSplitLeakage':False}


if __name__=='__main__':
    result=validate(ROOT)
    report=ROOT/'workspace/diagnostics/samples-v2/validation.json';report.parent.mkdir(parents=True,exist_ok=True)
    report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items()if k!='workflowCases'}))
