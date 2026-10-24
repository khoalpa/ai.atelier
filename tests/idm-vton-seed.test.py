"""Exercise IDM's actual pose VAE path, independent of global RNG history."""
import ast
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import torch

path=Path(__file__).resolve().parents[1]/'vendor/IDM-VTON/src/tryon_pipeline.py'
tree=ast.parse(path.read_text(encoding='utf-8'))
cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='StableDiffusionXLInpaintPipeline')
encode=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='_encode_vae_image')
retrieve=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='retrieve_latents')
scope={'torch':torch,'Optional':Optional}
exec(compile(ast.Module(body=[retrieve,encode],type_ignores=[]),'<idm-seed>','exec'),scope)
class VAE:
    config=SimpleNamespace(force_upcast=False,scaling_factor=.18215)
    def encode(self,image):
        return SimpleNamespace(latent_dist=SimpleNamespace(sample=lambda generator=None:torch.randn(image.shape,generator=generator)))
pipe=SimpleNamespace(vae=VAE())
pipe._encode_vae_image=lambda image,generator:scope['_encode_vae_image'](pipe,image,generator)
call=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='__call__')
pose_assignments=[n for n in ast.walk(call) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='pose_img' for t in n.targets)]
pose_encode=next(n for n in pose_assignments if isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Attribute) and n.value.func.attr=='_encode_vae_image')
fragment=compile(ast.Module(body=[pose_encode],type_ignores=[]),'<actual-pose-path>','exec')
def run(seed,batch=False):
    generators=[torch.Generator().manual_seed(seed+i) for i in range(2)] if batch else torch.Generator().manual_seed(seed)
    ns={'self':pipe,'pose_img':torch.zeros(2 if batch else 1,4,8,6),'generator':generators}
    exec(fragment,ns);return ns['pose_img']
a=run(42);torch.manual_seed(912);torch.randn(1000);b=run(42)
assert torch.equal(a,b)
assert not torch.equal(a,run(43))
assert torch.equal(run(42,True)[0],a[0])
assert not any(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='sample' and not n.keywords for n in ast.walk(call)), 'Unseeded sampling returned to inference'
print('OK: actual IDM pose encoding repeats its seed, changes with another seed, and supports per-image generators.')
