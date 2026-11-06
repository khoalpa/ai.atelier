'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const failures = [];
function filesBelow(directory, extension) {
  const files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      if (entry.name === '__pycache__') continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith(extension)) files.push(target);
    }
  }
  visit(directory);
  return files;
}
const required = [
  'apps/web',
  'apps/local-api',
  'apps/local-api/domain',
  'apps/local-api/repositories',
  'apps/local-api/queue',
  'apps/local-api/infrastructure',
  'apps/local-api/middleware',
  'packages/contracts',
  'packages/editor-core',
  'packages/runtime',
  'packages/storage',
  'services/ai/features',
  'services/ai/prompting',
  'services/ai/quality',
];

for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) failures.push(`Missing architecture directory: ${relative}`);
}

if (fs.existsSync(path.join(root, 'apps', 'local-api', 'modules'))) {
  failures.push('Legacy apps/local-api/modules directory must not be recreated.');
}

for (const name of fs.readdirSync(root).filter(name => name.endsWith('.py') && name !== 'ai_service.py')) {
  failures.push(`Only ai_service.py may exist as a root Python module: ${name}`);
}

const legacyApp = path.join(root, 'app');
for (const entry of fs.readdirSync(legacyApp, {withFileTypes: true})) {
  if (!entry.isFile() || !entry.name.endsWith('.js') || entry.name === 'server.js') continue;
  failures.push(`Only app/server.js may exist directly in the legacy app root: app/${entry.name}`);
}

const legacyPythonModule = '(?:prompt_catalog|prompt_limits|encoder_policy|processing_mode_prompts|character(?:_[a-z_]+)?|makeup(?:_[a-z_]+)?|image_enhancement|object_removal|outpainting|outpaint_quality|new_image|quality_learning|quality_report|skin_[a-z_]+|tryon_[a-z_]+|catvton_inputs|idm_vton_runtime|vton_pilot|sample_catalog|catalog_preview|sd35_depth_control|service_lifecycle|local_request_security)';
const legacyPythonImport = new RegExp(`^\\s*(?:from|import)\\s+${legacyPythonModule}\\b`, 'm');
for (const file of filesBelow(path.join(root, 'services', 'ai'), '.py')) {
  if (legacyPythonImport.test(fs.readFileSync(file, 'utf8'))) {
    failures.push(`Canonical AI source imports a root compatibility module: ${path.relative(root, file)}`);
  }
}

for (const area of ['scripts', 'tests']) {
  for (const file of filesBelow(path.join(root, area), '.py')) {
    if (path.basename(file) === 'modular-runtime.test.py') continue;
    if (legacyPythonImport.test(fs.readFileSync(file, 'utf8'))) {
      failures.push(`Repository Python tooling imports a root compatibility module: ${path.relative(root, file)}`);
    }
  }
}

for (const file of filesBelow(path.join(root, 'apps', 'local-api'), '.js')) {
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes('requireFromApp') || source.includes("createRequire(require('node:path').resolve(__dirname,'../../../app/")) {
    failures.push(`Local API source depends on the legacy app module root: ${path.relative(root, file)}`);
  }
}

for (const area of ['apps', 'packages', 'scripts']) {
  for (const file of filesBelow(path.join(root, area), '.js')) {
    const source = fs.readFileSync(file, 'utf8');
    if (/require\(['"]\.\.\/app\/(?!public\/|server(?:\.js)?['"])/.test(source)) {
      failures.push(`Repository JavaScript tooling imports a legacy app wrapper: ${path.relative(root, file)}`);
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Repository layout verified.');
}
