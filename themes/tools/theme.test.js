/* Behavioral tests for preference persistence, validation and system changes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../runtime/theme.js'), 'utf8');
function start(saved, blocked = false, dataset = {}) {
  let persisted = saved;
  const media = {matches:false, addEventListener(type, fn) { this.changed = fn; }};
  const document = {documentElement:{dataset:{...dataset}}, readyState:'loading', addEventListener() {}, dispatchEvent() {}};
  const window = {};
  vm.runInNewContext(source, {document, window, location:{pathname:'/'}, matchMedia:()=>media,
    localStorage:{getItem(){if(blocked) throw Error('blocked'); return persisted;}, setItem(k,v){if(blocked) throw Error('blocked'); persisted=v;}},
    CustomEvent:class {}});
  return {api:window.AIThemes, root:document.documentElement, media, saved:()=>persisted};
}
let app = start('{"theme":"paper","mode":"dark","style":"editorial","density":"compact"}');
assert.equal(app.root.dataset.theme, 'paper');
assert.equal(app.root.dataset.resolvedMode, 'dark');
app.api.set({theme:'atelier', mode:'light'});
assert.equal(JSON.parse(app.saved()).theme, 'atelier');
assert.equal(app.root.dataset.resolvedMode, 'light');
app.api.set({theme:'../../unsafe', mode:'invalid'});
assert.equal(app.root.dataset.theme, 'atelier');
assert.equal(app.root.dataset.mode, 'light');
app.api.set({mode:'system'});
app.media.matches = true; app.media.changed();
assert.equal(app.root.dataset.resolvedMode, 'dark');
app.api.reset();
assert.equal(app.root.dataset.theme, 'neutral');
assert.equal(app.root.dataset.density, 'comfortable');
for (const saved of ['not json', 'null', '{}']) {
  app = start(saved);
  assert.equal(app.root.dataset.theme, 'neutral');
}
app = start(null, true, {theme:'atelier', mode:'dark', density:'compact'});
app.api.set({theme:'paper'});
assert.equal(app.root.dataset.theme, 'paper');
console.log('PASS: stored preferences, invalid input, reset, system changes and blocked storage');
