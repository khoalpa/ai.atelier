'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {atomic,read}=require('./asset-catalog');
const {locked}=require('./process-lock');
const metadata=require('../packages/storage/metadata');
const contracts=require('../packages/contracts/jobs');
const ID=/^[a-f0-9-]{36}$/;
function createQueueStore(root){
 const directory=path.join(root,'workspace/work-queue');let tail=Promise.resolve();
 const serial=fn=>{const task=tail.then(()=>locked(path.join(directory,'mutation.lock'),fn));tail=task.catch(()=>{});return task;};
 async function get(id){if(!ID.test(id||''))throw Error('Hàng đợi không hợp lệ.');const q=await read(path.join(directory,id+'.json'),null);if(!q)throw Error('Không tìm thấy hàng đợi.');return q;}
 async function list(){await fs.mkdir(directory,{recursive:true});const result=[];for(const name of metadata.entries(directory)){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;const q=await read(path.join(directory,name));result.push({...q,owner:undefined,items:q.items.map(({payload,...i})=>i),status:q.status==='running'&&q.leaseUntil<Date.now()?'interrupted':q.status});}return result.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
 async function action(body){return serial(async()=>{
  let q;if(body.action==='create'){
   if(!['manual-color','export',...Object.keys(contracts.tasks)].includes(body.kind)||!Array.isArray(body.items)||!body.items.length||body.items.length>48)throw Error('Hàng đợi cần từ 1 đến 48 mục hợp lệ.');
   if(JSON.stringify(body).length>32*1024*1024)throw Error('Hàng đợi quá lớn.');
   let id=crypto.randomUUID();
   if(body.requestKey){contracts.jobId(body.requestKey);const hash=crypto.createHash('sha256').update(body.requestKey).digest('hex').slice(0,32);id=[hash.slice(0,8),hash.slice(8,12),hash.slice(12,16),hash.slice(16,20),hash.slice(20)].join('-');const previous=await read(path.join(directory,id+'.json'),null);if(previous){if(previous.kind!==body.kind||previous.requestHash!==body.requestHash)throw Error('Mã tác vụ đã được dùng với thiết lập khác.');return previous;}}
   q={id,requestKey:body.requestKey||'',requestHash:body.requestHash||'',name:String(body.name||'Xử lý ảnh').slice(0,120),kind:body.kind,status:'paused',createdAt:new Date().toISOString(),stopRequested:false,owner:null,leaseUntil:0,items:body.items.map(i=>({id:crypto.randomUUID(),name:String(i.name||'Ảnh').slice(0,160),status:'pending',payload:i.payload,jobId:i.jobId||'',result:null,error:''}))};
  }else{
   q=await get(body.id);
   if(body.action==='start'){
    if(['completed','cancelled'].includes(q.status))return q;
    if(q.status==='running'&&q.leaseUntil>Date.now())return q;
    q.execution='server';q.requested=true;q.stopRequested=false;q.status='queued';q.owner=null;q.leaseUntil=0;
    for(const item of q.items)if(item.status==='failed'){item.status='pending';item.error='';}
   }else if(body.action==='claim'){
    if(q.execution==='server'&&(!q.requested||q.stopRequested))throw Error('Lô đã được yêu cầu dừng.');
    if(typeof body.owner!=='string'||!ID.test(body.owner))throw Error('Phiên xử lý không hợp lệ.');
    if(q.owner&&q.owner!==body.owner&&q.leaseUntil>Date.now())throw Error('Hàng đợi đang chạy ở cửa sổ khác.');
    q.owner=body.owner;q.leaseUntil=Date.now()+30000;q.stopRequested=false;q.status='running';for(const item of q.items)if(item.status==='running')item.status='pending';
   }else if(body.action==='cancel-pending'){if(q.items.some(i=>i.status==='running'||i.checkpoint?.submitted))throw Error('Tác vụ đã được chuyển cho bộ xử lý.');for(const item of q.items)if(item.status==='pending')item.status='cancelled';q.status='cancelled';q.requested=false;q.stopRequested=true;}else if(body.action==='stop'){q.stopRequested=true;q.requested=false;if(q.status!=='running'||q.leaseUntil<Date.now())q.status='paused';}
   else if(body.action==='retry'){
    if(q.status==='running'&&q.leaseUntil>Date.now())throw Error('Dừng hàng đợi trước khi chạy lại.');for(const item of q.items)if(item.status==='failed'){item.status='pending';item.error='';}q.status='paused';q.stopRequested=false;
   }else{
    if(!body.owner||q.owner!==body.owner||q.leaseUntil<Date.now())throw Error('Phiên xử lý hết hiệu lực. Kết nối lại tại Hoạt động.');q.leaseUntil=Date.now()+30000;
    if(body.action==='item'){
     const item=q.items.find(i=>i.id===body.itemId);if(!item)throw Error('Mục không thuộc hàng đợi.');if(!['running','completed','failed'].includes(body.status))throw Error('Trạng thái không hợp lệ.');if(item.status==='completed'&&body.status!=='completed')throw Error('Ảnh hoàn tất không được chạy lại.');item.status=body.status;item.error=String(body.error||'').slice(0,1000);if(body.result!==undefined)item.result=body.result;if(body.checkpoint!==undefined)item.checkpoint=body.checkpoint;if(body.jobId)item.jobId=String(body.jobId).slice(0,100);
    }else if(body.action==='finish'){q.status=q.items.every(i=>i.status==='completed')?'completed':'paused';q.requested=false;q.owner=null;q.leaseUntil=0;}
    else if(body.action!=='heartbeat')throw Error('Thao tác hàng đợi không hợp lệ.');
   }
  }
  q.updatedAt=new Date().toISOString();await atomic(path.join(directory,q.id+'.json'),q);return q;
 });}
 return {get,list,action};
}
module.exports={createQueueStore};
