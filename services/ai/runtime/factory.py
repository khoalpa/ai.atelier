"""AI Atelier: runtime.factory."""
from services.ai.runtime.context import TaskContext
import torch
from services.ai.imaging.segmentation import detect_people_pose, safe_sample
from services.ai.models.pipelines import configure_vae_memory, load_inpaint_pipe, load_text_to_image_pipe, release_inpaint, release_tryon, release_text_to_image, text_to_image_model_path
from services.ai.runtime.configuration import CHROMA_ROOT, JOBS_DIR, OUTPUTS, ROOT, SOURCE_REVISION, device
from services.ai.runtime.jobs import ensure_job_active, persist_job_request, update_job
from services.ai.runtime.tracing import prompt_history, save_diffusion_preview, traced_pipeline_call


def task_context():
    return TaskContext(
        ROOT=ROOT, OUTPUTS=OUTPUTS, JOBS_DIR=JOBS_DIR, CHROMA_ROOT=CHROMA_ROOT,
        SOURCE_REVISION=SOURCE_REVISION, device=device, torch=torch,
        safe_sample=safe_sample, update_job=update_job, ensure_job_active=ensure_job_active,
        persist_job_request=persist_job_request, load_inpaint_pipe=load_inpaint_pipe,
        load_text_to_image_pipe=load_text_to_image_pipe, release_inpaint=release_inpaint,
        release_tryon=release_tryon,
        release_text_to_image=release_text_to_image, text_to_image_model_path=text_to_image_model_path,
        configure_vae_memory=configure_vae_memory, traced_pipeline_call=traced_pipeline_call,
        prompt_history=prompt_history, save_diffusion_preview=save_diffusion_preview,
        detect_people_pose=detect_people_pose,
    )


def execution_journal():
    from services.ai.runtime.execution import ExecutionJournal
    return ExecutionJournal(ROOT, JOBS_DIR, update_job, ensure_job_active, SOURCE_REVISION)
