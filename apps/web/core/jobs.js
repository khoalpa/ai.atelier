'use strict';
// Owned state: activeJobId, jobPollTimer, jobEventSource, activityState, activityClockTimer, STAGE_LABELS, PIPELINE_STAGES, INPAINT_STAGES, OUTPAINT_STAGES, TEXT_TO_IMAGE_STAGES, escapeHtml, readableRequestError, formatDuration, dismissedProgressJobs, currentAppView, jobsRefreshTimer
// Dependencies: $, cleanupOldJobs, outputUrl, renderRunPromptTraces, setMessage, setStudioCommandCollapsed, showGenerationResult, studioMode, updateStudioCommandVisibility
module.exports=function createJobs(deps){
let activeJobId, jobPollTimer, jobEventSource, activityState, activityClockTimer, STAGE_LABELS, PIPELINE_STAGES, INPAINT_STAGES, OUTPAINT_STAGES, TEXT_TO_IMAGE_STAGES, escapeHtml, readableRequestError, formatDuration, dismissedProgressJobs, currentAppView, jobsRefreshTimer;
function setActiveJob(jobId) {
  activeJobId = jobId;
  window.AtelierStore?.set({activeJobId:jobId||''});
  if (jobId) {
    localStorage.setItem('activeJobId', jobId);
    activityState={jobId,taskType:deps.studioMode==='chroma'?'text-to-image':deps.studioMode==='body'?'character':deps.studioMode,status:'running',stage:'preparing',startedAt:new Date().toISOString(),events:[],results:[]};
    renderActivity(activityState);
  } else localStorage.removeItem('activeJobId');
  deps.$('cancelJobButton').disabled = !jobId;
  deps.$('resumeJobButton').disabled = !jobId;
  deps.$('jobProgress').hidden = !jobId;
  if (jobPollTimer) clearInterval(jobPollTimer);
  if(jobEventSource){jobEventSource.close();jobEventSource=null;}
  if (jobId) connectJobStream(jobId);
  if(activityClockTimer)clearInterval(activityClockTimer);
  if(jobId)activityClockTimer=setInterval(()=>activityState&&renderActivity(activityState),1000);
}

function connectJobStream(jobId){
  if(!globalThis.EventSource){jobPollTimer=setInterval(()=>pollJobStatus().catch(()=>{}),1200);return;}
  jobEventSource=new EventSource(`/api/job-events?jobId=${encodeURIComponent(jobId)}`);
  jobEventSource.addEventListener('state',(event)=>{if(activeJobId!==jobId)return;try{applyJobState(JSON.parse(event.data));}catch{}});
  jobEventSource.addEventListener('end',()=>{jobEventSource?.close();jobEventSource=null;});
  jobEventSource.onerror=()=>{jobEventSource?.close();jobEventSource=null;if(activeJobId&&!jobPollTimer)jobPollTimer=setInterval(()=>pollJobStatus().catch(()=>{}),1200);};
}

function activityProgress(state){
  if(state.status==='completed')return 1;
  const total=Number(state.totalWorkSteps||0),completed=Number(state.completedSteps||0);
  if(total>0)return Math.max(0,Math.min(.99,completed/total));
  const seeds=Number(state.totalSeeds||0);
  if(seeds>0)return Math.max(0,Math.min(.99,Number(state.completedSeeds||0)/seeds));
  return 0;
}

function generationProgressInfo(state){
  const done=['completed','failed','cancelled'].includes(state.status);
  const progress=activityProgress(state);
  const measured=state.status==='completed'||Number(state.totalWorkSteps)>0||Number(state.totalSeeds)>0;
  const generating=['inpaint-generating','text-generating','result','preview'].includes(state.stage);
  const elapsed=Math.max(0,(Date.now()-Date.parse(state.startedAt||state.updatedAt||new Date()))/1000);
  const measuredEta=generating&&progress>0&&!done?elapsed*(1-progress)/progress:NaN;
  const historicalEta=typeof window!=='undefined'&&!done?window.StudioGuidance?.eta(state):NaN;
  const eta=Number.isFinite(measuredEta)?measuredEta:historicalEta;
  return {done,progress,measured,elapsed,eta,percent:Math.round(progress*100)};
}

function closeGenerationProgress(){
  if(!activityState)return;
  dismissedProgressJobs.add(activityState.jobId);
  for(const id of ['activityCenter','editorLiveProgress','chromaLiveProgress'])deps.$(id).hidden=true;
  deps.setMessage('Đã đóng thông báo tác vụ. Kết quả vẫn còn trong Thư viện và Hàng duyệt.','success');
}

function generationActionState(state){
  const done=['completed','cancelled','failed'].includes(state.status);
  const cancelling=!done&&(state.status==='cancelling'||Boolean(state.cancelRequested));
  return {done,cancelling,disabled:done?!(state.results||[]).length:cancelling};
}

function updateProgressVisibility(){
  if(!activityState)return;
  const dismissed=dismissedProgressJobs.has(activityState.jobId);
  const target=activityState.taskType==='text-to-image'?deps.$('chromaLiveProgress'):['inpaint','anatomy-inpaint','tryon','outpaint','enhance','makeup','character'].includes(activityState.taskType)?deps.$('editorLiveProgress'):null;
  const rightView=activityState.taskType==='text-to-image'?currentAppView==='create'&&deps.studioMode==='chroma':currentAppView==='create';
  const rect=target?.getBoundingClientRect();
  const docked=target?.parentElement?.classList.contains('workspace-progress-dock');
  const visible=rightView&&target&&!target.hidden&&(docked||rect.height>0&&rect.top<innerHeight&&rect.bottom>0);
  deps.$('activityCenter').hidden=dismissed||Boolean(visible);
}

function renderGenerationLive(state,progress,elapsed,eta,done){
  const target=state.taskType==='text-to-image'?deps.$('chromaLiveProgress'):['inpaint','anatomy-inpaint','tryon','outpaint','enhance','makeup','character'].includes(state.taskType)?deps.$('editorLiveProgress'):null;
  if(!target)return;
  for(const id of ['editorLiveProgress','chromaLiveProgress'])if(deps.$(id)!==target)deps.$(id).hidden=true;
  if(dismissedProgressJobs.has(state.jobId)){target.hidden=true;return;}
  if(done){target.hidden=true;return;}
  const info=generationProgressInfo(state);target.hidden=false;
  if(target.dataset.progressJob!==state.jobId){target.dataset.progressJob=state.jobId;target.classList.remove('is-collapsed');}
  const detailsOpen=Boolean(target.querySelector('.generation-details')?.open);
  let liveContent=target.querySelector('[data-live-status]');
  if(!liveContent){liveContent=document.createElement('div');liveContent.dataset.liveStatus='';liveContent.className='generation-live-status';target.prepend(liveContent);}
  const preview=state.preview?.file||state.preview?.url||(state.results||[]).at(-1)?.file;
  const previewUrl=preview?deps.outputUrl(preview):'';
  const stage=state.taskType==='outpaint'&&state.stage==='inpaint-generating'?'Đang mở rộng ảnh':STAGE_LABELS[state.stage]||state.stage||'Đang chuẩn bị';
  const title=done?(state.status==='completed'?'Đã hoàn tất':state.status==='failed'?'Tạo ảnh gặp lỗi':'Đã hủy'):stage;
  const steps=state.totalSteps?`Bước ${state.currentStep||0}/${state.totalSteps}`:'Đang chờ số bước';
  const variants=state.totalVariants?`Phương án ${state.currentVariant||1}/${state.totalVariants}`:'';
  const events=(state.events||[]).slice(-20).map(event=>`<li>${escapeHtml(event.message)}</li>`).join('');
  const phases=['Chuẩn bị','Nạp model','Tạo ảnh','Hoàn thiện và lưu','Hoàn tất'];
  const phase=state.status==='completed'?4:/saving|decoding|blending|refine|analysis|variant-complete|seam-repair|texture-recovery|layout-ready/.test(state.stage||'')?3:/generating|^result$|^preview$/.test(state.stage||'')?2:/model|loading/.test(state.stage||'')?1:0;
  liveContent.innerHTML=`<div class="generation-live-preview">${previewUrl?`<img src="${escapeHtml(previewUrl)}?v=${encodeURIComponent(state.preview?.updatedAt||state.updatedAt||'')}" alt="Ảnh xem trước"><span>Ảnh xem trước</span>`:`<div class="activity-empty">${escapeHtml(stage)}</div>`}</div><div class="generation-live-copy"><div class="generation-live-head"><strong>${escapeHtml(title)}</strong><small>${info.measured?info.percent+'%':'Đang xử lý'}</small></div><small>${[variants,steps,state.model,state.seed!==undefined?'Seed '+state.seed:'',state.width&&state.height?state.width+' × '+state.height:''].filter(Boolean).map(escapeHtml).join(' · ')}</small><div class="generation-live-bar ${!info.measured&&!done?'indeterminate':''}" role="progressbar" aria-label="Tiến trình tạo ảnh" aria-valuemin="0" aria-valuemax="100" ${info.measured?`aria-valuenow="${info.percent}"`:''}><span style="width:${info.measured?info.percent:35}%"></span></div><div class="generation-live-stats"><span>Đã chạy ${formatDuration(info.elapsed)}</span><span>${done?'Đã kết thúc':'Còn lại (ước tính) '+formatDuration(info.eta)}</span></div>${state.error?`<p class="generation-error">${escapeHtml(state.error)}</p>`:''}<details class="generation-details" ${detailsOpen?'open':''}><summary>Chi tiết</summary><ol class="generation-phases">${phases.map((label,index)=>`<li class="${index<phase?'complete':index===phase?'current':''}">${label}</li>`).join('')}</ol><small>${state.device==='cuda'?'VRAM '+Number(state.currentVramMb||state.peakVramMb||0).toFixed(0)+' MB':'Thiết bị: '+(state.device||'Đang xác định')}</small><ul>${events||'<li>Đang chờ sự kiện xử lý.</li>'}</ul></details><div class="generation-live-actions">${done?`<button type="button" data-inline-result ${!(state.results||[]).length?'disabled':''}>Xem kết quả</button><button type="button" data-inline-close>Đóng</button>`:'<button type="button" class="danger" data-inline-cancel>Hủy an toàn</button>'}</div></div>`;
  const guidance=window.StudioGuidance?.stageHint(state);if(guidance){const paragraph=document.createElement('p');paragraph.className='generation-stage-hint';paragraph.textContent=guidance;target.querySelector('.generation-live-copy')?.append(paragraph);}
  const collapseButton=document.createElement('button');collapseButton.type='button';collapseButton.className='generation-live-toggle';
  const syncCollapse=()=>{const collapsed=target.classList.contains('is-collapsed');collapseButton.textContent=collapsed?'Mở tiến trình':'Thu gọn';collapseButton.setAttribute('aria-expanded',String(!collapsed));collapseButton.setAttribute('aria-label',collapsed?'Mở chi tiết tiến trình':'Thu gọn tiến trình');};
  syncCollapse();collapseButton.addEventListener('click',()=>{target.classList.toggle('is-collapsed');syncCollapse();});
  target.querySelector('.generation-live-head')?.append(collapseButton);
  target.querySelector('[data-inline-cancel]')?.addEventListener('click',()=>cancelActiveJob().catch(error=>deps.setMessage(error.message,'error')));
  target.querySelector('[data-inline-close]')?.addEventListener('click',closeGenerationProgress);
  target.querySelector('[data-inline-result]')?.addEventListener('click',()=>deps.showGenerationResult(state));
}

function renderActivity(state){
  window.MakeupCompare?.update(state);
  window.StudioGuidance?.observeJob(state);
  activityState=state;const center=deps.$('activityCenter');
  const progress=activityProgress(state),percent=Math.round(progress*100),done=['completed','cancelled','failed'].includes(state.status),usesInlineProgress=['inpaint','tryon','outpaint','enhance','makeup','character','text-to-image'].includes(state.taskType);
  center.hidden=usesInlineProgress&&!done;
  if(done&&usesInlineProgress)center.hidden=true;
  center.classList.toggle('done',done);deps.$('activityProgressBar').style.width=`${percent}%`;deps.$('activityPercent').textContent=`${percent}%`;
  const progressInfo=generationProgressInfo(state),elapsed=progressInfo.elapsed,eta=progressInfo.eta;
  deps.$('activityPercent').textContent=progressInfo.measured?`${percent}%`:'Đang xử lý';
  const finalizing=['inpaint-blending','inpaint-texture-recovery','inpaint-structural-refine','inpaint-structural-analysis','inpaint-saving','inpaint-variant-complete'].includes(state.stage);
  const lastUpdate=Date.parse(state.updatedAt||state.startedAt||new Date()),staleSeconds=Math.max(0,(Date.now()-lastUpdate)/1000),stalled=!done&&(state.stalled===true||staleSeconds>=300);
  deps.$('activityElapsed').textContent=formatDuration(elapsed);deps.$('activityEta').textContent=done?'00:00':stalled?'Có thể đã treo':finalizing?'Sắp xong':formatDuration(eta);
  const gpuTotal=Number(state.gpuMemoryMb||0),gpuUsed=Math.min(Number(state.currentVramMb||state.peakVramMb||0),gpuTotal||Infinity);
  deps.$('activityGpu').textContent=state.device==='cuda'?`${gpuUsed.toFixed(0)} / ${gpuTotal.toFixed(0)} MB`:'CPU';
  const stageLabel=state.taskType==='outpaint'&&state.stage==='inpaint-generating'?'Đang mở rộng ảnh':STAGE_LABELS[state.stage]||state.stage||'Đang chuẩn bị';
  deps.$('activityTitle').textContent=done?(state.status==='completed'?'Đã tạo xong các phương án':state.status==='cancelled'?'Đã hủy tác vụ':'Tác vụ gặp lỗi'):stalled?`${stageLabel} · có thể đã treo`:stageLabel;
  const imagePart=state.total?`Ảnh ${Math.min(state.current||1,state.total)}/${state.total}`:'';const seedPart=state.totalSeeds?`Seed ${state.completedSeeds||0}/${state.totalSeeds}`:'';const variantPart=state.totalVariants?`Phương án ${state.currentVariant||1}/${state.totalVariants}`:'';const stepPart=state.totalSteps&&['inpaint-generating','text-generating'].includes(state.stage)?`Bước ${state.currentStep||0}/${state.totalSteps}`:'';
deps.$('activitySubtitle').textContent=[imagePart,variantPart,seedPart,stepPart,done?`${(state.results||[]).length} kết quả`:`${progressInfo.measured?percent+'%':'Đang xử lý'} · ${state.sampleId||''}`].filter(Boolean).join(' · ');
  deps.$('activityCancel').disabled=!activeJobId||done;deps.$('activityClose').hidden=!done;deps.$('activityResultCount').textContent=String((state.results||[]).length);
    const stages=state.taskType==='character'?['character-validating','character-loading','character-processing','character-checking','character-saving','done']:state.taskType==='makeup'?['makeup-detecting','makeup-processing','makeup-saving','done']:state.taskType==='enhance'?['enhance-validating','enhance-model-loading','enhance-processing','enhance-checking','done']:state.taskType==='outpaint'?OUTPAINT_STAGES.filter(stage=>(stage!=='outpaint-seam-repair'||state.seamRepair)&&(stage!=='inpaint-texture-recovery'||(state.detailPass&&!state.materialRefine))&&(stage!=='outpaint-material-refine'||state.materialRefine||state.sourceEnhance)):['inpaint','anatomy-inpaint'].includes(state.taskType)?INPAINT_STAGES:state.taskType==='text-to-image'?TEXT_TO_IMAGE_STAGES:PIPELINE_STAGES;let currentIndex=stages.indexOf(state.stage);if(state.stage==='inpaint-model-release')currentIndex=2;if(state.stage==='inpaint-variant-complete')currentIndex=10;currentIndex=Math.max(0,currentIndex);
  deps.$('activityTimeline').innerHTML=stages.map((stage,index)=>`<div class="activity-stage ${stage===state.stage||(state.stage==='inpaint-model-release'&&stage==='inpaint-model-loading')||(state.stage==='inpaint-variant-complete'&&stage==='inpaint-blending')?'current':''} ${(state.status==='completed'||index<currentIndex)?'complete':''}"><span class="stage-dot"></span><span>${STAGE_LABELS[stage]}</span><span>${stage===state.stage&&!done?'Đang chạy':state.status==='completed'||index<currentIndex?'Hoàn tất':'Chờ'}</span></div>`).join('');
  const results=state.results||[];deps.$('activityResults').innerHTML=results.length?results.slice(-12).reverse().map((item)=>`<article class="live-result"><img src="${escapeHtml(deps.outputUrl(item.file))}" alt="Kết quả ${escapeHtml(item.seed||'')}"><strong>${escapeHtml(item.sampleId?.split('/').pop()||`Seed ${item.seed}`)}</strong><small>${item.seed!==undefined?`Seed ${escapeHtml(item.seed)}`:''}${item.kind==='inpaint'?` · ngoài mask ${(Number(item.outsideMaskMAE||0)*100).toFixed(3)}%`:['text-to-image','outpaint','enhance','makeup','character'].includes(item.kind)?'':` · điểm ${Number(item.qualityScore||0).toFixed(1)}`}</small></article>`).join(''):'<div class="activity-empty">Kết quả sẽ xuất hiện tại đây ngay khi phương án đầu tiên hoàn tất.</div>';
  const events=state.events||[];deps.$('activityLog').innerHTML=events.length?events.slice(-30).reverse().map((event)=>`<div><time>${new Date(event.timestamp).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><span>${escapeHtml(event.message)}</span></div>`).join(''):'<div class="activity-empty">Đang chờ sự kiện đầu tiên…</div>';
  const preview=state.preview?.file||state.preview?.url||results.at(-1)?.file;deps.$('activityPreview').hidden=!preview;if(preview){deps.$('activityPreviewImage').src=`${deps.outputUrl(preview)}?v=${encodeURIComponent(state.preview?.updatedAt||state.updatedAt||'')}`;deps.$('activityPreviewTitle').textContent=done?'Ảnh cuối cùng':'Bản xem trước trực tiếp';deps.$('activityPreviewMeta').textContent=`${stageLabel}${stepPart?` · ${stepPart}`:''}${variantPart?` · ${variantPart}`:''}`;}
  renderGenerationLive(state,progress,elapsed,eta,done);
  deps.renderRunPromptTraces(state);
  if((['inpaint','tryon','outpaint','enhance','makeup','character'].includes(state.taskType)||(state.taskType==='text-to-image'&&deps.studioMode==='chroma'))&&currentAppView==='create'){
    const commandBar=deps.$('studioCommandBar'),primary=deps.$('studioPrimaryAction'),copy=deps.$('studioCommandTitle'),hint=deps.$('studioCommandHint'),status=commandBar?.querySelector('.studio-command-state');
    if(primary&&copy&&hint){const {cancelling,disabled}=generationActionState(state);copy.textContent=done?(state.status==='completed'?'Đã tạo xong':'Tác vụ đã kết thúc'):stageLabel;hint.textContent=done?`${(state.results||[]).length} kết quả · lưu trên máy`:[progressInfo.measured?percent+'%':'Đang xử lý',stepPart].filter(Boolean).join(' · ');primary.disabled=disabled;primary.dataset.command=done?'results':'cancel';primary.textContent=done?'Xem kết quả':cancelling?'Đang hủy…':'Hủy';primary.classList.toggle('danger',!done);status?.classList.toggle('ready',done&&state.status==='completed');}
    const commandNeedsAttention=state.status==='failed'||stalled;
    commandBar?.classList.toggle('is-running',!done&&!commandNeedsAttention);commandBar?.classList.toggle('is-complete',state.status==='completed');commandBar?.style.setProperty('--command-progress',`${progressInfo.measured?percent:0}%`);
    deps.updateStudioCommandVisibility(`job:${state.jobId}:${commandNeedsAttention?'attention':done?state.status:'running'}`,{attention:commandNeedsAttention,error:state.status==='failed',collapseNow:false,collapseAfter:0});
    if(commandBar?.classList.contains('is-collapsed'))deps.setStudioCommandCollapsed(true);
  }
  updateProgressVisibility();
}

async function pollJobStatus() {
  if (!activeJobId) return;
  const jobId=activeJobId;
  const response=await fetch('/api/job-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId})});
  const state=await response.json();
  if(activeJobId!==jobId||!response.ok||!state.ok)return;
  applyJobState(state);
}

async function settleJob(jobId, fallbackStatus='completed', error=''){
  let state=null;
  try{const response=await fetch('/api/job-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId})});const result=await response.json();if(response.ok&&result.ok)state=result;}catch{}
  if(!state||!['completed','cancelled','failed'].includes(state.status))state={...(activityState||{}),jobId,status:fallbackStatus,stage:fallbackStatus==='completed'?'done':fallbackStatus,error,updatedAt:new Date().toISOString()};
  renderActivity(state);
  globalThis.QualityLearning?.notifyJob(state);
  if(jobPollTimer){clearInterval(jobPollTimer);jobPollTimer=null;}if(jobEventSource){jobEventSource.close();jobEventSource=null;}if(activityClockTimer){clearInterval(activityClockTimer);activityClockTimer=null;}
  localStorage.removeItem('activeJobId');if(activeJobId===jobId)activeJobId='';
  deps.$('cancelJobButton').disabled=true;deps.$('resumeJobButton').disabled=state.status!=='interrupted'||!state.resumable;deps.$('jobProgress').hidden=true;
}

function applyJobState(state){
  if(!state.ok||state.status==='unknown'||(state.jobId&&state.jobId!==activeJobId))return;
  state={...(activityState||{}),...state};
  renderActivity(state);
  globalThis.QualityLearning?.notifyJob(state);
  const completed=Number(state.completedSeeds||state.current||0), total=Number(state.totalSeeds||state.total||0);
  if(total){deps.$('jobProgress').max=total;deps.$('jobProgress').value=Math.min(completed,total);}
  const detail=state.sampleId?` · ${state.sampleId}`:state.seed!==undefined?` · seed ${state.seed}`:'';
  deps.setMessage(`Tác vụ ${state.status} · ${state.stage||'đang chuẩn bị'}${detail}`);
  deps.$('resumeJobButton').disabled=!(state.status==='interrupted'&&state.resumable);
  if(['completed','cancelled','failed'].includes(state.status)){if(jobPollTimer){clearInterval(jobPollTimer);jobPollTimer=null;}jobEventSource?.close();jobEventSource=null;localStorage.removeItem('activeJobId');activeJobId='';}
}

async function resumeActiveJob() {
  if(!activeJobId)return deps.setMessage('Không có tác vụ bị gián đoạn để tiếp tục.', 'error');
  deps.setMessage('Đang tiếp tục tác vụ từ ảnh chưa hoàn tất gần nhất…');
  const response=await fetch('/api/resume-job',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:activeJobId})});
  const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tiếp tục tác vụ');
  deps.setMessage(`Đã tiếp tục và hoàn tất ${result.completed}/${result.requested} ảnh.`, 'success');
  setActiveJob('');
}

async function cancelActiveJob() {
  if (!activeJobId) return deps.setMessage('Không có tác vụ đang chạy để hủy.', 'error');
  const cancellingJobId=activeJobId;
  deps.$('cancelJobButton').disabled=true;deps.$('activityCancel').disabled=true;
  const response = await fetch('/api/cancel-job', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({jobId:cancellingJobId})});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể gửi yêu cầu hủy');
  const nextState={...activityState,jobId:cancellingJobId,status:result.status||'cancelling',stage:result.status==='cancelled'?'cancelled':(activityState.stage||'preparing'),cancelRequested:true,updatedAt:new Date().toISOString()};
  renderActivity(nextState);
  deps.setMessage(result.status==='cancelled'?'Tác vụ đã được hủy an toàn.':'Đã yêu cầu hủy; hệ thống sẽ dừng tại điểm an toàn gần nhất.','success');
  await pollJobStatus().catch(()=>{});
}

