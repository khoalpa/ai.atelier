"""Character edits: validated plans, protected compositing and atomic job publication."""
import hashlib
import json
import tempfile
import time
import uuid
import re
from pathlib import Path

import numpy as np
from PIL import Image
import image_enhancement as enhancement
import makeup
import character_geometry as geometry
import character_runtime as runtime
import character_controls as controls
import character_quality as quality


def configuration(root):
    return {**runtime.configuration(root), 'expressions':geometry.EXPRESSIONS, 'poses':geometry.POSES, 'joints':geometry.JOINTS, 'edges':geometry.EDGES,'qualityRecoveryReady':quality.available(root)}


def detect_faces(source,env,detected=None):
    detector=env.get('character_landmarks',makeup.landmarks)
    faces=detector(source,env['ROOT'])
    if 'character_landmarks' in env:return faces
    if detected is None:detected=env['detect_people_pose'](source)
    for raw in detected:
        points=np.asarray(raw.get('keypoints',[]));box=raw['box']
        if points.shape!=(17,3) or points[0,2]<.3:continue
        nose=points[0,:2]
        if any(np.linalg.norm(face[1]-nose)<max(30,(box[2]-box[0])*.3) for face in faces):continue
        span=max(48,np.linalg.norm(points[5,:2]-points[6,:2])*.8)
        crop=(max(0,round(nose[0]-span)),max(0,round(nose[1]-span)),min(source.width,round(nose[0]+span)),min(source.height,round(nose[1]+span*1.2)))
        if min(crop[2]-crop[0],crop[3]-crop[1])<48:continue
        for face in detector(source.crop(crop),env['ROOT']):
            face+=np.array(crop[:2]);
            if not any(np.linalg.norm(existing[1]-face[1])<30 for existing in faces):faces.append(face)
    return sorted(faces,key=lambda f:float(f[1,0]))


def inspect_source(sample_id, env):
    path=env['safe_sample'](str(sample_id));source,alpha=enhancement.load_source(path)
    detected=merge_duplicate_people(env['detect_people_pose'](source))
    faces=detect_faces(source,env,detected)
    people=[];w,h=source.size;used=set()
    for raw in sorted(detected,key=lambda p:(p['box'][0],p['box'][1])):
        box=np.clip(np.asarray(raw['box'])/[w,h,w,h],0,1)
        points=np.asarray(raw.get('keypoints',np.zeros((17,3))),dtype=float)
        points[:,:2]/=[w,h];points=np.clip(points,0,1)
        matching=[i for i,f in enumerate(faces) if i not in used and box[0]<=f[1,0]/w<=box[2] and box[1]<=f[1,1]/h<=box[3]]
        # Choose the face closest to this person's detected nose, not the first overlapping box.
        index=min(matching,key=lambda i:np.linalg.norm(faces[i][1]/[w,h]-points[0,:2])) if matching else None
        person=dict(box=box.tolist(),keypoints=points.tolist(),faceIndex=index)
        if index is not None:used.add(index)
        people.append(person)
    for index,face in enumerate(faces):
        if index in used:continue
        low=face.min(axis=0)/[w,h];high=face.max(axis=0)/[w,h]
        people.append(dict(box=[*np.clip(low-.03,0,1),*np.clip(high+.03,0,1)],keypoints=np.zeros((17,3)).tolist(),faceIndex=index))
    people.sort(key=lambda p:p['box'][0])
    for i,person in enumerate(people):
        person['id']=i;index=person['faceIndex']
        if index is not None:
            face=faces[index];low=face.min(axis=0);high=face.max(axis=0)
            if min(high-low)>=48:person['faceBox']=np.clip(np.r_[low,high]/[w,h,w,h],0,1).tolist()
        box=np.array(person.get('faceBox') or person['box'])*[w,h,w,h]
        thumb=source.crop(tuple(box));thumb.thumbnail((100,120));person['thumbnail']=makeup.encode(thumb)
        person['bodyReady']=sum(p[2]>.3 for p in person['keypoints'][5:])>=6
    if not people:raise ValueError('Chưa nhận diện được nhân vật. Chọn ảnh rõ mặt hoặc toàn thân.')
    return source,alpha,hashlib.sha256(path.read_bytes()).hexdigest(),people,faces


