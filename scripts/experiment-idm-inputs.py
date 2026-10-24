"""Two fixed cases, explicit description alone vs description plus reviewed mask."""
import json
import sys
import time
import traceback
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sample_catalog import resolve_sample

def main():
    import torch
    from PIL import Image,ImageDraw
    import ai_service as ai
    target=ROOT/'workspace/diagnostics/idm-input-experiment'
    prior=ROOT/'workspace/diagnostics/idm-qualification_20261021T023540Z'
    baseline=json.loads((prior/'report.json').read_text(encoding='utf-8'))
    audit=json.loads((target/'mask-audit.json').read_text())
    report={'modelId':'idm-vton','steps':20,'maxSide':512,'guidance':2.5,'thresholdsChanged':False,'cases':[]}
    original=ai.traced_pipeline_call
    for category,name,description in [
        ('upper_body','c002','a solid cobalt blue cotton Oxford button-front shirt with a pointed collar, white buttons, full-length long sleeves and buttoned cuffs'),
        ('overall','c003','a solid emerald green linen knee-length A-line dress with a round neckline, short sleeves, a fitted waist and a flared skirt')]:
        source=Image.open(resolve_sample(ROOT, f'characters/{name}.png')).convert('RGB')
        reference=Image.open(ROOT/f'workspace/references/{category}/reference.png').convert('RGB')
        old=next(row for row in baseline['items'] if row['category']==category and Path(row['sampleId']).stem==name)
        panels=[('Source',source),('Reference',reference),('Baseline',Image.open(ROOT/old['output']).convert('RGB'))]
        for variant,mask_name in [('description-only','old-mask'),('description-and-mask','candidate-mask')]:
            folder=target/category/variant
            folder.mkdir(exist_ok=True)
            mask=Image.open(target/category/f'{mask_name}.png').convert('L')
            person=next(row['person'] for row in audit if row['category']==category)
            policy=ai.mask_strength_policy(mask,person['box'],category,person['keypoints'])
            if not policy['accepted']:raise ValueError('Mask must pass unchanged gate')
            record={'category':category,'sample':name,'variant':variant,'garmentDescription':description,'seed':old['seed'],'maskPolicy':policy}
            report['cases'].append(record)
            def capture(pipe,**options):
                options['image'].save(folder/'model-source.png')
                options['mask_image'].save(folder/'model-mask.png')
                torch.cuda.reset_peak_memory_stats()
                start=time.perf_counter()
                result=original(pipe,**options)
                torch.cuda.synchronize()
                record.update(inferenceSeconds=time.perf_counter()-start,peakAllocatedMiB=torch.cuda.max_memory_allocated()/2**20)
                (result.images if hasattr(result,'images') else result[0])[0].save(folder/'raw.png')
                return result
            ai.traced_pipeline_call=capture
            try:
                result=ai.tryon(dict(modelId='idm-vton',sampleId=old['sampleId'],category=category,
                    garmentImage=ai.encode_image(reference),editableMask=ai.encode_image(mask),autoMask=False,
                    garmentDescription=description,seed=old['seed'],steps=20,maxSide=512,guidance=2.5,
                    count=1,expand=0,blur=6,repairSeams=False,generativeRefine=False,maxRetries=0,
                    minimumQuality=0,minimumSimilarity=0,minimumSeam=0,minimumAnatomy=0))
                final=Image.open(ROOT/result['selected']).convert('RGB')
                final.save(folder/'final.png')
                effective=Image.open((ROOT/result['selected']).parent/'editable_mask.png').convert('L')
                effective.save(folder/'effective-mask.png')
                metrics=ai.score_tryon_result(source,final,effective)
                metrics['referenceSimilarity']=ai.reference_similarity(reference,final,effective)
                color=ai.color_material_consistency(reference,final,effective)
                geometry=ai.catvton_geometry_consistency(final,effective)
                passed=bool(color['accepted'] and geometry['accepted'] and metrics['seamScore']>=80 and metrics['anatomyScore']>=95 and metrics['referenceSimilarity']>=.6)
                record.update(status='completed',selected=result['selected'],metrics=metrics,colorMaterial=color,geometry=geometry,automaticPassed=passed)
                panels.append((variant,final))
            except Exception:
                record.update(status='failed',error=traceback.format_exc())
            finally:ai.traced_pipeline_call=original
            (target/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
            print(json.dumps({k:record.get(k) for k in ['category','variant','status','automaticPassed','error']}),flush=True)
        sheet=Image.new('RGB',(300*len(panels),500),'#eeeeee')
        draw=ImageDraw.Draw(sheet)
        for index,(label,image) in enumerate(panels):
            image=image.copy();image.thumbnail((290,460))
            sheet.paste(image,(index*300+(300-image.width)//2,30))
            draw.text((index*300+8,8),label,fill='black')
        sheet.save(target/category/'comparison.jpg')
    ai.release_tryon()
if __name__=='__main__':main()
