from helpers.ai_source import read_source
import ast
import os
import re
import tempfile
from pathlib import Path
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
tree = ast.parse(read_source(root/'ai_service.py', encoding='utf-8'))
node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'configured_path')
with tempfile.TemporaryDirectory() as folder:
    base = Path(folder)
    saved, override, fallback = (base/name for name in ('saved', 'override', 'default'))
    for directory in (saved, override, fallback): directory.mkdir()
    config = {'inpaintModel': str(saved)}
    namespace = dict(Path=Path, os=os, ROOT=base, LOCAL_CONFIG=config)
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<config>', 'exec'), namespace)
    resolve = namespace['configured_path']
    with patch.dict(os.environ):
        os.environ.pop('INPAINT_MODEL', None)
        assert resolve('INPAINT_MODEL', 'inpaintModel', fallback) == saved
        os.environ['INPAINT_MODEL'] = str(override)
        assert resolve('INPAINT_MODEL', 'inpaintModel', fallback) == override
        os.environ.pop('INPAINT_MODEL')
        config.clear()
        assert resolve('INPAINT_MODEL', 'inpaintModel', fallback) == fallback
for filename in ('start-all.ps1', 'start-ai.ps1'):
    assert not re.search(r'\$env:INPAINT_MODEL\s*=', read_source(root/filename, encoding='utf-8'), re.I)
print('OK: launchers preserve saved model choice and explicit environment overrides.')
