'use strict';
// Owned state: garmentDataUrl, detectedPeople
// Dependencies: $, activeJobId, binaryMaskDataUrl, createJobId, current, currentRunDirectory, images, inpaintPromptReviewPending, presentStudioResults, seedForRun, selectPrimary, setActiveJob, setMessage, setReviewStatus, settleJob, showCompare, sourceImage
module.exports=function createOutfit(deps){
let garmentDataUrl, detectedPeople;
function tryonQualityFeedback(result) {
  if (result.qualityGate.passed) return {text:'Đã tạo ảnh · Đạt kiểm tra tự động. Hãy đối chiếu cổ, tay, gấu, lớp áo và họa tiết với ảnh mẫu trước khi chấp nhận.', kind:'success'};
  const selected=result.results.find(item=>item.seed===result.selectedSeed);
  const checks=[
    ['qualityScore','minimumQuality','Chất lượng tổng',1,''],
    ['referenceSimilarity','minimumSimilarity','Độ giống trang phục',100,'%'],
    ['seamScore','minimumSeam','Độ liền mạch của biên',1,''],
    ['anatomyScore','minimumAnatomy','Bảo toàn người và nền',1,''],
  ];
  const reasons=checks.filter(([metric,minimum])=>selected && Number(selected[metric])<Number(result.qualityGate[minimum]))
    .map(([metric,minimum,label,scale,unit])=>`${label} ${(selected[metric]*scale).toFixed(1)}${unit}, yêu cầu ${(result.qualityGate[minimum]*scale).toFixed(1)}${unit}`);
  if(result.bodyAudit?.required&&!result.bodyAudit.passed)reasons.push('Vùng tay chưa đạt kiểm tra, có thể còn tay áo ngoài mẫu tham chiếu');
  const details={'color-material':'Màu hoặc chất liệu chưa khớp mẫu','geometry':'Hình học trang phục cần xem lại','pose':'Tư thế thay đổi hoặc chưa đủ rõ để kiểm tra','target-mask':'Vùng theo kiểu dáng còn thiếu điểm tư thế tin cậy'};
  for(const reason of result.qualityGate.reasons||[])if(details[reason])reasons.push(details[reason]);
  return {text:`Đã tạo ảnh · Cần xem lại chất lượng${reasons.length?': '+reasons.join('; '):'.'} Bạn có thể xem và chọn phương án, hoặc chỉnh vùng thay trang phục rồi tạo lại.`, kind:'warning'};
}

async function runTryon() {
  if(descriptionTryonRunning||deps.inpaintPromptReviewPending||deps.activeJobId)return deps.setMessage('Hãy hoàn tất tác vụ hiện tại.', 'error');
  if(isDescriptionTryon())return runDescriptionTryon();
  if(!selectedOutfitType()?.category)return deps.setMessage('Loại này cần thay bằng mô tả.', 'error');
  if (!garmentDataUrl) return deps.setMessage('Hãy chọn ảnh trang phục tham chiếu.', 'error');
  if (!deps.current || !deps.sourceImage) return deps.setMessage('Hãy chọn ảnh người mẫu trước.', 'error');
  const modelId=deps.$('tryonModelSelect').value;
  if(!modelId||deps.$('tryonModelSelect').disabled)return deps.setMessage('Chưa có model thay trang phục sẵn sàng.', 'error');
  deps.setMessage(`Đang nạp ${modelId==='idm-vton'?'IDM-VTON':'CatVTON'} và tạo trang phục; lượt đầu có thể mất vài phút…`);
  const jobId=deps.createJobId('tryon'); deps.setActiveJob(jobId);let jobSucceeded=false,jobError='';
  try {
    const response = await fetch('/api/tryon', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        jobId, modelId, sampleId:deps.current.id, garmentImage:garmentDataUrl,
        targetGarment:targetGarmentValues(),referenceType:deps.$('referenceType')?.value||'auto',
        editableMask:deps.$('autoMaskToggle').checked ? '' : deps.binaryMaskDataUrl(false),
        protectedDetailMask:deps.binaryMaskDataUrl(false,true,true),
        autoMask:deps.$('autoMaskToggle').checked,
        reconstructExposedBody:deps.$('reconstructExposedBodyToggle').checked,
        bodyRepairMode:deps.$('bodyRepairMode').value,
        personIndex:Number(deps.$('personSelect').value),
        cropPerson:deps.$('cropPersonToggle').checked,
        usePose:deps.$('usePoseToggle').checked,
        preprocessGarment:true,
        twoStage:deps.$('twoStageToggle').checked,
        minimumQuality:Number(deps.$('minimumQuality').value),
        minimumSimilarity:Number(deps.$('minimumSimilarity').value),
        minimumSeam:Number(deps.$('minimumSeam').value), minimumAnatomy:Number(deps.$('minimumAnatomy').value),
        maxRetries:Number(deps.$('maxRetries').value), repairSeams:deps.$('repairSeamsToggle').checked,
        generativeRefine:deps.$('generativeRefineToggle').checked,
        refineRegion:deps.$('refineRegion').value,
        category:deps.$('garmentCategory').value,
        garmentDescription:modelId==='idm-vton' ? deps.$('garmentDescription').value.trim() : '',
        seed:deps.seedForRun('tryonSeed'), count:Number(deps.$('tryonCount').value),
        steps:Number(deps.$('tryonSteps').value), guidance:Number(deps.$('tryonGuidance').value),
        expand:8, blur:5, maxSide:1024,
      }),
    });
    const result=await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể thay trang phục');
    jobSucceeded=true;deps.currentRunDirectory=result.directory;
    if (result.qualityGate.passed) await deps.setReviewStatus(deps.current.id, 'pending', result.selected);
    const sourceCard=`<article class="result-card"><img src="${deps.current.url}" alt="Ảnh gốc"><p>Ảnh gốc</p></article>`;
    deps.$('resultsGrid').innerHTML=sourceCard+result.results.map((item)=>`<article class="result-card"><img src="${item.image}" alt="Trang phục phương án ${item.seed}"><p>Seed ${item.seed} · ${result.width} × ${result.height}<br>Tổng ${Number(item.qualityScore).toFixed(1)} · tương đồng mẫu ${(item.referenceSimilarity*100).toFixed(1)}%<br>Biên ${Number(item.seamScore).toFixed(1)} · bảo toàn ${Number(item.preservationScore??item.anatomyScore).toFixed(1)}<br>Màu/chất liệu: ${item.colorMaterial?.accepted?'đạt':'cần xem lại'} · hình học: ${item.geometry?.accepted?'đạt':'cần xem lại'}<br>${item.qualityGate?.passed?'Đạt kiểm tra tự động · cần duyệt mẫu':'Cần xem lại chất lượng'}<br>${item.seamRepair?.accepted?'✓ Đã sửa biên cục bộ':'Giữ nguyên biên'}</p><button data-seed="${item.seed}">${item.seed===result.selectedSeed?'✓ Đang chọn':'Chọn làm kết quả chính'}</button></article>`).join('');
    for (const button of deps.$('resultsGrid').querySelectorAll('[data-seed]')) button.addEventListener('click',()=>deps.selectPrimary(Number(button.dataset.seed),button));
    const selected=result.results.find((item)=>item.seed===result.selectedSeed)||result.results[0];
    deps.presentStudioResults(deps.current.url,selected?.image||'');
    if(selected) deps.showCompare(deps.current.url,selected.image);
    const feedback=tryonQualityFeedback(result);
    if(result.bodyRepair?.attempted&&!result.bodyRepair.applied){feedback.text+=' Lượt sửa tay chưa đạt kiểm tra; đã giữ ảnh trước bước sửa tay.';feedback.kind='warning';}
    deps.setMessage(feedback.text,feedback.kind);
  } catch(error) { jobError=error.message;deps.setMessage(error.message,'error'); }
  finally { await deps.settleJob(jobId,jobSucceeded?'completed':'failed',jobError); }
}

