"""Shared catalog policy for the active text encoders; no diffusion weights."""
from prompt_catalog import read_catalog


def model_policy(model_id=None, pipeline=None):
    models = read_catalog().get('promptQuality', {}).get('models', {})
    if model_id in models and (pipeline is None or models[model_id]['pipeline'] == pipeline):
        return models[model_id]
    return next((value for value in models.values() if value['pipeline'] == pipeline), None)


def sequence_limit(policy, tokenizer, runtime_limit=None):
    limits = [policy['maxSequenceLength']]
    native = getattr(tokenizer, 'model_max_length', None)
    if isinstance(native, int) and 1 < native < 1000000:
        limits.append(native)
    if isinstance(runtime_limit, int) and runtime_limit > 0:
        limits.append(runtime_limit)
    return min(limits)


def token_count(tokenizer, text, policy, template=None, drop=0):
    if policy.get('chatTemplate'):
        if template:
            actual = template.format(text)
        elif policy.get('wrapper'):
            actual = policy['wrapper'].replace('{prompt}', text)
            drop = policy.get('wrapperDropTokens', 0)
        else:
            actual = tokenizer.apply_chat_template([{'role': 'user', 'content': text}], tokenize=False,
                                                   add_generation_prompt=True, enable_thinking=False)
    else:
        actual = text
    raw = len(tokenizer(actual, add_special_tokens=True, truncation=False)['input_ids'])
    return max(0, raw - drop), raw


def preview_policy(model_path, policy, prompt, negative):
    from pathlib import Path
    from prompt_limits import preview_tokenizer
    tokenizer = preview_tokenizer(str(Path(model_path) / 'tokenizer'))
    count, raw = token_count(tokenizer, prompt, policy)
    negative_count = token_count(tokenizer, negative, policy)[0] if policy['supportsNegative'] else None
    return [{'name': policy['encoder'].upper(), 'kind': policy['encoder'], 'prompt': prompt,
             'tokens': count, 'rawTokens': raw, 'limit': sequence_limit(policy, tokenizer),
             'negativeTokens': negative_count}]