def merge_duplicate_people(detected):
    """Merge nested upper-body/full-body detections of the same visible head.

    A second box around the same person must not become a protected bystander.
    Two distinct heads remain two people even when their bodies overlap.
    """
    result=[]
    for raw in detected:
        item={**raw,'box':list(raw['box']),'keypoints':np.array(raw.get('keypoints',np.zeros((17,3))),dtype=float).tolist()}
        p=np.asarray(item['keypoints']);box=np.asarray(item['box']);merged=False
        for existing in result:
            q=np.asarray(existing['keypoints']);other=np.asarray(existing['box'])
            if p.shape!=(17,3) or q.shape!=(17,3) or min(p[0,2],q[0,2])<.5:continue
            overlap=np.maximum(0,np.minimum(box[2:],other[2:])-np.maximum(box[:2],other[:2])).prod()
            area=min(np.maximum(0,box[2:]-box[:2]).prod(),np.maximum(0,other[2:]-other[:2]).prod())
            span=max(20,min(np.linalg.norm(p[5,:2]-p[6,:2]),np.linalg.norm(q[5,:2]-q[6,:2])))
            if overlap/max(area,1)<.85 or np.linalg.norm(p[0,:2]-q[0,:2])>span*.2:continue
            existing['box']=np.r_[np.minimum(box[:2],other[:2]),np.maximum(box[2:],other[2:])].tolist()
            better=p[:,2]>q[:,2];q[better]=p[better];existing['keypoints']=q.tolist();merged=True;break
        if not merged:result.append(item)
    return result


def analyze(body,env):
    source,_,sha,people,_=inspect_source(body.get('sampleId',''),env)
    return dict(ok=True,sourceSha256=sha,width=source.width,height=source.height,people=people)


def appearance_description(source,people,ids,sha,env):
    if 'character_appearance' in env:return env['character_appearance'](source,people,ids)
    if 'torch' not in env:return ''
    import requests
    phrases=[];cache=Path(env['ROOT'])/'workspace/character-cache';cache.mkdir(parents=True,exist_ok=True)
    for i in ids:
        key=hashlib.sha256((sha+json.dumps(people[i]['box'])+'clothes-v2').encode()).hexdigest();file=cache/(key+'.json')
        cached=None
        if file.exists():
            try:cached=json.loads(file.read_text(encoding='utf8')).get('description','')
            except (ValueError,OSError):cached=None
        if cached is not None:text=cached
        else:
            box=np.asarray(people[i]['box'])*[*source.size,*source.size];crop=source.copy() if len(people)==1 else source.crop(tuple(box));crop.thumbnail((512,768))
            try:
                response=requests.post('http://127.0.0.1:11434/api/chat',json=dict(model='llava:7b',stream=False,keep_alive=0,options=dict(temperature=0,num_predict=90),messages=[dict(role='user',content='Describe ONLY the visible clothing and footwear, with exact colors, in one English phrase of at most 15 words. Do not describe the person or pose.',images=[makeup.encode(crop).split(',')[1]])]),timeout=120)
                response.raise_for_status();text=response.json().get('message',{}).get('content','').strip()
                if not re.fullmatch(r'[\x20-\x7e\s]{1,240}',text):text=''
                text=' '.join(text.split()[:20]);file.write_text(json.dumps(dict(description=text)),encoding='utf8')
            except (requests.RequestException,ValueError):
                # Bind the reviewed plan even if the optional local captioner
                # is unavailable; rendering must not silently change it later.
                text='';file.write_text(json.dumps(dict(description='')),encoding='utf8')
        if text:phrases.append(('' if len(ids)==1 else ('left: ' if i==ids[0] else 'right: ' if len(ids)==2 else f'person {ids.index(i)+1}: '))+text)
    return '; '.join(phrases)


