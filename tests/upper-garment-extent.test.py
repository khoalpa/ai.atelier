"""A real SAM fabric region must survive the pose bounds and waist logic."""
import ast
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
import cv2
import numpy as np
from PIL import Image

tree=ast.parse((Path(__file__).resolve().parents[1]/'ai_service.py').read_text(encoding='utf-8'))
cloth=np.zeros((1000,600),np.uint8)
cloth[280:650,200:410]=1  # shirt hem below hip landmarks at y=570
cloth[180:400,130:210]=1  # bent raised sleeve above the old box's top
cloth[180:250,130:290]=1
pose=[[0,0,0] for _ in range(17)]
for i,x,y in [(0,310,230),(5,220,310),(6,390,310),(7,160,220),(8,420,440),
              (9,260,205),(10,420,560),(11,250,570),(12,370,570),(13,255,790),(14,365,790)]:
    pose[i]=[x,y,.99]
class Sam:
    def set_image(self,image):pass
    def predict(self,**kwargs):
        larger=cloth.copy();larger[640:730,200:410]=1
        return np.stack([cloth,larger,cloth]),np.array([.98,.92,.96]),None
ns={'np':np,'cv2':cv2,'Image':Image,'device':'cpu','load_predictor':lambda:Sam(),
    'torch':SimpleNamespace(inference_mode=lambda:nullcontext(),autocast=lambda **kw:nullcontext(),bfloat16=None),
    'pose_garment_prior':lambda *args:cloth*255,
    'automatic_protected_detail_mask':lambda source,*args:Image.new('L',source.size)}
names={'upper_garment_prompt','automatic_garment_mask','fill_garment_mask_holes'}
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names],type_ignores=[]),'<mask>','exec'),ns)
mask,_=ns['automatic_garment_mask'](Image.new('RGB',(600,1000)),'upper_body',[120,120,440,980],pose)
out=np.array(mask)>0
assert out[625,300], 'The visible shirt hem was cut at the waist'
assert out[195,150], 'The raised sleeve was cut by the person-height box'
assert not out[800:,200:410].any(), 'Trousers were included without SAM evidence'
assert not out[675,300], 'A competing shirt+trousers proposal expanded the chosen shirt mask'
assert not out[:,470:].any(), 'Pose bounds must not become a rectangular edit region'
partial=[p[:] for p in pose];partial[11][2]=0
assert ns['upper_garment_prompt']((600,1000),[120,120,440,980],partial) is None
print('OK: visible lower hems and raised sleeves survive; unsupported trousers/background remain excluded.')
