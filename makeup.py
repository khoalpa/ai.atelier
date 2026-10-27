from prompt_catalog import prompt_text, prompt_template, catalog_value, CatalogMap, read_catalog
"""Offline face landmarks, localized cosmetics and optional SDXL makeup refinement."""
import base64
import hashlib
import importlib.util
import io
import json
import math
import re
import tempfile
import time
import uuid
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import image_enhancement as enhancement
import skin_retouch

VERSION = 1
LANDMARK_SHA = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'
PARTS = ('lips', 'eyes', 'brows', 'cheeks', 'base')
OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109]
LIPS = [61,40,37,0,267,270,291,321,314,17,84,91]
MOUTH = [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95]
EYES = [[33,160,158,133,153,144], [263,387,385,362,380,373]]
BROWS = [[70,63,105,66,107,55,65,52,53,46], [300,293,334,296,336,285,295,282,283,276]]


def styles(root):
    return read_catalog(Path(root) / 'workspace/prompts.json')['featurePresets']['makeup.styles']


def configuration(root):
    path = Path(root) / 'models/makeup/face_landmarker.task'
    return dict(version=VERSION, referenceVersion=1, comparisonVersion=1, styles=styles(root), landmarkReady=path.is_file() and importlib.util.find_spec('mediapipe') is not None,
                aiReady=skin_retouch.configuration(root)['modelReady'], maxFaces=8, maxPixels=enhancement.MAX_PIXELS)


def encode(image):
    data = io.BytesIO(); image.save(data, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(data.getvalue()).decode()


def landmarks(source, root):
    import mediapipe as mp
    path = Path(root) / 'models/makeup/face_landmarker.task'
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != LANDMARK_SHA:
        raise ValueError('Thiếu hoặc sai model khuôn mặt. Chạy scripts/setup-makeup.ps1.')
    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(path)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE, num_faces=8,
        min_face_detection_confidence=.5, min_face_presence_confidence=.5)
    # Resizing only the detector input keeps masks/results at original resolution.
    small = source.copy(); small.thumbnail((1600, 1600))
    with mp.tasks.vision.FaceLandmarker.create_from_options(options) as detector:
        result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(small).copy()))
    faces = [np.array([(p.x*source.width, p.y*source.height) for p in face], dtype=np.float32) for face in result.face_landmarks]
    return sorted(faces, key=lambda points: (float(points[1,0]), float(points[1,1])))


