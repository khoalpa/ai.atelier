from services.ai.runtime import metadata
from helpers.ai_source import read_source
"""Check outpainting geometry, lossless source preservation and job integration."""
import ast
import contextlib
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from outpainting import (prepare_canvas, prepare_inference, composite_canvas, detail_regions, merge_detail,
                        PatchAccumulator,seam_band,semantic_seam_masks,multiband_background,restore_source_core,seam_metrics,feather_seam_result,preserve_fabric_texture)
from services.ai.tasks.outpaint import outpaint_pipeline_kwargs

source = Image.fromarray(np.random.default_rng(1).integers(0, 256, (79, 113, 3), dtype=np.uint8))
for left, top, right, bottom in [(35, 0, 0, 0), (0, 0, 47, 0), (0, 31, 0, 0), (0, 0, 0, 19), (21, 15, 13, 27)]:
    body = dict(width=source.width+left+right, height=source.height+top+bottom, left=left, top=top)
    canvas, mask, geometry = prepare_canvas(source, body)
    assert canvas.size == mask.size == (body['width'], body['height'])
    model_image, model_mask, crop = prepare_inference(canvas, mask, 768)
    assert model_image.size == model_mask.size
    assert model_image.width*model_image.height <= 768**2
    assert all(value%64==0 for value in model_image.size)
    assert abs((crop[2]-crop[0])/(crop[3]-crop[1])-canvas.width/canvas.height) < .01
    generated = Image.new('RGB', (64, 64), (211, 23, 72))
    result = composite_canvas(source, generated, geometry)
    region = (left, top, left+source.width, top+source.height)
    assert np.array_equal(np.asarray(result.crop(region)), np.asarray(source))
    # Colour matching is confined to the narrow band, not stretched textures.
    outside = np.ones((result.height, result.width), dtype=bool)
    outside[max(0,top-32):min(result.height,top+source.height+32),
            max(0,left-32):min(result.width,left+source.width+32)] = False
    assert np.all(np.asarray(result)[outside] == [211, 23, 72])
    assert np.asarray(mask)[top+source.height//2, left+source.width//2] == 0
    assert not np.asarray(mask.crop(region)).any(), 'strict source preservation must also constrain model conditioning'
    assert geometry['conditioningOverlap'] == 0
    with tempfile.TemporaryDirectory() as folder:
        result.save(Path(folder)/'result.png')
        assert np.array_equal(np.asarray(Image.open(Path(folder)/'result.png').crop(region)), np.asarray(source))
    geometry['preserveOriginal'] = False
    blended = composite_canvas(source, generated, geometry)
    assert np.array_equal(np.asarray(blended.crop(region))[32:-32,32:-32], np.asarray(source)[32:-32,32:-32])
    assert np.any(np.asarray(blended.crop(region)) != np.asarray(source))

# A narrow source must retain conditioning context even with maximum overlap.
tiny_canvas, tiny_mask, tiny_geometry = prepare_canvas(Image.new('RGB',(16,16)), dict(width=32,height=32,left=8,top=8,overlap=128))
assert tiny_geometry['overlap'] == 4 and tiny_mask.getpixel((16,16)) == 0
_, flexible_mask, flexible = prepare_canvas(source, dict(width=148,height=79,left=35,overlap=16,preserveOriginal=False))
assert flexible['conditioningOverlap'] == 16
assert flexible_mask.getpixel((35,40)) == 255, 'explicit blend mode still permits source overlap'

large = Image.new('RGB', (1390,1858), 'blue')
large_canvas, large_mask, large_geometry = prepare_canvas(large, dict(width=1529,height=2044,left=139,overlap=16))
regions = detail_regions(large_mask, 1024)
assert regions and len(regions) == len(set(regions))
coverage = np.zeros((2044,1529), dtype=bool)
for box in regions:
    left, top, right, bottom = box
    assert right-left <= 1024 and bottom-top <= 1024
    coverage[top:bottom,left:right] = True
    old = np.asarray(large_canvas).copy()
    merge_detail(large_canvas, Image.new('RGB',(right-left,bottom-top),'red'), box, large_mask)
    assert np.array_equal(np.asarray(large_canvas)[np.asarray(large_mask)==0], old[np.asarray(large_mask)==0])
assert np.all(coverage[np.asarray(large_mask)>0]), 'all new strips in this portrait have detail coverage'
assert detail_regions(Image.new('L',(512,512),255),1024) == []
assert detail_regions(Image.new('L',(1200,1200),255),1024) == [], 'skip crops without original context'

# Edge colour matching should reduce a tint shift while keeping new texture.
flat = Image.new('RGB',(80,80),(128,128,128))
_, _, tint_geometry = prepare_canvas(flat,dict(width=112,height=80,left=32,overlap=16))
textured = np.full((80,112,3),110,dtype=np.uint8)
textured[::2] = 130
matched = np.asarray(composite_canvas(flat,Image.fromarray(textured),tint_geometry))
assert abs(float(matched[:,31].mean())-128) < abs(float(textured[:,31].mean())-128)
assert matched[:,31].var() > 30, 'matching must retain generated texture'
assert np.array_equal(matched[:,:16],textured[:,:16]), 'do not retouch beyond the edge band'

# Overlap order must not change the result, or the input used by another crop.
base=Image.new('RGB',(140,100),'gray');all_mask=Image.new('L',base.size,255)
predictions=[(Image.new('RGB',(100,100),'red'),(0,0,100,100)),
             (Image.new('RGB',(100,100),'blue'),(40,0,140,100))]
outputs=[]
for sequence in [predictions,predictions[::-1]]:
    accumulator=PatchAccumulator(base)
    for prediction,box in sequence: accumulator.add(prediction,box,all_mask)
    outputs.append(np.asarray(accumulator.finish()))
assert np.array_equal(*outputs), 'normalized patches must be independent of iteration order'
assert base.getpixel((50,50))==(128,128,128), 'phase input must stay immutable'

# Averaging two misaligned fabric motifs must not erase their fine texture.
checker=(np.indices((96,96)).sum(axis=0)%2*80+88).astype(np.uint8)
pattern=np.repeat(checker[...,None],3,axis=2)
fabric_predictions=[(Image.fromarray(pattern),(0,0,96,96)),
                    (Image.fromarray((256-pattern.astype(np.int16)).astype(np.uint8)),(32,0,128,96))]
fabric_results=[]
for sequence in [fabric_predictions,fabric_predictions[::-1]]:
    accumulator=PatchAccumulator(Image.new('RGB',(128,96),(128,128,128)))
    for prediction,box in sequence: accumulator.add(prediction,box,Image.new('L',(128,96),255),preserve_texture=True)
    fabric_results.append(np.asarray(accumulator.finish()))
assert np.array_equal(*fabric_results)
assert fabric_results[0][20:76,48:80].var()>900, 'shifted motifs must not average into a flat strip'

# Semantic seam editing is bounded; head protection and the source core are exact.
_,_,sg=prepare_canvas(Image.new('RGB',(100,100),'gray'),dict(width=132,height=132,left=32,overlap=16,preserveOriginal=False))
fg=Image.new('L',(100,100),0);fg.paste(255,(0,50,100,100))
cloth=fg.copy();protect=Image.new('L',(100,100),0);protect.paste(255,(0,0,40,40))
sm=semantic_seam_masks(sg,16,fg,cloth,protect)
assert not np.any((np.asarray(sm['background'])>0)&(np.asarray(sm['garment'])>0))
editable=Image.fromarray(np.maximum(np.asarray(sm['background']),np.asarray(sm['garment'])))
original=Image.new('RGB',(100,100),'gray');candidate=Image.new('RGB',(132,132),'red')
repaired=restore_source_core(original,candidate,sg,editable,protect,16)
crop=np.asarray(repaired.crop((32,0,132,100)))
assert np.all(crop[20:80,20:80]==128), 'interior beyond the seam strip must not change'
assert np.all(crop[:40,:40]==128), 'protected head pixels must not change'
assert seam_metrics(original,repaired,sg,protect)['protectedMAE']==0
strict=restore_source_core(original,candidate,{**sg,'preserveOriginal':True},editable,protect,16)
assert np.all(np.asarray(strict.crop((32,0,132,100)))==128)
blended=multiband_background(Image.new('RGB',(132,132),'gray'),candidate,sm['background'])
assert np.array_equal(np.asarray(blended)[np.asarray(sm['background'])==0],np.asarray(candidate)[np.asarray(sm['background'])==0])
soft=feather_seam_result(Image.new('RGB',(132,132),'gray'),candidate,editable,8)
assert np.array_equal(np.asarray(soft)[np.asarray(editable)==0],np.full_like(np.asarray(soft)[np.asarray(editable)==0],128))
assert soft.getpixel((16,60))==(128,128,128), 'outer band edge must return exactly to its baseline'

original_pattern=np.repeat(((np.indices((100,100)).sum(axis=0)%2)*80+88).astype(np.uint8)[...,None],3,axis=2)
texture_base=Image.new('RGB',(132,132),(128,128,128));texture_base.paste(Image.fromarray(original_pattern),(32,0))
texture_candidate=texture_base.copy();texture_candidate.paste((128,128,128),(32,50,48,100))
restored_texture=preserve_fabric_texture(Image.fromarray(original_pattern),texture_base,texture_candidate,sg,sm['garment'],protect)
restored_values=np.asarray(restored_texture)
assert restored_values[60:90,36:44].var()>900, 'source-side embroidery must survive seam feathering'
assert np.array_equal(restored_values[np.asarray(sm['garment'])==0],np.asarray(texture_candidate)[np.asarray(sm['garment'])==0])
assert np.array_equal(restored_values[:40,32:72],np.asarray(texture_candidate)[:40,32:72]), 'identity protection is exact'
strict_texture=preserve_fabric_texture(Image.fromarray(original_pattern),texture_base,texture_candidate,{**sg,'preserveOriginal':True},sm['garment'],protect)
assert np.array_equal(np.asarray(strict_texture.crop((32,0,132,100))),np.asarray(texture_candidate.crop((32,0,132,100))))

for invalid in [dict(width=113,height=79), dict(width=120,height=80,left=-1), dict(width=120,height=80,left=8),
                dict(width=112,height=90), dict(width=8193,height=90), dict(width=120.5,height=80),
                dict(width=True,height=80), dict(width=120,height=80,overlap=129),
                dict(width=120,height=80,preserveOriginal='false')]:
    try:
        prepare_canvas(source, invalid)
    except ValueError:
        pass
    else:
        raise AssertionError(invalid)
with patch.dict(os.environ, ATELIER_OUTPAINT_MAX_PIXELS='100'):
    try:
        prepare_canvas(source, dict(width=120,height=80))
    except ValueError:
        pass
    else:
        raise AssertionError('pixel limit')

# Exercise the real orchestration function with a deterministic fake GPU pipeline.
tree = ast.parse(read_source(ROOT/'ai_service.py', encoding='utf-8'))
runner = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'outpaint')
runner.decorator_list = []
with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    source.save(root/'source.png')
    events, calls, requests = [], [], []
    mode = ['ok']
    def pipeline(pipe, **kwargs):
        calls.append(kwargs)
        if mode[0] == 'oom':
            raise RuntimeError('CUDA out of memory')
        kwargs['callback_on_step_end'](pipe, 0, 0, {})
        return SimpleNamespace(images=[Image.new('RGB', (kwargs['width'],kwargs['height']), 'green')])
    class Generator:
        def __init__(self, **kwargs): pass
        def manual_seed(self, value): return self
    def active(job_id):
        if mode[0] == 'cancel': raise ValueError('Tác vụ đã hủy')
    namespace = dict(Path=Path, time=time, datetime=datetime, timezone=timezone, np=np, Image=Image,
        ROOT=root, OUTPUTS=root/'outputs', INPAINT_MODEL=root/'model', inpaint_pipe=None,
        prompt_text=lambda key:'Continue scene' if key.endswith('instruction') else 'seams',
        task_prompt=lambda key, polarity='positive': namespace['prompt_text'](__import__('prompt_catalog').read_catalog()['tasks'][key][polarity]['components'][0]),
        prompt_template=lambda key, **kwargs:'Avoid: '+kwargs['negative'], prompt_history=lambda:[],
        safe_sample=lambda name:root/'source.png', inpaint_model_entry=lambda model:None,
        detect_inpaint_architecture=lambda *args:'sdxl', resolved_inpaint_profile=lambda *args:{'nativeResolution':1024},
        persist_job_request=lambda *args:requests.append(args), update_job=lambda job, **kwargs:events.append(kwargs),
        ensure_job_active=active, release_inpaint=lambda:None,
        load_inpaint_pipe=lambda *args:SimpleNamespace(), traced_pipeline_call=pipeline,
        torch=SimpleNamespace(Generator=Generator,inference_mode=contextlib.nullcontext),
        encode_image=lambda image:'data:image/png;base64,test', json=json,
        outpaint_pipeline_kwargs=outpaint_pipeline_kwargs)
    namespace['outpaint_semantics']=lambda image,manual=None:(Image.new('L',image.size,0),Image.new('L',image.size,0),
                                                            manual or Image.new('L',image.size,0),[])
    namespace['metadata']=metadata
    exec(compile(ast.Module(body=[runner],type_ignores=[]),str(ROOT/'ai_service.py'),'exec'), namespace)
    body = dict(jobId='test',sampleId='source.png',width=180,height=120,left=30,top=20,count=2)
    response = namespace['outpaint'](body)
    assert response['ok'] and len(response['results']) == 2
    assert requests[0][1] == 'outpaint'
    assert events[-1]['status'] == 'completed'
    metadata = json.loads(read_source(root/response['directory']/'metadata.json', encoding='utf-8'))
    assert metadata['status'] == 'completed' and metadata['geometry']['left'] == 30
    for item in response['results']:
        assert item['originalRegionMAE'] == 0
        assert Image.open(root/item['file']).size == (180,120)
    assert calls[0]['padding_mask_crop'] is None and calls[0]['strength'] == 1
    assert events[0]['taskType'] == 'outpaint'
    mode[0] = 'cancel'
    try: namespace['outpaint'](body)
    except ValueError as error: assert 'hủy' in str(error)
    else: raise AssertionError('cancellation')
    mode[0] = 'oom'
    try: namespace['outpaint'](body)
    except ValueError as error: assert '512' in str(error)
    else: raise AssertionError('OOM feedback')
    mode[0] = 'ok'
    rotated = Image.new('RGB',(40,20),'orange')
    exif = Image.Exif();exif[274] = 6
    rotated.save(root/'rotated.jpg',exif=exif)
    namespace['safe_sample'] = lambda name:root/'rotated.jpg'
    oriented = namespace['outpaint'](dict(jobId='rotated',sampleId='rotated.jpg',width=80,height=60,left=10,top=10))
    assert oriented['geometry']['sourceWidth'] == 20 and oriented['geometry']['sourceHeight'] == 40
    assert oriented['results'][0]['originalRegionMAE'] == 0
    assert oriented['results'][0]['finalReview']['method'] == 'final-multiscale-seam-v2'
    assert oriented['results'][0]['finalReview']['status'] in ('needs-review','unverified')
    large.save(root/'large.png')
    namespace['safe_sample'] = lambda name:root/'large.png'
    before = len(calls)
    detail_event_start = len(events)
    detailed = namespace['outpaint'](dict(jobId='detail',sampleId='large.png',width=1529,height=2044,
                                        left=139,overlap=16,steps=8,detailSteps=4,maxSide=1024,detailPass=True))
    assert len(calls)-before > 1
    assert all(call['num_inference_steps']==4 for call in calls[before+1:])
    assert detailed['results'][0]['originalRegionMAE'] == 0
    assert events[-1]['completedSteps'] == 8+len(calls)-before-1
    assert all(call['strength']==.35 for call in calls[before+1:])
    detail_metadata = json.loads(read_source(root/detailed['directory']/'metadata.json', encoding='utf-8'))
    assert detail_metadata['detailRegions']
    progress = [e['completedSteps'] for e in events[detail_event_start:] if 'completedSteps' in e]
    assert progress == sorted(progress), 'progress must include every refinement pass'
    namespace['safe_sample'] = lambda name:root/'source.png'
    namespace['detect_inpaint_architecture'] = lambda *args:'flux'
    # Isolate default selection from tokenizer-specific handling in this test.
    namespace['resolved_inpaint_profile'] = lambda *args:{'nativeResolution':1024,'supportsNegativePrompt':True}
    namespace['outpaint'](dict(jobId='flux-defaults',sampleId='source.png',width=180,height=120,left=30))
    assert calls[-1]['num_inference_steps'] == 50 and calls[-1]['guidance_scale'] == 30
    assert calls[-1]['width']*calls[-1]['height'] <= 1024**2
    namespace['detect_inpaint_architecture'] = lambda *args:'qwen-image-controlnet-inpaint'
    namespace['resolved_inpaint_profile'] = lambda *args:{'nativeResolution':768,'steps':30,'guidance':4,'supportsNegativePrompt':True}
    namespace['outpaint'](dict(jobId='qwen-defaults',sampleId='source.png',width=180,height=120,left=30))
    assert calls[-1]['control_image'] and calls[-1]['control_mask']
    assert calls[-1]['num_inference_steps'] == 30 and calls[-1]['true_cfg_scale'] == 4
    assert 'prompt_2' not in calls[-1] and 'image' not in calls[-1] and 'mask_image' not in calls[-1]
    namespace['detect_inpaint_architecture'] = lambda *args:'sdxl'
    namespace['resolved_inpaint_profile'] = lambda *args:{'nativeResolution':1024}
    namespace['safe_sample'] = lambda name:root/'large.png'
    def semantics(image,manual=None):
        fg=Image.new('L',image.size,0);fg.paste(255,(0,image.height//2,*image.size))
        protected=Image.new('L',image.size,0);protected.paste(255,(0,0,image.width,30))
        return fg,fg.copy(),protected,[]
    namespace['outpaint_semantics']=semantics
    namespace['prompt_text']=lambda key:'PROMPT:'+key
    before=len(calls)
    material_result=namespace['outpaint'](dict(jobId='materials',sampleId='large.png',width=1529,height=2044,left=139,
        preserveOriginal=False,detailPass=True,materialRefine=True,sourceEnhance=True,count=2,
        steps=4,fabricSteps=10,maxSide=1024,prompt='Keep pale blue lace'))
    material_folder=root/material_result['directory']
    material_metadata=json.loads(read_source(material_folder/'metadata.json', encoding='utf-8'))
    assert len(material_metadata['materialVariants'])==2
    fabric_calls=[call for call in calls[before:] if call['strength']==.45]
    assert fabric_calls and all(call['num_inference_steps']==10 for call in fabric_calls)
    assert all('PROMPT:outpaint.fabric' in call['prompt'] and 'Keep pale blue lace' in call['prompt'] for call in fabric_calls)
    background_calls=[call for call in calls[before:] if call['strength']==.35]
    assert background_calls, 'fabric recovery must not suppress background refinement'
    assert all('Keep pale blue lace' in call['prompt'] for call in background_calls)
    for item in material_result['results']:
        assert item['diagnostics']['final']['protectedMAE']==0
        values=np.asarray(Image.open(root/item['file']))
        assert np.array_equal(values[:30,139:1529],np.asarray(large)[:30])
    for run_seed in (42,43):
        fabric_mask=np.asarray(Image.open(material_folder/f'material_garment_seed_{run_seed}.png'))
        assert not fabric_mask[:1858,139:1529].any(), 'generative fabric recovery cannot edit the source'
    assert events[-1]['completedSteps']==events[-1]['totalWorkSteps']
    # A selected layout is reused exactly; no second overview diffusion call.
    before=len(calls)
    layouts=namespace['outpaint'](dict(jobId='layouts',sampleId='large.png',width=1529,height=2044,left=139,
        preserveOriginal=True,detailPass=True,materialRefine=True,seamRepair=True,runMode='layout',count=2,steps=4,maxSide=512,seed=0))
    assert len(calls)-before==2 and all(item['layoutOnly'] for item in layouts['results'])
    layout_folder=root/layouts['directory']
    baseline=np.asarray(Image.open(layout_folder/'overview_seed_1.png'))
    before=len(calls)
    finished=namespace['outpaint'](dict(jobId='refine-layout',sampleId='large.png',width=1529,height=2044,left=139,
        preserveOriginal=True,detailPass=True,materialRefine=True,seamRepair=True,runMode='refine',count=4,
        refineFrom={'directory':layouts['directory'],'seed':1},steps=4,seamSteps=4,detailSteps=4,fabricSteps=10,maxSide=512))
    assert len(finished['results'])==1 and finished['results'][0]['seed']==1
    assert all(call['strength']<1 for call in calls[before:]), 'refinement must not generate another layout'
    assert np.array_equal(np.asarray(Image.open(root/finished['directory']/'overview_seed_1.png')),baseline)
    assert finished['results'][0]['originalRegionMAE']==0
    assert finished['results'][0]['qualityChecks']
    manual_mask=Image.new('L',large.size,0);manual_mask.paste(255,(0,large.height-20,large.width,large.height))
    namespace['decode_mask']=lambda value,size:manual_mask
    recorded_manual=[]
    def semantics_with_manual(image,manual=None):
        recorded_manual.append(manual.copy() if manual is not None else None)
        fg,cloth,locked,warnings=semantics(image,manual)
        if manual is not None: locked=Image.fromarray(np.maximum(np.asarray(locked),np.asarray(manual)))
        return fg,cloth,locked,warnings
    namespace['outpaint_semantics']=semantics_with_manual
    manual_result=namespace['outpaint'](dict(jobId='manual-materials',sampleId='large.png',width=1529,height=2044,left=139,
        preserveOriginal=True,detailPass=True,materialRefine=True,protectedDetailMask='manual',steps=4,fabricSteps=10,maxSide=1024))
    assert recorded_manual and np.asarray(recorded_manual[-1])[1838:1858,139:1529].all()
    assert manual_result['results'][0]['originalRegionMAE']==0
    namespace['outpaint_semantics']=semantics
    try:
        namespace['outpaint'](dict(jobId='invalid-enhance',sampleId='large.png',width=1529,height=2044,left=139,
            sourceEnhance=True,preserveOriginal=True))
    except ValueError as error: assert 'Giữ nguyên' in str(error)
    else: raise AssertionError('source enhancement must require explicit source-edit mode')
    before=len(calls)
    seam_result=namespace['outpaint'](dict(jobId='seam',sampleId='large.png',width=1529,height=2044,left=139,
                                         preserveOriginal=False,seamRepair=True,seamWidth=48,seamSteps=4,steps=4,maxSide=512))
    seam_folder=root/seam_result['directory']
    seam_metadata=json.loads(read_source(seam_folder/'metadata.json', encoding='utf-8'))
    assert seam_metadata['seamRegions'] and seam_metadata['patchCompositing']=='immutable-base-normalized-weights'
    assert seam_result['results'][0]['diagnostics']['final']['protectedMAE']==0
    assert seam_result['results'][0]['diagnostics']['final']['sourceCoreMAE']==0
    seam_output=np.asarray(Image.open(root/seam_result['results'][0]['file']))
    assert np.array_equal(seam_output[50:1800,139+50:139+1300],np.asarray(large)[50:1800,50:1300])
    overview=Image.open(seam_folder/'overview_seed_42.png')
    for call,region in zip(calls[before+1:],seam_metadata['seamRegions']):
        region_mask=Image.open(seam_folder/f"seam_{region['kind']}_mask.png")
        expected,_,_=prepare_inference(overview.crop(region['box']),region_mask.crop(region['box']),512)
        assert np.array_equal(np.asarray(call['image']),np.asarray(expected)), 'every seam crop reads the frozen overview'
        assert call['strength']==.4
    namespace['outpaint_semantics']=lambda image,manual=None:(Image.new('L',image.size,255),Image.new('L',image.size,0),Image.new('L',image.size,255),['Segmentation unavailable'])
    before=len(calls)
    skipped=namespace['outpaint'](dict(jobId='skip-seam',sampleId='large.png',width=1529,height=2044,left=139,
                                     preserveOriginal=False,seamRepair=True,steps=4,maxSide=512))
    assert len(calls)==before+1 and skipped['seamRegionCount']==0
    assert skipped['warnings']==['Segmentation unavailable']
    assert skipped['results'][0]['originalRegionMAE']==0, 'uncertain segmentation must not expose the source to edits'
    def cancel_in_detail(pipe, **kwargs):
        value = pipeline(pipe, **kwargs)
        mode[0] = 'cancel'
        return value
    before=len(calls)
    def preflight_limit(pipe, inputs):
        if 'PROMPT:outpaint.fabric' in inputs['prompt']:
            raise ValueError('prompt: 78 token, vượt giới hạn 77')
        return {}
    with patch('prompt_limits.validate_prompt_limits', side_effect=preflight_limit):
        try:
            namespace['outpaint'](dict(jobId='prompt-preflight',sampleId='large.png',width=1529,height=2044,left=139,
                runMode='layout',detailPass=True,materialRefine=True))
        except ValueError as error: assert 'outpaint.material' in str(error)
        else: raise AssertionError('later-pass prompts must be checked before layout generation')
    assert len(calls)==before
    namespace['traced_pipeline_call'] = cancel_in_detail
    try:
        namespace['outpaint'](dict(jobId='detail-cancel',sampleId='large.png',width=1529,height=2044,left=139,detailPass=True))
    except ValueError as error:
        assert 'hủy' in str(error)
    else:
        raise AssertionError('refinement must check cancellation before starting a crop')
print('OK: four directions, exact PNG preservation, blend bands, bounds, pixel budget, jobs, metadata, cancellation and OOM.')
