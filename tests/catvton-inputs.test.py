from helpers.ai_source import read_source
"""Edge markers survive model preparation; the mask shares the same full frame."""
import ast
import sys
from pathlib import Path
import numpy as np
from PIL import Image

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
from catvton_inputs import prepare_inputs
from tryon_geometry import fit_geometry
source=Image.new('RGB',(1024,1536),'black')
source.paste((255,0,0),(0,0,32,1536))
source.paste((0,255,0),(992,0,1024,1536))
mask=Image.new('L',source.size,0)
mask.paste(255,(0,0,32,1536))
image,prepared=prepare_inputs(source,mask,(320,512))
assert image.size==prepared.size==(320,512)
assert image.getpixel((0,256))==(255,0,0)
assert image.getpixel((319,256))==(0,255,0)
assert prepared.getpixel((0,256))==255
assert set(np.unique(np.asarray(prepared)))=={0,255}
geometry=fit_geometry(source.size,(320,512))
restored=prepared.crop(tuple(geometry['contentBox'])).resize(source.size,Image.Resampling.NEAREST)
assert restored.getbbox()==mask.getbbox()
try:prepare_inputs(source,Image.new('L',(1,1)),(320,512))
except ValueError:pass
else:raise AssertionError('Mismatched image and mask must fail')
tree=ast.parse(read_source(root/'ai_service.py', encoding='utf-8'))
candidate=next(node for node in ast.walk(tree) if isinstance(node,ast.FunctionDef) and node.name=='generate_candidate')
assert any(isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='prepare_inputs' for node in ast.walk(candidate))
print('OK: full-frame image/mask geometry preserves edge markers and binary mask alignment.')