def region_masks(points, size):
    w, h = size
    def polygon(indices):
        mask = np.zeros((h,w), np.uint8)
        cv2.fillPoly(mask, [np.rint(points[indices]).astype(np.int32)], 255)
        return mask
    face = polygon(OVAL)
    x,y,fw,fh = cv2.boundingRect(np.rint(points[OVAL]).astype(np.int32))
    if min(fw,fh) < 48:
        raise ValueError('Khuôn mặt quá nhỏ. Dùng ảnh rõ hơn, khuôn mặt rộng ít nhất 48 px.')
    eyes = np.maximum(polygon(EYES[0]), polygon(EYES[1]))
    mouth = polygon(MOUTH)
    # Eye whites/irises and the mouth cavity are never editable, even by diffusion.
    keep = np.maximum(cv2.dilate(eyes, np.ones((3,3),np.uint8)), mouth)
    lips = polygon(LIPS); lips[keep>0] = 0
    brows = np.maximum(polygon(BROWS[0]), polygon(BROWS[1]))
    lids = np.zeros_like(face)
    for eye, brow in zip(EYES, BROWS):
        # A band above each upper lid follows the local brow direction/face roll.
        upper = points[eye[:4]]
        top = upper + (np.mean(points[brow],axis=0)-np.mean(upper,axis=0))*.65
        cv2.fillPoly(lids,[np.rint(np.concatenate([upper,top[::-1]])).astype(np.int32)],255)
    lids[keep>0]=0
    cheeks = np.zeros_like(face)
    eye_axis=points[263]-points[33]
    angle=math.degrees(math.atan2(float(eye_axis[1]),float(eye_axis[0])))
    for side,nose in ((93,98),(323,327)):
        # Visible cheek width shrinks in a three-quarter view; do not use the
        # extrapolated landmarks on the hidden side of the face.
        center=points[side]*.45+points[nose]*.55
        center[1]-=fh*.025
        radius=max(6,float(np.linalg.norm(points[side]-points[nose]))*.31)
        cv2.ellipse(cheeks,tuple(np.rint(center).astype(int)),(round(radius),max(7,round(fh*.10))),angle,0,360,255,-1)
    base = face.copy()
    exclusions = np.maximum.reduce([lips, brows, lids, keep, polygon(LIPS)])
    base[cv2.dilate(exclusions,np.ones((5,5),np.uint8))>0]=0
    masks = dict(lips=lips, eyes=lids, brows=brows, cheeks=cheeks, base=base)
    for key,value in masks.items():
        value[(face==0)|(keep>0)] = 0
        masks[key] = Image.fromarray(value)
    liner_radius=max(5,int(fw*.025)//2*2+1)
    liner=cv2.dilate(eyes,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(liner_radius,liner_radius)))
    liner[(lids==0)|(keep>0)]=0
    masks['_liner']=Image.fromarray(liner)
    thin=cv2.dilate(eyes,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
    thin[(lids==0)|(keep>0)]=0
    masks['_linerThin']=Image.fromarray(thin)
    box = [max(0,x),max(0,y),min(w,x+fw),min(h,y+fh)]
    return masks, Image.fromarray(keep), box


def analyze(body, env):
    path = env['safe_sample'](str(body.get('sampleId','')))
    source,_ = enhancement.load_source(path)
    faces = env.get('makeup_landmarks',landmarks)(source,env['ROOT'])
    result = []
    for index,points in enumerate(faces):
        try: masks,_,box = region_masks(points,source.size)
        except ValueError: continue
        thumb=source.crop(box);thumb.thumbnail((160,160))
        result.append(dict(index=index,box=box,thumbnail=encode(thumb),regions={key:encode(masks[key]) for key in PARTS}))
    if not result: raise ValueError('Chưa nhận diện được khuôn mặt đủ rõ. Hãy dùng ảnh chính diện hoặc nghiêng nhẹ, không che mắt và môi.')
    return dict(ok=True,faces=result,sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),width=source.width,height=source.height)


