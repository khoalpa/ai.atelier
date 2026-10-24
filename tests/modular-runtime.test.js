'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
test('real modular API starts against an isolated SQLite workspace and executes asynchronous tasks',async()=>{
 const source=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-api-'));let app;const saved={...process.env};let submissions=0;
 const ai=http.createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.setHeader('Content-Type','application/json');if(req.url==='/enhance'){submissions++;res.end(JSON.stringify({ok:true,results:[{file:'checked.png'}]}));}else res.end(JSON.stringify({ok:true,status:'unknown'}));});});
 try{
  for(const dir of ['app','apps/local-api','packages'])fs.cpSync(path.join(source,dir),path.join(root,dir),{recursive:true,filter:file=>fs.statSync(file).isDirectory()||/\.(js|json)$/.test(file)});
  fs.copyFileSync(path.join(source,'version.json'),path.join(root,'version.json'));
  require(path.join(root,'packages/storage/metadata')).migrate(path.join(root,'workspace'));
  await new Promise(resolve=>ai.listen(0,'127.0.0.1',resolve));
  const reservation=http.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  process.env.AI_IMAGE_PORT=String(port);process.env.AI_SEGMENT_PORT=String(ai.address().port);process.env.ATELIER_DISABLE_BACKGROUND='1';
  app=require(path.join(root,'app/server'));if(!app.server.listening)await new Promise(resolve=>app.server.once('listening',resolve));
  assert.equal(app.services.server,app.server);
  for(const file of fs.readdirSync(path.join(root,'apps/local-api/services'))){
   if(!file.endsWith('.js'))continue;
   for(const [,name]of fs.readFileSync(path.join(root,'apps/local-api/services',file),'utf8').matchAll(/\bdeps\.([a-zA-Z_$][\w$]*)/g))assert(name in app.services,`Missing service dependency ${file}: ${name}`);
  }
  const base='http://127.0.0.1:'+app.server.address().port;
  async function json(url,body){const response=await fetch(base+url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return {status:response.status,value:await response.json()};}
  assert.equal((await json('/api/health')).value.version,JSON.parse(fs.readFileSync(path.join(root,'version.json'))).version);
  const request={kind:'enhance',jobId:'from-api',payload:{seed:42}};
  const accepted=await json('/api/tasks',request);assert.equal(accepted.status,202);
  assert.equal((await json('/api/tasks/from-api')).value.status,'queued');
  assert.equal((await json('/api/jobs')).value.jobs.find(j=>j.jobId==='from-api').status,'queued');
  assert.equal((await json('/api/tasks',request)).value.queueId,accepted.value.queueId);
  assert.equal((await json('/api/tasks',{...request,payload:{seed:99}})).status,400);
  await app.services.queueRunner.tick();assert.equal(submissions,1);
  assert.equal((await json('/api/tasks/from-api')).value.response.results[0].file,'checked.png');
  await json('/api/tasks',{kind:'enhance',jobId:'cancel-me',payload:{}});
  assert.equal((await json('/api/tasks/cancel-me/cancel',{})).value.status,'cancelled');await app.services.queueRunner.tick();assert.equal(submissions,1);
 }finally{
  if(app){await app.services.queueRunner.stop();app.services.qualityService.stop();await new Promise(resolve=>app.server.close(resolve));}
  await new Promise(resolve=>ai.close(resolve));require(path.join(root,'packages/storage/metadata')).close();
  for(const key of ['AI_IMAGE_PORT','AI_SEGMENT_PORT','ATELIER_DISABLE_BACKGROUND'])if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
  assert(root.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});
 }
});
