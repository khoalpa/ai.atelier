"""Composition and lifecycle of the local GPU service."""
from http.server import ThreadingHTTPServer
from services.ai.http import Handler
from services.ai.runtime.jobs import load_persisted_jobs
from services.ai.runtime.configuration import HOST, PORT, device, MODEL_VARIANT, mark_model_config_applied

def main():
    print(f"AI Atelier: http://{HOST}:{PORT} · device={device} · variant={MODEL_VARIANT}")
    load_persisted_jobs()
    mark_model_config_applied()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