def options(body, root):
    presets=styles(root)
    style=body.get('style','natural')
    if not isinstance(style,str) or style not in presets: raise ValueError('Phong cách trang điểm không hợp lệ.')
    preset=presets[style]
    result=dict(version=VERSION,style=style)
    name=body.get('styleName',preset['name'])
    if not isinstance(name,str) or not name.strip() or len(name)>160:raise ValueError('Tên phong cách không hợp lệ.')
    result['styleName']=name.strip()
    for key,choices,default in [('intensity',('light','medium','bold'),preset['intensity']),('renderer',('color','ai'),preset['renderer']),
                                ('eyeliner',('none','thin','defined'),preset['eyeliner']),('finish',('matte','satin','gloss'),preset['finish'])]:
        value=body.get(key,default)
        if value not in choices: raise ValueError('Thiết lập trang điểm không hợp lệ: '+key)
        result[key]=value
    for key in ('lip','eyeshadow','blush','brow'):
        value=body.get(key,preset.get(key,'#59443b'))
        if not isinstance(value,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',value): raise ValueError('Màu trang điểm không hợp lệ.')
        result[key]=value.lower()
    parts=body.get('parts',list(PARTS))
    if not isinstance(parts,list) or not parts or any(not isinstance(p,str) or p not in PARTS for p in parts): raise ValueError('Chọn ít nhất một vùng trang điểm hợp lệ.')
    result['parts']=list(dict.fromkeys(parts))
    strengths=body.get('strengths',{})
    if not isinstance(strengths,dict) or any(p not in PARTS for p in strengths): raise ValueError('Độ đậm từng vùng không hợp lệ.')
    result['strengths']={}
    for part in PARTS:
        amount=strengths.get(part,100)
        if isinstance(amount,bool) or not isinstance(amount,(int,float)) or not math.isfinite(amount) or not 0<=amount<=100: raise ValueError('Độ đậm từng vùng phải từ 0 đến 100%.')
        result['strengths'][part]=amount
    if not any(result['strengths'][p]>0 for p in parts): raise ValueError('Tăng độ đậm cho ít nhất một vùng đã chọn.')
    for key,default in [('preview',False),('preserveFeatures',True),('limitSelection',False)]:
        value=body.get(key,default)
        if not isinstance(value,bool): raise ValueError('Thiết lập không hợp lệ: '+key)
        result[key]=value
    smooth=body.get('skinSmooth',0)
    if isinstance(smooth,bool) or not isinstance(smooth,(int,float)) or not math.isfinite(smooth) or not 0<=smooth<=50: raise ValueError('Mức làm mịn phải từ 0 đến 50%.')
    result['skinSmooth']=smooth
    for key,limit,default in [('description',1000,''),('prompt',320,preset['prompt'])]:
        text=body.get(key,default)
        if not isinstance(text,str) or len(text)>limit: raise ValueError('Mô tả trang điểm quá dài hoặc không hợp lệ.')
        result[key]=text.strip()
    if result['description'] and body.get('plannedDescription')!=result['description']:
        raise ValueError('Hãy nhấn Đọc mô tả để cập nhật thiết lập trước khi chạy.')
    if style=='custom' and not result['description']: raise ValueError('Nhập mô tả cho phong cách tùy chỉnh.')
    if not result['prompt'] or len(result['prompt'].split())>38: raise ValueError('Mô tả đã đọc quá dài. Hãy rút gọn và thử lại.')
    index=body.get('faceIndex')
    if isinstance(index,bool) or not isinstance(index,int) or not 0<=index<8: raise ValueError('Chọn một khuôn mặt trước khi trang điểm.')
    result['faceIndex']=index
    seed=body.get('seed',42)
    if isinstance(seed,bool) or not isinstance(seed,int) or not 0<=seed<2147483646: raise ValueError('Seed không hợp lệ.')
    result['seed']=seed
    return result


def feature_mask(source, skin):
    gray=cv2.cvtColor(np.asarray(source),cv2.COLOR_RGB2GRAY)
    dark=cv2.morphologyEx(gray,cv2.MORPH_BLACKHAT,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(11,11)))
    spots=((dark>14)&(np.asarray(skin)>0)).astype(np.uint8)
    count,labels,stats,_=cv2.connectedComponentsWithStats(spots,8)
    kept=np.zeros_like(spots)
    for i in range(1,count):
        if 2<=stats[i,cv2.CC_STAT_AREA]<=120: kept[labels==i]=255
    return Image.fromarray(cv2.dilate(kept,np.ones((3,3),np.uint8)))


