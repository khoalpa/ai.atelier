"""Run the canonical three-image qualification for registered product references."""
import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--categories', nargs='+', choices=['upper_body', 'lower_body', 'overall'], default=['upper_body', 'lower_body', 'overall'])
    options = parser.parse_args()
    import ai_service
    report = {'createdAt': datetime.now(timezone.utc).isoformat(), 'items': []}
    for category in options.categories:
        started = time.monotonic()
        print(json.dumps({'category': category, 'stage': 'qualifying'}), flush=True)
        try:
            result = ai_service.qualify_product_reference({'category': category, 'seed': 52001, 'steps': 20, 'maxSide': 512})
            item = {'category': category, 'passed': result['passed'], 'passedCount': result['passedCount'], 'report': result['report']}
        except Exception as error:
            item = {'category': category, 'passed': False, 'error': str(error)}
        item['elapsedSeconds'] = round(time.monotonic() - started, 2)
        report['items'].append(item)
        print(json.dumps(item), flush=True)
        target = ROOT/'workspace/diagnostics/product-reference-qualification.json'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return 0 if all(item['passed'] for item in report['items']) else 1

if __name__ == '__main__':
    raise SystemExit(main())
