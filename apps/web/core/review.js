'use strict';
// Owned state: reviewState, auditItems, guidedReviewItems, guidedReviewIndex, reviewKey, currentReview, REVIEW_CATEGORY_LABELS
// Dependencies: $, activateAppView, createJobId, detectPeopleInImage, escapeHtml, garmentDataUrl, images, loadImage, readableRequestError, resumeActiveJob, setActiveJob, setMessage, setTool
module.exports=function createReview(deps){
let reviewState, auditItems, guidedReviewItems, guidedReviewIndex, reviewKey, currentReview, REVIEW_CATEGORY_LABELS;
async function calibrateQuality() {
  const response = await fetch('/api/calibrate-quality', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể hiệu chỉnh');
  if(result.qualityVersion!==2||!result.calibrationReady){
    deps.setMessage(`Chưa áp dụng ngưỡng mới: cần ít nhất 10 kết quả đã được chấp nhận với bộ chấm điểm hiện tại (đang có ${result.qualityVersion===2?result.approvedCount:0}).`,'warning');
    return;
  }
  const value = result.recommendation;
  deps.$('minimumQuality').value = value.minimumQuality;
  deps.$('minimumSimilarity').value = value.minimumSimilarity;
  deps.$('minimumSeam').value = value.minimumSeam;
  deps.$('minimumAnatomy').value = value.minimumAnatomy;
  deps.setMessage(`Đã phân tích ${result.sampleCount} kết quả (${result.approvedCount} chấp nhận) · ${result.report}`, 'success');
}

async function buildGoldenBaseline() {
  const response=await fetch('/api/golden-baseline',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tạo bộ chuẩn');
  deps.setMessage(`Đã tạo bộ chuẩn gồm ${result.caseCount} ảnh · ${result.baseline}`, 'success');
}

async function compareBaseline() {
  const response=await fetch('/api/compare-baseline',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể so sánh baseline');
  deps.$('resultsGrid').innerHTML=result.cases.map((item)=>`<article class="result-card"><p>${item.sampleId}<br><span class="review-badge">${item.status}</span><br>${item.warnings.join('<br>')||'Không phát hiện suy giảm'}</p></article>`).join('');
  deps.$('comparePanel').hidden=true;deps.$('resultsDialog').showModal();
  deps.setMessage(`Hồi quy: ${result.passed}/${result.total} đạt · ${result.regressed} suy giảm · báo cáo /reports/regression-report.html`,result.regressed?'error':'success');
}

async function showJobs() {
  const response=await fetch('/api/jobs');const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc hàng đợi');
  deps.$('resultsGrid').innerHTML=result.jobs.map((job)=>`<article class="result-card"><p><strong>${job.jobId}</strong><br><span class="review-badge">${job.status}</span> · ${job.stage||'—'}<br>${job.current&&job.total?`${job.current}/${job.total}`:job.completedSeeds&&job.totalSeeds?`${job.completedSeeds}/${job.totalSeeds} seed`:''}<br>${job.updatedAt||''}</p>${job.status==='interrupted'&&job.resumable?`<button data-resume-job="${job.jobId}">Tiếp tục</button>`:''}</article>`).join('')||'<p>Chưa có tác vụ.</p>';
  for(const button of deps.$('resultsGrid').querySelectorAll('[data-resume-job]'))button.addEventListener('click',()=>{deps.setActiveJob(button.dataset.resumeJob);deps.resumeActiveJob().catch((error)=>deps.setMessage(error.message,'error'));});
  deps.$('comparePanel').hidden=true;deps.$('resultsDialog').showModal();
}

async function cleanupOldJobs() {
  const retentionDays=Number(deps.$('jobRetentionDays').value);
  const previewResponse=await fetch('/api/cleanup-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({retentionDays})});
  const preview=await previewResponse.json();if(!previewResponse.ok||!preview.ok)throw new Error(preview.error||'Không thể xem trước');
  if(!preview.fileCount)return deps.setMessage('Không có checkpoint cũ cần dọn.','success');
  if(!confirm(`Xóa ${preview.fileCount} tệp của ${preview.jobCount} job đã hoàn tất/hủy? Ảnh và báo cáo được giữ lại.`))return;
  const response=await fetch('/api/cleanup-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({retentionDays,confirm:true})});
  const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể dọn checkpoint');
  deps.setMessage(`Đã dọn ${result.fileCount} tệp checkpoint; ảnh và báo cáo được giữ lại.`,'success');
}

async function runBenchmark() {
  const readiness=await loadReferenceReadiness();
  const category=deps.$('garmentCategory').value;
  const reference=readiness.items.find((item)=>item.category===category);
  if(!reference?.ready){
    deps.setMessage(`Ảnh tham chiếu ${category} chưa sẵn sàng. Hãy lưu và kiểm định ảnh tham chiếu trước.`, 'error');
    deps.activateAppView('create');
    deps.$('garmentFile').scrollIntoView({behavior:'smooth',block:'center'});
    return;
  }
  const jobId=deps.createJobId('benchmark');deps.setActiveJob(jobId);deps.$('benchmarkButton').disabled=true;
  try{const response=await fetch('/api/benchmark',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId,garmentImage:deps.garmentDataUrl,category:deps.$('garmentCategory').value,refineRegion:deps.$('refineRegion').value})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Benchmark thất bại');deps.setMessage(`Benchmark hoàn tất ${result.completed}/${result.requested} ảnh · ${result.report}`,'success');}
  catch(error){deps.setMessage(error.message,'error');}finally{deps.$('benchmarkButton').disabled=false;deps.setActiveJob('');}
}

async function buildDashboard() {
  const response=await fetch('/api/quality-dashboard',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tạo dashboard');
  const profile=result.recommendations[deps.$('garmentCategory').value];
  if(profile){deps.$('tryonCount').value=String(profile.count);deps.$('tryonSteps').value=profile.steps;deps.$('tryonGuidance').value=profile.guidance;}
  deps.setMessage(`Dashboard: ${result.itemCount} ảnh · đã áp dụng cấu hình đề xuất cho loại trang phục hiện tại · /reports/quality-dashboard.html`,'success');
}

async function checkSystem() {
  const response=await fetch('/api/system-check');const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra hệ thống');
  deps.setMessage(`${result.modelsReady?'✓ Model đầy đủ':'⚠ Thiếu model'} · ${result.gpu} · VRAM ${result.gpuMemoryMb} MB · trống ${result.diskFreeGb} GB`,result.modelsReady?'success':'error');
}

async function backupData() {
  const response=await fetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể sao lưu');
  deps.setMessage(`Đã sao lưu cấu hình, mask, trạng thái job và dữ liệu duyệt · ${result.backup}`,'success');
}

async function loadBackups() {
  const response=await fetch('/api/backups');const result=await response.json();if(!response.ok||!result.ok)return;
  deps.$('backupSelect').innerHTML='<option value="">Chọn bản sao lưu</option>'+result.backups.map((item)=>`<option value="${item.name}">${item.name}</option>`).join('');
}

async function restoreSelectedBackup() {
  const name=deps.$('backupSelect').value;if(!name)return deps.setMessage('Hãy chọn bản sao lưu.','error');
  if(!confirm(`Khôi phục ${name}? Hệ thống sẽ tạo một bản an toàn trước khi ghi đè dữ liệu cấu hình hiện tại.`))return;
  const response=await fetch('/api/restore-backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,confirm:true})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể khôi phục');
  await loadReviewState();deps.setMessage(`Đã khôi phục ${result.restored} · bản an toàn: ${result.safetyBackup}`,'success');
}

async function saveBenchmarkReview(category,sampleId,status,selected,card) {
  const select=card.querySelector('[data-benchmark-labels]');const defectLabels=[...select.selectedOptions].map((option)=>option.value);
  const response=await fetch('/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category,sampleId,status,selected,defectLabels})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể lưu duyệt');
  reviewState=result.state;card.querySelector('.review-badge').textContent=status;
}

function renderGuidedReview() {
  const item=guidedReviewItems[guidedReviewIndex];if(!item)return;
  const labels=item.review.defectLabels||[];const options=[['seam','Lỗi biên'],['color','Sai màu'],['texture','Sai hoa văn'],['anatomy','Sai hình thể'],['collar','Cổ áo'],['sleeves','Tay áo'],['waist','Vùng eo'],['hem','Gấu / chiều dài'],['layers','Sai lớp áo'],['old-clothing','Sót trang phục cũ']];
  const reviewed=guidedReviewItems.filter((entry)=>['approved','retry','rejected'].includes(entry.review.status)).length;
  deps.$('reviewProgress').hidden=false;deps.$('reviewProgress').textContent=`Ảnh ${guidedReviewIndex+1}/${guidedReviewItems.length} · đã duyệt ${reviewed}/${guidedReviewItems.length} · phím A: chấp nhận, R: chạy lại, X: loại bỏ, ←/→: chuyển ảnh`;
  deps.$('resultsGrid').innerHTML=`<article class="guided-review-shell" data-benchmark-card="${item.sampleId}"><nav class="review-session-list" aria-label="Danh sách cần duyệt">${guidedReviewItems.map((entry,index)=>`<button data-guided-index="${index}" class="${index===guidedReviewIndex?'active':''}"><span>${index+1}</span><strong>${deps.escapeHtml(entry.sampleId)}</strong><small>${deps.escapeHtml(entry.review.status||'pending')}</small></button>`).join('')}</nav><section class="review-stage"><div class="benchmark-pair"><figure><img src="${item.sourceUrl}" alt="Ảnh gốc"><figcaption>Trước</figcaption></figure><figure><img src="${item.resultUrl}" alt="Kết quả"><figcaption>Sau</figcaption></figure></div><div class="guided-nav"><button id="previousReviewButton" ${guidedReviewIndex===0?'disabled':''}>← Ảnh trước</button><button id="nextReviewButton" ${guidedReviewIndex===guidedReviewItems.length-1?'disabled':''}>Ảnh sau →</button></div></section><aside class="review-decision"><div><span class="card-kicker">QUYẾT ĐỊNH</span><h3>${deps.escapeHtml(item.sampleId)}</h3><p><span class="review-badge">${item.review.status||'pending'}</span> · tổng ${Number(item.qualityScore).toFixed(1)}<br>Biên ${Number(item.seamScore).toFixed(1)} · bảo toàn ${Number(item.anatomyScore).toFixed(1)}<br>Gợi ý xem kỹ: <strong>${item.suggestedRegion}</strong></p><label class="defect-labels">Nhãn lỗi<select multiple data-benchmark-labels>${options.map(([value,label])=>`<option value="${value}" ${labels.includes(value)?'selected':''}>${label}</option>`).join('')}</select></label></div><div class="review-actions"><button data-benchmark-status="approved">Chấp nhận <kbd>A</kbd></button><button data-benchmark-status="retry">Chạy lại <kbd>R</kbd></button><button data-benchmark-status="rejected">Loại bỏ <kbd>X</kbd></button><button data-benchmark-status="pending">Để sau</button></div></aside></article>`;
  const card=deps.$('resultsGrid').querySelector('[data-benchmark-card]');for(const button of card.querySelectorAll('[data-benchmark-status]'))button.addEventListener('click',async()=>{try{await saveBenchmarkReview(item.category,item.sampleId,button.dataset.benchmarkStatus,item.selected,card);item.review={...(reviewState.items[reviewKey(item.category,item.sampleId)]||{}),status:button.dataset.benchmarkStatus};if(button.dataset.benchmarkStatus!=='pending'&&guidedReviewIndex<guidedReviewItems.length-1)guidedReviewIndex++;renderGuidedReview();}catch(error){deps.setMessage(error.message,'error');}});
  window.StudioGuidance?.attachRepairHint(card.querySelector('[data-benchmark-labels]'));
  deps.$('previousReviewButton').addEventListener('click',()=>{guidedReviewIndex--;renderGuidedReview();});deps.$('nextReviewButton').addEventListener('click',()=>{guidedReviewIndex++;renderGuidedReview();});
  for(const button of card.querySelectorAll('[data-guided-index]'))button.addEventListener('click',()=>{guidedReviewIndex=Number(button.dataset.guidedIndex);renderGuidedReview();});
}

async function reviewBenchmark() {
  const category=deps.$('garmentCategory').value;const response=await fetch(`/api/benchmark-review?category=${encodeURIComponent(category)}`);const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tải benchmark');
  guidedReviewItems=result.items;guidedReviewIndex=Math.max(0,result.items.findIndex((item)=>!['approved','retry','rejected'].includes(item.review.status)));renderGuidedReview();
  deps.$('comparePanel').hidden=true;deps.$('resultsDialog').classList.add('guided-review-dialog');deps.$('resultsDialog').showModal();deps.setMessage(`Đã mở phiên duyệt tuần tự ${result.total} ảnh.`,'success');
}

async function showReviewReadiness() {
  const response=await fetch('/api/review-readiness');const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra tiến độ');
  const rows=Object.entries(result.perCategory||{}).map(([category,value])=>`${category}: ${value.approved}/${value.total} chấp nhận · ${value.pending} chờ`).join('<br>');deps.$('reviewProgress').hidden=true;deps.$('resultsGrid').innerHTML=`<article class="result-card"><p><strong>Tiến độ duyệt ${result.total} trường hợp</strong><br>${rows}<br>Tổng đã duyệt: ${result.reviewed}/${result.total}<br>Chấp nhận: ${result.approved} · chạy lại: ${result.retry} · loại bỏ: ${result.rejected}<br>Có nhãn lỗi: ${result.labeled}<br>Dữ liệu v1 được bảo toàn: ${result.legacyCount||0}<br>Tham chiếu: áo ${result.references.upper_body?'✓':'✗'} · quần/váy ${result.references.lower_body?'✓':'✗'} · toàn thân ${result.references.overall?'✓':'✗'}<br>Trọng số hoạt động: ${result.activeWeights?'✓':'✗'}</p>${result.blockers.length?`<p>${result.blockers.map((item)=>`• ${item}`).join('<br>')}</p>`:'<p>✓ Sẵn sàng nghiệm thu nội dung.</p>'}</article>`;deps.$('comparePanel').hidden=true;deps.$('resultsDialog').showModal();deps.setMessage(result.ready?'Quy trình duyệt đã sẵn sàng nghiệm thu.':`Còn ${result.blockers.length} điều kiện cần hoàn tất.`,result.ready?'success':'error');
}

async function runTargetedRetryQueue() {
  if(!deps.garmentDataUrl)throw new Error('Hãy chọn ảnh trang phục tham chiếu trước khi chạy lại.');
  const category=deps.$('garmentCategory').value;const planResponse=await fetch('/api/retry-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category})});const plan=await planResponse.json();if(!planResponse.ok||!plan.ok)throw new Error(plan.error||'Không thể lập hàng đợi chạy lại');if(!plan.count)return deps.setMessage('Không có ảnh nào được đánh dấu chạy lại.','success');
  deps.$('runRetryQueueButton').disabled=true;let completed=0;
  try{for(const item of plan.items){deps.setMessage(`Đang chạy lại ${completed+1}/${plan.count}: ${item.sampleId} · ${item.strategy}`);const jobId=deps.createJobId('review-retry');deps.setActiveJob(jobId);const response=await fetch('/api/batch-tryon',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId,garmentImage:deps.garmentDataUrl,category,sampleIds:[item.sampleId],onlyConfident:false,onlyQualityPassed:false,cropPerson:true,twoStage:true,...item.settings})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||`Chạy lại thất bại: ${item.sampleId}`);const output=result.items?.[0];if(!output)throw new Error(`Không có kết quả mới cho ${item.sampleId}`);const save=await fetch('/api/retry-comparison',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sampleId:item.sampleId,oldSelected:item.oldSelected,newSelected:output.selected,strategy:item.strategy,defectLabels:item.defectLabels,metrics:{qualityScore:output.qualityScore,referenceSimilarity:output.referenceSimilarity,seamScore:output.seamScore,anatomyScore:output.anatomyScore,textureContinuity:output.textureContinuity}})});const saved=await save.json();if(!save.ok||!saved.ok)throw new Error(saved.error||'Không thể lưu so sánh');completed++;}}
  finally{deps.$('runRetryQueueButton').disabled=false;deps.setActiveJob('');}deps.setMessage(`Đã tạo ${completed} kết quả chạy lại; chưa thay thế kết quả cũ. Hãy mở màn hình so sánh.`,'success');
}

async function showRetryComparisons() {
  const response=await fetch('/api/retry-comparisons');const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tải so sánh');deps.$('reviewProgress').hidden=true;
  deps.$('resultsGrid').innerHTML=result.items.map((item)=>`<article class="result-card" data-retry-comparison="${item.sampleId}"><div class="benchmark-pair">${item.oldUrl?`<img src="${item.oldUrl}" alt="Kết quả cũ">`:'<div>Không có kết quả cũ</div>'}<img src="${item.newUrl}" alt="Kết quả mới"></div><p><strong>${item.sampleId}</strong><br>${item.strategy} · ${(item.defectLabels||[]).join(', ')||'không có nhãn'}<br>Điểm mới: ${Number(item.metrics?.qualityScore||0).toFixed(1)} · biên ${Number(item.metrics?.seamScore||0).toFixed(1)} · bảo toàn ${Number(item.metrics?.anatomyScore||0).toFixed(1)}</p><div class="review-actions"><button data-promote-retry>Chọn kết quả mới và chờ duyệt</button><button data-keep-retry>Giữ kết quả cũ</button></div></article>`).join('')||'<p>Chưa có kết quả chạy lại.</p>';
  for(const button of deps.$('resultsGrid').querySelectorAll('[data-promote-retry]'))button.addEventListener('click',async()=>{const card=button.closest('[data-retry-comparison]');const item=result.items.find((entry)=>entry.sampleId===card.dataset.retryComparison);await setReviewStatus(item.sampleId,'pending',item.newSelected,item.defectLabels,deps.$('garmentCategory').value);card.querySelector('.review-badge')?.remove();button.disabled=true;deps.setMessage(`Đã chọn kết quả mới cho ${item.sampleId}; trạng thái chuyển về chờ duyệt.`,'success');});
  for(const button of deps.$('resultsGrid').querySelectorAll('[data-keep-retry]'))button.addEventListener('click',()=>{button.closest('[data-retry-comparison]').remove();deps.setMessage('Đã giữ kết quả cũ; quyết định retry không thay đổi.','success');});
  deps.$('comparePanel').hidden=true;deps.$('resultsDialog').showModal();
}

async function calibrateWeights() {
  const response=await fetch('/api/calibrate-weights',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể hiệu chỉnh trọng số');
  deps.setMessage(`Đã hiệu chỉnh từ ${result.reviewedCount} ảnh · trọng số lưu tại ${result.report}`,'success');
}

async function compareWeights() {
  const response=await fetch('/api/compare-weights',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể so sánh trọng số');
  deps.setMessage(`A/B ${result.count} ảnh · chênh lệch điểm trung bình ${Number(result.averageDelta).toFixed(3)} · ${result.report}`,'success');
}

async function activateWeights() {
  const response=await fetch('/api/activate-weights',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kích hoạt trọng số');
  deps.setMessage(`Đã kích hoạt trọng số với cải thiện ${Number(result.utilityImprovement).toFixed(3)} trên ${result.evidenceCount} ảnh duyệt · ${result.report}`,'success');
}

async function confirmDefaultWeights() {
  if(!confirm('Chỉ dùng trọng số mặc định khi đủ 69 trường hợp được chấp nhận và không có nhãn lỗi. Tiếp tục?'))return;
  const response=await fetch('/api/confirm-default-weights',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể xác nhận trọng số mặc định');deps.setMessage(`Đã ghi nhận không cần hiệu chỉnh · ${result.report}`,'success');
}

async function saveReferenceProfile(productReview) {
  if(!deps.garmentDataUrl)throw new Error('Hãy chọn ảnh trang phục tham chiếu trước.');
  const category=deps.$('garmentCategory').value;const response=await fetch('/api/reference-profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category,image:deps.garmentDataUrl,productReview})});const result=await response.json();
  if(!response.ok||!result.ok){
    const validation=result.validation;
    if(!productReview&&response.status===422&&validation?.reasons?.length===1&&validation.reasons[0]==='Phát hiện người hoặc pose trong ảnh sản phẩm'&&confirm('Bộ nhận diện thấy dáng người trong ảnh. Nếu đây là trang phục đặt phẳng, hãy kiểm tra ảnh: ảnh chỉ có sản phẩm, không có người hoặc ma-nơ-canh? Xác nhận này được lưu cùng checksum ảnh; kết quả vẫn cần smoke qualification.'))return saveReferenceProfile({noPerson:true,sha256:validation.metrics.sha256,reviewer:'Người dùng xác nhận trong ứng dụng'});
    throw new Error(result.error||'Không thể lưu ảnh tham chiếu');
  }
  const metrics=result.validation.metrics;await loadReferenceReadiness();deps.setMessage(`Reference đạt kiểm định và đã lưu cho ${category} · coverage ${Number(metrics.foregroundCoverage).toFixed(3)} · nét ${Number(metrics.sharpness).toFixed(1)} · SHA-256 ${metrics.sha256.slice(0,12)}…`,'success');
}

function referenceSetupSummary(item) {
  const label={upper_body:'Áo',lower_body:'Quần / váy',overall:'Toàn bộ trang phục'}[item.category]||item.category;
  if(item.ready)return {label,status:'✓ Đã kiểm định',next:'Sẵn sàng chạy bộ đánh giá 23 ảnh.'};
  if(!item.reference)return {label,status:item.experimentalReference?'Có ảnh thử nghiệm chưa đạt':'Chưa thiết lập ảnh tham chiếu',next:'Chọn loại trang phục và ảnh sản phẩm tương ứng, rồi bấm “Lưu ảnh tham chiếu cho loại hiện tại”.'};
  if(!item.checksumMatches)return {label,status:'Cần kiểm định lại ảnh',next:'Chọn lại ảnh sản phẩm và lưu ảnh tham chiếu để cập nhật kiểm định.'};
  if(item.status==='failed-smoke')return {label,status:'Ảnh đã lưu · Thử đồ chưa đạt chất lượng',next:'Xem báo cáo smoke qualification, kiểm tra màu, chi tiết vải và đường biên trước khi chạy lại.'};
  return {label,status:'Đã lưu ảnh · Chưa hoàn tất kiểm định',next:'Bấm “Chạy smoke qualification cho loại hiện tại” để kiểm tra trên 3 ảnh người mẫu.'};
}

async function loadReferenceReadiness(){
  const response=await fetch('/api/reference-readiness');const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra reference');
  const container=deps.$('referenceReadiness');container.replaceChildren();
  const intro=document.createElement('p');intro.textContent='Thiết lập bộ ảnh tham chiếu dùng cho đánh giá hàng loạt. Bạn vẫn có thể thay trang phục bằng ảnh vừa chọn trong Studio.';container.appendChild(intro);
  for(const item of result.items){
    const summary=referenceSetupSummary(item),card=document.createElement('article');card.className='model-item';
    const title=document.createElement('strong');title.textContent=summary.label;card.appendChild(title);
    for(const text of [summary.status,item.reference||(item.experimentalReference?`Ảnh thử nghiệm: ${item.experimentalReference}`:''),item.reason,summary.next].filter(Boolean)){
      const line=document.createElement('p');line.textContent=text;card.appendChild(line);
    }
    if(item.reference&&item.blockers.length){const detail=document.createElement('details'),heading=document.createElement('summary'),body=document.createElement('p');heading.textContent='Chi tiết kiểm định';body.textContent=item.blockers.join(' · ');detail.append(heading,body);card.appendChild(detail);}
    container.appendChild(card);
  }
  const current=result.items.find(item=>item.category===deps.$('garmentCategory').value);
  deps.$('benchmarkButton').dataset.ready=String(Boolean(current?.ready));
  deps.$('benchmarkButton').title=current?.ready?'Chạy bộ benchmark 23 ảnh':'Cần lưu và kiểm định ảnh tham chiếu trước';
  return result;
}

async function qualifyReference(){const category=deps.$('garmentCategory').value;deps.setMessage(`Đang smoke qualification ${category}…`);const response=await fetch('/api/qualify-reference',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category,seed:52001,steps:20,maxSide:512})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Qualification thất bại');await loadReferenceReadiness();deps.setMessage(`Qualification ${category}: ${result.passed?'đạt':'không đạt'} ${result.passedCount}/${result.requiredCount} · ${result.report}`,result.passed?'success':'error');}

async function checkAcceptance() {
  const response=await fetch('/api/release-acceptance',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra nghiệm thu');
  deps.$('resultsGrid').innerHTML=result.checks.map((item)=>`<article class="result-card"><p><strong>${item.category}</strong><br><span class="review-badge">${item.passed?'technical-pass':'failed'}</span><br>${item.reasons.join('<br>')||'Đạt tiêu chí kỹ thuật'}</p></article>`).join('');deps.$('comparePanel').hidden=true;deps.$('resultsDialog').showModal();
  deps.setMessage(`Nghiệm thu: ${result.status} · ${result.approvedCount}/23 ảnh được người dùng chấp nhận · ${result.report}`,result.status==='passed'?'success':'error');
}

async function loadReviewState() {
  const response = await fetch('/api/review');
  const result = await response.json();
  if (response.ok && result.ok) reviewState = result.state;
}

async function setReviewStatus(sampleId, status, selected = '', defectLabels = undefined, category = deps.$('garmentCategory').value) {
  const response = await fetch('/api/review', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({category,sampleId,status,selected,defectLabels}),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể lưu trạng thái duyệt');
  reviewState = result.state;
  renderAuditQueue();
}

function renderAuditQueue() {
  const filter = deps.$('reviewFilter').value;
  const visible = auditItems.filter((item)=>filter==='all'||(currentReview(item.sampleId).status||'pending')===filter);
  deps.$('resultsGrid').innerHTML = visible.map((item)=>{
    const status=currentReview(item.sampleId).status||'pending';
    const labels=currentReview(item.sampleId).defectLabels||[];
    return `<article class="result-card"><img src="/samples/${item.sampleId}" alt="${item.sampleId}"><p>${item.sampleId}<br><span class="review-badge">${status}</span> · ${item.orientation} · ${item.people.length} người · SAM ${Number(item.maskScore).toFixed(3)}<br>${item.needsManualReview?'⚠ '+item.reasons.join(', '):'✓ Đạt kiểm tra tự động'}</p><button data-review-id="${item.sampleId}">Mở để duyệt</button><label class="defect-labels">Nhãn lỗi<select multiple data-defects="${item.sampleId}"><option value="seam" ${labels.includes('seam')?'selected':''}>Lỗi biên</option><option value="texture" ${labels.includes('texture')?'selected':''}>Sai hoa văn</option><option value="anatomy" ${labels.includes('anatomy')?'selected':''}>Sai hình thể</option></select></label><div class="review-actions"><button data-status="approved" data-id="${item.sampleId}">Chấp nhận</button><button data-status="retry" data-id="${item.sampleId}">Chạy lại</button><button data-status="rejected" data-id="${item.sampleId}">Loại bỏ</button><button data-status="pending" data-id="${item.sampleId}">Chờ duyệt</button></div></article>`;
  }).join('');
  for (const button of deps.$('resultsGrid').querySelectorAll('[data-status]')) button.addEventListener('click',()=>{const select=document.querySelector(`[data-defects="${button.dataset.id}"]`);const labels=select?[...select.selectedOptions].map((option)=>option.value):[];setReviewStatus(button.dataset.id,button.dataset.status,undefined,labels).catch((error)=>deps.setMessage(error.message,'error'));});
  for (const button of deps.$('resultsGrid').querySelectorAll('[data-review-id]')) button.addEventListener('click', async()=>{
    const index=deps.images.findIndex((item)=>item.id===button.dataset.reviewId);
    if(index>=0){deps.$('imageSelect').value=String(index); await deps.loadImage(deps.images[index]); deps.$('resultsDialog').close(); await deps.detectPeopleInImage(); deps.setTool('person');}
  });
}

async function runRegressionAudit() {
  deps.$('auditButton').disabled = true;
  deps.setMessage('Đang kiểm tra phát hiện người và mask trên toàn bộ 23 ảnh…');
  try {
    const response = await fetch('/api/regression-audit', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({category:deps.$('garmentCategory').value,usePose:deps.$('usePoseToggle').checked}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể chạy kiểm tra hồi quy');
    auditItems = result.items;
    const category=deps.$('garmentCategory').value;const pending = auditItems.filter((item)=>!reviewState.items[reviewKey(category,item.sampleId)]).map((item)=>({category,sampleId:item.sampleId,status:'pending'}));
    if (pending.length) {
      const saved=await fetch('/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:pending})});
      const payload=await saved.json(); if(saved.ok&&payload.ok) reviewState=payload.state;
    }
    renderAuditQueue();
    deps.$('comparePanel').hidden = true;
    deps.$('resultsDialog').showModal();
    deps.setMessage(`Hồi quy: ${result.passed}/${result.total} đạt · ${result.manualReview} cần xem lại · ${result.report}`, result.manualReview ? 'error' : 'success');
  } catch (error) { deps.setMessage(error.message, 'error'); }
  finally { deps.$('auditButton').disabled = false; }
}

async function exportApproved() {
  try {
    const approvedCount=Object.values(reviewState.items||{}).filter((item)=>item.status==='approved').length;if(!window.confirm(`Xuất gói bàn giao gồm ${approvedCount} kết quả đã chấp nhận?\n\nCác mục chờ duyệt, chạy lại hoặc loại bỏ sẽ không được đưa vào gói.`))return;
    const response=await fetch('/api/export-approved',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const result=await response.json();
    if(!response.ok||!result.ok) throw new Error(result.error||'Không thể xuất manifest');
    deps.setMessage(`Đã xuất ${result.approvedCount} mục đã duyệt · ${result.manifest}`,'success');
  } catch(error){deps.setMessage(error.message,'error');}
}

function qualityMetric(label,value,percent){const safe=Number(value||0),display=label==='Tương đồng tham chiếu'?safe.toFixed(3):safe.toFixed(1);return `<article><div><span>${label}</span><strong>${display}</strong></div><div class="quality-track"><i style="width:${Math.max(0,Math.min(100,percent))}%"></i></div></article>`;}

async function runQualityAction(action,button){
  const feedback=document.querySelector('.quality-feedback');button.disabled=true;const original=button.textContent;button.textContent='Đang thực hiện…';if(feedback)feedback.textContent='Đang xử lý trên dữ liệu cục bộ…';
  try{
    if(action==='dashboard')await buildDashboard();else if(action==='benchmark')await runBenchmark();else if(action==='baseline')await compareBaseline();else if(action==='calibrate')await calibrateQuality();else if(action==='acceptance')await checkAcceptance();else if(action==='review')await showReviewReadiness();
    if(feedback)feedback.textContent='Đã hoàn tất. Dữ liệu chất lượng vừa được cập nhật.';
    if(['dashboard','benchmark','baseline','calibrate','acceptance'].includes(action))await loadQualityOverview();
  }catch(error){if(feedback)feedback.textContent=error.message;deps.setMessage(error.message,'error');}
  finally{button.disabled=false;button.textContent=original;}
}

async function loadQualityOverview(){
  const root=deps.$('qualityOverview');if(!root)return;root.setAttribute('aria-busy','true');
  try{
    const response=await fetch('/api/quality-overview'),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đọc dữ liệu chất lượng');
    const metrics=result.dashboard?.metrics||{},review=result.review,regression=result.regression,latest=result.latestBenchmark,acceptance=result.acceptance;
    root.innerHTML=`<section class="quality-summary"><div><span class="system-pulse ${latest?'':'warn'}"></span><div><strong>${latest?'Đã có dữ liệu đo lường':'Chưa có benchmark'}</strong><small>${latest?`Lần gần nhất ${new Date(latest.createdAt).toLocaleString('vi-VN')} · ${latest.count} ảnh`:'Chạy bộ kiểm tra để tạo dữ liệu đầu tiên'}</small></div></div><button data-quality-refresh>Làm mới</button></section>
      <section class="quality-kpis"><article><span>ĐIỂM TỔNG</span><strong>${Number(metrics.qualityScore||0).toFixed(1)}</strong><small>benchmark mới nhất</small></article><article><span>ĐÃ DUYỆT</span><strong>${review.reviewed}/${review.total}</strong><small>${review.approved} chấp nhận · ${review.retry} chạy lại</small></article><article><span>HỒI QUY</span><strong>${regression?`${regression.passed}/${regression.total}`:'—'}</strong><small>${regression?`${regression.regressed} suy giảm · ${regression.missing} thiếu`:'chưa so sánh baseline'}</small></article><article><span>PHÁT HÀNH</span><strong>${acceptance?.status==='passed'?'Đạt':acceptance?'Chưa đạt':'—'}</strong><small>${acceptance?`${acceptance.approvedCount||0}/23 ảnh chấp nhận`:'chưa kiểm tra nghiệm thu'}</small></article></section>
      <section class="quality-layout"><div class="quality-main"><div class="section-heading"><div><span class="card-kicker">CHỈ SỐ</span><h2>Chất lượng kết quả gần nhất</h2></div><button data-quality-action="dashboard">Phân tích lại</button></div><div class="quality-metrics">${qualityMetric('Chất lượng',metrics.qualityScore,metrics.qualityScore)}${qualityMetric('Tương đồng tham chiếu',metrics.referenceSimilarity,Number(metrics.referenceSimilarity||0)*100)}${qualityMetric('Đường biên',metrics.seamScore,metrics.seamScore)}${qualityMetric('Hình thể',metrics.anatomyScore,metrics.anatomyScore)}${qualityMetric('Liên tục chất liệu',metrics.textureContinuity,metrics.textureContinuity)}</div><div class="quality-category"><span>${result.benchmarkCount} lượt benchmark</span>${result.categories.map((item)=>`<span>${deps.escapeHtml(item.category)} · ${item.count} ảnh</span>`).join('')}</div></div>
      <aside class="quality-actions"><article><span class="card-kicker">BENCHMARK</span><h3>Đo trên bộ ảnh chuẩn</h3><p>Chạy cấu hình cố định và cập nhật toàn bộ chỉ số.</p><button data-quality-action="benchmark">Chạy bộ kiểm tra 23 ảnh</button></article><article><span class="card-kicker">HỒI QUY</span><h3>So sánh với baseline</h3><p>Baseline ${result.baseline?.caseCount||0} trường hợp · ${regression?.regressed||0} suy giảm.</p><button data-quality-action="baseline">So sánh ngay</button></article><article><span class="card-kicker">DUYỆT & NGHIỆM THU</span><h3>${review.reviewed} kết quả đã duyệt</h3><div class="quality-action-row"><button data-quality-action="review">Xem tiến độ</button><button data-quality-action="acceptance">Kiểm tra phát hành</button></div></article><article><span class="card-kicker">HIỆU CHỈNH</span><h3>Tối ưu ngưỡng chất lượng</h3><button data-quality-action="calibrate">Tạo đề xuất</button></article></aside></section><p class="quality-feedback" role="status">Dữ liệu được đọc và lưu hoàn toàn trên máy.</p>`;
    root.querySelector('[data-quality-refresh]')?.addEventListener('click',loadQualityOverview);for(const button of root.querySelectorAll('[data-quality-action]'))button.addEventListener('click',()=>runQualityAction(button.dataset.qualityAction,button));
  }catch(error){root.innerHTML=`<section class="quality-summary"><div><span class="system-pulse warn"></span><div><strong>Không thể tải dữ liệu chất lượng</strong><small>${deps.escapeHtml(deps.readableRequestError(error))}</small></div></div><button data-quality-refresh>Thử lại</button></section>`;root.querySelector('[data-quality-refresh]')?.addEventListener('click',loadQualityOverview);}
  finally{root.removeAttribute('aria-busy');}
}

async function runReviewAction(action,button,category=''){
  button.disabled=true;const original=button.textContent;button.textContent='Đang mở…';
  try{
    if(category&&deps.$('garmentCategory'))deps.$('garmentCategory').value=category;
    if(action==='session')await reviewBenchmark();else if(action==='readiness')await showReviewReadiness();else if(action==='retry')await runTargetedRetryQueue();else if(action==='compare')await showRetryComparisons();else if(action==='export')await exportApproved();
    await loadReviewOverview();
  }catch(error){deps.setMessage(error.message,'error');}
  finally{button.disabled=false;button.textContent=original;}
}

async function loadReviewOverview(){
  const root=deps.$('reviewOverview');if(!root)return;root.setAttribute('aria-busy','true');
  try{
    const [readinessResponse,comparisonsResponse]=await Promise.all([fetch('/api/review-readiness'),fetch('/api/retry-comparisons')]);const readiness=await readinessResponse.json(),comparisons=await comparisonsResponse.json();if(!readinessResponse.ok||!readiness.ok)throw new Error(readiness.error||'Không thể đọc hàng duyệt');
    const percent=readiness.total?Math.round(readiness.reviewed/readiness.total*100):0,nextCategory=readiness.next?.category||'upper_body';
    root.innerHTML=`<section class="review-summary"><div class="review-ring" style="--review-progress:${percent*3.6}deg"><span>${percent}%</span></div><div class="review-summary-copy"><strong>${readiness.ready?'Sẵn sàng nghiệm thu':'Cần tiếp tục duyệt'}</strong><small>${readiness.reviewed}/${readiness.total} trường hợp đã quyết định · ${readiness.pending} đang chờ</small></div><button data-review-action="session" data-review-category="${deps.escapeHtml(nextCategory)}">Duyệt trường hợp tiếp theo</button></section>
      <section class="review-kpis"><article><span>CHẤP NHẬN</span><strong>${readiness.approved}</strong><small>sẵn sàng bàn giao</small></article><article><span>CHẠY LẠI</span><strong>${readiness.retry}</strong><small>cần tạo phương án mới</small></article><article><span>LOẠI BỎ</span><strong>${readiness.rejected}</strong><small>không sử dụng</small></article><article><span>ĐANG CHỜ</span><strong>${readiness.pending}</strong><small>cần con người quyết định</small></article></section>
      <section class="review-layout"><div class="review-main"><div class="section-heading"><div><span class="card-kicker">PHIÊN DUYỆT</span><h2>Tiến độ theo loại trang phục</h2></div><button data-review-action="readiness">Xem đầy đủ</button></div><div class="review-categories">${Object.entries(readiness.perCategory||{}).map(([category,value])=>{const categoryPercent=value.total?Math.round(value.reviewed/value.total*100):0;return `<article><div class="review-category-head"><div><strong>${deps.escapeHtml(REVIEW_CATEGORY_LABELS[category]||category)}</strong><small>${value.reviewed}/${value.total} đã duyệt · ${value.pending} chờ</small></div><span>${categoryPercent}%</span></div><div class="review-progress-track"><i style="width:${categoryPercent}%"></i></div><button data-review-action="session" data-review-category="${deps.escapeHtml(category)}">${value.pending?'Tiếp tục duyệt':'Xem lại kết quả'}</button></article>`;}).join('')}</div><div class="review-next"><span class="card-kicker">TIẾP THEO</span><strong>${readiness.next?deps.escapeHtml(readiness.next.sampleId):'Không còn trường hợp chờ duyệt'}</strong><small>${readiness.next?deps.escapeHtml(REVIEW_CATEGORY_LABELS[readiness.next.category]||readiness.next.category):'Hàng duyệt đã hoàn thành'}</small></div></div>
      <aside class="review-side"><article><span class="card-kicker">ĐIỀU KIỆN CÒN THIẾU</span><h3>${readiness.blockers.length} mục cần xử lý</h3><ul>${readiness.blockers.slice(0,5).map((item)=>`<li>${deps.escapeHtml(item)}</li>`).join('')||'<li class="passed">Đã đáp ứng toàn bộ điều kiện.</li>'}</ul></article><article><span class="card-kicker">CHỈNH SỬA</span><h3>${readiness.retry} ảnh được đánh dấu chạy lại</h3><button data-review-action="retry" ${readiness.retry?'':'disabled'}>Chạy lại ảnh có vấn đề</button></article><article><span class="card-kicker">SO SÁNH</span><h3>${comparisons.items?.length||0} kết quả cũ và mới</h3><button data-review-action="compare" ${(comparisons.items?.length||0)?'':'disabled'}>Mở màn hình so sánh</button></article><article><span class="card-kicker">BÀN GIAO</span><h3>${readiness.approved} kết quả được chấp nhận</h3><button data-review-action="export" ${readiness.approved?'':'disabled'}>Xuất kết quả đã duyệt</button></article></aside></section>`;
    const benchmark=document.createElement("details");benchmark.className="workflow-card";benchmark.innerHTML="<summary>Kiểm chuẩn thử trang phục · nâng cao</summary>";while(root.firstChild)benchmark.append(root.firstChild);root.append(benchmark);
    window.CreativeReview?.mount(root).catch(error=>deps.setMessage(error.message,'error'));
    window.AcceptanceUI?.mount(root).catch(error=>deps.setMessage(error.message,'error'));
    for(const button of root.querySelectorAll('[data-review-action]'))button.addEventListener('click',()=>runReviewAction(button.dataset.reviewAction,button,button.dataset.reviewCategory||''));
  }catch(error){root.innerHTML=`<section class="review-summary error"><div class="review-summary-copy"><strong>Không thể tải hàng duyệt</strong><small>${deps.escapeHtml(deps.readableRequestError(error))}</small></div><button data-review-refresh>Thử lại</button></section>`;root.querySelector('[data-review-refresh]')?.addEventListener('click',loadReviewOverview);}
  finally{root.removeAttribute('aria-busy');}
}
return {bindings:{get reviewState(){return reviewState;},set reviewState(value){reviewState=value;},
get auditItems(){return auditItems;},set auditItems(value){auditItems=value;},
get guidedReviewItems(){return guidedReviewItems;},set guidedReviewItems(value){guidedReviewItems=value;},
get guidedReviewIndex(){return guidedReviewIndex;},set guidedReviewIndex(value){guidedReviewIndex=value;},
get reviewKey(){return reviewKey;},set reviewKey(value){reviewKey=value;},
get currentReview(){return currentReview;},set currentReview(value){currentReview=value;},
get calibrateQuality(){return calibrateQuality;},set calibrateQuality(value){calibrateQuality=value;},
get buildGoldenBaseline(){return buildGoldenBaseline;},set buildGoldenBaseline(value){buildGoldenBaseline=value;},
get compareBaseline(){return compareBaseline;},set compareBaseline(value){compareBaseline=value;},
get showJobs(){return showJobs;},set showJobs(value){showJobs=value;},
get cleanupOldJobs(){return cleanupOldJobs;},set cleanupOldJobs(value){cleanupOldJobs=value;},
get runBenchmark(){return runBenchmark;},set runBenchmark(value){runBenchmark=value;},
get buildDashboard(){return buildDashboard;},set buildDashboard(value){buildDashboard=value;},
get checkSystem(){return checkSystem;},set checkSystem(value){checkSystem=value;},
get backupData(){return backupData;},set backupData(value){backupData=value;},
get loadBackups(){return loadBackups;},set loadBackups(value){loadBackups=value;},
get restoreSelectedBackup(){return restoreSelectedBackup;},set restoreSelectedBackup(value){restoreSelectedBackup=value;},
get saveBenchmarkReview(){return saveBenchmarkReview;},set saveBenchmarkReview(value){saveBenchmarkReview=value;},
get renderGuidedReview(){return renderGuidedReview;},set renderGuidedReview(value){renderGuidedReview=value;},
get reviewBenchmark(){return reviewBenchmark;},set reviewBenchmark(value){reviewBenchmark=value;},
get showReviewReadiness(){return showReviewReadiness;},set showReviewReadiness(value){showReviewReadiness=value;},
get runTargetedRetryQueue(){return runTargetedRetryQueue;},set runTargetedRetryQueue(value){runTargetedRetryQueue=value;},
get showRetryComparisons(){return showRetryComparisons;},set showRetryComparisons(value){showRetryComparisons=value;},
get calibrateWeights(){return calibrateWeights;},set calibrateWeights(value){calibrateWeights=value;},
get compareWeights(){return compareWeights;},set compareWeights(value){compareWeights=value;},
get activateWeights(){return activateWeights;},set activateWeights(value){activateWeights=value;},
get confirmDefaultWeights(){return confirmDefaultWeights;},set confirmDefaultWeights(value){confirmDefaultWeights=value;},
get saveReferenceProfile(){return saveReferenceProfile;},set saveReferenceProfile(value){saveReferenceProfile=value;},
get referenceSetupSummary(){return referenceSetupSummary;},set referenceSetupSummary(value){referenceSetupSummary=value;},
get loadReferenceReadiness(){return loadReferenceReadiness;},set loadReferenceReadiness(value){loadReferenceReadiness=value;},
get qualifyReference(){return qualifyReference;},set qualifyReference(value){qualifyReference=value;},
get checkAcceptance(){return checkAcceptance;},set checkAcceptance(value){checkAcceptance=value;},
get loadReviewState(){return loadReviewState;},set loadReviewState(value){loadReviewState=value;},
get setReviewStatus(){return setReviewStatus;},set setReviewStatus(value){setReviewStatus=value;},
get renderAuditQueue(){return renderAuditQueue;},set renderAuditQueue(value){renderAuditQueue=value;},
get runRegressionAudit(){return runRegressionAudit;},set runRegressionAudit(value){runRegressionAudit=value;},
get exportApproved(){return exportApproved;},set exportApproved(value){exportApproved=value;},
get qualityMetric(){return qualityMetric;},set qualityMetric(value){qualityMetric=value;},
get runQualityAction(){return runQualityAction;},set runQualityAction(value){runQualityAction=value;},
get loadQualityOverview(){return loadQualityOverview;},set loadQualityOverview(value){loadQualityOverview=value;},
get REVIEW_CATEGORY_LABELS(){return REVIEW_CATEGORY_LABELS;},set REVIEW_CATEGORY_LABELS(value){REVIEW_CATEGORY_LABELS=value;},
get runReviewAction(){return runReviewAction;},set runReviewAction(value){runReviewAction=value;},
get loadReviewOverview(){return loadReviewOverview;},set loadReviewOverview(value){loadReviewOverview=value;}},steps:[
function initialize(){
(reviewState = {items:{}});
},
function initialize(){
(auditItems = []);
},
function initialize(){
(guidedReviewItems = []);
},
function initialize(){
(guidedReviewIndex = 0);
},
function initialize(){
(reviewKey = (category,sampleId)=>`${category}:${sampleId}`);
},
function initialize(){
(currentReview = (sampleId,category=deps.$('garmentCategory').value)=>reviewState.items[reviewKey(category,sampleId)]||{});
},
function initialize(){
(REVIEW_CATEGORY_LABELS = {upper_body:'Áo / thân trên',lower_body:'Quần, váy / thân dưới',overall:'Toàn thân'});
}
]};
};
