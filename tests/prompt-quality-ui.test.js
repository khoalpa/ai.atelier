const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),catalog=require('../app/prompt-store').readCatalog(),nodes=new Map();
function node(id){if(!nodes.has(id))nodes.set(id,{value:'',checked:false,textContent:'',innerHTML:'',disabled:false,addEventListener(){},dispatchEvent(){}});return nodes.get(id);}
node('textToImageModel').value='sdxl-base-1.0';
const context={window:{ATELIER_PROMPTS:catalog},document:{getElementById:node},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},setTimeout:()=>1,clearTimeout(){},AtelierApp:{escapeHtml:String},Event:class{}};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'packages/prompting/compiler.js'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(root,'apps/web/features/prompt-builder.js'),'utf8'),context);
assert(node('promptBuilderApply').disabled);
node('textToImageModel').value='flux-chroma1-hd';node('promptBlock-subject').value='One blue shirt';context.window.PromptBuilder.refresh();
assert(!node('promptBuilderApply').disabled);assert.equal(node('promptBuilderPreview').textContent,'One blue shirt');assert.equal(node('promptBuilderStatus').textContent,'');
node('promptBlock-composition').value='full-body close-up';context.window.PromptBuilder.refresh();assert(!node('promptBuilderConflicts').hidden);
node('textToImageModel').value='flux-2-klein-4b';node('chromaNegativePrompt').value='blur';context.window.PromptBuilder.refresh();assert(node('promptBuilderConflicts').innerHTML.includes('negative prompt'));
node('textToImageModel').value='flux-chroma1-hd';node('chromaNegativePrompt').value='my manually entered exclusions';node('promptLock-subject').checked=true;
node('promptBuilderPreset').onchange({target:{value:'product'}});assert.equal(node('chromaNegativePrompt').value,'my manually entered exclusions');assert.equal(node('promptBlock-subject').value,'One blue shirt');
node('chromaNegativePrompt').value='';node('promptBuilderPreset').onchange({target:{value:'product'}});assert.equal(node('chromaNegativePrompt').value,catalog.featurePresets['promptBuilder.negativePresets'].product);
node('promptBuilderPreset').value='product';node('promptBuilderPresetVersion').value='quality-v1';node('promptBuilderPresetVersion').onchange();assert.equal(node('promptBlock-style').value,catalog.promptQuality.baseline.featurePresets['promptBuilder.presets'].product.style);
node('promptBuilderPresetVersion').value='quality-v2';node('promptBuilderPresetVersion').onchange();assert.equal(node('promptBlock-style').value,catalog.featurePresets['promptBuilder.presets'].product.style);assert.equal(node('promptBlock-subject').value,'One blue shirt');
console.log('OK: model-loading race, restored preview, conflicts and unsupported negative prompt feedback.');
