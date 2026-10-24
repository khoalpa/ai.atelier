"""Combine reviewed pilots at native resolution, retaining every historical split.

Rebuild smaller person canvases from original photos and original-size masks.
The resulting manifest is pending visual review; no identities are inferred.
"""
import argparse
import copy
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vton_pilot import file_hash


def pixel_hash(path):
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image).convert('RGB')
        return hashlib.sha256(str(image.size).encode() + image.tobytes()).hexdigest()


def collect_sources(roots):
    records, products = [], []
    ids, product_ids, product_pixels, person_pixels = set(), set(), set(), set()
    for root in roots:
        catalog = json.loads((root/'products.json').read_text(encoding='utf-8'))
        by_id = {p['id']: p for p in catalog}
        for product in catalog:
            if not isinstance(product.get('id'),str) or re.fullmatch(r'[a-z0-9][a-z0-9_-]{2,63}',product['id']) is None:
                raise ValueError('Product IDs must be safe filename components')
            source = Path(product['source'])
            if file_hash(source) != product['sourceSha256']:
                raise ValueError('Original product changed after intake')
            pixels = pixel_hash(source)
            if product['id'] in product_ids or pixels in product_pixels:
                raise ValueError('Duplicate product across source datasets')
            product_ids.add(product['id']); product_pixels.add(pixels)
            products.append(copy.deepcopy(product))
        for line in (root/'manifest.jsonl').read_text(encoding='utf-8').splitlines():
            row = json.loads(line)
            if any(not isinstance(row.get(field),str) or re.fullmatch(r'[a-z0-9][a-z0-9_-]{2,63}',row[field]) is None
                   for field in ('id','productId')):
                raise ValueError('Record and product IDs must be safe filename components')
            if row['id'] in ids:
                raise ValueError('Duplicate record across source datasets')
            if row['quality']['maskReview'] != 'accepted_for_pilot':
                raise ValueError('Source masks must be visually reviewed')
            if row['split'] != by_id[row['productId']]['split']:
                raise ValueError('Historical product split disagrees with record')
            for field in ('productImage', 'personImage', 'maskImage'):
                if not isinstance(row[field],str) or Path(row[field]).is_absolute() or '..' in Path(row[field]).parts:
                    raise ValueError('Prepared paths must be relative to the dataset')
                path = (root/row[field]).resolve()
                if not path.is_relative_to(root.resolve()) or file_hash(path) != row['preparedHashes'][field]:
                    raise ValueError('Prepared source changed after review')
            source = Path(row['sourcePersonImage'])
            if file_hash(source) != row['sourceSha256']:
                raise ValueError('Original person image changed after intake')
            pixels = pixel_hash(source)
            if pixels in person_pixels:
                raise ValueError('Duplicate person photograph across source datasets')
            ids.add(row['id']); person_pixels.add(pixels)
            records.append((root, copy.deepcopy(row)))
    return records, products


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--datasets', type=Path, nargs='+', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    roots = [p.resolve() for p in args.datasets]
    records, products = collect_sources(roots)
    out = args.output.resolve()
    if any(out == root or out.is_relative_to(root) for root in roots):
        raise ValueError('Combined output must be separate from the source datasets')
    out.mkdir(parents=True, exist_ok=False)
    for name in ('products', 'people', 'masks', 'raw-masks', 'previews'):
        (out/name).mkdir()
    import cv2
    import numpy as np
    import ai_service as ai
    from catvton_inputs import prepare_inputs
    rows = []
    for root, row in records:
        raw = root/'raw-masks'/f'{row["id"]}.png'
        row['sourceRawMaskSha256'] = file_hash(raw)
        with Image.open(root/row['personImage']) as existing:
            native = existing.size == (768, 1024)
        if native:
            for field in ('personImage', 'maskImage'):
                shutil.copy2(root/row[field], out/row[field])
        else:
            person = ImageOps.exif_transpose(Image.open(row['sourcePersonImage'])).convert('RGB')
            mask = Image.open(raw).convert('L')
            if mask.size != person.size:
                raise ValueError('Original-size mask and source photo disagree')
            poses = ai.detect_people_pose(person)
            if len(poses) != 1:
                raise ValueError('Expected one person while rebuilding native canvas')
            pose = poses[0]
            radius = max(7, round(min(person.size)*.018)) | 1
            binary = cv2.dilate(np.array(mask), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius,radius)))
            protection = np.array(ai.automatic_protected_detail_mask(person,pose['box'],pose['keypoints']))
            binary[protection > 0] = 0
            image, fitted = prepare_inputs(person, Image.fromarray(binary), (768,1024))
            image.save(out/row['personImage']); fitted.save(out/row['maskImage'])
        shutil.copy2(raw, out/'raw-masks'/raw.name)
        shutil.copy2(root/row['productImage'], out/row['productImage'])
        row['cohort'] = Path(row['sourcePersonImage']).parent.name
        row['sourceDatasetManifestSha256'] = file_hash(root/'manifest.jsonl')
        row['quality']['previousMaskReview'] = row['quality']['maskReview']
        row['quality']['maskReview'] = 'pending'
        row.pop('preparedHashes', None)
        person = Image.open(out/row['personImage']).convert('RGB')
        mask = Image.open(out/row['maskImage']).convert('L')
        Image.composite(Image.new('RGB', person.size, '#999999'), person, mask).save(out/'previews'/f'{row["id"]}.jpg', quality=92)
        rows.append(row)
    (out/'manifest.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows),encoding='utf-8')
    (out/'products.json').write_text(json.dumps(products,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    status = {'pairs':len(rows),'products':len(products),'resolution':[768,1024],
        'splits':{s:sum(r['split']==s for r in rows) for s in ('train','validation')},
        'cohorts':{c:sum(r['cohort']==c for r in rows) for c in sorted({r['cohort'] for r in rows})},
        'historicalSplitsPreserved':True,'sourcePixelDuplicates':0,'identityDisjoint':None,
        'productionReady':False,'maskReview':'pending','sources':[str(r) for r in roots],
        'personIdentityNote':'User confirmed no person-ID table; IDs remain unknown.'}
    (out/'intake-status.json').write_text(json.dumps(status,indent=2)+'\n',encoding='utf-8')
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf',16)
    for page in range((len(rows)+5)//6):
        sheet = Image.new('RGB',(1500,800),'white'); draw = ImageDraw.Draw(sheet)
        for i,row in enumerate(rows[page*6:page*6+6]):
            x,y = (i%3)*500,(i//3)*400
            draw.text((x+4,y+4),Path(row['sourcePersonImage']).stem+' — '+row['split'],font=font,fill='black')
            paths = [out/row['productImage'],out/row['personImage'],out/'previews'/f'{row["id"]}.jpg']
            for j,path in enumerate(paths):
                im=Image.open(path).convert('RGB'); im.thumbnail((162,355),Image.Resampling.LANCZOS)
                sheet.paste(im,(x+j*166+(162-im.width)//2,y+36))
        sheet.save(out/f'mask-review-{page+1}.jpg',quality=94)
    print(json.dumps(status))


if __name__ == '__main__':
    main()
