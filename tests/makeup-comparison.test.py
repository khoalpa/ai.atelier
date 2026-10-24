import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import makeup
import makeup_comparison as comparison


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);(self.root/'app').mkdir()
        (self.root/'app/makeup-styles.json').write_bytes((ROOT/'app/makeup-styles.json').read_bytes())
        self.image=Image.open(__import__('sample_catalog').resolve_sample(ROOT, 'outpaint-benchmark/portrait-left/reference.png')).convert('RGB');self.path=self.root/'source.png';self.image.save(self.path)
        self.points=np.array(json.loads((ROOT/'tests/fixtures/makeup-landmarks.json').read_text()),np.float32)
        masks,_,_=makeup.region_masks(self.points,self.image.size);self.selected=Image.fromarray(np.maximum.reduce([np.asarray(masks[p]) for p in makeup.PARTS]))
        self.protected=Image.new('L',self.image.size);ImageDraw.Draw(self.protected).rectangle((260,380,290,410),fill=255)
        self.state={};self.cancelled=False
        def active(_):
            if self.cancelled:raise RuntimeError('Tác vụ đã được hủy')
        def update(_,**changes):self.state.update(copy.deepcopy(changes))
        self.env=dict(ROOT=self.root,OUTPUTS=self.root/'outputs',JOBS_DIR=self.root/'jobs',safe_sample=lambda _:self.path,
            makeup_landmarks=Mock(return_value=[self.points]),ensure_job_active=active,update_job=update,persist_job_request=Mock())
        self.body=dict(sampleId='portrait',sourceSha256=hashlib.sha256(self.path.read_bytes()).hexdigest(),faceIndex=0,jobId='compare',
                       editableMask=makeup.encode(self.selected),protectedDetailMask=makeup.encode(self.protected),comparisonStyles=self.styles('natural','classic'))
    def styles(self,*names):
        return [dict(id=name,name='Tên '+name,settings=dict(style=name)) for name in names]
    def tearDown(self):self.temp.cleanup()
    def test_count_duplicate_and_invalid_settings_rejected(self):
        for entries in [[],self.styles('natural'),self.styles(*(['natural']*5)),self.styles('natural','natural'),[{'id':'a','name':'n','settings':{}}]*2]:
            with self.assertRaises(ValueError):comparison.run({**self.body,'comparisonStyles':entries},self.env)
        wrong=self.styles('natural','custom');wrong[1]['settings'].update(description='new',plannedDescription='old')
        with self.assertRaises(ValueError):comparison.run({**self.body,'comparisonStyles':wrong},self.env)
        self.assertFalse((self.root/'outputs').exists())
    def test_same_source_masks_names_and_full_equality(self):
        original=self.path.read_bytes();result=comparison.run(self.body,self.env)
        self.assertEqual(len(result['results']),2);self.assertEqual(result['status'],'completed');self.assertEqual(self.path.read_bytes(),original)
        self.assertEqual(self.env['persist_job_request'].call_count,1);self.assertEqual(self.env['makeup_landmarks'].call_count,1)
        for item in result['results']:
            folder=(self.root/item['file']).parent;mask=np.array(Image.open(folder/'applied_mask.png'))>0
            actual=np.array(Image.open(self.root/item['file']));before=np.array(self.image.crop(item['crop']));x,y,r,b=item['crop'];local=mask[y:b,x:r]
            np.testing.assert_array_equal(actual[~local],before[~local]);self.assertEqual(item['label'],item['settings']['styleName'])
            metadata=json.loads((folder/'metadata.json').read_text(encoding='utf-8'));self.assertEqual(metadata['results'][0]['comparisonName'],item['comparisonName'])
            full=makeup.run({**item['settings'],'plannedDescription':item['settings']['description'],**{k:v for k,v in self.body.items() if k!='comparisonStyles'},'preview':False,'limitSelection':True},self.env)
            np.testing.assert_array_equal(Image.open(self.root/full['results'][0]['file']).crop(item['crop']),actual)
            np.testing.assert_array_equal(Image.open(folder/'protected_mask.png'),self.protected)
    def test_style_cannot_change_source_masks_face_or_seed(self):
        self.body['comparisonStyles'][0]['settings'].update(sampleId='other',faceIndex=7,sourceSha256='other',editableMask='bad',protectedDetailMask='bad',seed=999,preview=False)
        item=comparison.run(self.body,self.env)['results'][0]
        self.assertEqual(item['sampleId'],'portrait');self.assertEqual(item['seed'],42);self.assertEqual(item['settings']['faceIndex'],0);self.assertTrue(item['previewOnly'])
    def test_failure_retains_successes_and_continues(self):
        self.body['comparisonStyles']=self.styles('natural','artistic','classic')
        def failed(*args):raise RuntimeError('Model thử bị lỗi')
        self.env['makeup_ai']=failed
        result=comparison.run(self.body,self.env)
        self.assertEqual([x['status'] for x in result['comparisonEntries']],['completed','failed','completed'])
        self.assertEqual(len(result['results']),2);self.assertEqual(self.state['results'],result['results'])
    def test_cancel_keeps_first_and_stops_remaining(self):
        self.body['comparisonStyles']=self.styles('natural','artistic','classic')
        def cancel(*args):self.cancelled=True;self.env['ensure_job_active']('compare')
        self.env['makeup_ai']=cancel
        result=comparison.run(self.body,self.env)
        self.assertEqual(result['status'],'cancelled');self.assertEqual(len(result['results']),1)
        self.assertEqual([x['status'] for x in result['comparisonEntries']],['completed','cancelled','cancelled'])
        self.assertTrue((self.root/result['results'][0]['file']).exists());self.assertEqual(self.state['status'],'cancelled')
    def test_all_fail_and_mask_empty(self):
        def failed(*args,**kwargs):raise RuntimeError('Lỗi thử')
        self.env['makeup_compare_render']=failed
        result=comparison.run(self.body,self.env);self.assertEqual(result['status'],'failed');self.assertFalse(result['results'])
        with self.assertRaises(ValueError):comparison.run({**self.body,'editableMask':makeup.encode(Image.new('L',self.image.size))},self.env)
    def test_ai_one_candidate_uses_same_seed(self):
        seen=[]
        def ai(source,masks,allowed,box,settings,env,active,progress):
            seen.append((settings['seed'],env['makeup_variant_count']));yield source
        self.env['makeup_ai']=ai;self.body['comparisonStyles']=self.styles('natural','artistic')
        result=comparison.run(self.body,self.env);self.assertEqual(len(result['results']),2);self.assertEqual(seen,[(42,1)])
    def test_stale_source_rejected(self):
        with self.assertRaisesRegex(ValueError,'nguồn đã đổi'):comparison.run({**self.body,'sourceSha256':'bad'},self.env)
    def test_description_and_strength_snapshot(self):
        settings=self.body['comparisonStyles'][0]['settings'];settings.update(description='Chỉ tô son',plannedDescription='Chỉ tô son',parts=['lips'],lip='#a03850',strengths={'lips':47})
        item=comparison.run(self.body,self.env)['results'][0]
        self.assertEqual(item['settings']['description'],'Chỉ tô son');self.assertEqual(item['settings']['strengths']['lips'],47);self.assertEqual(item['settings']['lip'],'#a03850')

if __name__=='__main__':unittest.main()
