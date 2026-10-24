"""Pixel-level quality and abstention checks, independent of AI weights."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from object_removal import match_simple_background, blend_removal
from outpaint_quality import final_seam_review, choose_refinement

yy,xx=np.mgrid[:180,:240]
mask=Image.new('L',(240,180));mask.paste(255,(85,65,130,105))
selected=np.asarray(mask)>0
for kind in ('flat','gradient','horizontal','vertical','noise'):
    clean=np.full((180,240,3),170.,dtype=np.float32)
    if kind=='gradient':clean+=(xx*.1+yy*.1)[...,None]
    if kind=='horizontal':clean[yy%17<2]-=45
    if kind=='vertical':clean[xx%17<2]-=45
    if kind=='noise':clean+=np.random.default_rng(7).uniform(-30,30,clean.shape)
    clean=clean.astype(np.uint8);source=clean.copy();source[selected]=[200,0,0]
    generated=clean.copy();generated[selected]=230
    result,report=match_simple_background(Image.fromarray(source),Image.fromarray(generated),mask)
    if kind=='noise':assert not report['applied'] and np.array_equal(result,generated)
    else:
        assert report['applied'],(kind,report)
        assert np.abs(np.asarray(result).astype(float)-clean)[selected].max()<=1,kind
    assert np.array_equal(np.asarray(result)[~selected],generated[~selected])
    locked=Image.new('L',mask.size);locked.putpixel((100,80),255)
    assert not match_simple_background(Image.fromarray(source),Image.fromarray(generated),mask,locked)[1]['applied']
    edge=Image.new('L',mask.size);edge.paste(255,(0,20,30,70))
    assert not match_simple_background(Image.fromarray(source),Image.fromarray(generated),edge)[1]['applied']

for side in ('left','right','top','bottom'):
    g=dict(left=40 if side=='left' else 0,top=40 if side=='top' else 0,
           right=40 if side=='right' else 0,bottom=40 if side=='bottom' else 0,sourceWidth=120,sourceHeight=120)
    width=120+g['left']+g['right'];height=120+g['top']+g['bottom']
    yy,xx=np.mgrid[:height,:width];pixels=np.repeat((100+xx*.2+yy*.2)[...,None],3,axis=2).astype('uint8')
    good=final_seam_review(Image.fromarray(pixels),g);assert good['status']=='unverified',(side,good)
    bad=pixels.copy();outside=np.ones((height,width),bool);outside[g['top']:g['top']+120,g['left']:g['left']+120]=False
    bad[outside]=[40,40,80]
    assert final_seam_review(Image.fromarray(bad),g)['status']=='needs-review'

# A perfect one-pixel join must not hide a stretched photographic texture.
rng=np.random.default_rng(19)
texture=rng.integers(120,180,(128,160,3),dtype=np.uint8)
image=np.concatenate([np.repeat(texture[:,:1],64,axis=1),texture],axis=1)
g=dict(left=64,top=0,right=0,bottom=0,sourceWidth=160,sourceHeight=128)
check=final_seam_review(Image.fromarray(image),g)
assert check['sides']['left']['boundaryMAE']==0
assert 'stretched-detail' in check['sides']['left']['reasons']
baseline=np.concatenate([texture[:,:64][:,::-1],texture],axis=1)
editable=Image.new('L',(224,128));editable.paste(255,(0,0,64,128))
chosen,guard=choose_refinement(Image.fromarray(baseline),Image.fromarray(image),{**g,'preserveOriginal':True},editable,stage='seam')
assert not guard['accepted'] and 'stretched-detail-left' in guard['reasons']
assert np.array_equal(chosen,baseline)
print('OK: flat/gradient/parallel backgrounds, noisy abstention, protected holes, borders, and four seam orientations.')