function outputUrl(relativePath) {
  const normalized=String(relativePath||'').replace(/\\/g,'/').replace(/^\/+/, '').replace(/^workspace\//, '');
  return '/' + normalized;
}

async function runBatchTryon() {
  if(descriptionTryonRunning||deps.inpaintPromptReviewPending||deps.activeJobId)return deps.setMessage('Hãy hoàn tất tác vụ hiện tại.', 'error');
  if(isDescriptionTryon())return runDescriptionTryon(true);
  if (!garmentDataUrl) return deps.setMessage('Hãy chọn ảnh trang phục tham chiếu.', 'error');
  if (!deps.current || !deps.sourceImage) return deps.setMessage('Hãy chọn ảnh người mẫu trước khi chạy hàng loạt.', 'error');
  const modelId=deps.$('tryonModelSelect').value;
  if(!modelId||deps.$('tryonModelSelect').disabled)return deps.setMessage('Chưa có model thay trang phục sẵn sàng.', 'error');
  const scope = deps.$('batchScope').value;
  let targets = [deps.current];
  if (scope === 'group') targets = deps.images.filter((item) => item.group === deps.current.group);
  if (scope === 'selected') targets = deps.images.slice(0, 12);
  targets = targets.slice(0, 12);
  deps.$('batchTryonButton').disabled = true;
  const jobId=deps.createJobId('batch'); deps.setActiveJob(jobId);
  deps.setMessage(`Đang chạy hàng loạt ${targets.length} ảnh; mỗi ảnh sẽ tự tạo mask và chọn seed tốt nhất…`);
  try {
    const response = await fetch('/api/batch-tryon', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        jobId, modelId, sampleIds:targets.map((item)=>item.id), garmentImage:garmentDataUrl,
        targetGarment:targetGarmentValues(),referenceType:deps.$('referenceType')?.value||'auto',
        category:deps.$('garmentCategory').value, seed:deps.seedForRun('tryonSeed'),
        garmentDescription:modelId==='idm-vton' ? deps.$('garmentDescription').value.trim() : '',
        count:Number(deps.$('tryonCount').value), steps:Number(deps.$('tryonSteps').value),
        guidance:Number(deps.$('tryonGuidance').value), expand:8, blur:5, maxSide:1024,
        personIndex:Number(deps.$('personSelect').value), cropPerson:deps.$('cropPersonToggle').checked,
        minimumConfidence:Number(deps.$('confidenceThreshold').value)/100,
        onlyConfident:deps.$('onlyConfidentToggle').checked,
        bodyRepairMode:deps.$('bodyRepairMode').value,
        reconstructExposedBody:deps.$('reconstructExposedBodyToggle').checked,
        usePose:deps.$('usePoseToggle').checked,
        twoStage:deps.$('twoStageToggle').checked,
        minimumQuality:Number(deps.$('minimumQuality').value), minimumSimilarity:Number(deps.$('minimumSimilarity').value),
        minimumSeam:Number(deps.$('minimumSeam').value), minimumAnatomy:Number(deps.$('minimumAnatomy').value),
        maxRetries:Number(deps.$('maxRetries').value), repairSeams:deps.$('repairSeamsToggle').checked,
        generativeRefine:deps.$('generativeRefineToggle').checked,
        refineRegion:deps.$('refineRegion').value,
        onlyQualityPassed:deps.$('onlyQualityToggle').checked,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể chạy hàng loạt');
    for (const item of result.items) await deps.setReviewStatus(item.sampleId, 'pending', item.selected);
    deps.$('resultsGrid').innerHTML = result.items.map((item)=>`<article class="result-card"><img src="${outputUrl(item.selected)}" alt="${item.sampleId}"><p>${item.sampleId}<br>Seed ${item.selectedSeed} · điểm ${Number(item.qualityScore).toFixed(1)}/100 · giống mẫu ${(item.referenceSimilarity*100).toFixed(1)}%<br>SAM ${Number(item.autoMaskScore).toFixed(3)} · biên ${(item.edgeMAE*100).toFixed(2)}%</p></article>`).join('');
    deps.$('resultsDialog').showModal();
    deps.setMessage(`Hoàn tất ${result.completed}/${result.requested} ảnh · bỏ qua ${result.skipped||0} · báo cáo ${result.report}`, result.failed || result.skipped ? 'error' : 'success');
  } catch (error) { deps.setMessage(error.message, 'error'); }
  finally { deps.$('batchTryonButton').disabled = false; deps.setActiveJob(''); }
}
return {bindings:{get garmentDataUrl(){return garmentDataUrl;},set garmentDataUrl(value){garmentDataUrl=value;},
get detectedPeople(){return detectedPeople;},set detectedPeople(value){detectedPeople=value;},
get tryonQualityFeedback(){return tryonQualityFeedback;},set tryonQualityFeedback(value){tryonQualityFeedback=value;},
get runTryon(){return runTryon;},set runTryon(value){runTryon=value;},
get outputUrl(){return outputUrl;},set outputUrl(value){outputUrl=value;},
get runBatchTryon(){return runBatchTryon;},set runBatchTryon(value){runBatchTryon=value;}},steps:[
function initialize(){
(garmentDataUrl = '');
},
function initialize(){
(detectedPeople = []);
}
]};
};
