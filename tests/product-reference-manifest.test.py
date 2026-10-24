"""Uploaded products must use their manifest and never normalize a different sample."""
import ast
import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
tree = ast.parse((root/'ai_service.py').read_text(encoding='utf-8'))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'catvton_reference_matrix')
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    references = root/'workspace/references/upper_body'
    references.mkdir(parents=True)
    product = references/'reference.png'
    Image.new('RGB',(100,100),'blue').save(product)
    manifest = references/'manifest.json'
    manifest.write_text(json.dumps({'source':'uploaded-product'}))
    review = root/'workspace/review'
    review.mkdir(parents=True)
    (review/'reference-profiles.json').write_text(json.dumps({'profiles':{'upper_body':{'validation':{'accepted':True},'manifest':str(manifest.relative_to(root)),'reference':str(product.relative_to(root))}}}))
    def unexpected(*args):
        raise AssertionError('A validated product must not normalize a sample')
    scope = dict(ROOT=root, OUTPUTS=root/'workspace/outputs', Path=Path, Image=Image, json=json,
                 datetime=datetime, timezone=timezone, active_reference_path=lambda category:product,
                 normalize_reference=unexpected, encode_image=lambda image:'encoded',
                 safe_sample=lambda sample:product, detect_people=lambda source,pose:[])
    exec(compile(ast.Module(body=[function], type_ignores=[]),'<matrix>','exec'),scope)
    result=scope['catvton_reference_matrix']({'sampleIds':['one'],'category':'upper_body'})
    assert result['reference']=={'source':'uploaded-product'}
    assert result['skippedCount']==1
    manifest.unlink()
    try:
        scope['catvton_reference_matrix']({'sampleIds':['one'],'category':'upper_body'})
    except ValueError as error:
        assert 'manifest' in str(error)
    else:
        raise AssertionError('Missing uploaded manifest must fail explicitly')
print('OK: product matrix uses the uploaded manifest and fails safely if it is missing.')
