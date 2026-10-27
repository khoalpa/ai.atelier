'use strict';
// Owned state: progressVisibilityFrame
// Dependencies: $, STAGE_LABELS, activateAppView, activateWeights, activeJobId, activityState, aiPoints, analyzeModelUrl, analyzedModelUrl, applyDetectedRegions, applyPreset, applyTextToImagePreset, buildDashboard, buildGoldenBaseline, calibrateQuality, calibrateWeights, cancelActiveJob, checkAcceptance, checkSystem, cleanupOldJobs, closeGenerationProgress, compareBaseline, compareWeights, configureLora, confirmDefaultWeights, continueFromSelectedResult, createAutomaticMask, createMaskFromInpaintPreset, current, deselectCurrentImage, detectPeopleInImage, detectWithManagedModel, downloadAllModels, downloadAndRegisterModelUrl, downloadFullSizeImage, exportApproved, exportModelManifest, fitCanvas, garmentDataUrl, guidedReviewIndex, guidedReviewItems, highlightMaskTools, history, images, loadBackups, loadChromaStatus, loadImage, loadInpaintModelOptions, loadLoraStatus, loadModelCandidates, loadModelCapabilities, loadModels, loadReferenceReadiness, loadReviewState, loadRuntimeModelStatus, loadTextToImageLoras, manualProtectCanvas, manualProtectCtx, maskCanvas, maskCtx, pendingPromptAssist, pollJobStatus, preprocessGarment, protectCanvas, protectCtx, qualifyReference, refreshStudioReadiness, regionController, registerManagedModel, render, renderAuditQueue, renderGuidedReview, renderImageOptions, renderModelInventory, renderPromptAssistDiff, renderRegisteredModels, resetEditorSession, restoreModelSortPreferences, restoreSelectedBackup, resumeActiveJob, reviewBenchmark, runAdetailerRefine, runBatchTryon, runBenchmark, runChromaGenerate, runChromaSmoke, runInpaint, runLoraAbTest, runLoraMatrix, runLoraStrengthMatrix, runPromptAssist, runRegressionAudit, runTargetedRetryQueue, runTryon, save, saveReferenceProfile, segmentWithAi, setActiveJob, setMessage, setReviewStatus, setTool, setupExperience, setupSeedControl, setupStudioResultInstructions, showEmptyEditorState, showJobs, showRetryComparisons, showReviewReadiness, snapshot, sourceImage, startModelSelectorStartupScan, studioMode, studioSelectedResult, textQuality, updateDownloadAllModelsButton, updateProgressVisibility, updateTextToImagePipeline, uploadSourceImage
module.exports=function createBootstrap(deps){
let progressVisibilityFrame;
async function init() {
  try {
    await deps.loadReviewState();
    await deps.loadBackups();
    deps.loadLoraStatus().catch((error)=>{deps.$('loraStatus').textContent=error.message;});
    deps.loadChromaStatus().catch((error)=>{deps.$('chromaStatus').textContent=error.message;});
    deps.loadRuntimeModelStatus().catch((error)=>{deps.$('runtimeModelStatus').textContent=error.message;});
    deps.loadReferenceReadiness().catch((error)=>{deps.$('referenceReadiness').textContent=error.message;});
    const response = await fetch('/api/images');
    const data = await response.json();
    deps.images = data.images || [];
    if (!deps.images.length) throw new Error('Không tìm thấy ảnh trong thư mục samples');
    const selectedImageId=localStorage.getItem('selectedImageId');
    const selectedImage=deps.images.find((item)=>item.id===selectedImageId);
    deps.renderImageOptions(selectedImage?.id);
    if(selectedImage)await deps.loadImage(selectedImage);
    else deps.showEmptyEditorState();
    const persistedJob=localStorage.getItem('activeJobId');
    if(persistedJob){deps.setActiveJob(persistedJob);await deps.pollJobStatus();}
  } catch (error) {
    deps.setMessage(error.message, 'error');
    deps.$('loading').hidden = true;
  }
}
return {bindings:{get init(){return init;},set init(value){init=value;},
get progressVisibilityFrame(){return progressVisibilityFrame;},set progressVisibilityFrame(value){progressVisibilityFrame=value;}},steps:[
function initialize(){
deps.$('imageSelect').addEventListener('change', (event) => {if(event.target.value!=='')deps.loadImage(deps.images[Number(event.target.value)]);});
},
function initialize(){
deps.$('sourceImageFile').addEventListener('change',(event)=>{const file=event.target.files[0];deps.uploadSourceImage(file).catch((error)=>deps.setMessage(error.message,'error')).finally(()=>{event.target.value='';});});
},
function initialize(){
deps.$('resetEditorButton').addEventListener('click',()=>deps.resetEditorSession());
},
function initialize(){
deps.$('deselectImageButton').addEventListener('click',deps.deselectCurrentImage);
},
function initialize(){
deps.$('addTool').addEventListener('click', () => deps.setTool('add'));
},
function initialize(){
deps.$('eraseTool').addEventListener('click', () => deps.setTool('erase'));
},
function initialize(){
deps.$('protectTool').addEventListener('click', () => deps.setTool('protect'));
},
function initialize(){
deps.$('aiTool').addEventListener('click', () => deps.setTool('ai'));
},
function initialize(){
deps.$('personTool').addEventListener('click', () => deps.setTool('person'));
},
function initialize(){
deps.$('segmentButton').addEventListener('click', deps.segmentWithAi);
},
function initialize(){
deps.$('clearPointsButton').addEventListener('click', () => { deps.aiPoints = []; deps.render(); deps.setMessage('Đã xóa điểm AI.'); });
},
function initialize(){
deps.$('brushSize').addEventListener('input', (event) => { deps.$('brushValue').textContent = `${event.target.value} px`; });
},
function initialize(){
deps.$('overlayOpacity').addEventListener('input', (event) => { deps.$('opacityValue').textContent = `${event.target.value}%`; deps.render(); });
},
function initialize(){
deps.$('undoButton').addEventListener('click', () => { const state = deps.history.pop(); if (state) { deps.maskCtx.putImageData(state.editable, 0, 0); deps.protectCtx.putImageData(state.protected, 0, 0); deps.manualProtectCtx.clearRect(0,0,deps.manualProtectCanvas.width,deps.manualProtectCanvas.height);if(state.manualProtected)deps.manualProtectCtx.putImageData(state.manualProtected,0,0);deps.render(); deps.refreshStudioReadiness(); } });
},
function initialize(){
deps.$('clearButton').addEventListener('click', () => { deps.snapshot(); deps.maskCtx.clearRect(0, 0, deps.maskCanvas.width, deps.maskCanvas.height); deps.protectCtx.clearRect(0, 0, deps.protectCanvas.width, deps.protectCanvas.height); deps.manualProtectCtx.clearRect(0,0,deps.manualProtectCanvas.width,deps.manualProtectCanvas.height);deps.render(); deps.refreshStudioReadiness(); });
},
function initialize(){
deps.$('saveButton').addEventListener('click', deps.save);
},
function initialize(){
deps.$('suggestNotesButton').addEventListener('click',()=>deps.runPromptAssist({task:'notes',title:'Gợi ý ghi chú chỉnh sửa',targetId:'notes',buttonId:'suggestNotesButton',statusId:'notesAssistStatus',includeImage:true,includeMask:true,context:window.AtelierPromptCatalog.template("assistContext.region",{value:deps.$('labelSelect').selectedOptions[0].text})}));
},
function initialize(){
deps.$('suggestInpaintPromptButton').addEventListener('click',()=>deps.runPromptAssist({task:'inpaint',title:'Gợi ý mô tả yêu cầu xóa',targetId:'inpaintPrompt',buttonId:'suggestInpaintPromptButton',statusId:'inpaintPromptAssistStatus',includeImage:true,includeMask:true,context:window.AtelierPromptCatalog.template("assistContext.target",{value:deps.$('accessoryPreset').selectedOptions[0].text})}));
},
function initialize(){
deps.$('suggestChromaPromptButton').addEventListener('click',()=>deps.runPromptAssist({task:'imagePrompt',title:'Gợi ý mô tả ảnh',targetId:'chromaPrompt',buttonId:'suggestChromaPromptButton',statusId:'chromaPromptAssistStatus',context:window.AtelierPromptCatalog.template("assistContext.model",{value:deps.$('textToImageModel').selectedOptions[0]?.text||''})}));
},
function initialize(){
deps.$('optimizeChromaPromptButton').addEventListener('click',()=>deps.runPromptAssist({task:'optimizePrompt',title:'Tối ưu prompt hiện có',targetId:'chromaPrompt',buttonId:'optimizeChromaPromptButton',statusId:'chromaPromptAssistStatus',context:window.AtelierPromptCatalog.template("assistContext.negative",{value:deps.$('chromaNegativePrompt').value.trim()})}));
},
function initialize(){
deps.$('analyzeChromaPromptButton').addEventListener('click',()=>deps.runPromptAssist({task:'analyzePrompt',title:'Kiểm tra prompt và negative prompt',targetId:'chromaPrompt',buttonId:'analyzeChromaPromptButton',statusId:'chromaPromptAssistStatus',context:window.AtelierPromptCatalog.template("assistContext.negative",{value:deps.$('chromaNegativePrompt').value.trim()})}));
},
function initialize(){
deps.$('suggestNegativePromptButton').addEventListener('click',()=>deps.runPromptAssist({task:'negativePrompt',title:'Gợi ý negative prompt',targetId:'chromaNegativePrompt',buttonId:'suggestNegativePromptButton',statusId:'negativePromptAssistStatus',context:window.AtelierPromptCatalog.template("assistContext.image",{value:deps.$('chromaPrompt').value.trim()})}));
},
function initialize(){
deps.$('optimizeNegativePromptButton').addEventListener('click',()=>deps.runPromptAssist({task:'optimizeNegativePrompt',title:'Tối ưu negative prompt hiện có',targetId:'chromaNegativePrompt',buttonId:'optimizeNegativePromptButton',statusId:'negativePromptAssistStatus',context:window.AtelierPromptCatalog.template("assistContext.image",{value:deps.$('chromaPrompt').value.trim()})}));
},
function initialize(){
deps.$('closePromptAssistDialog').addEventListener('click',()=>{deps.$('promptAssistDialog').close();deps.pendingPromptAssist=null;});
},
function initialize(){
deps.$('promptAssistDraft').addEventListener('input',deps.renderPromptAssistDiff);
},
function initialize(){
deps.$('keepPromptAssistButton').addEventListener('click',()=>{deps.$('promptAssistDialog').close();deps.pendingPromptAssist=null;});
},
function initialize(){
deps.$('copyPromptAssistButton').addEventListener('click',async()=>{await navigator.clipboard.writeText(deps.$('promptAssistDraft').value);deps.$('copyPromptAssistButton').textContent='Đã sao chép';setTimeout(()=>deps.$('copyPromptAssistButton').textContent=deps.pendingPromptAssist?.analysisOnly?'Sao chép nội dung':'Sao chép bản nháp',1200);});
},
function initialize(){
deps.$('applyPromptAssistButton').addEventListener('click',()=>{if(!deps.pendingPromptAssist)return;const target=deps.$(deps.pendingPromptAssist.targetId),status=deps.$(deps.pendingPromptAssist.statusId);target.value=deps.$('promptAssistDraft').value.trim();target.dispatchEvent(new Event('input',{bubbles:true}));status.textContent='Đã áp dụng bản nháp AI. Bạn vẫn có thể chỉnh sửa thêm.';status.parentElement.classList.remove('is-error');status.parentElement.classList.add('is-success');deps.$('promptAssistDialog').close();deps.pendingPromptAssist=null;});
},
function initialize(){
deps.$('maskGuideCancel').addEventListener('click', () => deps.$('emptyMaskDialog').close());
},
function initialize(){
deps.$('maskGuideManual').addEventListener('click', () => {
  deps.$('emptyMaskDialog').close();
  deps.setTool('add');
  deps.$('addTool').scrollIntoView({ behavior: 'smooth', block: 'center' });
  deps.$('addTool').focus();
  deps.highlightMaskTools();
});
},
function initialize(){
deps.$('maskGuideAi').addEventListener('click', async () => {
  deps.$('emptyMaskDialog').close();
  deps.$('maskGuideAi').disabled = true;
  try { await deps.createMaskFromInpaintPreset(); }
  catch (error) { deps.setMessage(error.message, 'error'); }
  finally { deps.$('maskGuideAi').disabled = false; }
});
},
function initialize(){
deps.$('regionDetectButton').addEventListener('click',()=>deps.detectWithManagedModel(deps.$('regionDetector').value).catch(error=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('applyRegionButton').addEventListener('click',()=>deps.applyDetectedRegions().catch(error=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('cancelRegionButton').addEventListener('click',()=>deps.regionController?.abort());
},
function initialize(){
deps.$('adetailerMaskButton').addEventListener('click',()=>deps.detectWithManagedModel('adetailer').catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('adetailerRefineButton').addEventListener('click',()=>deps.runAdetailerRefine().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('loraWeight').addEventListener('input',(event)=>{deps.$('loraWeightValue').textContent=Number(event.target.value).toFixed(2);});
},
function initialize(){
deps.$('refreshLoraButton').addEventListener('click',async()=>{const button=deps.$('refreshLoraButton');button.disabled=true;deps.$('loraStatus').textContent='Đang cập nhật danh sách LoRA…';try{await Promise.all([deps.loadLoraStatus(),deps.loadTextToImageLoras()]);}catch(error){deps.$('loraStatus').textContent=error.message;deps.setMessage(error.message,'error');}finally{button.disabled=false;}});
},
function initialize(){
deps.$('applyLoraButton').addEventListener('click',()=>deps.configureLora(false).catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('clearLoraButton').addEventListener('click',()=>deps.configureLora(true).catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('loraAbButton').addEventListener('click',()=>deps.runLoraAbTest().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('loraMatrixButton').addEventListener('click',()=>deps.runLoraMatrix().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('loraStrengthButton').addEventListener('click',()=>deps.runLoraStrengthMatrix().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('refreshModelsButton').addEventListener('click',()=>Promise.all([deps.loadModels(),deps.loadModelCapabilities(),deps.loadInpaintModelOptions(),deps.loadModelCandidates()]).catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('downloadAllModelsButton').addEventListener('click',()=>deps.downloadAllModels().catch((error)=>{deps.setMessage(error.message,'error');deps.updateDownloadAllModelsButton();}));
},
function initialize(){
deps.$('modelInventorySearch').addEventListener('input',deps.renderModelInventory);
},
function initialize(){
deps.$('modelInventoryStatus').addEventListener('change',deps.renderModelInventory);
},
function initialize(){
deps.$('modelInventoryKind').addEventListener('change',deps.renderModelInventory);
},
function initialize(){
deps.$('modelInventoryArchitecture').addEventListener('change',deps.renderModelInventory);
},
function initialize(){
deps.$('modelInventoryCompatibility').addEventListener('change',deps.renderModelInventory);
},
function initialize(){
deps.$('modelInventorySort').addEventListener('change',()=>{localStorage.setItem('modelInventorySort',deps.$('modelInventorySort').value);deps.renderModelInventory();});
},
function initialize(){
deps.$('resetModelInventoryView').addEventListener('click',()=>{deps.$('modelInventorySearch').value='';deps.$('modelInventoryStatus').value='all';deps.$('modelInventoryKind').value='all';deps.$('modelInventoryArchitecture').value='all';deps.$('modelInventoryCompatibility').value='all';deps.$('modelInventorySort').value='status';localStorage.removeItem('modelInventorySort');deps.renderModelInventory();});
},
function initialize(){
deps.$('modelCapabilitySort').addEventListener('change',()=>{localStorage.setItem('modelCapabilitySort',deps.$('modelCapabilitySort').value);deps.loadModelCapabilities().catch((error)=>deps.setMessage(error.message,'error'));});
},
function initialize(){
deps.$('resetModelCapabilitySort').addEventListener('click',()=>{deps.$('modelCapabilitySort').value='workflow';localStorage.removeItem('modelCapabilitySort');deps.loadModelCapabilities().catch((error)=>deps.setMessage(error.message,'error'));});
},
function initialize(){
deps.$('registeredModelSort').addEventListener('change',()=>{localStorage.setItem('registeredModelSort',deps.$('registeredModelSort').value);deps.renderRegisteredModels();});
},
function initialize(){
deps.$('resetRegisteredModelView').addEventListener('click',()=>{deps.$('registeredModelSearch').value='';deps.$('registeredModelStatus').value='all';deps.$('registeredModelSort').value='active';localStorage.removeItem('registeredModelSort');deps.renderRegisteredModels();});
},
function initialize(){
deps.$('refreshChromaButton').addEventListener('click',()=>deps.loadChromaStatus().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('smokeChromaButton').addEventListener('click',()=>deps.runChromaSmoke().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('chromaGenerateButton').addEventListener('click',()=>deps.runChromaGenerate().catch((error)=>{deps.setMessage(error.message,'error');deps.$('chromaGalleryMeta').textContent=error.message;}));
},
function initialize(){
for(const button of document.querySelectorAll('[data-text-quality]'))button.addEventListener('click',()=>deps.applyTextToImagePreset(button.dataset.textQuality));
},
function initialize(){
deps.$('textToImageModel').addEventListener('change',()=>{localStorage.setItem('textToImageModelChoice',deps.$('textToImageModel').value);deps.applyTextToImagePreset(deps.textQuality);});
},
function initialize(){
for(const id of ['chromaSize','chromaQuality','chromaGuidance'])deps.$(id).addEventListener('change',()=>{for(const button of document.querySelectorAll('[data-text-quality]')){button.classList.remove('active');button.setAttribute('aria-pressed','false');}deps.textQuality='custom';deps.$('textToImagePresetHint').textContent=`Tùy chỉnh · ${deps.$('chromaSize').value} px · ${deps.$('chromaQuality').value} bước.`;window.NewImage?.sync();});
},
function initialize(){
deps.$('textToImagePipeline').addEventListener('change',deps.updateTextToImagePipeline);
},
function initialize(){
deps.$('textToImageLora').addEventListener('change',deps.updateTextToImagePipeline);
},
function initialize(){
deps.$('textToImageLoraWeight').addEventListener('input',(event)=>{deps.$('textToImageLoraWeightValue').textContent=Number(event.target.value).toFixed(2);});
},
function initialize(){
deps.$('exportModelsButton').addEventListener('click',()=>deps.exportModelManifest().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('registerModelButton').addEventListener('click',()=>deps.registerManagedModel().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('analyzeModelUrlButton').addEventListener('click',()=>deps.analyzeModelUrl().catch((error)=>{deps.$('modelUrlPreview').textContent=error.message;deps.setMessage(error.message,'error');}));
},
function initialize(){
deps.$('downloadRegisterModelButton').addEventListener('click',()=>deps.downloadAndRegisterModelUrl().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('modelUrl').addEventListener('input',()=>{deps.analyzedModelUrl=null;deps.$('downloadRegisterModelButton').disabled=true;deps.$('modelUrlPreview').hidden=true;});
},
function initialize(){
deps.$('closeResults').addEventListener('click', () => {deps.$('resultsDialog').classList.remove('guided-review-dialog');deps.$('resultsDialog').close();});
},
function initialize(){
deps.$('closeImageViewer').addEventListener('click',()=>deps.$('imageViewerDialog').close());
},
function initialize(){
deps.$('toggleViewerFitButton').addEventListener('click',()=>{
  const image=deps.$('imageViewerImage'),button=deps.$('toggleViewerFitButton');
  const fit=button.getAttribute('aria-pressed')!=='true';
  image.style.maxWidth=fit?'100%':'none';
  image.style.maxHeight=fit?'calc(100dvh - 32px)':'none';
  button.setAttribute('aria-pressed',String(fit));
  button.textContent=fit?'Xem 100%':'Xem toàn ảnh';
  deps.$('imageViewerMeta').textContent=`${image.naturalWidth} × ${image.naturalHeight} px · ${fit?'toàn ảnh':'hiển thị 100% · dùng thanh cuộn để xem chi tiết'}`;
});
},
function initialize(){
deps.$('saveFullSizeImageButton').addEventListener('click',()=>deps.downloadFullSizeImage(deps.sourceImage));
},
function initialize(){
deps.$('saveViewerImageButton').addEventListener('click',()=>deps.downloadFullSizeImage(deps.$('imageViewerImage')));
deps.$('sendViewerImageToStudioButton').addEventListener('click',()=>deps.sendViewerImageToStudio());
},
function initialize(){
deps.$('imageViewerImage').addEventListener('load',()=>{deps.$('saveViewerImageButton').disabled=false;deps.$('sendViewerImageToStudioButton').disabled=false;});
},
function initialize(){
deps.$('imageViewerImage').addEventListener('error',()=>{deps.$('saveViewerImageButton').disabled=true;deps.$('sendViewerImageToStudioButton').disabled=true;deps.$('imageViewerMeta').textContent='Không thể tải ảnh.';});
},
function initialize(){
deps.$('imageViewerImage').addEventListener('load',(event)=>{const image=event.currentTarget;deps.$('imageViewerMeta').textContent=`${image.naturalWidth} × ${image.naturalHeight} px · hiển thị 100% · dùng thanh cuộn để xem chi tiết`;});
},
function initialize(){
deps.$('imageViewerDialog').addEventListener('click',(event)=>{if(event.target===deps.$('imageViewerDialog'))deps.$('imageViewerDialog').close();});
},
function initialize(){
deps.$('accessoryPreset').addEventListener('change', (event) => {deps.applyPreset(event.target.value);deps.$('inpaintQualityPreset')?.dispatchEvent(new Event('change'));});
},
function initialize(){
deps.$('garmentFile').addEventListener('change', (event) => {
  const file=event.target.files[0];
  if (!file) return;
  if (file.size > 20*1024*1024) return deps.setMessage('Ảnh trang phục vượt quá 20 MB.','error');
  const reader=new FileReader();
  reader.onload=()=>{ deps.garmentDataUrl=reader.result; deps.$('garmentPreview').src=deps.garmentDataUrl; deps.$('garmentPreview').hidden=false; updateTryonInputMode(); };
  reader.readAsDataURL(file);
});
},
function initialize(){
deps.$('saveReferenceButton').addEventListener('click',()=>deps.saveReferenceProfile().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('refreshReferenceReadinessButton').addEventListener('click',()=>deps.loadReferenceReadiness().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('qualifyReferenceButton').addEventListener('click',()=>deps.qualifyReference().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('garmentCategory').addEventListener('change',()=>{if(selectedOutfitType()?.category)deps.loadReferenceReadiness().catch((error)=>deps.setMessage(error.message,'error'));});
},
function initialize(){
deps.$('autoMaskButton').addEventListener('click', async () => {
  const type=selectedOutfitType();
  if(type?.category)return deps.createAutomaticMask(type.category);
  if(type?.classes){deps.$('yoloClasses').value=type.classes.join(', ');try{await deps.detectWithManagedModel('yolo-world');}catch(error){deps.setMessage(error.message,'error');}return;}
  deps.setTool('add');deps.setMessage('Hãy tô vùng cần thay trên ảnh.');
});
},
function initialize(){
deps.$('preprocessGarmentButton').addEventListener('click', deps.preprocessGarment);
},
function initialize(){
deps.$('batchTryonButton').addEventListener('click', deps.runBatchTryon);
},
function initialize(){
deps.$('cancelJobButton').addEventListener('click',()=>deps.cancelActiveJob().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('activityCancel').addEventListener('click',()=>deps.cancelActiveJob().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('activityCollapse').addEventListener('click',()=>{
  const collapsed=deps.$('activityCenter').classList.toggle('is-collapsed'),button=deps.$('activityCollapse');
  button.setAttribute('aria-expanded',String(!collapsed));
  button.title=collapsed?'Mở thông báo tác vụ':'Thu gọn thông báo tác vụ';
  button.setAttribute('aria-label',button.title);
});
},
function initialize(){
deps.$('activityToggle').addEventListener('click',()=>{const drawer=deps.$('activityDrawer');drawer.hidden=!drawer.hidden;deps.$('activityToggle').textContent=drawer.hidden?'Chi tiết':'Thu gọn';deps.$('activityToggle').setAttribute('aria-expanded',String(!drawer.hidden));});
},
function initialize(){
deps.$('activityClose').addEventListener('click',deps.closeGenerationProgress);
},
function initialize(){
deps.$('activityReturn').addEventListener('click',()=>{if(!deps.activityState)return;deps.activateAppView(deps.activityState.taskType==='text-to-image'?'chroma':'create');const target=deps.activityState.taskType==='text-to-image'?deps.$('chromaLiveProgress'):deps.$('editorLiveProgress');target.scrollIntoView({behavior:'smooth',block:'center'});});
},
function initialize(){
(progressVisibilityFrame = 0);
},
function initialize(){
document.addEventListener('scroll',()=>{if(progressVisibilityFrame)return;progressVisibilityFrame=requestAnimationFrame(()=>{progressVisibilityFrame=0;deps.updateProgressVisibility();});},true);
},
function initialize(){
window.addEventListener('resize',deps.updateProgressVisibility);
},
function initialize(){
deps.$('resumeJobButton').addEventListener('click',()=>deps.resumeActiveJob().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('detectPeopleButton').addEventListener('click', deps.detectPeopleInImage);
},
function initialize(){
deps.$('auditButton').addEventListener('click', deps.runRegressionAudit);
},
function initialize(){
deps.$('reviewFilter').addEventListener('change', deps.renderAuditQueue);
},
function initialize(){
deps.$('exportApprovedButton').addEventListener('click', deps.exportApproved);
},
function initialize(){
deps.$('calibrateButton').addEventListener('click',()=>deps.calibrateQuality().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('goldenButton').addEventListener('click',()=>deps.buildGoldenBaseline().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('compareBaselineButton').addEventListener('click',()=>deps.compareBaseline().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('jobsButton').addEventListener('click',()=>deps.showJobs().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('cleanupJobsButton').addEventListener('click',()=>deps.cleanupOldJobs().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('benchmarkButton').addEventListener('click',()=>deps.runBenchmark().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('dashboardButton').addEventListener('click',()=>deps.buildDashboard().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('systemCheckButton').addEventListener('click',()=>deps.checkSystem().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('backupButton').addEventListener('click',()=>window.BackupUI.open());
},
function initialize(){
deps.$('reviewBenchmarkButton').addEventListener('click',()=>deps.reviewBenchmark().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('reviewReadinessButton').addEventListener('click',()=>deps.showReviewReadiness().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('runRetryQueueButton').addEventListener('click',()=>deps.runTargetedRetryQueue().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('retryComparisonsButton').addEventListener('click',()=>deps.showRetryComparisons().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('calibrateWeightsButton').addEventListener('click',()=>deps.calibrateWeights().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('compareWeightsButton').addEventListener('click',()=>deps.compareWeights().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('activateWeightsButton').addEventListener('click',()=>deps.activateWeights().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('confirmDefaultWeightsButton').addEventListener('click',()=>deps.confirmDefaultWeights().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('acceptanceButton').addEventListener('click',()=>deps.checkAcceptance().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('restoreBackupButton').addEventListener('click',()=>deps.restoreSelectedBackup().catch((error)=>deps.setMessage(error.message,'error')));
},
function initialize(){
deps.$('compareSlider').addEventListener('input',(event)=>{deps.$('compareAfterWrap').style.width=`${event.target.value}%`;});
},
function initialize(){
deps.$('studioCompareSlider').addEventListener('input',(event)=>{deps.$('studioCompareAfterWrap').style.clipPath=`inset(0 ${100-Number(event.target.value)}% 0 0)`;});
},
function initialize(){
deps.$('studioCloseResults').addEventListener('click',()=>{deps.$('studioResultsTray').hidden=true;deps.$('studioCompareStage').hidden=true;});
},
function initialize(){
deps.$('studioShowAllResults').addEventListener('click',()=>{if(!deps.$('resultsDialog').open)deps.$('resultsDialog').showModal();});
},
function initialize(){
deps.$('studioRetryResults').addEventListener('click',()=>{if(deps.activeJobId)return deps.setMessage('Một tác vụ đang chạy; hãy đợi hoàn tất hoặc hủy tác vụ hiện tại.','error');(deps.studioMode==='character'?()=>window.Character.run():deps.studioMode==='makeup'?()=>window.Makeup.run():deps.studioMode==='enhance'?()=>window.ImageEnhancement.run():deps.studioMode==='outpaint'?runOutpaint:deps.studioMode==='inpaint'?deps.runInpaint:deps.studioMode==='chroma'?deps.runChromaGenerate:deps.runTryon)();});
},
function initialize(){
deps.$('studioSendToReview').addEventListener('click',async()=>{if(!deps.current)return deps.setMessage('Không có ảnh hiện tại để gửi sang Duyệt.','error');try{await deps.setReviewStatus(deps.current.id,'pending',deps.studioSelectedResult||undefined);deps.activateAppView('review');deps.setMessage('Đã đưa kết quả vào hàng Duyệt.','success');}catch(error){deps.setMessage(error.message,'error');}});
},
function initialize(){
deps.$('studioContinueCharacter').addEventListener('click',()=>deps.continueFromSelectedResult('character'));
},
function initialize(){
deps.$('studioContinueInpaint').addEventListener('click',()=>deps.continueFromSelectedResult('inpaint'));
},
function initialize(){
deps.$('studioContinueTryon').addEventListener('click',()=>deps.continueFromSelectedResult('tryon'));
},
function initialize(){
deps.$('personSelect').addEventListener('change', deps.render);
},
function initialize(){
deps.$('confidenceThreshold').addEventListener('input',(event)=>{deps.$('confidenceValue').textContent=`${event.target.value}%`;});
},
function initialize(){
window.addEventListener('resize', deps.fitCanvas);
},
function initialize(){
window.addEventListener('keydown',(event)=>{if(!deps.$('resultsDialog').open||!deps.guidedReviewItems.length)return;if(event.key==='ArrowLeft'&&deps.guidedReviewIndex>0){deps.guidedReviewIndex--;deps.renderGuidedReview();}else if(event.key==='ArrowRight'&&deps.guidedReviewIndex<deps.guidedReviewItems.length-1){deps.guidedReviewIndex++;deps.renderGuidedReview();}else{const key=event.key.toLowerCase();const status=key==='a'?'approved':key==='r'?'retry':key==='x'?'rejected':null;if(status){const button=deps.$('resultsGrid').querySelector(`[data-benchmark-status="${status}"]`);if(button)button.click();}}});
},
function initialize(){
for(const id of ['inpaintSeed','tryonSeed','chromaSeed'])deps.setupSeedControl(id);
},
function initialize(){
deps.setupExperience();
},
function initialize(){
window.StudioGuidance?.init();
},
function initialize(){
window.StudioWorkspace?.setup();
},
function initialize(){
window.StudioWorkspace?.applyQualityDefaults();
},
function initialize(){
updateTryonInputMode();
},
function initialize(){
deps.setupStudioResultInstructions();
},
function initialize(){
deps.restoreModelSortPreferences();
},
function initialize(){
deps.startModelSelectorStartupScan();
},
function initialize(){
init();
},
function initialize(){
Object.assign(deps.STAGE_LABELS,{'makeup-detecting':'Nhận diện khuôn mặt','makeup-processing':'Trang điểm khuôn mặt','makeup-saving':'Kiểm tra vùng bảo vệ và lưu ảnh'});
},
function initialize(){
Object.assign(deps.STAGE_LABELS,{'makeup-comparing':'So sánh các phong cách trang điểm'});
},
function initialize(){
Object.assign(deps.STAGE_LABELS,{'character-validating':'Kiểm tra nhân vật và vùng tác động','character-loading':'Nạp bộ xử lý nhân vật','character-processing':'Tạo tư thế và biểu cảm','character-checking':'Đối chiếu tư thế đích','character-saving':'Lưu phương án'});
}
]};
};
