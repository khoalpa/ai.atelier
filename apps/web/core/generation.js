'use strict';
// Owned state: textToImageModels, TEXT_PIPELINE_HINTS, modelSelectorRefreshPromise, modelStartupScanPromise, textQuality
// Dependencies: $, current, editableMaskStats, escapeHtml, garmentDataUrl, loadInpaintModelOptions, loadModelCandidates, loadModelCapabilities, loadModels, modelInventory, runInpaint, runTryon, seedForRun, setCustomSeed, setMessage, sourceImage
module.exports=function createGeneration(deps){
let textToImageModels, TEXT_PIPELINE_HINTS, modelSelectorRefreshPromise, modelStartupScanPromise, textQuality;
function textControlUnavailableReason(){
  const required=['controlnet-depth-sd35-large'];
  for(const id of required){
    const item=deps.modelInventory.find((model)=>model.id===id);
    if(!item)return 'Chưa xác định được trạng thái model ControlNet SD3.5.';
    if(!item.downloaded||item.operationalReady!==true)return item.runtimeReason||`Model ${item.name} chưa sẵn sàng.`;
  }
  return '';
}

function updateTextToImagePipeline(){
  const mode=deps.$('textToImagePipeline').value,hasImage=Boolean(deps.current&&deps.sourceImage),hasMask=deps.editableMaskStats().selected>0,hasReference=Boolean(deps.garmentDataUrl);
  const ready=mode==='generate'||(mode==='inpaint'&&hasImage&&hasMask)||(mode==='catvton'&&hasImage&&hasReference)||(mode==='lora'&&hasImage&&hasMask&&Boolean(deps.$('textToImageLora').value))||(mode==='control'&&hasImage&&!textControlUnavailableReason());
  const missing=mode==='control'&&textControlUnavailableReason()?textControlUnavailableReason():mode==='generate'?'Không cần ảnh đầu vào.':!hasImage?'Thiếu ảnh chính; chọn trong Chỉnh sửa ảnh.':['inpaint','lora'].includes(mode)&&!hasMask?'Thiếu mask; tô vùng trong Chỉnh sửa ảnh.':mode==='catvton'&&!hasReference?'Thiếu ảnh trang phục/tham chiếu.':mode==='lora'&&!deps.$('textToImageLora').value?'Chưa chọn LoRA.':'Đã đủ đầu vào.';
  deps.$('textToImagePipelineHint').textContent=TEXT_PIPELINE_HINTS[mode];deps.$('textToImagePipelineReadiness').textContent=`${ready?'✓ Sẵn sàng':'○ Chưa sẵn sàng'} · ${missing}`;deps.$('textToImageLoraOptions').hidden=mode!=='lora';
  updateTextToImageAvailability();
}

async function loadTextToImageLoras(){const response=await fetch('/api/lora-status'),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc LoRA');const usable=result.adapters.filter((item)=>item.usable);deps.$('textToImageLora').innerHTML=usable.map((item)=>`<option value="${deps.escapeHtml(item.id)}">${deps.escapeHtml(item.name||item.id)}</option>`).join('')||'<option value="">Không có LoRA khả dụng</option>';updateTextToImagePipeline();}

function updateTextToImageAvailability(){syncTextToImageControls();const select=deps.$('textToImageModel'),item=textToImageModels.get(select.value),ready=Boolean(item?.downloaded)&&!['integration','dependency'].includes(item?.compatibility),direct=!deps.$('textToImagePipeline')||deps.$('textToImagePipeline').value==='generate';deps.$('chromaGenerateButton').disabled=direct&&!ready||(!direct&&deps.$('textToImagePipeline').value==='control'&&Boolean(textControlUnavailableReason()));deps.$('textToImageModelHint').textContent=item?`${ready?'✓ Sẵn sàng':'Chưa tải, thiếu tệp hoặc cần tích hợp'} · ${item.recommendedVramGb||'VRAM chưa rõ'} GB · ${item.pipeline||'pipeline tự nhận diện'}`:'Không tìm thấy model trong thư viện';deps.$('chromaViewStatus').textContent=direct?(ready?`${item.name} · sẵn sàng trên máy`:`${item?.name||select.value} · chưa sẵn sàng`):`Pipeline mở rộng · ${deps.$('textToImagePipeline').selectedOptions[0]?.text||''}`;deps.$('chromaViewStatus').classList.toggle('error',direct&&!ready);}

async function loadTextToImageModels(){const response=await fetch('/api/model-candidates',{cache:'no-store'}),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc model tạo ảnh');const preferred=['sdxl-base-1.0','sd35-medium','flux-chroma1-hd'],models=result.inventory.filter((item)=>item.kind==='text-to-image'||(item.features||[]).some((feature)=>String(feature).toLowerCase()==='text-to-image')).sort((a,b)=>{const ai=preferred.indexOf(a.id),bi=preferred.indexOf(b.id);return(ai<0?999:ai)-(bi<0?999:bi)||String(a.name).localeCompare(String(b.name),'vi');});textToImageModels=new Map(models.map((item)=>[item.id,item]));const previous=deps.$('textToImageModel').value,selected=localStorage.getItem('textToImageModelChoice')||previous||'sd35-medium';deps.$('textToImageModel').innerHTML=models.map((item)=>{const ready=Boolean(item.downloaded),compatible=!['integration','dependency'].includes(item.compatibility);return `<option value="${deps.escapeHtml(item.id)}" ${item.id===selected?'selected':''} ${ready&&compatible?'':'disabled'}>${deps.escapeHtml(item.name)}${ready&&compatible?' · sẵn sàng':ready?' · cần tích hợp':' · chưa tải'}</option>`;}).join('')||'<option value="" disabled>Không có model tương thích</option>';const current=textToImageModels.get(selected);if(!current?.downloaded||['integration','dependency'].includes(current?.compatibility)){const fallback=models.find((item)=>item.downloaded&&!['integration','dependency'].includes(item.compatibility));deps.$('textToImageModel').value=fallback?.id||'';if(fallback)localStorage.setItem('textToImageModelChoice',fallback.id);else localStorage.removeItem('textToImageModelChoice');}if(deps.$('textToImageModel').value!==previous)applyTextToImagePreset(textQuality);else updateTextToImageAvailability();}

async function refreshModelSelectors(){
  if(modelSelectorRefreshPromise)return modelSelectorRefreshPromise;
  modelSelectorRefreshPromise=Promise.all([deps.loadModels(),deps.loadModelCandidates(),loadTextToImageModels(),deps.loadModelCapabilities(),deps.loadInpaintModelOptions()]).finally(()=>{modelSelectorRefreshPromise=null;});
  return modelSelectorRefreshPromise;
}

function startModelSelectorStartupScan(){
  if(modelStartupScanPromise)return modelStartupScanPromise;
  modelStartupScanPromise=refreshModelSelectors().catch((error)=>{
    deps.setMessage(`Không thể quét model khi mở ứng dụng: ${error.message}`,'error');
  });
  return modelStartupScanPromise;
}

function TEXT_TO_IMAGE_PRESETS(){return window.ATELIER_PROMPTS.runtimePresets.textToImage;}

function syncTextToImageControls(){
  const klein=deps.$('textToImageModel').value==='flux-2-klein-4b';
  for(const id of ['chromaNegativePrompt','suggestNegativePromptButton','optimizeNegativePromptButton','chromaQuality'])if(deps.$(id))deps.$(id).disabled=klein;
  if(klein){deps.$('chromaQuality').value='4';if(deps.$('textToImagePresetHint'))deps.$('textToImagePresetHint').textContent=`FLUX.2 klein 4B · ${deps.$('chromaSize').value} px · 4 bước. Không dùng Điều cần tránh.`;}
  if(deps.$('chromaNegativePrompt'))deps.$('chromaNegativePrompt').title=klein?'FLUX.2 klein dùng mô tả chính; không áp dụng negative prompt.':'';
}

function applyTextToImagePreset(name){
  textQuality=['fast','balanced','quality'].includes(name)?name:'balanced';
  const id=deps.$('textToImageModel').value,chroma=id==='flux-chroma1-hd';
  const klein=id==='flux-2-klein-4b';
  const family=klein?'klein':chroma?'chroma':id==='sd35-medium'?'sd35':'sdxl';
  const profile=TEXT_TO_IMAGE_PRESETS().profiles?.[family];
  const sizes=TEXT_TO_IMAGE_PRESETS().sizes,steps=profile?.steps||(klein?TEXT_TO_IMAGE_PRESETS().steps.klein:chroma?TEXT_TO_IMAGE_PRESETS().steps.chroma:TEXT_TO_IMAGE_PRESETS().steps.standard);
  if(deps.$('chromaGuidance'))deps.$('chromaGuidance').value=String(profile?.guidance||(klein?1:chroma?3:4.5));
  syncTextToImageControls();
  deps.$('chromaSize').value=sizes[textQuality];deps.$('chromaQuality').value=String(steps[textQuality]);
  for(const button of document.querySelectorAll('[data-text-quality]')){const active=button.dataset.textQuality===textQuality;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  deps.$('textToImagePresetHint').textContent=`${deps.$('textToImageModel').selectedOptions[0]?.textContent||'Model đang chọn'} · ${sizes[textQuality]} px · ${steps[textQuality]} bước.${klein?' Không dùng Điều cần tránh.':''}`;
  updateTextToImageAvailability();window.NewImage?.sync();
}

async function runChromaGenerate(){return window.NewImage.generate();}

async function runExtendedTextPipeline(mode,prompt){
  updateTextToImagePipeline();
  if(mode==='control'&&textControlUnavailableReason())return deps.setMessage(textControlUnavailableReason(),'error');
  const negative=deps.$('chromaNegativePrompt').value.trim(),seed=deps.seedForRun('chromaSeed'),steps=Number(deps.$('chromaQuality').value);
  if(!deps.current||!deps.sourceImage)throw new Error('Hãy chọn ảnh chính trong Chỉnh sửa ảnh trước.');
  if(['inpaint','lora'].includes(mode)&&deps.editableMaskStats().selected===0)throw new Error('Hãy tô mask trong Chỉnh sửa ảnh trước.');
  if(mode==='catvton'&&!deps.garmentDataUrl)throw new Error('Hãy thêm ảnh trang phục hoặc ảnh tham chiếu trong Chỉnh sửa ảnh trước.');
  deps.$('inpaintPrompt').value=prompt;deps.setCustomSeed('inpaintSeed',seed);deps.$('inpaintSteps').value=String(steps);
  if(mode==='inpaint')return deps.runInpaint();
  if(mode==='catvton')return deps.runTryon();
  if(mode==='lora'){
    const id=deps.$('textToImageLora').value;if(!id)throw new Error('Chưa có LoRA khả dụng.');
    const response=await fetch('/api/lora-configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adapters:[{id,weight:Number(deps.$('textToImageLoraWeight').value)}]})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể áp dụng LoRA');
    return deps.runInpaint();
  }
  const button=deps.$('chromaGenerateButton');button.disabled=true;const original=button.textContent;button.textContent='Đang tạo có điều kiện…';
  try{
    const response=await fetch('/api/sd35-conditioned-generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sampleId:deps.current.id,prompt,negativePrompt:negative,seed,steps,guidance:4.5,controlScale:.7,maxSide:Number(deps.$('chromaSize').value)})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể chạy ControlNet SD3.5');
    deps.$('chromaGallery').innerHTML=`<article class="result-card"><img src="${result.image}" alt="Kết quả ControlNet SD3.5"><p>ControlNet SD3.5 · seed ${result.seed}</p><a class="button-link" href="${result.image}" download="conditioned-${result.seed}.png">Tải ảnh</a></article>`;deps.$('chromaGalleryMeta').textContent='Đã tạo ảnh theo chiều sâu và bố cục ảnh chính.';deps.setMessage('ControlNet SD3.5 đã tạo ảnh thành công.','success');
  }finally{button.disabled=false;button.textContent=original;}
}
return {bindings:{get textToImageModels(){return textToImageModels;},set textToImageModels(value){textToImageModels=value;},
get TEXT_PIPELINE_HINTS(){return TEXT_PIPELINE_HINTS;},set TEXT_PIPELINE_HINTS(value){TEXT_PIPELINE_HINTS=value;},
get textControlUnavailableReason(){return textControlUnavailableReason;},set textControlUnavailableReason(value){textControlUnavailableReason=value;},
get updateTextToImagePipeline(){return updateTextToImagePipeline;},set updateTextToImagePipeline(value){updateTextToImagePipeline=value;},
get loadTextToImageLoras(){return loadTextToImageLoras;},set loadTextToImageLoras(value){loadTextToImageLoras=value;},
get updateTextToImageAvailability(){return updateTextToImageAvailability;},set updateTextToImageAvailability(value){updateTextToImageAvailability=value;},
get loadTextToImageModels(){return loadTextToImageModels;},set loadTextToImageModels(value){loadTextToImageModels=value;},
get modelSelectorRefreshPromise(){return modelSelectorRefreshPromise;},set modelSelectorRefreshPromise(value){modelSelectorRefreshPromise=value;},
get modelStartupScanPromise(){return modelStartupScanPromise;},set modelStartupScanPromise(value){modelStartupScanPromise=value;},
get refreshModelSelectors(){return refreshModelSelectors;},set refreshModelSelectors(value){refreshModelSelectors=value;},
get startModelSelectorStartupScan(){return startModelSelectorStartupScan;},set startModelSelectorStartupScan(value){startModelSelectorStartupScan=value;},
get textQuality(){return textQuality;},set textQuality(value){textQuality=value;},
get TEXT_TO_IMAGE_PRESETS(){return TEXT_TO_IMAGE_PRESETS;},set TEXT_TO_IMAGE_PRESETS(value){TEXT_TO_IMAGE_PRESETS=value;},
get syncTextToImageControls(){return syncTextToImageControls;},set syncTextToImageControls(value){syncTextToImageControls=value;},
get applyTextToImagePreset(){return applyTextToImagePreset;},set applyTextToImagePreset(value){applyTextToImagePreset=value;},
get runChromaGenerate(){return runChromaGenerate;},set runChromaGenerate(value){runChromaGenerate=value;},
get runExtendedTextPipeline(){return runExtendedTextPipeline;},set runExtendedTextPipeline(value){runExtendedTextPipeline=value;}},steps:[
function initialize(){
(textToImageModels = new Map());
},
function initialize(){
(TEXT_PIPELINE_HINTS = {generate:'Tạo ảnh mới hoàn toàn từ prompt.',inpaint:'Dùng ảnh và mask đang chọn trong Chỉnh sửa ảnh để tái tạo vùng bằng SD3.5.',catvton:'Dùng ảnh người đang chọn và ảnh trang phục tham chiếu bằng CatVTON.',lora:'Áp dụng LoRA SD3.5 rồi tái tạo vùng mask đang chọn.',control:'Giữ chiều sâu và bố cục ảnh chính bằng ControlNet Depth SD 3.5 Large.'});
},
function initialize(){
(modelSelectorRefreshPromise = null);
(modelStartupScanPromise = null);
},
function initialize(){
(textQuality = 'balanced');
}
]};
};
