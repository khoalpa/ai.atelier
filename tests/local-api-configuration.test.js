'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createConfiguration, MIME } = require('../apps/local-api/configuration');

const ROOT = path.resolve(__dirname, '..');

test('local API configuration derives paths and runtime settings in one place', () => {
  const configuration = createConfiguration(ROOT, {
    AI_IMAGE_PORT: '9000',
    AI_SEGMENT_PORT: '9001',
    ATELIER_LLM_URL: 'http://localhost:11434/',
    ATELIER_LLM_MODEL: 'vision-model',
    ATELIER_PROMPT_LLM_MODEL: 'prompt-model',
    ATELIER_MAKEUP_LLM_MODEL: 'makeup-model',
  });

  assert.equal(configuration.PORT, 9000);
  assert.equal(configuration.AI_PORT, 9001);
  assert.equal(configuration.LLM_BASE_URL, 'http://localhost:11434');
  assert.equal(configuration.LLM_MODEL, 'vision-model');
  assert.equal(configuration.PROMPT_LLM_MODEL, 'prompt-model');
  assert.equal(configuration.MAKEUP_LLM_MODEL, 'makeup-model');
  assert.equal(configuration.PUBLIC_DIR, path.join(ROOT, 'app', 'public'));
  assert.equal(configuration.REVIEW_STATE, path.join(ROOT, 'workspace', 'review', 'review-state.json'));
  assert.equal(configuration.BACKGROUND_RENDERER_URL, 'http://127.0.0.1:9000');
  assert.equal(configuration.MIME, MIME);
});

test('local API configuration keeps stable defaults without reading mutable globals', () => {
  const configuration = createConfiguration(ROOT, {});

  assert.equal(configuration.HOST, '127.0.0.1');
  assert.equal(configuration.PORT, 7860);
  assert.equal(configuration.AI_PORT, 7861);
  assert.equal(configuration.LLM_BASE_URL, 'http://127.0.0.1:11434');
});
