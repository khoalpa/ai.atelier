"""Use installed tokenizer files, with no model weights or GPU inference."""
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from catalog_preview import token_preview

prompt='A blue cotton shirt. '+('Show consistent fabric weave, accurate seams and natural folds under soft studio light. '*10)
for model in ('flux-chroma1-hd','flux-2-klein-4b','qwen-image-controlnet-inpainting'):
    result=token_preview(ROOT,{'modelId':model,'prompt':prompt,'negativePrompt':'blur, mismatched lighting'})
    encoder=result['encoders'][0]
    assert result['withinLimits'] and 77<encoder['tokens']<=encoder['limit'],(model,encoder)
    assert not token_preview(ROOT,{'modelId':model,'prompt':'cotton '*600})['withinLimits']
    if model=='flux-2-klein-4b':assert encoder['negativeTokens'] is None
    if model=='qwen-image-controlnet-inpainting':assert encoder['rawTokens']-encoder['tokens']==34
print('OK: actual T5/Qwen tokenizer assets, prompts beyond CLIP length, exact overflow and Qwen wrapper accounting.')
