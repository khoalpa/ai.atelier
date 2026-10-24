/* Standalone enhancement shares Studio's masks, jobs and result selection. */
window.ImageEnhancement = (() => {
  const el = id => document.getElementById(id);
  let config = null, running = false, edgePick = null;
  let edgePoints = {skin:null,background:null};
  const methods = {light:'Cải thiện nhẹ', ai2x:'Phóng lớn AI 2×','skin-smooth':'Làm mịn da tự nhiên','skin-heal':'Xóa khuyết điểm nhỏ','skin-ai':'Sửa vùng da bằng AI','skin-edge':'Làm rõ viền da'};
  const skinMode = () => ['skin-smooth','skin-heal','skin-ai'].includes(el('enhanceMethod').value);
  const edgeMode = () => el('enhanceMethod').value==='skin-edge';
  const selectedOnly = () => skinMode()||edgeMode();
  const pointsReady = () => Boolean(edgePoints.skin)===Boolean(edgePoints.background);
  const serviceReady = () => Boolean(config?.serviceReady && (!skinMode() || config?.skin?.version===1) && (!edgeMode() || config?.edgeVersion===1));
  const modelReady = () => el('enhanceMethod').value==='skin-ai'?Boolean(config?.skin?.modelReady):el('enhanceMethod').value!=='ai2x'||Boolean(config?.modelReady);
  function requirements(hasSource, hasMask) {
    const scale = el('enhanceMethod').value === 'ai2x' ? 2 : 1;
    const w = (globalThis.AtelierApp.sourceImage?.naturalWidth || 0)*scale, h = (globalThis.AtelierApp.sourceImage?.naturalHeight || 0)*scale;
    return [['Ảnh',hasSource], ['Vùng chỉnh sửa',(!selectedOnly()&&el('enhanceScope').value==='all')||hasMask],
      ...(edgeMode()?[['Hai phía viền',pointsReady()]]:[]),
      ['Dịch vụ',serviceReady()], ['Model',modelReady()],
      ['Kích thước',!hasSource||(w*h<=(config?.maxPixels||16777216)&&Math.max(w,h)<=(config?.maxSide||8192))]];
  }
  function sync() {
    if(!el('enhanceDimensions'))return;
    const skin=skinMode(), edge=edgeMode(), method=el('enhanceMethod').value;
    if(skin||edge)el('enhanceScope').value='selected';
    el('enhanceScope').disabled=skin||edge;
    el('skinRetouchControls').hidden=!skin;
    el('skinEdgeControls').hidden=!edge;
    el('enhanceProfileRow').hidden=skin||edge;
    el('enhanceLevelRow').hidden=method==='skin-smooth';
    el('enhanceLevelLabel').textContent=edge?'Độ rõ đường biên':skin?'Mức sửa khuyết điểm':'Mức độ';
    el('enhancePreviewPosition').hidden=skin||edge;
    el('enhanceProtectionHint').hidden=skin||edge;
    for(const name of ['Width','Softness','Decontam'])el(`edge${name}Value`).textContent=el(`edge${name}`).value+(name==='Width'?' px':'%');
    el('edgePickSkin').setAttribute('aria-pressed',String(edgePick==='skin'));
    el('edgePickBackground').setAttribute('aria-pressed',String(edgePick==='background'));
    el('edgePointsStatus').textContent=edgePick?`Nhấp một điểm nằm rõ bên phía ${edgePick==='skin'?'Da':'Nền'} trên ảnh. Nhấp lại nút để hủy chọn điểm.`:!edgePoints.skin&&!edgePoints.background?'Tự động ước lượng hai phía theo màu. Chọn hai điểm tham chiếu nếu nhận diện chưa đúng.':`Da: ${edgePoints.skin?`${Math.round(edgePoints.skin.x)}, ${Math.round(edgePoints.skin.y)}`:'chưa chọn'} · Nền: ${edgePoints.background?`${Math.round(edgePoints.background.x)}, ${Math.round(edgePoints.background.y)}`:'chưa chọn'}. ${pointsReady()?'Đã đủ hai điểm tham chiếu.':'Chọn thêm điểm còn thiếu hoặc Xóa hai điểm để dùng tự động.'}`;
    el('skinSmooth').min=method==='skin-smooth'?'1':'0';
    el('skinSmoothValue').textContent=`${el('skinSmooth').value}%`;
    el('skinRetouchHint').textContent=(method==='skin-ai'?'Tô phủ vết sẹo và phần bóng đổ cần sửa. AI có thể thay đổi chi tiết trong vùng tô; hãy xem thử.':method==='skin-heal'?'Tô sát vết bẩn, nốt ruồi hoặc từng khuyết điểm nhỏ. Với vùng rộng hoặc sẹo sâu, chọn Sửa vùng da bằng AI.':'Tô vùng da cần làm mịn. Công cụ này không xóa sẹo hoặc nốt ruồi.')+' Dùng cọ xanh để giữ mắt, môi, tóc hoặc dấu đặc trưng. Xem thử tự đặt tại vùng đã tô.';
    el('enhancePreview').textContent=edge?'Xem thử và nhận diện viền':skin?'Xem thử vùng da':'Xem thử một vùng';
    el('enhanceRun').textContent=edge?'Áp dụng làm rõ viền':skin?'Áp dụng cho vùng da đã tô':'Cải thiện toàn ảnh';
    const w=globalThis.AtelierApp.sourceImage?.naturalWidth||0,h=globalThis.AtelierApp.sourceImage?.naturalHeight||0,scale=el('enhanceMethod').value==='ai2x'?2:1;
    el('enhanceDimensions').textContent=w?`${w} × ${h} → ${w*scale} × ${h*scale} px`:'Chọn ảnh để xem kích thước đầu ra.';
    el('enhanceStatus').textContent=!config?'Đang kiểm tra dịch vụ…':!config.serviceReady?'Dịch vụ cần nạp phiên bản Cải thiện ảnh. Mở phiên nâng cấp hoặc khởi động lại ứng dụng.':scale===2&&!config.modelReady?'Chưa có model AI 2× trên máy. Có thể dùng Cải thiện nhẹ.':scale===2?'AI có thể suy diễn chi tiết. Vùng bảo vệ được phóng lớn bằng nội suy; hãy kiểm tra mặt, chữ và họa tiết.':'Giảm nhiễu và tăng nét nhẹ; vùng ngoài lựa chọn và vùng bảo vệ giữ nguyên pixel.';
    if(skin)el('enhanceStatus').textContent=!serviceReady()?'Dịch vụ cần nạp phiên bản Làm mịn & sửa da. Mở phiên sửa da hoặc khởi động lại ứng dụng.':!modelReady()?'Chưa có model sửa da AI trên máy. Có thể dùng Làm mịn hoặc Xóa khuyết điểm nhỏ.':'Chỉ sửa vùng tô đỏ, trừ vùng bảo vệ. Giữ kích thước và giữ nguyên pixel ngoài vùng sửa.';
    if(edge)el('enhanceStatus').textContent=!serviceReady()?'Dịch vụ chưa nạp công cụ làm rõ viền. Mở phiên làm rõ viền hoặc khởi động lại ứng dụng.':!pointsReady()?el('edgePointsStatus').textContent:'Làm rõ một dải hẹp quanh viền, giữ nền mờ và phần da phía trong. Hãy kiểm tra đường biên ở 100% trước khi lưu.';
    if(w&&(w*scale*h*scale>(config?.maxPixels||16777216)||Math.max(w*scale,h*scale)>(config?.maxSide||8192)))el('enhanceStatus').textContent='Kích thước đầu ra vượt giới hạn. Chọn Cải thiện nhẹ hoặc dùng ảnh nguồn nhỏ hơn; vẫn có thể xem thử một vùng.';
    const checks=requirements(Boolean(w),globalThis.AtelierApp.editableMaskStats().selected>0),invalidSmooth=method==='skin-smooth'&&Number(el('skinSmooth').value)<=0;
    el('enhancePreview').disabled=running||Boolean(globalThis.AtelierApp.activeJobId)||invalidSmooth||checks.some(item=>item[0]!=='Kích thước'&&!item[1]);
    el('enhanceRun').disabled=running||Boolean(globalThis.AtelierApp.activeJobId)||invalidSmooth||checks.some(item=>!item[1]);
  }
  async function refresh() {
    try{const response=await fetch('/api/enhance-config');if(!response.ok)throw Error();config=await response.json();}
    catch{config={serviceReady:false};}
    sync();globalThis.AtelierApp.refreshStudioReadiness();
  }
  function payload(preview=false) {
    if(!globalThis.AtelierApp.current||!globalThis.AtelierApp.sourceImage)throw new Error('Chọn ảnh nguồn trước khi cải thiện.');
    const skin=skinMode(),edge=edgeMode(),scope=selectedOnly()?'selected':el('enhanceScope').value;
    if(scope==='selected'&&globalThis.AtelierApp.editableMaskStats().selected<=0)throw new Error('Tô vùng cần sửa trước khi xem thử hoặc áp dụng.');
    if(edge&&!pointsReady())throw new Error('Chọn đủ hai điểm Da và Nền, hoặc xóa cả hai để dùng tự động.');
    return {sampleId:globalThis.AtelierApp.current.id,method:el('enhanceMethod').value,level:el('enhanceLevel').value,
      profile:skin?'portrait':el('enhanceProfile').value,scope,preview,
      ...(skin?{skinSmooth:Number(el('skinSmooth').value),preserveTexture:el('skinPreserveTexture').checked}:{}),
      ...(edge?{edgeWidth:Number(el('edgeWidth').value),edgeSoftness:Number(el('edgeSoftness').value),edgeDecontam:Number(el('edgeDecontam').value),edgeKeepShape:true,edgeSkinPoint:edgePoints.skin,edgeBackgroundPoint:edgePoints.background}:{}),
      previewX:Number(el('enhancePreviewX').value),previewY:Number(el('enhancePreviewY').value),
      editableMask:scope==='selected'?globalThis.AtelierApp.binaryMaskDataUrl(false):'',
      protectedDetailMask:globalThis.AtelierApp.binaryMaskDataUrl(false,true)};
  }
  async function run(preview=false) {
    if(globalThis.AtelierApp.activeJobId||running||globalThis.AtelierApp.inpaintPromptReviewPending||descriptionTryonRunning)return globalThis.AtelierApp.setMessage('Hãy hoàn tất tác vụ hiện tại.','error');
    let request;try{request=payload(preview);}catch(error){return globalThis.AtelierApp.setMessage(error.message,'error');}
    if(!serviceReady()||!modelReady())return globalThis.AtelierApp.setMessage(el('enhanceStatus').textContent,'error');
    running=true;const jobId=globalThis.AtelierApp.createJobId('enhance');globalThis.AtelierApp.setActiveJob(jobId);sync();let success=false,errorText='';
    try{
      const response=await fetch('/api/enhance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,jobId})});
      const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể cải thiện ảnh.');
      success=true;show(result);
      globalThis.AtelierApp.setMessage(preview?'Đã xử lý vùng xem thử. Chạy toàn ảnh khi thiết lập phù hợp.':`Đã lưu ảnh ${result.width} × ${result.height} px · ${result.durationSeconds}s. Hãy so sánh ở 100%.`,'success');
    }catch(error){errorText=error.message;globalThis.AtelierApp.setMessage(error.message,'error');}
    finally{await globalThis.AtelierApp.settleJob(jobId,success?'completed':'failed',errorText);running=false;sync();}
  }
  function inspect(item) {
    const dialog=document.createElement('dialog');dialog.className='enhance-inspector';dialog.setAttribute('aria-label','So sánh cải thiện ảnh ở 100%');
    const before=globalThis.AtelierApp.outputUrl(item.comparisonFile),after=globalThis.AtelierApp.outputUrl(item.file);
    dialog.innerHTML=`<div class="enhance-inspector-head"><strong>${item.previewOnly?'Xem thử một vùng':'So sánh ở 100%'} · ${item.width} × ${item.height} px</strong><button type="button">Đóng</button></div><p>${item.settings?.scale===2?'Ảnh trước được nội suy 2× để so sánh cùng kích thước.':'Kích thước thật: một pixel ảnh tương ứng một pixel CSS.'}${item.previewOnly?' Vùng thử không thay thế kết quả toàn ảnh.':''}</p><label>Trước / Sau <input type="range" min="0" max="100" value="50" aria-label="So sánh ảnh trước và sau"></label><div class="enhance-inspector-scroll"><div class="enhance-inspector-pair" style="width:${Number(item.width)}px;height:${Number(item.height)}px"><img src="${globalThis.AtelierApp.escapeHtml(before)}" alt="Trước cải thiện"><img class="enhance-after" src="${globalThis.AtelierApp.escapeHtml(after)}" alt="Sau cải thiện" style="clip-path:inset(0 50% 0 0)"></div></div>`;
    dialog.querySelector('input').oninput=event=>{dialog.querySelector('.enhance-after').style.clipPath=`inset(0 ${100-Number(event.target.value)}% 0 0)`;};
    if(item.edgeOverlayFile){
      const guide=document.createElement('img');guide.className='enhance-edge-guide';guide.src=globalThis.AtelierApp.outputUrl(item.edgeOverlayFile);guide.alt='Đường biên nhận diện';guide.hidden=true;
      dialog.querySelector('.enhance-inspector-pair').append(guide);
      const label=document.createElement('label'),toggle=document.createElement('input');label.className='enhance-edge-toggle';toggle.type='checkbox';toggle.onchange=()=>{guide.hidden=!toggle.checked;};label.append(toggle,' Hiện đường biên nhận diện (màu vàng)');
      dialog.querySelector('.enhance-inspector-scroll').before(label);
      if(item.metrics?.edgeRegions?.some(region=>!region.spillApplied)&&item.settings?.edgeDecontam>0){const note=document.createElement('p');note.textContent='Chưa phân biệt chắc phía da theo màu: phần khử lem đã bỏ qua ở vùng đó. Chọn hai điểm Da/Nền để chỉ rõ.';label.after(note);}
    }
    dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
  }
  async function editAgain(item) {
    if(globalThis.AtelierApp.activeJobId||running||globalThis.AtelierApp.inpaintPromptReviewPending||descriptionTryonRunning)return globalThis.AtelierApp.setMessage('Hãy hoàn tất tác vụ hiện tại.','error');
    const source=globalThis.AtelierApp.images.find(image=>image.id===item.sampleId);
    if(!source)return globalThis.AtelierApp.setMessage('Ảnh nguồn không còn trong danh sách. Có thể dùng kết quả đã lưu để chỉnh sửa tiếp.','error');
    running=true;sync();
    try{
      const folder=String(item.file).replace(/\/[^/]+$/,'');
      const readMask=file=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Không đọc được vùng chọn đã lưu.'));image.src=globalThis.AtelierApp.outputUrl(`${folder}/${file}`);});
      const [selected,protectedImage]=await Promise.all([readMask('editable_mask.png'),readMask('protected_mask.png')]);
      if(!await globalThis.AtelierApp.loadImage(source))throw new Error('Không tải được ảnh nguồn.');
      if(globalThis.AtelierApp.current?.id!==item.sampleId)throw new Error('Ảnh nguồn đã đổi; hãy mở lại thiết lập.');
      if(selected.naturalWidth!==globalThis.AtelierApp.sourceImage.naturalWidth||selected.naturalHeight!==globalThis.AtelierApp.sourceImage.naturalHeight)throw new Error('Kích thước ảnh nguồn đã đổi; không thể khôi phục vùng chọn cũ.');
      globalThis.AtelierApp.activateAppView('create');globalThis.AtelierApp.setStudioMode('enhance');
      for(const [key,id] of [['method','enhanceMethod'],['level','enhanceLevel'],['profile','enhanceProfile'],['scope','enhanceScope'],['skinSmooth','skinSmooth'],['edgeWidth','edgeWidth'],['edgeSoftness','edgeSoftness'],['edgeDecontam','edgeDecontam']]){
        if(item.settings?.[key]!==undefined)el(id).value=String(item.settings[key]);
      }
      el('skinPreserveTexture').checked=item.settings?.preserveTexture!==false;
      edgePoints={skin:item.settings?.edgeSkinPoint||null,background:item.settings?.edgeBackgroundPoint||null};edgePick=null;
      const paint=(image,context,color)=>{
        context.clearRect(0,0,context.canvas.width,context.canvas.height);context.drawImage(image,0,0);
        const pixels=context.getImageData(0,0,context.canvas.width,context.canvas.height);
        for(let i=0;i<pixels.data.length;i+=4){const chosen=pixels.data[i]>127;pixels.data[i]=color[0];pixels.data[i+1]=color[1];pixels.data[i+2]=color[2];pixels.data[i+3]=chosen?color[3]:0;}
        context.putImageData(pixels,0,0);
      };
      paint(selected,globalThis.AtelierApp.maskCtx,[255,40,40,255]);paint(protectedImage,globalThis.AtelierApp.protectCtx,[0,120,255,180]);paint(protectedImage,globalThis.AtelierApp.manualProtectCtx,[0,120,255,180]);
      globalThis.AtelierApp.render();globalThis.AtelierApp.setMessage('Đã khôi phục ảnh nguồn, vùng tô, vùng bảo vệ và thiết lập. Có thể điều chỉnh rồi xem thử.','success');
    }catch(error){globalThis.AtelierApp.setMessage(error.message,'error');}
    finally{running=false;sync();globalThis.AtelierApp.refreshStudioReadiness();}
  }
  function show(result) {
    const item=result.results?.[0];if(!item)return;
    el('studioResultsTrayQuality')?.remove();
    if(item.previewOnly)return inspect(item);
    globalThis.AtelierApp.activateAppView('create');globalThis.AtelierApp.setStudioMode('enhance');
    globalThis.AtelierApp.currentRunDirectory=result.directory||String(item.file).replace(/\/[^/]+$/,'');
    const reference=globalThis.AtelierApp.outputUrl(item.comparisonFile),url=globalThis.AtelierApp.outputUrl(item.file);
    el('resultsGrid').innerHTML=`<article class="result-card"><img src="${globalThis.AtelierApp.escapeHtml(reference)}" alt="Ảnh trước cải thiện"><p>${item.settings?.scale===2?'Ảnh nguồn nội suy 2× để đối chiếu':'Ảnh nguồn'}</p></article><article class="result-card"><img src="${globalThis.AtelierApp.escapeHtml(url)}" alt="Ảnh đã cải thiện"><p>${methods[item.settings?.method]||'Cải thiện ảnh'} · ${item.width} × ${item.height} px<br>Đã kiểm tra vùng bảo vệ · Cần duyệt chi tiết</p><button data-enhance-inspect type="button">So sánh ở 100%</button><button data-seed="0" data-task="enhance" data-sample-id="${globalThis.AtelierApp.escapeHtml(item.sampleId)}" data-directory="${globalThis.AtelierApp.escapeHtml(globalThis.AtelierApp.currentRunDirectory)}">Chọn làm kết quả chính</button><a href="${globalThis.AtelierApp.escapeHtml(url)}" download>Tải PNG</a></article>`;
    el('resultsGrid').querySelector('[data-enhance-inspect]').onclick=()=>inspect(item);
    if(item.settings?.skinRetouchVersion||item.settings?.edgeVersion){
      const editButton=document.createElement('button');editButton.type='button';editButton.textContent='Chỉnh lại vùng và thiết lập';editButton.dataset.enhanceEdit='';editButton.onclick=()=>editAgain(item);
      el('resultsGrid').querySelector('[data-enhance-inspect]').after(editButton);
    }
    const button=el('resultsGrid').querySelector('[data-seed]');button.onclick=()=>globalThis.AtelierApp.selectPrimary(0,button);
    globalThis.AtelierApp.presentStudioResults(reference,url);globalThis.AtelierApp.showCompare(reference,url);
  }
  function restore(state) {show({results:(state.results||[]).slice(-1)});}
  function resetEdgeGuides(){edgePoints={skin:null,background:null};edgePick=null;}
  function pickMissingPoint(){edgePick=edgePoints.skin?'background':'skin';sync();globalThis.AtelierApp.setMessage(el('edgePointsStatus').textContent);globalThis.AtelierApp.canvas.scrollIntoView({block:'center'});}
  function captureEdgePoint(event){
    if(globalThis.AtelierApp.studioMode!=='enhance'||!edgeMode()||!edgePick||running||globalThis.AtelierApp.activeJobId)return false;
    const point=globalThis.AtelierApp.canvasPoint(event);
    edgePoints[edgePick]={x:Math.max(0,Math.min(globalThis.AtelierApp.sourceImage.naturalWidth-1,point.x)),y:Math.max(0,Math.min(globalThis.AtelierApp.sourceImage.naturalHeight-1,point.y))};
    edgePick=null;event.preventDefault();sync();globalThis.AtelierApp.render();globalThis.AtelierApp.refreshStudioReadiness();globalThis.AtelierApp.setMessage(el('edgePointsStatus').textContent,'success');return true;
  }
  function drawEdgeGuides(context){
    if(globalThis.AtelierApp.studioMode!=='enhance'||!edgeMode()||!globalThis.AtelierApp.sourceImage)return;
    context.save();
    for(const [kind,point] of Object.entries(edgePoints))if(point){
      const x=point.x*globalThis.AtelierApp.canvas.width/globalThis.AtelierApp.sourceImage.naturalWidth,y=point.y*globalThis.AtelierApp.canvas.height/globalThis.AtelierApp.sourceImage.naturalHeight;
      context.fillStyle=kind==='skin'?'#ffbf78':'#79d9ee';context.strokeStyle='#111';context.lineWidth=2;
      context.beginPath();context.arc(x,y,6,0,Math.PI*2);context.fill();context.stroke();
      context.font='bold 13px sans-serif';context.fillText(kind==='skin'?'Da':'Nền',x+9,y-9);
    }
    context.restore();
  }
  function setup() {
    el('enhanceMethod').addEventListener('change',()=>{el('skinSmooth').value=el('enhanceMethod').value==='skin-smooth'?'35':'0';edgePick=null;globalThis.AtelierApp.render();});
    for(const id of ['enhanceMethod','enhanceProfile','enhanceLevel','enhanceScope'])el(id).addEventListener('change',()=>{sync();globalThis.AtelierApp.refreshStudioReadiness();});
    el('skinSmooth').addEventListener('input',()=>{sync();globalThis.AtelierApp.refreshStudioReadiness();});
    for(const id of ['edgeWidth','edgeSoftness','edgeDecontam'])el(id).addEventListener('input',sync);
    for(const [id,kind] of [['edgePickSkin','skin'],['edgePickBackground','background']])el(id).onclick=()=>{
      if(running||globalThis.AtelierApp.activeJobId)return;edgePick=edgePick===kind?null:kind;sync();globalThis.AtelierApp.setMessage(el('edgePointsStatus').textContent);globalThis.AtelierApp.canvas.scrollIntoView({block:'center'});
    };
    el('edgeClearPoints').onclick=()=>{resetEdgeGuides();sync();globalThis.AtelierApp.render();globalThis.AtelierApp.refreshStudioReadiness();};
    el('enhancePreview').onclick=()=>run(true);el('enhanceRun').onclick=()=>run(false);el('enhanceRefresh').onclick=refresh;
    el('studioContinueEnhance').onclick=()=>globalThis.AtelierApp.continueFromSelectedResult('enhance');
    refresh();
  }
  return {setup,sync,run,requirements,restore,inspect,payload,editAgain,resetEdgeGuides,captureEdgePoint,drawEdgeGuides,pickMissingPoint};
})();
