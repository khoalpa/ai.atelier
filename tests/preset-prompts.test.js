const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path'),os=require('os');
const {savePresetPrompt}=require('../app/preset-store');
const source=fs.readFileSync(path.join(__dirname,'../app/public/app.js'),'utf8');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-preset-'));
const file=path.join(temp,'prompts.json'),backups=path.join(temp,'backups');
fs.copyFileSync(require('../app/prompt-store').FILE,file);
const catalog=JSON.parse(fs.readFileSync(file,'utf8'));
const store=new Map(),controls={},fields={};
for(const id of ['inpaintPrompt','maskExpand','maskBlur','inpaintSteps','inpaintStrength','inpaintGuidance','cropPadding','inpaintResolution','inpaintFillMode','inpaintFillModeHint'])controls[id]={value:''};
for(const id of ['presetPromptName','presetPromptText','presetPromptStatus','presetPromptSave','presetPromptReset'])fields[id]={value:id==='presetPromptName'?'glasses':'',dataset:{},addEventListener(type,fn){this[type]=fn;}};
const context={localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)},$:id=>controls[id],document:{createElement:()=>({querySelector:selector=>fields[selector.slice(1)]})},window:{confirm:()=>true,ATELIER_PROMPTS:catalog},Proxy,fetch:async(url,request)=>{assert.equal(url,'/api/preset-prompt');try{const result=savePresetPrompt(JSON.parse(request.body),file);return {ok:true,json:async()=>result};}catch(error){return {ok:false,json:async()=>({ok:false,error:error.message})};}}};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const PRESETS='),source.indexOf('async function init()')),context);
vm.runInContext(source.slice(source.indexOf('const PRESET_PROMPTS_KEY='),source.indexOf('const DEFAULT_PROMPT_LIBRARY=')),context);
const names=Object.keys(vm.runInContext('EDITABLE_PRESET_LABELS',context));
const initial=Object.fromEntries(names.map(name=>[name,{prompt:context.readEditablePresetPrompt(name),steps:30}]));

(async()=>{
  const root={appendChild(){}};
  controls.inpaintFillMode.value='reconstruct_body';
  context.applyPreset('custom');
  assert.equal(controls.inpaintFillMode.value,'background','Custom objects must not inherit a previous replacement mode');
  assert(controls.inpaintFillMode.disabled);
  assert.equal(controls.inpaintPrompt.value,'');
  context.renderPresetPromptEditor(root);
  const prompt='Natural restoration, "quoted", apostrophe\'s\nVietnamese: khôi phục. ` ${notExecuted} </script>';
  fields.presetPromptText.value=prompt;
  await fields.presetPromptSave.click();
  assert(fs.readFileSync(file,'utf8').includes(JSON.stringify(prompt)));
  assert.equal(fs.readFileSync(path.join(__dirname,'../app/public/app.js'),'utf8'),source);
  context.applyPreset('glasses');assert.equal(controls.inpaintPrompt.value,prompt);
  assert.equal(store.get('atelier.accessoryPresetPrompts.v1'),undefined);
  await fields.presetPromptReset.click();assert.equal(fields.presetPromptText.value,catalog.defaults.presets.glasses);
  for(const name of names.filter(name=>['sleepwear','underwear','mannequin'].includes(name))){
    fields.presetPromptName.value=name;fields.presetPromptName.change();assert.equal(fields.presetPromptText.value,'');
    await fields.presetPromptSave.click();assert(fields.presetPromptStatus.textContent.includes('const PRESETS'));
    fields.presetPromptText.value='Featureless plastic display';await fields.presetPromptSave.click();
    context.applyPreset(name);assert.equal(controls.inpaintPrompt.value,'Featureless plastic display');
    await fields.presetPromptReset.click();assert.equal(fields.presetPromptText.value,'');
  }
  for(const name of names.filter(name=>!['sleepwear','underwear','mannequin'].includes(name))){
    fields.presetPromptName.value=name;fields.presetPromptName.change();
    const updated=`Saved ${name}: ${prompt}`;
    fields.presetPromptText.value=updated;await fields.presetPromptSave.click();
    assert.equal(fields.presetPromptText.value,updated);
    context.applyPreset(name);assert.equal(controls.inpaintPrompt.value,updated);
    fields.presetPromptName.value='mannequin';fields.presetPromptName.change();
    fields.presetPromptName.value=name;fields.presetPromptName.change();
    assert.equal(fields.presetPromptText.value,updated);
    const reloaded=JSON.parse(fs.readFileSync(file,'utf8')).presets;
    assert.equal(reloaded[name].prompt,updated);
    assert.equal(reloaded[name].steps,catalog.presets[name].steps);
    await fields.presetPromptReset.click();
    assert.equal(fields.presetPromptText.value,catalog.defaults.presets[name]);
    const restored=JSON.parse(fs.readFileSync(file,'utf8')).presets;
    assert.equal(restored[name].prompt,catalog.defaults.presets[name]);
  }
  const before=fs.readFileSync(file,'utf8');
  assert.throws(()=>savePresetPrompt({name:'unknown',prompt:'x'},file));
  assert.throws(()=>savePresetPrompt({name:'glasses',prompt:'x'.repeat(16001)},file));
  assert.equal(fs.readFileSync(file,'utf8'),before);
  context.fetch=async()=>{throw new Error('Connection unavailable');};
  fields.presetPromptText.value='Unsaved draft';await fields.presetPromptSave.click();assert.equal(fields.presetPromptText.value,'Unsaved draft');assert.equal(fields.presetPromptSave.disabled,false);
  assert(fields.presetPromptStatus.textContent.includes('Connection unavailable'));
  console.log('OK: JSON persistence, escaping, independent preset restore, UI application and save failure.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(temp,{recursive:true,force:true}));
