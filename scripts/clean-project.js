'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const removableDirectories = [
  '.pytest_cache',
  '__pycache__',
  'scripts/__pycache__',
  'services/ai/__pycache__',
  'services/ai/imaging/__pycache__',
  'services/ai/models/__pycache__',
  'services/ai/runtime/__pycache__',
  'services/ai/tasks/__pycache__',
  'tests/__pycache__',
  'tests/helpers/__pycache__',
  'themes/dist',
  'themes/tools/__pycache__',
];
const removableFiles = ['apps/local-api/ai.atelier.lnk'];

function insideProject(target) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

let removed = 0;
for (const relative of [...removableDirectories, ...removableFiles]) {
  const target = path.resolve(root, relative);
  if (!insideProject(target)) throw new Error(`Refusing to clean outside the project: ${target}`);
  if (!fs.existsSync(target)) continue;
  fs.rmSync(target, {recursive: true, force: true});
  removed += 1;
  console.log(`Removed ${relative}`);
}
console.log(removed ? `Cleaned ${removed} generated path(s).` : 'Project caches are already clean.');
