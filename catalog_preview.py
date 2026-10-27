"""Token-only catalog inspection: local tokenizer assets, no diffusion weights."""
import json
from pathlib import Path
from prompt_limits import preview_encoder_prompts
from encoder_policy import model_policy, preview_policy

def token_preview(root, body):
    model_id=body.get('modelId')
    registry=json.loads((Path(root)/'models/registry.json').read_text(encoding='utf-8'))
    entry=next((item for item in registry['models'] if item['id']==model_id),None)
    if entry is None:
        raise ValueError('Không tìm thấy model đã đăng ký.')
    path=Path(entry['path'])
    if not path.is_absolute():path=Path(root)/path
    architecture=entry.get('architecture')
    policy=model_policy(model_id)
    if not policy and architecture not in ('flux','sdxl','sd35','sd3','sd15','sd2'):
        raise ValueError('Chưa hỗ trợ kiểm tra tokenizer cho kiến trúc này.')
    prompt,negative=body.get('prompt',''),body.get('negativePrompt','')
    if any(not isinstance(value,str) or len(value)>16000 for value in (prompt,negative)):
        raise ValueError('Nội dung kiểm tra token không hợp lệ.')
    if policy and policy.get('tokenizerModel'):
        base=next((item for item in registry['models'] if item['id']==policy['tokenizerModel']),None)
        if not base:raise ValueError('Không tìm thấy model tokenizer nền.')
        path=Path(base['path'])
        if not path.is_absolute():path=Path(root)/path
    encoders=preview_policy(path,policy,prompt,negative) if policy else preview_encoder_prompts(path,architecture,prompt,negative,'background')
    if not encoders:raise ValueError('Model không có tokenizer cục bộ có thể đọc.')
    return {'ok':True,'modelId':model_id,'encoders':encoders,'supportsNegative':policy['supportsNegative'] if policy else None,'withinLimits':all(e['tokens']<=e['limit'] and (e['negativeTokens'] is None or e['negativeTokens']<=e['limit']) for e in encoders)}
