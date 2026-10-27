from prompt_catalog import prompt_text, prompt_template, catalog_value, CatalogMap, read_catalog
"""Validated character plans, COCO joints, OpenPose controls and target-based QA."""
import math
import colorsys
import character_controls as controls
import cv2
import numpy as np
from PIL import Image

EXPRESSIONS = CatalogMap("featurePresets", 'character.expressions')
POSES = CatalogMap("featurePresets", 'character.poses')
INTERACTIONS = {'handshake','handover','look_each_other','group'}
JOINTS = ['Mũi','Mắt trái','Mắt phải','Tai trái','Tai phải','Vai trái','Vai phải','Khuỷu trái','Khuỷu phải','Cổ tay trái','Cổ tay phải','Hông trái','Hông phải','Gối trái','Gối phải','Cổ chân trái','Cổ chân phải']
EDGES = [(5,6),(5,7),(7,9),(6,8),(8,10),(5,11),(6,12),(11,12),(11,13),(13,15),(12,14),(14,16),(0,1),(0,2),(1,3),(2,4)]
ACTION_PROMPTS = CatalogMap("featurePresets", 'character.actions')

def number(value, name, low, high):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not low<=value<=high:
        raise ValueError(f'{name} phải từ {low} đến {high}.')
    return float(value)

def options(body):
    mode=body.get('mode','face');pose=body.get('pose','keep');expression=body.get('expression','keep')
    if mode not in ('face','body','interaction') or pose not in POSES or expression not in EXPRESSIONS: raise ValueError('Tác vụ, tư thế hoặc biểu cảm không hợp lệ.')
    ids=body.get('personIds',[])
    if not isinstance(ids,list) or not 1<=len(ids)<=4 or any(type(i)!=int or i<0 for i in ids) or len(set(ids))!=len(ids): raise ValueError('Chọn từ một đến bốn nhân vật khác nhau.')
    ids=sorted(ids)
    if mode=='face' and len(ids)!=1: raise ValueError('Chỉnh khuôn mặt từng người một.')
    if mode=='interaction' and (len(ids)<2 or pose not in INTERACTIONS): raise ValueError('Chọn ít nhất hai người và một kiểu tương tác.')
    if pose in ('handshake','handover','look_each_other') and len(ids)!=2: raise ValueError('Tương tác này cần đúng hai nhân vật.')
    if mode!='interaction' and pose in INTERACTIONS: raise ValueError('Chọn chế độ tương tác nhiều nhân vật.')
    count=body.get('count',2)
    if type(count)!=int or count not in (1,2,3,4): raise ValueError('Số phương án phải từ một đến bốn.')
    seed=body.get('seed',42)
    if type(seed)!=int or not 0<=seed<=2147483643: raise ValueError('Seed không hợp lệ.')
    description=body.get('description','');prompt=body.get('prompt','')
    if not isinstance(description,str) or not isinstance(prompt,str) or len(description)>2000 or len(prompt)>2000: raise ValueError('Mô tả quá dài.')
    if description.strip() and body.get('plannedDescription')!=description: raise ValueError('Mô tả đã đổi. Đọc lại mô tả và kiểm tra kế hoạch trước khi tạo.')
    pipeline=body.get('pipeline','disabled' if mode=='face' else 'sdxl-openpose')
    if mode=='face':
        if pipeline not in ('disabled','sdxl-openpose','sd35-pose-hybrid'):raise ValueError('Pipeline tư thế không hợp lệ.')
        pipeline='disabled'
    elif pipeline=='disabled':
        raise ValueError('Chỉnh tư thế hiện chưa khả dụng. Bạn vẫn có thể chỉnh khuôn mặt và hướng nhìn.')
    elif pipeline not in ('sdxl-openpose','sd35-pose-hybrid'):raise ValueError('Pipeline tư thế không hợp lệ.')
    anatomy_quality=body.get('anatomyQuality','balanced')
    if anatomy_quality not in ('balanced','enhanced','strict'):raise ValueError('Mức kiểm tra giải phẫu không hợp lệ.')
    result=dict(mode=mode,pose=pose,expression=expression,pipeline=pipeline,personIds=ids,count=count,seed=seed,description=description,prompt=prompt,
        anatomyQuality=anatomy_quality,
        intensity=number(body.get('intensity',.6),'Mức biểu cảm',0,1),yaw=number(body.get('yaw',0),'Xoay đầu',-20,20),pitch=number(body.get('pitch',0),'Cúi/ngẩng',-15,15),roll=number(body.get('roll',0),'Nghiêng đầu',-15,15),
        gazeX=number(body.get('gazeX',0),'Hướng nhìn ngang',-1,1),gazeY=number(body.get('gazeY',0),'Hướng nhìn dọc',-1,1),
        identity=number(body.get('identity',.65),'Giữ diện mạo',0,1),clothing=number(body.get('clothing',.45),'Giữ trang phục',0,1),
        steps=int(number(body.get('steps',28),'Số bước',12,50)),resolution=int(number(body.get('resolution',768),'Độ phân giải',512,1024)))
    for key in ('preview','useReferencePose','useReferenceExpression','keepFace'):
        default=key=='keepFace'
        if type(body.get(key,default)) is not bool: raise ValueError('Tùy chọn không hợp lệ: '+key)
        result[key]=body.get(key,default)
    return controls.validate(body,result,POSES,EXPRESSIONS,number)

