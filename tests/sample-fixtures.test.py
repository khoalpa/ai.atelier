import importlib.util
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('sample_validation',ROOT/'scripts/validate-samples.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
result=module.validate(ROOT)
assert len(result['workflowCases'])==24
assert all(row['inputValidation']=='passed'for row in result['workflowCases'])
print('Validated 64 demo assets, historical mappings, 24 workflow fixtures and the 90-pair dataset.')
