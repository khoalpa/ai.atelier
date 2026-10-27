"""Catalog token checks use registered local assets and never load a pipeline."""
import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from catalog_preview import token_preview

with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);(root/'models').mkdir()
    registry={'models':[{'id':'local','path':'models/example','architecture':'sdxl'},{'id':'unsupported','path':'models/other','architecture':'klein'}]}
    (root/'models/registry.json').write_text(json.dumps(registry),encoding='utf-8')
    response=[{'name':'CLIP','tokens':12,'negativeTokens':5,'limit':77}]
    with patch('catalog_preview.preview_encoder_prompts',return_value=response) as preview:
        result=token_preview(root,{'modelId':'local','prompt':'A garment','negativePrompt':'blur'})
        assert result['withinLimits'] and result['encoders']==response
        assert preview.call_args.args==(root/'models/example','sdxl','A garment','blur','background')
    with patch('catalog_preview.preview_encoder_prompts',return_value=[{'name':'CLIP','tokens':90,'negativeTokens':5,'limit':77}]):
        assert not token_preview(root,{'modelId':'local','prompt':'text'})['withinLimits']
    with patch('catalog_preview.preview_encoder_prompts') as preview:
        for body in [{'modelId':'missing'},{'modelId':'unsupported'},{'modelId':'local','prompt':'x'*16001}]:
            try:token_preview(root,body)
            except ValueError:pass
            else:raise AssertionError('Invalid model or prompt accepted')
        preview.assert_not_called()
print('OK: local-tokenizer-only preview, precise limits and unsupported/invalid input handling.')
