"""Local LivePortrait and SDXL OpenPose inference; no downloads during editing."""
import gc
import importlib
import json
import sys
import types
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

BASE = 'models/inpainting/stable-diffusion-xl-1.0-inpainting-0.1'
MODEL_ROOT = 'models/character'

def configuration(root):
    root=Path(root);base=root/MODEL_ROOT
    face_files=['liveportrait/base_models/'+n+'.pth' for n in ('appearance_feature_extractor','motion_extractor','warping_module','spade_generator')]+['liveportrait/retargeting_models/stitching_retargeting_module.pth']
    installed=(base/'installation.json').is_file()
    common_ready=(root/'models/makeup/face_landmarker.task').is_file()
    face_dependencies=all(importlib.util.find_spec(name) is not None for name in ('timm','einops','yaml','rich','mediapipe'))
    face_ready=installed and common_ready and face_dependencies and all((base/'liveportrait'/p).is_file() for p in face_files) and (root/'vendor/LivePortrait/src/live_portrait_wrapper.py').is_file()
    body_files=['sdxl-base/unet/diffusion_pytorch_model.fp16.safetensors','sdxl-base/unet/config.json','sdxl-base/scheduler/scheduler_config.json','openpose-sdxl/config.json','openpose-sdxl/diffusion_pytorch_model.safetensors','ip-adapter/models/image_encoder/model.safetensors','ip-adapter/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors','ip-adapter/sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors']
    shared_files=['model_index.json','vae/config.json','vae/diffusion_pytorch_model.fp16.safetensors']
    for part in ('text_encoder','text_encoder_2'):shared_files.extend([part+'/config.json',part+'/model.fp16.safetensors'])
    for part in ('tokenizer','tokenizer_2'):shared_files.extend([part+'/vocab.json',part+'/merges.txt',part+'/tokenizer_config.json',part+'/special_tokens_map.json'])
    body_ready=installed and common_ready and all((base/p).is_file() for p in body_files+['ip-adapter/models/image_encoder/config.json']) and all((root/BASE/p).is_file() for p in shared_files)
    return dict(version=1,faceReady=face_ready,bodyReady=body_ready,interactionReady=body_ready,maxPeople=4,maxPixels=16777216,offline=True)

def release(env):
    for name in ('release_inpaint','release_tryon','release_text_to_image'):
        if name in env:env[name]()
    gc.collect()
    if env['torch'].cuda.is_available():env['torch'].cuda.empty_cache()

def liveportrait(root):
    package='atelier_liveportrait'
    if package not in sys.modules:
        module=types.ModuleType(package);module.__path__=[str(Path(root)/'vendor/LivePortrait/src')];sys.modules[package]=module
    config_module=importlib.import_module(package+'.config.inference_config')
    wrapper_module=importlib.import_module(package+'.live_portrait_wrapper')
    config=config_module.InferenceConfig();directory=Path(root)/MODEL_ROOT/'liveportrait/liveportrait'
    for key,name in [('F','appearance_feature_extractor'),('M','motion_extractor'),('W','warping_module'),('G','spade_generator')]:setattr(config,'checkpoint_'+key,str(directory/'base_models'/f'{name}.pth'))
    config.checkpoint_S=str(directory/'retargeting_models/stitching_retargeting_module.pth')
    return wrapper_module.LivePortraitWrapper(config)

def aligned_face(source,points):
    eyes=[points[[33,133]].mean(axis=0),points[[263,362]].mean(axis=0)]
    eyes=sorted(eyes,key=lambda p:p[0]);mouth=points[[61,291]].mean(axis=0)
    matrix=cv2.getAffineTransform(np.float32([eyes[0],eyes[1],mouth]),np.float32([[90,105],[166,105],[128,164]]))
    crop=cv2.warpAffine(np.asarray(source),matrix,(256,256),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101)
    return crop,matrix

