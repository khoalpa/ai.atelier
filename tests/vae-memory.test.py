from helpers.ai_source import read_source
import ast
from pathlib import Path
from types import SimpleNamespace

tree = ast.parse(read_source(Path(__file__).resolve().parents[1] / 'ai_service.py', encoding='utf-8'))
ns = {}
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'configure_vae_memory'], type_ignores=[]), '<vae-memory>', 'exec'), ns)
configure = ns['configure_vae_memory']
calls = []
vae = SimpleNamespace(enable_tiling=lambda: calls.append('vae-tiling'), enable_slicing=lambda: calls.append('vae-slicing'))
configure(SimpleNamespace(vae=vae))
assert calls == ['vae-tiling', 'vae-slicing']
calls.clear()
configure(SimpleNamespace(vae=vae, enable_vae_tiling=lambda: calls.append('pipeline-tiling'), enable_vae_slicing=lambda: calls.append('pipeline-slicing')))
assert calls == ['pipeline-tiling', 'pipeline-slicing']
calls.clear()
configure(SimpleNamespace(vae=SimpleNamespace(enable_tiling=lambda: calls.append('tiling'))))
assert calls == ['tiling']
configure(SimpleNamespace())
print('OK: pipeline API, VAE fallback, partial and absent optimization support.')
