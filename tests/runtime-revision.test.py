from helpers.ai_source import read_source
"""Optional IDM code participates in revision tracking without becoming mandatory."""
import ast
import json
import hashlib
import tempfile
from pathlib import Path

root=Path(__file__).resolve().parents[1]
tree=ast.parse(read_source(root/'ai_service.py', encoding='utf-8'))
assignment=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='SOURCE_REVISION' for t in n.targets))
code=compile(ast.Module(body=[assignment],type_ignores=[]),'<runtime-revision>','exec')
optional='vendor/IDM-VTON/src/tryon_pipeline.py'
with tempfile.TemporaryDirectory() as directory:
    folder=Path(directory)
    manifest=json.loads(read_source(root/'version.json', encoding='utf-8'))
    names=set(manifest['aiSources'])
    for name in names-{optional,'version.json'}:
        p=folder/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('base')
    (folder/'version.json').write_text(json.dumps(manifest),encoding='utf-8')
    def revision():
        ns={'ROOT':folder,'hashlib':hashlib,'json':json};exec(code,ns);return ns['SOURCE_REVISION']
    without=revision()
    p=folder/optional;p.parent.mkdir(parents=True);p.write_text('unseeded-pose')
    old=revision();p.write_text('seeded-pose');new=revision()
    assert len({without,old,new})==3
print('OK: optional IDM absence is supported and changes to its inference code change the runtime revision.')
