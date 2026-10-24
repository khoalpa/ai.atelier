/* Outpainting controls share the Studio source, jobs and result selection. */
function outpaintGeometry() {
  if(!sourceImage)throw new Error('Chọn ảnh nguồn trước.');
  const read=id=>{const value=Number($(id).value);if(!Number.isInteger(value)||value<0||value>8192)throw new Error('Kích thước và vị trí phải là số nguyên từ 0 đến 8192.');return value;};
  const width=read('outpaintWidth'),height=read('outpaintHeight'),left=read('outpaintLeft'),top=read('outpaintTop');
  const sw=sourceImage.naturalWidth,sh=sourceImage.naturalHeight;
  if(width<sw||height<sh||left+sw>width||top+sh>height)throw new Error('Khung mới phải chứa trọn ảnh gốc.');
  if(width===sw&&height===sh)throw new Error('Hãy mở rộng ít nhất một cạnh ảnh.');
  if(width*height>outpaintPixelLimit)throw new Error('Canvas vượt giới hạn diện tích; hãy giảm kích thước.');
  return {width,height,left,top,right:width-sw-left,bottom:height-sh-top};
}
let outpaintPixelLimit=16777216,outpaintSourceId='',outpaintSourceImage=null,outpaintDrag=null,outpaintServiceReady=false;
function resetOutpaintFrame(){
  if(!sourceImage)return;
  const sw=sourceImage.naturalWidth,sh=sourceImage.naturalHeight;
  $('outpaintWidth').value=Math.min(8192,sw+Math.max(64,Math.round(sw*.25)));
  $('outpaintHeight').value=sh;
  $('outpaintLeft').value=Math.floor((Number($('outpaintWidth').value)-sw)/2);$('outpaintTop').value=0;
  $('outpaintRatio').value='custom';
}
function applyOutpaintRatio(){
  if(!sourceImage||$('outpaintRatio').value==='custom')return;
  const [a,b]=$('outpaintRatio').value.split(':').map(Number),sw=sourceImage.naturalWidth,sh=sourceImage.naturalHeight;
  let width=Math.max(sw,Math.ceil(sh*a/b)),height=Math.max(sh,Math.ceil(sw*b/a));
  if(width===sw&&height===sh){width=Math.ceil(sw*1.25);height=Math.ceil(width*b/a);}
  $('outpaintWidth').value=width;$('outpaintHeight').value=height;
  $('outpaintLeft').value=Math.floor((width-sw)/2);$('outpaintTop').value=Math.floor((height-sh)/2);
}
function refreshOutpaintPreview(){
  const stage=$('outpaintStage');if(!stage)return;
  stage.hidden=studioMode!=='outpaint'||!sourceImage;
  if(studioMode!=='outpaint')return;
  $('editorCanvas').hidden=true;
  const second=document.querySelector('.journey-steps li:nth-child(2)'),third=document.querySelector('.journey-steps li:nth-child(3)');
  if(second){second.dataset.stepTarget='outpaintWidth';second.querySelector('strong').textContent='Khung mở rộng';second.querySelector('small').textContent='Chọn tỷ lệ và vị trí';}
  if(third){third.dataset.stepTarget='outpaintPrompt';third.querySelector('strong').textContent='Mô tả';third.querySelector('small').textContent='Nội dung phần mở rộng';}
  const toolbarHint=document.querySelector('.canvas-toolbar>span:last-child');if(toolbarHint)toolbarHint.textContent='Ô caro: vùng sẽ tạo thêm · Viền xanh: ảnh gốc';
  if(current?.id!==outpaintSourceId||sourceImage!==outpaintSourceImage){outpaintSourceId=current?.id||'';outpaintSourceImage=sourceImage;resetOutpaintFrame();}
  let g;try{g=outpaintGeometry();}catch(error){$('outpaintGeometryHint').textContent=error.message;$('outpaintRun').disabled=true;const preview=$('outpaintPreview');preview.getContext('2d').clearRect(0,0,preview.width,preview.height);return;}
  $('outpaintRun').disabled=Boolean(activeJobId)||!outpaintServiceReady;
  $('outpaintRight').value=g.right;$('outpaintBottom').value=g.bottom;
  $('outpaintGeometryHint').textContent=`${g.width} × ${g.height} px · Thêm trái ${g.left}, phải ${g.right}, trên ${g.top}, dưới ${g.bottom} px`;
  const preview=$('outpaintPreview'),scale=Math.min(1000/g.width,700/g.height,1);
  preview.width=Math.max(1,Math.round(g.width*scale));preview.height=Math.max(1,Math.round(g.height*scale));
  const ctx=preview.getContext('2d');ctx.fillStyle='#233148';ctx.fillRect(0,0,preview.width,preview.height);
  ctx.fillStyle='#30445f';for(let y=0;y<preview.height;y+=24)for(let x=0;x<preview.width;x+=24)if((x/24+y/24)%2===0)ctx.fillRect(x,y,24,24);
  ctx.drawImage(sourceImage,g.left*scale,g.top*scale,sourceImage.naturalWidth*scale,sourceImage.naturalHeight*scale);
  ctx.strokeStyle='#74d7ff';ctx.lineWidth=2;ctx.strokeRect(g.left*scale,g.top*scale,sourceImage.naturalWidth*scale,sourceImage.naturalHeight*scale);
  refreshOutpaintEstimate();
}
let outpaintProfileModel='';
let outpaintTiming=[],outpaintResultContext=null;
function outpaintPresetValues(name,flux){
  const profiles={fast:{steps:flux?24:20,resolution:640,detail:false,fabric:false,seam:true},balanced:{steps:flux?36:28,resolution:768,detail:true,fabric:false,seam:true},detail:{steps:flux?50:30,resolution:1024,detail:true,fabric:true,seam:true}};
  return profiles[name]||profiles.detail;
}
function applyOutpaintPreset(name){
  if(name==='custom')return;
  const p=outpaintPresetValues(name,/flux.*fill/i.test($('outpaintModel').value));
  for(const [id,value] of Object.entries({outpaintSteps:p.steps,outpaintResolution:p.resolution,outpaintGuidance:/flux.*fill/i.test($('outpaintModel').value)?30:5,outpaintOverlap:16})){
    $(id).value=String(value);delete $(id).dataset.userEdited;
  }
  $('outpaintDetail').checked=p.detail;$('outpaintMaterialRefine').checked=p.fabric;$('outpaintSeamRepair').checked=p.seam;
  if($('outpaintPreset'))$('outpaintPreset').value=name;
  syncOutpaintQualityOptions();refreshOutpaintEstimate();
}
function estimateOutpaintWork(g,{side,steps,count,seam,detail,fabric,layout}){
  const tiles=(Math.ceil(Math.max(0,g.width-side)/(side*.75))+1)*(Math.ceil(Math.max(0,g.height-side)/(side*.75))+1);
  return {layout:steps*count,finish:tiles*((seam?32:0)+(detail?7:0)+(fabric?18:0)),total:count*(steps+(layout?0:tiles*((seam?32:0)+(detail?7:0)+(fabric?18:0))))};
}
function refreshOutpaintEstimate(){
  const hint=$('outpaintEstimate');if(!hint)return;
  if(!outpaintServiceReady){hint.textContent='Phiên dịch vụ này chưa nạp bản mở rộng ảnh mới. Hãy mở phiên đã nâng cấp hoặc khởi động lại ứng dụng.';return;}
  const layout=Boolean($('outpaintChooseLayout')?.checked);
  if($('outpaintRun'))$('outpaintRun').textContent=layout?'Tạo bố cục mở rộng':'Tạo ảnh mở rộng';
  let g;try{g=outpaintGeometry();}catch{hint.textContent='Chọn ảnh và khung mở rộng để xem ước tính.';return;}
  const side=Number($('outpaintResolution').value),sample=outpaintTiming.find(x=>x.modelId===$('outpaintModel').value&&x.maxSide===side);
  if(!sample){hint.textContent='Chưa đủ lịch sử cho model và độ phân giải này. Chọn bố cục trước giúp giảm thời gian hoàn thiện nhiều phương án.';return;}
  const work=estimateOutpaintWork(g,{side,steps:Number($('outpaintSteps').value),count:Number($('outpaintCount').value),seam:$('outpaintSeamRepair').checked,detail:$('outpaintDetail').checked,fabric:$('outpaintDetail').checked&&$('outpaintMaterialRefine').checked,layout});
  const range=units=>`${Math.max(1,Math.floor(units*sample.secondsPerStep*.7/60))}–${Math.max(1,Math.ceil(units*sample.secondsPerStep*1.6/60))} phút`;
  hint.textContent=`Ước tính ${layout?'tạo bố cục':'toàn bộ'}: ${range(work.total)}${layout?' · hoàn thiện một ảnh: '+range(work.finish):''}. Tham khảo ${sample.sampleCount} lần chạy; thời gian thực tế còn tùy nội dung và lúc nạp model.`;
}
function applyOutpaintModelProfile(force=false){
  const model=$('outpaintModel')?.value;if(!model)return;
  if(!force&&model===outpaintProfileModel)return;
  outpaintProfileModel=model;
  const flux=/flux.*fill/i.test(model);
  const p=outpaintPresetValues($('outpaintPreset')?.value||'detail',flux);
  for(const [id,value] of Object.entries({outpaintSteps:p.steps,outpaintGuidance:flux?30:5,outpaintResolution:p.resolution,outpaintOverlap:16})){
    const field=$(id);if(field&&(force||!field.dataset?.userEdited))field.value=String(value);
  }
  if($('outpaintQualityHint'))$('outpaintQualityHint').textContent='Thiết lập theo model. Số phương án và chế độ giữ ảnh gốc được chọn riêng.';
}
function syncOutpaintModels(){
  const input=$('inpaintModelSelect'),select=$('outpaintModel');if(!select||!input)return;
  const saved=select.value||localStorage.getItem('outpaintModelChoice');select.innerHTML=input.innerHTML;select.disabled=input.disabled;
  select.value=[...select.options].some(o=>o.value===saved&&!o.disabled)?saved:input.value;
  applyOutpaintModelProfile();
}
function outpaintReady(){try{outpaintGeometry();return true;}catch{return false;}}
function syncOutpaintQualityOptions(changed){
  if(changed==='outpaintSourceEnhance'&&$('outpaintSourceEnhance').checked)$('outpaintPreserve').checked=false;
  if(changed==='outpaintPreserve'&&$('outpaintPreserve').checked)$('outpaintSourceEnhance').checked=false;
  $('outpaintMaterialRefine').disabled=!$('outpaintDetail').checked;
  const continuation=$('outpaintBackgroundContinuity');
  if(continuation){continuation.disabled=!$('outpaintPreserve').checked;if(continuation.disabled)continuation.checked=false;}
}
function showSavedOutpaintResults(state){
  const results=(state.results||[]).filter(item=>item.file);if(!results.length)return setMessage('Tác vụ chưa có ảnh kết quả được lưu.','error');
  activateAppView('create');setStudioMode('outpaint');
  const latest=results[results.length-1],directory=String(latest.file).replace(/\\/g,'/').replace(/\/[^/]+$/,'');
  const sameRun=results.filter(item=>String(item.file).replace(/\\/g,'/').startsWith(String(directory).replace(/\\/g,'/')+'/'));
  renderOutpaintResults({results:sameRun,directory,width:state.width,height:state.height,modelName:state.model},state.sourceId||latest.sampleId);
}
function renderOutpaintResults(result,sourceId){
  outpaintResultContext={...result,sourceId};
  currentRunDirectory=result.directory;
  const reference=outputUrl(result.directory+'/source_canvas.png');
  $('resultsGrid').innerHTML=`<article class="result-card"><img src="${escapeHtml(reference)}" alt="Ảnh nguồn trong khung mới"><p>Ảnh nguồn trong khung mới</p></article>`+result.results.map(item=>`<article class="result-card"><img src="${escapeHtml(outputUrl(item.file))}" alt="Ảnh mở rộng seed ${item.seed}"><p>${result.modelName?escapeHtml(result.modelName)+' · ':''}${item.layoutOnly?'Bố cục · ':''}Seed ${item.seed} · ${result.width} × ${result.height} px<br> ${item.sourceEnhanced?'Đã hoàn thiện ảnh gốc · Mức chỉnh':'Chênh lệch nguồn'}: ${Number(item.originalRegionMAE).toFixed(3)}/255${item.diagnostics?.final?.sourceCoreMAE===0&&item.diagnostics?.final?.protectedMAE===0?'<br> Giữ nguyên vùng lõi và vùng bảo vệ':''}${item.qualityChecks?.some(c=>!c.accepted)?'<br> Đã giữ bản trước ở bước không đạt kiểm tra':''}</p>${item.backgroundContinuity?.applied?'<small>Đã lấy màu và chi tiết nền từ ảnh gốc để đồng bộ phần mở rộng.</small>':''}${item.finalReview?`<p class="outpaint-final-review">${escapeHtml(item.finalReview.message)}</p>`:''}${item.layoutOnly?`<small>Hoàn thiện theo thiết lập lúc tạo bố cục.</small><button data-outpaint-refine="${item.seed}">Hoàn thiện ảnh này</button>`:''}<button data-outpaint-inspect="${item.seed}">Xem đường nối ở 100%</button><button data-seed="${item.seed}" data-task="outpaint" data-sample-id="${escapeHtml(sourceId)}" data-directory="${escapeHtml(result.directory)}">Chọn làm kết quả chính</button><a href="${escapeHtml(outputUrl(item.file))}" download>Tải PNG</a></article>`).join('');
  for(const button of $('resultsGrid').querySelectorAll('[data-seed]'))button.onclick=()=>selectPrimary(Number(button.dataset.seed),button);
  for(const button of $('resultsGrid').querySelectorAll('[data-outpaint-refine]'))button.onclick=()=>refineOutpaintResult(Number(button.dataset.outpaintRefine));
  for(const button of $('resultsGrid').querySelectorAll('[data-outpaint-inspect]'))button.onclick=()=>inspectOutpaintResult(Number(button.dataset.outpaintInspect));
  const first=result.results[0]?outputUrl(result.results[0].file):'';
  presentStudioResults(reference,first);if(first)showCompare(reference,first);
}
async function outpaintMetadata(context){
  const response=await fetch(outputUrl(context.directory+'/metadata.json'));
  if(!response.ok)throw new Error('Không đọc được cấu hình bố cục đã lưu.');
  return response.json();
}
function syncOutpaintContextActions(card){
  const target=$('studioOutpaintContextActions');if(!target)return;
  target.replaceChildren();
  for(const original of card.querySelectorAll('[data-outpaint-refine],[data-outpaint-inspect],[data-enhance-inspect],[data-enhance-edit],[data-makeup-inspect],[data-makeup-edit]')){
    const button=original.cloneNode(true);button.onclick=()=>original.click();target.append(button);
  }
}
async function refineOutpaintResult(seed){
  if(activeJobId||inpaintPromptReviewPending||descriptionTryonRunning)return setMessage('Hãy hoàn tất tác vụ hiện tại.','error');
  const context=outpaintResultContext;
  try{
    const metadata=await outpaintMetadata(context);
    if(!metadata.request)throw new Error('Bố cục cũ chưa hỗ trợ hoàn thiện riêng; hãy tạo bố cục mới.');
    await submitOutpaint({...metadata.request,count:1,seed,runMode:'refine',refineFrom:{directory:context.directory,seed}},metadata.source);
  }catch(error){setMessage(error.message,'error');}
}
async function inspectOutpaintResult(seed){
  const context=outpaintResultContext,item=context.results.find(r=>r.seed===seed);if(!item)return;
  try{
    const metadata=await outpaintMetadata(context),g=metadata.geometry;
    if(!g||!['width','height','left','top','sourceWidth','sourceHeight'].every(k=>Number.isInteger(g[k])&&g[k]>=0&&g[k]<=8192))throw new Error('Khung ảnh đã lưu không hợp lệ.');
    const dialog=document.createElement('dialog');dialog.className='outpaint-inspector';
    dialog.setAttribute('aria-label','Kiểm tra đường nối ở kích thước thật');
    dialog.innerHTML=`<div class="outpaint-inspector-tools"><strong>Ảnh ở 100% · kéo thanh cuộn để xem các cạnh</strong><label><input type="checkbox" checked> Hiện viền ảnh gốc</label><button type="button">Đóng</button></div><div class="outpaint-inspector-scroll"><div style="position:relative;width:${g.width}px;height:${g.height}px"><img src="${escapeHtml(outputUrl(item.file))}" alt="Ảnh mở rộng ở kích thước thật" width="${g.width}" height="${g.height}"><span class="outpaint-source-outline" style="left:${g.left}px;top:${g.top}px;width:${g.sourceWidth}px;height:${g.sourceHeight}px"></span></div></div>`;
    document.body.appendChild(dialog);dialog.querySelector('button').onclick=()=>dialog.close();
    dialog.querySelector('input').onchange=event=>{dialog.querySelector('.outpaint-source-outline').hidden=!event.target.checked;};
    dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
  }catch(error){setMessage(error.message,'error');}
}
function setupOutpainting(){
  syncOutpaintModels();
  new MutationObserver(()=>{syncOutpaintModels();refreshStudioReadiness();}).observe($('inpaintModelSelect'),{childList:true,subtree:true,attributes:true});
  for(const id of ['outpaintWidth','outpaintHeight','outpaintLeft','outpaintTop'])$(id).addEventListener('input',()=>{if(id==='outpaintWidth'||id==='outpaintHeight')$('outpaintRatio').value='custom';refreshOutpaintPreview();refreshStudioReadiness();});
  for(const id of ['outpaintRight','outpaintBottom'])$(id).addEventListener('input',()=>{if(!sourceImage)return;const value=Number($(id).value);if(!Number.isInteger(value)||value<0||value>8192)return setMessage('Phần mở rộng phải là số nguyên từ 0 đến 8192.','error');if(id==='outpaintRight')$('outpaintWidth').value=sourceImage.naturalWidth+Number($('outpaintLeft').value)+value;else $('outpaintHeight').value=sourceImage.naturalHeight+Number($('outpaintTop').value)+value;$('outpaintRatio').value='custom';refreshOutpaintPreview();refreshStudioReadiness();});
  $('outpaintRatio').addEventListener('change',()=>{applyOutpaintRatio();refreshOutpaintPreview();refreshStudioReadiness();});
  $('outpaintCenter').onclick=()=>{if(!sourceImage)return;$('outpaintLeft').value=Math.max(0,Math.floor((Number($('outpaintWidth').value)-sourceImage.naturalWidth)/2));$('outpaintTop').value=Math.max(0,Math.floor((Number($('outpaintHeight').value)-sourceImage.naturalHeight)/2));refreshOutpaintPreview();refreshStudioReadiness();};
  $('outpaintModel').addEventListener('change',()=>{localStorage.setItem('outpaintModelChoice',$('outpaintModel').value);applyOutpaintModelProfile(true);refreshStudioReadiness();});
  for(const id of ['outpaintSteps','outpaintGuidance','outpaintResolution','outpaintOverlap'])$(id).addEventListener('input',()=>{$(id).dataset.userEdited='true';$('outpaintPreset').value='custom';refreshOutpaintEstimate();});
  for(const id of ['outpaintPreserve','outpaintSourceEnhance','outpaintDetail'])$(id).addEventListener('change',()=>syncOutpaintQualityOptions(id));
  for(const id of ['outpaintDetail','outpaintSeamRepair','outpaintMaterialRefine'])$(id).addEventListener('change',()=>{$('outpaintPreset').value='custom';});
  syncOutpaintQualityOptions();
  $('outpaintQuality').onclick=()=>{applyOutpaintPreset('detail');refreshStudioReadiness();};
  $('outpaintPreset').onchange=()=>applyOutpaintPreset($('outpaintPreset').value);
  for(const id of ['outpaintCount','outpaintChooseLayout','outpaintDetail','outpaintSeamRepair','outpaintMaterialRefine','outpaintModel','outpaintWidth','outpaintHeight','outpaintRatio'])$(id).addEventListener('change',refreshOutpaintEstimate);
  $('outpaintRun').onclick=runOutpaint;
  $('studioContinueOutpaint').onclick=()=>continueFromSelectedResult('outpaint');
  const preview=$('outpaintPreview');
  preview.addEventListener('pointerdown',event=>{if(!outpaintReady()||activeJobId)return;const g=outpaintGeometry(),rect=preview.getBoundingClientRect(),x=(event.clientX-rect.left)*g.width/rect.width,y=(event.clientY-rect.top)*g.height/rect.height;if(x<g.left||x>g.width-g.right||y<g.top||y>g.height-g.bottom)return;outpaintDrag={x:event.clientX,y:event.clientY,left:g.left,top:g.top};preview.setPointerCapture(event.pointerId);});
  preview.addEventListener('pointermove',event=>{if(!outpaintDrag)return;const rect=preview.getBoundingClientRect(),w=Number($('outpaintWidth').value),h=Number($('outpaintHeight').value);$('outpaintLeft').value=Math.max(0,Math.min(w-sourceImage.naturalWidth,Math.round(outpaintDrag.left+(event.clientX-outpaintDrag.x)*w/rect.width)));$('outpaintTop').value=Math.max(0,Math.min(h-sourceImage.naturalHeight,Math.round(outpaintDrag.top+(event.clientY-outpaintDrag.y)*h/rect.height)));refreshOutpaintPreview();refreshStudioReadiness();});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])preview.addEventListener(name,()=>outpaintDrag=null);
  fetch('/api/outpaint-config').then(r=>r.json()).then(config=>{if(Number.isInteger(config.maxPixels))outpaintPixelLimit=config.maxPixels;outpaintTiming=config.timing||[];outpaintServiceReady=config.version>=2&&config.serviceReady===true;refreshOutpaintPreview();refreshStudioReadiness();refreshOutpaintEstimate();}).catch(()=>refreshOutpaintEstimate());
}
async function runOutpaint(){
  if(activeJobId||inpaintPromptReviewPending||descriptionTryonRunning)return setMessage('Hãy hoàn tất tác vụ hiện tại.','error');
  let g;try{g=outpaintGeometry();}catch(error){return setMessage(error.message,'error');}
  if(!$('outpaintModel').value||$('outpaintModel').disabled)return setMessage('Hãy chọn model sẵn sàng.','error');
  const request={...g,sampleId:current.id,modelId:$('outpaintModel').value,prompt:$('outpaintPrompt').value,negativePrompt:$('outpaintNegative').value,preserveOriginal:$('outpaintPreserve').checked,overlap:Number($('outpaintOverlap').value),seed:Number($('outpaintSeed').value),steps:Number($('outpaintSteps').value),guidance:Number($('outpaintGuidance').value),maxSide:Number($('outpaintResolution').value),count:Number($('outpaintCount').value),detailPass:$('outpaintDetail').checked,materialRefine:$('outpaintDetail').checked&&$('outpaintMaterialRefine').checked,sourceEnhance:$('outpaintSourceEnhance').checked,seamRepair:$('outpaintSeamRepair').checked,backgroundContinuity:$('outpaintBackgroundContinuity').checked,seamWidth:Number($('outpaintSeamWidth').value),protectedDetailMask:binaryMaskDataUrl(false,true,true),runMode:$('outpaintChooseLayout').checked?'layout':'complete'};
  await submitOutpaint(request,current.id);
}
async function submitOutpaint(request,sourceId){
  if(!outpaintServiceReady)return setMessage('Phiên AI chưa nạp bản mới; hãy mở phiên đã nâng cấp hoặc khởi động lại ứng dụng.','error');
  if(activeJobId||inpaintPromptReviewPending||descriptionTryonRunning)return setMessage('Hãy hoàn tất tác vụ hiện tại.','error');
  const jobId=createJobId('outpaint');
  setActiveJob(jobId);let succeeded=false,jobError='';
  try{
    const response=await fetch('/api/outpaint',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,jobId})});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể mở rộng ảnh.');
    succeeded=true;renderOutpaintResults(result,sourceId);
    setMessage(`Đã tạo ${result.results.length} ${result.runMode==='layout'?'bố cục; chọn một ảnh để hoàn thiện':'ảnh mở rộng'} · ${result.width} × ${result.height} px${result.warnings?.length?' · Lưu ý: '+result.warnings.join('; '):''}`,'success');
  }catch(error){jobError=error.message;setMessage(error.message,'error');}
  finally{await settleJob(jobId,succeeded?'completed':'failed',jobError);}
}
