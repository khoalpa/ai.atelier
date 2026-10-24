"""Check prompt preview and confirmed overrides without model loading."""
import ast
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
tree = ast.parse((root / 'ai_service.py').read_text(encoding='utf-8'))
names = {'build_inpaint_instruction', 'build_inpaint_negative_prompt', 'resolve_inpaint_prompts'}
nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
nodes += [n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'INPAINT_TARGETS' for t in n.targets)]
from prompt_catalog import prompt_text, prompt_template
scope = {'ROOT': root, 'prompt_text': prompt_text, 'prompt_template': prompt_template}
exec(compile(ast.Module(body=nodes, type_ignores=[]), '<prompts>', 'exec'), scope)
resolve = scope['resolve_inpaint_prompts']
body = {'removalTarget': 'glasses', 'fillMode': 'background', 'prompt': 'Remove glasses.', 'negativePrompt': 'blur, BLUR'}
preview = resolve(body)
assert preview['prompt'].count('Remove glasses.') == 1
assert preview['negativePrompt'].split(', ').count('blur') == 1
for architecture in ('sdxl', 'sd35', 'flux'):
    assert resolve(body, architecture)['prompt'] == preview['prompt']
    final = resolve({**body, 'confirmedPrompts': {'prompt': ' User edited final ', 'negativePrompt': ''}}, architecture)
    assert final['prompt'] == 'User edited final'
    assert final['negativePrompt'] == ''
for invalid in ({}, {'prompt': ' ', 'negativePrompt': ''}, 'text', {'prompt': 'ok', 'negativePrompt': None}):
    try:
        resolve({**body, 'confirmedPrompts': invalid})
        raise AssertionError('Invalid confirmation accepted')
    except ValueError:
        pass
print('OK: preview composition, model parity, exact confirmed overrides and validation.')
