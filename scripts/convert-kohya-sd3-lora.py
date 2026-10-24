"""Convert a Kohya sd-scripts SD3/SD3.5 LoRA to Diffusers/PEFT keys.

The source file is never modified. Combined QKV LoRA matrices are split along
their output dimension and the original alpha/rank scale is folded into B.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import torch
from safetensors import safe_open
from safetensors.torch import save_file


BLOCK = re.compile(r"^lora_unet_joint_blocks_(\d+)_(context_block|x_block)_(.+)$")
MODULES = {
    ("context_block", "adaLN_modulation_1"): "norm1_context.linear",
    ("context_block", "attn_proj"): "attn.to_add_out",
    ("context_block", "mlp_fc1"): "ff_context.net.0.proj",
    ("context_block", "mlp_fc2"): "ff_context.net.2",
    ("x_block", "adaLN_modulation_1"): "norm1.linear",
    ("x_block", "attn_proj"): "attn.to_out.0",
    ("x_block", "mlp_fc1"): "ff.net.0.proj",
    ("x_block", "mlp_fc2"): "ff.net.2",
}
QKV = {
    "context_block": ("attn.add_q_proj", "attn.add_k_proj", "attn.add_v_proj"),
    "x_block": ("attn.to_q", "attn.to_k", "attn.to_v"),
}


def load_source(path: Path) -> tuple[dict[str, torch.Tensor], dict[str, str]]:
    with safe_open(path, framework="pt", device="cpu") as handle:
        tensors = {key: handle.get_tensor(key) for key in handle.keys()}
        metadata = dict(handle.metadata() or {})
    return tensors, metadata


def convert(source: dict[str, torch.Tensor]) -> tuple[dict[str, torch.Tensor], dict]:
    stems = sorted({key.rsplit(".", 2)[0] for key in source if key.endswith(".lora_down.weight")})
    output: dict[str, torch.Tensor] = {}
    converted_stems = 0
    split_stems = 0

    for stem in stems:
        match = BLOCK.match(stem)
        if not match:
            raise ValueError(f"Unsupported Kohya SD3 key: {stem}")
        block, side, module = match.groups()
        down = source[f"{stem}.lora_down.weight"]
        up = source[f"{stem}.lora_up.weight"]
        alpha_tensor = source.get(f"{stem}.alpha")
        alpha = float(alpha_tensor.item()) if alpha_tensor is not None else float(down.shape[0])
        scale = alpha / float(down.shape[0])
        prefix = f"transformer.transformer_blocks.{block}."

        if module == "attn_qkv":
            if up.shape[0] % 3:
                raise ValueError(f"QKV output cannot be split into thirds: {stem} {tuple(up.shape)}")
            for target, up_part in zip(QKV[side], up.chunk(3, dim=0)):
                output[f"{prefix}{target}.lora_A.weight"] = down.clone().contiguous()
                output[f"{prefix}{target}.lora_B.weight"] = (up_part * scale).contiguous()
            split_stems += 1
        else:
            target = MODULES.get((side, module))
            if target is None:
                raise ValueError(f"Unsupported SD3 module: {stem}")
            output[f"{prefix}{target}.lora_A.weight"] = down.contiguous()
            output[f"{prefix}{target}.lora_B.weight"] = (up * scale).contiguous()
        converted_stems += 1

    report = {
        "sourceTensorCount": len(source),
        "sourceLoraCount": len(stems),
        "convertedLoraCount": converted_stems + split_stems * 2,
        "outputTensorCount": len(output),
        "splitQkvCount": split_stems,
    }
    return output, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.source.resolve() == args.destination.resolve():
        raise ValueError("Destination must differ from source")
    tensors, source_metadata = load_source(args.source)
    converted, report = convert(tensors)
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    metadata = {
        "format": "diffusers-peft",
        "base_model": "stable-diffusion-3.5-large",
        "converted_from": args.source.name,
        "converter": "ai.image/scripts/convert-kohya-sd3-lora.py",
        "source_ss_base_model_version": source_metadata.get("ss_base_model_version", ""),
        "source_ss_sd_model_name": source_metadata.get("ss_sd_model_name", ""),
    }
    save_file(converted, str(args.destination), metadata=metadata)
    report.update(source=str(args.source), destination=str(args.destination), metadata=metadata)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
