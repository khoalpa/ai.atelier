const $ = (id) => document.getElementById(id);
const canvas = $('editorCanvas');
const ctx = canvas.getContext('2d');
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
const protectCanvas = document.createElement('canvas');
const protectCtx = protectCanvas.getContext('2d', { willReadFrequently: true });
const manualProtectCanvas = document.createElement('canvas');
const manualProtectCtx = manualProtectCanvas.getContext('2d', { willReadFrequently: true });

let images = [];
let current = null;
let sourceImage = null;
let drawing = false;
let tool = 'add';
let lastPoint = null;
let history = [];
let aiPoints = [];
let currentRunDirectory = '';
let studioSelectedResult = '';
let studioPendingResult = '';
let studioViewingResult = '';
let libraryFilter = 'all';
const librarySelected = new Set();
let libraryAssets = [];
let garmentDataUrl = '';
let detectedPeople = [];
let reviewState = {items:{}};
let auditItems = [];
let activeJobId = '';
let jobPollTimer = null;
let jobEventSource = null;
let guidedReviewItems = [];
let guidedReviewIndex = 0;
let activityState = null;
let activityClockTimer = null;
let studioCommandCollapseTimer = null;
let studioCommandAutoKey = '';
let studioCommandManuallyCollapsed = false;
const MAX_HISTORY = 20;
const reviewKey=(category,sampleId)=>`${category}:${sampleId}`;
const currentReview=(sampleId,category=$('garmentCategory').value)=>reviewState.items[reviewKey(category,sampleId)]||{};

