'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
function readVersion(root) { return JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version; }
function webRevision(root) {
  const hash = crypto.createHash('sha256');
  function walk(dir) { for (const entry of fs.readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(js|html|css|json)$/.test(entry.name)) hash.update(path.relative(root,file)).update(fs.readFileSync(file));
  } }
  hash.update(fs.readFileSync(path.join(root,'version.json'))); walk(path.join(root,'app')); return hash.digest('hex');
}
function aiRevision(root) { const hash=crypto.createHash('sha256');for(const name of JSON.parse(fs.readFileSync(path.join(root,'version.json'),'utf8')).aiSources||[]) {const file=path.join(root,name);if(fs.existsSync(file))hash.update(fs.readFileSync(file));}return hash.digest('hex'); }
module.exports = {readVersion, webRevision, aiRevision};
