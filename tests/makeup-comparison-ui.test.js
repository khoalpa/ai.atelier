const assert=require('assert'),fs=require('fs'),vm=require('vm');
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.style={};this.textContent='';this.clientWidth=200;this.clientHeight=260;this.scrollLeft=0;this.scrollTop=0;}
  append(...items){this.children.push(...items.filter(x=>typeof x!=='string'));}
  replaceChildren(...items){this.children=[];this.append(...items);}
  setAttribute(){} scrollIntoView(){} setPointerCapture(){}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.tag===selector?[child]:[]),...child.querySelectorAll(selector)]);}
  get offsetWidth(){return parseFloat(this.style.width)||0;}
  get offsetHeight(){return parseFloat(this.style.height)||0;}
}
const fields=Object.fromEntries([...require('./helpers/source').read('app/public/index.html','utf8').matchAll(/id="(makeupCompare[^"]+)"/g)].map(([,id])=>[id,new Element()]));
const catalog=require('../app/makeup-styles.json'),calls=[],restored=[],messages=[];
let setup,busy=false,active=false,ready=true,descriptionReady=true,current={style:'natural',styleName:'Màu tham chiếu',lip:'#b23b42',description:'Son đỏ'},resolveRun,lastRequest,lastState;
const context={Image:class extends Element {constructor(){super('img');}},setTimeout,
  document:{getElementById:id=>fields[id],createElement:tag=>new Element(tag),addEventListener:(_,fn)=>setup=fn},
  window:{addEventListener(){},Makeup:{catalog:()=>catalog,isLocked:()=>busy||active,comparisonReady:()=>ready,descriptionReady:()=>descriptionReady,
    settings:()=>current,comparisonSource:()=>({sampleId:'source',faceIndex:1,editableMask:'red',protectedDetailMask:'blue',sourceSha256:'sha'}),
    setExtensionBusy:value=>busy=value,editAgain:async item=>{restored.push(item);return true;},focus(){}}},
  outputUrl:x=>'/'+x,activateAppView(){},setStudioMode(){},inpaintPromptReviewPending:false,descriptionTryonRunning:false,
  setMessage:message=>messages.push(message),createJobId:()=>String(calls.length),setActiveJob:()=>active=true,settleJob:async()=>{active=false;},
  fetch:async(url,options)=>{
    const body=options?.body?JSON.parse(options.body):null;calls.push({url,body});
    if(url.endsWith('makeup-library'))return {ok:true,json:async()=>({styles:[{id:'mine',name:'Phong cách riêng',settings:{style:'classic'}}]})};
    if(url.endsWith('makeup-compare')){lastRequest=body;return new Promise(resolve=>resolveRun=value=>resolve({ok:true,json:async()=>value}));}
    if(url.endsWith('job-status'))return {ok:true,json:async()=>lastState};
    return {ok:true,json:async()=>({ok:true})};
  }};
vm.createContext(context);vm.runInContext(require('./helpers/source').read('app/public/makeup-compare.js','utf8'),context);
const ui=context.window.MakeupCompare;
const inputs=()=>fields.makeupCompareChoices.querySelectorAll('input');
function check(id,value){const input=inputs().find(x=>x.dataset.compareStyle===id);input.checked=value;input.onchange();}
function image(id,name){return {comparisonId:id,comparisonName:name,width:343,height:399,file:id+'.png',comparisonFile:'before.png',settings:{renderer:'color',intensity:'light',parts:['lips'],lip:'#b23b42',eyeshadow:'#a47e70',blush:'#ce8d87',brow:'#59443b'}};}
function batch(status,entries,results=[]){return {jobId:lastRequest.jobId,comparison:true,status,comparisonEntries:entries,results};}
(async()=>{
  setup();await new Promise(setImmediate);
  assert.equal(inputs().length,8);assert(!fields.makeupCompareStart.disabled);
  check('preset:classic',false);assert(fields.makeupCompareStart.disabled);
  check('preset:classic',true);check('preset:office',true);check('preset:peach',true);
  assert(inputs().filter(x=>!x.checked).every(x=>x.disabled));check('current',true);assert(!inputs().find(x=>x.dataset.compareStyle==='current').checked);
  check('preset:office',false);check('preset:peach',false);check('preset:classic',false);check('current',true);
  ready=false;ui.sync();assert(fields.makeupCompareStart.disabled);ready=true;
  descriptionReady=false;await fields.makeupCompareStart.onclick();assert(messages.at(-1).includes('Đọc mô tả'));assert(!lastRequest);
  descriptionReady=true;
  const run=fields.makeupCompareStart.onclick();assert(lastRequest);current.lip='#ffffff';
  assert.equal(lastRequest.comparisonStyles[1].settings.lip,'#b23b42');
  assert.equal(lastRequest.sampleId,'source');assert.equal(lastRequest.faceIndex,1);assert.equal(lastRequest.protectedDetailMask,'blue');
  assert(inputs().every(x=>x.disabled));assert(!fields.makeupCompareCancel.disabled);
  const first=image('preset:natural','Tự nhiên'),second=image('current','Màu tham chiếu');
  const entries=[{id:'preset:natural',name:'Tự nhiên',status:'completed',progress:100},{id:'current',name:'Màu tham chiếu',status:'running',progress:20}];
  ui.update(batch('running',entries,[first]));
  const firstCard=fields.makeupCompareGrid.children[0];assert(firstCard.querySelectorAll('button')[0].disabled);
  await fields.makeupCompareCancel.onclick();assert.equal(calls.at(-1).url,'/api/cancel-job');assert(fields.makeupCompareCancel.disabled);
  entries[1].status='cancelled';lastState=batch('cancelled',entries,[first]);resolveRun(lastState);await run;
  assert(!firstCard.querySelectorAll('button')[0].disabled);assert(fields.makeupCompareNotice.textContent.includes('1/2'));
  await firstCard.querySelectorAll('button')[0].onclick();assert.equal(restored[0],first);
  // History can restore successes beside an individual failure, then all results.
  ui.show(batch('completed',[entries[0],{...entries[1],status:'failed',error:'Model lỗi'}],[first]));
  assert(fields.makeupCompareGrid.children[1].children[1].textContent.includes('Model lỗi'));
  ui.show(batch('completed',entries.map(x=>({...x,status:'completed',progress:100})),[first,second]));
  fields.makeupCompareZoom.onchange({target:{value:'2'}});
  const viewports=fields.makeupCompareGrid.children.map(c=>c.children[3].children[0]);
  assert(viewports.every(v=>v.children[0].offsetWidth===686));
  viewports[0].scrollLeft=123;viewports[0].scrollTop=217;viewports[0].onscroll();
  assert.equal(viewports[1].scrollLeft,123);assert.equal(viewports[1].scrollTop,217);
  fields.makeupCompareOriginal.onchange({target:{checked:true}});
  assert(viewports.every(v=>!v.children[0].children[0].hidden&&v.children[0].children[1].hidden));
  console.log('PASS: 2–4 selection, availability, immutable settings, progress, cancellation, partial history, synchronized zoom/pan/original, choosing a result.');
})().catch(error=>{console.error(error);process.exitCode=1;});
