"""Real regressions: read/write seam permissions, dense tiles and quality fallback."""
import json
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from PIL import Image, ImageFilter

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from outpainting import (prepare_canvas,prepare_inference,semantic_seam_masks,background_reference_mask,
                        equalize_background_seams,detail_regions,PatchAccumulator)
from outpaint_quality import (choose_refinement,exclude_source,tile_mask,load_layout,source_fingerprint,PromptEmbeddingCache)

for left,top,right,bottom in [(60,0,0,0),(0,60,0,0),(0,0,60,0),(0,0,0,60)]:
    source=Image.new('RGB',(120,120),(160,160,160))
    canvas,_,g=prepare_canvas(source,dict(width=120+left+right,height=120+top+bottom,left=left,top=top,preserveOriginal=True))
    fg=Image.new('L',source.size,0)
    masks=semantic_seam_masks(g,48,fg,fg,fg)
    reference=background_reference_mask(g,fg,fg)
    p=np.asarray(canvas).copy()
    if left:p[:,47:58]=120
    if top:p[47:58]=120
    if right:p[:,122:133]=120
    if bottom:p[122:133]=120
    before=Image.fromarray(p)
    after=equalize_background_seams(before,g,masks['background'],40,reference)
    out=np.asarray(after)
    assert np.array_equal(out[top:top+120,left:left+120],np.asarray(source))
    dark=(p[:,:,0]==120)
    assert out[dark].mean()>150, 'one-sided repair must use source as a readable reference'
    assert np.array_equal(out[np.asarray(masks['background'])==0],p[np.asarray(masks['background'])==0])
    chosen,check=choose_refinement(before,after,g,masks['background'],stage='seam')
    assert check['accepted'],check

# Reference labels must never interpolate across an intervening object.
g=dict(width=180,height=120,left=60,top=0,right=0,bottom=0,sourceWidth=120,sourceHeight=120,preserveOriginal=True)
reference=Image.new('L',(180,120),255);reference.paste(0,(70,0,75,120))
mask=Image.new('L',(180,120),0);mask.paste(255,(20,0,60,120))
bad=Image.new('RGB',(180,120),(160,160,160));bad.paste((120,120,120),(47,0,58,120))
assert np.array_equal(np.asarray(equalize_background_seams(bad,g,mask,40,reference)),np.asarray(bad))

# Aspect ratio and model budget, including extreme banners and tiny sources.
for size in [(1529,2044),(4096,768),(64,8192),(127,81),(1,2048)]:
    image=Image.new('RGB',size);m=Image.new('L',size,255)
    result,mm,crop=prepare_inference(image,m,1024)
    assert result.size==mm.size and result.width*result.height<=1024**2
    assert all(v%64==0 for v in result.size)
    assert max(result.size)<=1536
    assert crop[2]>crop[0] and crop[3]>crop[1]
    if min(size)>64:
        assert abs((crop[2]-crop[0])/(crop[3]-crop[1])-size[0]/size[1])<.015
image=Image.new('RGB',(1529,2044));m=Image.new('L',image.size,255)
_,_,crop=prepare_inference(image,m,1024)
assert (crop[2]-crop[0])*(crop[3]-crop[1])>766*1024

# Fully generated distant windows retain context and the complete expansion is covered.
source=Image.new('RGB',(256,256),'gray')
base,mask,g=prepare_canvas(source,dict(width=2304,height=1024,left=1024,top=384))
mask=exclude_source(mask,g)
coverage=np.zeros((base.height,base.width),dtype=bool)
acc=PatchAccumulator(base)
for box in detail_regions(mask,512,include_generated=True):
    local=tile_mask(mask,box,base.size)
    l,t,r,b=box
    coverage[t:b,l:r]|=np.asarray(local)>0
    if np.asarray(mask.crop(box)).min()==255:assert np.asarray(local).min()==0
    acc.add(Image.new('RGB',(r-l,b-t),'silver'),box,local)
assert coverage[np.asarray(mask)>0].all(), 'no holes in far expansion coverage'
assert not coverage[384:640,1024:1280].any()
assert np.array_equal(np.asarray(acc.finish())[384:640,1024:1280],np.asarray(source))

# Gate rejects broken seams, detail erasure, structural drift and protected changes.
source=Image.new('RGB',(80,100),(128,128,128))
base,mask,g=prepare_canvas(source,dict(width=160,height=100,left=80,overlap=0))
mask=exclude_source(mask,g)
candidate=base.copy();candidate.paste((20,20,20),(79,0,80,100))
chosen,check=choose_refinement(base,candidate,g,mask)
assert not check['accepted'] and 'boundary-left' in check['reasons']
assert np.array_equal(np.asarray(chosen),np.asarray(base))
candidate=base.copy();candidate.putpixel((120,20),(0,0,0))
_,check=choose_refinement(base,candidate,g,Image.new('L',base.size,255))
assert not check['accepted'] and check['scopeErrorPixels']==1
candidate=base.copy();candidate.paste((220,220,220),(0,0,65,100))
assert not choose_refinement(base,candidate,g,mask)[1]['accepted']
texture=np.asarray(base).copy();texture[:,:64]=np.where(np.indices((100,64))[1][...,None]%4<2,100,156)
textured=Image.fromarray(texture)
blurred=textured.filter(ImageFilter.GaussianBlur(3));blurred.paste(source,(80,0))
assert 'detail-loss' in choose_refinement(textured,blurred,g,mask)[1]['reasons']
candidate=base.copy();candidate.paste((130,130,130),(0,0,60,100))
assert choose_refinement(base,candidate,g,mask)[1]['accepted']

with tempfile.TemporaryDirectory() as folder:
    root=Path(folder);outputs=root/'workspace/outputs';directory=outputs/'outpaint_layout';directory.mkdir(parents=True)
    base.save(directory/'overview_seed_0.png')
    meta=dict(taskType='outpaint',source='test.png',sourceFingerprint=source_fingerprint(source),geometry=g,results=[dict(seed=0)])
    (directory/'metadata.json').write_text(json.dumps(meta),encoding='utf-8')
    reference=dict(directory='workspace/outputs/outpaint_layout',seed=0)
    restored,_=load_layout(root,outputs,reference,'test.png',source,g)
    assert np.array_equal(np.asarray(restored),np.asarray(base))
    for ref,src,geometry in [(dict(directory='../outside',seed=0),source,g),
                             (dict(reference,seed=True),source,g),(dict(reference,seed=1),source,g),
                             (reference,Image.new('RGB',source.size,'red'),g),
                             (reference,source,{**g,'left':40})]:
        try:load_layout(root,outputs,ref,'test.png',src,geometry)
        except ValueError:pass
        else:raise AssertionError('invalid layout accepted')

class Tensor:
    def detach(self):return self
    def cpu(self):return self
    def to(self,device):return self
class FluxFillPipeline:
    _execution_device='cpu'
    def __init__(self):self.calls=[]
    def encode_prompt(self,**kw):self.calls.append(kw);return Tensor(),Tensor(),None
pipe=FluxFillPipeline();cache=PromptEmbeddingCache(pipe)
for text in ['same','same','different']:
    cached=cache.apply(dict(prompt=text,prompt_2=text,width=512))
    assert 'prompt' not in cached and 'prompt_embeds' in cached and cached['width']==512
assert cache.hits==1 and cache.misses==2 and len(pipe.calls)==2
print('OK: strict preservation seam repair in four directions; rectangular budget; full detail coverage; rollback; saved-layout validation; prompt cache.')