def validate_joints(points):
    try: p=np.asarray(points,dtype=float)
    except (ValueError,TypeError): raise ValueError('Tọa độ khớp không hợp lệ.')
    if p.shape!=(17,3) or not np.isfinite(p).all() or (p<0).any() or (p>1).any(): raise ValueError('Cần 17 khớp với tọa độ và độ tin cậy từ 0 đến 1.')
    return p.copy()

def preset_joints(points, preset, side='right'):
    p=validate_joints(points);q=p.copy()
    if preset in ('keep','custom','look_each_other','handshake','handover'): return q
    if preset=='group':preset='relaxed'
    if min(p[5,2],p[6,2],p[11,2],p[12,2])<.3: raise ValueError('Chưa thấy đủ vai/hông. Dùng ảnh rõ hoặc chỉnh tư thế theo ảnh tham chiếu.')
    center=(p[5,:2]+p[6,:2])/2;hip=(p[11,:2]+p[12,:2])/2
    width=max(.06,np.linalg.norm(p[5,:2]-p[6,:2]));height=max(.12,np.linalg.norm(hip-center));direction=1 if p[5,0]>p[6,0] else -1
    def put(i,x,y):q[i]=[center[0]+direction*x*width,center[1]+y*height,1]
    if preset=='relaxed':
        for i,x,y in [(7,.65,.55),(9,.63,1.15),(8,-.65,.55),(10,-.63,1.15)]:put(i,x,y)
    elif preset=='hands_hips':
        for i,x,y in [(7,.85,.55),(9,.4,.9),(8,-.85,.55),(10,-.4,.9)]:put(i,x,y)
    elif preset=='crossed_arms':
        for i,x,y in [(7,.6,.65),(9,-.3,.35),(8,-.6,.65),(10,.3,.45)]:put(i,x,y)
    elif preset in ('wave','point','thumbs_up','peace','touch_hair','hand_chest'):
        coords={'wave':(-.9,.15,-.9,-.3),'point':(-1.05,.1,-1.65,.05),'thumbs_up':(-.8,.45,-.7,-.05),'peace':(-.75,.2,-.65,-.35),'touch_hair':(-1,.05,-.35,-.5),'hand_chest':(-.7,.6,-.05,.3)}[preset]
        if side in ('right','both'):put(8,*coords[:2]);put(10,*coords[2:])
        if side in ('left','both'):put(7,-coords[0],coords[1]);put(9,-coords[2],coords[3])
    elif preset in ('read','hold_cup','show_product'):
        for i,x,y in [(7,.65,.6),(9,.2,.45),(8,-.65,.6),(10,-.2,.45)]:put(i,x,y)
    elif preset in ('walk','run','jump','sit'):
        if min(p[13:,2])<.3: raise ValueError('Cần nhìn thấy đầu gối và bàn chân để đổi hành động toàn thân.')
        poses={'walk':[(7,.65,.4),(9,.6,1),(8,-.6,.55),(10,-.2,.2),(13,.5,1.7),(15,.7,2.5),(14,-.35,1.75),(16,-.55,2.35)],
               'run':[(7,.7,.5),(9,.3,.1),(8,-.7,.2),(10,-.4,-.3),(13,.7,1.45),(15,.1,1.9),(14,-.3,1.9),(16,-.8,2.05)],
               'jump':[(7,.9,-.3),(9,1.1,-.8),(8,-.9,-.3),(10,-1.1,-.8),(13,.65,1.65),(15,.95,2.1),(14,-.65,1.65),(16,-.95,2.1)],
               'sit':[(7,.55,.65),(9,.5,1.05),(8,-.55,.65),(10,-.5,1.05),(13,.65,1.3),(15,.65,2),(14,-.65,1.3),(16,-.65,2)]}
        for i,x,y in poses[preset]:put(i,x,y)
    if ((q[q[:,2]>.25,:2]<.01)|(q[q[:,2]>.25,:2]>.99)).any(): raise ValueError('Tư thế vượt khung ảnh. Mở rộng ảnh hoặc chỉnh khớp vào trong khung.')
    return q