function createJobId(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

const SEED_MAX = 2147483647;
function randomSeed(){const values=new Uint32Array(1);globalThis.crypto?.getRandomValues?.(values);return Number((values[0]||Math.floor(Math.random()*SEED_MAX))%SEED_MAX);}
function setupSeedControl(id){
  const input=$(id),mode=$(`${id}Mode`),randomButton=$(`${id}Random`),resetButton=$(`${id}Reset`);if(!input||!mode)return;
  const defaultSeed=Number(input.dataset.defaultSeed),storageKey=`atelier.${id}.mode`,saved=localStorage.getItem(storageKey);
  if(['default','random','custom'].includes(saved))mode.value=saved;
  const sync=()=>{input.disabled=mode.value!=='custom';if(mode.value==='default')input.value=String(defaultSeed);input.title=mode.value==='random'?'Seed mới sẽ được tạo khi bắt đầu tác vụ.':'';localStorage.setItem(storageKey,mode.value);};
  mode.addEventListener('change',sync);
  input.addEventListener('input',()=>{mode.value='custom';sync();});
  randomButton?.addEventListener('click',()=>{mode.value='custom';input.value=String(randomSeed());sync();});
  resetButton?.addEventListener('click',()=>{mode.value='default';sync();});
  sync();
}
function seedForRun(id){
  const input=$(id),mode=$(`${id}Mode`);if(!input||!mode)throw new Error('Thiếu thiết lập seed');
  if(mode.value==='random')input.value=String(randomSeed());
  const seed=Number(input.value);if(!Number.isSafeInteger(seed)||seed<0||seed>SEED_MAX)throw new Error(`Seed phải là số nguyên từ 0 đến ${SEED_MAX}.`);
  return seed;
}
function setCustomSeed(id,seed){const input=$(id),mode=$(`${id}Mode`);input.value=String(seed);if(mode){mode.value='custom';mode.dispatchEvent(new Event('change'));}}

function setActiveJob(jobId) {
  activeJobId = jobId;
  window.AtelierStore?.set({activeJobId:jobId||''});
  if (jobId) {
    localStorage.setItem('activeJobId', jobId);
    activityState={jobId,taskType:studioMode==='chroma'?'text-to-image':studioMode,status:'running',stage:'preparing',startedAt:new Date().toISOString(),events:[],results:[]};
    renderActivity(activityState);
  } else localStorage.removeItem('activeJobId');
  $('cancelJobButton').disabled = !jobId;
  $('resumeJobButton').disabled = !jobId;
  $('jobProgress').hidden = !jobId;
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

const STAGE_LABELS={preparing:'Chuẩn bị dữ liệu','batch-preparing':'Chuẩn bị hàng loạt','detecting-people':'Phát hiện nhân vật','creating-mask':'Tạo vùng trang phục','loading-model':'Nạp model AI',preview:'Tạo bản xem nhanh',result:'Tạo ảnh chất lượng cao',retry:'Thử phương án bổ sung','generative-seam-refine':'Sửa đường biên','batch-item':'Xử lý ảnh','batch-item-complete':'Hoàn tất một ảnh',scoring:'Chấm điểm chất lượng',saving:'Lưu kết quả','inpaint-validating':'Kiểm tra ảnh và mask','inpaint-preparing-mask':'Chuẩn bị mask và crop','inpaint-model-loading':'Kiểm tra model Inpainting','inpaint-model-release':'Giải phóng bộ nhớ model','inpaint-model-disk':'Đọc model từ ổ đĩa','inpaint-model-gpu':'Đưa model lên GPU','inpaint-model-ready':'Model đã sẵn sàng','inpaint-generating':'Tạo phương án Inpainting','inpaint-blending':'Ghép biên ảnh','inpaint-texture-recovery':'Phục hồi chi tiết ảnh','inpaint-structural-refine':'Tinh chỉnh cấu trúc ảnh','inpaint-structural-analysis':'Kiểm tra cấu trúc ảnh','inpaint-variant-complete':'Hoàn tất một phương án','inpaint-saving':'Lưu kết quả','text-validating':'Kiểm tra mô tả và cấu hình','text-model-loading':'Nạp model tạo ảnh','text-generating':'Khử nhiễu và tạo ảnh','text-decoding':'Giải mã ảnh','text-saving':'Lưu ảnh và metadata','done':'Hoàn tất','failed':'Thất bại','cancelled':'Đã hủy','restart-required':'Cần tiếp tục'};
STAGE_LABELS['reconstructing-body-mask']='Chuẩn bị tái tạo phần cơ thể mới lộ ra';
STAGE_LABELS['repairing-exposed-arms']='Sửa vùng tay mới lộ ra';
Object.assign(STAGE_LABELS,{'enhance-validating':'Kiểm tra ảnh và vùng xử lý','enhance-model-loading':'Nạp model cải thiện ảnh','enhance-processing':'Cải thiện chi tiết','enhance-checking':'Kiểm tra vùng bảo vệ và lưu ảnh'});
STAGE_LABELS['outpaint-seam-repair']='Sửa đường nối nền và trang phục';
STAGE_LABELS['outpaint-material-refine']='Phục hồi vải và hoàn thiện ảnh';
STAGE_LABELS['outpaint-layout-ready']='Ghép bố cục mở rộng';
const PIPELINE_STAGES=['preparing','detecting-people','creating-mask','reconstructing-body-mask','loading-model','preview','result','retry','generative-seam-refine','scoring','saving','done'];
const INPAINT_STAGES=['inpaint-validating','inpaint-preparing-mask','inpaint-model-loading','inpaint-model-disk','inpaint-model-gpu','inpaint-model-ready','inpaint-generating','inpaint-blending','inpaint-texture-recovery','inpaint-structural-refine','inpaint-structural-analysis','inpaint-saving','done'];
const OUTPAINT_STAGES=['inpaint-validating','inpaint-model-loading','inpaint-generating','outpaint-layout-ready','outpaint-seam-repair','inpaint-texture-recovery','outpaint-material-refine','inpaint-blending','done'];
const TEXT_TO_IMAGE_STAGES=['text-validating','text-model-loading','text-generating','text-decoding','text-saving','done'];
const escapeHtml=(value)=>String(value??'').replace(/[&<>'"]/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const readableRequestError=(error)=>/failed to fetch|networkerror|load failed/i.test(String(error?.message||error))?'Dịch vụ cục bộ chưa phản hồi. Hãy mở lại ứng dụng hoặc nhấn Thử lại.':String(error?.message||error||'Đã xảy ra lỗi');
const formatDuration=(seconds)=>{if(!Number.isFinite(seconds)||seconds<0)return 'Đang tính';const rounded=Math.round(seconds);return `${String(Math.floor(rounded/60)).padStart(2,'0')}:${String(rounded%60).padStart(2,'0')}`;};

function downloadFullSizeImage(image){
  const source=image?.currentSrc||image?.src;
  if(!source||!image.naturalWidth)return;
  const url=new URL(source,document.baseURI);
  if(!['http:','https:','data:','blob:'].includes(url.protocol))return;
  let filename='ai-atelier-anh-goc.png';
  if(['http:','https:'].includes(url.protocol)){
    try{filename=decodeURIComponent(url.pathname.split('/').pop())||filename;}catch{}
  }else if(url.protocol==='data:'){
    const format=source.match(/^data:image\/(png|jpeg|webp);/i)?.[1]?.toLowerCase();
    if(format)filename=`ai-atelier-anh-goc.${format==='jpeg'?'jpg':format}`;
  }
  const link=document.createElement('a');
  link.href=source;
  link.download=filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_');
  document.body.appendChild(link);link.click();link.remove();
}

function openImageAtFullSize(source, alt='Ảnh phóng to'){
  if(!source)return;
  const dialog=$('imageViewerDialog'),image=$('imageViewerImage');
  loadImagePromptTrace(source);
  $('imageViewerTitle').textContent=alt||'Ảnh ở kích thước 100%';
  $('imageViewerMeta').textContent='Đang tải ảnh ở kích thước gốc…';
  $('saveViewerImageButton').disabled=true;
  image.alt=alt||'Ảnh phóng to';
  image.style.maxWidth='none';
  image.style.maxHeight='none';
  $('toggleViewerFitButton').textContent='Xem toàn ảnh';
  $('toggleViewerFitButton').setAttribute('aria-pressed','false');
  image.src=source;
  if(!dialog.open)dialog.showModal();
}

document.addEventListener('dblclick',(event)=>{
  const image=event.target;
  if(image===canvas&&sourceImage){
    event.preventDefault();
    restoreCanvasBeforeDoubleClick();
    openImageAtFullSize(sourceImage.currentSrc||sourceImage.src,'Ảnh nguồn · 100%');
    return;
  }
  if(!(image instanceof HTMLImageElement)||image.id==='imageViewerImage'||!image.currentSrc)return;
  event.preventDefault();
  openImageAtFullSize(image.currentSrc,image.alt||'Ảnh ở kích thước 100%');
});

const dismissedProgressJobs=new Set();
let currentAppView='create';
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
  for(const id of ['activityCenter','editorLiveProgress','chromaLiveProgress'])$(id).hidden=true;
  setMessage('Đã đóng thông báo tác vụ. Kết quả vẫn còn trong Thư viện và Hàng duyệt.','success');
}
let imagePromptRequest=0;
async function loadImagePromptTrace(source){
  const host=$('imagePromptTrace'),request=++imagePromptRequest;
  if(!host)return;
  host.hidden=true;
  if(!String(source).startsWith('/outputs/'))return;
  try{const response=await fetch('/api/output-prompts?file='+encodeURIComponent(source.slice('/outputs/'.length))),data=await response.json();if(request!==imagePromptRequest)return;if(!response.ok||!data.ok)return;renderPromptTrace(host,{jobId:source,promptHistory:data.promptHistory||[]});}catch{}
}
function promptTraceMarkup(history){
  const strategy={direct:'Áp dụng trực tiếp','merged-into-positive':'Ghép vào prompt chính',unused:'Không áp dụng negative prompt riêng trong lần gọi này'};
  return history.map((entry,index)=>`<article class="prompt-trace-entry"><h4>Lần gọi ${index+1} · ${escapeHtml(STAGE_LABELS[entry.stage]||entry.stage)}${entry.autoRetry?' · Tự thử lại':''}</h4><small>${escapeHtml(entry.model)} · Seed ${escapeHtml(entry.seed??'—')} · ${escapeHtml(entry.timestamp)}${entry.sampleId?' · '+escapeHtml(entry.sampleId):''}</small><p>Negative prompt: ${escapeHtml(strategy[entry.negativePromptStrategy]||'Chưa xác định')}</p>${Object.entries(entry.tokenBudget||{}).map(([key,budget])=>`<p>${escapeHtml(key==='prompt'?'CLIP':key==='prompt_2'?'T5':key)}: ${escapeHtml((budget.tokens||[]).join(', '))} / ${escapeHtml(budget.limit)} token</p>`).join('')}${entry.resolvedSources?.clipSummaryShortened?'<p>CLIP dùng bản tóm tắt; T5 giữ nguyên hướng dẫn đầy đủ.</p>':''}${Object.keys(entry.prompts||{}).length?Object.entries(entry.prompts).map(([key,value])=>`<strong>${escapeHtml(key)}</strong><pre>${escapeHtml(Array.isArray(value)?value.join('\n'):String(value??''))}</pre>`).join(''):'<p>Bước này không sử dụng prompt văn bản.</p>'}<details><summary>Nguồn tạo prompt và cấu hình</summary><strong>Prompt người dùng</strong><pre>${escapeHtml(entry.userPrompt||'(Trống)')}</pre><strong>Negative prompt người dùng</strong><pre>${escapeHtml(entry.userNegativePrompt||'(Trống)')}</pre><pre>${escapeHtml(JSON.stringify({sources:entry.sources,resolvedSources:entry.resolvedSources,parameters:entry.parameters,pipeline:entry.pipeline},null,2))}</pre></details></article>`).join('');
}
function renderPromptTrace(host,state){
  if(!host)return;
  const history=state.promptHistory||[],signature=JSON.stringify([state.jobId,history]);
  host.hidden=false;
  if(host.dataset.traceSignature===signature)return;
  const previous=host.querySelector('details');
  const open=previous?previous.open:host.id==='editorPromptTrace'||host.id==='chromaPromptTrace';
  host.dataset.traceSignature=signature;
  host.hidden=false;
  const latest=history.at(-1);
  host.innerHTML=`<details class="prompt-trace" ${open?'open':''}><summary>Prompt đang dùng · ${latest?'Seed '+escapeHtml(latest.seed??'—'):'Đang chuẩn bị'}</summary><div class="button-row"><button type="button" data-trace-expand>Xem rộng</button><button type="button" data-trace-copy ${history.length?'':'disabled'}>Sao chép</button><button type="button" data-trace-download ${history.length?'':'disabled'}>Tải chi tiết JSON</button></div><div class="prompt-trace-content">${latest?promptTraceMarkup([latest]):'<p>Chưa ghi nhận lần gọi model nào.</p>'}${history.length>1?`<details><summary>Các lần gọi trước (${history.length-1})</summary>${promptTraceMarkup(history.slice(0,-1))}</details>`:''}</div></details>`;
  host.querySelector('[data-trace-expand]').onclick=()=>{
    const dialog=document.createElement('dialog');dialog.className='prompt-reader-dialog';
    dialog.innerHTML='<div class="prompt-reader-heading"><h2>Prompt đang dùng</h2><button type="button" autofocus>Đóng</button></div><div class="prompt-reader-content">'+(history.length?promptTraceMarkup(history):'<p>Chưa ghi nhận lần gọi model nào.</p>')+'</div>';
    dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
  };
  host.querySelector('[data-trace-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(history,null,2));setMessage('Đã sao chép toàn bộ chi tiết prompt.','success');}catch{setMessage('Không thể sao chép. Hãy dùng Tải chi tiết JSON.','error');}};
  host.querySelector('[data-trace-download]').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({jobId:state.jobId,promptHistory:history},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='prompt-'+String(state.jobId||'run').replace(/[^a-zA-Z0-9_-]/g,'')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
}
function renderRunPromptTraces(state){
  const target=state.taskType==='text-to-image'?$('chromaLiveProgress'):$('editorLiveProgress');
  const activeTrace=target?.id==='chromaLiveProgress'?'chromaPromptTrace':'editorPromptTrace';
  for(const id of ['chromaPromptTrace','editorPromptTrace']){const host=$(id);if(host&&(id!==activeTrace||target.hidden))host.hidden=true;}
  if(target&&!target.hidden){let host=$(target.id==='chromaLiveProgress'?'chromaPromptTrace':'editorPromptTrace');if(!host){host=document.createElement('div');host.id=target.id==='chromaLiveProgress'?'chromaPromptTrace':'editorPromptTrace';}if(host.parentElement!==target)target.append(host);renderPromptTrace(host,state);}
  renderPromptTrace($('resultPromptTrace'),state);
}

function generationActionState(state){
  const done=['completed','cancelled','failed'].includes(state.status);
  const cancelling=!done&&(state.status==='cancelling'||Boolean(state.cancelRequested));
  return {done,cancelling,disabled:done?!(state.results||[]).length:cancelling};
}
function showGenerationResult(state){
  if(!state)return;
  globalThis.QualityLearning?.notifyJob(state);
  if(state.taskType==='character')return window.Character.restore(state);
  if(state.taskType==='makeup')return window.Makeup.restore(state);
  if(state.taskType==='enhance')return window.ImageEnhancement.restore(state);
  if(state.taskType==='outpaint')return showSavedOutpaintResults(state);
  if(state.taskType==='text-to-image'){activateAppView('create');setStudioMode('chroma');}else activateAppView('create');
  if(state.taskType==='text-to-image'){window.NewImage?.restore(state);$('chromaGallery').scrollIntoView({behavior:'smooth',block:'center'});}
  else {
    const results=(state.results||[]).filter(item=>item.file);
    if(state.status!=='completed'||!$('resultsGrid').children.length){
      if(!results.length)return setMessage('Tác vụ chưa có ảnh kết quả được lưu.','error');
      $('resultsGrid').innerHTML=results.map(item=>`<article class="result-card"><img src="${escapeHtml(outputUrl(item.file))}" alt="Kết quả seed ${escapeHtml(item.seed??'')}"><p>Seed ${escapeHtml(item.seed??'—')} · Ảnh đã lưu</p><a href="${escapeHtml(outputUrl(item.file))}" download>Tải ảnh</a></article>`).join('');
      $('comparePanel').hidden=true;
    }else if($('studioResultsFilmstrip').children.length){
      $('studioResultsTray').hidden=false;
      $('studioResultsTray').scrollIntoView({behavior:'smooth',block:'start'});
      return;
    }
    $('resultsDialog').classList.remove('guided-review-dialog');
    if(!$('resultsDialog').open)$('resultsDialog').showModal();
  }
}
function presentStudioResults(sourceUrl,selectedUrl=''){
  const tray=$('studioResultsTray'),filmstrip=$('studioResultsFilmstrip'),cards=[...$('resultsGrid').querySelectorAll('.result-card')];if(!tray||!filmstrip||!cards.length)return;
  const results=cards.map((card,index)=>{const image=card.querySelector('img'),button=card.querySelector('[data-seed]'),description=card.querySelector('p')?.innerText||'';return {index,src:image?.getAttribute('src')||'',alt:image?.alt||`Phương án ${index}`,seed:button?.dataset.seed||'',description};}).filter((item)=>item.src);
  const candidates=results.filter((item)=>item.index>0);studioSelectedResult='';studioPendingResult='';studioViewingResult='';window.AtelierStore?.set({selectedResult:''});tray.hidden=false;$('studioResultsMeta').textContent=`Đã tạo xong ${candidates.length} phương án · hãy xem và chọn kết quả cuối`;
  filmstrip.innerHTML=candidates.map((item,position)=>`<article class="studio-result-thumb" data-tray-index="${item.index}"><button class="studio-result-preview" type="button" aria-label="Xem phương án ${position+1}"><img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt)}"></button><div class="studio-result-thumb-copy"><span><strong>Phương án ${position+1}</strong><small>${item.seed?`Seed ${escapeHtml(item.seed)}`:escapeHtml(item.description.split('\n')[0]||'Kết quả mới')}</small></span><span class="studio-selected-mark">✓</span></div><button type="button" data-tray-select ${item.seed?'':'disabled'}>Chọn phương án</button></article>`).join('');
  const titleFor=(item)=>`Phương án ${Math.max(1,candidates.indexOf(item)+1)}`;
  const updateSelection=()=>{const confirmed=candidates.find((item)=>item.src===studioSelectedResult),pending=candidates.find((item)=>item.src===studioPendingResult),viewing=candidates.find((item)=>item.src===studioViewingResult),status=$('studioFocusStatus'),summary=$('studioSelectionSummary');for(const node of filmstrip.querySelectorAll('.studio-result-thumb')){const item=results.find((entry)=>entry.index===Number(node.dataset.trayIndex)),selected=item?.src===studioSelectedResult,staged=item?.src===studioPendingResult&&!selected;node.classList.toggle('is-selected',selected);node.classList.toggle('is-pending',staged);const button=node.querySelector('[data-tray-select]');if(button)button.textContent=selected?'✓ Kết quả cuối':staged?'Chờ xác nhận':'Chọn phương án';}const viewingConfirmed=viewing&&viewing.src===studioSelectedResult,viewingPending=viewing&&viewing.src===studioPendingResult&&!viewingConfirmed;status.className=viewingConfirmed?'is-confirmed':viewingPending?'is-pending':'';status.textContent=viewingConfirmed?'✓ Đã chọn làm kết quả cuối':viewingPending?'Chờ xác nhận':'Đang xem · Chưa chọn';$('studioChooseResult').disabled=!viewing||viewingConfirmed;$('studioChooseResult').textContent=viewingConfirmed?'✓ Đã chọn làm kết quả cuối':viewingPending?'Đã chọn · xác nhận bên phải':'Chọn làm kết quả cuối';summary.className=`studio-selection-summary ${pending?'is-pending':confirmed?'is-confirmed':''}`;$('studioSelectionState').textContent=pending?'LỰA CHỌN CHỜ XÁC NHẬN':confirmed?'ĐÃ XÁC NHẬN KẾT QUẢ CUỐI':'CHƯA CHỌN KẾT QUẢ CUỐI';$('studioSelectionTitle').textContent=pending?titleFor(pending):confirmed?titleFor(confirmed):'Hãy chọn phương án phù hợp';$('studioSelectionHint').textContent=pending?'Xem lại ảnh rồi xác nhận để hoàn tất lựa chọn.':confirmed?'Bạn vẫn có thể xem hoặc đổi sang phương án khác.':'Bạn có thể xem các ảnh khác mà không làm mất lựa chọn.';$('studioConfirmResult').disabled=!pending;$('studioConfirmResult').textContent=confirmed&&!pending?'✓ Đã xác nhận':'Xác nhận kết quả cuối';$('studioSendToReview').disabled=!confirmed;refreshContinuationActions();};
  const focus=(item)=>{if(!item?.src)return;studioViewingResult=item.src;$('studioCompareBefore').src=cards[item.index].dataset.sourceUrl||sourceUrl;$('studioCompareAfter').src=item.src;$('studioCompareAfterWrap').style.clipPath=`inset(0 ${100-Number($('studioCompareSlider').value)}% 0 0)`;$('studioCompareStage').hidden=false;const title=titleFor(item),description=item.description.split('\n')[0]||'Kết quả chỉnh sửa mới';$('studioFocusTitle').textContent=title;$('studioFocusDescription').textContent=description;$('studioActionTitle').textContent=title;$('studioActionDescription').textContent=description;$('studioDownloadResult').href=item.src;$('studioDownloadResult').download=`ai-atelier-phuong-an-${Math.max(1,candidates.indexOf(item)+1)}.png`;for(const node of filmstrip.querySelectorAll('.studio-result-thumb'))node.classList.toggle('is-viewing',Number(node.dataset.trayIndex)===item.index);if(typeof syncOutpaintContextActions==='function')syncOutpaintContextActions(cards[item.index]);window.Character?.resultActions?.(cards[item.index]);updateSelection();};
  const stage=(item)=>{if(!item?.seed)return;if(item.src===studioSelectedResult){studioPendingResult='';focus(item);return;}studioPendingResult=item.src;focus(item);updateSelection();};
  for(const card of filmstrip.querySelectorAll('[data-tray-index]')){const item=results.find((entry)=>entry.index===Number(card.dataset.trayIndex));card.querySelector('.studio-result-preview')?.addEventListener('click',()=>focus(item));card.querySelector('[data-tray-select]')?.addEventListener('click',()=>stage(item));}
  $('studioChooseResult').onclick=()=>stage(candidates.find((item)=>item.src===studioViewingResult));
  $('studioConfirmResult').onclick=async()=>{const item=candidates.find((entry)=>entry.src===studioPendingResult),original=item&&cards[item.index].querySelector('[data-seed]');if(!item||!original)return;const selected=await selectPrimary(Number(item.seed),original);if(!selected)return;studioSelectedResult=item.src;studioPendingResult='';window.AtelierStore?.set({selectedResult:studioSelectedResult});focus(item);setMessage(`${titleFor(item)} đã được xác nhận là kết quả cuối.`,'success');};
  focus(candidates.find((item)=>item.src===selectedUrl)||candidates[0]);
}
function refreshContinuationActions(){
  for(const id of ['studioContinueInpaint','studioContinueTryon','studioContinueOutpaint','studioContinueEnhance','studioContinueCharacter','studioManualResult']){
    const button=$(id);if(button)button.disabled=!studioPendingResult&&!studioSelectedResult;
  }
}

async function continueFromSelectedResult(nextMode,branchParentId){
  const selected=studioPendingResult||studioSelectedResult;
  if(!selected)return setMessage('Hãy chọn một phương án trước khi chỉnh sửa tiếp.','error');
  if(!['inpaint','tryon','outpaint','enhance','makeup','character'].includes(nextMode))return;
  if(activeJobId&&!['completed','failed','cancelled','restart-required'].includes(activityState?.status))return setMessage('Hãy đợi tác vụ đang chạy hoàn tất trước khi chỉnh sửa tiếp.','error');
  const buttons=['studioContinueInpaint','studioContinueTryon','studioContinueOutpaint','studioContinueEnhance','studioContinueCharacter'].map(id=>$(id)).filter(Boolean);
  let historyWarning='';
  buttons.forEach(button=>button.disabled=true);
  try{
    const url=selected.startsWith('data:')||selected.startsWith('/')?selected:outputUrl(selected);
    const response=await fetch(url);if(!response.ok)throw new Error('Không thể đọc ảnh của phương án đã chọn.');
    const blob=await response.blob();
    const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[blob.type];
    if(!extension)throw new Error('Phương án không có định dạng ảnh được hỗ trợ.');
    const name=`${(current?.name||'ket-qua').replace(/\.[^.]+$/,'')}-chinh-sua-tiep.${extension}`;
    const selectedCard=[...$('resultsGrid').querySelectorAll('.result-card')].find(card=>card.querySelector('img')?.getAttribute('src')===selected);
    const branchSource=branchParentId||selectedCard?.querySelector('[data-seed]')?.dataset.sampleId||current?.id;
    await uploadSourceImage(new File([blob],name,{type:blob.type}));
    if(window.StudioGuidance&&branchSource)await window.StudioGuidance.recordBranch({sourceId:branchSource,childId:current.id,result:url,task:selectedCard?.querySelector('[data-seed]')?.dataset.task||nextMode}).catch(error=>{historyWarning=` Chưa lưu được lịch sử: ${error.message}`;});
    if(activityState?.jobId)dismissedProgressJobs.add(activityState.jobId);
    for(const id of ['activityCenter','editorLiveProgress','chromaLiveProgress','editorPromptTrace','chromaPromptTrace']){
      const panel=$(id);if(panel)panel.hidden=true;
    }
    currentRunDirectory='';studioSelectedResult='';studioPendingResult='';studioViewingResult='';
    $('resultsGrid').replaceChildren();$('comparePanel').hidden=true;$('studioCompareStage').hidden=true;
    window.AtelierStore?.set({selectedResult:''});
    if(activeJobId)setActiveJob(null);
    setStudioMode(nextMode);setTool('add');
    setMessage(`Đã dùng phương án đã chọn làm ảnh nguồn mới. ${nextMode==='character'?'Nhận diện nhân vật rồi chọn tư thế hoặc biểu cảm.':nextMode==='makeup'?'Nhận diện khuôn mặt và chọn phong cách trang điểm.':nextMode==='enhance'?'Chọn cách cải thiện và xem thử một vùng.':nextMode==='outpaint'?'Chọn khung mở rộng mới.':nextMode==='inpaint'?'Chọn vùng cần xóa.':'Chọn trang phục và vùng cần thay.'}${historyWarning}`,historyWarning?'error':'success');
  }catch(error){setMessage(error.message,'error');}
  finally{refreshContinuationActions();}
}

function updateProgressVisibility(){
  if(!activityState)return;
  const dismissed=dismissedProgressJobs.has(activityState.jobId);
  const target=activityState.taskType==='text-to-image'?$('chromaLiveProgress'):['inpaint','tryon','outpaint','enhance','makeup','character'].includes(activityState.taskType)?$('editorLiveProgress'):null;
  const rightView=activityState.taskType==='text-to-image'?currentAppView==='create'&&studioMode==='chroma':currentAppView==='create';
  const rect=target?.getBoundingClientRect();
  const docked=target?.parentElement?.classList.contains('workspace-progress-dock');
  const visible=rightView&&target&&!target.hidden&&(docked||rect.height>0&&rect.top<innerHeight&&rect.bottom>0);
  $('activityCenter').hidden=dismissed||Boolean(visible);
}
function renderGenerationLive(state,progress,elapsed,eta,done){
  const target=state.taskType==='text-to-image'?$('chromaLiveProgress'):['inpaint','tryon','outpaint','enhance','makeup','character'].includes(state.taskType)?$('editorLiveProgress'):null;
  if(!target)return;
  for(const id of ['editorLiveProgress','chromaLiveProgress'])if($(id)!==target)$(id).hidden=true;
  if(dismissedProgressJobs.has(state.jobId)){target.hidden=true;return;}
  if(done){target.hidden=true;return;}
  const info=generationProgressInfo(state);target.hidden=false;
  if(target.dataset.progressJob!==state.jobId){target.dataset.progressJob=state.jobId;target.classList.remove('is-collapsed');}
  const detailsOpen=Boolean(target.querySelector('.generation-details')?.open);
  let liveContent=target.querySelector('[data-live-status]');
  if(!liveContent){liveContent=document.createElement('div');liveContent.dataset.liveStatus='';liveContent.className='generation-live-status';target.prepend(liveContent);}
  const preview=state.preview?.file||state.preview?.url||(state.results||[]).at(-1)?.file;
  const previewUrl=preview?outputUrl(preview):'';
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
  target.querySelector('[data-inline-cancel]')?.addEventListener('click',()=>cancelActiveJob().catch(error=>setMessage(error.message,'error')));
  target.querySelector('[data-inline-close]')?.addEventListener('click',closeGenerationProgress);
  target.querySelector('[data-inline-result]')?.addEventListener('click',()=>showGenerationResult(state));
}

function renderActivity(state){
  window.MakeupCompare?.update(state);
  window.StudioGuidance?.observeJob(state);
  activityState=state;const center=$('activityCenter');
  const progress=activityProgress(state),percent=Math.round(progress*100),done=['completed','cancelled','failed'].includes(state.status),usesInlineProgress=['inpaint','tryon','outpaint','enhance','makeup','character','text-to-image'].includes(state.taskType);
  center.hidden=usesInlineProgress&&!done;
  if(done&&usesInlineProgress)center.hidden=true;
  center.classList.toggle('done',done);$('activityProgressBar').style.width=`${percent}%`;$('activityPercent').textContent=`${percent}%`;
  const progressInfo=generationProgressInfo(state),elapsed=progressInfo.elapsed,eta=progressInfo.eta;
  $('activityPercent').textContent=progressInfo.measured?`${percent}%`:'Đang xử lý';
  const finalizing=['inpaint-blending','inpaint-texture-recovery','inpaint-structural-refine','inpaint-structural-analysis','inpaint-saving','inpaint-variant-complete'].includes(state.stage);
  const lastUpdate=Date.parse(state.updatedAt||state.startedAt||new Date()),staleSeconds=Math.max(0,(Date.now()-lastUpdate)/1000),stalled=!done&&(state.stalled===true||staleSeconds>=300);
  $('activityElapsed').textContent=formatDuration(elapsed);$('activityEta').textContent=done?'00:00':stalled?'Có thể đã treo':finalizing?'Sắp xong':formatDuration(eta);
  const gpuTotal=Number(state.gpuMemoryMb||0),gpuUsed=Math.min(Number(state.currentVramMb||state.peakVramMb||0),gpuTotal||Infinity);
  $('activityGpu').textContent=state.device==='cuda'?`${gpuUsed.toFixed(0)} / ${gpuTotal.toFixed(0)} MB`:'CPU';
  const stageLabel=state.taskType==='outpaint'&&state.stage==='inpaint-generating'?'Đang mở rộng ảnh':STAGE_LABELS[state.stage]||state.stage||'Đang chuẩn bị';
  $('activityTitle').textContent=done?(state.status==='completed'?'Đã tạo xong các phương án':state.status==='cancelled'?'Đã hủy tác vụ':'Tác vụ gặp lỗi'):stalled?`${stageLabel} · có thể đã treo`:stageLabel;
  const imagePart=state.total?`Ảnh ${Math.min(state.current||1,state.total)}/${state.total}`:'';const seedPart=state.totalSeeds?`Seed ${state.completedSeeds||0}/${state.totalSeeds}`:'';const variantPart=state.totalVariants?`Phương án ${state.currentVariant||1}/${state.totalVariants}`:'';const stepPart=state.totalSteps&&['inpaint-generating','text-generating'].includes(state.stage)?`Bước ${state.currentStep||0}/${state.totalSteps}`:'';
$('activitySubtitle').textContent=[imagePart,variantPart,seedPart,stepPart,done?`${(state.results||[]).length} kết quả`:`${progressInfo.measured?percent+'%':'Đang xử lý'} · ${state.sampleId||''}`].filter(Boolean).join(' · ');
  $('activityCancel').disabled=!activeJobId||done;$('activityClose').hidden=!done;$('activityResultCount').textContent=String((state.results||[]).length);
  const stages=state.taskType==='character'?['character-validating','character-loading','character-processing','character-checking','character-saving','done']:state.taskType==='makeup'?['makeup-detecting','makeup-processing','makeup-saving','done']:state.taskType==='enhance'?['enhance-validating','enhance-model-loading','enhance-processing','enhance-checking','done']:state.taskType==='outpaint'?OUTPAINT_STAGES.filter(stage=>(stage!=='outpaint-seam-repair'||state.seamRepair)&&(stage!=='inpaint-texture-recovery'||(state.detailPass&&!state.materialRefine))&&(stage!=='outpaint-material-refine'||state.materialRefine||state.sourceEnhance)):state.taskType==='inpaint'?INPAINT_STAGES:state.taskType==='text-to-image'?TEXT_TO_IMAGE_STAGES:PIPELINE_STAGES;let currentIndex=stages.indexOf(state.stage);if(state.stage==='inpaint-model-release')currentIndex=2;if(state.stage==='inpaint-variant-complete')currentIndex=10;currentIndex=Math.max(0,currentIndex);
  $('activityTimeline').innerHTML=stages.map((stage,index)=>`<div class="activity-stage ${stage===state.stage||(state.stage==='inpaint-model-release'&&stage==='inpaint-model-loading')||(state.stage==='inpaint-variant-complete'&&stage==='inpaint-blending')?'current':''} ${(state.status==='completed'||index<currentIndex)?'complete':''}"><span class="stage-dot"></span><span>${STAGE_LABELS[stage]}</span><span>${stage===state.stage&&!done?'Đang chạy':state.status==='completed'||index<currentIndex?'Hoàn tất':'Chờ'}</span></div>`).join('');
  const results=state.results||[];$('activityResults').innerHTML=results.length?results.slice(-12).reverse().map((item)=>`<article class="live-result"><img src="${escapeHtml(outputUrl(item.file))}" alt="Kết quả ${escapeHtml(item.seed||'')}"><strong>${escapeHtml(item.sampleId?.split('/').pop()||`Seed ${item.seed}`)}</strong><small>${item.seed!==undefined?`Seed ${escapeHtml(item.seed)}`:''}${item.kind==='inpaint'?` · ngoài mask ${(Number(item.outsideMaskMAE||0)*100).toFixed(3)}%`:['text-to-image','outpaint','enhance','makeup','character'].includes(item.kind)?'':` · điểm ${Number(item.qualityScore||0).toFixed(1)}`}</small></article>`).join(''):'<div class="activity-empty">Kết quả sẽ xuất hiện tại đây ngay khi phương án đầu tiên hoàn tất.</div>';
  const events=state.events||[];$('activityLog').innerHTML=events.length?events.slice(-30).reverse().map((event)=>`<div><time>${new Date(event.timestamp).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><span>${escapeHtml(event.message)}</span></div>`).join(''):'<div class="activity-empty">Đang chờ sự kiện đầu tiên…</div>';
  const preview=state.preview?.file||state.preview?.url||results.at(-1)?.file;$('activityPreview').hidden=!preview;if(preview){$('activityPreviewImage').src=`${outputUrl(preview)}?v=${encodeURIComponent(state.preview?.updatedAt||state.updatedAt||'')}`;$('activityPreviewTitle').textContent=done?'Ảnh cuối cùng':'Bản xem trước trực tiếp';$('activityPreviewMeta').textContent=`${stageLabel}${stepPart?` · ${stepPart}`:''}${variantPart?` · ${variantPart}`:''}`;}
  renderGenerationLive(state,progress,elapsed,eta,done);
  renderRunPromptTraces(state);
  if((['inpaint','tryon','outpaint','enhance','makeup','character'].includes(state.taskType)||(state.taskType==='text-to-image'&&studioMode==='chroma'))&&currentAppView==='create'){
    const commandBar=$('studioCommandBar'),primary=$('studioPrimaryAction'),copy=$('studioCommandTitle'),hint=$('studioCommandHint'),status=commandBar?.querySelector('.studio-command-state');
    if(primary&&copy&&hint){const {cancelling,disabled}=generationActionState(state);copy.textContent=done?(state.status==='completed'?'Đã tạo xong':'Tác vụ đã kết thúc'):stageLabel;hint.textContent=done?`${(state.results||[]).length} kết quả · lưu trên máy`:[progressInfo.measured?percent+'%':'Đang xử lý',stepPart].filter(Boolean).join(' · ');primary.disabled=disabled;primary.dataset.command=done?'results':'cancel';primary.textContent=done?'Xem kết quả':cancelling?'Đang hủy…':'Hủy';primary.classList.toggle('danger',!done);status?.classList.toggle('ready',done&&state.status==='completed');}
    const commandNeedsAttention=state.status==='failed'||stalled;
    commandBar?.classList.toggle('is-running',!done&&!commandNeedsAttention);commandBar?.classList.toggle('is-complete',state.status==='completed');commandBar?.style.setProperty('--command-progress',`${progressInfo.measured?percent:0}%`);
    updateStudioCommandVisibility(`job:${state.jobId}:${commandNeedsAttention?'attention':done?state.status:'running'}`,{attention:commandNeedsAttention,error:state.status==='failed',collapseNow:false,collapseAfter:0});
    if(commandBar?.classList.contains('is-collapsed'))setStudioCommandCollapsed(true);
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
  $('cancelJobButton').disabled=true;$('resumeJobButton').disabled=state.status!=='interrupted'||!state.resumable;$('jobProgress').hidden=true;
}

function applyJobState(state){
  if(!state.ok||state.status==='unknown'||(state.jobId&&state.jobId!==activeJobId))return;
  state={...(activityState||{}),...state};
  renderActivity(state);
  globalThis.QualityLearning?.notifyJob(state);
  const completed=Number(state.completedSeeds||state.current||0), total=Number(state.totalSeeds||state.total||0);
  if(total){$('jobProgress').max=total;$('jobProgress').value=Math.min(completed,total);}
  const detail=state.sampleId?` · ${state.sampleId}`:state.seed!==undefined?` · seed ${state.seed}`:'';
  setMessage(`Tác vụ ${state.status} · ${state.stage||'đang chuẩn bị'}${detail}`);
  $('resumeJobButton').disabled=!(state.status==='interrupted'&&state.resumable);
  if(['completed','cancelled','failed'].includes(state.status)){if(jobPollTimer){clearInterval(jobPollTimer);jobPollTimer=null;}jobEventSource?.close();jobEventSource=null;localStorage.removeItem('activeJobId');activeJobId='';}
}

async function resumeActiveJob() {
  if(!activeJobId)return setMessage('Không có tác vụ bị gián đoạn để tiếp tục.', 'error');
  setMessage('Đang tiếp tục tác vụ từ ảnh chưa hoàn tất gần nhất…');
  const response=await fetch('/api/resume-job',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:activeJobId})});
  const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tiếp tục tác vụ');
  setMessage(`Đã tiếp tục và hoàn tất ${result.completed}/${result.requested} ảnh.`, 'success');
  setActiveJob('');
}

async function cancelActiveJob() {
  if (!activeJobId) return setMessage('Không có tác vụ đang chạy để hủy.', 'error');
  const cancellingJobId=activeJobId;
  $('cancelJobButton').disabled=true;$('activityCancel').disabled=true;
  const response = await fetch('/api/cancel-job', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({jobId:cancellingJobId})});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể gửi yêu cầu hủy');
  const nextState={...activityState,jobId:cancellingJobId,status:result.status||'cancelling',stage:result.status==='cancelled'?'cancelled':(activityState.stage||'preparing'),cancelRequested:true,updatedAt:new Date().toISOString()};
  renderActivity(nextState);
  setMessage(result.status==='cancelled'?'Tác vụ đã được hủy an toàn.':'Đã yêu cầu hủy; hệ thống sẽ dừng tại điểm an toàn gần nhất.','success');
  await pollJobStatus().catch(()=>{});
}

async function calibrateQuality() {
  const response = await fetch('/api/calibrate-quality', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể hiệu chỉnh');
  if(result.qualityVersion!==2||!result.calibrationReady){
    setMessage(`Chưa áp dụng ngưỡng mới: cần ít nhất 10 kết quả đã được chấp nhận với bộ chấm điểm hiện tại (đang có ${result.qualityVersion===2?result.approvedCount:0}).`,'warning');
    return;
  }
  const value = result.recommendation;
  $('minimumQuality').value = value.minimumQuality;
  $('minimumSimilarity').value = value.minimumSimilarity;
  $('minimumSeam').value = value.minimumSeam;
  $('minimumAnatomy').value = value.minimumAnatomy;
  setMessage(`Đã phân tích ${result.sampleCount} kết quả (${result.approvedCount} chấp nhận) · ${result.report}`, 'success');
}

async function buildGoldenBaseline() {
  const response=await fetch('/api/golden-baseline',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tạo bộ chuẩn');
  setMessage(`Đã tạo bộ chuẩn gồm ${result.caseCount} ảnh · ${result.baseline}`, 'success');
}

async function compareBaseline() {
  const response=await fetch('/api/compare-baseline',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể so sánh baseline');
  $('resultsGrid').innerHTML=result.cases.map((item)=>`<article class="result-card"><p>${item.sampleId}<br><span class="review-badge">${item.status}</span><br>${item.warnings.join('<br>')||'Không phát hiện suy giảm'}</p></article>`).join('');
  $('comparePanel').hidden=true;$('resultsDialog').showModal();
  setMessage(`Hồi quy: ${result.passed}/${result.total} đạt · ${result.regressed} suy giảm · báo cáo /reports/regression-report.html`,result.regressed?'error':'success');
}

async function showJobs() {
  const response=await fetch('/api/jobs');const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc hàng đợi');
  $('resultsGrid').innerHTML=result.jobs.map((job)=>`<article class="result-card"><p><strong>${job.jobId}</strong><br><span class="review-badge">${job.status}</span> · ${job.stage||'—'}<br>${job.current&&job.total?`${job.current}/${job.total}`:job.completedSeeds&&job.totalSeeds?`${job.completedSeeds}/${job.totalSeeds} seed`:''}<br>${job.updatedAt||''}</p>${job.status==='interrupted'&&job.resumable?`<button data-resume-job="${job.jobId}">Tiếp tục</button>`:''}</article>`).join('')||'<p>Chưa có tác vụ.</p>';
  for(const button of $('resultsGrid').querySelectorAll('[data-resume-job]'))button.addEventListener('click',()=>{setActiveJob(button.dataset.resumeJob);resumeActiveJob().catch((error)=>setMessage(error.message,'error'));});
  $('comparePanel').hidden=true;$('resultsDialog').showModal();
}

async function cleanupOldJobs() {
  const retentionDays=Number($('jobRetentionDays').value);
  const previewResponse=await fetch('/api/cleanup-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({retentionDays})});
  const preview=await previewResponse.json();if(!previewResponse.ok||!preview.ok)throw new Error(preview.error||'Không thể xem trước');
  if(!preview.fileCount)return setMessage('Không có checkpoint cũ cần dọn.','success');
  if(!confirm(`Xóa ${preview.fileCount} tệp của ${preview.jobCount} job đã hoàn tất/hủy? Ảnh và báo cáo được giữ lại.`))return;
  const response=await fetch('/api/cleanup-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({retentionDays,confirm:true})});
  const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể dọn checkpoint');
  setMessage(`Đã dọn ${result.fileCount} tệp checkpoint; ảnh và báo cáo được giữ lại.`,'success');
}

async function runBenchmark() {
  const readiness=await loadReferenceReadiness();
  const category=$('garmentCategory').value;
  const reference=readiness.items.find((item)=>item.category===category);
  if(!reference?.ready){
    setMessage(`Ảnh tham chiếu ${category} chưa sẵn sàng. Hãy lưu và kiểm định ảnh tham chiếu trước.`, 'error');
    activateAppView('create');
    $('garmentFile').scrollIntoView({behavior:'smooth',block:'center'});
    return;
  }
  const jobId=createJobId('benchmark');setActiveJob(jobId);$('benchmarkButton').disabled=true;
  try{const response=await fetch('/api/benchmark',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId,garmentImage:garmentDataUrl,category:$('garmentCategory').value,refineRegion:$('refineRegion').value})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Benchmark thất bại');setMessage(`Benchmark hoàn tất ${result.completed}/${result.requested} ảnh · ${result.report}`,'success');}
  catch(error){setMessage(error.message,'error');}finally{$('benchmarkButton').disabled=false;setActiveJob('');}
}

async function buildDashboard() {
  const response=await fetch('/api/quality-dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tạo dashboard');
  const profile=result.recommendations[$('garmentCategory').value];
  if(profile){$('tryonCount').value=String(profile.count);$('tryonSteps').value=profile.steps;$('tryonGuidance').value=profile.guidance;}
  setMessage(`Dashboard: ${result.itemCount} ảnh · đã áp dụng cấu hình đề xuất cho loại trang phục hiện tại · /reports/quality-dashboard.html`,'success');
}

async function checkSystem() {
  const response=await fetch('/api/system-check');const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra hệ thống');
  setMessage(`${result.modelsReady?'✓ Model đầy đủ':'⚠ Thiếu model'} · ${result.gpu} · VRAM ${result.gpuMemoryMb} MB · trống ${result.diskFreeGb} GB`,result.modelsReady?'success':'error');
}

async function backupData() {
  const response=await fetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể sao lưu');
  setMessage(`Đã sao lưu cấu hình, mask, trạng thái job và dữ liệu duyệt · ${result.backup}`,'success');
}

async function loadBackups() {
  const response=await fetch('/api/backups');const result=await response.json();if(!response.ok||!result.ok)return;
  $('backupSelect').innerHTML='<option value="">Chọn bản sao lưu</option>'+result.backups.map((item)=>`<option value="${item.name}">${item.name}</option>`).join('');
}

async function restoreSelectedBackup() {
  const name=$('backupSelect').value;if(!name)return setMessage('Hãy chọn bản sao lưu.','error');
  if(!confirm(`Khôi phục ${name}? Hệ thống sẽ tạo một bản an toàn trước khi ghi đè dữ liệu cấu hình hiện tại.`))return;
  const response=await fetch('/api/restore-backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,confirm:true})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể khôi phục');
  await loadReviewState();setMessage(`Đã khôi phục ${result.restored} · bản an toàn: ${result.safetyBackup}`,'success');
}

async function saveBenchmarkReview(category,sampleId,status,selected,card) {
  const select=card.querySelector('[data-benchmark-labels]');const defectLabels=[...select.selectedOptions].map((option)=>option.value);
  const response=await fetch('/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category,sampleId,status,selected,defectLabels})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể lưu duyệt');
  reviewState=result.state;card.querySelector('.review-badge').textContent=status;
}

function renderGuidedReview() {
  const item=guidedReviewItems[guidedReviewIndex];if(!item)return;
  const labels=item.review.defectLabels||[];const options=[['seam','Lỗi biên'],['color','Sai màu'],['texture','Sai hoa văn'],['anatomy','Sai hình thể'],['collar','Cổ áo'],['sleeves','Tay áo'],['waist','Vùng eo'],['hem','Gấu / chiều dài'],['layers','Sai lớp áo'],['old-clothing','Sót trang phục cũ']];
  const reviewed=guidedReviewItems.filter((entry)=>['approved','retry','rejected'].includes(entry.review.status)).length;
  $('reviewProgress').hidden=false;$('reviewProgress').textContent=`Ảnh ${guidedReviewIndex+1}/${guidedReviewItems.length} · đã duyệt ${reviewed}/${guidedReviewItems.length} · phím A: chấp nhận, R: chạy lại, X: loại bỏ, ←/→: chuyển ảnh`;
  $('resultsGrid').innerHTML=`<article class="guided-review-shell" data-benchmark-card="${item.sampleId}"><nav class="review-session-list" aria-label="Danh sách cần duyệt">${guidedReviewItems.map((entry,index)=>`<button data-guided-index="${index}" class="${index===guidedReviewIndex?'active':''}"><span>${index+1}</span><strong>${escapeHtml(entry.sampleId)}</strong><small>${escapeHtml(entry.review.status||'pending')}</small></button>`).join('')}</nav><section class="review-stage"><div class="benchmark-pair"><figure><img src="${item.sourceUrl}" alt="Ảnh gốc"><figcaption>Trước</figcaption></figure><figure><img src="${item.resultUrl}" alt="Kết quả"><figcaption>Sau</figcaption></figure></div><div class="guided-nav"><button id="previousReviewButton" ${guidedReviewIndex===0?'disabled':''}>← Ảnh trước</button><button id="nextReviewButton" ${guidedReviewIndex===guidedReviewItems.length-1?'disabled':''}>Ảnh sau →</button></div></section><aside class="review-decision"><div><span class="card-kicker">QUYẾT ĐỊNH</span><h3>${escapeHtml(item.sampleId)}</h3><p><span class="review-badge">${item.review.status||'pending'}</span> · tổng ${Number(item.qualityScore).toFixed(1)}<br>Biên ${Number(item.seamScore).toFixed(1)} · bảo toàn ${Number(item.anatomyScore).toFixed(1)}<br>Gợi ý xem kỹ: <strong>${item.suggestedRegion}</strong></p><label class="defect-labels">Nhãn lỗi<select multiple data-benchmark-labels>${options.map(([value,label])=>`<option value="${value}" ${labels.includes(value)?'selected':''}>${label}</option>`).join('')}</select></label></div><div class="review-actions"><button data-benchmark-status="approved">Chấp nhận <kbd>A</kbd></button><button data-benchmark-status="retry">Chạy lại <kbd>R</kbd></button><button data-benchmark-status="rejected">Loại bỏ <kbd>X</kbd></button><button data-benchmark-status="pending">Để sau</button></div></aside></article>`;
  const card=$('resultsGrid').querySelector('[data-benchmark-card]');for(const button of card.querySelectorAll('[data-benchmark-status]'))button.addEventListener('click',async()=>{try{await saveBenchmarkReview(item.category,item.sampleId,button.dataset.benchmarkStatus,item.selected,card);item.review={...(reviewState.items[reviewKey(item.category,item.sampleId)]||{}),status:button.dataset.benchmarkStatus};if(button.dataset.benchmarkStatus!=='pending'&&guidedReviewIndex<guidedReviewItems.length-1)guidedReviewIndex++;renderGuidedReview();}catch(error){setMessage(error.message,'error');}});
  window.StudioGuidance?.attachRepairHint(card.querySelector('[data-benchmark-labels]'));
  $('previousReviewButton').addEventListener('click',()=>{guidedReviewIndex--;renderGuidedReview();});$('nextReviewButton').addEventListener('click',()=>{guidedReviewIndex++;renderGuidedReview();});
  for(const button of card.querySelectorAll('[data-guided-index]'))button.addEventListener('click',()=>{guidedReviewIndex=Number(button.dataset.guidedIndex);renderGuidedReview();});
}

async function reviewBenchmark() {
  const category=$('garmentCategory').value;const response=await fetch(`/api/benchmark-review?category=${encodeURIComponent(category)}`);const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tải benchmark');
  guidedReviewItems=result.items;guidedReviewIndex=Math.max(0,result.items.findIndex((item)=>!['approved','retry','rejected'].includes(item.review.status)));renderGuidedReview();
  $('comparePanel').hidden=true;$('resultsDialog').classList.add('guided-review-dialog');$('resultsDialog').showModal();setMessage(`Đã mở phiên duyệt tuần tự ${result.total} ảnh.`,'success');
}

async function showReviewReadiness() {
  const response=await fetch('/api/review-readiness');const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra tiến độ');
  const rows=Object.entries(result.perCategory||{}).map(([category,value])=>`${category}: ${value.approved}/${value.total} chấp nhận · ${value.pending} chờ`).join('<br>');$('reviewProgress').hidden=true;$('resultsGrid').innerHTML=`<article class="result-card"><p><strong>Tiến độ duyệt ${result.total} trường hợp</strong><br>${rows}<br>Tổng đã duyệt: ${result.reviewed}/${result.total}<br>Chấp nhận: ${result.approved} · chạy lại: ${result.retry} · loại bỏ: ${result.rejected}<br>Có nhãn lỗi: ${result.labeled}<br>Dữ liệu v1 được bảo toàn: ${result.legacyCount||0}<br>Tham chiếu: áo ${result.references.upper_body?'✓':'✗'} · quần/váy ${result.references.lower_body?'✓':'✗'} · toàn thân ${result.references.overall?'✓':'✗'}<br>Trọng số hoạt động: ${result.activeWeights?'✓':'✗'}</p>${result.blockers.length?`<p>${result.blockers.map((item)=>`• ${item}`).join('<br>')}</p>`:'<p>✓ Sẵn sàng nghiệm thu nội dung.</p>'}</article>`;$('comparePanel').hidden=true;$('resultsDialog').showModal();setMessage(result.ready?'Quy trình duyệt đã sẵn sàng nghiệm thu.':`Còn ${result.blockers.length} điều kiện cần hoàn tất.`,result.ready?'success':'error');
}

async function runTargetedRetryQueue() {
  if(!garmentDataUrl)throw new Error('Hãy chọn ảnh trang phục tham chiếu trước khi chạy lại.');
  const category=$('garmentCategory').value;const planResponse=await fetch('/api/retry-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category})});const plan=await planResponse.json();if(!planResponse.ok||!plan.ok)throw new Error(plan.error||'Không thể lập hàng đợi chạy lại');if(!plan.count)return setMessage('Không có ảnh nào được đánh dấu chạy lại.','success');
  $('runRetryQueueButton').disabled=true;let completed=0;
  try{for(const item of plan.items){setMessage(`Đang chạy lại ${completed+1}/${plan.count}: ${item.sampleId} · ${item.strategy}`);const jobId=createJobId('review-retry');setActiveJob(jobId);const response=await fetch('/api/batch-tryon',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId,garmentImage:garmentDataUrl,category,sampleIds:[item.sampleId],onlyConfident:false,onlyQualityPassed:false,cropPerson:true,twoStage:true,...item.settings})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||`Chạy lại thất bại: ${item.sampleId}`);const output=result.items?.[0];if(!output)throw new Error(`Không có kết quả mới cho ${item.sampleId}`);const save=await fetch('/api/retry-comparison',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sampleId:item.sampleId,oldSelected:item.oldSelected,newSelected:output.selected,strategy:item.strategy,defectLabels:item.defectLabels,metrics:{qualityScore:output.qualityScore,referenceSimilarity:output.referenceSimilarity,seamScore:output.seamScore,anatomyScore:output.anatomyScore,textureContinuity:output.textureContinuity}})});const saved=await save.json();if(!save.ok||!saved.ok)throw new Error(saved.error||'Không thể lưu so sánh');completed++;}}
  finally{$('runRetryQueueButton').disabled=false;setActiveJob('');}setMessage(`Đã tạo ${completed} kết quả chạy lại; chưa thay thế kết quả cũ. Hãy mở màn hình so sánh.`,'success');
}

async function showRetryComparisons() {
  const response=await fetch('/api/retry-comparisons');const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tải so sánh');$('reviewProgress').hidden=true;
  $('resultsGrid').innerHTML=result.items.map((item)=>`<article class="result-card" data-retry-comparison="${item.sampleId}"><div class="benchmark-pair">${item.oldUrl?`<img src="${item.oldUrl}" alt="Kết quả cũ">`:'<div>Không có kết quả cũ</div>'}<img src="${item.newUrl}" alt="Kết quả mới"></div><p><strong>${item.sampleId}</strong><br>${item.strategy} · ${(item.defectLabels||[]).join(', ')||'không có nhãn'}<br>Điểm mới: ${Number(item.metrics?.qualityScore||0).toFixed(1)} · biên ${Number(item.metrics?.seamScore||0).toFixed(1)} · bảo toàn ${Number(item.metrics?.anatomyScore||0).toFixed(1)}</p><div class="review-actions"><button data-promote-retry>Chọn kết quả mới và chờ duyệt</button><button data-keep-retry>Giữ kết quả cũ</button></div></article>`).join('')||'<p>Chưa có kết quả chạy lại.</p>';
  for(const button of $('resultsGrid').querySelectorAll('[data-promote-retry]'))button.addEventListener('click',async()=>{const card=button.closest('[data-retry-comparison]');const item=result.items.find((entry)=>entry.sampleId===card.dataset.retryComparison);await setReviewStatus(item.sampleId,'pending',item.newSelected,item.defectLabels,$('garmentCategory').value);card.querySelector('.review-badge')?.remove();button.disabled=true;setMessage(`Đã chọn kết quả mới cho ${item.sampleId}; trạng thái chuyển về chờ duyệt.`,'success');});
  for(const button of $('resultsGrid').querySelectorAll('[data-keep-retry]'))button.addEventListener('click',()=>{button.closest('[data-retry-comparison]').remove();setMessage('Đã giữ kết quả cũ; quyết định retry không thay đổi.','success');});
  $('comparePanel').hidden=true;$('resultsDialog').showModal();
}

async function calibrateWeights() {
  const response=await fetch('/api/calibrate-weights',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể hiệu chỉnh trọng số');
  setMessage(`Đã hiệu chỉnh từ ${result.reviewedCount} ảnh · trọng số lưu tại ${result.report}`,'success');
}

async function compareWeights() {
  const response=await fetch('/api/compare-weights',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể so sánh trọng số');
  setMessage(`A/B ${result.count} ảnh · chênh lệch điểm trung bình ${Number(result.averageDelta).toFixed(3)} · ${result.report}`,'success');
}

async function activateWeights() {
  const response=await fetch('/api/activate-weights',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kích hoạt trọng số');
  setMessage(`Đã kích hoạt trọng số với cải thiện ${Number(result.utilityImprovement).toFixed(3)} trên ${result.evidenceCount} ảnh duyệt · ${result.report}`,'success');
}

async function confirmDefaultWeights() {
  if(!confirm('Chỉ dùng trọng số mặc định khi đủ 69 trường hợp được chấp nhận và không có nhãn lỗi. Tiếp tục?'))return;
  const response=await fetch('/api/confirm-default-weights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể xác nhận trọng số mặc định');setMessage(`Đã ghi nhận không cần hiệu chỉnh · ${result.report}`,'success');
}

async function saveReferenceProfile(productReview) {
  if(!garmentDataUrl)throw new Error('Hãy chọn ảnh trang phục tham chiếu trước.');
  const category=$('garmentCategory').value;const response=await fetch('/api/reference-profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category,image:garmentDataUrl,productReview})});const result=await response.json();
  if(!response.ok||!result.ok){
    const validation=result.validation;
    if(!productReview&&response.status===422&&validation?.reasons?.length===1&&validation.reasons[0]==='Phát hiện người hoặc pose trong ảnh sản phẩm'&&confirm('Bộ nhận diện thấy dáng người trong ảnh. Nếu đây là trang phục đặt phẳng, hãy kiểm tra ảnh: ảnh chỉ có sản phẩm, không có người hoặc ma-nơ-canh? Xác nhận này được lưu cùng checksum ảnh; kết quả vẫn cần smoke qualification.'))return saveReferenceProfile({noPerson:true,sha256:validation.metrics.sha256,reviewer:'Người dùng xác nhận trong ứng dụng'});
    throw new Error(result.error||'Không thể lưu ảnh tham chiếu');
  }
  const metrics=result.validation.metrics;await loadReferenceReadiness();setMessage(`Reference đạt kiểm định và đã lưu cho ${category} · coverage ${Number(metrics.foregroundCoverage).toFixed(3)} · nét ${Number(metrics.sharpness).toFixed(1)} · SHA-256 ${metrics.sha256.slice(0,12)}…`,'success');
}

function referenceSetupSummary(item) {
  const label={upper_body:'Áo',lower_body:'Quần / váy',overall:'Toàn bộ trang phục'}[item.category]||item.category;
  if(item.ready)return {label,status:'✓ Đã kiểm định',next:'Sẵn sàng chạy bộ đánh giá 23 ảnh.'};
  if(!item.reference)return {label,status:item.experimentalReference?'Có ảnh thử nghiệm chưa đạt':'Chưa thiết lập ảnh tham chiếu',next:'Chọn loại trang phục và ảnh sản phẩm tương ứng, rồi bấm “Lưu ảnh tham chiếu cho loại hiện tại”.'};
  if(!item.checksumMatches)return {label,status:'Cần kiểm định lại ảnh',next:'Chọn lại ảnh sản phẩm và lưu ảnh tham chiếu để cập nhật kiểm định.'};
  if(item.status==='failed-smoke')return {label,status:'Ảnh đã lưu · Thử đồ chưa đạt chất lượng',next:'Xem báo cáo smoke qualification, kiểm tra màu, chi tiết vải và đường biên trước khi chạy lại.'};
  return {label,status:'Đã lưu ảnh · Chưa hoàn tất kiểm định',next:'Bấm “Chạy smoke qualification cho loại hiện tại” để kiểm tra trên 3 ảnh người mẫu.'};
}

async function loadReferenceReadiness(){
  const response=await fetch('/api/reference-readiness');const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra reference');
  const container=$('referenceReadiness');container.replaceChildren();
  const intro=document.createElement('p');intro.textContent='Thiết lập bộ ảnh tham chiếu dùng cho đánh giá hàng loạt. Bạn vẫn có thể thay trang phục bằng ảnh vừa chọn trong Studio.';container.appendChild(intro);
  for(const item of result.items){
    const summary=referenceSetupSummary(item),card=document.createElement('article');card.className='model-item';
    const title=document.createElement('strong');title.textContent=summary.label;card.appendChild(title);
    for(const text of [summary.status,item.reference||(item.experimentalReference?`Ảnh thử nghiệm: ${item.experimentalReference}`:''),item.reason,summary.next].filter(Boolean)){
      const line=document.createElement('p');line.textContent=text;card.appendChild(line);
    }
    if(item.reference&&item.blockers.length){const detail=document.createElement('details'),heading=document.createElement('summary'),body=document.createElement('p');heading.textContent='Chi tiết kiểm định';body.textContent=item.blockers.join(' · ');detail.append(heading,body);card.appendChild(detail);}
    container.appendChild(card);
  }
  const current=result.items.find(item=>item.category===$('garmentCategory').value);
  $('benchmarkButton').dataset.ready=String(Boolean(current?.ready));
  $('benchmarkButton').title=current?.ready?'Chạy bộ benchmark 23 ảnh':'Cần lưu và kiểm định ảnh tham chiếu trước';
  return result;
}
async function qualifyReference(){const category=$('garmentCategory').value;setMessage(`Đang smoke qualification ${category}…`);const response=await fetch('/api/qualify-reference',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category,seed:52001,steps:20,maxSide:512})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Qualification thất bại');await loadReferenceReadiness();setMessage(`Qualification ${category}: ${result.passed?'đạt':'không đạt'} ${result.passedCount}/${result.requiredCount} · ${result.report}`,result.passed?'success':'error');}

async function checkAcceptance() {
  const response=await fetch('/api/release-acceptance',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra nghiệm thu');
  $('resultsGrid').innerHTML=result.checks.map((item)=>`<article class="result-card"><p><strong>${item.category}</strong><br><span class="review-badge">${item.passed?'technical-pass':'failed'}</span><br>${item.reasons.join('<br>')||'Đạt tiêu chí kỹ thuật'}</p></article>`).join('');$('comparePanel').hidden=true;$('resultsDialog').showModal();
  setMessage(`Nghiệm thu: ${result.status} · ${result.approvedCount}/23 ảnh được người dùng chấp nhận · ${result.report}`,result.status==='passed'?'success':'error');
}

function setMessage(text, kind = '') {
  $('message').hidden = false;
  $('message').textContent = text+(kind==='error'&&window.StudioGuidance?' '+window.StudioGuidance.recovery(text):'');
  $('message').className = `message ${kind}`;
}

function showCompare(before, after) {
  $('compareBefore').src = before;
  $('compareAfter').src = after;
  $('comparePanel').hidden = false;
  $('compareSlider').value = 50;
  $('compareAfterWrap').style.width = '50%';
}

async function loadReviewState() {
  const response = await fetch('/api/review');
  const result = await response.json();
  if (response.ok && result.ok) reviewState = result.state;
}

async function setReviewStatus(sampleId, status, selected = '', defectLabels = undefined, category = $('garmentCategory').value) {
  const response = await fetch('/api/review', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({category,sampleId,status,selected,defectLabels}),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể lưu trạng thái duyệt');
  reviewState = result.state;
  renderAuditQueue();
}

function renderAuditQueue() {
  const filter = $('reviewFilter').value;
  const visible = auditItems.filter((item)=>filter==='all'||(currentReview(item.sampleId).status||'pending')===filter);
  $('resultsGrid').innerHTML = visible.map((item)=>{
    const status=currentReview(item.sampleId).status||'pending';
    const labels=currentReview(item.sampleId).defectLabels||[];
    return `<article class="result-card"><img src="/samples/${item.sampleId}" alt="${item.sampleId}"><p>${item.sampleId}<br><span class="review-badge">${status}</span> · ${item.orientation} · ${item.people.length} người · SAM ${Number(item.maskScore).toFixed(3)}<br>${item.needsManualReview?'⚠ '+item.reasons.join(', '):'✓ Đạt kiểm tra tự động'}</p><button data-review-id="${item.sampleId}">Mở để duyệt</button><label class="defect-labels">Nhãn lỗi<select multiple data-defects="${item.sampleId}"><option value="seam" ${labels.includes('seam')?'selected':''}>Lỗi biên</option><option value="texture" ${labels.includes('texture')?'selected':''}>Sai hoa văn</option><option value="anatomy" ${labels.includes('anatomy')?'selected':''}>Sai hình thể</option></select></label><div class="review-actions"><button data-status="approved" data-id="${item.sampleId}">Chấp nhận</button><button data-status="retry" data-id="${item.sampleId}">Chạy lại</button><button data-status="rejected" data-id="${item.sampleId}">Loại bỏ</button><button data-status="pending" data-id="${item.sampleId}">Chờ duyệt</button></div></article>`;
  }).join('');
  for (const button of $('resultsGrid').querySelectorAll('[data-status]')) button.addEventListener('click',()=>{const select=document.querySelector(`[data-defects="${button.dataset.id}"]`);const labels=select?[...select.selectedOptions].map((option)=>option.value):[];setReviewStatus(button.dataset.id,button.dataset.status,undefined,labels).catch((error)=>setMessage(error.message,'error'));});
  for (const button of $('resultsGrid').querySelectorAll('[data-review-id]')) button.addEventListener('click', async()=>{
    const index=images.findIndex((item)=>item.id===button.dataset.reviewId);
    if(index>=0){$('imageSelect').value=String(index); await loadImage(images[index]); $('resultsDialog').close(); await detectPeopleInImage(); setTool('person');}
  });
}

let editorZoom=1,editorPan={x:0,y:0},editorPanStart=null,editorPanMode=false;
function updateEditorTransform(){
  const wrap=$('canvasWrap').getBoundingClientRect();
  const limitX=Math.max(0,(parseFloat(canvas.style.width)-wrap.width)/2+wrap.width/3);
  const limitY=Math.max(0,(parseFloat(canvas.style.height)-wrap.height)/2+wrap.height/3);
  editorPan.x=Math.max(-limitX,Math.min(limitX,editorPan.x));
  editorPan.y=Math.max(-limitY,Math.min(limitY,editorPan.y));
  canvas.style.transform=`translate(${editorPan.x}px, ${editorPan.y}px)`;
}
function setEditorZoom(value){
  if(!sourceImage||drawing)return;
  const next=Math.max(1,Math.min(8,value)),ratio=next/editorZoom;
  editorPan.x*=ratio;editorPan.y*=ratio;editorZoom=next;
  if(next===1)editorPan={x:0,y:0};
  fitCanvas();
}
function fitCanvas() {
  if (!sourceImage) return;
  const wrap = $('canvasWrap').getBoundingClientRect();
  const scale = Math.min((wrap.width - 36) / sourceImage.naturalWidth, (wrap.height - 36) / sourceImage.naturalHeight, 1);
  const displayScale=Math.max(0.001,scale)*editorZoom;
  canvas.width = Math.max(1, Math.round(sourceImage.naturalWidth * Math.min(1,displayScale)));
  canvas.height = Math.max(1, Math.round(sourceImage.naturalHeight * Math.min(1,displayScale)));
  canvas.style.width=`${sourceImage.naturalWidth*displayScale}px`;
  canvas.style.height=`${sourceImage.naturalHeight*displayScale}px`;
  $('editorZoomValue').textContent=`${Math.round(editorZoom*100)}%`;
  updateEditorTransform();
  render();
}

$('editorZoomIn').addEventListener('click',()=>setEditorZoom(editorZoom*1.25));
$('editorZoomOut').addEventListener('click',()=>setEditorZoom(editorZoom/1.25));
$('editorZoomFit').addEventListener('click',()=>setEditorZoom(1));
$('editorPanToggle').addEventListener('click',()=>{
  editorPanMode=!editorPanMode;
  $('editorPanToggle').setAttribute('aria-pressed',String(editorPanMode));
  canvas.style.cursor=editorPanMode?'grab':'crosshair';
});
canvas.addEventListener('wheel',(event)=>{
  if(!sourceImage)return;
  event.preventDefault();
  setEditorZoom(editorZoom*(event.deltaY<0?1.15:1/1.15));
},{passive:false});
canvas.addEventListener('auxclick',(event)=>{if(event.button===1)event.preventDefault();});

function render() {
  if (!sourceImage) return;
  window.Character?.checkMasks?.();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.globalAlpha = Number($('overlayOpacity').value) / 100;
  ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = Number($('overlayOpacity').value) / 100;
  ctx.drawImage(protectCanvas, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  window.ImageEnhancement?.drawEdgeGuides?.(ctx);
  window.Makeup?.draw(ctx);
  for (const point of aiPoints) {
    const x = point.x * canvas.width / maskCanvas.width;
    const y = point.y * canvas.height / maskCanvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = point.label === 1 ? '#42df75' : '#ffcf44';
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  for (const person of detectedPeople) {
    const [x0,y0,x1,y1] = person.box;
    const selected = Number($('personSelect').value) === person.index;
    ctx.strokeStyle = selected ? '#42df75' : '#ffcf44';
    ctx.lineWidth = selected ? 4 : 2;
    ctx.strokeRect(x0 * canvas.width / maskCanvas.width, y0 * canvas.height / maskCanvas.height, (x1-x0) * canvas.width / maskCanvas.width, (y1-y0) * canvas.height / maskCanvas.height);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`Người ${person.index+1}`, x0 * canvas.width / maskCanvas.width + 5, y0 * canvas.height / maskCanvas.height + 18);
    if (person.keypoints) for (const point of person.keypoints) {
      if (point[2] < 0.25) continue;
      ctx.beginPath(); ctx.arc(point[0]*canvas.width/maskCanvas.width,point[1]*canvas.height/maskCanvas.height,3,0,Math.PI*2);
      ctx.fillStyle='#35c2ff'; ctx.fill();
    }
  }
}

function snapshot() {
  history.push({
    editable: maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height),
    protected: protectCtx.getImageData(0, 0, protectCanvas.width, protectCanvas.height),
    manualProtected: manualProtectCtx.getImageData(0,0,manualProtectCanvas.width,manualProtectCanvas.height),
  });
  if (history.length > MAX_HISTORY) history.shift();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * maskCanvas.width / rect.width,
    y: (event.clientY - rect.top) * maskCanvas.height / rect.height,
  };
}

function paint(from, to) {
  const size = Number($('brushSize').value);
  const contexts = tool === 'erase' ? [maskCtx, protectCtx, manualProtectCtx] : tool === 'protect' ? [protectCtx,manualProtectCtx] : [maskCtx];
  for (const targetCtx of contexts) {
    targetCtx.save();
    targetCtx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    targetCtx.strokeStyle = tool === 'protect' ? 'rgba(40, 145, 255, 1)' : 'rgba(255, 40, 40, 1)';
    targetCtx.fillStyle = targetCtx.strokeStyle;
    targetCtx.lineWidth = size; targetCtx.lineCap = 'round'; targetCtx.lineJoin = 'round';
    targetCtx.beginPath(); targetCtx.moveTo(from.x, from.y); targetCtx.lineTo(to.x, to.y); targetCtx.stroke();
    targetCtx.beginPath(); targetCtx.arc(to.x, to.y, size / 2, 0, Math.PI * 2); targetCtx.fill();
    targetCtx.restore();
  }
  render();
}

let canvasPointerStart=null,canvasFirstClick=null;
function restoreCanvasBeforeDoubleClick(){
  drawing=false;lastPoint=null;
  const saved=canvasFirstClick;canvasFirstClick=null;
  if(!saved||saved.image!==sourceImage)return;
  if(saved.state){
    maskCtx.putImageData(saved.state.editable,0,0);protectCtx.putImageData(saved.state.protected,0,0);
    manualProtectCtx.clearRect(0,0,manualProtectCanvas.width,manualProtectCanvas.height);
    if(saved.state.manualProtected)manualProtectCtx.putImageData(saved.state.manualProtected,0,0);
    history=saved.history;
  }
  aiPoints=saved.points;$('personSelect').value=saved.person;
  render();refreshStudioReadiness();
}
canvas.addEventListener('click',(event)=>{
  if(event.detail===1)canvasFirstClick=canvasPointerStart;
});
canvas.addEventListener('pointerdown', (event) => {
  if (!sourceImage) return;
  if(editorPanMode||event.button===1||(event.button===0&&event.altKey)){
    event.preventDefault();canvasPointerStart=null;canvasFirstClick=null;
    editorPanStart={id:event.pointerId,x:event.clientX,y:event.clientY,pan:{...editorPan}};
    canvas.setPointerCapture(event.pointerId);return;
  }
  if(event.button!==0)return;
  if(window.ImageEnhancement?.captureEdgePoint?.(event)){canvasPointerStart=null;canvasFirstClick=null;return;}
  canvasPointerStart={image:sourceImage,points:aiPoints.map(point=>({...point})),person:$('personSelect').value};
  if (tool === 'ai') {
    const point = canvasPoint(event);
    aiPoints.push({ ...point, label: event.shiftKey ? 0 : 1 });
    render();
    setMessage(`${aiPoints.length} điểm AI. Nhấn “Tạo mask tự động”.`);
    return;
  }
  if (tool === 'person') {
    const point = canvasPoint(event);
    const matches = detectedPeople.filter((person)=>point.x>=person.box[0]&&point.x<=person.box[2]&&point.y>=person.box[1]&&point.y<=person.box[3]);
    if (matches.length) {
      matches.sort((a,b)=>(a.box[2]-a.box[0])*(a.box[3]-a.box[1])-(b.box[2]-b.box[0])*(b.box[3]-b.box[1]));
      $('personSelect').value=String(matches[0].index); render();
      setMessage(`Đã chọn nhân vật ${matches[0].index+1}.`,'success');
    }
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  snapshot();
  canvasPointerStart.state=history.at(-1);canvasPointerStart.history=history.slice(0,-1);
  drawing = true;
  lastPoint = canvasPoint(event);
  paint(lastPoint, lastPoint);
});
canvas.addEventListener('pointermove', (event) => {
  if(editorPanStart?.id===event.pointerId){
    editorPan={x:editorPanStart.pan.x+event.clientX-editorPanStart.x,y:editorPanStart.pan.y+event.clientY-editorPanStart.y};
    updateEditorTransform();return;
  }
  if (!drawing) return;
  const point = canvasPoint(event);
  paint(lastPoint, point);
  lastPoint = point;
});
canvas.addEventListener('pointerup', () => { editorPanStart=null;drawing = false; lastPoint = null; refreshStudioReadiness(); });
canvas.addEventListener('pointercancel', () => { editorPanStart=null;drawing = false; lastPoint = null; });
canvas.addEventListener('lostpointercapture',()=>{editorPanStart=null;drawing=false;lastPoint=null;});

async function loadImage(item) {
  if(!item)return;
  studioTaskMasks={};
  manualProtectCtx.clearRect(0,0,manualProtectCanvas.width,manualProtectCanvas.height);
  if($('studioResultsTray'))$('studioResultsTray').hidden=true;
  current = item;
  window.ImageEnhancement?.resetEdgeGuides?.();
  window.Makeup?.reset();window.Character?.reset();
  $('saveFullSizeImageButton').disabled=true;
  localStorage.setItem('selectedImageId',item.id);
  window.AtelierStore?.set({selectedImageId:item.id});
  $('loading').hidden = false;
  setMessage('Đang tải ảnh…');
  const img = new Image();
  return new Promise((resolve)=>{
  img.onload = () => {
    if(current?.id!==item.id){resolve(false);return;}
    sourceImage = img;
    editorZoom=1;editorPan={x:0,y:0};editorPanStart=null;
    $('saveFullSizeImageButton').disabled=false;
    maskCanvas.width = img.naturalWidth;
    maskCanvas.height = img.naturalHeight;
    protectCanvas.width = img.naturalWidth;
    protectCanvas.height = img.naturalHeight;
    manualProtectCanvas.width=img.naturalWidth;manualProtectCanvas.height=img.naturalHeight;
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    protectCtx.clearRect(0, 0, protectCanvas.width, protectCanvas.height);
    history = [];
    aiPoints = [];
    detectedPeople = [];
    $('personSelect').innerHTML = '<option value="0">Nhân vật chính</option>';
    $('imageInfo').textContent = `${item.id} · ${img.naturalWidth} × ${img.naturalHeight}`;
    canvas.hidden=false;
    $('emptyCanvasState').hidden=true;
    $('deselectImageButton').disabled=false;
    $('resetEditorButton').disabled=false;
    $('loading').hidden = true;
    fitCanvas();
    $('message').hidden = true;
    refreshStudioReadiness();
    window.StudioGuidance?.renderHistory();
    resolve(true);
  };
  img.onerror = () => { $('loading').hidden = true; setMessage('Không thể tải ảnh.', 'error'); resolve(false); };
  img.src = item.url;
  });
}

function renderImageOptions(selectedId = current?.id) {
  const option=(item,index)=>`<option value="${index}" ${item.id===selectedId?'selected':''}>${escapeHtml(item.sourceType==='user'?item.name:`${item.group} / ${item.name}`)}</option>`;
  const groups=[
    ['Ảnh của bạn',images.map((item,index)=>({item,index})).filter(({item})=>item.sourceType==='user')],
    ['Ảnh mẫu',images.map((item,index)=>({item,index})).filter(({item})=>item.sourceType!=='user')],
  ];
  $('imageSelect').innerHTML=`<option value="" ${selectedId?'':'selected'}>— Chọn ảnh —</option>`+groups.filter(([,entries])=>entries.length).map(([label,entries])=>`<optgroup label="${label}">${entries.map(({item,index})=>option(item,index)).join('')}</optgroup>`).join('');
}

function editorHasChanges(){
  if(!current)return false;
  const maskChanged=editableMaskStats().selected>0;
  return maskChanged||aiPoints.length>0||Boolean(garmentDataUrl)||Boolean($('notes').value.trim())||Boolean(currentRunDirectory);
}

function restoreControlDefault(control){
  if(!control)return;
  if(control.type==='checkbox'||control.type==='radio')control.checked=control.defaultChecked;
  else if(control.tagName==='SELECT')for(const option of control.options)option.selected=option.defaultSelected;
  else if(control.type==='file')control.value='';
  else control.value=control.defaultValue;
}

function resetEditorSession({ask=true}={}){
  if(ask&&editorHasChanges()&&!window.confirm('Đặt lại phiên chỉnh sửa?\n\nMask, ảnh tham chiếu và các thay đổi chưa lưu sẽ bị xóa. Ảnh nguồn và kết quả đã lưu vẫn được giữ nguyên.'))return false;
  studioTaskMasks={};
  window.Character?.reset();
  const selectedInpaintModel=$('inpaintModelSelect')?.value;
  for(const panel of [$('studioInpaintPanel'),$('studioTryonPanel'),$('studioEnhancePanel'),$('studioCharacterPanel')])for(const control of panel?.querySelectorAll('input, select, textarea')||[])restoreControlDefault(control);
  if(selectedInpaintModel)$('inpaintModelSelect').value=selectedInpaintModel;
  for(const id of ['brushSize','overlayOpacity','notes','labelSelect'])restoreControlDefault($(id));
  if(typeof applyPreset==='function')applyPreset($('accessoryPreset').value);
  if(maskCanvas.width&&maskCanvas.height){maskCtx.clearRect(0,0,maskCanvas.width,maskCanvas.height);protectCtx.clearRect(0,0,protectCanvas.width,protectCanvas.height);}
  history=[];aiPoints=[];detectedPeople=[];currentRunDirectory='';garmentDataUrl='';
  $('garmentPreview').hidden=true;$('garmentPreview').removeAttribute('src');
  $('personSelect').innerHTML='<option value="0">Nhân vật chính</option>';
  $('resultsGrid').innerHTML='';if($('resultsDialog').open)$('resultsDialog').close();
  if($('studioResultsTray'))$('studioResultsTray').hidden=true;if($('studioCompareStage'))$('studioCompareStage').hidden=true;
  $('brushValue').textContent=`${$('brushSize').value} px`;$('opacityValue').textContent=`${$('overlayOpacity').value}%`;$('loraWeightValue').textContent=Number($('loraWeight').value).toFixed(2);
  window.StudioWorkspace?.applyQualityDefaults();
  setTool('add');setStudioMode('inpaint');render();refreshStudioReadiness();
  setMessage('Đã đặt lại phiên chỉnh sửa.','success');
  return true;
}

function showEmptyEditorState(message=''){
  current=null;sourceImage=null;drawing=false;lastPoint=null;
  localStorage.removeItem('selectedImageId');
  window.AtelierStore?.set({selectedImageId:''});
  ctx.clearRect(0,0,canvas.width,canvas.height);canvas.hidden=true;
  $('emptyCanvasState').hidden=false;$('loading').hidden=true;$('imageInfo').textContent='Chưa chọn ảnh';
  if($('studioResultsTray'))$('studioResultsTray').hidden=true;
  $('deselectImageButton').disabled=true;$('resetEditorButton').disabled=true;
  $('saveFullSizeImageButton').disabled=true;
  renderImageOptions(null);$('imageSelect').value='';refreshStudioReadiness();
  if(message)setMessage(message,'success');
}

function deselectCurrentImage(){
  if(editorHasChanges()&&!window.confirm('Bỏ chọn ảnh và xóa các thay đổi chưa lưu?\n\nẢnh không bị xóa khỏi máy hoặc danh sách nguồn ảnh.'))return;
  resetEditorSession({ask:false});showEmptyEditorState('Đã bỏ chọn ảnh. Chọn ảnh nguồn trong bảng Thiết lập để tiếp tục.');
}

async function uploadSourceImage(file) {
  if (!file) return;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Chỉ hỗ trợ ảnh PNG, JPG hoặc WebP.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Ảnh cần chỉnh sửa phải nhỏ hơn 20 MB.');
  setMessage('Đang thêm ảnh vào workspace…');
  const data = await new Promise((resolve, reject) => { const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error('Không thể đọc tệp ảnh.')); reader.readAsDataURL(file); });
  const response = await fetch('/api/images/upload', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:file.name,data}) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể thêm ảnh.');
  images = [result.image, ...images.filter((item)=>item.id!==result.image.id)];
  renderImageOptions(result.image.id);
  $('imageSelect').value = '0';
  if(!await loadImage(result.image))throw new Error('Đã lưu ảnh nhưng không thể tải ảnh vào trình chỉnh sửa.');
  setMessage(`Đã thêm ${file.name}. Ảnh chỉ được lưu trên máy này.`, 'success');
}

function setTool(next) {
  tool = next;
  $('addTool').classList.toggle('active', tool === 'add');
  $('eraseTool').classList.toggle('active', tool === 'erase');
  $('aiTool').classList.toggle('active', tool === 'ai');
  $('protectTool').classList.toggle('active', tool === 'protect');
  $('personTool').classList.toggle('active', tool === 'person');
  $('aiHint').hidden = tool !== 'ai';
  $('aiActions').hidden = tool !== 'ai';
  refreshStudioReadiness();
}

async function segmentWithAi() {
  if (!current) return setMessage('Hãy chọn ảnh trước.', 'error');
  if(['upper_body','lower_body','full_body','overall'].includes($('labelSelect')?.value)&&(studioMode!=='tryon'||selectedOutfitType()?.category))return createAutomaticMask('',aiPoints);
  if(studioMode==='tryon'&&selectedOutfitType()?.category)return createAutomaticMask('',aiPoints);
  const clothingCategory={outfit:'overall',sleepwear:'overall',underwear:'overall',shirt:'upper_body',pants:'lower_body'}[$('accessoryPreset')?.value];
  if(studioMode==='inpaint'&&clothingCategory)return createAutomaticMask(clothingCategory,aiPoints);
  const sampleId=current.id,mode=studioMode;
  if (!aiPoints.length) {
    const pixels=maskCtx.getImageData(0,0,maskCanvas.width,maskCanvas.height).data;let sumX=0,sumY=0,count=0;
    for(let index=3,pixel=0;index<pixels.length;index+=4,pixel++){if(pixels[index]>24){sumX+=pixel%maskCanvas.width;sumY+=Math.floor(pixel/maskCanvas.width);count++;}}
    if(count){aiPoints=[{x:Math.round(sumX/count),y:Math.round(sumY/count),label:1}];render();setMessage('Đang dùng tâm vùng đã tô làm gợi ý cho AI…');}
    else{setTool('ai');setMessage('Chế độ Điểm AI đã bật. Hãy nhấp vào vật thể cần chọn rồi bấm “Tạo mask tự động”.','error');return;}
  }
  setMessage('SAM 2 đang phân vùng…');
  $('segmentButton').disabled=true;
  try {
    const response = await fetch('/api/segment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sampleId, points: aiPoints, protectedDetailMask:binaryMaskDataUrl(false,true,true) }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể phân vùng');
    if(current?.id!==sampleId||studioMode!==mode)return;
    const mask = new Image();
    mask.onload = () => {
      if(current?.id!==sampleId||studioMode!==mode)return;
      snapshot();
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      maskCtx.drawImage(mask, 0, 0, maskCanvas.width, maskCanvas.height);
      const pixels = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const selected = pixels.data[i] > 127;
        pixels.data[i] = 255; pixels.data[i + 1] = 40; pixels.data[i + 2] = 40;
        pixels.data[i + 3] = selected ? 255 : 0;
      }
      maskCtx.putImageData(pixels, 0, 0);
      render();
      refreshStudioReadiness();
      setMessage(`Đã tạo mask vật thể · phủ ${(Number(result.coverage)*100).toFixed(1)}% · Đã giữ vùng bảo vệ và điểm loại trừ`, 'success');
    };
    mask.src = result.mask;
  } catch (error) { setMessage(error.message, 'error'); }
  finally{$('segmentButton').disabled=false;}
}

function displayMask(maskUrl, message) {
  const sampleId=current?.id,mode=studioMode;
  const mask = new Image();
  mask.onload = () => {
    if(current?.id!==sampleId||studioMode!==mode)return;
    snapshot();
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskCtx.drawImage(mask, 0, 0, maskCanvas.width, maskCanvas.height);
    const pixels = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const selected = pixels.data[i] > 127;
      pixels.data[i] = 255; pixels.data[i + 1] = 40; pixels.data[i + 2] = 40;
      pixels.data[i + 3] = selected ? 255 : 0;
    }
    maskCtx.putImageData(pixels, 0, 0);
    render();
    refreshStudioReadiness();
    setMessage(message, 'success');
  };
  mask.src = maskUrl;
}

function displayProtectedMask(maskUrl) {
  if (!maskUrl) return;
  const sampleId=current?.id,mode=studioMode;
  const mask = new Image();
  mask.onload = () => {
    if(current?.id!==sampleId||studioMode!==mode)return;
    protectCtx.clearRect(0, 0, protectCanvas.width, protectCanvas.height);
    protectCtx.drawImage(mask, 0, 0, protectCanvas.width, protectCanvas.height);
    const pixels = protectCtx.getImageData(0, 0, protectCanvas.width, protectCanvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const selected = pixels.data[i] > 127;
      pixels.data[i] = 0; pixels.data[i + 1] = 120; pixels.data[i + 2] = 255;
      pixels.data[i + 3] = selected ? 180 : 0;
    }
    protectCtx.putImageData(pixels, 0, 0);
    render();
  };
  mask.src = maskUrl;
}

async function createAutomaticMask(categoryOverride = '', points = []) {
  if (!current) return setMessage('Hãy chọn ảnh cần chỉnh sửa trước khi tạo mask.', 'error');
  const sampleId=current.id,mode=studioMode;
  const preset=$('accessoryPreset')?.value;
  const region=$('labelSelect')?.value;
  const regionCategories={shirt:'upper_body',pants:'lower_body',outfit:'overall',sleepwear:'overall',underwear:'overall'};
  const selectedCategory={upper_body:'upper_body',lower_body:'lower_body',full_body:'overall',overall:'overall'}[region];
  if(mode==='tryon'&&!categoryOverride&&!selectedOutfitType()?.category)return segmentWithAi();
  const category=categoryOverride||selectedCategory||(mode==='inpaint'?regionCategories[preset]:selectedOutfitType()?.category);
  if(!category)return segmentWithAi();
  $('autoMaskButton').disabled = true;
  $('segmentButton').disabled = true;
  setMessage('Đang chọn vùng trang phục và bảo vệ khuôn mặt, tóc, bàn tay…');
  try {
    const response = await fetch('/api/auto-mask', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sampleId, category, personIndex:Number($('personSelect').value), points, inferCategoryFromPoints:false, protectedDetailMask:binaryMaskDataUrl(false,true,true),...(mode==='tryon'?{targetGarment:targetGarmentValues()}: {})}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể tạo mask tự động');
    if(current?.id!==sampleId||studioMode!==mode)return;
    if($('labelSelect')?.value!==region)return;
    if(mode==='inpaint'&&$('accessoryPreset')?.value!==preset)return;
    if(mode==='tryon'&&!selectedCategory&&!categoryOverride&&$('garmentCategory').value!==category)return;
    if(result.category!==category)throw new Error('Loại mask trả về không khớp nhãn vùng đã chọn.');
    const label={upper_body:'áo',lower_body:'quần / váy',overall:'toàn bộ trang phục',full_body:'toàn bộ trang phục'}[result.category];
    displayMask(result.mask, `Đã tạo mask ${label} · ${result.accepted?'Đã bảo vệ mặt, tóc và bàn tay':'Vùng chọn chưa đủ, hãy thêm điểm hoặc tô bổ sung'} · phủ ${(Number(result.coverage)*100).toFixed(1)}%`);
    displayProtectedMask(result.protectedMask);
    if(result.targetCoverage?.warnings?.length)setMessage(result.targetCoverage.warnings.join(' '),'error');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { $('autoMaskButton').disabled = false; $('segmentButton').disabled = false; }
}

async function detectPeopleInImage() {
  if (!current) return setMessage('Hãy chọn ảnh trước khi phát hiện nhân vật.', 'error');
  $('detectPeopleButton').disabled = true;
  setMessage('Đang phát hiện nhân vật bằng bộ dò local…');
  try {
    const response = await fetch('/api/analyze-people', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sampleId:current.id,usePose:$('usePoseToggle').checked}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể phát hiện nhân vật');
    $('personSelect').innerHTML = result.people.map((person)=>`<option value="${person.index}">Nhân vật ${person.index + 1} · ${person.source}</option>`).join('');
    detectedPeople = result.people;
    render();
    setMessage(`Đã phát hiện ${result.people.length} nhân vật. Chọn nhân vật rồi tạo mask.`, 'success');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { $('detectPeopleButton').disabled = false; }
}

async function preprocessGarment() {
  if (!garmentDataUrl) return setMessage('Hãy chọn ảnh trang phục tham chiếu.', 'error');
  $('preprocessGarmentButton').disabled = true;
  setMessage('Đang tách nền và căn lại ảnh trang phục…');
  try {
    const response = await fetch('/api/preprocess-garment', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({garmentImage:garmentDataUrl,category:$('garmentCategory').value,referenceType:$('referenceType')?.value||'auto'}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể tiền xử lý trang phục');
    garmentDataUrl = result.image;
    if($('referenceType'))$('referenceType').value='product';
    $('garmentPreview').src = garmentDataUrl;
    setMessage(`Đã chuẩn hóa ${result.mode==='model-photo'?'ảnh người mẫu':'ảnh sản phẩm'} · vùng giữ lại ${(result.coverage * 100).toFixed(1)}% · SAM ${Number(result.score).toFixed(3)}`, 'success');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { $('preprocessGarmentButton').disabled = false; }
}

function binaryMaskDataUrl(invert = false, protectedOnly = false, manualOnly = false) {
  const out = document.createElement('canvas');
  out.width = maskCanvas.width;
  out.height = maskCanvas.height;
  const outCtx = out.getContext('2d');
  const source = (protectedOnly ? manualOnly ? manualProtectCtx : protectCtx : maskCtx).getImageData(0, 0, out.width, out.height);
  const protection = protectCtx.getImageData(0, 0, out.width, out.height);
  const result = outCtx.createImageData(out.width, out.height);
  for (let i = 0; i < source.data.length; i += 4) {
    const selected = source.data[i + 3] > 0 && (protectedOnly || protection.data[i + 3] === 0);
    const value = (invert ? !selected : selected) ? 255 : 0;
    result.data[i] = value;
    result.data[i + 1] = value;
    result.data[i + 2] = value;
    result.data[i + 3] = 255;
  }
  outCtx.putImageData(result, 0, 0);
  return out.toDataURL('image/png');
}

function editableMaskStats() {
  const total = maskCanvas.width * maskCanvas.height;
  if (!total) return { selected: 0, total: 0, minimum: 1, coverage: 0 };
  const editable = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  const protectedPixels = protectCtx.getImageData(0, 0, protectCanvas.width, protectCanvas.height).data;
  let selected = 0;
  for (let i = 3; i < editable.length; i += 4) {
    if (editable[i] > 0 && protectedPixels[i] === 0) selected++;
  }
  return { selected, total, minimum: Math.max(16, Math.ceil(total * 0.0001)), coverage: selected / total };
}

function highlightMaskTools() {
  const tools = $('addTool')?.closest('.tool-group');
  const workspace = canvas.closest('.canvas-wrap');
  for (const element of [tools, workspace]) {
    if (!element) continue;
    element.classList.remove('mask-attention');
    requestAnimationFrame(() => element.classList.add('mask-attention'));
    setTimeout(() => element.classList.remove('mask-attention'), 2600);
  }
}

function showMaskGuide(stats) {
  const preset = $('accessoryPreset').selectedOptions[0]?.textContent?.trim() || 'hiện tại';
  const empty = stats.selected === 0;
  $('maskGuideTitle').textContent = empty ? 'Chọn vùng trước khi tạo phương án' : 'Vùng chọn đang quá nhỏ';
  $('maskGuideText').textContent = empty
    ? `Hãy tô lên vật thể hoặc để AI tạo vùng theo preset “${preset}”.`
    : `Vùng hiện tại chỉ chiếm ${(stats.coverage * 100).toFixed(3)}% ảnh. Hãy mở rộng vùng hoặc để AI tạo lại mask “${preset}”.`;
  $('emptyMaskDialog').showModal();
  highlightMaskTools();
  setMessage(empty ? 'Chưa chọn vùng cần xóa.' : 'Vùng chọn quá nhỏ để tạo kết quả ổn định.', 'error');
}

async function createMaskFromInpaintPreset() {
  const preset = $('accessoryPreset').value;
  const garmentCategories = { shirt: 'upper_body', pants: 'lower_body', outfit: 'overall' };
  const objectClasses = { glasses: 'glasses', hat: 'hat', jewelry: 'necklace, jewelry', bag: 'handbag, bag', shoes: 'shoes' };
  if (garmentCategories[preset]) return createAutomaticMask(garmentCategories[preset]);
  if (objectClasses[preset]) {
    $('yoloClasses').value = objectClasses[preset];
    return detectWithManagedModel('yolo-world');
  }
  setTool('ai');
  $('aiTool').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setMessage('Nhấp vào vật thể cần xóa, sau đó chọn “Tạo mask tự động”.');
}

async function save() {
  if (!current || !sourceImage) return setMessage('Hãy chọn ảnh trước khi lưu vùng chỉnh sửa.', 'error');
  setMessage('Đang lưu…');
  try {
    const response = await fetch('/api/masks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleId: current.id,
        imageWidth: sourceImage.naturalWidth,
        imageHeight: sourceImage.naturalHeight,
        label: $('labelSelect').value,
        notes: $('notes').value,
        brushSize: Number($('brushSize').value),
        editableMask: binaryMaskDataUrl(false),
        protectedDetailMask: binaryMaskDataUrl(false, true),
        protectedMask: binaryMaskDataUrl(true),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không thể lưu');
    setMessage(`Đã lưu: ${result.directory}`, 'success');
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

let inpaintPromptReviewPending=false;
function reviewGenerationPrompts(initial,request={}){
  const dialog=$('generationPromptDialog'),form=$('generationPromptForm'),positive=$('generationPrompt'),negative=$('generationNegativePrompt');
  const panel=$('generationEncoderPrompts');
  let revision=0,timer,closed=false;
  const render=(result)=>{
    if(result.encoders?.length)negative.disabled=result.encoders.every(encoder=>encoder.negativeTokens==null);
    const safe=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    panel.innerHTML=(result.encoders||[]).map(encoder=>`<article class="encoder-prompt encoder-${encoder.kind==='t5'?'t5':'clip'}"><strong>${safe(encoder.name)} · ${safe(encoder.tokens)} / ${safe(encoder.limit)} token${encoder.tokens>encoder.limit?' · Vượt giới hạn':''}</strong><pre>${safe(encoder.prompt)}</pre><small>${encoder.negativeTokens==null?'Model không dùng negative prompt':`Negative prompt: ${safe(encoder.negativeTokens)} / ${safe(encoder.limit)} token${encoder.negativeTokens>encoder.limit?' · Vượt giới hạn':''}`}</small></article>`).join('');
    if(result.tokenError)panel.textContent=result.tokenError;
  };
  const refresh=()=>{
    const version=++revision;clearTimeout(timer);panel.textContent='Đang cập nhật token…';
    timer=setTimeout(async()=>{
      try{
        const response=await fetch('/api/inpaint-prompts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,confirmedPrompts:{prompt:positive.value.trim(),negativePrompt:negative.value.trim()}})});
        const result=await response.json();if(!response.ok||!result.ok)throw new Error();
        if(!closed&&version===revision)render(result);
      }catch{if(!closed&&version===revision)panel.textContent='Chưa xác định được số token. Hãy kiểm tra nội dung prompt và tokenizer của model.';}
    },300);
  };
  const reset=()=>{++revision;clearTimeout(timer);positive.value=initial.prompt;negative.value=initial.negativePrompt;positive.setCustomValidity('');render(initial);};
  reset();
  return new Promise((resolve)=>{
    const close=()=>dialog.close();
    const submit=(event)=>{event.preventDefault();if(!positive.value.trim()){positive.setCustomValidity('Hãy nhập prompt trước khi xác nhận.');positive.reportValidity();return;}dialog.returnValue='confirmed';dialog.close();};
    const clearValidity=()=>{positive.setCustomValidity('');refresh();};
    const finished=()=>{
      closed=true;++revision;clearTimeout(timer);negative.removeEventListener('input',refresh);
      form.removeEventListener('submit',submit);positive.removeEventListener('input',clearValidity);
      for(const id of ['cancelGenerationPrompt','backGenerationPrompt'])$(id).removeEventListener('click',close);
      $('resetGenerationPrompt').removeEventListener('click',reset);
      resolve(dialog.returnValue==='confirmed'?{prompt:positive.value.trim(),negativePrompt:negative.value.trim()}:null);
    };
    dialog.returnValue='';
    dialog.addEventListener('close',finished,{once:true});form.addEventListener('submit',submit);positive.addEventListener('input',clearValidity);negative.addEventListener('input',refresh);
    for(const id of ['cancelGenerationPrompt','backGenerationPrompt'])$(id).addEventListener('click',close);
    $('resetGenerationPrompt').addEventListener('click',reset);dialog.showModal();positive.focus();
  });
}

async function runInpaint() {
  if(descriptionTryonRunning)return setMessage('Hãy hoàn tất tác vụ thay trang phục hiện tại.', 'error');
  if(studioResultInstructionsDirty())return setMessage('Hãy lưu hướng dẫn kết quả sau khi xóa trước khi tạo ảnh.', 'error');
  if (!current || !sourceImage) return setMessage('Hãy chọn ảnh cần chỉnh sửa trước.', 'error');
  if (['sleepwear','underwear','mannequin'].includes($('accessoryPreset').value) && !$('inpaintPrompt').value.trim()) return setMessage('Preset này đang trống. Hãy nhập mô tả trong Studio hoặc chỉnh sửa tại màn Prompt trước khi tạo ảnh.', 'error');
  const maskStats = editableMaskStats();
  if (maskStats.selected < maskStats.minimum) {
    showMaskGuide(maskStats);
    return;
  }
  if(inpaintPromptReviewPending||activeJobId)return setMessage('Hãy hoàn tất xác nhận hoặc tác vụ hiện tại.', 'error');
  const request={
        sampleId: current.id,
        modelId: $('inpaintModelSelect').value,
        removalTarget: ['sleepwear','underwear','mannequin'].includes($('accessoryPreset').value)?'custom':$('accessoryPreset').value,
        objectLabel: $('inpaintObjectLabel')?.value?.trim() || '',
        fillMode: $('inpaintFillMode').value,
        forbiddenReplacement: $('inpaintFillMode').value==='base_layer'?'':['sleepwear','underwear','mannequin'].includes($('accessoryPreset').value)?'':['outfit','shirt'].includes($('accessoryPreset').value)?'upper-body garment':$('accessoryPreset').value==='pants'?'lower-body garment':'replacement object',
        editableMask: binaryMaskDataUrl(false),
        protectedDetailMask: binaryMaskDataUrl(false,true),
        prompt: $('inpaintPrompt').value,
        negativePrompt: $('inpaintNegativePrompt').disabled ? '' : $('inpaintNegativePrompt').value,
        seed: seedForRun('inpaintSeed'),
        count: Number($('inpaintCount').value),
        expand: Number($('maskExpand').value),
        blur: Number($('maskBlur').value),
        steps: Number($('inpaintSteps').value),
        strength: Number($('inpaintStrength').value),
        guidance: Number($('inpaintGuidance').value),
        cropPadding: Number($('cropPadding').value), contextRatio: 0.30,
        maxSide: Number($('inpaintResolution').value),
        autoRetry: true,
        maxAutoRetries: 1,
        useModelProfile: true,
        semanticCheck: true,
      };
  let confirmedPrompts;
  inpaintPromptReviewPending=true;
  try{
    const response=await fetch('/api/inpaint-prompts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelId:request.modelId,removalTarget:request.removalTarget,fillMode:request.fillMode,forbiddenReplacement:request.forbiddenReplacement,prompt:request.prompt,negativePrompt:request.negativePrompt})});
    const result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tổng hợp prompt');
    confirmedPrompts=await reviewGenerationPrompts(result,{modelId:request.modelId,fillMode:request.fillMode});
    if(!confirmedPrompts)return;
    if(activeJobId)return setMessage('Một tác vụ khác đang chạy. Hãy thử lại sau.', 'error');
  }catch(error){setMessage(error.message,'error');return;}
  finally{inpaintPromptReviewPending=false;}
  setMessage('Đang kiểm tra ảnh và chuẩn bị Inpainting…');
  const jobId=createJobId('inpaint');setActiveJob(jobId);let jobSucceeded=false,jobError='';
  try {
    const response = await fetch('/api/inpaint', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({...request, jobId, confirmedPrompts}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể inpaint');
    jobSucceeded=true;
    currentRunDirectory = result.directory;
    const sourceCard = `<article class="result-card"><img src="${current.url}" alt="Ảnh gốc"><p>Ảnh gốc</p></article>`;
    $('resultsGrid').innerHTML = sourceCard + result.results.map((item) => `
      <article class="result-card">
        <img src="${item.image}" alt="Kết quả seed ${item.seed}">
        <p>Seed ${item.seed} · ${result.width} × ${result.height} · ${result.device}<br>Thay đổi ngoài mask: ${(item.outsideMaskMAE * 100).toFixed(3)}% · ${item.removalCheck?.statusLabel||'Chưa kiểm tra phần còn sót'}</p>
        <button data-seed="${item.seed}">Chọn làm kết quả chính</button>
      </article>`).join('');
    for (const button of $('resultsGrid').querySelectorAll('[data-seed]')) {
      button.addEventListener('click', () => selectPrimary(Number(button.dataset.seed), button));
    }
    const selected = result.results.find((item)=>item.seed===result.selectedSeed) || result.results[0];
    presentStudioResults(current.url,selected?.image||'');
    if (selected) showCompare(current.url, selected.image);
    setMessage(`Đã tạo ${result.results.length} phương án bằng ${result.modelName||'model mặc định'} · ${result.removalPassed||0} vượt kiểm tra nhận diện. Hãy xem lại nền và đường biên trước khi chọn.`, result.removalPassed ? 'success' : 'info');
  } catch (error) { jobError=error.message;setMessage(error.message, 'error'); }
  finally { await settleJob(jobId,jobSucceeded?'completed':'failed',jobError); }
}

async function loadRuntimeModelStatus(){const response=await fetch('/api/runtime-model-status');const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra công cụ');const names={'adetailer':'ADetailer','yolo-world':'YOLO-World','grounding-dino-base':'Grounding DINO','florence-2-large':'Florence-2'};$('runtimeModelStatus').textContent=Object.entries(names).map(([id,name])=>{const model=result.models[id];return `${name}: ${model?.loaded?'Đã nạp vào bộ nhớ':model?.ready?'Đã có tệp · chưa nạp':'Thiếu tệp công cụ'}`;}).join('\n');return result;}


let regionDetection = null, regionController = null;
function selectedRegions(){
  if(!regionDetection || regionDetection.sampleId!==current?.id || regionDetection.mode!==studioMode) throw new Error('Ảnh đã đổi. Hãy tìm đối tượng lại.');
  const indices=[...$('regionChoices').querySelectorAll('input:checked')].map(input=>Number(input.value));
  const items=regionDetection.items.filter(item=>indices.includes(item.index));
  if(!items.length)throw new Error('Hãy chọn ít nhất một đối tượng.');
  return items;
}
async function applyDetectedRegions(){
  const items=selectedRegions(),sampleId=current.id,mode=studioMode;
  const canvas=document.createElement('canvas');canvas.width=maskCanvas.width;canvas.height=maskCanvas.height;
  const ctx=canvas.getContext('2d'),selected=new Uint8Array(canvas.width*canvas.height);
  for(const item of items){
    const img=new Image();img.src=item.mask;await img.decode();ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    for(let i=0;i<selected.length;i++)if(pixels[i*4]>127)selected[i]=1;
  }
  if(current?.id!==sampleId||studioMode!==mode)throw new Error('Ảnh đã đổi. Hãy tìm đối tượng lại.');
  snapshot();const pixels=maskCtx.getImageData(0,0,canvas.width,canvas.height),merge=$('regionMergeMode').value;
  for(let i=0;i<selected.length;i++){
    const old=pixels.data[i*4+3]>127,active=merge==='add'?old||selected[i]:merge==='subtract'?old&&!selected[i]:selected[i];
    pixels.data[i*4]=255;pixels.data[i*4+1]=40;pixels.data[i*4+2]=40;pixels.data[i*4+3]=active?255:0;
  }
  maskCtx.putImageData(pixels,0,0);render();refreshStudioReadiness();setMessage('Đã áp dụng vùng chọn. Kiểm tra vùng đỏ trước khi chỉnh sửa.','success');
}
async function detectWithManagedModel(model){
  if(!current)throw new Error('Hãy chọn ảnh cần chỉnh sửa.');
  if(regionController||activeJobId)throw new Error('Hãy hoàn tất tác vụ hiện tại.');
  const target=current.id,mode=studioMode,classes=$('yoloClasses').value.split(',').map(item=>item.trim()).filter(Boolean);
  if(model!=='adetailer'&&!classes.length)throw new Error('Hãy nhập đối tượng cần chọn bằng tiếng Anh.');
  const controller=new AbortController();regionController=controller;regionDetection=null;
  $('regionResults').hidden=true;$('adetailerRefineButton').disabled=true;
  $('cancelRegionButton').hidden=false;$('regionDetectButton').disabled=true;$('adetailerMaskButton').disabled=true;
  $('regionProgress').textContent='Đang nhận diện và tạo vùng chọn…';
  try{
    const response=await fetch('/api/detect-regions',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({sampleId:target,model,classes,confidence:.25,padding:model==='adetailer'?12:8})});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể phát hiện vùng');
    if(current?.id!==target||studioMode!==mode)return;
    if(!result.count)throw new Error('Không tìm thấy đối tượng phù hợp. Thử mô tả hoặc bộ nhận diện khác.');
    regionDetection={sampleId:target,mode,model,items:result.detections};
    $('regionChoices').replaceChildren();
    for(const [position,item] of result.detections.entries()){
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=item.index;input.checked=true;
      const preview=document.createElement('canvas');preview.width=64;preview.height=64;preview.setAttribute('aria-hidden','true');
      const [x0,y0,x1,y1]=item.box;
      if(sourceImage&&x1>x0&&y1>y0)preview.getContext('2d').drawImage(sourceImage,x0,y0,x1-x0,y1-y0,0,0,64,64);
      label.append(input,preview,document.createTextNode(`${model==='adetailer'?'Khuôn mặt':item.label} ${position+1}`));$('regionChoices').append(label);
    }
    $('regionResults').hidden=false;$('adetailerRefineButton').disabled=model!=='adetailer';
    $('regionProgress').textContent=`Tìm thấy ${result.count} vùng. Chọn đối tượng rồi áp dụng. ${result.warning||''}`;
  }catch(error){$('regionProgress').textContent=error.name==='AbortError'?'Đã hủy chờ kết quả. Lượt xử lý trên máy chủ có thể còn đang hoàn tất.':error.message;if(error.name!=='AbortError')throw error;}
  finally{regionController=null;$('cancelRegionButton').hidden=true;$('regionDetectButton').disabled=false;$('adetailerMaskButton').disabled=false;}
}

async function runAdetailerRefine(){if(!current)throw new Error('Hãy chọn ảnh cần chỉnh sửa.');if(activeJobId||regionController)throw new Error('Hãy hoàn tất tác vụ hiện tại.');const faces=selectedRegions();if(regionDetection.model!=='adetailer')throw new Error('Hãy tìm khuôn mặt trước.');const jobId=createJobId('adetailer');setActiveJob(jobId);$('adetailerRefineButton').disabled=true;try{const response=await fetch('/api/adetailer-refine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId,sampleId:current.id,faceIndices:faces.map(item=>item.index),strength:Number($('faceStrength').value),seed:seedForRun('inpaintSeed'),steps:Number($('inpaintSteps').value),guidance:Number($('inpaintGuidance').value),count:1,maxSide:768})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tinh chỉnh khuôn mặt');currentRunDirectory=result.directory;$('resultsGrid').innerHTML=`<article class="result-card"><img src="${current.url}" alt="Ảnh gốc"><p>Ảnh gốc</p></article>`+result.results.map((item)=>`<article class="result-card"><img src="${item.image}" alt="ADetailer"><p>ADetailer · seed ${item.seed}</p><button data-seed="${item.seed}">Dùng kết quả này</button></article>`).join('');for(const button of $('resultsGrid').querySelectorAll('[data-seed]'))button.addEventListener('click',()=>selectPrimary(Number(button.dataset.seed),button));$('comparePanel').hidden=true;presentStudioResults(current.url);$('resultsDialog').showModal();setMessage(`ADetailer đã tinh chỉnh ${result.detector.count} khuôn mặt.`,'success');}finally{$('adetailerRefineButton').disabled=false;setActiveJob('');}}

let loraStatusRequest=0;
async function loadLoraStatus(){
  const request=++loraStatusRequest,modelId=$('inpaintModelSelect').value;
  $('applyLoraButton').disabled=true;
  const selected=new Set([...$('loraSelect').selectedOptions].map((option)=>option.value));
  const response=await fetch(`/api/lora-status?modelId=${encodeURIComponent(modelId)}`,{cache:'no-store'}),result=await response.json();
  if(request!==loraStatusRequest)return;
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc LoRA');
  const active=new Set(result.active.map((item)=>item.id));
  const adapters=result.adapters.filter((item)=>item.compatible).sort((a,b)=>Number(b.usable)-Number(a.usable)||String(a.name||a.id).localeCompare(String(b.name||b.id),'vi'));
  $('loraPanelTitle').textContent=`LoRA · ${result.model.name}`;
  $('loraSelect').innerHTML=adapters.map((item)=>{
    const state=!item.available?'thiếu tệp':!item.compatible?'không tương thích SD3.5':!item.checksumValid?'cần kiểm tra tệp':!item.usable?'đã tắt':active.has(item.id)?'đang bật':'sẵn sàng';
    return `<option value="${escapeHtml(item.id)}" ${item.usable?'':'disabled'} ${item.usable&&(selected.has(item.id)||active.has(item.id))?'selected':''}>${escapeHtml(item.name||item.id)} · ${state}</option>`;
  }).join('')||'<option disabled>Chưa có LoRA tương thích với model này</option>';
  $('applyLoraButton').disabled=!adapters.some((item)=>item.usable);
  $('loraSelect').size=Math.max(1,Math.min(4,adapters.length));
  $('loraSelect').disabled=!adapters.some((item)=>item.usable);
  $('loraWeight').disabled=!adapters.some((item)=>item.usable);
  $('loraStatus').textContent=`${adapters.length} LoRA tương thích · ${adapters.filter((item)=>item.usable).length} khả dụng · ${active.size} đang bật cho ${result.model.name}.`;
}

async function loadModels(){const response=await fetch('/api/models');const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể quét model');const ready=result.models.filter((item)=>item.operationalReady!==false&&item.ready).length;const size=result.models.reduce((sum,item)=>sum+Number(item.sizeBytes||0),0)/1073741824;$('modelSummary').textContent=`${ready}/${result.models.length} model có thể sử dụng · ${size.toFixed(2)} GB${result.restartRequired?' · cần khởi động lại dịch vụ AI':''}`;$('modelList').innerHTML=result.models.map((item)=>{const usable=item.ready&&item.operationalReady!==false;const state=usable?(item.active?'✓ đang dùng':'✓ có thể sử dụng'):(item.runtimeReason||('✗ '+item.reasons.join(', ')));return `<article class="model-item"><strong>${item.name}</strong> · ${item.kind}<br>${item.resolvedPath}<br>${(item.sizeBytes/1073741824).toFixed(2)} GB · ${state}<div class="button-row"><button data-model-activate="${item.id}" ${item.ready&&!item.active?'':'disabled'}>${item.active?(usable?'✓ Đang dùng':'Đã chọn · chờ phụ thuộc'):'Kích hoạt'}</button><button data-model-quarantine="${item.id}" ${item.active?'disabled':''}>Cách ly</button></div></article>`;}).join('');$('quarantineList').innerHTML=(result.quarantine||[]).map((item)=>`<article class="model-item"><strong>${item.name}</strong> · đang cách ly<br>${item.path}<button data-model-restore="${item.id}">Khôi phục</button></article>`).join('');for(const button of document.querySelectorAll('[data-model-activate]'))button.addEventListener('click',()=>activateManagedModel(button.dataset.modelActivate).catch((error)=>setMessage(error.message,'error')));for(const button of document.querySelectorAll('[data-model-quarantine]'))button.addEventListener('click',()=>quarantineManagedModel(button.dataset.modelQuarantine).catch((error)=>setMessage(error.message,'error')));for(const button of document.querySelectorAll('[data-model-restore]'))button.addEventListener('click',()=>restoreManagedModel(button.dataset.modelRestore).catch((error)=>setMessage(error.message,'error')));}
let modelInventory=[];
function formatModelSize(item){if(item.downloaded&&Number(item.sizeBytes)>0)return `${(Number(item.sizeBytes)/1073741824).toFixed(2)} GB trên máy`;if(Number(item.estimatedDownloadGb)>0)return `~${Number(item.estimatedDownloadGb).toFixed(1)} GB tải xuống (ước tính)`;return 'Dung lượng chưa khai báo';}
function renderModelInventory(){const query=$('modelInventorySearch').value.trim().toLowerCase(),status=$('modelInventoryStatus').value,kind=$('modelInventoryKind').value,architecture=$('modelInventoryArchitecture').value,compatibility=$('modelInventoryCompatibility').value,names=new Map(modelInventory.map((item)=>[item.id,item.name])),compatibilityLabels={ready:'Dùng ngay',dependency:'Cần model nền',integration:'Cần tích hợp',restricted:'Giấy phép hạn chế'},kindLabels={'text-to-image':'Tạo ảnh từ mô tả',dependency:'Model phụ thuộc'};const items=modelInventory.filter((item)=>{const level=item.compatibility||(item.kind==='dependency'?'dependency':'ready'),haystack=[item.name,item.author,item.style,item.kind,item.architecture,item.features?.join(' ')].join(' ').toLowerCase(),matchesKind=kind==='all'||item.kind===kind||(kind==='text-to-image'&&(item.features||[]).some((feature)=>String(feature).toLowerCase()==='text-to-image'));return(!query||haystack.includes(query))&&(status==='all'||(status==='downloaded')===Boolean(item.downloaded))&&matchesKind&&(architecture==='all'||item.architecture===architecture)&&(compatibility==='all'||level===compatibility);});$('modelCandidateList').innerHTML=items.map((item)=>{const waiting=!item.downloaded,downloading=item.status==='downloading',accessRequired=item.download?.errorCode==='access-required',dependencies=(item.dependencies||[]).map((id)=>names.get(id)||id),type=kindLabels[item.kind]||(item.style||item.kind||'Model'),format=item.formatLabel||item.architecture||'Chưa khai báo',description=item.description||item.resolvedPath||item.path||'',level=item.compatibility||(item.kind==='dependency'?'dependency':'ready'),action=waiting&&item.source&&item.source!=='local'?`<button class="button-link" data-model-download="${escapeHtml(item.id)}" ${downloading?'disabled':''}>${downloading?'Đang tải…':accessRequired?'Thử lại sau khi cấp quyền':item.status==='download-failed'?'Thử lại':'Tải về'}</button>`:'',features=(item.features||[]).join(' · '),progress=downloading?`<div class="model-download-progress"><i style="width:${Math.max(2,Number(item.download?.percent)||2)}%"></i></div>`:'',statusText=downloading?(item.download?.percent?`Đang tải ${item.download.percent}%`:'Đang tải về…'):accessRequired?'Chưa được Hugging Face cấp quyền truy cập':item.status==='download-failed'?`Tải lỗi: ${item.download?.error||'không rõ nguyên nhân'}`:waiting?'Đang chờ tải về':'✓ Đã tải về';return `<article class="model-item model-candidate ${waiting?'is-waiting':'is-downloaded'}"><div class="candidate-heading"><strong>${escapeHtml(item.name)}</strong><span class="state-badge">${escapeHtml((item.architecture||item.kind||'MODEL').toUpperCase())}</span></div><small>${escapeHtml(type)} · ${escapeHtml(format)}</small><div><span class="compatibility-badge ${escapeHtml(level)}">${escapeHtml(compatibilityLabels[level]||level)}</span></div><div class="model-quick-facts"><span>${escapeHtml(formatModelSize(item))}</span><span>VRAM ${escapeHtml(item.recommendedVramGb||'chưa khai báo')} GB</span><span>${escapeHtml(item.resolution||'Độ phân giải chưa khai báo')}</span></div><p>${escapeHtml(description)}</p>${dependencies.length?`<p class="model-dependencies"><strong>Phụ thuộc:</strong> ${escapeHtml(dependencies.join(', '))}</p>`:''}${item.integrationNote?`<p class="integration-note"><strong>Để sử dụng:</strong> ${escapeHtml(item.integrationNote)}</p>`:''}${progress}<details class="model-details"><summary>Xem chi tiết</summary><dl><dt>Phiên bản</dt><dd>${escapeHtml(item.version||'Chưa khai báo')}</dd><dt>Pipeline</dt><dd>${escapeHtml(item.pipeline||'Tự nhận diện')}</dd><dt>Precision</dt><dd>${escapeHtml(item.precision||'Theo model')}</dd><dt>Chuyển đổi</dt><dd>${escapeHtml(item.conversion||'Không yêu cầu')}</dd><dt>Giấy phép</dt><dd>${escapeHtml(item.license||'Chưa khai báo')}</dd><dt>Thương mại</dt><dd>${escapeHtml(item.commercialUse||'Cần kiểm tra giấy phép')}</dd><dt>Tác giả</dt><dd>${escapeHtml(item.author||'Chưa khai báo')}</dd><dt>Đường dẫn</dt><dd>${escapeHtml(item.resolvedPath||item.targetPath||item.path||'Chưa xác định')}</dd><dt>SHA-256</dt><dd>${escapeHtml(item.sha256||'Chưa xác minh')}</dd><dt>Tính năng</dt><dd>${escapeHtml(features||'Chưa khai báo')}</dd><dt>Kiểm thử</dt><dd>${escapeHtml(item.status==='integrated-smoke-passed'?'Smoke test đạt':item.downloaded&&level==='ready'?'Chưa smoke test riêng':level==='ready'?'Chờ tải model':'Chưa tích hợp vào pipeline')}</dd></dl></details><div class="button-row">${action}${item.source&&item.source!=='local'?`<a class="button-link secondary" href="${escapeHtml(item.source)}" target="_blank" rel="noopener noreferrer">${accessRequired?'Mở trang cấp quyền':'Xem nguồn'}</a>`:''}<span class="candidate-status">${escapeHtml(statusText)}</span></div></article>`;}).join('')||'<p class="models-empty">Không có model phù hợp bộ lọc.</p>';for(const button of document.querySelectorAll('[data-model-download]'))button.addEventListener('click',()=>startModelDownload(button.dataset.modelDownload).catch((error)=>setMessage(error.message,'error')));}
const renderModelInventoryWithoutPercent=renderModelInventory;
renderModelInventory=function(){renderModelInventoryWithoutPercent();for(const bar of $('modelCandidateList').querySelectorAll('.model-download-progress')){const card=bar.closest('.model-candidate'),name=card?.querySelector('.candidate-heading strong')?.textContent,item=modelInventory.find((model)=>model.name===name&&model.status==='downloading'),percent=Number(item?.download?.percent||0);bar.setAttribute('role','progressbar');bar.setAttribute('aria-label',`Tiến độ tải ${name||'model'}`);bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-valuenow',String(percent));bar.insertAdjacentHTML('beforeend',`<span>${percent.toFixed(1)}%</span>`);}}
const modelNameCompare=(a,b)=>String(a.name||a.id||'').localeCompare(String(b.name||b.id||''),'vi',{sensitivity:'base'});
const modelSize=(item)=>Number(item.sizeBytes||0)||Number(item.estimatedDownloadGb||0)*1073741824;
const modelVram=(item)=>Number(String(item.recommendedVramGb||'999').match(/\d+(?:\.\d+)?/)?.[0]||999);
const renderModelInventoryLicenseBase=renderModelInventory;
renderModelInventory=function(){renderModelInventoryLicenseBase();for(const card of document.querySelectorAll('#modelCandidateList .model-candidate')){const name=card.querySelector('.candidate-heading strong')?.textContent,item=modelInventory.find((model)=>model.name===name);if(!item?.licenseNotice)continue;const badge=card.querySelector('.compatibility-badge');if(badge&&item.compatibility==='restricted')badge.textContent=item.licenseLabel||'Cần xử lý giấy phép';const notice=document.createElement('p');notice.className='license-notice';notice.innerHTML=`<strong>Điều kiện giấy phép:</strong> ${escapeHtml(item.licenseNotice)}`;const details=card.querySelector('.model-details');if(details)card.insertBefore(notice,details);}}
const modelStatusRank=(item)=>item.downloaded?(item.compatibility==='ready'||!item.compatibility?0:item.compatibility==='restricted'?1:item.compatibility==='dependency'?2:3):4;
function compareInventoryModels(a,b,sort){if(sort==='name-asc')return modelNameCompare(a,b);if(sort==='name-desc')return-modelNameCompare(a,b);if(sort==='newest')return String(b.createdAt||b.updatedAt||'').localeCompare(String(a.createdAt||a.updatedAt||''))||modelNameCompare(a,b);if(sort==='size-asc')return modelSize(a)-modelSize(b)||modelNameCompare(a,b);if(sort==='size-desc')return modelSize(b)-modelSize(a)||modelNameCompare(a,b);if(sort==='vram-asc')return modelVram(a)-modelVram(b)||modelNameCompare(a,b);if(sort==='downloaded')return Number(b.downloaded)-Number(a.downloaded)||modelNameCompare(a,b);if(sort==='architecture')return String(a.architecture||'').localeCompare(String(b.architecture||''),'vi')||modelNameCompare(a,b);if(sort==='kind')return String(a.kind||'').localeCompare(String(b.kind||''),'vi')||modelNameCompare(a,b);return modelStatusRank(a)-modelStatusRank(b)||modelNameCompare(a,b);}
const renderModelInventorySortedBase=renderModelInventory;
renderModelInventory=function(){const sort=$('modelInventorySort')?.value||'status';modelInventory.sort((a,b)=>compareInventoryModels(a,b,sort));renderModelInventorySortedBase();const visible=$('modelCandidateList').querySelectorAll('.model-candidate').length,label=$('modelInventorySort')?.selectedOptions[0]?.text||'';$('modelInventorySummary').dataset.sortLabel=label;$('modelInventorySummary').textContent=$('modelInventorySummary').textContent.replace(/ · Sắp xếp:.+$/,'')+` · ${visible} kết quả · Sắp xếp: ${label}`;};
const renderModelInventoryWithSort=renderModelInventory;
renderModelInventory=function(){renderModelInventoryWithSort();for(const card of $('modelCandidateList').querySelectorAll('.model-candidate')){const name=card.querySelector('.candidate-heading strong')?.textContent,item=modelInventory.find((model)=>model.name===name);if(item?.provider!=='ollama'&&!String(item?.source||'').startsWith('ollama://'))continue;const details=card.querySelector('.model-details'),address=document.createElement('p');address.className='local-model-address';address.innerHTML=`<strong>Địa chỉ cục bộ:</strong> <code>${escapeHtml(item.localEndpoint||'http://127.0.0.1:11434')}</code><br><strong>Model:</strong> <code>${escapeHtml(item.localModel||item.version||'')}</code>`;details?.before(address);const source=card.querySelector('a.button-link.secondary');if(source){source.href=item.sourcePage||`https://ollama.com/library/${String(item.localModel||'llava').split(':')[0]}`;source.textContent='Xem trang model';}const status=card.querySelector('.candidate-status');if(status&&!item.downloaded)status.textContent=item.runtimeReason||'Model chưa có trong Ollama';}}
function downloadableModels(){return modelInventory.filter((item)=>{const source=String(item.source||''),level=item.compatibility||(item.kind==='dependency'?'dependency':'ready');return!item.downloaded&&!['downloading','starting','running'].includes(item.status)&&/^https:\/\//i.test(source)&&item.provider!=='ollama'&&!['restricted','integration'].includes(level);});}
const formatDownloadBytes=(value)=>{const bytes=Number(value||0);if(!bytes)return '0 MB';if(bytes>=1073741824)return `${(bytes/1073741824).toFixed(2)} GB`;return `${(bytes/1048576).toFixed(bytes>=104857600?0:1)} MB`;};
function updateDownloadAllModelsButton(){const button=$('downloadAllModelsButton'),status=$('downloadAllModelsStatus');if(!button||!status)return;const items=downloadableModels(),size=items.reduce((sum,item)=>sum+Number(item.estimatedDownloadGb||0),0),active=modelInventory.find((item)=>item.status==='downloading');if(active){const received=Number(active.download?.bytesDownloaded||0),total=Number(active.download?.totalBytes||0),percent=Math.max(0,Math.min(99.9,Number(active.download?.percent||0))),remaining=items.length;button.disabled=true;button.textContent='Đang tải lần lượt…';status.innerHTML=`<div class="bulk-download-current"><div class="bulk-download-title"><strong>Đang tải: ${escapeHtml(active.name||active.id)}</strong><span>${percent.toFixed(1)}%</span></div><div class="bulk-download-progress" role="progressbar" aria-label="Tiến độ tải ${escapeHtml(active.name||active.id)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><i style="width:${Math.max(2,percent)}%"></i></div><div class="bulk-download-meta"><span>${total?`${formatDownloadBytes(received)} / ${formatDownloadBytes(total)}`:received?`${formatDownloadBytes(received)} đã nhận`:'Đang chuẩn bị dữ liệu'}</span><span>${remaining?`Còn ${remaining} model trong danh sách chờ`:'Model cuối cùng trong lượt tải'}</span></div></div>`;return;}button.disabled=!items.length;button.textContent=items.length?`Tải về tất cả (${items.length})`:'Đã tải đủ model tự động';status.textContent=items.length?`${items.length} model hợp lệ${size?` · khoảng ${size.toFixed(1)} GB`:''} · tải lần lượt để bảo vệ tài nguyên máy`:'Không còn model nào có thể tải tự động. Model giới hạn và model cần tích hợp thủ công được bỏ qua.';}
async function loadModelCandidates(){const response=await fetch('/api/model-candidates',{cache:'no-store'});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tải danh mục model');modelInventory=result.inventory;updateTextToImagePipeline();$('modelInventorySummary').textContent=`${result.summary.total} model · ${result.summary.downloaded} đã tải · ${result.summary.waiting} đang chờ tải · ${result.summary.dependencies} model phụ thuộc`;renderModelInventory();updateDownloadAllModelsButton();}
async function startModelDownload(id){const item=modelInventory.find((model)=>model.id===id);if(!item)throw new Error('Không tìm thấy model');const size=Number(item.estimatedDownloadGb)>0?` khoảng ${item.estimatedDownloadGb} GB`:'';if(!confirm(`Tải ${item.name}${size} vào máy?\n\nBạn cần tuân thủ giấy phép: ${item.license||'chưa khai báo'}.`))return;const response=await fetch('/api/models/download',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể bắt đầu tải model');setMessage(`Đã bắt đầu tải ${item.name}. Bạn có thể theo dõi tiến độ trong danh mục model.`,'success');await loadModelCandidates();}
async function downloadAllModels(){const items=downloadableModels();if(!items.length)return updateDownloadAllModelsButton();const size=items.reduce((sum,item)=>sum+Number(item.estimatedDownloadGb||0),0),sizeText=size?` (khoảng ${size.toFixed(1)} GB)`:'';if(!confirm(`Tải lần lượt ${items.length} model${sizeText} vào máy?\n\nCác model có giấy phép hạn chế, cần tích hợp thủ công, model Ollama và model đã có sẽ được bỏ qua.`))return;const button=$('downloadAllModelsButton');button.disabled=true;button.textContent='Đang xếp hàng…';const response=await fetch('/api/models/download-all',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true})}),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể xếp hàng tải model');$('downloadAllModelsStatus').textContent=result.queued?`Đã xếp hàng ${result.queued} model; hệ thống đang tải lần lượt.`:'Không có model mới cần tải.';setMessage(result.queued?`Đã xếp hàng ${result.queued} model để tải lần lượt.`:'Không có model mới cần tải.','success');await loadModelCandidates();}
async function loadModelCapabilities(){const response=await fetch('/api/model-capabilities');const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc model theo chức năng');$('modelCapabilityList').innerHTML=result.features.map((feature)=>{const options=feature.models.map((model)=>{const usable=model.ready&&model.operationalReady!==false;const suffix=usable?' · sẵn sàng':model.runtimeReason?` · ${model.runtimeReason}`:' · thiếu tệp';return `<option value="${escapeHtml(model.id)}" ${model.id===feature.selectedModel?'selected':''}>${escapeHtml(model.name+suffix)}</option>`;}).join('');return `<article class="model-item"><strong>${escapeHtml(feature.name)}</strong><br><small>${escapeHtml(feature.description)}</small><label>Model<select data-feature-model="${escapeHtml(feature.id)}">${options||'<option>Không có model tương thích</option>'}</select></label></article>`;}).join('');for(const select of document.querySelectorAll('[data-feature-model]'))select.addEventListener('change',()=>selectModelForFeature(select.dataset.featureModel,select.value).catch((error)=>setMessage(error.message,'error')));}
async function loadInpaintModelOptions(){
  const response=await fetch('/api/model-capabilities',{cache:'no-store'}),result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tải model Inpainting');
  const feature=result.features.find((item)=>item.id==='inpainting'),models=feature?.models||[];
  window.ATELIER_INPAINT_MODELS=models;
  const selectable=models.filter((item)=>item.ready&&item.registered&&item.operationalReady!==false);
  const label=(item)=>`${item.name}${item.removalProfile?` · ${item.contentStyle==='anime'?'anime':'ảnh thật'} · ${item.removalProfile.nativeResolution}px`:''}${item.selected?' · mặc định':''}${item.ready&&item.registered&&item.operationalReady!==false?'':' · '+(item.runtimeReason||'chưa sẵn sàng')}`;
  const options=(items,disabled=false)=>items.map((item)=>`<option value="${escapeHtml(item.id)}" ${disabled?'disabled':''} ${item.id===selected?'selected':''}>${escapeHtml(label(item))}</option>`).join('');
  if(!models.length){$('inpaintModelSelect').innerHTML='<option value="">Không tìm thấy model Inpainting tương thích</option>';$('inpaintModelSelect').disabled=true;$('inpaintModelHint').textContent='Thêm model Inpainting trong Quản lý model.';syncDescriptionModels();return;}
  const saved=localStorage.getItem('inpaintModelChoice'),selected=selectable.some((item)=>item.id===saved)?saved:(selectable.find((item)=>item.id===feature.selectedModel)?.id||selectable[0]?.id||'');
  $('inpaintModelSelect').innerHTML=`${selectable.length?`<optgroup label="Có thể sử dụng">${options(selectable)}</optgroup>`:''}<optgroup label="Chưa sẵn sàng">${options(models.filter((item)=>!selectable.includes(item)),true)}</optgroup>`;
  $('inpaintModelSelect').value=selected;$('inpaintModelSelect').disabled=!selectable.length;
  const showProfile=()=>{const model=models.find((item)=>item.id===$('inpaintModelSelect').value),p=model?.removalProfile;$('inpaintModelHint').textContent=p?`${model.contentStyle==='anime'?'Anime/minh họa':'Ảnh thật/đa dụng'} · profile ${p.nativeResolution}px · ${p.steps} bước · strength ${p.strength} · guidance ${p.guidance}`:`${selectable.length} model có thể sử dụng · ${models.length-selectable.length} model tương thích cần tải, đăng ký hoặc hoàn thiện phụ thuộc.`;};
  showProfile();
  if(typeof applyInpaintModelSettings==='function')applyInpaintModelSettings();
  $('inpaintModelSelect').onchange=()=>{localStorage.setItem('inpaintModelChoice',$('inpaintModelSelect').value);$('loraSelect').innerHTML='';showProfile();if(typeof applyInpaintModelSettings==='function')applyInpaintModelSettings(true);refreshStudioReadiness();loadLoraStatus().catch((error)=>{$('loraStatus').textContent=error.message;});};
  syncDescriptionModels();
  await loadLoraStatus();
  refreshStudioReadiness();
}
async function selectModelForFeature(featureId,modelId){const response=await fetch('/api/model-capabilities/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({featureId,modelId})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể chọn model');await Promise.all([loadModels(),loadModelCapabilities()]);setMessage(result.operationalReady?'Đã chọn model cho chức năng. Khởi động lại dịch vụ AI để áp dụng.':'Đã lưu lựa chọn; model đang chờ tải đủ phụ thuộc.','success');}
function setModelManagerTab(tab){const selected=['capabilities','inventory','registered','register'].includes(tab)?tab:'capabilities';localStorage.setItem('modelManagerTab',selected);for(const button of document.querySelectorAll('[data-model-tab]')){const active=button.dataset.modelTab===selected;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));}for(const pane of document.querySelectorAll('[data-model-pane]')){const active=pane.dataset.modelPane===selected;pane.hidden=!active;pane.classList.toggle('active',active);}}
const loadModelsBase=loadModels;
loadModels=async function(){await loadModelsBase();const response=await fetch('/api/models'),result=await response.json();if(!response.ok||!result.ok)return;const ready=result.models.filter((item)=>item.operationalReady!==false&&item.ready).length,size=result.models.reduce((sum,item)=>sum+Number(item.sizeBytes||0),0)/1073741824,active=result.models.filter((item)=>item.active).length;$('modelSummary').innerHTML=`<div class="model-summary-grid"><article><span>SẴN SÀNG</span><strong>${ready}/${result.models.length}</strong><small>model khả dụng</small></article><article><span>ĐANG CHỌN</span><strong>${active}</strong><small>pipeline hoạt động</small></article><article><span>DUNG LƯỢNG</span><strong>${size.toFixed(1)} GB</strong><small>đã lưu trên máy</small></article><article class="${result.restartRequired?'warning':'ready'}"><span>ÁP DỤNG</span><strong>${result.restartRequired?'Cần khởi động lại':'Đã đồng bộ'}</strong><small>${result.restartRequired?'để nạp lựa chọn mới':'cấu hình hiện hành'}</small></article></div>`;};
let registeredModelsState={models:[],quarantine:[]},lastRegisteredModelId='';
function renderRegisteredModels(){const query=($('registeredModelSearch')?.value||'').trim().toLowerCase(),status=$('registeredModelStatus')?.value||'all',models=registeredModelsState.models.filter((item)=>{const usable=item.ready&&item.operationalReady!==false,state=item.active?'active':usable?'ready':'attention',haystack=[item.name,item.id,item.kind,item.resolvedPath].join(' ').toLowerCase();return(!query||haystack.includes(query))&&(status==='all'||status===state);}),quarantine=registeredModelsState.quarantine||[];const active=registeredModelsState.models.filter((item)=>item.active).length,attention=registeredModelsState.models.filter((item)=>!item.ready||item.operationalReady===false).length;$('registeredModelSummary').innerHTML=`<span><strong>${registeredModelsState.models.length}</strong> đã đăng ký</span><span><strong>${active}</strong> đang dùng</span><span><strong>${attention}</strong> cần xử lý</span><span><strong>${quarantine.length}</strong> cách ly</span>`;$('modelList').innerHTML=status==='quarantine'?'':models.map((item)=>{const usable=item.ready&&item.operationalReady!==false,state=item.active?'Đang dùng':usable?'Sẵn sàng':'Cần xử lý',highlight=item.id===lastRegisteredModelId?'is-new':'';return `<article class="model-item registered-model-card ${highlight}" data-registered-model="${escapeHtml(item.id)}"><div class="candidate-heading"><div><span class="model-health ${usable?'ok':'warn'}"></span><strong>${escapeHtml(item.name)}</strong></div><span class="state-badge ${item.active?'active':''}">${state}</span></div><div class="registered-model-kind">${escapeHtml(item.kind)} · ${(Number(item.sizeBytes||0)/1073741824).toFixed(2)} GB</div><div class="registered-path"><code title="${escapeHtml(item.resolvedPath)}">${escapeHtml(item.resolvedPath)}</code><button data-copy-model-path="${escapeHtml(item.resolvedPath)}" aria-label="Sao chép đường dẫn">Sao chép</button></div>${!usable?`<p class="model-warning">${escapeHtml(item.runtimeReason||(item.reasons||[]).join(', ')||'Model chưa sẵn sàng')}</p>`:''}<div class="registered-actions"><button data-model-activate="${escapeHtml(item.id)}" ${item.ready&&!item.active?'':'disabled'}>${item.active?'✓ Đang dùng':'Kích hoạt'}</button><details><summary>Thao tác khác</summary><button data-model-quarantine="${escapeHtml(item.id)}" ${item.active?'disabled':''}>Đưa vào cách ly</button></details></div></article>`;}).join('')||'<p class="models-empty">Không có model phù hợp bộ lọc.</p>';$('quarantineList').innerHTML=(status==='all'||status==='quarantine')&&quarantine.length?`<h3>Vùng cách ly</h3>`+quarantine.map((item)=>`<article class="model-item registered-model-card quarantined"><div class="candidate-heading"><strong>${escapeHtml(item.name)}</strong><span class="state-badge">Cách ly</span></div><code>${escapeHtml(item.path)}</code><button data-model-restore="${escapeHtml(item.id)}">Khôi phục</button></article>`).join(''):'';for(const button of $('modelList').querySelectorAll('[data-model-activate]'))button.addEventListener('click',()=>activateManagedModel(button.dataset.modelActivate).catch((error)=>setMessage(error.message,'error')));for(const button of $('modelList').querySelectorAll('[data-model-quarantine]'))button.addEventListener('click',()=>quarantineManagedModel(button.dataset.modelQuarantine).catch((error)=>setMessage(error.message,'error')));for(const button of $('quarantineList').querySelectorAll('[data-model-restore]'))button.addEventListener('click',()=>restoreManagedModel(button.dataset.modelRestore).catch((error)=>setMessage(error.message,'error')));for(const button of $('modelList').querySelectorAll('[data-copy-model-path]'))button.addEventListener('click',async()=>{await navigator.clipboard.writeText(button.dataset.copyModelPath);button.textContent='Đã chép';setTimeout(()=>button.textContent='Sao chép',1200);});}
const renderRegisteredModelsUnsorted=renderRegisteredModels;
renderRegisteredModels=function(){const sort=$('registeredModelSort')?.value||'active',stateRank=(item)=>item.active?0:item.ready&&item.operationalReady!==false?1:2,compare=(a,b)=>{if(sort==='attention')return stateRank(b)-stateRank(a)||modelNameCompare(a,b);if(sort==='name-asc')return modelNameCompare(a,b);if(sort==='name-desc')return-modelNameCompare(a,b);if(sort==='newest')return String(b.registeredAt||b.createdAt||'').localeCompare(String(a.registeredAt||a.createdAt||''))||modelNameCompare(a,b);if(sort==='size-asc')return modelSize(a)-modelSize(b)||modelNameCompare(a,b);if(sort==='size-desc')return modelSize(b)-modelSize(a)||modelNameCompare(a,b);if(sort==='kind')return String(a.kind||'').localeCompare(String(b.kind||''),'vi')||modelNameCompare(a,b);if(sort==='path')return String(a.resolvedPath||a.path||'').localeCompare(String(b.resolvedPath||b.path||''),'vi')||modelNameCompare(a,b);return stateRank(a)-stateRank(b)||modelNameCompare(a,b);};registeredModelsState.models.sort(compare);registeredModelsState.quarantine?.sort(modelNameCompare);renderRegisteredModelsUnsorted();if(sort==='quarantine'&&$('quarantineList').children.length)$('quarantineList').parentElement?.insertBefore($('quarantineList'),$('modelList'));else if($('modelList').nextElementSibling!==$('quarantineList'))$('modelList').after($('quarantineList'));};
const loadModelsRegisteredBase=loadModels;
loadModels=async function(){await loadModelsRegisteredBase();const response=await fetch('/api/models'),result=await response.json();if(!response.ok||!result.ok)return;registeredModelsState=result;renderRegisteredModels();};
const renderRegisteredModelsWithSort=renderRegisteredModels;
renderRegisteredModels=function(){renderRegisteredModelsWithSort();for(const card of $('modelList').querySelectorAll('[data-registered-model]')){const id=card.dataset.registeredModel,item=registeredModelsState.models.find((model)=>model.id===id),details=card.querySelector('.registered-actions details');if(!item||!details)continue;let menu=details.querySelector('.registered-action-menu');if(!menu){menu=document.createElement('div');menu.className='registered-action-menu';for(const button of [...details.querySelectorAll(':scope > button')])menu.appendChild(button);details.appendChild(menu);}const button=document.createElement('button');button.className='danger';button.textContent='Xóa vĩnh viễn';button.dataset.modelDelete=id;button.disabled=Boolean(item.active);button.addEventListener('click',()=>deleteManagedModel(id,item.name,'registered').catch((error)=>setMessage(error.message,'error')));menu.appendChild(button);}for(const card of $('quarantineList').querySelectorAll('.registered-model-card')){const restore=card.querySelector('[data-model-restore]'),item=(registeredModelsState.quarantine||[]).find((model)=>model.id===restore?.dataset.modelRestore);if(!restore||!item)continue;const actions=document.createElement('div');actions.className='quarantine-actions';restore.before(actions);actions.appendChild(restore);const button=document.createElement('button');button.className='danger';button.textContent='Xóa vĩnh viễn';button.addEventListener('click',()=>deleteManagedModel(item.id,item.name,'quarantine').catch((error)=>setMessage(error.message,'error')));actions.appendChild(button);}}
const loadModelCapabilitiesBase=loadModelCapabilities;
loadModelCapabilities=async function(){await loadModelCapabilitiesBase();const response=await fetch('/api/model-capabilities',{cache:'no-store'}),result=await response.json();if(!response.ok||!result.ok)return;$('modelCapabilityList').innerHTML=result.features.map((feature)=>{const selected=feature.models.find((model)=>model.id===feature.selectedModel),selectedReady=selected?.ready&&selected?.operationalReady!==false,options=feature.models.map((model)=>{const usable=model.ready&&model.operationalReady!==false,suffix=usable?' · sẵn sàng':model.runtimeReason?` · ${model.runtimeReason}`:' · thiếu tệp';return `<option value="${escapeHtml(model.id)}" ${model.id===feature.selectedModel?'selected':''} ${usable?'':'disabled'}>${escapeHtml(model.name+suffix)}</option>`;}).join('');return `<article class="model-item capability-card ${selectedReady?'is-ready':'needs-attention'}"><div class="capability-heading"><div><span class="model-health ${selectedReady?'ok':'warn'}"></span><div><strong>${escapeHtml(feature.name)}</strong><small>${escapeHtml(feature.description)}</small></div></div><span class="state-badge">${feature.models.filter((model)=>model.ready&&model.operationalReady!==false).length} sẵn sàng / ${feature.models.length} tương thích</span></div><label>${selectedReady?'Model đang sử dụng':'Model đã chọn'}<select data-feature-model="${escapeHtml(feature.id)}">${options||'<option>Không có model tương thích</option>'}</select></label><p class="capability-state">${selected?`${selectedReady?'✓ Sẵn sàng':'⚠ Chưa sẵn sàng'} · ${escapeHtml(selected.name)}`:'Chưa chọn model'}</p></article>`;}).join('');for(const select of $('modelCapabilityList').querySelectorAll('[data-feature-model]'))select.addEventListener('change',async()=>{select.disabled=true;try{await selectModelForFeature(select.dataset.featureModel,select.value);}catch(error){setMessage(error.message,'error');select.disabled=false;}});};
function sortCapabilityCards(){const list=$('modelCapabilityList'),sort=$('modelCapabilitySort')?.value||'workflow',cards=[...list.querySelectorAll('.capability-card')],name=(card)=>card.querySelector('.capability-heading strong')?.textContent||'',count=(card)=>Number(card.querySelector('.state-badge')?.textContent.match(/\d+/)?.[0]||0),base=new Map(cards.map((card,index)=>[card,index]));cards.sort((a,b)=>{if(sort==='ready')return Number(b.classList.contains('is-ready'))-Number(a.classList.contains('is-ready'))||name(a).localeCompare(name(b),'vi');if(sort==='attention')return Number(b.classList.contains('needs-attention'))-Number(a.classList.contains('needs-attention'))||name(a).localeCompare(name(b),'vi');if(sort==='compatible')return count(b)-count(a)||name(a).localeCompare(name(b),'vi');if(sort==='name-asc')return name(a).localeCompare(name(b),'vi');if(sort==='name-desc')return name(b).localeCompare(name(a),'vi');return base.get(a)-base.get(b);});for(const card of cards)list.appendChild(card);$('modelCapabilitySortSummary').textContent=`${cards.length} chức năng · Sắp xếp: ${$('modelCapabilitySort').selectedOptions[0].text}`;}
const loadModelCapabilitiesSortedBase=loadModelCapabilities;
loadModelCapabilities=async function(){await loadModelCapabilitiesSortedBase();sortCapabilityCards();};
async function loadChromaStatus(){const response=await fetch('/api/chroma-status');const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra Chroma');$('chromaStatus').textContent=`Chroma: ${result.dependenciesReady?'✓ đã kích hoạt':'thiếu '+result.missing.length+' tệp'} · smoke ${result.smokePassed?'đạt':'chưa đạt'} · ${result.pipelineLoaded?'đang nằm trong bộ nhớ':'sẵn sàng, sẽ nạp khi chạy'} · dùng cho tạo ảnh, không thay thế Inpainting/CatVTON`;$('smokeChromaButton').disabled=!result.dependenciesReady;if($('chromaViewStatus')){$('chromaViewStatus').textContent=result.dependenciesReady?(result.pipelineLoaded?'Model đang trong bộ nhớ':'Model sẵn sàng · nạp khi tạo'):`Thiếu ${result.missing.length} tệp model`;$('chromaViewStatus').classList.toggle('error',!result.dependenciesReady);}return result;}
async function runChromaSmoke(){$('smokeChromaButton').disabled=true;setMessage('Đang nạp Chroma1-HD và chạy smoke 512 px…');try{const response=await fetch('/api/chroma-smoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seed:433,steps:8,size:512})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Smoke Chroma thất bại');await loadChromaStatus();setMessage(`Chroma smoke ${result.passed?'đạt':'không đạt'} · ${result.elapsedSeconds}s · VRAM ${result.peakVramMb} MB · ${result.report}`,result.passed?'success':'error');}finally{$('smokeChromaButton').disabled=false;}}

let textToImageModels=new Map();
const TEXT_PIPELINE_HINTS={generate:'Tạo ảnh mới hoàn toàn từ prompt.',inpaint:'Dùng ảnh và mask đang chọn trong Chỉnh sửa ảnh để tái tạo vùng bằng SD3.5.',catvton:'Dùng ảnh người đang chọn và ảnh trang phục tham chiếu bằng CatVTON.',lora:'Áp dụng LoRA SD3.5 rồi tái tạo vùng mask đang chọn.',control:'Giữ chiều sâu và bố cục ảnh chính bằng ControlNet Depth SD 3.5 Large.'};
function textControlUnavailableReason(){
  const required=['controlnet-depth-sd35-large'];
  for(const id of required){
    const item=modelInventory.find((model)=>model.id===id);
    if(!item)return 'Chưa xác định được trạng thái model ControlNet SD3.5.';
    if(!item.downloaded||item.operationalReady!==true)return item.runtimeReason||`Model ${item.name} chưa sẵn sàng.`;
  }
  return '';
}
function updateTextToImagePipeline(){
  const mode=$('textToImagePipeline').value,hasImage=Boolean(current&&sourceImage),hasMask=editableMaskStats().selected>0,hasReference=Boolean(garmentDataUrl);
  const ready=mode==='generate'||(mode==='inpaint'&&hasImage&&hasMask)||(mode==='catvton'&&hasImage&&hasReference)||(mode==='lora'&&hasImage&&hasMask&&Boolean($('textToImageLora').value))||(mode==='control'&&hasImage&&!textControlUnavailableReason());
  const missing=mode==='control'&&textControlUnavailableReason()?textControlUnavailableReason():mode==='generate'?'Không cần ảnh đầu vào.':!hasImage?'Thiếu ảnh chính; chọn trong Chỉnh sửa ảnh.':['inpaint','lora'].includes(mode)&&!hasMask?'Thiếu mask; tô vùng trong Chỉnh sửa ảnh.':mode==='catvton'&&!hasReference?'Thiếu ảnh trang phục/tham chiếu.':mode==='lora'&&!$('textToImageLora').value?'Chưa chọn LoRA.':'Đã đủ đầu vào.';
  $('textToImagePipelineHint').textContent=TEXT_PIPELINE_HINTS[mode];$('textToImagePipelineReadiness').textContent=`${ready?'✓ Sẵn sàng':'○ Chưa sẵn sàng'} · ${missing}`;$('textToImageLoraOptions').hidden=mode!=='lora';
  updateTextToImageAvailability();
}
async function loadTextToImageLoras(){const response=await fetch('/api/lora-status'),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc LoRA');const usable=result.adapters.filter((item)=>item.usable);$('textToImageLora').innerHTML=usable.map((item)=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name||item.id)}</option>`).join('')||'<option value="">Không có LoRA khả dụng</option>';updateTextToImagePipeline();}
function updateTextToImageAvailability(){syncTextToImageControls();const select=$('textToImageModel'),item=textToImageModels.get(select.value),ready=Boolean(item?.downloaded)&&!['integration','dependency'].includes(item?.compatibility),direct=!$('textToImagePipeline')||$('textToImagePipeline').value==='generate';$('chromaGenerateButton').disabled=direct&&!ready||(!direct&&$('textToImagePipeline').value==='control'&&Boolean(textControlUnavailableReason()));$('textToImageModelHint').textContent=item?`${ready?'✓ Sẵn sàng':'Chưa tải, thiếu tệp hoặc cần tích hợp'} · ${item.recommendedVramGb||'VRAM chưa rõ'} GB · ${item.pipeline||'pipeline tự nhận diện'}`:'Không tìm thấy model trong thư viện';$('chromaViewStatus').textContent=direct?(ready?`${item.name} · sẵn sàng trên máy`:`${item?.name||select.value} · chưa sẵn sàng`):`Pipeline mở rộng · ${$('textToImagePipeline').selectedOptions[0]?.text||''}`;$('chromaViewStatus').classList.toggle('error',direct&&!ready);}
async function loadTextToImageModels(){const response=await fetch('/api/model-candidates',{cache:'no-store'}),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc model tạo ảnh');const preferred=['sdxl-base-1.0','sd35-medium','flux-chroma1-hd'],models=result.inventory.filter((item)=>item.kind==='text-to-image'||(item.features||[]).some((feature)=>String(feature).toLowerCase()==='text-to-image')).sort((a,b)=>{const ai=preferred.indexOf(a.id),bi=preferred.indexOf(b.id);return(ai<0?999:ai)-(bi<0?999:bi)||String(a.name).localeCompare(String(b.name),'vi');});textToImageModels=new Map(models.map((item)=>[item.id,item]));const previous=$('textToImageModel').value,selected=localStorage.getItem('textToImageModelChoice')||previous||'sd35-medium';$('textToImageModel').innerHTML=models.map((item)=>{const ready=Boolean(item.downloaded),compatible=!['integration','dependency'].includes(item.compatibility);return `<option value="${escapeHtml(item.id)}" ${item.id===selected?'selected':''} ${ready&&compatible?'':'disabled'}>${escapeHtml(item.name)}${ready&&compatible?' · sẵn sàng':ready?' · cần tích hợp':' · chưa tải'}</option>`;}).join('')||'<option value="" disabled>Không có model tương thích</option>';const current=textToImageModels.get(selected);if(!current?.downloaded||['integration','dependency'].includes(current?.compatibility)){const fallback=models.find((item)=>item.downloaded&&!['integration','dependency'].includes(item.compatibility));$('textToImageModel').value=fallback?.id||'';if(fallback)localStorage.setItem('textToImageModelChoice',fallback.id);else localStorage.removeItem('textToImageModelChoice');}if($('textToImageModel').value!==previous)applyTextToImagePreset(textQuality);else updateTextToImageAvailability();}
let modelSelectorRefreshPromise=null,modelStartupScanPromise=null;
async function refreshModelSelectors(){
  if(modelSelectorRefreshPromise)return modelSelectorRefreshPromise;
  modelSelectorRefreshPromise=Promise.all([loadModels(),loadModelCandidates(),loadTextToImageModels(),loadModelCapabilities(),loadInpaintModelOptions()]).finally(()=>{modelSelectorRefreshPromise=null;});
  return modelSelectorRefreshPromise;
}
function startModelSelectorStartupScan(){
  if(modelStartupScanPromise)return modelStartupScanPromise;
  modelStartupScanPromise=refreshModelSelectors().catch((error)=>{
    setMessage(`Không thể quét model khi mở ứng dụng: ${error.message}`,'error');
  });
  return modelStartupScanPromise;
}
let textQuality='balanced';
function TEXT_TO_IMAGE_PRESETS(){return window.ATELIER_PROMPTS.runtimePresets.textToImage;}
function syncTextToImageControls(){
  const klein=$('textToImageModel').value==='flux-2-klein-4b';
  for(const id of ['chromaNegativePrompt','suggestNegativePromptButton','optimizeNegativePromptButton','chromaQuality'])if($(id))$(id).disabled=klein;
  if(klein){$('chromaQuality').value='4';if($('textToImagePresetHint'))$('textToImagePresetHint').textContent=`FLUX.2 klein 4B · ${$('chromaSize').value} px · 4 bước. Không dùng Điều cần tránh.`;}
  if($('chromaNegativePrompt'))$('chromaNegativePrompt').title=klein?'FLUX.2 klein dùng mô tả chính; không áp dụng negative prompt.':'';
}
function applyTextToImagePreset(name){
  textQuality=['fast','balanced','quality'].includes(name)?name:'balanced';
  const id=$('textToImageModel').value,chroma=id==='flux-chroma1-hd';
  const klein=id==='flux-2-klein-4b';
  const family=klein?'klein':chroma?'chroma':id==='sd35-medium'?'sd35':'sdxl';
  const profile=TEXT_TO_IMAGE_PRESETS().profiles?.[family];
  const sizes=TEXT_TO_IMAGE_PRESETS().sizes,steps=profile?.steps||(klein?TEXT_TO_IMAGE_PRESETS().steps.klein:chroma?TEXT_TO_IMAGE_PRESETS().steps.chroma:TEXT_TO_IMAGE_PRESETS().steps.standard);
  if($('chromaGuidance'))$('chromaGuidance').value=String(profile?.guidance||(klein?1:chroma?3:4.5));
  syncTextToImageControls();
  $('chromaSize').value=sizes[textQuality];$('chromaQuality').value=String(steps[textQuality]);
  for(const button of document.querySelectorAll('[data-text-quality]')){const active=button.dataset.textQuality===textQuality;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  $('textToImagePresetHint').textContent=`${$('textToImageModel').selectedOptions[0]?.textContent||'Model đang chọn'} · ${sizes[textQuality]} px · ${steps[textQuality]} bước.${klein?' Không dùng Điều cần tránh.':''}`;
  updateTextToImageAvailability();window.NewImage?.sync();
}

async function runChromaGenerate(){return window.NewImage.generate();}

async function runExtendedTextPipeline(mode,prompt){
  updateTextToImagePipeline();
  if(mode==='control'&&textControlUnavailableReason())return setMessage(textControlUnavailableReason(),'error');
  const negative=$('chromaNegativePrompt').value.trim(),seed=seedForRun('chromaSeed'),steps=Number($('chromaQuality').value);
  if(!current||!sourceImage)throw new Error('Hãy chọn ảnh chính trong Chỉnh sửa ảnh trước.');
  if(['inpaint','lora'].includes(mode)&&editableMaskStats().selected===0)throw new Error('Hãy tô mask trong Chỉnh sửa ảnh trước.');
  if(mode==='catvton'&&!garmentDataUrl)throw new Error('Hãy thêm ảnh trang phục hoặc ảnh tham chiếu trong Chỉnh sửa ảnh trước.');
  $('inpaintPrompt').value=prompt;setCustomSeed('inpaintSeed',seed);$('inpaintSteps').value=String(steps);
  if(mode==='inpaint')return runInpaint();
  if(mode==='catvton')return runTryon();
  if(mode==='lora'){
    const id=$('textToImageLora').value;if(!id)throw new Error('Chưa có LoRA khả dụng.');
    const response=await fetch('/api/lora-configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adapters:[{id,weight:Number($('textToImageLoraWeight').value)}]})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể áp dụng LoRA');
    return runInpaint();
  }
  const button=$('chromaGenerateButton');button.disabled=true;const original=button.textContent;button.textContent='Đang tạo có điều kiện…';
  try{
    const response=await fetch('/api/sd35-conditioned-generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sampleId:current.id,prompt,negativePrompt:negative,seed,steps,guidance:4.5,controlScale:.7,maxSide:Number($('chromaSize').value)})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể chạy ControlNet SD3.5');
    $('chromaGallery').innerHTML=`<article class="result-card"><img src="${result.image}" alt="Kết quả ControlNet SD3.5"><p>ControlNet SD3.5 · seed ${result.seed}</p><a class="button-link" href="${result.image}" download="conditioned-${result.seed}.png">Tải ảnh</a></article>`;$('chromaGalleryMeta').textContent='Đã tạo ảnh theo chiều sâu và bố cục ảnh chính.';setMessage('ControlNet SD3.5 đã tạo ảnh thành công.','success');
  }finally{button.disabled=false;button.textContent=original;}
}

let pendingPromptAssist=null;
function promptAssistDiff(original,draft){
  const tokenize=text=>String(text).match(/[\p{L}\p{N}\p{M}_]+|\s+|[^\p{L}\p{N}\p{M}_\s]/gu)||[];
  const a=tokenize(original),b=tokenize(draft),chunks=[];
  const push=(type,text)=>{if(!text)return;const last=chunks.at(-1);if(last?.type===type)last.text+=text;else chunks.push({type,text});};
  let start=0,endA=a.length,endB=b.length;
  while(start<endA&&start<endB&&a[start]===b[start]){push('equal',a[start]);start++;}
  while(endA>start&&endB>start&&a[endA-1]===b[endB-1]){endA--;endB--;}
  const n=endA-start,m=endB-start;
  // Bound memory for unusually large drafts; preserve the common edges.
  if(n*m>1000000){push('remove',a.slice(start,endA).join(''));push('add',b.slice(start,endB).join(''));}
  else{
    const rows=Array.from({length:n+1},()=>new Uint32Array(m+1));
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)rows[i][j]=a[start+i]===b[start+j]?1+rows[i+1][j+1]:Math.max(rows[i+1][j],rows[i][j+1]);
    let i=0,j=0;
    while(i<n||j<m){
      if(i<n&&j<m&&a[start+i]===b[start+j]){push('equal',a[start+i]);i++;j++;}
      else if(i<n&&(j===m||rows[i+1][j]>=rows[i][j+1]))push('remove',a[start+i++]);
      else push('add',b[start+j++]);
    }
  }
  push('equal',a.slice(endA).join(''));return chunks;
}
function renderPromptAssistDiff(){
  const chunks=promptAssistDiff($('promptAssistOriginal').value,$('promptAssistDraft').value);
  const changed=chunks.some(chunk=>chunk.type!=='equal');
  $('promptAssistDiffStatus').textContent=changed?'Phần bị xóa được gạch ngang màu đỏ; phần thêm mới được tô xanh.':'Không có thay đổi: bản đề xuất giống nội dung hiện tại.';
  $('promptAssistDiffColumns').hidden=!changed;
  const html=side=>chunks.filter(chunk=>chunk.type!==(side==='original'?'add':'remove')).map(chunk=>{
    const text=escapeHtml(chunk.text);
    return chunk.type==='equal'?text:chunk.type==='remove'?`<del>${text}</del>`:`<ins>${text}</ins>`;
  }).join('');
  $('promptAssistDiffOriginal').innerHTML=html('original');$('promptAssistDiffDraft').innerHTML=html('draft');
}
function renderPromptAssistFeedback(id,title,items){const element=$(id);element.hidden=!items?.length;if(!items?.length)return;element.innerHTML=`<strong>${escapeHtml(title)}</strong><ul>${items.map((item)=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`;}
function openPromptAssistPreview({targetId,statusId,title,previous,result,analysisOnly=false}){
  pendingPromptAssist={targetId,statusId,analysisOnly};
  $('promptAssistDialogTitle').textContent=title;$('promptAssistOriginal').value=previous;$('promptAssistDraft').value=result.suggestion||previous;
  renderPromptAssistDiff();
  $('promptAssistDraft').readOnly=analysisOnly;$('applyPromptAssistButton').hidden=analysisOnly;
  $('copyPromptAssistButton').textContent=analysisOnly?'Sao chép nội dung':'Sao chép bản nháp';
  $('promptAssistScore').hidden=result.qualityScore===null||result.qualityScore===undefined;$('promptAssistScore').textContent=`Độ rõ prompt: ${result.qualityScore}/100`;
  renderPromptAssistFeedback('promptAssistChanges','AI đã cải thiện',result.changes);renderPromptAssistFeedback('promptAssistWarnings','Cần lưu ý',result.warnings);
  $('promptAssistDialog').showModal();
}
async function requestPromptSuggestion({task,targetId,buttonId,statusId,includeImage=false,includeMask=false,context='',title='Bản nháp AI'}) {
  const target=$(targetId),button=$(buttonId),status=$(statusId),previous=target.value;
  const originalLabel=button.textContent;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Đang phân tích…';
  status.parentElement.classList.remove('is-success','is-error');status.textContent='LLM đang chuẩn bị bản nháp để bạn xem trước…';
  try {
    const payload={task,currentText:previous,context};
    if(['chromaPrompt','chromaNegativePrompt','chromaClipPrompt'].includes(targetId)){payload.imageModelId=$('textToImageModel').value;payload.shortClip=targetId==='chromaClipPrompt';if(targetId==='chromaClipPrompt'&&!previous)payload.currentText=$('chromaPrompt').value;}
    if(includeImage&&current)payload.sampleId=current.id;if(includeMask&&current)payload.mask=binaryMaskDataUrl(false);
    const response=await fetch('/api/prompt-assist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json().catch(()=>({}));if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tạo gợi ý');
    openPromptAssistPreview({targetId,statusId,title,previous,result,analysisOnly:task==='analyzePrompt'});
    status.textContent=`Đã tạo bản nháp bằng ${result.model}. Chỉ áp dụng khi bạn xác nhận.`;status.parentElement.classList.add('is-success');
  } catch(error) {status.textContent=error.message;status.parentElement.classList.add('is-error');setMessage(error.message,'error');}
  finally {button.disabled=false;button.removeAttribute('aria-busy');button.textContent=originalLabel;}
}
function runPromptAssist(options){return requestPromptSuggestion(options);}

let analyzedModelUrl=null;
async function analyzeModelUrl(){const url=$('modelUrl').value.trim();if(!url)throw new Error('Hãy nhập URL model.');$('analyzeModelUrlButton').disabled=true;$('modelUrlPreview').hidden=false;$('modelUrlPreview').textContent='Đang đọc metadata từ nguồn…';try{const response=await fetch('/api/models/url/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể phân tích URL');analyzedModelUrl=result.analysis;$('urlModelId').value=analyzedModelUrl.id;$('urlModelName').value=analyzedModelUrl.name;$('urlModelKind').value=[...$('urlModelKind').options].some((option)=>option.value===analyzedModelUrl.kind)?analyzedModelUrl.kind:'custom';$('urlModelArchitecture').value=analyzedModelUrl.architecture;$('urlModelTarget').value=analyzedModelUrl.targetPath;$('modelUrlPreview').innerHTML=`<strong>${escapeHtml(analyzedModelUrl.name)}</strong><dl><dt>Nguồn</dt><dd>${escapeHtml(analyzedModelUrl.provider)}</dd><dt>Phiên bản</dt><dd>${escapeHtml(analyzedModelUrl.revision||'main')}</dd><dt>Kiến trúc</dt><dd>${escapeHtml(analyzedModelUrl.architecture)}</dd><dt>Định dạng</dt><dd>${escapeHtml(analyzedModelUrl.formatLabel)}</dd><dt>Dung lượng</dt><dd>${analyzedModelUrl.estimatedDownloadGb?escapeHtml(Number(analyzedModelUrl.estimatedDownloadGb).toFixed(2)+' GB'):'Chưa xác định'}</dd><dt>Giấy phép</dt><dd>${escapeHtml(analyzedModelUrl.license)}</dd><dt>Chuyển đổi</dt><dd>${escapeHtml(analyzedModelUrl.conversion)}</dd></dl>`;$('downloadRegisterModelButton').disabled=false;setMessage('Đã phân tích URL. Hãy kiểm tra thông tin và xác nhận giấy phép.','success');}finally{$('analyzeModelUrlButton').disabled=false;}}
async function downloadAndRegisterModelUrl(){if(!analyzedModelUrl)throw new Error('Hãy phân tích URL trước.');if(!$('urlModelLicenseAccepted').checked)throw new Error('Bạn cần xác nhận đã đọc giấy phép model.');const body={url:$('modelUrl').value.trim(),id:$('urlModelId').value.trim(),name:$('urlModelName').value.trim(),kind:$('urlModelKind').value,architecture:$('urlModelArchitecture').value,targetPath:$('urlModelTarget').value.trim(),autoConvert:$('urlModelAutoConvert').checked,licenseAccepted:true};if(!confirm(`Tải và đăng ký ${body.name}?\n\nNguồn: ${analyzedModelUrl.provider}\nDung lượng: ${analyzedModelUrl.estimatedDownloadGb?Number(analyzedModelUrl.estimatedDownloadGb).toFixed(2)+' GB':'chưa xác định'}\nGiấy phép: ${analyzedModelUrl.license}`))return;$('downloadRegisterModelButton').disabled=true;try{const response=await fetch('/api/models/url/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tải và đăng ký model');setMessage(`Đã bắt đầu tải ${result.entry.name}; theo dõi tiến độ trong Thư viện model.`,'success');setModelManagerTab('inventory');await loadModelCandidates();}finally{$('downloadRegisterModelButton').disabled=false;}}

async function registerManagedModel(){const body={id:$('modelId').value,name:$('modelName').value,kind:$('modelKind').value,architecture:$('modelArchitecture').value,path:$('modelPath').value,configKey:$('modelConfigKey').value,license:$('modelLicense').value,source:'local'};const response=await fetch('/api/models/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đăng ký model');lastRegisteredModelId=result.model.id;setModelManagerTab('registered');await loadModels();document.querySelector(`[data-registered-model="${CSS.escape(lastRegisteredModelId)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'});setMessage(`Đã đăng ký ${result.model.name}.`,'success');}
async function activateManagedModel(id){const response=await fetch('/api/models/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kích hoạt model');await loadModels();if(id==='flux-chroma1-hd')await loadChromaStatus();setMessage(result.restartRequired?'Đã chọn model. Hãy khởi động lại dịch vụ AI để áp dụng.':'Model đã được kích hoạt và sẵn sàng nạp khi sử dụng.','success');}
async function quarantineManagedModel(id){if(!confirm(`Đưa ${id} vào vùng cách ly có thể phục hồi?`))return;const response=await fetch('/api/models/quarantine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,confirm:true})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể cách ly model');await loadModels();setMessage(`Đã cách ly ${id}; có thể khôi phục.`, 'success');}
async function restoreManagedModel(id){const response=await fetch('/api/models/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể khôi phục model');await loadModels();setMessage(`Đã khôi phục ${id}.`,'success');}
async function deleteManagedModel(id,name,location='registered'){const confirmation=prompt(`Xóa vĩnh viễn ${name||id}?\n\nToàn bộ dữ liệu model sẽ bị xóa khỏi máy và không thể khôi phục. Nhập chính xác ID "${id}" để xác nhận:`);if(confirmation===null)return;if(confirmation!==id)throw new Error('ID xác nhận không khớp. Model chưa bị xóa.');const response=await fetch('/api/models/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,location,confirm:confirmation})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể xóa model');await Promise.all([loadModels(),loadModelCandidates(),loadTextToImageModels(),loadModelCapabilities(),loadInpaintModelOptions()]);setMessage(`Đã xóa vĩnh viễn ${name||id} và giải phóng ${(Number(result.sizeBytes||0)/1073741824).toFixed(2)} GB.`,'success');}
async function exportModelManifest(){const response=await fetch('/api/models/export');const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể xuất manifest');setMessage(`Đã xuất ${result.models.length} model · ${result.manifest}`,'success');}

async function configureLora(clear=false){const ids=clear?[]:[...$('loraSelect').selectedOptions].map((option)=>option.value);if(ids.length>2)throw new Error('Chỉ chọn tối đa hai LoRA.');const weight=Number($('loraWeight').value);const response=await fetch('/api/lora-configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelId:$('inpaintModelSelect').value,adapters:ids.map((id)=>({id,weight}))})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể cấu hình LoRA');await loadLoraStatus();setMessage(clear?'Đã tắt LoRA cho model đang chọn.':`Đã áp dụng ${result.active.length} LoRA.`,'success');}

async function runLoraAbTest(){if(!current)throw new Error('Hãy chọn ảnh mẫu.');const response=await fetch('/api/lora-ab-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sampleId:current.id,editableMask:binaryMaskDataUrl(false),prompt:$('inpaintPrompt').value,seed:seedForRun('inpaintSeed'),count:1,steps:Number($('inpaintSteps').value),strength:Number($('inpaintStrength').value),guidance:Number($('inpaintGuidance').value),expand:Number($('maskExpand').value),blur:Number($('maskBlur').value),cropPadding:Number($('cropPadding').value),maxSide:768})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể chạy A/B LoRA');$('resultsGrid').innerHTML=`<article class="result-card"><img src="/${result.baseline.output.replace(/^workspace\//,'')}" alt="Không LoRA"><p>Không LoRA</p></article><article class="result-card"><img src="/${result.candidate.output.replace(/^workspace\//,'')}" alt="Có LoRA"><p>Có LoRA · cùng seed ${result.seed}</p></article>`;$('comparePanel').hidden=true;$('resultsDialog').showModal();setMessage(`A/B LoRA hoàn tất · ${result.report}`,'success');}

async function runLoraMatrix(){const selected=[...$('loraSelect').selectedOptions].map((option)=>option.value)[0];if(!selected)throw new Error('Hãy chọn một LoRA.');$('loraMatrixButton').disabled=true;setMessage('Ma trận 5 ảnh × 3 weight đang chạy; quá trình này có thể mất nhiều phút…');try{const response=await fetch('/api/lora-ab-matrix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adapterId:selected,weights:[0.4,0.6,0.8],category:'upper_body',prompt:$('inpaintPrompt').value,seed:seedForRun('inpaintSeed'),steps:Number($('inpaintSteps').value),guidance:Number($('inpaintGuidance').value),maxSide:512})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể chạy ma trận LoRA');setMessage(`Ma trận hoàn tất ${result.sampleCount} ảnh · bỏ qua ${result.skippedCount} · ${result.report}`,'success');}finally{$('loraMatrixButton').disabled=false;}}

async function runLoraStrengthMatrix(){const selected=[...$('loraSelect').selectedOptions].map((option)=>option.value)[0];if(!selected)throw new Error('Hãy chọn một LoRA.');$('loraStrengthButton').disabled=true;setMessage('Hiệu chỉnh strength trên ba ảnh một người đang chạy…');try{const response=await fetch('/api/lora-strength-matrix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adapterId:selected,adapterWeight:Number($('loraWeight').value),strengths:[0.5,0.6,0.7],seed:seedForRun('inpaintSeed'),steps:Number($('inpaintSteps').value),guidance:Number($('inpaintGuidance').value),maxSide:512})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể hiệu chỉnh strength');setMessage(`Hiệu chỉnh hoàn tất ${result.sampleCount} ảnh · bỏ qua ${result.skippedCount} · ${result.report}`,'success');}finally{$('loraStrengthButton').disabled=false;}}

async function selectPrimary(seed, button) {
  try {
    const response = await fetch('/api/select-result', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({directory: button.dataset.directory||currentRunDirectory, seed}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    for (const item of $('resultsGrid').querySelectorAll('[data-seed]')) item.textContent = 'Chọn làm kết quả chính';
    button.textContent = '✓ Đã chọn';
    studioSelectedResult=result.selected;
    globalThis.QualityLearning?.selection({directory:button.dataset.directory||currentRunDirectory,seed});
    const sampleId=button.dataset.sampleId||current.id;
    await setReviewStatus(sampleId, 'pending', result.selected);
    setMessage(`Đã chọn seed ${seed} · ${result.selected}`, 'success');
    return result.selected;
  } catch (error) { setMessage(error.message, 'error'); return ''; }
}

function tryonQualityFeedback(result) {
  if (result.qualityGate.passed) return {text:'Đã tạo ảnh · Đạt kiểm tra tự động. Hãy đối chiếu cổ, tay, gấu, lớp áo và họa tiết với ảnh mẫu trước khi chấp nhận.', kind:'success'};
  const selected=result.results.find(item=>item.seed===result.selectedSeed);
  const checks=[
    ['qualityScore','minimumQuality','Chất lượng tổng',1,''],
    ['referenceSimilarity','minimumSimilarity','Độ giống trang phục',100,'%'],
    ['seamScore','minimumSeam','Độ liền mạch của biên',1,''],
    ['anatomyScore','minimumAnatomy','Bảo toàn người và nền',1,''],
  ];
  const reasons=checks.filter(([metric,minimum])=>selected && Number(selected[metric])<Number(result.qualityGate[minimum]))
    .map(([metric,minimum,label,scale,unit])=>`${label} ${(selected[metric]*scale).toFixed(1)}${unit}, yêu cầu ${(result.qualityGate[minimum]*scale).toFixed(1)}${unit}`);
  if(result.bodyAudit?.required&&!result.bodyAudit.passed)reasons.push('Vùng tay chưa đạt kiểm tra, có thể còn tay áo ngoài mẫu tham chiếu');
  const details={'color-material':'Màu hoặc chất liệu chưa khớp mẫu','geometry':'Hình học trang phục cần xem lại','pose':'Tư thế thay đổi hoặc chưa đủ rõ để kiểm tra','target-mask':'Vùng theo kiểu dáng còn thiếu điểm tư thế tin cậy'};
  for(const reason of result.qualityGate.reasons||[])if(details[reason])reasons.push(details[reason]);
  return {text:`Đã tạo ảnh · Cần xem lại chất lượng${reasons.length?': '+reasons.join('; '):'.'} Bạn có thể xem và chọn phương án, hoặc chỉnh vùng thay trang phục rồi tạo lại.`, kind:'warning'};
}

async function runTryon() {
  if(descriptionTryonRunning||inpaintPromptReviewPending||activeJobId)return setMessage('Hãy hoàn tất tác vụ hiện tại.', 'error');
  if(isDescriptionTryon())return runDescriptionTryon();
  if(!selectedOutfitType()?.category)return setMessage('Loại này cần thay bằng mô tả.', 'error');
  if (!garmentDataUrl) return setMessage('Hãy chọn ảnh trang phục tham chiếu.', 'error');
  if (!current || !sourceImage) return setMessage('Hãy chọn ảnh người mẫu trước.', 'error');
  const modelId=$('tryonModelSelect').value;
  if(!modelId||$('tryonModelSelect').disabled)return setMessage('Chưa có model thay trang phục sẵn sàng.', 'error');
  setMessage(`Đang nạp ${modelId==='idm-vton'?'IDM-VTON':'CatVTON'} và tạo trang phục; lượt đầu có thể mất vài phút…`);
  const jobId=createJobId('tryon'); setActiveJob(jobId);let jobSucceeded=false,jobError='';
  try {
    const response = await fetch('/api/tryon', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        jobId, modelId, sampleId:current.id, garmentImage:garmentDataUrl,
        targetGarment:targetGarmentValues(),referenceType:$('referenceType')?.value||'auto',
        editableMask:$('autoMaskToggle').checked ? '' : binaryMaskDataUrl(false),
        protectedDetailMask:binaryMaskDataUrl(false,true,true),
        autoMask:$('autoMaskToggle').checked,
        reconstructExposedBody:$('reconstructExposedBodyToggle').checked,
        bodyRepairMode:$('bodyRepairMode').value,
        personIndex:Number($('personSelect').value),
        cropPerson:$('cropPersonToggle').checked,
        usePose:$('usePoseToggle').checked,
        preprocessGarment:true,
        twoStage:$('twoStageToggle').checked,
        minimumQuality:Number($('minimumQuality').value),
        minimumSimilarity:Number($('minimumSimilarity').value),
        minimumSeam:Number($('minimumSeam').value), minimumAnatomy:Number($('minimumAnatomy').value),
        maxRetries:Number($('maxRetries').value), repairSeams:$('repairSeamsToggle').checked,
        generativeRefine:$('generativeRefineToggle').checked,
        refineRegion:$('refineRegion').value,
        category:$('garmentCategory').value,
        garmentDescription:modelId==='idm-vton' ? $('garmentDescription').value.trim() : '',
        seed:seedForRun('tryonSeed'), count:Number($('tryonCount').value),
        steps:Number($('tryonSteps').value), guidance:Number($('tryonGuidance').value),
        expand:8, blur:5, maxSide:1024,
      }),
    });
    const result=await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể thay trang phục');
    jobSucceeded=true;currentRunDirectory=result.directory;
    if (result.qualityGate.passed) await setReviewStatus(current.id, 'pending', result.selected);
    const sourceCard=`<article class="result-card"><img src="${current.url}" alt="Ảnh gốc"><p>Ảnh gốc</p></article>`;
    $('resultsGrid').innerHTML=sourceCard+result.results.map((item)=>`<article class="result-card"><img src="${item.image}" alt="Trang phục phương án ${item.seed}"><p>Seed ${item.seed} · ${result.width} × ${result.height}<br>Tổng ${Number(item.qualityScore).toFixed(1)} · tương đồng mẫu ${(item.referenceSimilarity*100).toFixed(1)}%<br>Biên ${Number(item.seamScore).toFixed(1)} · bảo toàn ${Number(item.preservationScore??item.anatomyScore).toFixed(1)}<br>Màu/chất liệu: ${item.colorMaterial?.accepted?'đạt':'cần xem lại'} · hình học: ${item.geometry?.accepted?'đạt':'cần xem lại'}<br>${item.qualityGate?.passed?'Đạt kiểm tra tự động · cần duyệt mẫu':'Cần xem lại chất lượng'}<br>${item.seamRepair?.accepted?'✓ Đã sửa biên cục bộ':'Giữ nguyên biên'}</p><button data-seed="${item.seed}">${item.seed===result.selectedSeed?'✓ Đang chọn':'Chọn làm kết quả chính'}</button></article>`).join('');
    for (const button of $('resultsGrid').querySelectorAll('[data-seed]')) button.addEventListener('click',()=>selectPrimary(Number(button.dataset.seed),button));
    const selected=result.results.find((item)=>item.seed===result.selectedSeed)||result.results[0];
    presentStudioResults(current.url,selected?.image||'');
    if(selected) showCompare(current.url,selected.image);
    const feedback=tryonQualityFeedback(result);
    if(result.bodyRepair?.attempted&&!result.bodyRepair.applied){feedback.text+=' Lượt sửa tay chưa đạt kiểm tra; đã giữ ảnh trước bước sửa tay.';feedback.kind='warning';}
    setMessage(feedback.text,feedback.kind);
  } catch(error) { jobError=error.message;setMessage(error.message,'error'); }
  finally { await settleJob(jobId,jobSucceeded?'completed':'failed',jobError); }
}

function outputUrl(relativePath) {
  const normalized=String(relativePath||'').replace(/\\/g,'/').replace(/^\/+/, '').replace(/^workspace\//, '');
  return '/' + normalized;
}

async function runBatchTryon() {
  if(descriptionTryonRunning||inpaintPromptReviewPending||activeJobId)return setMessage('Hãy hoàn tất tác vụ hiện tại.', 'error');
  if(isDescriptionTryon())return runDescriptionTryon(true);
  if (!garmentDataUrl) return setMessage('Hãy chọn ảnh trang phục tham chiếu.', 'error');
  if (!current || !sourceImage) return setMessage('Hãy chọn ảnh người mẫu trước khi chạy hàng loạt.', 'error');
  const modelId=$('tryonModelSelect').value;
  if(!modelId||$('tryonModelSelect').disabled)return setMessage('Chưa có model thay trang phục sẵn sàng.', 'error');
  const scope = $('batchScope').value;
  let targets = [current];
  if (scope === 'group') targets = images.filter((item) => item.group === current.group);
  if (scope === 'selected') targets = images.slice(0, 12);
  targets = targets.slice(0, 12);
  $('batchTryonButton').disabled = true;
  const jobId=createJobId('batch'); setActiveJob(jobId);
  setMessage(`Đang chạy hàng loạt ${targets.length} ảnh; mỗi ảnh sẽ tự tạo mask và chọn seed tốt nhất…`);
  try {
    const response = await fetch('/api/batch-tryon', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        jobId, modelId, sampleIds:targets.map((item)=>item.id), garmentImage:garmentDataUrl,
        targetGarment:targetGarmentValues(),referenceType:$('referenceType')?.value||'auto',
        category:$('garmentCategory').value, seed:seedForRun('tryonSeed'),
        garmentDescription:modelId==='idm-vton' ? $('garmentDescription').value.trim() : '',
        count:Number($('tryonCount').value), steps:Number($('tryonSteps').value),
        guidance:Number($('tryonGuidance').value), expand:8, blur:5, maxSide:1024,
        personIndex:Number($('personSelect').value), cropPerson:$('cropPersonToggle').checked,
        minimumConfidence:Number($('confidenceThreshold').value)/100,
        onlyConfident:$('onlyConfidentToggle').checked,
        bodyRepairMode:$('bodyRepairMode').value,
        reconstructExposedBody:$('reconstructExposedBodyToggle').checked,
        usePose:$('usePoseToggle').checked,
        twoStage:$('twoStageToggle').checked,
        minimumQuality:Number($('minimumQuality').value), minimumSimilarity:Number($('minimumSimilarity').value),
        minimumSeam:Number($('minimumSeam').value), minimumAnatomy:Number($('minimumAnatomy').value),
        maxRetries:Number($('maxRetries').value), repairSeams:$('repairSeamsToggle').checked,
        generativeRefine:$('generativeRefineToggle').checked,
        refineRegion:$('refineRegion').value,
        onlyQualityPassed:$('onlyQualityToggle').checked,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể chạy hàng loạt');
    for (const item of result.items) await setReviewStatus(item.sampleId, 'pending', item.selected);
    $('resultsGrid').innerHTML = result.items.map((item)=>`<article class="result-card"><img src="${outputUrl(item.selected)}" alt="${item.sampleId}"><p>${item.sampleId}<br>Seed ${item.selectedSeed} · điểm ${Number(item.qualityScore).toFixed(1)}/100 · giống mẫu ${(item.referenceSimilarity*100).toFixed(1)}%<br>SAM ${Number(item.autoMaskScore).toFixed(3)} · biên ${(item.edgeMAE*100).toFixed(2)}%</p></article>`).join('');
    $('resultsDialog').showModal();
    setMessage(`Hoàn tất ${result.completed}/${result.requested} ảnh · bỏ qua ${result.skipped||0} · báo cáo ${result.report}`, result.failed || result.skipped ? 'error' : 'success');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { $('batchTryonButton').disabled = false; setActiveJob(''); }
}

async function runRegressionAudit() {
  $('auditButton').disabled = true;
  setMessage('Đang kiểm tra phát hiện người và mask trên toàn bộ 23 ảnh…');
  try {
    const response = await fetch('/api/regression-audit', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({category:$('garmentCategory').value,usePose:$('usePoseToggle').checked}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể chạy kiểm tra hồi quy');
    auditItems = result.items;
    const category=$('garmentCategory').value;const pending = auditItems.filter((item)=>!reviewState.items[reviewKey(category,item.sampleId)]).map((item)=>({category,sampleId:item.sampleId,status:'pending'}));
    if (pending.length) {
      const saved=await fetch('/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:pending})});
      const payload=await saved.json(); if(saved.ok&&payload.ok) reviewState=payload.state;
    }
    renderAuditQueue();
    $('comparePanel').hidden = true;
    $('resultsDialog').showModal();
    setMessage(`Hồi quy: ${result.passed}/${result.total} đạt · ${result.manualReview} cần xem lại · ${result.report}`, result.manualReview ? 'error' : 'success');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { $('auditButton').disabled = false; }
}

async function exportApproved() {
  try {
    const approvedCount=Object.values(reviewState.items||{}).filter((item)=>item.status==='approved').length;if(!window.confirm(`Xuất gói bàn giao gồm ${approvedCount} kết quả đã chấp nhận?\n\nCác mục chờ duyệt, chạy lại hoặc loại bỏ sẽ không được đưa vào gói.`))return;
    const response=await fetch('/api/export-approved',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const result=await response.json();
    if(!response.ok||!result.ok) throw new Error(result.error||'Không thể xuất manifest');
    setMessage(`Đã xuất ${result.approvedCount} mục đã duyệt · ${result.manifest}`,'success');
  } catch(error){setMessage(error.message,'error');}
}

const PRESETS=new Proxy({}, {get:(_,name)=>window.ATELIER_PROMPTS.presets[name]});

function applyPreset(name) {
  const p = PRESETS[name];
  if(p){
    $('inpaintPrompt').value=readEditablePresetPrompt(name); $('maskExpand').value=p.expand; $('maskBlur').value=p.blur;
    $('inpaintSteps').value=p.steps; $('inpaintStrength').value=p.strength;
    $('inpaintGuidance').value=p.guidance; $('cropPadding').value=p.crop;
    if(p.resolution)$('inpaintResolution').value=p.resolution;
  } else if(name==='custom') {
    $('inpaintPrompt').value='';
  }
  
  const garment=['outfit','sleepwear','underwear','shirt','pants'].includes(name);
  $('inpaintFillMode').disabled=!garment;
  if(!garment)$('inpaintFillMode').value='background';
  else if($('inpaintFillMode').value==='background')$('inpaintFillMode').value='reconstruct_body';
  $('inpaintFillModeHint').textContent=garment?'Phục hồi tay, vai hoặc chân; giữ vùng nhạy cảm được che bằng trang phục kín.':'Vật thể nhỏ sẽ được thay bằng nền hoặc chi tiết xung quanh.';
  if(typeof showStudioResultInstructions==='function')showStudioResultInstructions();
  if(typeof applyInpaintModelSettings==='function')applyInpaintModelSettings(true);
}

async function init() {
  try {
    await loadReviewState();
    await loadBackups();
    loadLoraStatus().catch((error)=>{$('loraStatus').textContent=error.message;});
    loadChromaStatus().catch((error)=>{$('chromaStatus').textContent=error.message;});
    loadRuntimeModelStatus().catch((error)=>{$('runtimeModelStatus').textContent=error.message;});
    loadReferenceReadiness().catch((error)=>{$('referenceReadiness').textContent=error.message;});
    const response = await fetch('/api/images');
    const data = await response.json();
    images = data.images || [];
    if (!images.length) throw new Error('Không tìm thấy ảnh trong thư mục samples');
    const selectedImageId=localStorage.getItem('selectedImageId');
    const selectedImage=images.find((item)=>item.id===selectedImageId);
    renderImageOptions(selectedImage?.id);
    if(selectedImage)await loadImage(selectedImage);
    else showEmptyEditorState();
    const persistedJob=localStorage.getItem('activeJobId');
    if(persistedJob){setActiveJob(persistedJob);await pollJobStatus();}
  } catch (error) {
    setMessage(error.message, 'error');
    $('loading').hidden = true;
  }
}

$('imageSelect').addEventListener('change', (event) => {if(event.target.value!=='')loadImage(images[Number(event.target.value)]);});
$('sourceImageFile').addEventListener('change',(event)=>{const file=event.target.files[0];uploadSourceImage(file).catch((error)=>setMessage(error.message,'error')).finally(()=>{event.target.value='';});});
$('resetEditorButton').addEventListener('click',()=>resetEditorSession());
$('deselectImageButton').addEventListener('click',deselectCurrentImage);
$('addTool').addEventListener('click', () => setTool('add'));
$('eraseTool').addEventListener('click', () => setTool('erase'));
$('protectTool').addEventListener('click', () => setTool('protect'));
$('aiTool').addEventListener('click', () => setTool('ai'));
$('personTool').addEventListener('click', () => setTool('person'));
$('segmentButton').addEventListener('click', segmentWithAi);
$('clearPointsButton').addEventListener('click', () => { aiPoints = []; render(); setMessage('Đã xóa điểm AI.'); });
$('brushSize').addEventListener('input', (event) => { $('brushValue').textContent = `${event.target.value} px`; });
$('overlayOpacity').addEventListener('input', (event) => { $('opacityValue').textContent = `${event.target.value}%`; render(); });
$('undoButton').addEventListener('click', () => { const state = history.pop(); if (state) { maskCtx.putImageData(state.editable, 0, 0); protectCtx.putImageData(state.protected, 0, 0); manualProtectCtx.clearRect(0,0,manualProtectCanvas.width,manualProtectCanvas.height);if(state.manualProtected)manualProtectCtx.putImageData(state.manualProtected,0,0);render(); refreshStudioReadiness(); } });
$('clearButton').addEventListener('click', () => { snapshot(); maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height); protectCtx.clearRect(0, 0, protectCanvas.width, protectCanvas.height); manualProtectCtx.clearRect(0,0,manualProtectCanvas.width,manualProtectCanvas.height);render(); refreshStudioReadiness(); });
$('saveButton').addEventListener('click', save);
$('suggestNotesButton').addEventListener('click',()=>runPromptAssist({task:'notes',title:'Gợi ý ghi chú chỉnh sửa',targetId:'notes',buttonId:'suggestNotesButton',statusId:'notesAssistStatus',includeImage:true,includeMask:true,context:window.AtelierPromptCatalog.template("assistContext.region",{value:$('labelSelect').selectedOptions[0].text})}));
$('suggestInpaintPromptButton').addEventListener('click',()=>runPromptAssist({task:'inpaint',title:'Gợi ý mô tả yêu cầu xóa',targetId:'inpaintPrompt',buttonId:'suggestInpaintPromptButton',statusId:'inpaintPromptAssistStatus',includeImage:true,includeMask:true,context:window.AtelierPromptCatalog.template("assistContext.target",{value:$('accessoryPreset').selectedOptions[0].text})}));
$('suggestChromaPromptButton').addEventListener('click',()=>runPromptAssist({task:'imagePrompt',title:'Gợi ý mô tả ảnh',targetId:'chromaPrompt',buttonId:'suggestChromaPromptButton',statusId:'chromaPromptAssistStatus',context:window.AtelierPromptCatalog.template("assistContext.model",{value:$('textToImageModel').selectedOptions[0]?.text||''})}));
$('optimizeChromaPromptButton').addEventListener('click',()=>runPromptAssist({task:'optimizePrompt',title:'Tối ưu prompt hiện có',targetId:'chromaPrompt',buttonId:'optimizeChromaPromptButton',statusId:'chromaPromptAssistStatus',context:window.AtelierPromptCatalog.template("assistContext.negative",{value:$('chromaNegativePrompt').value.trim()})}));
$('analyzeChromaPromptButton').addEventListener('click',()=>runPromptAssist({task:'analyzePrompt',title:'Kiểm tra prompt và negative prompt',targetId:'chromaPrompt',buttonId:'analyzeChromaPromptButton',statusId:'chromaPromptAssistStatus',context:window.AtelierPromptCatalog.template("assistContext.negative",{value:$('chromaNegativePrompt').value.trim()})}));
$('suggestNegativePromptButton').addEventListener('click',()=>runPromptAssist({task:'negativePrompt',title:'Gợi ý negative prompt',targetId:'chromaNegativePrompt',buttonId:'suggestNegativePromptButton',statusId:'negativePromptAssistStatus',context:window.AtelierPromptCatalog.template("assistContext.image",{value:$('chromaPrompt').value.trim()})}));
$('optimizeNegativePromptButton').addEventListener('click',()=>runPromptAssist({task:'optimizeNegativePrompt',title:'Tối ưu negative prompt hiện có',targetId:'chromaNegativePrompt',buttonId:'optimizeNegativePromptButton',statusId:'negativePromptAssistStatus',context:window.AtelierPromptCatalog.template("assistContext.image",{value:$('chromaPrompt').value.trim()})}));
$('closePromptAssistDialog').addEventListener('click',()=>{$('promptAssistDialog').close();pendingPromptAssist=null;});
$('promptAssistDraft').addEventListener('input',renderPromptAssistDiff);
$('keepPromptAssistButton').addEventListener('click',()=>{$('promptAssistDialog').close();pendingPromptAssist=null;});
$('copyPromptAssistButton').addEventListener('click',async()=>{await navigator.clipboard.writeText($('promptAssistDraft').value);$('copyPromptAssistButton').textContent='Đã sao chép';setTimeout(()=>$('copyPromptAssistButton').textContent=pendingPromptAssist?.analysisOnly?'Sao chép nội dung':'Sao chép bản nháp',1200);});
$('applyPromptAssistButton').addEventListener('click',()=>{if(!pendingPromptAssist)return;const target=$(pendingPromptAssist.targetId),status=$(pendingPromptAssist.statusId);target.value=$('promptAssistDraft').value.trim();target.dispatchEvent(new Event('input',{bubbles:true}));status.textContent='Đã áp dụng bản nháp AI. Bạn vẫn có thể chỉnh sửa thêm.';status.parentElement.classList.remove('is-error');status.parentElement.classList.add('is-success');$('promptAssistDialog').close();pendingPromptAssist=null;});
$('maskGuideCancel').addEventListener('click', () => $('emptyMaskDialog').close());
$('maskGuideManual').addEventListener('click', () => {
  $('emptyMaskDialog').close();
  setTool('add');
  $('addTool').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('addTool').focus();
  highlightMaskTools();
});
$('maskGuideAi').addEventListener('click', async () => {
  $('emptyMaskDialog').close();
  $('maskGuideAi').disabled = true;
  try { await createMaskFromInpaintPreset(); }
  catch (error) { setMessage(error.message, 'error'); }
  finally { $('maskGuideAi').disabled = false; }
});
$('regionDetectButton').addEventListener('click',()=>detectWithManagedModel($('regionDetector').value).catch(error=>setMessage(error.message,'error')));
$('applyRegionButton').addEventListener('click',()=>applyDetectedRegions().catch(error=>setMessage(error.message,'error')));
$('cancelRegionButton').addEventListener('click',()=>regionController?.abort());
$('adetailerMaskButton').addEventListener('click',()=>detectWithManagedModel('adetailer').catch((error)=>setMessage(error.message,'error')));


$('adetailerRefineButton').addEventListener('click',()=>runAdetailerRefine().catch((error)=>setMessage(error.message,'error')));
$('loraWeight').addEventListener('input',(event)=>{$('loraWeightValue').textContent=Number(event.target.value).toFixed(2);});
$('refreshLoraButton').addEventListener('click',async()=>{const button=$('refreshLoraButton');button.disabled=true;$('loraStatus').textContent='Đang cập nhật danh sách LoRA…';try{await Promise.all([loadLoraStatus(),loadTextToImageLoras()]);}catch(error){$('loraStatus').textContent=error.message;setMessage(error.message,'error');}finally{button.disabled=false;}});
$('applyLoraButton').addEventListener('click',()=>configureLora(false).catch((error)=>setMessage(error.message,'error')));
$('clearLoraButton').addEventListener('click',()=>configureLora(true).catch((error)=>setMessage(error.message,'error')));
$('loraAbButton').addEventListener('click',()=>runLoraAbTest().catch((error)=>setMessage(error.message,'error')));
$('loraMatrixButton').addEventListener('click',()=>runLoraMatrix().catch((error)=>setMessage(error.message,'error')));
$('loraStrengthButton').addEventListener('click',()=>runLoraStrengthMatrix().catch((error)=>setMessage(error.message,'error')));
$('refreshModelsButton').addEventListener('click',()=>Promise.all([loadModels(),loadModelCapabilities(),loadInpaintModelOptions(),loadModelCandidates()]).catch((error)=>setMessage(error.message,'error')));
$('downloadAllModelsButton').addEventListener('click',()=>downloadAllModels().catch((error)=>{setMessage(error.message,'error');updateDownloadAllModelsButton();}));
$('modelInventorySearch').addEventListener('input',renderModelInventory);
$('modelInventoryStatus').addEventListener('change',renderModelInventory);
$('modelInventoryKind').addEventListener('change',renderModelInventory);
$('modelInventoryArchitecture').addEventListener('change',renderModelInventory);
$('modelInventoryCompatibility').addEventListener('change',renderModelInventory);
$('modelInventorySort').addEventListener('change',()=>{localStorage.setItem('modelInventorySort',$('modelInventorySort').value);renderModelInventory();});
$('resetModelInventoryView').addEventListener('click',()=>{$('modelInventorySearch').value='';$('modelInventoryStatus').value='all';$('modelInventoryKind').value='all';$('modelInventoryArchitecture').value='all';$('modelInventoryCompatibility').value='all';$('modelInventorySort').value='status';localStorage.removeItem('modelInventorySort');renderModelInventory();});
$('modelCapabilitySort').addEventListener('change',()=>{localStorage.setItem('modelCapabilitySort',$('modelCapabilitySort').value);loadModelCapabilities().catch((error)=>setMessage(error.message,'error'));});
$('resetModelCapabilitySort').addEventListener('click',()=>{$('modelCapabilitySort').value='workflow';localStorage.removeItem('modelCapabilitySort');loadModelCapabilities().catch((error)=>setMessage(error.message,'error'));});
$('registeredModelSort').addEventListener('change',()=>{localStorage.setItem('registeredModelSort',$('registeredModelSort').value);renderRegisteredModels();});
$('resetRegisteredModelView').addEventListener('click',()=>{$('registeredModelSearch').value='';$('registeredModelStatus').value='all';$('registeredModelSort').value='active';localStorage.removeItem('registeredModelSort');renderRegisteredModels();});
$('refreshChromaButton').addEventListener('click',()=>loadChromaStatus().catch((error)=>setMessage(error.message,'error')));
$('smokeChromaButton').addEventListener('click',()=>runChromaSmoke().catch((error)=>setMessage(error.message,'error')));
$('chromaGenerateButton').addEventListener('click',()=>runChromaGenerate().catch((error)=>{setMessage(error.message,'error');$('chromaGalleryMeta').textContent=error.message;}));
for(const button of document.querySelectorAll('[data-text-quality]'))button.addEventListener('click',()=>applyTextToImagePreset(button.dataset.textQuality));
$('textToImageModel').addEventListener('change',()=>{localStorage.setItem('textToImageModelChoice',$('textToImageModel').value);applyTextToImagePreset(textQuality);});
for(const id of ['chromaSize','chromaQuality','chromaGuidance'])$(id).addEventListener('change',()=>{for(const button of document.querySelectorAll('[data-text-quality]')){button.classList.remove('active');button.setAttribute('aria-pressed','false');}textQuality='custom';$('textToImagePresetHint').textContent=`Tùy chỉnh · ${$('chromaSize').value} px · ${$('chromaQuality').value} bước.`;window.NewImage?.sync();});
$('textToImagePipeline').addEventListener('change',updateTextToImagePipeline);
$('textToImageLora').addEventListener('change',updateTextToImagePipeline);
$('textToImageLoraWeight').addEventListener('input',(event)=>{$('textToImageLoraWeightValue').textContent=Number(event.target.value).toFixed(2);});
$('exportModelsButton').addEventListener('click',()=>exportModelManifest().catch((error)=>setMessage(error.message,'error')));
$('registerModelButton').addEventListener('click',()=>registerManagedModel().catch((error)=>setMessage(error.message,'error')));
$('analyzeModelUrlButton').addEventListener('click',()=>analyzeModelUrl().catch((error)=>{$('modelUrlPreview').textContent=error.message;setMessage(error.message,'error');}));
$('downloadRegisterModelButton').addEventListener('click',()=>downloadAndRegisterModelUrl().catch((error)=>setMessage(error.message,'error')));
$('modelUrl').addEventListener('input',()=>{analyzedModelUrl=null;$('downloadRegisterModelButton').disabled=true;$('modelUrlPreview').hidden=true;});
$('closeResults').addEventListener('click', () => {$('resultsDialog').classList.remove('guided-review-dialog');$('resultsDialog').close();});
$('closeImageViewer').addEventListener('click',()=>$('imageViewerDialog').close());
$('toggleViewerFitButton').addEventListener('click',()=>{
  const image=$('imageViewerImage'),button=$('toggleViewerFitButton');
  const fit=button.getAttribute('aria-pressed')!=='true';
  image.style.maxWidth=fit?'100%':'none';
  image.style.maxHeight=fit?'calc(100dvh - 160px)':'none';
  button.setAttribute('aria-pressed',String(fit));
  button.textContent=fit?'Xem 100%':'Xem toàn ảnh';
  $('imageViewerMeta').textContent=`${image.naturalWidth} × ${image.naturalHeight} px · ${fit?'toàn ảnh':'hiển thị 100% · dùng thanh cuộn để xem chi tiết'}`;
});
$('saveFullSizeImageButton').addEventListener('click',()=>downloadFullSizeImage(sourceImage));
$('saveViewerImageButton').addEventListener('click',()=>downloadFullSizeImage($('imageViewerImage')));
$('imageViewerImage').addEventListener('load',()=>{$('saveViewerImageButton').disabled=false;});
$('imageViewerImage').addEventListener('error',()=>{$('saveViewerImageButton').disabled=true;$('imageViewerMeta').textContent='Không thể tải ảnh.';});
$('imageViewerImage').addEventListener('load',(event)=>{const image=event.currentTarget;$('imageViewerMeta').textContent=`${image.naturalWidth} × ${image.naturalHeight} px · hiển thị 100% · dùng thanh cuộn để xem chi tiết`;});
$('imageViewerDialog').addEventListener('click',(event)=>{if(event.target===$('imageViewerDialog'))$('imageViewerDialog').close();});
$('accessoryPreset').addEventListener('change', (event) => {applyPreset(event.target.value);$('inpaintQualityPreset')?.dispatchEvent(new Event('change'));});
$('garmentFile').addEventListener('change', (event) => {
  const file=event.target.files[0];
  if (!file) return;
  if (file.size > 20*1024*1024) return setMessage('Ảnh trang phục vượt quá 20 MB.','error');
  const reader=new FileReader();
  reader.onload=()=>{ garmentDataUrl=reader.result; $('garmentPreview').src=garmentDataUrl; $('garmentPreview').hidden=false; updateTryonInputMode(); };
  reader.readAsDataURL(file);
});
$('saveReferenceButton').addEventListener('click',()=>saveReferenceProfile().catch((error)=>setMessage(error.message,'error')));
$('refreshReferenceReadinessButton').addEventListener('click',()=>loadReferenceReadiness().catch((error)=>setMessage(error.message,'error')));
$('qualifyReferenceButton').addEventListener('click',()=>qualifyReference().catch((error)=>setMessage(error.message,'error')));
$('garmentCategory').addEventListener('change',()=>{if(selectedOutfitType()?.category)loadReferenceReadiness().catch((error)=>setMessage(error.message,'error'));});
$('autoMaskButton').addEventListener('click', async () => {
  const type=selectedOutfitType();
  if(type?.category)return createAutomaticMask(type.category);
  if(type?.classes){$('yoloClasses').value=type.classes.join(', ');try{await detectWithManagedModel('yolo-world');}catch(error){setMessage(error.message,'error');}return;}
  setTool('add');setMessage('Hãy tô vùng cần thay trên ảnh.');
});
$('preprocessGarmentButton').addEventListener('click', preprocessGarment);
$('batchTryonButton').addEventListener('click', runBatchTryon);
$('cancelJobButton').addEventListener('click',()=>cancelActiveJob().catch((error)=>setMessage(error.message,'error')));
$('activityCancel').addEventListener('click',()=>cancelActiveJob().catch((error)=>setMessage(error.message,'error')));
$('activityCollapse').addEventListener('click',()=>{
  const collapsed=$('activityCenter').classList.toggle('is-collapsed'),button=$('activityCollapse');
  button.setAttribute('aria-expanded',String(!collapsed));
  button.title=collapsed?'Mở thông báo tác vụ':'Thu gọn thông báo tác vụ';
  button.setAttribute('aria-label',button.title);
});
$('activityToggle').addEventListener('click',()=>{const drawer=$('activityDrawer');drawer.hidden=!drawer.hidden;$('activityToggle').textContent=drawer.hidden?'Chi tiết':'Thu gọn';$('activityToggle').setAttribute('aria-expanded',String(!drawer.hidden));});
$('activityClose').addEventListener('click',closeGenerationProgress);
$('activityReturn').addEventListener('click',()=>{if(!activityState)return;activateAppView(activityState.taskType==='text-to-image'?'chroma':'create');const target=activityState.taskType==='text-to-image'?$('chromaLiveProgress'):$('editorLiveProgress');target.scrollIntoView({behavior:'smooth',block:'center'});});
let progressVisibilityFrame=0;
document.addEventListener('scroll',()=>{if(progressVisibilityFrame)return;progressVisibilityFrame=requestAnimationFrame(()=>{progressVisibilityFrame=0;updateProgressVisibility();});},true);
window.addEventListener('resize',updateProgressVisibility);
$('resumeJobButton').addEventListener('click',()=>resumeActiveJob().catch((error)=>setMessage(error.message,'error')));
$('detectPeopleButton').addEventListener('click', detectPeopleInImage);
$('auditButton').addEventListener('click', runRegressionAudit);
$('reviewFilter').addEventListener('change', renderAuditQueue);
$('exportApprovedButton').addEventListener('click', exportApproved);
$('calibrateButton').addEventListener('click',()=>calibrateQuality().catch((error)=>setMessage(error.message,'error')));
$('goldenButton').addEventListener('click',()=>buildGoldenBaseline().catch((error)=>setMessage(error.message,'error')));
$('compareBaselineButton').addEventListener('click',()=>compareBaseline().catch((error)=>setMessage(error.message,'error')));
$('jobsButton').addEventListener('click',()=>showJobs().catch((error)=>setMessage(error.message,'error')));
$('cleanupJobsButton').addEventListener('click',()=>cleanupOldJobs().catch((error)=>setMessage(error.message,'error')));
$('benchmarkButton').addEventListener('click',()=>runBenchmark().catch((error)=>setMessage(error.message,'error')));
$('dashboardButton').addEventListener('click',()=>buildDashboard().catch((error)=>setMessage(error.message,'error')));
$('systemCheckButton').addEventListener('click',()=>checkSystem().catch((error)=>setMessage(error.message,'error')));
$('backupButton').addEventListener('click',()=>window.BackupUI.open());
$('reviewBenchmarkButton').addEventListener('click',()=>reviewBenchmark().catch((error)=>setMessage(error.message,'error')));
$('reviewReadinessButton').addEventListener('click',()=>showReviewReadiness().catch((error)=>setMessage(error.message,'error')));
$('runRetryQueueButton').addEventListener('click',()=>runTargetedRetryQueue().catch((error)=>setMessage(error.message,'error')));
$('retryComparisonsButton').addEventListener('click',()=>showRetryComparisons().catch((error)=>setMessage(error.message,'error')));
$('calibrateWeightsButton').addEventListener('click',()=>calibrateWeights().catch((error)=>setMessage(error.message,'error')));
$('compareWeightsButton').addEventListener('click',()=>compareWeights().catch((error)=>setMessage(error.message,'error')));
$('activateWeightsButton').addEventListener('click',()=>activateWeights().catch((error)=>setMessage(error.message,'error')));
$('confirmDefaultWeightsButton').addEventListener('click',()=>confirmDefaultWeights().catch((error)=>setMessage(error.message,'error')));
$('acceptanceButton').addEventListener('click',()=>checkAcceptance().catch((error)=>setMessage(error.message,'error')));
$('restoreBackupButton').addEventListener('click',()=>restoreSelectedBackup().catch((error)=>setMessage(error.message,'error')));
$('compareSlider').addEventListener('input',(event)=>{$('compareAfterWrap').style.width=`${event.target.value}%`;});
$('studioCompareSlider').addEventListener('input',(event)=>{$('studioCompareAfterWrap').style.clipPath=`inset(0 ${100-Number(event.target.value)}% 0 0)`;});
$('studioCloseResults').addEventListener('click',()=>{$('studioResultsTray').hidden=true;$('studioCompareStage').hidden=true;});
$('studioShowAllResults').addEventListener('click',()=>{if(!$('resultsDialog').open)$('resultsDialog').showModal();});
$('studioRetryResults').addEventListener('click',()=>{if(activeJobId)return setMessage('Một tác vụ đang chạy; hãy đợi hoàn tất hoặc hủy tác vụ hiện tại.','error');(studioMode==='character'?()=>window.Character.run():studioMode==='makeup'?()=>window.Makeup.run():studioMode==='enhance'?()=>window.ImageEnhancement.run():studioMode==='outpaint'?runOutpaint:studioMode==='inpaint'?runInpaint:studioMode==='chroma'?runChromaGenerate:runTryon)();});
$('studioSendToReview').addEventListener('click',async()=>{if(!current)return setMessage('Không có ảnh hiện tại để gửi sang Duyệt.','error');try{await setReviewStatus(current.id,'pending',studioSelectedResult||undefined);activateAppView('review');setMessage('Đã đưa kết quả vào hàng Duyệt.','success');}catch(error){setMessage(error.message,'error');}});
$('studioContinueCharacter').addEventListener('click',()=>continueFromSelectedResult('character'));
$('studioContinueInpaint').addEventListener('click',()=>continueFromSelectedResult('inpaint'));
$('studioContinueTryon').addEventListener('click',()=>continueFromSelectedResult('tryon'));
$('personSelect').addEventListener('change', render);
$('confidenceThreshold').addEventListener('input',(event)=>{$('confidenceValue').textContent=`${event.target.value}%`;});
window.addEventListener('resize', fitCanvas);
window.addEventListener('keydown',(event)=>{if(!$('resultsDialog').open||!guidedReviewItems.length)return;if(event.key==='ArrowLeft'&&guidedReviewIndex>0){guidedReviewIndex--;renderGuidedReview();}else if(event.key==='ArrowRight'&&guidedReviewIndex<guidedReviewItems.length-1){guidedReviewIndex++;renderGuidedReview();}else{const key=event.key.toLowerCase();const status=key==='a'?'approved':key==='r'?'retry':key==='x'?'rejected':null;if(status){const button=$('resultsGrid').querySelector(`[data-benchmark-status="${status}"]`);if(button)button.click();}}});

const HUBS = {
  library: {
    eyebrow:'THƯ VIỆN', title:'Tất cả tài sản sáng tạo', description:'Tìm lại ảnh nguồn và mở trực tiếp trong Studio để tiếp tục chỉnh sửa.', cards:[]
  },
  review: {
    eyebrow:'HÀNG DUYỆT', title:'Kiểm tra và ra quyết định', description:'Mọi kết quả cần con người xác nhận trước khi bàn giao.',
    cards:[
      ['PHIÊN DUYỆT','Duyệt tuần tự 23 ảnh','Xem ảnh gốc và kết quả cạnh nhau, gắn nhãn lỗi bằng phím tắt.','reviewBenchmarkButton',true],
      ['TIẾN ĐỘ','Kiểm tra mức độ hoàn tất','Xem số ảnh đã chấp nhận, đang chờ và các điều kiện còn thiếu.','reviewReadinessButton'],
      ['CHỈNH SỬA','Chạy lại ảnh có vấn đề','Dùng nhãn lỗi để tự chọn chiến lược xử lý phù hợp.','runRetryQueueButton'],
      ['SO SÁNH','Kết quả cũ và mới','Đặt hai phiên bản cạnh nhau trước khi thay thế.','retryComparisonsButton'],
      ['BÀN GIAO','Xuất kết quả đã duyệt','Tạo manifest chỉ gồm những ảnh đã được chấp nhận.','exportApprovedButton']
    ]
  },
  jobs: {
    eyebrow:'TÁC VỤ', title:'Theo dõi quá trình xử lý', description:'Quản lý batch đang chạy, tiếp tục công việc bị gián đoạn và dọn checkpoint.',
    cards:[
      ['HÀNG ĐỢI','Xem tất cả tác vụ','Theo dõi trạng thái, tiến độ và tiếp tục tác vụ bị gián đoạn.','jobsButton',true],
      ['ĐANG CHẠY','Hủy ở điểm an toàn','Dừng sau lượt xử lý GPU hiện tại mà không làm hỏng kết quả.','cancelJobButton'],
      ['PHỤC HỒI','Tiếp tục tác vụ','Tiếp tục từ ảnh chưa hoàn tất gần nhất.','resumeJobButton'],
      ['BẢO TRÌ','Dọn checkpoint cũ','Giữ nguyên ảnh và báo cáo, chỉ dọn dữ liệu tác vụ cũ.','cleanupJobsButton']
    ]
  },
  reports: {
    eyebrow:'CHẤT LƯỢNG', title:'Đo lường và cải thiện kết quả', description:'Benchmark, baseline và hiệu chỉnh được tách khỏi luồng tạo ảnh hằng ngày.',
    cards:[
      ['TỔNG QUAN','Bảng phân tích chất lượng','Tổng hợp chỉ số và áp dụng cấu hình đề xuất theo loại trang phục.','dashboardButton',true],
      ['BENCHMARK','Chạy bộ kiểm tra 23 ảnh','Đánh giá cấu hình cố định trên toàn bộ bộ ảnh chuẩn.','benchmarkButton'],
      ['HỒI QUY','So sánh với baseline','Phát hiện suy giảm về điểm tổng, đường biên và hình thể.','compareBaselineButton'],
      ['HIỆU CHỈNH','Tối ưu ngưỡng chất lượng','Đề xuất ngưỡng từ các kết quả đã được duyệt.','calibrateButton'],
      ['NGHIỆM THU','Kiểm tra điều kiện phát hành','Tách điều kiện kỹ thuật khỏi mức độ sẵn sàng nội dung.','acceptanceButton']
    ]
  },
  settings: {
    eyebrow:'HỆ THỐNG', title:'Vận hành ngoại tuyến', description:'Kiểm tra model, dữ liệu và khả năng khôi phục trong một nơi riêng.',
    cards:[
      ['SẴN SÀNG','Kiểm tra hệ thống','Xác nhận model, GPU, VRAM và dung lượng lưu trữ.','systemCheckButton',true],
      ['MODEL','Mở quản lý model','Đăng ký, kích hoạt hoặc cách ly model cục bộ.','refreshModelsButton'],
      ['AN TOÀN','Sao lưu dữ liệu','Lưu cấu hình, mask, hàng duyệt và trạng thái tác vụ.','backupButton'],
      ['DỮ LIỆU CHUẨN','Tạo baseline hồi quy','Đóng băng các kết quả đã chấp nhận để kiểm thử về sau.','goldenButton']
    ]
  },
  model: {
    eyebrow:'MODEL CỤC BỘ', title:'Quản lý model', description:'Theo dõi, tải xuống và cấu hình model AI trên máy.', cards:[]
  },
  prompts: {
    eyebrow:'THƯ VIỆN PROMPT', title:'Quản lý prompt mặc định', description:'Lưu, chỉnh sửa và lựa chọn prompt hoặc negative prompt dùng cho từng tác vụ.', cards:[]
  }
};

const PROMPT_LIBRARY_KEY='atelier.promptLibrary.v1';
const PRESET_PROMPTS_KEY='atelier.accessoryPresetPrompts.v1';
const EDITABLE_PRESET_LABELS={outfit:'Trang phục',shirt:'Áo / phần trên',pants:'Quần / váy',glasses:'Kính',hat:'Mũ',jewelry:'Trang sức',bag:'Túi',shoes:'Giày dép'};
function readEditablePresetOverrides(){return {};}

function readEditablePresetPrompt(name){
  const saved=Object.hasOwn(EDITABLE_PRESET_LABELS,name)?readEditablePresetOverrides()[name]:null;
  return typeof saved==='string'&&(saved.trim()||PRESETS[name]?.prompt==='')?saved:PRESETS[name]?.prompt||'';
}
function renderPresetPromptEditor(root){
  const panel=document.createElement('section');
  panel.className='prompt-editor';
  panel.innerHTML=`<div><p class="eyebrow">ĐỐI TƯỢNG CẦN XÓA</p><h2>Mô tả yêu cầu xóa</h2></div><p>Xác định đối tượng và phạm vi cần xóa cho từng Preset trong Studio.</p><label>Preset<select id="presetPromptName">${Object.entries(EDITABLE_PRESET_LABELS).filter(([value])=>["outfit","sleepwear","underwear","shirt","pants","glasses","hat","jewelry","bag","shoes","mannequin"].includes(value)).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><label>Mô tả yêu cầu xóa<textarea id="presetPromptText" rows="6"></textarea></label><div class="prompt-editor-actions"><button id="presetPromptSave" class="primary">Lưu preset</button><button id="presetPromptReset">Khôi phục preset gốc</button></div><small id="presetPromptStatus" role="status"></small>`;
  root.appendChild(panel);
  const select=panel.querySelector('#presetPromptName'),text=panel.querySelector('#presetPromptText'),status=panel.querySelector('#presetPromptStatus');
  const load=()=>{text.value=readEditablePresetPrompt(select.value);status.textContent='';};
  select.addEventListener('change',()=>{
    const previous=select.dataset.loaded;
    if(previous&&text.value!==readEditablePresetPrompt(previous)&&!window.confirm('Nội dung chưa lưu. Chuyển sang preset khác?')){select.value=previous;return;}
    load();select.dataset.loaded=select.value;
  });
  const persist=async(reset)=>{
    const name=select.value,value=text.value.trim();
    if(!reset&&!value&&!['sleepwear','underwear','mannequin'].includes(name)){status.textContent='Hãy nhập nội dung prompt.';return;}
    const save=panel.querySelector('#presetPromptSave'),restore=panel.querySelector('#presetPromptReset');
    save.disabled=restore.disabled=select.disabled=text.disabled=true;
    status.textContent='Đang lưu prompt…';
    try{
      const response=await fetch('/api/preset-prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,prompt:value,reset})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Không thể lưu preset.');
      PRESETS[name].prompt=result.prompt;
      window.ATELIER_PROMPTS.presets[name].prompt=result.prompt;
      text.value=result.prompt;
      status.textContent=reset?'Đã khôi phục prompt gốc.':'Đã lưu prompt. Chọn lại preset trong Studio để áp dụng.';
    }catch(error){status.textContent=error.message;}
    finally{save.disabled=restore.disabled=select.disabled=text.disabled=false;}
  };
  panel.querySelector('#presetPromptSave').addEventListener('click',()=>persist(false));
  panel.querySelector('#presetPromptReset').addEventListener('click',()=>persist(true));
  load();select.dataset.loaded=select.value;
}
let studioResultModes=[];
const studioResultDrafts=new Map();
function studioResultInstructionsDirty(){
  const id=$('inpaintFillMode').value;
  return studioResultDrafts.has(id)&&studioResultDrafts.get(id)!==studioResultModes.find(mode=>mode.id===id)?.prompt;
}
function showStudioResultInstructions(){
  const field=$('inpaintFillModePrompt');if(!field)return;
  const id=$('inpaintFillMode').value,mode=studioResultModes.find(mode=>mode.id===id);
  field.value=studioResultDrafts.get(id)??mode?.prompt??'';
  field.disabled=!mode;$('saveInpaintFillModePrompt').disabled=!mode;
  $('inpaintFillModePromptStatus').textContent=mode?(studioResultInstructionsDirty()?'Có thay đổi chưa lưu.':'Dùng chung với hướng dẫn trong màn Prompt.'): 'Chưa tải được hướng dẫn.';
}
async function loadStudioResultInstructions(){
  try{
    const response=await fetch('/api/processing-modes'),result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tải hướng dẫn.');
    studioResultModes=result.modes;showStudioResultInstructions();
  }catch(error){$('inpaintFillModePromptStatus').textContent=error.message;}
}
function setupStudioResultInstructions(){
  $('inpaintFillMode').addEventListener('change',showStudioResultInstructions);
  $('inpaintFillModePrompt').addEventListener('input',()=>{
    studioResultDrafts.set($('inpaintFillMode').value,$('inpaintFillModePrompt').value);
    $('inpaintFillModePromptStatus').textContent=studioResultInstructionsDirty()?'Có thay đổi chưa lưu.':'Dùng chung với hướng dẫn trong màn Prompt.';
  });
  $('saveInpaintFillModePrompt').addEventListener('click',async()=>{
    const id=$('inpaintFillMode').value,prompt=$('inpaintFillModePrompt').value,button=$('saveInpaintFillModePrompt');
    if(!prompt.trim()){$('inpaintFillModePromptStatus').textContent='Hãy nhập nội dung hướng dẫn.';return;}
    button.disabled=true;
    try{
      const response=await fetch('/api/processing-modes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,prompt})}),result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Không thể lưu hướng dẫn.');
      studioResultModes=result.modes;
      if(studioResultDrafts.get(id)===prompt)studioResultDrafts.delete(id);
      showStudioResultInstructions();
    }catch(error){$('inpaintFillModePromptStatus').textContent=error.message;}finally{button.disabled=false;}
  });
  loadStudioResultInstructions();
}
async function renderProcessingModeEditor(root){
  const panel=document.createElement('section');panel.className='prompt-editor';
  panel.innerHTML=`<div><p class="eyebrow">KẾT QUẢ SAU KHI XÓA</p><h2>Hướng dẫn phần thay thế</h2></div><p>Xác định phần thay thế sau khi xóa. Nội dung được dùng chung với Studio.</p><label>Kết quả sau khi xóa<select data-mode-select disabled></select></label>
  <label>Hướng dẫn cho kết quả đã chọn<textarea data-mode-text rows="6" maxlength="16000" disabled></textarea></label><div class="prompt-editor-actions"><button data-mode-save class="primary" disabled>Lưu hướng dẫn</button><button data-mode-reset disabled>Khôi phục nội dung gốc</button></div><small data-mode-status role="status">Đang tải kết quả sau khi xóa…</small>`;
  root.appendChild(panel);
  const select=panel.querySelector('[data-mode-select]'),text=panel.querySelector('[data-mode-text]'),save=panel.querySelector('[data-mode-save]'),reset=panel.querySelector('[data-mode-reset]'),status=panel.querySelector('[data-mode-status]');
  let modes=[],loaded='';
  const busy=(value)=>{select.disabled=text.disabled=save.disabled=reset.disabled=value;};
  const load=()=>{loaded=select.value;text.value=modes.find(mode=>mode.id===loaded)?.prompt||'';};
  select.addEventListener('change',()=>{
    if(text.value!==modes.find(mode=>mode.id===loaded)?.prompt&&!window.confirm('Nội dung chưa lưu. Chọn kết quả sau khi xóa khác?')){select.value=loaded;return;}
    load();status.textContent='';
  });
  const persist=async(restore)=>{
    if(!restore&&!text.value.trim()){status.textContent='Hãy nhập nội dung hướng dẫn.';return;}
    busy(true);status.textContent='Đang lưu hướng dẫn kết quả sau khi xóa…';
    try{
      const response=await fetch('/api/processing-modes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:select.value,prompt:text.value,reset:restore})});
      const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể lưu hướng dẫn kết quả sau khi xóa.');
      modes=result.modes;studioResultModes=result.modes;studioResultDrafts.delete(select.value);showStudioResultInstructions();load();status.textContent=restore?'Đã khôi phục nội dung gốc.':'Đã lưu. Nội dung được áp dụng từ lần tạo ảnh tiếp theo.';
    }catch(error){status.textContent=error.message;}finally{busy(false);}
  };
  save.addEventListener('click',()=>persist(false));reset.addEventListener('click',()=>persist(true));
  try{
    const response=await fetch('/api/processing-modes');const result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tải kết quả sau khi xóa.');
    modes=result.modes;select.innerHTML=modes.map(mode=>`<option value="${escapeHtml(mode.id)}">${escapeHtml(mode.label)}</option>`).join('');
    load();busy(false);status.textContent='';
  }catch(error){status.textContent=error.message;}
}
const DEFAULT_PROMPT_LIBRARY=window.ATELIER_PROMPTS.defaults.library;
const PROMPT_SLOT_LABELS={'new-image':'Prompt · Ảnh mới','new-image-negative':'Negative prompt · Ảnh mới','inpaint':'Prompt · Mô tả yêu cầu xóa','inpaint-negative':'Negative prompt · Điều cần tránh dùng chung'};
const LEGACY_INPAINT_LIBRARY_TEXT=window.ATELIER_PROMPTS.legacyLibrary;
function readPromptLibrary(){return structuredClone(window.ATELIER_PROMPTS.library);}
async function writePromptLibrary(items){await window.AtelierPromptCatalog.saveLibrary(items);}

function applyManagedPromptDefaults(){const items=readPromptLibrary(),mapping={'new-image':'chromaPrompt','new-image-negative':'chromaNegativePrompt','inpaint':'inpaintPrompt','inpaint-negative':'inpaintNegativePrompt'};for(const [slot,id] of Object.entries(mapping)){const item=items.find((entry)=>entry.slot===slot&&entry.isDefault);if(item&&$(id))$(id).value=item.text;}refreshStudioReadiness();}
function renderPromptManager(){
  const root=$('promptManager');if(!root)return;const items=readPromptLibrary(),defaults=items.filter((item)=>item.isDefault).length,positive=items.filter((item)=>!item.slot.endsWith('-negative')).length;
  root.innerHTML=`<section class="prompt-summary"><article><span>TỔNG SỐ</span><strong>${items.length}</strong><small>prompt đã lưu</small></article><article><span>PROMPT</span><strong>${positive}</strong><small>mô tả tạo ảnh và chỉnh sửa</small></article><article><span>NEGATIVE</span><strong>${items.length-positive}</strong><small>nội dung cần tránh</small></article><article><span>MẶC ĐỊNH</span><strong>${defaults}</strong><small>đang áp dụng trong Studio</small></article></section><div class="prompt-manager-layout"><section class="prompt-editor"><div><p class="eyebrow">CHỈNH SỬA</p><h2 id="promptEditorTitle">Thêm prompt</h2></div><input id="promptEditId" type="hidden"><label>Tên prompt<input id="promptName" placeholder="${escapeHtml(window.ATELIER_PROMPTS.uiPlaceholders.promptName)}"></label><label>Phạm vi<select id="promptSlot">${Object.entries(PROMPT_SLOT_LABELS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><label>Nội dung<textarea id="promptText" rows="8" placeholder="${escapeHtml(window.ATELIER_PROMPTS.uiPlaceholders.promptText)}"></textarea></label><div class="prompt-editor-actions"><button id="promptSave" class="primary">Lưu prompt</button><button id="promptCancel">Làm trống</button></div><button id="promptResetDefaults" class="prompt-reset">Khôi phục thư viện ban đầu</button></section><section><div class="prompt-list-heading"><div><p class="eyebrow">THƯ VIỆN</p><h2>Prompt đã lưu</h2></div><select id="promptFilter" aria-label="Lọc prompt"><option value="all">Tất cả</option>${Object.entries(PROMPT_SLOT_LABELS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></div><div id="promptList" class="prompt-list"></div></section></div>`;
  const taskEditors=document.createElement('div');taskEditors.className='prompt-task-editors';
  window.AtelierPromptCatalog.renderTransfer(root,()=>{
    studioResultModes=Object.entries(window.ATELIER_PROMPTS.processingModes).map(([id,mode])=>({id,...mode}));
    studioResultDrafts.clear();
    for(const [id,value] of Object.entries(window.ATELIER_PROMPTS.ui)){const field=$(id);if(field)field.value=value;}
    window.AtelierPromptCatalog.applyPlaceholders();showStudioResultInstructions();applyManagedPromptDefaults();renderPromptManager();
  });
  root.querySelector('.prompt-manager-layout').before(taskEditors);
  const jsonConfigButton=document.createElement('button');jsonConfigButton.type='button';jsonConfigButton.className='json-editor-open expert-only';jsonConfigButton.dataset.jsonConfigOpen='prompts';jsonConfigButton.textContent='Chỉnh sửa đầy đủ JSON · tất cả nhóm cấu hình';root.prepend(jsonConfigButton);
  renderPresetPromptEditor(taskEditors);
  renderProcessingModeEditor(taskEditors);
  const renderList=()=>{const filter=$('promptFilter').value,list=items.filter((item)=>filter==='all'||item.slot===filter);$('promptList').innerHTML=list.map((item)=>`<article class="prompt-card ${item.isDefault?'is-default':''}" data-prompt-id="${escapeHtml(item.id)}"><div class="prompt-card-head"><div><span>${escapeHtml(PROMPT_SLOT_LABELS[item.slot]||item.slot)}</span><strong>${escapeHtml(item.name)}</strong></div>${item.isDefault?'<em>Mặc định</em>':''}</div><p>${escapeHtml(item.text)}</p><div class="prompt-card-actions"><button data-prompt-edit>Chỉnh sửa</button><button data-prompt-default ${item.isDefault?'disabled':''}>Đặt mặc định</button><button data-prompt-copy>Nhân bản</button><button data-prompt-delete ${item.builtin?'disabled title="Prompt tích hợp không thể xóa"':''}>Xóa</button></div></article>`).join('')||'<div class="library-empty"><div><strong>Chưa có prompt</strong><p>Thêm prompt đầu tiên cho phạm vi này.</p></div></div>';};
  const clearEditor=()=>{$('promptEditId').value='';$('promptName').value='';$('promptText').value='';$('promptEditorTitle').textContent='Thêm prompt';};renderList();
  $('promptFilter').addEventListener('change',renderList);$('promptCancel').addEventListener('click',clearEditor);
  $('promptSave').addEventListener('click',async()=>{try{const name=$('promptName').value.trim(),text=$('promptText').value.trim(),slot=$('promptSlot').value,id=$('promptEditId').value;if(!name||!text)return setMessage('Hãy nhập tên và nội dung prompt.','error');if(id){const item=items.find((entry)=>entry.id===id);if(item)Object.assign(item,{name,text,slot});}else items.push({id:`prompt-${Date.now()}`,name,text,slot,isDefault:false,builtin:false});await writePromptLibrary(items);applyManagedPromptDefaults();renderPromptManager();setMessage('Đã lưu prompt.','success');}catch(error){setMessage(error.message,'error');renderPromptManager();}});
  $('promptResetDefaults').addEventListener('click',async()=>{try{await writePromptLibrary(DEFAULT_PROMPT_LIBRARY.map((item)=>({...item})));applyManagedPromptDefaults();renderPromptManager();setMessage('Đã khôi phục thư viện prompt ban đầu.','success');}catch(error){setMessage(error.message,'error');renderPromptManager();}});
  $('promptList').addEventListener('click',async(event)=>{try{const card=event.target.closest('[data-prompt-id]'),item=items.find((entry)=>entry.id===card?.dataset.promptId);if(!item)return;if(event.target.closest('[data-prompt-edit]')){$('promptEditId').value=item.id;$('promptName').value=item.name;$('promptSlot').value=item.slot;$('promptText').value=item.text;$('promptEditorTitle').textContent='Chỉnh sửa prompt';$('promptName').focus();}else if(event.target.closest('[data-prompt-default]')){for(const entry of items)if(entry.slot===item.slot)entry.isDefault=false;item.isDefault=true;await writePromptLibrary(items);applyManagedPromptDefaults();renderPromptManager();}else if(event.target.closest('[data-prompt-copy]')){items.push({...item,id:`prompt-${Date.now()}`,name:`${item.name} · bản sao`,isDefault:false,builtin:false});await writePromptLibrary(items);renderPromptManager();}else if(event.target.closest('[data-prompt-delete]')&&!item.builtin){const index=items.indexOf(item);items.splice(index,1);if(item.isDefault){const fallback=items.find((entry)=>entry.slot===item.slot);if(fallback)fallback.isDefault=true;}await writePromptLibrary(items);applyManagedPromptDefaults();renderPromptManager();}}catch(error){setMessage(error.message,'error');renderPromptManager();}});
}

function systemStateLabel(model){if(model.ready&&model.operationalReady!==false)return 'Sẵn sàng';return model.runtimeReason||'Thiếu tệp model';}
const RESET_SCOPE_UI={
  uploads:['Ảnh của bạn','Ảnh do bạn tải lên; ảnh mẫu có sẵn được giữ nguyên.'],
  manual:['Chỉnh sửa thủ công','Phiên chỉnh sửa, ảnh gốc của phiên và bộ màu đã lưu.'],
  masks:['Mask đã lưu','Các mask đã lưu từ những phiên chỉnh sửa trước.'],
  review:['Hàng duyệt','Trạng thái chờ duyệt, chấp nhận, chạy lại và loại bỏ.'],
  jobs:['Tác vụ','Lịch sử tác vụ đã hoàn tất hoặc bị gián đoạn.'],
  quality:['Chất lượng','Báo cáo, baseline, hiệu chỉnh và benchmark chất lượng.'],
  outputs:['Kết quả tạo ảnh','Các ảnh kết quả và thư mục chạy đã sinh ra.'],
};
function formatResetSize(bytes){if(!bytes)return '0 KB';const units=['B','KB','MB','GB'];let value=bytes,index=0;while(value>=1024&&index<units.length-1){value/=1024;index++;}return `${value.toFixed(index?1:0)} ${units[index]}`;}
async function reloadSourceImages(){
  const selectedId=current?.id;
  const response=await fetch('/api/images'),data=await response.json();
  if(!response.ok)throw new Error(data.error||'Không thể tải lại danh sách ảnh');
  images=data.images||[];renderImageOptions();
  const selected=images.find((item)=>item.id===selectedId);if(selected)await loadImage(selected);else showEmptyEditorState();
}
async function resetWorkspaceScope(scope,button){
  const label=scope==='all'?'toàn bộ dữ liệu làm việc':RESET_SCOPE_UI[scope]?.[0]||scope;
  if(!window.confirm(`Đặt lại ${label}?\n\nDữ liệu sẽ được chuyển vào kho phục hồi trên máy, không bị xóa vĩnh viễn. Model, cấu hình và ảnh mẫu không bị ảnh hưởng.`))return;
  const feedback=document.querySelector('.reset-feedback'),original=button.textContent;button.disabled=true;button.textContent='Đang đặt lại…';
  try{
    const response=await fetch('/api/reset-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope,confirm:true})});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đặt lại dữ liệu');
    if(feedback)feedback.textContent=result.movedItems?`Đã đặt lại ${label}. ${result.movedFiles} tệp đã được chuyển vào ${result.archive}.`:`${label} hiện đã trống.`;
    if(['uploads','all'].includes(scope))await reloadSourceImages();
    if(['review','quality','all'].includes(scope))await loadReviewState();
    await loadSystemOverview();
  }catch(error){if(feedback)feedback.textContent=error.message;setMessage(error.message,'error');button.disabled=false;button.textContent=original;}
}
async function openModelManager(){
  activateAppView('model');
}
async function loadSystemOverview(){
  const root=$('systemOverview');if(!root)return;
  root.setAttribute('aria-busy','true');
  try{
    const response=await fetch('/api/system-overview'),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra hệ thống');
    const summary=result.summary,allReady=result.ready;
    root.innerHTML=`
      <section class="system-status ${allReady?'is-ready':'needs-attention'}">
        <div><span class="system-pulse"></span><div><strong>${allReady?'Các công cụ đã sẵn sàng chạy ngoại tuyến':'Hệ thống cần xử lý'}</strong><small>Kiểm tra lúc ${new Date(result.checkedAt).toLocaleTimeString('vi-VN')} · ${result.offline?'Dữ liệu chỉ lưu trên máy':'Đang dùng kết nối ngoài'}</small></div></div>
        <button data-system-refresh>Kiểm tra lại</button>
      </section>
      <section class="system-metrics" aria-label="Tổng quan hệ thống">
        <article><span>MODEL</span><strong>${summary.readyCount}/${summary.totalModels}</strong><small>model đủ điều kiện kỹ thuật</small></article>
        <article><span>THIẾT BỊ</span><strong>${escapeHtml(summary.gpu)}</strong><small>${summary.gpuMemoryMb?`${summary.gpuMemoryMb} MB VRAM`:'Chế độ CPU'}</small></article>
        <article><span>LƯU TRỮ</span><strong>${summary.diskFreeGb??'—'} GB</strong><small>dung lượng còn trống</small></article>
        <article><span>KHÔI PHỤC</span><strong>${summary.backupCount}</strong><small>bản sao lưu cục bộ</small></article>
      </section>
      <section class="workflow-card"><strong>Chất lượng tham chiếu trang phục: ${result.referenceReadiness?.readyCount??0}/${result.referenceReadiness?.total??3} bộ đạt kiểm định</strong><p>Model đủ điều kiện chạy chưa đồng nghĩa ảnh đã đạt chất lượng. Kiểm tra kết quả tại Duyệt trước khi bàn giao.</p></section>
      <section class="system-layout">
        <div class="system-main">
          <div class="section-heading"><div><span class="card-kicker">MODEL CỤC BỘ</span><h2>Khả năng đang sử dụng</h2></div><button data-open-model-manager>Quản lý model</button></div>
          <div class="system-models">${result.models.map((model)=>`<article><span class="model-state ${model.ready&&model.operationalReady!==false?'ok':'warn'}"></span><div><strong>${escapeHtml(model.name)}</strong><small>${escapeHtml(model.kind)} · ${escapeHtml(systemStateLabel(model))}</small></div><span class="state-badge">${model.selected?'Đã chọn':'Khả dụng'}</span></article>`).join('')}</div>
        </div>
        <aside class="system-side">
          <article class="system-action"><span class="card-kicker">AN TOÀN DỮ LIỆU</span><h3>Sao lưu và khôi phục</h3><p>${result.backups[0]?.createdAt?`Gần nhất: ${new Date(result.backups[0].createdAt).toLocaleString('vi-VN')}`:'Chưa có bản sao lưu.'}</p><button data-system-backup>Sao lưu ngay</button></article>
          <article class="system-action"><span class="card-kicker">DỮ LIỆU CHUẨN</span><h3>Baseline hồi quy</h3><p>${result.baseline?`${result.baseline.caseCount} trường hợp · ${new Date(result.baseline.createdAt).toLocaleDateString('vi-VN')}`:'Chưa tạo baseline.'}</p><button data-system-baseline>${result.baseline?'Tạo lại baseline':'Tạo baseline'}</button></article>
          <article class="system-action compact"><span class="card-kicker">TÁC VỤ</span><h3>${summary.runningJobs} đang chạy · ${summary.interruptedJobs} gián đoạn</h3><button data-trigger="jobsButton">Mở hàng tác vụ</button></article>
        </aside>
      </section>
      <section class="system-reset">
        <div class="section-heading"><div><span class="card-kicker">ĐẶT LẠI DỮ LIỆU</span><h2>Dọn các danh sách cục bộ</h2></div><span class="reset-archive-count">${result.resetData.archives} lần đặt lại có thể phục hồi</span></div>
        <p class="reset-note">Dữ liệu được chuyển vào kho phục hồi, không xóa vĩnh viễn. Model, cấu hình, bản sao lưu và ảnh mẫu luôn được giữ nguyên.</p>
        <div class="reset-grid">${Object.entries(RESET_SCOPE_UI).map(([scope,[label,description]])=>{const data=result.resetData.scopes[scope]||{items:0,files:0,bytes:0};return `<article><div><strong>${label}</strong><small>${description}</small><span>${data.items} mục · ${data.files} tệp · ${formatResetSize(data.bytes)}</span></div><button class="danger" data-reset-scope="${scope}" ${data.items?'':'disabled'}>Đặt lại</button></article>`;}).join('')}</div>
        <div class="reset-footer"><p class="reset-feedback" role="status">Chọn từng nhóm để kiểm soát chính xác dữ liệu cần dọn.</p><button class="danger" data-reset-scope="all" ${Object.values(result.resetData.scopes).some((item)=>item.items)?'':'disabled'}>Đặt lại toàn bộ dữ liệu làm việc</button></div>
      </section>`;
    root.querySelector('[data-system-refresh]')?.addEventListener('click',loadSystemOverview);
    root.querySelector('[data-system-backup]')?.addEventListener('click',()=>window.BackupUI.open());
    root.querySelector('[data-system-baseline]')?.addEventListener('click',async()=>{await buildGoldenBaseline();await loadSystemOverview();});
    for(const button of root.querySelectorAll('[data-reset-scope]'))button.addEventListener('click',()=>resetWorkspaceScope(button.dataset.resetScope,button));
  }catch(error){root.innerHTML=`<section class="system-status needs-attention"><div><span class="system-pulse"></span><div><strong>Không thể đọc trạng thái hệ thống</strong><small>${escapeHtml(readableRequestError(error))}</small></div></div><button data-system-refresh>Thử lại</button></section>`;root.querySelector('[data-system-refresh]')?.addEventListener('click',loadSystemOverview);}
  finally{root.removeAttribute('aria-busy');}
}

function qualityMetric(label,value,percent){const safe=Number(value||0),display=label==='Tương đồng tham chiếu'?safe.toFixed(3):safe.toFixed(1);return `<article><div><span>${label}</span><strong>${display}</strong></div><div class="quality-track"><i style="width:${Math.max(0,Math.min(100,percent))}%"></i></div></article>`;}
async function runQualityAction(action,button){
  const feedback=document.querySelector('.quality-feedback');button.disabled=true;const original=button.textContent;button.textContent='Đang thực hiện…';if(feedback)feedback.textContent='Đang xử lý trên dữ liệu cục bộ…';
  try{
    if(action==='dashboard')await buildDashboard();else if(action==='benchmark')await runBenchmark();else if(action==='baseline')await compareBaseline();else if(action==='calibrate')await calibrateQuality();else if(action==='acceptance')await checkAcceptance();else if(action==='review')await showReviewReadiness();
    if(feedback)feedback.textContent='Đã hoàn tất. Dữ liệu chất lượng vừa được cập nhật.';
    if(['dashboard','benchmark','baseline','calibrate','acceptance'].includes(action))await loadQualityOverview();
  }catch(error){if(feedback)feedback.textContent=error.message;setMessage(error.message,'error');}
  finally{button.disabled=false;button.textContent=original;}
}
async function loadQualityOverview(){
  const root=$('qualityOverview');if(!root)return;root.setAttribute('aria-busy','true');
  try{
    const response=await fetch('/api/quality-overview'),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc dữ liệu chất lượng');
    const metrics=result.dashboard?.metrics||{},review=result.review,regression=result.regression,latest=result.latestBenchmark,acceptance=result.acceptance;
    root.innerHTML=`<section class="quality-summary"><div><span class="system-pulse ${latest?'':'warn'}"></span><div><strong>${latest?'Đã có dữ liệu đo lường':'Chưa có benchmark'}</strong><small>${latest?`Lần gần nhất ${new Date(latest.createdAt).toLocaleString('vi-VN')} · ${latest.count} ảnh`:'Chạy bộ kiểm tra để tạo dữ liệu đầu tiên'}</small></div></div><button data-quality-refresh>Làm mới</button></section>
      <section class="quality-kpis"><article><span>ĐIỂM TỔNG</span><strong>${Number(metrics.qualityScore||0).toFixed(1)}</strong><small>benchmark mới nhất</small></article><article><span>ĐÃ DUYỆT</span><strong>${review.reviewed}/${review.total}</strong><small>${review.approved} chấp nhận · ${review.retry} chạy lại</small></article><article><span>HỒI QUY</span><strong>${regression?`${regression.passed}/${regression.total}`:'—'}</strong><small>${regression?`${regression.regressed} suy giảm · ${regression.missing} thiếu`:'chưa so sánh baseline'}</small></article><article><span>PHÁT HÀNH</span><strong>${acceptance?.status==='passed'?'Đạt':acceptance?'Chưa đạt':'—'}</strong><small>${acceptance?`${acceptance.approvedCount||0}/23 ảnh chấp nhận`:'chưa kiểm tra nghiệm thu'}</small></article></section>
      <section class="quality-layout"><div class="quality-main"><div class="section-heading"><div><span class="card-kicker">CHỈ SỐ</span><h2>Chất lượng kết quả gần nhất</h2></div><button data-quality-action="dashboard">Phân tích lại</button></div><div class="quality-metrics">${qualityMetric('Chất lượng',metrics.qualityScore,metrics.qualityScore)}${qualityMetric('Tương đồng tham chiếu',metrics.referenceSimilarity,Number(metrics.referenceSimilarity||0)*100)}${qualityMetric('Đường biên',metrics.seamScore,metrics.seamScore)}${qualityMetric('Hình thể',metrics.anatomyScore,metrics.anatomyScore)}${qualityMetric('Liên tục chất liệu',metrics.textureContinuity,metrics.textureContinuity)}</div><div class="quality-category"><span>${result.benchmarkCount} lượt benchmark</span>${result.categories.map((item)=>`<span>${escapeHtml(item.category)} · ${item.count} ảnh</span>`).join('')}</div></div>
      <aside class="quality-actions"><article><span class="card-kicker">BENCHMARK</span><h3>Đo trên bộ ảnh chuẩn</h3><p>Chạy cấu hình cố định và cập nhật toàn bộ chỉ số.</p><button data-quality-action="benchmark">Chạy bộ kiểm tra 23 ảnh</button></article><article><span class="card-kicker">HỒI QUY</span><h3>So sánh với baseline</h3><p>Baseline ${result.baseline?.caseCount||0} trường hợp · ${regression?.regressed||0} suy giảm.</p><button data-quality-action="baseline">So sánh ngay</button></article><article><span class="card-kicker">DUYỆT & NGHIỆM THU</span><h3>${review.reviewed} kết quả đã duyệt</h3><div class="quality-action-row"><button data-quality-action="review">Xem tiến độ</button><button data-quality-action="acceptance">Kiểm tra phát hành</button></div></article><article><span class="card-kicker">HIỆU CHỈNH</span><h3>Tối ưu ngưỡng chất lượng</h3><button data-quality-action="calibrate">Tạo đề xuất</button></article></aside></section><p class="quality-feedback" role="status">Dữ liệu được đọc và lưu hoàn toàn trên máy.</p>`;
    root.querySelector('[data-quality-refresh]')?.addEventListener('click',loadQualityOverview);for(const button of root.querySelectorAll('[data-quality-action]'))button.addEventListener('click',()=>runQualityAction(button.dataset.qualityAction,button));
  }catch(error){root.innerHTML=`<section class="quality-summary"><div><span class="system-pulse warn"></span><div><strong>Không thể tải dữ liệu chất lượng</strong><small>${escapeHtml(readableRequestError(error))}</small></div></div><button data-quality-refresh>Thử lại</button></section>`;root.querySelector('[data-quality-refresh]')?.addEventListener('click',loadQualityOverview);}
  finally{root.removeAttribute('aria-busy');}
}

let jobsRefreshTimer=null;
function jobStatusLabel(status){return({running:'Đang chạy',cancelling:'Đang dừng',interrupted:'Gián đoạn',completed:'Hoàn tất',cancelled:'Đã hủy',failed:'Thất bại',queued:'Chờ xử lý'})[status]||status||'Không xác định';}
function jobProgress(job){if(['enhance','makeup','character'].includes(job.taskType))return{current:Number(job.completedSteps||0),total:Number(job.totalWorkSteps||0),percent:job.status==='completed'?100:Math.min(95,Math.round(10+80*Number(job.completedSteps||0)/Math.max(1,Number(job.totalWorkSteps||1))))};if(job.taskType==='text-to-image')return{current:Number(job.completedSteps||0),total:Number(job.totalWorkSteps||0),percent:generationProgressInfo(job).percent};if(job.taskType==='outpaint')return{current:Number(job.currentVariant||0),total:Number(job.totalVariants||0),percent:generationProgressInfo(job).percent};const current=Number(job.current||job.completedSeeds||0),total=Number(job.total||job.totalSeeds||0);if(job.status==='completed')return{current,total,percent:100};if(job.taskType==='inpaint'){const phase={'inpaint-validating':3,'inpaint-preparing-mask':8,'inpaint-model-loading':11,'inpaint-model-release':13,'inpaint-model-disk':16,'inpaint-model-gpu':21,'inpaint-model-ready':25,'inpaint-blending':90,'inpaint-texture-recovery':93,'inpaint-structural-refine':95,'inpaint-structural-analysis':95,'inpaint-variant-complete':97,'inpaint-saving':98,failed:100,cancelled:100};const percent=job.stage==='inpaint-generating'&&job.totalWorkSteps?25+Math.round(65*Number(job.completedSteps||0)/Number(job.totalWorkSteps)):phase[job.stage]??0;return{current:job.currentVariant||1,total:job.totalVariants||1,percent:Math.max(0,Math.min(99,percent))};}return{current,total,percent:total?Math.max(0,Math.min(100,Math.round(current/total*100))):0};}
async function runJobAction(action,jobId,button){button.disabled=true;try{if(action==='results'){const response=await fetch('/api/job-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId})}),state=await response.json();if(!response.ok||!state.ok)throw new Error(state.error||'Không thể mở kết quả đã lưu.');showGenerationResult(state);return;}if(action==='resume'){setActiveJob(jobId);await resumeActiveJob();}else if(action==='cancel'){setActiveJob(jobId);await cancelActiveJob();}await loadJobsOverview();}catch(error){setMessage(error.message,'error');button.disabled=false;}}
async function loadJobsOverview(){
  const root=$('jobsOverview');if(!root)return;
  try{
    const response=await fetch('/api/jobs'),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc danh sách tác vụ');
    const jobs=result.jobs||[],running=jobs.filter((job)=>['running','cancelling'].includes(job.status)),interrupted=jobs.filter((job)=>job.status==='interrupted'),completed=jobs.filter((job)=>job.status==='completed'),failed=jobs.filter((job)=>['failed','cancelled'].includes(job.status));
    root.innerHTML=`<section class="jobs-live"><div><span class="live-dot ${running.length?'active':''}"></span><div><strong>${running.length?`${running.length} tác vụ đang xử lý`:'Không có tác vụ đang chạy'}</strong><small>Cập nhật lúc ${new Date().toLocaleTimeString('vi-VN')} · tự làm mới sau 3 giây</small></div></div><button data-jobs-refresh>Làm mới</button></section>
      <section class="jobs-kpis"><article><span>ĐANG CHẠY</span><strong>${running.length}</strong><small>tác vụ hoạt động</small></article><article><span>GIÁN ĐOẠN</span><strong>${interrupted.length}</strong><small>có thể tiếp tục</small></article><article><span>HOÀN TẤT</span><strong>${completed.length}</strong><small>đã tạo kết quả</small></article><article><span>LỖI / ĐÃ HỦY</span><strong>${failed.length}</strong><small>cần kiểm tra</small></article></section>
      <section class="jobs-layout"><div class="jobs-main"><div class="section-heading"><div><span class="card-kicker">HÀNG TÁC VỤ</span><h2>Quá trình xử lý</h2></div><span class="jobs-count">${jobs.length} tác vụ</span></div><div class="jobs-list">${jobs.map((job)=>{const progress=jobProgress(job),active=['running','cancelling'].includes(job.status);return `<article class="job-card ${active?'is-active':''}"><div class="job-head"><div><span class="job-state ${escapeHtml(job.status)}">${escapeHtml(jobStatusLabel(job.status))}</span><strong>${escapeHtml(job.jobId)}</strong></div><time>${job.updatedAt?new Date(job.updatedAt).toLocaleString('vi-VN'):'—'}</time></div><div class="job-meta"><span>${escapeHtml(STAGE_LABELS[job.stage]||job.stage||'Chưa xác định bước')}</span><span>${job.sampleId?escapeHtml(job.sampleId):'—'}</span><span>${progress.total?`${progress.current}/${progress.total}`:'Chưa có tiến độ'}</span></div><div class="job-progress"><i style="width:${progress.percent}%"></i></div><div class="job-foot"><small>${progress.percent}% hoàn tất${job.seed?` · seed ${job.seed}`:''}</small><div>${job.status==='interrupted'&&job.resumable?`<button data-job-action="resume" data-job-id="${escapeHtml(job.jobId)}">Tiếp tục</button>`:''}${active?`<button class="danger" data-job-action="cancel" data-job-id="${escapeHtml(job.jobId)}">Hủy an toàn</button>`:''}</div></div></article>`;}).join('')||'<div class="jobs-empty"><strong>Chưa có tác vụ</strong><p>Các tác vụ tạo ảnh và benchmark sẽ xuất hiện tại đây.</p></div>'}</div></div>
      <aside class="jobs-side"><article><span class="card-kicker">PHỤC HỒI</span><h3>${interrupted.length} tác vụ có thể tiếp tục</h3><p>Tiếp tục theo thiết lập đã lưu. Một số tác vụ sẽ tạo lại các phương án từ đầu.</p>${interrupted[0]?`<button data-job-action="resume" data-job-id="${escapeHtml(interrupted[0].jobId)}">Tiếp tục tác vụ gần nhất</button>`:'<button disabled>Không có tác vụ gián đoạn</button>'}</article><article><span class="card-kicker">BẢO TRÌ</span><h3>Dọn checkpoint cũ</h3><p>Chỉ xóa trạng thái tác vụ đã hoàn tất hoặc đã hủy; ảnh và báo cáo được giữ lại.</p><button data-jobs-cleanup>Dọn checkpoint cũ</button></article><article><span class="card-kicker">AN TOÀN</span><h3>Hủy ở điểm an toàn</h3><p>Yêu cầu hủy sẽ có hiệu lực sau lượt xử lý hiện tại để tránh làm hỏng kết quả.</p></article></aside></section>`;
    window.WorkQueue?.render(root).catch(error=>setMessage(error.message,'error'));
    root.querySelectorAll('.jobs-list .job-card').forEach((card,index)=>{const job=jobs[index];if(['outpaint','text-to-image','enhance','makeup','character'].includes(job.taskType)&&(job.comparison||(job.results||[]).some(item=>item.file||item.image))){const button=document.createElement('button');button.textContent=job.comparison?'Mở bảng so sánh':job.taskType==='character'?'Xem tư thế & biểu cảm':job.taskType==='makeup'?'Xem ảnh trang điểm':job.taskType==='enhance'?'Xem ảnh cải thiện':job.taskType==='text-to-image'?'Xem ảnh đã tạo':'Xem ảnh mở rộng';button.dataset.jobAction='results';button.dataset.jobId=job.jobId;card.querySelector('.job-foot>div').append(button);}});
    root.querySelector('[data-jobs-refresh]')?.addEventListener('click',loadJobsOverview);for(const button of root.querySelectorAll('[data-job-action]'))button.addEventListener('click',()=>runJobAction(button.dataset.jobAction,button.dataset.jobId,button));root.querySelector('[data-jobs-cleanup]')?.addEventListener('click',async()=>{await cleanupOldJobs();await loadJobsOverview();});
  }catch(error){root.innerHTML=`<section class="jobs-live error"><div><span class="live-dot"></span><div><strong>Không thể tải tác vụ</strong><small>${escapeHtml(readableRequestError(error))}</small></div></div><button data-jobs-refresh>Thử lại</button></section>`;root.querySelector('[data-jobs-refresh]')?.addEventListener('click',loadJobsOverview);}
}
function startJobsLiveUpdates(){clearInterval(jobsRefreshTimer);loadJobsOverview();jobsRefreshTimer=setInterval(()=>{if(!$('hubView').hidden&&$('jobsOverview'))loadJobsOverview();},3000);}

const REVIEW_CATEGORY_LABELS={upper_body:'Áo / thân trên',lower_body:'Quần, váy / thân dưới',overall:'Toàn thân'};
async function runReviewAction(action,button,category=''){
  button.disabled=true;const original=button.textContent;button.textContent='Đang mở…';
  try{
    if(category&&$('garmentCategory'))$('garmentCategory').value=category;
    if(action==='session')await reviewBenchmark();else if(action==='readiness')await showReviewReadiness();else if(action==='retry')await runTargetedRetryQueue();else if(action==='compare')await showRetryComparisons();else if(action==='export')await exportApproved();
    await loadReviewOverview();
  }catch(error){setMessage(error.message,'error');}
  finally{button.disabled=false;button.textContent=original;}
}
async function loadReviewOverview(){
  const root=$('reviewOverview');if(!root)return;root.setAttribute('aria-busy','true');
  try{
    const [readinessResponse,comparisonsResponse]=await Promise.all([fetch('/api/review-readiness'),fetch('/api/retry-comparisons')]);const readiness=await readinessResponse.json(),comparisons=await comparisonsResponse.json();if(!readinessResponse.ok||!readiness.ok)throw new Error(readiness.error||'Không thể đọc hàng duyệt');
    const percent=readiness.total?Math.round(readiness.reviewed/readiness.total*100):0,nextCategory=readiness.next?.category||'upper_body';
    root.innerHTML=`<section class="review-summary"><div class="review-ring" style="--review-progress:${percent*3.6}deg"><span>${percent}%</span></div><div class="review-summary-copy"><strong>${readiness.ready?'Sẵn sàng nghiệm thu':'Cần tiếp tục duyệt'}</strong><small>${readiness.reviewed}/${readiness.total} trường hợp đã quyết định · ${readiness.pending} đang chờ</small></div><button data-review-action="session" data-review-category="${escapeHtml(nextCategory)}">Duyệt trường hợp tiếp theo</button></section>
      <section class="review-kpis"><article><span>CHẤP NHẬN</span><strong>${readiness.approved}</strong><small>sẵn sàng bàn giao</small></article><article><span>CHẠY LẠI</span><strong>${readiness.retry}</strong><small>cần tạo phương án mới</small></article><article><span>LOẠI BỎ</span><strong>${readiness.rejected}</strong><small>không sử dụng</small></article><article><span>ĐANG CHỜ</span><strong>${readiness.pending}</strong><small>cần con người quyết định</small></article></section>
      <section class="review-layout"><div class="review-main"><div class="section-heading"><div><span class="card-kicker">PHIÊN DUYỆT</span><h2>Tiến độ theo loại trang phục</h2></div><button data-review-action="readiness">Xem đầy đủ</button></div><div class="review-categories">${Object.entries(readiness.perCategory||{}).map(([category,value])=>{const categoryPercent=value.total?Math.round(value.reviewed/value.total*100):0;return `<article><div class="review-category-head"><div><strong>${escapeHtml(REVIEW_CATEGORY_LABELS[category]||category)}</strong><small>${value.reviewed}/${value.total} đã duyệt · ${value.pending} chờ</small></div><span>${categoryPercent}%</span></div><div class="review-progress-track"><i style="width:${categoryPercent}%"></i></div><button data-review-action="session" data-review-category="${escapeHtml(category)}">${value.pending?'Tiếp tục duyệt':'Xem lại kết quả'}</button></article>`;}).join('')}</div><div class="review-next"><span class="card-kicker">TIẾP THEO</span><strong>${readiness.next?escapeHtml(readiness.next.sampleId):'Không còn trường hợp chờ duyệt'}</strong><small>${readiness.next?escapeHtml(REVIEW_CATEGORY_LABELS[readiness.next.category]||readiness.next.category):'Hàng duyệt đã hoàn thành'}</small></div></div>
      <aside class="review-side"><article><span class="card-kicker">ĐIỀU KIỆN CÒN THIẾU</span><h3>${readiness.blockers.length} mục cần xử lý</h3><ul>${readiness.blockers.slice(0,5).map((item)=>`<li>${escapeHtml(item)}</li>`).join('')||'<li class="passed">Đã đáp ứng toàn bộ điều kiện.</li>'}</ul></article><article><span class="card-kicker">CHỈNH SỬA</span><h3>${readiness.retry} ảnh được đánh dấu chạy lại</h3><button data-review-action="retry" ${readiness.retry?'':'disabled'}>Chạy lại ảnh có vấn đề</button></article><article><span class="card-kicker">SO SÁNH</span><h3>${comparisons.items?.length||0} kết quả cũ và mới</h3><button data-review-action="compare" ${(comparisons.items?.length||0)?'':'disabled'}>Mở màn hình so sánh</button></article><article><span class="card-kicker">BÀN GIAO</span><h3>${readiness.approved} kết quả được chấp nhận</h3><button data-review-action="export" ${readiness.approved?'':'disabled'}>Xuất kết quả đã duyệt</button></article></aside></section>`;
    const benchmark=document.createElement("details");benchmark.className="workflow-card";benchmark.innerHTML="<summary>Kiểm chuẩn thử trang phục · nâng cao</summary>";while(root.firstChild)benchmark.append(root.firstChild);root.append(benchmark);
    window.CreativeReview?.mount(root).catch(error=>setMessage(error.message,'error'));
    window.AcceptanceUI?.mount(root).catch(error=>setMessage(error.message,'error'));
    for(const button of root.querySelectorAll('[data-review-action]'))button.addEventListener('click',()=>runReviewAction(button.dataset.reviewAction,button,button.dataset.reviewCategory||''));
  }catch(error){root.innerHTML=`<section class="review-summary error"><div class="review-summary-copy"><strong>Không thể tải hàng duyệt</strong><small>${escapeHtml(readableRequestError(error))}</small></div><button data-review-refresh>Thử lại</button></section>`;root.querySelector('[data-review-refresh]')?.addEventListener('click',loadReviewOverview);}
  finally{root.removeAttribute('aria-busy');}
}

async function restartAtelierWeb(event) {
  const button=event.currentTarget,status=button.parentElement.querySelector('[data-restart-status]');
  if(activeJobId){status.textContent='Hãy đợi tác vụ hiện tại kết thúc.';return;}
  if(!confirm('Khởi động lại máy chủ web AI Atelier? Hãy lưu vùng chỉnh sửa trước. Trang sẽ tải lại khi máy chủ sẵn sàng.'))return;
  button.disabled=true;
  try{
    status.textContent='Đang yêu cầu khởi động lại…';
    const response=await fetch('/api/restart-web',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true}),signal:AbortSignal.timeout(10000)});
    const result=await response.json();
    if(!response.ok||!result.ok)throw new Error(response.status===405?'Máy chủ hiện tại chưa hỗ trợ chức năng này. Hãy khởi động lại bằng start.ps1 một lần.':result.error||'Không thể khởi động lại máy chủ.');
    status.textContent='Đang chờ máy chủ kết nối lại…';
    for(let attempt=0;attempt<30;attempt++){
      await new Promise(resolve=>setTimeout(resolve,1000));
      try{
        const healthResponse=await fetch('/api/health',{cache:'no-store',signal:AbortSignal.timeout(1500)}),health=await healthResponse.json();
        if(healthResponse.ok&&health.ok&&health.instanceId&&health.instanceId!==result.instanceId){location.reload();return;}
      }catch{}
    }
    throw new Error('Máy chủ chưa kết nối lại. Hãy chạy start.ps1 và tải lại trang.');
  }catch(error){status.textContent=error.message;button.disabled=false;}
}

function renderHub(name) {
  const hub=HUBS[name]; if(!hub)return;
  const retainedModelContent=$('modelManagerContent');if(retainedModelContent&&$('hubView').contains(retainedModelContent))$('modelManagerDialog').appendChild(retainedModelContent);
  const libraryContent=`<section class="library-overview"><div class="library-toolbar"><input id="librarySearch" type="search" placeholder="${escapeHtml(window.ATELIER_PROMPTS.uiPlaceholders.librarySearch)}" aria-label="Tìm trong thư viện"><button id="libraryRestoreRemoved" type="button" hidden>Khôi phục mục đã xóa</button><small id="libraryCount">Đang tải…</small></div><div class="library-filters" role="group" aria-label="Lọc thư viện"><button class="active" data-library-filter="all">Tất cả</button><button data-library-filter="user">Ảnh nguồn</button><button data-library-filter="result">Kết quả</button><button data-library-filter="reference">Tham chiếu</button><button data-library-filter="sample">Ảnh mẫu</button><button data-library-filter="recent">Gần đây</button></div><div id="libraryBulkBar" class="library-bulk-bar" hidden><strong id="librarySelectedCount">0 ảnh đã chọn</strong><button id="libraryOpenSelected">Mở mục đầu tiên</button><button id="libraryClearSelected">Bỏ chọn</button><button id="libraryRemoveSelected" class="danger">Xóa khỏi thư viện</button></div><div id="libraryGrid" class="library-grid"></div></section>`;
  const settingsContent='<section class="settings-dashboard"><article data-services-panel></article><article><span class="card-kicker">DỮ LIỆU TRÌNH DUYỆT</span><h3>Xóa dữ liệu đã lưu</h3><p>Xóa prompt cục bộ, lựa chọn ảnh, model và tùy chỉnh giao diện trong trình duyệt này. Ảnh, model, kết quả và hướng dẫn lưu trên máy vẫn được giữ.</p><button class="danger" data-clear-browser-data>Xóa dữ liệu trình duyệt…</button><small data-browser-data-status role="status"></small></article><article><span class="card-kicker">CHẤT LƯỢNG</span><h3>Nghiệm thu theo tác vụ</h3><p>Đối chiếu ảnh nguồn và kết quả, kiểm tra từng tiêu chí, theo dõi các ca còn cần sửa.</p><button data-settings-view="review">Mở bộ nghiệm thu</button><button data-settings-view="reports">Chỉ số kỹ thuật</button></article><article><span class="card-kicker">MODEL</span><h3>Thư viện model cục bộ</h3><p>Kiểm tra phụ thuộc, đăng ký và lựa chọn model theo chức năng.</p><button data-open-model-manager>Mở quản lý model</button></article></section><div id="systemOverview" class="system-overview"><div class="system-skeleton">Đang kiểm tra hệ thống…</div></div>';
  const modelContent='<section id="modelPageHost" class="model-manager-page"><div class="system-skeleton">Đang tải thư viện model…</div></section>';
  const promptContent='<section id="promptManager" class="prompt-manager"></section>';
  $('hubView').innerHTML=`<div class="hub-header"><div><p class="eyebrow">${hub.eyebrow}</p><h1>${hub.title}</h1><p>${hub.description}</p></div><button data-view-return>← Trở lại Studio</button></div>${name==='library'?libraryContent:name==='settings'?settingsContent:name==='model'?modelContent:name==='prompts'?promptContent:name==='reports'?'<div id="qualityOverview" class="quality-overview"><div class="system-skeleton">Đang tổng hợp dữ liệu chất lượng…</div></div>':name==='jobs'?'<div id="jobsOverview" class="jobs-overview"><div class="system-skeleton">Đang tải hàng tác vụ…</div></div>':name==='review'?'<div id="reviewOverview" class="review-overview"><div class="system-skeleton">Đang tải hàng duyệt…</div></div>':`<div class="hub-grid">${hub.cards.map(([kicker,title,description,target,featured])=>`<article class="hub-card ${featured?'featured':''}"><span class="card-kicker">${kicker}</span><h3>${title}</h3><p>${description}</p><button data-trigger="${target}">${title}</button></article>`).join('')}</div>`}`;
  $('hubView').hidden=false;
  if(name==='library')window.AtelierLibrary.mount($('hubView').querySelector('.library-overview'),{preview:item=>openImageAtFullSize(item.url,item.name),open:async item=>{activateAppView('create');await loadImage(item);}});
  if(name==='settings'){
    const jsonConfigButton=document.createElement('button');jsonConfigButton.type='button';jsonConfigButton.className='json-editor-open expert-only';jsonConfigButton.dataset.jsonConfigOpen='prompts';jsonConfigButton.textContent='Quản lý và chỉnh sửa tất cả JSON cấu hình';$('hubView').querySelector('.settings-dashboard').before(jsonConfigButton);
    globalThis.QualityLearning?.mountSettings($('hubView'));
    const promptLink=document.createElement('button');promptLink.textContent='Thư viện mô tả và prompt';promptLink.onclick=()=>activateAppView('prompts');$('hubView').querySelector('.settings-dashboard').append(promptLink);
    loadSystemOverview();
    window.ServiceManagerUI?.mount($('hubView').querySelector('[data-services-panel]'),restartAtelierWeb);
  }
  if(name==='reports')loadQualityOverview();
  if(name==='jobs')startJobsLiveUpdates();
  if(name==='review')loadReviewOverview();
  if(name==='prompts')renderPromptManager();
  if(name==='model'){
    const host=$('modelPageHost'),content=$('modelManagerContent'),panel=$('offlineModelPanel');if(host&&content){host.innerHTML='';host.appendChild(content);if(panel&&panel.parentElement!==content)content.appendChild(panel);if(panel)panel.open=true;setModelManagerTab(localStorage.getItem('modelManagerTab')||'capabilities');Promise.all([loadModels(),loadModelCapabilities(),loadChromaStatus()]).catch((error)=>setMessage(error.message,'error'));}
  }
}

function renderLibrary(){return window.AtelierLibrary?.render();}
async function loadLibraryAssets(){return window.AtelierLibrary?.load();}

async function changeLibraryRemoval(restore){
  const ids=[...librarySelected];if(!restore&&!ids.length)return;
  const message=restore?'Khôi phục tất cả mục đã xóa khỏi thư viện?':`Xóa ${ids.length} ảnh đã chọn khỏi thư viện? Tệp trên ổ đĩa được giữ nguyên. Bạn có thể khôi phục sau.`;
  if(!window.confirm(message))return;
  const button=$(restore?'libraryRestoreRemoved':'libraryRemoveSelected');button.disabled=true;
  try{const response=await fetch('/api/library-remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(restore?{restore:true}:{ids})}),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể cập nhật thư viện');librarySelected.clear();await loadLibraryAssets();}
  catch(error){window.alert(error.message);}finally{button.disabled=false;}
}
function updateLibraryBulkBar(){const bar=$('libraryBulkBar');if(!bar)return;bar.hidden=!librarySelected.size;$('librarySelectedCount').textContent=`${librarySelected.size} ảnh đã chọn`;}

function activateAppView(name) {
  if(name==='chroma'){name='create';setStudioMode('chroma');}
  currentAppView=name;
  window.AtelierStore?.set({view:name});
  const studioCommandBar=$('studioCommandBar');
  if(studioCommandBar)studioCommandBar.hidden=name!=='create';
  requestAnimationFrame(updateProgressVisibility);
    if(name!=='jobs'){clearInterval(jobsRefreshTimer);jobsRefreshTimer=null;}
  for(const item of document.querySelectorAll('[data-view]')){const active=item.dataset.view===name;item.classList.toggle('active',active);if(item.matches('.nav-item'))active?item.setAttribute('aria-current','page'):item.removeAttribute('aria-current');}
  $('chromaView').hidden=true;
  if(name==='create'){$('hubView').hidden=true;loadStudioResultInstructions();requestAnimationFrame(fitCanvas);return;}
  renderHub(name);
}

let studioMode='tryon';
let studioTaskMasks={};
function switchTaskMask(next){
  if(next===studioMode||!current||!sourceImage||!maskCanvas.width||!maskCanvas.height)return;
  studioTaskMasks[studioMode]={imageId:current.id,width:maskCanvas.width,height:maskCanvas.height,editable:maskCtx.getImageData(0,0,maskCanvas.width,maskCanvas.height),protected:protectCtx.getImageData(0,0,protectCanvas.width,protectCanvas.height),points:aiPoints.map((point)=>({...point})),history:[...history],notes:$('notes').value,label:$('labelSelect').value};
  const saved=studioTaskMasks[next];
  studioTaskMasks[studioMode].manualProtected=manualProtectCtx.getImageData(0,0,manualProtectCanvas.width,manualProtectCanvas.height);
  manualProtectCtx.clearRect(0,0,manualProtectCanvas.width,manualProtectCanvas.height);
  if(saved?.imageId===current.id&&saved.width===maskCanvas.width&&saved.height===maskCanvas.height&&saved.manualProtected)manualProtectCtx.putImageData(saved.manualProtected,0,0);
  maskCtx.clearRect(0,0,maskCanvas.width,maskCanvas.height);protectCtx.clearRect(0,0,protectCanvas.width,protectCanvas.height);
  aiPoints=[];history=[];drawing=false;lastPoint=null;
  if(saved&&saved.imageId===current.id&&saved.width===maskCanvas.width&&saved.height===maskCanvas.height){maskCtx.putImageData(saved.editable,0,0);protectCtx.putImageData(saved.protected,0,0);aiPoints=saved.points;history=saved.history;$('notes').value=saved.notes;$('labelSelect').value=saved.label;}
  else $('notes').value='';
  render();
}
async function loadTryonModelOptions(){
  const response=await fetch('/api/model-capabilities',{cache:'no-store'}),result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra model thay trang phục');
  const feature=result.features.find((item)=>item.id==='virtual-tryon'),models=feature?.models||[];
  const previous=$('tryonModelSelect').value;
  const supported=models.filter((model)=>['catvton','idm-vton'].includes(model.id)&&model.ready&&model.registered&&model.operationalReady!==false);
  const readyOptions=supported.map((model)=>`<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)} · sẵn sàng</option>`).join('');
  const unavailable=models.filter((model)=>!supported.includes(model));
  const pendingOptions=unavailable.map((model)=>`<option value="${escapeHtml(model.id)}" disabled>${escapeHtml(model.name)} · ${!model.registered?'chưa đăng ký':escapeHtml(model.runtimeReason||'chưa sẵn sàng')}</option>`).join('');
  $('tryonModelSelect').innerHTML=(readyOptions?`<optgroup label="Có thể sử dụng">${readyOptions}</optgroup>`:'<option value="">Chưa có model có thể sử dụng</option>')+(pendingOptions?`<optgroup label="Chưa thể sử dụng">${pendingOptions}</optgroup>`:'');
  $('tryonModelSelect').value=supported.find((model)=>model.id===previous)?.id||supported.find((model)=>model.selected)?.id||supported[0]?.id||'';$('tryonModelSelect').disabled=!supported.length;
  $('tryonModelHint').textContent=supported.length?'Dùng ảnh trang phục tham chiếu với model đã chọn. IDM-VTON sử dụng thêm DensePose. Pipeline thay trang phục chưa hỗ trợ LoRA.':'Hoàn thiện model và các phụ thuộc trong Hệ thống.';
  refreshStudioReadiness();
}
function refreshStudioReadiness(){
  const status=$('studioReadiness');if(!status)return;
  if(studioMode==='outpaint')refreshOutpaintPreview();
  const hasSource=Boolean(current&&sourceImage),hasMask=editableMaskStats().selected>0,hasReference=Boolean(garmentDataUrl),autoMask=Boolean($('autoMaskToggle')?.checked);
  const modelSelect=studioMode==='outpaint'?$('outpaintModel'):studioMode==='inpaint'?$('inpaintModelSelect'):studioMode==='chroma'?$('textToImageModel'):isDescriptionTryon()?$('tryonDescriptionModel'):$('tryonModelSelect'),hasModel=Boolean(modelSelect?.value&&!modelSelect.disabled);
  window.ImageEnhancement?.sync();
  window.Makeup?.sync();
  window.Character?.sync();
  const requirements=studioMode==='character'?window.Character.requirements(hasSource):studioMode==='makeup'?window.Makeup.requirements(hasSource):studioMode==='enhance'?window.ImageEnhancement.requirements(hasSource,hasMask):studioMode==='outpaint'?[['Ảnh',hasSource],['Khung mở rộng',outpaintReady()],['Model',hasModel]]:studioMode==='inpaint'?[['Ảnh',hasSource],['Vùng chỉnh sửa',hasMask],['Model',hasModel]]:studioMode==='chroma'?[['Mô tả',Boolean($('chromaPrompt')?.value.trim())&&window.NewImage?.promptReady()!==false],['Model',hasModel]]:isDescriptionTryon()?[['Ảnh',hasSource],['Mô tả',Boolean($('tryonDescription')?.value.trim())],['Vùng chỉnh sửa',hasMask||autoMask],['Model',hasModel]]:[['Ảnh',hasSource],['Trang phục',hasReference],['Vùng chỉnh sửa',hasMask||autoMask],['Model',hasModel]];
  const next=requirements.find((item)=>!item[1]),ready=!next;
  const toolGuides={add:'Tô lên vùng cần chỉnh sửa trên ảnh.',erase:'Tô để loại khỏi vùng chỉnh sửa.',protect:'Đánh dấu vùng cần giữ nguyên.',ai:'Nhấp vào vật thể để AI tạo mask.',person:'Chọn nhân vật cần chỉnh sửa trên ảnh.'};
  const guide=studioMode==='character'?$('characterStatus').textContent:studioMode==='makeup'?$('makeupStatus').textContent:studioMode==='enhance'?$('enhanceStatus').textContent:studioMode==='outpaint'?$('outpaintGeometryHint').textContent:ready?(studioMode==='chroma'?'Mô tả và model đã sẵn sàng.':'Ảnh, vùng chỉnh sửa và model đã sẵn sàng.'):next[0]==='Mô tả'?(studioMode==='tryon'?'Mô tả trang phục hoặc phụ kiện mới.':(window.NewImage?.promptReady()===false?'Mô tả vượt giới hạn model. Xem phần kiểm tra và chỉnh nội dung.':'Nhập nội dung ảnh bạn muốn tạo.')):next[0]==='Ảnh'?'Chọn ảnh nguồn để bắt đầu.':next[0]==='Trang phục'?'Thêm ảnh trang phục tham chiếu.':next[0]==='Model'?'Chọn hoặc tải model phù hợp.':toolGuides[tool]||toolGuides.add;
  status.classList.toggle('is-ready',ready);status.innerHTML=`<div><span class="studio-ready-dot"></span><div><strong>${ready?'Sẵn sàng tạo kết quả':`Cần thêm: ${next[0]}`}</strong><small class="studio-requirements">${requirements.map(([label,done])=>`${done?'✓':'○'} ${label}`).join(' · ')}</small><small class="studio-guide">${guide}</small></div></div><button id="studioNextAction">${ready?'Đi đến nút tạo':next[0]==='Ảnh'?'Chọn ảnh':next[0]==='Trang phục'?'Thêm trang phục':next[0]==='Mô tả'?'Nhập mô tả':studioMode==='character'?'Thiết lập nhân vật':'Chọn vùng'}</button>`;
  $('studioNextAction').textContent=!ready&&next[0]==='Model'?'Quản lý model':$('studioNextAction').textContent;
  $('studioNextAction').addEventListener('click',()=>{if(ready){revealStudioCreateAction();}else if(studioMode==='character'&&next[0]!=='Ảnh'){window.Character.focus();}else if(studioMode==='makeup'&&next[0]!=='Ảnh'){window.Makeup.focus();}else if(next[0]==='Hai phía viền'){window.ImageEnhancement.pickMissingPoint();}else if(next[0]==='Model')openModelManager();else if(next[0]==='Mô tả'){tryonPromptField().scrollIntoView({behavior:'smooth',block:'center'});tryonPromptField().focus();}else if(next[0]==='Khung mở rộng')$('outpaintWidth').focus();else if(next[0]==='Ảnh')$('sourceImageFile').click();else if(next[0]==='Trang phục')$('garmentFile').click();else{setTool('add');$('addTool').scrollIntoView({behavior:'smooth',block:'center'});}});
  const steps=[...document.querySelectorAll('.journey-steps li')];steps.forEach((step,index)=>step.classList.toggle('complete',index===0?hasSource:index===1?(studioMode==='outpaint'?outpaintReady():hasMask):index===2?['inpaint','outpaint'].includes(studioMode)||(studioMode==='tryon'&&isDescriptionTryon()?Boolean($('tryonDescription').value.trim()):hasReference):false));
  const resultReady=Boolean(studioViewingResult||studioSelectedResult||studioPendingResult);
  steps.forEach((step,index)=>{if(index===3){step.querySelector('strong').textContent='Tạo và so sánh';step.querySelector('small').textContent=resultReady?'Xem và chọn kết quả':'Sinh phương án';step.classList.toggle('complete',resultReady);}step.setAttribute('aria-current',step.classList.contains('active')?'step':'false');});
  updateStudioCommandBar({ready,next:next?.[0],hasSource,hasMask,hasReference,hasModel});
  window.StudioWorkspace?.syncJourney();
}
function revealStudioCreateAction(){
  const bar=$('studioCommandBar'),primary=$('studioPrimaryAction');
  if(!bar||!primary)return;
  if(studioCommandCollapseTimer){clearTimeout(studioCommandCollapseTimer);studioCommandCollapseTimer=null;}
  studioCommandManuallyCollapsed=false;
  bar.hidden=false;
  setStudioCommandCollapsed(false);
  bar.scrollIntoView({behavior:'smooth',block:'nearest'});
  primary.focus({preventScroll:true});
}
function setStudioCommandCollapsed(collapsed){
  const bar=$('studioCommandBar'),toggle=$('studioCommandToggle');if(!bar||!toggle)return;
  bar.classList.toggle('is-collapsed',Boolean(collapsed));
  toggle.setAttribute('aria-expanded',String(!collapsed));
  const summary=[$('studioCommandTitle')?.textContent,$('studioCommandHint')?.textContent].filter(Boolean).join(' · ');
  toggle.setAttribute('aria-label',collapsed?`Mở thanh tác vụ · ${summary}`:'Thu gọn thanh tác vụ');
  toggle.title=collapsed?summary:'Thu gọn thanh tác vụ';
}
function scheduleStudioCommandCollapse(delay=5000){
  if(studioCommandCollapseTimer)clearTimeout(studioCommandCollapseTimer);
  studioCommandCollapseTimer=setTimeout(()=>{studioCommandCollapseTimer=null;setStudioCommandCollapsed(true);},delay);
}
function updateStudioCommandVisibility(key,{attention=false,error=false,collapseAfter=0,collapseNow=false}={}){
  const bar=$('studioCommandBar');if(!bar)return;
  bar.classList.toggle('needs-attention',attention);bar.classList.toggle('has-error',error);
  if(key===studioCommandAutoKey)return;
  studioCommandAutoKey=key;
  if(studioCommandCollapseTimer){clearTimeout(studioCommandCollapseTimer);studioCommandCollapseTimer=null;}
  if(error){studioCommandManuallyCollapsed=false;setStudioCommandCollapsed(false);return;}
  if(studioCommandManuallyCollapsed){setStudioCommandCollapsed(true);return;}
  if(attention){setStudioCommandCollapsed(false);return;}
  if(collapseNow){setStudioCommandCollapsed(true);return;}
  setStudioCommandCollapsed(false);if(collapseAfter)scheduleStudioCommandCollapse(collapseAfter);
}
function updateStudioCommandBar(state={}){
  const bar=$('studioCommandBar'),primary=$('studioPrimaryAction'),copy=$('studioCommandTitle'),hint=$('studioCommandHint'),status=bar?.querySelector('.studio-command-state');if(!bar||!primary)return;
  const task=studioMode==='character'?'Tư thế & biểu cảm':studioMode==='makeup'?'Trang điểm AI':studioMode==='enhance'?'Cải thiện ảnh':studioMode==='outpaint'?'Mở rộng ảnh':studioMode==='inpaint'?'Xóa vật thể':studioMode==='chroma'?'Ảnh mới':'Thay trang phục';copy.textContent=task;status.classList.toggle('ready',Boolean(state.ready));
  if(studioMode==='character'&&state.next&&state.next!=='Ảnh'){hint.textContent=$('characterStatus').textContent;primary.disabled=false;primary.dataset.command='character-settings';primary.textContent='Thiết lập nhân vật';return;}
  if(studioMode==='makeup'&&state.next&&state.next!=='Ảnh'){hint.textContent=$('makeupStatus').textContent;primary.disabled=false;primary.dataset.command='makeup-settings';primary.textContent='Thiết lập trang điểm';return;}
  if(studioMode==='enhance'&&state.next==='Hai phía viền'){hint.textContent=$('edgePointsStatus').textContent;primary.disabled=false;primary.dataset.command='edge-guides';primary.textContent='Chọn điểm còn thiếu';return;}
  if(studioMode==='enhance'&&['Dịch vụ','Kích thước','Model'].includes(state.next)){hint.textContent=$('enhanceStatus').textContent;primary.disabled=false;primary.dataset.command='enhance-settings';primary.textContent='Xem thiết lập cải thiện';return;}
  const missing=state.next?`Cần thêm ${state.next.toLowerCase()}`:'Sẵn sàng tạo kết quả';hint.textContent=`${missing} · Tự động lưu trên máy`;
  primary.classList.remove('danger');primary.disabled=false;
  primary.dataset.command=state.ready?'run':state.next==='Model'?'models':state.next==='Mô tả'?'prompt':state.next==='Trang phục'?'garment':state.next==='Vùng chỉnh sửa'?'mask':state.next==='Khung mở rộng'?'frame':'source';
  primary.textContent=state.ready?(studioMode==='enhance'?'Cải thiện ảnh':studioMode==='chroma'?'Tạo ảnh':'Tạo kết quả'):state.next==='Model'?'Quản lý model':state.next==='Mô tả'?'Nhập mô tả':state.next==='Trang phục'?'Thêm trang phục':state.next==='Vùng chỉnh sửa'?'Chọn vùng':state.next==='Khung mở rộng'?'Chỉnh khung':'Chọn ảnh';
  bar.classList.toggle('is-complete',Boolean(state.ready));bar.classList.remove('is-running');bar.style.setProperty('--command-progress',state.ready?'100%':'0%');
  updateStudioCommandVisibility(state.ready?'ready':`missing:${state.next||'input'}`,{attention:!state.ready,collapseAfter:0});
}
function setExperienceMode(mode){
  const next=mode==='expert'?'expert':'simple';document.body.dataset.experience=next;localStorage.setItem('studioExperience',next);
  window.AtelierStore?.set({experience:next});
  $('simpleExperienceButton').classList.toggle('active',next==='simple');$('expertExperienceButton').classList.toggle('active',next==='expert');
  $('simpleExperienceButton').setAttribute('aria-pressed',String(next==='simple'));$('expertExperienceButton').setAttribute('aria-pressed',String(next==='expert'));
  $('experienceHint').textContent=next==='simple'?'Chỉ hiển thị những lựa chọn cần thiết để tạo kết quả.':'Hiển thị model, seed, LoRA, pipeline và các thông số kiểm định.';
}
function setStudioMode(mode){
  const nextMode=['inpaint','tryon','chroma','outpaint','enhance','makeup','character'].includes(mode)?mode:'tryon';
  if(nextMode!=='chroma')switchTaskMask(nextMode);
  studioMode=nextMode;localStorage.setItem('studioMode',studioMode);document.body.dataset.studioTask=studioMode;
  window.AtelierStore?.set({task:studioMode});
  const secondStep=document.querySelector('.journey-steps li:nth-child(2)'),thirdStep=document.querySelector('.journey-steps li:nth-child(3)');
  if(secondStep){secondStep.dataset.stepTarget='addTool';secondStep.querySelector('strong').textContent='Chọn vùng';secondStep.querySelector('small').textContent='Vẽ hoặc dùng AI';}
  if(thirdStep)thirdStep.dataset.stepTarget='garmentFile';
  const inpaint=$('studioInpaintPanel'),tryon=$('studioTryonPanel'),chroma=$('chromaGeneratorPanel'),stage=$('studioChromaStage');if(!inpaint||!tryon||!chroma)return;
  $('studioCharacterPanel').hidden=studioMode!=='character';
  $('studioMakeupPanel').hidden=studioMode!=='makeup';
  $('studioEnhancePanel').hidden=studioMode!=='enhance';
  $('studioOutpaintPanel').hidden=studioMode!=='outpaint';
  inpaint.hidden=studioMode!=='inpaint';tryon.hidden=studioMode!=='tryon';chroma.hidden=studioMode!=='chroma';if(stage)stage.hidden=studioMode!=='chroma';inpaint.open=true;tryon.open=true;chroma.open=true;
  $('editorCanvas').hidden=['chroma','outpaint'].includes(studioMode)||!sourceImage;$('emptyCanvasState').hidden=studioMode==='chroma'||Boolean(sourceImage);$('loading').hidden=studioMode==='chroma'||$('loading').hidden;
  for(const button of document.querySelectorAll('[data-studio-mode]'))button.classList.toggle('active',button.dataset.studioMode===studioMode);
  const title=$('studioModeTitle'),hint=$('studioModeHint'),heading=document.querySelector('.panel-heading h2'),journeyTitle=document.querySelector('.journey-heading h2'),toolbarHint=document.querySelector('.canvas-toolbar>span:last-child');if(title)title.textContent=studioMode==='character'?'Tư thế & biểu cảm':studioMode==='makeup'?'Trang điểm AI':studioMode==='enhance'?'Cải thiện ảnh':studioMode==='outpaint'?'Mở rộng ảnh':studioMode==='inpaint'?'Xóa vật thể':studioMode==='chroma'?'Ảnh mới':'Thay trang phục';if(hint)hint.textContent=studioMode==='character'?'Đổi biểu cảm, tư thế hoặc tương tác; xem vùng tác động trước khi tạo.':studioMode==='makeup'?'Chọn khuôn mặt, phong cách hoặc mô tả riêng rồi so sánh.':studioMode==='enhance'?'Chọn cách cải thiện và xem thử trước khi xử lý toàn ảnh.':studioMode==='outpaint'?'Chọn khung lớn hơn và kéo ảnh để đặt bố cục.':studioMode==='inpaint'?'Tô vùng cần xóa rồi tạo phương án tái tạo.':studioMode==='chroma'?'Nhập mô tả và tạo các phương án mới.':'Thêm ảnh trang phục tham chiếu rồi chọn chất lượng.';if(heading)heading.textContent=studioMode==='chroma'?'Tạo ảnh mới':'Chỉnh sửa ảnh';if(journeyTitle)journeyTitle.textContent=studioMode==='chroma'?'Ảnh mới':'Vùng chỉnh sửa';if(toolbarHint)toolbarHint.textContent=studioMode==='character'?'Xanh: vùng bảo vệ · Xem trước vùng tác động trong Thiết lập':studioMode==='makeup'?'Đỏ: vùng trang điểm · Xanh: chi tiết cần giữ':studioMode==='enhance'?'Xanh: vùng bảo vệ · Chọn phạm vi tại bảng Thiết lập':studioMode==='chroma'?'Kết quả được lưu tự động trên máy':'Đỏ: vùng sẽ chỉnh · Ngoài vùng: được bảo vệ';
  $('imageInfo').textContent=studioMode==='chroma'?'Ảnh mới từ mô tả':current?`${current.id} · ${sourceImage?.naturalWidth||0} × ${sourceImage?.naturalHeight||0}`:'—';$('deselectImageButton').hidden=studioMode==='chroma';$('saveFullSizeImageButton').hidden=studioMode==='chroma';
  const third=document.querySelector('.journey-steps li:nth-child(3)');if(third){third.querySelector('strong').textContent=studioMode==='inpaint'?'Vùng chỉnh sửa':'Trang phục';third.querySelector('small').textContent=studioMode==='inpaint'?'Không cần ảnh tham chiếu':'Thêm ảnh tham chiếu';}
  refreshOutpaintPreview();
  if(studioMode==='tryon')updateTryonInputMode();
  refreshStudioReadiness();
}
function restoreModelSortPreferences(){for(const [id,key] of [['modelInventorySort','modelInventorySort'],['modelCapabilitySort','modelCapabilitySort'],['registeredModelSort','registeredModelSort']]){const select=$(id),saved=localStorage.getItem(key);if(select&&saved&&[...select.options].some((option)=>option.value===saved))select.value=saved;}}
function setupExperience() {
  setupOutpainting();
  window.ImageEnhancement.setup();
  window.Makeup.setup();
  window.Character.setup();
  setupOutfitWorkflow();
  const offlineModelPanel=$('offlineModelPanel'),modelManagerContent=$('modelManagerContent');
  if(offlineModelPanel&&modelManagerContent)modelManagerContent.appendChild(offlineModelPanel);
  const chromaPanel=$('chromaGeneratorPanel'),chromaShell=document.querySelector('.chroma-gallery-shell'),canvasWrap=$('canvasWrap');if(chromaShell&&canvasWrap){chromaShell.id='studioChromaStage';chromaShell.classList.add('studio-chroma-stage');canvasWrap.appendChild(chromaShell);chromaShell.hidden=true;}
  const journey=$('journeyContent');
  const chromaJourney=document.createElement('section');chromaJourney.className='chroma-journey';chromaJourney.innerHTML=`<p class="eyebrow">BẮT ĐẦU NHANH</p><h3>Ý tưởng ảnh mới</h3><p>Chọn gợi ý hoặc viết mô tả riêng trong bảng Thiết lập.</p><div class="chroma-prompt-presets"><button type="button" data-chroma-prompt="${escapeHtml(window.ATELIER_PROMPTS.ui.quickIdea1)}">Ảnh sản phẩm</button><button type="button" data-chroma-prompt="${escapeHtml(window.ATELIER_PROMPTS.ui.quickIdea2)}">Chân dung thời trang</button><button type="button" data-chroma-prompt="${escapeHtml(window.ATELIER_PROMPTS.ui.quickIdea3)}">Chiến dịch tối giản</button></div><div class="chroma-size-shortcuts"><span>Tỷ lệ nhanh</span><button type="button" data-new-image-ratio="1:1">1:1</button><button type="button" data-new-image-ratio="4:5">4:5</button><button type="button" data-new-image-ratio="16:9">16:9</button><button type="button" data-chroma-library>Xem ảnh gần đây</button></div>`;
  journey.appendChild(chromaJourney);for(const button of chromaJourney.querySelectorAll('[data-chroma-prompt]'))button.addEventListener('click',()=>{$('chromaPrompt').value=button.dataset.chromaPrompt;$('chromaPrompt').dispatchEvent(new Event('input'));$('chromaPrompt').focus();});for(const button of chromaJourney.querySelectorAll('[data-chroma-size]'))button.addEventListener('click',()=>{$('chromaSize').value=button.dataset.chromaSize;$('chromaSize').dispatchEvent(new Event('change'));});chromaJourney.querySelector('[data-chroma-library]').addEventListener('click',()=>activateAppView('library'));
  const moveIds=['sourceImageFile','imageSelect','labelSelect','addTool','brushSize','overlayOpacity','notes','saveButton'];
  const moved=new Set();
  for(const id of moveIds){const node=$(id);if(!node)continue;let block=node.closest('label,.tool-group,.button-row')||node;if(block.classList.contains('button-row')&&id==='addTool')block=node.closest('.tool-group');if(block&&!moved.has(block)){journey.appendChild(block);moved.add(block);}}
  const aiActions=$('aiActions');if(aiActions)journey.appendChild(aiActions);
  const undo=$('undoButton')?.closest('.button-row');if(undo)journey.appendChild(undo);
  const saveMask=$('saveButton');
  if(saveMask&&aiActions&&undo){
    const maskActions=document.createElement('section');maskActions.className='mask-action-card';maskActions.innerHTML='<div class="mask-action-heading"><span aria-hidden="true">◩</span><div><strong>Hành động mask</strong><small>Lưu hoặc điều chỉnh vùng đã chọn.</small></div></div>';
    saveMask.before(maskActions);maskActions.append(saveMask,aiActions,undo);
  }
  const tryon=$('studioTryonPanel');
  const inpaint=$('studioInpaintPanel');
  if(chromaPanel&&tryon){chromaPanel.classList.add('studio-task-panel');tryon.after(chromaPanel);chromaPanel.open=true;chromaPanel.hidden=true;}
  if(tryon&&inpaint){
    const switcher=document.createElement('section');switcher.className='studio-mode-card';switcher.innerHTML='<div><p class="eyebrow">TÁC VỤ</p><h3 id="studioModeTitle">Thay trang phục</h3><p id="studioModeHint">Thêm ảnh trang phục tham chiếu rồi chọn chất lượng.</p></div><div class="studio-mode-switch"><button data-studio-mode="chroma">Tạo ảnh</button><button data-studio-mode="outpaint">Mở rộng</button><button data-studio-mode="inpaint">Vật thể</button><button data-studio-mode="tryon">Trang phục</button><button data-studio-mode="enhance">Cải thiện</button><button data-studio-mode="makeup">Trang điểm</button><button data-studio-mode="character">Tư thế &amp; biểu cảm</button></div>';
    const readiness=document.createElement('section');readiness.id='studioReadiness';readiness.className='studio-readiness';
    inpaint.before(switcher,readiness);readiness.after($('studioOutpaintPanel'),$('studioEnhancePanel'));for(const button of switcher.querySelectorAll('[data-studio-mode]'))button.addEventListener('click',()=>setStudioMode(button.dataset.studioMode));
  }
  if(tryon){
    tryon.open=true;
    const quick=document.createElement('div');quick.className='quick-quality';quick.innerHTML='<label>Chế độ chất lượng<select id="qualityPreset"><option value="fast">Nhanh</option><option value="balanced">Cân bằng</option><option value="quality" selected>Chất lượng cao nhất</option></select><small>Điều chỉnh tốc độ và số phương án bằng một lựa chọn.</small></label>';
    $('garmentCategory').closest('label').after(quick);
    const advanced=document.createElement('details');advanced.className='inpaint-panel advanced-panel';advanced.innerHTML='<summary>Thiết lập nâng cao</summary>';
    const advancedIds=['tryonSeed','tryonCount','tryonSteps','tryonGuidance','autoMaskToggle','cropPersonToggle','confidenceThreshold','onlyConfidentToggle','twoStageToggle','minimumQuality','minimumSimilarity','minimumSeam','minimumAnatomy','maxRetries','repairSeamsToggle','generativeRefineToggle','refineRegion','onlyQualityToggle','batchScope'];
    const advancedBlocks=[];
    for(const id of advancedIds){const node=$(id);const block=node?.closest('label,.compact-grid');if(block&&!advancedBlocks.includes(block))advancedBlocks.push(block);}
    tryon.appendChild(advanced);for(const block of advancedBlocks)advanced.appendChild(block);
    const operations=$('operationalCommandHost');
    const operationIds=['auditButton','reviewFilter','exportApprovedButton','calibrateButton','goldenButton','compareBaselineButton','jobsButton','jobRetentionDays','cleanupJobsButton','benchmarkButton','dashboardButton','reviewBenchmarkButton','reviewReadinessButton','runRetryQueueButton','retryComparisonsButton','calibrateWeightsButton','compareWeightsButton','activateWeightsButton','confirmDefaultWeightsButton','acceptanceButton','systemCheckButton','backupButton','backupSelect','restoreBackupButton'];
    const operationBlocks=[];for(const id of operationIds){const node=$(id);const block=node?.closest('label,.compact-grid')||node;if(block&&!operationBlocks.includes(block))operationBlocks.push(block);}
    if(operations)for(const block of operationBlocks)operations.appendChild(block);
    $('qualityPreset').addEventListener('change',(event)=>{const presets=window.ATELIER_PROMPTS.runtimePresets.tryonQuality;const preset=presets[event.target.value];$('tryonCount').value=preset.count;$('tryonSteps').value=preset.steps;$('twoStageToggle').checked=preset.twoStage;if(isDescriptionTryon())applyDescriptionQualityPreset(event.target.value);setMessage(`Đã chọn chế độ ${event.target.selectedOptions[0].text.toLowerCase()}.`,'success');});
  }
  // Keep the same order in both task panels: model, task inputs, common settings, advanced, run.
  if(inpaint){
    const quick=document.createElement('div');quick.className='quick-quality';quick.innerHTML='<label>Mục tiêu chất lượng<select id="inpaintQualityPreset"><option value="fast">Nhanh</option><option value="balanced">Cân bằng</option><option value="detail" selected>Chất lượng cao nhất</option></select><small>Áp dụng số bước, độ phân giải và thông số phù hợp với model.</small></label>';
    $('inpaintModelSelect').closest('label').after(quick);$('inpaintQualityPreset').addEventListener('change',(event)=>{applyInpaintModelSettings(true);setMessage(`Đã chọn chế độ ${event.target.selectedOptions[0].text.toLowerCase()} theo model hiện tại.`,'success');});
    const grid=$('inpaintSeed').closest('.compact-grid'),advanced=document.createElement('details');
    advanced.className='advanced-panel';advanced.innerHTML='<summary>Thiết lập nâng cao</summary><div class="compact-grid"></div>';
    grid.after(advanced);
    advanced.after($('studioLoraPanel'));
    for(const id of ['maskExpand','maskBlur','inpaintSteps','inpaintStrength','inpaintGuidance','cropPadding','inpaintResolution'])advanced.querySelector('.compact-grid').appendChild($(id).closest('label'));
  }
  if(tryon){
    const referenceAdvanced=document.createElement('details');referenceAdvanced.className='advanced-panel';referenceAdvanced.innerHTML='<summary>Quản lý ảnh tham chiếu và kiểm định</summary>';
    $('garmentPreview').after(referenceAdvanced);
    for(const id of ['saveReferenceButton','refreshReferenceReadinessButton','qualifyReferenceButton','referenceReadiness'])referenceAdvanced.appendChild($(id));
    const basic=document.createElement('div');basic.className='compact-grid';$('qualityPreset').closest('.quick-quality').after(basic);
    for(const id of ['tryonSeed','tryonCount'])basic.appendChild($(id).closest('label'));
    const peopleAdvanced=document.createElement('details');peopleAdvanced.className='advanced-panel';peopleAdvanced.innerHTML='<summary>Nhân vật và vùng chỉnh sửa</summary>';
    $('garmentCategory').closest('label').after(peopleAdvanced);
    for(const id of ['personSelect','detectPeopleButton','usePoseToggle'])peopleAdvanced.appendChild($(id).closest('label')||$(id));
    loadTryonModelOptions().catch((error)=>{$('tryonModelHint').textContent=error.message;refreshStudioReadiness();});
  }
  $('tryonModelSelect')?.addEventListener('change',refreshStudioReadiness);
  $('textToImageModel')?.addEventListener('change',refreshStudioReadiness);$('chromaPrompt')?.addEventListener('input',refreshStudioReadiness);
  $('autoMaskToggle')?.addEventListener('change',refreshStudioReadiness);applyManagedPromptDefaults();setStudioMode(localStorage.getItem('studioMode')||'tryon');
  for(const node of document.querySelectorAll('.advanced-panel,.lora-panel'))node.classList.add('expert-only');
  for(const id of ['batchTryonButton','cancelJobButton','resumeJobButton','tryonSeed','tryonCount','inpaintSeed','inpaintCount'])$(id)?.closest('label,button')?.classList.add('expert-only');
  $('simpleExperienceButton')?.addEventListener('click',()=>setExperienceMode('simple'));$('expertExperienceButton')?.addEventListener('click',()=>setExperienceMode('expert'));setExperienceMode(localStorage.getItem('studioExperience')||'simple');
  $('studioPrimaryAction')?.addEventListener('click',()=>{const command=$('studioPrimaryAction').dataset.command;if(command==='run'){if(activeJobId)return setMessage('Một tác vụ đang chạy; hãy đợi hoàn tất hoặc hủy tác vụ hiện tại.','error');(studioMode==='character'?()=>window.Character.run():studioMode==='makeup'?()=>window.Makeup.run():studioMode==='enhance'?()=>window.ImageEnhancement.run():studioMode==='outpaint'?runOutpaint:studioMode==='inpaint'?runInpaint:studioMode==='chroma'?runChromaGenerate:runTryon)();}else if(command==='cancel')cancelActiveJob().catch((error)=>setMessage(error.message,'error'));else if(command==='results'){showGenerationResult(activityState);}else if(command==='edge-guides'){window.ImageEnhancement.pickMissingPoint();}else if(command==='character-settings'){window.Character.focus();}else if(command==='makeup-settings'){window.Makeup.focus();}else if(command==='enhance-settings'){$('studioEnhancePanel').scrollIntoView({block:'center'});$('enhanceRefresh').focus();}else if(command==='models')openModelManager();else if(command==='prompt'){tryonPromptField().scrollIntoView({behavior:'smooth',block:'center'});tryonPromptField().focus();}else if(command==='garment')$('garmentFile').click();else if(command==='frame'){$('outpaintWidth').focus();}else if(command==='mask'){setTool('add');$('addTool').focus();}else $('sourceImageFile').click();});
  $('studioCommandToggle')?.addEventListener('click',()=>{if(studioCommandCollapseTimer){clearTimeout(studioCommandCollapseTimer);studioCommandCollapseTimer=null;}const collapse=!$('studioCommandBar').classList.contains('is-collapsed');studioCommandManuallyCollapsed=collapse;setStudioCommandCollapsed(collapse);});
  document.querySelector('.brand')?.addEventListener('click',(event)=>{event.preventDefault();activateAppView('create');});
  for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>activateAppView(button.dataset.view));
    $('hubView').addEventListener('click',(event)=>{if(event.target.closest('[data-clear-browser-data]')){
      const status=$('hubView').querySelector('[data-browser-data-status]');
      if(activeJobId&&!['completed','failed','cancelled','restart-required'].includes(activityState?.status)){status.textContent='Hãy đợi tác vụ đang chạy kết thúc trước khi xóa dữ liệu trình duyệt.';return;}
      if(!window.confirm('Xóa dữ liệu AI Atelier trong trình duyệt này? Prompt cục bộ và tùy chỉnh sẽ được đặt lại. Ảnh, model, kết quả và dữ liệu lưu trên ổ đĩa được giữ nguyên. Trang sẽ tải lại.'))return;
      try{if(jobPollTimer)clearInterval(jobPollTimer);jobEventSource?.close();window.AtelierBrowserData.clear();window.location.reload();}catch(error){status.textContent='Không thể xóa dữ liệu: '+error.message;}
      return;
    }const returnButton=event.target.closest('[data-view-return]');if(returnButton){activateAppView('create');return;}const settingsView=event.target.closest('[data-settings-view]');if(settingsView){activateAppView(settingsView.dataset.settingsView);return;}if(event.target.closest('[data-open-model-manager]')){openModelManager();return;}const proxy=event.target.closest('[data-trigger]');if(proxy){const target=$(proxy.dataset.trigger);if(!target){setMessage('Chức năng này chưa được kết nối.', 'error');return;}if(target.disabled){activateAppView('create');target.scrollIntoView({behavior:'smooth',block:'center'});setMessage(target.title||'Chức năng chưa sẵn sàng; hãy hoàn tất dữ liệu đầu vào trước.', 'error');return;}target.click();}});
  for(const step of document.querySelectorAll('.journey-steps li')){const activateStep=()=>{for(const item of document.querySelectorAll('.journey-steps li'))item.classList.remove('active');step.classList.add('active');const target=$(step.dataset.stepTarget);if(target){activateAppView('create');target.scrollIntoView({behavior:'smooth',block:'center'});target.focus({preventScroll:true});}};step.addEventListener('click',activateStep);step.addEventListener('keydown',(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activateStep();}});}
  $('helpButton').addEventListener('click',()=>$('helpDialog').showModal());
  $('headerModelButton')?.addEventListener('click',()=>openModelManager());
  $('closeHelp').addEventListener('click',()=>$('helpDialog').close());
    $('closeModelManager').addEventListener('click',()=>$('modelManagerDialog').close());
    for(const button of document.querySelectorAll('[data-model-tab]'))button.addEventListener('click',()=>setModelManagerTab(button.dataset.modelTab));
    $('registeredModelSearch')?.addEventListener('input',renderRegisteredModels);
    $('registeredModelStatus')?.addEventListener('change',renderRegisteredModels);
}

for(const id of ['inpaintSeed','tryonSeed','chromaSeed'])setupSeedControl(id);
setupExperience();
window.StudioGuidance?.init();
window.StudioWorkspace?.setup();
window.StudioWorkspace?.applyQualityDefaults();
updateTryonInputMode();
setupStudioResultInstructions();
restoreModelSortPreferences();
startModelSelectorStartupScan();
init();



Object.assign(STAGE_LABELS,{'makeup-detecting':'Nhận diện khuôn mặt','makeup-processing':'Trang điểm khuôn mặt','makeup-saving':'Kiểm tra vùng bảo vệ và lưu ảnh'});

Object.assign(STAGE_LABELS,{'makeup-comparing':'So sánh các phong cách trang điểm'});

Object.assign(STAGE_LABELS,{'character-validating':'Kiểm tra nhân vật và vùng tác động','character-loading':'Nạp bộ xử lý nhân vật','character-processing':'Tạo tư thế và biểu cảm','character-checking':'Đối chiếu tư thế đích','character-saving':'Lưu phương án'});
