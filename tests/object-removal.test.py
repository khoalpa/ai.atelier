"""Regressions for actual erase semantics, ROI geometry and orchestration."""
import ast
from contextlib import nullcontext
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from object_removal import (blend_removal, visual_change, assess_removal, model_settings,
                            removal_regions, prepare_region, restore_region, removal_rank)

mask = Image.new('L', (160, 160)); mask.paste(255, (60, 60, 100, 100))
source = Image.new('RGB', mask.size, (128, 128, 128)); source.paste((180, 30, 30), (60, 60, 100, 100))
perfect = Image.new('RGB', source.size, (128, 128, 128))
allowed = mask.filter(ImageFilter.MaxFilter(13))
result, _, metrics = blend_removal(source, perfect, mask, allowed)
assert np.array_equal(np.asarray(result)[np.asarray(mask)>0], np.asarray(perfect)[np.asarray(mask)>0])
assert np.array_equal(np.asarray(result)[np.asarray(allowed)==0], np.asarray(source)[np.asarray(allowed)==0])
protected = Image.new('L', source.size); protected.paste(255, (70, 70, 75, 75))
locked, _, _ = blend_removal(source, perfect, mask, allowed, protected)
assert np.array_equal(np.asarray(locked)[np.asarray(protected)>0], np.asarray(source)[np.asarray(protected)>0])
empty, _, _ = blend_removal(source, perfect, Image.new('L', source.size), Image.new('L', source.size))
assert np.array_equal(empty, source)
edge = Image.new('L', source.size); edge.paste(255, (0, 0, 160, 20))
edge_result, _, _ = blend_removal(source, perfect, edge, edge)
assert np.array_equal(np.asarray(edge_result)[:20], np.asarray(perfect)[:20])

recolored = source.copy(); recolored.paste((30, 30, 180), (60, 60, 100, 100))
change = visual_change(source, recolored, mask)
assert not change['accepted'] and change['changedPixelRatio'] == 1
positive = {'available': True, 'detected': True}
negative = {'available': True, 'detected': False}
unknown = {'available': False, 'detected': False}
assert assess_removal(change, positive, positive)['status'] == 'residual'
assert not assess_removal(change, positive, unknown)['accepted']
assert not assess_removal(change, negative, negative)['accepted']
low = perfect.copy(); low.paste((138, 138, 138), (60, 60, 100, 100))
removed = assess_removal(visual_change(low, perfect, mask), positive, negative)
assert removed['accepted'] and removed['changedPixelRatio'] == 0
assert not assess_removal(removed, positive, negative, .001)['accepted']
invalid = visual_change(source, perfect, Image.new('L', source.size))
assert not assess_removal(invalid, positive, negative)['accepted']

settings = model_settings({'guidance': 30, 'strength': .55}, {'strength': .9}, 'flux')
assert settings['strength'] == .55 and settings['guidance'] == 30
for invalid in ({'guidance': 51}, {'strength': float('nan')}, {'steps': 0}):
    try: model_settings(invalid, {}, 'flux')
    except ValueError: pass
    else: raise AssertionError('Invalid settings accepted')

large = Image.new('RGB', (3200, 2400), 'gray')
thin = Image.new('L', large.size); thin.paste(255, (1600, 1100, 1602, 1300))
regions = removal_regions(thin, 96)
box = regions[0]
assert box[2]-box[0] < 400 and box[3]-box[1] < 500
crop, local_mask, original_size = prepare_region(large, thin, box, 1024)
assert crop.width % 64 == crop.height % 64 == 0
assert np.asarray(local_mask).sum() > np.asarray(thin).sum()
assert restore_region(crop, box, original_size).size == (box[2]-box[0], box[3]-box[1])
separate = Image.new('L', large.size); separate.paste(255, (100,100,120,120)); separate.paste(255, (3000,2200,3020,2220))
assert len(removal_regions(separate)) == 2
assert len(removal_regions(separate, max_regions=1)) == 1
assert removal_rank({'seed': 1, 'removalCheck': removed}) < removal_rank({'seed': 2, 'removalCheck': change})
print('OK: clean core, protected holes, borders, conservative scoring, low contrast, model settings, thin ROI and disconnected objects.')

# Exercise the production orchestration with a fake model: same code path as API,
# real files in a temporary directory, no GPU or user image mutation.
tree = ast.parse((ROOT/'ai_service.py').read_text(encoding='utf-8'))
names = {'inpaint', 'effective_step_policy', 'prepare_dual_inpaint_masks',
         'adaptive_inpaint_context_padding', 'inpaint_removal_check',
         'texture_preserving_core_recovery', 'detect_core_structural_artifacts', 'adaptive_local_edge_blend'}
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
for node in nodes: node.decorator_list = []
class Generator:
    def __init__(self, **kwargs): pass
    def manual_seed(self, value): self.seed = value; return self

