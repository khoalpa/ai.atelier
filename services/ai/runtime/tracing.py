"""AI Atelier: runtime.tracing."""
from PIL import Image, ImageFilter, ImageOps
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
import torch
from services.ai.runtime.jobs import job_lock, jobs, update_job


prompt_trace_context = ContextVar("prompt_trace", default=None)


def trace_generation(function):
    @wraps(function)
    def wrapped(body):
        context = {"body": body, "history": [], "jobId": str(body.get("jobId") or "")}
        token = prompt_trace_context.set(context)
        try:
            return function(body)
        finally:
            prompt_trace_context.reset(token)
    return wrapped


def prompt_history():
    context = prompt_trace_context.get()
    return list(context["history"]) if context else []


def traced_pipeline_call(pipe, **kwargs):
    from encoder_policy import model_policy
    import inspect
    policy=model_policy(pipeline=type(pipe).__name__)
    if policy and policy.get('wrapper') and hasattr(pipe,'prompt_template_encode'):
        pipe.prompt_template_encode=policy['wrapper'].replace('{prompt}','{}')
        pipe.prompt_template_encode_start_idx=policy['wrapperDropTokens']
    if policy and 'max_sequence_length' in inspect.signature(pipe.__call__).parameters:
        kwargs.setdefault('max_sequence_length', policy['maxSequenceLength'])
    # CLIP vision encoders remain valid. Only CLIP text tokenizers are banned.
    if any('clip' in type(getattr(pipe, name, None)).__name__.lower()
           for name in ('tokenizer', 'tokenizer_2', 'tokenizer_3')):
        raise RuntimeError('Tác vụ dùng token CLIP đã bị loại vĩnh viễn. Hãy dùng pipeline T5.')
    prompt_cache = kwargs.pop('_prompt_cache', None)
    from prompt_limits import validate_prompt_limits
    token_budget = validate_prompt_limits(pipe, kwargs)
    context = prompt_trace_context.get()
    if context is not None:
        body = context["body"]
        job_id = context["jobId"]
        with job_lock:
            state = dict(jobs.get(job_id, {}))
        fields = {key: kwargs[key] for key in ("prompt", "prompt_2", "prompt_3", "negative_prompt", "negative_prompt_2", "negative_prompt_3") if key in kwargs}
        generator = kwargs.get("generator")
        entry = {
            "sequence": len(context["history"]) + 1,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "stage": state.get("stage", "generation"), "sampleId": body.get("sampleId"),
            "model": str(getattr(pipe, "_atelier_model_path", None) or state.get("model") or type(pipe).__name__),
            "pipeline": type(pipe).__name__,
            "seed": int(generator.initial_seed()) if hasattr(generator, "initial_seed") else state.get("seed"),
            "autoRetry": bool(state.get("autoRetry", False)),
            "userPrompt": str(body.get("prompt") or ""),
            "userNegativePrompt": str(body.get("negativePrompt") or ""),
            "sources": {key: body[key] for key in ("modelId", "removalTarget", "fillMode", "forbiddenReplacement", "processingMode", "presetId") if key in body},
            "prompts": fields,
            "tokenBudget": token_budget,
            "negativePromptStrategy": "direct" if "negative_prompt" in fields else "merged-into-positive" if "Avoid these failure modes:" in str(fields.get("prompt", "")) else "unused",
            "resolvedSources": context.get("resolvedSources", {}),
            "parameters": {key: kwargs[key] for key in ("num_inference_steps", "guidance_scale", "strength", "width", "height") if key in kwargs},
        }
        context["history"].append(entry)
        # Persist before inference so failures and cancellation retain the actual call.
        update_job(job_id, _prompt=entry)
    return pipe(**(prompt_cache.apply(kwargs) if prompt_cache is not None else kwargs))


def save_diffusion_preview(pipe, latents, target: Path, width: int, height: int) -> bool:
    """Decode a best-effort preview without changing the active generation state."""
    try:
        preview_latents = latents.detach()
        if preview_latents.ndim == 3 and hasattr(pipe, "_unpack_latents"):
            preview_latents = pipe._unpack_latents(preview_latents, height, width, pipe.vae_scale_factor)
        if preview_latents.ndim != 4 or not hasattr(pipe, "vae"):
            return False
        scaling = float(getattr(pipe.vae.config, "scaling_factor", 1.0) or 1.0)
        shift = getattr(pipe.vae.config, "shift_factor", None)
        preview_latents = preview_latents / scaling
        if shift is not None:
            preview_latents = preview_latents + float(shift)
        with torch.inference_mode():
            decoded = pipe.vae.decode(preview_latents, return_dict=False)[0]
            image = pipe.image_processor.postprocess(decoded, output_type="pil")[0]
        image.thumbnail((384, 384), Image.Resampling.LANCZOS)
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, format="JPEG", quality=82, optimize=True)
        return True
    except Exception:
        return False
