"""Read the same prompt catalog as the web app, including saved edits."""
import json
import re
import threading
from collections.abc import Mapping
from pathlib import Path

_FILE = Path(__file__).resolve().parent / 'workspace' / 'prompts.json'
_lock = threading.Lock()
_stamp = None
_catalog = None

def read_catalog(file=None):
    global _stamp, _catalog
    path = Path(file) if file else _FILE
    with _lock:
        stat = path.stat()
        stamp = (str(path), stat.st_mtime_ns, stat.st_size)
        if stamp != _stamp:
            value = json.loads(path.read_text(encoding='utf-8'))
            if value.get('schemaVersion') != 1:
                raise ValueError('Unsupported prompt catalog version')
            for key in ('components', 'templates', 'processingModes', 'presets', 'runtimePresets', 'featurePresets'):
                if not isinstance(value.get(key), dict):
                    raise ValueError('Invalid prompt catalog: ' + key)
            _catalog, _stamp = value, stamp
        return _catalog

def prompt_text(key):
    value = read_catalog()['components'][key]
    if not isinstance(value, str):
        raise ValueError('Invalid prompt component: ' + key)
    return value


def prompt_value(value, label='Prompt'):
    if not isinstance(value, str) or len(value) > 16000:
        raise ValueError(label + ' phải là văn bản, tối đa 16000 ký tự; nội dung chưa được gửi đến model.')
    return value

def prompt_template(key, **variables):
    template = read_catalog()['templates'][key]
    return re.sub(r'\{([a-zA-Z][a-zA-Z0-9_]*)\}', lambda match: str(variables[match[1]]), template)

def task_prompt(key, polarity='positive', **variables):
    spec = read_catalog()['tasks'][key][polarity]
    variables = {**variables, **{name: prompt_text(ref) for name, ref in spec.get('componentBindings', {}).items()}}
    parts = [prompt_text(component) for component in spec.get('components', [])]
    for item_id in spec.get('libraryIds', []):
        parts.append(next(item['text'] for item in read_catalog()['library'] if item['id'] == item_id))
    if spec.get('template'):
        parts.append(prompt_template(spec['template'], **variables))
    return (', ' if polarity == 'negative' else ' ').join(parts)

def catalog_value(*keys):
    value = read_catalog()
    for key in keys:
        value = value[key]
    return value

class CatalogMap(Mapping):
    """A live mapping; imported catalog edits never leave module constants stale."""
    def __init__(self, *keys):
        self.keys_path = keys

    def __getitem__(self, key):
        return catalog_value(*self.keys_path)[key]

    def __iter__(self):
        return iter(catalog_value(*self.keys_path))

    def __len__(self):
        return len(catalog_value(*self.keys_path))
