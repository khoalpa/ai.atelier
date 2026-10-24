"""AI Atelier: runtime.jobs."""
from datetime import datetime, timezone
from pathlib import Path
from services.ai.runtime import metadata
import json
import os
import threading
from services.ai.runtime.configuration import JOBS_DIR


job_lock = threading.Lock()


jobs = {}


def update_job(job_id: str, **changes):
    if not job_id:
        return
    with job_lock:
        now = datetime.now(timezone.utc).isoformat()
        event = changes.pop("_event", None)
        result = changes.pop("_result", None)
        prompt_entry = changes.pop("_prompt", None)
        previous = jobs.get(job_id, {})
        state = {**previous, **changes, "updatedAt": now}
        if changes.get("status") == "running" and not state.get("startedAt"):
            state["startedAt"] = now
        events = list(previous.get("events", []))
        stage_changed = changes.get("stage") and changes.get("stage") != previous.get("stage")
        status_changed = changes.get("status") and changes.get("status") != previous.get("status")
        if event or stage_changed or status_changed:
            payload = event if isinstance(event, dict) else {}
            events.append({"sequence": int(previous.get("eventSequence", 0)) + 1, "timestamp": now, "type": payload.get("type", "stage.changed" if stage_changed else "status.changed"), "message": payload.get("message", str(changes.get("stage") or changes.get("status") or "Đã cập nhật")), **{key:value for key,value in payload.items() if key not in ("type", "message")}})
            state["eventSequence"] = events[-1]["sequence"]
        state["events"] = events[-100:]
        results = list(changes.get("results", previous.get("results", [])))
        if isinstance(result, dict):
            result_key = (result.get("sampleId"), result.get("seed"), result.get("file"))
            results = [item for item in results if (item.get("sampleId"), item.get("seed"), item.get("file")) != result_key]
            results.append({"timestamp": now, **result})
        state["results"] = results[-48:]
        state["promptHistory"] = list(previous.get("promptHistory", [])) + ([prompt_entry] if prompt_entry else [])
        jobs[job_id] = state
        JOBS_DIR.mkdir(parents=True, exist_ok=True)
        safe_id = "".join(character for character in job_id if character.isalnum() or character in "-_")
        if safe_id:
            target = JOBS_DIR / f"{safe_id}.json"
            metadata.write(target, {"jobId": job_id, **jobs[job_id]})


def load_persisted_jobs():
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    for path in metadata.files(JOBS_DIR):
        if path.name.endswith(".request.json") or path.name.endswith(".checkpoint.json"):
            continue
        try:
            state = metadata.read(path)
            job_id = str(state.pop("jobId"))
            if state.get("status") in ("running", "cancelling"):
                state.update(status="interrupted", resumable=bool(state.get("requestFile")), stage="restart-required")
            jobs[job_id] = state
            metadata.write(path, {"jobId": job_id, **state})
        except Exception:
            continue


def job_health(state: dict) -> dict:
    if state.get("status") not in ("running", "cancelling"):
        return {"stalled": False}
    try:
        updated = datetime.fromisoformat(str(state.get("updatedAt", "")).replace("Z", "+00:00"))
        stale_seconds = max(0, int((datetime.now(timezone.utc) - updated).total_seconds()))
    except (TypeError, ValueError):
        stale_seconds = 0
    threshold = max(120, int(os.environ.get("AI_JOB_STALL_SECONDS", "300")))
    return {"stalled": stale_seconds >= threshold, "staleSeconds": stale_seconds, "stallThresholdSeconds": threshold}


def persist_job_request(job_id: str, task_type: str, body: dict) -> Path | None:
    """Persist a local replay request so interrupted generation can be restarted safely."""
    safe_job_id = "".join(character for character in job_id if character.isalnum() or character in "-_")
    if not safe_job_id:
        return None
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    request_file = JOBS_DIR / f"{safe_job_id}.request.json"
    request = {**body, "jobId": job_id, "taskType": task_type}
    request.pop("resume", None)
    canonical_routes = {'character':'/character-render','makeup':'/makeup-compare' if request.get('comparisonStyles') else '/makeup','enhance':'/enhance','inpaint':'/inpaint','outpaint':'/outpaint','tryon':'/tryon','batch-tryon':'/batch-tryon','text-to-image':'/chroma-generate'}
    request['_route'] = canonical_routes.get(task_type, request.get('_route', ''))
    metadata.write(request_file, request)
    return request_file


def job_cancelled(job_id: str) -> bool:
    with job_lock:
        return bool(job_id and jobs.get(job_id, {}).get("cancelRequested"))


def ensure_job_active(job_id: str):
    if job_cancelled(job_id):
        update_job(job_id, status="cancelled")
        raise RuntimeError("Tác vụ đã được hủy tại điểm dừng an toàn")
