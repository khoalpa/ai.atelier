/* Makeup owns face selection; all painting still uses Studio's full-size canvases. */
window.Makeup=(()=>{
  const el=id=>document.getElementById(id);
  let config=null,analysis=null,face=null,busy=false,extensionBusy=false,revision=0,planned='',prompt='',styleName='',runSeed=42,regionImages={},restoreInProgress=false,previewReady=false;
  const parts=()=>[...document.querySelectorAll('[data-makeup-part]:checked')].map(input=>input.dataset.makeupPart);
  const locked=()=>busy||extensionBusy||Boolean(globalThis.AtelierApp.activeJobId);
  const strengths=()=>Object.fromEntries(['lips','eyes','brows','cheeks','base'].map(p=>[p,Number(document.querySelector(`[data-makeup-strength="${p}"]`)?.value??100)]));
  const invalidatePreview=()=>{previewReady=false;};
  const primaryLabel=()=>previewReady?'Áp dụng phong cách đã chọn':'Tạo 2 bản xem thử';
  const currentStyleLabel=()=>styleName||config?.styles?.[el('makeupStyle').value]?.name||el('makeupStyle').selectedOptions?.[0]?.textContent||'Phong cách';
  function requirements(hasSource){return [['Ảnh',hasSource],['Khuôn mặt',Boolean(face)],['Vùng trang điểm',parts().length>0&&(!face||globalThis.AtelierApp.editableMaskStats().selected>0)],['Mô tả',descriptionReady()],['Dịch vụ',Boolean(config?.serviceReady&&config.landmarkReady)],['Model',el('makeupRenderer').value!=='ai'||Boolean(config?.aiReady)]];}
  function descriptionReady(){const text=el('makeupDescription').value.trim();return text?text===planned:el('makeupStyle').value!=='custom';}
  function sync(){
    if(!el('makeupStatus'))return;
    el('makeupSmoothValue').textContent=el('makeupSmooth').value+'%';
    el('makeupSmooth').disabled=!parts().includes('base');
    const checks=requirements(Boolean(globalThis.AtelierApp.current&&globalThis.AtelierApp.sourceImage));
    el('makeupPreview').disabled=locked()||checks.some(c=>!c[1]);el('makeupRun').disabled=el('makeupPreview').disabled;
    el('makeupDetect').disabled=locked()||!globalThis.AtelierApp.current||!config?.landmarkReady;
    el('makeupReadDescription').disabled=locked()||!el('makeupDescription').value.trim()||!config?.plannerReady;
    el('makeupStatus').textContent=busy?'Đang chuẩn bị trang điểm…':!config?.serviceReady?'Dịch vụ chưa nạp Trang điểm AI. Mở phiên trang điểm hoặc kiểm tra lại dịch vụ.':!config?.landmarkReady?'Chưa có bộ nhận diện khuôn mặt trên máy.':!face?'Nhận diện rồi chọn một khuôn mặt để bắt đầu.':!descriptionReady()?'Mô tả đã đổi. Nhấn Đọc mô tả rồi kiểm tra các thiết lập.':!checks.every(c=>c[1])?'Kiểm tra vùng trang điểm và khả năng xử lý AI.':'Sẵn sàng tạo hai phương án. Mắt, khoang miệng và vùng bảo vệ giữ nguyên; hãy kiểm tra chi tiết sau xử lý.';
    el('makeupReaderStatus').textContent=config?.plannerReady?'Mô tả được đọc trên máy. Kiểm tra thiết lập được gợi ý trước khi chạy.':'Bộ đọc mô tả chưa sẵn sàng. Bạn vẫn có thể chọn phong cách và chỉnh màu; nhấn Kiểm tra lại dịch vụ sau khi chuẩn bị xong.';
    if(!parts().some(p=>strengths()[p]>0)){el('makeupPreview').disabled=true;el('makeupRun').disabled=true;}
    document.querySelectorAll('[data-makeup-strength]').forEach(input=>{input.disabled=!parts().includes(input.dataset.makeupStrength);const output=el(input.id+'Value');if(output)output.textContent=input.value+'%';});
    document.querySelectorAll('[data-makeup-style]').forEach(button=>{const active=button.dataset.makeupStyle===el('makeupStyle').value;button.classList?.toggle('active',active);button.setAttribute?.('aria-pressed',String(active));});
    document.querySelectorAll('[data-makeup-intensity]').forEach(button=>{const active=button.dataset.makeupIntensity===el('makeupIntensity').value;button.classList?.toggle('active',active);button.setAttribute?.('aria-pressed',String(active));});
    window.MakeupLibrary?.sync();
    window.MakeupCompare?.sync();
  }
  async function refresh(){try{const r=await fetch('/api/makeup-config');config=await r.json();if(!r.ok)throw Error();}catch{config={serviceReady:false};}sync();globalThis.AtelierApp.refreshStudioReadiness();}
  function reset(){revision++;invalidatePreview();if(!restoreInProgress)busy=false;analysis=null;face=null;regionImages={};el('makeupFaces')?.replaceChildren();sync();}
  async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok||!result.ok)throw Error(result.error||'Không thể xử lý trang điểm.');return result;}
  function readImage(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Không đọc được vùng khuôn mặt.'));image.src=url;});}
  function paint(image,context,color){
    context.clearRect(0,0,context.canvas.width,context.canvas.height);context.drawImage(image,0,0);
    const pixels=context.getImageData(0,0,context.canvas.width,context.canvas.height);
    for(let i=0;i<pixels.data.length;i+=4){const chosen=pixels.data[i]>127;pixels.data[i]=color[0];pixels.data[i+1]=color[1];pixels.data[i+2]=color[2];pixels.data[i+3]=chosen?color[3]:0;}context.putImageData(pixels,0,0);
  }
  function applyRegions(){
    if(!face||globalThis.AtelierApp.studioMode!=='makeup'||restoreInProgress)return;
    const scratch=document.createElement('canvas');scratch.width=globalThis.AtelierApp.maskCanvas.width;scratch.height=globalThis.AtelierApp.maskCanvas.height;const ctx=scratch.getContext('2d');
    ctx.fillStyle='black';ctx.fillRect(0,0,scratch.width,scratch.height);ctx.globalCompositeOperation='lighten';
    for(const part of parts())if(regionImages[part])ctx.drawImage(regionImages[part],0,0);
    invalidatePreview();globalThis.AtelierApp.snapshot();paint(scratch,globalThis.AtelierApp.maskCtx,[255,40,40,255]);globalThis.AtelierApp.render();globalThis.AtelierApp.refreshStudioReadiness();
  }
  async function chooseFace(chosen){
    const token=++revision,id=globalThis.AtelierApp.current?.id;busy=true;sync();
    try{
      const entries=await Promise.all(Object.entries(chosen.regions).map(async([key,url])=>[key,await readImage(url)]));
      if(token!==revision||globalThis.AtelierApp.current?.id!==id)return;
      face=chosen;regionImages=Object.fromEntries(entries);
      el('makeupFaces').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.face)===chosen.index)));
      applyRegions();globalThis.AtelierApp.render();
    }finally{if(token===revision){busy=false;sync();globalThis.AtelierApp.refreshStudioReadiness();}}
  }
  async function detect(){
    if(locked()||!globalThis.AtelierApp.current)return;
    const id=globalThis.AtelierApp.current.id,token=++revision;busy=true;sync();
    try{
      const result=await post('/api/makeup-analyze',{sampleId:id});
      if(token!==revision||globalThis.AtelierApp.current?.id!==id)return;
      analysis=result;face=null;regionImages={};showFaces(result.faces);
      busy=false;
      if(result.faces.length===1)await chooseFace(result.faces[0]);
      globalThis.AtelierApp.setMessage(result.faces.length===1?'Đã chọn khuôn mặt. Kiểm tra vùng tô đỏ; dùng cọ xanh để bảo vệ chi tiết.':'Chọn một khuôn mặt trong bảng Trang điểm AI.','success');
    }catch(e){globalThis.AtelierApp.setMessage(e.message,'error');}finally{if(token===revision)busy=false;sync();globalThis.AtelierApp.refreshStudioReadiness();}
  }
  function showFaces(faces){
    el('makeupFaces').replaceChildren();
    for(const entry of faces){const button=document.createElement('button');button.type='button';button.dataset.face=entry.index;button.setAttribute('aria-pressed','false');const image=new Image();image.src=entry.thumbnail;image.alt='';button.append(image,`Khuôn mặt ${entry.index+1}`);button.onclick=()=>{if(!locked())chooseFace(entry).catch(e=>globalThis.AtelierApp.setMessage(e.message,'error'));};el('makeupFaces').append(button);}
  }
  function setPlan(plan){
    for(const [key,id] of [['lip','makeupLip'],['eyeshadow','makeupEyeshadow'],['blush','makeupBlush'],['intensity','makeupIntensity'],['renderer','makeupRenderer'],['eyeliner','makeupEyeliner'],['finish','makeupFinish']])if(plan[key])el(id).value=plan[key];
    if(plan.parts)document.querySelectorAll('[data-makeup-part]').forEach(input=>input.checked=plan.parts.includes(input.dataset.makeupPart));
    if(el('makeupBrow'))el('makeupBrow').value=plan.brow||'#59443b';
    document.querySelectorAll('[data-makeup-strength]').forEach(input=>input.value=plan.strengths?.[input.dataset.makeupStrength]??100);
    prompt=plan.prompt;el('makeupSummary').textContent=plan.summary||plan.description||'';
  }
  function preset(){if(!config?.styles)return;invalidatePreview();planned='';const plan=config.styles[el('makeupStyle').value];styleName=plan.name;runSeed=42;setPlan({...plan,parts:['lips','eyes','brows','cheeks','base']});applyRegions();sync();globalThis.AtelierApp.refreshStudioReadiness();}
  async function readDescription(){
    if(locked())return;
    const description=el('makeupDescription').value.trim(),style=el('makeupStyle').value;
    const baseline=settings();busy=true;sync();
    try{const plan=await post('/api/makeup-plan',{description,style,baseSettings:baseline});if(JSON.stringify(baseline)!==JSON.stringify(settings()))return globalThis.AtelierApp.setMessage('Thiết lập đã đổi trong lúc đọc mô tả. Hãy đọc lại để cập nhật.','error');invalidatePreview();setPlan(plan);planned=description;applyRegions();globalThis.AtelierApp.setMessage('Đã đọc mô tả. Bạn có thể chỉnh lại màu, vùng và mức độ trước khi xem thử.','success');}
    catch(e){globalThis.AtelierApp.setMessage(e.message,'error');}finally{busy=false;sync();globalThis.AtelierApp.refreshStudioReadiness();}
  }
  function settings(){
    return {style:el('makeupStyle').value,styleName:styleName||config?.styles?.[el('makeupStyle').value]?.name||'Trang điểm AI',description:el('makeupDescription').value.trim(),plannedDescription:planned,prompt:prompt||config?.styles?.[el('makeupStyle').value]?.prompt||window.ATELIER_PROMPTS.components['makeup.fallback'],
      intensity:el('makeupIntensity').value,renderer:el('makeupRenderer').value,lip:el('makeupLip').value,eyeshadow:el('makeupEyeshadow').value,blush:el('makeupBlush').value,brow:el('makeupBrow')?.value||'#59443b',
      eyeliner:el('makeupEyeliner').value,finish:el('makeupFinish').value,parts:parts(),strengths:strengths(),preserveFeatures:el('makeupPreserve').checked,skinSmooth:Number(el('makeupSmooth').value)};
  }
  function loadStyle(value,label){
    styleName=(label||value.styleName||config?.styles?.[value.style]?.name||'Phong cách riêng').slice(0,160);runSeed=value.seed??42;
    el('makeupStyle').value=value.style||'natural';el('makeupDescription').value=value.description||'';planned=value.description||'';setPlan(value);
    el('makeupSmooth').value=value.skinSmooth??0;el('makeupPreserve').checked=value.preserveFeatures!==false;
    el('makeupSummary').textContent=label||value.summary||'Đã nạp phong cách. Kiểm tra màu và vùng áp dụng.';
    applyRegions();sync();globalThis.AtelierApp.refreshStudioReadiness();
  }
  function comparisonSource(){
    if(!globalThis.AtelierApp.current||!face||!analysis)throw Error('Nhận diện và chọn khuôn mặt trước khi so sánh.');
    if(!config?.comparisonVersion||!config?.serviceReady)throw Error('Dịch vụ chưa nạp so sánh phong cách. Kiểm tra lại dịch vụ.');
    if(globalThis.AtelierApp.editableMaskStats().selected<=0)throw Error('Tô vùng đỏ cần trang điểm trước khi so sánh.');
    return {sampleId:globalThis.AtelierApp.current.id,sourceSha256:analysis.sourceSha256,faceIndex:face.index,editableMask:globalThis.AtelierApp.binaryMaskDataUrl(false),protectedDetailMask:globalThis.AtelierApp.binaryMaskDataUrl(false,true)};
  }
  function payload(preview=false){
    if(!globalThis.AtelierApp.current||!face||!analysis)throw Error('Nhận diện và chọn một khuôn mặt trước.');
    if(!descriptionReady())throw Error('Nhấn Đọc mô tả để cập nhật yêu cầu.');
    if(!parts().length||globalThis.AtelierApp.editableMaskStats().selected<=0)throw Error('Chọn ít nhất một vùng trang điểm và giữ phần tô đỏ cần sửa.');
    return {sampleId:globalThis.AtelierApp.current.id,sourceSha256:analysis.sourceSha256,faceIndex:face.index,style:el('makeupStyle').value,styleName:settings().styleName,seed:runSeed,
      description:el('makeupDescription').value.trim(),plannedDescription:planned,prompt:prompt||config.styles[el('makeupStyle').value].prompt,
      intensity:el('makeupIntensity').value,renderer:el('makeupRenderer').value,lip:el('makeupLip').value,eyeshadow:el('makeupEyeshadow').value,blush:el('makeupBlush').value,
      eyeliner:el('makeupEyeliner').value,finish:el('makeupFinish').value,parts:parts(),preserveFeatures:el('makeupPreserve').checked,
      skinSmooth:Number(el('makeupSmooth').value),brow:el('makeupBrow')?.value||'#59443b',strengths:strengths(),limitSelection:true,editableMask:globalThis.AtelierApp.binaryMaskDataUrl(false),protectedDetailMask:globalThis.AtelierApp.binaryMaskDataUrl(false,true),preview};
  }
  async function run(preview=false){
    if(locked()||globalThis.AtelierApp.inpaintPromptReviewPending||descriptionTryonRunning)return globalThis.AtelierApp.setMessage('Hãy hoàn tất tác vụ hiện tại.','error');
    let request;try{request=payload(preview);}catch(e){return globalThis.AtelierApp.setMessage(e.message,'error');}
    if(requirements(true).some(c=>!c[1]))return globalThis.AtelierApp.setMessage(el('makeupStatus').textContent,'error');
    busy=true;const jobId=globalThis.AtelierApp.createJobId('makeup');globalThis.AtelierApp.setActiveJob(jobId);sync();let success=false,error='';
    try{const result=await post('/api/makeup',{...request,jobId});success=true;show(result);globalThis.AtelierApp.setMessage(preview?'Đã tạo hai bản xem thử khuôn mặt. Chọn Áp dụng để lưu ảnh đầy đủ.':'Đã lưu hai phương án trang điểm. Hãy so sánh và chọn kết quả.','success');}
    catch(e){error=e.message;globalThis.AtelierApp.setMessage(error,'error');}finally{await globalThis.AtelierApp.settleJob(jobId,success?'completed':'failed',error);busy=false;sync();}
  }
  function inspect(item){window.ImageEnhancement.inspect(item);const dialog=document.querySelector('.enhance-inspector:last-of-type');if(dialog){dialog.setAttribute('aria-label','So sánh trang điểm ở 100%');dialog.querySelectorAll('img')[0].alt='Trước trang điểm';dialog.querySelectorAll('img')[1].alt='Sau trang điểm';}}
  function previewDialog(items){
    const dialog=document.createElement('dialog');dialog.className='makeup-preview';dialog.setAttribute('aria-label','Hai phương án trang điểm xem thử');
    const heading=document.createElement('h3');heading.textContent='Xem thử khuôn mặt · Hai phương án';dialog.append(heading);
    const row=document.createElement('div');row.className='makeup-preview-grid';
    for(const item of items){const card=document.createElement('article'),image=new Image(),inspectButton=document.createElement('button'),choose=document.createElement('button');image.src=globalThis.AtelierApp.outputUrl(item.file);image.alt=item.label;inspectButton.textContent='So sánh 100%';inspectButton.onclick=()=>inspect(item);choose.className='primary';choose.textContent='Chọn phương án này';choose.onclick=()=>{runSeed=item.seed;previewReady=true;styleName=item.label||styleName;dialog.close();globalThis.AtelierApp.refreshStudioReadiness();globalThis.AtelierApp.setMessage('Đã chọn phương án xem thử. Có thể áp dụng phong cách này.','success');};card.append(image,document.createTextNode(item.label),choose,inspectButton);row.append(card);}dialog.append(row);
    const close=document.createElement('button');close.textContent='Đóng và chỉnh tiếp';close.onclick=()=>dialog.close();dialog.append(close);dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
  }
  function show(result){
    if(result.comparison||(result.results||[]).some(i=>i.comparisonId))return window.MakeupCompare.show(result);
    const items=(result.results||[]).filter(i=>i.kind==='makeup');if(!items.length)return;
    if(items[0].previewOnly)return previewDialog(items);
    globalThis.AtelierApp.activateAppView('create');globalThis.AtelierApp.setStudioMode('makeup');el('studioResultsTrayQuality')?.remove();
    globalThis.AtelierApp.currentRunDirectory=result.directory||items[0].file.replace(/\/[^/]+$/,'');
    const before=globalThis.AtelierApp.outputUrl(items[0].comparisonFile);
    el('resultsGrid').innerHTML=`<article class="result-card"><img src="${globalThis.AtelierApp.escapeHtml(before)}" alt="Trước trang điểm"><p>Ảnh nguồn</p></article>`+items.map(item=>`<article class="result-card"><img src="${globalThis.AtelierApp.escapeHtml(globalThis.AtelierApp.outputUrl(item.file))}" alt="${globalThis.AtelierApp.escapeHtml(item.label)}"><p>${globalThis.AtelierApp.escapeHtml(item.label)} · ${globalThis.AtelierApp.escapeHtml(item.settings.styleName||config?.styles?.[item.settings.style]?.name||'Trang điểm AI')}</p><button data-makeup-inspect="${item.seed}">So sánh ở 100%</button><button data-makeup-edit="${item.seed}">Chỉnh lại phong cách và vùng</button><button data-seed="${item.seed}" data-task="makeup" data-sample-id="${globalThis.AtelierApp.escapeHtml(item.sampleId)}" data-directory="${globalThis.AtelierApp.escapeHtml(globalThis.AtelierApp.currentRunDirectory)}">Chọn làm kết quả chính</button><a href="${globalThis.AtelierApp.escapeHtml(globalThis.AtelierApp.outputUrl(item.file))}" download>Tải PNG</a></article>`).join('');
    el('resultsGrid').querySelectorAll('[data-makeup-inspect]').forEach(b=>b.onclick=()=>inspect(items.find(i=>i.seed===Number(b.dataset.makeupInspect))));
    el('resultsGrid').querySelectorAll('[data-makeup-edit]').forEach(b=>b.onclick=()=>editAgain(items.find(i=>i.seed===Number(b.dataset.makeupEdit))));
    el('resultsGrid').querySelectorAll('[data-seed]').forEach(b=>b.onclick=()=>globalThis.AtelierApp.selectPrimary(Number(b.dataset.seed),b));
    globalThis.AtelierApp.presentStudioResults(before,globalThis.AtelierApp.outputUrl(items[0].file));globalThis.AtelierApp.showCompare(before,globalThis.AtelierApp.outputUrl(items[0].file));
  }
  async function editAgain(item){
    if(locked())return globalThis.AtelierApp.setMessage('Hãy hoàn tất tác vụ hiện tại.','error');
    const source=globalThis.AtelierApp.images.find(i=>i.id===item.sampleId);if(!source)return globalThis.AtelierApp.setMessage('Ảnh nguồn không còn trong thư viện.','error');
    busy=true;restoreInProgress=true;sync();
    try{
      const folder=item.file.replace(/\/[^/]+$/,''),[selected,protectedImage]=await Promise.all([readImage(globalThis.AtelierApp.outputUrl(folder+'/editable_mask.png')),readImage(globalThis.AtelierApp.outputUrl(folder+'/protected_mask.png'))]);
      if(!await globalThis.AtelierApp.loadImage(source))throw Error('Không tải được ảnh nguồn.');
      const analyzed=await post('/api/makeup-analyze',{sampleId:source.id});
      if(globalThis.AtelierApp.current?.id!==source.id||analyzed.sourceSha256!==item.sourceSha256)throw Error('Ảnh nguồn đã thay đổi. Hãy nhận diện lại.');
      analysis=analyzed;showFaces(analysis.faces);const chosen=analysis.faces.find(f=>f.index===item.settings.faceIndex);if(!chosen)throw Error('Không còn khuôn mặt đã chọn.');
      styleName=item.settings.styleName||item.comparisonName||'';runSeed=item.settings.seed??42;
      globalThis.AtelierApp.activateAppView('create');globalThis.AtelierApp.setStudioMode('makeup');el('makeupStyle').value=item.settings.style;el('makeupDescription').value=item.settings.description;planned=item.settings.description;setPlan(item.settings);
      el('makeupSmooth').value=item.settings.skinSmooth;el('makeupPreserve').checked=item.settings.preserveFeatures;
      await chooseFace(chosen);paint(selected,globalThis.AtelierApp.maskCtx,[255,40,40,255]);paint(protectedImage,globalThis.AtelierApp.protectCtx,[0,120,255,180]);paint(protectedImage,globalThis.AtelierApp.manualProtectCtx,[0,120,255,180]);
      el('makeupSummary').textContent=styleName;globalThis.AtelierApp.render();globalThis.AtelierApp.setMessage('Đã khôi phục phong cách, mô tả, màu và vùng trang điểm.','success');return true;
    }catch(e){globalThis.AtelierApp.setMessage(e.message,'error');return false;}finally{busy=false;restoreInProgress=false;sync();globalThis.AtelierApp.refreshStudioReadiness();}
  }
  function draw(context){if(globalThis.AtelierApp.studioMode!=='makeup'||!face||!globalThis.AtelierApp.sourceImage)return;const [x,y,r,b]=face.box,sx=globalThis.AtelierApp.canvas.width/globalThis.AtelierApp.sourceImage.naturalWidth,sy=globalThis.AtelierApp.canvas.height/globalThis.AtelierApp.sourceImage.naturalHeight;context.save();context.strokeStyle='#f9c977';context.lineWidth=2;context.strokeRect(x*sx,y*sy,(r-x)*sx,(b-y)*sy);context.restore();}
  function focus(){window.StudioWorkspace?.reveal?.(el('studioMakeupPanel'));el('studioMakeupPanel').scrollIntoView({block:'center'});el(face?'makeupStyle':'makeupDetect').focus();}
  function setup(){
    const panel=el('studioMakeupPanel');if(panel&&document.createElement){
      const faceMain=document.createElement('section');faceMain.id='makeupFaceMain';faceMain.className='makeup-main-section';faceMain.innerHTML='<strong>Khuôn mặt</strong><small>Nhận diện và chọn người cần trang điểm.</small>';panel.prepend(faceMain);faceMain.append(el('makeupDetect'),el('makeupFaces'));
      const styleMain=document.createElement('section');styleMain.id='makeupStyleMain';styleMain.className='makeup-main-section';styleMain.innerHTML='<strong>Phong cách</strong><div class="makeup-source-buttons" role="group" aria-label="Nguồn phong cách"><button type="button" data-makeup-source="preset" class="active" aria-pressed="true">Mẫu có sẵn</button><button type="button" data-makeup-source="description">Mô tả riêng</button><button type="button" data-makeup-source="reference">Ảnh tham chiếu</button><button type="button" data-makeup-source="saved">Đã lưu</button></div><div class="makeup-style-buttons" role="group" aria-label="Phong cách trang điểm"></div>';
      faceMain.after(styleMain);const styleSelect=el('makeupStyle'),styleLabel=styleSelect.previousElementSibling;styleLabel.hidden=true;styleSelect.hidden=true;for(const option of [...styleSelect.options].filter(option=>option.value!=='custom')){const button=document.createElement('button');button.type='button';button.dataset.makeupStyle=option.value;button.textContent=option.textContent;button.onclick=()=>{styleSelect.value=button.dataset.makeupStyle;preset();};styleMain.querySelector('.makeup-style-buttons').append(button);}
      const descriptionPanel=document.createElement('div');descriptionPanel.className='makeup-source-panel';descriptionPanel.dataset.makeupPanel='description';descriptionPanel.hidden=true;styleMain.after(descriptionPanel);descriptionPanel.append(el('makeupDescription').previousElementSibling,el('makeupDescription'),el('makeupReadDescription'),el('makeupReaderStatus'),el('makeupSummary'));
      const reference=panel.querySelector('.makeup-reference'),library=panel.querySelector('.makeup-library');reference.open=false;library.open=false;reference.dataset.makeupPanel='reference';library.dataset.makeupPanel='saved';reference.hidden=true;library.hidden=true;descriptionPanel.after(reference,library);
      const showSource=source=>{for(const button of styleMain.querySelectorAll('[data-makeup-source]')){const active=button.dataset.makeupSource===source;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}styleMain.querySelector('.makeup-style-buttons').hidden=source!=='preset';for(const node of panel.querySelectorAll('[data-makeup-panel]'))node.hidden=node.dataset.makeupPanel!==source;if(source==='description'){styleSelect.value='custom';invalidatePreview();sync();}};for(const button of styleMain.querySelectorAll('[data-makeup-source]'))button.onclick=()=>showSource(button.dataset.makeupSource);
      const region=document.createElement('section');region.id='makeupRegionMain';region.className='makeup-main-section';region.innerHTML='<strong>Vùng và mức độ</strong>';library.after(region);const partsField=panel.querySelector('.makeup-parts').closest('fieldset');region.append(partsField);
      const intensity=el('makeupIntensity'),intensityLabel=intensity.closest('label');intensityLabel.hidden=true;const intensityButtons=document.createElement('div');intensityButtons.className='button-row makeup-intensity-buttons';intensityButtons.setAttribute('role','group');intensityButtons.setAttribute('aria-label','Mức độ trang điểm');intensityButtons.innerHTML='<button type="button" data-makeup-intensity="light">Nhẹ</button><button type="button" data-makeup-intensity="medium">Tự nhiên</button><button type="button" data-makeup-intensity="bold">Đậm</button>';region.append(intensityButtons,el('makeupPreserve').closest('label'),el('makeupSmooth').previousElementSibling,el('makeupSmooth'));for(const button of intensityButtons.querySelectorAll('button'))button.onclick=()=>{intensity.value=button.dataset.makeupIntensity;invalidatePreview();sync();globalThis.AtelierApp.refreshStudioReadiness();};
      const advanced=document.createElement('details');advanced.className='advanced-panel makeup-advanced';advanced.innerHTML='<summary>Thiết lập nâng cao</summary>';region.after(advanced);advanced.append(panel.querySelector('.makeup-colors'),panel.querySelector('.makeup-strengths'),el('makeupEyeliner').closest('label'),el('makeupFinish').closest('label'),el('makeupRenderer').closest('label'),el('makeupRefresh'));
      el('makeupPreview').hidden=true;el('makeupRun').classList.remove('primary');el('makeupRun').textContent='Áp dụng ngay · 2 phương án';el('makeupComparePanel').open=false;
    }
    el('makeupDetect').onclick=detect;el('makeupReadDescription').onclick=readDescription;el('makeupRefresh').onclick=refresh;
    el('makeupPreview').onclick=()=>run(true);el('makeupRun').onclick=()=>run(false);el('makeupStyle').onchange=preset;
    document.querySelectorAll('[data-makeup-part]').forEach(input=>input.onchange=applyRegions);
    for(const id of ['makeupDescription','makeupRenderer','makeupSmooth'])el(id).addEventListener('input',()=>{invalidatePreview();sync();globalThis.AtelierApp.refreshStudioReadiness();});
    for(const id of ['makeupLip','makeupEyeshadow','makeupBlush','makeupBrow','makeupIntensity','makeupEyeliner','makeupFinish'])el(id)?.addEventListener('input',()=>{invalidatePreview();sync();globalThis.AtelierApp.refreshStudioReadiness();});
    document.querySelectorAll('[data-makeup-strength]').forEach(input=>input.addEventListener('input',()=>{invalidatePreview();sync();globalThis.AtelierApp.refreshStudioReadiness();}));
    refresh().then(()=>{if(!prompt)preset();});
  }
  return {setup,reset,sync,requirements,run:()=>run(!previewReady),apply:run,primaryLabel,currentStyleLabel,previewReady:()=>previewReady,draw,focus,payload,show,editAgain,settings,loadStyle,descriptionReady,comparisonSource,catalog:()=>config?.styles||{},comparisonReady:()=>Boolean(config?.comparisonVersion===1&&config?.landmarkReady&&face),isLocked:locked,referenceReady:()=>Boolean(config?.referenceVersion===1&&config?.landmarkReady),setExtensionBusy:value=>{extensionBusy=value;sync();globalThis.AtelierApp.refreshStudioReadiness();},restore:show};
})();
