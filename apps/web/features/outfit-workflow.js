// Both tasks use this catalog; category is the existing CatVTON/mask API value.
function outfitTypes(){return window.ATELIER_PROMPTS.outfitTypes;}
let descriptionTryonRunning=false;
let descriptionConfiguredModel='';
function targetGarmentValues(){
  return Object.fromEntries([['sleeveLength','targetSleeveLength'],['hemLength','targetHemLength'],['silhouette','targetSilhouette'],['neckline','targetNeckline'],['layering','targetLayering']].map(([key,id])=>[key,globalThis.AtelierApp.$(id)?.value||'unknown']));
}
function descriptionModelValues(){
  const id=globalThis.AtelierApp.$('tryonDescriptionModel')?.value;
  const model=(window.ATELIER_INPAINT_MODELS||[]).find(item=>item.id===id)||{};
  const profile=window.ATELIER_PROMPTS?.runtimePresets?.modelInpaintProfiles?.[id]||model.removalProfile||{};
  const flux=model.architecture==='flux'||profile.promptMode==='flux-positive-only';
  return {steps:Number(profile.steps||40),guidance:Number(profile.guidance??(flux?30:6)),strength:Number(profile.strength??1),maxSide:Number(profile.nativeResolution||1024),supportsNegative:profile.supportsNegativePrompt??!flux};
}
function applyDescriptionModelSettings(reset=false){
  const model=globalThis.AtelierApp.$('tryonDescriptionModel');if(!model)return;
  const values=descriptionModelValues();
  if(reset||descriptionConfiguredModel!==model.value){
    for(const [id,key] of [['descriptionSteps','steps'],['descriptionGuidance','guidance'],['descriptionStrength','strength'],['descriptionResolution','maxSide']])if(globalThis.AtelierApp.$(id))globalThis.AtelierApp.$(id).value=String(values[key]);
    descriptionConfiguredModel=model.value;
  }
  if(globalThis.AtelierApp.$('tryonDescriptionNegative'))globalThis.AtelierApp.$('tryonDescriptionNegative').disabled=!values.supportsNegative;
  if(globalThis.AtelierApp.$('descriptionNegativeHint'))globalThis.AtelierApp.$('descriptionNegativeHint').textContent=values.supportsNegative?'Nêu các chi tiết không muốn xuất hiện.':'Model này không dùng điều cần tránh; hãy nêu rõ trang phục mong muốn trong mô tả.';
}
function descriptionRunSettings(){
  const defaults=descriptionModelValues();
  return Object.fromEntries([['steps','descriptionSteps'],['guidance','descriptionGuidance'],['strength','descriptionStrength'],['maxSide','descriptionResolution']].map(([key,id])=>[key,Number(globalThis.AtelierApp.$(id)?.value||defaults[key])]));
}
function applyDescriptionQualityPreset(name){
  const defaults=descriptionModelValues();
  const factor={fast:.6,balanced:.8,quality:1}[name]||1;
  if(globalThis.AtelierApp.$('descriptionSteps'))globalThis.AtelierApp.$('descriptionSteps').value=String(Math.max(4,Math.round(defaults.steps*factor)));
}
function isDescriptionTryon(){return globalThis.AtelierApp.$('tryonInputMode')?.value==='description';}
function selectedOutfitType(){return outfitTypes().find(item=>(item.category||item.id)===globalThis.AtelierApp.$('garmentCategory').value);}
function tryonPromptField(){return globalThis.AtelierApp.studioMode==='tryon'?globalThis.AtelierApp.$('tryonDescription'):globalThis.AtelierApp.$('chromaPrompt');}
function syncDescriptionModels(){
  const source=globalThis.AtelierApp.$('inpaintModelSelect'),target=globalThis.AtelierApp.$('tryonDescriptionModel');if(!source||!target)return;
  const previous=target.value;target.innerHTML=source.innerHTML;target.disabled=source.disabled;
  target.value=[...target.options].some(item=>item.value===previous&&!item.disabled)?previous:source.value;
  applyDescriptionModelSettings();
  globalThis.AtelierApp.refreshStudioReadiness();
}
function updateTryonInputMode(){
  const type=selectedOutfitType();
  if(!type?.category)globalThis.AtelierApp.$('tryonInputMode').value='description';
  const description=isDescriptionTryon();
  if(globalThis.AtelierApp.$('referenceType'))globalThis.AtelierApp.$('referenceType').closest('label').hidden=description;
  if(globalThis.AtelierApp.$('targetGarmentFields'))globalThis.AtelierApp.$('targetGarmentFields').hidden=!type?.category;
  if(globalThis.AtelierApp.$('targetSleeveLength'))globalThis.AtelierApp.$('targetSleeveLength').disabled=type?.category==='lower_body';
  if(globalThis.AtelierApp.$('targetNeckline'))globalThis.AtelierApp.$('targetNeckline').disabled=type?.category==='lower_body';
  globalThis.AtelierApp.$('tryonInputMode').querySelector('option[value="reference"]').disabled=!type?.category;
  globalThis.AtelierApp.$('tryonDescriptionFields').hidden=!description;
  for(const id of ['tryonModelSelect','garmentDescription','tryonSteps','tryonGuidance','garmentFile','garmentPreview','preprocessGarmentButton','saveReferenceButton','refreshReferenceReadinessButton','qualifyReferenceButton','referenceReadiness','minimumSimilarity','twoStageToggle','minimumQuality','minimumSeam','minimumAnatomy','maxRetries','repairSeamsToggle','generativeRefineToggle','refineRegion','onlyQualityToggle','reconstructExposedBodyToggle','bodyRepairMode','cropPersonToggle','confidenceThreshold','onlyConfidentToggle']){
    const node=globalThis.AtelierApp.$(id);if(!node)continue;const host=node.closest('label')||node;host.hidden=description||(id==='garmentPreview'&&!globalThis.AtelierApp.garmentDataUrl);
  }
  const referencePanel=globalThis.AtelierApp.$('referenceReadiness')?.closest('details');if(referencePanel)referencePanel.hidden=description;
  globalThis.AtelierApp.$('tryonModelHint').hidden=description;
  globalThis.AtelierApp.$('tryonReferenceBodyHint').hidden=description;
  const guide=globalThis.AtelierApp.$('garmentFile').closest('label').nextElementSibling;if(guide?.classList.contains('studio-guidance'))guide.hidden=description;
  globalThis.AtelierApp.$('autoMaskToggle').disabled=!type?.category&&!type?.classes;
  if(globalThis.AtelierApp.$('autoMaskToggle').disabled)globalThis.AtelierApp.$('autoMaskToggle').checked=false;
  const manualOnly=!type?.category&&!type?.classes;
  globalThis.AtelierApp.$('batchTryonButton').disabled=manualOnly;
  globalThis.AtelierApp.$('batchTryonButton').title=manualOnly?'Loại này cần tô vùng riêng trên từng ảnh; hãy chạy ảnh hiện tại.':'';
  globalThis.AtelierApp.$('batchTryonButton').textContent=description?'Chạy hàng loạt bằng mô tả':'Chạy hàng loạt và tự chọn';
  const batchCard=globalThis.AtelierApp.$('batchTryonButton').closest('section');
  const batchHint=batchCard?.querySelector('.batch-command-heading small');if(batchHint)batchHint.textContent=description?'Tự tạo vùng riêng cho từng ảnh; xem và chọn phương án.':'Tự tạo mask và chọn kết quả tốt nhất.';
  const license=batchCard?.querySelector('.batch-command-license');if(license)license.hidden=description;
  if(globalThis.AtelierApp.studioMode==='tryon'){
    if(globalThis.AtelierApp.$('studioModeHint'))globalThis.AtelierApp.$('studioModeHint').textContent=description?'Mô tả trang phục hoặc phụ kiện mới rồi chọn vùng cần thay.':'Thêm ảnh trang phục tham chiếu rồi chọn chất lượng.';
    const step=document.querySelector('.journey-steps li:nth-child(3)');if(step){step.querySelector('strong').textContent=description?'Mô tả trang phục':'Trang phục';step.querySelector('small').textContent=description?'Không cần ảnh mẫu':'Thêm ảnh tham chiếu';}
  }
  globalThis.AtelierApp.refreshStudioReadiness();
}
function setupOutfitWorkflow(){
  const previous=globalThis.AtelierApp.$('garmentCategory').value;
  for(const [id,tryon] of [['accessoryPreset',false],['garmentCategory',true]]){
    const select=globalThis.AtelierApp.$(id),value=select.value;
    select.replaceChildren(...outfitTypes().map(item=>{const key=tryon?(item.category||item.id):item.id;return new Option(item.label,key,key===value,key===value);}));
    select.value=tryon?previous:value;
  }
  globalThis.AtelierApp.$('tryonInputMode').addEventListener('change',updateTryonInputMode);
  globalThis.AtelierApp.$('garmentCategory').addEventListener('change',updateTryonInputMode);
  globalThis.AtelierApp.$('tryonDescriptionModel').addEventListener('change',()=>applyDescriptionModelSettings(true));
  for(const id of ['tryonDescription','tryonDescriptionNegative','tryonDescriptionModel'])globalThis.AtelierApp.$(id).addEventListener('input',globalThis.AtelierApp.refreshStudioReadiness);
  syncDescriptionModels();updateTryonInputMode();
}
async function requestOutfitJson(url,body){
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể thay trang phục bằng mô tả');return result;
}
async function descriptionMask(target,type,automatic,protectedDetailMask,personIndex){
  if(!automatic)return {mask:globalThis.AtelierApp.binaryMaskDataUrl(false),protectedMask:protectedDetailMask};
  if(type.category){
    const result=await requestOutfitJson('/api/auto-mask',{sampleId:target.id,category:type.category,personIndex,protectedDetailMask,targetGarment:targetGarmentValues()});
    if(result.accepted===false)throw new Error('Vùng tự động chưa đủ tin cậy. Hãy kiểm tra và tô vùng thủ công.');
    if(result.targetCoverage?.warnings?.length)throw new Error(result.targetCoverage.warnings.join(' '));
    return result;
  }
  if(type.classes){
    const result=await requestOutfitJson('/api/detect-regions',{sampleId:target.id,model:'yolo-world',classes:type.classes,confidence:.25,padding:8});
    if(!result.count)throw new Error('Không tìm thấy phụ kiện; hãy tô vùng thủ công.');
    return {...result,protectedMask:protectedDetailMask};
  }
  throw new Error('Loại này cần tô vùng thủ công trên ảnh hiện tại.');
}
async function runDescriptionTryon(batch=false){
  if(descriptionTryonRunning||globalThis.AtelierApp.activeJobId||globalThis.AtelierApp.inpaintPromptReviewPending)return globalThis.AtelierApp.setMessage('Hãy hoàn tất tác vụ hiện tại.','error');
  if(!globalThis.AtelierApp.current||!globalThis.AtelierApp.sourceImage)return globalThis.AtelierApp.setMessage('Hãy chọn ảnh người mẫu trước.','error');
  const prompt=globalThis.AtelierApp.$('tryonDescription').value.trim(),type=selectedOutfitType(),model=globalThis.AtelierApp.$('tryonDescriptionModel');
  if(!prompt)return globalThis.AtelierApp.setMessage('Hãy nhập mô tả trang phục hoặc phụ kiện mới.','error');
  if(!model.value||model.disabled)return globalThis.AtelierApp.setMessage('Hãy chọn model Inpainting sẵn sàng.','error');
  if(batch&&!type.category&&!type.classes)return globalThis.AtelierApp.setMessage('Loại này cần tô vùng riêng và chạy từng ảnh.','error');
  const automatic=batch||globalThis.AtelierApp.$('autoMaskToggle').checked;
  if(!automatic&&globalThis.AtelierApp.editableMaskStats().selected<globalThis.AtelierApp.editableMaskStats().minimum){globalThis.AtelierApp.showMaskGuide(globalThis.AtelierApp.editableMaskStats());return;}
  const scope=globalThis.AtelierApp.$('batchScope').value;
  const targets=(batch?(scope==='group'?globalThis.AtelierApp.images.filter(item=>item.group===globalThis.AtelierApp.current.group):scope==='selected'?globalThis.AtelierApp.images:[globalThis.AtelierApp.current]):[globalThis.AtelierApp.current]).slice(0,12);
  const base={modelId:model.value,processingMode:window.ATELIER_PROMPTS.tasks['outfit-description'].processingMode,removalTarget:'custom',fillMode:window.ATELIER_PROMPTS.tasks['outfit-description'].fillMode,forbiddenReplacement:'',prompt,negativePrompt:descriptionModelValues().supportsNegative?globalThis.AtelierApp.$('tryonDescriptionNegative').value.trim():'',seed:globalThis.AtelierApp.seedForRun('tryonSeed'),count:Number(globalThis.AtelierApp.$('tryonCount').value),...descriptionRunSettings(),expand:8,blur:5,useModelProfile:true,semanticCheck:false,autoRetry:false};
  const sourceId=globalThis.AtelierApp.current.id,protectedMask=globalThis.AtelierApp.binaryMaskDataUrl(false,true),personIndex=Number(globalThis.AtelierApp.$('personSelect').value);
  descriptionTryonRunning=true;globalThis.AtelierApp.inpaintPromptReviewPending=true;
  const outputs=[],errors=[];
  try{
    const preview=await requestOutfitJson('/api/inpaint-prompts',base);
    const confirmedPrompts=await globalThis.AtelierApp.reviewGenerationPrompts(preview,base);if(!confirmedPrompts)return;
    globalThis.AtelierApp.inpaintPromptReviewPending=false;
    if(globalThis.AtelierApp.current?.id!==sourceId||globalThis.AtelierApp.studioMode!=='tryon')throw new Error('Ảnh hoặc tác vụ đã thay đổi. Hãy tạo lại với ảnh đang chọn.');
    for(const [index,target] of targets.entries()){
      const jobId=globalThis.AtelierApp.createJobId('tryon-description');globalThis.AtelierApp.setActiveJob(jobId);let success=false,error='';
      try{
        globalThis.AtelierApp.setMessage(`Đang thay bằng mô tả · ảnh ${index+1}/${targets.length}…`);
        const masks=await descriptionMask(target,type,automatic,target.id===sourceId?protectedMask:'',personIndex);
        const result=await requestOutfitJson('/api/inpaint',{...base,jobId,sampleId:target.id,seed:base.seed+index*100,editableMask:masks.mask,protectedDetailMask:masks.protectedMask||'',confirmedPrompts});
        success=true;outputs.push({target,result});
      }catch(failure){error=failure.message;errors.push(`${target.id}: ${error}`);if(/hủy|cancel/i.test(error)||!batch)throw failure;}
      finally{await globalThis.AtelierApp.settleJob(jobId,success?'completed':'failed',error);}
    }
  }catch(error){if(!errors.length)errors.push(error.message);}
  finally{
    descriptionTryonRunning=false;globalThis.AtelierApp.inpaintPromptReviewPending=false;
    if(outputs.length){
      const original=document.createElement('article');original.className='result-card';
      const source=document.createElement('img');source.src=outputs[0].target.url;source.alt='Ảnh gốc';original.appendChild(source);
      const cards=[original];
      for(const {target,result} of outputs)for(const item of result.results){
        const card=document.createElement('article');card.className='result-card';card.dataset.sourceUrl=target.url;const image=document.createElement('img');image.src=item.image;image.alt='Trang phục từ mô tả';
        const caption=document.createElement('p');caption.textContent=`${target.id} · seed ${item.seed}`;
        const button=document.createElement('button');button.textContent='Chọn làm kết quả chính';button.dataset.seed=String(item.seed);button.dataset.directory=result.directory;button.dataset.sampleId=target.id;button.onclick=()=>globalThis.AtelierApp.selectPrimary(item.seed,button);
        card.append(image,caption,button);cards.push(card);
      }
      globalThis.AtelierApp.$('resultsGrid').replaceChildren(...cards);const first=outputs[0];globalThis.AtelierApp.currentRunDirectory=first.result.directory;
      globalThis.AtelierApp.presentStudioResults(first.target.url,first.result.results[0]?.image||'');
    }
    if(errors.length)globalThis.AtelierApp.setMessage(`Đã tạo ${outputs.length}/${targets.length} ảnh. ${errors.join(' · ')}`,'error');
    else if(outputs.length)globalThis.AtelierApp.setMessage(`Đã thay trang phục bằng mô tả cho ${outputs.length} ảnh. Hãy xem và chọn phương án phù hợp.`,'success');
  }
}