def transfer_pose(reference, original):
    r=validate_joints(reference);p=validate_joints(original)
    if min(r[5,2],r[6,2],r[11,2],r[12,2],p[5,2],p[6,2],p[11,2],p[12,2])<.3: raise ValueError('Ảnh mẫu cần nhìn rõ vai và hông.')
    rc=(r[11,:2]+r[12,:2])/2;pc=(p[11,:2]+p[12,:2])/2
    rs=np.linalg.norm((r[5,:2]+r[6,:2])/2-rc);ps=np.linalg.norm((p[5,:2]+p[6,:2])/2-pc)
    # Normalize horizontal span separately: a portrait reference and a wide
    # group photograph use different normalized x coordinates.
    rw=np.linalg.norm(r[5,:2]-r[6,:2]);pw=np.linalg.norm(p[5,:2]-p[6,:2])
    r[:,:2]=(r[:,:2]-rc)*[pw/max(rw,.01),ps/max(rs,.01)]+pc
    if ((r[r[:,2]>.25,:2]<0)|(r[r[:,2]>.25,:2]>1)).any(): raise ValueError('Tư thế tham chiếu vượt khung ảnh đích.')
    return np.clip(r,0,1)

def interaction_targets(people,targets,pose):
    if pose not in ('handshake','handover'):return targets,[]
    ids=sorted(targets,key=lambda i:people[i]['box'][0]);a,b=ids
    qa,qb=targets[a],targets[b]
    ca=np.mean(qa[[5,6],:2],axis=0);cb=np.mean(qb[[5,6],:2],axis=0)
    contact=(ca+cb)/2;contact[1]+=.1
    contacts=[]
    for key,q,c,other in [(a,qa,ca,cb),(b,qb,cb,ca)]:
        shoulder=min((5,6),key=lambda j:abs(q[j,0]-other[0]));elbow=shoulder+2;wrist=shoulder+4
        q[wrist]=[*contact,1];q[elbow]=[*((q[shoulder,:2]+contact)/2+np.array([0,.05])),1]
        contacts.append(dict(personId=key,joint=wrist,x=float(contact[0]),y=float(contact[1])))
    return targets,contacts

