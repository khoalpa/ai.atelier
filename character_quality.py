"""Conservative garment recovery, regional reference masks and boundary matching.

Recovery is limited to intersections of parsed garments and bone-aligned source
fabric. Faces, skin, props, background and protected pixels are never copied.
"""
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

PARSER='models/tryon/IDM-VTON/humanparsing/parsing_atr.onnx'
_session=None


def available(root):
    import importlib.util
    return (Path(root)/PARSER).is_file() and importlib.util.find_spec('onnxruntime') is not None


def parse(image,root):
    global _session
    import onnxruntime as ort
    if _session is None:
        options=ort.SessionOptions();options.intra_op_num_threads=4
        _session=ort.InferenceSession(str(Path(root)/PARSER),sess_options=options,providers=['CPUExecutionProvider'])
    w,h=image.size;extent=max(w-1,h-1,1);scale=512/extent
    matrix=np.float32([[scale,0,256-(w-1)*scale/2],[0,scale,256-(h-1)*scale/2]])
    pixels=cv2.warpAffine(np.asarray(image.convert('RGB'))[:,:,::-1],matrix,(512,512))
    tensor=((pixels.astype(np.float32)/255-[.406,.456,.485])/[.225,.224,.229]).transpose(2,0,1)[None].astype(np.float32)
    logits=_session.run(None,{_session.get_inputs()[0].name:tensor})[1][0]
    # Match the parser's align_corners=True resize before restoring coordinates.
    import torch
    logits=torch.nn.functional.interpolate(torch.from_numpy(logits)[None],size=(512,512),mode='bilinear',align_corners=True)[0].numpy().transpose(1,2,0)
    scores=cv2.warpAffine(logits,cv2.invertAffineTransform(matrix),(w,h),flags=cv2.INTER_LINEAR)
    labels=scores.argmax(axis=2).astype(np.uint8)
    ordered=np.partition(scores,-2,axis=2);confidence=(ordered[:,:,-1]-ordered[:,:,-2])>.6
    return labels,confidence


def skeleton_distance(points,size):
    w,h=size;mask=np.ones((h,w),np.uint8)*255;p=np.asarray(points)
    for a,b in [(5,6),(5,11),(6,12),(11,12),(5,7),(7,9),(6,8),(8,10),(11,13),(13,15),(12,14),(14,16)]:
        if min(p[a,2],p[b,2])>.25:cv2.line(mask,tuple(np.rint(p[a,:2]*[w,h]).astype(int)),tuple(np.rint(p[b,:2]*[w,h]).astype(int)),0,2)
    return cv2.distanceTransform(mask,cv2.DIST_L2,3)


def ownership(targets,size):
    distances=np.stack([skeleton_distance(q,size) for q in targets.values()])
    owner=distances.argmin(axis=0);result={}
    for n,(index,q) in enumerate(targets.items()):
        span=np.linalg.norm((q[5,:2]-q[6,:2])*size)
        result[index]=(owner==n)&(distances[n]<max(16,span*.8))
    return result


def segment_matrix(a,b,c,d):
    v=b-a;u=d-c;length=np.linalg.norm(v);other=np.linalg.norm(u)
    if min(length,other)<5 or not .45<other/length<2.2:return None
    perp=np.array([-v[1],v[0]]);other_perp=np.array([-u[1],u[0]])
    return cv2.getAffineTransform(np.float32([a,b,a+perp]),np.float32([c,d,c+other_perp]))


