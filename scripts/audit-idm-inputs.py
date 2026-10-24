"""Prepare reviewable, case-specific masks before bounded IDM experiments."""
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

def main():
    import cv2
    import numpy as np
    import torch
    from PIL import Image,ImageDraw
    import ai_service as ai
    previous=ROOT/'workspace/diagnostics/idm-qualification_20261021T023540Z'
    target=ROOT/'workspace/diagnostics/idm-input-experiment'
    target.mkdir(exist_ok=True)
    audit=[]
    for category,name in [('upper_body','c002'),('overall','c003')]:
        folder=target/category
        folder.mkdir(exist_ok=True)
        source=Image.open(ROOT/f'samples/characters/{name}.png').convert('RGB')
        person=ai.detect_people(source,True)[0]
        points=person['keypoints']
        x0,y0,x1,y1=person['box']
        ph=y1-y0
        hips=float(np.mean([points[11][1],points[12][1]]))
        shoulder_y=float(np.mean([points[5][1],points[6][1]]))
        protected=ai.automatic_protected_detail_mask(source,person['box'],points)
        old=Image.open(previous/category/name/'requested-mask.png').convert('L')
        # Prompt SAM directly for the actual old garment; unlike the current
        # automatic helper, do not cut the torso above the estimated waist.
        box=np.array([x0,y0+ph*.13,x1,hips+ph*.06 if category=='upper_body' else y1-ph*.02],dtype=np.float32)
        center=(points[5][0]+points[6][0])/2
        positive=[[center,shoulder_y+ph*.12],[center,hips-ph*.03]]
        if category=='overall':
            positive += [[points[i][0],points[i][1]] for i in (13,14)]
        model=ai.load_predictor()
        with torch.inference_mode(),torch.autocast(device_type=ai.device,dtype=torch.bfloat16,enabled=ai.device=='cuda'):
            model.set_image(np.asarray(source))
            masks,scores,_=model.predict(point_coords=np.array(positive,dtype=np.float32),point_labels=np.ones(len(positive),dtype=np.int32),box=box,multimask_output=True)
        selected=int(np.argmax(scores))
        binary=ai.fill_garment_mask_holes(masks[selected]).astype(np.uint8)*255
        binary=np.maximum(binary,np.asarray(old))
        binary=cv2.morphologyEx(binary,cv2.MORPH_CLOSE,np.ones((9,9),np.uint8))
        # No new skin/background is inferred here. This candidate only recovers
        # SAM-selected source clothing and remains subject to human mask review.
        binary[np.asarray(protected)>0]=0
        candidate=Image.fromarray(binary)
        for label,image in [('source',source),('old-mask',old),('candidate-mask',candidate),('protected',protected)]:image.save(folder/f'{label}.png')
        sheet=Image.new('RGB',(source.width*3,source.height))
        for index,mask in enumerate([old,candidate,protected]):
            color=Image.new('RGB',source.size,('red','lime','blue')[index])
            overlay=Image.blend(source,color,.45)
            overlay=Image.composite(overlay,source,mask)
            sheet.paste(overlay,(index*source.width,0))
        sheet.thumbnail((1536,768))
        sheet.save(folder/'mask-audit.jpg')
        audit.append({'category':category,'sample':name,'person':person,'samConfidence':float(scores[selected]),
            'oldPolicy':ai.mask_strength_policy(old,person['box'],category,points),
            'candidatePolicy':ai.mask_strength_policy(candidate,person['box'],category,points),
            'addedPixels':int(((binary>16)&(np.asarray(old)<=16)).sum()),'protectedOverlap':int(((binary>16)&(np.asarray(protected)>0)).sum())})
    (target/'mask-audit.json').write_text(json.dumps(audit,indent=2),encoding='utf-8')
    print(str(target),flush=True)
if __name__=='__main__':main()
