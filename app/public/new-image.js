/* Source-preserving new-image workflow. All mutations stay on the local service. */
window.NewImage=(()=>{
  let timer=null, sequence=0, busy=false, cards=[], selected=null, valid=null;
  const value=id=>document.getElementById(id).value;
  const el=id=>document.getElementById(id);
  const esc=value=>globalThis.AtelierApp.escapeHtml(String(value??''));
  function payload(){return {modelId:value('textToImageModel'),prompt:value('chromaPrompt'),negativePrompt:value('chromaNegativePrompt'),
    clipPrompt:value('chromaClipPrompt'),clipNegativePrompt:value('chromaClipNegative'),size:Number(value('chromaSize')),
    aspectRatio:value('chromaAspect'),framing:value('chromaFraming'),steps:Number(value('chromaQuality')),guidance:Number(value('chromaGuidance')),
    count:Number(value('chromaCount')),quality:['fast','balanced','quality'].includes(globalThis.AtelierApp.textQuality)?globalThis.AtelierApp.textQuality:'custom',
    skipLayerGuidance:el('chromaSlg').checked};}
  async function api(path,body){
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể thực hiện yêu cầu.');return result;
  }
  function sync(){
    const model=value('textToImageModel'),klein=model==='flux-2-klein-4b',sd35=model==='sd35-medium';
    el('chromaGuidance').disabled=klein;if(klein)el('chromaGuidance').value='1';
    el('newImageClipFields').hidden=!sd35;el('chromaSlgLabel').hidden=!sd35;if(!sd35)el('chromaSlg').checked=false;
    const [a,b]=value('chromaAspect').split(':').map(Number),size=Number(value('chromaSize'));
    const w=Math.max(256,Math.round(size*Math.sqrt(a/b)/32)*32),h=Math.max(256,Math.round(size*Math.sqrt(b/a)/32)*32);
    el('newImageDimensions').textContent=`Ảnh tạo: ${w} × ${h} px · chọn một phương án để hoàn thiện.${model==='flux-chroma1-hd'?' Chroma có thể cần nhiều phút mỗi ảnh.':''}`;
    sequence++;valid=null;el('newImagePlan').textContent='Mô tả sẽ được kiểm tra trước khi tạo. Không tự cắt nội dung.';
  }
  function renderPlan(result){
    valid=result.valid;
    el('newImagePlan').classList.toggle('has-error',!result.valid);
    el('newImagePlan').innerHTML=`<strong>${result.valid?'Đã kiểm tra · mô tả nằm trong giới hạn':'Cần điều chỉnh mô tả'}</strong>`+
      result.encoders.map(item=>`<small>${esc(item.name)}: mô tả ${item.promptTokens}/${item.limit}${item.negative_promptTokens===undefined?'':` · điều cần tránh ${item.negative_promptTokens}/${item.limit}`} token</small>`).join('')+
      [...result.errors,...result.warnings].map(item=>`<p>${esc(item)}</p>`).join('')+
      `<details><summary>Xem nội dung thực gửi vào model</summary>${result.encoders.map(item=>`<strong>${esc(item.name)}</strong><pre>${esc(item.prompt)}</pre>${item.negative_prompt===undefined?'':`<small>Điều cần tránh</small><pre>${esc(item.negative_prompt)||'(trống)'}</pre>`}`).join('')}</details>`;
    if(!result.valid&&result.profile.family==='sd35')el('newImageClipFields').open=true;
    globalThis.AtelierApp.refreshStudioReadiness();
  }
  async function check(body=payload()){
    const revision=++sequence;
    el('newImagePlan').textContent='Đang đọc giới hạn của model…';
    const result=await api('/api/new-image-plan',body);
    if(revision===sequence)renderPlan(result);
    return result;
  }
  function schedule(){clearTimeout(timer);sequence++;valid=null;timer=setTimeout(()=>{if(value('chromaPrompt').trim())check().catch(error=>{el('newImagePlan').textContent=error.message;});},700);}
  function render(){
    el('chromaGallery').innerHTML=cards.map((item,index)=>`<article class="result-card ${selected===index?'new-image-selected':''}">
      <img src="${esc(item.image||globalThis.AtelierApp.outputUrl(item.file))}" alt="Phương án ${index+1}, seed ${esc(item.seed)}" data-new-open="${index}">
      <p>${esc(globalThis.AtelierApp.textToImageModels.get(item.model)?.name||item.model||'Ảnh đã lưu')} · seed ${esc(item.seed)}<br>${esc(item.width||'')} × ${esc(item.height||'')} ${item.method==='upscale'?'· phóng lớn giữ bố cục':item.method==='detail'?'· tinh chỉnh AI':''}</p>
      <div class="button-row"><button type="button" data-new-select="${index}">${selected===index?'Đã chọn':'Chọn phương án'}</button><a class="button-link" href="${esc(item.image||globalThis.AtelierApp.outputUrl(item.file))}" download>Tải ảnh</a></div></article>`).join('');
    let host=el('newImageFinish');if(!host){host=document.createElement('section');host.id='newImageFinish';host.className='new-image-finish';el('chromaGallery').after(host);}
    const item=cards[selected];host.hidden=!item;
    if(!item)return;
    host.innerHTML=`<strong>Hoàn thiện phương án ${selected+1}</strong><p>Phóng lớn 2× giữ bố cục bằng nội suy và tăng nét nhẹ. Tinh chỉnh AI dùng chính ảnh đã chọn, có thể thay đổi chi tiết; hãy xem so sánh trước khi dùng.</p><div class="button-row"><button data-new-refine="upscale" ${!item.source||busy||item.width*item.height*4>5000000?'disabled':''}>Phóng lớn 2×</button>${item.canDetail?`<button data-new-refine="detail" ${busy?'disabled':''}>Tinh chỉnh AI nhẹ</button>`:''}<button data-new-enhance ${busy?'disabled':''}>Cải thiện ảnh này</button><button data-new-edit ${busy?'disabled':''}>Chỉnh sửa tiếp</button><button data-manual-url="${esc(item.image||globalThis.AtelierApp.outputUrl(item.file))}" data-manual-name="Ảnh mới · phương án ${selected+1}" ${busy?'disabled':''}>Chỉnh sửa thủ công</button></div><small>Mở ảnh trong Studio để xóa vật thể, thay trang phục hoặc mở rộng khung ảnh.</small>`;
  }
  async function execute(request,source=null){
    const jobId=globalThis.AtelierApp.createJobId('text-to-image');globalThis.AtelierApp.setActiveJob(jobId);
    try{
      const result=await api('/api/chroma-generate',{...request,jobId,livePreview:true});
      if(source){cards=[...cards,...result.results];selected=cards.length-1;showComparison(source,result.results[0]);}
      else {cards=result.results;selected=null;el('newImageComparison')?.remove();}
      render();
      window.QualityLearning?.notifyJob({jobId,status:'completed',taskType:'text-to-image'});
      el('chromaGalleryMeta').textContent=`${result.results.length} phương án · tổng ${result.totalSeconds??result.elapsedSeconds}s · nạp model ${result.loadingSeconds??'—'}s · xử lý ${result.inferenceSeconds??'—'}s · VRAM ${result.peakVramMb} MB`;
      globalThis.AtelierApp.setMessage('Đã lưu ảnh. Chọn phương án để hoàn thiện hoặc chỉnh sửa tiếp.','success');
      await globalThis.AtelierApp.pollJobStatus();
    }catch(error){
      await globalThis.AtelierApp.pollJobStatus().catch(()=>{});
      if(globalThis.AtelierApp.activityState?.results?.length)restore(globalThis.AtelierApp.activityState);
      el('chromaGalleryMeta').textContent=error.message;globalThis.AtelierApp.setMessage(error.message,'error');
    }finally{globalThis.AtelierApp.setActiveJob('');}
  }
  async function generate(){
    if(busy||globalThis.AtelierApp.activeJobId)return globalThis.AtelierApp.setMessage('Hãy đợi tác vụ hiện tại hoàn tất.','error');
    if(!value('chromaPrompt').trim()){el('chromaPrompt').focus();return globalThis.AtelierApp.setMessage('Hãy nhập mô tả ảnh.','error');}
    if(value('textToImagePipeline')!=='generate')return globalThis.AtelierApp.runExtendedTextPipeline(value('textToImagePipeline'),value('chromaPrompt'));
    busy=true;el('chromaGenerateButton').disabled=true;
    try{
      const body={...payload(),seed:globalThis.AtelierApp.seedForRun('chromaSeed')};
      const result=await check(body);if(!result.valid)throw new Error(result.errors.join(' '));
      await execute(body);
    }catch(error){globalThis.AtelierApp.setMessage(error.message,'error');}
    finally{busy=false;globalThis.AtelierApp.updateTextToImageAvailability();render();}
  }
  function showComparison(before,after){
    el('newImageComparison')?.remove();const section=document.createElement('section');section.id='newImageComparison';section.className='new-image-comparison';
    section.innerHTML=`<p>So sánh trước / sau · bấm ảnh để xem ở kích thước đầy đủ</p><div><figure><img src="${esc(before.image||globalThis.AtelierApp.outputUrl(before.file))}" alt="Bố cục đã chọn"><figcaption>Bố cục đã chọn</figcaption></figure><figure><img src="${esc(after.image)}" alt="Ảnh hoàn thiện"><figcaption>Ảnh hoàn thiện</figcaption></figure></div>`;
    for(const img of section.querySelectorAll('img'))img.addEventListener('click',()=>globalThis.AtelierApp.openImageAtFullSize(img.src,img.alt));
    el('chromaGallery').after(section);
  }
  async function refine(method){
    if(busy||globalThis.AtelierApp.activeJobId)return;const source=cards[selected];if(!source?.source)return;
    busy=true;render();
    try{await execute({runMode:'refine',source:source.source,sourceSha:source.sha256,method},source);}
    finally{busy=false;render();}
  }
  function restore(state){
    if(!state?.results?.length)return;
    cards=state.results.map(item=>({...item,model:item.model||state.model,image:item.image||globalThis.AtelierApp.outputUrl(item.file)}));selected=null;render();
    el('chromaGalleryMeta').textContent=`${cards.length} ảnh đã lưu${state.durationSeconds===undefined?'':` · tổng ${state.durationSeconds}s · nạp model ${state.loadingSeconds??'—'}s · xử lý ${state.inferenceSeconds??'—'}s`}`;
    el('newImageComparison')?.remove();const finished=cards.find(item=>item.parentImage);if(finished)showComparison({image:finished.parentImage},finished);
  }
  async function edit(mode='inpaint'){
    const item=cards[selected];if(!item||busy||globalThis.AtelierApp.activeJobId)return;
    const response=await fetch(item.image||globalThis.AtelierApp.outputUrl(item.file));if(!response.ok)throw new Error('Không thể đọc ảnh đã chọn.');
    const blob=await response.blob();await globalThis.AtelierApp.uploadSourceImage(new File([blob],'anh-moi-chinh-sua.png',{type:blob.type}));
    if(globalThis.AtelierApp.activityState?.jobId)globalThis.AtelierApp.dismissedProgressJobs.add(globalThis.AtelierApp.activityState.jobId);
    for(const id of ['activityCenter','editorLiveProgress','chromaLiveProgress','editorPromptTrace','chromaPromptTrace'])if(el(id))el(id).hidden=true;
    el('accessoryPreset').value='custom';globalThis.AtelierApp.applyPreset('custom');
    globalThis.AtelierApp.setStudioMode(mode);globalThis.AtelierApp.setTool('add');globalThis.AtelierApp.activateAppView('create');
    globalThis.AtelierApp.setMessage('Đã mở ảnh trong Studio. Chọn công cụ, khoanh vùng và nhập yêu cầu.','success');
  }
  function initialize(){
    const basic=el('newImageComposition');for(const id of ['chromaCount','chromaSize'])basic.append(el(id).closest('label'));
    for(const id of ['chromaPrompt','chromaNegativePrompt','chromaClipPrompt','chromaClipNegative'])el(id).addEventListener('input',schedule);
    for(const id of ['chromaAspect','chromaFraming','textToImageModel'])el(id).addEventListener('change',()=>{sync();schedule();});
    el('newImageCheck').addEventListener('click',()=>check().catch(error=>{el('newImagePlan').textContent=error.message;}));
    el('suggestClipPrompt').addEventListener('click',()=>globalThis.AtelierApp.runPromptAssist({task:'shortenPrompt',targetId:'chromaClipPrompt',buttonId:'suggestClipPrompt',statusId:'clipPromptAssistStatus',title:'Bản ngắn cho CLIP',context:'Preserve key visual constraints from this full prompt: '+value('chromaPrompt')}));
    document.addEventListener('click',event=>{
      const select=event.target.closest('[data-new-select]'),open=event.target.closest('[data-new-open]'),finish=event.target.closest('[data-new-refine]'),ratio=event.target.closest('[data-new-image-ratio]');
      if(select){selected=Number(select.dataset.newSelect);window.QualityLearning?.selection({file:cards[selected].image||globalThis.AtelierApp.outputUrl(cards[selected].file)});render();}
      if(open){const item=cards[Number(open.dataset.newOpen)];globalThis.AtelierApp.openImageAtFullSize(item.image||globalThis.AtelierApp.outputUrl(item.file),'Ảnh mới');}
      if(finish)refine(finish.dataset.newRefine).catch(error=>globalThis.AtelierApp.setMessage(error.message,'error'));
      if(ratio){el('chromaAspect').value=ratio.dataset.newImageRatio;sync();}
      if(event.target.closest('[data-new-enhance]'))edit('enhance').catch(error=>globalThis.AtelierApp.setMessage(error.message,'error'));
      if(event.target.closest('[data-new-edit]'))edit().catch(error=>globalThis.AtelierApp.setMessage(error.message,'error'));
    });
    sync();
    fetch('/api/new-image-config').then(r=>r.json()).then(result=>{if(!result.serviceReady)el('newImagePlan').textContent='Dịch vụ AI cần được khởi động lại để dùng bản nâng cấp Ảnh mới.';}).catch(()=>{});
  }
  initialize();return {generate,check,sync,restore,payload,promptReady:()=>valid!==false};
})();