def color_candidate(source, masks, settings, variant):
    rgb=np.asarray(source).astype(np.float32)
    result=rgb.copy()
    gain={'light':.4,'medium':.65,'bold':.9}[settings['intensity']] * (1 if variant==0 else .82)
    weight=lambda part:settings.get('strengths',{}).get(part,100)/100
    def tint(mask, color, opacity, darkness=0, softness=2, lip_tone=False, part='base'):
        nonlocal result
        hard=np.asarray(mask)>0
        if not hard.any() or not weight(part):return
        # All feathering is inward. Texture/light gradients remain in the source.
        distance=cv2.distanceTransform(np.pad(hard.astype(np.uint8),1),cv2.DIST_L2,3)[1:-1,1:-1]
        ramp=np.minimum(distance/max(1,softness),1)
        alpha=ramp*ramp*(3-2*ramp)*opacity*gain*weight(part)
        target=np.array([int(color[i:i+2],16) for i in (1,3,5)],np.float32)
        lab=cv2.cvtColor(np.clip(result/255,0,1),cv2.COLOR_RGB2LAB)
        targetlab=cv2.cvtColor((target/255).reshape(1,1,3),cv2.COLOR_RGB2LAB)[0,0]
        lab[:,:,1:]=lab[:,:,1:]*(1-alpha[:,:,None])+targetlab[1:]*alpha[:,:,None]
        lab[:,:,0]*=1-darkness*alpha
        if lip_tone:
            shift=np.clip(targetlab[0]-np.median(lab[:,:,0][hard]),-24,8)
            # Shift the base tone while retaining fine texture and lip highlights.
            specular=1-np.clip((lab[:,:,0]-65)/25,0,1)
            lab[:,:,0]+=shift*alpha*specular
        converted=cv2.cvtColor(lab,cv2.COLOR_LAB2RGB)*255
        result[hard]=converted[hard]
    if 'base' in settings['parts'] and weight('base'):
        hard=np.asarray(masks['base'])>0
        if settings['skinSmooth']:
            softened=np.asarray(skin_retouch.smooth(source,settings['skinSmooth'],True))
            result[hard]=result[hard]*(1-weight('base'))+softened[hard]*weight('base')
        # Thin foundation evens low-frequency chroma, without lifting the skin tone.
        lab=cv2.cvtColor(result/255,cv2.COLOR_RGB2LAB)
        clean=cv2.GaussianBlur(lab[:,:,1:],(0,0),5)
        lab[:,:,1:][hard]=lab[:,:,1:][hard]* (1-.12*gain*weight('base'))+clean[hard]*(.12*gain*weight('base'))
        converted=cv2.cvtColor(lab,cv2.COLOR_LAB2RGB)*255
        result[hard]=converted[hard]
    for part,key,opacity,darkness in [('cheeks','blush',.5,0),('eyes','eyeshadow',.72,.1),('lips','lip',.9,.08)]:
        if part in settings['parts']:
            bounds=masks[part].getbbox()
            feather=max(14,(bounds[2]-bounds[0])*.18) if part=='cheeks' and bounds else 12 if part=='eyes' else 2
            tint(masks[part],settings[key],opacity,darkness,feather,part=='lips',part)
    if 'brows' in settings['parts']: tint(masks['brows'],settings.get('brow','#59443b'),.35,.2,2,part='brows')
    if 'eyes' in settings['parts'] and settings['eyeliner']!='none':
        # Only the ring beside the actual eye, never the outer eyeshadow boundary.
        defined=settings['eyeliner']=='defined'
        tint(masks['_liner' if defined else '_linerThin'],'#382c30',.7 if defined else .4,.3,1,part='eyes')
    if 'lips' in settings['parts'] and settings['finish']=='gloss':
        hard=np.asarray(masks['lips'])>0
        luma=cv2.cvtColor(rgb.astype(np.uint8),cv2.COLOR_RGB2GRAY).astype(np.float32)
        if hard.any():
            highlight=np.clip((luma-np.percentile(luma[hard],65))/35,0,1)*gain*weight('lips')*8
            result[hard]+=highlight[hard,None]
    if 'lips' in settings['parts'] and settings['finish']=='matte':
        hard=np.asarray(masks['lips'])>0
        luma=cv2.cvtColor(rgb.astype(np.uint8),cv2.COLOR_RGB2GRAY).astype(np.float32)
        if hard.any():
            highlights=cv2.GaussianBlur(np.clip(luma-np.percentile(luma[hard],70),0,30),(0,0),1.5)
            result[hard]-=highlights[hard,None]*.35*gain*weight('lips')
    return Image.fromarray(np.rint(result).clip(0,255).astype(np.uint8))


