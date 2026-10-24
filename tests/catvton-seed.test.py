"""VAE sampling must use the request generator, independently of global RNG."""
import ast
from pathlib import Path
from types import SimpleNamespace
import torch

root=Path(__file__).resolve().parents[1]
tree=ast.parse((root/'vendor/CatVTON/utils.py').read_text(encoding='utf-8'))
node=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='compute_vae_encodings')
scope={'torch':torch}
exec(compile(ast.Module(body=[node],type_ignores=[]),'<vae>','exec'),scope)
class Distribution:
    def sample(self,generator=None):
        return torch.randn((1,4,4,4),generator=generator)
vae=SimpleNamespace(device='cpu',dtype=torch.float32,config=SimpleNamespace(scaling_factor=.18215),encode=lambda image:SimpleNamespace(latent_dist=Distribution()))
def encode(seed,global_seed):
    torch.manual_seed(global_seed)
    return scope['compute_vae_encodings'](torch.zeros((1,3,8,8)),vae,generator=torch.Generator().manual_seed(seed))
assert torch.equal(encode(42,1),encode(42,999))
assert not torch.equal(encode(42,1),encode(43,1))
pipeline=ast.parse((root/'vendor/CatVTON/model/pipeline.py').read_text(encoding='utf-8'))
calls=[node for node in ast.walk(pipeline) if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='compute_vae_encodings']
assert len(calls)==4
assert all(any(item.arg=='generator' and ast.unparse(item.value)=='generator' for item in call.keywords) for call in calls)
print('OK: both CatVTON pipelines use the request seed for VAE sampling, unaffected by global RNG.')
