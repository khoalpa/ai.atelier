from helpers.ai_source import read_source
"""Verify prompt composition without loading model weights."""
import ast
from pathlib import Path
import sys
import tempfile
import json

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
source = ast.parse(read_source(root / 'ai_service.py', encoding='utf-8'))
names = {'build_inpaint_instruction', 'build_inpaint_negative_prompt'}
nodes = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in names]
nodes += [node for node in source.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'INPAINT_TARGETS' for target in node.targets)]
with tempfile.TemporaryDirectory() as temporary:
    test_root = Path(temporary)
    (test_root / 'workspace').mkdir()
    catalog = json.loads(read_source(root / 'workspace/prompts.json', encoding='utf-8'))
    for mode, text in {'base_layer': 'Use a neutral base layer.', 'reconstruct_body': 'Restore the covered body surfaces.', 'background': 'Continue the surrounding background.'}.items():
        catalog['processingModes'][mode]['prompt'] = text
    (test_root / 'workspace/prompts.json').write_text(json.dumps(catalog), encoding='utf-8')
    from prompt_catalog import prompt_text, prompt_template
    namespace = {'ROOT': test_root, 'prompt_text': prompt_text, 'prompt_template': prompt_template}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<instructions>', 'exec'), namespace)
    for architecture in ['flux', 'sdxl', 'sd15', 'anime']:
        for mode, replacement in [('base_layer', 'Use a neutral base layer.'), ('reconstruct_body', 'Restore the covered body surfaces.'), ('background', 'Continue the surrounding background.')]:
            request = 'Remove the selected glasses, including frames and lenses.'
            prompt, negative = namespace['build_inpaint_instruction']('glasses', mode, architecture, request)
            assert prompt.count(request) == 1
            assert prompt.count(replacement) == 1
            assert prompt.count('outside the mask 100% frozen and completely unchanged') == 1
            assert 'Avoid these failure modes:' not in prompt
            assert len(prompt) < 500
            assert 'Additional visual direction:' not in prompt
            assert negative
    prompt, _ = namespace['build_inpaint_instruction']('glasses', 'background', 'sdxl')
    assert 'selected glasses' in prompt
    prompt, negative = namespace['build_inpaint_instruction']('shirt', 'reconstruct_body', 'flux', 'Replace the long sleeves with bare arms.', forbidden_replacement='upper-body garment')
    assert 'Restore the covered body surfaces.' in prompt
    assert 'upper-body garment' not in negative
    assert 'Avoid these failure modes:' not in prompt
print('OK: removal, replacement and shared preservation compose once across model families.')
