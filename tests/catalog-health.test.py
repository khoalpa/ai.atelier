"""Live catalog mappings must become plain JSON at public API boundaries."""
import ast
import json
import sys
from pathlib import Path
from types import SimpleNamespace
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from prompt_catalog import CatalogMap, catalog_value
source=ast.parse((ROOT/'character.py').read_text(encoding='utf-8'))
node=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='configuration')
scope={'runtime':SimpleNamespace(configuration=lambda root:{'ready':True}),'geometry':SimpleNamespace(EXPRESSIONS=CatalogMap('featurePresets','character.expressions'),POSES=CatalogMap('featurePresets','character.poses'),JOINTS=[],EDGES=[]),'quality':SimpleNamespace(available=lambda root:False)}
exec(compile(ast.Module(body=[node],type_ignores=[]),'<configuration>','exec'),scope)
payload=scope['configuration'](ROOT)
assert json.loads(json.dumps(payload))['poses']==catalog_value('featurePresets','character.poses')
assert isinstance(payload['expressions'],dict)
print('OK: character configuration and health payloads serialize live catalog mappings.')