def prepare(body,env):
    settings=geometry.options(body)
    source,alpha,sha,people,faces=inspect_source(body.get('sampleId',''),env)
    if body.get('sourceSha256')!=sha:raise ValueError('Ảnh nguồn đã đổi. Nhận diện nhân vật lại trước khi tạo.')
    if any(i>=len(people) for i in settings['personIds']):raise ValueError('Nhân vật đã thay đổi. Hãy nhận diện lại.')
    selected=settings['personIds'];reference=None;ref_person=None;reference_faces=None
    if settings['useReferencePose'] or settings['useReferenceExpression']:
        ref_source,_,ref_sha,ref_people,reference_faces=inspect_source(body.get('referenceId',''),env)
        if body.get('referenceSha256')!=ref_sha:raise ValueError('Ảnh tham chiếu đã đổi. Nhận diện lại ảnh tham chiếu.')
        ref_id=body.get('referencePersonId')
        if type(ref_id)!=int or not 0<=ref_id<len(ref_people):raise ValueError('Chọn nhân vật trong ảnh tham chiếu.')
        ref_person=ref_people[ref_id];reference=(ref_source,ref_person,reference_faces)
        if settings['useReferenceExpression'] and not ref_person.get('faceBox'):raise ValueError('Khuôn mặt tham chiếu chưa đủ rõ.')
    raw_targets=body.get('targetPoses',{})
    if not isinstance(raw_targets,dict) or set(raw_targets)-{str(i) for i in selected}:raise ValueError('Khung xương phải thuộc các nhân vật đã chọn.')
    targets={}
    for i in selected:
        person=people[i];individual=controls.person(settings,i)
        if settings['mode']=='face' and not person.get('faceBox'):raise ValueError('Mặt quá nhỏ hoặc bị che. Chọn ảnh thấy rõ khuôn mặt ít nhất 48 px.')
        if settings['mode']!='face' and not person['bodyReady']:raise ValueError('Nhân vật chưa có đủ khớp nhìn thấy. Chọn ảnh rõ vai, hông và tay/chân.')
        q=geometry.validate_joints(person['keypoints'])
        if settings['mode']!='face':
            if str(i) in raw_targets:q=geometry.validate_joints(raw_targets[str(i)])
            elif settings['useReferencePose']:q=geometry.transfer_pose(ref_person['keypoints'],q)
            else:q=geometry.preset_joints(q,individual['pose'],individual['handSide'])
        targets[i]=q
    explicit_contacts=controls.apply_contacts(targets,settings) if not raw_targets else []
    if (raw_targets or explicit_contacts) and settings['pose'] in ('handshake','handover'):
        contacts=[]
        for i,q in targets.items():
            other=next(v for key,v in targets.items() if key!=i);center=other[[5,6],:2].mean(axis=0)
            wrist=min((9,10),key=lambda j:np.linalg.norm(q[j,:2]-center));contacts.append(dict(personId=i,joint=wrist,x=float(q[wrist,0]),y=float(q[wrist,1])))
        if np.linalg.norm(np.array([contacts[0]['x'],contacts[0]['y']])-np.array([contacts[1]['x'],contacts[1]['y']]))>.06:raise ValueError('Hai cổ tay tiếp xúc còn quá xa nhau. Kéo chúng lại gần trong khung xương đích.')
    else:targets,contacts=geometry.interaction_targets(people,targets,settings['pose'])
    if settings['mode']=='face' and not controls.face_requested(controls.person(settings,selected[0])):raise ValueError('Chọn biểu cảm, hướng nhìn hoặc góc đầu muốn thay đổi.')
    face_ids={i for i in selected if controls.face_requested(controls.person(settings,i))}
    if settings['mode']!='face' and settings['keepFace']:
        for i,q in targets.items():
            original=np.asarray(people[i]['keypoints'])
            if i not in face_ids and people[i].get('faceBox') and np.linalg.norm(q[0,:2]-original[0,:2])<.01:q[:5]=original[:5]
    protected=enhancement.read_mask(body.get('protectedDetailMask'),source.size)
    # Per-person object regions use that person's own requested action. Build
    # against the same selected set so one selected person's box is not cut out.
    allowed=geometry.allowed_mask(people,targets,source.size,settings['mode'],protected,settings['pose'],settings)
    if settings['mode']!='face':
        # Preserve stationary shirt fronts in both the reviewed edit region
        # and the inference mask, rather than repairing invented clothes later.
        mask=np.array(allowed)
        mask[np.asarray(geometry.stationary_torso_mask(people,targets,source.size))>0]=0
        allowed=Image.fromarray(mask)
    if settings['mode']!='face':
        if face_ids:
            facial=geometry.allowed_mask(people,targets,source.size,'face',protected) if face_ids==set(selected) else None
            if facial is None:
                facial=Image.new('L',source.size)
                for i in face_ids:
                    one=geometry.allowed_mask([people[i]],{0:targets[i]},source.size,'face',protected)
                    facial=Image.fromarray(np.maximum(np.asarray(facial),np.asarray(one)))
                # Preserve every unselected bystander, including overlaps.
                f=np.array(facial)
                for i,person in enumerate(people):
                    if i not in selected:
                        x,y,r,b=np.rint(np.asarray(person['box'])*[*source.size,*source.size]).astype(int);f[max(0,y):b,max(0,x):r]=0
                facial=Image.fromarray(f)
            allowed=Image.fromarray(np.maximum(np.asarray(allowed),np.asarray(facial)))
        mask=np.array(allowed)
        for i,q in targets.items():
            person=people[i];original=np.asarray(person['keypoints'])
            if i not in face_ids and settings['keepFace'] and person.get('faceBox') and np.linalg.norm(q[0,:2]-original[0,:2])<.01:
                keep=geometry.allowed_mask([person],{0:q},source.size,'face');mask[np.asarray(keep)>0]=0
        allowed=Image.fromarray(mask)
    if body.get('limitSelection',False):
        selection=enhancement.read_mask(body.get('editableMask'),source.size)
        allowed=Image.fromarray(np.minimum(np.asarray(allowed),np.asarray(selection)))
        if not allowed.getbbox():raise ValueError('Vùng giới hạn chưa được tô hoặc đã bị bảo vệ hết.')
    if not allowed.getbbox():raise ValueError('Vùng bảo vệ che hết vùng thay đổi.')
    if settings['mode']!='face':
        a=np.asarray(allowed);w,h=source.size
        for i,q in targets.items():
            original=np.asarray(people[i]['keypoints'])
            moved=np.linalg.norm((q[:,:2]-original[:,:2])*[w,h],axis=1)>max(2,min(w,h)*.006)
            for j,(x,y,c) in enumerate(q):
                if moved[j] and c>.4 and a[min(h-1,round(y*h)),min(w-1,round(x*w))]==0:raise ValueError('Khớp đích chạm vùng bảo vệ hoặc nhân vật chưa chọn. Dời khớp hoặc chỉnh vùng trước khi tạo.')
    target_json={str(i):q.tolist() for i,q in targets.items()}
    if settings['mode']!='face':settings['appearancePrompt']=appearance_description(source,people,selected,sha,env)
    signature={**settings,'targets':target_json,'source':sha,'reference':body.get('referenceSha256') if reference else None,'referencePerson':body.get('referencePersonId') if reference else None,'mask':hashlib.sha256(allowed.tobytes()).hexdigest()}
    # Preview/full-size count does not change the reviewed geometric plan.
    for key in ('preview','count','seed','steps','resolution','variantOffset'):signature.pop(key,None)
    plan_hash=hashlib.sha256(json.dumps(signature,sort_keys=True).encode()).hexdigest()
    control=geometry.draw_pose(targets,source.size,settings['pose'],settings)
    return dict(settings=settings,source=source,alpha=alpha,sha=sha,people=people,faces=faces,reference=reference,targets=targets,target_json=target_json,contacts=contacts,protected=protected,allowed=allowed,control=control,plan_hash=plan_hash)


