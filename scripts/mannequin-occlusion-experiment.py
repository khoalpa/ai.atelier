"""Independent synthetic object-occlusion experiment; no human source images."""
import base64
import io
import json
from pathlib import Path
import urllib.request
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT))
from prompt_catalog import prompt_text
OUT = ROOT / 'workspace/review/mannequin-occlusion'
OUT.mkdir(parents=True, exist_ok=True)
source_dir = ROOT / 'workspace/uploads/mannequin-occlusion'
source_dir.mkdir(parents=True, exist_ok=True)
size = (512, 768)
clean = Image.new('RGB', size, '#c9c4bb')
d = ImageDraw.Draw(clean)
d.ellipse((120, 709, 395, 739), fill='#99958f')
plastic = '#e5e4df'
d.rounded_rectangle((205, 419, 250, 713), radius=20, fill=plastic)
d.rounded_rectangle((267, 419, 312, 713), radius=20, fill=plastic)
d.rounded_rectangle((141, 224, 180, 475), radius=19, fill=plastic)
d.rounded_rectangle((337, 224, 376, 475), radius=19, fill=plastic)
d.polygon([(192, 214), (224, 201), (291, 201), (325, 215), (316, 290), (299, 352), (320, 437), (299, 466), (214, 466), (193, 437), (213, 352), (197, 290)], fill=plastic)
d.rounded_rectangle((236, 164, 279, 224), radius=12, fill=plastic)
d.ellipse((212, 67, 303, 185), fill=plastic)
clean.save(OUT / 'ground-truth.png')
source = clean.copy()
ImageDraw.Draw(source).rectangle((177, 275, 339, 354), fill='#2356b6')
source.save(source_dir / 'source.png')
source.save(OUT / 'source.png')
mask = Image.new('L', size)
ImageDraw.Draw(mask).rectangle((173, 271, 343, 358), fill=255)
mask.save(OUT / 'mask.png')
buf = io.BytesIO()
mask.save(buf, format='PNG')
body = dict(jobId='mannequin-occlusion-experiment', sampleId='uploads/mannequin-occlusion/source.png',
    editableMask='data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode(),
    removalTarget='custom', fillMode='background', modelId='sdxl-inpaint-base-0.1',
    prompt=prompt_text("mannequinExperiment.prompt"),
    negativePrompt=prompt_text("mannequinExperiment.negativePrompt"),
    count=4, seed=27180, strength=1.0, steps=24, guidance=5, maxSide=768,
    expand=8, blur=4, edgeFeather=4, autoRetry=False, useModelProfile=False)
(OUT / 'request.json').write_text(json.dumps(body, indent=2), encoding='utf-8')
try:
    request = urllib.request.Request('http://127.0.0.1:7861/inpaint', data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=3600) as response:
        result = json.load(response)
    (OUT / 'response.json').write_text(json.dumps(result), encoding='utf-8')
    variants = result.get('results', [])
    board = Image.new('RGB', (512 * 3, 800 * 2), 'white')
    for i, (label, im) in enumerate([('Ground truth', clean), ('Occluded input', source)] + [(f'Variant {i+1}', Image.open(io.BytesIO(base64.b64decode(v['image'].split(',')[-1]))).convert('RGB')) for i, v in enumerate(variants)]):
        x, y = (i % 3) * 512, (i // 3) * 800
        board.paste(im.resize(size), (x, y + 28))
        ImageDraw.Draw(board).text((x + 12, y + 8), label, fill='black')
    board.save(OUT / 'comparison.jpg')
    print(json.dumps({'ok': True, 'variants': len(variants), 'output': str(OUT)}, ensure_ascii=False))
except Exception as error:
    (OUT / 'error.txt').write_text(str(error), encoding='utf-8')
    raise
