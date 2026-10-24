from helpers.ai_source import read_source
import ast
from pathlib import Path
import numpy as np
import cv2
from PIL import Image

tree=ast.parse(read_source(Path(__file__).resolve().parents[1]/'ai_service.py', encoding='utf-8'))
names={'sleeveless_reference','arm_reconstruction_masks','fill_garment_mask_holes','reference_skin_mask'}
ns={'np':np,'cv2':cv2,'Image':Image}
exec(compile(ast.Module(body=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in names],type_ignores=[]),'<arms>', 'exec'),ns)
reference=Image.new('RGB',(100,200),'white')
reference.paste((220,20,40),(20,50,80,185))
reference.paste((220,20,40),(24,10,28,60))
reference.paste((220,20,40),(72,10,76,60))
assert ns['sleeveless_reference'](reference)
assert not ns['sleeveless_reference'](Image.new('RGB',(100,200),'white'))
sleeved=Image.new('RGB',(100,200),'white');sleeved.paste((220,20,40),(10,10,90,190))
assert not ns['sleeveless_reference'](sleeved)
tone_source=Image.new('RGB',(100,150),(205,150,115))
tone_person={'box':[10,5,90,145],'keypoints':[[50,15,1.0]]}
sample=Image.new('RGB',(100,150),(65,48,37))
sample.paste((205,150,115),(0,0,40,150))
skin=ns['reference_skin_mask'](tone_source,sample,tone_person)
assert skin[80,20]==255
assert skin[80,80]==0  # warm brown fabric must not count as skin
source=Image.new('RGB',(100,150),(120,150,195))
source.paste((205,150,115),(15,75,27,90))
source.paste((205,150,115),(40,5,60,25))
points=[[50,15,1.0] for _ in range(17)]
for i,p in {5:[30,35,1],6:[70,35,1],7:[20,60,1],8:[80,60,1],9:[20,85,1],10:[80,85,1],11:[35,100,1],12:[65,100,1]}.items():points[i]=p
protected=Image.new('L',source.size);protected.paste(255,(35,5,65,30))
editable=Image.new('L',source.size);editable.paste(255,(10,30,90,100))
mask,preserve=ns['arm_reconstruction_masks'](source,{'keypoints':points},editable,protected)
m,p=np.asarray(mask),np.asarray(preserve)
assert m[50,20]>0  # old sleeve is editable
assert m[50,50]==0  # center of new garment stays untouched
assert p[80,20]==255 and m[80,20]==0  # visible source skin preserved
assert not m[np.asarray(protected)>0].any()
assert not m[:20].any()
result=Image.new('RGB',source.size,(65,45,30))
result.paste((225,20,35),(37,40,63,95))
colored_mask,_=ns['arm_reconstruction_masks'](source,{'keypoints':points},editable,protected,result)
assert np.asarray(colored_mask)[50,50]==0  # new red garment remains protected
assert np.asarray(colored_mask)[50,32]>0  # brown sleeve must not be locked as a red garment
missing,_=ns['arm_reconstruction_masks'](source,{},editable,protected)
assert missing.getbbox() is None
print('OK: thin straps trigger repair; sleeves do not; garment, skin, head and background remain protected.')
