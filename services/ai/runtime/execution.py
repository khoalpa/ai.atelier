"""Durable, idempotent admission and result publication for GPU requests."""
import hashlib
import json
import re
from . import metadata


class ExecutionJournal:
    def __init__(self, root, jobs_dir, update_job, ensure_active, revision):
        self.root, self.jobs_dir = root, jobs_dir
        self.update_job, self.ensure_active = update_job, ensure_active
        self.revision = revision
        self.tasks = json.loads((root / 'packages/contracts/tasks.json').read_text(encoding='utf-8'))['tasks']
        self.routes = {value['route']: value for value in self.tasks.values()}

    def begin(self, route, body):
        task = self.routes.get(route)
        if not task or not body.get('jobId'):
            return None
        job_id = body['jobId']
        if not isinstance(job_id, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', job_id):
            raise ValueError('Mã tác vụ không hợp lệ.')
        previous = metadata.read(self.jobs_dir / f'{job_id}.json', {})
        request_hash = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        if previous.get('requestSha256') and previous['requestSha256'] != request_hash:
            raise ValueError('Mã tác vụ đã được dùng cho một yêu cầu khác.')
        if previous.get('status') == 'completed' and previous.get('response'):
            return previous['response']
        self.ensure_active(job_id)
        request = {**body, 'taskType': task['taskType'], '_route': route}
        metadata.write(self.jobs_dir / f'{job_id}.request.json', request)
        catalog = self.root / 'workspace/prompts.json'
        self.update_job(job_id, status='running', stage='preparing', taskType=task['taskType'],
                        requestFile=f'workspace/jobs/{job_id}.request.json',
                        resumable=True, resumeMode=task['resume'], sourceRevision=self.revision,
                        promptCatalogSha256=hashlib.sha256(catalog.read_bytes()).hexdigest() if catalog.exists() else '',
                        requestSha256=request_hash)
        return None

    def publish(self, job_id, status, payload):
        if job_id and status == 200 and payload.get('ok', True):
            # The response is committed before HTTP transmission. A disconnected
            # caller can recover the exact response without repeating inference.
            self.update_job(job_id, status='completed', stage='done', response=payload)
