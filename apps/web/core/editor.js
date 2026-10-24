'use strict';
// Owned state: canvas, ctx, maskCanvas, maskCtx, protectCanvas, protectCtx, manualProtectCanvas, manualProtectCtx, images, current, sourceImage, drawing, tool, lastPoint, history, aiPoints, MAX_HISTORY, editorZoom, editorPan, editorPanStart, editorPanMode, canvasPointerStart, canvasFirstClick
// Dependencies: $, applyPreset, currentRunDirectory, detectWithManagedModel, detectedPeople, escapeHtml, garmentDataUrl, refreshStudioReadiness, setMessage, setStudioMode, studioMode, studioTaskMasks
module.exports=function createEditor(deps){
let canvas, ctx, maskCanvas, maskCtx, protectCanvas, protectCtx, manualProtectCanvas, manualProtectCtx, images, current, sourceImage, drawing, tool, lastPoint, history, aiPoints, MAX_HISTORY, editorZoom, editorPan, editorPanStart, editorPanMode, canvasPointerStart, canvasFirstClick;
function updateEditorTransform(){
  const wrap=deps.$('canvasWrap').getBoundingClientRect();
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
  const wrap = deps.$('canvasWrap').getBoundingClientRect();
  const scale = Math.min((wrap.width - 36) / sourceImage.naturalWidth, (wrap.height - 36) / sourceImage.naturalHeight, 1);
  const displayScale=Math.max(0.001,scale)*editorZoom;
  canvas.width = Math.max(1, Math.round(sourceImage.naturalWidth * Math.min(1,displayScale)));
  canvas.height = Math.max(1, Math.round(sourceImage.naturalHeight * Math.min(1,displayScale)));
  canvas.style.width=`${sourceImage.naturalWidth*displayScale}px`;
  canvas.style.height=`${sourceImage.naturalHeight*displayScale}px`;
  deps.$('editorZoomValue').textContent=`${Math.round(editorZoom*100)}%`;
  updateEditorTransform();
  render();
}

function render() {
  if (!sourceImage) return;
  window.Character?.checkMasks?.();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.globalAlpha = Number(deps.$('overlayOpacity').value) / 100;
  ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = Number(deps.$('overlayOpacity').value) / 100;
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
  for (const person of deps.detectedPeople) {
    const [x0,y0,x1,y1] = person.box;
    const selected = Number(deps.$('personSelect').value) === person.index;
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
  const size = Number(deps.$('brushSize').value);
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
  aiPoints=saved.points;deps.$('personSelect').value=saved.person;
  render();deps.refreshStudioReadiness();
}

async function loadImage(item) {
  if(!item)return;
  deps.studioTaskMasks={};
  manualProtectCtx.clearRect(0,0,manualProtectCanvas.width,manualProtectCanvas.height);
  if(deps.$('studioResultsTray'))deps.$('studioResultsTray').hidden=true;
  current = item;
  window.ImageEnhancement?.resetEdgeGuides?.();
  window.Makeup?.reset();window.Character?.reset();
  deps.$('saveFullSizeImageButton').disabled=true;
  localStorage.setItem('selectedImageId',item.id);
  window.AtelierStore?.set({selectedImageId:item.id});
  deps.$('loading').hidden = false;
  deps.setMessage('Đang tải ảnh…');
  const img = new Image();
  return new Promise((resolve)=>{
  img.onload = () => {
    if(current?.id!==item.id){resolve(false);return;}
    sourceImage = img;
    editorZoom=1;editorPan={x:0,y:0};editorPanStart=null;
    deps.$('saveFullSizeImageButton').disabled=false;
    maskCanvas.width = img.naturalWidth;
    maskCanvas.height = img.naturalHeight;
    protectCanvas.width = img.naturalWidth;
    protectCanvas.height = img.naturalHeight;
    manualProtectCanvas.width=img.naturalWidth;manualProtectCanvas.height=img.naturalHeight;
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    protectCtx.clearRect(0, 0, protectCanvas.width, protectCanvas.height);
    history = [];
    aiPoints = [];
    deps.detectedPeople = [];
    deps.$('personSelect').innerHTML = '<option value="0">Nhân vật chính</option>';
    deps.$('imageInfo').textContent = `${item.id} · ${img.naturalWidth} × ${img.naturalHeight}`;
    canvas.hidden=false;
    deps.$('emptyCanvasState').hidden=true;
    deps.$('deselectImageButton').disabled=false;
    deps.$('resetEditorButton').disabled=false;
    deps.$('loading').hidden = true;
    fitCanvas();
    deps.$('message').hidden = true;
    deps.refreshStudioReadiness();
    window.StudioGuidance?.renderHistory();
    resolve(true);
  };
  img.onerror = () => { deps.$('loading').hidden = true; deps.setMessage('Không thể tải ảnh.', 'error'); resolve(false); };
  img.src = item.url;
  });
}

function renderImageOptions(selectedId = current?.id) {
  const option=(item,index)=>`<option value="${index}" ${item.id===selectedId?'selected':''}>${deps.escapeHtml(item.sourceType==='user'?item.name:`${item.group} / ${item.name}`)}</option>`;
  const groups=[
    ['Ảnh của bạn',images.map((item,index)=>({item,index})).filter(({item})=>item.sourceType==='user')],
    ['Ảnh mẫu',images.map((item,index)=>({item,index})).filter(({item})=>item.sourceType!=='user')],
  ];
  deps.$('imageSelect').innerHTML=`<option value="" ${selectedId?'':'selected'}>— Chọn ảnh —</option>`+groups.filter(([,entries])=>entries.length).map(([label,entries])=>`<optgroup label="${label}">${entries.map(({item,index})=>option(item,index)).join('')}</optgroup>`).join('');
}

function editorHasChanges(){
  if(!current)return false;
  const maskChanged=editableMaskStats().selected>0;
  return maskChanged||aiPoints.length>0||Boolean(deps.garmentDataUrl)||Boolean(deps.$('notes').value.trim())||Boolean(deps.currentRunDirectory);
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
  deps.studioTaskMasks={};
  window.Character?.reset();
  const selectedInpaintModel=deps.$('inpaintModelSelect')?.value;
  for(const panel of [deps.$('studioInpaintPanel'),deps.$('studioTryonPanel'),deps.$('studioEnhancePanel'),deps.$('studioCharacterPanel')])for(const control of panel?.querySelectorAll('input, select, textarea')||[])restoreControlDefault(control);
  if(selectedInpaintModel)deps.$('inpaintModelSelect').value=selectedInpaintModel;
  for(const id of ['brushSize','overlayOpacity','notes','labelSelect'])restoreControlDefault(deps.$(id));
  if(typeof deps.applyPreset==='function')deps.applyPreset(deps.$('accessoryPreset').value);
  if(maskCanvas.width&&maskCanvas.height){maskCtx.clearRect(0,0,maskCanvas.width,maskCanvas.height);protectCtx.clearRect(0,0,protectCanvas.width,protectCanvas.height);}
  history=[];aiPoints=[];deps.detectedPeople=[];deps.currentRunDirectory='';deps.garmentDataUrl='';
  deps.$('garmentPreview').hidden=true;deps.$('garmentPreview').removeAttribute('src');
  deps.$('personSelect').innerHTML='<option value="0">Nhân vật chính</option>';
  deps.$('resultsGrid').innerHTML='';if(deps.$('resultsDialog').open)deps.$('resultsDialog').close();
  if(deps.$('studioResultsTray'))deps.$('studioResultsTray').hidden=true;if(deps.$('studioCompareStage'))deps.$('studioCompareStage').hidden=true;
  deps.$('brushValue').textContent=`${deps.$('brushSize').value} px`;deps.$('opacityValue').textContent=`${deps.$('overlayOpacity').value}%`;deps.$('loraWeightValue').textContent=Number(deps.$('loraWeight').value).toFixed(2);
  window.StudioWorkspace?.applyQualityDefaults();
  setTool('add');deps.setStudioMode('inpaint');render();deps.refreshStudioReadiness();
  deps.setMessage('Đã đặt lại phiên chỉnh sửa.','success');
  return true;
}

function showEmptyEditorState(message=''){
  current=null;sourceImage=null;drawing=false;lastPoint=null;
  localStorage.removeItem('selectedImageId');
  window.AtelierStore?.set({selectedImageId:''});
  ctx.clearRect(0,0,canvas.width,canvas.height);canvas.hidden=true;
  deps.$('emptyCanvasState').hidden=false;deps.$('loading').hidden=true;deps.$('imageInfo').textContent='Chưa chọn ảnh';
  if(deps.$('studioResultsTray'))deps.$('studioResultsTray').hidden=true;
  deps.$('deselectImageButton').disabled=true;deps.$('resetEditorButton').disabled=true;
  deps.$('saveFullSizeImageButton').disabled=true;
  renderImageOptions(null);deps.$('imageSelect').value='';deps.refreshStudioReadiness();
  if(message)deps.setMessage(message,'success');
}

function deselectCurrentImage(){
  if(editorHasChanges()&&!window.confirm('Bỏ chọn ảnh và xóa các thay đổi chưa lưu?\n\nẢnh không bị xóa khỏi máy hoặc danh sách nguồn ảnh.'))return;
  resetEditorSession({ask:false});showEmptyEditorState('Đã bỏ chọn ảnh. Chọn ảnh nguồn trong bảng Thiết lập để tiếp tục.');
}

async function uploadSourceImage(file) {
  if (!file) return;
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Chỉ hỗ trợ ảnh PNG, JPG hoặc WebP.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Ảnh cần chỉnh sửa phải nhỏ hơn 20 MB.');
  deps.setMessage('Đang thêm ảnh vào workspace…');
  const data = await new Promise((resolve, reject) => { const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error('Không thể đọc tệp ảnh.')); reader.readAsDataURL(file); });
  const response = await fetch('/api/images/upload', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:file.name,data}) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể thêm ảnh.');
  images = [result.image, ...images.filter((item)=>item.id!==result.image.id)];
  renderImageOptions(result.image.id);
  deps.$('imageSelect').value = '0';
  if(!await loadImage(result.image))throw new Error('Đã lưu ảnh nhưng không thể tải ảnh vào trình chỉnh sửa.');
  deps.setMessage(`Đã thêm ${file.name}. Ảnh chỉ được lưu trên máy này.`, 'success');
}

