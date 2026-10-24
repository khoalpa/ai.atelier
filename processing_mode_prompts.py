"""Resolve editable processing instructions from the shared catalog."""
from pathlib import Path
from prompt_catalog import read_catalog

def processing_mode_prompt(root: Path, mode: str, fallback: str = '') -> str:
    value = read_catalog(root / 'workspace' / 'prompts.json')['processingModes'][mode]['prompt']
    if not isinstance(value, str) or not value.strip() or len(value) > 16000:
        raise ValueError('Invalid processing mode prompt: ' + mode)
    return value
