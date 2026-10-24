"""Verify the real inference loader, including upstream shared tensor aliases."""
import argparse
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--run',type=Path,required=True)
    args=parser.parse_args(); run=args.run.resolve()
    import torch
    from accelerate import load_checkpoint_in_model
    from safetensors import safe_open
    import ai_service as ai
    from vton_pilot import file_hash
    ai.device='cpu'
    pipe=ai.load_tryon_pipe('catvton')
    checkpoint=run/'attention/model.safetensors'
    load_checkpoint_in_model(pipe.attn_modules,str(checkpoint.parent))
    state=pipe.attn_modules.state_dict()
    with safe_open(checkpoint,framework='pt',device='cpu') as saved:
        keys=list(saved.keys())
        mismatches=[key for key in keys if key not in state or
                    not torch.equal(saved.get_tensor(key).to(state[key].dtype),state[key])]
        aliases={key:value for key,value in (saved.metadata() or {}).items() if key in state and value in keys}
        mismatches.extend(key for key,value in aliases.items() if
                          not torch.equal(saved.get_tensor(value).to(state[key].dtype),state[key]))
        finite=all(torch.isfinite(saved.get_tensor(key)).all().item() for key in keys)
    if mismatches or not finite:
        raise AssertionError(f'Checkpoint verification failed: {mismatches}')
    result={'verified':True,'loader':'CatVTON attention / accelerate.load_checkpoint_in_model',
            'tensors':len(keys),'sharedAliases':len(aliases),'finite':finite,'mismatches':mismatches,'sha256':file_hash(checkpoint)}
    (run/'checkpoint-verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result))


if __name__=='__main__': main()
