/* Makeup owns face selection; all painting still uses Studio's full-size canvases. */
window.Makeup=(()=>{
  const el=id=>document.getElementById(id);
  let config=null,analysis=null,face=null,busy=false,extensionBusy=false,revision=0,planned='',prompt='',styleName='',runSeed=42,regionImages={},restoreInProgress=false;
  const parts=()=>[...document.querySelectorAll('[data-makeup-part]:checked')].map(input=>input.dataset.makeupPart);
  const locked=()=>busy||extensionBusy||Boolean(activeJobId);
  const strengths=()=>Object.fromEntries(['lips','eyes','brows','cheeks','base'].map(p=>[p,Number(document.querySelector(`[data-makeup-strength="${p}"]`)?.value??100)]));
  function requirements(hasSource){return [['Ảnh',hasSource],['Khuôn mặt',Boolean(face)],['Vùng trang điểm',parts().length>0&&(!face||editableMaskStats().selected>0)],['Mô tả',descriptionReady()],['Dịch vụ',Boolean(config?.serviceReady&&config.landmarkReady)],['Model',el('makeupRenderer').value!=='ai'||Boolean(config?.aiReady)]];}
  function descriptionReady(){const text=el('makeupDescription').value.trim();return text?text===planned:el('makeupStyle').value!=='custom';}
  function sync(){
    if(!el('makeupStatus'))return;
    el('makeupSmoothValue').textContent=el('makeupSmooth').value+'%';
    el('makeupSmooth').disabled=!parts().includes('base');
    const checks=requirements(Boolean(current&&sourceImage));
    el('makeupPreview').disabled=locked()||checks.some(c=>!c[1]);el('makeupRun').disabled=el('makeupPreview').disabled;
    el('makeupDetect').disabled=locked()||!current||!config?.landmarkReady;
    el('makeupReadDescription').disabled=locked()||!el('makeupDescription').value.trim()||!config?.plannerReady;
    el('makeupStatus').textContent=busy?'Đang chuẩn bị trang điểm…':!config?.serviceReady?'Dịch vụ chưa nạp Trang điểm AI. Mở phiên trang điểm hoặc kiểm tra lại dịch vụ.':!config?.landmarkReady?'Chưa có bộ nhận diện khuôn mặt trên máy.':!face?'Nhận diện rồi chọn một khuôn mặt để bắt đầu.':!descriptionReady()?'Mô tả đã đổi. Nhấn Đọc mô tả rồi kiểm tra các thiết lập.':!checks.every(c=>c[1])?'Kiểm tra vùng trang điểm và khả năng xử lý AI.':'Sẵn sàng tạo hai phương án. Mắt, khoang miệng và vùng bảo vệ giữ nguyên; hãy kiểm tra chi tiết sau xử lý.';
    el('makeupReaderStatus').textContent=config?.plannerReady?'Mô tả được đọc trên máy. Kiểm tra thiết lập được gợi ý trước khi chạy.':'Bộ đọc mô tả chưa sẵn sàng. Bạn vẫn có thể chọn phong cách và chỉnh màu; nhấn Kiểm tra lại dịch vụ sau khi chuẩn bị xong.';
    if(!parts().some(p=>strengths()[p]>0)){el('makeupPreview').disabled=true;el('makeupRun').disabled=true;}
    document.querySelectorAll('[data-makeup-strength]').forEach(input=>{input.disabled=!parts().includes(input.dataset.makeupStrength);const output=el(input.id+'Value');if(output)output.textContent=input.value+'%';});
    window.MakeupLibrary?.sync();
    window.MakeupCompare?.sync();
  }
  async function refresh(){try{const r=await fetch('/api/makeup-config');config=await r.json();if(!r.ok)throw Error();}catch{config={serviceReady:false};}sync();refreshStudioReadiness();}
  function reset(){revision++;if(!restoreInProgress)busy=false;analysis=null;face=null;regionImages={};el('makeupFaces')?.replaceChildren();sync();}
  async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok||!result.ok)throw Error(result.error||'Không thể xử lý trang điểm.');return result;}
  function readImage(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Không đọc được vùng khuôn mặt.'));image.src=url;});}
  function paint(image,context,color){
    context.clearRect(0,0,context.canvas.width,context.canvas.height);context.drawImage(image,0,0);
    const pixels=context.getImageData(0,0,context.canvas.width,context.canvas.height);
    for(let i=0;i<pixels.data.length;i+=4){const chosen=pixels.data[i]>127;pixels.data[i]=color[0];pixels.data[i+1]=color[1];pixels.data[i+2]=color[2];pixels.data[i+3]=chosen?color[3]:0;}context.putImageData(pixels,0,0);
  }
  function applyRegions(){
    if(!face||studioMode!=='makeup'||restoreInProgress)return;
    const scratch=document.createElement('canvas');scratch.width=maskCanvas.width;scratch.height=maskCanvas.height;const ctx=scratch.getContext('2d');
    ctx.fillStyle='black';ctx.fillRect(0,0,scratch.width,scratch.height);ctx.globalCompositeOperation='lighten';
    for(const part of parts())if(regionImages[part])ctx.drawImage(regionImages[part],0,0);
    snapshot();paint(scratch,maskCtx,[255,40,40,255]);render();refreshStudioReadiness();
  }
  async function chooseFace(chosen){
    const token=++revision,id=current?.id;busy=true;sync();
    try{
      const entries=await Promise.all(Object.entries(chosen.regions).map(async([key,url])=>[key,await readImage(url)]));
      if(token!==revision||current?.id!==id)return;
      face=chosen;regionImages=Object.fromEntries(entries);
      el('makeupFaces').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.face)===chosen.index)));
      applyRegions();render();
    }finally{if(token===revision){busy=false;sync();refreshStudioReadiness();}}
  }
  async function detect(){
    if(locked()||!current)return;
    const id=current.id,token=++revision;busy=true;sync();
    try{
      const result=await post('/api/makeup-analyze',{sampleId:id});
      if(token!==revision||current?.id!==id)return;
      analysis=result;face=null;regionImages={};showFaces(result.faces);
      busy=false;
      if(result.faces.length===1)await chooseFace(result.faces[0]);
      setMessage(result.faces.length===1?'Đã chọn khuôn mặt. Kiểm tra vùng tô đỏ; dùng cọ xanh để bảo vệ chi tiết.':'Chọn một khuôn mặt trong bảng Trang điểm AI.','success');
    }catch(e){setMessage(e.message,'error');}finally{if(token===revision)busy=false;sync();refreshStudioReadiness();}
  }
  function showFaces(faces){
    el('makeupFaces').replaceChildren();
    for(const entry of faces){const button=document.createElement('button');button.type='button';button.dataset.face=entry.index;button.setAttribute('aria-pressed','false');const image=new Image();image.src=entry.thumbnail;image.alt='';button.append(image,`Khuôn mặt ${entry.index+1}`);button.onclick=()=>{if(!locked())chooseFace(entry).catch(e=>setMessage(e.message,'error'));};el('makeupFaces').append(button);}
  }
  function setPlan(plan){
    for(const [key,id] of [['lip','makeupLip'],['eyeshadow','makeupEyeshadow'],['blush','makeupBlush'],['intensity','makeupIntensity'],['renderer','makeupRenderer'],['eyeliner','makeupEyeliner'],['finish','makeupFinish']])if(plan[key])el(id).value=plan[key];
    if(plan.parts)document.querySelectorAll('[data-makeup-part]').forEach(input=>input.checked=plan.parts.includes(input.dataset.makeupPart));
    if(el('makeupBrow'))el('makeupBrow').value=plan.brow||'#59443b';
    document.querySelectorAll('[data-makeup-strength]').forEach(input=>input.value=plan.strengths?.[input.dataset.makeupStrength]??100);
    prompt=plan.prompt;el('makeupSummary').textContent=plan.summary||plan.description||'';
  }
  function preset(){if(!config?.styles)return;planned='';const plan=config.styles[el('makeupStyle').value];styleName=plan.name;runSeed=42;setPlan({...plan,parts:['lips','eyes','brows','cheeks','base']});applyRegions();sync();refreshStudioReadiness();}
  async function readDescription(){
    if(locked())return;
    const description=el('makeupDescription').value.trim(),style=el('makeupStyle').value;
    const baseline=settings();busy=true;sync();
    try{const plan=await post('/api/makeup-plan',{description,style,baseSettings:baseline});if(JSON.stringify(baseline)!==JSON.stringify(settings()))return setMessage('Thiết lập đã đổi trong lúc đọc mô tả. Hãy đọc lại để cập nhật.','error');setPlan(plan);planned=description;applyRegions();setMessage('Đã đọc mô tả. Bạn có thể chỉnh lại màu, vùng và mức độ trước khi xem thử.','success');}
    catch(e){setMessage(e.message,'error');}finally{busy=false;sync();refreshStudioReadiness();}
  }
  function settings(){
    return {style:el('makeupStyle').value,styleName:styleName||config?.styles?.[el('makeupStyle').value]?.name||'Trang điểm AI',description:el('makeupDescription').value.trim(),plannedDescription:planned,prompt:prompt||config?.styles?.[el('makeupStyle').value]?.prompt||'natural makeup',
      intensity:el('makeupIntensity').value,renderer:el('makeupRenderer').value,lip:el('makeupLip').value,eyeshadow:el('makeupEyeshadow').value,blush:el('makeupBlush').value,brow:el('makeupBrow')?.value||'#59443b',
      eyeliner:el('makeupEyeliner').value,finish:el('makeupFinish').value,parts:parts(),strengths:strengths(),preserveFeatures:el('makeupPreserve').checked,skinSmooth:Number(el('makeupSmooth').value)};
  }
  function loadStyle(value,label){
    styleName=(label||value.styleName||config?.styles?.[value.style]?.name||'Phong cách riêng').slice(0,160);runSeed=value.seed??42;
    el('makeupStyle').value=value.style||'natural';el('makeupDescription').value=value.description||'';planned=value.description||'';setPlan(value);
    el('makeupSmooth').value=value.skinSmooth??0;el('makeupPreserve').checked=value.preserveFeatures!==false;
    el('makeupSummary').textContent=label||value.summary||'Đã nạp phong cách. Kiểm tra màu và vùng áp dụng.';
    applyRegions();sync();refreshStudioReadiness();
  }
  function comparisonSource(){
    if(!current||!face||!analysis)throw Error('Nhận diện và chọn khuôn mặt trước khi so sánh.');
    if(!config?.comparisonVersion||!config?.serviceReady)throw Error('Dịch vụ chưa nạp so sánh phong cách. Kiểm tra lại dịch vụ.');
    if(editableMaskStats().selected<=0)throw Error('Tô vùng đỏ cần trang điểm trước khi so sánh.');
    return {sampleId:current.id,sourceSha256:analysis.sourceSha256,faceIndex:face.index,editableMask:binaryMaskDataUrl(false),protectedDetailMask:binaryMaskDataUrl(false,true)};
  }
  function payload(preview=false){
    if(!current||!face||!analysis)throw Error('Nhận diện và chọn một khuôn mặt trước.');
    if(!descriptionReady())throw Error('Nhấn Đọc mô tả để cập nhật yêu cầu.');
    if(!parts().length||editableMaskStats().selected<=0)throw Error('Chọn ít nhất một vùng trang điểm và giữ phần tô đỏ cần sửa.');
    return {sampleId:current.id,sourceSha256:analysis.sourceSha256,faceIndex:face.index,style:el('makeupStyle').value,styleName:settings().styleName,seed:runSeed,
      description:el('makeupDescription').value.trim(),plannedDescription:planned,prompt:prompt||config.styles[el('makeupStyle').value].prompt,
      intensity:el('makeupIntensity').value,renderer:el('makeupRenderer').value,lip:el('makeupLip').value,eyeshadow:el('makeupEyeshadow').value,blush:el('makeupBlush').value,
      eyeliner:el('makeupEyeliner').value,finish:el('makeupFinish').value,parts:parts(),preserveFeatures:el('makeupPreserve').checked,
      skinSmooth:Number(el('makeupSmooth').value),brow:el('makeupBrow')?.value||'#59443b',strengths:strengths(),limitSelection:true,editableMask:binaryMaskDataUrl(false),protectedDetailMask:binaryMaskDataUrl(false,true),preview};
  }
  async function run(preview=false){
    if(locked()||inpaintPromptReviewPending||descriptionTryonRunning)return setMessage('Hãy hoàn tất tác vụ hiện tại.','error');
    let request;try{request=payload(preview);}catch(e){return setMessage(e.message,'error');}
    if(requirements(true).some(c=>!c[1]))return setMessage(el('makeupStatus').textContent,'error');
    busy=true;const jobId=createJobId('makeup');setActiveJob(jobId);sync();let success=false,error='';
    try{const result=await post('/api/makeup',{...request,jobId});success=true;show(result);setMessage(preview?'Đã tạo hai bản xem thử khuôn mặt. Chọn Áp dụng để lưu ảnh đầy đủ.':'Đã lưu hai phương án trang điểm. Hãy so sánh và chọn kết quả.','success');}
    catch(e){error=e.message;setMessage(error,'error');}finally{await settleJob(jobId,success?'completed':'failed',error);busy=false;sync();}
  }
  function inspect(item){window.ImageEnhancement.inspect(item);const dialog=document.querySelector('.enhance-inspector:last-of-type');if(dialog){dialog.setAttribute('aria-label','So sánh trang điểm ở 100%');dialog.querySelectorAll('img')[0].alt='Trước trang điểm';dialog.querySelectorAll('img')[1].alt='Sau trang điểm';}}
  function previewDialog(items){
    const dialog=document.createElement('dialog');dialog.className='makeup-preview';dialog.setAttribute('aria-label','Hai phương án trang điểm xem thử');
    const heading=document.createElement('h3');heading.textContent='Xem thử khuôn mặt · Hai phương án';dialog.append(heading);
    const row=document.createElement('div');row.className='makeup-preview-grid';
    for(const item of items){const card=document.createElement('article'),image=new Image(),button=document.createElement('button');image.src=outputUrl(item.file);image.alt=item.label;button.textContent=item.label+' · So sánh 100%';button.onclick=()=>inspect(item);card.append(image,button);row.append(card);}dialog.append(row);
    const close=document.createElement('button');close.textContent='Đóng và chỉnh tiếp';close.onclick=()=>dialog.close();dialog.append(close);dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
  }
  function show(result){
    if(result.comparison||(result.results||[]).some(i=>i.comparisonId))return window.MakeupCompare.show(result);
    const items=(result.results||[]).filter(i=>i.kind==='makeup');if(!items.length)return;
    if(items[0].previewOnly)return previewDialog(items);
    activateAppView('create');setStudioMode('makeup');el('studioResultsTrayQuality')?.remove();
    currentRunDirectory=result.directory||items[0].file.replace(/\/[^/]+$/,'');
    const before=outputUrl(items[0].comparisonFile);
    el('resultsGrid').innerHTML=`<article class="result-card"><img src="${escapeHtml(before)}" alt="Trước trang điểm"><p>Ảnh nguồn</p></article>`+items.map(item=>`<article class="result-card"><img src="${escapeHtml(outputUrl(item.file))}" alt="${escapeHtml(item.label)}"><p>${escapeHtml(item.label)} · ${escapeHtml(item.settings.styleName||config?.styles?.[item.settings.style]?.name||'Trang điểm AI')}</p><button data-makeup-inspect="${item.seed}">So sánh ở 100%</button><button data-makeup-edit="${item.seed}">Chỉnh lại phong cách và vùng</button><button data-seed="${item.seed}" data-task="makeup" data-sample-id="${escapeHtml(item.sampleId)}" data-directory="${escapeHtml(currentRunDirectory)}">Chọn làm kết quả chính</button><a href="${escapeHtml(outputUrl(item.file))}" download>Tải PNG</a></article>`).join('');
    el('resultsGrid').querySelectorAll('[data-makeup-inspect]').forEach(b=>b.onclick=()=>inspect(items.find(i=>i.seed===Number(b.dataset.makeupInspect))));
    el('resultsGrid').querySelectorAll('[data-makeup-edit]').forEach(b=>b.onclick=()=>editAgain(items.find(i=>i.seed===Number(b.dataset.makeupEdit))));
    el('resultsGrid').querySelectorAll('[data-seed]').forEach(b=>b.onclick=()=>selectPrimary(Number(b.dataset.seed),b));
    presentStudioResults(before,outputUrl(items[0].file));showCompare(before,outputUrl(items[0].file));
  }
  async function editAgain(item){
    if(locked())return setMessage('Hãy hoàn tất tác vụ hiện tại.','error');
    const source=images.find(i=>i.id===item.sampleId);if(!source)return setMessage('Ảnh nguồn không còn trong thư viện.','error');
    busy=true;restoreInProgress=true;sync();
    try{
      const folder=item.file.replace(/\/[^/]+$/,''),[selected,protectedImage]=await Promise.all([readImage(outputUrl(folder+'/editable_mask.png')),readImage(outputUrl(folder+'/protected_mask.png'))]);
      if(!await loadImage(source))throw Error('Không tải được ảnh nguồn.');
      const analyzed=await post('/api/makeup-analyze',{sampleId:source.id});
      if(current?.id!==source.id||analyzed.sourceSha256!==item.sourceSha256)throw Error('Ảnh nguồn đã thay đổi. Hãy nhận diện lại.');
      analysis=analyzed;showFaces(analysis.faces);const chosen=analysis.faces.find(f=>f.index===item.settings.faceIndex);if(!chosen)throw Error('Không còn khuôn mặt đã chọn.');
      styleName=item.settings.styleName||item.comparisonName||'';runSeed=item.settings.seed??42;
      activateAppView('create');setStudioMode('makeup');el('makeupStyle').value=item.settings.style;el('makeupDescription').value=item.settings.description;planned=item.settings.description;setPlan(item.settings);
      el('makeupSmooth').value=item.settings.skinSmooth;el('makeupPreserve').checked=item.settings.preserveFeatures;
      await chooseFace(chosen);paint(selected,maskCtx,[255,40,40,255]);paint(protectedImage,protectCtx,[0,120,255,180]);paint(protectedImage,manualProtectCtx,[0,120,255,180]);
      el('makeupSummary').textContent=styleName;render();setMessage('Đã khôi phục phong cách, mô tả, màu và vùng trang điểm.','success');return true;
    }catch(e){setMessage(e.message,'error');return false;}finally{busy=false;restoreInProgress=false;sync();refreshStudioReadiness();}
  }
  function draw(context){if(studioMode!=='makeup'||!face||!sourceImage)return;const [x,y,r,b]=face.box,sx=canvas.width/sourceImage.naturalWidth,sy=canvas.height/sourceImage.naturalHeight;context.save();context.strokeStyle='#f9c977';context.lineWidth=2;context.strokeRect(x*sx,y*sy,(r-x)*sx,(b-y)*sy);context.restore();}
  function focus(){window.StudioWorkspace?.reveal?.(el('studioMakeupPanel'));el('studioMakeupPanel').scrollIntoView({block:'center'});el(face?'makeupStyle':'makeupDetect').focus();}
  function setup(){
    el('makeupDetect').onclick=detect;el('makeupReadDescription').onclick=readDescription;el('makeupRefresh').onclick=refresh;
    el('makeupPreview').onclick=()=>run(true);el('makeupRun').onclick=()=>run(false);el('makeupStyle').onchange=preset;
    document.querySelectorAll('[data-makeup-part]').forEach(input=>input.onchange=applyRegions);
    for(const id of ['makeupDescription','makeupRenderer','makeupSmooth'])el(id).addEventListener('input',()=>{sync();refreshStudioReadiness();});
    document.querySelectorAll('[data-makeup-strength]').forEach(input=>input.addEventListener('input',()=>{sync();refreshStudioReadiness();}));
    refresh().then(()=>{if(!prompt)preset();});
  }
  return {setup,reset,sync,requirements,run,draw,focus,payload,show,editAgain,settings,loadStyle,descriptionReady,comparisonSource,catalog:()=>config?.styles||{},comparisonReady:()=>Boolean(config?.comparisonVersion===1&&config?.landmarkReady&&face),isLocked:locked,referenceReady:()=>Boolean(config?.referenceVersion===1&&config?.landmarkReady),setExtensionBusy:value=>{extensionBusy=value;sync();refreshStudioReadiness();},restore:show};
})();
