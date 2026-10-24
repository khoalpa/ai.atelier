"""Verify the actual IDM argument adapter without allocating model weights."""
import ast
import sys
from pathlib import Path
from types import SimpleNamespace
import torch
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
from idm_vton_runtime import canvas_size, description_for, negative_description_for, generate

assert canvas_size(512)==(384,512)
assert canvas_size(960)==(720,960)
assert canvas_size(1024)==(768,1024)
assert description_for('upper_body')=='an upper body garment'
assert description_for('overall','  an emerald A-line dress  ')=='an emerald A-line dress'
assert negative_description_for('  trousers, layered skirt  ')=='trousers, layered skirt'
assert negative_description_for('')==''

class Pipe:
    unet=SimpleNamespace(dtype=torch.float32, encoder_hid_proj=SimpleNamespace(to=lambda device:None))
    _execution_device='cpu'
    def encode_prompt(self,*args,**kwargs):
        prompts.append(args[0])
        negatives.append(kwargs.get('negative_prompt'))
        return (torch.zeros(1,2,3),)*4

prompts=[]
negatives=[]
captured={}
image=Image.new('RGB',(80,120),'white')
mask=Image.new('L',image.size,255)
def call(pipe,**kwargs):
    captured.update(kwargs)
    return ([kwargs['image'].copy()],)
assert generate(Pipe(),image,image,mask,image,'upper_body',call,width=64,height=128,num_inference_steps=2).size == image.size
assert captured['cloth'].shape==(1,3,128,64)
assert captured['pose_img'].shape==(1,3,128,64)
assert captured['mask_image'].size==(64,128)
assert captured['cloth'].max()==1 and captured['cloth'].min()>.9
assert not np.asarray(captured['mask_image'])[:16].any(), 'Letterbox padding must not be editable'
assert 'condition_image' not in captured
assert captured['strength']==1.0
assert prompts==['model is wearing an upper body garment','a photo of an upper body garment']
prompts.clear()
mask.paste(0,(0,0,37,120))
generate(Pipe(),image,image,mask,image,'overall',call,garment_description='a green knee-length A-line dress',garment_negative_description='trousers, layered skirt',width=64,height=128)
assert prompts==['model is wearing a green knee-length A-line dress','a photo of a green knee-length A-line dress']
assert negatives[-2]=='monochrome, lowres, bad anatomy, worst quality, low quality, trousers, layered skirt'
assert set(np.asarray(captured['mask_image']).ravel().tolist())=={0,255}, 'Binary edit masks must stay binary after resizing'
for invalid in ['', 'x'*401, 123]:
    try:
        generate(Pipe(),image,image,mask,image,'overall',call,garment_description=invalid,width=64,height=128)
        raise AssertionError('Invalid description must fail')
    except ValueError:
        pass

tree=ast.parse((root/'ai_service.py').read_text(encoding='utf-8'))
loader=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='load_tryon_pipe')
released=[]
scope={'tryon_pipe':object(),'tryon_pipe_model_id':'catvton'}
def release():
    released.append(True)
    scope['tryon_pipe']=None
scope.update(release_tryon=release,DENSEPOSE_SCRIPT=SimpleNamespace(is_file=lambda:False))
exec(compile(ast.Module(body=[loader],type_ignores=[]),'<loader>','exec'),scope)
assert scope['load_tryon_pipe']('catvton') is scope['tryon_pipe']
try:
    scope['load_tryon_pipe']('idm-vton')
    raise AssertionError('Missing DensePose must fail, never run CatVTON')
except RuntimeError:
    pass
assert released
try:
    scope['load_tryon_pipe']('unknown')
    raise AssertionError('Unknown models must fail')
except ValueError:
    pass
print('OK: IDM tensors, prompt embeddings, model cache switch and fail-closed routing.')
