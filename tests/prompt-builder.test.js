'use strict';
const assert=require('node:assert'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=require('./helpers/web-html')();
const source=fs.readFileSync(path.join(root,'apps/web/features/prompt-builder.js'),'utf8');
new (require('node:vm').Script)(source);
const catalog=JSON.parse(fs.readFileSync(path.join(root,'workspace/prompts.json'),'utf8'));
const reference=require('../app/prompt-store').renderTemplate(catalog.templates['promptBuilder.references'],{roles:'1=subject, 2=style',referenceMode:'strict'});
assert(reference.includes('Reference roles: 1=subject, 2=style. Reference mode: strict.'));
assert(reference.endsWith('unless explicit in the image.'));
assert.match(html,/id="promptBuilder"/);
assert.match(html,/<script src="\/prompt-builder\.js"><\/script>/);
for(const key of ['subject','environment','action','composition','style','lighting','color','materials','constraints']){
  assert.match(html,new RegExp(`id="promptBlock-${key}"`));
  assert.match(html,new RegExp(`id="promptLock-${key}"`));
}
assert.match(source,/imageData/);assert.match(source,/Tạo 3 biến thể|variants/);
assert.match(source,/atelier\.prompt-builder\.v2/);assert.match(source,/function conflicts/);assert.match(source,/function adapter/);assert.match(source,/applyComponents/);
assert.match(source,/evaluateResult/);assert.match(source,/improveFromAssessment/);assert.match(JSON.parse(fs.readFileSync(path.join(root,'workspace/prompts.json'),'utf8')).templates['promptBuilder.references'],/Reference roles/);
assert.match(source,/promptComponents:values/);
assert.match(fs.readFileSync(path.join(root,'apps/local-api/services/prompts.js'),'utf8'),/body\.imageData/);
assert.match(fs.readFileSync(path.join(root,'apps/local-api/services/prompts.js'),'utf8'),/componentKeys/);
assert.match(source,/structured:true/);
assert.match(fs.readFileSync(path.join(root,'apps/web/features/new-image.js'),'utf8'),/data-new-evaluate/);
console.log('prompt builder tests passed');
