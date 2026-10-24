"""Convert a local SD 1.5/SDXL inpainting checkpoint into a Diffusers folder.

The conversion is entirely offline: the existing Diffusers model is used only as
the local configuration source, and the checkpoint is never uploaded.
"""

from __future__ import annotations

import argparse
import gc
from pathlib import Path

import torch
from diffusers import StableDiffusionInpaintPipeline, StableDiffusionXLInpaintPipeline


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--architecture", choices=("sd15", "sdxl"), required=True)
    args = parser.parse_args()

    if not args.checkpoint.is_file():
        raise SystemExit(f"Không tìm thấy checkpoint: {args.checkpoint}")
    if not (args.config / "model_index.json").is_file():
        raise SystemExit(f"Thiếu cấu hình Diffusers cục bộ: {args.config}")
    if args.output.exists():
        raise SystemExit(f"Thư mục đích đã tồn tại: {args.output}")

    pipeline_class = StableDiffusionXLInpaintPipeline if args.architecture == "sdxl" else StableDiffusionInpaintPipeline
    args.output.parent.mkdir(parents=True, exist_ok=True)
    pipeline = pipeline_class.from_single_file(
        str(args.checkpoint), config=str(args.config), local_files_only=True, torch_dtype=torch.float16
    )
    pipeline.save_pretrained(str(args.output), safe_serialization=True)
    del pipeline
    gc.collect()
    print(args.output)


if __name__ == "__main__":
    main()
