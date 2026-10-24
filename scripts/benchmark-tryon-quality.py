"""Compare the same local try-on requests before/after an implementation change."""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', choices=['before', 'after'], required=True)
    parser.add_argument('--model', default='catvton', choices=['catvton', 'idm-vton'])
    parser.add_argument('--tag', default='')
    args = parser.parse_args()
    import ai_service as ai
    from PIL import Image, ImageDraw, ImageOps
    # Resolve lazy adapters before announcing the run, so a before-run is stable.
    import catvton_inputs
    import idm_vton_runtime
    if args.tag and (not args.tag.replace('-','').isalnum()):
        raise ValueError('Tag must contain only letters, digits and hyphens')
    folder = ROOT / 'workspace/diagnostics/tryon-quality-20261022' / (args.phase + '-' + args.model + ('-'+args.tag if args.tag else ''))
    folder.mkdir(parents=True, exist_ok=True)
    cases = [
        ('upper_body', 'c002', {'sleeveLength': 'long', 'hemLength': 'hip'}, 'a cobalt blue long-sleeve button-front shirt with a pointed collar and buttoned cuffs'),
        ('overall', 'c003', {'sleeveLength': 'short', 'hemLength': 'knee', 'silhouette': 'a_line'}, 'a green short-sleeve knee-length A-line dress with a round neck, single layer'),
        ('lower_body', 'c002', {'hemLength': 'ankle', 'silhouette': 'trousers'}, 'tan full-length trousers'),
    ]
    report = {'phase': args.phase, 'model': args.model, 'revision': ai.SOURCE_REVISION,
              'mode': 'unpaired garment transfer', 'cases': []}
    print(json.dumps({'started': str(folder), 'revision': ai.SOURCE_REVISION}), flush=True)
    try:
        for index, (category, sample, attributes, description) in enumerate(cases):
            reference = Image.open(ROOT / 'workspace/references' / category / 'reference.png').convert('RGB')
            body = dict(modelId=args.model, sampleId=f'characters/{sample}.png', category=category,
                        garmentImage=ai.encode_image(reference), autoMask=True, cropPerson=True,
                        preprocessGarment=True, referenceType='product', targetGarment=attributes,
                        garmentDescription=description, reconstructExposedBody=True,
                        seed=72001+index*100, count=2, twoStage=True, steps=30, maxSide=1024,
                        guidance=2.0 if args.model=='idm-vton' else 2.5,
                        repairSeams=False, generativeRefine=False, maxRetries=0)
            started = time.perf_counter()
            try:
                result = ai.tryon(body)
                target = folder / f'{category}-{sample}.png'
                image = Image.open(ROOT / result['selected']).convert('RGB')
                image.save(target)
                selected = next(x for x in result['results'] if x['seed'] == result['selectedSeed'])
                record = {'category': category, 'sample': sample, 'status': 'completed',
                          'elapsedSeconds': time.perf_counter()-started, 'selected': str(target.relative_to(ROOT)),
                          'directory': result['directory'], 'gate': result['qualityGate'],
                          'metrics': {k:v for k,v in selected.items() if k != 'image'}}
            except Exception as error:
                record = {'category': category, 'sample': sample, 'status': 'failed', 'error': str(error)}
            report['cases'].append(record)
            (folder/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(record, ensure_ascii=True), flush=True)
    finally:
        ai.release_tryon()
    sheet = Image.new('RGB', (960, 460*len(cases)), 'white')
    draw = ImageDraw.Draw(sheet)
    for index, record in enumerate(report['cases']):
        if record['status'] != 'completed':
            continue
        files = [ROOT/'samples/characters'/f"{record['sample']}.png",
                 ROOT/'workspace/references'/record['category']/'reference.png', ROOT/record['selected']]
        for column, (label, file) in enumerate(zip(['Source','Reference',args.phase], files)):
            draw.text((column*320+8,index*460+8),record['category']+' / '+label,fill='black')
            thumb=ImageOps.contain(Image.open(file).convert('RGB'), (310,420))
            sheet.paste(thumb,(column*320+(320-thumb.width)//2,index*460+32))
    sheet.save(folder/'comparison.jpg')
    if any(x['status'] != 'completed' for x in report['cases']):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
