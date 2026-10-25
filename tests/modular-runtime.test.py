"""Test actual module wiring, durable execution and HTTP without GPU inference."""
import builtins
import dis
import importlib
import json
import sys
import tempfile
import threading
import types
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from services.ai.runtime import jobs, metadata
from services.ai.runtime.execution import ExecutionJournal
from services.ai.runtime.factory import task_context
import services.ai.http as http

class RuntimeTests(unittest.TestCase):
    def test_legacy_entry_point_exports_prompt_catalog_helpers(self):
        import ai_service
        import prompt_catalog
        for name in ('prompt_text','prompt_template','read_catalog','task_prompt'):
            self.assertIs(getattr(ai_service,name),getattr(prompt_catalog,name))

    def test_legacy_diagnostics_override_the_actual_domain_dependencies(self):
        import ai_service
        from services.ai.tasks import tryon
        from services.ai.runtime import factory
        original=ai_service.traced_pipeline_call
        replacement=lambda *args,**kwargs:None
        try:
            ai_service.traced_pipeline_call=replacement
            self.assertIs(tryon.traced_pipeline_call,replacement)
            self.assertIs(factory.task_context()['traced_pipeline_call'],replacement)
        finally:ai_service.traced_pipeline_call=original
        self.assertIs(tryon.traced_pipeline_call,original)

    def test_every_extracted_function_has_its_global_dependencies(self):
        symbols=json.loads((ROOT/'services/ai/symbols.json').read_text(encoding='utf-8'))
        missing=[]
        def check(code, namespace, owner):
            for op in dis.get_instructions(code):
                if op.opname=='LOAD_GLOBAL' and op.argval not in namespace and not hasattr(builtins,op.argval):missing.append(owner+':'+str(op.argval))
            for child in code.co_consts:
                if isinstance(child,types.CodeType):check(child,namespace,owner)
        for name in set(symbols.values()):
            module=importlib.import_module(name)
            for key,value in vars(module).items():
                if isinstance(value,types.FunctionType) and value.__module__==name:check(value.__code__,value.__globals__,name+'.'+key)
        self.assertEqual(missing,[])
        self.assertEqual(task_context()['ROOT'],ROOT)
        for name in ('release_inpaint','release_tryon','release_text_to_image'):
            self.assertTrue(callable(task_context()[name]),name)
        with self.assertRaises(Exception):task_context().ROOT=Path('elsewhere')

    def test_durable_http_replay_rejects_conflicts_without_damaging_completed_job(self):
        with tempfile.TemporaryDirectory(prefix='atelier-journal-') as folder:
            directory=Path(folder)/'workspace/jobs'
            with patch.object(jobs,'JOBS_DIR',directory),patch.object(jobs,'jobs',{}):
                journal=ExecutionJournal(ROOT,directory,jobs.update_job,jobs.ensure_job_active,'test-revision')
                server=http.ThreadingHTTPServer(('127.0.0.1',0),http.Handler)
                thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
                def post(body):
                    request=urllib.request.Request(f'http://127.0.0.1:{server.server_port}/enhance',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Host':f'127.0.0.1:{http.PORT}'})
                    try:
                        with urllib.request.urlopen(request,timeout=10) as response:return response.status,json.load(response)
                    except urllib.error.HTTPError as error:return error.code,json.load(error)
                try:
                    with patch.object(http,'execution_journal',return_value=journal),patch('image_enhancement.enhance',return_value={'ok':True,'results':[{'file':'preserved.png'}]}) as run:
                        body={'jobId':'repeat','seed':42}
                        self.assertEqual(post(body)[0],200);self.assertEqual(post(body)[1]['results'][0]['file'],'preserved.png');self.assertEqual(run.call_count,1)
                        self.assertEqual(post({**body,'seed':99})[0],400)
                        self.assertEqual(metadata.read(directory/'repeat.json')['status'],'completed')
                        self.assertEqual(post(body)[0],200);self.assertEqual(run.call_count,1)
                finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
