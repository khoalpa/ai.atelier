"""Background donor matching preserves the source and rejects unsafe donors."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from outpainting import prepare_canvas,continue_background_texture

rng=np.random.default_rng(427)
source=Image.fromarray(rng.integers(105,160,(220,240,3),dtype=np.uint8))
for side in ('left','right','top','bottom'):
    body=dict(width=source.width+(32 if side in ('left','right') else 0),
              height=source.height+(32 if side in ('top','bottom') else 0),
              left=32 if side=='left' else 0,top=32 if side=='top' else 0)
    candidate,mask,g=prepare_canvas(source,body)
    values=np.asarray(candidate).copy();values[np.asarray(mask)>0]=[110,110,110];candidate=Image.fromarray(values)
    source_fg=Image.new('L',source.size);result_fg=Image.new('L',candidate.size)
    out,info=continue_background_texture(source,candidate,g,source_fg,result_fg)
    assert info['applied'] and info['side']==side
    core=(g['left'],g['top'],g['left']+source.width,g['top']+source.height)
    assert np.array_equal(np.array(out.crop(core)),np.array(source))
    new=np.array(out)[np.array(mask)>0]
    assert new.std()>5, 'donor must provide two-dimensional texture, not a stretched constant column'
    for a,b in [(Image.new('L',source.size,255),result_fg),(source_fg,Image.new('L',candidate.size,255)),(None,result_fg)]:
        untouched,report=continue_background_texture(source,candidate,g,a,b)
        assert not report['applied'] and np.array_equal(np.array(untouched),np.array(candidate))
    _,report=continue_background_texture(source,candidate,{**g,'preserveOriginal':False},source_fg,result_fg)
    assert not report['applied']
print('OK: four directions, exact original, actual texture, uncertain foreground/donor rejection.')
