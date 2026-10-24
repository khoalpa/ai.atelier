'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createQueueStore}=require('../app/work-queue-store'),{createRunner}=require('../app/work-queue-runner'),{createTaskCoordinator}=require('../apps/local-api/task-coordinator'),{tasks}=require('../packages/contracts/jobs'),metadata=require('../packages/storage/metadata');
async function fixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-coordinator-'));let runner;try{
 metadata.migrate(path.join(root,'workspace'));const store=createQueueStore(root),calls=[];
 const ai=async(route,body)=>{calls.push({route,body});return route==='/job-status'?{status:'unknown'}:{ok:true,results:[{file:'saved.png'}],jobId:body.jobId};};
 runner=createRunner(root,{store,manualStore:{},renderer:{stop(){},available(){return true;}},ai,pollMs:1});
 const coordinator=createTaskCoordinator({store,ai,pollMs:1});await run({root,store,runner,coordinator,calls});
 }finally{await runner?.stop();metadata.close(path.join(root,'workspace'));assert(root.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}}
test('all generation contracts use the durable queue and preserve the complete response',()=>fixture(async({coordinator,runner,calls})=>{
 for(const [kind,definition]of Object.entries(tasks)){
  const jobId='contract-'+kind,accepted=await coordinator.enqueue(definition.route,{jobId,seed:42});
  assert.equal((await coordinator.status(jobId)).status,'queued');await runner.tick();
  assert.equal((await coordinator.wait(accepted.queueId)).results[0].file,'saved.png');
  assert.equal((await coordinator.status(jobId)).status,'completed');assert.equal(calls.find(c=>c.body.jobId===jobId).route,definition.route);
 }
}));
test('repeated requests are idempotent and conflicting requests cannot overwrite them',()=>fixture(async({coordinator,runner,calls})=>{
 const first=await coordinator.enqueue('/enhance',{jobId:'same',seed:2});
 assert.equal((await coordinator.enqueue('/enhance',{seed:2,jobId:'same'})).queueId,first.queueId);
 await assert.rejects(coordinator.enqueue('/enhance',{jobId:'same',seed:3}),/thiết lập khác/);
 await runner.tick();await coordinator.enqueue('/enhance',{jobId:'same',seed:2});await runner.tick();
 assert.equal(calls.filter(c=>c.route==='/enhance').length,1);
}));
test('closing the waiting client does not cancel queued work; pending cancellation does',()=>fixture(async({coordinator,runner,calls})=>{
 const first=await coordinator.enqueue('/enhance',{jobId:'closed'});assert.equal(await coordinator.wait(first.queueId,()=>true),null);
 await runner.tick();assert.equal((await coordinator.wait(first.queueId)).ok,true);
 await coordinator.enqueue('/tryon',{jobId:'cancelled'});await coordinator.cancel('cancelled');await runner.tick();
 assert.equal((await coordinator.status('cancelled')).status,'cancelled');assert(!calls.some(c=>c.route==='/tryon'));
}));
test('rollback does not resurrect removed metadata; migrating again retains the rollback state',()=>fixture(async({root})=>{
 const home=path.join(root,'workspace'),file=path.join(home,'jobs/old.json');metadata.write(file,{status:'completed'});
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'{"status":"obsolete"}');metadata.remove(file);
 metadata.exportLegacy(home);assert(!fs.existsSync(file));metadata.migrate(home);assert.equal(metadata.exists(file),false);
}));
