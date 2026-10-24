"""Verify lossless prompt composition and live catalog reload without models."""
import ast
import hashlib
import json
import sys
import tempfile
from pathlib import Path

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
from prompt_catalog import prompt_text, prompt_template, read_catalog
from processing_mode_prompts import processing_mode_prompt
from unittest.mock import patch
import prompt_catalog

tree=ast.parse((root/'ai_service.py').read_text(encoding='utf-8'))
names={'build_inpaint_instruction','build_inpaint_negative_prompt','resolve_inpaint_prompts'}
nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
nodes += [n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='INPAINT_TARGETS' for t in n.targets)]
scope={'ROOT':root,'prompt_text':prompt_text,'prompt_template':prompt_template}
exec(compile(ast.Module(body=nodes,type_ignores=[]),'<helpers>','exec'),scope)
# Golden composition inputs must not depend on user-editable workspace prompts.
fixture = root / 'tests/fixtures/prompt-catalog.json'
with tempfile.TemporaryDirectory(prefix='atelier-prompt-fixture-') as temporary, patch.object(prompt_catalog, '_FILE', fixture):
    fixture_root = Path(temporary)
    (fixture_root / 'workspace').mkdir()
    (fixture_root / 'workspace/prompts.json').write_bytes(fixture.read_bytes())
    scope['ROOT'] = fixture_root
    results=[]
    for target in scope['INPAINT_TARGETS']:
        for mode in ('base_layer','reconstruct_body','background'):
            for architecture in ('flux','sdxl','sd35'):
                for user in ('','Remove selected item. Giữ ánh sáng.'):
                    results.append(scope['build_inpaint_instruction'](target,mode,architecture,user,forbidden_replacement='new object'))
                    for retry in (False,True):
                        results.append(scope['build_inpaint_negative_prompt'](target,mode,retry,'blur, BLUR, extra artifact'))
    expected=json.loads((root/'tests/prompt-catalog-fingerprint.json').read_text())
    assert len(results)==expected['cases']
    assert hashlib.sha256(json.dumps(results,ensure_ascii=False).encode()).hexdigest()==expected['sha256']
with tempfile.TemporaryDirectory() as temporary:
    test_root=Path(temporary)
    (test_root/'workspace').mkdir()
    file=test_root/'workspace/prompts.json'
    catalog=json.loads((root/'workspace/prompts.json').read_text(encoding='utf-8'))
    for text in ('First instruction.','New instruction with Unicode: ánh sáng.'):
        catalog['processingModes']['background']['prompt']=text
        file.write_text(json.dumps(catalog),encoding='utf-8')
        assert processing_mode_prompt(test_root,'background')==text
    file.write_text('{bad json',encoding='utf-8')
    try:read_catalog(file)
    except ValueError:pass
    else:raise AssertionError('Invalid catalog was ignored')
print('OK: 486 fixed-fixture prompt composition cases verified; shared catalog reload and invalid JSON checked.')
