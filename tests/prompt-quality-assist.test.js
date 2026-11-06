const assert=require('node:assert/strict'),catalog=require('../apps/local-api/domain/catalog/prompt-store').readCatalog();
let body,calls=0;
const api=require('../apps/local-api/services/prompts')({ROOT:require('node:path').resolve(__dirname,'..'),readCatalog:()=>catalog,renderTemplate:require('../apps/local-api/domain/catalog/prompt-store').renderTemplate,parseJson:async()=>body,send:(_res,status,text)=>({status,data:JSON.parse(text)}),LLM_MODEL:'vision-test',PROMPT_LLM_MODEL:'text-test',callAiJson:async()=>({withinLimits:true})});
let lastPayload;
api.requestLocalLlm=async(payload)=>{calls++;lastPayload=payload;return {message:{content:JSON.stringify({suggestion:'A changed subject',components:{subject:'Wrong identity',materials:'fine fabric'},warnings:[],changes:[]})}};};
(async()=>{
  body={task:'imagePrompt',structured:true,imageModelId:'flux-chroma1-hd',currentText:'a '.repeat(2500),context:'context '.repeat(600),lockedComponents:{subject:'One exact adult subject'}};
  let result=await api.promptAssist({},{});assert.equal(result.status,200);assert.equal(result.data.components.subject,body.lockedComponents.subject);assert(result.data.suggestion.includes(body.lockedComponents.subject));assert(result.data.tokenCheck.withinLimits);assert.equal(lastPayload.model,'text-test');assert.equal(lastPayload.format,'json');assert.equal(lastPayload.think,false);assert.equal(lastPayload.options.num_predict,3200);
  body.currentText='x'.repeat(16001);result=await api.promptAssist({},{});assert.equal(result.status,400);assert.equal(calls,1);
  body={task:'imagePrompt',structured:true,imageModelId:'flux-chroma1-hd',lockedComponents:{bogus:'x'}};result=await api.promptAssist({},{});assert.equal(result.status,400);assert.equal(calls,1);
  api.requestLocalLlm=async()=>({message:{content:JSON.stringify({suggestion:'unstructured description'})}});
  body={task:'imagePrompt',evaluation:true,imageData:'data:image/png;base64,AA=='};result=await api.promptAssist({},{});assert.equal(result.status,400);assert.match(result.data.error,/đánh giá/);
  api.requestLocalLlm=async()=>({done_reason:'length',message:{content:'A cut-off description'}});body={task:'imagePrompt'};result=await api.promptAssist({},{});assert.equal(result.status,400);assert.match(result.data.error,/vượt giới hạn 2400 token/);
  api.requestLocalLlm=async()=>({done:false,done_reason:'unload',message:{content:''}});result=await api.promptAssist({},{});assert.equal(result.status,400);assert.match(result.data.error,/dừng bất thường \(unload\)/);
  api.requestLocalLlm=async(payload)=>{lastPayload=payload;return {message:{content:JSON.stringify({suggestion:'vision result',assessment:{overallScore:90,components:{}},changes:[],warnings:[]})}};};body={task:'imagePrompt',evaluation:true,imageData:'data:image/png;base64,AA=='};result=await api.promptAssist({},{});assert.equal(lastPayload.model,'vision-test');assert.equal(lastPayload.think,undefined);
  console.log('OK: long assist input, exact server-side locks, token preview, early rejection and no fabricated evaluation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
