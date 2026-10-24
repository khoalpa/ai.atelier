"""AI Atelier: tasks.dispatch."""
from services.ai.runtime import metadata
from services.ai.runtime.configuration import JOBS_DIR
from services.ai.runtime.factory import task_context
from services.ai.runtime.jobs import update_job
from services.ai.tasks.generate import chroma_generate, sd35_conditioned_generate, sdxl_conditioned_generate
from services.ai.tasks.inpaint import inpaint
from services.ai.tasks.outpaint import outpaint
from services.ai.tasks.tryon import batch_tryon, tryon


def dispatch_generation(route, body):
    if route == '/tryon': return tryon(body)
    if route == '/batch-tryon': return batch_tryon(body)
    if route == '/inpaint': return inpaint(body)
    if route == '/outpaint': return outpaint(body)
    if route == '/chroma-generate': return chroma_generate(body)
    if route == '/sd35-conditioned-generate': return sd35_conditioned_generate(body)
    if route == '/sdxl-conditioned-generate': return sdxl_conditioned_generate(body)
    if route == '/enhance':
        from image_enhancement import enhance
        return enhance(body, task_context())
    if route in ('/character-render', '/character-regenerate'):
        from character import run, regenerate
        return (regenerate if route.endswith('regenerate') else run)(body, task_context())
    if route in ('/makeup', '/makeup-compare'):
        if route == '/makeup-compare':
            from makeup_comparison import run
        else:
            from makeup import run
        return run(body, task_context())
    raise ValueError('Loại tác vụ không được hỗ trợ.')


def resume_job(body: dict) -> dict:
    job_id = str(body.get("jobId", ""))[:80]
    safe_job_id = "".join(character for character in job_id if character.isalnum() or character in "-_")
    request_file = JOBS_DIR / f"{safe_job_id}.request.json"
    if not safe_job_id or not metadata.exists(request_file):
        raise ValueError("Tác vụ không có điểm kiểm tra để tiếp tục")
    request = metadata.read(request_file)
    request.update(jobId=job_id, resume=True)
    if request.get('_route'):
        update_job(job_id, cancelRequested=False, status='running', error=None, response=None)
        return dispatch_generation(request['_route'], request)
    task_type = str(request.get("taskType") or "batch-tryon")
    if task_type == "character":
        from character import run
        update_job(job_id, cancelRequested=False, status="running", error=None, results=[])
        return run(request, task_context())
    if task_type == "makeup":
        if request.get("comparisonStyles"):
            from makeup_comparison import run
        else:
            from makeup import run
        update_job(job_id, cancelRequested=False, status="running", error=None, results=[])
        return run(request, task_context())
    if task_type == "enhance":
        from image_enhancement import enhance
        update_job(job_id, cancelRequested=False, status="running", error=None, results=[])
        return enhance(request, task_context())
    if task_type == "outpaint":
        update_job(job_id, cancelRequested=False, status="running", error=None)
        return outpaint(request)
    if task_type == "inpaint":
        # Diffusion schedulers cannot safely resume from an arbitrary latent step.
        # Replay the saved request with the same seed instead.
        update_job(job_id, cancelRequested=False, status="running", stage="inpaint-validating",
                   resumable=True, error=None,
                   _event={"type":"job.resumed", "message":"Đang chạy lại Inpainting từ đầu với cùng cấu hình và seed"})
        return inpaint(request)
    update_job(job_id, cancelRequested=False, status="running", error=None)
    return batch_tryon(request)
