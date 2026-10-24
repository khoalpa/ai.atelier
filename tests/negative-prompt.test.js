const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Load the pure prompt helpers without starting the HTTP server or the LLM.
const source = fs.readFileSync(path.join(__dirname, '../app/server.js'), 'utf8');
const helpers = source.slice(source.indexOf('function assistantFallback('), source.indexOf('function requestLocalLlm('));
const context = vm.createContext({});
vm.runInContext(helpers, context);
const normalize = context.normalizeNegativePrompt;

assert.equal(normalize('blurry, extra limbs'), 'blurry, extra limbs');
assert.equal(normalize('text, logo, watermark'), 'text, logo, watermark');
assert.equal(normalize('blurry, blurry, BLURRY; extra limbs\nnone'), 'blurry, extra limbs');
assert.equal(normalize(''), '');
const detailed = 'unwanted lettering that overlaps the central subject and makes the requested composition difficult to read';
assert.equal(normalize(detailed), detailed);
assert.equal(context.assistantFallback('optimizeNegativePrompt', 'blurry, extra limbs', 'a logo'), 'blurry, extra limbs');
assert.equal(context.assistantFallback('negativePrompt', '', 'a typographic logo with a watermark'), '');
for (const task of ['imagePrompt', 'optimizePrompt', 'shortenPrompt', 'expandPrompt']) {
  for (const idea of ['Soft blurry watercolor illustration, muted colors', 'Ảnh cố ý mờ trong ánh sáng tự nhiên', '']) {
    assert.equal(context.assistantFallback(task, idea), idea);
  }
}
console.log('OK: negative prompt constraints survive normalization; no automatic bans or fallback additions.');
