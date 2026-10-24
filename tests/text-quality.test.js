const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../app/public/app.js'),'utf8');
const body=source.slice(source.indexOf('let textQuality='),source.indexOf('async function runChromaGenerate('));
const controls={textToImageModel:{value:'flux-chroma1-hd',selectedOptions:[{textContent:'Chroma'}]},chromaSize:{},chromaQuality:{},textToImagePresetHint:{}};
const buttons=['fast','balanced','quality'].map(name=>({dataset:{textQuality:name},classList:{toggle(){}},setAttribute(){}}));
const context={window:{ATELIER_PROMPTS:require('../app/prompt-store').readCatalog()},$:id=>controls[id],document:{querySelectorAll:()=>buttons},updateTextToImageAvailability(){}};
vm.createContext(context);vm.runInContext(body,context);
assert.equal(vm.runInContext('textQuality',context),'balanced','New sessions start with a balanced draft preset');
for(const [name,steps] of [['fast',12],['balanced',28],['quality',40]]){context.applyTextToImagePreset(name);assert.equal(controls.textToImageModel.value,'flux-chroma1-hd');assert.equal(controls.chromaQuality.value,String(steps));}
controls.textToImageModel.value='sdxl-base-1.0';context.applyTextToImagePreset('quality');assert.equal(controls.chromaQuality.value,'40');assert.equal(controls.textToImageModel.value,'sdxl-base-1.0');
assert.equal(controls.chromaSize.value,'1024');
controls.chromaNegativePrompt={disabled:false};
controls.textToImageModel.value='flux-2-klein-4b';
for(const name of ['fast','balanced','quality']){context.applyTextToImagePreset(name);assert.equal(controls.chromaQuality.value,'4');assert.equal(controls.chromaNegativePrompt.disabled,true);}
controls.textToImageModel.value='sdxl-base-1.0';context.applyTextToImagePreset('balanced');assert.equal(controls.chromaNegativePrompt.disabled,false);
assert(!source.includes("$('textToImagePreset')"));
console.log('OK: quality changes preserve model and use model-specific step counts.');
