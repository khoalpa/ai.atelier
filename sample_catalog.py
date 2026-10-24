"""Resolve stable sample IDs without rewriting historical jobs or image bytes."""
import json
from pathlib import Path

COLLECTIONS = {
    'characters': 'testing/regression-v1/characters',
    'garment': 'testing/regression-v1/garment',
    'landscape': 'testing/regression-v1/storyboards/repair-shop/landscape',
    'portrait': 'testing/regression-v1/storyboards/repair-shop/portrait',
    'object-removal-benchmark': 'testing/regression-v1/object-removal',
    'outpaint-benchmark': 'testing/regression-v1/outpaint',
    'synthetic-paired-vton-20261021': 'datasets/synthetic-paired-vton/v1',
}


def collection_path(root, relative):
    """Internal diagnostic access to a migrated collection, including manifests."""
    root = Path(root)
    parts = str(relative).replace('\\', '/').split('/')
    if any(p in ('', '.', '..') or ':' in p for p in parts):
        raise ValueError('Invalid collection path')
    if not (root / 'samples/catalog.json').exists():
        return root / 'samples' / relative
    if parts[0] in ('couple_tee', 'couple_tee_2', 'expand'):
        return root / 'workspace/sample-archive/v1' / relative
    return root / 'samples' / COLLECTIONS.get(parts[0], parts[0]) / Path(*parts[1:])


def project_path(root, relative):
    """Resolve paths recorded by older offline diagnostic reports."""
    root = Path(root)
    value = str(relative).replace('\\', '/')
    prefix = root.as_posix() + '/'
    if value.casefold().startswith(prefix.casefold()):
        value = value[len(prefix):]
    if value.startswith('samples/'):
        value = value[8:]
        if Path(value).suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp'):
            return resolve_sample(root, value)
        return collection_path(root, value)
    return root / relative


def sample_id_for_path(root, file):
    root=Path(root);file=project_path(root,file).resolve()
    catalog=root/'samples/catalog.json'
    if catalog.exists():
        for asset in json.loads(catalog.read_text(encoding='utf-8'))['assets']:
            base=root/('workspace/sample-archive/v1'if asset.get('storage')=='archive'else'samples')
            if (base/asset['path']).resolve()==file:return asset['id']
        raise ValueError('File is not in the sample catalog')
    return file.relative_to((root/'samples').resolve()).as_posix()


def sample_ids(root, prefixes=(), fallback_prefixes=()):
    root = Path(root)
    file = root / 'samples/catalog.json'
    if file.exists():
        ids = json.loads((root / 'samples/aliases.json').read_text(encoding='utf-8'))['aliases']
    else:
        ids = [p.relative_to(root / 'samples').as_posix() for p in (root / 'samples').rglob('*') if p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp')]
    selected = sorted(value for value in ids if not prefixes or value.startswith(tuple(prefixes)))
    if not selected and fallback_prefixes:
        selected = sorted(value for value in ids if value.startswith(tuple(fallback_prefixes)))
    return selected


def resolve_sample(root, sample_id):
    root = Path(root)
    value = str(sample_id).replace('\\', '/')
    if not value or value.startswith('/') or ':' in value or any(p in ('.', '..') for p in value.split('/')):
        raise ValueError('Ảnh nguồn không hợp lệ')
    catalog_file = root / 'samples/catalog.json'
    base = root / 'samples'
    if catalog_file.exists():
        catalog = json.loads(catalog_file.read_text(encoding='utf-8'))
        aliases = json.loads((root / 'samples/aliases.json').read_text(encoding='utf-8'))['aliases']
        key = aliases.get(value, value)
        asset = next((a for a in catalog['assets'] if a['id'] == key), None)
        if asset is None:
            asset = next((a for a in catalog['assets'] if a.get('storage') != 'archive' and a['path'] == value), None)
        if asset is None:
            raise ValueError('Ảnh mẫu không có trong danh mục')
        if asset.get('storage') == 'archive':
            base = root / 'workspace/sample-archive/v1'
        value = asset['path']
    base = base.resolve()
    target = (base / value).resolve()
    if base not in target.parents or not target.is_file():
        raise ValueError('Ảnh nguồn không hợp lệ')
    return target
