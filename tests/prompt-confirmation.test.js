const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=require('./helpers/source').read('app/public/app.js','utf8');
const code=source.slice(source.indexOf('let inpaintPromptReviewPending='),source.indexOf('async function loadRuntimeModelStatus'));
class Element extends EventTarget{
  constructor(){super();this.value='';this.returnValue='';}
  setCustomValidity(value){this.validation=value;}
  reportValidity(){}
  focus(){}
  showModal(){this.open=true;}
  close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const calls=[],jobs=[];let previewFailure=false;
const context={Event,Promise,setTimeout,clearTimeout,$:get,studioResultInstructionsDirty:()=>false,current:{id:'sample'},sourceImage:{},editableMaskStats:()=>({selected:10,minimum:1}),activeJobId:'',binaryMaskDataUrl:()=> 'mask',seedForRun:()=>42,setMessage:()=>{},createJobId:()=> 'job',setActiveJob:id=>jobs.push(id),settleJob:async()=>{},fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return{ok:!previewFailure,json:async()=>url==='/api/inpaint-prompts'?{ok:!previewFailure,prompt:'assembled',negativePrompt:'avoid'}:{ok:false,error:'test stop'}};}};
vm.createContext(context);vm.runInContext(require('./helpers/source').read('app/public/outfit-workflow.js','utf8'),context);vm.runInContext(code,context);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  let result=context.runInpaint();await tick();
  assert(get('generationPromptDialog').open);assert.equal(jobs.length,0);assert.equal(calls.length,1);
  await context.runInpaint();assert.equal(calls.length,1,'Repeated clicks cannot open another review');
  get('cancelGenerationPrompt').dispatchEvent(new Event('click'));await result;
  assert.equal(calls.length,1);assert.equal(jobs.length,0);
  result=context.runInpaint();await tick();get('generationPrompt').value='   ';
  get('generationPromptForm').dispatchEvent(new Event('submit',{cancelable:true}));assert(get('generationPrompt').validation);assert.equal(jobs.length,0);
  get('resetGenerationPrompt').dispatchEvent(new Event('click'));assert.equal(get('generationPrompt').value,'assembled');
  get('generationPrompt').value=' user final ';get('generationNegativePrompt').value='';
  get('generationPromptForm').dispatchEvent(new Event('submit',{cancelable:true}));await result;
  assert.equal(calls.at(-1).url,'/api/inpaint');assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).body.confirmedPrompts)),{prompt:'user final',negativePrompt:''});assert.equal(jobs.length,1);
  result=context.runInpaint();await tick();get('generationPromptDialog').close();await result;assert.equal(jobs.length,1,'Escape/close must cancel even after a previous confirmation');
  previewFailure=true;await context.runInpaint();assert.equal(jobs.length,1,'Preview failure cannot start generation');
  console.log('OK: confirmation gate, edits, empty validation, reset, cancel, duplicate clicks, preview errors and request payload.');
})().catch(error=>{console.error(error);process.exitCode=1;});

