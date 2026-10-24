"""Record resolved dependencies used by the AI service, with source provenance."""
from importlib import metadata
from pathlib import Path
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
import json

ROOT=Path(__file__).resolve().parents[1]
SEEDS=['torch','torchvision','diffusers','transformers','accelerate','peft','safetensors',
       'pillow','numpy','opencv-python-headless','ultralytics','timm','kornia',
       'onnxruntime','mediapipe','SAM-2','clip','scipy','omegaconf',
       'hydra-core','einops','sentencepiece','protobuf']
pending=list(SEEDS);resolved={};sources={};missing=set()
while pending:
    name=pending.pop();key=canonicalize_name(name)
    if key in resolved or key in missing:continue
    try:dist=metadata.distribution(name)
    except metadata.PackageNotFoundError:
        missing.add(key);continue
    resolved[key]=f'{dist.metadata["Name"]}=={dist.version}'
    direct=json.loads(dist.read_text('direct_url.json') or '{}')
    if direct.get('vcs_info'):
        info=direct['vcs_info'];sources[key]=f'{dist.metadata["Name"]} @ {info["vcs"]}+{direct["url"]}@{info["commit_id"]}'
    for value in dist.requires or []:
        req=Requirement(value)
        if req.marker is None or req.marker.evaluate({'extra':''}):pending.append(req.name)
header='# Resolved on Python 3.10 / Windows x64. Build wheels from requirements-ai-sources.lock.\n'
(ROOT/'requirements-ai.lock').write_text(header+'\n'.join(resolved[key] for key in sorted(resolved))+'\n',encoding='utf-8')
(ROOT/'requirements-ai-sources.lock').write_text(header+'\n'.join(sources.get(key,resolved[key]) for key in sorted(resolved))+'\n',encoding='utf-8')
print(f'Locked {len(resolved)} installed dependencies; {len(sources)} source commits.')
print('Metadata requirements absent from current runtime:',', '.join(sorted(missing)) or 'none')
(ROOT/'requirements-ai-audit.json').write_text(json.dumps({'python':'3.10','platform':'win_amd64','missingMetadataRequirements':sorted(missing),'note':'Snapshot of the existing runtime, including its dependency gaps. Offline setup must resolve these before being treated as a new-machine installer.'},indent=2)+'\n',encoding='utf-8')
