const fs=require('fs'),vm=require('vm'),assert=require('assert');
const script=require('./helpers/source').read('app/public/outfit-workflow.js','utf8');
function harness({batch=false,category='upper_body',auto=false,cancel=false}={}){
  const values={tryonInputMode:'description',garmentCategory:category,tryonDescription:'white linen shirt',tryonDescriptionNegative:'logos',tryonDescriptionModel:'sdxl',batchScope:'selected',personSelect:'0',tryonCount:'2',tryonSteps:'35'};
  const controls=Object.fromEntries(Object.entries(values).map(([id,value])=>[id,{value,disabled:false}]));
  controls.autoMaskToggle={checked:auto};controls.resultsGrid={replaceChildren(...cards){this.cards=cards;}};
  const calls=[],messages=[],settled=[];
  const context={Promise,Option:class{},current:{id:'a',url:'/a.png'},sourceImage:{},studioMode:'tryon',activeJobId:'',inpaintPromptReviewPending:false,images:[{id:'a',url:'/a.png'},{id:'b',url:'/b.png'}],$:id=>controls[id],editableMaskStats:()=>({selected:100,minimum:2}),binaryMaskDataUrl:(_,protect)=>protect?'protected':'manual-mask',seedForRun:()=>42,reviewGenerationPrompts:async preview=>cancel?null:{prompt:preview.prompt,negativePrompt:preview.negativePrompt},createJobId:()=>`job-${calls.length}`,setActiveJob:id=>{context.activeJobId=id;},settleJob:async(id,status)=>{context.activeJobId='';settled.push(status);},setMessage:(text,kind)=>messages.push({text,kind}),presentStudioResults(){},selectPrimary(){},currentRunDirectory:'',document:{createElement:tag=>({tag,dataset:{},append(){},appendChild(){}})},fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return{ok:true,json:async()=>url==='/api/inpaint-prompts'?{ok:true,prompt:'Replace clothing',negativePrompt:'logos'}:url==='/api/auto-mask'?{ok:true,accepted:true,mask:`auto-${body.sampleId}`,protectedMask:`protect-${body.sampleId}`}:{ok:true,directory:`run-${body.sampleId}`,results:[{image:`/${body.sampleId}-result.png`,seed:body.seed}]}};}};
  context.window={ATELIER_PROMPTS:require('../app/prompt-store').readCatalog()};
  vm.createContext(context);vm.runInContext(script,context);
  return {context,controls,calls,messages,settled,run:()=>context.runDescriptionTryon(batch)};
}
(async()=>{
  let h=harness();await h.run();
  let request=h.calls.find(c=>c.url==='/api/inpaint').body;
  assert.equal(request.editableMask,'manual-mask');assert.equal(request.protectedDetailMask,'protected');
  assert.equal(request.processingMode,'outfit-description');assert.equal(request.semanticCheck,false);assert.equal(request.confirmedPrompts.prompt,'Replace clothing');assert(!('garmentImage' in request));
  assert.equal(h.controls.resultsGrid.cards.length,2,'Source card and selectable result must both exist');
  h=harness({cancel:true});await h.run();assert.equal(h.calls.length,1,'Cancelling prompt confirmation must not generate');
  h=harness({batch:true});await h.run();const requests=h.calls.filter(c=>c.url==='/api/inpaint').map(c=>c.body);
  assert.equal(requests.length,2);assert.equal(requests[0].editableMask,'auto-a');assert.equal(requests[1].editableMask,'auto-b');assert.equal(requests[1].protectedDetailMask,'protect-b');assert.equal(requests[1].seed,142);
  h=harness({batch:true,category:'custom'});await h.run();assert.equal(h.calls.length,0);assert.equal(h.messages.at(-1).kind,'error');
  h=harness();h.controls.tryonDescription.value=' ';await h.run();assert.equal(h.calls.length,0);
  h=harness({batch:true});let original=h.context.fetch;
  h.context.fetch=async(url,options)=>url==='/api/inpaint'&&JSON.parse(options.body).sampleId==='b'?{ok:false,json:async()=>({error:'Model failure'})}:original(url,options);
  await h.run();assert.deepEqual(h.settled,['completed','failed']);assert.equal(h.controls.resultsGrid.cards.length,2,'Partial batch success must remain available');assert.equal(h.messages.at(-1).kind,'error');
  h=harness({batch:true});original=h.context.fetch;
  h.context.fetch=async(url,options)=>url==='/api/inpaint'?{ok:false,json:async()=>({error:'Tác vụ đã được hủy tại điểm dừng an toàn'})}:original(url,options);
  await h.run();assert.equal(h.settled.length,1,'Cancellation must stop the rest of the batch');
  h=harness({category:'glasses',auto:true});original=h.context.fetch;let detected;
  h.context.fetch=async(url,options)=>{if(url==='/api/detect-regions'){detected=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true,count:1,mask:'accessory-mask'})};}return original(url,options);};
  await h.run();assert.deepEqual(detected.classes,['glasses']);assert.equal(h.calls.find(c=>c.url==='/api/inpaint').body.editableMask,'accessory-mask');
  console.log('OK: description-only generation, protection, confirmation cancellation, independent batch masks/seeds, manual-only categories and empty descriptions.');
})().catch(error=>{console.error(error);process.exitCode=1;});
