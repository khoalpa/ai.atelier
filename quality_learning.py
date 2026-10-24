"""Local, bounded post-generation assessment and learning. Never loads a model.

Input: completed job files written by the existing inference service.
Output: immutable assessments and optional, strictly masked finishing variants.
The worker uses SQLite leases so different web instances cannot repeat a job.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import threading
import time
import uuid

import numpy as np
from PIL import Image, ImageFilter
from quality_report import build_report

VERSION = 1
AMOUNTS = (12, 20, 28)
DEFECTS = {'blur', 'seam', 'residual', 'identity', 'garment', 'anatomy', 'prompt', 'color', 'other'}
TASKS = {'text-to-image', 'inpaint', 'tryon', 'outpaint'}
DEFAULTS = {'mode': 'observe', 'maxSeconds': 8, 'maxPixels': 4194304}


def now():
    return datetime.now(timezone.utc).isoformat()


def packed(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else packed(value).encode()).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def sharpness(image, allowed):
    gray = np.asarray(image.convert('L'), dtype=np.float32)
    low = np.asarray(image.convert('L').filter(ImageFilter.GaussianBlur(.8)), dtype=np.float32)
    return float(np.abs(gray - low)[allowed].mean()) if allowed.any() else 0.


def finish(image, allowed, amount):
    """No resynthesis: at most two RGB levels, inside a hard eroded mask only."""
    before = np.asarray(image.convert('RGB'), dtype=np.float32)
    blurred = np.asarray(image.filter(ImageFilter.GaussianBlur(.8)), dtype=np.float32)
    detail = before - blurred
    delta = np.clip(np.rint(detail * amount / 100), -2, 2)
    delta[np.abs(detail) < 2] = 0
    # Do not introduce newly clipped highlights or shadows.
    delta[((before + delta <= 0) & (before > 0)) | ((before + delta >= 255) & (before < 255))] = 0
    delta[~allowed] = 0
    return Image.fromarray(np.uint8(np.clip(before + delta, 0, 255)))


def compare(before, after, allowed):
    a, b = np.asarray(before, dtype=np.int16), np.asarray(after, dtype=np.int16)
    delta = np.abs(a - b)
    outside = int(delta[~allowed].max()) if (~allowed).any() else 0
    edge_before, edge_after = sharpness(before, allowed), sharpness(after, allowed)
    gain = edge_after / max(edge_before, .0001) - 1
    clipping_before = float(((a == 0) | (a == 255)).mean())
    clipping_after = float(((b == 0) | (b == 255)).mean())
    passed = (outside == 0 and int(delta.max()) <= 2 and .003 <= gain <= .12
              and clipping_after <= clipping_before + .0001)
    return {'passed': bool(passed), 'outsideMaxDelta': outside, 'maxDelta': int(delta.max()),
            'detailGain': round(gain, 6), 'clippingDelta': round(clipping_after-clipping_before, 6),
            'meanDelta': round(float(delta.mean()), 6), 'semanticQualityVerified': False}


class QualityStore:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.outputs = (self.root / 'workspace/outputs').resolve()
        self.folder = self.root / 'workspace/quality-learning'
        self.folder.mkdir(parents=True, exist_ok=True)
        self.db = self.folder / 'state.sqlite3'
        self.owner = uuid.uuid4().hex
        self.stop = threading.Event()
        self.scan_error = ''
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, state TEXT NOT NULL,
                    lease REAL NOT NULL, owner TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1,
                    error TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY, job TEXT NOT NULL,
                    file TEXT NOT NULL, sha TEXT NOT NULL, scope TEXT NOT NULL, unit TEXT NOT NULL,
                    created TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(file,sha));
                CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY REFERENCES results(id),
                    data TEXT NOT NULL, updated TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, scope TEXT NOT NULL,
                    state TEXT NOT NULL, created TEXT NOT NULL, data TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS results_scope ON results(scope);
                CREATE INDEX IF NOT EXISTS results_job ON results(job);
                CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created TEXT NOT NULL, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS finishing (job TEXT PRIMARY KEY, result TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS selections (file TEXT PRIMARY KEY, created TEXT NOT NULL);
            ''')
            db.execute('INSERT OR IGNORE INTO settings VALUES (1,?)',
                       (packed({**DEFAULTS, 'installedAt': now(), 'revision': 1}),))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db, timeout=20)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def settings(self, db=None):
        if db is not None:
            return json.loads(db.execute('SELECT data FROM settings WHERE id=1').fetchone()[0])
        with self.connect() as connection:
            return self.settings(connection)

    def configure(self, params):
        if params.get('mode') not in ('off', 'observe', 'auto'):
            raise ValueError('Chọn Tắt, Chỉ ghi nhận và đánh giá hoặc Tự động cải thiện.')
        seconds = params.get('maxSeconds', DEFAULTS['maxSeconds'])
        if type(seconds) is not int or not 2 <= seconds <= 30:
            raise ValueError('Ngân sách hoàn thiện phải từ 2 đến 30 giây.')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = self.settings(db)
            if params.get('revision') != previous['revision']:
                raise ValueError('Cài đặt đã thay đổi ở cửa sổ khác. Hãy tải lại.')
            settings = {**previous, 'mode': params['mode'], 'maxSeconds': seconds,
                        'revision': previous['revision'] + 1}
            if settings['mode'] == 'off':
                settings['disabledAt'] = now()
            elif previous['mode'] == 'off':
                settings['enabledAt'] = now()
            db.execute('UPDATE settings SET data=? WHERE id=1', (packed(settings),))
            self.log(db, {'action': 'settings', 'before': previous, 'after': settings})
        return {'settings': settings}

    def log(self, db, data):
        db.execute('INSERT INTO history(created,data) VALUES (?,?)', (now(), packed(data)))

    def output_path(self, value):
        text = str(value).replace('\\', '/')
        if text.startswith('/outputs/'):
            text = 'workspace' + text
        target = (self.root / text).resolve()
        if not target.is_relative_to(self.outputs) or target == self.outputs:
            raise ValueError('Ảnh phải nằm trong thư mục kết quả.')
        return target

    def url(self, path):
        return '/outputs/' + Path(path).resolve().relative_to(self.outputs).as_posix()

    def claim(self, job_id):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if row and (row['state'] == 'done' or row['attempts'] >= 3 or row['lease'] > time.time()):
                return False
            db.execute('INSERT INTO jobs(id,state,lease,owner,attempts,updated) VALUES (?,?,?,?,?,?) '
                       'ON CONFLICT(id) DO UPDATE SET state=excluded.state,lease=excluded.lease,'
                       'owner=excluded.owner,attempts=excluded.attempts,updated=excluded.updated',
                       (job_id, 'processing', time.time()+180, self.owner, (row['attempts']+1) if row else 1, now()))
        return True

    def discover(self, job):
        items = list(job.get('results') or [])
        if job.get('directory'):
            directory = self.output_path(job['directory'])
            meta = read_json(directory / 'metadata.json')
            # The metadata identifies final try-on outputs; exclude draft previews.
            if meta.get('category') and meta.get('results'):
                items = [{**item, 'file': str((directory / item['file']).relative_to(self.root)), 'kind': 'tryon'}
                         for item in meta['results'] if item.get('file')]
        found = []
        for item in items[:48]:
            if not item.get('file'):
                continue
            path = self.output_path(item['file'])
            if path.suffix.lower() != '.png' or 'quality-learning' in path.parts:
                continue
            metadata_path = path.with_suffix('.json')
            if not metadata_path.is_file():
                metadata_path = path.parent / 'metadata.json'
            meta = read_json(metadata_path)
            task = job.get('taskType') or item.get('kind')
            if meta.get('category') and meta.get('qualityVersion'):
                task = 'tryon'
            if meta.get('processingMode') in ('outfit', 'clothing', 'outfit-description') or meta.get('fillMode') == 'replacement':
                task = 'tryon'
            if task not in TASKS:
                continue
            candidate = next((r for r in meta.get('results', []) if r.get('seed') == item.get('seed')), {})
            found.append((path, meta, {**item, **candidate}, task))
        return found

    def allowed(self, path, image, meta, task):
        if task == 'text-to-image':
            return np.ones((image.height, image.width), dtype=bool)
        mask_path = path.parent / ('generation_mask.png' if task == 'outpaint' else 'editable_mask.png')
        with Image.open(mask_path) as mask:
            if mask.size != image.size:
                raise ValueError('Vùng cho phép sửa không khớp kích thước ảnh.')
            allowed = np.asarray(mask.convert('L').filter(ImageFilter.MinFilter(5))) == 255
        # Outpainting always excludes the complete source, even when its prior
        # pipeline explicitly allowed source enhancement.
        if task == 'outpaint':
            g = meta['geometry']
            x, y, w, h = (int(g[k]) for k in ('left', 'top', 'sourceWidth', 'sourceHeight'))
            if min(x, y, w, h) < 0 or x+w > image.width or y+h > image.height:
                raise ValueError('Khung ảnh nguồn không hợp lệ.')
            allowed[y:y+h, x:x+w] = False
        for name in ('protected_identity.png', 'protected_mask.png',
                     f"material_protected_seed_{meta.get('_seed')}.png"):
            target = path.parent / name
            if not target.exists():
                continue
            with Image.open(target) as mask:
                if mask.size == image.size:
                    allowed &= np.asarray(mask.convert('L')) == 0
                elif task == 'outpaint' and mask.size == (w, h):
                    allowed[y:y+h, x:x+w] = False
                else:
                    raise ValueError('Vùng bảo vệ không khớp kích thước ảnh.')
        if task == 'tryon' and meta.get('qualityVersion') and not (path.parent / 'protected_identity.png').exists():
            raise ValueError('Thiếu vùng bảo vệ nhân vật.')
        return allowed

    def technical(self, meta, item, task):
        reasons = []
        gate = item.get('qualityGate') or (meta.get('qualityGate') if item.get('seed') == meta.get('selectedSeed') else None)
        removal = item.get('removalCheck') or next((r for r in meta.get('removalChecks', []) if r.get('seed') == item.get('seed')), None)
        if gate and gate.get('passed') is False:
            reasons.append('Kết quả chưa vượt kiểm tra chất lượng của tác vụ.')
        if removal and removal.get('status') in ('preservation-failed', 'residual', 'unchanged', 'invalid-mask'):
            reasons.append('Cần xử lý vật thể hoặc vùng bảo vệ trước khi hoàn thiện.')
        if float(item.get('outsideMaskMAE') or 0) > 0:
            reasons.append('Vùng ngoài mask đã thay đổi.')
        final = (item.get('diagnostics') or {}).get('final', {})
        if any(float(final.get(key) or 0) > 0 for key in ('protectedMAE', 'sourceCoreMAE')):
            reasons.append('Vùng lõi hoặc vùng bảo vệ cần được kiểm tra.')
        audit = item.get('bodyAudit') or (meta.get('bodyAudit') if item.get('seed') == meta.get('selectedSeed') else None)
        if audit and audit.get('required') and audit.get('passed') is False:
            reasons.append('Vùng cơ thể mới lộ ra cần được xem lại.')
        return {'passed': not reasons, 'reasons': reasons, 'taskGate': gate,
                'removalCheck': removal, 'requiresVisualReview': True}

    def context(self, image, meta, task):
        request = meta.get('request') or {}
        model = str(meta.get('modelId') or meta.get('model') or 'default')
        group = str(meta.get('category') or meta.get('removalTarget') or
                    ('portrait' if image.height > image.width else 'landscape' if image.width > image.height else 'square'))
        # Use content, not filenames or seed, to keep repeat runs out of holdout.
        source = str(meta.get('source') or '')
        if source:
            target = (self.root / ('workspace' if source.startswith('uploads/') else 'samples') / source).resolve()
            permitted = (self.root / ('workspace/uploads' if source.startswith('uploads/') else 'samples')).resolve()
            unit = digest(target.read_bytes()) if target.is_relative_to(permitted) and target.is_file() else digest(source)
        else:
            unit = digest(str(request.get('prompt') or meta.get('prompt') or '').strip().lower())
        signature = {k: meta.get(k) for k in ('qualityVersion', 'architecture', 'inpaintArchitecture')}
        signature['runtime'] = meta.get('runtime', {})
        scope = digest([VERSION, task, model, group, signature])
        return scope, unit, model, group

    def recipe(self, scope, unit):
        with self.connect() as db:
            rows = db.execute("SELECT * FROM profiles WHERE scope=? AND state IN ('active','validating') ORDER BY created DESC", (scope,)).fetchall()
        for row in rows:
            profile = json.loads(row['data'])
            if row['state'] == 'active' or unit not in profile['trainingUnits']:
                return profile['amount'], row['id'], row['state']
        with self.connect() as db:
            if db.execute('SELECT 1 FROM profiles WHERE scope=?', (scope,)).fetchone():
                return AMOUNTS[0], None, 'default'
        return AMOUNTS[int(unit[:8], 16) % len(AMOUNTS)], None, 'exploring'

    def assess(self, job, path, meta, item, task, settings, can_finish, deadline):
        assessment_started = time.monotonic()
        sha = digest(path.read_bytes())
        result_id = digest([str(path.relative_to(self.root)), sha])[:32]
        with self.connect() as db:
            if db.execute('SELECT 1 FROM results WHERE id=?', (result_id,)).fetchone():
                return False
        with Image.open(path) as source:
            if source.width * source.height > 16777216:
                raise ValueError('Ảnh vượt giới hạn kiểm tra 16 triệu pixel.')
            image = source.convert('RGB')
        scope, unit, model, group = self.context(image, meta, task)
        technical = self.technical(meta, item, task)
        record = {'id': result_id, 'jobId': job['jobId'], 'task': task, 'model': model, 'group': group,
                  'original': self.url(path), 'originalSha256': sha, 'width': image.width, 'height': image.height,
                  'seed': item.get('seed'), 'technical': technical, 'status': 'review',
                  'message': 'Đã ghi nhận. Cần xem ảnh để đánh giá nội dung.', 'createdAt': now(),
                  'settings': {k: (meta.get('request') or meta).get(k) for k in
                               ('steps', 'guidance', 'strength', 'maxSide', 'quality', 'processingMode')},
                  'durationSeconds': job.get('durationSeconds') or (meta.get('performance') or {}).get('durationSeconds'),
                  'profileId': None, 'amount': None, 'improved': None, 'assessmentVersion': VERSION,
                  'decisionReason': 'observe', 'finishingAttempted': False}
        attempted = False
        if settings['mode'] == 'auto' and not can_finish:
            record.update(status='retained', decisionReason='job-limit',
                          message='Giữ bản ban đầu: tác vụ đã sử dụng lượt hoàn thiện tự động.')
        if settings['mode'] == 'auto' and can_finish:
            record['status'] = 'retained'
            if not technical['passed']:
                record['decisionReason'] = 'task-check'
                record['message'] = 'Giữ bản ban đầu. ' + ' '.join(technical['reasons'])
            elif item.get('layoutOnly') or meta.get('runMode') == 'layout' or meta.get('parent'):
                record['decisionReason'] = 'already-finished'
                record['message'] = 'Giữ bố cục hoặc ảnh đã hoàn thiện; không tự sửa nối tiếp.'
            elif image.width * image.height > settings['maxPixels']:
                record['decisionReason'] = 'image-too-large'
                record['message'] = 'Giữ bản ban đầu: ảnh vượt ngân sách hoàn thiện 4 triệu pixel.'
            elif time.monotonic() >= deadline:
                record['decisionReason'] = 'time-budget'
                record['message'] = 'Giữ bản ban đầu: hết ngân sách xử lý.'
            else:
                try:
                    record['decisionReason'] = 'mask-unavailable'
                    allowed = self.allowed(path, image, {**meta, '_seed': item.get('seed')}, task)
                    record['decisionReason'] = 'processing-error'
                    edge = sharpness(image, allowed)
                    record['technical']['detailSignal'] = round(edge, 5)
                    if not .4 <= edge <= 12 or np.count_nonzero(allowed) < 64:
                        record['decisionReason'] = 'unsuitable-detail'
                        record['message'] = 'Giữ bản ban đầu: chưa có dấu hiệu phù hợp để tăng chi tiết nhẹ.'
                    else:
                        with self.connect() as db:
                            claimed = db.execute('INSERT OR IGNORE INTO finishing VALUES (?,?)', (job['jobId'], result_id)).rowcount
                        if not claimed:
                            record['decisionReason'] = 'job-limit'
                            raise ValueError('Tác vụ đã sử dụng lượt hoàn thiện tự động.')
                        attempted = True
                        record['finishingAttempted'] = True
                        amount, profile_id, phase = self.recipe(scope, unit)
                        started = time.monotonic()
                        candidate = finish(image, allowed, amount)
                        gate = compare(image, candidate, allowed)
                        record.update(amount=amount, profileId=profile_id, profilePhase=phase,
                                      comparison=gate, finishingSeconds=round(time.monotonic()-started, 4))
                        # Recheck the setting after CPU work so switching off takes
                        # effect before publishing an extra image.
                        if (gate['passed'] and time.monotonic() < deadline
                                and self.settings()['mode'] == 'auto' and digest(path.read_bytes()) == sha):
                            folder = self.output_path(str(self.outputs / 'quality-learning' / result_id))
                            folder.mkdir(parents=True, exist_ok=True)
                            output = self.output_path(str(folder / 'finished.png'))
                            temporary = folder / (self.owner + '.png')
                            candidate.save(temporary)
                            temporary.replace(output)
                            record.update(status='improved', decisionReason='accepted', improved=self.url(output),
                                          improvedSha256=digest(output.read_bytes()),
                                          message='Có bản tăng chi tiết nhẹ, vượt kiểm tra pixel. Hãy so sánh trước khi dùng.')
                            self.output_path(str(folder / 'metadata.json')).write_text(packed(record), encoding='utf-8')
                        else:
                            if not gate['passed']:
                                reason, message = 'comparison-failed', 'bản thử chưa vượt kiểm tra pixel.'
                            elif time.monotonic() >= deadline:
                                reason, message = 'time-budget', 'hết ngân sách xử lý.'
                            elif self.settings()['mode'] != 'auto':
                                reason, message = 'mode-changed', 'chế độ tự động đã thay đổi.'
                            else:
                                reason, message = 'source-changed', 'ảnh ban đầu đã thay đổi trong lúc xử lý.'
                            record.update(decisionReason=reason, message='Giữ bản ban đầu: ' + message)
                except (OSError, ValueError, KeyError) as error:
                    record['message'] = 'Giữ bản ban đầu: ' + str(error)
        record['assessmentSeconds'] = round(time.monotonic()-assessment_started, 4)
        with self.connect() as db:
            db.execute('INSERT OR IGNORE INTO results VALUES (?,?,?,?,?,?,?,?)',
                       (result_id, job['jobId'], str(path.relative_to(self.root)), sha, scope, unit, now(), packed(record)))
        return attempted

    def process(self, job, historical=False):
        settings = self.settings()
        if settings['mode'] == 'off' or job.get('status') != 'completed' or not job.get('jobId'):
            return
        if not historical:
            try:
                completed_at = datetime.fromisoformat(str(job.get('updatedAt', '')).replace('Z', '+00:00')).timestamp()
                cutoff = datetime.fromisoformat(settings.get('enabledAt', settings['installedAt'])).timestamp()
                if completed_at < cutoff:
                    return
            except (ValueError, TypeError):
                return
        job_id = str(job['jobId'])
        if not self.claim(job_id):
            return
        try:
            outputs = self.discover(job)
            deadline = time.monotonic() + settings['maxSeconds']
            attempted = False
            for path, meta, item, task in outputs:
                if self.settings()['mode'] == 'off':
                    break
                attempted |= self.assess(job, path, meta, item, task, settings, not attempted, deadline)
            with self.connect() as db:
                db.execute("UPDATE jobs SET state='done',lease=0,error='',updated=? WHERE id=? AND owner=?", (now(), job_id, self.owner))
        except Exception as error:
            with self.connect() as db:
                db.execute("UPDATE jobs SET state='error',lease=?,error=?,updated=? WHERE id=? AND owner=?",
                           (time.time()+10, str(error)[:500], now(), job_id, self.owner))

    def scan(self):
        if self.settings()['mode'] == 'off':
            return
        folder = self.root / 'workspace/jobs'
        if not folder.exists():
            return
        cutoff = self.settings().get('enabledAt', self.settings()['installedAt'])
        cutoff_time = datetime.fromisoformat(cutoff).timestamp()
        for path in sorted(folder.glob('*.json'), key=lambda p: p.stat().st_mtime):
            if path.name.endswith(('.request.json', '.checkpoint.json')) or path.stat().st_mtime < cutoff_time:
                continue
            if self.stop.is_set():
                return
            try:
                job = read_json(path)
            except (OSError, ValueError):
                continue  # The inference service may still be writing this file.
            self.process(job)

    def watch(self):
        while not self.stop.is_set():
            try:
                self.scan()
                self.scan_error = ''
            except Exception as error:
                self.scan_error = str(error)[:300]
            self.stop.wait(3)

    def learn(self, db, scope):
        rows = db.execute('SELECT r.*,f.data AS feedback FROM results r JOIN feedback f ON f.id=r.id WHERE scope=? ORDER BY r.created', (scope,)).fetchall()
        examples = []
        for row in rows:
            result, feedback = json.loads(row['data']), json.loads(row['feedback'])
            if result.get('improved') and result.get('comparison', {}).get('passed') and feedback.get('preference') in ('improved', 'original', 'tie'):
                examples.append((row, result, feedback))
        active_rows = db.execute("SELECT * FROM profiles WHERE scope=? AND state IN ('active','validating') ORDER BY created DESC", (scope,)).fetchall()
        for profile_row in active_rows:
            profile = json.loads(profile_row['data'])
            unique = {}
            for row, result, feedback in examples:
                if result.get('profileId') == profile_row['id'] and row['unit'] not in profile['trainingUnits']:
                    # Conflicting feedback on a repeated content group is conservative.
                    good = feedback.get('preference') == 'improved' and feedback.get('rating') == 'good' and feedback.get('target') == 'improved' and not feedback.get('defects')
                    unique[row['unit']] = unique.get(row['unit'], True) and good
            profile['holdoutCount'], profile['wins'] = len(unique), sum(unique.values())
            training_support = set()
            training_bad = set()
            for row, result, feedback in examples:
                if row['unit'] in profile['trainingUnits'] and result.get('amount') == profile['amount']:
                    good = feedback.get('preference') == 'improved' and feedback.get('rating') == 'good' and feedback.get('target') == 'improved' and not feedback.get('defects')
                    (training_support if good else training_bad).add(row['unit'])
            training_valid = len(training_support - training_bad) >= 3
            n, wins = len(unique), sum(unique.values())
            lower = ((wins/n + 1.96**2/(2*n) - 1.96*((wins/n*(1-wins/n)+1.96**2/(4*n))/n)**.5)/(1+1.96**2/n)) if n else 0
            profile['lowerConfidenceBound'] = round(lower, 4)
            state = profile_row['state']
            if not training_valid:
                state = 'rolled-back' if state == 'active' else 'rejected'
            elif state == 'validating' and n >= 5 and lower > .5 and wins == n:
                state = 'active'
                db.execute("UPDATE profiles SET state='superseded' WHERE scope=? AND state='active'", (scope,))
                self.log(db, {'action': 'profile-activated', 'profileId': profile_row['id'], 'evidence': profile})
            elif state == 'active' and (n < 5 or lower <= .5 or n-wins >= 2):
                state = 'rolled-back'
                self.log(db, {'action': 'profile-regression', 'profileId': profile_row['id']})
            elif state == 'validating' and n-wins >= 2:
                state = 'rejected'
            if state != profile_row['state'] and state in ('rejected', 'rolled-back'):
                profile['endedAt'] = now()
                self.log(db, {'action': 'profile-ended', 'profileId': profile_row['id'], 'state': state})
            db.execute('UPDATE profiles SET state=?,data=? WHERE id=?', (state, packed(profile), profile_row['id']))
        if db.execute("SELECT 1 FROM profiles WHERE scope=? AND state IN ('active','validating')", (scope,)).fetchone():
            return
        previous = db.execute('SELECT data FROM profiles WHERE scope=? ORDER BY created DESC LIMIT 1', (scope,)).fetchone()
        if previous:
            cutoff = json.loads(previous[0]).get('endedAt', now())
            examples = [(row, result, feedback) for row, result, feedback in examples if row['created'] > cutoff]
        # Freeze an amount only after three different content groups explicitly
        # prefer it. Later validation must use new groups and the frozen amount.
        for amount in AMOUNTS:
            units = set()
            relevant = [(row, r, f) for row, r, f in examples if r.get('amount') == amount]
            bad = {row['unit'] for row, r, f in relevant if f.get('preference') != 'improved' or f.get('rating') != 'good' or f.get('defects')}
            for row, result, feedback in relevant:
                if feedback.get('preference') == 'improved' and feedback.get('rating') == 'good' and feedback.get('target') == 'improved' and row['unit'] not in bad:
                    units.add(row['unit'])
            if len(units) >= 3:
                profile_id = uuid.uuid4().hex
                exemplar = relevant[-1][1]
                profile = {'amount': amount, 'trainingUnits': sorted(units), 'holdoutCount': 0, 'wins': 0,
                           'version': VERSION, 'task': exemplar['task'], 'model': exemplar['model'], 'group': exemplar['group']}
                db.execute('INSERT INTO profiles VALUES (?,?,?,?,?)', (profile_id, scope, 'validating', now(), packed(profile)))
                self.log(db, {'action': 'profile-created', 'profileId': profile_id, 'trainingCount': len(units)})
                break

    def feedback(self, params):
        result_id = str(params.get('resultId', ''))
        target = params.get('target', 'original')
        if target not in ('original', 'improved'):
            raise ValueError('Chọn ảnh cần đánh giá.')
        rating = params.get('rating')
        if rating not in (None, 'good', 'needs-work', 'clear'):
            raise ValueError('Đánh giá không hợp lệ.')
        preference = params.get('preference')
        if preference not in (None, 'original', 'improved', 'tie'):
            raise ValueError('So sánh không hợp lệ.')
        defects = params.get('defects', [])
        if not isinstance(defects, list) or any(d not in DEFECTS for d in defects) or len(defects) > 9:
            raise ValueError('Nhãn lỗi không hợp lệ.')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM results WHERE id=?', (result_id,)).fetchone()
            if not row:
                raise ValueError('Không tìm thấy kết quả đã được ghi nhận.')
            result = json.loads(row['data'])
            if (target == 'improved' or preference) and not result.get('improved'):
                raise ValueError('Kết quả chưa có bản hoàn thiện để so sánh.')
            for key, hash_key in (('original', 'originalSha256'), ('improved', 'improvedSha256')):
                if result.get(key) and digest(self.output_path(result[key]).read_bytes()) != result[hash_key]:
                    raise ValueError('Ảnh đã thay đổi; phản hồi không được dùng để học.')
            old = db.execute('SELECT data FROM feedback WHERE id=?', (result_id,)).fetchone()
            value = json.loads(old[0]) if old else {}
            if rating == 'clear':
                value = {}
            else:
                if rating:
                    value.update(rating=rating, target=target, defects=defects)
                if preference:
                    value['preference'] = preference
                if params.get('selected') is not None:
                    value['selected'] = target if params['selected'] is True else None
            db.execute('INSERT INTO feedback VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated=excluded.updated',
                       (result_id, packed(value), now()))
            self.log(db, {'action': 'feedback', 'resultId': result_id, 'before': json.loads(old[0]) if old else {}, 'after': value})
            self.learn(db, row['scope'])
        return {'feedback': value}

    def rollback(self, params):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM profiles WHERE id=?', (str(params.get('profileId', '')),)).fetchone()
            if not row or row['state'] not in ('active', 'validating'):
                raise ValueError('Cấu hình không còn hoạt động.')
            data = {**json.loads(row['data']), 'endedAt': now()}
            db.execute("UPDATE profiles SET state='rolled-back',data=? WHERE id=?", (packed(data), row['id']))
            self.log(db, {'action': 'profile-rollback', 'profileId': row['id']})
        return {'restored': 'default'}

    def selection(self, params):
        if self.settings()['mode'] == 'off':
            return {'recorded': False, 'countsAsPositiveRating': False}
        if params.get('file'):
            path = self.output_path(params['file'])
        else:
            directory = self.output_path(params.get('directory', ''))
            seed = params.get('seed')
            if type(seed) is not int:
                raise ValueError('Seed không hợp lệ.')
            meta = read_json(directory / 'metadata.json')
            selected = next((r for r in meta.get('results', []) if r.get('seed') == seed), None)
            path = self.output_path(str(directory / selected['file'])) if selected and selected.get('file') else directory / f'result_seed_{seed}.png'
        if not path.is_file() or path.suffix.lower() != '.png':
            raise ValueError('Không tìm thấy phương án đã chọn.')
        with self.connect() as db:
            db.execute('INSERT INTO selections VALUES (?,?) ON CONFLICT(file) DO UPDATE SET created=excluded.created',
                       (str(path.relative_to(self.root)), now()))
        return {'recorded': True, 'countsAsPositiveRating': False}

    def state(self, params):
        with self.connect() as db:
            settings = self.settings(db)
            job_id = str(params.get('jobId') or '')[:120]
            query = 'SELECT r.*,f.data AS feedback FROM results r LEFT JOIN feedback f ON r.id=f.id'
            where, values = (' WHERE r.job=?', (job_id,)) if job_id else ('', ())
            if params.get('url'):
                where, values = " WHERE json_extract(r.data,'$.original')=? OR json_extract(r.data,'$.improved')=?", (str(params['url']), str(params['url']))
            elif params.get('resultId'):
                where, values = ' WHERE r.id=?', (str(params['resultId']),)
            rows = db.execute(query + where + ' ORDER BY r.created DESC LIMIT 60', values).fetchall()
            selections = dict(db.execute('SELECT file,created FROM selections').fetchall())
            results = [{**json.loads(row['data']), 'selectedOriginalAt': selections.get(row['file']),
                        'feedback': json.loads(row['feedback']) if row['feedback'] else {}} for row in rows]
            profiles = [{**json.loads(row['data']), 'id': row['id'], 'state': row['state'], 'createdAt': row['created']} for row in db.execute('SELECT * FROM profiles ORDER BY created DESC LIMIT 30')]
            counts = dict(db.execute('SELECT state,count(*) FROM jobs GROUP BY state').fetchall())
            feedback_rows = [json.loads(row[0]) for row in db.execute('SELECT data FROM feedback')]
            rated = [row for row in feedback_rows if row.get('rating')]
            summary = {'results': db.execute('SELECT count(*) FROM results').fetchone()[0],
                       'rated': len(rated), 'accepted': sum(r.get('rating') == 'good' for r in rated),
                       'needsWork': sum(r.get('rating') == 'needs-work' for r in rated),
                       'compared': sum(bool(r.get('preference')) for r in feedback_rows)}
            errors = [dict(row) for row in db.execute("SELECT id,error FROM jobs WHERE state='error' ORDER BY updated DESC LIMIT 5")]
        return {'version': VERSION, 'settings': settings, 'results': results, 'profiles': profiles,
                'jobs': counts, 'summary': summary, 'errors': errors, 'workerError': self.scan_error}

    def report(self, params):
        with self.connect() as db:
            rows = db.execute('SELECT r.job,r.data,f.data AS feedback FROM results r '
                              'LEFT JOIN feedback f ON r.id=f.id')
            report = build_report((json.loads(row['data']),
                                   json.loads(row['feedback']) if row['feedback'] else {}, row['job'])
                                  for row in rows)
        return {'report': {**report, 'generatedAt': now()}}

    def dispatch(self, method, params):
        handlers = {'state': self.state, 'configure': self.configure, 'feedback': self.feedback,
                    'rollback': self.rollback, 'selection': self.selection, 'report': self.report}
        if method not in handlers or not isinstance(params, dict):
            raise ValueError('Thao tác chất lượng không hợp lệ.')
        return handlers[method](params)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    store = QualityStore(args.root)
    worker = threading.Thread(target=store.watch, daemon=True)
    worker.start()
    try:
        for line in sys.stdin:
            request = {}
            try:
                if len(line) > 65536:
                    raise ValueError('Yêu cầu quá lớn.')
                request = json.loads(line)
                result = {'ok': True, **store.dispatch(request.get('method'), request.get('params', {}))}
            except Exception as error:
                result = {'ok': False, 'error': str(error)}
            print(packed({'id': request.get('id'), **result}), flush=True)
    finally:
        store.stop.set()
        worker.join(timeout=3)


if __name__ == '__main__':
    main()
