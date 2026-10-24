const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=require('./helpers/source').read(require.resolve('../app/public/character-extra.js'),'utf8');
function queueContext(rows,post){
  const calls=[],context={queue:rows,running:false,stop:false,api:{locked:()=>false,setBusy(){},notice:(...args)=>calls.push(['notice',...args]),post:async(route,body)=>{calls.push([route,body]);return post(route,body);}},el:()=>({}),createJobId:()=>`test-${calls.length}`,setActiveJob(){},settleJob:async()=>{},persist(){},renderQueue(){}};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  async function runBatch('),source.indexOf('  function setup(')),context);return {context,calls};
}
test('batch refuses unreviewed input before any inference request',async()=>{const {context,calls}=queueContext([{approved:false,request:{}}],()=>{throw Error('must not run');});await context.runBatch();assert.equal(calls.filter(c=>c[0]==='/api/character-render').length,0);assert.match(calls[0][1],/Duyệt từng ảnh/);});
test('batch retains successful results and stops after the first failed image',async()=>{let n=0;const rows=[0,1,2].map(i=>({approved:true,request:{sampleId:`photo-${i}`,planHash:`review-${i}`}}));const {context,calls}=queueContext(rows,async()=>{if(++n===2)throw Error('stale source');return {results:[{file:'saved.png'}]};});await context.runBatch();assert.equal(calls.filter(c=>c[0]==='/api/character-render').length,2);assert.equal(rows[0].results[0].file,'saved.png');assert.equal(rows[1].approved,false);assert.equal(rows[2].results,undefined);assert.equal(context.running,false);});
test('batch reconnect recovers completed job without regenerating it',async()=>{const row={approved:true,request:{planHash:'review'},jobId:'saved-job'};const {context,calls}=queueContext([row],async route=>{assert.equal(route,'/api/job-status');return {status:'completed',results:[{file:'existing.png'}]};});await context.runBatch();assert.equal(calls.filter(c=>c[0]==='/api/character-render').length,0);assert.equal(row.results[0].file,'existing.png');});
test('batch mapping rejects duplicate people and rescales target geometry per source',()=>{
  const skeleton=offset=>Array.from({length:17},(_,i)=>[.3+offset+(i%2)*.1,.2+Math.floor(i/5)*.15,1]);
  const from=skeleton(0),to=skeleton(.2),row={template:{mode:'body',personIds:[0],targetPoses:{0:from},perPerson:{0:{expression:'smile'}}},mapping:['1'],sampleId:'new',sourcePeople:[{id:0,keypoints:from}],analysis:{sourceSha256:'new-hash',people:[{id:1,keypoints:to}]}};
  const context={clone:structuredClone};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  function transfer('),source.indexOf('  function renderQueue(')),context);
  const value=context.requestFor(row);assert.equal(value.sourceSha256,'new-hash');assert.equal(value.personIds[0],1);assert.equal(value.perPerson[1].expression,'smile');assert.ok(Math.abs(value.targetPoses[1][0][0]-to[0][0])<1e-8);
  row.template.personIds=[0,1];row.mapping=['1','1'];assert.throws(()=>context.requestFor(row),/khác nhau/);
});
