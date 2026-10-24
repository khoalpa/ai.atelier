import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prompt_limits import validate_prompt_limits, split_flux_prompts

class Tokenizer:
    model_max_length = 77
    def __call__(self, text, **kwargs):
        return {'input_ids': [0] + list(text) + [1]}

class Pipe:
    tokenizer = Tokenizer()
    tokenizer_2 = Tokenizer()
    def __call__(self, max_sequence_length=50):
        raise AssertionError('Validation must not run inference')

p = Pipe()
assert validate_prompt_limits(p, {'prompt': 'short'})['prompt']['tokens'] == [7]
for kwargs in ({'prompt': 'x' * 76}, {'prompt': 'short', 'prompt_2': 'x' * 49}, {'prompt': 'short', 'negative_prompt': 'x' * 76}, {'prompt': ['short', 'x' * 76]}):
    try:
        validate_prompt_limits(p, kwargs)
    except ValueError:
        pass
    else:
        raise AssertionError('Oversized input was accepted')
assert validate_prompt_limits(object(), {}) == {}
class Flux2KleinPipeline:
    tokenizer = Tokenizer()
    tokenizer.model_max_length = 1000000000
    tokenizer.apply_chat_template = lambda messages, **kwargs: 'wrapper:' + messages[0]['content']
    def __call__(self, max_sequence_length=20):
        pass

assert validate_prompt_limits(Flux2KleinPipeline(), {'prompt': 'short'})['prompt']['limit'] == 20
try:
    validate_prompt_limits(Flux2KleinPipeline(), {'prompt': 'x' * 15})
except ValueError:
    pass
else:
    raise AssertionError('Klein chat-template overhead must count towards the 512-token bound')
print('OK: per-encoder limits, special tokens, batch text and negative prompts; no silent truncation.')

class Flux(Pipe):
    def __call__(self, max_sequence_length=512):
        pass

flux = Flux()
flux.tokenizer_2 = Tokenizer()
flux.tokenizer_2.model_max_length = 512
full = ('Remove the bag. ' + 'Match background lighting. ' * 6).strip()
kwargs, info = split_flux_prompts(flux, full)
assert kwargs['prompt_2'] == full
assert info['tokenBudget']['prompt']['tokens'][0] <= 70
assert info['tokenBudget']['prompt_2']['tokens'][0] > 77
assert info['clipSummaryShortened']
kwargs, _ = split_flux_prompts(flux, 'longword' * 20)
assert len(kwargs['prompt']) <= 68
try:
    split_flux_prompts(flux, 'x' * 520)
except ValueError:
    pass
else:
    raise AssertionError('T5 overflow must not silently truncate the full prompt')
print('OK: short CLIP overview, unchanged long T5 instruction, strict T5 overflow.')
