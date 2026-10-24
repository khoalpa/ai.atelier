"""Load current domain implementations for the pre-existing isolated AST tests.

These tests inject mocked globals, so the model-state namespace is flattened at
this seam. Imports, state sharing and HTTP wiring have separate integration tests.
"""
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def ai_source():
    symbols = json.loads((ROOT / 'services/ai/symbols.json').read_text(encoding='utf-8'))
    modules = list(dict.fromkeys(symbols.values()))
    source = '\n\n'.join((ROOT / (name.replace('.', '/') + '.py')).read_text(encoding='utf-8') for name in modules)
    lines=source.splitlines(keepends=True)
    edits=[]
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            names=sorted({n.attr for n in ast.walk(node) if isinstance(n,ast.Attribute) and isinstance(n.value,ast.Name) and n.value.id=='model_state' and isinstance(n.ctx,ast.Store)})
            if names: edits.append((node.body[0].lineno-1, ' '*node.body[0].col_offset+'global '+', '.join(names)+'\n'))
    for offset,line in sorted(edits,reverse=True):lines.insert(offset,line)
    source=''.join(lines)
    return source.replace('model_state.', '')

def read_source(path, **kwargs):
    if Path(path).name == 'ai_service.py': return ai_source()
    text=Path(path).read_text(**kwargs)
    return text.replace('deps.','').replace('globalThis.AtelierApp.','') if Path(path).suffix=='.js' else text
