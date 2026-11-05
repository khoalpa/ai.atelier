'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const committed = path.join(root, 'app', 'public');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-atelier-web-'));
const generated = path.join(temporaryRoot, 'public');

function files(directory, base = directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? files(full, base) : [path.relative(base, full)];
  });
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

try {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-web.js')], {
    cwd: root,
    env: {...process.env, ATELIER_WEB_OUTPUT: generated},
    stdio: 'inherit',
  });
  const changed = files(generated).filter(relative => {
    const expected = path.join(committed, relative);
    return !fs.existsSync(expected) || digest(path.join(generated, relative)) !== digest(expected);
  });
  if (changed.length) {
    console.error('Generated web files are out of date:');
    for (const relative of changed) console.error(`- app/public/${relative.replaceAll('\\', '/')}`);
    process.exitCode = 1;
  } else {
    console.log('Generated web files match apps/web.');
  }
} finally {
  fs.rmSync(temporaryRoot, {recursive: true, force: true});
}
