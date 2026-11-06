'use strict';

const path = require('path');
const { python } = require('../../packages/runtime/paths');
const { readVersion, webRevision } = require('../../packages/runtime/version');

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
});

function createConfiguration(root, env = process.env) {
  const reviewDir = path.join(root, 'workspace', 'review');
  const host = '127.0.0.1';
  const port = Number(env.AI_IMAGE_PORT || 7860);

  return {
    ROOT: root,
    PUBLIC_DIR: path.join(root, 'app', 'public'),
    SAMPLES_DIR: path.join(root, 'samples'),
    UPLOADS_DIR: path.join(root, 'workspace', 'uploads'),
    MASKS_DIR: path.join(root, 'workspace', 'masks'),
    OUTPUTS_DIR: path.join(root, 'workspace', 'outputs'),
    REVIEW_DIR: reviewDir,
    REVIEW_STATE: path.join(reviewDir, 'review-state.json'),
    JOBS_DIR: path.join(root, 'workspace', 'jobs'),
    BACKUPS_DIR: path.join(root, 'workspace', 'backups'),
    RESET_ARCHIVE_DIR: path.join(root, 'workspace', 'reset-archive'),
    REFERENCES_DIR: path.join(root, 'workspace', 'references'),
    RETRY_COMPARISONS: path.join(reviewDir, 'retry-comparisons.json'),
    MODEL_REGISTRY: path.join(root, 'models', 'registry.json'),
    MODEL_CANDIDATES: path.join(root, 'models', 'inpaint-candidates.json'),
    EXTERNAL_MODEL_SOURCES: path.join(root, 'models', 'external-sources.json'),
    MODEL_DOWNLOADS: path.join(root, 'workspace', 'model-downloads'),
    MODEL_DOWNLOADER: path.join(root, 'scripts', 'download_model.py'),
    MODEL_DOWNLOAD_PYTHON: python(root),
    MODEL_HISTORY: path.join(root, 'workspace', 'model-registry-history'),
    CONFIG_FILE: path.join(root, 'workspace', 'config.json'),
    HOST: host,
    PORT: port,
    AI_PORT: Number(env.AI_SEGMENT_PORT || 7861),
    LLM_BASE_URL: String(env.ATELIER_LLM_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    LLM_MODEL: String(env.ATELIER_LLM_MODEL || 'llava:7b'),
    PROMPT_LLM_MODEL: String(env.ATELIER_PROMPT_LLM_MODEL || 'qwen3:4b'),
    MAKEUP_LLM_MODEL: String(env.ATELIER_MAKEUP_LLM_MODEL || 'qwen3:4b'),
    VERSION: readVersion(root),
    WEB_REVISION: webRevision(root),
    MIME,
    BACKGROUND_RENDERER_URL: `http://${host}:${port}`,
  };
}

module.exports = { createConfiguration, MIME };
