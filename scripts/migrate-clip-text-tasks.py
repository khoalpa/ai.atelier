"""One-time, recoverable migration for legacy CLIP text jobs."""
from datetime import datetime, timezone
from pathlib import Path
import json
import shutil
import sys


ROOT = Path(__file__).resolve().parents[1]
JOBS = ROOT / 'workspace' / 'jobs'
STAMP = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
BACKUP = ROOT / 'workspace' / 'backups' / f'clip-text-migration-{STAMP}'
CLIP_MODELS = {'sd35-medium', 'sdxl-base-1.0', 'sd35-inpaint', 'sdxl-inpaint-base-0.1', 'flux-1-fill-dev'}
CLIP_ROUTES = {'/inpaint', '/outpaint', '/sd35-conditioned-generate', '/sdxl-conditioned-generate'}


def migrate(value):
    changed = False
    if isinstance(value, dict):
        for key in ('clipPrompt', 'clipNegativePrompt'):
            if key in value:
                del value[key]
                changed = True
        for item in list(value.values()):
            changed = migrate(item) or changed
        model = str(value.get('modelId') or value.get('model') or '')
        route = str(value.get('_route') or '')
        task = str(value.get('taskType') or '')
        if model in CLIP_MODELS or route in CLIP_ROUTES or task in {'inpaint', 'outpaint'}:
            if value.get('replayBlockedReason') != 'clip-text-policy':
                value['replayBlockedReason'] = 'clip-text-policy'
                value['replayAllowed'] = False
                changed = True
    elif isinstance(value, list):
        for item in value:
            changed = migrate(item) or changed
    return changed


def main():
    changed = scanned = 0
    if not JOBS.is_dir():
        print(json.dumps({'ok': True, 'scanned': 0, 'changed': 0, 'backup': None}))
        return
    for path in sorted(JOBS.glob('*.json')):
        scanned += 1
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            continue
        if not migrate(data):
            continue
        relative = path.relative_to(JOBS)
        target = BACKUP / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        temporary = path.with_suffix(path.suffix + '.clip-migration.tmp')
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(path)
        changed += 1
    manifest = {'schemaVersion': 1, 'createdAt': datetime.now(timezone.utc).isoformat(),
                'scanned': scanned, 'changed': changed,
                'backup': str(BACKUP.relative_to(ROOT)).replace('\\', '/') if changed else None}
    if changed:
        (BACKUP / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'ok': True, **manifest}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        raise
