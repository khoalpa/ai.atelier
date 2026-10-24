import hashlib
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('depth_installer',Path(__file__).resolve().parents[1]/'scripts/setup-sd35-depth.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)

def meta(location):return SimpleNamespace(location=location,size=4,etag='same')
class Response:
    def __init__(self,code,content=b'abcd',range='bytes 0-3/4'):
        self.status_code=code;self.content=content;self.headers={'Content-Range':range}
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def raise_for_status(self):pass

with patch.object(installer,'get_hf_file_metadata',side_effect=[meta('https://cdn/old'),meta('https://cdn/new')]) as metadata,patch.object(installer.requests,'get',side_effect=[Response(403),Response(206)]) as get:
    source=installer.RangeSource('org/model','weights.safetensors')
    assert source.fetch((0,3))==b'abcd'
    assert get.call_args_list[1].args[0]=='https://cdn/new'
    assert metadata.call_args_list[0].args[0]!=metadata.call_args_list[1].args[0]
    source.refresh(failed_location='https://cdn/old')
    assert metadata.call_count==2 # Concurrent stale workers share the renewed URL.
with patch.object(installer,'get_hf_file_metadata',side_effect=[meta('https://cdn/old?Expires=1'),meta('https://cdn/new')]) as metadata:
    source=installer.RangeSource('org/model','weights.safetensors')
    assert source.location()=='https://cdn/new' and metadata.call_count==2
with patch.object(installer,'get_hf_file_metadata',side_effect=[meta('https://cdn/old'),SimpleNamespace(location='new',size=5,etag='changed')]):
    source=installer.RangeSource('org/model','weights.safetensors')
    try:source.refresh()
    except RuntimeError:pass
    else:raise AssertionError('Changed remote file accepted')

with tempfile.TemporaryDirectory() as folder:
    root=Path(folder);target=root/'models/test';target.mkdir(parents=True)
    partial=target/'weights.safetensors.partial';partial.write_bytes(b'ab')
    ranges=[]
    class Source:
        def __init__(self,*args):self.meta=SimpleNamespace(size=4,etag=hashlib.sha256(b'abcd').hexdigest())
        def fetch(self,bounds):ranges.append(bounds);return b'abcd'[bounds[0]:bounds[1]+1]
    api=SimpleNamespace(model_info=lambda *args,**kwargs:SimpleNamespace(siblings=[SimpleNamespace(rfilename='weights.safetensors')]))
    with patch.object(installer,'ROOT',root),patch.object(installer,'STATUS',root/'status.json'),patch.object(installer,'RangeSource',Source),patch.object(installer,'HfApi',return_value=api):
        installer.download('org/model','test')
    assert ranges==[(2,3)]
    assert (target/'weights.safetensors').read_bytes()==b'abcd'
    assert not partial.exists()
print('PASS: 403 refresh, proactive expiry renewal, shared renewal, identity guard, resumed bytes and final SHA256.')
