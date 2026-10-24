from helpers.ai_source import read_source
"""AI prompt confirmation accepts the same image payload budget as inference."""
import ast
import io
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
tree = ast.parse(read_source(root/'ai_service.py', encoding='utf-8'))
handler = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Handler')
method = next(n for n in handler.body if isinstance(n, ast.FunctionDef) and n.name == 'do_POST')
method.decorator_list = []
namespace = dict(execution_journal=lambda:SimpleNamespace(routes={}),json=json, Path=Path, INPAINT_MODEL=root/'model',
    inpaint_model_entry=lambda *args: None, detect_inpaint_architecture=lambda *args: 'sdxl',
    resolved_inpaint_profile=lambda *args: {}, resolve_inpaint_prompts=lambda *args: {'prompt':'scene', 'negativePrompt':''})
exec(compile(ast.Module(body=[method], type_ignores=[]), '<payload>', 'exec'), namespace)
payload = json.dumps({'editableMask': 'x'*(3*1024*1024)}).encode()
class Request:
    path = '/inpaint-prompts'
    headers = {'Content-Length': str(len(payload))}
    rfile = io.BytesIO(payload)
    def reply(self, status, body): self.status, self.body = status, body
request = Request()
with patch.dict(sys.modules, {'prompt_limits': SimpleNamespace(preview_encoder_prompts=lambda *args: [])}):
    namespace['do_POST'](request)
assert request.status == 200 and request.body['ok']
request.headers = {'Content-Length': str(31*1024*1024)}
namespace['do_POST'](request)
assert request.status == 400 and not request.body['ok']
print('OK: AI prompt confirmation accepts 3 MB and rejects requests above 30 MB.')
