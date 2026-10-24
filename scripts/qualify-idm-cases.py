"""Replay the nine canonical reference cases with IDM, retaining mask gates."""
import hashlib
import json
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

def main():
    import torch
    from PIL import Image,ImageDraw
    import ai_service as ai
    target=ROOT/'workspace/diagnostics'/datetime.now(timezone.utc).strftime('idm-qualification_%Y%m%dT%H%M%SZ')
    target.mkdir(parents=True)
    prior=json.loads((ROOT/'workspace/diagnostics/product-reference-qualification.json').read_text(encoding='utf-8'))
    report={'createdAt':datetime.now(timezone.utc).isoformat(),'modelId':'idm-vton','steps':20,'maxSide':512,
            'guidance':2.5,'requested':9,'diagnosticOnly':True,'defaultChanged':False,'items':[]}
    original=ai.traced_pipeline_call
    for group in prior['items']:
        category=group['category']
        qualification=json.loads((ROOT/group['report']).read_text(encoding='utf-8'))
        matrix=json.loads((ROOT/qualification['matrixReport']).read_text(encoding='utf-8'))
        refpath=ROOT/qualification['reference']
        if hashlib.sha256(refpath.read_bytes()).hexdigest()!=qualification['referenceSha256']:
            raise ValueError('Reference changed since CatVTON qualification')
        reference=Image.open(refpath).convert('RGB')
        by_sample={row['sampleId']:row for row in matrix['rows']}
        skipped={row['sampleId']:row for row in matrix['skipped']}
        panels=[]
        for sample_id in qualification['qualificationSamples']:
            name=Path(sample_id).stem
            folder=target/category/name
            folder.mkdir(parents=True)
            source=Image.open(ROOT/'samples'/sample_id).convert('RGB')
            record={'category':category,'sampleId':sample_id,'reference':qualification['reference']}
            report['items'].append(record)
            if sample_id in skipped:
                record.update(status='blocked',reason=skipped[sample_id])
                panels.append((name,source,reference,None,None,None))
                print(json.dumps({'category':category,'sample':name,'status':'blocked'}),flush=True)
                continue
            previous=by_sample[sample_id]
            mask=Image.open((ROOT/previous['output']).parent/f'{name}_mask.png').convert('L')
            mask.save(folder/'requested-mask.png')
            record.update(seed=previous['seed'],maskSource=str(((ROOT/previous['output']).parent/f'{name}_mask.png').relative_to(ROOT)))
            def capture(pipe,**options):
                options['image'].save(folder/'model-source.png')
                options['mask_image'].save(folder/'model-mask.png')
                options['ip_adapter_image'].save(folder/'model-reference.png')
                torch.cuda.reset_peak_memory_stats()
                started=time.perf_counter()
                result=original(pipe,**options)
                torch.cuda.synchronize()
                record.update(inferenceSeconds=time.perf_counter()-started,peakAllocatedMiB=torch.cuda.max_memory_allocated()/2**20)
                images=result.images if hasattr(result,'images') else result[0]
                images[0].save(folder/'raw.png')
                return result
            ai.traced_pipeline_call=capture
            started=time.perf_counter()
            try:
                result=ai.tryon(dict(modelId='idm-vton',sampleId=sample_id,category=category,
                    garmentImage=ai.encode_image(reference),editableMask=ai.encode_image(mask),autoMask=False,
                    seed=previous['seed'],steps=20,maxSide=512,guidance=2.5,count=1,expand=0,blur=6,
                    repairSeams=False,generativeRefine=False,maxRetries=0,
                    minimumQuality=0,minimumSimilarity=0,minimumSeam=0,minimumAnatomy=0))
                final=Image.open(ROOT/result['selected']).convert('RGB')
                final.save(folder/'final.png')
                metrics=ai.score_tryon_result(source,final,mask)
                metrics['referenceSimilarity']=ai.reference_similarity(reference,final,mask)
                color=ai.color_material_consistency(reference,final,mask)
                geometry=ai.catvton_geometry_consistency(final,mask)
                passed=bool(color['accepted'] and geometry['accepted'] and metrics['seamScore']>=80 and metrics['anatomyScore']>=95 and metrics['referenceSimilarity']>=.6)
                record.update(status='completed',output=str((folder/'final.png').relative_to(ROOT)),selected=result['selected'],
                    totalSeconds=time.perf_counter()-started,metrics=metrics,colorMaterial=color,geometry=geometry,automaticPassed=passed,
                    catvtonOutput=previous['output'])
                panels.append((name,source,reference,Image.open(ROOT/previous['output']).convert('RGB'),Image.open(folder/'raw.png').convert('RGB'),final))
            except Exception:
                record.update(status='failed',error=traceback.format_exc())
                panels.append((name,source,reference,None,None,None))
            finally:
                ai.traced_pipeline_call=original
            report.update(rendered=sum(r['status']=='completed' for r in report['items']),
                          blocked=sum(r['status']=='blocked' for r in report['items']),
                          passed=sum(r.get('automaticPassed',False) for r in report['items']))
            (target/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps({k:record.get(k) for k in ['category','sampleId','status','automaticPassed','inferenceSeconds','error']}),flush=True)
        sheet=Image.new('RGB',(1250,420*3),'#eeeeee')
        draw=ImageDraw.Draw(sheet)
        for y,(name,*images) in enumerate(panels):
            for x,(label,image) in enumerate(zip(['Source','Reference','CatVTON','IDM raw','IDM final'],images)):
                draw.text((250*x+8,420*y+8),name+' '+label,fill='black')
                if image is None:
                    draw.text((250*x+30,420*y+100),'BLOCKED / NO OUTPUT',fill='red')
                    continue
                image=image.copy()
                image.thumbnail((240,380))
                sheet.paste(image,(250*x+(250-image.width)//2,420*y+30))
        sheet.save(target/f'{category}.jpg')
        (target/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    ai.release_tryon()
    print(str(target),flush=True)

if __name__=='__main__':
    main()