def plan(body,env):
    p=prepare(body,env)
    tint=np.asarray(p['source']).copy();mask=np.asarray(p['allowed'])>0
    tint[mask]=np.rint(tint[mask]*.7+np.array([255,90,60])*.3)
    if p['settings']['mode']!='face':
        bones=np.asarray(p['control']);visible=bones.max(axis=2)>0;tint[visible]=bones[visible]
    warnings=['Vùng màu cam được tái tạo. Ngoài vùng và người chưa chọn được giữ nguyên.', 'Kiểm tra diện mạo, trang phục, ngón tay và tiếp xúc đồ vật trong kết quả.']
    if p['settings']['mode']=='face':warnings=['Xoay đầu nhẹ và đổi biểu cảm có thể làm lộ chi tiết mới. So sánh khuôn mặt trước khi chọn.']
    return dict(ok=True,planHash=p['plan_hash'],targetPoses=p['target_json'],contacts=p['contacts'],handTargets={str(i):{side:q.tolist() for side,q in controls.hand_targets(p['targets'][i],controls.person(p['settings'],i),p['source'].size).items()} for i in p['targets']},overlay=makeup.encode(Image.fromarray(tint)),allowedMask=makeup.encode(p['allowed']),control=makeup.encode(p['control']),warnings=warnings)


