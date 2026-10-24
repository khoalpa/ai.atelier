const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const store=require('../app/prompt-store'),catalog=store.readCatalog();
const html=fs.readFileSync(path.join(__dirname,'../app/public/index.html'),'utf8');
assert(!/\bplaceholder=/.test(html));
const registry=JSON.parse(fs.readFileSync(path.join(__dirname,'../models/registry.json'),'utf8'));
assert(!registry.models.some(model=>Object.hasOwn(model,'removalProfile')));
assert(Object.keys(catalog.runtimePresets.modelInpaintProfiles).every(id=>registry.models.some(model=>model.id===id)));
for(const mutate of [c=>delete c.runtimePresets,c=>c.runtimePresets.textToImage.steps.klein.fast=0,c=>c.runtimePresets.tryonQuality.fast.twoStage='yes',c=>c.runtimePresets.inpaintQuality.garment.fast.strength=2,c=>c.runtimePresets.modelInpaintProfiles.bad={guidance:99},c=>c.outfitTypes.push(c.outfitTypes[0]),c=>c.uiPlaceholders.outpaintPrompt={},c=>delete c.outfitTypes]){
  const copy=structuredClone(catalog);mutate(copy);assert.throws(()=>store.validate(copy));
}
const fields=Object.fromEntries(Object.keys(catalog.uiPlaceholders).map(id=>[id,{}]));
const context={window:{ATELIER_PROMPTS:structuredClone(catalog),addEventListener(){}},document:{getElementById:id=>fields[id]}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/public/prompt-catalog.js'),'utf8'),context);
for(const [id,text] of Object.entries(catalog.uiPlaceholders))assert.equal(fields[id].placeholder,text);
context.window.ATELIER_PROMPTS.uiPlaceholders.outpaintPrompt='Imported "placeholder"';
context.window.AtelierPromptCatalog.applyPlaceholders();assert.equal(fields.outpaintPrompt.placeholder,'Imported "placeholder"');
const outfit=fs.readFileSync(path.join(__dirname,'../app/public/outfit-workflow.js'),'utf8');
vm.runInNewContext(outfit,context);assert.equal(context.outfitTypes().length,catalog.outfitTypes.length);
context.window.ATELIER_PROMPTS.outfitTypes=[{id:'custom',label:'New category'}];assert.equal(context.outfitTypes()[0].label,'New category');
console.log('OK: all placeholders hydrate from JSON, model profiles moved, new groups validate and outfit types read live configuration.');