function jobStatusLabel(status){return({running:'Đang chạy',cancelling:'Đang dừng',interrupted:'Gián đoạn',completed:'Hoàn tất',cancelled:'Đã hủy',failed:'Thất bại',queued:'Chờ xử lý'})[status]||status||'Không xác định';}

function jobProgress(job){if(['enhance','makeup','character'].includes(job.taskType))return{current:Number(job.completedSteps||0),total:Number(job.totalWorkSteps||0),percent:job.status==='completed'?100:Math.min(95,Math.round(10+80*Number(job.completedSteps||0)/Math.max(1,Number(job.totalWorkSteps||1))))};if(job.taskType==='text-to-image')return{current:Number(job.completedSteps||0),total:Number(job.totalWorkSteps||0),percent:generationProgressInfo(job).percent};if(job.taskType==='outpaint')return{current:Number(job.currentVariant||0),total:Number(job.totalVariants||0),percent:generationProgressInfo(job).percent};const current=Number(job.current||job.completedSeeds||0),total=Number(job.total||job.totalSeeds||0);if(job.status==='completed')return{current,total,percent:100};if(['inpaint','anatomy-inpaint'].includes(job.taskType)){const phase={'inpaint-validating':3,'inpaint-preparing-mask':8,'inpaint-model-loading':11,'inpaint-model-release':13,'inpaint-model-disk':16,'inpaint-model-gpu':21,'inpaint-model-ready':25,'inpaint-blending':90,'inpaint-texture-recovery':93,'inpaint-structural-refine':95,'inpaint-structural-analysis':95,'inpaint-variant-complete':97,'inpaint-saving':98,failed:100,cancelled:100};const percent=job.stage==='inpaint-generating'&&job.totalWorkSteps?25+Math.round(65*Number(job.completedSteps||0)/Number(job.totalWorkSteps)):phase[job.stage]??0;return{current:job.currentVariant||1,total:job.totalVariants||1,percent:Math.max(0,Math.min(99,percent))};}return{current,total,percent:total?Math.max(0,Math.min(100,Math.round(current/total*100))):0};}

