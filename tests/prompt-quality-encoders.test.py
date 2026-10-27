import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from encoder_policy import model_policy, token_count, sequence_limit
from prompt_limits import validate_prompt_limits
from prompt_catalog import prompt_value

class Tokenizer:
    model_max_length=10**9
    def __call__(self,text,**kwargs):return {'input_ids':list(range(len(text.split())+2))}
    def apply_chat_template(self,messages,**kwargs):return 'system wrapper '+messages[0]['content']+' assistant'

class ChromaPipeline:
    tokenizer=Tokenizer()
    def __call__(self,max_sequence_length=512):raise AssertionError('No inference in preflight')

pipe=ChromaPipeline()
assert validate_prompt_limits(pipe,{'prompt':'word '*100})['prompt']['tokens']==[102]
try:validate_prompt_limits(pipe,{'prompt':'word '*511})
except ValueError:pass
else:raise AssertionError('T5 overflow silently accepted')
assert model_policy('flux-2-klein-4b','ChromaPipeline')['encoder']=='t5'
assert token_count(Tokenizer(),'one two',model_policy('flux-2-klein-4b'))[0]==7
assert sequence_limit(model_policy('flux-chroma1-hd'),Tokenizer(),256)==256
text='word '*250+'important ending';assert prompt_value(text)==text
try:prompt_value('x'*16001)
except ValueError:pass
else:raise AssertionError('Oversized transport text accepted')
print('OK: T5 beyond CLIP length, exact overflow, pipeline policy, wrapper count and no character truncation.')

# Exercise the real call boundary without importing a model or running inference.
import ast
from types import SimpleNamespace
source=ast.parse((Path(__file__).resolve().parents[1]/'services/ai/runtime/tracing.py').read_text(encoding='utf-8'))
namespace={'prompt_trace_context':SimpleNamespace(get=lambda:None)}
exec(compile(ast.Module(body=[node for node in source.body if isinstance(node,ast.FunctionDef) and node.name=='traced_pipeline_call'],type_ignores=[]),'tracing.py','exec'),namespace)
class QwenImageControlNetPipeline:
    tokenizer=Tokenizer()
    prompt_template_encode='obsolete {}'
    prompt_template_encode_start_idx=0
    def __call__(self,prompt,max_sequence_length=512):return {'prompt':prompt,'max_sequence_length':max_sequence_length}
qwen=QwenImageControlNetPipeline()
result=namespace['traced_pipeline_call'](qwen,prompt='A blue shirt')
assert qwen.prompt_template_encode==model_policy(pipeline=type(qwen).__name__)['wrapper'].replace('{prompt}','{}')
assert qwen.prompt_template_encode_start_idx==34 and result['max_sequence_length']==512
print('OK: runtime and preview use the same catalog wrapper and sequence configuration.')
