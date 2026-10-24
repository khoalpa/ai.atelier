"""Download the reviewed originals, preserving file-specific attribution."""
from pathlib import Path
from urllib.parse import urlparse
import hashlib
import json
import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
HOME = ROOT / 'workspace/sample-intake/v2/downloaded'
HOME.mkdir(parents=True, exist_ok=True)
session = requests.Session()
session.mount('https://', HTTPAdapter(max_retries=Retry(total=5, backoff_factor=10,
              status_forcelist=[429, 503], respect_retry_after_header=True)))
rows = json.loads((ROOT / 'scripts/samples-v2-downloads.json').read_text(encoding='utf-8'))['assets']
for row in rows:
    if urlparse(row['downloadUrl']).hostname != 'upload.wikimedia.org':
        raise ValueError('Unreviewed download host')
    suffix = Path(urlparse(row['downloadUrl']).path).suffix.lower()
    file = HOME / (row['id'] + suffix)
    if not file.exists():
        response = session.get(row['downloadUrl'], headers={'User-Agent': 'AIAtelierSampleCurator/1.0'}, timeout=60)
        response.raise_for_status()
        if len(response.content) > 20 * 1024 * 1024:
            raise ValueError('Image exceeds ingestion limit')
        temporary = file.with_suffix('.download')
        temporary.write_bytes(response.content)
        with Image.open(temporary) as im:
            im.verify()
        temporary.replace(file)
        time.sleep(5)
    with Image.open(file) as im:
        im.load()
        if min(im.size) < 768:
            raise ValueError('Image is too small')
    provenance = {**row, 'file': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                  'modifications': 'None; original downloaded bytes preserved'}
    (HOME / (row['id'] + '.json')).write_text(json.dumps(provenance, ensure_ascii=False, indent=2), encoding='utf-8')
    print(row['id'], file.stat().st_size, flush=True)
