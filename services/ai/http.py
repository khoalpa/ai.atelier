"""AI Atelier: http."""
from functools import wraps
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from local_request_security import trusted_request
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import json
import os
import shutil
import torch
from services.ai.imaging.mask_workflows import auto_mask
from services.ai.imaging.references import normalize_reference, preprocess_garment, validate_product_reference
from services.ai.imaging.segmentation import analyze_people, detect_regions, segment_object_mask
from services.ai.models.pipelines import birefnet_mask, chroma_status, configure_loras, detect_inpaint_architecture, inpaint_model_entry, lora_status, release_inpaint, release_text_to_image, release_tryon, runtime_model_status, tryon_model_files
from services.ai.runtime.configuration import APP_VERSION, INPAINT_MODEL, MODEL_VARIANT, PORT, POSE_MODEL, ROOT, SERVICE_STARTED_AT, SOURCE_REVISION, device, inference_lock, service_lifecycle
from services.ai.runtime.factory import execution_journal, task_context
from services.ai.runtime.jobs import job_health, job_lock, jobs, update_job
from services.ai.tasks.benchmarks import benchmark, catvton_color_audit, catvton_dedicated_mask_matrix, catvton_geometry_audit, catvton_reference_matrix, catvton_retry_matrix, effective_step_matrix, hybrid_tryon_compare, lora_ab_matrix, lora_ab_test, lora_strength_matrix, qualify_product_reference, regression_audit, structural_refine_matrix, texture_recovery_matrix
from services.ai.tasks.dispatch import resume_job
from services.ai.tasks.generate import chroma_generate, chroma_smoke, new_image_plan, sd35_conditioned_generate, sdxl_conditioned_generate
from services.ai.tasks.inpaint import adetailer_refine, inpaint, resolve_inpaint_prompts, resolved_inpaint_profile
from services.ai.tasks.outpaint import outpaint
from services.ai.tasks.tryon import batch_tryon, tryon


def serialized_inference(function):
    @wraps(function)
    def wrapped(self):
        # Control requests must remain responsive while inference holds the lock.
        if self.path in ("/prepare-restart", "/cancel-restart", "/cancel-job", "/job-status", "/inpaint-prompts", "/new-image-plan"):
            return function(self)
        try:
            with service_lifecycle.request():
                with inference_lock:
                    return function(self)
        except RuntimeError as error:
            return self.reply(503, {"ok": False, "error": str(error)})
    return wrapped


