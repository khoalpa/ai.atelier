const fs=require('fs'),vm=require('vm'),assert=require('assert');
const controls={tryonDescriptionModel:{value:'flux'},tryonDescriptionNegative:{},descriptionNegativeHint:{}};
for(const id of ['descriptionSteps','descriptionGuidance','descriptionStrength','descriptionResolution'])controls[id]={value:''};
const context={$:id=>controls[id],window:{ATELIER_INPAINT_MODELS:[
  {id:'flux',architecture:'flux',removalProfile:{steps:40,guidance:30,strength:1,nativeResolution:1024,supportsNegativePrompt:false}},
  {id:'sdxl',architecture:'sdxl',removalProfile:{steps:35,guidance:6,strength:.95,nativeResolution:1024,supportsNegativePrompt:true}}
]}};
vm.createContext(context);vm.runInContext(require('./helpers/source').read('app/public/outfit-workflow.js','utf8'),context);
context.applyDescriptionModelSettings();
assert.equal(context.descriptionRunSettings().guidance,30);
assert.equal(context.descriptionRunSettings().maxSide,1024);
assert.equal(controls.tryonDescriptionNegative.disabled,true);
controls.descriptionGuidance.value='33';context.applyDescriptionModelSettings();
assert.equal(context.descriptionRunSettings().guidance,33,'Refresh must preserve manual settings');
context.applyDescriptionQualityPreset('fast');assert.equal(context.descriptionRunSettings().steps,24);
assert.equal(context.descriptionRunSettings().guidance,33);
controls.tryonDescriptionModel.value='sdxl';context.applyDescriptionModelSettings();
assert.equal(context.descriptionRunSettings().guidance,6);
assert.equal(controls.tryonDescriptionNegative.disabled,false);
context.applyDescriptionQualityPreset('quality');assert.equal(context.descriptionRunSettings().steps,35);
console.log('OK: outfit description uses per-model guidance, negative support and quality presets without losing manual settings.');