def ai_candidates(source, masks, allowed, box, settings, env, active, progress):
    import torch
    from object_removal import prepare_region, restore_region
    if not skin_retouch.configuration(env['ROOT'])['modelReady']:raise ValueError('Chưa có model trang điểm AI. Có thể chọn Phủ màu giữ chi tiết.')
    for name in ('release_inpaint','release_tryon','release_text_to_image'):env[name]()
    pipe=None
    try:
        path=Path(env['ROOT'])/'models/inpainting/stable-diffusion-xl-1.0-inpainting-0.1'
        pipe=env['load_inpaint_pipe'](lambda *_:active(),path,'sdxl');pipe.unload_lora_weights()
        if not torch.cuda.is_available():pipe.to(dtype=torch.float32)
        strength={'light':.28,'medium':.4,'bold':.52}[settings['intensity']]
        steps=math.ceil(16/strength); effective=int(steps*strength)
        prompt=settings['prompt']+prompt_text('makeup.preserve')
        negative=prompt_text('makeup.negative')
        for variant in range(env.get('makeup_variant_count',2)):
            active()
            conditioned=color_candidate(source,masks,settings,variant)
            patch,selection,size=prepare_region(conditioned,allowed,box,768,erase_conditioning=False)
            def step(pipeline,index,timestep,kwargs):
                active();progress(variant*effective+index+1,env.get('makeup_variant_count',2)*effective);return kwargs
            with torch.inference_mode():
                output=env['traced_pipeline_call'](pipe,prompt=prompt,negative_prompt=negative,image=patch,mask_image=selection,
                    width=patch.width,height=patch.height,strength=strength,num_inference_steps=steps,guidance_scale=4.5,
                    generator=torch.Generator('cpu').manual_seed(settings['seed']+variant),
                    callback_on_step_end=step,callback_on_step_end_tensor_inputs=['latents']).images[0]
            active()
            if output.size!=patch.size:raise RuntimeError('Kích thước ảnh trang điểm AI không đúng.')
            candidate=source.copy();candidate.paste(restore_region(output,box,size),box[:2])
            yield candidate
    finally:
        del pipe
        env['release_inpaint']()


