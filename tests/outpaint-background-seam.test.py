"""Regression: remove a dark background band without touching fabric or source core."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from outpainting import equalize_background_seams

pixels=np.full((120,180,3),160,dtype=np.uint8)
pixels[:,47:58]=120
mask=np.zeros((120,180),dtype=np.uint8)
mask[:80,20:100]=255
geometry=dict(left=60,top=0,right=0,bottom=0,sourceWidth=120,sourceHeight=120,preserveOriginal=False)
result=np.asarray(equalize_background_seams(Image.fromarray(pixels),geometry,Image.fromarray(mask),32))
assert result[20:60,50:55].mean()>150
assert np.array_equal(result[mask==0],pixels[mask==0])
assert np.array_equal(result[:,100:],pixels[:,100:])
geometry['preserveOriginal']=True
result=np.asarray(equalize_background_seams(Image.fromarray(pixels),geometry,Image.fromarray(mask),32))
assert np.array_equal(result[:,60:],pixels[:,60:])
# A non-background endpoint must prevent interpolation across a silhouette.
mask[:,28]=0
result=np.asarray(equalize_background_seams(Image.fromarray(pixels),geometry,Image.fromarray(mask),32))
assert np.array_equal(result,pixels)
print('OK: dark band removed; subject, source core and preservation boundaries retained.')
