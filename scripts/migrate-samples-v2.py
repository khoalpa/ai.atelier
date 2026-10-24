"""Reversible sample migration. Copies and verifies before retiring legacy paths."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sample_catalog import resolve_sample


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bounded(path):
    path = path.resolve()
    if ROOT not in path.parents:
        raise ValueError('Migration target outside project: ' + str(path))
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    home = ROOT / 'workspace/diagnostics/samples-v2'
    backup = Path(json.loads((home / 'backup.json').read_text(encoding='utf-8'))['path'])
    original = json.loads((backup / 'manifest.json').read_text(encoding='utf-8'))
    if (ROOT / 'samples/catalog.json').exists():
        raise SystemExit('Migration already installed; use the import script for additional assets.')
    assets, aliases, copies = [], {}, []
    clothing_hashes = {}
    for record in original['files']:
        relative = record['path'].removeprefix('samples/')
        folder, tail = relative.split('/', 1)
        source = ROOT / record['path']
        if sha(source) != record['sha256']:
            raise ValueError('Source changed since backup: ' + relative)
        archived = folder in ('couple_tee', 'couple_tee_2', 'expand')
        if archived:
            destination = relative
        elif folder == 'synthetic-paired-vton-20261021':
            destination = 'datasets/synthetic-paired-vton/v1/' + tail
        elif folder in ('landscape', 'portrait'):
            destination = 'testing/regression-v1/storyboards/repair-shop/' + folder + '/' + tail
        else:
            name = {'object-removal-benchmark': 'object-removal', 'outpaint-benchmark': 'outpaint'}.get(folder, folder)
            destination = 'testing/regression-v1/' + name + '/' + tail
        target = (ROOT / 'workspace/sample-archive/v1' if archived else ROOT / 'samples') / destination
        image = source.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')
        if image and folder.startswith('couple_tee') and record['sha256'] in clothing_hashes:
            aliases[relative] = clothing_hashes[record['sha256']]
            continue
        copies.append((source, bounded(target), record['sha256']))
        if not image:
            continue
        if folder.startswith('couple_tee'):
            clothing_hashes[record['sha256']] = relative
        aliases[relative] = relative
        synthetic = folder == 'synthetic-paired-vton-20261021'
        roles = ['archive'] if archived else ['dataset'] if synthetic else ['regression']
        provenance = {'synthetic': synthetic, 'license': 'generation-terms' if synthetic else 'unverified',
                      'source': 'OpenAI ImageGen, recorded 2026-10-21' if synthetic else 'Legacy local asset; provenance not established',
                      'redistributable': synthetic}
        if folder == 'object-removal-benchmark':
            provenance = {'synthetic': True, 'license': 'project-generated', 'source': 'scripts/benchmark-object-removal.py', 'redistributable': True}
        from PIL import Image
        with Image.open(source) as im:
            width, height = im.size
        asset = {'id': relative, 'path': destination, 'storage': 'archive' if archived else 'samples',
                 'label': source.stem, 'group': folder, 'roles': roles, 'tasks': [],
                 'sha256': record['sha256'], 'width': width, 'height': height, 'bytes': record['bytes'], 'provenance': provenance}
        assets.append(asset)
    # Reuse only assets with recorded generation provenance, and only training products.
    product_ids = ['upper-body-01', 'upper-body-02', 'upper-body-05', 'upper-body-08',
                   'lower-body-01', 'lower-body-05', 'overall-01', 'overall-02']
    selected = {f'synthetic-paired-vton-20261021/images/{kind}/{product}{suffix}.png'
                for product in product_ids for kind, suffix in [('products', ''), ('people', '-p1')]}
    for asset in assets:
        if asset['id'] in selected:
            asset['roles'].append('demo')
            person = '/people/' in asset['id']
            asset['group'] = 'Người mẫu' if person else 'Trang phục'
            asset['label'] = ('Người mẫu · ' if person else 'Trang phục · ') + Path(asset['id']).stem
            asset['tasks'] = ['tryon', 'manual']
            asset['evaluation'] = 'demo-visible; not an independent holdout'
    plan = {'schemaVersion': 2, 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'assets': assets, 'legacyBackup': str(backup), 'policy': 'Demo is explicitly selected; legacy IDs and image bytes stay unchanged.'}
    write(home / 'migration-plan.json', {'assets': len(assets), 'aliases': len(aliases), 'copies': len(copies), 'demo': len(selected), 'backup': str(backup)})
    if not args.apply:
        print(json.dumps({'planned': len(copies), 'assets': len(assets), 'demo': len(selected)}))
        return
    for source, target, digest in copies:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and sha(target) != digest:
            raise ValueError('Conflicting destination: ' + str(target))
        shutil.copy2(source, target)
        if sha(target) != digest:
            raise ValueError('Copy verification failed: ' + str(target))
    write(ROOT / 'samples/aliases.json', {'schemaVersion': 1, 'aliases': aliases})
    write(ROOT / 'samples/catalog.json', plan)
    for record in original['files']:
        if Path(record['path']).suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp'):
            assert sha(resolve_sample(ROOT, record['path'].removeprefix('samples/'))) == record['sha256']
    # Original trees are retained in a separate rollback location, never deleted.
    retired = bounded(ROOT / 'workspace/sample-archive/original-layout-v1')
    retired.mkdir(parents=True, exist_ok=True)
    folders = sorted({record['path'].split('/')[1] for record in original['files']})
    for folder in folders:
        source = bounded(ROOT / 'samples' / folder)
        target = bounded(retired / folder)
        if target.exists():
            raise ValueError('Retired destination already exists: ' + str(target))
        source.rename(target)
    write(home / 'migration-result.json', {'verifiedLegacyImages': len(aliases), 'canonicalAssets': len(assets), 'demoImages': len(selected), 'retiredOriginals': str(retired), 'backup': str(backup)})
    print(json.dumps({'verifiedLegacyImages': len(aliases), 'canonicalAssets': len(assets), 'demoImages': len(selected)}))


if __name__ == '__main__':
    main()
