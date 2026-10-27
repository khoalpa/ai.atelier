const assert=require('node:assert/strict'),catalog=require('../app/prompt-store').readCatalog();
let body,calls=0;
const api=require('../apps/local-api/services/prompts')({ROOT:require('node:path').resolve(__dirname,'..'),readCatalog:()=>catalog,renderTemplate:require('../app/prompt-store').renderTemplate,parseJson:async()=>body,send:(_res,status,text)=>({status,data:JSON.parse(text)}),LLM_MODEL:'test',callAiJson:async()=>({withinLimits:true})});
api.requestLocalLlm=async()=>{calls++;return {message:{content:JSON.stringify({suggestion:'A changed subject',components:{subject:'Wrong identity',materials:'fine fabric'},warnings:[],changes:[]})}};};
(async()=>{
  body={task:'imagePrompt',structured:true,imageModelId:'flux-chroma1-hd',currentText:'a '.repeat(2500),context:'context '.repeat(600),lockedComponents:{subject:'One exact adult subject'}};
  let result=await api.promptAssist({},{});assert.equal(result.status,200);assert.equal(result.data.components.subject,body.lockedComponents.subject);assert(result.data.suggestion.includes(body.lockedComponents.subject));assert(result.data.tokenCheck.withinLimits);
  body.currentText='x'.repeat(16001);result=await api.promptAssist({},{});assert.equal(result.status,400);assert.equal(calls,1);
  body={task:'imagePrompt',structured:true,imageModelId:'flux-chroma1-hd',lockedComponents:{bogus:'x'}};result=await api.promptAssist({},{});assert.equal(result.status,400);assert.equal(calls,1);
  api.requestLocalLlm=async()=>({message:{content:JSON.stringify({suggestion:'unstructured description'})}});
  body={task:'imagePrompt',evaluation:true,imageData:'data:image/png;base64,AA=='};result=await api.promptAssist({},{});assert.equal(result.status,400);assert.match(result.data.error,/đánh giá/);
  api.requestLocalLlm=async()=>({done_reason:'length',message:{content:'A cut-off description'}});body={task:'imagePrompt'};result=await api.promptAssist({},{});assert.equal(result.status,400);assert.match(result.data.error,/giới hạn trả lời/);
  console.log('OK: long assist input, exact server-side locks, token preview, early rejection and no fabricated evaluation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