def refine_faces(candidate,p,env,active,progress):
    settings=p['settings']
    if not any(controls.face_requested(controls.person(settings,i)) for i in p['targets']):return candidate
    faces=detect_faces(candidate,env);used=set()
    for i,q in p['targets'].items():
        individual=controls.person(settings,i)
        if not controls.face_requested(individual):continue
        available=[j for j in range(len(faces)) if j not in used]
        if not available:raise ValueError('Kết quả không còn đủ khuôn mặt rõ để áp dụng biểu cảm. Đổi seed hoặc giảm thay đổi tư thế.')
        index=min(available,key=lambda j:np.linalg.norm(faces[j][1]/candidate.size-q[0,:2]));used.add(index)
        face_settings={**individual,'count':1,'variantOffset':0}
        if settings['pose']=='look_each_other':
            other=next(v for key,v in p['targets'].items() if key!=i);face_settings['yaw']=15 if other[0,0]<q[0,0] else -15;face_settings['gazeX']=-.6 if other[0,0]<q[0,0] else .6
        reference=None
        if settings['useReferenceExpression']:
            rs,rp,rf=p['reference'];reference=(rs,rf[rp['faceIndex']])
        candidates=env.get('character_face',runtime.face_candidates)(candidate,faces[index],face_settings,env,active,progress,reference)
        try:edited=next(candidates)
        finally:candidates.close()
        points=faces[index];box=np.r_[points.min(axis=0),points.max(axis=0)]/[*candidate.size,*candidate.size]
        face_mask=geometry.allowed_mask([dict(faceBox=box.tolist())],{0:q},candidate.size,'face')
        _,candidate,_=enhancement.composite(candidate,edited,face_mask,dict(method='character',scale=1))
    return candidate


