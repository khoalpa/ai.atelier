"""Install a pinned, verified Diffusers snapshot for offline inference."""
import hashlib
import json
import os
import subprocess
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

os.environ.setdefault('HF_HUB_DISABLE_XET', '1')
from huggingface_hub import HfApi, snapshot_download

ROOT = Path(__file__).resolve().parents[1]
REPO = 'black-forest-labs/FLUX.2-klein-4B'
TARGET = ROOT / 'models/flux/flux-2-klein-4b'
PATTERNS = ['model_index.json', 'scheduler/*', 'transformer/*', 'text_encoder/*', 'tokenizer/*', 'vae/*', 'README.md', '*LICENSE*']

def main():
    info = HfApi().model_info(REPO, files_metadata=True)
    marker = TARGET / 'installation.json'
    if marker.exists():
        marker.unlink()
    snapshot_download(REPO, revision=info.sha, local_dir=TARGET, allow_patterns=PATTERNS,
                      ignore_patterns=['*.safetensors'], max_workers=3)
    for item in info.siblings:
        if item.rfilename.endswith('.safetensors') and item.rfilename.split('/')[0] in ('transformer', 'text_encoder', 'vae'):
            download_parts(item, info.sha)
    records = []
    for item in info.siblings:
        target = TARGET / item.rfilename
        if not target.is_file():
            continue
        digest = checksum(target)
        expected = getattr(item.lfs, 'sha256', None) if item.lfs else None
        if expected and digest != expected:
            raise RuntimeError('Checksum mismatch: ' + item.rfilename)
        records.append({'file': item.rfilename, 'bytes': target.stat().st_size, 'sha256': digest, 'verifiedAgainstSource': bool(expected)})
    (TARGET / 'installation.json').write_text(json.dumps({'repo': REPO, 'revision': info.sha, 'license': 'Apache-2.0', 'files': records}, indent=2), encoding='utf-8')
    print('VERIFIED', info.sha, len(records), 'files', flush=True)

def download_parts(item, revision):
    target = TARGET / item.rfilename
    if target.is_file() and target.stat().st_size == item.size:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    parts = target.parent / (target.name + '.parts')
    parts.mkdir(exist_ok=True)
    chunk = 32 * 1024 * 1024
    ranges = [(start, min(start + chunk, item.size) - 1) for start in range(0, item.size, chunk)]
    def fetch(bounds):
        start, end = bounds
        part = parts / str(start)
        if part.is_file() and part.stat().st_size == end - start + 1:
            return
        url = f'https://huggingface.co/{REPO}/resolve/{revision}/{item.rfilename}?part={start}'
        subprocess.run(['curl.exe', '--fail', '--location', '--silent', '--show-error', '--retry', '4',
                        '--max-time', '180', '--range', f'{start}-{end}', '--output', str(part), url], check=True)
        if part.stat().st_size != end - start + 1:
            raise RuntimeError('Invalid range download: ' + str(part))
    with ThreadPoolExecutor(max_workers=8) as pool:
        for index, future in enumerate(as_completed([pool.submit(fetch, bounds) for bounds in ranges]), 1):
            future.result()
            print(item.rfilename, index, '/', len(ranges), flush=True)
    temporary = target.with_suffix('.assembling')
    with temporary.open('wb') as output:
        for start, end in ranges:
            with (parts / str(start)).open('rb') as stream:
                shutil.copyfileobj(stream, output, 8 * 1024 * 1024)
    temporary.replace(target)
    for start, end in ranges:
        (parts / str(start)).unlink()
    parts.rmdir()

def checksum(target):
    digest = hashlib.sha256()
    with target.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

if __name__ == '__main__':
    main()
