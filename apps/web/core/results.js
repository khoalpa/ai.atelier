'use strict';
// Owned state: currentRunDirectory, studioSelectedResult, studioPendingResult, studioViewingResult, imagePromptRequest, studioResultModes, studioResultDrafts
// Dependencies: $, STAGE_LABELS, activateAppView, activeJobId, activityState, canvas, current, dismissedProgressJobs, escapeHtml, outputUrl, restoreCanvasBeforeDoubleClick, setActiveJob, setMessage, setReviewStatus, setStudioMode, setTool, sourceImage, uploadSourceImage
module.exports=function createResults(deps){
let currentRunDirectory, studioSelectedResult, studioPendingResult, studioViewingResult, imagePromptRequest, studioResultModes, studioResultDrafts;
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
  const dialog=deps.$('imageViewerDialog'),image=deps.$('imageViewerImage');
  loadImagePromptTrace(source);
  deps.$('imageViewerTitle').textContent=alt||'Ảnh ở kích thước 100%';
  deps.$('imageViewerMeta').textContent='Đang tải ảnh ở kích thước gốc…';
  deps.$('saveViewerImageButton').disabled=true;
  deps.$('sendViewerImageToStudioButton').disabled=true;
  image.alt=alt||'Ảnh phóng to';
  image.style.maxWidth='none';
  image.style.maxHeight='none';
  deps.$('toggleViewerFitButton').textContent='Xem toàn ảnh';
  deps.$('toggleViewerFitButton').setAttribute('aria-pressed','false');
  image.src=source;
  if(!dialog.open)dialog.showModal();
}

async function sendViewerImageToStudio(){
  const image=deps.$('imageViewerImage'),button=deps.$('sendViewerImageToStudioButton');
  const source=image.currentSrc||image.src;
  if(!source||!image.naturalWidth||button.disabled)return;
  if(deps.activeJobId&&!['completed','failed','cancelled','restart-required'].includes(deps.activityState?.status))return deps.setMessage('Hãy đợi tác vụ đang chạy hoàn tất trước khi chuyển ảnh sang Studio.','error');
  button.disabled=true;button.textContent='Đang chuyển…';
  try{
    const currentSource=deps.sourceImage?.currentSrc||deps.sourceImage?.src;
    if(currentSource&&new URL(source,document.baseURI).href===new URL(currentSource,document.baseURI).href){
      deps.$('imageViewerDialog').close();deps.activateAppView('create');
      deps.setMessage('Ảnh này đã là ảnh nguồn trong Studio.','success');
      return;
    }
    const response=await fetch(source);
    if(!response.ok)throw new Error('Không thể đọc ảnh để chuyển sang Studio.');
    const blob=await response.blob();
    const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[blob.type];
    if(!extension)throw new Error('Studio chỉ hỗ trợ ảnh PNG, JPG hoặc WebP.');
    let base='anh-tu-trinh-xem';
    try{base=decodeURIComponent(new URL(source,document.baseURI).pathname.split('/').pop()||base).replace(/\.[^.]+$/,'')||base;}catch{}
    await deps.uploadSourceImage(new File([blob],`${base}-studio.${extension}`,{type:blob.type}));
    deps.$('imageViewerDialog').close();deps.activateAppView('create');
    deps.setMessage('Đã chuyển ảnh sang Studio và đặt làm ảnh nguồn.','success');
  }catch(error){deps.setMessage(error.message,'error');}
  finally{button.textContent='Dùng trong Studio';button.disabled=!image.naturalWidth;}
}

async function loadImagePromptTrace(source){
  const host=deps.$('imagePromptTrace'),request=++imagePromptRequest;
  if(!host)return;
  host.hidden=true;
  if(!String(source).startsWith('/outputs/'))return;
  try{const response=await fetch('/api/output-prompts?file='+encodeURIComponent(source.slice('/outputs/'.length))),data=await response.json();if(request!==imagePromptRequest)return;if(!response.ok||!data.ok)return;renderPromptTrace(host,{jobId:source,promptHistory:data.promptHistory||[]});}catch{}
}

