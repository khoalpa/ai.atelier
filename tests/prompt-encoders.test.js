const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app/public/app.js','utf8');
class Element extends EventTarget {
  constructor(){super();this.value='';this.innerHTML='';this.textContent='';}
  setCustomValidity(){} focus(){} showModal(){} close(){this.dispatchEvent(new Event('close'));}
}
const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
let lastRequest;
const encoders=[{name:'CLIP',kind:'clip',tokens:8,limit:77,prompt:'short <overview>',negativeTokens:null},{name:'T5',kind:'t5',tokens:90,limit:512,prompt:'complete prompt',negativeTokens:null}];
const context={Promise,setTimeout,clearTimeout,$:get,fetch:async(url,options)=>{lastRequest=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true,encoders:encoders.map(x=>({...x,tokens:x.tokens+1}))})};}};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('let inpaintPromptReviewPending='),source.indexOf('async function runInpaint()')),context);
(async()=>{
  const pending=context.reviewGenerationPrompts({prompt:'full',negativePrompt:'blur',encoders},{modelId:'flux',fillMode:'background'});
  let html=get('generationEncoderPrompts').innerHTML;
  assert(html.includes('encoder-clip'));assert(html.includes('encoder-t5'));assert(html.includes('90 / 512'));assert(html.includes('&lt;overview&gt;'));
  get('generationPrompt').value='edited';get('generationPrompt').dispatchEvent(new Event('input'));
  await new Promise(r=>setTimeout(r,400));
  assert.equal(lastRequest.modelId,'flux');assert.equal(lastRequest.confirmedPrompts.prompt,'edited');
  assert(get('generationEncoderPrompts').innerHTML.includes('91 / 512'));
  get('resetGenerationPrompt').dispatchEvent(new Event('click'));assert(get('generationEncoderPrompts').innerHTML.includes('90 / 512'));
  get('cancelGenerationPrompt').dispatchEvent(new Event('click'));await pending;
  console.log('OK: encoder colors, exact counts, escaping, live edits, selected model and reset.');
})().catch(e=>{console.error(e);process.exitCode=1;});
