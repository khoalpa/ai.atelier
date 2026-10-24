import ast
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

tree=ast.parse((Path(__file__).resolve().parents[1]/'ai_service.py').read_text(encoding='utf-8'))
names={'fill_garment_mask_holes','refine_object_mask'}
ns={'np':np,'cv2':cv2,'Image':Image}
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names],type_ignores=[]),'<objects>','exec'),ns)
mask=np.zeros((120,160),dtype=np.uint8)
mask[10:90,10:80]=1;mask[20:80,100:140]=1
mask[30:34,40:44]=0;mask[100:104,150:154]=1
protected=Image.new('L',(160,120));protected.paste(255,(20,60,35,75))
points=[{'x':30,'y':30,'label':1},{'x':120,'y':40,'label':1},{'x':60,'y':60,'label':0}]
result=np.asarray(ns['refine_object_mask'](mask,points,protected))
assert result[32,42]==255  # texture holes filled
assert result[40,120]==255  # disconnected selected object kept
assert not result[100:104,150:154].any()  # unselected noise removed
assert result[60,60]==0  # negative point survives cleanup
assert not result[60:75,20:35].any()  # manual protection wins
single=np.asarray(ns['refine_object_mask'](mask,points[:1],protected))
assert not single[:,100:].any()  # do not silently include another object
print('OK: shared hole repair, multiple selected objects, negative hints and manual protection for object removal.')

from contextlib import nullcontext
from types import SimpleNamespace
from tempfile import TemporaryDirectory
segment=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='segment_object_mask')
class Predictor:
    calls=0
    def set_image(self,image): self.image=image
    def predict(self,point_coords,point_labels,multimask_output):
        self.calls+=1
        selected=np.zeros((120,160),dtype=np.float32)
        if len(point_coords)==1 and point_coords[0,0]>90:selected[20:80,100:140]=1
        else:selected[10:90,10:80]=1
        return np.asarray([selected,selected]),np.asarray([.95,.92]),None
predictor=Predictor()
with TemporaryDirectory() as directory:
    sample=Path(directory)/'object.png';Image.new('RGB',(160,120),'gray').save(sample)
    ns.update({'safe_sample':lambda _:sample,'load_predictor':lambda:predictor,'encode_image':lambda image:image,'device':'cpu','torch':SimpleNamespace(inference_mode=nullcontext,autocast=lambda **_:nullcontext(),bfloat16=None)})
    exec(compile(ast.Module(body=[segment],type_ignores=[]),'<segment>','exec'),ns)
    result=ns['segment_object_mask']({'sampleId':'object.png','points':[{'x':30,'y':30},{'x':120,'y':40}]})
    final=np.asarray(result['mask'])
    assert final[30,30]>0 and final[40,120]>0 and predictor.calls==2
print('OK: floating SAM masks and separate prompts for disconnected objects work together.')
