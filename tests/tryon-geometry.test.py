"""Contain geometry preserves ratios, aligned masks and immutable exterior."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tryon_geometry import fit_geometry,fit_image,restore_image,inward_blend

for size in [(400,200),(200,400),(384,512),(120,120)]:
    image=Image.new('RGB',size,'white')
    mask=Image.new('L',size)
    box=(size[0]//4,size[1]//4,size[0]*3//4,size[1]*3//4)
    ImageDraw.Draw(image).rectangle(box,fill='red')
    ImageDraw.Draw(mask).rectangle(box,fill=255)
    geometry=fit_geometry(size,(384,512))
    fitted=fit_image(image,geometry)
    fitted_mask=fit_image(mask,geometry,mask=True)
    left,top,right,bottom=geometry['contentBox']
    assert abs((right-left)/(bottom-top)-size[0]/size[1])<.01
    assert set(np.unique(fitted_mask))<={0,255}
    assert not np.asarray(fitted_mask)[:top].any()
    restored=restore_image(fitted,geometry)
    assert restored.size==size
    assert restored.getpixel((size[0]//2,size[1]//2))[0]>245
    source=np.asarray(image)
    output=np.asarray(Image.composite(Image.new('RGB',size,'blue'),image,inward_blend(mask,5)))
    assert np.array_equal(source[np.asarray(mask)==0],output[np.asarray(mask)==0])
print('OK: portrait, landscape and square geometry, binary mask padding, reverse mapping and exact exterior pixels.')