function promptTraceMarkup(history){
  const strategy={direct:'Áp dụng trực tiếp','merged-into-positive':'Ghép vào prompt chính',unused:'Không áp dụng negative prompt riêng trong lần gọi này'};
  return history.map((entry,index)=>`<article class="prompt-trace-entry"><h4>Lần gọi ${index+1} · ${deps.escapeHtml(deps.STAGE_LABELS[entry.stage]||entry.stage)}${entry.autoRetry?' · Tự thử lại':''}</h4><small>${deps.escapeHtml(entry.model)} · Seed ${deps.escapeHtml(entry.seed??'—')} · ${deps.escapeHtml(entry.timestamp)}${entry.sampleId?' · '+deps.escapeHtml(entry.sampleId):''}</small><p>Negative prompt: ${deps.escapeHtml(strategy[entry.negativePromptStrategy]||'Chưa xác định')}</p>${Object.entries(entry.tokenBudget||{}).map(([key,budget])=>`<p>${deps.escapeHtml(key==='prompt'?'Bộ mã hóa văn bản':key)}: ${deps.escapeHtml((budget.tokens||[]).join(', '))} / ${deps.escapeHtml(budget.limit)} token</p>`).join('')}${Object.keys(entry.prompts||{}).length?Object.entries(entry.prompts).map(([key,value])=>`<strong>${deps.escapeHtml(key)}</strong><pre>${deps.escapeHtml(Array.isArray(value)?value.join('\n'):String(value??''))}</pre>`).join(''):'<p>Bước này không sử dụng prompt văn bản.</p>'}<details><summary>Nguồn tạo prompt và cấu hình</summary><strong>Prompt người dùng</strong><pre>${deps.escapeHtml(entry.userPrompt||'(Trống)')}</pre><strong>Negative prompt người dùng</strong><pre>${deps.escapeHtml(entry.userNegativePrompt||'(Trống)')}</pre><pre>${deps.escapeHtml(JSON.stringify({sources:entry.sources,resolvedSources:entry.resolvedSources,parameters:entry.parameters,pipeline:entry.pipeline},null,2))}</pre></details></article>`).join('');
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
  host.innerHTML=`<details class="prompt-trace" ${open?'open':''}><summary>Prompt đang dùng · ${latest?'Seed '+deps.escapeHtml(latest.seed??'—'):'Đang chuẩn bị'}</summary><div class="button-row"><button type="button" data-trace-expand>Xem rộng</button><button type="button" data-trace-copy ${history.length?'':'disabled'}>Sao chép</button><button type="button" data-trace-download ${history.length?'':'disabled'}>Tải chi tiết JSON</button></div><div class="prompt-trace-content">${latest?promptTraceMarkup([latest]):'<p>Chưa ghi nhận lần gọi model nào.</p>'}${history.length>1?`<details><summary>Các lần gọi trước (${history.length-1})</summary>${promptTraceMarkup(history.slice(0,-1))}</details>`:''}</div></details>`;
  host.querySelector('[data-trace-expand]').onclick=()=>{
    const dialog=document.createElement('dialog');dialog.className='prompt-reader-dialog';
    dialog.innerHTML='<div class="prompt-reader-heading"><h2>Prompt đang dùng</h2><button type="button" autofocus>Đóng</button></div><div class="prompt-reader-content">'+(history.length?promptTraceMarkup(history):'<p>Chưa ghi nhận lần gọi model nào.</p>')+'</div>';
    dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
  };
  host.querySelector('[data-trace-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(history,null,2));deps.setMessage('Đã sao chép toàn bộ chi tiết prompt.','success');}catch{deps.setMessage('Không thể sao chép. Hãy dùng Tải chi tiết JSON.','error');}};
  host.querySelector('[data-trace-download]').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({jobId:state.jobId,promptHistory:history},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='prompt-'+String(state.jobId||'run').replace(/[^a-zA-Z0-9_-]/g,'')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
}

function renderRunPromptTraces(state){
  const target=state.taskType==='text-to-image'?deps.$('chromaLiveProgress'):deps.$('editorLiveProgress');
  const activeTrace=target?.id==='chromaLiveProgress'?'chromaPromptTrace':'editorPromptTrace';
  for(const id of ['chromaPromptTrace','editorPromptTrace']){const host=deps.$(id);if(host&&(id!==activeTrace||target.hidden))host.hidden=true;}
  if(target&&!target.hidden){let host=deps.$(target.id==='chromaLiveProgress'?'chromaPromptTrace':'editorPromptTrace');if(!host){host=document.createElement('div');host.id=target.id==='chromaLiveProgress'?'chromaPromptTrace':'editorPromptTrace';}if(host.parentElement!==target)target.append(host);renderPromptTrace(host,state);}
  renderPromptTrace(deps.$('resultPromptTrace'),state);
}

function showGenerationResult(state){
  if(!state)return;
  globalThis.QualityLearning?.notifyJob(state);
  if(state.taskType==='character')return window.Character.restore(state);
  if(state.taskType==='makeup')return window.Makeup.restore(state);
  if(state.taskType==='enhance')return window.ImageEnhancement.restore(state);
  if(state.taskType==='outpaint')return showSavedOutpaintResults(state);
  if(state.taskType==='text-to-image'){deps.activateAppView('create');deps.setStudioMode('chroma');}else deps.activateAppView('create');
  if(state.taskType==='text-to-image'){window.NewImage?.restore(state);deps.$('chromaGallery').scrollIntoView({behavior:'smooth',block:'center'});}
  else {
    const results=(state.results||[]).filter(item=>item.file);
    if(state.status!=='completed'||!deps.$('resultsGrid').children.length){
      if(!results.length)return deps.setMessage('Tác vụ chưa có ảnh kết quả được lưu.','error');
      deps.$('resultsGrid').innerHTML=results.map(item=>`<article class="result-card"><img src="${deps.escapeHtml(deps.outputUrl(item.file))}" alt="Kết quả seed ${deps.escapeHtml(item.seed??'')}"><p>Seed ${deps.escapeHtml(item.seed??'—')} · Ảnh đã lưu</p><a href="${deps.escapeHtml(deps.outputUrl(item.file))}" download>Tải ảnh</a></article>`).join('');
      deps.$('comparePanel').hidden=true;
    }else if(deps.$('studioResultsFilmstrip').children.length){
      deps.$('studioResultsTray').hidden=false;
      deps.$('studioResultsTray').scrollIntoView({behavior:'smooth',block:'start'});
      return;
    }
    deps.$('resultsDialog').classList.remove('guided-review-dialog');
    if(!deps.$('resultsDialog').open)deps.$('resultsDialog').showModal();
  }
}

function presentStudioResults(sourceUrl,selectedUrl=''){
  const tray=deps.$('studioResultsTray'),filmstrip=deps.$('studioResultsFilmstrip'),cards=[...deps.$('resultsGrid').querySelectorAll('.result-card')];if(!tray||!filmstrip||!cards.length)return;
  const results=cards.map((card,index)=>{const image=card.querySelector('img'),button=card.querySelector('[data-seed]'),description=card.querySelector('p')?.innerText||'';return {index,src:image?.getAttribute('src')||'',alt:image?.alt||`Phương án ${index}`,seed:button?.dataset.seed||'',description};}).filter((item)=>item.src);
  const candidates=results.filter((item)=>item.index>0);studioSelectedResult='';studioPendingResult='';studioViewingResult='';window.AtelierStore?.set({selectedResult:''});tray.hidden=false;deps.$('studioResultsMeta').textContent=`Đã tạo xong ${candidates.length} phương án · hãy xem và chọn kết quả cuối`;
  filmstrip.innerHTML=candidates.map((item,position)=>`<article class="studio-result-thumb" data-tray-index="${item.index}"><button class="studio-result-preview" type="button" aria-label="Xem phương án ${position+1}"><img src="${deps.escapeHtml(item.src)}" alt="${deps.escapeHtml(item.alt)}"></button><div class="studio-result-thumb-copy"><span><strong>Phương án ${position+1}</strong><small>${item.seed?`Seed ${deps.escapeHtml(item.seed)}`:deps.escapeHtml(item.description.split('\n')[0]||'Kết quả mới')}</small></span><span class="studio-selected-mark">✓</span></div><button type="button" data-tray-select ${item.seed?'':'disabled'}>Chọn phương án</button></article>`).join('');
  const titleFor=(item)=>`Phương án ${Math.max(1,candidates.indexOf(item)+1)}`;
  const updateSelection=()=>{const confirmed=candidates.find((item)=>item.src===studioSelectedResult),pending=candidates.find((item)=>item.src===studioPendingResult),viewing=candidates.find((item)=>item.src===studioViewingResult),status=deps.$('studioFocusStatus'),summary=deps.$('studioSelectionSummary');for(const node of filmstrip.querySelectorAll('.studio-result-thumb')){const item=results.find((entry)=>entry.index===Number(node.dataset.trayIndex)),selected=item?.src===studioSelectedResult,staged=item?.src===studioPendingResult&&!selected;node.classList.toggle('is-selected',selected);node.classList.toggle('is-pending',staged);const button=node.querySelector('[data-tray-select]');if(button)button.textContent=selected?'✓ Kết quả cuối':staged?'Chờ xác nhận':'Chọn phương án';}const viewingConfirmed=viewing&&viewing.src===studioSelectedResult,viewingPending=viewing&&viewing.src===studioPendingResult&&!viewingConfirmed;status.className=viewingConfirmed?'is-confirmed':viewingPending?'is-pending':'';status.textContent=viewingConfirmed?'✓ Đã chọn làm kết quả cuối':viewingPending?'Chờ xác nhận':'Đang xem · Chưa chọn';deps.$('studioChooseResult').disabled=!viewing||viewingConfirmed;deps.$('studioChooseResult').textContent=viewingConfirmed?'✓ Đã chọn làm kết quả cuối':viewingPending?'Đã chọn · xác nhận bên phải':'Chọn làm kết quả cuối';summary.className=`studio-selection-summary ${pending?'is-pending':confirmed?'is-confirmed':''}`;deps.$('studioSelectionState').textContent=pending?'LỰA CHỌN CHỜ XÁC NHẬN':confirmed?'ĐÃ XÁC NHẬN KẾT QUẢ CUỐI':'CHƯA CHỌN KẾT QUẢ CUỐI';deps.$('studioSelectionTitle').textContent=pending?titleFor(pending):confirmed?titleFor(confirmed):'Hãy chọn phương án phù hợp';deps.$('studioSelectionHint').textContent=pending?'Xem lại ảnh rồi xác nhận để hoàn tất lựa chọn.':confirmed?'Bạn vẫn có thể xem hoặc đổi sang phương án khác.':'Bạn có thể xem các ảnh khác mà không làm mất lựa chọn.';deps.$('studioConfirmResult').disabled=!pending;deps.$('studioConfirmResult').textContent=confirmed&&!pending?'✓ Đã xác nhận':'Xác nhận kết quả cuối';deps.$('studioSendToReview').disabled=!confirmed;refreshContinuationActions();};
  const focus=(item)=>{if(!item?.src)return;studioViewingResult=item.src;deps.$('studioCompareBefore').src=cards[item.index].dataset.sourceUrl||sourceUrl;deps.$('studioCompareAfter').src=item.src;deps.$('studioCompareAfterWrap').style.clipPath=`inset(0 ${100-Number(deps.$('studioCompareSlider').value)}% 0 0)`;deps.$('studioCompareStage').hidden=false;const title=titleFor(item),description=item.description.split('\n')[0]||'Kết quả chỉnh sửa mới';deps.$('studioFocusTitle').textContent=title;deps.$('studioFocusDescription').textContent=description;deps.$('studioActionTitle').textContent=title;deps.$('studioActionDescription').textContent=description;deps.$('studioDownloadResult').href=item.src;deps.$('studioDownloadResult').download=`ai-atelier-phuong-an-${Math.max(1,candidates.indexOf(item)+1)}.png`;for(const node of filmstrip.querySelectorAll('.studio-result-thumb'))node.classList.toggle('is-viewing',Number(node.dataset.trayIndex)===item.index);if(typeof syncOutpaintContextActions==='function')syncOutpaintContextActions(cards[item.index]);window.Character?.resultActions?.(cards[item.index]);updateSelection();};
  const stage=(item)=>{if(!item?.seed)return;if(item.src===studioSelectedResult){studioPendingResult='';focus(item);return;}studioPendingResult=item.src;focus(item);updateSelection();};
  for(const card of filmstrip.querySelectorAll('[data-tray-index]')){const item=results.find((entry)=>entry.index===Number(card.dataset.trayIndex));card.querySelector('.studio-result-preview')?.addEventListener('click',()=>focus(item));card.querySelector('[data-tray-select]')?.addEventListener('click',()=>stage(item));}
  deps.$('studioChooseResult').onclick=()=>stage(candidates.find((item)=>item.src===studioViewingResult));
  deps.$('studioConfirmResult').onclick=async()=>{const item=candidates.find((entry)=>entry.src===studioPendingResult),original=item&&cards[item.index].querySelector('[data-seed]');if(!item||!original)return;const selected=await selectPrimary(Number(item.seed),original);if(!selected)return;studioSelectedResult=item.src;studioPendingResult='';window.AtelierStore?.set({selectedResult:studioSelectedResult});focus(item);deps.setMessage(`${titleFor(item)} đã được xác nhận là kết quả cuối.`,'success');};
  focus(candidates.find((item)=>item.src===selectedUrl)||candidates[0]);
}

function refreshContinuationActions(){
  for(const id of ['studioContinueInpaint','studioContinueTryon','studioContinueOutpaint','studioContinueEnhance','studioContinueCharacter','studioManualResult']){
    const button=deps.$(id);if(button)button.disabled=!studioPendingResult&&!studioSelectedResult;
  }
}

async function continueFromSelectedResult(nextMode,branchParentId){
  const selected=studioPendingResult||studioSelectedResult;
  if(!selected)return deps.setMessage('Hãy chọn một phương án trước khi chỉnh sửa tiếp.','error');
  if(!['inpaint','tryon','outpaint','enhance','makeup','character'].includes(nextMode))return;
  if(deps.activeJobId&&!['completed','failed','cancelled','restart-required'].includes(deps.activityState?.status))return deps.setMessage('Hãy đợi tác vụ đang chạy hoàn tất trước khi chỉnh sửa tiếp.','error');
  const buttons=['studioContinueInpaint','studioContinueTryon','studioContinueOutpaint','studioContinueEnhance','studioContinueCharacter'].map(id=>deps.$(id)).filter(Boolean);
  let historyWarning='';
  buttons.forEach(button=>button.disabled=true);
  try{
    const url=selected.startsWith('data:')||selected.startsWith('/')?selected:deps.outputUrl(selected);
    const response=await fetch(url);if(!response.ok)throw new Error('Không thể đọc ảnh của phương án đã chọn.');
    const blob=await response.blob();
    const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[blob.type];
    if(!extension)throw new Error('Phương án không có định dạng ảnh được hỗ trợ.');
    const name=`${(deps.current?.name||'ket-qua').replace(/\.[^.]+$/,'')}-chinh-sua-tiep.${extension}`;
    const selectedCard=[...deps.$('resultsGrid').querySelectorAll('.result-card')].find(card=>card.querySelector('img')?.getAttribute('src')===selected);
    const branchSource=branchParentId||selectedCard?.querySelector('[data-seed]')?.dataset.sampleId||deps.current?.id;
    await deps.uploadSourceImage(new File([blob],name,{type:blob.type}));
    if(window.StudioGuidance&&branchSource)await window.StudioGuidance.recordBranch({sourceId:branchSource,childId:deps.current.id,result:url,task:selectedCard?.querySelector('[data-seed]')?.dataset.task||nextMode}).catch(error=>{historyWarning=` Chưa lưu được lịch sử: ${error.message}`;});
    if(deps.activityState?.jobId)deps.dismissedProgressJobs.add(deps.activityState.jobId);
    for(const id of ['activityCenter','editorLiveProgress','chromaLiveProgress','editorPromptTrace','chromaPromptTrace']){
      const panel=deps.$(id);if(panel)panel.hidden=true;
    }
    currentRunDirectory='';studioSelectedResult='';studioPendingResult='';studioViewingResult='';
    deps.$('resultsGrid').replaceChildren();deps.$('comparePanel').hidden=true;deps.$('studioCompareStage').hidden=true;
    window.AtelierStore?.set({selectedResult:''});
    if(deps.activeJobId)deps.setActiveJob(null);
    deps.setStudioMode(nextMode);deps.setTool('add');
    deps.setMessage(`Đã dùng phương án đã chọn làm ảnh nguồn mới. ${nextMode==='character'?'Nhận diện nhân vật rồi chọn tư thế hoặc biểu cảm.':nextMode==='makeup'?'Nhận diện khuôn mặt và chọn phong cách trang điểm.':nextMode==='enhance'?'Chọn cách cải thiện và xem thử một vùng.':nextMode==='outpaint'?'Chọn khung mở rộng mới.':nextMode==='inpaint'?'Chọn vùng cần xóa.':'Chọn trang phục và vùng cần thay.'}${historyWarning}`,historyWarning?'error':'success');
  }catch(error){deps.setMessage(error.message,'error');}
  finally{refreshContinuationActions();}
}

function showCompare(before, after) {
  deps.$('compareBefore').src = before;
  deps.$('compareAfter').src = after;
  deps.$('comparePanel').hidden = false;
  deps.$('compareSlider').value = 50;
  deps.$('compareAfterWrap').style.width = '50%';
}

async function selectPrimary(seed, button) {
  try {
    const response = await fetch('/api/select-result', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({directory: button.dataset.directory||currentRunDirectory, seed}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    for (const item of deps.$('resultsGrid').querySelectorAll('[data-seed]')) item.textContent = 'Chọn làm kết quả chính';
    button.textContent = '✓ Đã chọn';
    studioSelectedResult=result.selected;
    globalThis.QualityLearning?.selection({directory:button.dataset.directory||currentRunDirectory,seed});
    const sampleId=button.dataset.sampleId||deps.current.id;
    await deps.setReviewStatus(sampleId, 'pending', result.selected);
    deps.setMessage(`Đã chọn seed ${seed} · ${result.selected}`, 'success');
    return result.selected;
  } catch (error) { deps.setMessage(error.message, 'error'); return ''; }
}

function studioResultInstructionsDirty(){
  const id=deps.$('inpaintFillMode').value;
  return studioResultDrafts.has(id)&&studioResultDrafts.get(id)!==studioResultModes.find(mode=>mode.id===id)?.prompt;
}

function showStudioResultInstructions(){
  const field=deps.$('inpaintFillModePrompt');if(!field)return;
  const id=deps.$('inpaintFillMode').value,mode=studioResultModes.find(mode=>mode.id===id);
  field.value=studioResultDrafts.get(id)??mode?.prompt??'';
  field.disabled=!mode;deps.$('saveInpaintFillModePrompt').disabled=!mode;
  deps.$('inpaintFillModePromptStatus').textContent=mode?(studioResultInstructionsDirty()?'Có thay đổi chưa lưu.':'Dùng chung với hướng dẫn trong màn Prompt.'): 'Chưa tải được hướng dẫn.';
}

async function loadStudioResultInstructions(){
  try{
    const response=await fetch('/api/processing-modes'),result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tải hướng dẫn.');
    studioResultModes=result.modes;showStudioResultInstructions();
  }catch(error){deps.$('inpaintFillModePromptStatus').textContent=error.message;}
}

function setupStudioResultInstructions(){
  deps.$('inpaintFillMode').addEventListener('change',showStudioResultInstructions);
  deps.$('inpaintFillModePrompt').addEventListener('input',()=>{
    studioResultDrafts.set(deps.$('inpaintFillMode').value,deps.$('inpaintFillModePrompt').value);
    deps.$('inpaintFillModePromptStatus').textContent=studioResultInstructionsDirty()?'Có thay đổi chưa lưu.':'Dùng chung với hướng dẫn trong màn Prompt.';
  });
  deps.$('saveInpaintFillModePrompt').addEventListener('click',async()=>{
    const id=deps.$('inpaintFillMode').value,prompt=deps.$('inpaintFillModePrompt').value,button=deps.$('saveInpaintFillModePrompt');
    if(!prompt.trim()){deps.$('inpaintFillModePromptStatus').textContent='Hãy nhập nội dung hướng dẫn.';return;}
    button.disabled=true;
    try{
      const response=await fetch('/api/processing-modes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,prompt})}),result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Không thể lưu hướng dẫn.');
      studioResultModes=result.modes;
      if(studioResultDrafts.get(id)===prompt)studioResultDrafts.delete(id);
      showStudioResultInstructions();
    }catch(error){deps.$('inpaintFillModePromptStatus').textContent=error.message;}finally{button.disabled=false;}
  });
  loadStudioResultInstructions();
}
return {bindings:{get currentRunDirectory(){return currentRunDirectory;},set currentRunDirectory(value){currentRunDirectory=value;},
get studioSelectedResult(){return studioSelectedResult;},set studioSelectedResult(value){studioSelectedResult=value;},
get studioPendingResult(){return studioPendingResult;},set studioPendingResult(value){studioPendingResult=value;},
get studioViewingResult(){return studioViewingResult;},set studioViewingResult(value){studioViewingResult=value;},
get downloadFullSizeImage(){return downloadFullSizeImage;},set downloadFullSizeImage(value){downloadFullSizeImage=value;},
get openImageAtFullSize(){return openImageAtFullSize;},set openImageAtFullSize(value){openImageAtFullSize=value;},
get sendViewerImageToStudio(){return sendViewerImageToStudio;},set sendViewerImageToStudio(value){sendViewerImageToStudio=value;},
get imagePromptRequest(){return imagePromptRequest;},set imagePromptRequest(value){imagePromptRequest=value;},
get loadImagePromptTrace(){return loadImagePromptTrace;},set loadImagePromptTrace(value){loadImagePromptTrace=value;},
get promptTraceMarkup(){return promptTraceMarkup;},set promptTraceMarkup(value){promptTraceMarkup=value;},
get renderPromptTrace(){return renderPromptTrace;},set renderPromptTrace(value){renderPromptTrace=value;},
get renderRunPromptTraces(){return renderRunPromptTraces;},set renderRunPromptTraces(value){renderRunPromptTraces=value;},
get showGenerationResult(){return showGenerationResult;},set showGenerationResult(value){showGenerationResult=value;},
get presentStudioResults(){return presentStudioResults;},set presentStudioResults(value){presentStudioResults=value;},
get refreshContinuationActions(){return refreshContinuationActions;},set refreshContinuationActions(value){refreshContinuationActions=value;},
get continueFromSelectedResult(){return continueFromSelectedResult;},set continueFromSelectedResult(value){continueFromSelectedResult=value;},
get showCompare(){return showCompare;},set showCompare(value){showCompare=value;},
get selectPrimary(){return selectPrimary;},set selectPrimary(value){selectPrimary=value;},
get studioResultModes(){return studioResultModes;},set studioResultModes(value){studioResultModes=value;},
get studioResultDrafts(){return studioResultDrafts;},set studioResultDrafts(value){studioResultDrafts=value;},
get studioResultInstructionsDirty(){return studioResultInstructionsDirty;},set studioResultInstructionsDirty(value){studioResultInstructionsDirty=value;},
get showStudioResultInstructions(){return showStudioResultInstructions;},set showStudioResultInstructions(value){showStudioResultInstructions=value;},
get loadStudioResultInstructions(){return loadStudioResultInstructions;},set loadStudioResultInstructions(value){loadStudioResultInstructions=value;},
get setupStudioResultInstructions(){return setupStudioResultInstructions;},set setupStudioResultInstructions(value){setupStudioResultInstructions=value;}},steps:[
function initialize(){
(currentRunDirectory = '');
},
function initialize(){
(studioSelectedResult = '');
},
function initialize(){
(studioPendingResult = '');
},
function initialize(){
(studioViewingResult = '');
},
function initialize(){
document.addEventListener('dblclick',(event)=>{
  const image=event.target;
  if(image===deps.canvas&&deps.sourceImage){
    event.preventDefault();
    deps.restoreCanvasBeforeDoubleClick();
    openImageAtFullSize(deps.sourceImage.currentSrc||deps.sourceImage.src,'Ảnh nguồn · 100%');
    return;
  }
  if(!(image instanceof HTMLImageElement)||image.id==='imageViewerImage'||!image.currentSrc)return;
  event.preventDefault();
  openImageAtFullSize(image.currentSrc,image.alt||'Ảnh ở kích thước 100%');
});
},
function initialize(){
(imagePromptRequest = 0);
},
function initialize(){
(studioResultModes = []);
},
function initialize(){
(studioResultDrafts = new Map());
}
]};
};
