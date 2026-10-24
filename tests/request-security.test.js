const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const {spawn} = require('node:child_process');

async function request(port, route, headers = {}, method = 'POST') {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers:{'Content-Type':'text/plain',...headers}},res=>{
      let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));
    });
    req.on('error',reject);req.end(method==='GET'?undefined:'{"id":"__security_probe__","confirm":"__security_probe__"}');
  });
}

(async()=>{
  const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
  const port=socket.address().port;await new Promise(r=>socket.close(r));
  const child=spawn(process.execPath,[path.join(__dirname,'../app/server.js')],{env:{...process.env,AI_IMAGE_PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Server startup timed out')),10000);
      child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(new Error('Server exited '+code));});
    });
    for(const route of ['/api/models/delete','/api/reset-data','/api/cleanup-jobs','/api/restart-web','/api/inpaint','/api/library-remove','/api/review','/api/manual/assets','/api/manual/projects','/api/manual/export','/api/manual/presets','/api/regions','/api/export-presets','/api/work-queue','/api/asset-catalog','/api/review-creative','/api/manual-cutout','/api/restore-backup','/api/backup-verify']) {
      for(const headers of [{Origin:'https://other.example'}, {'Sec-Fetch-Site':'cross-site'}, {Origin:'null'}, {Host:`attacker.example:${port}`}]) {
        assert.equal((await request(port,route,headers)).status,403,route+' must reject '+JSON.stringify(headers));
      }
    }
    assert.equal((await request(port,'/api/health',{Host:`attacker.example:${port}`},'GET')).status,403);
    assert.equal((await request(port,'/api/health',{},'GET')).status,200);
    for(const headers of [{}, {Origin:`http://127.0.0.1:${port}`}, {Host:`localhost:${port}`,Origin:`http://localhost:${port}`}]) {
      const result=await request(port,'/api/models/delete',headers);
      assert.equal(result.status,400);assert.match(result.body.error,/Model chưa đăng ký/);
    }
    console.log('OK: real HTTP routes reject foreign origins and rebinding hosts; local calls still work.');
  } finally {child.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
