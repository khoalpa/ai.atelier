"""Install SD3.5 depth assets with resumable, verified range downloads."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4
import hashlib
import json
import os
import time
import requests
from huggingface_hub import HfApi, get_hf_file_metadata, hf_hub_url, hf_hub_download

ROOT = Path(__file__).resolve().parents[1]
STATUS = ROOT / 'workspace/sd35-depth-install.json'


def status(**values):
    values.update(processId=os.getpid(), updatedAt=time.time())
    temporary = STATUS.with_suffix('.tmp')
    temporary.write_text(json.dumps(values, indent=2), encoding='utf-8')
    temporary.replace(STATUS)


class RangeSource:
    """Share refreshed signed URLs between workers without changing file identity."""
    def __init__(self, repo, name):
        self.url = hf_hub_url(repo, name)
        self.lock = Lock()
        self.meta = None
        self.refreshed = 0
        self.refresh()

    def refresh(self, failed_location=None):
        with self.lock:
            if failed_location and failed_location != self.meta.location:
                return  # Another worker already replaced the rejected URL.
            # Bust cached redirects; otherwise the Hub may return the same expired URL.
            fresh = get_hf_file_metadata(self.url + '?download=true&refresh=' + uuid4().hex)
            if self.meta and (fresh.size != self.meta.size or fresh.etag != self.meta.etag):
                raise RuntimeError('Remote file changed; refusing to append incompatible data')
            self.meta = fresh
            self.refreshed = time.time()

    def location(self):
        with self.lock:
            current = self.meta.location
            expiry = parse_qs(urlsplit(current).query).get('Expires', [None])[0]
            stale = time.time() - self.refreshed > 900
            try:
                stale = stale or (expiry is not None and float(expiry) - time.time() < 120)
            except (ValueError, TypeError):
                pass
        if stale:
            self.refresh(failed_location=current)
        return self.meta.location

    def fetch(self, bounds):
        start, end = bounds
        for attempt in range(8):
            try:
                location = self.location()
                with requests.get(location, headers={'Range': f'bytes={start}-{end}'}, timeout=(15, 60)) as response:
                    if response.status_code in (401, 403):
                        self.refresh(failed_location=location)
                        continue
                    response.raise_for_status()
                    expected = f'bytes {start}-{end}/{self.meta.size}'
                    if response.status_code != 206 or response.headers.get('Content-Range') != expected:
                        raise RuntimeError('Server returned an unexpected byte range')
                    data = response.content
                    if len(data) != end - start + 1:
                        raise RuntimeError('Incomplete byte range')
                    return data
            except (requests.RequestException, RuntimeError):
                if attempt == 7:
                    break
                time.sleep(min(2 ** attempt, 15))
        # Do not save signed URLs or access credentials in the status log.
        raise RuntimeError(f'Download failed after retries at byte {start}; saved data can be resumed')


def verify(file, etag):
    sha = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            sha.update(chunk)
    if len(etag) == 64 and sha.hexdigest() != etag:
        raise RuntimeError('SHA256 mismatch: ' + file.name)


def download(repo, folder):
    target = ROOT / 'models' / folder
    target.mkdir(parents=True, exist_ok=True)
    for item in HfApi().model_info(repo, files_metadata=True).siblings:
        name = item.rfilename
        if not (name.endswith(('.json', '.safetensors')) or name.startswith('LICENSE')):
            continue
        if not name.endswith('.safetensors'):
            hf_hub_download(repo, name, local_dir=str(target))
            continue
        source = RangeSource(repo, name)
        destination = target / name
        partial = target / (name + '.partial')
        if destination.exists() and destination.stat().st_size == source.meta.size:
            continue
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > source.meta.size:
            raise RuntimeError('Partial file is larger than remote file; refusing to append')
        status(state='downloading', repo=repo, bytes=offset, total=source.meta.size)
        print(f'Resuming {repo} at {offset} / {source.meta.size} bytes', flush=True)
        with partial.open('ab') as output, ThreadPoolExecutor(max_workers=8) as pool:
            while offset < source.meta.size:
                bounds = [(start, min(start + 8 * 1024 * 1024, source.meta.size) - 1)
                          for start in range(offset, min(offset + 8 * 8 * 1024 * 1024, source.meta.size), 8 * 1024 * 1024)]
                for chunk in pool.map(source.fetch, bounds):
                    output.write(chunk)
                    output.flush()
                    offset += len(chunk)
                    status(state='downloading', repo=repo, bytes=offset, total=source.meta.size)
        status(state='verifying', repo=repo, bytes=offset, total=source.meta.size)
        verify(partial, source.meta.etag)
        partial.replace(destination)
        print('Verified ' + repo, flush=True)


def main():
    try:
        for repo, folder in [('depth-anything/Depth-Anything-V2-Large-hf', 'depth/depth-anything-v2-large'), ('stabilityai/stable-diffusion-3.5-large-controlnet-depth', 'controlnet/depth-sd35-large')]:
            download(repo, folder)
        status(state='completed')
    except Exception as error:
        # Keep the file offset in the failure record for inspection and resumption.
        try:
            previous = json.loads(STATUS.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            previous = {}
        previous.update(state='failed', error=type(error).__name__ + ': download interrupted; rerun to resume')
        status(**previous)
        raise RuntimeError('Download interrupted; rerun to resume saved data') from None


if __name__ == '__main__':
    main()
