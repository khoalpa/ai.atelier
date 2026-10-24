"""Verify real inference outputs and prepare an isolated fixture for feedback/UI QA."""
import argparse
import json
from pathlib import Path
import shutil
import sys

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from quality_learning import QualityStore, digest, now, packed, compare


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=ROOT/'workspace/diagnostics/quality-report')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    fixture = args.output / 'fixture'
    store = QualityStore(fixture)
    store.configure({'mode': 'auto', 'maxSeconds': 8, 'revision': store.settings()['revision']})
    chosen = {}
    for file in sorted(args.source.glob('quality-live-*.json'), key=lambda p:p.stat().st_mtime):
        record = json.loads(file.read_text(encoding='utf-8'))
        if record.get('status') == 'completed':
            chosen[record['route']] = record
    assert set(chosen) == {'chroma-generate', 'inpaint', 'tryon', 'outpaint'}, 'Need four completed live requests.'
    report = {'checkedAt': now(), 'kind': 'real-inference-output-verification', 'cases': [],
              'feedbackFixture': str(fixture.resolve()), 'userPreferenceMeasured': False}
    def copy(file):
        target = fixture / file.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, target)
    for route, live in chosen.items():
        job, quality = live['job'], live['quality']['results']
        assert quality, f'No automatic quality record: {route}'
        case = dict(task=quality[0]['task'], jobId=job['jobId'], completed=True,
                    inferenceSeconds=live['elapsedSeconds'], autoRecorded=True, results=[])
        for result in quality:
            original = ROOT / ('workspace' + result['original'])
            assert digest(original.read_bytes()) == result['originalSha256'], 'Original result changed.'
            metadata = original.with_suffix('.json')
            metadata = metadata if metadata.exists() else original.parent/'metadata.json'
            meta = json.loads(metadata.read_text(encoding='utf-8-sig'))
            for asset in ([original, metadata] if route == 'chroma-generate' else list(original.parent.glob('*.png')) + [metadata]):
                copy(asset)
            image = Image.open(original).convert('RGB')
            item = {'id': result['id'], 'status': result['status'], 'original': result['original'],
                    'originalHashUnchanged': True, 'sourcePixelsPreserved': None,
                    'protectedPixelsPreserved': None}
            if meta.get('source'):
                source = ROOT / ('workspace' if meta['source'].startswith('uploads/') else 'samples') / meta['source']
                copy(source)
                pixels = np.asarray(Image.open(source).convert('RGB'))
                actual = np.asarray(image)
                if route == 'outpaint':
                    g = meta['geometry']; x,y,w,h = (g[k] for k in ('left','top','sourceWidth','sourceHeight'))
                    assert np.array_equal(actual[y:y+h,x:x+w], pixels), 'Outpaint changed source pixels.'
                else:
                    editable = np.asarray(Image.open(original.parent/'editable_mask.png').convert('L')) > 0
                    assert np.array_equal(actual[~editable], pixels[~editable]), 'Changed pixels outside edit mask.'
                    protected = original.parent / ('protected_identity.png' if route == 'tryon' else 'protected_mask.png')
                    if protected.exists():
                        protected_mask = np.asarray(Image.open(protected).convert('L')) > 0
                        assert np.array_equal(actual[protected_mask], pixels[protected_mask]), 'Changed protected pixels.'
                        item['protectedPixelsPreserved'] = True
                item['sourcePixelsPreserved'] = True
            if result.get('improved'):
                allowed = store.allowed(fixture/original.relative_to(ROOT), image, meta, result['task'])
                improved = ROOT / ('workspace' + result['improved'])
                item['finishingComparison'] = compare(image, Image.open(improved).convert('RGB'), allowed)
                assert item['finishingComparison']['passed'], 'Finishing broke pixel limits.'
                assert digest(improved.read_bytes()) == result['improvedSha256']
            case['results'].append(item)
        jobs = fixture / 'workspace/jobs'; jobs.mkdir(parents=True, exist_ok=True)
        (jobs / (job['jobId'] + '.json')).write_text(packed({**job, 'updatedAt':now()}), encoding='utf-8')
        report['cases'].append(case)
    (args.output/'workflow-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'passed':len(report['cases']), 'fixture':str(fixture.resolve()),
                      'report':str((args.output/'workflow-verification.json').resolve())}),flush=True)


if __name__ == '__main__':
    main()
