"""Verify the Windows DensePose adapter matches IDM-VTON's dp_segm contract."""
import sys
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import torch
import torchvision  # Register torchvision::nms before the adapter imports it.
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import idm_vton_runtime as runtime

captured={}
class FakeModel:
    def eval(self):return self
    def __call__(self,tensor):
        captured['tensor']=tensor.clone()
        boxes=torch.tensor([[0,0,384,512]],dtype=torch.float32)
        coarse=torch.zeros((1,2,2,2));coarse[:,1]=1
        fine=torch.zeros((1,25,2,2));fine[:,1]=1
        return boxes,coarse,fine,torch.empty(0),torch.empty(0)

original=torch.jit.load
torch.jit.load=lambda *args,**kwargs:FakeModel()
try:
    result=runtime.densepose_image(Image.new('RGB',(10,10),(10,20,30)),Path('fake.torchscript'))
finally:
    torch.jit.load=original

assert captured['tensor'][:,0,0].tolist()==[30,20,10], 'Detectron2 input must be BGR'
expected_bgr=cv2.applyColorMap(np.asarray([[int(255/24)]],dtype=np.uint8),cv2.COLORMAP_PARULA)[0,0]
expected_rgb=expected_bgr[::-1].tolist()
assert np.asarray(result)[256,192].tolist()==expected_rgb, 'dp_segm must use the PARULA label palette'
assert result.size==(384,512)
print('OK: DensePose uses BGR input, PARULA labels and the author 384x512 pose canvas.')
