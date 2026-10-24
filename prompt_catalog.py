"""Read the same prompt catalog as the web app, including saved edits."""
import json
import re
import threading
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
            for key in ('components', 'templates', 'processingModes', 'presets', 'runtimePresets'):
                if not isinstance(value.get(key), dict):
                    raise ValueError('Invalid prompt catalog: ' + key)
            _catalog, _stamp = value, stamp
        return _catalog

def prompt_text(key):
    value = read_catalog()['components'][key]
    if not isinstance(value, str):
        raise ValueError('Invalid prompt component: ' + key)
    return value

def prompt_template(key, **variables):
    template = read_catalog()['templates'][key]
    return re.sub(r'\{([a-zA-Z][a-zA-Z0-9_]*)\}', lambda match: str(variables[match[1]]), template)

def task_prompt(key, polarity='positive', **variables):
    spec = read_catalog()['tasks'][key][polarity]
    parts = [prompt_text(component) for component in spec.get('components', [])]
    if spec.get('template'):
        parts.append(prompt_template(spec['template'], **variables))
    return (', ' if polarity == 'negative' else ' ').join(parts)
