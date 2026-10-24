"""Material masks, bounded source finishing and protection regressions."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from outpainting import material_detail_masks,finish_materials

geometry=dict(left=30,top=0,right=0,bottom=20,sourceWidth=100,sourceHeight=100,preserveOriginal=False)
shape=(120,130)
fg=np.zeros(shape,dtype=np.uint8);fg[50:]=255
garment=fg.copy();protected=np.zeros(shape,dtype=np.uint8);protected[:,60:70]=255
foreground,cloth,locked=map(Image.fromarray,(fg,garment,protected))
masks=material_detail_masks(geometry,foreground,cloth,locked)
for label in masks.values():
    values=np.asarray(label)
    assert not values[:100,30:].any()
    assert not values[:,60:70].any()
assert np.asarray(masks['garment'])[105:,35:55].all()
assert np.asarray(masks['background'])[10:40,5:25].all()

rng=np.random.default_rng(12)
rgb=np.clip(150+rng.normal(0,4,(*shape,3)),0,255).astype(np.uint8)
rgb[50:,:,0]=np.where(np.indices(shape)[1][50:]%4<2,110,190)
image=Image.fromarray(rgb)
finished=np.asarray(finish_materials(image,foreground,cloth,locked,geometry,True))
assert np.array_equal(finished[protected>0],rgb[protected>0])
assert np.max(np.abs(finished.astype(int)-rgb.astype(int)))<=6
assert np.any(finished[70:90,80:100]!=rgb[70:90,80:100]), 'source fabric should receive bounded detail'
assert np.std(finished[10:40,80:100])<np.std(rgb[10:40,80:100]), 'background noise should decrease'
for enhance,preserve in [(False,False),(True,True)]:
    result=np.asarray(finish_materials(image,foreground,cloth,locked,{**geometry,'preserveOriginal':preserve},enhance))
    assert np.array_equal(result[:100,30:],rgb[:100,30:])
unknown=Image.new('L',image.size,128)
assert np.array_equal(np.asarray(finish_materials(image,unknown,cloth,locked,geometry,True)),rgb)
print('OK: generated material masks exclude source; finishing is bounded, label-aware and protected.')
