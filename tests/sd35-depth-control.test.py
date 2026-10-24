import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image
import sd35_depth_control as control

with tempfile.TemporaryDirectory() as directory:
    root=Path(directory)
    assert not control.readiness(root,{})['ready']
    paths=control.required_paths(root,{})
    for key,files in {'control':['config.json','diffusion_pytorch_model.safetensors'],'depth':['config.json','preprocessor_config.json','model.safetensors'],'base':['model_index.json','transformer/config.json']}.items():
        for name in files:
            file=paths[key]/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('{}')
    assert control.readiness(root,{})['ready']
    calls=[]
    class FakeControl:
        @classmethod
        def from_pretrained(cls,*args,**kwargs):
            assert kwargs['local_files_only'];return cls()
    class FakePipeline:
        @classmethod
        def from_pretrained(cls,*args,**kwargs):
            assert kwargs['local_files_only'];assert isinstance(kwargs['controlnet'],FakeControl);return cls()
        def to(self,device): assert device=='cpu'
    def call(pipe,**kwargs):
        calls.append(kwargs);return SimpleNamespace(images=[Image.new('RGB',(64,64))])
    with patch.dict(sys.modules,{'diffusers':SimpleNamespace(SD3ControlNetModel=FakeControl,StableDiffusion3ControlNetPipeline=FakePipeline)}),patch.object(control,'depth_image',return_value=Image.new('RGB',(128,128))),patch.object(control.torch.cuda,'is_available',return_value=False):
        image,depth,seed=control.generate(Image.new('RGB',(128,128)),{'prompt':'test','seed':123,'controlScale':.8},root,{},call)
    assert seed==123 and calls[0]['controlnet_conditioning_scale']==.8
    assert 'control_image' in calls[0] and 'ip_adapter_image' not in calls[0]
    assert calls[0]['max_sequence_length']==256
print('PASS: SD3.5 pipeline uses local models, depth conditioning, correct seed and no SDXL adapter.')