class Handler(BaseHTTPRequestHandler):
    def reply(self, status: int, payload: dict):
        if getattr(self, '_generation_job', ''):
            execution_journal().publish(self._generation_job, status, payload)
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # The durable result was published above; losing the HTTP client
            # must never turn a completed generation into a failed job.
            return

    def do_GET(self):
        if self.path == "/health":
            missing_tryon = [str(path.relative_to(ROOT)) for path in tryon_model_files() if not path.is_file()]
            return self.reply(200, {
                "ok": True,
                "revision": SOURCE_REVISION,
                "outpaintVersion": 2,
                "newImageVersion": 2,
                "enhanceVersion": 1,
                "characterVersion": 1,
                "manualCutoutVersion": 1, "version": APP_VERSION, "lifecycleVersion": 1, **service_lifecycle.status(),
                "character": __import__("character").configuration(ROOT),
                "makeupVersion": 1,
                "makeup": __import__("makeup").configuration(ROOT),
                "enhancement": __import__("image_enhancement").configuration(ROOT),
                "startedAt": SERVICE_STARTED_AT,
                "pid": os.getpid(),
                "device": device,
                "variant": MODEL_VARIANT,
                "inpaintModel": str(INPAINT_MODEL),
                "inpaintAvailable": INPAINT_MODEL.exists(),
                "tryonAvailable": not missing_tryon,
                "tryonMissing": missing_tryon,
                "poseAvailable": POSE_MODEL.is_file(),
                "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
                "gpuMemoryMb": round(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)) if torch.cuda.is_available() else 0,
                "diskFreeGb": round(shutil.disk_usage(ROOT).free / (1024 ** 3), 2),
                "modelsReady": INPAINT_MODEL.exists() and not missing_tryon and POSE_MODEL.is_file(),
            })
        if urlsplit(self.path).path == "/lora-status":
            try:
                return self.reply(200, lora_status(parse_qs(urlsplit(self.path).query).get("modelId", [None])[0]))
            except Exception as error:
                return self.reply(400, {"ok": False, "error": str(error)})
        if self.path == "/chroma-status":
            return self.reply(200, chroma_status())
        if self.path == "/runtime-model-status":
            return self.reply(200, runtime_model_status())
        self.reply(404, {"ok": False, "error": "Không tìm thấy endpoint"})

    @trusted_request(PORT)
    @serialized_inference
    def do_POST(self):
        if self.path not in ("/prepare-restart", "/cancel-restart", "/manual-cutout", "/character-regenerate", "/character-analyze", "/character-preview", "/character-render", "/makeup-compare", "/makeup-reference", "/makeup", "/makeup-analyze", "/enhance", "/new-image-plan", "/sd35-conditioned-generate", "/outpaint", "/inpaint-prompts", "/segment", "/analyze-people", "/auto-mask", "/preprocess-garment", "/validate-product-reference", "/qualify-product-reference", "/normalize-garment-reference", "/catvton-reference-matrix", "/catvton-dedicated-mask-matrix", "/catvton-retry-matrix", "/catvton-color-audit", "/catvton-geometry-audit", "/chroma-smoke", "/chroma-generate", "/inpaint", "/tryon", "/batch-tryon", "/regression-audit", "/cancel-job", "/job-status", "/resume-job", "/benchmark", "/lora-configure", "/lora-ab-test", "/lora-ab-matrix", "/lora-strength-matrix", "/texture-recovery-matrix", "/structural-refine-matrix", "/effective-step-matrix", "/hybrid-tryon-compare", "/detect-regions", "/adetailer-refine", "/sdxl-conditioned-generate"):
            return self.reply(404, {"ok": False, "error": "Không tìm thấy endpoint"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            max_payload = 30 * 1024 * 1024 if self.path in ("/inpaint", "/resume-job", "/tryon", "/batch-tryon", "/preprocess-garment", "/validate-product-reference", "/benchmark", "/lora-ab-test", "/lora-ab-matrix", "/lora-strength-matrix") else 2 * 1024 * 1024
            if self.path in ("/character-preview", "/character-render", "/makeup-compare", "/makeup", "/enhance", "/segment", "/auto-mask", "/inpaint-prompts"):
                max_payload = 30 * 1024 * 1024
            if length > max_payload:
                raise ValueError("Payload quá lớn")
            body = json.loads(self.rfile.read(length) or b"{}")
            self._generation_job = ''
            if self.path in execution_journal().routes:
                recovered = execution_journal().begin(self.path, body)
                if recovered is not None:
                    return self.reply(200, recovered)
                self._generation_job = str(body.get('jobId') or '')
            elif self.path == '/resume-job':
                self._generation_job = str(body.get('jobId') or '')
            if self.path in ("/prepare-restart", "/cancel-restart"):
                if body.get("confirm") is not True:
                    return self.reply(400, {"ok": False, "error": "Thiếu xác nhận."})
                try:
                    return self.reply(200, service_lifecycle.prepare() if self.path == "/prepare-restart" else service_lifecycle.cancel(body.get("token")))
                except RuntimeError as error:
                    return self.reply(409, {"ok": False, "error": str(error)})
            if self.path == "/manual-cutout":
                from background_edit import cutout
                release_inpaint()
                release_tryon()
                release_text_to_image()
                return self.reply(200, cutout(body, ROOT, birefnet_mask))
            if self.path == "/new-image-plan":
                return self.reply(200, new_image_plan(body))
            if self.path == "/inpaint-prompts":
                entry = inpaint_model_entry(str(body.get('modelId') or '') or None)
                path = Path(entry['path']) if entry else INPAINT_MODEL
                if not path.is_absolute():
                    path = ROOT / path
                architecture = detect_inpaint_architecture(path, entry.get('architecture') if entry else None)
                resolved = resolve_inpaint_prompts(body, architecture, resolved_inpaint_profile(entry, architecture))
                from prompt_limits import preview_encoder_prompts
                try:
                    resolved['encoders'] = preview_encoder_prompts(path, architecture, resolved['prompt'], resolved['negativePrompt'], str(body.get('fillMode') or 'background'))
                except Exception:
                    resolved['encoders'] = []
                    resolved['tokenError'] = 'Không thể đọc tokenizer của model. Chưa xác định được số token.'
                return self.reply(200, {"ok": True, **resolved})
            if self.path == "/cancel-job":
                job_id = str(body.get("jobId", ""))[:80]
                if not job_id:
                    raise ValueError("Thiếu mã tác vụ")
                with job_lock:
                    previous = dict(jobs.get(job_id, {}))
                terminal = previous.get("status") in ("completed", "cancelled", "failed")
                if terminal:
                    return self.reply(200, {"ok": True, "jobId": job_id, "status": previous.get("status"), "alreadyFinished": True})
                # A request can arrive before the worker has initialized its state.
                # Keep a cancellation tombstone so startup cannot erase the request.
                status = "cancelling" if previous.get("status") == "running" else "cancelled"
                update_job(job_id, cancelRequested=True, status=status, stage="cancelled" if status == "cancelled" else previous.get("stage", "preparing"),
                           _event={"type":"job.cancel.requested", "message":"Đã nhận yêu cầu hủy an toàn"})
                return self.reply(200, {"ok": True, "jobId": job_id, "status": status})
            if self.path == "/job-status":
                job_id = str(body.get("jobId", ""))[:80]
                with job_lock:
                    state = dict(jobs.get(job_id, {"status": "unknown"}))
                return self.reply(200, {"ok": True, "jobId": job_id, **state, **job_health(state)})
            if self.path == "/resume-job":
                return self.reply(200, resume_job(body))
            if self.path == "/benchmark":
                return self.reply(200, benchmark(body))
            if self.path == "/chroma-smoke":
                return self.reply(200, chroma_smoke(body))
            if self.path == "/chroma-generate":
                return self.reply(200, chroma_generate(body))
            if self.path == "/detect-regions":
                return self.reply(200, detect_regions(body))
            if self.path == "/adetailer-refine":
                return self.reply(200, adetailer_refine(body))
            if self.path == "/sd35-conditioned-generate":
                return self.reply(200, sd35_conditioned_generate(body))
            if self.path == "/sdxl-conditioned-generate":
                return self.reply(200, sdxl_conditioned_generate(body))
            if self.path == "/lora-configure":
                return self.reply(200, configure_loras(body))
            if self.path == "/lora-ab-test":
                return self.reply(200, lora_ab_test(body))
            if self.path == "/lora-ab-matrix":
                return self.reply(200, lora_ab_matrix(body))
            if self.path == "/lora-strength-matrix":
                return self.reply(200, lora_strength_matrix(body))
            if self.path == "/texture-recovery-matrix":
                return self.reply(200, texture_recovery_matrix(body))
            if self.path == "/structural-refine-matrix":
                return self.reply(200, structural_refine_matrix(body))
            if self.path == "/effective-step-matrix":
                return self.reply(200, effective_step_matrix(body))
            if self.path == "/hybrid-tryon-compare":
                return self.reply(200, hybrid_tryon_compare(body))
            if self.path == "/normalize-garment-reference":
                return self.reply(200, normalize_reference(body))
            if self.path == "/validate-product-reference":
                return self.reply(200, validate_product_reference(body))
            if self.path == "/qualify-product-reference":
                return self.reply(200, qualify_product_reference(body))
            if self.path == "/catvton-reference-matrix":
                return self.reply(200, catvton_reference_matrix(body))
            if self.path == "/catvton-dedicated-mask-matrix":
                return self.reply(200, catvton_dedicated_mask_matrix(body))
            if self.path == "/catvton-retry-matrix":
                return self.reply(200, catvton_retry_matrix(body))
            if self.path == "/catvton-color-audit":
                return self.reply(200, catvton_color_audit(body))
            if self.path == "/catvton-geometry-audit":
                return self.reply(200, catvton_geometry_audit(body))
            if self.path == "/character-regenerate":
                from character_workflow import regenerate
                return self.reply(200, regenerate(body, task_context()))
            if self.path in ("/character-analyze", "/character-preview", "/character-render"):
                import character
                handler={"/character-analyze":character.analyze,"/character-preview":character.plan,"/character-render":character.run}[self.path]
                return self.reply(200, handler(body, task_context()))
            if self.path == "/makeup-compare":
                from makeup_comparison import run
                return self.reply(200, run(body, task_context()))
            if self.path == "/makeup-reference":
                from makeup_reference import analyze
                return self.reply(200, analyze(body, task_context()))
            if self.path == "/makeup-analyze":
                from makeup import analyze
                return self.reply(200, analyze(body, task_context()))
            if self.path == "/makeup":
                from makeup import run
                return self.reply(200, run(body, task_context()))
            if self.path == "/enhance":
                from image_enhancement import enhance
                return self.reply(200, enhance(body, task_context()))
            if self.path == "/outpaint":
                return self.reply(200, outpaint(body))
            if self.path == "/inpaint":
                return self.reply(200, inpaint(body))
            if self.path == "/tryon":
                return self.reply(200, tryon(body))
            if self.path == "/batch-tryon":
                return self.reply(200, batch_tryon(body))
            if self.path == "/auto-mask":
                return self.reply(200, auto_mask(body))
            if self.path == "/analyze-people":
                return self.reply(200, analyze_people(body))
            if self.path == "/preprocess-garment":
                return self.reply(200, preprocess_garment(body))
            if self.path == "/regression-audit":
                return self.reply(200, regression_audit(body))
            self.reply(200, segment_object_mask(body))
        except Exception as error:
            failed_job_id = getattr(self, '_generation_job', '')
            if failed_job_id and self.path not in ("/job-status", "/cancel-job"):
                update_job(failed_job_id, status="cancelled" if "hủy" in str(error).lower() else "failed", stage="cancelled" if "hủy" in str(error).lower() else "failed", error=str(error), _event={"type":"job.failed", "message":str(error)})
            self.reply(400, {"ok": False, "error": str(error)})

    def log_message(self, fmt, *args):
        print(f"[SAM2] {self.address_string()} - {fmt % args}")