async function runJobAction(action,jobId,button){button.disabled=true;try{if(action==='results'){const response=await fetch('/api/job-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId})}),state=await response.json();if(!response.ok||!state.ok)throw new Error(state.error||'Không thể mở kết quả đã lưu.');deps.showGenerationResult(state);return;}if(action==='resume'){setActiveJob(jobId);await resumeActiveJob();}else if(action==='cancel'){setActiveJob(jobId);await cancelActiveJob();}await loadJobsOverview();}catch(error){deps.setMessage(error.message,'error');button.disabled=false;}}

async function loadJobsOverview(){
  const root=deps.$('jobsOverview');if(!root)return;
  try{
    const response=await fetch('/api/jobs'),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc danh sách tác vụ');
    const jobs=result.jobs||[],running=jobs.filter((job)=>['running','cancelling'].includes(job.status)),interrupted=jobs.filter((job)=>job.status==='interrupted'),completed=jobs.filter((job)=>job.status==='completed'),failed=jobs.filter((job)=>['failed','cancelled'].includes(job.status));
    const attention=running.length+interrupted.length+failed.filter(job=>job.status==='failed').length;
    const summaryTitle=running.length?`${running.length} tác vụ đang xử lý`:interrupted.length?`${interrupted.length} tác vụ đang chờ tiếp tục`:'Mọi tác vụ đã ổn định';
    root.innerHTML=`<section class="jobs-command"><div class="jobs-command-status"><span class="live-dot ${running.length?'active':''}"></span><div><span class="card-kicker">TRẠNG THÁI HỆ THỐNG</span><strong>${summaryTitle}</strong><small>${attention?`${attention} mục cần theo dõi`:'Không có việc cần xử lý'} · cập nhật ${new Date().toLocaleTimeString('vi-VN')}</small></div></div><div class="jobs-command-actions">${interrupted[0]?`<button class="primary" data-job-action="resume" data-job-id="${escapeHtml(interrupted[0].jobId)}">Tiếp tục tác vụ</button>`:''}<button data-jobs-refresh aria-label="Làm mới danh sách tác vụ">↻ Làm mới</button></div></section>
      <section class="jobs-kpis" aria-label="Tổng quan tác vụ"><article class="active"><span>ĐANG CHẠY</span><strong>${running.length}</strong></article><article><span>GIÁN ĐOẠN</span><strong>${interrupted.length}</strong></article><article><span>HOÀN TẤT</span><strong>${completed.length}</strong></article><article class="${failed.length?'warning':''}"><span>LỖI / ĐÃ HỦY</span><strong>${failed.length}</strong></article></section>
      <section class="jobs-main"><div class="section-heading jobs-list-heading"><div><span class="card-kicker">LỊCH SỬ XỬ LÝ</span><h2>Tất cả tác vụ</h2></div><div class="jobs-filters" role="group" aria-label="Lọc tác vụ"><button class="is-selected" data-job-filter="all" aria-pressed="true">Tất cả <span>${jobs.length}</span></button><button data-job-filter="attention" aria-pressed="false">Cần chú ý <span>${attention}</span></button><button data-job-filter="completed" aria-pressed="false">Hoàn tất <span>${completed.length}</span></button></div></div><div class="jobs-list">${jobs.map((job)=>{const progress=jobProgress(job),active=['running','cancelling'].includes(job.status),needsAttention=active||job.status==='interrupted'||job.status==='failed';return `<article class="job-card ${active?'is-active':''}" data-job-group="${job.status==='completed'?'completed':needsAttention?'attention':'other'}"><div class="job-status-rail"><span class="job-state ${escapeHtml(job.status)}">${escapeHtml(jobStatusLabel(job.status))}</span></div><div class="job-body"><div class="job-head"><div><strong>${escapeHtml(STAGE_LABELS[job.stage]||job.stage||'Tác vụ xử lý ảnh')}</strong><small>${escapeHtml(job.jobId)}</small></div><time>${job.updatedAt?new Date(job.updatedAt).toLocaleString('vi-VN'):'—'}</time></div><div class="job-progress-row"><div class="job-progress" role="progressbar" aria-valuenow="${progress.percent}" aria-valuemin="0" aria-valuemax="100"><i style="width:${progress.percent}%"></i></div><strong>${progress.percent}%</strong></div><div class="job-foot"><small>${[job.sampleId,progress.total?`${progress.current}/${progress.total} mục`:null,job.seed?`seed ${job.seed}`:null].filter(Boolean).map(escapeHtml).join(' · ')||'Chưa có thông tin tiến độ'}</small><div>${job.status==='interrupted'&&job.resumable?`<button class="primary" data-job-action="resume" data-job-id="${escapeHtml(job.jobId)}">Tiếp tục</button>`:''}${active?`<button class="danger" data-job-action="cancel" data-job-id="${escapeHtml(job.jobId)}">Dừng an toàn</button>`:''}</div></div></div></article>`;}).join('')||'<div class="jobs-empty"><span aria-hidden="true">✓</span><strong>Chưa có hoạt động</strong><p>Tác vụ tạo và chỉnh sửa ảnh sẽ xuất hiện tại đây.</p></div>'}</div></section>
      <details class="jobs-maintenance"><summary><span><span class="card-kicker">QUẢN LÝ DỮ LIỆU</span><strong>Checkpoint và tác vụ cũ</strong></span><span aria-hidden="true">⌄</span></summary><div><p>Xóa trạng thái của tác vụ đã hoàn tất hoặc đã hủy. Ảnh và báo cáo vẫn được giữ nguyên.</p><button data-jobs-cleanup>Dọn checkpoint cũ</button></div></details>`;
    window.WorkQueue?.render(root).catch(error=>deps.setMessage(error.message,'error'));
    root.querySelectorAll('.jobs-list .job-card').forEach((card,index)=>{const job=jobs[index];if(['outpaint','text-to-image','enhance','makeup','character'].includes(job.taskType)&&(job.comparison||(job.results||[]).some(item=>item.file||item.image))){const button=document.createElement('button');button.textContent=job.comparison?'Mở bảng so sánh':job.taskType==='character'?'Xem tư thế & biểu cảm':job.taskType==='makeup'?'Xem ảnh trang điểm':job.taskType==='enhance'?'Xem ảnh cải thiện':job.taskType==='text-to-image'?'Xem ảnh đã tạo':'Xem ảnh mở rộng';button.dataset.jobAction='results';button.dataset.jobId=job.jobId;card.querySelector('.job-foot>div').append(button);}});
    root.querySelector('[data-jobs-refresh]')?.addEventListener('click',loadJobsOverview);for(const button of root.querySelectorAll('[data-job-action]'))button.addEventListener('click',()=>runJobAction(button.dataset.jobAction,button.dataset.jobId,button));for(const filter of root.querySelectorAll('[data-job-filter]'))filter.addEventListener('click',()=>{for(const button of root.querySelectorAll('[data-job-filter]')){const selected=button===filter;button.classList.toggle('is-selected',selected);button.setAttribute('aria-pressed',String(selected));}for(const card of root.querySelectorAll('[data-job-group]'))card.hidden=filter.dataset.jobFilter!=='all'&&card.dataset.jobGroup!==filter.dataset.jobFilter;});root.querySelector('[data-jobs-cleanup]')?.addEventListener('click',async()=>{await deps.cleanupOldJobs();await loadJobsOverview();});
  }catch(error){root.innerHTML=`<section class="jobs-live error"><div><span class="live-dot"></span><div><strong>Không thể tải tác vụ</strong><small>${escapeHtml(readableRequestError(error))}</small></div></div><button data-jobs-refresh>Thử lại</button></section>`;root.querySelector('[data-jobs-refresh]')?.addEventListener('click',loadJobsOverview);}
}

function startJobsLiveUpdates(){clearInterval(jobsRefreshTimer);loadJobsOverview();jobsRefreshTimer=setInterval(()=>{if(!deps.$('hubView').hidden&&deps.$('jobsOverview'))loadJobsOverview();},3000);}
return {bindings:{get activeJobId(){return activeJobId;},set activeJobId(value){activeJobId=value;},
get jobPollTimer(){return jobPollTimer;},set jobPollTimer(value){jobPollTimer=value;},
get jobEventSource(){return jobEventSource;},set jobEventSource(value){jobEventSource=value;},
get activityState(){return activityState;},set activityState(value){activityState=value;},
get activityClockTimer(){return activityClockTimer;},set activityClockTimer(value){activityClockTimer=value;},
get setActiveJob(){return setActiveJob;},set setActiveJob(value){setActiveJob=value;},
get connectJobStream(){return connectJobStream;},set connectJobStream(value){connectJobStream=value;},
get STAGE_LABELS(){return STAGE_LABELS;},set STAGE_LABELS(value){STAGE_LABELS=value;},
get PIPELINE_STAGES(){return PIPELINE_STAGES;},set PIPELINE_STAGES(value){PIPELINE_STAGES=value;},
get INPAINT_STAGES(){return INPAINT_STAGES;},set INPAINT_STAGES(value){INPAINT_STAGES=value;},
get OUTPAINT_STAGES(){return OUTPAINT_STAGES;},set OUTPAINT_STAGES(value){OUTPAINT_STAGES=value;},
get TEXT_TO_IMAGE_STAGES(){return TEXT_TO_IMAGE_STAGES;},set TEXT_TO_IMAGE_STAGES(value){TEXT_TO_IMAGE_STAGES=value;},
get escapeHtml(){return escapeHtml;},set escapeHtml(value){escapeHtml=value;},
get readableRequestError(){return readableRequestError;},set readableRequestError(value){readableRequestError=value;},
get formatDuration(){return formatDuration;},set formatDuration(value){formatDuration=value;},
get dismissedProgressJobs(){return dismissedProgressJobs;},set dismissedProgressJobs(value){dismissedProgressJobs=value;},
get currentAppView(){return currentAppView;},set currentAppView(value){currentAppView=value;},
get activityProgress(){return activityProgress;},set activityProgress(value){activityProgress=value;},
get generationProgressInfo(){return generationProgressInfo;},set generationProgressInfo(value){generationProgressInfo=value;},
get closeGenerationProgress(){return closeGenerationProgress;},set closeGenerationProgress(value){closeGenerationProgress=value;},
get generationActionState(){return generationActionState;},set generationActionState(value){generationActionState=value;},
get updateProgressVisibility(){return updateProgressVisibility;},set updateProgressVisibility(value){updateProgressVisibility=value;},
get renderGenerationLive(){return renderGenerationLive;},set renderGenerationLive(value){renderGenerationLive=value;},
get renderActivity(){return renderActivity;},set renderActivity(value){renderActivity=value;},
get pollJobStatus(){return pollJobStatus;},set pollJobStatus(value){pollJobStatus=value;},
get settleJob(){return settleJob;},set settleJob(value){settleJob=value;},
get applyJobState(){return applyJobState;},set applyJobState(value){applyJobState=value;},
get resumeActiveJob(){return resumeActiveJob;},set resumeActiveJob(value){resumeActiveJob=value;},
get cancelActiveJob(){return cancelActiveJob;},set cancelActiveJob(value){cancelActiveJob=value;},
get jobsRefreshTimer(){return jobsRefreshTimer;},set jobsRefreshTimer(value){jobsRefreshTimer=value;},
get jobStatusLabel(){return jobStatusLabel;},set jobStatusLabel(value){jobStatusLabel=value;},
get jobProgress(){return jobProgress;},set jobProgress(value){jobProgress=value;},
get runJobAction(){return runJobAction;},set runJobAction(value){runJobAction=value;},
get loadJobsOverview(){return loadJobsOverview;},set loadJobsOverview(value){loadJobsOverview=value;},
get startJobsLiveUpdates(){return startJobsLiveUpdates;},set startJobsLiveUpdates(value){startJobsLiveUpdates=value;}},steps:[
function initialize(){
(activeJobId = '');
},
function initialize(){
(jobPollTimer = null);
},
function initialize(){
(jobEventSource = null);
},
function initialize(){
(activityState = null);
},
function initialize(){
(activityClockTimer = null);
},
function initialize(){
(STAGE_LABELS = {preparing:'Chuẩn bị dữ liệu','batch-preparing':'Chuẩn bị hàng loạt','detecting-people':'Phát hiện nhân vật','creating-mask':'Tạo vùng trang phục','loading-model':'Nạp model AI',preview:'Tạo bản xem nhanh',result:'Tạo ảnh chất lượng cao',retry:'Thử phương án bổ sung','generative-seam-refine':'Sửa đường biên','batch-item':'Xử lý ảnh','batch-item-complete':'Hoàn tất một ảnh',scoring:'Chấm điểm chất lượng',saving:'Lưu kết quả','inpaint-validating':'Kiểm tra ảnh và mask','inpaint-preparing-mask':'Chuẩn bị mask và crop','inpaint-model-loading':'Kiểm tra model Inpainting','inpaint-model-release':'Giải phóng bộ nhớ model','inpaint-model-disk':'Đọc model từ ổ đĩa','inpaint-model-gpu':'Đưa model lên GPU','inpaint-model-ready':'Model đã sẵn sàng','inpaint-generating':'Tạo phương án Inpainting','inpaint-blending':'Ghép biên ảnh','inpaint-texture-recovery':'Phục hồi chi tiết ảnh','inpaint-structural-refine':'Tinh chỉnh cấu trúc ảnh','inpaint-structural-analysis':'Kiểm tra cấu trúc ảnh','inpaint-variant-complete':'Hoàn tất một phương án','inpaint-saving':'Lưu kết quả','text-validating':'Kiểm tra mô tả và cấu hình','text-model-loading':'Nạp model tạo ảnh','text-generating':'Khử nhiễu và tạo ảnh','text-decoding':'Giải mã ảnh','text-saving':'Lưu ảnh và metadata','done':'Hoàn tất','failed':'Thất bại','cancelled':'Đã hủy','restart-required':'Cần tiếp tục'});
},
function initialize(){
STAGE_LABELS['reconstructing-body-mask']='Chuẩn bị tái tạo phần cơ thể mới lộ ra';
},
function initialize(){
STAGE_LABELS['repairing-exposed-arms']='Sửa vùng tay mới lộ ra';
},
function initialize(){
Object.assign(STAGE_LABELS,{'enhance-validating':'Kiểm tra ảnh và vùng xử lý','enhance-model-loading':'Nạp model cải thiện ảnh','enhance-processing':'Cải thiện chi tiết','enhance-checking':'Kiểm tra vùng bảo vệ và lưu ảnh'});
},
function initialize(){
STAGE_LABELS['outpaint-seam-repair']='Sửa đường nối nền và trang phục';
},
function initialize(){
STAGE_LABELS['outpaint-material-refine']='Phục hồi vải và hoàn thiện ảnh';
},
function initialize(){
STAGE_LABELS['outpaint-layout-ready']='Ghép bố cục mở rộng';
},
function initialize(){
(PIPELINE_STAGES = ['preparing','detecting-people','creating-mask','reconstructing-body-mask','loading-model','preview','result','retry','generative-seam-refine','scoring','saving','done']);
},
function initialize(){
(INPAINT_STAGES = ['inpaint-validating','inpaint-preparing-mask','inpaint-model-loading','inpaint-model-disk','inpaint-model-gpu','inpaint-model-ready','inpaint-generating','inpaint-blending','inpaint-texture-recovery','inpaint-structural-refine','inpaint-structural-analysis','inpaint-saving','done']);
},
function initialize(){
(OUTPAINT_STAGES = ['inpaint-validating','inpaint-model-loading','inpaint-generating','outpaint-layout-ready','outpaint-seam-repair','inpaint-texture-recovery','outpaint-material-refine','inpaint-blending','done']);
},
function initialize(){
(TEXT_TO_IMAGE_STAGES = ['text-validating','text-model-loading','text-generating','text-decoding','text-saving','done']);
},
function initialize(){
(escapeHtml = (value)=>String(value??'').replace(/[&<>'"]/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])));
},
function initialize(){
(readableRequestError = (error)=>/failed to fetch|networkerror|load failed/i.test(String(error?.message||error))?'Dịch vụ cục bộ chưa phản hồi. Hãy mở lại ứng dụng hoặc nhấn Thử lại.':String(error?.message||error||'Đã xảy ra lỗi'));
},
function initialize(){
(formatDuration = (seconds)=>{if(!Number.isFinite(seconds)||seconds<0)return 'Đang tính';const rounded=Math.round(seconds);return `${String(Math.floor(rounded/60)).padStart(2,'0')}:${String(rounded%60).padStart(2,'0')}`;});
},
function initialize(){
(dismissedProgressJobs = new Set());
},
function initialize(){
(currentAppView = 'create');
},
function initialize(){
(jobsRefreshTimer = null);
}
]};
};