def run(body,env):
    started=time.perf_counter();job_id=str(body.get('jobId',''))[:80]
    active=lambda:env['ensure_job_active'](job_id);update=lambda **kw:env['update_job'](job_id,**kw)
    active();update(status='running',taskType='character',stage='character-validating',sourceId=body.get('sampleId'),results=[])
    env['persist_job_request'](job_id,'character',body)
    p=prepare(body,env);settings=p['settings'];active()
    if body.get('planHash')!=p['plan_hash']:raise ValueError('Thiết lập hoặc vùng bảo vệ đã đổi. Kiểm tra lại bản xem trước vùng tác động.')
    config=env.get('character_configuration',runtime.configuration)(env['ROOT'])
    needs_face=settings['mode']=='face' or any(controls.face_requested(controls.person(settings,i)) for i in p['targets'])
    if needs_face and not config['faceReady']:raise ValueError('Chưa chuẩn bị xong bộ xử lý khuôn mặt. Chạy scripts/setup-character.py.')
    if settings['mode']!='face' and not config['bodyReady']:raise ValueError('Chưa chuẩn bị xong bộ xử lý tư thế. Chạy scripts/setup-character.py.')
    source=p['source'];progress=lambda i,n:update(stage='character-processing',completedSteps=i,totalWorkSteps=n)
    update(stage='character-loading',totalVariants=settings['count'],completedSteps=0,totalWorkSteps=settings['count'])
    if settings['mode']=='face':
        person=p['people'][settings['personIds'][0]];reference=None
        if settings['useReferenceExpression']:
            rs,rp,rf=p['reference'];reference=(rs,rf[rp['faceIndex']])
        candidates=env.get('character_face',runtime.face_candidates)(source,p['faces'][person['faceIndex']],controls.person(settings,settings['personIds'][0]),env,active,progress,reference)
    elif settings['pose']=='look_each_other':candidates=(source.copy() for _ in range(settings['count']))
    else:candidates=env.get('character_body',runtime.body_candidates)(source,p['control'],p['allowed'],p['people'],p['targets'],settings,env,active,progress)
    folder=env['OUTPUTS']/'character'/uuid.uuid4().hex[:20];relative=lambda f:f.relative_to(env['ROOT']).as_posix();items=[]
    saved={**settings,'targetPoses':p['target_json'],'referenceId':body.get('referenceId'),'referenceSha256':body.get('referenceSha256'),'referencePersonId':body.get('referencePersonId'),'plannedDescription':body.get('plannedDescription',''),'limitSelection':bool(body.get('limitSelection',False))}
    env['JOBS_DIR'].mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='character-',dir=env['JOBS_DIR']) as temporary:
        stage=Path(temporary)
        try:
            for index,candidate in enumerate(candidates):
                active();update(stage='character-checking')
                if candidate.size!=source.size:raise RuntimeError('Kích thước kết quả không khớp ảnh nguồn.')
                quality_metrics=dict(available=False,reason='disabled' if not settings['qualityRecovery'] else 'parser-unavailable')
                if settings['mode']!='face' and settings['qualityRecovery']:
                    if quality.available(env['ROOT']):
                        active();candidate,quality_metrics=quality.recover(source,candidate,p['people'],p['targets'],p['allowed'],env['ROOT'],settings['clothing']);active()
                    candidate=quality.match_boundary(source,candidate,p['allowed'])
                if settings['mode']!='face':candidate=refine_faces(candidate,p,env,active,lambda *_:active())
                feather=max(4,min(source.size)*.018) if settings['mode']!='face' else max(3,min(source.size)*.006)
                _,result,metrics=enhancement.composite(source,candidate,p['allowed'],dict(method='character',scale=1,feather=feather))
                if settings['mode']!='face':
                    metrics['targetPose']=geometry.pose_score(p['targets'],env['detect_people_pose'](result),source.size)
                    if not metrics['targetPose']['available']:raise ValueError('Không nhận diện đủ nhân vật trong ảnh tạo ra. Kết quả lỗi chưa được lưu; thử mức Chi tiết hoặc đổi seed.')
                else:
                    metrics['faceDetected']=bool(detect_faces(result,env))
                    if not metrics['faceDetected']:raise ValueError('Không còn nhận diện được mặt sau chỉnh sửa. Giảm góc đầu hoặc mức biểu cảm và thử lại.')
                metrics['garmentRecovery']=quality_metrics
                metrics['handControl']={'requested':any(controls.hand_targets(q,controls.person(settings,i),source.size) for i,q in p['targets'].items()),'verified':False}
                metrics.update(identityVerified=False,clothingVerified=False,contactVerified=False,requiresVisualReview=True)
                if p['alpha'] is not None:result.putalpha(p['alpha'])
                crop=p['allowed'].getbbox() if settings['preview'] and settings['mode']=='face' else None
                if crop:result=result.crop(crop)
                seed=settings['seed']+index;result.save(stage/f'result_seed_{seed}.png')
                items.append(dict(kind='character',seed=seed,sampleId=body['sampleId'],file=relative(folder/f'result_seed_{seed}.png'),comparisonFile=relative(folder/'comparison.png'),width=result.width,height=result.height,settings=saved,metrics=metrics,previewOnly=settings['preview'],crop=crop,sourceSha256=p['sha'],variantIndex=settings['variantOffset']+index,parentFile=body.get('parentFile'),label=f"Phương án {settings['variantOffset']+index+1}"))
        finally:
            if hasattr(candidates,'close'):candidates.close()
        if len(items)!=settings['count']:raise RuntimeError('Chưa tạo đủ số phương án. Kết quả chưa được công bố.')
        active();update(stage='character-saving')
        original=source.copy()
        if p['alpha'] is not None:original.putalpha(p['alpha'])
        original.save(stage/'source.png');(original.crop(items[0]['crop']) if items[0]['crop'] else original).save(stage/'comparison.png')
        p['allowed'].save(stage/'applied_mask.png');p['protected'].save(stage/'protected_mask.png');p['control'].save(stage/'target_pose.png')
        enhancement.read_mask(body.get('editableMask'),source.size).save(stage/'editable_mask.png')
        report=dict(ok=True,version=2,taskType='character',directory=relative(folder),results=items,sourceSha256=p['sha'],source=body['sampleId'],settings=saved,planHash=p['plan_hash'],contacts=p['contacts'],durationSeconds=round(time.perf_counter()-started,3),previewOnly=settings['preview'])
        (stage/'metadata.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        active();folder.parent.mkdir(parents=True,exist_ok=True);stage.rename(folder)
    for item in items:update(_result=item)
    update(status='completed',stage='done',completedSteps=settings['count'],totalWorkSteps=settings['count'],durationSeconds=report['durationSeconds'])
    return report
