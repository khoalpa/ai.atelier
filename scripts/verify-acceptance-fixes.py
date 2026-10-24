"""Run saved acceptance requests against the real local service, without auto-approval."""
import argparse
import json
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'workspace/diagnostics/acceptance-fixes-2.7'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('request', type=Path)
    parser.add_argument('--route', default='outpaint')
    args = parser.parse_args()
    body = json.loads(args.request.read_text(encoding='utf-8-sig'))
    def post(route, data):
        request = Request('http://127.0.0.1:7860/api/' + route,
                          data=json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=2400) as response:
            return json.load(response)
    if args.route == 'character-render':
        analysis = post('character-analyze', {'sampleId': body['sampleId']})
        body['sourceSha256'] = analysis['sourceSha256']
        preview = post('character-preview', body)
        body.update(planHash=preview['planHash'], targetPoses=preview['targetPoses'])
        import base64
        (OUTPUT / (args.request.stem + '-plan.png')).write_bytes(base64.b64decode(preview['overlay'].split(',')[1]))
    body['jobId'] = 'acceptance27-' + uuid.uuid4().hex
    record = dict(request=body, route=args.route, startedAt=time.time())
    file = OUTPUT / (args.request.stem + '-run.json')
    if file.exists():
        raise ValueError('Use a new request name; existing evidence must be preserved.')
    def save():
        file.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    save()
    print(json.dumps(dict(report=str(file), jobId=body['jobId'])), flush=True)
    try:
        result = post(args.route, body)
        # Keep paths/metrics, not redundant base64 copies of saved image files.
        for item in result.get('results', []):
            if not item.get('file') and result.get('directory') and 'seed' in item:
                saved = ROOT / result['directory'] / f"result_seed_{item['seed']}.png"
                if saved.is_file():
                    item['file'] = str(saved.relative_to(ROOT))
            if str(item.get('image', '')).startswith('data:'):
                item.pop('image', None)
        record.update(response=result, seconds=round(time.time()-record['startedAt'], 2))
        print(json.dumps(dict(ok=result.get('ok'), seconds=record['seconds'],
                              files=[r.get('file') for r in result.get('results', [])])), flush=True)
    except Exception as error:
        record['error'] = str(error)
        if hasattr(error, 'read'):
            record['detail'] = error.read().decode('utf-8', errors='replace')
        raise
    finally:
        save()


if __name__ == '__main__':
    main()
