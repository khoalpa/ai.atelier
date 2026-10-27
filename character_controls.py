from prompt_catalog import prompt_text, prompt_template, catalog_value, CatalogMap, read_catalog
"""Per-person controls and 21-point hand targets in character coordinates."""
import math
import numpy as np

FACE_RANGES = {'intensity':(0,1),'yaw':(-20,20),'pitch':(-15,15),'roll':(-15,15),'gazeX':(-1,1),'gazeY':(-1,1)}
GESTURES = {'auto','open','fist','point','peace','thumbs_up','grip','custom'}


def validate(body, settings, poses, expressions, number):
    side=body.get('handSide','right')
    if side not in ('left','right','both'):raise ValueError('Chọn tay trái, phải hoặc cả hai của nhân vật.')
    settings['handSide']=side
    settings['qualityRecovery']=body.get('qualityRecovery',True)
    if type(settings['qualityRecovery']) is not bool:raise ValueError('Tùy chọn giữ chi tiết không hợp lệ.')
    raw=body.get('perPerson',{})
    if not isinstance(raw,dict) or set(raw)-{str(i) for i in settings['personIds']}:raise ValueError('Thiết lập riêng phải thuộc nhân vật đã chọn.')
    result={}
    for key,value in raw.items():
        if not isinstance(value,dict) or set(value)-{'pose','expression','handSide','hands',*FACE_RANGES}:raise ValueError('Thiết lập riêng không hợp lệ.')
        out={}
        for name,choices in [('pose',set(poses)-{'handshake','handover','look_each_other','group'}),('expression',expressions),('handSide',{'left','right','both'})]:
            if name in value:
                if value[name] not in choices:raise ValueError('Tư thế, biểu cảm hoặc bên tay không hợp lệ.')
                out[name]=value[name]
        for name,(low,high) in FACE_RANGES.items():
            if name in value:out[name]=number(value[name],name,low,high)
        hands=value.get('hands',{})
        if not isinstance(hands,dict) or set(hands)-{'left','right'}:raise ValueError('Bàn tay không hợp lệ.')
        out['hands']={}
        for hand,control in hands.items():
            if not isinstance(control,dict) or set(control)-{'gesture','fingers','spread','rotation','contact'}:raise ValueError('Điều khiển bàn tay không hợp lệ.')
            gesture=control.get('gesture','auto')
            if gesture not in GESTURES:raise ValueError('Cử chỉ bàn tay không hợp lệ.')
            item={'gesture':gesture,'spread':number(control.get('spread',.5),'Độ xòe ngón',0,1),'rotation':number(control.get('rotation',0),'Xoay cổ tay',-90,90)}
            fingers=control.get('fingers',[0]*5)
            if not isinstance(fingers,list) or len(fingers)!=5:raise ValueError('Cần đủ năm ngón tay.')
            item['fingers']=[number(v,'Độ co ngón',0,1) for v in fingers]
            contact=control.get('contact')
            if contact is not None:
                if not isinstance(contact,dict) or set(contact)!={'x','y'}:raise ValueError('Điểm tiếp xúc không hợp lệ.')
                item['contact']={k:number(contact[k],'Điểm tiếp xúc',.01,.99) for k in ('x','y')}
            out['hands'][hand]=item
        result[key]=out
    settings['perPerson']=result
    # An isolated retry retains the intensity of its original face variant.
    offset=body.get('variantOffset',0)
    if type(offset)!=int or not 0<=offset<=3 or offset+settings['count']>4:raise ValueError('Chỉ số phương án không hợp lệ.')
    settings['variantOffset']=offset
    return settings


def person(settings,index):
    result={**settings,**settings.get('perPerson',{}).get(str(index),{})}
    if settings['pose'] in ('handshake','handover','look_each_other'):result['pose']=settings['pose']
    return result


def face_requested(settings):
    return settings['expression']!='keep' or settings['useReferenceExpression'] or settings['pose']=='look_each_other' or any(settings[k] for k in FACE_RANGES if k!='intensity')


def hand_targets(points, settings, size):
    """Generate OpenPose hand geometry; flexion 0=extended, 1=curled."""
    w,h=size;p=np.asarray(points);result={}
    for side,wrist,elbow in [('left',9,7),('right',10,8)]:
        control=settings.get('hands',{}).get(side,{})
        gesture=control.get('gesture','auto')
        if gesture=='auto':
            if settings.get('handSide','right') not in (side,'both'):continue
            gesture={'wave':'open','point':'point','peace':'peace','thumbs_up':'thumbs_up','touch_hair':'open','hand_chest':'open','hands_hips':'open','crossed_arms':'open','show_product':'open','hold_cup':'grip','read':'grip','handover':'grip'}.get(settings['pose'])
        if not gesture or min(p[wrist,2],p[elbow,2])<.3:continue
        base=p[wrist,:2]*[w,h];direction=(p[wrist,:2]-p[elbow,:2])*[w,h];length=np.linalg.norm(direction)
        if length<5:continue
        angle=math.radians(control.get('rotation',0));up=np.array([[math.cos(angle),-math.sin(angle)],[math.sin(angle),math.cos(angle)]])@(direction/length)
        right=np.array([-up[1],up[0]])*(1 if side=='right' else -1)
        scale=min(length*.48,min(w,h)*.065);spread=control.get('spread',.5)
        flex={'open':[0]*5,'fist':[1]*5,'point':[.8,0,1,1,1],'peace':[.8,0,0,1,1],'thumbs_up':[0,1,1,1,1],'grip':[.65,.7,.8,.85,.9],'custom':control.get('fingers',[0]*5)}[gesture]
        joints=[base]
        for finger in range(5):
            lateral=(finger-2)*(.12+.16*spread)
            for joint in range(1,5):
                # Curled tips fold back toward the palm; thumb extends sideways.
                reach=(.22+joint*.21)*(1-flex[finger]*.68)
                reach-=max(0,joint-2)*flex[finger]*.07
                x=lateral*(.65+joint*.12)
                if finger==0:x-=joint*.12*(1-flex[finger]);reach*=.68
                joints.append(base+scale*(up*reach+right*x))
        normalized=np.asarray(joints)/[w,h]
        if (normalized<0).any() or (normalized>1).any():raise ValueError('Bàn tay vượt khung ảnh. Dời cổ tay vào trong hoặc mở rộng ảnh.')
        result[side]=normalized
    return result


def hand_prompt(settings):
    descriptions=CatalogMap("featurePresets", 'character.hands')
    result=[]
    for side,hand in settings.get('hands',{}).items():
        gesture=hand.get('gesture','auto')
        if gesture=='auto':continue
        if gesture=='custom':
            names=catalog_value('featurePresets','character.fingers');extended=[names[i] for i,v in enumerate(hand.get('fingers',[0]*5)) if v<.35]
            detail=(', '.join(extended)+prompt_text('character.extendedFingers')) if extended else prompt_text('character.curledFingers')
        else:detail=descriptions[gesture]
        result.append(side+prompt_text('character.handLabel')+detail)
    return result


def apply_contacts(targets,settings):
    contacts=[]
    for index,q in targets.items():
        s=person(settings,index)
        for side,control in s.get('hands',{}).items():
            if 'contact' not in control:continue
            wrist=9 if side=='left' else 10;point=control['contact'];old=q[wrist,:2].copy();new=np.array([point['x'],point['y']])
            q[wrist]=[*new,1];q[wrist-2,:2]=np.clip(q[wrist-2,:2]+(new-old)*.5,.01,.99)
            contacts.append(dict(personId=index,joint=wrist,**point))
    return contacts