function setTool(next) {
  tool = next;
  deps.$('addTool').classList.toggle('active', tool === 'add');
  deps.$('eraseTool').classList.toggle('active', tool === 'erase');
  deps.$('aiTool').classList.toggle('active', tool === 'ai');
  deps.$('protectTool').classList.toggle('active', tool === 'protect');
  deps.$('personTool').classList.toggle('active', tool === 'person');
  deps.$('aiHint').hidden = tool !== 'ai';
  deps.$('aiActions').hidden = tool !== 'ai';
  deps.refreshStudioReadiness();
}

async function segmentWithAi() {
  if (!current) return deps.setMessage('Hãy chọn ảnh trước.', 'error');
  if(['upper_body','lower_body','full_body','overall'].includes(deps.$('labelSelect')?.value)&&(deps.studioMode!=='tryon'||selectedOutfitType()?.category))return createAutomaticMask('',aiPoints);
  if(deps.studioMode==='tryon'&&selectedOutfitType()?.category)return createAutomaticMask('',aiPoints);
  const clothingCategory={outfit:'overall',sleepwear:'overall',underwear:'overall',shirt:'upper_body',pants:'lower_body'}[deps.$('accessoryPreset')?.value];
  if(deps.studioMode==='inpaint'&&clothingCategory)return createAutomaticMask(clothingCategory,aiPoints);
  const sampleId=current.id,mode=deps.studioMode;
  if (!aiPoints.length) {
    const pixels=maskCtx.getImageData(0,0,maskCanvas.width,maskCanvas.height).data;let sumX=0,sumY=0,count=0;
    for(let index=3,pixel=0;index<pixels.length;index+=4,pixel++){if(pixels[index]>24){sumX+=pixel%maskCanvas.width;sumY+=Math.floor(pixel/maskCanvas.width);count++;}}
    if(count){aiPoints=[{x:Math.round(sumX/count),y:Math.round(sumY/count),label:1}];render();deps.setMessage('Đang dùng tâm vùng đã tô làm gợi ý cho AI…');}
    else{setTool('ai');deps.setMessage('Chế độ Điểm AI đã bật. Hãy nhấp vào vật thể cần chọn rồi bấm “Tạo mask tự động”.','error');return;}
  }
  deps.setMessage('SAM 2 đang phân vùng…');
  deps.$('segmentButton').disabled=true;
  try {
    const response = await fetch('/api/segment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sampleId, points: aiPoints, protectedDetailMask:binaryMaskDataUrl(false,true,true) }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể phân vùng');
    if(current?.id!==sampleId||deps.studioMode!==mode)return;
    const mask = new Image();
    mask.onload = () => {
      if(current?.id!==sampleId||deps.studioMode!==mode)return;
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
      deps.refreshStudioReadiness();
      deps.setMessage(`Đã tạo mask vật thể · phủ ${(Number(result.coverage)*100).toFixed(1)}% · Đã giữ vùng bảo vệ và điểm loại trừ`, 'success');
    };
    mask.src = result.mask;
  } catch (error) { deps.setMessage(error.message, 'error'); }
  finally{deps.$('segmentButton').disabled=false;}
}

