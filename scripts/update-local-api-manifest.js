'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const api = path.join(root, 'apps', 'local-api');
const output = path.join(api, 'source-manifest.json');
const sources = [];

function walk(directory) {
  for (const entry of fs.readdirSync(path.join(api, directory), {withFileTypes: true})) {
    const relative = path.posix.join(directory.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) walk(relative);
    else if (entry.isFile() && entry.name.endsWith('.js') && relative !== 'application.js') sources.push(relative);
  }
}

for (const entry of fs.readdirSync(api, {withFileTypes: true})) {
  if (entry.isDirectory()) walk(entry.name);
  else if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'application.js') sources.push(entry.name);
}

sources.sort((left, right) => left.localeCompare(right));
fs.writeFileSync(output, `${JSON.stringify(sources, null, 2)}\n`);
console.log(`Updated local API source manifest: ${sources.length} files.`);