def face_candidates(source,points,settings,env,active,progress,reference=None):
    torch=env['torch'];release(env);active();wrapper=liveportrait(env['ROOT'])
    rotation=importlib.import_module('atelier_liveportrait.utils.camera').get_rotation_matrix
    try:
        crop,matrix=aligned_face(source,points);prepared=wrapper.prepare_source(crop)
        with torch.inference_mode():
            info=wrapper.get_kp_info(prepared);feature=wrapper.extract_feature_3d(prepared);x_source=wrapper.transform_keypoint(info)
            driving=None
            if reference:
                reference_crop,_=aligned_face(*reference);driving=wrapper.get_kp_info(wrapper.prepare_source(reference_crop))
            for index in range(settings['count']):
                active();variation=[1,.8,.65,.5][settings.get('variantOffset',0)+index];amount=settings['intensity']*variation;delta=info['exp'].clone()
                if driving is not None:delta+=(driving['exp']-info['exp'])*amount
                expression=settings['expression']
                smile={'smile':.6,'laugh':1.2,'sad':-.35,'serious':-.12,'angry':-.25}.get(expression,0)*amount
                for joint,axis,weight in [(20,1,-.01),(14,1,-.02),(17,1,.0065),(17,2,.003),(13,1,-.00275),(16,1,-.00275),(3,1,-.0035),(7,1,-.0035)]:delta[0,joint,axis]+=smile*weight
                eyebrow={'surprised':10,'sad':4,'angry':-10,'serious':-2}.get(expression,0)*amount
                if eyebrow>0:delta[0,1,1]+=eyebrow*.001;delta[0,2,1]-=eyebrow*.001
                else:
                    delta[0,1,0]-=eyebrow*.001;delta[0,2,0]+=eyebrow*.001;delta[0,1,1]+=eyebrow*.0003;delta[0,2,1]-=eyebrow*.0003
                gx=settings['gazeX']*8*variation;gy=settings['gazeY']*8*variation
                for joint,weight in [(11,.0007 if gx>0 else .001),(15,.001 if gx>0 else .0007)]:delta[0,joint,0]+=gx*weight;delta[0,joint,1]-=gy*.001
                r=rotation(info['pitch']+settings['pitch']*variation,info['yaw']+settings['yaw']*variation,info['roll']+settings['roll']*variation)
                target=info['scale'][...,None]*(info['kp']@r+delta)
                target[:,:,:2]+=info['t'][:,None,:2]
                # Mouth openness is a learned retargeting control; original ratio uses the same distance convention.
                original_ratio=float(np.linalg.norm(points[13]-points[14])/max(1,np.linalg.norm(points[61]-points[291])))
                target_ratio={'laugh':.32*amount,'surprised':.48*amount,'serious':.015,'angry':.025}.get(expression)
                if target_ratio is not None:
                    ratios=torch.tensor([[original_ratio,target_ratio]],device=wrapper.device,dtype=torch.float32)
                    target+=wrapper.retarget_lip(x_source,ratios)
                target=wrapper.stitching(x_source,target)
                output=wrapper.parse_output(wrapper.warp_decode(feature,x_source,target)['out'])[0]
                active();inverse=cv2.invertAffineTransform(matrix);inverse[:,:2]*=256/output.shape[0]
                restored=cv2.warpAffine(output,inverse,source.size,flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101)
                progress(index+1,settings['count']);yield Image.fromarray(restored)
    finally:
        del wrapper;gc.collect()
        if torch.cuda.is_available():torch.cuda.empty_cache()

