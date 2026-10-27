const assert=require('node:assert/strict'),s=require('../app/prompt-store');
const baseline=require('./fixtures/catalog-lossless-baseline.json'),c=s.readCatalog();
for(const [key,value] of Object.entries(baseline.featurePresets))assert.deepEqual(c.featurePresets[key],value,key);
for(const [key,value] of Object.entries(baseline.components))assert.equal(c.promptQuality?.baseline?.components?.[key]??c.components[key],value,key);
const makeup=require('../app/catalog-values').live('featurePresets','makeup.styles');assert(Object.hasOwn(makeup,'natural'));assert.deepEqual(Object.keys(makeup),Object.keys(baseline.featurePresets['makeup.styles']));
const fs=require('fs'),path=require('path');
for(const name of ['benchmark-new-image.py','benchmark-object-removal.py','smoke-object-removal.py','verify-quality-live.py'])assert(fs.readFileSync(path.join(__dirname,'../scripts',name),'utf8').includes('prompt-benchmarks.json'));
assert(!fs.existsSync(path.join(__dirname,'../app/makeup-styles.json')));
console.log('OK: original action/hand/skin/makeup/framing/enhancement/IDM values preserved; benchmark data separated.');
