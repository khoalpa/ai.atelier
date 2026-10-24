const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require('path').join(__dirname,'../app/public/prompt-catalog.js'),'utf8');
async function scenario(fail){
  const catalog=structuredClone(require('../app/prompt-store').readCatalog()),storage=new Map([['atelier.promptLibrary.v1',JSON.stringify(catalog.library)],['atelier.accessoryPresetPrompts.v1',JSON.stringify({hat:'Legacy hat'})]]);
  const fields={inpaintNegativePrompt:{value:''}},messages=[];let load,request,updated=false;
  const window={ATELIER_PROMPTS:catalog,addEventListener:(_,fn)=>load=fn,setMessage:value=>messages.push(value),applyManagedPromptDefaults:()=>{updated=true;}};
  const context={window,document:{getElementById:id=>fields[id]},localStorage:{getItem:key=>storage.get(key)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:{randomUUID:()=> 'test-browser-id'},fetch:async(_,options)=>{request=JSON.parse(options.body);return {ok:!fail,json:async()=>fail?{ok:false,error:'Offline'}:{ok:true,catalog}};}};
  vm.runInNewContext(source,context);
  assert.equal(fields.inpaintNegativePrompt.value,catalog.ui.inpaintNegativePrompt);
  assert.equal(window.AtelierPromptCatalog.template('assistContext.image',{value:'Test'}),'Mô tả ảnh: Test');
  assert.throws(()=>window.AtelierPromptCatalog.template('assistContext.image',{}));
  load();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(request.action,'migrate');assert.equal(request.presets.hat,'Legacy hat');
  if(fail){assert(storage.has('atelier.promptLibrary.v1'));assert(storage.has('atelier.accessoryPresetPrompts.v1'));assert(messages[0].includes('Offline'));assert(!updated);}
  else{assert(!storage.has('atelier.promptLibrary.v1'));assert(!storage.has('atelier.accessoryPresetPrompts.v1'));assert(updated);}
}
(async()=>{await scenario(false);await scenario(true);console.log('OK: browser defaults, context templates, confirmed migration and preservation on save failure.');})().catch(error=>{console.error(error);process.exitCode=1;});
