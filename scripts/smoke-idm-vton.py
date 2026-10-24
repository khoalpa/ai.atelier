"""Optional real local inference; run with .venv-sam2/Scripts/python.exe."""
import sys
import argparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import torch
from PIL import Image
from idm_vton_runtime import load_pipeline, densepose_image, generate

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--width', type=int, default=384)
parser.add_argument('--height', type=int, default=512)
args = parser.parse_args()
source = Image.open(root / 'samples/characters/c001.png').convert('RGB')
mask = Image.new('L', source.size, 0)
mask.paste(255, (int(source.width*.25), int(source.height*.2), int(source.width*.75), int(source.height*.6)))
garment = source.crop(mask.getbbox())
pose = densepose_image(source, root / 'models/pose/densepose/densepose_r50_fpn_dl_fixed.torchscript')
print('DensePose ready', flush=True)
pipe = load_pipeline(root / 'models/tryon/IDM-VTON', root / 'vendor/IDM-VTON', 'cuda')
print('Pipeline ready', flush=True)
result = generate(pipe, source, garment, mask, pose, 'upper_body', lambda p, **kw: p(**kw),
                  width=args.width, height=args.height, num_inference_steps=2, guidance_scale=2.0,
                  generator=torch.Generator('cuda').manual_seed(42))
result.save(root / 'workspace/idm-vton-smoke.png')
print('IDM-VTON inference OK', result.size, flush=True)
