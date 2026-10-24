"""Reference routing must not cut cuffs or use a whole-person background mask."""
import ast
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from PIL import Image, ImageFilter

tree=ast.parse((Path(__file__).resolve().parents[1]/'ai_service.py').read_text(encoding='utf-8'))
functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'preprocess_garment_image','normalize_garment_reference'}]
points=[[0,0,0] for _ in range(17)]
for i,(x,y) in {0:(50,10),1:(45,10),5:(25,30),6:(75,30),7:(15,55),8:(85,55),9:(10,80),10:(90,80),11:(40,75),12:(60,75)}.items():points[i]=[x,y,1]
person={'box':[0,0,100,120],'keypoints':points,'confidence':.95}
mask=Image.new('L',(100,120));mask.paste(255,(20,25,80,80));mask.paste(255,(4,45,20,95));mask.paste(255,(80,45,96,95))
calls=[]
def people(image):calls.append('pose');return [person]
def background(image):calls.append('background');return mask
ns=dict(np=np,Image=Image,ImageFilter=ImageFilter,POSE_MODEL=SimpleNamespace(is_file=lambda:True),
        detect_people_pose=people,birefnet_mask=background,
        automatic_garment_mask=lambda *a:(mask,.95),
        automatic_protected_detail_mask=lambda *a:Image.new('L',mask.size))
exec(compile(ast.Module(body=functions,type_ignores=[]),'<references>','exec'),ns)
source=Image.new('RGB',mask.size,'blue')
result=ns['preprocess_garment_image'](source,'upper_body','auto')
assert result[3]=='model-photo' and calls==['pose'], 'Human references must resolve before BiRefNet'
calls.clear();result=ns['preprocess_garment_image'](source,'upper_body','product')
assert calls==['background'] and result[3]=='birefnet'
ns['detect_people_pose']=lambda image:[]
try:ns['preprocess_garment_image'](source,'upper_body','model')
except ValueError:pass
else:raise AssertionError('Unknown person crop must not silently become a product')
ns['detect_people_pose']=lambda image:[person]
_,cutout,metrics=ns['normalize_garment_reference'](source,'upper_body')
x0,y0,_,_=metrics['bbox']
assert cutout.getpixel((10-x0,90-y0))>200,'Normalization must preserve long cuffs'
assert cutout.getpixel((50-x0,77-y0))>200,'Normalization must preserve the hem'
assert metrics['requiresVisualReview']
print('OK: person/product reference routing, uncertain-person rejection and cuff/hem preservation.')
