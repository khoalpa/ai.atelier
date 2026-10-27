const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'models/registry.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'models/inpaint-candidates.json'), 'utf8'));
const service = fs.readFileSync(path.join(root, 'apps/local-api/services/models.js'), 'utf8');
const id = 'depth-anything-v2-large';

for (const [source, collection] of [['registry', registry.models], ['catalog', catalog.candidates]]) {
  const model = collection.find((entry) => entry.id === id);
  assert.ok(model, `${id} must exist in ${source}`);
  assert.equal(model.architecture, 'depth-anything-v2');
  assert.equal(model.textEncoder, 'none');
  assert.equal(model.pipeline, 'DepthAnythingForDepthEstimation');
  assert.equal(model.precision, 'FP32');
  assert.equal(model.resolution, '518×518 nội bộ · xuất theo ảnh nguồn');
  assert.equal(model.recommendedVramGb, '2–4');
  assert.equal(model.formatLabel, 'Transformers Safetensors');
  assert.deepEqual(model.requiredFiles, ['config.json', 'preprocessor_config.json', 'model.safetensors']);
}

const installed = path.join(root, 'models/depth/depth-anything-v2-large');
for (const file of ['config.json', 'preprocessor_config.json', 'model.safetensors']) {
  assert.ok(fs.existsSync(path.join(installed, file)), `missing installed model file: ${file}`);
}
const config = JSON.parse(fs.readFileSync(path.join(installed, 'config.json'), 'utf8'));
assert.ok(config.architectures.includes('DepthAnythingForDepthEstimation'));
assert.equal(config.backbone_config.image_size, 518);
assert.match(service, /'depth-anything-v2-large':\{version:'V2 Large'/);

console.log('depth-anything-v2-large registration metadata is valid');
