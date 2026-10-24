"""One real GPU request with a deadline and safe cancellation; never fabricates feedback."""
import argparse
import json
from pathlib import Path
import threading
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import uuid

ROOT = Path(__file__).resolve().parents[1]


def post(base, route, body, timeout=15):
    request = Request(base + '/api/' + route, data=json.dumps(body).encode(),
                      headers={'Content-Type': 'application/json'})
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except HTTPError as error:
        raise RuntimeError(error.read().decode('utf-8', errors='replace')) from error


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:7860')
    parser.add_argument('--request', type=Path)
    parser.add_argument('--route', default='chroma-generate', choices=['chroma-generate', 'inpaint', 'tryon', 'outpaint'])
    parser.add_argument('--seconds', type=int, default=180)
    parser.add_argument('--cancel-after', type=int, help='Explicitly verify cancellation after this many seconds.')
    args = parser.parse_args()
    # Do not queue a diagnostic behind someone else's inference.
    for file in (ROOT / 'workspace/jobs').glob('*.json'):
        try:
            job = json.loads(file.read_text(encoding='utf-8-sig'))
        except (ValueError, OSError):
            continue
        if job.get('status') in ('running', 'queued', 'cancelling'):
            raise RuntimeError('An active job already exists: ' + str(job.get('jobId')))
    body = json.loads(args.request.read_text(encoding='utf-8-sig')) if args.request else dict(
        modelId='sd35-medium', prompt='A white ceramic cup on a gray table in soft daylight.',
        negativePrompt='', seed=528, size=256, aspectRatio='1:1', steps=4,
        guidance=4.5, count=1, quality='custom', livePreview=False)
    body['jobId'] = 'quality-live-' + uuid.uuid4().hex
    output = ROOT / 'workspace/diagnostics/quality-report'
    output.mkdir(parents=True, exist_ok=True)
    file = output / (body['jobId'] + '.json')
    record = {'jobId': body['jobId'], 'route': args.route, 'request': body, 'status': 'starting'}
    def save():
        file.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    save()
    print(json.dumps({'jobId': body['jobId'], 'report': str(file)}), flush=True)
    done = threading.Event()
    def run():
        try:
            record['response'] = post(args.base, args.route, body, timeout=args.seconds + 120)
        except Exception as error:
            record['requestError'] = str(error)
        finally:
            done.set()
    started = time.monotonic()
    threading.Thread(target=run, daemon=True).start()
    if not done.wait(min(args.seconds, args.cancel_after) if args.cancel_after else args.seconds):
        record['cancellationTest'] = bool(args.cancel_after)
        record['deadlineExceeded'] = not bool(args.cancel_after)
        try:
            record['cancelResponse'] = post(args.base, 'cancel-job', {'jobId': body['jobId']})
        except Exception as error:
            record['cancelError'] = str(error)
        save()
        print('Safe cancellation requested.', flush=True)
        done.wait(60)
    job_file = ROOT / 'workspace/jobs' / (body['jobId'] + '.json')
    try:
        record['job'] = json.loads(job_file.read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        record['job'] = {}
    record['status'] = record['job'].get('status', 'request-failed')
    record['elapsedSeconds'] = round(time.monotonic() - started, 3)
    if record['status'] == 'completed':
        for _ in range(15):
            state = post(args.base, 'quality-learning/state', {'jobId': body['jobId']})
            if state.get('results') or state.get('errors'):
                record['quality'] = state
                break
            time.sleep(2)
    if args.cancel_after and record['status'] == 'cancelled':
        record['quality'] = post(args.base, 'quality-learning/state', {'jobId': body['jobId']})
        assert record['quality']['results'] == [], 'Cancelled jobs must not enter quality learning.'
    save()
    print(json.dumps({k: record[k] for k in ('jobId', 'status', 'elapsedSeconds')}), flush=True)
    if record['status'] != ('cancelled' if args.cancel_after else 'completed'):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
