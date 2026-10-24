from services.ai.runtime import metadata
from helpers.ai_source import read_source
"""All replay branches clear cancellation while preserving saved requests."""
import ast
import json
import tempfile
from pathlib import Path

tree = ast.parse(read_source(Path(__file__).resolve().parents[1] / 'ai_service.py', encoding='utf-8'))
node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'resume_job')
with tempfile.TemporaryDirectory() as directory:
    state = {}
    def update(job_id, **changes):
        state.update(changes)
    def replay(body):
        assert state['cancelRequested'] is False
        assert state['status'] == 'running' and state['error'] is None
        assert body['resume'] is True and body['jobId'] == 'demo'
        assert body['sampleIds'] == ['original']
        return {'ok': True}
    namespace = dict(Path=Path, JOBS_DIR=Path(directory), json=json, update_job=update,
                     batch_tryon=replay, inpaint=replay, outpaint=replay)
    namespace['metadata']=metadata
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<resume>', 'exec'), namespace)
    for task in ('batch-tryon', 'inpaint', 'outpaint', None):
        saved = {'sampleIds': ['original']}
        if task:
            saved['taskType'] = task
        target = Path(directory, 'demo.request.json')
        target.write_text(json.dumps(saved), encoding='utf-8')
        state.update(cancelRequested=True, status='interrupted', error='old failure')
        assert namespace['resume_job']({'jobId': 'demo'})['ok']
        assert json.loads(read_source(target, encoding='utf-8')) == saved
print('OK: replay resets cancellation for batch, legacy batch, inpaint and outpaint.')
