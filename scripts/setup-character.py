"""Install pinned, verified local weights for Character Studio (network only here)."""
import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [
 ('stabilityai/stable-diffusion-xl-base-1.0','462165984030d82259a11f4367a4eed129e94a7b','models/character/sdxl-base',['unet/config.json','unet/diffusion_pytorch_model.fp16.safetensors','scheduler/scheduler_config.json','LICENSE.md']),
    ('xinsir/controlnet-openpose-sdxl-1.0', '23f966cd5cfdd3f7729c903e243d87152162d2b7',
     'models/character/openpose-sdxl', ['config.json', 'diffusion_pytorch_model.safetensors', 'README.md']),
    ('h94/IP-Adapter', '018e402774aeeddd60609b4ecdb7e298259dc729', 'models/character/ip-adapter',
     ['models/image_encoder/config.json', 'models/image_encoder/model.safetensors',
      'sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors', 'sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors']),
    ('KlingTeam/LivePortrait', '82a4fa6735ca58432b6ce39301b4b9ee066dea47', 'models/character/liveportrait',
     ['liveportrait/base_models/'+name+'.pth' for name in
      ['appearance_feature_extractor', 'motion_extractor', 'spade_generator', 'warping_module']]+
     ['liveportrait/retargeting_models/stitching_retargeting_module.pth']),
]

def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'AI-Atelier-Setup'}), timeout=60).read()

def digest(file):
    h = hashlib.sha256()
    with open(file, 'rb') as stream:
        for block in iter(lambda: stream.read(8*1024*1024), b''): h.update(block)
    return h.hexdigest()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--offline',action='store_true');args=parser.parse_args()
    manifest_path=ROOT/'models/character/installation.json'
    if args.offline:
        data=json.loads(manifest_path.read_text())
        for entry in data['files']:
            path=ROOT/entry['path']
            if not path.is_file() or digest(path)!=entry['sha256']: raise RuntimeError('Missing or changed: '+entry['path'])
        print('Verified',len(data['files']),'files offline');return
    from huggingface_hub import hf_hub_download, HfApi
    records=[]
    for repo,revision,target,names in SOURCES:
        info=HfApi().model_info(repo,revision=revision,files_metadata=True)
        remote={item.rfilename:item for item in info.siblings}
        for name in names:
            print('Downloading',repo,name,flush=True)
            path=Path(hf_hub_download(repo,name,revision=revision,local_dir=ROOT/target))
            sha=digest(path);lfs=getattr(remote[name],'lfs',None)
            if lfs and sha!=lfs.sha256: raise RuntimeError('Remote checksum mismatch: '+name)
            records.append(dict(path=path.relative_to(ROOT).as_posix(),sha256=sha,repo=repo,revision=revision))
    vendor=ROOT/'vendor/LivePortrait';vendor.mkdir(parents=True,exist_ok=True)
    pin=vendor/'source-revision.txt'
    revision='9b294b3d0536135442ea73cb01e6cb3ca7029dd3'
    tree=json.loads(fetch(f'https://api.github.com/repos/KlingAIResearch/LivePortrait/git/trees/{revision}?recursive=1'))['tree']
    for item in tree:
        name=item['path']
        if item['type']!='blob' or not (name in ('LICENSE','readme.md') or (name.startswith('src/') and '/dependencies/' not in name)): continue
        path=vendor/name;path.parent.mkdir(parents=True,exist_ok=True)
        def git_blob_sha(content):return hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()
        if not path.exists() or git_blob_sha(path.read_bytes())!=item['sha']:
            content=fetch(f'https://raw.githubusercontent.com/KlingAIResearch/LivePortrait/{revision}/{name}')
            if git_blob_sha(content)!=item['sha']:raise RuntimeError('Vendor source checksum mismatch: '+name)
            path.write_bytes(content)
        records.append(dict(path=path.relative_to(ROOT).as_posix(),sha256=digest(path),repo='KlingAIResearch/LivePortrait',revision=revision))
    pin.write_text(revision)
    manifest_path.parent.mkdir(parents=True,exist_ok=True)
    manifest_path.write_text(json.dumps(dict(version=1,files=records),indent=2))
    print('Installed and verified',len(records),'files',flush=True)

if __name__=='__main__': main()
