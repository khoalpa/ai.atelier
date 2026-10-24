const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=require('./helpers/source').read('app/public/app.js','utf8');
const code=source.slice(source.indexOf('async function createAutomaticMask('),source.indexOf('async function detectPeopleInImage('));
const controls={accessoryPreset:{value:'shirt'},garmentCategory:{value:'overall'},personSelect:{value:'0'},autoMaskButton:{},segmentButton:{}};
const requests=[],displayed=[];
let mutate=null;
const context={current:{id:'characters/c001.png'},studioMode:'inpaint',$:id=>controls[id],setMessage(){},binaryMaskDataUrl:()=>'',displayMask:(mask)=>displayed.push(mask),displayProtectedMask(){},segmentWithAi:async()=>requests.push('generic'),fetch:async(_,opts)=>{const body=JSON.parse(opts.body);requests.push(body);if(mutate)mutate();return {ok:true,json:async()=>({ok:true,category:body.category,mask:'mask',accepted:true,coverage:.1})}}};
context.window={ATELIER_PROMPTS:require('../app/prompt-store').readCatalog()};
vm.createContext(context);vm.runInContext(require('./helpers/source').read('app/public/outfit-workflow.js','utf8'),context);vm.runInContext(code,context);
(async()=>{
 for(const [region,category] of Object.entries({shirt:'upper_body',pants:'lower_body',outfit:'overall'})){
  controls.accessoryPreset.value=region;
  await context.createAutomaticMask('',[{x:100,y:900,label:1}]);
  assert.equal(requests.at(-1).category,category);
  assert.equal(requests.at(-1).inferCategoryFromPoints,false);
 }
 context.studioMode='tryon';controls.garmentCategory.value='upper_body';
 await context.createAutomaticMask();assert.equal(requests.at(-1).category,'upper_body');
 const before=displayed.length;mutate=()=>controls.garmentCategory.value='lower_body';
 await context.createAutomaticMask();assert.equal(displayed.length,before,'Ignore response when category changed while loading');
 console.log('OK: automatic mask uses the active task region, ignores hidden category and cross-region hints, rejects stale responses.');
 mutate=null;context.studioMode='inpaint';controls.accessoryPreset.value='outfit';controls.garmentCategory.value='overall';
 controls.labelSelect={value:'upper_body'};
 await context.createAutomaticMask();assert.equal(requests.at(-1).category,'upper_body','Visible region must beat hidden outfit preset');
 controls.labelSelect.value='lower_body';await context.createAutomaticMask();assert.equal(requests.at(-1).category,'lower_body');
 controls.labelSelect.value='full_body';await context.createAutomaticMask();assert.equal(requests.at(-1).category,'overall');
 console.log('OK: visible labelSelect overrides conflicting presets for upper/lower/full body.');
})().catch(e=>{console.error(e);process.exitCode=1});
