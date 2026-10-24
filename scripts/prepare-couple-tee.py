"""Prepare a local, product-held-out pilot without changing source photographs.

Filename suffixes describe source files, never verified person identities. This
exploratory dataset is deliberately separate from the production readiness gate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def key(value):
    return unicodedata.normalize('NFC', value).casefold()


def discover(source):
    groups = {}
    for path in sorted(source.iterdir(), key=lambda p: key(p.name)):
        if path.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
            continue
        stem, role = path.stem, 'product'
        for suffix in ('female', 'male'):
            if key(stem).endswith(' ' + suffix):
                stem, role = stem[:-(len(suffix)+1)], suffix
                break
        group = groups.setdefault(key(stem), {'name': stem})
        if role in group:
            raise ValueError(f'Duplicate {role} image for {stem}')
        group[role] = path
    for group in groups.values():
        if 'product' not in group or not any(role in group for role in ('female', 'male')):
            raise ValueError(f'Incomplete product/person pair: {group["name"]}')
    return list(groups.values())


def segment(predictor, image, box, positive, negative):
    import numpy as np
    import torch
    size = np.array(image.size)
    coords = np.asarray(positive + negative, dtype=np.float32) * size
    labels = np.array([1]*len(positive) + [0]*len(negative), dtype=np.int32)
    with torch.inference_mode(), torch.autocast('cuda', dtype=torch.bfloat16):
        predictor.set_image(np.asarray(image))
        masks, scores, _ = predictor.predict(point_coords=coords, point_labels=labels,
            box=np.array(box, dtype=np.float32)*np.tile(size, 2), multimask_output=True)
    valid = [float(score) if .015 < mask.mean() < .85 else -1 for mask, score in zip(masks, scores)]
    index = int(np.argmax(valid))
    if valid[index] < 0:
        raise ValueError('No plausible garment segmentation; manual mask required')
    return Image.fromarray(masks[index].astype('uint8')*255), float(scores[index])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=ROOT/'samples/couple_tee')
    parser.add_argument('--output', type=Path, default=ROOT/'workspace/training/couple-tee-pilot')
    parser.add_argument('--annotations', type=Path, default=ROOT/'workspace/training/couple-tee-intake/annotations.json')
    parser.add_argument('--height',type=int,choices=(512,768,1024),default=512)
    parser.add_argument('--id-prefix',default='tee',help='Distinct prefix for a new source collection; preserves historical IDs by default')
    args = parser.parse_args()
    if re.fullmatch(r'[a-z][a-z0-9-]{0,20}',args.id_prefix) is None:
        raise ValueError('ID prefix must be a short lowercase filename component')
    source, out = args.source.resolve(), args.output.resolve()
    if source == out or source in out.parents:
        raise ValueError('Use an output directory outside the original source folder')
    groups = discover(source)
    annotations = json.loads(args.annotations.read_text(encoding='utf-8'))
    canvas_size=(args.height*3//4,args.height)
    import numpy as np
    import cv2
    import ai_service as ai
    from catvton_inputs import prepare_inputs
    predictor = ai.load_predictor()
    for folder in ('products', 'people', 'masks', 'raw-masks', 'previews'):
        (out/folder).mkdir(parents=True, exist_ok=True)
    rows, products = [], []
    for group in groups:
        name = group['product'].stem
        annotation = annotations[name]
        if annotation.get('exclude'):
            print(json.dumps({'excluded':name,'reason':annotation['exclude']},ensure_ascii=True),flush=True)
            continue
        product_id = args.id_prefix + '-' + hashlib.sha256(key(name).encode()).hexdigest()[:10]
        product = ImageOps.exif_transpose(Image.open(group['product'])).convert('RGB')
        crop = annotation['frontCrop']
        product = product.crop(tuple(round(v * product.size[i % 2]) for i, v in enumerate(crop)))
        pmask, pscore = segment(predictor, product, annotation['box'], annotation['positive'], annotation['negative'])
        # Reviewed exclusion polygons refer to visible mannequin parts only.
        # Keep them in the annotation file so this correction is reproducible.
        draw_mask = ImageDraw.Draw(pmask)
        for polygon in annotation.get('restorePolygons', []):
            draw_mask.polygon([(round(x*product.width),round(y*product.height)) for x,y in polygon],fill=255)
        for polygon in annotation.get('excludePolygons', []):
            draw_mask.polygon([(round(x*product.width),round(y*product.height)) for x,y in polygon],fill=0)
        # Isolated jewelry/hand fragments must not change garment framing.
        count, labels, stats, _ = cv2.connectedComponentsWithStats((np.asarray(pmask)>0).astype(np.uint8))
        if count > 1:
            pmask = Image.fromarray((labels == 1+int(np.argmax(stats[1:,cv2.CC_STAT_AREA]))).astype(np.uint8)*255)
        bounds = pmask.getbbox()
        if not bounds:
            raise ValueError('Empty product mask')
        clean = Image.composite(product, Image.new('RGB', product.size, 'white'), pmask).crop(bounds)
        canvas = Image.new('RGB', (768, 1024), 'white')
        clean.thumbnail((700, 956), Image.Resampling.LANCZOS)
        canvas.paste(clean, ((768-clean.width)//2, (1024-clean.height)//2))
        canvas.save(out/'products'/f'{product_id}.png')
        pmask.save(out/'raw-masks'/f'{product_id}.png')
        products.append({'id': product_id, 'name': name, 'source': str(group['product']),
                         'sourceSha256': digest(group['product']), 'maskConfidence': pscore,
                         'frontCrop': crop, 'split': annotation['split']})
        for role in ('female', 'male'):
            if role not in group:
                continue
            record_id = product_id + '-' + role
            person = ImageOps.exif_transpose(Image.open(group[role])).convert('RGB')
            people = ai.detect_people_pose(person)
            if len(people) != 1:
                raise ValueError(f'Expected one detected person in {group[role]}')
            pose = people[0]
            points = pose['keypoints']
            if min(points[i][2] for i in (5,6,11,12)) < .4:
                raise ValueError(f'Uncertain torso pose: {record_id}')
            shoulder = np.mean([points[i][:2] for i in (5,6)], axis=0)
            hip = np.mean([points[i][:2] for i in (11,12)], axis=0)
            positive = [(shoulder*.7+hip*.3)/person.size, (shoulder*.35+hip*.65)/person.size]
            negative = [np.array(points[i][:2])/person.size for i in (0,9,10) if points[i][2]>.5]
            bx = pose['box']
            box = [bx[0]/person.width, max(0,(shoulder[1]-(hip[1]-shoulder[1])*.25)/person.height),
                   bx[2]/person.width, min(1,(hip[1]+(hip[1]-shoulder[1])*.4)/person.height)]
            override=annotation.get('people',{}).get(role,{})
            box=override.get('box',box);positive=override.get('positive',positive);negative=override.get('negative',negative)
            mask, score = segment(predictor, person, box, positive, negative)
            person_draw=ImageDraw.Draw(mask)
            for field,fill in [('restorePolygons',255),('excludePolygons',0)]:
                for polygon in override.get(field,[]):
                    person_draw.polygon([(round(x*person.width),round(y*person.height)) for x,y in polygon],fill=fill)
            mask.save(out/'raw-masks'/f'{record_id}.png')
            # Dilate garment contours so the training input cannot copy the hem
            # and sleeve boundaries directly from the target. Preserve hands/face.
            binary = np.array(mask)
            radius = max(7, round(min(person.size)*.018)) | 1
            binary = cv2.dilate(binary, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(radius,radius)))
            protection = np.array(ai.automatic_protected_detail_mask(person,pose['box'],points))
            binary[protection>0] = 0
            image, fitted_mask = prepare_inputs(person, Image.fromarray(binary), canvas_size)
            image.save(out/'people'/f'{record_id}.png')
            fitted_mask.save(out/'masks'/f'{record_id}.png')
            preview = Image.composite(Image.new('RGB',image.size,(140,140,140)),image,fitted_mask)
            preview.save(out/'previews'/f'{record_id}.jpg', quality=90)
            rows.append({'id':record_id,'split':annotation['split'],'category':'upper_body',
                         'productId':product_id,'personIdentity':None,'sourceRole':role,
                         'cohort':source.name,
                         'productImage':f'products/{product_id}.png','personImage':f'people/{record_id}.png',
                         'maskImage':f'masks/{record_id}.png','sourcePersonImage':str(group[role]),
                         'sourceSha256':digest(group[role]),'maskConfidence':score,
                         'attributes':annotation['attributes'],
                         'quality':{'maskReview':'pending','garmentMayBeOccluded':True},
                         'provenance':{'source':f'user-supplied {source.name} folder for local training',
                                       'synthetic':False,'consentRecorded':None,'commercialUseAllowed':None}})
        print(json.dumps({'prepared':name,'pairs':len(rows)},ensure_ascii=False),flush=True)
    (out/'manifest.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows),encoding='utf-8')
    (out/'products.json').write_text(json.dumps(products,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    status={'scope':'upper_body exploratory pilot','pairs':len(rows),'products':len(products),
            'splitUnit':'product','identityDisjoint':None,'productionReady':False,
            'limitations':['small dataset','person identities unverified','rights metadata unverified',
                           'visible jewelry and occlusion','mask review pending'],
            'sourceRoot':str(source),'annotationSha256':digest(args.annotations)}
    status['resolution']=list(canvas_size)
    status['idPrefix']=args.id_prefix
    (out/'intake-status.json').write_text(json.dumps(status,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf',16)
    for page in range((len(rows)+9)//10):
        sheet=Image.new('RGB',(1500,650),'white'); draw=ImageDraw.Draw(sheet)
        for i,row in enumerate(rows[page*10:page*10+10]):
            x,y=(i%5)*300,(i//5)*325
            product=Image.open(out/row['productImage']); product.thumbnail((140,270))
            masked=Image.open(out/'previews'/f'{row["id"]}.jpg'); masked.thumbnail((150,270))
            sheet.paste(product,(x,y+40)); sheet.paste(masked,(x+145,y+40))
            draw.text((x+3,y+3),Path(row['sourcePersonImage']).stem,font=font,fill='black')
            draw.text((x+3,y+22),row['split'],font=font,fill='black')
        sheet.save(out/f'mask-review-{page+1}.jpg',quality=94)


if __name__ == '__main__':
    main()
