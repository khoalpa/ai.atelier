const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require('path').join(__dirname,'../app/public/app.js'),'utf8');
const controls=Object.fromEntries(['inpaintFillMode','inpaintFillModePrompt','saveInpaintFillModePrompt','inpaintFillModePromptStatus'].map(id=>[id,{value:'',addEventListener(event,handler){this[event]=handler;}}]));
controls.inpaintFillMode.value='base_layer';
let modes=[{id:'base_layer',prompt:'Base instructions'},{id:'background',prompt:'Background instructions'}];
const context={$:id=>controls[id],Map,fetch:async(url,options)=>{
  assert.equal(url,'/api/processing-modes');
  if(options){const body=JSON.parse(options.body);modes=modes.map(mode=>mode.id===body.id?{...mode,prompt:body.prompt}:mode);}
  return {ok:true,json:async()=>({ok:true,modes})};
}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('let studioResultModes='),source.indexOf('async function renderProcessingModeEditor')),context);
(async()=>{
  context.setupStudioResultInstructions();await context.loadStudioResultInstructions();
  assert.equal(controls.inpaintFillModePrompt.value,'Base instructions');
  controls.inpaintFillModePrompt.value='Edited base';controls.inpaintFillModePrompt.input();
  assert(context.studioResultInstructionsDirty());
  controls.inpaintFillMode.value='background';controls.inpaintFillMode.change();
  assert.equal(controls.inpaintFillModePrompt.value,'Background instructions');
  assert(!context.studioResultInstructionsDirty());
  controls.inpaintFillMode.value='base_layer';controls.inpaintFillMode.change();
  assert.equal(controls.inpaintFillModePrompt.value,'Edited base');
  await controls.saveInpaintFillModePrompt.click();
  assert.equal(modes[0].prompt,'Edited base');assert(!context.studioResultInstructionsDirty());
  modes=[{id:'base_layer',prompt:'Updated in Prompt'},{id:'background',prompt:'Background instructions'}];
  await context.loadStudioResultInstructions();
  assert.equal(controls.inpaintFillModePrompt.value,'Updated in Prompt');
  console.log('OK: Studio instructions load, retain drafts by result, save to shared API and refresh external changes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
