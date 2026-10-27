"""Validate text against the tokenizers actually used by a diffusion pipeline."""
import inspect


def split_flux_prompts(pipe, full_prompt, validate=True):
    """Keep the complete instruction in T5; create a bounded CLIP overview."""
    text = str(full_prompt).strip()
    if not text:
        raise ValueError('Prompt không được để trống.')
    tokenizer = pipe.tokenizer
    limit = min(70, int(tokenizer.model_max_length))
    # Prefer complete leading sentences. Any shortening affects only the
    # overview; the full user instruction remains unchanged in prompt_2.
    summary = text.split('. ', 1)[0].strip()
    if not summary.endswith('.'):
        summary += '.'
    while len(tokenizer(summary, add_special_tokens=True, truncation=False)['input_ids']) > limit:
        summary = summary.rsplit(' ', 1)[0] if ' ' in summary else summary[:-1]
        if not summary:
            raise ValueError('Không thể tạo bản tóm tắt trong giới hạn CLIP.')
    kwargs = {'prompt': summary, 'prompt_2': text}
    report = validate_prompt_limits(pipe, kwargs) if validate else {}
    return kwargs, {'clipSummaryShortened': summary != text, 'tokenBudget': report}


from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace


@lru_cache(maxsize=12)
def preview_tokenizer(path):
    from transformers import AutoTokenizer
    return AutoTokenizer.from_pretrained(path, local_files_only=True)


def preview_encoder_prompts(model_path, architecture, prompt, negative, fill_mode):
    """Read only local tokenizer assets; never load diffusion model weights."""
    encoders = []
    inputs = {'prompt': prompt}
    if architecture == 'flux' and fill_mode in ('background', 'base_layer', 'reconstruct_body') and prompt.strip():
        tokenizer = preview_tokenizer(str(Path(model_path) / 'tokenizer'))
        inputs, _ = split_flux_prompts(SimpleNamespace(tokenizer=tokenizer), prompt, validate=False)
    for index, folder in enumerate(('tokenizer', 'tokenizer_2', 'tokenizer_3')):
        path = Path(model_path) / folder
        if not path.is_dir():
            continue
        tokenizer = preview_tokenizer(str(path))
        is_t5 = (architecture == 'flux' and index == 1) or (architecture in ('sd3', 'sd35') and index == 2)
        label = 'T5' if is_t5 else ('CLIP' if index == 0 else 'CLIP 2')
        limit = (512 if architecture == 'flux' else 256) if is_t5 else int(tokenizer.model_max_length)
        if not 1 < limit < 1000000:
            raise ValueError('Không xác định được giới hạn tokenizer.')
        text = inputs.get('prompt' if index == 0 else 'prompt_' + str(index + 1), prompt)
        count = len(tokenizer(text, add_special_tokens=True, truncation=False)['input_ids'])
        negative_count = None if architecture == 'flux' else len(tokenizer(negative, add_special_tokens=True, truncation=False)['input_ids'])
        encoders.append({'name': label, 'kind': 't5' if is_t5 else 'clip', 'prompt': text,
                         'tokens': count, 'limit': limit, 'negativeTokens': negative_count})
    return encoders


def validate_prompt_limits(pipe, kwargs):
    from encoder_policy import model_policy, sequence_limit, token_count
    policy = model_policy(pipeline=type(pipe).__name__)
    report = {}
    if not any(getattr(pipe, 'tokenizer' + suffix, None) is not None for suffix in ('', '_2', '_3')):
        return report
    parameters = inspect.signature(pipe.__call__).parameters
    sequence = kwargs.get('max_sequence_length')
    if sequence is None and 'max_sequence_length' in parameters:
        default = parameters['max_sequence_length'].default
        if isinstance(default, int):
            sequence = default
    for suffix in ('', '_2', '_3'):
        tokenizer = getattr(pipe, 'tokenizer' + suffix, None)
        if tokenizer is None:
            continue
        native_limit = getattr(tokenizer, 'model_max_length', None)
        limits = [v for v in (native_limit,) if isinstance(v, int) and 1 < v < 1000000]
        klein = type(pipe).__name__ == 'Flux2KleinPipeline'
        if (suffix or klein) and isinstance(sequence, int) and sequence > 0:
            limits.append(sequence)
        if policy:
            limits.append(sequence_limit(policy, tokenizer, sequence))
        if not limits:
            raise ValueError('Không xác định được giới hạn tokenizer; chưa gửi prompt vào model.')
        limit = min(limits)
        if policy and suffix == '':
            limit = sequence_limit(policy, tokenizer, sequence)
        for prefix in ('prompt', 'negative_prompt'):
            key = prefix + suffix
            value = kwargs.get(key, kwargs.get(prefix))
            if value is None:
                continue
            texts = value if isinstance(value, list) else [value]
            if policy:
                template=getattr(pipe, 'prompt_template_encode', None)
                drop=getattr(pipe, 'prompt_template_encode_start_idx', 0)
                counts=[token_count(tokenizer,text,policy,template,drop)[0] for text in texts]
            elif klein:
                texts = [tokenizer.apply_chat_template([{'role': 'user', 'content': text}], tokenize=False,
                         add_generation_prompt=True, enable_thinking=False) for text in texts]
                counts = [len(tokenizer(text, add_special_tokens=True, truncation=False)['input_ids']) for text in texts]
            else:
                counts = [len(tokenizer(text, add_special_tokens=True, truncation=False)['input_ids']) for text in texts]
            report[key] = {'tokens': counts, 'limit': limit}
            if any(count > limit for count in counts):
                raise ValueError(f'{key}: {max(counts)} token, vượt giới hạn {limit}. Hãy rút ngắn nội dung; model chưa được gọi.')
    return report