function displayMask(maskUrl, message) {
  const sampleId=current?.id,mode=deps.studioMode;
  const mask = new Image();
  mask.onload = () => {
    if(current?.id!==sampleId||deps.studioMode!==mode)return;
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
    deps.refreshStudioReadiness();
    deps.setMessage(message, 'success');
  };
  mask.src = maskUrl;
}

function displayProtectedMask(maskUrl) {
  if (!maskUrl) return;
  const sampleId=current?.id,mode=deps.studioMode;
  const mask = new Image();
  mask.onload = () => {
    if(current?.id!==sampleId||deps.studioMode!==mode)return;
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
  if (!current) return deps.setMessage('Hãy chọn ảnh cần chỉnh sửa trước khi tạo mask.', 'error');
  const sampleId=current.id,mode=deps.studioMode;
  const preset=deps.$('accessoryPreset')?.value;
  const region=deps.$('labelSelect')?.value;
  const regionCategories={shirt:'upper_body',pants:'lower_body',outfit:'overall',sleepwear:'overall',underwear:'overall'};
  const selectedCategory={upper_body:'upper_body',lower_body:'lower_body',full_body:'overall',overall:'overall'}[region];
  if(mode==='tryon'&&!categoryOverride&&!selectedOutfitType()?.category)return segmentWithAi();
  const category=categoryOverride||selectedCategory||(mode==='inpaint'?regionCategories[preset]:selectedOutfitType()?.category);
  if(!category)return segmentWithAi();
  deps.$('autoMaskButton').disabled = true;
  deps.$('segmentButton').disabled = true;
  deps.setMessage('Đang chọn vùng trang phục và bảo vệ khuôn mặt, tóc, bàn tay…');
  try {
    const response = await fetch('/api/auto-mask', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sampleId, category, personIndex:Number(deps.$('personSelect').value), points, inferCategoryFromPoints:false, protectedDetailMask:binaryMaskDataUrl(false,true,true),...(mode==='tryon'?{targetGarment:targetGarmentValues()}: {})}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể tạo mask tự động');
    if(current?.id!==sampleId||deps.studioMode!==mode)return;
    if(deps.$('labelSelect')?.value!==region)return;
    if(mode==='inpaint'&&deps.$('accessoryPreset')?.value!==preset)return;
    if(mode==='tryon'&&!selectedCategory&&!categoryOverride&&deps.$('garmentCategory').value!==category)return;
    if(result.category!==category)throw new Error('Loại mask trả về không khớp nhãn vùng đã chọn.');
    const label={upper_body:'áo',lower_body:'quần / váy',overall:'toàn bộ trang phục',full_body:'toàn bộ trang phục'}[result.category];
    displayMask(result.mask, `Đã tạo mask ${label} · ${result.accepted?'Đã bảo vệ mặt, tóc và bàn tay':'Vùng chọn chưa đủ, hãy thêm điểm hoặc tô bổ sung'} · phủ ${(Number(result.coverage)*100).toFixed(1)}%`);
    displayProtectedMask(result.protectedMask);
    if(result.targetCoverage?.warnings?.length)deps.setMessage(result.targetCoverage.warnings.join(' '),'error');
  } catch (error) { deps.setMessage(error.message, 'error'); }
  finally { deps.$('autoMaskButton').disabled = false; deps.$('segmentButton').disabled = false; }
}

async function detectPeopleInImage() {
  if (!current) return deps.setMessage('Hãy chọn ảnh trước khi phát hiện nhân vật.', 'error');
  deps.$('detectPeopleButton').disabled = true;
  deps.setMessage('Đang phát hiện nhân vật bằng bộ dò local…');
  try {
    const response = await fetch('/api/analyze-people', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({sampleId:current.id,usePose:deps.$('usePoseToggle').checked}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể phát hiện nhân vật');
    deps.$('personSelect').innerHTML = result.people.map((person)=>`<option value="${person.index}">Nhân vật ${person.index + 1} · ${person.source}</option>`).join('');
    deps.detectedPeople = result.people;
    render();
    deps.setMessage(`Đã phát hiện ${result.people.length} nhân vật. Chọn nhân vật rồi tạo mask.`, 'success');
  } catch (error) { deps.setMessage(error.message, 'error'); }
  finally { deps.$('detectPeopleButton').disabled = false; }
}

async function preprocessGarment() {
  if (!deps.garmentDataUrl) return deps.setMessage('Hãy chọn ảnh trang phục tham chiếu.', 'error');
  deps.$('preprocessGarmentButton').disabled = true;
  deps.setMessage('Đang tách nền và căn lại ảnh trang phục…');
  try {
    const response = await fetch('/api/preprocess-garment', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({garmentImage:deps.garmentDataUrl,category:deps.$('garmentCategory').value,referenceType:deps.$('referenceType')?.value||'auto'}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể tiền xử lý trang phục');
    deps.garmentDataUrl = result.image;
    if(deps.$('referenceType'))deps.$('referenceType').value='product';
    deps.$('garmentPreview').src = deps.garmentDataUrl;
    deps.setMessage(`Đã chuẩn hóa ${result.mode==='model-photo'?'ảnh người mẫu':'ảnh sản phẩm'} · vùng giữ lại ${(result.coverage * 100).toFixed(1)}% · SAM ${Number(result.score).toFixed(3)}`, 'success');
  } catch (error) { deps.setMessage(error.message, 'error'); }
  finally { deps.$('preprocessGarmentButton').disabled = false; }
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
  const tools = deps.$('addTool')?.closest('.tool-group');
  const workspace = canvas.closest('.canvas-wrap');
  for (const element of [tools, workspace]) {
    if (!element) continue;
    element.classList.remove('mask-attention');
    requestAnimationFrame(() => element.classList.add('mask-attention'));
    setTimeout(() => element.classList.remove('mask-attention'), 2600);
  }
}

function showMaskGuide(stats) {
  const preset = deps.$('accessoryPreset').selectedOptions[0]?.textContent?.trim() || 'hiện tại';
  const empty = stats.selected === 0;
  deps.$('maskGuideTitle').textContent = empty ? 'Chọn vùng trước khi tạo phương án' : 'Vùng chọn đang quá nhỏ';
  deps.$('maskGuideText').textContent = empty
    ? `Hãy tô lên vật thể hoặc để AI tạo vùng theo preset “${preset}”.`
    : `Vùng hiện tại chỉ chiếm ${(stats.coverage * 100).toFixed(3)}% ảnh. Hãy mở rộng vùng hoặc để AI tạo lại mask “${preset}”.`;
  deps.$('emptyMaskDialog').showModal();
  highlightMaskTools();
  deps.setMessage(empty ? 'Chưa chọn vùng cần xóa.' : 'Vùng chọn quá nhỏ để tạo kết quả ổn định.', 'error');
}

async function createMaskFromInpaintPreset() {
  const preset = deps.$('accessoryPreset').value;
  const garmentCategories = { shirt: 'upper_body', pants: 'lower_body', outfit: 'overall' };
  const objectClasses = { glasses: 'glasses', hat: 'hat', jewelry: 'necklace, jewelry', bag: 'handbag, bag', shoes: 'shoes' };
  if (garmentCategories[preset]) return createAutomaticMask(garmentCategories[preset]);
  if (objectClasses[preset]) {
    deps.$('yoloClasses').value = objectClasses[preset];
    return deps.detectWithManagedModel('yolo-world');
  }
  setTool('ai');
  deps.$('aiTool').scrollIntoView({ behavior: 'smooth', block: 'center' });
  deps.setMessage('Nhấp vào vật thể cần xóa, sau đó chọn “Tạo mask tự động”.');
}
return {bindings:{get canvas(){return canvas;},set canvas(value){canvas=value;},
get ctx(){return ctx;},set ctx(value){ctx=value;},
get maskCanvas(){return maskCanvas;},set maskCanvas(value){maskCanvas=value;},
get maskCtx(){return maskCtx;},set maskCtx(value){maskCtx=value;},
get protectCanvas(){return protectCanvas;},set protectCanvas(value){protectCanvas=value;},
get protectCtx(){return protectCtx;},set protectCtx(value){protectCtx=value;},
get manualProtectCanvas(){return manualProtectCanvas;},set manualProtectCanvas(value){manualProtectCanvas=value;},
get manualProtectCtx(){return manualProtectCtx;},set manualProtectCtx(value){manualProtectCtx=value;},
get images(){return images;},set images(value){images=value;},
get current(){return current;},set current(value){current=value;},
get sourceImage(){return sourceImage;},set sourceImage(value){sourceImage=value;},
get drawing(){return drawing;},set drawing(value){drawing=value;},
get tool(){return tool;},set tool(value){tool=value;},
get lastPoint(){return lastPoint;},set lastPoint(value){lastPoint=value;},
get history(){return history;},set history(value){history=value;},
get aiPoints(){return aiPoints;},set aiPoints(value){aiPoints=value;},
get MAX_HISTORY(){return MAX_HISTORY;},set MAX_HISTORY(value){MAX_HISTORY=value;},
get editorZoom(){return editorZoom;},set editorZoom(value){editorZoom=value;},
get editorPan(){return editorPan;},set editorPan(value){editorPan=value;},
get editorPanStart(){return editorPanStart;},set editorPanStart(value){editorPanStart=value;},
get editorPanMode(){return editorPanMode;},set editorPanMode(value){editorPanMode=value;},
get updateEditorTransform(){return updateEditorTransform;},set updateEditorTransform(value){updateEditorTransform=value;},
get setEditorZoom(){return setEditorZoom;},set setEditorZoom(value){setEditorZoom=value;},
get fitCanvas(){return fitCanvas;},set fitCanvas(value){fitCanvas=value;},
get render(){return render;},set render(value){render=value;},
get snapshot(){return snapshot;},set snapshot(value){snapshot=value;},
get canvasPoint(){return canvasPoint;},set canvasPoint(value){canvasPoint=value;},
get paint(){return paint;},set paint(value){paint=value;},
get canvasPointerStart(){return canvasPointerStart;},set canvasPointerStart(value){canvasPointerStart=value;},
get canvasFirstClick(){return canvasFirstClick;},set canvasFirstClick(value){canvasFirstClick=value;},
get restoreCanvasBeforeDoubleClick(){return restoreCanvasBeforeDoubleClick;},set restoreCanvasBeforeDoubleClick(value){restoreCanvasBeforeDoubleClick=value;},
get loadImage(){return loadImage;},set loadImage(value){loadImage=value;},
get renderImageOptions(){return renderImageOptions;},set renderImageOptions(value){renderImageOptions=value;},
get editorHasChanges(){return editorHasChanges;},set editorHasChanges(value){editorHasChanges=value;},
get restoreControlDefault(){return restoreControlDefault;},set restoreControlDefault(value){restoreControlDefault=value;},
get resetEditorSession(){return resetEditorSession;},set resetEditorSession(value){resetEditorSession=value;},
get showEmptyEditorState(){return showEmptyEditorState;},set showEmptyEditorState(value){showEmptyEditorState=value;},
get deselectCurrentImage(){return deselectCurrentImage;},set deselectCurrentImage(value){deselectCurrentImage=value;},
get uploadSourceImage(){return uploadSourceImage;},set uploadSourceImage(value){uploadSourceImage=value;},
get setTool(){return setTool;},set setTool(value){setTool=value;},
get segmentWithAi(){return segmentWithAi;},set segmentWithAi(value){segmentWithAi=value;},
get displayMask(){return displayMask;},set displayMask(value){displayMask=value;},
get displayProtectedMask(){return displayProtectedMask;},set displayProtectedMask(value){displayProtectedMask=value;},
get createAutomaticMask(){return createAutomaticMask;},set createAutomaticMask(value){createAutomaticMask=value;},
get detectPeopleInImage(){return detectPeopleInImage;},set detectPeopleInImage(value){detectPeopleInImage=value;},
get preprocessGarment(){return preprocessGarment;},set preprocessGarment(value){preprocessGarment=value;},
get binaryMaskDataUrl(){return binaryMaskDataUrl;},set binaryMaskDataUrl(value){binaryMaskDataUrl=value;},
get editableMaskStats(){return editableMaskStats;},set editableMaskStats(value){editableMaskStats=value;},
get highlightMaskTools(){return highlightMaskTools;},set highlightMaskTools(value){highlightMaskTools=value;},
get showMaskGuide(){return showMaskGuide;},set showMaskGuide(value){showMaskGuide=value;},
get createMaskFromInpaintPreset(){return createMaskFromInpaintPreset;},set createMaskFromInpaintPreset(value){createMaskFromInpaintPreset=value;}},steps:[
function initialize(){
(canvas = deps.$('editorCanvas'));
},
function initialize(){
(ctx = canvas.getContext('2d'));
},
function initialize(){
(maskCanvas = document.createElement('canvas'));
},
function initialize(){
(maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true }));
},
function initialize(){
(protectCanvas = document.createElement('canvas'));
},
function initialize(){
(protectCtx = protectCanvas.getContext('2d', { willReadFrequently: true }));
},
function initialize(){
(manualProtectCanvas = document.createElement('canvas'));
},
function initialize(){
(manualProtectCtx = manualProtectCanvas.getContext('2d', { willReadFrequently: true }));
},
function initialize(){
(images = []);
},
function initialize(){
(current = null);
},
function initialize(){
(sourceImage = null);
},
function initialize(){
(drawing = false);
},
function initialize(){
(tool = 'add');
},
function initialize(){
(lastPoint = null);
},
function initialize(){
(history = []);
},
function initialize(){
(aiPoints = []);
},
function initialize(){
(MAX_HISTORY = 20);
},
function initialize(){
(editorZoom = 1);
(editorPan = {x:0,y:0});
(editorPanStart = null);
(editorPanMode = false);
},
function initialize(){
deps.$('editorZoomIn').addEventListener('click',()=>setEditorZoom(editorZoom*1.25));
},
function initialize(){
deps.$('editorZoomOut').addEventListener('click',()=>setEditorZoom(editorZoom/1.25));
},
function initialize(){
deps.$('editorZoomFit').addEventListener('click',()=>setEditorZoom(1));
},
function initialize(){
deps.$('editorPanToggle').addEventListener('click',()=>{
  editorPanMode=!editorPanMode;
  deps.$('editorPanToggle').setAttribute('aria-pressed',String(editorPanMode));
  canvas.style.cursor=editorPanMode?'grab':'crosshair';
});
},
function initialize(){
canvas.addEventListener('wheel',(event)=>{
  if(!sourceImage)return;
  event.preventDefault();
  setEditorZoom(editorZoom*(event.deltaY<0?1.15:1/1.15));
},{passive:false});
},
function initialize(){
canvas.addEventListener('auxclick',(event)=>{if(event.button===1)event.preventDefault();});
},
function initialize(){
(canvasPointerStart = null);
(canvasFirstClick = null);
},
function initialize(){
canvas.addEventListener('click',(event)=>{
  if(event.detail===1)canvasFirstClick=canvasPointerStart;
});
},
function initialize(){
canvas.addEventListener('pointerdown', (event) => {
  if (!sourceImage) return;
  if(editorPanMode||event.button===1||(event.button===0&&event.altKey)){
    event.preventDefault();canvasPointerStart=null;canvasFirstClick=null;
    editorPanStart={id:event.pointerId,x:event.clientX,y:event.clientY,pan:{...editorPan}};
    canvas.setPointerCapture(event.pointerId);return;
  }
  if(event.button!==0)return;
  if(window.ImageEnhancement?.captureEdgePoint?.(event)){canvasPointerStart=null;canvasFirstClick=null;return;}
  canvasPointerStart={image:sourceImage,points:aiPoints.map(point=>({...point})),person:deps.$('personSelect').value};
  if (tool === 'ai') {
    const point = canvasPoint(event);
    aiPoints.push({ ...point, label: event.shiftKey ? 0 : 1 });
    render();
    deps.setMessage(`${aiPoints.length} điểm AI. Nhấn “Tạo mask tự động”.`);
    return;
  }
  if (tool === 'person') {
    const point = canvasPoint(event);
    const matches = deps.detectedPeople.filter((person)=>point.x>=person.box[0]&&point.x<=person.box[2]&&point.y>=person.box[1]&&point.y<=person.box[3]);
    if (matches.length) {
      matches.sort((a,b)=>(a.box[2]-a.box[0])*(a.box[3]-a.box[1])-(b.box[2]-b.box[0])*(b.box[3]-b.box[1]));
      deps.$('personSelect').value=String(matches[0].index); render();
      deps.setMessage(`Đã chọn nhân vật ${matches[0].index+1}.`,'success');
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
},
function initialize(){
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
},
function initialize(){
canvas.addEventListener('pointerup', () => { editorPanStart=null;drawing = false; lastPoint = null; deps.refreshStudioReadiness(); });
},
function initialize(){
canvas.addEventListener('pointercancel', () => { editorPanStart=null;drawing = false; lastPoint = null; });
},
function initialize(){
canvas.addEventListener('lostpointercapture',()=>{editorPanStart=null;drawing=false;lastPoint=null;});
}
]};
};
