"""Install pinned IDM sources, Windows DensePose and register the local model."""
import argparse
import json
from pathlib import Path
import subprocess
import shutil
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / 'vendor' / 'IDM-VTON'
REVISION = '0d5f3ec2d737487a9bb24e4100936ad254780383'


def prepare_sources():
    if not VENDOR.exists():
        subprocess.run(['git', 'clone', 'https://github.com/yisol/IDM-VTON.git', str(VENDOR)], check=True)
        subprocess.run(['git', '-C', str(VENDOR), 'checkout', REVISION], check=True)
    # Adapt upstream's Diffusers 0.25 import locations to the app's 0.37 runtime.
    for folder in ('src', 'ip_adapter'):
        for file in (VENDOR / folder).glob('*.py'):
            text = file.read_text(encoding='utf-8')
            patched = text.replace('    PositionNet,', '    GLIGENTextBoundingboxProjection as PositionNet,')
            patched = patched.replace('from diffusers.models.transformer_2d import', 'from diffusers.models.transformers.transformer_2d import')
            patched = patched.replace('from diffusers.models.dual_transformer_2d import', 'from diffusers.models.transformers.dual_transformer_2d import')
            patched = patched.replace(', _remove_lora=_remove_lora)', ')')
            if text != patched:
                file.write_text(patched, encoding='utf-8')


def register_model():
    file = ROOT / 'models' / 'registry.json'
    registry = json.loads(file.read_text(encoding='utf-8'))
    if any(item['id'] == 'idm-vton' for item in registry['models']):
        return
    entry = dict(id='idm-vton', name='IDM-VTON', kind='tryon', architecture='sdxl',
                 path='models/tryon/IDM-VTON', configKey='idmVtonModel',
                 requiredFiles=['model_index.json', 'unet/config.json', 'unet_encoder/config.json'],
                 license='CC-BY-NC-SA-4.0', source='https://huggingface.co/yisol/IDM-VTON')
    history = ROOT / 'workspace' / 'model-registry-history'
    history.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    shutil.copy2(file, history / f'{stamp}-idm-vton-setup.json')
    registry['models'].append(entry)
    registry['updatedAt'] = datetime.now(timezone.utc).isoformat()
    file.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--local-only', action='store_true')
    args = parser.parse_args()
    prepare_sources()
    if not args.local_only:
        from huggingface_hub import hf_hub_download, snapshot_download
        snapshot_download('yisol/IDM-VTON', local_dir=str(ROOT / 'models/tryon/IDM-VTON'))
        hf_hub_download('hr16/DensePose-TorchScript-with-hint-image',
                        'densepose_r50_fpn_dl_fixed.torchscript',
                        revision='9822aed612fd3c413914701146bbdd7503338898',
                        local_dir=str(ROOT / 'models/pose/densepose'))
    register_model()
    print('IDM-VTON setup complete.')
