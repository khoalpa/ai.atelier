const assert=require('node:assert/strict'),{preview}=require('../app/catalog-inspector'),s=require('../app/prompt-store');
const c=s.readCatalog(),skin=preview(c,'skin.retouch');assert.equal(skin.prompt,c.components['skin.positive']);assert.equal(skin.negativePrompt,c.components['skin.negative']);assert.deepEqual(skin.missingVariables,[]);
const missing=preview(c,'makeup.render');assert.deepEqual(missing.missingVariables,['prompt']);
const makeup=preview(c,'makeup.render',{prompt:'natural makeup',preserve:'untrusted override'});assert.equal(makeup.prompt,'natural makeup'+c.components['makeup.preserve']);assert.equal(makeup.negativePrompt,c.components['makeup.negative']);
assert.throws(()=>preview(c,'missing'));assert.throws(()=>preview(c,'skin.retouch',{description:{bad:true}}));
const bad=structuredClone(c);bad.tasks['skin.retouch'].positive.components=['nonexistent'];assert.throws(()=>s.validate(bad));
const binding=structuredClone(c);binding.tasks['makeup.render'].positive.componentBindings.unknown='makeup.preserve';assert.throws(()=>s.validate(binding));
assert(makeup.usage.every(item=>typeof item.file==='string'&&item.line>0));
console.log('OK: positive/negative composition, required variables, trusted bindings, invalid references and usage.');
