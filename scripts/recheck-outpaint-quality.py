"""Replay the production seam guard on saved real-model stages, without inference."""
import json, shutil, sys, uuid
from datetime import datetime,timezone
from pathlib import Path
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from outpaint_quality import choose_refinement,final_seam_review
OUT=ROOT/'workspace/diagnostics/background-quality-2.6'
record_file=OUT/'outpaint-replayed.json'
records=json.loads(record_file.read_text(encoding='utf-8')) if record_file.exists() else []
for index in (7,8):
    if any(r['case']==index for r in records):continue
    file=OUT/f'live-{index}.json'
    if not file.exists():continue
    live=json.loads(file.read_text(encoding='utf-8'))
    if not live.get('ok'):continue
    original=ROOT/live['response']['directory'];meta=json.loads((original/'metadata.json').read_text(encoding='utf-8'))
    seed=meta['seed'];before=Image.open(original/f'overview_seed_{seed}.png').convert('RGB');candidate=Image.open(original/f'seam_repaired_seed_{seed}.png').convert('RGB')
    editable=Image.fromarray(np.maximum(np.asarray(Image.open(original/'seam_background_mask.png').convert('L')),np.asarray(Image.open(original/'seam_garment_mask.png').convert('L'))))
    chosen,check=choose_refinement(before,candidate,meta['geometry'],editable,stage='seam')
    target=ROOT/'workspace/outputs'/('outpaint_quality26_'+uuid.uuid4().hex[:12]);target.mkdir()
    chosen.save(target/f'result_seed_{seed}.png')
    for name in ('source_canvas.png','generation_mask.png'):
        shutil.copy2(original/name,target/name)
    output=str((target/f'result_seed_{seed}.png').relative_to(ROOT))
    result=dict(seed=seed,file=output,originalRegionMAE=0,qualityChecks=[check],finalReview=final_seam_review(chosen,meta['geometry']))
    updated=dict(schemaVersion=2,taskType='outpaint',source=meta['source'],sourceFingerprint=meta['sourceFingerprint'],modelId=meta['modelId'],geometry=meta['geometry'],request=meta['request'],createdAt=datetime.now(timezone.utc).isoformat(),results=[result],
        validationMode='saved-real-model-stages-production-guard-replay',derivedFrom=str(original.relative_to(ROOT)),
        note='No new inference. Replayed final guard after detecting stretched detail in the live validation run.')
    (target/'metadata.json').write_text(json.dumps(updated,ensure_ascii=False,indent=2),encoding='utf-8')
    records.append(dict(case=index,output=output,guard=check,finalReview=result['finalReview']))
    record_file.write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([dict(case=r['case'],output=r['output'],guardAccepted=r['guard']['accepted'],reasons=r['guard']['reasons']) for r in records]))
