'use strict';
// Owned state: studioCommandCollapseTimer, studioCommandAutoKey, studioCommandManuallyCollapsed, HUBS, studioMode, studioTaskMasks
// Dependencies: $, activeJobId, activityState, aiPoints, applyManagedPromptDefaults, cancelActiveJob, current, currentAppView, drawing, editableMaskStats, escapeHtml, fitCanvas, garmentDataUrl, history, jobEventSource, jobPollTimer, jobsRefreshTimer, lastPoint, loadChromaStatus, loadImage, loadModelCapabilities, loadModels, loadQualityOverview, loadReviewOverview, loadStudioResultInstructions, loadSystemOverview, manualProtectCanvas, manualProtectCtx, maskCanvas, maskCtx, openImageAtFullSize, openModelManager, protectCanvas, protectCtx, render, renderPromptManager, renderRegisteredModels, runChromaGenerate, runInpaint, runTryon, setMessage, setModelManagerTab, setTool, showGenerationResult, sourceImage, startJobsLiveUpdates, studioPendingResult, studioSelectedResult, studioViewingResult, tool, updateProgressVisibility
module.exports=function createNavigation(deps){
let studioCommandCollapseTimer, studioCommandAutoKey, studioCommandManuallyCollapsed, HUBS, studioMode, studioTaskMasks;
async function restartAtelierWeb(event) {
  const button=event.currentTarget,status=button.parentElement.querySelector('[data-restart-status]');
  if(deps.activeJobId){status.textContent='Hãy đợi tác vụ hiện tại kết thúc.';return;}
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
  const retainedModelContent=deps.$('modelManagerContent');if(retainedModelContent&&deps.$('hubView').contains(retainedModelContent))deps.$('modelManagerDialog').appendChild(retainedModelContent);
  const libraryContent=`<section class="library-overview"><div class="library-toolbar"><input id="librarySearch" type="search" placeholder="${deps.escapeHtml(window.ATELIER_PROMPTS.uiPlaceholders.librarySearch)}" aria-label="Tìm trong thư viện"><button id="libraryRestoreRemoved" type="button" hidden>Khôi phục mục đã xóa</button><small id="libraryCount">Đang tải…</small></div><div class="library-filters" role="group" aria-label="Lọc thư viện"><button class="active" data-library-filter="all">Tất cả</button><button data-library-filter="user">Ảnh nguồn</button><button data-library-filter="result">Kết quả</button><button data-library-filter="reference">Tham chiếu</button><button data-library-filter="sample">Ảnh mẫu</button><button data-library-filter="recent">Gần đây</button></div><div id="libraryBulkBar" class="library-bulk-bar" hidden><strong id="librarySelectedCount">0 ảnh đã chọn</strong><button id="libraryOpenSelected">Mở mục đầu tiên</button><button id="libraryClearSelected">Bỏ chọn</button><button id="libraryRemoveSelected" class="danger">Xóa khỏi thư viện</button></div><div id="libraryGrid" class="library-grid"></div></section>`;
  const settingsContent=`<div id="systemOverview" class="system-overview"><div class="system-skeleton">Đang kiểm tra hệ thống…</div></div>
    <section class="settings-section" aria-labelledby="settingsToolsTitle">
      <div class="settings-section-heading"><div><span class="card-kicker">QUẢN TRỊ</span><h2 id="settingsToolsTitle">Công cụ và dữ liệu</h2><p>Các thiết lập ít dùng được gom tại đây để khu vực vận hành luôn dễ kiểm tra.</p></div></div>
      <div class="settings-dashboard">
        <article class="settings-card settings-service-card" data-services-panel></article>
        <article class="settings-card"><div class="settings-card-heading"><span class="settings-card-icon" aria-hidden="true">◫</span><div><span class="card-kicker">MODEL & PROMPT</span><h3>Tài nguyên tạo ảnh</h3></div></div><p>Kiểm tra model cục bộ và quản lý mô tả mặc định cho từng tác vụ.</p><div class="settings-card-actions"><button data-open-model-manager>Quản lý model</button></div></article>
        <article class="settings-card"><div class="settings-card-heading"><span class="settings-card-icon" aria-hidden="true">✓</span><div><span class="card-kicker">CHẤT LƯỢNG</span><h3>Kiểm tra kết quả</h3></div></div><p>Duyệt ảnh theo tác vụ hoặc xem các chỉ số kỹ thuật và xu hướng chất lượng.</p><div class="settings-card-actions"><button data-settings-view="review">Mở bộ nghiệm thu</button><button data-settings-view="reports">Xem chỉ số</button></div></article>
        <article class="settings-card settings-danger-card"><div class="settings-card-heading"><span class="settings-card-icon" aria-hidden="true">⌫</span><div><span class="card-kicker">DỮ LIỆU TRÌNH DUYỆT</span><h3>Xóa tùy chỉnh trên trình duyệt</h3></div></div><p>Đặt lại prompt, ảnh đang chọn, model và giao diện. Ảnh, model và kết quả trên máy vẫn được giữ.</p><div class="settings-card-actions"><button class="danger" data-clear-browser-data>Xóa dữ liệu trình duyệt…</button></div><small data-browser-data-status role="status"></small></article>
      </div>
    </section>`;
  const modelContent='<section id="modelPageHost" class="model-manager-page"><div class="system-skeleton">Đang tải thư viện model…</div></section>';
  const promptContent='<section id="promptManager" class="prompt-manager"></section>';
  deps.$('hubView').innerHTML=`<div class="hub-header"><div><p class="eyebrow">${hub.eyebrow}</p><h1>${hub.title}</h1><p>${hub.description}</p></div><button data-view-return>← Trở lại Studio</button></div>${name==='library'?libraryContent:name==='settings'?settingsContent:name==='model'?modelContent:name==='prompts'?promptContent:name==='reports'?'<div id="qualityOverview" class="quality-overview"><div class="system-skeleton">Đang tổng hợp dữ liệu chất lượng…</div></div>':name==='jobs'?'<div id="jobsOverview" class="jobs-overview"><div class="system-skeleton">Đang tải hàng tác vụ…</div></div>':name==='review'?'<div id="reviewOverview" class="review-overview"><div class="system-skeleton">Đang tải hàng duyệt…</div></div>':`<div class="hub-grid">${hub.cards.map(([kicker,title,description,target,featured])=>`<article class="hub-card ${featured?'featured':''}"><span class="card-kicker">${kicker}</span><h3>${title}</h3><p>${description}</p><button data-trigger="${target}">${title}</button></article>`).join('')}</div>`}`;
  deps.$('hubView').hidden=false;
  if(name==='library')window.AtelierLibrary.mount(deps.$('hubView').querySelector('.library-overview'),{preview:item=>deps.openImageAtFullSize(item.url,item.name),open:async item=>{activateAppView('create');await deps.loadImage(item);}});
  if(name==='settings'){
    const jsonConfigButton=document.createElement('button');jsonConfigButton.type='button';jsonConfigButton.className='json-editor-open expert-only';jsonConfigButton.dataset.jsonConfigOpen='prompts';jsonConfigButton.textContent='Quản lý và chỉnh sửa tất cả JSON cấu hình';deps.$('hubView').querySelector('.settings-dashboard').before(jsonConfigButton);
    globalThis.QualityLearning?.mountSettings(deps.$('hubView'));
    const promptLink=document.createElement('button');promptLink.textContent='Quản lý prompt';promptLink.onclick=()=>activateAppView('prompts');deps.$('hubView').querySelector('[data-open-model-manager]').parentElement.append(promptLink);
    deps.loadSystemOverview();
    window.ServiceManagerUI?.mount(deps.$('hubView').querySelector('[data-services-panel]'),restartAtelierWeb);
  }
  if(name==='reports')deps.loadQualityOverview();
  if(name==='jobs')deps.startJobsLiveUpdates();
  if(name==='review')deps.loadReviewOverview();
  if(name==='prompts')deps.renderPromptManager();
  if(name==='model'){
    const host=deps.$('modelPageHost'),content=deps.$('modelManagerContent'),panel=deps.$('offlineModelPanel');if(host&&content){host.innerHTML='';host.appendChild(content);if(panel&&panel.parentElement!==content)content.appendChild(panel);if(panel)panel.open=true;deps.setModelManagerTab(localStorage.getItem('modelManagerTab')||'capabilities');Promise.all([deps.loadModels(),deps.loadModelCapabilities(),deps.loadChromaStatus()]).catch((error)=>deps.setMessage(error.message,'error'));}
  }
}

function activateAppView(name) {
  if(name==='chroma'){name='create';setStudioMode('chroma');}
  deps.currentAppView=name;
  window.AtelierStore?.set({view:name});
  window.SharedRegions?.setStudioVisible(name==='create');
  const studioCommandBar=deps.$('studioCommandBar');
  if(studioCommandBar)studioCommandBar.hidden=name!=='create';
  requestAnimationFrame(deps.updateProgressVisibility);
    if(name!=='jobs'){clearInterval(deps.jobsRefreshTimer);deps.jobsRefreshTimer=null;}
  for(const item of document.querySelectorAll('[data-view]')){const active=item.dataset.view===name;item.classList.toggle('active',active);if(item.matches('.nav-item'))active?item.setAttribute('aria-current','page'):item.removeAttribute('aria-current');}
  deps.$('chromaView').hidden=true;
  if(name==='create'){deps.$('hubView').hidden=true;deps.loadStudioResultInstructions();requestAnimationFrame(deps.fitCanvas);return;}
  renderHub(name);
}

function switchTaskMask(next){
  if(next===studioMode||!deps.current||!deps.sourceImage||!deps.maskCanvas.width||!deps.maskCanvas.height)return;
  studioTaskMasks[studioMode]={imageId:deps.current.id,width:deps.maskCanvas.width,height:deps.maskCanvas.height,editable:deps.maskCtx.getImageData(0,0,deps.maskCanvas.width,deps.maskCanvas.height),protected:deps.protectCtx.getImageData(0,0,deps.protectCanvas.width,deps.protectCanvas.height),points:deps.aiPoints.map((point)=>({...point})),history:[...deps.history],notes:deps.$('notes').value,label:deps.$('labelSelect').value};
  const saved=studioTaskMasks[next];
  studioTaskMasks[studioMode].manualProtected=deps.manualProtectCtx.getImageData(0,0,deps.manualProtectCanvas.width,deps.manualProtectCanvas.height);
  deps.manualProtectCtx.clearRect(0,0,deps.manualProtectCanvas.width,deps.manualProtectCanvas.height);
  if(saved?.imageId===deps.current.id&&saved.width===deps.maskCanvas.width&&saved.height===deps.maskCanvas.height&&saved.manualProtected)deps.manualProtectCtx.putImageData(saved.manualProtected,0,0);
  deps.maskCtx.clearRect(0,0,deps.maskCanvas.width,deps.maskCanvas.height);deps.protectCtx.clearRect(0,0,deps.protectCanvas.width,deps.protectCanvas.height);
  deps.aiPoints=[];deps.history=[];deps.drawing=false;deps.lastPoint=null;
  if(saved&&saved.imageId===deps.current.id&&saved.width===deps.maskCanvas.width&&saved.height===deps.maskCanvas.height){deps.maskCtx.putImageData(saved.editable,0,0);deps.protectCtx.putImageData(saved.protected,0,0);deps.aiPoints=saved.points;deps.history=saved.history;deps.$('notes').value=saved.notes;deps.$('labelSelect').value=saved.label;}
  else deps.$('notes').value='';
  deps.render();
}

async function loadTryonModelOptions(){
  const response=await fetch('/api/model-capabilities',{cache:'no-store'}),result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra model thay trang phục');
  const feature=result.features.find((item)=>item.id==='virtual-tryon'),models=feature?.models||[];
  const previous=deps.$('tryonModelSelect').value;
  const supported=models.filter((model)=>['catvton','idm-vton'].includes(model.id)&&model.ready&&model.registered&&model.operationalReady!==false);
  const readyOptions=supported.map((model)=>`<option value="${deps.escapeHtml(model.id)}">${deps.escapeHtml(model.name)} · sẵn sàng</option>`).join('');
  const unavailable=models.filter((model)=>!supported.includes(model));
  const pendingOptions=unavailable.map((model)=>`<option value="${deps.escapeHtml(model.id)}" disabled>${deps.escapeHtml(model.name)} · ${!model.registered?'chưa đăng ký':deps.escapeHtml(model.runtimeReason||'chưa sẵn sàng')}</option>`).join('');
  deps.$('tryonModelSelect').innerHTML=(readyOptions?`<optgroup label="Có thể sử dụng">${readyOptions}</optgroup>`:'<option value="">Chưa có model có thể sử dụng</option>')+(pendingOptions?`<optgroup label="Chưa thể sử dụng">${pendingOptions}</optgroup>`:'');
  deps.$('tryonModelSelect').value=supported.find((model)=>model.id===previous)?.id||supported.find((model)=>model.selected)?.id||supported[0]?.id||'';deps.$('tryonModelSelect').disabled=!supported.length;
  deps.$('tryonModelHint').textContent=supported.length?'Dùng ảnh trang phục tham chiếu với model đã chọn. IDM-VTON sử dụng thêm DensePose. Pipeline thay trang phục chưa hỗ trợ LoRA.':'Hoàn thiện model và các phụ thuộc trong Hệ thống.';
  refreshStudioReadiness();
}

function refreshStudioReadiness(){
  const status=deps.$('studioReadiness');if(!status)return;
  if(studioMode==='outpaint')refreshOutpaintPreview();
  const hasSource=Boolean(deps.current&&deps.sourceImage),hasMask=deps.editableMaskStats().selected>0,hasReference=Boolean(deps.garmentDataUrl),autoMask=Boolean(deps.$('autoMaskToggle')?.checked);
  const modelSelect=studioMode==='outpaint'?deps.$('outpaintModel'):studioMode==='inpaint'?deps.$('inpaintModelSelect'):studioMode==='chroma'?deps.$('textToImageModel'):isDescriptionTryon()?deps.$('tryonDescriptionModel'):deps.$('tryonModelSelect'),hasModel=Boolean(modelSelect?.value&&!modelSelect.disabled);
  window.ImageEnhancement?.sync();
  window.Makeup?.sync();
  window.Character?.sync();
  const requirements=['character','body'].includes(studioMode)?window.Character.requirements(hasSource):studioMode==='makeup'?window.Makeup.requirements(hasSource):studioMode==='enhance'?window.ImageEnhancement.requirements(hasSource,hasMask):studioMode==='outpaint'?[['Ảnh',hasSource],['Khung mở rộng',outpaintReady()],['Model',hasModel]]:studioMode==='inpaint'?[['Ảnh',hasSource],['Vùng chỉnh sửa',hasMask],['Model',hasModel]]:studioMode==='chroma'?[['Mô tả',Boolean(deps.$('chromaPrompt')?.value.trim())&&window.NewImage?.promptReady()!==false],['Model',hasModel]]:isDescriptionTryon()?[['Ảnh',hasSource],['Mô tả',Boolean(deps.$('tryonDescription')?.value.trim())],['Vùng chỉnh sửa',hasMask||autoMask],['Model',hasModel]]:[['Ảnh',hasSource],['Trang phục',hasReference],['Vùng chỉnh sửa',hasMask||autoMask],['Model',hasModel]];
  const next=requirements.find((item)=>!item[1]),ready=!next;
  const toolGuides={add:'Tô lên vùng cần chỉnh sửa trên ảnh.',erase:'Tô để loại khỏi vùng chỉnh sửa.',protect:'Đánh dấu vùng cần giữ nguyên.',ai:'Nhấp vào vật thể để AI tạo mask.',person:'Chọn nhân vật cần chỉnh sửa trên ảnh.'};
  const guide=['character','body'].includes(studioMode)?deps.$('characterStatus').textContent:studioMode==='makeup'?deps.$('makeupStatus').textContent:studioMode==='enhance'?deps.$('enhanceStatus').textContent:studioMode==='outpaint'?deps.$('outpaintGeometryHint').textContent:ready?(studioMode==='chroma'?'Mô tả và model đã sẵn sàng.':'Ảnh, vùng chỉnh sửa và model đã sẵn sàng.'):next[0]==='Mô tả'?(studioMode==='tryon'?'Mô tả trang phục hoặc phụ kiện mới.':(window.NewImage?.promptReady()===false?'Mô tả vượt giới hạn model. Xem phần kiểm tra và chỉnh nội dung.':'Nhập nội dung ảnh bạn muốn tạo.')):next[0]==='Ảnh'?'Chọn ảnh nguồn để bắt đầu.':next[0]==='Trang phục'?'Thêm ảnh trang phục tham chiếu.':next[0]==='Model'?'Chọn hoặc tải model phù hợp.':toolGuides[deps.tool]||toolGuides.add;
  status.classList.toggle('is-ready',ready);status.innerHTML=`<div><span class="studio-ready-dot"></span><div><strong>${ready?'Sẵn sàng tạo kết quả':`Cần thêm: ${next[0]}`}</strong><small class="studio-requirements">${requirements.map(([label,done])=>`${done?'✓':'○'} ${label}`).join(' · ')}</small><small class="studio-guide">${guide}</small></div></div><button id="studioNextAction">${ready?'Đi đến nút tạo':next[0]==='Ảnh'?'Chọn ảnh':next[0]==='Trang phục'?(isDescriptionTryon()?'Nhập mô tả':'Thêm ảnh mẫu'):next[0]==='Mô tả'?'Nhập mô tả':['character','body'].includes(studioMode)?(next[0]==='Khuôn mặt'?'Nhận diện khuôn mặt':next[0]==='Nhân vật'?'Nhận diện người':next[0]==='Thay đổi'?'Chọn thay đổi':'Kiểm tra vùng tác động'):studioMode==='tryon'?'Tạo vùng thay':'Chọn vùng'}</button>`;
  deps.$('studioNextAction').textContent=!ready&&next[0]==='Model'?'Quản lý model':!ready&&studioMode==='makeup'&&next[0]!=='Ảnh'?next[0]==='Khuôn mặt'?'Nhận diện khuôn mặt':next[0]==='Mô tả'?'Đọc mô tả':next[0]==='Vùng trang điểm'?'Chọn vùng trang điểm':'Thiết lập trang điểm':deps.$('studioNextAction').textContent;
  deps.$('studioNextAction').addEventListener('click',()=>{if(ready){revealStudioCreateAction();}else if(['character','body'].includes(studioMode)&&next[0]!=='Ảnh'){window.Character.focus();}else if(studioMode==='makeup'&&next[0]!=='Ảnh'){window.Makeup.focus();}else if(next[0]==='Hai phía viền'){window.ImageEnhancement.pickMissingPoint();}else if(next[0]==='Model')deps.openModelManager();else if(next[0]==='Mô tả'){tryonPromptField().scrollIntoView({behavior:'smooth',block:'center'});tryonPromptField().focus();}else if(next[0]==='Khung mở rộng')deps.$('outpaintWidth').focus();else if(next[0]==='Ảnh')deps.$('sourceImageFile').click();else if(next[0]==='Trang phục')deps.$('garmentFile').click();else{deps.setTool('add');deps.$('addTool').scrollIntoView({behavior:'smooth',block:'center'});}});
  const steps=[...document.querySelectorAll('.journey-steps li')];steps.forEach((step,index)=>step.classList.toggle('complete',index===0?hasSource:index===1?(studioMode==='outpaint'?outpaintReady():hasMask):index===2?['inpaint','outpaint'].includes(studioMode)||(studioMode==='tryon'&&isDescriptionTryon()?Boolean(deps.$('tryonDescription').value.trim()):hasReference):false));
  const resultReady=Boolean(deps.studioViewingResult||deps.studioSelectedResult||deps.studioPendingResult);
  steps.forEach((step,index)=>{if(index===3&&!['character','body'].includes(studioMode)){step.querySelector('strong').textContent='Tạo và so sánh';step.querySelector('small').textContent=resultReady?'Xem và chọn kết quả':'Sinh phương án';step.classList.toggle('complete',resultReady);}step.setAttribute('aria-current',step.classList.contains('active')?'step':'false');});
  if(studioMode==='character'){const characterRequirements=new Map(requirements);steps.forEach((step,index)=>step.classList.toggle('complete',index===0?hasSource:index===1?Boolean(characterRequirements.get('Khuôn mặt')):index===2?Boolean(characterRequirements.get('Thay đổi')):index===3?Boolean(characterRequirements.get('Vùng tác động')):Boolean(window.Character?.previewReady?.()||resultReady)));}
  if(studioMode==='body'){const bodyRequirements=new Map(requirements),bodyChanged=Boolean(bodyRequirements.get('Thay đổi')||bodyRequirements.get('Bộ phận')),bodyReviewed=Boolean(bodyRequirements.get('Vùng tác động'));steps.forEach((step,index)=>step.classList.toggle('complete',index===0?hasSource:index===1?Boolean(bodyRequirements.get('Nhân vật')):index===2?bodyChanged:index===3?bodyReviewed:Boolean(window.Character?.previewReady?.()||resultReady)));}
  updateStudioCommandBar({ready,next:next?.[0],hasSource,hasMask,hasReference,hasModel});
  window.StudioWorkspace?.syncJourney();
}

function revealStudioCreateAction(){
  const bar=deps.$('studioCommandBar'),primary=deps.$('studioPrimaryAction');
  if(!bar||!primary)return;
  if(studioCommandCollapseTimer){clearTimeout(studioCommandCollapseTimer);studioCommandCollapseTimer=null;}
  studioCommandManuallyCollapsed=false;
  bar.hidden=false;
  setStudioCommandCollapsed(false);
  bar.scrollIntoView({behavior:'smooth',block:'nearest'});
  primary.focus({preventScroll:true});
}

function setStudioCommandCollapsed(collapsed){
  const bar=deps.$('studioCommandBar'),toggle=deps.$('studioCommandToggle');if(!bar||!toggle)return;
  bar.classList.toggle('is-collapsed',Boolean(collapsed));
  toggle.setAttribute('aria-expanded',String(!collapsed));
  const summary=[deps.$('studioCommandTitle')?.textContent,deps.$('studioCommandHint')?.textContent].filter(Boolean).join(' · ');
  toggle.setAttribute('aria-label',collapsed?`Mở thanh tác vụ · ${summary}`:'Thu gọn thanh tác vụ');
  toggle.title=collapsed?summary:'Thu gọn thanh tác vụ';
}

function scheduleStudioCommandCollapse(delay=5000){
  if(studioCommandCollapseTimer)clearTimeout(studioCommandCollapseTimer);
  studioCommandCollapseTimer=setTimeout(()=>{studioCommandCollapseTimer=null;setStudioCommandCollapsed(true);},delay);
}

function updateStudioCommandVisibility(key,{attention=false,error=false,collapseAfter=0,collapseNow=false}={}){
  const bar=deps.$('studioCommandBar');if(!bar)return;
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
  const bar=deps.$('studioCommandBar'),primary=deps.$('studioPrimaryAction'),copy=deps.$('studioCommandTitle'),hint=deps.$('studioCommandHint'),status=bar?.querySelector('.studio-command-state');if(!bar||!primary)return;
  const task=studioMode==='body'?'Tư thế & cơ thể':studioMode==='character'?'Khuôn mặt & hướng nhìn':studioMode==='makeup'?'Trang điểm AI':studioMode==='enhance'?'Cải thiện ảnh':studioMode==='outpaint'?'Mở rộng ảnh':studioMode==='inpaint'?'Xóa vật thể':studioMode==='chroma'?'Tạo ảnh mới':'Thay trang phục';copy.textContent=task;status.classList.toggle('ready',Boolean(state.ready));
  if(['character','body'].includes(studioMode)&&state.next&&state.next!=='Ảnh'){hint.textContent=deps.$('characterStatus').textContent;primary.disabled=false;primary.dataset.command=state.next==='Vùng tác động'?(studioMode==='body'&&window.Character.bodyChangeType()==='anatomy'?'character-primary':'character-preview'):'character-settings';primary.textContent=state.next==='Khuôn mặt'?'Nhận diện khuôn mặt':state.next==='Nhân vật'?'Nhận diện người':state.next==='Thay đổi'?'Chọn thay đổi cơ thể':state.next==='Bộ phận'?'Chọn bộ phận':state.next==='Vùng tác động'?'Kiểm tra vùng tác động':'Thiết lập '+(studioMode==='body'?'tư thế':'khuôn mặt');return;}
  if(studioMode==='makeup'&&state.next&&state.next!=='Ảnh'){hint.textContent=deps.$('makeupStatus').textContent;primary.disabled=false;primary.dataset.command='makeup-settings';primary.textContent=state.next==='Khuôn mặt'?'Nhận diện khuôn mặt':state.next==='Mô tả'?'Đọc mô tả':state.next==='Vùng trang điểm'?'Chọn vùng trang điểm':'Thiết lập trang điểm';return;}
  if(studioMode==='enhance'&&state.next==='Hai phía viền'){hint.textContent=deps.$('edgePointsStatus').textContent;primary.disabled=false;primary.dataset.command='edge-guides';primary.textContent='Chọn điểm còn thiếu';return;}
  if(studioMode==='enhance'&&['Dịch vụ','Kích thước','Model'].includes(state.next)){hint.textContent=deps.$('enhanceStatus').textContent;primary.disabled=false;primary.dataset.command='enhance-settings';primary.textContent='Xem thiết lập cải thiện';return;}
  const missing=state.next?`Cần thêm ${state.next.toLowerCase()}`:'Sẵn sàng tạo kết quả';
  if(studioMode==='chroma'&&state.ready){
    const quality={fast:'Nhanh',balanced:'Cân bằng',quality:'Chi tiết'}[deps.textQuality]||'Tùy chỉnh';
    const count=Number(deps.$('chromaCount')?.value)||1;
    hint.textContent=`${deps.$('chromaAspect')?.value||'1:1'} · ${quality} · ${count} phương án`;
  }else if(studioMode==='inpaint'&&state.ready){
    const quality={fast:'Nhanh',balanced:'Cân bằng',detail:'Chi tiết'}[deps.$('inpaintQualityPreset')?.value]||'Cân bằng';
    const fill=deps.$('inpaintFillMode')?.selectedOptions[0]?.textContent||'Phục hồi nền';
    hint.textContent=`Vùng xóa đã chọn · ${fill} · ${quality} · ${Number(deps.$('inpaintCount')?.value)||1} phương án`;
  }else if(studioMode==='outpaint'&&state.ready){
    const quality={fast:'Nhanh',balanced:'Cân bằng',detail:'Chi tiết'}[deps.$('outpaintPreset')?.value]||'Tùy chỉnh';
    const count=Number(deps.$('outpaintCount')?.value)||1;
    const layout=Boolean(deps.$('outpaintChooseLayout')?.checked);
    hint.textContent=`${deps.$('outpaintRatio')?.value==='custom'?'Khung tùy chỉnh':deps.$('outpaintRatio')?.value} · ${quality} · ${count} ${layout?'bố cục':'phương án'}`;
  }else if(studioMode==='tryon'&&state.ready){
    const quality={fast:'Nhanh',balanced:'Cân bằng',quality:'Chi tiết'}[deps.$('qualityPreset')?.value]||'Cân bằng';
    const source=isDescriptionTryon()?'Theo mô tả':'Ảnh mẫu';
    const category=deps.$('garmentCategory')?.selectedOptions[0]?.textContent||'Trang phục';
    hint.textContent=`${source} · ${category} · ${quality} · ${Number(deps.$('tryonCount')?.value)||1} phương án`;
  }else if(studioMode==='enhance'&&state.ready){
    const level={light:'Nhẹ',balanced:'Cân bằng',strong:'Mạnh'}[deps.$('enhanceLevel')?.value]||'Cân bằng';
    const scope=deps.$('enhanceScope')?.value==='selected'?'Vùng đã chọn':'Toàn ảnh';
    hint.textContent=`${window.ImageEnhancement.methodLabel()} · ${level} · ${scope} · ${deps.$('enhanceDimensions')?.textContent||''}`;
  }else if(['character','body'].includes(studioMode)&&state.ready){
    hint.textContent=`${deps.$('characterChangeSummary')?.textContent||'Thay đổi khuôn mặt'} · ${window.Character.previewReady()?'Đã chọn bản xem thử':'2 phương án xem thử'}`;
  }else if(studioMode==='makeup'&&state.ready){
    const intensity={light:'Nhẹ',medium:'Tự nhiên',bold:'Đậm'}[deps.$('makeupIntensity')?.value]||'Tự nhiên';
    const regionCount=document.querySelectorAll('[data-makeup-part]:checked').length;
    hint.textContent=`${window.Makeup.currentStyleLabel()} · ${intensity} · ${regionCount} vùng · 2 phương án`;
  }else hint.textContent=`${missing} · Tự động lưu trên máy`;
  primary.classList.remove('danger');primary.disabled=false;
  primary.dataset.command=state.ready?'run':state.next==='Model'?'models':state.next==='Mô tả'?'prompt':state.next==='Trang phục'?'garment':state.next==='Vùng chỉnh sửa'?'mask':state.next==='Khung mở rộng'?'frame':'source';
  const chromaCount=Number(deps.$('chromaCount')?.value)||1;
  const inpaintCount=Number(deps.$('inpaintCount')?.value)||1;
  const outpaintCount=Number(deps.$('outpaintCount')?.value)||1;
  const tryonCount=Number(deps.$('tryonCount')?.value)||1;
  primary.textContent=state.ready?(studioMode==='enhance'?window.ImageEnhancement.primaryLabel():studioMode==='makeup'?window.Makeup.primaryLabel():['character','body'].includes(studioMode)?window.Character.primaryLabel():studioMode==='chroma'?`Tạo ${chromaCount} ảnh`:studioMode==='inpaint'?(inpaintCount===1?'Xóa vật thể':`Tạo ${inpaintCount} phương án`):studioMode==='outpaint'?(deps.$('outpaintChooseLayout')?.checked?`Tạo ${outpaintCount} bố cục`:'Tạo ảnh mở rộng'):studioMode==='tryon'?`Tạo ${tryonCount} phương án`:'Tạo kết quả'):state.next==='Model'?'Quản lý model':state.next==='Mô tả'?'Nhập mô tả':state.next==='Trang phục'?(isDescriptionTryon()?'Nhập mô tả':'Thêm ảnh mẫu'):state.next==='Vùng chỉnh sửa'?(studioMode==='tryon'?'Tạo vùng thay':'Chọn vật thể'):state.next==='Khung mở rộng'?'Chỉnh khung':'Chọn ảnh';
  bar.classList.toggle('is-complete',Boolean(state.ready));bar.classList.remove('is-running');bar.style.setProperty('--command-progress',state.ready?'100%':'0%');
  updateStudioCommandVisibility(state.ready?'ready':`missing:${state.next||'input'}`,{attention:!state.ready,collapseAfter:0});
}

function setExperienceMode(mode){
  const next=mode==='expert'?'expert':'simple';document.body.dataset.experience=next;localStorage.setItem('studioExperience',next);
  window.AtelierStore?.set({experience:next});
  deps.$('simpleExperienceButton').classList.toggle('active',next==='simple');deps.$('expertExperienceButton').classList.toggle('active',next==='expert');
  deps.$('simpleExperienceButton').setAttribute('aria-pressed',String(next==='simple'));deps.$('expertExperienceButton').setAttribute('aria-pressed',String(next==='expert'));
  deps.$('experienceHint').textContent=next==='simple'?'Chỉ hiển thị những lựa chọn cần thiết để tạo kết quả.':'Hiển thị model, seed, LoRA, pipeline và các thông số kiểm định.';
}

function setStudioMode(mode){
  const nextMode=['tryon','inpaint','outpaint','chroma','enhance','makeup','character','body'].includes(mode)?mode:'tryon';
  if(nextMode!=='chroma')switchTaskMask(nextMode);
  studioMode=nextMode;localStorage.setItem('studioMode',studioMode);document.body.dataset.studioTask=studioMode;
  window.AtelierStore?.set({task:studioMode});
  const secondStep=document.querySelector('.journey-steps li:nth-child(2)'),thirdStep=document.querySelector('.journey-steps li:nth-child(3)');
  if(secondStep){secondStep.dataset.stepTarget='addTool';secondStep.querySelector('strong').textContent='Chọn vùng';secondStep.querySelector('small').textContent='Vẽ hoặc dùng AI';}
  if(thirdStep)thirdStep.dataset.stepTarget='garmentFile';
  const inpaint=deps.$('studioInpaintPanel'),tryon=deps.$('studioTryonPanel'),chroma=deps.$('chromaGeneratorPanel'),stage=deps.$('studioChromaStage');if(!inpaint||!tryon||!chroma)return;
  deps.$('studioCharacterPanel').hidden=studioMode!=='character';
  deps.$('studioBodyPanel').hidden=studioMode!=='body';
  deps.$('studioMakeupPanel').hidden=studioMode!=='makeup';
  deps.$('studioEnhancePanel').hidden=studioMode!=='enhance';
  deps.$('studioOutpaintPanel').hidden=studioMode!=='outpaint';
  inpaint.hidden=studioMode!=='inpaint';tryon.hidden=studioMode!=='tryon';chroma.hidden=studioMode!=='chroma';if(stage)stage.hidden=studioMode!=='chroma';inpaint.open=true;tryon.open=true;chroma.open=true;
  deps.$('editorCanvas').hidden=['chroma','outpaint'].includes(studioMode)||!deps.sourceImage;deps.$('emptyCanvasState').hidden=studioMode==='chroma'||Boolean(deps.sourceImage);deps.$('loading').hidden=studioMode==='chroma'||deps.$('loading').hidden;
  for(const button of document.querySelectorAll('[data-studio-mode]'))button.classList.toggle('active',button.dataset.studioMode===studioMode);
  window.Character?.setStudioTask(studioMode);
  const title=deps.$('studioModeTitle'),hint=deps.$('studioModeHint'),heading=document.querySelector('.panel-heading h2'),journeyTitle=document.querySelector('.journey-heading h2'),toolbarHint=document.querySelector('.canvas-toolbar>span:last-child');if(title)title.textContent=studioMode==='body'?'Tư thế & cơ thể':studioMode==='character'?'Khuôn mặt & hướng nhìn':studioMode==='makeup'?'Trang điểm AI':studioMode==='enhance'?'Cải thiện ảnh':studioMode==='outpaint'?'Mở rộng ảnh':studioMode==='inpaint'?'Xóa vật thể':studioMode==='chroma'?'Ảnh mới':'Thay trang phục';if(hint)hint.textContent=studioMode==='body'?'Chọn người, tư thế hoặc bộ phận cần chỉnh rồi kiểm tra khung xương và vùng tác động.':studioMode==='character'?'Chọn khuôn mặt, biểu cảm, hướng nhìn hoặc góc đầu rồi kiểm tra vùng tác động.':studioMode==='makeup'?'Chọn khuôn mặt, phong cách hoặc mô tả riêng rồi so sánh.':studioMode==='enhance'?'Chọn cách cải thiện và xem thử trước khi xử lý toàn ảnh.':studioMode==='outpaint'?'Chọn khung lớn hơn và kéo ảnh để đặt bố cục.':studioMode==='inpaint'?'Tô vùng cần xóa rồi tạo phương án tái tạo.':studioMode==='chroma'?'Nhập mô tả và tạo các phương án mới.':'Chọn ảnh mẫu hoặc mô tả trang phục, sau đó tạo vùng thay.';if(heading)heading.textContent=studioMode==='chroma'?'Tạo ảnh mới':'Chỉnh sửa ảnh';if(journeyTitle)journeyTitle.textContent=studioMode==='chroma'?'Ảnh mới':studioMode==='tryon'?'Thay trang phục':'Vùng chỉnh sửa';if(toolbarHint)toolbarHint.textContent=['character','body'].includes(studioMode)?'Cam: vùng sẽ tạo lại · Xanh: vùng bảo vệ':studioMode==='makeup'?'Đỏ: vùng trang điểm · Xanh: chi tiết cần giữ':studioMode==='enhance'?'Xanh: vùng bảo vệ · Chọn phạm vi tại bảng Thiết lập':studioMode==='chroma'?'Kết quả được lưu tự động trên máy':'Đỏ: vùng sẽ chỉnh · Ngoài vùng: được bảo vệ';
  deps.$('imageInfo').textContent=studioMode==='chroma'?'Ảnh mới từ mô tả':deps.current?`${deps.current.id} · ${deps.sourceImage?.naturalWidth||0} × ${deps.sourceImage?.naturalHeight||0}`:'—';deps.$('deselectImageButton').hidden=studioMode==='chroma';deps.$('saveFullSizeImageButton').hidden=studioMode==='chroma';
  const third=document.querySelector('.journey-steps li:nth-child(3)');if(third){third.querySelector('strong').textContent=studioMode==='inpaint'?'Vùng chỉnh sửa':'Trang phục';third.querySelector('small').textContent=studioMode==='inpaint'?'Không cần ảnh tham chiếu':'Thêm ảnh tham chiếu';}
  refreshOutpaintPreview();
  if(studioMode==='tryon')updateTryonInputMode();
  refreshStudioReadiness();
}

function restoreModelSortPreferences(){for(const [id,key] of [['modelInventorySort','modelInventorySort'],['modelCapabilitySort','modelCapabilitySort'],['registeredModelSort','registeredModelSort']]){const select=deps.$(id),saved=localStorage.getItem(key);if(select&&saved&&[...select.options].some((option)=>option.value===saved))select.value=saved;}}

function setupExperience() {
  setupOutpainting();
  window.ImageEnhancement.setup();
  window.Makeup.setup();
  window.Character.setup();
  window.AnatomyPartsManager?.setup();
  window.AnatomyInpaint?.setup();
  setupOutfitWorkflow();
  const offlineModelPanel=deps.$('offlineModelPanel'),modelManagerContent=deps.$('modelManagerContent');
  if(offlineModelPanel&&modelManagerContent)modelManagerContent.appendChild(offlineModelPanel);
  const chromaPanel=deps.$('chromaGeneratorPanel'),chromaShell=document.querySelector('.chroma-gallery-shell'),canvasWrap=deps.$('canvasWrap');if(chromaShell&&canvasWrap){chromaShell.id='studioChromaStage';chromaShell.classList.add('studio-chroma-stage');canvasWrap.appendChild(chromaShell);chromaShell.hidden=true;}
  const journey=deps.$('journeyContent');
  const chromaJourney=document.createElement('section');chromaJourney.className='chroma-journey';chromaJourney.innerHTML=`<p class="eyebrow">BẮT ĐẦU NHANH</p><h3>Ý tưởng ảnh mới</h3><p>Chọn gợi ý hoặc viết mô tả riêng trong bảng Thiết lập.</p><div class="chroma-prompt-presets"><button type="button" data-chroma-prompt="${deps.escapeHtml(window.ATELIER_PROMPTS.ui.quickIdea1)}">Ảnh sản phẩm</button><button type="button" data-chroma-prompt="${deps.escapeHtml(window.ATELIER_PROMPTS.ui.quickIdea2)}">Chân dung thời trang</button><button type="button" data-chroma-prompt="${deps.escapeHtml(window.ATELIER_PROMPTS.ui.quickIdea3)}">Chiến dịch tối giản</button></div><div class="chroma-size-shortcuts"><span>Tỷ lệ nhanh</span><button type="button" data-new-image-ratio="1:1">1:1</button><button type="button" data-new-image-ratio="4:5">4:5</button><button type="button" data-new-image-ratio="16:9">16:9</button><button type="button" data-chroma-library>Xem ảnh gần đây</button></div>`;
  journey.appendChild(chromaJourney);for(const button of chromaJourney.querySelectorAll('[data-chroma-prompt]'))button.addEventListener('click',()=>{deps.$('chromaPrompt').value=button.dataset.chromaPrompt;deps.$('chromaPrompt').dispatchEvent(new Event('input'));deps.$('chromaPrompt').focus();});for(const button of chromaJourney.querySelectorAll('[data-chroma-size]'))button.addEventListener('click',()=>{deps.$('chromaSize').value=button.dataset.chromaSize;deps.$('chromaSize').dispatchEvent(new Event('change'));});chromaJourney.querySelector('[data-chroma-library]').addEventListener('click',()=>activateAppView('library'));
  const moveIds=['sourceImageFile','imageSelect','labelSelect','addTool','brushSize','overlayOpacity','notes','saveButton'];
  const moved=new Set();
  for(const id of moveIds){const node=deps.$(id);if(!node)continue;let block=node.closest('label,.tool-group,.button-row')||node;if(block.classList.contains('button-row')&&id==='addTool')block=node.closest('.tool-group');if(block&&!moved.has(block)){journey.appendChild(block);moved.add(block);}}
  const aiActions=deps.$('aiActions');if(aiActions)journey.appendChild(aiActions);
  const undo=deps.$('undoButton')?.closest('.button-row');if(undo)journey.appendChild(undo);
  const saveMask=deps.$('saveButton');
  if(saveMask&&aiActions&&undo){
    const maskActions=document.createElement('section');maskActions.className='mask-action-card';maskActions.innerHTML='<div class="mask-action-heading"><span aria-hidden="true">◩</span><div><strong>Hành động mask</strong><small>Lưu hoặc điều chỉnh vùng đã chọn.</small></div></div>';
    saveMask.before(maskActions);maskActions.append(saveMask,aiActions,undo);
  }
  const tryon=deps.$('studioTryonPanel');
  const inpaint=deps.$('studioInpaintPanel');
  if(chromaPanel&&tryon){chromaPanel.classList.add('studio-task-panel');tryon.after(chromaPanel);chromaPanel.open=true;chromaPanel.hidden=true;}
  if(tryon&&inpaint){
    const switcher=document.createElement('section');switcher.className='studio-mode-card';switcher.innerHTML='<div><p class="eyebrow">TÁC VỤ</p><h3 id="studioModeTitle">Thay trang phục</h3><p id="studioModeHint">Thêm ảnh trang phục tham chiếu rồi chọn chất lượng.</p></div><div class="studio-mode-switch"><button data-studio-mode="chroma">Tạo ảnh</button><button data-studio-mode="inpaint">Xóa vật thể</button><button data-studio-mode="outpaint">Mở rộng ảnh</button><button data-studio-mode="tryon">Trang phục</button><button data-studio-mode="enhance">Cải thiện</button><button data-studio-mode="makeup">Trang điểm</button><button data-studio-mode="character">Khuôn mặt</button><button data-studio-mode="body">Tư thế &amp; cơ thể</button></div>';
    const readiness=document.createElement('section');readiness.id='studioReadiness';readiness.className='studio-readiness';
    inpaint.before(switcher,readiness);readiness.after(deps.$('studioOutpaintPanel'),deps.$('studioEnhancePanel'),deps.$('studioMakeupPanel'),deps.$('studioCharacterPanel'),deps.$('studioBodyPanel'));for(const button of switcher.querySelectorAll('[data-studio-mode]'))button.addEventListener('click',()=>setStudioMode(button.dataset.studioMode));
  }
  if(tryon){
    tryon.open=true;
    const inputMode=deps.$('tryonInputMode');inputMode.closest('label').hidden=true;
    const method=document.createElement('fieldset');method.className='tryon-method-main';method.innerHTML='<legend>Trang phục mới</legend><div class="button-row" role="group" aria-label="Cách chọn trang phục mới"><button type="button" data-tryon-input-mode="reference">Dùng ảnh mẫu</button><button type="button" data-tryon-input-mode="description">Mô tả trang phục</button></div>';
    tryon.querySelector('summary').after(method);
    for(const button of method.querySelectorAll('[data-tryon-input-mode]'))button.onclick=()=>{inputMode.value=button.dataset.tryonInputMode;inputMode.dispatchEvent(new Event('change'));};
    const quick=document.createElement('fieldset');quick.id='tryonQualityMain';quick.className='quick-quality tryon-quality-main';quick.innerHTML='<legend>Chất lượng</legend><select id="qualityPreset" hidden><option value="fast">Nhanh</option><option value="balanced" selected>Cân bằng</option><option value="quality">Chi tiết</option></select><div class="button-row" role="group" aria-label="Chất lượng thay trang phục"><button type="button" data-tryon-quality="fast">Nhanh</button><button type="button" data-tryon-quality="balanced" class="active" aria-pressed="true">Cân bằng</button><button type="button" data-tryon-quality="quality">Chi tiết</button></div><small>Cân bằng phù hợp cho phần lớn lượt thử trang phục.</small>';
    deps.$('targetGarmentFields').after(quick);
    const advanced=document.createElement('details');advanced.className='inpaint-panel advanced-panel';advanced.innerHTML='<summary>Thiết lập nâng cao</summary>';
    const advancedIds=['tryonSeed','tryonCount','tryonSteps','tryonGuidance','autoMaskToggle','cropPersonToggle','confidenceThreshold','onlyConfidentToggle','twoStageToggle','minimumQuality','minimumSimilarity','minimumSeam','minimumAnatomy','maxRetries','repairSeamsToggle','generativeRefineToggle','refineRegion','onlyQualityToggle','batchScope'];
    const advancedBlocks=[];
    for(const id of advancedIds){const node=deps.$(id);const block=node?.closest('label,.compact-grid');if(block&&!advancedBlocks.includes(block))advancedBlocks.push(block);}
    tryon.appendChild(advanced);for(const block of advancedBlocks)advanced.appendChild(block);
    const operations=deps.$('operationalCommandHost');
    const operationIds=['auditButton','reviewFilter','exportApprovedButton','calibrateButton','goldenButton','compareBaselineButton','jobsButton','jobRetentionDays','cleanupJobsButton','benchmarkButton','dashboardButton','reviewBenchmarkButton','reviewReadinessButton','runRetryQueueButton','retryComparisonsButton','calibrateWeightsButton','compareWeightsButton','activateWeightsButton','confirmDefaultWeightsButton','acceptanceButton','systemCheckButton','backupButton','backupSelect','restoreBackupButton'];
    const operationBlocks=[];for(const id of operationIds){const node=deps.$(id);const block=node?.closest('label,.compact-grid')||node;if(block&&!operationBlocks.includes(block))operationBlocks.push(block);}
    if(operations)for(const block of operationBlocks)operations.appendChild(block);
    deps.$('qualityPreset').addEventListener('change',(event)=>{const presets=window.ATELIER_PROMPTS.runtimePresets.tryonQuality;const preset=presets[event.target.value];deps.$('tryonCount').value=preset.count;deps.$('tryonSteps').value=preset.steps;deps.$('twoStageToggle').checked=preset.twoStage;if(isDescriptionTryon())applyDescriptionQualityPreset(event.target.value);for(const button of quick.querySelectorAll('[data-tryon-quality]')){const active=button.dataset.tryonQuality===event.target.value;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}deps.setMessage(`Đã chọn chế độ ${event.target.selectedOptions[0].text.toLowerCase()}.`,'success');globalThis.AtelierApp.refreshStudioReadiness();});
    for(const button of quick.querySelectorAll('[data-tryon-quality]'))button.onclick=()=>{deps.$('qualityPreset').value=button.dataset.tryonQuality;deps.$('qualityPreset').dispatchEvent(new Event('change'));};
  }
  // Keep the same order in both task panels: model, task inputs, common settings, advanced, run.
  if(inpaint){
    const quick=document.createElement('fieldset');quick.className='quick-quality inpaint-quality';quick.innerHTML='<legend>Chất lượng</legend><select id="inpaintQualityPreset" hidden><option value="fast">Nhanh</option><option value="balanced" selected>Cân bằng</option><option value="detail">Chi tiết</option></select><div class="button-row" role="group" aria-label="Chất lượng xóa vật thể"><button type="button" data-inpaint-quality="fast">Nhanh</button><button type="button" data-inpaint-quality="balanced" class="active" aria-pressed="true">Cân bằng</button><button type="button" data-inpaint-quality="detail">Chi tiết</button></div><small>Chọn mức phù hợp; hệ thống tự đặt độ phân giải và số bước.</small>';
    deps.$('inpaintFillMode').closest('.studio-prompt-group').after(quick);deps.$('inpaintQualityPreset').addEventListener('change',(event)=>{applyInpaintModelSettings(true);for(const button of quick.querySelectorAll('[data-inpaint-quality]')){const active=button.dataset.inpaintQuality===event.target.value;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}deps.setMessage(`Đã chọn chế độ ${event.target.selectedOptions[0].text.toLowerCase()} theo model hiện tại.`,'success');});
    for(const button of quick.querySelectorAll('[data-inpaint-quality]'))button.addEventListener('click',()=>{deps.$('inpaintQualityPreset').value=button.dataset.inpaintQuality;deps.$('inpaintQualityPreset').dispatchEvent(new Event('change'));});
    const grid=deps.$('inpaintSeed').closest('.compact-grid'),advanced=document.createElement('details');
    advanced.className='advanced-panel';advanced.innerHTML='<summary>Thiết lập nâng cao</summary><div class="compact-grid"></div>';
    grid.after(advanced);
    advanced.after(deps.$('studioLoraPanel'));
    const advancedGrid=advanced.querySelector('.compact-grid');
    for(const id of ['inpaintModelSelect','inpaintSeed','maskExpand','maskBlur','inpaintSteps','inpaintStrength','inpaintGuidance','cropPadding','inpaintResolution','inpaintObjectLabel'])advancedGrid.appendChild(deps.$(id).closest('label'));
    advanced.appendChild(deps.$('inpaintNegativePrompt').closest('.studio-prompt-group'));
    quick.appendChild(deps.$('inpaintCount').closest('label'));
    grid.remove();deps.$('inpaintFillMode').addEventListener('change',refreshStudioReadiness);
  }
  if(tryon){
    const referenceAdvanced=document.createElement('details');referenceAdvanced.className='advanced-panel';referenceAdvanced.innerHTML='<summary>Quản lý ảnh tham chiếu và kiểm định</summary>';
    deps.$('garmentPreview').after(referenceAdvanced);
    for(const id of ['saveReferenceButton','refreshReferenceReadinessButton','qualifyReferenceButton','referenceReadiness'])referenceAdvanced.appendChild(deps.$(id));
    const quality=deps.$('tryonQualityMain');quality.appendChild(deps.$('tryonCount').closest('label'));
    const seedLabel=deps.$('tryonSeed').closest('label'),advancedPanel=[...tryon.querySelectorAll('.advanced-panel')].find(node=>node.querySelector('#tryonSteps'));if(seedLabel&&advancedPanel)advancedPanel.prepend(seedLabel);
    const peopleAdvanced=document.createElement('details');peopleAdvanced.className='advanced-panel';peopleAdvanced.innerHTML='<summary>Nhân vật và vùng chỉnh sửa</summary>';
    deps.$('garmentCategory').closest('label').after(peopleAdvanced);
    for(const id of ['personSelect','detectPeopleButton','usePoseToggle'])peopleAdvanced.appendChild(deps.$(id).closest('label')||deps.$(id));
    const referenceInput=document.createElement('section');referenceInput.className='tryon-input-main';referenceInput.setAttribute('aria-label','Ảnh trang phục mẫu');
    tryon.querySelector('.tryon-method-main').after(referenceInput);for(const id of ['garmentFile','garmentPreview','preprocessGarmentButton']){const node=deps.$(id);referenceInput.appendChild(node.closest('label')||node);}
    const region=document.createElement('section');region.className='tryon-region-main';region.innerHTML='<strong>Người và vùng thay</strong><small>Chọn loại trang phục trước để hệ thống tạo vùng phù hợp.</small>';
    quality.before(region);for(const id of ['garmentCategory','personSelect','autoMaskButton','targetGarmentFields']){const node=deps.$(id);region.appendChild(node.closest('label')||node);}
    const manual=document.createElement('button');manual.type='button';manual.textContent='Chỉnh vùng thủ công';manual.onclick=()=>{deps.setTool('add');deps.$('addTool').focus();deps.$('addTool').scrollIntoView({behavior:'smooth',block:'center'});};region.appendChild(manual);
    loadTryonModelOptions().catch((error)=>{deps.$('tryonModelHint').textContent=error.message;refreshStudioReadiness();});
  }
  deps.$('tryonModelSelect')?.addEventListener('change',refreshStudioReadiness);
  deps.$('textToImageModel')?.addEventListener('change',refreshStudioReadiness);deps.$('chromaPrompt')?.addEventListener('input',refreshStudioReadiness);
  deps.$('autoMaskToggle')?.addEventListener('change',refreshStudioReadiness);deps.applyManagedPromptDefaults();setStudioMode(localStorage.getItem('studioMode')||'tryon');
  for(const node of document.querySelectorAll('.advanced-panel,.lora-panel'))node.classList.add('expert-only');
  for(const id of ['batchTryonButton','cancelJobButton','resumeJobButton','tryonSeed','inpaintSeed','inpaintCount'])deps.$(id)?.closest('label,button')?.classList.add('expert-only');
  deps.$('simpleExperienceButton')?.addEventListener('click',()=>setExperienceMode('simple'));deps.$('expertExperienceButton')?.addEventListener('click',()=>setExperienceMode('expert'));setExperienceMode(localStorage.getItem('studioExperience')||'simple');
  deps.$('studioPrimaryAction')?.addEventListener('click',()=>{const command=deps.$('studioPrimaryAction').dataset.command;if(command==='run'||command==='character-primary'){if(deps.activeJobId)return deps.setMessage('Một tác vụ đang chạy; hãy đợi hoàn tất hoặc hủy tác vụ hiện tại.','error');(command==='character-primary'?()=>window.Character.run():['character','body'].includes(studioMode)?()=>window.Character.run():studioMode==='makeup'?()=>window.Makeup.run():studioMode==='enhance'?()=>window.ImageEnhancement.run():studioMode==='outpaint'?runOutpaint:studioMode==='inpaint'?deps.runInpaint:studioMode==='chroma'?deps.runChromaGenerate:deps.runTryon)();}else if(command==='cancel')deps.cancelActiveJob().catch((error)=>deps.setMessage(error.message,'error'));else if(command==='results'){deps.showGenerationResult(deps.activityState);}else if(command==='edge-guides'){window.ImageEnhancement.pickMissingPoint();}else if(command==='character-preview'){window.Character.preview();}else if(command==='character-settings'){window.Character.focus();}else if(command==='makeup-settings'){window.Makeup.focus();}else if(command==='enhance-settings'){deps.$('studioEnhancePanel').scrollIntoView({block:'center'});deps.$('enhanceRefresh').focus();}else if(command==='models')deps.openModelManager();else if(command==='prompt'){tryonPromptField().scrollIntoView({behavior:'smooth',block:'center'});tryonPromptField().focus();}else if(command==='garment')deps.$('garmentFile').click();else if(command==='frame')deps.$('outpaintWidth').focus();else if(command==='mask'){deps.setTool('add');deps.$('addTool').focus();}else deps.$('sourceImageFile').click();});
  deps.$('studioCommandToggle')?.addEventListener('click',()=>{if(studioCommandCollapseTimer){clearTimeout(studioCommandCollapseTimer);studioCommandCollapseTimer=null;}const collapse=!deps.$('studioCommandBar').classList.contains('is-collapsed');studioCommandManuallyCollapsed=collapse;setStudioCommandCollapsed(collapse);});
  document.querySelector('.brand')?.addEventListener('click',(event)=>{event.preventDefault();activateAppView('create');});
  for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>activateAppView(button.dataset.view));
    deps.$('hubView').addEventListener('click',(event)=>{if(event.target.closest('[data-clear-browser-data]')){
      const status=deps.$('hubView').querySelector('[data-browser-data-status]');
      if(deps.activeJobId&&!['completed','failed','cancelled','restart-required'].includes(deps.activityState?.status)){status.textContent='Hãy đợi tác vụ đang chạy kết thúc trước khi xóa dữ liệu trình duyệt.';return;}
      if(!window.confirm('Xóa dữ liệu AI Atelier trong trình duyệt này? Prompt cục bộ và tùy chỉnh sẽ được đặt lại. Ảnh, model, kết quả và dữ liệu lưu trên ổ đĩa được giữ nguyên. Trang sẽ tải lại.'))return;
      try{if(deps.jobPollTimer)clearInterval(deps.jobPollTimer);deps.jobEventSource?.close();window.AtelierBrowserData.clear();window.location.reload();}catch(error){status.textContent='Không thể xóa dữ liệu: '+error.message;}
      return;
    }const returnButton=event.target.closest('[data-view-return]');if(returnButton){activateAppView('create');return;}const settingsView=event.target.closest('[data-settings-view]');if(settingsView){activateAppView(settingsView.dataset.settingsView);return;}if(event.target.closest('[data-open-model-manager]')){deps.openModelManager();return;}const proxy=event.target.closest('[data-trigger]');if(proxy){const target=deps.$(proxy.dataset.trigger);if(!target){deps.setMessage('Chức năng này chưa được kết nối.', 'error');return;}if(target.disabled){activateAppView('create');target.scrollIntoView({behavior:'smooth',block:'center'});deps.setMessage(target.title||'Chức năng chưa sẵn sàng; hãy hoàn tất dữ liệu đầu vào trước.', 'error');return;}target.click();}});
  for(const step of document.querySelectorAll('.journey-steps li')){const activateStep=()=>{for(const item of document.querySelectorAll('.journey-steps li'))item.classList.remove('active');step.classList.add('active');const target=deps.$(step.dataset.stepTarget);if(target){activateAppView('create');target.scrollIntoView({behavior:'smooth',block:'center'});target.focus({preventScroll:true});}};step.addEventListener('click',activateStep);step.addEventListener('keydown',(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activateStep();}});}
  deps.$('helpButton').addEventListener('click',()=>deps.$('helpDialog').showModal());
  deps.$('headerModelButton')?.addEventListener('click',()=>deps.openModelManager());
  deps.$('closeHelp').addEventListener('click',()=>deps.$('helpDialog').close());
    deps.$('closeModelManager').addEventListener('click',()=>deps.$('modelManagerDialog').close());
    for(const button of document.querySelectorAll('[data-model-tab]'))button.addEventListener('click',()=>deps.setModelManagerTab(button.dataset.modelTab));
    deps.$('registeredModelSearch')?.addEventListener('input',deps.renderRegisteredModels);
    deps.$('registeredModelStatus')?.addEventListener('change',deps.renderRegisteredModels);
}
return {bindings:{get studioCommandCollapseTimer(){return studioCommandCollapseTimer;},set studioCommandCollapseTimer(value){studioCommandCollapseTimer=value;},
get studioCommandAutoKey(){return studioCommandAutoKey;},set studioCommandAutoKey(value){studioCommandAutoKey=value;},
get studioCommandManuallyCollapsed(){return studioCommandManuallyCollapsed;},set studioCommandManuallyCollapsed(value){studioCommandManuallyCollapsed=value;},
get HUBS(){return HUBS;},set HUBS(value){HUBS=value;},
get restartAtelierWeb(){return restartAtelierWeb;},set restartAtelierWeb(value){restartAtelierWeb=value;},
get renderHub(){return renderHub;},set renderHub(value){renderHub=value;},
get activateAppView(){return activateAppView;},set activateAppView(value){activateAppView=value;},
get studioMode(){return studioMode;},set studioMode(value){studioMode=value;},
get studioTaskMasks(){return studioTaskMasks;},set studioTaskMasks(value){studioTaskMasks=value;},
get switchTaskMask(){return switchTaskMask;},set switchTaskMask(value){switchTaskMask=value;},
get loadTryonModelOptions(){return loadTryonModelOptions;},set loadTryonModelOptions(value){loadTryonModelOptions=value;},
get refreshStudioReadiness(){return refreshStudioReadiness;},set refreshStudioReadiness(value){refreshStudioReadiness=value;},
get revealStudioCreateAction(){return revealStudioCreateAction;},set revealStudioCreateAction(value){revealStudioCreateAction=value;},
get setStudioCommandCollapsed(){return setStudioCommandCollapsed;},set setStudioCommandCollapsed(value){setStudioCommandCollapsed=value;},
get scheduleStudioCommandCollapse(){return scheduleStudioCommandCollapse;},set scheduleStudioCommandCollapse(value){scheduleStudioCommandCollapse=value;},
get updateStudioCommandVisibility(){return updateStudioCommandVisibility;},set updateStudioCommandVisibility(value){updateStudioCommandVisibility=value;},
get updateStudioCommandBar(){return updateStudioCommandBar;},set updateStudioCommandBar(value){updateStudioCommandBar=value;},
get setExperienceMode(){return setExperienceMode;},set setExperienceMode(value){setExperienceMode=value;},
get setStudioMode(){return setStudioMode;},set setStudioMode(value){setStudioMode=value;},
get restoreModelSortPreferences(){return restoreModelSortPreferences;},set restoreModelSortPreferences(value){restoreModelSortPreferences=value;},
get setupExperience(){return setupExperience;},set setupExperience(value){setupExperience=value;}},steps:[
function initialize(){
(studioCommandCollapseTimer = null);
},
function initialize(){
(studioCommandAutoKey = '');
},
function initialize(){
(studioCommandManuallyCollapsed = false);
},
function initialize(){
(HUBS = {
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
    eyebrow:'HOẠT ĐỘNG', title:'Trung tâm xử lý', description:'Theo dõi tiến độ, xử lý việc cần chú ý và xem lại kết quả gần đây.',
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
});
},
function initialize(){
(studioMode = 'tryon');
},
function initialize(){
(studioTaskMasks = {});
}
]};
};
