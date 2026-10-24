"""The denoising loop must release its previous UNet before the garment pass."""
import sys
from pathlib import Path
from types import SimpleNamespace
import torch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from idm_vton_runtime import limit_denoising_residency

events=[]
class Encoder(torch.nn.Module):
    def forward(self,value):events.append('encoder');return value+1
unet=object();encoder=Encoder()
hook=SimpleNamespace(model=unet,offload=lambda:events.append('unet-offload'))
pipe=SimpleNamespace(unet=unet,unet_encoder=encoder,_all_hooks=[hook])
assert limit_denoising_residency(pipe)
assert limit_denoising_residency(pipe)  # repeated setup must not stack hooks
for _ in range(2):assert encoder(torch.tensor(4)).item()==5
assert events==['unet-offload','encoder','unet-offload','encoder']
assert not limit_denoising_residency(SimpleNamespace(unet=object(),unet_encoder=Encoder()))
print('OK: each garment pass first offloads the previous UNet; hooks remain idempotent and optional on CPU.')
