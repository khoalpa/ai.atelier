'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {acquire}=require('./process-lock'), Core=require('./public/manual-core'),Export=require('./public/export-core');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function createRunner(root,{store,manualStore,renderer,ai,canRun=()=>true,pollMs=1000}) {
  const owner=crypto.randomUUID();let release=null,timer=null,busy=false,stopped=false,active='',lastError='';
  async function savedOutput(item,project,spec){
    const directory=path.join(root,'workspace/outputs/manual',item.id);let meta;
    try{meta=JSON.parse(await fs.readFile(path.join(directory,'metadata.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
    const ext=spec?({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[spec.format]):'png',file=path.join(directory,'result.'+ext);
    if(meta.projectId!==project.id||meta.revision!==project.revision||crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')!==meta.sha256)throw Error('Ảnh đã xuất không khớp công việc. Cần kiểm tra trước khi tiếp tục.');
    return {url:`/outputs/manual/${item.id}/result.${ext}`,width:meta.width,height:meta.height,projectId:project.id,revision:project.revision,filename:meta.displayName};
  }
  async function renderItem(item,kind){
    const p=item.payload;let project,spec;
    if(kind==='export'&&p.projectId)project=await manualStore.load(p.projectId,p.revision);
    else {const doc=Core.create(p.asset);if(kind==='manual-color')doc.adjustments=p.adjustments;project=await manualStore.save({creationKey:item.id,name:item.name,document:doc});}
    if(kind==='export')spec=Export.validate(p.spec);
    const previous=await savedOutput(item,project,spec);if(previous)return previous;
    const data=await renderer.render(project.document,spec);
    const output=await manualStore.exportImage({id:project.id,revision:project.revision,exportId:item.id,data,spec,name:item.name,index:p.index});
    return {...output,filename:spec?Export.filename(item.name,spec,output,p.index):item.name.replace(/\.[^.]+$/,'')+'-chinh-mau.png'};
  }
  async function character(item,checkpoint){
    const jobId=item.jobId||item.checkpoint?.jobId||'character-'+item.id;
    async function recover(){
      while(!stopped){let state;try{state=await ai('/job-status',{jobId});}catch(e){if(e.code!=='AI_CONNECTION')throw e;await delay(pollMs);continue;}
        if(state.status==='completed')return {results:state.results};
        if(['running','cancelling'].includes(state.status)){await delay(pollMs);continue;}
        if(state.status==='unknown')throw Error('Chưa xác nhận được lượt AI trước. Lô đã dừng để tránh tạo ảnh trùng.');
        if(state.resumable)return submit('/resume-job',{jobId});
        throw Error('Lượt AI trước đã dừng và không có điểm tiếp tục. Tạo lô mới sau khi kiểm tra kết quả.');
      }
      throw Error('Dịch vụ đang đóng.');
    }
    async function submit(route,body){try{return await ai(route,body);}catch(e){if(e.code!=='AI_CONNECTION')throw e;await delay(pollMs);return recover();}}
    if(item.checkpoint?.submitted||item.jobId){
      return recover();
    }
    await checkpoint({jobId,submitted:true});
    return submit('/character-render',{...item.payload,jobId});
  }
  async function run(id){
    active=id;let heartbeat;
    try{
      let q=await store.action({action:'claim',id,owner});
      heartbeat=setInterval(()=>store.action({action:'heartbeat',id,owner}).catch(e=>{lastError=e.message;}),8000);
      for(const item of q.items){
        if(stopped) return;
        if(item.status==='completed')continue;
        q=await store.get(id);if(q.stopRequested)break;
        await store.action({action:'item',id,owner,itemId:item.id,status:'running'});
        try {
          const checkpoint=async value=>{await store.action({action:'item',id,owner,itemId:item.id,status:'running',checkpoint:value,jobId:value.jobId});};
          const result=q.kind==='character'?await character(item,checkpoint):await renderItem(item,q.kind);
          if(stopped)return;
          await store.action({action:'item',id,owner,itemId:item.id,status:'completed',result});
        }catch(error){
          if(stopped)return;
          await store.action({action:'item',id,owner,itemId:item.id,status:'failed',error:error.message});break;
        }
      }
      if(!stopped)await store.action({action:'finish',id,owner});
    }finally{clearInterval(heartbeat);active='';}
  }
  async function tick(){if(busy||stopped)return;busy=true;try{
    if(!release)release=await acquire(path.join(root,'workspace/work-queue/runner.lock'));
    if(!release||!await canRun())return;
    const rows=await store.list();const next=rows.filter(q=>q.execution==='server'&&q.requested&&!q.stopRequested&&q.status!=='completed').sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];
    if(next){lastError='';await run(next.id);}
  }catch(e){lastError=e.message;}finally{busy=false;}}
  function start(){if(timer)return;stopped=false;timer=setInterval(tick,pollMs);timer.unref();tick();}
  async function stop(){stopped=true;clearInterval(timer);timer=null;renderer.stop();if(release){await release();release=null;}}
  function status(){return {active,leader:Boolean(release),error:lastError,rendererReady:renderer.available(),background:true};}
  return {start,stop,tick,status};
}
module.exports={createRunner};
