const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),vm=require('vm');
const {spawn}=require('child_process');
async function main(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-api-')),file=path.join(dir,'prompts.json');
  fs.copyFileSync(require('../app/prompt-store').FILE,file);
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
  const child=spawn(process.execPath,[path.join(__dirname,'../app/server.js')],{env:{...process.env,AI_IMAGE_PORT:String(port),ATELIER_PROMPTS_FILE:file,ATELIER_JSON_CONFIG_ROOT:dir},windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Server startup timed out')),10000);child.stdout.on('data',()=>{clearTimeout(timeout);resolve();});child.on('error',reject);child.on('exit',code=>{clearTimeout(timeout);reject(new Error('Server exited '+code));});});
    const url=`http://127.0.0.1:${port}`;
    async function post(route,body,headers={}){return fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});}
    const initial=await (await fetch(url+'/api/prompts')).json();assert(initial.ok);
    const script=await (await fetch(url+'/api/prompts.js')).text();const context={window:{}};vm.runInNewContext(script,context);assert(context.window.ATELIER_PROMPTS.presets.glasses);
    const html=await (await fetch(url)).text();assert(html.indexOf('/api/prompts.js')<html.indexOf('/app.js'));
    const items=structuredClone(initial.catalog.library);items[0].text='Updated shared library';
    let response=await post('/api/prompts',{action:'library',items,expectedLibrary:initial.catalog.library});assert.equal(response.status,200);
    response=await post('/api/prompts',{action:'library',items,expectedLibrary:initial.catalog.library});assert.equal(response.status,400);
    response=await post('/api/preset-prompt',{name:'hat',prompt:'Updated hat prompt'});assert.equal(response.status,200);
    response=await post('/api/processing-modes',{id:'background',prompt:'Updated background prompt'});assert.equal(response.status,200);
    response=await post('/api/prompts',{action:'library',items},{origin:'https://other.example'});assert.equal(response.status,403);
    const final=await (await fetch(url+'/api/prompts')).json();assert.equal(final.catalog.library[0].text,items[0].text);assert.equal(final.catalog.presets.hat.prompt,'Updated hat prompt');assert.equal(final.catalog.processingModes.background.prompt,'Updated background prompt');
    assert.deepEqual(JSON.parse(require('./helpers/source').read(file,'utf8')),final.catalog);
    const exportResponse=await fetch(url+'/api/prompts/export');assert.equal(exportResponse.status,200);
    assert(exportResponse.headers.get('content-disposition').includes('ai-atelier-prompts.json'));
    assert(exportResponse.headers.get('content-type').includes('application/json'));
    const exported=await exportResponse.json();assert.deepEqual(exported,final.catalog);
    const candidate=structuredClone(exported);candidate.library[0].text='Imported via HTTP';candidate.promptAssist.system='Imported system instruction';candidate.ui.quickIdea1='Imported UI idea';
    response=await post('/api/prompts',{action:'preview-import',catalog:candidate});assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.summary.templates,Object.keys(candidate.templates).length);
    assert.deepEqual(JSON.parse(require('./helpers/source').read(file,'utf8')),exported);
    response=await post('/api/prompts',{action:'import',catalog:candidate,expectedRevision:preview.revision},{origin:'https://other.example'});assert.equal(response.status,403);
    response=await post('/api/prompts',{action:'import',catalog:candidate,expectedRevision:preview.revision});assert.equal(response.status,200);
    assert.deepEqual((await response.json()).catalog,candidate);
    response=await post('/api/prompts',{action:'import',catalog:exported,expectedRevision:preview.revision});assert.equal(response.status,400);
    response=await post('/api/prompts',{action:'preview-import',catalog:{schemaVersion:1}});assert.equal(response.status,400);
    response=await fetch(url+'/api/prompts',{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad json'});assert.equal(response.status,400);
    assert.deepEqual(JSON.parse(require('./helpers/source').read(file,'utf8')),candidate);
    const configFiles=await (await fetch(url+'/api/json-config')).json();assert.equal(configFiles.files.length,7);
    const configSnapshot=await (await fetch(url+'/api/json-config/prompts')).json();assert.deepEqual(configSnapshot.data,candidate);
    const edited=structuredClone(configSnapshot.data);edited.uiPlaceholders.promptName='Editor change through HTTP';
    response=await post('/api/json-config/prompts',{action:'validate',data:edited,revision:configSnapshot.revision});assert.equal(response.status,200);assert.equal((await response.json()).changeCount,1);
    assert.deepEqual(JSON.parse(require('./helpers/source').read(file,'utf8')),candidate);
    response=await post('/api/json-config/prompts',{action:'save',data:edited,revision:configSnapshot.revision},{origin:'https://other.example'});assert.equal(response.status,403);
    response=await post('/api/json-config/prompts',{action:'save',data:edited,revision:configSnapshot.revision});assert.equal(response.status,200);const configSaved=await response.json();assert(configSaved.saved);
    response=await post('/api/json-config/prompts',{action:'save',data:candidate,revision:configSnapshot.revision});assert.equal(response.status,400);
    response=await post('/api/json-config/prompts',{action:'restore',backup:'../../config.json',revision:configSaved.revision});assert.equal(response.status,400);
    response=await post('/api/json-config/prompts',{action:'restore',backup:configSaved.backup,revision:configSaved.revision});assert.equal(response.status,200);assert.deepEqual((await response.json()).data,candidate);
    response=await fetch(url+'/api/json-config/unknown-file');assert.equal(response.status,400);
    console.log('OK: live HTTP startup, browser export, JSON saves, stale-save rejection and origin checks.');
  }finally{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
