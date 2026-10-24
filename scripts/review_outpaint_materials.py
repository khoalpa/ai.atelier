"""Independent pixel checks and before/after crops for a material-refinement run."""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageOps

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('directory',type=Path)
parser.add_argument('baseline',type=Path)
args=parser.parse_args()
directory=args.directory.resolve()
metadata=json.loads((directory/'metadata.json').read_text(encoding='utf-8'))
seed=metadata['seed'];g=metadata['geometry'];x,y=g['left'],g['top']
box=(x,y,x+g['sourceWidth'],y+g['sourceHeight'])
baseline=Image.open(args.baseline).convert('RGB')
result=Image.open(directory/f'result_seed_{seed}.png').convert('RGB')
before=Image.open(directory/f'before_finish_seed_{seed}.png').convert('RGB')
source=ImageOps.exif_transpose(Image.open(ROOT/'workspace'/metadata['source'])).convert('RGB')
cloth=np.asarray(Image.open(directory/f'material_garment_seed_{seed}.png'))>0
protected=np.asarray(Image.open(directory/f'material_protected_seed_{seed}.png'))>0
a,b,c=map(np.asarray,(baseline,result,before))
inside=np.zeros(cloth.shape,dtype=bool);inside[y:box[3],x:box[2]]=True
source_locked=protected[y:box[3],x:box[2]]
checks=dict(sizeUnchanged=result.size==baseline.size,
    generationExcludesSource=not cloth[inside].any(),
    sourceProtectedExact=np.array_equal(np.asarray(result.crop(box))[source_locked],np.asarray(source)[source_locked]),
    externalProtectedExact=np.array_equal(b[protected&~inside],a[protected&~inside]),
    generationLimitedToFabric=np.array_equal(c[~inside&~cloth],a[~inside&~cloth]),
    sourceNotRegenerated=np.array_equal(c[inside&~protected],a[inside&~protected]),
    finishingPreservesProtected=np.array_equal(b[protected],c[protected]),
    finishingBounded=int(np.abs(b.astype(np.int16)-c.astype(np.int16)).max())<=6)
assert all(checks.values()),checks
report=dict(directory=str(directory),baseline=str(args.baseline.resolve()),checks=checks,
            fabricRegions=metadata['materialVariants'][0]['fabricRegions'],warnings=metadata['semanticWarnings'],
            diagnostics=metadata['results'][0]['diagnostics'],
            note='Pixel checks verify scope and preservation, not visual quality or exact motif reconstruction.')
review=ROOT/'workspace/review';review.mkdir(exist_ok=True)
(review/'outpaint-materials-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',23)
canvas=Image.new('RGB',(1280,1190),'#101923');draw=ImageDraw.Draw(canvas)
draw.text((20,10),'Trước',fill='white',font=font);draw.text((660,10),'Sau',fill='white',font=font)
regions=[('Vải ảnh gốc',(550,1100,1150,1600)),
         ('Vải mở rộng bên trái',(0,1140,330,1740)),
         ('Vải mở rộng phía dưới',(250,1790,1000,2044))]
for row,(label,crop) in enumerate(regions):
    top=50+row*380
    draw.text((20,top),label,fill='#ffd080',font=font)
    for column,image in enumerate((baseline,result)):
        tile=ImageOps.contain(image.crop(crop),(620,330))
        canvas.paste(tile,(column*640+10+(620-tile.width)//2,top+35))
canvas.save(review/'outpaint-materials-comparison.png')
print(json.dumps(report,ensure_ascii=False,indent=2))
