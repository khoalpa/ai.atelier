import importlib.util
import json
import tempfile
from pathlib import Path


root = Path(__file__).resolve().parents[1]
registry = json.loads((root / 'models' / 'registry.json').read_text(encoding='utf-8'))
models = {item['id']: item for item in registry['models']}
assert models['flux-chroma1-hd']['textEncoder'] == 't5'
assert models['flux-2-klein-4b']['textEncoder'] == 'qwen'
assert models['qwen-image-base']['textEncoder'] == 'qwen'
assert models['qwen-image-controlnet-inpainting']['textEncoder'] == 'qwen'
assert models['qwen-image-controlnet-union']['textEncoder'] == 'qwen'
assert models['qwen-image-controlnet-inpainting']['baseModelPath'] == models['qwen-image-controlnet-union']['baseModelPath']
for model_id in ('sd35-inpaint', 'waifu-inpaint-xl', 'sdxl-inpaint-base-0.1', 'flux-1-fill-dev', 'controlnet-depth-sd35-large', 'controlnet-canny-sd35-large'):
    assert model_id not in models

routes = (root / 'apps' / 'local-api' / 'services' / 'routes.js').read_text(encoding='utf-8')
assert "pathname === '/api/inpaint'" in routes and "proxyToAi(req,res,'/inpaint'" in routes
assert "pathname === '/api/qwen-depth-generate'" in routes and "proxyToAi(req,res,'/qwen-depth-generate'" in routes
assert "pathname === '/api/outpaint'" in routes and "proxyToAi(req,res,'/outpaint'" in routes

spec = importlib.util.spec_from_file_location('clip_migration', root / 'scripts' / 'migrate-clip-text-tasks.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
record = {'request': {'clipPrompt': 'old', 'modelId': 'sd35-medium'}, '_route': '/inpaint'}
assert module.migrate(record)
assert 'clipPrompt' not in record['request']
assert record['request']['replayAllowed'] is False
assert record['replayAllowed'] is False
print('OK: Qwen model metadata, permanent CLIP model removal, API gates, and CLIP job migration are enforced.')
