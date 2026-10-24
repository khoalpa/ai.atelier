from helpers.ai_source import read_source
"""Replacement prompts must not inherit object-removal instructions."""
import ast
from pathlib import Path

root = Path(__file__).resolve().parents[1]
tree = ast.parse(read_source(root / 'ai_service.py', encoding='utf-8'))
node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'resolve_inpaint_prompts')
import sys
sys.path.insert(0, str(root))
from prompt_catalog import task_prompt
scope = {'task_prompt': task_prompt}
exec(compile(ast.Module(body=[node], type_ignores=[]), '<prompt>', 'exec'), scope)
resolve = scope['resolve_inpaint_prompts']
body = {'processingMode': 'outfit-description', 'prompt': 'white linen shirt', 'negativePrompt': 'logos'}
for architecture in ('sdxl', 'sd35', 'flux'):
    result = resolve(body, architecture)
    assert 'white linen shirt' in result['prompt']
    assert 'Preserve identity' in result['prompt']
    assert 'Remove' not in result['prompt']
    assert result['negativePrompt'] == 'logos'
    assert result['generatedNegativePrompt'] == 'logos'
    confirmed = resolve({**body, 'confirmedPrompts': {'prompt': ' edited ', 'negativePrompt': ''}}, architecture)
    assert confirmed['prompt'] == 'edited' and confirmed['negativePrompt'] == ''
for invalid in ({'prompt': ' '}, {'confirmedPrompts': {}}, {'confirmedPrompts': 'text'}):
    try:
        resolve({**body, **invalid})
    except ValueError:
        pass
    else:
        raise AssertionError('Invalid description or confirmation accepted')
print('OK: replacement prompt preserves identity, excludes removal rules, honors confirmed prompts, validates input.')
