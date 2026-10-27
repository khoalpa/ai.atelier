"""Explicit dependencies shared by image tasks; no access to service globals."""
from collections.abc import Mapping
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Any, Callable


@dataclass(frozen=True)
class TaskContext(Mapping):
    ROOT: Path
    OUTPUTS: Path
    JOBS_DIR: Path
    CHROMA_ROOT: Path
    INPAINT_MODEL: Path
    SOURCE_REVISION: str
    device: str
    torch: Any
    safe_sample: Callable
    update_job: Callable
    ensure_job_active: Callable
    persist_job_request: Callable
    load_inpaint_pipe: Callable
    load_text_to_image_pipe: Callable
    release_inpaint: Callable
    release_tryon: Callable
    release_text_to_image: Callable
    text_to_image_model_path: Callable
    configure_vae_memory: Callable
    traced_pipeline_call: Callable
    prompt_history: Callable
    save_diffusion_preview: Callable
    detect_people_pose: Callable

    def __getitem__(self, key):
        if key not in self.__dataclass_fields__:
            raise KeyError(key)
        return getattr(self, key)

    def __iter__(self):
        return (field.name for field in fields(self))

    def __len__(self):
        return len(fields(self))