with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    # Real removal inputs contain selected objects; a blank grey wall would be
    # correctly restored unchanged by predictable-background continuation.
    fixture=large.copy()
    fixture.paste((190,35,35),mask=Image.fromarray(np.maximum(np.asarray(thin),np.asarray(separate))))
    fixture.save(root/'source.png')
    calls, updates = [], []
    trace = {}
    pipe = SimpleNamespace()
    def pipeline(_, **kwargs):
        calls.append(kwargs)
        kwargs['callback_on_step_end'](pipe, 0, 0, {})
        return SimpleNamespace(images=[Image.new('RGB', (kwargs['width'], kwargs['height']), (160, 160, 160))])
    ns = dict(np=np, cv2=cv2, Image=Image, ImageFilter=ImageFilter, ImageOps=ImageOps,
              Path=Path, time=time, datetime=datetime, timezone=timezone, json=json,
              ROOT=root, OUTPUTS=root/'outputs', device='cpu', INPAINT_MODEL=root/'model', inpaint_pipe=None,
              active_loras=[], torch=SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False),
                    Generator=Generator, inference_mode=nullcontext),
              safe_sample=lambda _:root/'source.png', decode_mask=lambda value,size: separate if value=='two' else thin,
              persist_job_request=lambda *a:None, update_job=lambda *a,**kw:updates.append(kw), ensure_job_active=lambda _:None,
              inpaint_model_entry=lambda _:None, detect_inpaint_architecture=lambda *a:'flux',
              release_inpaint=lambda:None, load_inpaint_pipe=lambda *a:pipe,
              resolved_inpaint_profile=lambda *a:{'nativeResolution':1024,'strength':1,'guidance':30,'steps':40,'supportsNegativePrompt':False},
              resolve_inpaint_prompts=lambda body,*a:{'prompt':body['confirmedPrompts']['prompt'],'negativePrompt':body['confirmedPrompts']['negativePrompt'],'generatedNegativePrompt':''},
              prompt_trace_context=SimpleNamespace(get=lambda:trace), prompt_history=lambda:[],
              semantic_inpaint_residual_check=lambda *a:positive, traced_pipeline_call=pipeline,
              build_inpaint_negative_prompt=lambda *a:'unused', prompt_text=lambda _: ' MUST NOT BE APPENDED',
              encode_image=lambda image:'image')
    exec(compile(ast.Module(body=nodes,type_ignores=[]), '<inpaint>', 'exec'), ns)
    request = dict(sampleId='source', editableMask='one', fillMode='background', removalTarget='custom',
                   objectLabel='cup', count=1, steps=12, strength=.55, guidance=30, maxSide=512,
                   confirmedPrompts={'prompt':'Continuous gray tabletop.', 'negativePrompt':''},
                   autoRetry=True, maxAutoRetries=1, livePreview=False, semanticCheck=True)
    with patch.dict(sys.modules, {'prompt_limits':SimpleNamespace(split_flux_prompts=lambda pipe,text:({'prompt':text,'prompt_2':text},{}))}):
        output = ns['inpaint'](request)
        assert output['attemptedVariants'] == 2, 'Confirmed prompts must allow retry'
        assert all(call['prompt'] == 'Continuous gray tabletop.' for call in calls)
        assert all(call['strength'] == .55 and call['guidance_scale'] == 30 for call in calls)
        assert all('negative_prompt' not in call and 'padding_mask_crop' not in call for call in calls)
        assert output['width'] == 3200 and output['height'] == 2400
        assert output['results'][0]['outsideMaskMAE'] == 0
        assert output['regionCount'] == 1 and calls[0]['image'].width < 512
        calls.clear()
        ns['semantic_inpaint_residual_check'] = lambda *a:unknown
        output = ns['inpaint']({**request, 'editableMask':'two'})
        assert output['regionCount'] == 2 and len(calls) == 2
        assert output['attemptedVariants'] == 1, 'Unverified is not a reason to spend a retry'
        assert not output['results'][0]['removalCheck']['accepted']
        calls.clear()
        checks = iter([positive, negative])
        ns['semantic_inpaint_residual_check'] = lambda *a:next(checks)
        output = ns['inpaint'](request)
        assert output['removalPassed'] == 1 and len(calls) == 1
        calls.clear()
        ns['semantic_inpaint_residual_check'] = lambda *a:unknown
        def cancel_after_first_region(_):
            if calls: raise RuntimeError('cancelled-between-regions')
        ns['ensure_job_active'] = cancel_after_first_region
        try: ns['inpaint']({**request, 'editableMask':'two'})
        except RuntimeError as error: assert str(error)=='cancelled-between-regions'
        else: raise AssertionError('Cancellation ignored')
        assert len(calls) == 1
        print('OK: confirmed retry, immutable prompts/settings, FLUX ROI calls, full-size output and unknown-detector handling.')
