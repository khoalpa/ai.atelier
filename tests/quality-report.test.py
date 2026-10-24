"""Report denominators, full history, current feedback and legacy timing semantics."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from quality_learning import packed, now
from quality_report import build_report, retention_reason, TASK_ORDER

spec = importlib.util.spec_from_file_location('quality_fixtures', ROOT / 'tests/quality-learning.test.py')
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.case = fixtures.QualityTests()
        self.case.setUp()
        self.store = self.case.store

    def tearDown(self):
        self.case.tearDown()

    def test_empty_has_four_tasks_and_unknown_ratios_and_times(self):
        report = self.store.report({})['report']
        self.assertEqual([r['task'] for r in report['tasks']], list(TASK_ORDER))
        self.assertEqual(report['total']['recorded'], 0)
        self.assertIsNone(report['total']['preferImprovedRate'])
        self.assertEqual(report['total']['assessmentTime'],
                         dict(samples=0, averageSeconds=None, maxSeconds=None))

    def test_real_feedback_edits_and_clear_change_report_without_affecting_images(self):
        self.case.configure('auto')
        job = self.case.fixture(prompt=self.case.training_prompt(50))
        result = self.case.record(job)
        self.assertIsNotNone(result['improved'])
        before = self.store.output_path(result['original']).read_bytes()
        self.store.selection({'file': result['original']})
        self.assertEqual(self.store.report({})['report']['total']['rated'], 0)
        self.store.feedback({'resultId': result['id'], 'rating': 'good', 'target': 'original'})
        total = self.store.report({})['report']['total']
        self.assertEqual(total['good'], 1)
        self.assertIsNone(total['preferImprovedRate'])
        self.store.feedback({'resultId': result['id'], 'preference': 'improved', 'target': 'improved'})
        self.assertEqual(self.store.report({})['report']['total']['preferImprovedRate'], 1)
        self.store.feedback({'resultId': result['id'], 'preference': 'tie', 'target': 'original'})
        total = self.store.report({})['report']['total']
        self.assertEqual((total['compared'], total['tie'], total['preferImprovedRate']), (1, 1, 0))
        self.store.feedback({'resultId': result['id'], 'rating': 'needs-work', 'target': 'improved', 'defects': ['blur']})
        total = self.store.report({})['report']['total']
        self.assertEqual((total['good'], total['needsWork']), (0, 1))
        self.store.feedback({'resultId': result['id'], 'rating': 'clear'})
        total = self.store.report({})['report']['total']
        self.assertEqual((total['rated'], total['compared']), (0, 0))
        self.assertEqual(before, self.store.output_path(result['original']).read_bytes())

    def test_full_history_not_recent_sixty_and_jobs_are_distinct(self):
        with self.store.connect() as db:
            for index in range(81):
                result = {'task': TASK_ORDER[index % 4], 'status': 'review'}
                db.execute('INSERT INTO results VALUES (?,?,?,?,?,?,?,?)',
                           (str(index), 'job-'+str(index//3), str(index), str(index), 'scope', str(index), now(), packed(result)))
        self.assertEqual(len(self.store.state({})['results']), 60)
        self.assertEqual(len(self.store.state({'jobId': 'job-0'})['results']), 3)
        report = self.store.report({})['report']
        self.assertEqual((report['total']['recorded'], report['total']['jobs']), (81, 27))
        self.assertEqual([r['recorded'] for r in report['tasks']], [21, 20, 20, 20])

    def test_preference_denominator_includes_original_and_tie_only_explicit_pairs(self):
        result = dict(task='inpaint', status='improved', improved='/outputs/a.png')
        rows = [(result, {'preference': p}, str(i)) for i, p in enumerate(['improved', 'improved', 'original', 'tie'])]
        rows += [(result, {'rating': 'good', 'selected': 'improved'}, '5')]
        rows += [(dict(task='inpaint', status='retained'), {'preference': 'improved'}, '6')]
        total = build_report(rows)['total']
        self.assertEqual((total['recorded'], total['compared'], total['preferImprovedRate']), (6, 4, .5))

    def test_missing_and_invalid_timing_not_zero_legacy_reason_remains_honest(self):
        base = dict(task='outpaint', status='retained', message='Giữ bản ban đầu: bản thử chưa đủ cải thiện hoặc đã hết ngân sách.')
        rows = [(base, {}, 'a'), ({**base, 'assessmentSeconds': 2, 'finishingSeconds': .4}, {}, 'b'),
                ({**base, 'assessmentSeconds': 4}, {}, 'c'),
                ({**base, 'assessmentSeconds': float('nan'), 'finishingSeconds': -1}, {}, 'd')]
        total = build_report(rows)['total']
        self.assertEqual(total['assessmentTime'], dict(samples=2, averageSeconds=3, maxSeconds=4))
        self.assertEqual(total['finishingTime']['samples'], 1)
        self.assertEqual(total['reasons'], [dict(code='legacy-unspecified', count=4)])
        self.assertEqual(retention_reason({**base, 'comparison': {'passed': False}}), 'comparison-failed')
        self.assertEqual(retention_reason({**base, 'technical': {'passed': False}}), 'task-check')

    def test_worker_records_reason_and_time_and_maximum_one_attempt(self):
        self.case.configure('auto')
        for task in TASK_ORDER:
            self.store.process(self.case.fixture(task, prompt=self.case.training_prompt(50), count=3))
        report = self.store.report({})['report']
        for task in report['tasks']:
            self.assertEqual((task['recorded'], task['attempted'], task['improved'], task['retained']), (3, 1, 1, 2))
            self.assertEqual(task['reasons'], [dict(code='job-limit', count=2)])
            self.assertEqual(task['assessmentTime']['samples'], 3)
        job = self.case.fixture('tryon', failed_gate=True)
        record = self.case.record(job)
        self.assertEqual(record['decisionReason'], 'task-check')
        job = self.case.fixture('inpaint')
        (self.store.output_path(job['results'][0]['file']).parent / 'editable_mask.png').unlink()
        self.assertEqual(self.case.record(job)['decisionReason'], 'mask-unavailable')


if __name__ == '__main__':
    unittest.main(verbosity=2)
