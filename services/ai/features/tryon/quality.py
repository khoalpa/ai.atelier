"""Versioned diagnostic gates. Automatic scores never approve product identity."""
import math
import numpy as np


def pose_consistency(source_person, result_people):
    source = (source_person or {}).get('keypoints') or []
    box = (source_person or {}).get('box')
    if not box or len(source) < 17:
        return {'available': False, 'accepted': False, 'reason': 'source-pose-unavailable'}
    def iou(other):
        b = other['box']
        overlap = max(0,min(box[2],b[2])-max(box[0],b[0]))*max(0,min(box[3],b[3])-max(box[1],b[1]))
        union = (box[2]-box[0])*(box[3]-box[1])+(b[2]-b[0])*(b[3]-b[1])-overlap
        return overlap/max(1.,union)
    candidates = [p for p in result_people if len(p.get('keypoints') or []) >= 17 and iou(p) >= .35]
    if not candidates:
        return {'available': False, 'accepted': False, 'reason': 'result-pose-unavailable'}
    candidate = max(candidates, key=iou)
    before, after = np.asarray(source, dtype=float), np.asarray(candidate['keypoints'], dtype=float)
    visible = (before[:,2] >= .4) & (after[:,2] >= .4)
    visible[:5] = False
    count = int(visible.sum())
    if count < 6:
        return {'available': False, 'accepted': False, 'reason': 'insufficient-visible-joints', 'jointCount': count}
    diagonal = max(1., math.hypot(box[2]-box[0], box[3]-box[1]))
    displacement = np.linalg.norm(after[visible,:2]-before[visible,:2],axis=1)/diagonal
    maximum, mean = float(displacement.max()), float(displacement.mean())
    return {'available': True, 'accepted': mean <= .035 and maximum <= .09,
            'meanDisplacement': mean, 'maxDisplacement': maximum, 'jointCount': count,
            'score': max(0., 100*(1-mean)), 'scope': 'visible-joint-preservation-only'}


def gate_reasons(item, thresholds):
    reasons = []
    checks = [('qualityScore','minimumQuality','quality'),
              ('referenceSimilarity','minimumSimilarity','reference'),
              ('seamScore','minimumSeam','seam'),
              ('preservationScore','minimumAnatomy','preservation')]
    for key, minimum, reason in checks:
        value = item.get(key)
        if not isinstance(value, (float,int)) or not math.isfinite(value) or value < thresholds[minimum]:
            reasons.append(reason)
    for key, reason in [('colorMaterial','color-material'),('geometry','geometry'),('poseConsistency','pose')]:
        if item.get(key,{}).get('accepted') is not True:
            reasons.append(reason)
    if item.get('bodyAudit',{}).get('passed') is False:
        reasons.append('exposed-body')
    if item.get('targetCoverage',{}).get('warnings'):
        reasons.append('target-mask')
    return reasons


def candidate_key(item, thresholds):
    """Hard constraints precede ranking, including the first set of candidates."""
    reasons = gate_reasons(item, thresholds)
    ranking = item.get('rankingScore',0)
    ranking = ranking if isinstance(ranking,(float,int)) and math.isfinite(ranking) else -1e9
    return (not reasons, -len(reasons), ranking)


def repair_is_better(before, after, thresholds):
    # A local repair must neither introduce a failed gate nor hide body failures.
    previous = set(gate_reasons(before, thresholds))
    following = set(gate_reasons(after, thresholds))
    return (following <= previous and after['seamScore'] > before['seamScore']
            and after['referenceSimilarity'] >= before['referenceSimilarity']-.02
            and after['preservationScore'] >= before['preservationScore']-1
            and after['colorMaterial']['colorMaterialScore'] >= before['colorMaterial']['colorMaterialScore']-1
            and after['geometry']['geometryScore'] >= before['geometry']['geometryScore']-1)


def quality_gate(item, thresholds):
    reasons = gate_reasons(item, thresholds)
    return {**thresholds, 'version': 2, 'passed': not reasons, 'reasons': reasons,
            'requiresVisualReview': True,
            'reviewChecklist': ['collar','sleeves','hem','layers','color','texture','anatomy','old-clothing'],
            'minimumPreservation': thresholds['minimumAnatomy']}
