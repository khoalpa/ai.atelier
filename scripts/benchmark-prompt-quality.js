'use strict';
// Compare prompt revisions without changing seeds, model or inference settings.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),catalog=JSON.parse(fs.readFileSync(path.join(root,'workspace/prompts.json'))),compiler=require('../packages/prompting/compiler');
const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const base=option('--base','http://127.0.0.1:7860'),modelId=option('--model','flux-chroma1-hd');
const directory=path.resolve(root,option('--output','workspace/diagnostics/prompt-quality-ab'));
fs.mkdirSync(directory,{recursive:true});
async function post(route,body){return new Promise((resolve,reject)=>{const url=new URL(route,base),payload=JSON.stringify(body),request=require(url.protocol==='https:'?'node:https':'node:http').request(url,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},response=>{let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.on('end',()=>{try{const data=JSON.parse(text);if(response.statusCode>=400||!data.ok)throw Error(data.error||text);resolve(data);}catch(error){reject(error);}});});request.setTimeout(1800000,()=>request.destroy(Error('Benchmark request timed out')));request.on('error',reject);request.end(payload);});}
function recover(request){
  const review=path.join(root,'workspace/review');if(!fs.existsSync(review))return null;
  for(const name of fs.readdirSync(review).filter(name=>/^chroma-generate-.*\.json$/.test(name)).reverse()){
    const report=JSON.parse(fs.readFileSync(path.join(review,name)));
    if(report.model===request.modelId&&report.prompt===request.prompt&&report.negativePrompt===request.negativePrompt&&report.seed===request.seed&&report.steps===request.steps&&report.guidance===request.guidance&&report.width===request.size&&report.height===request.size&&report.results?.length===1)return {ok:true,report:'workspace/review/'+name,...report};
  }
  return null;
}
function render(records){
  const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const blind=records.filter(r=>r.result?.results?.length).sort((a,b)=>crypto.createHash('sha256').update(a.id).digest('hex').localeCompare(crypto.createHash('sha256').update(b.id).digest('hex')));
  const cards=blind.map((r,i)=>{const item=r.result.results[0],file=path.join(root,'workspace',item.image.replace(/^\//,'')),relative=path.relative(directory,file).replace(/\\/g,'/');return `<article><h2>Image ${i+1} · ${escape(r.case)}</h2><p>${escape(r.intent)}</p><a href="${escape(relative)}"><img src="${escape(relative)}"></a><p>Review: intent, composition, material, geometry, lighting consistency. Leave irrelevant criteria unscored.</p></article>`;});
  fs.writeFileSync(path.join(directory,'index.html'),'<!doctype html><meta charset="utf-8"><title>Prompt quality A/B</title><style>body{font:16px system-ui;margin:24px;background:#eee}main{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}article{background:white;padding:16px}img{width:100%}</style><h1>Matched prompt comparison</h1><p>Labels conceal the prompt revision. All inference settings are identical within each pair.</p><main>'+cards.join('')+'</main>');
  fs.writeFileSync(path.join(directory,'blind-key.json'),JSON.stringify(blind.map((r,i)=>({label:i+1,id:r.id,variant:r.variant,case:r.case})),null,2));
}
(async()=>{
  const suite=catalog.promptQuality.benchmark,records=[];
  for(const test of suite.cases)for(const variant of ['baseline','candidate']){
    const id=test.id+'-'+variant,file=path.join(directory,id+'.json');
    const components={...(variant==='baseline'?catalog.promptQuality.baseline.featurePresets['promptBuilder.presets']:catalog.featurePresets['promptBuilder.presets'])[test.preset],subject:test.subject};
    const prompt=variant==='baseline'?catalog.promptQuality.order.map(key=>components[key]).filter(Boolean).concat(catalog.components['promptBuilder.suffix']).join(', '):compiler.compile(catalog,{modelId,components}).prompt;
    const request={...suite.settings,modelId,prompt,negativePrompt:'',jobId:'prompt-quality-'+crypto.randomUUID()},record={id,case:test.id,intent:test.intent,variant,request};
    record.fingerprint=crypto.createHash('sha256').update(JSON.stringify({...request,jobId:undefined})).digest('hex');
    if(fs.existsSync(file)){const cached=JSON.parse(fs.readFileSync(file));if(cached.result?.ok&&cached.fingerprint===record.fingerprint){records.push(cached);continue;}}
    const recovered=recover(request);if(recovered){record.result=recovered;record.recovered=true;fs.writeFileSync(file,JSON.stringify(record,null,2));records.push(record);render(records);console.log('RECOVERED '+id);continue;}
    console.log('START '+id);
    try{record.preflight=await post('/api/new-image-plan',request);if(!record.preflight.valid)throw Error(record.preflight.errors.join('; '));record.result=await post('/api/chroma-generate',request);console.log('DONE '+id);}
    catch(error){record.error=error.message;console.log('FAILED '+id+': '+error.message);}
    fs.writeFileSync(file,JSON.stringify(record,null,2));records.push(record);render(records);
  }
  render(records);const failed=records.filter(r=>!r.result?.ok);console.log(JSON.stringify({directory,total:records.length,failed:failed.length}));if(failed.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
