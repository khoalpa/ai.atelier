"""Incomplete pose masks need a confident, complete fallback or must fail."""
import ast
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

tree=ast.parse((Path(__file__).resolve().parents[1]/'ai_service.py').read_text(encoding='utf-8'))
node=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='catvton_dedicated_mask')
points=[[100,20,1.] for _ in range(17)]
for index,position in {5:(60,50),6:(140,50),7:(50,90),8:(150,90),9:(45,125),10:(155,125),11:(75,170),12:(125,170)}.items():
    points[index]=[*position,1.]
source=Image.new('RGB',(200,300))
for confidence,complete,expected in [(.95,True,True),(.5,True,False),(.95,False,False)]:
    policies=iter([{'accepted':False,'garmentCompleteness':.60},{'accepted':complete,'garmentCompleteness':.85 if complete else .65}])
    protected=Image.new('L',source.size,0);protected.paste(255,(0,0,20,300))
    def exclude(mask,protection):
        result=np.asarray(mask).copy();result[np.asarray(protection)>0]=0;return Image.fromarray(result)
    namespace={'np':np,'cv2':cv2,'Image':Image,'automatic_protected_detail_mask':lambda *args:protected,
               'mask_strength_policy':lambda *args:next(policies),
               'automatic_garment_mask':lambda *args:(Image.new('L',source.size,255),confidence),
               'exclude_protected_pixels':exclude}
    exec(compile(ast.Module(body=[node],type_ignores=[]),'<mask>','exec'),namespace)
    mask,score,metrics=namespace['catvton_dedicated_mask'](source,'upper_body',[20,0,180,290],points)
    assert metrics['accepted']==expected
    if expected:
        assert metrics['mode']=='standard-coverage-fallback'
        assert not np.asarray(mask)[:,:20].any()
        assert score==confidence
print('OK: pose completeness is enforced; only confident, complete, protected fallbacks are accepted.')
