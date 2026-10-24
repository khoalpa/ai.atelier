from helpers.ai_source import read_source
"""Concurrent model requests serialize without blocking cancellation or status."""
import ast
import sys
import threading
from functools import wraps
from pathlib import Path
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor

tree = ast.parse(read_source(Path(__file__).resolve().parents[1] / 'ai_service.py', encoding='utf-8'))
node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'serialized_inference')
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from service_lifecycle import ServiceLifecycle
namespace = dict(wraps=wraps, inference_lock=threading.RLock(), service_lifecycle=ServiceLifecycle())
exec(compile(ast.Module(body=[node], type_ignores=[]), '<serialization>', 'exec'), namespace)
entered, release, second_started, second_entered = (threading.Event() for _ in range(4))
state = []

@namespace['serialized_inference']
def request(self):
    if self.path == '/segment':
        entered.set()
        assert release.wait(5)
    elif self.path == '/tryon':
        second_entered.set()
    state.append(self.path)
    return self.path

def second():
    second_started.set()
    return request(SimpleNamespace(path='/tryon'))

with ThreadPoolExecutor(max_workers=3) as pool:
    first = pool.submit(request, SimpleNamespace(path='/segment'))
    assert entered.wait(5)
    pending = pool.submit(second)
    try:
        assert second_started.wait(5)
        assert not second_entered.wait(.1)
        for endpoint in ('/cancel-job', '/job-status'):
            assert pool.submit(request, SimpleNamespace(path=endpoint)).result(2) == endpoint
    finally:
        release.set()
    first.result(5)
    pending.result(5)
assert state.index('/segment') < state.index('/tryon')

@namespace['serialized_inference']
def failing(self):
    raise ValueError('inference failed')

try:
    failing(SimpleNamespace(path='/inpaint'))
except ValueError:
    pass
with ThreadPoolExecutor(max_workers=1) as pool:
    assert pool.submit(request, SimpleNamespace(path='/tryon')).result(2) == '/tryon'
handler = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Handler')
post = next(n for n in handler.body if isinstance(n, ast.FunctionDef) and n.name == 'do_POST')
assert any(isinstance(d, ast.Name) and d.id == 'serialized_inference' for d in post.decorator_list)
print('OK: model requests serialize, controls bypass inference and exceptions release the lock.')