def recover(source,candidate,people,targets,mask,root,amount=.45,parser=None):
    if max(source.size)>1280 and parser is None:
        factor=1280/max(source.size);size=tuple(round(v*factor) for v in source.size)
        small_source=source.resize(size,Image.Resampling.LANCZOS);small=candidate.resize(size,Image.Resampling.LANCZOS)
        result,metrics=recover(small_source,small,people,targets,mask.resize(size,Image.Resampling.NEAREST),root,amount)
        delta=np.asarray(result).astype(np.float32)-np.asarray(small).astype(np.float32)
        corrected=np.clip(np.asarray(candidate).astype(np.float32)+cv2.resize(delta,source.size),0,255).astype(np.uint8)
        return Image.fromarray(corrected),metrics
    parser=parser or (lambda image:parse(image,root));w,h=source.size
    original=np.asarray(source.convert('RGB'));out=np.asarray(candidate.convert('RGB')).copy()
    allowed=np.asarray(mask)>0;owners=ownership(targets,source.size);source_owners=ownership({i:np.asarray(people[i]['keypoints']) for i in targets},source.size);records=[]
    for index,target in targets.items():
        person=people[index];p=np.asarray(person['keypoints']);q=np.asarray(target)
        # Expand around both poses so a raised hand remains in the parsing crop.
        visible=np.vstack([p[p[:,2]>.25,:2],q[q[:,2]>.25,:2]])*[w,h]
        low=np.minimum(visible.min(axis=0)-max(w,h)*.04,np.asarray(person['box'][:2])*[w,h])
        high=np.maximum(visible.max(axis=0)+max(w,h)*.06,np.asarray(person['box'][2:])*[w,h])
        x,y=np.maximum(0,np.floor(low)).astype(int);r,b=np.minimum([w,h],np.ceil(high)).astype(int)
        labels0,conf0=parser(source.crop((x,y,r,b)));labels1,conf1=parser(candidate.crop((x,y,r,b)))
        src_labels=np.zeros((h,w),np.uint8);dst_labels=src_labels.copy();src_conf=src_labels.copy();dst_conf=src_labels.copy()
        src_labels[y:b,x:r]=labels0;dst_labels[y:b,x:r]=labels1;src_conf[y:b,x:r]=conf0;dst_conf[y:b,x:r]=conf1
        # Separate sleeves and trouser legs by their closest anatomical segment.
        parts=[(5,11,[4,7]),(6,12,[4,7]),(5,7,[4,7]),(7,9,[4,7]),(6,8,[4,7]),(8,10,[4,7]),(11,13,[5,6,7]),(13,15,[5,6,7]),(12,14,[5,6,7]),(14,16,[5,6,7]),(13,15,[9,10]),(14,16,[9,10])]
        def distances(points):
            stack=[]
            for a,b,_ in parts:
                binary=np.ones((h,w),np.uint8)*255
                if min(points[a,2],points[b,2])>.3:cv2.line(binary,tuple(np.rint(points[a,:2]*[w,h]).astype(int)),tuple(np.rint(points[b,:2]*[w,h]).astype(int)),0,1)
                stack.append(cv2.distanceTransform(binary,cv2.DIST_L2,3))
            return np.stack(stack)
        sd,td=distances(p),distances(q);copied=0;before=[];after=[]
        for part,(a,b,labels) in enumerate(parts):
            if min(p[a,2],p[b,2],q[a,2],q[b,2])<.3:continue
            competitors=[j for j,item in enumerate(parts) if set(item[2])&set(labels)]
            sm=np.isin(src_labels,labels)&(src_conf>0)&source_owners[index]&(sd[part]<=sd[competitors].min(axis=0)+.5)
            dm=np.isin(dst_labels,labels)&(dst_conf>0)&(td[part]<=td[competitors].min(axis=0)+.5)&allowed&owners[index]
            if min(sm.sum(),dm.sum())<40:continue
            matrix=segment_matrix(p[a,:2]*[w,h],p[b,:2]*[w,h],q[a,:2]*[w,h],q[b,:2]*[w,h])
            if matrix is None:continue
            warped=cv2.warpAffine(original,matrix,(w,h));wm=cv2.warpAffine(sm.astype(np.uint8),matrix,(w,h),flags=cv2.INTER_NEAREST)>0
            overlap=wm&dm
            if overlap.sum()<40:continue
            # Color correction respects original fabric variation, and bounded
            # texture recovery avoids pasting an entire old sleeve silhouette.
            src_med=np.median(original[sm],axis=0);dst_med=np.median(out[dm],axis=0)
            strength=min(.85,.35+amount*.65);delta=np.clip(src_med-dst_med,-180,180)
            corrected=np.clip(out.astype(np.float32)+delta*strength,0,255)
            core=cv2.distanceTransform(dm.astype(np.uint8),cv2.DIST_L2,3)
            alpha=np.minimum(core/max(2,min(w,h)*.006),1)*dm
            texture=warped.astype(np.float32)-cv2.GaussianBlur(warped.astype(np.float32),(0,0),2)
            corrected=np.clip(corrected+texture*min(.6,amount)*overlap[...,None],0,255)
            # A stationary torso has no reason to invent new embroidery or a
            # logo. Restore its original fabric where both parsers agree and
            # the nearest target limb is still the torso (so a crossing arm is
            # not erased). Moving sleeves get a softer bone-aligned transfer.
            moved=max(np.linalg.norm((p[j,:2]-q[j,:2])*[w,h]) for j in (a,b))
            fabric_core=cv2.distanceTransform(overlap.astype(np.uint8),cv2.DIST_L2,3)
            fabric_alpha=np.clip((fabric_core-1)/max(2,min(w,h)*.003),0,1)
            fabric_alpha*=1 if part in (0,1) and moved<2 else min(.75,.25+amount*.6)
            corrected=corrected*(1-fabric_alpha[...,None])+warped*fabric_alpha[...,None]
            old=out.copy();out=np.rint(out*(1-alpha[...,None])+corrected*alpha[...,None]).astype(np.uint8)
            before.append(float(np.linalg.norm(src_med-dst_med)));after.append(float(np.linalg.norm(src_med-np.median(out[dm],axis=0))));copied+=int(np.any(old!=out,axis=2).sum())
        records.append(dict(personId=index,recoveredPixels=copied,colorDistanceBefore=float(np.mean(before)) if before else None,colorDistanceAfter=float(np.mean(after)) if after else None))
    out[~allowed]=original[~allowed]
    return Image.fromarray(out),dict(available=True,scope='confident-parsed-garment-intersections',people=records)


def match_boundary(source,candidate,mask):
    original=np.asarray(source).astype(np.float32);generated=np.asarray(candidate).astype(np.float32);binary=(np.asarray(mask)>0).astype(np.uint8)
    width=max(3,min(source.size)*.008);distance=cv2.distanceTransform(binary,cv2.DIST_L2,3)
    ring=((distance>0)&(distance<width*.5)).astype(np.float32);weights=cv2.GaussianBlur(ring,(0,0),width)
    delta=cv2.GaussianBlur((original-generated)*ring[...,None],(0,0),width)/np.maximum(weights[...,None],1e-5)
    fade=np.clip(1-distance/(width*3),0,1)*binary
    out=np.clip(generated+np.clip(delta,-24,24)*fade[...,None],0,255).astype(np.uint8);out[binary==0]=original[binary==0].astype(np.uint8)
    return Image.fromarray(out)
