'use strict';
const crypto=require('node:crypto');
const contracts=require('../../packages/contracts/jobs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function queueId(key){const h=crypto.createHash('sha256').update(key).digest('hex').slice(0,32);return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
function createTaskCoordinator({store,ai,pollMs=300}){
 async function enqueue(route,body){
  const definition=contracts.forRoute(route);if(!definition)throw Error('Loại tác vụ không được hỗ trợ.');
  const [kind,task]=definition,jobId=contracts.jobId(body.jobId||kind+'-'+crypto.randomUUID());
  const payload={...body,jobId},requestHash=crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
  const queue=await store.action({action:'create',kind,name:task.label,requestKey:jobId,requestHash,items:[{name:task.label,payload}]});
  if(queue.status==='paused'&&!queue.items.some(i=>i.status==='failed'))await store.action({action:'start',id:queue.id});
  return {ok:true,jobId,queueId:queue.id,resumeMode:task.resume};
 }
 async function find(jobId){try{return await store.get(queueId(jobId));}catch(e){if(!/Không tìm thấy/.test(e.message))throw e;return null;}}
 async function status(jobId){
  contracts.jobId(jobId);const queue=await find(jobId),item=queue?.items[0];
  if(item&&!item.checkpoint?.submitted&&!item.jobId){return {ok:true,jobId,taskType:contracts.tasks[queue.kind].taskType,status:queue.status==='cancelled'?'cancelled':queue.status==='paused'?'interrupted':'queued',stage:'queued',updatedAt:queue.updatedAt,results:[],resumable:queue.status==='paused',resumeMode:contracts.tasks[queue.kind].resume};}
  try{const state=await ai('/job-status',{jobId});if(state.status!=='unknown'||!item)return state;}catch(error){if(!item)throw error;}
  if(item?.status==='completed')return {ok:true,jobId,status:'completed',results:item.result?.results||[],response:item.result};
  return {ok:true,jobId,taskType:contracts.tasks[queue.kind].taskType,status:item?.status==='failed'?'interrupted':'running',stage:'preparing',error:item?.error||'',resumable:false};
 }
 async function cancel(jobId){
  contracts.jobId(jobId);const queue=await find(jobId);
  if(queue){try{await store.action({action:'cancel-pending',id:queue.id});return {ok:true,jobId,status:'cancelled'};}catch(e){if(!/bộ xử lý/.test(e.message))throw e;}}
  return ai('/cancel-job',{jobId});
 }
 async function wait(id,isClosed=()=>false){
  while(!isClosed()){
   const q=await store.get(id),item=q.items[0];
   if(item.status==='completed')return item.result;
   if(item.status==='cancelled'||q.status==='cancelled')throw Error('Tác vụ đã được hủy.');
   if(item.status==='failed')throw Error(item.error||'Tác vụ chưa hoàn tất.');
   if(q.status==='paused')throw Error('Tác vụ đã dừng. Tiếp tục tại Hoạt động.');
   await delay(pollMs);
  }
  return null;
 }
 async function resume(jobId,isClosed){const q=await find(contracts.jobId(jobId));if(!q)return ai('/resume-job',{jobId});await store.action({action:'start',id:q.id});return wait(q.id,isClosed);}
 return {enqueue,status,cancel,wait,resume,find};
}
module.exports={createTaskCoordinator,queueId};
