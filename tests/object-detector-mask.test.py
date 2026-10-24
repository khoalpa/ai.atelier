"""YOLO object boxes must go through SAM, not erase their whole rectangle."""
import ast
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import cv2
import numpy as np
from PIL import Image

root=Path(__file__).resolve().parents[1]
tree=ast.parse((root/'ai_service.py').read_text(encoding='utf-8'))
node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='detect_regions')
class Tensor:
    def detach(self):return self
    def cpu(self):return self
    def tolist(self):return [10,10,40,40]
    def item(self):return 0
box=SimpleNamespace(xyxy=[Tensor()],cls=[Tensor()],conf=[SimpleNamespace(item=lambda:.95)])
prediction=SimpleNamespace(names={0:'cup'},boxes=[box])
model=SimpleNamespace(set_classes=lambda _:None,predict=lambda *a,**kw:[prediction])
with TemporaryDirectory() as directory:
    path=Path(directory)/'source.png';Image.new('RGB',(60,60),'gray').save(path)
    calls=[]
    shape=np.zeros((60,60),dtype=np.uint8);cv2.circle(shape,(25,25),10,255,-1)
    def segment(source,boxes):calls.append(boxes);return Image.fromarray(shape)
    ns=dict(Image=Image,np=np,cv2=cv2,device='cpu',safe_sample=lambda _:path,
            _detector=lambda _:model,_boxes_to_sam_mask=segment,encode_image=lambda image:image)
    exec(compile(ast.Module(body=[node],type_ignores=[]),'<detection>','exec'),ns)
    result=ns['detect_regions']({'sampleId':'source','model':'yolo-world','classes':['cup'],'padding':0})
    mask=np.asarray(result['mask'])
    assert mask[25,25]==255 and mask[10,10]==0 and calls==[[[10,10,40,40]]]
    assert np.array_equal(result['detections'][0]['mask'],result['mask'])
    ns['_boxes_to_sam_mask']=lambda *a:Image.new('L',(60,60))
    try:ns['detect_regions']({'sampleId':'source','model':'yolo-world','classes':['cup']})
    except ValueError as error:assert 'đường viền' in str(error)
    else:raise AssertionError('Empty segmentation silently became a rectangle')
print('OK: YOLO + SAM contour masks, consistent per-object union and explicit segmentation failure.')
