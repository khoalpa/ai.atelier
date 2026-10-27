/* Outpainting controls share the Studio source, jobs and result selection. */
function outpaintGeometry() {
  if(!globalThis.AtelierApp.sourceImage)throw new Error('Chọn ảnh nguồn trước.');
  const read=id=>{const value=Number(globalThis.AtelierApp.$(id).value);if(!Number.isInteger(value)||value<0||value>8192)throw new Error('Kích thước và vị trí phải là số nguyên từ 0 đến 8192.');return value;};
  const width=read('outpaintWidth'),height=read('outpaintHeight'),left=read('outpaintLeft'),top=read('outpaintTop');
  const sw=globalThis.AtelierApp.sourceImage.naturalWidth,sh=globalThis.AtelierApp.sourceImage.naturalHeight;
  if(width<sw||height<sh||left+sw>width||top+sh>height)throw new Error('Khung mới phải chứa trọn ảnh gốc.');
  if(width===sw&&height===sh)throw new Error('Hãy mở rộng ít nhất một cạnh ảnh.');
  if(width*height>outpaintPixelLimit)throw new Error('Canvas vượt giới hạn diện tích; hãy giảm kích thước.');
  return {width,height,left,top,right:width-sw-left,bottom:height-sh-top};
}
let outpaintPixelLimit=16777216,outpaintSourceId='',outpaintSourceImage=null,outpaintDrag=null,outpaintServiceReady=false;
function resetOutpaintFrame(){
  if(!globalThis.AtelierApp.sourceImage)return;
  const sw=globalThis.AtelierApp.sourceImage.naturalWidth,sh=globalThis.AtelierApp.sourceImage.naturalHeight;
  globalThis.AtelierApp.$('outpaintWidth').value=Math.min(8192,sw+Math.max(64,Math.round(sw*.25)));
  globalThis.AtelierApp.$('outpaintHeight').value=sh;
  globalThis.AtelierApp.$('outpaintLeft').value=Math.floor((Number(globalThis.AtelierApp.$('outpaintWidth').value)-sw)/2);globalThis.AtelierApp.$('outpaintTop').value=0;
  globalThis.AtelierApp.$('outpaintRatio').value='custom';
}
function applyOutpaintRatio(){
  if(!globalThis.AtelierApp.sourceImage||globalThis.AtelierApp.$('outpaintRatio').value==='custom')return;
  const [a,b]=globalThis.AtelierApp.$('outpaintRatio').value.split(':').map(Number),sw=globalThis.AtelierApp.sourceImage.naturalWidth,sh=globalThis.AtelierApp.sourceImage.naturalHeight;
  let width=Math.max(sw,Math.ceil(sh*a/b)),height=Math.max(sh,Math.ceil(sw*b/a));
  if(width===sw&&height===sh){width=Math.ceil(sw*1.25);height=Math.ceil(width*b/a);}
  globalThis.AtelierApp.$('outpaintWidth').value=width;globalThis.AtelierApp.$('outpaintHeight').value=height;
  globalThis.AtelierApp.$('outpaintLeft').value=Math.floor((width-sw)/2);globalThis.AtelierApp.$('outpaintTop').value=Math.floor((height-sh)/2);
}
function applyOutpaintDirection(direction){
  if(!globalThis.AtelierApp.sourceImage)return;
  const sw=globalThis.AtelierApp.sourceImage.naturalWidth,sh=globalThis.AtelierApp.sourceImage.naturalHeight;
  const extraX=Math.max(64,Math.round(sw*.25)),extraY=Math.max(64,Math.round(sh*.25));
  let width=sw,height=sh,left=0,top=0;
  if(direction==='even'){width=Math.min(8192,sw+extraX);height=Math.min(8192,sh+extraY);left=Math.floor((width-sw)/2);top=Math.floor((height-sh)/2);}
  if(direction==='left'){width=Math.min(8192,sw+extraX);left=width-sw;}
  if(direction==='right')width=Math.min(8192,sw+extraX);
  if(direction==='top'){height=Math.min(8192,sh+extraY);top=height-sh;}
  if(direction==='bottom')height=Math.min(8192,sh+extraY);
  Object.entries({outpaintWidth:width,outpaintHeight:height,outpaintLeft:left,outpaintTop:top}).forEach(([id,value])=>{globalThis.AtelierApp.$(id).value=value;});
  globalThis.AtelierApp.$('outpaintRatio').value='custom';refreshOutpaintPreview();globalThis.AtelierApp.refreshStudioReadiness();
}
function alignOutpaintSource(position){
  if(!globalThis.AtelierApp.sourceImage)return;
  const width=Number(globalThis.AtelierApp.$('outpaintWidth').value),height=Number(globalThis.AtelierApp.$('outpaintHeight').value),sw=globalThis.AtelierApp.sourceImage.naturalWidth,sh=globalThis.AtelierApp.sourceImage.naturalHeight;
  if(position==='reset')return resetOutpaintFrame(),refreshOutpaintPreview(),globalThis.AtelierApp.refreshStudioReadiness();
  let left=Number(globalThis.AtelierApp.$('outpaintLeft').value),top=Number(globalThis.AtelierApp.$('outpaintTop').value);
  if(position==='center'){left=Math.floor((width-sw)/2);top=Math.floor((height-sh)/2);}
  if(position==='left')left=0;if(position==='right')left=width-sw;if(position==='top')top=0;if(position==='bottom')top=height-sh;
  globalThis.AtelierApp.$('outpaintLeft').value=Math.max(0,left);globalThis.AtelierApp.$('outpaintTop').value=Math.max(0,top);refreshOutpaintPreview();globalThis.AtelierApp.refreshStudioReadiness();
}
function refreshOutpaintPreview(){
  const stage=globalThis.AtelierApp.$('outpaintStage');if(!stage)return;
  stage.hidden=globalThis.AtelierApp.studioMode!=='outpaint'||!globalThis.AtelierApp.sourceImage;
  if(globalThis.AtelierApp.studioMode!=='outpaint')return;
  globalThis.AtelierApp.$('editorCanvas').hidden=true;
  const second=document.querySelector('.journey-steps li:nth-child(2)'),third=document.querySelector('.journey-steps li:nth-child(3)');
  if(second){second.dataset.stepTarget='outpaintWidth';second.querySelector('strong').textContent='Khung mở rộng';second.querySelector('small').textContent='Chọn tỷ lệ và vị trí';}
  if(third){third.dataset.stepTarget='outpaintPrompt';third.querySelector('strong').textContent='Mô tả';third.querySelector('small').textContent='Nội dung phần mở rộng';}
  const toolbarHint=document.querySelector('.canvas-toolbar>span:last-child');if(toolbarHint)toolbarHint.textContent='Ô caro: vùng sẽ tạo thêm · Viền xanh: ảnh gốc';
  if(globalThis.AtelierApp.current?.id!==outpaintSourceId||globalThis.AtelierApp.sourceImage!==outpaintSourceImage){outpaintSourceId=globalThis.AtelierApp.current?.id||'';outpaintSourceImage=globalThis.AtelierApp.sourceImage;resetOutpaintFrame();}
  let g;try{g=outpaintGeometry();}catch(error){globalThis.AtelierApp.$('outpaintGeometryHint').textContent=error.message;globalThis.AtelierApp.$('outpaintRun').disabled=true;const preview=globalThis.AtelierApp.$('outpaintPreview');preview.getContext('2d').clearRect(0,0,preview.width,preview.height);return;}
  globalThis.AtelierApp.$('outpaintRun').disabled=Boolean(globalThis.AtelierApp.activeJobId)||!outpaintServiceReady;
  globalThis.AtelierApp.$('outpaintRight').value=g.right;globalThis.AtelierApp.$('outpaintBottom').value=g.bottom;
  globalThis.AtelierApp.$('outpaintGeometryHint').textContent=`${g.width} × ${g.height} px · Thêm trái ${g.left}, phải ${g.right}, trên ${g.top}, dưới ${g.bottom} px`;
  const preview=globalThis.AtelierApp.$('outpaintPreview'),scale=Math.min(1000/g.width,700/g.height,1);
  preview.width=Math.max(1,Math.round(g.width*scale));preview.height=Math.max(1,Math.round(g.height*scale));
  const ctx=preview.getContext('2d');ctx.fillStyle='#233148';ctx.fillRect(0,0,preview.width,preview.height);
  ctx.fillStyle='#30445f';for(let y=0;y<preview.height;y+=24)for(let x=0;x<preview.width;x+=24)if((x/24+y/24)%2===0)ctx.fillRect(x,y,24,24);
  ctx.drawImage(globalThis.AtelierApp.sourceImage,g.left*scale,g.top*scale,globalThis.AtelierApp.sourceImage.naturalWidth*scale,globalThis.AtelierApp.sourceImage.naturalHeight*scale);
  ctx.strokeStyle='#74d7ff';ctx.lineWidth=2;ctx.strokeRect(g.left*scale,g.top*scale,globalThis.AtelierApp.sourceImage.naturalWidth*scale,globalThis.AtelierApp.sourceImage.naturalHeight*scale);
  refreshOutpaintEstimate();
}
let outpaintProfileModel='';
let outpaintTiming=[],outpaintResultContext=null;
function outpaintPresetValues(name,flux){
  const profiles=window.ATELIER_PROMPTS.runtimePresets.outpaintQuality[flux?'flux':'standard'];
  return profiles[name]||profiles.detail;
}
function applyOutpaintPreset(name){
  if(name==='custom')return;
  const p=outpaintPresetValues(name,/flux.*fill/i.test(globalThis.AtelierApp.$('outpaintModel').value));
  const model=globalThis.AtelierApp.$('outpaintModel').value,profile=globalThis.ATELIER_PROMPTS?.runtimePresets?.modelInpaintProfiles?.[model]||{};
  for(const [id,value] of Object.entries({outpaintSteps:name==='detail'&&profile.steps?profile.steps:p.steps,outpaintResolution:Math.min(p.resolution,profile.nativeResolution||p.resolution),outpaintGuidance:profile.guidance??(/flux.*fill/i.test(model)?30:5),outpaintOverlap:16})){
    globalThis.AtelierApp.$(id).value=String(value);delete globalThis.AtelierApp.$(id).dataset.userEdited;
  }
  globalThis.AtelierApp.$('outpaintDetail').checked=p.detail;globalThis.AtelierApp.$('outpaintMaterialRefine').checked=p.fabric;globalThis.AtelierApp.$('outpaintSeamRepair').checked=p.seam;
  if(globalThis.AtelierApp.$('outpaintPreset'))globalThis.AtelierApp.$('outpaintPreset').value=name;
  syncOutpaintQualityOptions();refreshOutpaintEstimate();
}
function estimateOutpaintWork(g,{side,steps,count,seam,detail,fabric,layout}){
  const tiles=(Math.ceil(Math.max(0,g.width-side)/(side*.75))+1)*(Math.ceil(Math.max(0,g.height-side)/(side*.75))+1);
  return {layout:steps*count,finish:tiles*((seam?32:0)+(detail?7:0)+(fabric?18:0)),total:count*(steps+(layout?0:tiles*((seam?32:0)+(detail?7:0)+(fabric?18:0))))};
}
function refreshOutpaintEstimate(){
  const hint=globalThis.AtelierApp.$('outpaintEstimate');if(!hint)return;
  if(!outpaintServiceReady){hint.textContent='Phiên dịch vụ này chưa nạp bản mở rộng ảnh mới. Hãy mở phiên đã nâng cấp hoặc khởi động lại ứng dụng.';return;}
  const layout=Boolean(globalThis.AtelierApp.$('outpaintChooseLayout')?.checked);
  if(globalThis.AtelierApp.$('outpaintRun'))globalThis.AtelierApp.$('outpaintRun').textContent=layout?'Tạo bố cục mở rộng':'Tạo ảnh mở rộng';
  let g;try{g=outpaintGeometry();}catch{hint.textContent='Chọn ảnh và khung mở rộng để xem ước tính.';return;}
  const side=Number(globalThis.AtelierApp.$('outpaintResolution').value),sample=outpaintTiming.find(x=>x.modelId===globalThis.AtelierApp.$('outpaintModel').value&&x.maxSide===side);
  if(!sample){hint.textContent='Chưa đủ lịch sử cho model và độ phân giải này. Chọn bố cục trước giúp giảm thời gian hoàn thiện nhiều phương án.';return;}
  const work=estimateOutpaintWork(g,{side,steps:Number(globalThis.AtelierApp.$('outpaintSteps').value),count:Number(globalThis.AtelierApp.$('outpaintCount').value),seam:globalThis.AtelierApp.$('outpaintSeamRepair').checked,detail:globalThis.AtelierApp.$('outpaintDetail').checked,fabric:globalThis.AtelierApp.$('outpaintDetail').checked&&globalThis.AtelierApp.$('outpaintMaterialRefine').checked,layout});
  const range=units=>`${Math.max(1,Math.floor(units*sample.secondsPerStep*.7/60))}–${Math.max(1,Math.ceil(units*sample.secondsPerStep*1.6/60))} phút`;
  hint.textContent=`Ước tính ${layout?'tạo bố cục':'toàn bộ'}: ${range(work.total)}${layout?' · hoàn thiện một ảnh: '+range(work.finish):''}. Tham khảo ${sample.sampleCount} lần chạy; thời gian thực tế còn tùy nội dung và lúc nạp model.`;
}
function applyOutpaintModelProfile(force=false){
  const model=globalThis.AtelierApp.$('outpaintModel')?.value;if(!model)return;
  if(!force&&model===outpaintProfileModel)return;
  outpaintProfileModel=model;
  const flux=/flux.*fill/i.test(model);
  const p=outpaintPresetValues(globalThis.AtelierApp.$('outpaintPreset')?.value||'detail',flux);
  const profile=globalThis.ATELIER_PROMPTS?.runtimePresets?.modelInpaintProfiles?.[model]||{};
  for(const [id,value] of Object.entries({outpaintSteps:profile.steps??p.steps,outpaintGuidance:profile.guidance??(flux?30:5),outpaintResolution:profile.nativeResolution??p.resolution,outpaintOverlap:16})){
    const field=globalThis.AtelierApp.$(id);if(field&&(force||!field.dataset?.userEdited))field.value=String(value);
  }
  if(globalThis.AtelierApp.$('outpaintQualityHint'))globalThis.AtelierApp.$('outpaintQualityHint').textContent='Thiết lập theo model. Số phương án và chế độ giữ ảnh gốc được chọn riêng.';
}
function syncOutpaintModels(){
  const input=globalThis.AtelierApp.$('inpaintModelSelect'),select=globalThis.AtelierApp.$('outpaintModel');if(!select||!input)return;
  const saved=select.value||localStorage.getItem('outpaintModelChoice');select.innerHTML=input.innerHTML;select.disabled=input.disabled;
  select.value=[...select.options].some(o=>o.value===saved&&!o.disabled)?saved:input.value;
  applyOutpaintModelProfile();
}
function outpaintReady(){try{outpaintGeometry();return true;}catch{return false;}}
function syncOutpaintQualityOptions(changed){
  if(changed==='outpaintSourceEnhance'&&globalThis.AtelierApp.$('outpaintSourceEnhance').checked)globalThis.AtelierApp.$('outpaintPreserve').checked=false;
  if(changed==='outpaintPreserve'&&globalThis.AtelierApp.$('outpaintPreserve').checked)globalThis.AtelierApp.$('outpaintSourceEnhance').checked=false;
  globalThis.AtelierApp.$('outpaintMaterialRefine').disabled=!globalThis.AtelierApp.$('outpaintDetail').checked;
  const continuation=globalThis.AtelierApp.$('outpaintBackgroundContinuity');
  if(continuation){continuation.disabled=!globalThis.AtelierApp.$('outpaintPreserve').checked;if(continuation.disabled)continuation.checked=false;}
}
function showSavedOutpaintResults(state){
  const results=(state.results||[]).filter(item=>item.file);if(!results.length)return globalThis.AtelierApp.setMessage('Tác vụ chưa có ảnh kết quả được lưu.','error');
  globalThis.AtelierApp.activateAppView('create');globalThis.AtelierApp.setStudioMode('outpaint');
  const latest=results[results.length-1],directory=String(latest.file).replace(/\\/g,'/').replace(/\/[^/]+$/,'');
  const sameRun=results.filter(item=>String(item.file).replace(/\\/g,'/').startsWith(String(directory).replace(/\\/g,'/')+'/'));
  renderOutpaintResults({results:sameRun,directory,width:state.width,height:state.height,modelName:state.model},state.sourceId||latest.sampleId);
}
function renderOutpaintResults(result,sourceId){
  outpaintResultContext={...result,sourceId};
  globalThis.AtelierApp.currentRunDirectory=result.directory;
  const reference=globalThis.AtelierApp.outputUrl(result.directory+'/source_canvas.png');
  globalThis.AtelierApp.$('resultsGrid').innerHTML=`<article class="result-card"><img src="${globalThis.AtelierApp.escapeHtml(reference)}" alt="Ảnh nguồn trong khung mới"><p>Ảnh nguồn trong khung mới</p></article>`+result.results.map(item=>`<article class="result-card"><img src="${globalThis.AtelierApp.escapeHtml(globalThis.AtelierApp.outputUrl(item.file))}" alt="Ảnh mở rộng seed ${item.seed}"><p>${result.modelName?globalThis.AtelierApp.escapeHtml(result.modelName)+' · ':''}${item.layoutOnly?'Bố cục · ':''}Seed ${item.seed} · ${result.width} × ${result.height} px<br> ${item.sourceEnhanced?'Đã hoàn thiện ảnh gốc · Mức chỉnh':'Chênh lệch nguồn'}: ${Number(item.originalRegionMAE).toFixed(3)}/255${item.diagnostics?.final?.sourceCoreMAE===0&&item.diagnostics?.final?.protectedMAE===0?'<br> Giữ nguyên vùng lõi và vùng bảo vệ':''}${item.qualityChecks?.some(c=>!c.accepted)?'<br> Đã giữ bản trước ở bước không đạt kiểm tra':''}</p>${item.backgroundContinuity?.applied?'<small>Đã lấy màu và chi tiết nền từ ảnh gốc để đồng bộ phần mở rộng.</small>':''}${item.finalReview?`<p class="outpaint-final-review">${globalThis.AtelierApp.escapeHtml(item.finalReview.message)}</p>`:''}${item.layoutOnly?`<small>Hoàn thiện theo thiết lập lúc tạo bố cục.</small><button data-outpaint-refine="${item.seed}">Hoàn thiện ảnh này</button>`:''}<button data-outpaint-inspect="${item.seed}">Xem đường nối ở 100%</button><button data-seed="${item.seed}" data-task="outpaint" data-sample-id="${globalThis.AtelierApp.escapeHtml(sourceId)}" data-directory="${globalThis.AtelierApp.escapeHtml(result.directory)}">Chọn làm kết quả chính</button><a href="${globalThis.AtelierApp.escapeHtml(globalThis.AtelierApp.outputUrl(item.file))}" download>Tải PNG</a></article>`).join('');
  for(const button of globalThis.AtelierApp.$('resultsGrid').querySelectorAll('[data-seed]'))button.onclick=()=>globalThis.AtelierApp.selectPrimary(Number(button.dataset.seed),button);
  for(const button of globalThis.AtelierApp.$('resultsGrid').querySelectorAll('[data-outpaint-refine]'))button.onclick=()=>refineOutpaintResult(Number(button.dataset.outpaintRefine));
  for(const button of globalThis.AtelierApp.$('resultsGrid').querySelectorAll('[data-outpaint-inspect]'))button.onclick=()=>inspectOutpaintResult(Number(button.dataset.outpaintInspect));
  const first=result.results[0]?globalThis.AtelierApp.outputUrl(result.results[0].file):'';
  globalThis.AtelierApp.presentStudioResults(reference,first);if(first)globalThis.AtelierApp.showCompare(reference,first);
}
async function outpaintMetadata(context){
  const response=await fetch(globalThis.AtelierApp.outputUrl(context.directory+'/metadata.json'));
  if(!response.ok)throw new Error('Không đọc được cấu hình bố cục đã lưu.');
  return response.json();
}
function syncOutpaintContextActions(card){
  const target=globalThis.AtelierApp.$('studioOutpaintContextActions');if(!target)return;
  target.replaceChildren();
  for(const original of card.querySelectorAll('[data-outpaint-refine],[data-outpaint-inspect],[data-enhance-inspect],[data-enhance-edit],[data-makeup-inspect],[data-makeup-edit]')){
    const button=original.cloneNode(true);button.onclick=()=>original.click();target.append(button);
  }
}
async function refineOutpaintResult(seed){
  if(globalThis.AtelierApp.activeJobId||globalThis.AtelierApp.inpaintPromptReviewPending||descriptionTryonRunning)return globalThis.AtelierApp.setMessage('Hãy hoàn tất tác vụ hiện tại.','error');
  const context=outpaintResultContext;
  try{
    const metadata=await outpaintMetadata(context);
    if(!metadata.request)throw new Error('Bố cục cũ chưa hỗ trợ hoàn thiện riêng; hãy tạo bố cục mới.');
    await submitOutpaint({...metadata.request,count:1,seed,runMode:'refine',refineFrom:{directory:context.directory,seed}},metadata.source);
  }catch(error){globalThis.AtelierApp.setMessage(error.message,'error');}
}
async function inspectOutpaintResult(seed){
  const context=outpaintResultContext,item=context.results.find(r=>r.seed===seed);if(!item)return;
  try{
    const metadata=await outpaintMetadata(context),g=metadata.geometry;
    if(!g||!['width','height','left','top','sourceWidth','sourceHeight'].every(k=>Number.isInteger(g[k])&&g[k]>=0&&g[k]<=8192))throw new Error('Khung ảnh đã lưu không hợp lệ.');
    const dialog=document.createElement('dialog');dialog.className='outpaint-inspector';
    dialog.setAttribute('aria-label','Kiểm tra đường nối ở kích thước thật');
    dialog.innerHTML=`<div class="outpaint-inspector-tools"><strong>Ảnh ở 100% · kéo thanh cuộn để xem các cạnh</strong><label><input type="checkbox" checked> Hiện viền ảnh gốc</label><button type="button">Đóng</button></div><div class="outpaint-inspector-scroll"><div style="position:relative;width:${g.width}px;height:${g.height}px"><img src="${globalThis.AtelierApp.escapeHtml(globalThis.AtelierApp.outputUrl(item.file))}" alt="Ảnh mở rộng ở kích thước thật" width="${g.width}" height="${g.height}"><span class="outpaint-source-outline" style="left:${g.left}px;top:${g.top}px;width:${g.sourceWidth}px;height:${g.sourceHeight}px"></span></div></div>`;
    document.body.appendChild(dialog);dialog.querySelector('button').onclick=()=>dialog.close();
    dialog.querySelector('input').onchange=event=>{dialog.querySelector('.outpaint-source-outline').hidden=!event.target.checked;};
    dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
  }catch(error){globalThis.AtelierApp.setMessage(error.message,'error');}
}
function setupOutpainting(){
  const panel=globalThis.AtelierApp.$('studioOutpaintPanel');
  const ratioLabel=globalThis.AtelierApp.$('outpaintRatio').closest('label');ratioLabel.hidden=true;
  const frame=document.createElement('section');frame.className='outpaint-main-section';frame.innerHTML='<strong>Khung mới</strong><div class="outpaint-ratio-buttons" role="group" aria-label="Tỷ lệ khung mới"><button type="button" data-outpaint-ratio="1:1">1:1</button><button type="button" data-outpaint-ratio="4:5">4:5</button><button type="button" data-outpaint-ratio="3:2">3:2</button><button type="button" data-outpaint-ratio="16:9">16:9</button><button type="button" data-outpaint-ratio="9:16">9:16</button><button type="button" data-outpaint-ratio="custom">Tùy chỉnh</button></div><small>Mở rộng theo tỷ lệ</small><div class="outpaint-direction-buttons" role="group" aria-label="Hướng mở rộng"><button type="button" data-outpaint-direction="even">Mở rộng đều</button><button type="button" data-outpaint-direction="left">Sang trái</button><button type="button" data-outpaint-direction="right">Sang phải</button><button type="button" data-outpaint-direction="top">Lên trên</button><button type="button" data-outpaint-direction="bottom">Xuống dưới</button></div><small>Đặt ảnh trong khung</small><div class="outpaint-align-buttons" role="group" aria-label="Căn ảnh trong khung"><button type="button" data-outpaint-align="center">Căn giữa</button><button type="button" data-outpaint-align="left">Căn trái</button><button type="button" data-outpaint-align="right">Căn phải</button><button type="button" data-outpaint-align="top">Căn trên</button><button type="button" data-outpaint-align="bottom">Căn dưới</button><button type="button" data-outpaint-align="reset">Đặt lại</button></div>';
  const custom=document.createElement('details');custom.className='outpaint-custom-size';custom.innerHTML='<summary>Kích thước tùy chỉnh</summary>';custom.append(ratioLabel,panel.querySelector('.outpaint-fields'));
  const quality=document.createElement('fieldset');quality.className='outpaint-quality-main';quality.innerHTML='<legend>Chất lượng</legend><div class="button-row" role="group" aria-label="Chất lượng mở rộng ảnh"><button type="button" data-outpaint-quality="fast">Nhanh</button><button id="outpaintBalancedQualityButton" type="button" data-outpaint-quality="balanced" class="active" aria-pressed="true">Cân bằng</button><button type="button" data-outpaint-quality="detail">Chi tiết</button></div>';
  const mode=document.createElement('fieldset');mode.className='outpaint-run-mode';mode.innerHTML='<legend>Cách tạo</legend><label><input type="radio" name="outpaintRunMode" value="layout" checked> Chọn bố cục trước <small>Khuyến nghị</small></label><label><input type="radio" name="outpaintRunMode" value="complete"> Tạo ảnh hoàn chỉnh ngay</label>';
  panel.querySelector('summary').after(frame,custom);globalThis.AtelierApp.$('outpaintPrompt').closest('label').after(quality);quality.append(globalThis.AtelierApp.$('outpaintCount').closest('label'));globalThis.AtelierApp.$('outpaintEstimate').before(mode);
  globalThis.AtelierApp.$('outpaintPreset').closest('label').hidden=true;globalThis.AtelierApp.$('outpaintChooseLayout').closest('label').hidden=true;globalThis.AtelierApp.$('outpaintCenter').hidden=true;globalThis.AtelierApp.$('outpaintQuality').hidden=true;globalThis.AtelierApp.$('outpaintRun').hidden=true;
  for(const button of frame.querySelectorAll('[data-outpaint-ratio]'))button.onclick=()=>{globalThis.AtelierApp.$('outpaintRatio').value=button.dataset.outpaintRatio;globalThis.AtelierApp.$('outpaintRatio').dispatchEvent(new Event('change'));};
  for(const button of frame.querySelectorAll('[data-outpaint-direction]'))button.onclick=()=>applyOutpaintDirection(button.dataset.outpaintDirection);
  for(const button of frame.querySelectorAll('[data-outpaint-align]'))button.onclick=()=>alignOutpaintSource(button.dataset.outpaintAlign);
  for(const button of quality.querySelectorAll('[data-outpaint-quality]'))button.onclick=()=>{const value=button.dataset.outpaintQuality;globalThis.AtelierApp.$('outpaintPreset').value=value;applyOutpaintPreset(value);for(const item of quality.querySelectorAll('[data-outpaint-quality]')){const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));}globalThis.AtelierApp.refreshStudioReadiness();};
  for(const radio of mode.querySelectorAll('input'))radio.onchange=()=>{globalThis.AtelierApp.$('outpaintChooseLayout').checked=radio.value==='layout';refreshOutpaintEstimate();globalThis.AtelierApp.refreshStudioReadiness();};
  quality.querySelector('[data-outpaint-quality="balanced"]').click();
  syncOutpaintModels();
  new MutationObserver(()=>{syncOutpaintModels();globalThis.AtelierApp.refreshStudioReadiness();}).observe(globalThis.AtelierApp.$('inpaintModelSelect'),{childList:true,subtree:true,attributes:true});
  for(const id of ['outpaintWidth','outpaintHeight','outpaintLeft','outpaintTop'])globalThis.AtelierApp.$(id).addEventListener('input',()=>{if(id==='outpaintWidth'||id==='outpaintHeight')globalThis.AtelierApp.$('outpaintRatio').value='custom';refreshOutpaintPreview();globalThis.AtelierApp.refreshStudioReadiness();});
  for(const id of ['outpaintRight','outpaintBottom'])globalThis.AtelierApp.$(id).addEventListener('input',()=>{if(!globalThis.AtelierApp.sourceImage)return;const value=Number(globalThis.AtelierApp.$(id).value);if(!Number.isInteger(value)||value<0||value>8192)return globalThis.AtelierApp.setMessage('Phần mở rộng phải là số nguyên từ 0 đến 8192.','error');if(id==='outpaintRight')globalThis.AtelierApp.$('outpaintWidth').value=globalThis.AtelierApp.sourceImage.naturalWidth+Number(globalThis.AtelierApp.$('outpaintLeft').value)+value;else globalThis.AtelierApp.$('outpaintHeight').value=globalThis.AtelierApp.sourceImage.naturalHeight+Number(globalThis.AtelierApp.$('outpaintTop').value)+value;globalThis.AtelierApp.$('outpaintRatio').value='custom';refreshOutpaintPreview();globalThis.AtelierApp.refreshStudioReadiness();});
  globalThis.AtelierApp.$('outpaintRatio').addEventListener('change',()=>{applyOutpaintRatio();refreshOutpaintPreview();globalThis.AtelierApp.refreshStudioReadiness();});
  globalThis.AtelierApp.$('outpaintCenter').onclick=()=>{if(!globalThis.AtelierApp.sourceImage)return;globalThis.AtelierApp.$('outpaintLeft').value=Math.max(0,Math.floor((Number(globalThis.AtelierApp.$('outpaintWidth').value)-globalThis.AtelierApp.sourceImage.naturalWidth)/2));globalThis.AtelierApp.$('outpaintTop').value=Math.max(0,Math.floor((Number(globalThis.AtelierApp.$('outpaintHeight').value)-globalThis.AtelierApp.sourceImage.naturalHeight)/2));refreshOutpaintPreview();globalThis.AtelierApp.refreshStudioReadiness();};
  globalThis.AtelierApp.$('outpaintModel').addEventListener('change',()=>{localStorage.setItem('outpaintModelChoice',globalThis.AtelierApp.$('outpaintModel').value);applyOutpaintModelProfile(true);globalThis.AtelierApp.refreshStudioReadiness();});
  for(const id of ['outpaintSteps','outpaintGuidance','outpaintResolution','outpaintOverlap'])globalThis.AtelierApp.$(id).addEventListener('input',()=>{globalThis.AtelierApp.$(id).dataset.userEdited='true';globalThis.AtelierApp.$('outpaintPreset').value='custom';refreshOutpaintEstimate();});
  for(const id of ['outpaintPreserve','outpaintSourceEnhance','outpaintDetail'])globalThis.AtelierApp.$(id).addEventListener('change',()=>syncOutpaintQualityOptions(id));
  for(const id of ['outpaintDetail','outpaintSeamRepair','outpaintMaterialRefine'])globalThis.AtelierApp.$(id).addEventListener('change',()=>{globalThis.AtelierApp.$('outpaintPreset').value='custom';});
  syncOutpaintQualityOptions();
  globalThis.AtelierApp.$('outpaintQuality').onclick=()=>{applyOutpaintPreset('detail');globalThis.AtelierApp.refreshStudioReadiness();};
  globalThis.AtelierApp.$('outpaintPreset').onchange=()=>applyOutpaintPreset(globalThis.AtelierApp.$('outpaintPreset').value);
  for(const id of ['outpaintCount','outpaintChooseLayout','outpaintDetail','outpaintSeamRepair','outpaintMaterialRefine','outpaintModel','outpaintWidth','outpaintHeight','outpaintRatio'])globalThis.AtelierApp.$(id).addEventListener('change',refreshOutpaintEstimate);
  globalThis.AtelierApp.$('outpaintRun').onclick=runOutpaint;
  globalThis.AtelierApp.$('studioContinueOutpaint').onclick=()=>globalThis.AtelierApp.continueFromSelectedResult('outpaint');
  const preview=globalThis.AtelierApp.$('outpaintPreview');
  preview.addEventListener('pointerdown',event=>{if(!outpaintReady()||globalThis.AtelierApp.activeJobId)return;const g=outpaintGeometry(),rect=preview.getBoundingClientRect(),x=(event.clientX-rect.left)*g.width/rect.width,y=(event.clientY-rect.top)*g.height/rect.height;if(x<g.left||x>g.width-g.right||y<g.top||y>g.height-g.bottom)return;outpaintDrag={x:event.clientX,y:event.clientY,left:g.left,top:g.top};preview.setPointerCapture(event.pointerId);});
  preview.addEventListener('pointermove',event=>{if(!outpaintDrag)return;const rect=preview.getBoundingClientRect(),w=Number(globalThis.AtelierApp.$('outpaintWidth').value),h=Number(globalThis.AtelierApp.$('outpaintHeight').value);globalThis.AtelierApp.$('outpaintLeft').value=Math.max(0,Math.min(w-globalThis.AtelierApp.sourceImage.naturalWidth,Math.round(outpaintDrag.left+(event.clientX-outpaintDrag.x)*w/rect.width)));globalThis.AtelierApp.$('outpaintTop').value=Math.max(0,Math.min(h-globalThis.AtelierApp.sourceImage.naturalHeight,Math.round(outpaintDrag.top+(event.clientY-outpaintDrag.y)*h/rect.height)));refreshOutpaintPreview();globalThis.AtelierApp.refreshStudioReadiness();});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])preview.addEventListener(name,()=>outpaintDrag=null);
  fetch('/api/outpaint-config').then(r=>r.json()).then(config=>{if(Number.isInteger(config.maxPixels))outpaintPixelLimit=config.maxPixels;outpaintTiming=config.timing||[];outpaintServiceReady=config.version>=2&&config.serviceReady===true;refreshOutpaintPreview();globalThis.AtelierApp.refreshStudioReadiness();refreshOutpaintEstimate();}).catch(()=>refreshOutpaintEstimate());
}
async function runOutpaint(){
  if(globalThis.AtelierApp.activeJobId||globalThis.AtelierApp.inpaintPromptReviewPending||descriptionTryonRunning)return globalThis.AtelierApp.setMessage('Hãy hoàn tất tác vụ hiện tại.','error');
  let g;try{g=outpaintGeometry();}catch(error){return globalThis.AtelierApp.setMessage(error.message,'error');}
  if(!globalThis.AtelierApp.$('outpaintModel').value||globalThis.AtelierApp.$('outpaintModel').disabled)return globalThis.AtelierApp.setMessage('Hãy chọn model sẵn sàng.','error');
  const request={...g,sampleId:globalThis.AtelierApp.current.id,modelId:globalThis.AtelierApp.$('outpaintModel').value,prompt:globalThis.AtelierApp.$('outpaintPrompt').value,negativePrompt:globalThis.AtelierApp.$('outpaintNegative').value,preserveOriginal:globalThis.AtelierApp.$('outpaintPreserve').checked,overlap:Number(globalThis.AtelierApp.$('outpaintOverlap').value),seed:Number(globalThis.AtelierApp.$('outpaintSeed').value),steps:Number(globalThis.AtelierApp.$('outpaintSteps').value),guidance:Number(globalThis.AtelierApp.$('outpaintGuidance').value),maxSide:Number(globalThis.AtelierApp.$('outpaintResolution').value),count:Number(globalThis.AtelierApp.$('outpaintCount').value),detailPass:globalThis.AtelierApp.$('outpaintDetail').checked,materialRefine:globalThis.AtelierApp.$('outpaintDetail').checked&&globalThis.AtelierApp.$('outpaintMaterialRefine').checked,sourceEnhance:globalThis.AtelierApp.$('outpaintSourceEnhance').checked,seamRepair:globalThis.AtelierApp.$('outpaintSeamRepair').checked,backgroundContinuity:globalThis.AtelierApp.$('outpaintBackgroundContinuity').checked,seamWidth:Number(globalThis.AtelierApp.$('outpaintSeamWidth').value),protectedDetailMask:globalThis.AtelierApp.binaryMaskDataUrl(false,true,true),runMode:globalThis.AtelierApp.$('outpaintChooseLayout').checked?'layout':'complete'};
  await submitOutpaint(request,globalThis.AtelierApp.current.id);
}
async function submitOutpaint(request,sourceId){
  if(!outpaintServiceReady)return globalThis.AtelierApp.setMessage('Phiên AI chưa nạp bản mới; hãy mở phiên đã nâng cấp hoặc khởi động lại ứng dụng.','error');
  if(globalThis.AtelierApp.activeJobId||globalThis.AtelierApp.inpaintPromptReviewPending||descriptionTryonRunning)return globalThis.AtelierApp.setMessage('Hãy hoàn tất tác vụ hiện tại.','error');
  const jobId=globalThis.AtelierApp.createJobId('outpaint');
  globalThis.AtelierApp.setActiveJob(jobId);let succeeded=false,jobError='';
  try{
    const response=await fetch('/api/outpaint',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,jobId})});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể mở rộng ảnh.');
    succeeded=true;renderOutpaintResults(result,sourceId);
    globalThis.AtelierApp.setMessage(`Đã tạo ${result.results.length} ${result.runMode==='layout'?'bố cục; chọn một ảnh để hoàn thiện':'ảnh mở rộng'} · ${result.width} × ${result.height} px${result.warnings?.length?' · Lưu ý: '+result.warnings.join('; '):''}`,'success');
  }catch(error){jobError=error.message;globalThis.AtelierApp.setMessage(error.message,'error');}
  finally{await globalThis.AtelierApp.settleJob(jobId,succeeded?'completed':'failed',jobError);}
}
