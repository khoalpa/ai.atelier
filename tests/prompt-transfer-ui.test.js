const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),os=require('os'),path=require('path');
const store=require('../app/prompt-store');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-transfer-ui-')),file=path.join(dir,'prompts.json');
fs.copyFileSync(store.FILE,file);
const source=require('./helpers/source').read(path.join(__dirname,'../app/public/prompt-catalog.js'),'utf8');
const controls=new Map(),downloads=[],messages=[];let applied=0,offline=false,requestCount=0;
function control(){return {value:'',disabled:false,hidden:false,textContent:'',files:[],addEventListener(type,fn){this[type]=fn;},click(){if(this.onClick)this.onClick();}};}
const panel={querySelector(selector){if(!controls.has(selector))controls.set(selector,control());return controls.get(selector);}};
const catalog=structuredClone(store.readCatalog(file)),defaultsReference=catalog.defaults.library;
const window={ATELIER_PROMPTS:catalog,addEventListener(){},setMessage:message=>messages.push(message)};
const context={window,document:{getElementById:()=>null,createElement:tag=>tag==='section'?panel:{click(){downloads.push({href:this.href,download:this.download});},remove(){}},body:{appendChild(){}}},URL:{createObjectURL:()=> 'blob:exported-catalog',revokeObjectURL(){}},setTimeout:fn=>fn(),fetch:async(url,options)=>{
  requestCount++;if(offline)throw new Error('Connection unavailable');
  if(url==='/api/prompts/export')return {ok:true,blob:async()=>JSON.stringify(store.readCatalog(file))};
  const body=JSON.parse(options.body);
  try{
    const result=body.action==='preview-import'?{ok:true,...store.previewImport(body.catalog,file)}:{ok:true,catalog:store.importCatalog(body.catalog,body.expectedRevision,file)};
    return {ok:true,json:async()=>structuredClone(result)};
  }catch(error){return {ok:false,json:async()=>({ok:false,error:error.message})};}
}};
vm.runInNewContext(source,context);
window.AtelierPromptCatalog.renderTransfer({prepend(){}},()=>{applied++;});
const get=selector=>controls.get(selector),input=get('[data-import-file]'),apply=get('[data-apply-import]'),status=get('[data-transfer-status]');
async function select(value,name='custom-prompts.json'){
  const content=typeof value==='string'?value:JSON.stringify(value);
  input.files=[{name,size:Buffer.byteLength(content),text:async()=>content}];await input.change();
}
(async()=>{
  const original=store.readCatalog(file),candidate=structuredClone(original);candidate.library[0].text='UI imported prompt';candidate.defaults.library[0].text='UI imported reset default';
  await get('[data-export-prompts]').click();assert.equal(downloads[0].download,'ai-atelier-prompts.json');
  await select(candidate,'<script>literal filename</script>.json');
  assert.equal(applied,0);assert(!apply.disabled);assert(get('[data-import-summary]').textContent.includes('<script>literal filename</script>.json'));
  assert.deepEqual(store.readCatalog(file),original);
  get('[data-cancel-import]').click();assert(apply.disabled);assert.deepEqual(store.readCatalog(file),original);
  await select('{invalid');assert(apply.disabled);assert(status.textContent.includes('JSON'));assert.deepEqual(store.readCatalog(file),original);
  const before=requestCount;input.files=[{size:2*1024*1024+1}];await input.change();assert.equal(requestCount,before);assert(status.textContent.includes('2 MB'));
  await select(candidate);offline=true;await apply.click();assert.equal(applied,0);assert(!apply.disabled);assert(status.textContent.includes('Connection unavailable'));assert.deepEqual(store.readCatalog(file),original);
  offline=false;await apply.click();assert.equal(applied,1);assert.deepEqual(store.readCatalog(file),candidate);assert(messages[0].includes('Đã nhập'));
  assert.equal(catalog.defaults.library,defaultsReference);assert.equal(defaultsReference[0].text,'UI imported reset default');
  assert.equal(catalog.library[0].text,'UI imported prompt');
  await select(original);store.savePresetPrompt({name:'hat',prompt:'Another window edit'},file);await apply.click();assert.equal(applied,1);assert(status.textContent.includes('thay đổi'));assert.equal(store.readCatalog(file).presets.hat.prompt,'Another window edit');
  console.log('OK: transfer UI export, preview, cancel, JSON/size errors, retry, live defaults refresh and stale import rejection.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
