const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = require('./helpers/web-html')();
const css = fs.readFileSync(path.join(root, 'apps/web/styles/components/toggles.css'), 'utf8');

assert.match(html, /styles\/components\/toggles\.css/);
assert.match(css, /input\[type="checkbox"\].*:checked/);
assert.match(css, /label:has\(> input\[type="checkbox"\]:checked\)/);
assert.match(css, /\.library-select/);
assert.match(css, /prefers-reduced-motion/);

console.log('toggle design tests passed');
