"""Descriptive quality statistics. Technical acceptance is not a user preference."""
import math

TASK_ORDER = ('text-to-image', 'inpaint', 'tryon', 'outpaint')
REASONS = {
    'task-check', 'already-finished', 'image-too-large', 'time-budget',
    'unsuitable-detail', 'mask-unavailable', 'job-limit', 'comparison-failed',
    'mode-changed', 'source-changed', 'processing-error', 'legacy-unspecified',
}


def retention_reason(result):
    code = result.get('decisionReason')
    if code in REASONS:
        return code
    # Old records remain immutable. Only infer reasons that their saved evidence supports.
    if result.get('technical', {}).get('passed') is False:
        return 'task-check'
    message = result.get('message', '')
    for fragment, reason in (
        ('không tự sửa nối tiếp', 'already-finished'),
        ('ảnh vượt ngân sách', 'image-too-large'),
        ('chưa có dấu hiệu phù hợp', 'unsuitable-detail'),
        ('đã sử dụng lượt hoàn thiện', 'job-limit'),
    ):
        if fragment in message:
            return reason
    if result.get('comparison', {}).get('passed') is False:
        return 'comparison-failed'
    # The old combined message cannot distinguish a deadline from a setting change.
    if message == 'Giữ bản ban đầu: hết ngân sách xử lý.':
        return 'time-budget'
    return 'legacy-unspecified'


def bucket(task=None):
    return dict(task=task, recorded=0, improved=0, retained=0, observed=0, attempted=0,
                rated=0, good=0, needsWork=0, compared=0, preferImproved=0,
                preferOriginal=0, tie=0, _jobs=set(), _reasons={},
                _assessment=[], _finishing=[])


def add(group, result, feedback, job):
    group['recorded'] += 1
    group['_jobs'].add(job)
    improved = result.get('status') == 'improved' and bool(result.get('improved'))
    retained = result.get('status') == 'retained'
    group['improved' if improved else 'retained' if retained else 'observed'] += 1
    group['attempted'] += bool(result.get('finishingAttempted') or result.get('comparison'))
    if retained:
        reason = retention_reason(result)
        group['_reasons'][reason] = group['_reasons'].get(reason, 0) + 1
    rating = feedback.get('rating')
    if rating in ('good', 'needs-work'):
        group['rated'] += 1
        group['good' if rating == 'good' else 'needsWork'] += 1
    # Ratings, selections and missing comparisons never imply preference for a variant.
    preference = feedback.get('preference') if improved else None
    if preference in ('improved', 'original', 'tie'):
        group['compared'] += 1
        group[{'improved': 'preferImproved', 'original': 'preferOriginal', 'tie': 'tie'}[preference]] += 1
    for field, target in (('assessmentSeconds', '_assessment'), ('finishingSeconds', '_finishing')):
        value = result.get(field)
        if type(value) in (int, float) and math.isfinite(value) and value >= 0:
            group[target].append(value)


def timing(values):
    return {'samples': len(values), 'averageSeconds': round(sum(values)/len(values), 4) if values else None,
            'maxSeconds': round(max(values), 4) if values else None}


def finalize(group):
    group['jobs'] = len(group.pop('_jobs'))
    group['reasons'] = [{'code': code, 'count': count} for code, count in
                        sorted(group.pop('_reasons').items(), key=lambda pair: (-pair[1], pair[0]))]
    group['assessmentTime'] = timing(group.pop('_assessment'))
    group['finishingTime'] = timing(group.pop('_finishing'))
    group['preferImprovedRate'] = round(group['preferImproved']/group['compared'], 6) if group['compared'] else None
    return group


def build_report(rows):
    """Rows are (result, current feedback, job id), over the entire persisted history."""
    tasks = {task: bucket(task) for task in TASK_ORDER}
    total = bucket()
    for result, feedback, job in rows:
        if result.get('task') not in tasks:
            continue
        add(tasks[result['task']], result, feedback, job)
        add(total, result, feedback, job)
    return {'version': 1, 'period': 'all', 'total': finalize(total),
            'tasks': [finalize(tasks[task]) for task in TASK_ORDER]}