def body_candidates(source,control,mask,people,targets,settings,env,active,progress):
    from diffusers import ControlNetModel, UNet2DConditionModel, StableDiffusionXLControlNetInpaintPipeline, EulerDiscreteScheduler
    from transformers import CLIPVisionModelWithProjection
    from diffusers.image_processor import IPAdapterMaskProcessor
    torch=env['torch'];root=Path(env['ROOT']);model=root/MODEL_ROOT;release(env);active();pipe=None
    try:
        dtype=torch.float16 if torch.cuda.is_available() else torch.float32
        net=ControlNetModel.from_pretrained(str(model/'openpose-sdxl'),torch_dtype=dtype,local_files_only=True)
        encoder=CLIPVisionModelWithProjection.from_pretrained(str(model/'ip-adapter/models/image_encoder'),torch_dtype=dtype,local_files_only=True)
        # OpenPose was trained against the four-channel SDXL base UNet. Keep that
        # backbone; the inpainting pipeline blends protected latents every step.
        unet=UNet2DConditionModel.from_pretrained(str(model/'sdxl-base/unet'),torch_dtype=dtype,variant='fp16',local_files_only=True)
        pipe=StableDiffusionXLControlNetInpaintPipeline.from_pretrained(str(root/BASE),unet=unet,controlnet=net,image_encoder=encoder,torch_dtype=dtype,variant='fp16',local_files_only=True,add_watermarker=False)
        pipe.scheduler=EulerDiscreteScheduler.from_pretrained(str(model/'sdxl-base/scheduler'),local_files_only=True)
        pipe.load_ip_adapter([str(model/'ip-adapter')]*2,subfolder=['sdxl_models']*2,weight_name=['ip-adapter-plus_sdxl_vit-h.safetensors','ip-adapter-plus-face_sdxl_vit-h.safetensors'],image_encoder_folder=None,local_files_only=True)
        if torch.cuda.is_available():pipe.enable_model_cpu_offload()
        else:pipe.to('cpu')
        pipe.enable_vae_tiling();pipe.set_progress_bar_config(disable=True)
        # Apply the same grid resize to image, mask and target skeleton.
        factor=settings['resolution']/max(source.size);sw=max(64,round(source.width*factor/64)*64);sh=max(64,round(source.height*factor/64)*64)
        image=source.resize((sw,sh),Image.Resampling.LANCZOS);selection=mask.resize((sw,sh),Image.Resampling.NEAREST);pose=control.resize((sw,sh),Image.Resampling.LANCZOS)
        import character_quality as quality
        import character_controls as controls
        regions=quality.ownership(targets,(sw,sh))
        refs=[];faces=[];body_masks=[];face_masks=[]
        for index,q in targets.items():
            person=people[index];box=np.array(person['box'])*[source.width,source.height,source.width,source.height]
            refs.append(source.crop(tuple(np.rint(box).astype(int))))
            face_box=np.array(person.get('faceBox') or person['box'])*[source.width,source.height,source.width,source.height]
            faces.append(source.crop(tuple(np.rint(face_box).astype(int))))
            body=np.zeros((sh,sw),np.uint8);face=np.zeros_like(body);visible=q[q[:,2]>.25,:2]*[sw,sh]
            low=visible.min(axis=0);high=visible.max(axis=0);pad=max(12,(high[0]-low[0])*.3)
            body[regions[index]]=255
            center=q[0,:2]*[sw,sh];radius=max(12,np.linalg.norm((q[5,:2]-q[6,:2])*[sw,sh])*.4)
            cv2.circle(face,tuple(center.astype(int)),int(radius),255,-1);body_masks.append(Image.fromarray(body));face_masks.append(Image.fromarray(face))
        processor=IPAdapterMaskProcessor();masks=[processor.preprocess(m,height=sh,width=sw).reshape(1,len(targets),sh,sw).to(dtype=dtype) for m in [body_masks,face_masks]]
        pipe.set_ip_adapter_scale([[settings['clothing']]*len(targets),[settings['identity']]*len(targets)])
        from character_geometry import ACTION_PROMPTS
        actions=[]
        for n,index in enumerate(targets):
            individual=controls.person(settings,index)
            action=ACTION_PROMPTS[individual['pose']]
            hand_details=controls.hand_prompt(individual)
            if hand_details and individual['pose'] in ('wave','point','peace','thumbs_up'):action='arm positioned as target skeleton'
            if individual['pose'] in ('wave','point','peace','thumbs_up','touch_hair','hand_chest'):action+=' with '+individual['handSide']+' hand'
            if hand_details:action+='; '+', '.join(hand_details)
            actions.append(('' if len(targets)==1 else ('left: ' if n==0 else 'right: ' if len(targets)==2 else f'person {n+1}: '))+action)
        if settings['pose'] in ('handshake','handover','look_each_other'):actions=[ACTION_PROMPTS[settings['pose']]]
        prompt=('One person, ' if len(targets)==1 else f'{len(targets)} people, ')+'; '.join(actions)+'. Natural anatomy. '+settings['prompt']
        appearance=settings.get('appearancePrompt','')
        # User instructions are never truncated. Automatic clothing descriptions
        # fit the remaining CLIP budget and are preserved in the saved settings.
        if len(pipe.tokenizer(prompt).input_ids)>77:raise ValueError('Mô tả hành động quá dài cho model. Rút gọn mô tả và đọc lại.')
        words=appearance.split()
        while words and len(pipe.tokenizer(prompt+' Wearing '+ ' '.join(words)).input_ids)>77:words.pop()
        if words:prompt+=' Wearing '+' '.join(words)
        negative='extra person, duplicate body, extra arms, extra legs, malformed hands, distorted face, wrong clothes, blurry, text, watermark'
        # Never silently truncate a user's confirmed instruction.
        if len(pipe.tokenizer(prompt).input_ids)>77:raise ValueError('Mô tả hành động quá dài cho model. Rút gọn mô tả và đọc lại.')
        for variant in range(settings['count']):
            active()
            def callback(pipeline,step,timestep,kwargs):active();progress(variant*settings['steps']+step+1,settings['count']*settings['steps']);return kwargs
            with torch.inference_mode():
                result=pipe(prompt=prompt,negative_prompt=negative,image=image,mask_image=selection,control_image=pose,
                    ip_adapter_image=[refs,faces],cross_attention_kwargs={'ip_adapter_masks':masks},height=sh,width=sw,
                    strength=1.,controlnet_conditioning_scale=1.,control_guidance_end=.9,num_inference_steps=settings['steps'],guidance_scale=5.,
                    generator=torch.Generator('cpu').manual_seed(settings['seed']+variant),callback_on_step_end=callback).images[0]
            active();yield result.resize(source.size,Image.Resampling.LANCZOS)
    finally:
        del pipe;gc.collect()
        if torch.cuda.is_available():torch.cuda.empty_cache()
