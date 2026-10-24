const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../app/server.js'),'utf8');
const handler = source.slice(source.indexOf('let webRestartPending ='),source.indexOf('const server = http.createServer'));
function fixture({body={confirm:true},jobs=[],origin}={}) {
  const responses=[];let spawned=false;
  const context={serviceManager:{busy:()=>false,idle:async()=>{}},parseJson:async()=>body,listJobs:()=>jobs,send:(_res,code,data)=>responses.push({code,...JSON.parse(data)}),spawn:()=>{spawned=true;throw new Error('Unexpected spawn');},process:{pid:1},path,ROOT:'.',__dirname:'.'};
  vm.createContext(context);vm.runInContext(handler,context);
  return {responses,run:()=>context.restartWebServer({headers:{host:'127.0.0.1:7860',origin}},{}),spawned:()=>spawned};
}
test('rejects requests from another origin',async()=>{const f=fixture({origin:'https://example.com'});await f.run();assert.equal(f.responses[0].code,403);assert.equal(f.spawned(),false);});
test('requires explicit confirmation',async()=>{const f=fixture({body:{}});await f.run();assert.equal(f.responses[0].code,400);assert.equal(f.spawned(),false);});
test('blocks restart while generation is running',async()=>{const f=fixture({jobs:[{status:'running'}]});await f.run();assert.equal(f.responses[0].code,409);assert.equal(f.spawned(),false);});
