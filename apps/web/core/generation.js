'use strict';
// Owned state: textToImageModels, TEXT_PIPELINE_HINTS, modelSelectorRefreshPromise, modelStartupScanPromise, textQuality
// Dependencies: $, current, editableMaskStats, escapeHtml, garmentDataUrl, loadInpaintModelOptions, loadModelCandidates, loadModelCapabilities, loadModels, modelInventory, runInpaint, runTryon, seedForRun, setCustomSeed, setMessage, sourceImage
module.exports=function createGeneration(deps){
let textToImageModels, TEXT_PIPELINE_HINTS, modelSelectorRefreshPromise, modelStartupScanPromise, textQuality;
function updateTextToImagePipeline(){
  const mode=deps.$('textToImagePipeline').value,hasImage=Boolean(deps.current&&deps.sourceImage),hasMask=deps.editableMaskStats().selected>0,hasReference=Boolean(deps.garmentDataUrl);
  const ready=mode==='generate'||(mode==='catvton'&&hasImage&&hasReference);
  const missing=mode==='generate'?'Không cần ảnh đầu vào.':!hasImage?'Thiếu ảnh chính; chọn trong Chỉnh sửa ảnh.':!hasReference?'Thiếu ảnh trang phục/tham chiếu.':'Đã đủ đầu vào.';
  deps.$('textToImagePipelineHint').textContent=TEXT_PIPELINE_HINTS[mode];deps.$('textToImagePipelineReadiness').textContent=`${ready?'✓ Sẵn sàng':'○ Chưa sẵn sàng'} · ${missing}`;deps.$('textToImageLoraOptions').hidden=true;
  updateTextToImageAvailability();
}

async function loadTextToImageLoras(){const response=await fetch('/api/lora-status'),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc LoRA');const usable=result.adapters.filter((item)=>item.usable);deps.$('textToImageLora').innerHTML=usable.map((item)=>`<option value="${deps.escapeHtml(item.id)}">${deps.escapeHtml(item.name||item.id)}</option>`).join('')||'<option value="">Không có LoRA khả dụng</option>';updateTextToImagePipeline();}

function updateTextToImageAvailability(){syncTextToImageControls();const select=deps.$('textToImageModel'),item=textToImageModels.get(select.value),ready=Boolean(item?.downloaded)&&item?.promptAllowed!==false&&!['integration','dependency'].includes(item?.compatibility),direct=!deps.$('textToImagePipeline')||deps.$('textToImagePipeline').value==='generate';deps.$('chromaGenerateButton').disabled=direct&&!ready;deps.$('textToImageModelHint').textContent=item?`${ready?'✓ Sẵn sàng':'Chưa tải, thiếu tệp hoặc không đạt chính sách encoder'} · ${item.textEncoder||'encoder chưa rõ'} · ${item.recommendedVramGb||'VRAM chưa rõ'} GB`:'Không tìm thấy model trong thư viện';deps.$('chromaViewStatus').textContent=direct?(ready?`${item.name} · sẵn sàng trên máy`:`${item?.name||select.value} · chưa sẵn sàng`):`Pipeline mở rộng · ${deps.$('textToImagePipeline').selectedOptions[0]?.text||''}`;deps.$('chromaViewStatus').classList.toggle('error',direct&&!ready);}

async function loadTextToImageModels(){const response=await fetch('/api/model-candidates',{cache:'no-store'}),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc model tạo ảnh');const allowed=new Set(['flux-chroma1-hd','flux-2-klein-4b']),preferred=['flux-chroma1-hd','flux-2-klein-4b'],models=result.inventory.filter((item)=>allowed.has(item.id)&&(item.kind==='text-to-image'||(item.features||[]).some((feature)=>String(feature).toLowerCase()==='text-to-image'))).sort((a,b)=>preferred.indexOf(a.id)-preferred.indexOf(b.id)||String(a.name).localeCompare(String(b.name),'vi'));textToImageModels=new Map(models.map((item)=>[item.id,item]));const previous=deps.$('textToImageModel').value,stored=localStorage.getItem('textToImageModelChoice'),selected=allowed.has(stored)?stored:'flux-chroma1-hd';deps.$('textToImageModel').innerHTML=models.map((item)=>{const ready=Boolean(item.downloaded),compatible=!['integration','dependency'].includes(item.compatibility);return `<option value="${deps.escapeHtml(item.id)}" ${item.id===selected?'selected':''} ${ready&&compatible?'':'disabled'}>${deps.escapeHtml(item.name)}${ready&&compatible?' · sẵn sàng':ready?' · cần tích hợp':' · chưa tải'}</option>`;}).join('')||'<option value="" disabled>Không có model T5/Qwen tương thích</option>';const current=textToImageModels.get(selected);if(!current?.downloaded||['integration','dependency'].includes(current?.compatibility)){const fallback=models.find((item)=>item.downloaded&&!['integration','dependency'].includes(item.compatibility));deps.$('textToImageModel').value=fallback?.id||'';if(fallback)localStorage.setItem('textToImageModelChoice',fallback.id);else localStorage.removeItem('textToImageModelChoice');}if(deps.$('textToImageModel').value!==previous)applyTextToImagePreset(textQuality);else updateTextToImageAvailability();globalThis.PromptBuilder?.refresh();}

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
  if(!deps.current||!deps.sourceImage)throw new Error('Hãy chọn ảnh chính trong Chỉnh sửa ảnh trước.');
  if(mode!=='catvton')throw new Error('Pipeline này đã ngừng vì chưa có model T5-only.');
  if(!deps.garmentDataUrl)throw new Error('Hãy thêm ảnh trang phục hoặc ảnh tham chiếu trong Chỉnh sửa ảnh trước.');
  const seed=deps.seedForRun('chromaSeed'),steps=Number(deps.$('chromaQuality').value);
  deps.$('inpaintPrompt').value=prompt;deps.setCustomSeed('inpaintSeed',seed);deps.$('inpaintSteps').value=String(steps);
  return deps.runTryon();
}
return {bindings:{get textToImageModels(){return textToImageModels;},set textToImageModels(value){textToImageModels=value;},
get TEXT_PIPELINE_HINTS(){return TEXT_PIPELINE_HINTS;},set TEXT_PIPELINE_HINTS(value){TEXT_PIPELINE_HINTS=value;},
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
(TEXT_PIPELINE_HINTS = {generate:'Tạo ảnh mới hoàn toàn bằng T5 hoặc Qwen.',catvton:'Dùng ảnh người đang chọn và ảnh trang phục tham chiếu bằng CatVTON.'});
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
