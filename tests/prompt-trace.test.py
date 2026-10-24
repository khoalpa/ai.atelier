import ast
import sys
import json
import tempfile
import threading
import unittest
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

source = Path(__file__).resolve().parents[1] / 'ai_service.py'
sys.path.insert(0, str(source.parent))
tree = ast.parse(source.read_text(encoding='utf-8'))
names = {'trace_generation', 'prompt_history', 'traced_pipeline_call', 'update_job'}
namespace = dict(ContextVar=ContextVar, wraps=wraps, datetime=datetime, timezone=timezone, json=json,
                 job_lock=threading.Lock(), jobs={}, prompt_trace_context=ContextVar('test_trace', default=None))
exec(compile(ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names], type_ignores=[]), str(source), 'exec'), namespace)

class Generator:
    def initial_seed(self): return 42

class Pipeline:
    def __call__(self, **kwargs):
        if kwargs.get('fail'): raise RuntimeError('inference failed')
        return kwargs

class PromptTraceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        namespace['JOBS_DIR'] = Path(self.temp.name)
        namespace['jobs'].clear()
    def tearDown(self): self.temp.cleanup()
    def run_generation(self, body):
        @namespace['trace_generation']
        def generate(body):
            namespace['update_job'](body['jobId'], stage='inpaint-generating', model='test')
            for retry in (False, True):
                namespace['update_job'](body['jobId'], autoRetry=retry)
                namespace['traced_pipeline_call'](Pipeline(), prompt=[body['prompt'] + (' retry' if retry else '')], negative_prompt=['avoid'], generator=Generator())
            return namespace['prompt_history']()
        return generate(body)
    def test_exact_calls_and_persistence(self):
        long_prompt = '<script>' + 'abc' * 1000
        history = self.run_generation({'jobId':'one','prompt':long_prompt})
        self.assertEqual(history[0]['prompts']['prompt'], [long_prompt])
        self.assertEqual(history[1]['prompts']['prompt'], [long_prompt + ' retry'])
        self.assertTrue(history[1]['autoRetry'])
        self.assertEqual(history[0]['seed'],42)
        persisted=json.loads((namespace['JOBS_DIR']/'one.json').read_text(encoding='utf-8'))
        self.assertEqual(persisted['promptHistory'],history)
        self.assertIsNone(namespace['prompt_trace_context'].get())
    def test_failure_retains_call_and_resets_context(self):
        @namespace['trace_generation']
        def fail(body): namespace['traced_pipeline_call'](Pipeline(), prompt='actual', fail=True)
        with self.assertRaises(RuntimeError): fail({'jobId':'failed'})
        self.assertEqual(namespace['jobs']['failed']['promptHistory'][0]['prompts']['prompt'],'actual')
        self.assertIsNone(namespace['prompt_trace_context'].get())
    def test_concurrent_isolation(self):
        with ThreadPoolExecutor(2) as pool:
            results=list(pool.map(self.run_generation,[{'jobId':'a','prompt':'A'},{'jobId':'b','prompt':'B'}]))
        self.assertEqual(results[0][0]['userPrompt'],'A')
        self.assertEqual(results[1][0]['userPrompt'],'B')
        self.assertEqual(len(namespace['jobs']['a']['promptHistory']),2)
    def test_no_text_and_flux(self):
        @namespace['trace_generation']
        def generate(body):
            namespace['update_job']('modes',stage='inpaint-generating')
            namespace['traced_pipeline_call'](Pipeline())
            namespace['traced_pipeline_call'](Pipeline(),prompt='merged',prompt_2='merged')
            return namespace['prompt_history']()
        history=generate({'jobId':'modes'})
        self.assertEqual(history[0]['negativePromptStrategy'],'unused')
        self.assertEqual(history[0]['prompts'],{})
        self.assertEqual(history[1]['negativePromptStrategy'],'unused')

if __name__ == '__main__': unittest.main()
