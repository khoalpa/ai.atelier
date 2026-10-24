"""Replaying a job replaces the previous attempt's cards, keeping normal appends."""
import ast
import json
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

root=Path(__file__).resolve().parents[1]
tree=ast.parse((root/'ai_service.py').read_text(encoding='utf-8'))
node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='update_job')
with tempfile.TemporaryDirectory() as directory:
    ns=dict(jobs={},job_lock=threading.Lock(),datetime=datetime,timezone=timezone,json=json,JOBS_DIR=Path(directory))
    exec(compile(ast.Module(body=[node],type_ignores=[]),'job update','exec'),ns)
    update=ns['update_job']
    update('replay',status='completed',_result=dict(sampleId='portrait',seed=42,file='old.png'))
    update('replay',status='running',results=[])
    assert ns['jobs']['replay']['results']==[]
    update('replay',_result=dict(sampleId='portrait',seed=42,file='new1.png'))
    update('replay',_result=dict(sampleId='portrait',seed=43,file='new2.png'))
    assert [item['file'] for item in ns['jobs']['replay']['results']]==['new1.png','new2.png']
    assert len(json.loads((Path(directory)/'replay.json').read_text(encoding='utf-8'))['results'])==2
print('OK: replay clears old cards; new variants append and persist.')
