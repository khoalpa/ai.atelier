"""Bounded CatVTON attention-only experiment with fixed held-out comparisons.

Never modifies installed weights or enables a checkpoint in the application.
Identity independence and commercial provenance remain separate unresolved facts.
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import random
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from vton_pilot import build_inpaint_batch, file_hash, load_dataset, masked_mae

ACTIVE_OUTPUT = None


def write_json(path, value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    global ACTIVE_OUTPUT
    parser=argparse.ArgumentParser()
    parser.add_argument('--dataset',type=Path,default=ROOT/'workspace/training/couple-tee-pilot')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--steps',type=int,default=48)
    parser.add_argument('--accumulate',type=int,default=2)
    parser.add_argument('--learning-rate',type=float,default=2e-6)
    parser.add_argument('--seed',type=int,default=221026)
    parser.add_argument('--inference-steps',type=int,default=30)
    args=parser.parse_args()
    if not 1 <= args.steps <= 2000 or not 1 <= args.accumulate <= 32 or not 0 < args.learning_rate <= 1e-5:
        raise ValueError('Invalid bounded pilot parameters')
    rows=load_dataset(args.dataset)
    out=args.output.resolve()
    out.mkdir(parents=True,exist_ok=False)
    ACTIVE_OUTPUT = out
    started=time.time()
    snapshot=out/'source-snapshot'; snapshot.mkdir()
    source_hashes={}
    for relative in ('ai_service.py','vton_pilot.py','tryon_geometry.py','catvton_inputs.py','scripts/train-vton-pilot.py'):
        source=ROOT/relative
        target=snapshot/relative; target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source,target)
        source_hashes[relative]=file_hash(target)
    import numpy as np
    import torch
    import torch.nn.functional as F
    from PIL import Image
    from safetensors.torch import save_model
    import ai_service as ai
    from tryon_geometry import target_coverage
    os.environ['HF_HUB_OFFLINE']='1'
    os.environ['TRANSFORMERS_OFFLINE']='1'
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
    pipe=ai.load_tryon_pipe('catvton')
    from utils import prepare_image, prepare_mask_image, resize_and_padding, compute_dream_and_update_latents_for_inpaint
    pipe.unet.requires_grad_(False); pipe.vae.requires_grad_(False)
    pipe.unet.eval(); pipe.vae.eval()
    scheduler=pipe.noise_scheduler
    if scheduler.config.prediction_type != 'epsilon':
        raise ValueError('Only epsilon prediction is supported by this DREAM pilot')
    train=[r for r in rows if r['split']=='train']; validation=[r for r in rows if r['split']=='validation']
    with Image.open(args.dataset/rows[0]['personImage']) as first_image:
        width,height=first_image.size
    report={'status':'running','purpose':'local exploratory pilot','productionReady':False,
            'sourceSha256':source_hashes,
            'datasetManifestSha256':file_hash(args.dataset/'manifest.jsonl'),
            'baseAttentionSha256':file_hash(ai.CATVTON_MODEL/'mix-48k-1024/attention/model.safetensors'),
            'counts':{'train':len(train),'validation':len(validation),'products':len({r['productId'] for r in rows})},
            'splitUnit':'product','identityDisjoint':None,'consentRecorded':None,'commercialUseAllowed':None,
            'config':{k:str(v) if isinstance(v,Path) else v for k,v in vars(args).items()},
            'method':{'trainable':'self-attention','loss':'epsilon MSE on full concatenated latent',
                      'dreamDetailPreservation':10,'conditionDropout':.1,'vaeEncoding':'fixed posterior mode',
                      'augmentation':'none; preserves text orientation','resolution':[width,height]},
            'limitations':[f'Only {len({r["productId"] for r in rows})} products; results are exploratory.',
                           'Person identity independence is unverified.',
                           'Paired reconstruction is not proof of transfer to a different garment.',
                           'Raw renders require visual review; no automatic checkpoint promotion.']}
    write_json(out/'run.json',report)
    cached={}
    for row in rows:
        person=Image.open(args.dataset/row['personImage']).convert('RGB')
        garment=resize_and_padding(Image.open(args.dataset/row['productImage']).convert('RGB'),(width,height))
        mask=Image.open(args.dataset/row['maskImage']).convert('L')
        pt=prepare_image(person).to('cuda',dtype=pipe.vae.dtype)
        gt=prepare_image(garment).to('cuda',dtype=pipe.vae.dtype)
        mt=prepare_mask_image(mask).to('cuda',dtype=pipe.vae.dtype)
        with torch.no_grad():
            def encode(t):
                return (pipe.vae.encode(t).latent_dist.mode()*pipe.vae.config.scaling_factor).detach().float()
            p,g,m=encode(pt),encode(gt),encode(pt*(mt<.5))
        cached[row['id']]={'person':p,'garment':g,'masked_person':m,
                          'mask':F.interpolate(mt.float(),size=p.shape[-2:],mode='nearest'),
                          'images':(person,garment,mask)}
    print(json.dumps({'stage':'latents-ready','records':len(cached)}),flush=True)

    @torch.no_grad()
    def evaluate(stage):
        folder=out/stage; folder.mkdir()
        scores=[]
        pipe.unet.eval()
        for index,row in enumerate(validation):
            data=cached[row['id']]; person,garment,mask=data['images']
            generator=torch.Generator('cuda').manual_seed(args.seed+index)
            with torch.autocast('cuda',dtype=torch.bfloat16):
                result=pipe(person,garment,mask,num_inference_steps=args.inference_steps,
                            guidance_scale=2.5,width=width,height=height,generator=generator)[0]
            result.save(folder/f'{row["id"]}-paired.png')
            # A fixed different validation product exposes failures hidden by reconstruction.
            alternate=validation[(index+2)%len(validation)]
            if alternate['productId']==row['productId']:
                raise ValueError('Transfer comparison must use a different product')
            ref=cached[alternate['id']]['images'][1]
            pose=ai.detect_people_pose(person)[0]
            protected=ai.automatic_protected_detail_mask(person,pose['box'],pose['keypoints'])
            transfer_mask,_,_,_=target_coverage(mask,protected,'upper_body',pose,
                {'sleeveLength':alternate['attributes']['sleeveLength'],'hemLength':'hip','silhouette':'straight'})
            transfer_mask.save(folder/f'{row["id"]}-transfer-mask.png')
            with torch.autocast('cuda',dtype=torch.bfloat16):
                transferred=pipe(person,ref,transfer_mask,num_inference_steps=args.inference_steps,
                                 guidance_scale=2.5,width=width,height=height,
                                 generator=torch.Generator('cuda').manual_seed(args.seed+100+index))[0]
            transferred.save(folder/f'{row["id"]}-transfer.png')
            scores.append({'id':row['id'],'cohort':row.get('cohort','unspecified'),'pairedEditRegionMAE':masked_mae(person,result,mask),
                           'transferProductId':alternate['productId'], 'transferGroundTruthAvailable':False})
            print(json.dumps({'stage':stage,'validated':index+1,'total':len(validation)}),flush=True)
        result={'records':scores,'meanPairedEditRegionMAE':float(np.mean([r['pairedEditRegionMAE'] for r in scores]))}
        result['cohorts']={cohort:{'count':sum(r['cohort']==cohort for r in scores),
            'meanPairedEditRegionMAE':float(np.mean([r['pairedEditRegionMAE'] for r in scores if r['cohort']==cohort]))}
            for cohort in sorted({r['cohort'] for r in scores})}
        write_json(folder/'metrics.json',result)
        return result

    baseline=evaluate('baseline')
    pipe.unet.train(); pipe.unet.enable_gradient_checkpointing()
    # Master trainable parameters stay float32; autocast controls compute dtype.
    pipe.attn_modules.float().requires_grad_(True)
    parameters=list(pipe.attn_modules.parameters())
    if any(p.requires_grad for name,p in pipe.unet.named_parameters() if 'attn1' not in name):
        raise AssertionError('Only self-attention parameters may receive gradients')
    frozen_before={name:p.detach().cpu().clone() for name,p in pipe.unet.named_parameters() if name in ('conv_in.weight','conv_out.weight')}
    initial=parameters[0].detach().cpu().clone()
    optimizer=torch.optim.AdamW(parameters,lr=args.learning_rate,weight_decay=.01)
    generator=torch.Generator('cuda').manual_seed(args.seed+1000)
    sample_rng=random.Random(args.seed)
    report['trainableParameters']=sum(p.numel() for p in parameters)
    losses=[]; order=[]; optimizer.zero_grad(set_to_none=True)
    torch.cuda.reset_peak_memory_stats()
    for step in range(args.steps):
        step_loss=0.
        for micro in range(args.accumulate):
            if not order:
                order=list(range(len(train))); sample_rng.shuffle(order)
            row=train[order.pop()]; data=cached[row['id']]
            t=torch.randint(0,scheduler.config.num_train_timesteps,(1,),device='cuda',generator=generator)
            noise=torch.randn((1,4,data['person'].shape[-2]*2,data['person'].shape[-1]),device='cuda',generator=generator)
            model_input,target=build_inpaint_batch(**{k:data[k] for k in ('person','garment','masked_person','mask')},
                noise=noise,timesteps=t,scheduler=scheduler,drop_condition=sample_rng.random()<.1)
            with torch.autocast('cuda',dtype=torch.bfloat16):
                model_input,target=compute_dream_and_update_latents_for_inpaint(pipe.unet,scheduler,t,noise,
                    model_input,target,None,dream_detail_preservation=10)
                predicted=pipe.unet(model_input.requires_grad_(True),t,encoder_hidden_states=None).sample
                loss=F.mse_loss(predicted.float(),target.float())
            if not torch.isfinite(loss):
                raise FloatingPointError('Non-finite training loss')
            (loss/args.accumulate).backward()
            step_loss+=float(loss.detach())/args.accumulate
        grad_norm=torch.nn.utils.clip_grad_norm_(parameters,1.,error_if_nonfinite=True)
        optimizer.step(); optimizer.zero_grad(set_to_none=True)
        entry={'step':step+1,'loss':step_loss,'gradNorm':float(grad_norm),'elapsedSeconds':round(time.time()-started,2)}
        losses.append(entry)
        with (out/'training.jsonl').open('a',encoding='utf-8') as stream:
            stream.write(json.dumps(entry)+'\n')
        print(json.dumps(entry),flush=True)
    if torch.equal(initial,parameters[0].detach().cpu()):
        raise AssertionError('Attention parameters did not update')
    for name,p in pipe.unet.named_parameters():
        if name in frozen_before and not torch.equal(frozen_before[name],p.detach().cpu()):
            raise AssertionError('Frozen base parameters changed')
    report['peakTrainingMemoryMiB']=round(torch.cuda.max_memory_allocated()/1024**2)
    checkpoint=out/'attention'; checkpoint.mkdir()
    save_model(pipe.attn_modules,str(checkpoint/'model.safetensors'),metadata={'format':'pt'})
    # Store recoverable optimizer/RNG state separately from the inference checkpoint.
    torch.save({'optimizer':optimizer.state_dict(),'step':args.steps,'torchRng':torch.get_rng_state(),
                'cudaRng':torch.cuda.get_rng_state(),'noiseRng':generator.get_state(),
                'sampleRng':sample_rng.getstate(),'order':order,'manifestSha256':report['datasetManifestSha256']},out/'training-state.pt')
    del optimizer,loss,predicted,model_input,target
    gc.collect(); torch.cuda.empty_cache()
    pipe.unet.disable_gradient_checkpointing(); pipe.attn_modules.to(dtype=torch.bfloat16)
    adapted=evaluate('adapted')
    report.update(status='completed',elapsedSeconds=round(time.time()-started),baseline=baseline,adapted=adapted,
                  attentionSha256=file_hash(checkpoint/'model.safetensors'),frozenParameterCheck='passed',
                  attentionChanged=True,installedWeightsChanged=False,automaticPromotion=False,
                  pairedMAEDelta=adapted['meanPairedEditRegionMAE']-baseline['meanPairedEditRegionMAE'])
    if file_hash(ai.CATVTON_MODEL/'mix-48k-1024/attention/model.safetensors') != report['baseAttentionSha256']:
        raise AssertionError('Installed checkpoint was modified')
    write_json(out/'run.json',report)
    print(json.dumps({'status':report['status'],'pairedMAEDelta':report['pairedMAEDelta']}),flush=True)


if __name__=='__main__':
    try:
        main()
    except BaseException as error:
        if ACTIVE_OUTPUT is not None:
            status_file=ACTIVE_OUTPUT/'run.json'
            status=json.loads(status_file.read_text(encoding='utf-8')) if status_file.is_file() else {}
            status.update(status='interrupted' if isinstance(error,KeyboardInterrupt) else 'failed',
                          productionReady=False,error=f'{type(error).__name__}: {error}')
            write_json(status_file,status)
        raise
