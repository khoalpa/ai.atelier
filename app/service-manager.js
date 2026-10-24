'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {readVersion,webRevision,aiRevision}=require('./runtime-version');
function createServiceManager(root,{aiGet,aiPost,queues,jobs,runner,port,aiPort,loadedVersion,loadedRevision,launch=spawn}){
  let operation=null;
  const busy=()=>operation?.status==='running';
  async function idle(){if(jobs().some(j=>['running','cancelling','queued'].includes(j.status))||(await queues.list()).some(q=>['running','queued'].includes(q.status)))throw Error('Đợi tác vụ và lô ảnh đang chạy hoàn tất trước khi khởi động lại.');}
  async function state(){const previous=operation||await fs.readFile(path.join(root,'workspace/logs/service-restart.json'),'utf8').then(JSON.parse).catch(()=>null);const ai=await aiGet('/health'),expected=readVersion(root);return {ok:true,expectedVersion:expected,web:{version:loadedVersion,pid:process.pid,needsRestart:loadedVersion!==expected||loadedRevision!==webRevision(root)},ai:{online:!!ai.ok,version:ai.version||'Chưa có thông tin',pid:ai.pid,device:ai.device,activeRequests:ai.activeRequests||0,maintenance:!!ai.maintenance,needsRestart:ai.ok&&(ai.version!==expected||ai.revision!==aiRevision(root)),manualCutoutReady:ai.manualCutoutVersion===1},queue:runner.status(),operation:previous};}
  async function restart(){
    if(busy())throw Error('Dịch vụ đang khởi động lại.');
    operation={status:'running',startedAt:new Date().toISOString(),message:'Đang kiểm tra và khởi động lại dịch vụ AI…'};
    let reservation;
    try{
      await idle();const health=await aiGet('/health');if(!health.ok)throw Error('Dịch vụ AI chưa chạy. Mở ứng dụng bằng start-all.ps1 trước.');
      if(health.activeRequests)throw Error('Còn thao tác AI đang xử lý.');
      if(health.lifecycleVersion===1)reservation=(await aiPost('/prepare-restart',{confirm:true})).token;
      await idle();
      const shell=process.env.ATELIER_POWERSHELL||'powershell.exe';
      const child=launch(shell,['-NoProfile','-File',path.join(root,'restart-ai.ps1'),'-AiPort',String(aiPort),'-WebPort',String(port)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
      const collect=data=>{output=(output+String(data)).slice(-12000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
      let settled=false;
      const done=async error=>{if(settled)return;settled=true;const status=error?'failed':'completed';try{const current=await aiGet('/health');if(!error&&(current.version!==readVersion(root)||current.revision!==aiRevision(root)))error=Error('Dịch vụ mới chưa nạp đúng phiên bản.');}catch(e){error=e;}operation={...operation,status:error?'failed':status,finishedAt:new Date().toISOString(),message:error?error.message:'Dịch vụ AI đã sẵn sàng.',log:output};if(error&&reservation)await aiPost('/cancel-restart',{confirm:true,token:reservation}).catch(()=>{});await fs.mkdir(path.join(root,'workspace/logs'),{recursive:true});await fs.writeFile(path.join(root,'workspace/logs/service-restart.json'),JSON.stringify(operation,null,2));};
      child.once('error',e=>done(Error('Không mở được công cụ khởi động lại: '+e.message)).catch(()=>{}));child.once('exit',code=>done(code?Error('Khởi động lại chưa thành công. Xem nhật ký và thử lại.'):null).catch(()=>{}));
      return operation;
    }catch(e){operation={...operation,status:'failed',message:e.message};if(reservation)await aiPost('/cancel-restart',{confirm:true,token:reservation}).catch(()=>{});throw e;}
  }
  return {state,restart,busy,idle};
}
module.exports={createServiceManager};
