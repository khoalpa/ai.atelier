"""Exercise the running web proxy, real SAM and 1024 px object inpainting."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import time
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WEB_PORT = int(os.environ.get('AI_IMAGE_PORT', '7860'))
AI_PORT = int(os.environ.get('AI_SEGMENT_PORT', '7861'))


def post(route, body):
    request = Request(f'http://127.0.0.1:{WEB_PORT}/api/' + route,
                      data=json.dumps(body).encode(),
                      headers={'Content-Type': 'application/json'}, method='POST')
    with urlopen(request, timeout=600) as response:
        result = json.load(response)
    assert result.get('ok'), result.get('error')
    return result


def main():
    started = time.perf_counter()
    with urlopen(f'http://127.0.0.1:{AI_PORT}/health') as response:
        health = json.load(response)
    revision = hashlib.sha256(b''.join((ROOT/name).read_bytes() for name in (
        'ai_service.py', 'object_removal.py', 'catvton_inputs.py', 'idm_vton_runtime.py',
        'local_request_security.py', 'vendor/CatVTON/model/pipeline.py', 'vendor/CatVTON/utils.py'))).hexdigest()
    assert health['revision'] == revision, 'Restart AI service to load current code.'
    sample = 'object-removal-benchmark/01-flat-1/source.png'
    segmented = post('segment', {'sampleId': sample, 'points': [{'x':480,'y':320,'label':1}]})
    sam = Image.open(io.BytesIO(base64.b64decode(segmented['mask'].split(',')[-1]))).convert('L')
    assert sam.size == (960,640) and sam.getpixel((480,320)) > 0
    assert sam.getpixel((0,0)) == 0 and 0 < segmented['coverage'] < .2
    detected = post('detect-regions', {'sampleId':sample, 'model':'yolo-world',
                                     'classes':['red rectangle'], 'confidence':.15, 'padding':0})
    assert detected['maskMethod'] == 'yolo-world+sam' and detected['count'] > 0
    contour = Image.open(io.BytesIO(base64.b64decode(detected['mask'].split(',')[-1]))).convert('L')
    assert contour.getpixel((480,320)) > 0 and contour.getpixel((0,0)) == 0
    mask_path = ROOT/'samples/object-removal-benchmark/01-flat-1/mask.png'
    prompt = 'A continuous matte beige wall, with matching color and lighting.'
    body = dict(sampleId=sample, editableMask='data:image/png;base64,'+base64.b64encode(mask_path.read_bytes()).decode(),
                modelId='sdxl-inpaint-base-0.1', fillMode='background', removalTarget='custom',
                objectLabel='red rectangle', prompt=prompt, negativePrompt='',
                confirmedPrompts={'prompt':prompt,'negativePrompt':''},
                count=1, seed=82000, maxSide=1024, autoRetry=False, livePreview=False,
                jobId='object-removal-live-smoke')
    result = post('inpaint', body)
    directory = ROOT/result['directory']
    source = np.asarray(Image.open(ROOT/'samples'/sample).convert('RGB'))
    output = np.asarray(Image.open(directory/'result_seed_82000.png').convert('RGB'))
    allowed = np.asarray(Image.open(directory/'editable_mask.png').convert('L')) > 0
    assert output.shape == source.shape
    outside_max = int(np.abs(output.astype(int)-source.astype(int))[~allowed].max())
    assert outside_max == 0
    assert result['effectiveSettings']['maxSide'] == 1024
    assert result['effectiveSettings']['steps'] == 40
    report = dict(ok=True, revision=revision, servicePid=health['pid'],
                  samCoverage=segmented['coverage'], detectorMaskMethod=detected['maskMethod'],
                  detectedCount=detected['count'], sourceSize=[960,640],
                  outsideMaxDifference=outside_max, settings=result['effectiveSettings'],
                  removalCheck=result['results'][0]['removalCheck'],
                  directory=result['directory'], seconds=round(time.perf_counter()-started,3))
    target=ROOT/'workspace/diagnostics/object-removal-live-smoke.json'
    target.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report),flush=True)


if __name__ == '__main__':
    main()
