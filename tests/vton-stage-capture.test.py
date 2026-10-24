import importlib.util
from pathlib import Path
from types import SimpleNamespace
from PIL import Image

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('benchmark',root/'scripts/benchmark-real-vton.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
image=Image.new('RGB',(20,30),'red')
for output in ([image],([image],),([image],None),SimpleNamespace(images=[image])):
    assert m.first_generated_image(output) is image
for output in ([],None,([None],)):
    try:m.first_generated_image(output)
    except ValueError:pass
    else:raise AssertionError('Invalid pipeline output accepted')
print('OK: raw stage capture handles both CatVTON and IDM pipeline return structures.')
