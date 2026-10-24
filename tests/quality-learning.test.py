"""Exercise the real CPU worker on isolated, generated images; no GPU required."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from quality_learning import QualityStore, compare, digest, finish, now, packed


class QualityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = QualityStore(self.root)
        self.counter = 0

    def tearDown(self):
        self.temp.cleanup()

    def configure(self, mode):
        self.store.configure({'mode': mode, 'maxSeconds': 8, 'revision': self.store.settings()['revision']})

    def fixture(self, task='text-to-image', prompt=None, count=1, failed_gate=False):
        self.counter += 1
        directory = self.root / 'workspace/outputs' / f'case-{self.counter}'
        directory.mkdir(parents=True)
        y, x = np.indices((128, 128))
        gray = np.uint8(128 + 44*np.sin(x*.7) + 30*np.cos(y*.9))
        image = Image.fromarray(np.stack([gray, gray, gray], axis=2)).filter(ImageFilter.GaussianBlur(.6))
        mask = Image.new('L', image.size, 0); mask.paste(255, (20, 20, 108, 108))
        mask.save(directory/'editable_mask.png'); mask.save(directory/'generation_mask.png')
        protect = Image.new('L', image.size, 0); protect.paste(255, (45, 45, 65, 65))
        protect.save(directory/'protected_identity.png')
        meta = {'modelId':'test-model', 'seed':42, 'request':{'prompt': prompt or f'content {self.counter}'}, 'results':[]}
        if task == 'tryon':
            meta.update(category='upper_body', qualityVersion=2, selectedSeed=42)
        if task == 'outpaint':
            meta['geometry'] = dict(left=32, top=32, sourceWidth=64, sourceHeight=64)
        results = []
        for index in range(count):
            file = directory / f'result_seed_{42+index}.png'; image.save(file)
            candidate = {'file':str(file.relative_to(self.root)), 'seed':42+index, 'kind':task}
            if task == 'tryon':
                candidate['qualityGate'] = {'passed':not failed_gate, 'version':2}
            elif task == 'inpaint':
                candidate['removalCheck'] = {'accepted':not failed_gate, 'status':'residual' if failed_gate else 'detector-passed'}
            results.append(candidate)
            meta['results'].append({**candidate, 'file':file.name})
        (directory/'metadata.json').write_text(packed(meta),encoding='utf-8')
        return {'jobId':f'job-{self.counter}', 'status':'completed', 'taskType':task,
                'updatedAt':now(), 'directory':str(directory.relative_to(self.root)), 'results':results}

    def record(self, job):
        self.store.process(job)
        return self.store.state({'jobId':job['jobId']})['results'][0]

    def test_default_observe_off_failed_cancelled_and_dedup(self):
        job = self.fixture()
        for status in ('failed', 'cancelled', 'running'):
            self.store.process({**job,'status':status})
        self.assertEqual(self.store.state({})['summary']['results'],0)
        record = self.record(job)
        self.assertEqual(self.store.state({'url':record['original']})['results'][0]['id'],record['id'])
        self.assertEqual(self.store.state({'resultId':record['id']})['results'][0]['original'],record['original'])
        self.assertEqual(self.store.state({'url':'/outputs/missing.png'})['results'],[])
        self.assertIsNone(record['improved'])
        self.assertTrue(record['technical']['requiresVisualReview'])
        self.store.process(job)
        self.assertEqual(self.store.state({})['summary']['results'],1)
        self.configure('off')
        self.store.process(self.fixture())
        self.assertEqual(self.store.state({})['summary']['results'],1)

    def test_all_tasks_source_and_protected_pixels_and_one_attempt(self):
        self.configure('auto')
        for task in ('text-to-image','inpaint','tryon','outpaint'):
            with self.subTest(task=task):
                job = self.fixture(task,prompt=self.training_prompt(50),count=3)
                original_hashes = [digest(self.store.output_path(r['file']).read_bytes()) for r in job['results']]
                self.store.process(job)
                records = self.store.state({'jobId':job['jobId']})['results']
                self.assertEqual(len(records),3)
                self.assertEqual(sum('comparison' in r for r in records),1)
                improved = [r for r in records if r['improved']]
                self.assertEqual(len(improved),1, records)
                r = improved[0]
                before = Image.open(self.store.output_path(r['original'])).convert('RGB')
                after = Image.open(self.store.output_path(r['improved'])).convert('RGB')
                meta = json.loads((self.store.output_path(r['original']).parent/'metadata.json').read_text())
                allowed = self.store.allowed(self.store.output_path(r['original']),before,meta,task)
                self.assertTrue(compare(before,after,allowed)['passed'])
                self.assertTrue(np.array_equal(np.asarray(before)[~allowed],np.asarray(after)[~allowed]))
                self.assertEqual(original_hashes,[digest(self.store.output_path(i['file']).read_bytes()) for i in job['results']])

    def test_gate_failure_and_missing_mask_never_publish(self):
        self.configure('auto')
        for task in ('tryon','inpaint'):
            r = self.record(self.fixture(task,failed_gate=True))
            self.assertFalse(r['technical']['passed']); self.assertIsNone(r['improved'])
        job = self.fixture('inpaint')
        (self.store.output_path(job['results'][0]['file']).parent/'editable_mask.png').unlink()
        r = self.record(job)
        self.assertIsNone(r['improved'])

    def test_finish_rejects_scope_clipping_and_large_changes(self):
        image = Image.new('RGB',(32,32),(120,120,120))
        allowed = np.zeros((32,32),dtype=bool); allowed[8:24,8:24]=True
        after=image.copy(); after.putpixel((0,0),(121,120,120))
        self.assertFalse(compare(image,after,allowed)['passed'])
        after=image.copy(); after.putpixel((10,10),(128,120,120))
        self.assertFalse(compare(image,after,allowed)['passed'])
        self.assertFalse(compare(image,finish(image,allowed,20),allowed)['passed'])

    def test_multiple_workers_claim_once_and_resume(self):
        self.configure('auto'); job=self.fixture()
        other = QualityStore(self.root)
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda worker:worker.process(job),[self.store,other]))
        self.assertEqual(len(other.state({})['results']),1)
        self.assertEqual(other.state({})['jobs']['done'],1)
        job2=self.fixture()
        self.assertTrue(self.store.claim(job2['jobId']))
        with self.store.connect() as db:
            db.execute('UPDATE jobs SET lease=0 WHERE id=?',(job2['jobId'],))
        other.process(job2)
        self.assertEqual(len(other.state({})['results']),2)

    def test_settings_revision_and_path_validation(self):
        settings = self.store.settings()
        self.configure('auto')
        with self.assertRaises(ValueError):
            self.store.configure({**settings,'mode':'off'})
        for path in ('../../secret.png','workspace/outputs/../../private.png','C:/outside.png'):
            with self.assertRaises(ValueError): self.store.output_path(path)
        with self.assertRaises(ValueError): self.store.dispatch('train',{})

    def test_selection_is_not_approval_and_timezone_cutoff(self):
        job = self.fixture()
        job['updatedAt'] = datetime.now(timezone(timedelta(hours=7))).isoformat()
        self.store.selection({'file':job['results'][0]['file']})
        record = self.record(job)
        self.assertTrue(record['selectedOriginalAt'])
        self.assertEqual(record['feedback'],{})
        self.assertEqual(self.store.state({})['summary']['rated'],0)
        old = self.fixture()
        old['updatedAt'] = (datetime.now(timezone(timedelta(hours=7)))-timedelta(hours=1)).isoformat()
        self.store.process(old)
        self.assertEqual(self.store.state({})['summary']['results'],1)

    def good(self, result):
        self.store.feedback({'resultId':result['id'],'target':'improved','rating':'good','preference':'improved'})

    def training_prompt(self, index):
        for salt in range(100):
            text = f'independent content {index} variant {salt}'
            if int(digest(text)[:8],16)%3 == 1: return text
        raise AssertionError('No prompt')

    def test_profiles_need_explicit_independent_holdout_and_can_rollback(self):
        self.configure('auto')
        training = []
        for index in range(3):
            record=self.record(self.fixture(prompt=self.training_prompt(index)))
            self.assertEqual(record['amount'],20)
            training.append(record); self.good(record)
        profile=self.store.state({})['profiles'][0]
        self.assertEqual(profile['state'],'validating')
        # A repeated prompt or seed is not a new validation example.
        repeated=self.record(self.fixture(prompt=self.training_prompt(0)))
        if repeated['improved']:
            self.good(repeated)
        self.assertEqual(self.store.state({})['profiles'][0]['holdoutCount'],0)
        holdout=[]
        for index in range(5):
            record=self.record(self.fixture(prompt=f'holdout {index}'))
            holdout.append(record)
            self.assertEqual(record['profileId'],profile['id'])
            # Selecting or downloading is not a positive rating.
            self.store.feedback({'resultId':record['id'],'target':'improved','selected':True})
            self.assertEqual(self.store.state({})['profiles'][0]['state'],'validating')
            self.good(record)
        self.assertEqual(self.store.state({})['profiles'][0]['state'],'active')
        self.store.feedback({'resultId':holdout[0]['id'],'rating':'clear'})
        self.assertEqual(self.store.state({})['profiles'][0]['state'],'rolled-back')
        after=self.record(self.fixture(prompt='post rollback'))
        self.assertEqual(after['amount'],12)
        self.assertIsNone(after['profileId'])

    def test_changed_image_feedback_and_invalid_labels_rejected(self):
        self.configure('auto'); record=self.record(self.fixture())
        with self.assertRaises(ValueError):
            self.store.feedback({'resultId':record['id'],'rating':'needs-work','defects':['made-up']})
        Image.new('RGB',(8,8)).save(self.store.output_path(record['original']))
        with self.assertRaises(ValueError): self.good(record)

    def test_scan_survives_incomplete_json_and_ignores_old_and_partial_jobs(self):
        directory=self.root/'workspace/jobs'; directory.mkdir(parents=True)
        job=self.fixture(); (directory/'new.json').write_text(packed(job),encoding='utf-8')
        (directory/'partial.json').write_text('{',encoding='utf-8')
        old=self.fixture(); old['updatedAt']='2000-01-01T00:00:00+00:00'
        (directory/'old.json').write_text(packed(old),encoding='utf-8')
        self.store.scan()
        self.assertEqual(self.store.state({})['summary']['results'],1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