def run(body, env, variant_count=2):
    if variant_count not in (1,2):raise ValueError('Số phương án không hợp lệ.')
    env={**env,'makeup_variant_count':variant_count}
    started=time.perf_counter();settings=options(body,env['ROOT'])
    job_id=str(body.get('jobId',''))[:80]
    active=lambda:env['ensure_job_active'](job_id)
    update=lambda **kw:env['update_job'](job_id,**kw)
    active()
    path=env['safe_sample'](str(body.get('sampleId','')))
    sha=hashlib.sha256(path.read_bytes()).hexdigest()
    if body.get('sourceSha256')!=sha:raise ValueError('Ảnh nguồn đã đổi. Hãy nhận diện khuôn mặt lại.')
    source,alpha=enhancement.load_source(path)
    update(status='running',taskType='makeup',stage='makeup-detecting',sourceId=body['sampleId'],totalVariants=variant_count,completedSteps=0,totalWorkSteps=variant_count,results=[])
    env['persist_job_request'](job_id,'makeup',body)
    faces=env.get('makeup_landmarks',landmarks)(source,env['ROOT']);active()
    if settings['faceIndex']>=len(faces):raise ValueError('Khuôn mặt đã thay đổi. Hãy nhận diện lại.')
    masks,keep,box=region_masks(faces[settings['faceIndex']],source.size)
    protected=enhancement.read_mask(body.get('protectedDetailMask'),source.size)
    manual_protected=protected.copy()
    selected=enhancement.read_mask(body.get('editableMask'),source.size,255 if not settings['limitSelection'] else 0)
    protection=np.maximum(np.asarray(protected),np.asarray(keep))
    if settings['preserveFeatures']:protection=np.maximum(protection,np.asarray(feature_mask(source,masks['base'])))
    union=np.maximum.reduce([np.asarray(masks[part]) for part in settings['parts'] if settings['strengths'][part]>0])
    if settings['limitSelection']:union=np.minimum(union,np.asarray(selected))
    else:selected=Image.fromarray(union.copy())
    allowed=Image.fromarray(np.where(protection>0,0,union).astype(np.uint8))
    if not allowed.getbbox():raise ValueError('Không còn vùng trang điểm. Kiểm tra vùng đã tô và vùng bảo vệ.')
    protected=Image.fromarray(protection)
    pad=max(24,int((box[2]-box[0])*.18))
    crop=(max(0,box[0]-pad),max(0,box[1]-pad),min(source.width,box[2]+pad),min(source.height,box[3]+pad))
    settings['faceBox']=box
    progress=lambda i,n:update(stage='makeup-processing',completedSteps=i,totalWorkSteps=n)
    candidates=env.get('makeup_ai',ai_candidates)(source,masks,allowed,crop,settings,env,active,progress) if settings['renderer']=='ai' else (color_candidate(source,masks,settings,i) for i in range(variant_count))
    folder=env['OUTPUTS']/'makeup'/uuid.uuid4().hex[:20]
    relative=lambda p:p.relative_to(env['ROOT']).as_posix()
    items=[]
    env['JOBS_DIR'].mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='makeup-',dir=env['JOBS_DIR']) as temporary:
        stage=Path(temporary)
        try:
            for variant,candidate in enumerate(candidates):
                active();progress(variant+1,variant_count)
                if candidate.size!=source.size:raise RuntimeError('Kích thước kết quả không khớp ảnh nguồn.')
                if settings['renderer']=='ai':
                    amount=np.maximum.reduce([(np.asarray(masks[p])>0)*settings['strengths'][p]/100 for p in settings['parts']])[:,:,None]
                    candidate=Image.fromarray(np.rint(np.asarray(source)*(1-amount)+np.asarray(candidate)*amount).clip(0,255).astype(np.uint8))
                _,result,metrics=enhancement.composite(source,candidate,allowed,dict(method='makeup',scale=1))
                if alpha is not None:result.putalpha(alpha)
                if settings['preview']:result=result.crop(crop)
                seed=settings['seed']+variant
                result.save(stage/f'result_seed_{seed}.png')
                items.append(dict(kind='makeup',seed=seed,sampleId=body['sampleId'],file=relative(folder/f'result_seed_{seed}.png'),
                    comparisonFile=relative(folder/'comparison.png'),width=result.width,height=result.height,settings=settings,
                    metrics=metrics,previewOnly=settings['preview'],crop=crop if settings['preview'] else None,sourceSha256=sha,
                    label=f'Phương án {variant+1}'+(' · dịu hơn' if variant and settings['renderer']=='color' else '')))
        finally:
            if hasattr(candidates,'close'):candidates.close()
        if len(items)!=variant_count:raise RuntimeError('Chưa tạo đủ phương án trang điểm.')
        active();update(stage='makeup-saving')
        original=source.copy()
        if alpha is not None:original.putalpha(alpha)
        original.save(stage/'source.png')
        (original.crop(crop) if settings['preview'] else original).save(stage/'comparison.png')
        # Save full-sized masks even for previews so edit-again is unambiguous.
        selected.save(stage/'editable_mask.png');manual_protected.save(stage/'protected_mask.png')
        protected.save(stage/'applied_protection.png');allowed.save(stage/'applied_mask.png')
        report=dict(ok=True,version=VERSION,taskType='makeup',directory=relative(folder),results=items,settings=settings,
                    sourceSha256=sha,source=body['sampleId'],durationSeconds=round(time.perf_counter()-started,3),previewOnly=settings['preview'])
        (stage/'metadata.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        active();folder.parent.mkdir(parents=True,exist_ok=True);stage.rename(folder)
    for item in items:update(_result=item)
    update(status='completed',stage='done',completedSteps=variant_count,totalWorkSteps=variant_count,durationSeconds=report['durationSeconds'])
    return report
