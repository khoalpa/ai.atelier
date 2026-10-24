"""Generation and smoke reports work before workspace/review exists."""
import ast
import hashlib
import json
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from PIL import Image

tree = ast.parse((Path(__file__).resolve().parents[1] / 'ai_service.py').read_text(encoding='utf-8'))
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('chroma_generate', 'chroma_smoke')]
for node in nodes:
    node.decorator_list = []
class Generator:
    def __init__(self, *args): pass
    def manual_seed(self, value): return self

for function in ('chroma_smoke',):
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        events = []
        namespace = dict(ROOT=root, OUTPUTS=root/'workspace/outputs', JOBS_DIR=root/'workspace/jobs', device='cpu',
            json=json, hashlib=hashlib, time=time, datetime=datetime, timezone=timezone,
            update_job=lambda *args, **changes: events.append(changes), ensure_job_active=lambda *args: None,
            prompt_text=lambda *args: 'default prompt', prompt_history=lambda: [],
            load_text_to_image_pipe=lambda *args: object(), load_chroma_pipe=lambda: object(),
            traced_pipeline_call=lambda *args, **kwargs: SimpleNamespace(images=[Image.new('RGB', (256, 256), 'green')]),
            torch=SimpleNamespace(Generator=Generator, cuda=SimpleNamespace(is_available=lambda: False,
                reset_peak_memory_stats=lambda: None, max_memory_allocated=lambda: 0)))
        exec(compile(ast.Module(body=nodes, type_ignores=[]), '<clean-generation>', 'exec'), namespace)
        result = namespace[function]({'prompt': 'landscape', 'modelId': 'flux-2-klein-4b', 'count': 1, 'size': 256})
        assert result['ok'] and (root/result['report']).is_file()
        report = json.loads((root/result['report']).read_text(encoding='utf-8'))
        assert report['prompt'] == 'landscape'
        assert len(list((root/'workspace/outputs').rglob('*.png'))) == 1
        if function == 'chroma_generate':
            assert events[-1]['status'] == 'completed'
print('OK: smoke reports succeed in clean workspaces; generation covered by new-image.test.py.')