def draw_pose(targets,size,gesture='keep',settings=None):
    w,h=size;canvas=np.zeros((h,w,3),np.uint8)
    # OpenPose's 18-joint ordering and palette, with the thicker xinsir lines.
    colors=[(255,0,0),(255,85,0),(255,170,0),(255,255,0),(170,255,0),(85,255,0),(0,255,0),(0,255,85),(0,255,170),(0,255,255),(0,170,255),(0,85,255),(0,0,255),(85,0,255),(170,0,255),(255,0,255),(255,0,170),(255,0,85)]
    limbs=[(1,2),(1,5),(2,3),(3,4),(5,6),(6,7),(1,8),(8,9),(9,10),(1,11),(11,12),(12,13),(1,0),(0,14),(14,16),(0,15),(15,17)]
    for index,raw in targets.items():
        p=validate_joints(raw);neck=(p[5]+p[6])/2;neck[2]=min(p[5,2],p[6,2])
        q=np.vstack([p[0],neck,p[[6,8,10,5,7,9,12,14,16,11,13,15,2,1,4,3]]]);xy=np.rint(q[:,:2]*[w,h]).astype(int)
        ratio=1 if max(w,h)<500 else 2 if max(w,h)<1000 else 3 if max(w,h)<2000 else max(3,round(max(w,h)/700))
        radius=4*ratio;thickness=8*ratio
        for k,(a,b) in enumerate(limbs):
            if min(q[a,2],q[b,2])>.25:cv2.line(canvas,tuple(xy[a]),tuple(xy[b]),tuple(round(c*.6) for c in colors[k]),thickness,cv2.LINE_AA)
        for k,point in enumerate(xy):
            if q[k,2]>.25:cv2.circle(canvas,tuple(point),radius,colors[k],-1,cv2.LINE_AA)
        hand_settings=controls.person(settings,index) if settings else dict(pose=gesture,handSide='right')
        for hand in controls.hand_targets(p,hand_settings,size).values():
            xy_hand=np.rint(hand*[w,h]).astype(int)
            for finger in range(5):
                last=xy_hand[0]
                for joint in range(4):
                    point=xy_hand[1+finger*4+joint]
                    color=tuple(round(c*255) for c in colorsys.hsv_to_rgb((finger*4+joint)/20,1,1))
                    cv2.line(canvas,tuple(last),tuple(point),color,max(1,radius//2),cv2.LINE_AA);last=point
    return Image.fromarray(canvas)

def allowed_mask(people,targets,size,mode,protection=None,pose='keep',settings=None):
    w,h=size;mask=np.zeros((h,w),np.uint8);selected=set(targets)
    for index,q in targets.items():
        person=people[index];individual=controls.person(settings,index) if settings is not None else None
        action=individual['pose'] if individual else pose
        if mode=='face':
            if not person.get('faceBox'):raise ValueError('Không tìm thấy mặt rõ của nhân vật này.')
            box=np.array(person['faceBox'])*[w,h,w,h];pad=max(12,(box[2]-box[0])*.32)
            x,y,r,b=box+[ -pad,-pad,pad,pad*.7]
            cv2.ellipse(mask,(int((x+r)/2),int((y+b)/2)),(max(1,int((r-x)/2)),max(1,int((b-y)/2))),0,0,360,255,-1)
        else:
            original=validate_joints(person['keypoints'])
            points=q[q[:,2]>.25,:2]*[w,h]
            if len(points)<6:raise ValueError('Không đủ khớp nhìn thấy cho tư thế đích.')
            shoulder_width=np.linalg.norm((original[5,:2]-original[6,:2])*[w,h])
            moved=np.linalg.norm((q[:,:2]-original[:,:2])*[w,h],axis=1)>max(2,min(w,h)*.006)
            for a,b in EDGES:
                if not (moved[a] or moved[b]):continue
                radius=max(14,int(shoulder_width*(.6 if (a,b) in [(5,6),(5,11),(6,12),(11,12)] else .28 if a>=11 else .25)))
                for skeleton in (original,q):
                    if min(skeleton[a,2],skeleton[b,2])>.25:
                        limb_radius=max(radius,int(shoulder_width*.43)) if skeleton is original and a in (5,6,7,8) and b in (7,8,9,10) else radius
                        aa=tuple((skeleton[a,:2]*[w,h]).astype(int));bb=tuple((skeleton[b,:2]*[w,h]).astype(int))
                        cv2.line(mask,aa,bb,255,limb_radius*2);cv2.circle(mask,aa,limb_radius,255,-1);cv2.circle(mask,bb,limb_radius,255,-1)
            # A stationary skeleton can still request object/gesture synthesis.
            for j in (9,10):
                side='left' if j==9 else 'right'
                stationary=individual is None or action in ('read','hold_cup','show_product','handshake','handover') or (action in ('wave','point','thumbs_up','peace') and individual.get('handSide') in (side,'both')) or individual.get('hands',{}).get(side,{}).get('gesture','auto')!='auto'
                if q[j,2]>.25 and (moved[j] or not moved.any() and stationary):cv2.circle(mask,tuple((q[j,:2]*[w,h]).astype(int)),max(20,int(shoulder_width*.4)),255,-1)
                if moved[j] and min(q[j,2],q[j-2,2])>.25:
                    wrist=q[j,:2]*[w,h];forearm=(q[j,:2]-q[j-2,:2])*[w,h]
                    tip=wrist+forearm/max(1,np.linalg.norm(forearm))*shoulder_width*.6
                    radius=max(18,int(shoulder_width*.35));cv2.line(mask,tuple(wrist.astype(int)),tuple(tip.astype(int)),255,radius*2);cv2.circle(mask,tuple(tip.astype(int)),radius,255,-1)
                if moved[j] and original[j,2]>.25:
                    wrist=original[j,:2]*[w,h];elbow=original[j-2,:2]*[w,h];tip=wrist+(wrist-elbow)*.65
                    radius=max(18,int(shoulder_width*.3));cv2.line(mask,tuple(wrist.astype(int)),tuple(tip.astype(int)),255,radius*2);cv2.circle(mask,tuple(tip.astype(int)),radius,255,-1)
            for ankle,knee in ((15,13),(16,14)):
                if moved[ankle] and original[ankle,2]>.25:
                    foot=original[ankle,:2]*[w,h];toe=foot+(foot-original[knee,:2]*[w,h])*.35
                    cv2.line(mask,tuple(foot.astype(int)),tuple(toe.astype(int)),255,max(24,int(shoulder_width*.6)))
                if moved[ankle] and q[ankle,2]>.25:
                    foot=q[ankle,:2]*[w,h]
                    cv2.ellipse(mask,tuple(foot.astype(int)),(max(18,int(shoulder_width*.45)),max(18,int(shoulder_width*.3))),0,0,360,255,-1)
            if moved[11:].any():
                # Old trousers/skirt and shoes extend beyond the joint lines.
                # Cover their whole source region to avoid residual legs after
                # sitting, jumping or moving hips. Other people are cut out below.
                x,y,r,b=np.asarray(person['box'])*[w,h,w,h]
                hip_y=float(np.min(original[[11,12],1])*h)-shoulder_width*.15
                cv2.rectangle(mask,(max(0,int(x-shoulder_width*.1)),max(0,int(hip_y))),
                    (min(w-1,int(r+shoulder_width*.1)),min(h-1,int(b+shoulder_width*.15))),255,-1)
            if action in ('read','hold_cup','show_product','handover'):
                hands=q[[9,10],:2]*[w,h];center=hands.mean(axis=0);radius=shoulder_width*(.45 if action=='hold_cup' else .65)
                cv2.ellipse(mask,tuple(center.astype(int)),(max(18,int(radius)),max(18,int(radius*.75))),0,0,360,255,-1)
            if action=='sit':
                hip=q[[11,12],:2].mean(axis=0)*[w,h];knee=q[[13,14],:2].mean(axis=0)*[w,h]
                cv2.rectangle(mask,tuple((hip-[shoulder_width*.65,10]).astype(int)),tuple((knee+[shoulder_width*.65,shoulder_width*.65]).astype(int)),255,-1)
    # Unselected people are explicitly protected, even in an overlapping edit box.
    for index,person in enumerate(people):
        if index in selected:continue
        x,y,r,b=np.rint(np.array(person['box'])*[w,h,w,h]).astype(int);mask[max(0,y):min(h,b),max(0,x):min(w,r)]=0
    if protection is not None:mask[np.asarray(protection)>0]=0
    if not mask.any() and settings is None:raise ValueError('Vùng bảo vệ che hết vùng thay đổi.')
    return Image.fromarray(mask)


def stationary_torso_mask(people, targets, size):
    """Keep unmoved shirt fronts while allowing old/new arms to cross them.

    Broad old-limb removal bands otherwise regenerate a tucked shirt as an
    open jacket. This mask is geometry only: it never copies a moving sleeve
    or covers a requested crossing arm, including another selected person's.
    """
    w,h=size;keep=np.zeros((h,w),np.uint8);arms=np.zeros_like(keep)
    for index,q in targets.items():
        p=np.asarray(people[index]['keypoints']);q=np.asarray(q)
        moved=np.linalg.norm((q[:,:2]-p[:,:2])*[w,h],axis=1)>max(2,min(w,h)*.006)
        span=np.linalg.norm((p[5,:2]-p[6,:2])*[w,h])
        if np.all(p[[5,6,11,12],2]>.4) and not moved[[5,6,11,12]].any():
            torso=np.zeros_like(keep)
            cv2.fillConvexPoly(torso,np.rint(p[[5,6,12,11],:2]*[w,h]).astype(np.int32),255)
            radius=max(2,round(span*.05))
            torso=cv2.erode(torso,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(radius*2+1,)*2))
            keep=np.maximum(keep,torso)
        for a,b in ((5,7),(7,9),(6,8),(8,10)):
            if not (moved[a] or moved[b]):continue
            for skeleton,scale in ((p,.22),(q,.30)):
                if min(skeleton[a,2],skeleton[b,2])<.3:continue
                start,end=np.rint(skeleton[[a,b],:2]*[w,h]).astype(int)
                radius=max(12,round(span*scale))
                cv2.line(arms,tuple(start),tuple(end),255,radius*2)
                cv2.circle(arms,tuple(end),radius,255,-1)
                if b in (9,10):
                    tip=end+(end-start)*.5
                    cv2.line(arms,tuple(end),tuple(np.rint(tip).astype(int)),255,max(24,round(span*.8)))
    keep[arms>0]=0
    return Image.fromarray(keep)

def pose_score(targets,result_people,size):
    from scipy.optimize import linear_sum_assignment
    target=list(targets.values());observed=[];w,h=size
    for person in result_people:
        p=np.asarray(person.get('keypoints',[]),dtype=float)
        if p.shape==(17,3):p[:,:2]/=[w,h];observed.append(p)
    if not observed:return dict(available=False,passed=False,reason='Không nhận diện được tư thế kết quả; cần duyệt trực quan.')
    costs=np.ones((len(target),len(observed)))*10
    for i,a in enumerate(target):
        for j,b in enumerate(observed):
            valid=(a[:,2]>.35)&(b[:,2]>.35);valid[:5]=False
            if valid.sum()>=4:costs[i,j]=float(np.mean(np.linalg.norm((a[valid,:2]-b[valid,:2])*[w,h],axis=1))/math.hypot(w,h))
    rows,cols=linear_sum_assignment(costs);errors=[float(costs[i,j]) for i,j in zip(rows,cols)]
    coverage=[]
    for i,j in zip(rows,cols):
        expected=target[i][:,2]>.35;expected[:5]=False
        coverage.append(float(((observed[j][:,2]>.35)&expected).sum()/max(1,expected.sum())))
    available=len(rows)==len(target) and all(e<10 for e in errors)
    return dict(available=available,passed=available and min(coverage,default=0)>=.85 and max(errors,default=10)<.06,meanTargetError=float(np.mean(errors)),perPerson=errors,jointCoverage=coverage,scope='visible-target-joints',needsVisualReview=True)
