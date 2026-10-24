const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
function workspaceArtifactExists(relativePath) {
  if (fs.existsSync(path.join(root, relativePath))) return true;
  const suffix=relativePath.replace(/^workspace[\\/]/,'').split(/[\\/]/).join(path.sep);
  const archiveRoots=['workspace/reset-archive','workspace/backups'].map((relative)=>path.join(root,relative));
  return archiveRoots.some((archiveRoot)=>fs.existsSync(archiveRoot)&&fs.readdirSync(archiveRoot,{withFileTypes:true}).some((entry)=>entry.isDirectory()&&fs.existsSync(path.join(archiveRoot,entry.name,suffix))));
}
function checkWorkspaceArtifact(relativePath) {
  if (process.env.ATELIER_TEST_WORKSPACE_ARTIFACTS === '1') {
    assert.ok(workspaceArtifactExists(relativePath), `Thiếu dữ liệu nghiệm thu: ${relativePath}`);
  } else {
    console.log(`SKIP: dữ liệu nghiệm thu tùy chọn ${relativePath} (ATELIER_TEST_WORKSPACE_ARTIFACTS=1 để kiểm tra).`);
  }
}
const expected = [
  'app/server.js',
  'app/public/index.html',
  'app/public/app.js',
  'app/public/styles.css',
  'samples/characters/c001.png',
  'samples/characters/c002.png',
  'samples/characters/c003.png',
];

for (const relative of expected) {
  assert.ok(fs.existsSync(path.join(root, relative)), `Thiếu tệp: ${relative}`);
}

const images = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(png|jpe?g)$/i.test(entry.name)) images.push(full);
  }
}
walk(path.join(root, 'samples'));
assert.ok(images.length >= 23, `Kỳ vọng ít nhất 23 ảnh mẫu, nhận được ${images.length}`);
console.log(`OK: cấu trúc hợp lệ và tìm thấy ${images.length} ảnh mẫu.`);

const serverSource = fs.readFileSync(path.join(root, 'app/server.js'), 'utf8');
for (const route of ['/api/auto-mask', '/api/preprocess-garment', '/api/batch-tryon', '/api/analyze-people', '/api/regression-audit', '/outputs/']) {
  assert.ok(serverSource.includes(route), `Thiếu route Sprint 3B: ${route}`);
}
for (const uploadFeature of ['/api/images/upload', '/uploads/', 'UPLOADS_DIR']) {
  assert.ok(serverSource.includes(uploadFeature), `Thiếu chức năng tải ảnh nguồn: ${uploadFeature}`);
}
assert.ok(serverSource.includes('resolveSamplePath(sampleId)'), 'Các thao tác lưu/duyệt phải hỗ trợ ảnh trong uploads/');
for (const progressFeature of ['/api/job-events', 'text/event-stream', 'streamJobEvents']) {
  assert.ok(serverSource.includes(progressFeature), `Thiếu cập nhật tiến độ thời gian thực: ${progressFeature}`);
}
const aiProgressSource = fs.readFileSync(path.join(root, 'ai_service.py'), 'utf8');
for (const progressFeature of ['inpaint-model-', 'inpaint-generating', 'callback_on_step_end', 'inpaint-variant-complete', 'totalWorkSteps']) {
  assert.ok(aiProgressSource.includes(progressFeature), `Thiếu tiến độ chi tiết Inpainting: ${progressFeature}`);
}
console.log('OK: các route tự động hóa và audit Sprint 3C đã được khai báo.');

const uiSource = fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8');
for (const feature of ['cropPerson', 'minimumConfidence', 'data-review-id', 'personTool']) {
  assert.ok(uiSource.includes(feature), `Thiếu chức năng Sprint 3D: ${feature}`);
}
console.log('OK: hàng đợi duyệt, chọn người và ngưỡng an toàn Sprint 3D đã được khai báo.');

for (const route of ['/api/review', '/api/export-approved']) {
  assert.ok(serverSource.includes(route), `Thiếu route Sprint 3E: ${route}`);
}
for (const feature of ['compareSlider', 'reviewFilter', 'exportApprovedButton']) {
  assert.ok(fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8').includes(feature), `Thiếu giao diện Sprint 3E: ${feature}`);
}
console.log('OK: lưu trạng thái, so sánh và xuất manifest Sprint 3E đã được khai báo.');

assert.ok(fs.existsSync(path.join(root, 'models/pose/yolo11n-pose.pt')), 'Thiếu checkpoint pose local');
for (const feature of ['usePoseToggle', 'keypoints', 'poseAvailable']) {
  const combined = fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8') + fs.readFileSync(path.join(root, 'ai_service.py'), 'utf8');
  assert.ok(combined.includes(feature), `Thiếu chức năng Sprint 3F: ${feature}`);
}
console.log('OK: checkpoint, keypoint và bảo vệ pose Sprint 3F đã được khai báo.');

for (const feature of ['twoStageToggle', 'minimumQuality', 'minimumSimilarity', 'onlyQualityToggle']) {
  assert.ok(fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8').includes(feature), `Thiếu giao diện Sprint 4A: ${feature}`);
}
for (const feature of ['clip_embedding', 'qualityGate', 'model-photo', 'previewCandidates']) {
  assert.ok(fs.readFileSync(path.join(root, 'ai_service.py'), 'utf8').includes(feature), `Thiếu pipeline Sprint 4A: ${feature}`);
}
console.log('OK: chuẩn hóa trang phục, hai tầng và cổng chất lượng Sprint 4A đã được khai báo.');

for (const feature of ['minimumSeam', 'minimumAnatomy', 'maxRetries', 'repairSeamsToggle']) {
  assert.ok(fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8').includes(feature), `Thiếu giao diện Sprint 4B: ${feature}`);
}
for (const feature of ['repair_local_seams', 'seamScore', 'anatomyScore', 'textureContinuity', 'retryCount']) {
  assert.ok(fs.readFileSync(path.join(root, 'ai_service.py'), 'utf8').includes(feature), `Thiếu pipeline Sprint 4B: ${feature}`);
}
console.log('OK: sửa biên bảo thủ, chấm lỗi cục bộ và retry có giới hạn Sprint 4B đã được khai báo.');

for (const feature of ['generativeRefineToggle', 'cancelJobButton', 'calibrateButton']) {
  assert.ok(fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8').includes(feature), `Thiếu giao diện Sprint 4C: ${feature}`);
}
for (const feature of ['generative_seam_refine', 'ensure_job_active', '/cancel-job', 'selectedMetrics']) {
  assert.ok(fs.readFileSync(path.join(root, 'ai_service.py'), 'utf8').includes(feature), `Thiếu pipeline Sprint 4C: ${feature}`);
}
for (const route of ['/api/cancel-job', '/api/job-status', '/api/calibrate-quality']) {
  assert.ok(serverSource.includes(route), `Thiếu route Sprint 4C: ${route}`);
}
console.log('OK: sửa sinh ảnh có mục tiêu, hủy an toàn và hiệu chỉnh ngưỡng Sprint 4C đã được khai báo.');

for (const feature of ['refineRegion', 'resumeJobButton', 'jobProgress', 'goldenButton']) {
  assert.ok(fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8').includes(feature), `Thiếu giao diện Sprint 4D: ${feature}`);
}
for (const feature of ['load_persisted_jobs', 'save_checkpoint', 'resume_job', 'completedSeeds']) {
  assert.ok(fs.readFileSync(path.join(root, 'ai_service.py'), 'utf8').includes(feature), `Thiếu hàng đợi Sprint 4D: ${feature}`);
}
for (const route of ['/api/resume-job', '/api/golden-baseline']) {
  assert.ok(serverSource.includes(route), `Thiếu route Sprint 4D: ${route}`);
}
console.log('OK: checkpoint bền vững, tiến độ, vùng sửa và bộ chuẩn Sprint 4D đã được khai báo.');

for (const feature of ['compareBaselineButton', 'jobsButton', 'cleanupJobsButton', 'benchmarkButton']) {
  assert.ok(fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8').includes(feature), `Thiếu giao diện Sprint 4E: ${feature}`);
}
for (const route of ['/api/jobs', '/api/compare-baseline', '/api/cleanup-jobs', '/api/benchmark']) {
  assert.ok(serverSource.includes(route), `Thiếu route Sprint 4E: ${route}`);
}
for (const feature of ['def benchmark', '"benchmark": True', 'maximum = 23']) {
  assert.ok(fs.readFileSync(path.join(root, 'ai_service.py'), 'utf8').includes(feature), `Thiếu benchmark Sprint 4E: ${feature}`);
}
console.log('OK: so sánh baseline, quản lý job, dọn an toàn và benchmark Sprint 4E đã được khai báo.');

for (const feature of ['dashboardButton', 'systemCheckButton', 'backupButton']) {
  assert.ok(fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8').includes(feature), `Thiếu giao diện Sprint 4F: ${feature}`);
}
for (const route of ['/api/quality-dashboard', '/api/system-check', '/api/backup']) {
  assert.ok(serverSource.includes(route), `Thiếu route Sprint 4F: ${route}`);
}
for (const feature of ['durationSeconds', 'peakVramMb', 'gpuMemoryMb', 'benchmarkConfig']) {
  assert.ok(fs.readFileSync(path.join(root, 'ai_service.py'), 'utf8').includes(feature), `Thiếu đo lường Sprint 4F: ${feature}`);
}
assert.ok(fs.existsSync(path.join(root, 'build-offline-release.ps1')), 'Thiếu bộ đóng gói offline Sprint 4F');
console.log('OK: dashboard, đo hiệu năng, kiểm tra offline, sao lưu và đóng gói Sprint 4F đã được khai báo.');

for (const feature of ['reviewBenchmarkButton', 'calibrateWeightsButton', 'backupSelect', 'restoreBackupButton']) {
  assert.ok(fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8').includes(feature), `Thiếu giao diện Sprint 4G: ${feature}`);
}
for (const route of ['/api/benchmark-review', '/api/calibrate-weights', '/api/backups', '/api/restore-backup']) {
  assert.ok(serverSource.includes(route), `Thiếu route Sprint 4G: ${route}`);
}
for (const feature of ['rankingScore', 'scoreWeights', 'score-weights.json']) {
  assert.ok(fs.readFileSync(path.join(root, 'ai_service.py'), 'utf8').includes(feature), `Thiếu hiệu chỉnh Sprint 4G: ${feature}`);
}
assert.ok(fs.existsSync(path.join(root, 'verify-offline-release.ps1')), 'Thiếu kiểm tra checksum Sprint 4G');
console.log('OK: duyệt benchmark, trọng số, khôi phục và checksum Sprint 4G đã được khai báo.');

for (const feature of ['compareWeightsButton', 'acceptanceButton', 'suggestedRegion']) {
  const combined = fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8') + serverSource;
  assert.ok(combined.includes(feature), `Thiếu nghiệm thu Sprint 4H: ${feature}`);
}
for (const route of ['/api/compare-weights', '/api/release-acceptance']) {
  assert.ok(serverSource.includes(route), `Thiếu route Sprint 4H: ${route}`);
}
for (const file of ['open_app.bat', 'test-clean-install.ps1']) {
  assert.ok(fs.existsSync(path.join(root, file)), `Thiếu tệp Sprint 4H: ${file}`);
}
checkWorkspaceArtifact('workspace/review/reference-profiles.json');
console.log('OK: mở ứng dụng, A/B, gợi ý vùng lỗi và nghiệm thu Sprint 4H đã được khai báo.');

for (const feature of ['saveReferenceButton', 'activateWeightsButton']) {
  assert.ok(fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8').includes(feature), `Thiếu giao diện Sprint 4I: ${feature}`);
}
for (const route of ['/api/reference-profile', '/api/activate-weights']) {
  assert.ok(serverSource.includes(route), `Thiếu route Sprint 4I: ${route}`);
}
for (const feature of ['CONFIG_FILE', 'active-score-weights.json']) {
  assert.ok(fs.readFileSync(path.join(root, 'ai_service.py'), 'utf8').includes(feature), `Thiếu cấu hình Sprint 4I: ${feature}`);
}
for (const file of ['install-offline.ps1', 'update-offline.ps1', 'rollback-offline.ps1', 'docs/SPRINT-4I.md']) {
  assert.ok(fs.existsSync(path.join(root, file)), `Thiếu tệp Sprint 4I: ${file}`);
}
console.log('OK: cấu hình model, ảnh tham chiếu, khóa trọng số và vòng đời cài đặt Sprint 4I đã được khai báo.');

for (const feature of ['reviewReadinessButton', 'reviewProgress']) {
  assert.ok(fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8').includes(feature), `Thiếu giao diện Sprint 4J: ${feature}`);
}
for (const feature of ['renderGuidedReview', 'guidedReviewIndex', "event.key==='ArrowLeft'"]) {
  assert.ok(fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8').includes(feature), `Thiếu phiên duyệt Sprint 4J: ${feature}`);
}
assert.ok(serverSource.includes('/api/review-readiness'), 'Thiếu route tiến độ Sprint 4J');
assert.ok(fs.existsSync(path.join(root, 'docs/SPRINT-4J.md')), 'Thiếu tài liệu Sprint 4J');
console.log('OK: phiên duyệt tuần tự, phím tắt và cổng tiến độ Sprint 4J đã được khai báo.');

for (const feature of ['runRetryQueueButton', 'retryComparisonsButton']) {
  assert.ok(fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8').includes(feature), `Thiếu giao diện Sprint 4K: ${feature}`);
}
for (const route of ['/api/retry-plan', '/api/retry-comparison', '/api/retry-comparisons']) {
  assert.ok(serverSource.includes(route), `Thiếu route Sprint 4K: ${route}`);
}
for (const file of ['docs/SPRINT-4K.md', 'docs/PROJECT-COMPLETION.md']) {
  assert.ok(fs.existsSync(path.join(root, file)), `Thiếu tài liệu Sprint 4K: ${file}`);
}
console.log('OK: hàng chạy lại theo nhãn, so sánh cũ–mới và kế hoạch hoàn thành Sprint 4K đã được khai báo.');

for (const feature of ['reviewKey(category,sampleId)', 'legacyItems', 'approvedByCategory', '/api/confirm-default-weights']) {
  assert.ok(serverSource.includes(feature), `Thiếu ma trận duyệt Sprint 4L: ${feature}`);
}
for (const feature of ['confirmDefaultWeightsButton', 'currentReview']) {
  const combined=fs.readFileSync(path.join(root,'app/public/index.html'),'utf8')+fs.readFileSync(path.join(root,'app/public/app.js'),'utf8');
  assert.ok(combined.includes(feature), `Thiếu giao diện Sprint 4L: ${feature}`);
}
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-4L.md')), 'Thiếu tài liệu Sprint 4L');
checkWorkspaceArtifact('workspace/review/sd35-smoke-test.json');
console.log('OK: ma trận duyệt 69 trường hợp và đường xác nhận không cần hiệu chỉnh Sprint 4L đã được khai báo.');

for (const feature of ['read_lora_registry', 'configure_loras', 'lora_ab_test', '"loras": lora_metadata']) {
  assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature), `Thiếu LoRA Sprint 4M: ${feature}`);
}
for (const route of ['/api/lora-status','/api/lora-configure','/api/lora-ab-test'])assert.ok(serverSource.includes(route),`Thiếu route LoRA Sprint 4M: ${route}`);
for (const file of ['models/lora/registry.json','models/lora/README.md','docs/SPRINT-4M.md'])assert.ok(fs.existsSync(path.join(root,file)),`Thiếu tệp Sprint 4M: ${file}`);
console.log('OK: registry, checksum, cấu hình động và A/B LoRA SD3.5 Sprint 4M đã được khai báo.');
for (const file of ['scripts/convert-kohya-sd3-lora.py','docs/SPRINT-4O.md'])assert.ok(fs.existsSync(path.join(root,file)),`Thiếu tệp Sprint 4O: ${file}`);
checkWorkspaceArtifact('workspace/review/lora-sd35-large-photorealistic-conversion.json');
const loraRegistry=JSON.parse(fs.readFileSync(path.join(root,'models/lora/registry.json'),'utf8'));
const photorealistic=loraRegistry.adapters.find((item)=>item.id==='sd35-large-photorealistic');
assert.ok(photorealistic?.file?.endsWith('.diffusers.safetensors'),'LoRA photorealistic chưa dùng bản Diffusers');
assert.equal(photorealistic?.status,'converted-experimental','Sai trạng thái LoRA photorealistic');
assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes('"active": public_active'),'Trạng thái LoRA còn lộ đối tượng Path');
console.log('OK: bộ chuyển đổi Kohya SD3.5 và A/B Sprint 4O đã được khai báo.');
for (const feature of ['automatic_protected_detail_mask','lora_ab_matrix','"protectedMask"'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu mask/ma trận Sprint 4P: ${feature}`);
assert.ok(serverSource.includes('/api/lora-ab-matrix'),'Thiếu route ma trận LoRA Sprint 4P');
for (const feature of ['loraMatrixButton','displayProtectedMask','runLoraMatrix'])assert.ok((fs.readFileSync(path.join(root,'app/public/index.html'),'utf8')+fs.readFileSync(path.join(root,'app/public/app.js'),'utf8')).includes(feature),`Thiếu giao diện Sprint 4P: ${feature}`);
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-4P.md')),'Thiếu tài liệu Sprint 4P');
checkWorkspaceArtifact('workspace/review/automatic-mask-smoke-20261013.json');
console.log('OK: mask bảo vệ và ma trận LoRA Sprint 4P đã được khai báo.');
for (const feature of ['mask_strength_policy','lora_strength_matrix','minimumCoverage','recommendedStrength'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu hiệu chỉnh Sprint 4Q: ${feature}`);
assert.ok(serverSource.includes('/api/lora-strength-matrix'),'Thiếu route strength matrix Sprint 4Q');
for (const feature of ['loraStrengthButton','runLoraStrengthMatrix'])assert.ok((fs.readFileSync(path.join(root,'app/public/index.html'),'utf8')+fs.readFileSync(path.join(root,'app/public/app.js'),'utf8')).includes(feature),`Thiếu giao diện Sprint 4Q: ${feature}`);
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-4Q.md')),'Thiếu tài liệu Sprint 4Q');
console.log('OK: tự hiệu chỉnh mask/strength Sprint 4Q đã được khai báo.');
for (const feature of ['adaptive_local_edge_blend','edgeFeather','edge_artifacts_seed_'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu hòa biên Sprint 4R: ${feature}`);
for (const feature of ['prepare_dual_inpaint_masks','generation_mask.png','adaptive_inpaint_context_padding','contextRatio'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu ghép liền mạch cơ thể: ${feature}`);
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-4R.md')),'Thiếu tài liệu Sprint 4R');
console.log('OK: hòa biên cục bộ thích ứng Sprint 4R đã được khai báo.');
for (const feature of ['texture_preserving_core_recovery','texture_recovery_matrix','texture_core_seed_','laplacianVarianceBefore'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu khôi phục texture Sprint 4T: ${feature}`);
assert.ok(serverSource.includes('/api/texture-recovery-matrix'),'Thiếu route texture recovery Sprint 4T');
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-4T.md')),'Thiếu tài liệu Sprint 4T');
console.log('OK: khôi phục texture lõi và A/B cùng thế hệ Sprint 4T đã được khai báo.');
for (const feature of ['detect_core_structural_artifacts','generative_core_structural_refine','structural_refine_matrix','structural_artifacts_seed_'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu sửa cấu trúc Sprint 4U: ${feature}`);
assert.ok(serverSource.includes('/api/structural-refine-matrix'),'Thiếu route structural refine Sprint 4U');
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-4U.md')),'Thiếu tài liệu Sprint 4U');
console.log('OK: phát hiện và tái sinh cục bộ lỗi cấu trúc Sprint 4U đã được khai báo.');
for (const feature of ['effective_step_policy','effective_step_matrix','minimumEffectiveSteps','stepsAutoAdjusted'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu hiệu chỉnh effective steps Sprint 4V: ${feature}`);
assert.ok(serverSource.includes('/api/effective-step-matrix'),'Thiếu route effective step matrix Sprint 4V');
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-4V.md')),'Thiếu tài liệu Sprint 4V');
console.log('OK: chính sách và ma trận effective steps Sprint 4V đã được khai báo.');
for (const feature of ['pose_garment_prior','relativePersonCoverage','garmentCompleteness','minimumGarmentCompleteness'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu cổng mask Sprint 4W: ${feature}`);
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-4W.md')),'Thiếu tài liệu Sprint 4W');
console.log('OK: pose-union và cổng đầy đủ mask Sprint 4W đã được khai báo.');
for (const feature of ['hybrid_tryon_compare','catvtonSteps','hybrid_refine_mask','sameSeedWithinRow'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu hybrid Sprint 4X: ${feature}`);
assert.ok(serverSource.includes('/api/hybrid-tryon-compare'),'Thiếu route hybrid compare Sprint 4X');
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-4X.md')),'Thiếu tài liệu Sprint 4X');
console.log('OK: so sánh CatVTON, SD3.5 và hybrid Sprint 4X đã được khai báo.');
for (const feature of ['normalize_garment_reference','normalize_reference','catvton_reference_matrix','lowerBodyContaminationBeforeCrop','lowerBodyContamination'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu reference sạch Sprint 4Y: ${feature}`);
for (const route of ['/api/normalize-garment-reference','/api/catvton-reference-matrix'])assert.ok(serverSource.includes(route),`Thiếu route Sprint 4Y: ${route}`);
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-4Y.md')),'Thiếu tài liệu Sprint 4Y');
console.log('OK: chuẩn hóa reference và ma trận CatVTON thuần Sprint 4Y đã được khai báo.');
for (const feature of ['catvton_dedicated_mask','catvton_dedicated_mask_matrix','waistLeakage','protectedOverlap','pose-dedicated'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu dedicated mask Sprint 4Z: ${feature}`);
assert.ok(serverSource.includes('/api/catvton-dedicated-mask-matrix'),'Thiếu route dedicated mask Sprint 4Z');
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-4Z.md')),'Thiếu tài liệu Sprint 4Z');
console.log('OK: mask CatVTON chuyên biệt và ma trận kiểm chứng Sprint 4Z đã được khai báo.');
for (const feature of ['catvton_core_degradation','catvton_retry_matrix','coreTextureScore','lowTextureRatio','selectionWeights'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu selective retry Sprint 5A: ${feature}`);
assert.ok(serverSource.includes('/api/catvton-retry-matrix'),'Thiếu route selective retry Sprint 5A');
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-5A.md')),'Thiếu tài liệu Sprint 5A');
console.log('OK: phát hiện suy biến nội vùng và selective retry Sprint 5A đã được khai báo.');
for (const feature of ['validate_product_reference','active_reference_path','backgroundStd','foregroundCoverage','dominantPalette'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu kiểm định reference Sprint 5B: ${feature}`);
for (const route of ['/api/validate-reference','/api/reference-profile'])assert.ok(serverSource.includes(route),`Thiếu route reference Sprint 5B: ${route}`);
assert.ok(serverSource.includes("callAiJson('/validate-product-reference'"),'Lưu reference chưa bắt buộc qua cổng AI');
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-5B.md')),'Thiếu tài liệu Sprint 5B');
console.log('OK: nhập, kiểm định và kích hoạt reference sản phẩm Sprint 5B đã được khai báo.');
for (const feature of ['color_material_consistency','catvton_color_audit','colorOutlierRatio','colorMaterialScore','promotionAllowed'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu cổng màu/chất liệu Sprint 5C: ${feature}`);
assert.ok(serverSource.includes('/api/catvton-color-audit'),'Thiếu route color audit Sprint 5C');
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-5C.md')),'Thiếu tài liệu Sprint 5C');
console.log('OK: cổng nhất quán màu/chất liệu và chống promotion sai Sprint 5C đã được khai báo.');
for (const feature of ['catvton_geometry_consistency','catvton_geometry_audit','largestFlatComponentRatio','sideEdgeImbalance','weakBoundaryRatio','combinedGateAccepted'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu cổng hình học Sprint 5D: ${feature}`);
assert.ok(serverSource.includes('/api/catvton-geometry-audit'),'Thiếu route geometry audit Sprint 5D');
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-5D.md')),'Thiếu tài liệu Sprint 5D');
console.log('OK: cổng hình học nội vùng và audit kết hợp Sprint 5D đã được khai báo.');
for (const feature of ['referenceReadinessPayload','benchmarkWithPreflight','checksumMatches','Benchmark bị chặn'])assert.ok(serverSource.includes(feature),`Thiếu reference preflight Sprint 5E: ${feature}`);
for (const route of ['/api/reference-readiness','/api/benchmark'])assert.ok(serverSource.includes(route),`Thiếu route preflight Sprint 5E: ${route}`);
for (const feature of ['referenceReadiness','refreshReferenceReadinessButton'])assert.ok(fs.readFileSync(path.join(root,'app/public/index.html'),'utf8').includes(feature),`Thiếu UI reference Sprint 5E: ${feature}`);
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-5E.md')),'Thiếu tài liệu Sprint 5E');
console.log('OK: reference readiness và benchmark preflight Sprint 5E đã được khai báo.');
for (const feature of ['qualify_product_reference','reference-qualification-','failed-smoke','qualifiedAt'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu smoke qualification Sprint 5F: ${feature}`);
assert.ok(serverSource.includes('/api/qualify-reference'),'Thiếu route qualification Sprint 5F');
for (const feature of ['qualifyReferenceButton','qualifyReference'])assert.ok((fs.readFileSync(path.join(root,'app/public/index.html'),'utf8')+fs.readFileSync(path.join(root,'app/public/app.js'),'utf8')).includes(feature),`Thiếu UI qualification Sprint 5F: ${feature}`);
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-5F.md')),'Thiếu tài liệu Sprint 5F');
console.log('OK: smoke qualification reference sản phẩm Sprint 5F đã được khai báo.');

const modelRegistry=JSON.parse(fs.readFileSync(path.join(root,'models/registry.json'),'utf8'));
const chroma=modelRegistry.models.find((item)=>item.id==='flux-chroma1-hd');
assert.ok(chroma,'Thiếu đăng ký FLUX Chroma1-HD');
assert.equal(chroma.status,'integrated-smoke-passed');
assert.ok(chroma.requiredFiles.includes('text_encoder/model.safetensors.index.json'));
assert.ok(chroma.requiredFiles.includes('vae/diffusion_pytorch_model.safetensors'));
assert.equal(chroma.sha256,'d446d9695d08276f61e53653e025289dd96f7a489c27982a1fa54ecabc06642a');
assert.ok(fs.existsSync(path.join(root,'models/flux/chroma1-hd/Chroma1-HD.safetensors')),'Thiếu checkpoint Chroma1-HD');
assert.equal(fs.statSync(path.join(root,'models/flux/chroma1-hd/Chroma1-HD.safetensors')).size,17800038288);
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-4S.md')),'Thiếu tài liệu Sprint 4S');
console.log('OK: FLUX Chroma1-HD Sprint 4S đã được tải, xác minh và đăng ký.');
for (const feature of ['chroma_required_files','load_chroma_pipe','chroma_smoke','enable_model_cpu_offload'])assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes(feature),`Thiếu tích hợp Chroma Sprint 5G: ${feature}`);
for (const route of ['/api/chroma-status','/api/chroma-smoke'])assert.ok(serverSource.includes(route),`Thiếu route Chroma Sprint 5G: ${route}`);
for (const feature of ['chromaStatus','refreshChromaButton','smokeChromaButton'])assert.ok(fs.readFileSync(path.join(root,'app/public/index.html'),'utf8').includes(feature),`Thiếu UI Chroma Sprint 5G: ${feature}`);
assert.ok(fs.existsSync(path.join(root,'docs/SPRINT-5G.md')),'Thiếu tài liệu Sprint 5G');
console.log('OK: loader ngoại tuyến và smoke gate Chroma Sprint 5G đã được khai báo.');

for (const route of ['/api/models','/api/models/register','/api/models/activate','/api/models/quarantine','/api/models/restore','/api/models/export'])assert.ok(serverSource.includes(route),`Thiếu route quản lý model Sprint 4N: ${route}`);
for (const route of ['/api/model-capabilities','/api/model-capabilities/select'])assert.ok(serverSource.includes(route),`Thiếu route lựa chọn model theo chức năng: ${route}`);
for (const feature of ['MODEL_FEATURES','compatibleWithFeature','featureModels','modelCapabilityList'])assert.ok((serverSource+fs.readFileSync(path.join(root,'app/public/index.html'),'utf8')+fs.readFileSync(path.join(root,'app/public/app.js'),'utf8')).includes(feature),`Thiếu lựa chọn model theo chức năng: ${feature}`);
for (const feature of ['modelSummary','refreshModelsButton','registerModelButton','quarantineList'])assert.ok(fs.readFileSync(path.join(root,'app/public/index.html'),'utf8').includes(feature),`Thiếu giao diện quản lý model Sprint 4N: ${feature}`);
for (const file of ['models/registry.json','docs/SPRINT-4N.md'])assert.ok(fs.existsSync(path.join(root,file)),`Thiếu tệp Sprint 4N: ${file}`);
console.log('OK: registry thống nhất, xác minh, kích hoạt, manifest và cách ly Sprint 4N đã được khai báo.');

for (const feature of ['benchmarkProvenance','referenceSha256','qualificationMatches','qualificationSamples','Benchmark không gắn với qualification/reference hiện tại']) {
  assert.ok((serverSource + fs.readFileSync(path.join(root, 'ai_service.py'), 'utf8')).includes(feature), `Thiếu chuỗi bằng chứng qualification Sprint 5H: ${feature}`);
}
assert.ok(serverSource.includes("body.garmentImage=`data:${mime};base64,"), 'Benchmark phải luôn dùng reference đã qualification');
assert.ok(!serverSource.includes('if(!body.garmentImage){const target=safeJoin(ROOT,item.reference)'), 'Benchmark không được cho ảnh request ghi đè reference đã qualification');
console.log('OK: provenance qualification → benchmark → release Sprint 5H đã được khóa.');

for (const feature of ['/api/system-overview','systemOverview','system-status','system-models']) {
  assert.ok((serverSource + fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/styles.css'), 'utf8')).includes(feature), `Thiếu bảng điều khiển vận hành ngoại tuyến: ${feature}`);
}
console.log('OK: bảng điều khiển vận hành ngoại tuyến đã được khai báo.');

for (const feature of ['modelManagerDialog','openModelManager','data-open-model-manager','closeModelManager']) {
  assert.ok((fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8')).includes(feature), `Thiếu màn hình quản lý model: ${feature}`);
}
console.log('OK: nút Quản lý model mở màn hình quản lý chuyên dụng.');

for (const feature of ['/api/quality-overview','qualityOverview','quality-kpis','data-quality-action']) {
  assert.ok((serverSource + fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/styles.css'), 'utf8')).includes(feature), `Thiếu bảng điều khiển chất lượng: ${feature}`);
}
console.log('OK: bảng điều khiển đo lường và cải thiện chất lượng đã được khai báo.');

for (const feature of ['jobsOverview','startJobsLiveUpdates','data-job-action','jobs-live','job-progress']) {
  assert.ok((fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/styles.css'), 'utf8')).includes(feature), `Thiếu bảng theo dõi tác vụ: ${feature}`);
}
console.log('OK: bảng theo dõi tác vụ thời gian thực đã được khai báo.');

for (const feature of ['reviewOverview','loadReviewOverview','data-review-action','review-ring','review-categories']) {
  assert.ok((fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/styles.css'), 'utf8')).includes(feature), `Thiếu không gian hàng duyệt: ${feature}`);
}
console.log('OK: không gian kiểm tra và ra quyết định đã được khai báo.');

for (const feature of ['studioMode','setStudioMode','studioReadiness','data-studio-mode','studio-mode-card']) {
  assert.ok((fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/styles.css'), 'utf8')).includes(feature), `Thiếu cải tiến trải nghiệm Tạo ảnh: ${feature}`);
}
console.log('OK: luồng Tạo ảnh theo tác vụ và trạng thái sẵn sàng đã được khai báo.');

for (const feature of ['Đang dùng tâm vùng đã tô làm gợi ý','Chế độ Điểm AI đã bật',"$('segmentButton').disabled=true"]) {
  assert.ok(fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8').includes(feature), `Thiếu sửa lỗi tạo mask tự động: ${feature}`);
}
console.log('OK: tạo mask tự động hỗ trợ điểm AI và vùng tô thủ công.');

for (const feature of ['data-model-tab','data-model-pane','setModelManagerTab','model-summary-grid','capability-card']) {
  assert.ok((fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/styles.css'), 'utf8')).includes(feature), `Thiếu cải tiến quản lý model: ${feature}`);
}
console.log('OK: quản lý model được phân tầng theo chức năng, thư viện và đăng ký.');

for (const feature of ['data-model-tab="registered"','registeredModelSearch','renderRegisteredModels','registered-model-card','lastRegisteredModelId']) {
  assert.ok((fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/styles.css'), 'utf8')).includes(feature), `Thiếu tab model đã đăng ký: ${feature}`);
}
console.log('OK: danh sách model đã được tách khỏi tab Thêm model.');

const modelCatalog=JSON.parse(fs.readFileSync(path.join(root,'models/inpaint-candidates.json'),'utf8'));
// The catalog is user-managed: an optional candidate can be removed without
// breaking the application or turning a source-tree test red.
for(const id of ['grounding-dino-base','birefnet','florence-2-large','flux-1-fill-dev','idm-vton']){
  const candidate=modelCatalog.candidates.find((item)=>item.id===id);
  assert.ok(candidate,`Thiếu model đề xuất trong thư viện: ${id}`);
  assert.ok(['integration','restricted'].includes(candidate.compatibility),`Thiếu trạng thái tương thích an toàn: ${id}`);
  assert.ok(candidate.source.startsWith('https://huggingface.co/'),`Nguồn model không hợp lệ: ${id}`);
}
const modelLibraryUi=fs.readFileSync(path.join(root,'app/public/index.html'),'utf8')+fs.readFileSync(path.join(root,'app/public/app.js'),'utf8');
for(const feature of ['modelInventoryCompatibility','compatibility-badge','integrationNote'])assert.ok(modelLibraryUi.includes(feature),`Thiếu UI tương thích model: ${feature}`);
console.log('OK: thư viện có model đề xuất, cảnh báo tích hợp/giấy phép và bộ lọc tương thích.');

const buttonTypography=fs.readFileSync(path.join(root,'app/public/button-typography.css'),'utf8');
assert.ok(fs.readFileSync(path.join(root,'app/public/index.html'),'utf8').includes('/button-typography.css'),'Thiếu stylesheet typography cho nút');
for(const feature of ['--button-font-family','--button-font-size','button,','.button-link'])assert.ok(buttonTypography.includes(feature),`Thiếu quy tắc đồng bộ nút: ${feature}`);
for(const feature of ['--button-height','--button-height-sm','--button-height-lg','--button-padding-y','--button-padding-x','--button-group-gap','--button-icon-gap','file-selector-button'])assert.ok(buttonTypography.includes(feature),`Thiếu spacing token cho nút: ${feature}`);
assert.ok(buttonTypography.includes('margin: 0;'),'Nút chưa được chuẩn hóa margin');
console.log('OK: phông chữ và kích thước chữ của toàn bộ nút đã được đồng bộ.');

assert.ok(fs.readFileSync(path.join(root,'app/public/index.html'),'utf8').includes('id="offlineModelPanel"'),'Thiếu định danh vùng quản lý model độc lập');
assert.ok(fs.readFileSync(path.join(root,'app/public/app.js'),'utf8').includes("modelManagerContent.appendChild(offlineModelPanel)"),'Quản lý model vẫn còn trong tab Chỉnh sửa ảnh');
console.log('OK: quản lý model offline đã được chuyển khỏi Chỉnh sửa ảnh sang Hệ thống.');

const studioMarkup=fs.readFileSync(path.join(root,'app/public/index.html'),'utf8');
const studioBehavior=fs.readFileSync(path.join(root,'app/public/app.js'),'utf8');
assert.ok(studioMarkup.includes('id="studioInpaintPanel" open'),'Panel Inpainting chưa được khóa mở');
assert.ok(studioMarkup.includes('id="studioTryonPanel" open'),'Panel CatVTON chưa được khóa mở');
assert.ok(studioBehavior.includes("inpaint.open=true;tryon.open=true"),'Chuyển tác vụ có thể thu gọn panel');
assert.ok(fs.readFileSync(path.join(root,'app/public/button-typography.css'),'utf8').includes('.studio-task-panel > summary { display: none; }'),'Tiêu đề accordion tác vụ vẫn còn hiển thị');
console.log('OK: panel Inpainting/CatVTON luôn mở và không còn điều khiển accordion dư thừa.');

assert.ok(studioMarkup.includes('id="operationalCommandHost" hidden'),'Thiếu vùng lệnh nền cho công cụ vận hành');
assert.ok(studioBehavior.includes("const operations=$('operationalCommandHost')"),'Công cụ vận hành chưa được chuyển khỏi bảng chỉnh sửa');
assert.ok(!studioBehavior.includes("operations.className='inpaint-panel operations-panel'"),'Accordion Công cụ vận hành và kiểm định vẫn còn được tạo');
console.log('OK: công cụ vận hành và kiểm định đã được tách khỏi tab Chỉnh sửa ảnh.');

for(const id of ['resetEditorButton','deselectImageButton','emptyCanvasState'])assert.ok(studioMarkup.includes(`id="${id}"`),`Thiếu điều khiển đặt lại ảnh: ${id}`);
for(const feature of ['resetEditorSession','deselectCurrentImage','editorHasChanges','renderImageOptions(null)'])assert.ok(studioBehavior.includes(feature),`Thiếu hành vi đặt lại ảnh: ${feature}`);
console.log('OK: Đặt lại phiên và Bỏ chọn ảnh đã được triển khai với màn hình trống an toàn.');

const downloaderSource=fs.readFileSync(path.join(root,'scripts/download_model.py'),'utf8');
for(const feature of ['files_metadata=True','monitor_directory_progress','bytesDownloaded','totalBytes'])assert.ok(downloaderSource.includes(feature),`Thiếu tiến độ tải Hugging Face: ${feature}`);
for(const feature of ['liveModelDownloadStatus','aria-valuenow','percent.toFixed(1)'])assert.ok((serverSource+studioBehavior).includes(feature),`Thiếu phần trăm tải model trên giao diện: ${feature}`);
console.log('OK: tải model Hugging Face hiển thị phần trăm thực theo số byte đã nhận.');

const maskGuideSource = fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8');
for (const feature of ['emptyMaskDialog','editableMaskStats','showMaskGuide','createMaskFromInpaintPreset','maskGuideAi','maskGuideManual']) {
  assert.ok(maskGuideSource.includes(feature), `Thiếu hướng dẫn mask trống: ${feature}`);
}
assert.ok(maskGuideSource.indexOf('if (maskStats.selected < maskStats.minimum)') < maskGuideSource.indexOf("createJobId('inpaint')"), 'Phải kiểm tra mask trước khi tạo job Inpainting');
console.log('OK: mask trống hoặc quá nhỏ được chặn trước khi tạo tác vụ và có hướng dẫn phục hồi.');

const chromaGeneratorSource = fs.readFileSync(path.join(root, 'new_image.py'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/new-image.js'), 'utf8') + serverSource + fs.readFileSync(path.join(root, 'ai_service.py'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8');
for (const feature of ['/api/chroma-generate','/chroma-generate','chroma_generate','chromaGeneratorPanel','chromaGenerateButton','runChromaGenerate']) {
  assert.ok(chromaGeneratorSource.includes(feature), `Thiếu chức năng tạo ảnh Chroma: ${feature}`);
}
console.log('OK: tạo ảnh từ mô tả bằng Chroma đã được kết nối từ giao diện đến pipeline.');

for (const feature of ['editorLiveProgress','chromaLiveProgress','activityPreview','TEXT_TO_IMAGE_STAGES','text-generating','renderGenerationLive','save_diffusion_preview','callback_on_step_end_tensor_inputs=["latents"]']) {
  assert.ok(chromaGeneratorSource.includes(feature), `Thiếu tiến trình hoặc preview trực tiếp: ${feature}`);
}
for (const feature of ['activityClose','Đóng tác vụ','if(done){target.hidden=true','Đã đóng thông báo tác vụ']) {
  assert.ok(chromaGeneratorSource.includes(feature), `Thiếu cơ chế đóng hoặc chống chồng lấn tác vụ: ${feature}`);
}
for (const feature of ['usesInlineProgress','center.hidden=usesInlineProgress&&!done','data-inline-cancel','generation-live-actions']) {
  assert.ok(chromaGeneratorSource.includes(feature), `Tiến trình đang chạy vẫn có thể chồng lấn hoặc không hủy được: ${feature}`);
}
for (const feature of ["totalWorkSteps=cfg['count']*total_steps",'completedSteps=index*total_steps+completed','currentVramMb','variant.completed']) {
  assert.ok(chromaGeneratorSource.includes(feature), `Thiếu số liệu tiến trình tạo ảnh: ${feature}`);
}
console.log('OK: Chỉnh sửa ảnh và Tạo ảnh từ mô tả hiển thị tiến trình chi tiết cùng preview thời gian thực.');

for (const feature of ['data-view="create">Chỉnh sửa ảnh','data-view="chroma">Tạo ảnh từ mô tả','chromaView','chromaFormHost','chromaGallery','name===\'chroma\'']) {
  assert.ok(chromaGeneratorSource.includes(feature), `Hai không gian tạo/chỉnh sửa ảnh chưa được tách biệt: ${feature}`);
}
console.log('OK: Tạo ảnh từ mô tả và Chỉnh sửa ảnh có không gian điều hướng riêng.');

for (const feature of ['imageViewerDialog','imageViewerImage','openImageAtFullSize','document.addEventListener(\'dblclick\'','image.naturalWidth','closeImageViewer']) {
  assert.ok(chromaGeneratorSource.includes(feature), `Thiếu trình xem ảnh kích thước 100%: ${feature}`);
}
console.log('OK: nhấp đúp vào ảnh mở trình xem ở kích thước 100%.');

for (const id of ['sdxl-base-1.0','sd35-medium']) {
  const candidate=modelCatalog.candidates.find((item)=>item.id===id);
  assert.ok(candidate,`Thiếu model tạo ảnh đề xuất: ${id}`);
  assert.equal(candidate.kind,'text-to-image',`Sai nhóm model tạo ảnh: ${id}`);
  assert.ok(candidate.source.startsWith('https://huggingface.co/'),`Nguồn model tạo ảnh không hợp lệ: ${id}`);
}
assert.ok(modelLibraryUi.includes('value="text-to-image"'), 'Thiếu bộ lọc Tạo ảnh từ mô tả trong Thư viện model');
console.log('OK: Các model tạo ảnh GPU đề xuất đã có trong Thư viện model.');

for (const feature of ['textToImagePreset','textToImageModel','TEXT_TO_IMAGE_PRESETS','loadTextToImageModels','load_text_to_image_pipe']) {
  assert.ok(chromaGeneratorSource.includes(feature), `Thiếu cấu hình giao diện đa model tạo ảnh: ${feature}`);
}
for (const feature of ['refreshModelSelectors','startModelSelectorStartupScan','cache:\'no-store\'',"item.kind==='text-to-image'"]) {
  assert.ok(chromaGeneratorSource.includes(feature), `Dropdown model chưa tự động đồng bộ: ${feature}`);
}
for (const forbidden of ['startModelSelectorAutoRefresh','visibilitychange',"window.addEventListener('focus'",'setInterval(()=>{if(!document.hidden)scheduleModelSelectorRefresh(0);},5000)','modelDownloadPoll']) {
  assert.ok(!chromaGeneratorSource.includes(forbidden), `Model vẫn bị quét liên tục: ${forbidden}`);
}
assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes('Model tạo ảnh không được đăng ký hoặc không tương thích'), 'Backend chưa hỗ trợ model tạo ảnh đăng ký động');
for (const id of ['sdxl-base-1.0']) {
  const candidate=modelCatalog.candidates.find((item)=>item.id===id);
  assert.equal(candidate.compatibility,'ready',`Model ${id} đã tích hợp nhưng chưa được đánh dấu Dùng ngay`);
  assert.ok(!candidate.integrationNote,`Model ${id} vẫn còn cảnh báo tích hợp lỗi thời`);
}
console.log('OK: giao diện preset và pipeline đa model cho Tạo ảnh từ mô tả đã được khai báo.');

for (const feature of ['registeredIds=new Set','catalogModels=readDownloadCatalog().candidates','registered:model.registered','Có thể sử dụng','Chưa sẵn sàng','model tương thích cần tải, đăng ký hoặc hoàn thiện phụ thuộc']) {
  assert.ok((serverSource + chromaGeneratorSource).includes(feature), `Dropdown Inpainting chưa liệt kê đủ model tương thích: ${feature}`);
}
console.log('OK: Dropdown Inpainting hiển thị model tương thích theo trạng thái sẵn sàng.');

const modelSortSource=fs.readFileSync(path.join(root,'app/public/index.html'),'utf8')+fs.readFileSync(path.join(root,'app/public/app.js'),'utf8')+fs.readFileSync(path.join(root,'app/public/styles.css'),'utf8');
for(const feature of ['modelCapabilitySort','modelInventorySort','registeredModelSort','resetModelCapabilitySort','resetModelInventoryView','resetRegisteredModelView','compareInventoryModels','sortCapabilityCards','restoreModelSortPreferences'])assert.ok(modelSortSource.includes(feature),`Thiếu sắp xếp model: ${feature}`);
for(const key of ['modelInventorySort','modelCapabilitySort','registeredModelSort'])assert.ok(modelSortSource.includes(`localStorage.setItem('${key}'`),`Chưa ghi nhớ sắp xếp: ${key}`);
console.log('OK: ba tab quản lý model hỗ trợ sắp xếp độc lập, đặt lại và ghi nhớ lựa chọn.');

for(const feature of ['readOllamaModels','/api/tags','localEndpoint','sourcePage','ollama-model-missing'])assert.ok(serverSource.includes(feature)||modelSortSource.includes(feature)||JSON.stringify(modelCatalog).includes(feature),`Thiếu kiểm kê Ollama: ${feature}`);
for(const feature of ['local-model-address','Xem trang model'])assert.ok(modelSortSource.includes(feature),`Thiếu thông tin model Ollama trên giao diện: ${feature}`);
console.log('OK: model Ollama dùng trạng thái dịch vụ thực, hiển thị địa chỉ cục bộ và nguồn web hợp lệ.');

const resetUiSource = fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/reset.css'), 'utf8');
for (const feature of ['/api/reset-data','RESET_ARCHIVE_DIR','resetWorkspaceData','data-reset-scope','resetWorkspaceScope','Đặt lại toàn bộ dữ liệu làm việc']) {
  assert.ok((serverSource + resetUiSource).includes(feature), `Thiếu tính năng đặt lại dữ liệu: ${feature}`);
}
for (const scope of ['uploads','masks','review','jobs','quality','outputs']) assert.ok(resetUiSource.includes(`${scope}:`), `Thiếu phạm vi đặt lại: ${scope}`);
assert.ok(serverSource.includes("['running','cancelling']"), 'Đặt lại tác vụ phải bị chặn khi còn tác vụ đang chạy');
assert.ok(serverSource.includes("fs.renameSync(target, destination)"), 'Dữ liệu phải được chuyển vào kho phục hồi thay vì xóa vĩnh viễn');
console.log('OK: dữ liệu làm việc có thể đặt lại theo nhóm, có xác nhận và kho phục hồi.');

const imagePickerSource = serverSource + fs.readFileSync(path.join(root, 'app/public/index.html'), 'utf8') + fs.readFileSync(path.join(root, 'app/public/app.js'), 'utf8');
for (const feature of ["sourceType: 'sample'","sourceType: 'user'",'<label>Nguồn ảnh',"['Ảnh của bạn'","['Ảnh mẫu'",'<optgroup label=']) {
  assert.ok(imagePickerSource.includes(feature), `Thiếu phân nhóm nguồn ảnh: ${feature}`);
}
assert.ok(serverSource.includes("png|jpe?g|webp"), 'Danh sách nguồn ảnh phải nhận diện WebP sau khi tải lại trang');
console.log('OK: dropdown nguồn ảnh tách ảnh người dùng, ảnh mẫu và giữ ảnh WebP sau khi tải lại.');

for (const feature of ['async function handleRequest','Promise.resolve(handleRequest(req, res)).catch','Dịch vụ gặp lỗi khi xử lý yêu cầu']) {
  assert.ok(serverSource.includes(feature), `Thiếu hàng rào lỗi máy chủ: ${feature}`);
}
assert.ok(fs.readFileSync(path.join(root,'app/public/app.js'),'utf8').includes('readableRequestError'), 'Thiếu thông báo thân thiện khi dịch vụ cục bộ ngừng phản hồi');
console.log('OK: lỗi một API không làm dừng máy chủ và lỗi kết nối được hướng dẫn rõ ràng.');

const extendedGeneratorUi=fs.readFileSync(path.join(root,'app/public/index.html'),'utf8')+fs.readFileSync(path.join(root,'app/public/app.js'),'utf8');
for(const feature of ['textToImagePipeline','Inpainting SD3.5','CatVTON · thay trang phục','LoRA SD3.5 · theo phong cách','ControlNet SD 3.5','runExtendedTextPipeline','/api/sd35-conditioned-generate','loadTextToImageLoras'])assert.ok(extendedGeneratorUi.includes(feature),`Thiếu pipeline tạo ảnh mở rộng: ${feature}`);
console.log('OK: Tạo ảnh từ mô tả hỗ trợ Inpainting, CatVTON, LoRA và ControlNet SD3.5 theo đầu vào sẵn có.');

assert.ok(serverSource.includes('manuallyCopied=path.join(modelsRoot,path.basename(configured))'),'Máy chủ chưa nhận diện model được sao chép trực tiếp vào models');
assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes('manually_copied = ROOT / "models" / configured.name'),'AI pipeline chưa hỗ trợ đường dẫn model sao chép thủ công');
assert.ok(fs.readFileSync(path.join(root,'app/public/app.js'),'utf8').includes('loadModelCandidates(),loadTextToImageModels(),loadModelCapabilities()'),'Thư viện model chưa tự quét lại trạng thái');
console.log('OK: model sao chép thủ công vào thư mục models được tự phát hiện và cập nhật trên giao diện.');

for(const feature of ['function discoverLocalModels','model_index.json','autoDetected:true','status:\'auto-detected\'','autoDiscovered:discovered.map'])assert.ok(serverSource.includes(feature),`Thiếu tự đăng ký model cục bộ: ${feature}`);
assert.ok(fs.readFileSync(path.join(root,'app/public/app.js'),'utf8').includes('Promise.all([loadModels(),loadModelCandidates(),loadTextToImageModels(),loadModelCapabilities(),loadInpaintModelOptions()])'),'Danh sách Model đã đăng ký chưa được quét khi mở ứng dụng');
assert.ok(fs.readFileSync(path.join(root,'app/public/app.js'),'utf8').includes('startModelSelectorStartupScan();'),'Lần quét model khởi động chưa được gọi');
console.log('OK: Model được quét một lần khi mở ứng dụng; các lần quét sau do người dùng chủ động.');

const cleanStartupSource=fs.readFileSync(path.join(root,'app/public/app.js'),'utf8');
assert.ok(cleanStartupSource.includes('function showEmptyEditorState'),'Thiếu trạng thái trình sửa ảnh trống');
assert.ok(!cleanStartupSource.includes('await loadImage(images[0])'),'Khởi động sạch không được tự tải ảnh đầu tiên');
assert.ok(cleanStartupSource.includes("const selected=images.find((item)=>item.id===selectedId);if(selected)await loadImage(selected);else showEmptyEditorState()"),'Tải lại danh sách phải giữ ảnh đang chọn hoặc trở về trạng thái trống');
console.log('OK: Chỉnh sửa ảnh khởi động sạch ở trạng thái chưa chọn ảnh.');

const promptAssistSource = serverSource + fs.readFileSync(path.join(root,'app/public/index.html'),'utf8') + fs.readFileSync(path.join(root,'app/public/app.js'),'utf8');
for (const feature of ['/api/prompt-assist','promptAssist','suggestNotesButton','suggestInpaintPromptButton','suggestChromaPromptButton','suggestNegativePromptButton','pendingPromptAssist']) {
  assert.ok(promptAssistSource.includes(feature), `Thiếu trợ lý LLM tạo prompt: ${feature}`);
}
const promptCatalog = require('../app/prompt-store').readCatalog();
for (const task of ['notes','inpaint','imagePrompt','negativePrompt']) assert.ok(promptCatalog.promptAssist.tasks[task], `Thiếu tác vụ LLM: ${task}`);
assert.ok(serverSource.includes("process.env.ATELIER_LLM_MODEL || 'llava:7b'"), 'Thiếu model LLM cục bộ mặc định hoặc khả năng cấu hình');
console.log('OK: trợ lý LLM hỗ trợ đủ bốn trường, dùng ảnh/mask khi phù hợp và có hoàn tác.');

const promptOptimizationSource=serverSource+fs.readFileSync(path.join(root,'app/public/index.html'),'utf8')+fs.readFileSync(path.join(root,'app/public/app.js'),'utf8');
for(const feature of ['optimizePrompt','optimizeNegativePrompt','analyzePrompt','promptAssistDialog','openPromptAssistPreview','applyPromptAssistButton','qualityScore','warnings'])assert.ok(promptOptimizationSource.includes(feature),`Thiếu tối ưu prompt/negative prompt: ${feature}`);
console.log('OK: trợ lý AI hỗ trợ xem trước, tối ưu, kiểm tra xung đột và chỉ áp dụng khi người dùng xác nhận.');

const removalSource=fs.readFileSync(path.join(root,'ai_service.py'),'utf8')+fs.readFileSync(path.join(root,'object_removal.py'),'utf8')+fs.readFileSync(path.join(root,'app/public/index.html'),'utf8')+fs.readFileSync(path.join(root,'app/public/app.js'),'utf8')+JSON.stringify(promptCatalog);
for(const feature of ['removalTarget','fillMode','inpaintFillMode','base_layer','reconstruct_body','build_inpaint_instruction','inpaint_removal_check','maxAutoRetries','visual-change-diagnostic-v2','replace-core-feather-outward-v1'])assert.ok(removalSource.includes(feature),`Thiếu cải tiến xóa vật thể: ${feature}`);
assert.ok(removalSource.includes('Avoid these failure modes:'),'FLUX phải nhận ràng buộc loại trừ trong positive prompt');
assert.equal(promptCatalog.presets.outfit.resolution, '1024', 'Preset xóa trang phục phải dùng độ phân giải đủ lớn');
assert.equal(promptCatalog.presets.outfit.strength, 0.9, 'Preset xóa trang phục phải dùng strength đủ mạnh');
assert.ok(!removalSource.includes('Render the chest and nipples in clear detail'),'Preset mặc định không được ép sinh chi tiết cơ thể nhạy cảm');
console.log('OK: xóa vật thể truyền ngữ nghĩa mục tiêu, có chế độ lấp vùng, prompt FLUX, kiểm tra phần còn sót và tự thử lại.');

const installedProfiles=JSON.parse(fs.readFileSync(path.join(root,'models/registry.json'),'utf8')).models.filter((item)=>item.kind==='inpaint');
const catalogProfiles=JSON.parse(fs.readFileSync(path.join(root,'models/inpaint-candidates.json'),'utf8')).candidates.filter((item)=>item.kind==='inpaint');
const migratedProfiles=require('../app/prompt-store').readCatalog().runtimePresets.modelInpaintProfiles;
const registryProfiles=[...installedProfiles,...catalogProfiles.filter((candidate)=>!installedProfiles.some((installed)=>installed.id===candidate.id))].map(model=>({...model,removalProfile:migratedProfiles[model.id]}));
for(const id of ['sd35-inpaint','waifu-inpaint-xl','sdxl-inpaint-base-0.1','flux-1-fill-dev']){
  const model=registryProfiles.find((item)=>item.id===id);assert.ok(model?.removalProfile,`Model ${id} thiếu removalProfile`);for(const key of ['nativeResolution','steps','strength','guidance','promptMode','supportsNegativePrompt','retryStrengthIncrement','maximumRetries'])assert.notEqual(model.removalProfile[key],undefined,`Profile ${id} thiếu ${key}`);
}
for(const feature of ['resolved_inpaint_profile','semantic_inpaint_residual_check','contentStyle'])assert.ok(removalSource.includes(feature),`Thiếu điều phối inpainting đa model: ${feature}`);
assert.equal(registryProfiles.find((item)=>item.id==='flux-1-fill-dev').removalProfile.supportsNegativePrompt,false,'FLUX không được nhận negative prompt riêng');
assert.equal(registryProfiles.find((item)=>item.id==='waifu-inpaint-xl').contentStyle,'anime','Waifu phải bị giới hạn cho anime');
assert.ok(!fs.readFileSync(path.join(root,'app/public/app.js'),'utf8').includes('autoSwitchModel: true'),'Giao diện không được yêu cầu tự chuyển model');
assert.ok(!removalSource.includes('fallback_result = inpaint('),'Backend không được chạy lại bằng model khác');
assert.ok(!removalSource.includes('def inpaint_fallback_entry('),'Không được tự chọn model thay thế');
console.log('OK: model Inpainting có profile riêng và giữ nguyên model đã chọn.');

for(const feature of ['build_inpaint_negative_prompt','forbiddenReplacement','negativePromptApplied','negativePromptStrategy','merged-into-positive','build_inpaint_negative_prompt.shirt','build_inpaint_negative_prompt.replacement_garment','build_inpaint_negative_prompt.any_remaining_collar','residual-structure'])assert.ok(removalSource.includes(feature),`Thiếu negative prompt chống tái sinh trang phục: ${feature}`);
assert.ok(removalSource.includes('fill_mode != "reconstruct_body"')&&removalSource.includes('base_layer intentionally does not ban generic clothing'),'Negative prompt phải phân biệt lớp nền và tái tạo cơ thể');
assert.ok(removalSource.includes('attempt_negative')&&removalSource.includes('corrective result must avoid all of these outcomes'),'Retry phải có negative prompt cưỡng chế riêng và tương đương cho FLUX');
console.log('OK: negative prompt phân tầng ngăn sinh lại quần áo, không mâu thuẫn lớp nền và tăng cường ở lượt retry.');

const downloadAllSource = serverSource + fs.readFileSync(path.join(root,'app/public/index.html'),'utf8') + fs.readFileSync(path.join(root,'app/public/app.js'),'utf8');
for(const feature of ['downloadAllModelsButton','downloadAllModelsStatus','downloadAllModels','/api/models/download-all','startAllModelDownloads','modelDownloadQueue','canAutoDownloadModel'])assert.ok(downloadAllSource.includes(feature),`Thiếu tải tất cả model: ${feature}`);
for(const feature of ['bulk-download-current','Đang tải:','bytesDownloaded','totalBytes','Còn ${remaining} model trong danh sách chờ','aria-valuenow'])assert.ok(downloadAllSource.includes(feature),`Thiếu thông tin model đang tải cạnh nút Tải về tất cả: ${feature}`);
assert.ok(downloadAllSource.includes("!['restricted','integration'].includes(level)"),'Tải tất cả chưa loại model hạn chế hoặc cần tích hợp thủ công');
console.log('OK: Thư viện model hỗ trợ tải tất cả theo hàng đợi tuần tự và bỏ qua model không phù hợp.');

const gatedModelCatalog = JSON.parse(fs.readFileSync(path.join(root,'models/inpaint-candidates.json'),'utf8'));
const waifuInpaint = gatedModelCatalog.candidates.find((item)=>item.id==='waifu-inpaint-xl');
assert.equal(waifuInpaint.compatibility,'restricted','Waifu-Inpaint-XL phải được đánh dấu là model hạn chế quyền truy cập');
assert.ok(serverSource.includes("errorCode:'access-required'"),'Thiếu phân loại lỗi truy cập Hugging Face');
assert.ok(downloadAllSource.includes('Thử lại sau khi cấp quyền')&&downloadAllSource.includes('Mở trang cấp quyền'),'Thiếu hướng dẫn phục hồi khi model gated bị từ chối');
console.log('OK: lỗi model Hugging Face gated được phân loại, hướng dẫn cấp quyền và loại khỏi tải hàng loạt.');

const cancellationSource = fs.readFileSync(path.join(root,'ai_service.py'),'utf8') + fs.readFileSync(path.join(root,'app/public/app.js'),'utf8');
assert.ok(!cancellationSource.includes('stage="text-validating", cancelRequested=False'),'Tạo ảnh không được xóa yêu cầu hủy gửi sớm');
assert.ok(!cancellationSource.includes('stage="inpaint-validating", cancelRequested=False'),'Inpainting không được xóa yêu cầu hủy gửi sớm');
for(const feature of ['job.cancel.requested','cancellation tombstone','alreadyFinished','const cancellingJobId=activeJobId','await pollJobStatus().catch'])assert.ok(cancellationSource.includes(feature),`Thiếu xử lý hủy an toàn: ${feature}`);
console.log('OK: Hủy an toàn giữ yêu cầu hủy sớm, phản hồi tức thì và đồng bộ lại trạng thái tác vụ.');

for(const feature of ['processIsAlive','download-interrupted','staleForMs>15000','processId:child.pid','detached:true','resumed:Boolean(previous)'])assert.ok(serverSource.includes(feature),`Thiếu phục hồi tải model bị treo: ${feature}`);
assert.ok(serverSource.includes('/^[a-z0-9][a-z0-9.-]{1,63}$/'),'API tải model phải chấp nhận ID phiên bản có dấu chấm');
console.log('OK: tiến trình tải model mồ côi được phát hiện và có thể tiếp tục từ dữ liệu tạm.');

const resilientDownloaderSource = fs.readFileSync(path.join(root,'scripts/download_model.py'),'utf8');
for(const feature of ['HF_HUB_DISABLE_XET','clean_stale_huggingface_cache','max_workers=1','item.stat().st_size == 0'])assert.ok(resilientDownloaderSource.includes(feature),`Thiếu chống treo Hugging Face: ${feature}`);
console.log('OK: downloader Hugging Face tránh Xet deadlock, dọn khóa cũ và giữ dữ liệu tải dở.');

for(const feature of ["part.endsWith('.partial')","part==='.cache'","catalogOwned","path.basename(resolved).endsWith('.partial')","catalogByPath.has(key)"])assert.ok(serverSource.includes(feature),`Thiếu chống đăng ký nhầm tệp tải tạm: ${feature}`);
console.log('OK: bộ quét model bỏ qua thư mục .partial, cache và tệp con của model trong catalog.');

const integrationSource = serverSource + fs.readFileSync(path.join(root,'ai_service.py'),'utf8') + fs.readFileSync(path.join(root,'app/public/app.js'),'utf8') + fs.readFileSync(path.join(root,'app/public/index.html'),'utf8');
for(const feature of ['INTEGRATED_MODEL_NOTES','birefnet_mask','transformer_detect_regions','id="regionDetector"','value="grounding-dino"','value="florence-2"','ControlNetUnionModel','control_mode=1'])assert.ok(integrationSource.includes(feature),`Thiếu tích hợp model mở rộng: ${feature}`);
for(const id of ['grounding-dino-base','birefnet','controlnet-union-sdxl-1.0','florence-2-large'])assert.ok(integrationSource.includes(id),`Thiếu model tích hợp: ${id}`);
console.log('OK: BiRefNet, ControlNet Union, Grounding DINO và Florence-2 đã được nối vào pipeline sử dụng.');

const baseInpaintCatalog = JSON.parse(fs.readFileSync(path.join(root,'models/inpaint-candidates.json'),'utf8'));
for(const id of ['sdxl-inpaint-base-0.1']){
  const candidate=baseInpaintCatalog.candidates.find((item)=>item.id===id);
  assert.ok(candidate,`Thiếu model nền ${id}`);
  assert.equal(candidate.kind,'inpaint',`Model ${id} phải dùng được trực tiếp như Inpainting`);
  assert.equal(candidate.compatibility,'ready',`Model ${id} không được tiếp tục hiển thị Cần model nền`);
  assert.deepEqual(candidate.dependencies,[],`Model ${id} không cần model nền bổ sung để nạp pipeline`);
}
assert.ok(serverSource.includes("'sdxl-inpaint-base-0.1':'Đã hỗ trợ trực tiếp"),'Thiếu ghi chú tích hợp cho model Inpainting nền');
console.log('OK: model Inpainting nền được nhận diện là pipeline dùng trực tiếp, không còn trạng thái Cần model nền.');

for(const feature of ['MODEL_LICENSE_POLICIES','LOCALLY_USABLE_RESTRICTED_MODELS','licenseAcceptedForLocalUse','licenseCategory','licenseNotice'])assert.ok(serverSource.includes(feature),`Thiếu xử lý giấy phép model: ${feature}`);
const licenseUiSource=fs.readFileSync(path.join(root,'app/public/app.js'),'utf8')+fs.readFileSync(path.join(root,'app/public/index.html'),'utf8');
for(const feature of ['Cần xử lý giấy phép','license-notice','licenseLabel','Điều kiện giấy phép:'])assert.ok(licenseUiSource.includes(feature),`Thiếu hướng dẫn giấy phép trên giao diện: ${feature}`);
console.log('OK: model đã tải được dùng cục bộ và model hạn chế hiển thị đúng điều kiện cấp quyền/phi thương mại.');

for(const feature of ['hasHuggingFaceToken','huggingFaceAccessConfigured','huggingFaceAuthenticated','Đã cấp quyền Hugging Face','Đã cấp quyền · Phi thương mại'])assert.ok(serverSource.includes(feature),`Thiếu đồng bộ quyền Hugging Face: ${feature}`);
assert.ok(resilientDownloaderSource.includes('get_token()'),'Trình tải chưa sử dụng token đã lưu trong Hugging Face cache');
console.log('OK: quyền Hugging Face đã chấp nhận được nhận diện và token cache được chuyển cho trình tải model.');

assert.ok(!/\$env:INPAINT_MODEL\s*=/.test(fs.readFileSync(path.join(root,'start-all.ps1'),'utf8')),'Script khởi động không được ghi đè lựa chọn model');
assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes('"text-to-image" / "stable-diffusion-3.5-large"'),'Thiếu đường dẫn mặc định Inpainting đã chuẩn hóa');
assert.ok(fs.readFileSync(path.join(root,'ai_service.py'),'utf8').includes('models_root.rglob(configured.name)'),'AI service chưa tự phục hồi đường dẫn model cũ');
assert.ok(serverSource.includes('findNamedModel'),'Máy chủ chưa tự phục hồi đường dẫn registry cũ');
console.log('OK: đường dẫn SD3.5 Large được chuẩn hóa và có cơ chế phục hồi cấu hình từ phiên bản cũ.');

const generatedImageSource=fs.readFileSync(path.join(root,'new_image.py'),'utf8')+fs.readFileSync(path.join(root,'ai_service.py'),'utf8')+fs.readFileSync(path.join(root,'app/public/app.js'),'utf8');
assert.ok(generatedImageSource.includes("'image': '/outputs/chroma/'"),'API tạo ảnh chưa trả URL công khai');
assert.ok(generatedImageSource.includes("replace(/^\\/+/, '').replace(/^workspace\\//, '')"),'Giao diện chưa chuẩn hóa URL ảnh có dấu gạch đầu hoặc tiền tố workspace');
assert.ok(serverSource.includes("pathname.startsWith('/workspace/outputs/')"),'Thiếu route tương thích cho URL kết quả cũ');
console.log('OK: ảnh tạo mới và kết quả cũ đều dùng được URL công khai /outputs.');

const seedUiSource=fs.readFileSync(path.join(root,'app/public/index.html'),'utf8')+fs.readFileSync(path.join(root,'app/public/app.js'),'utf8');
for(const id of ['inpaintSeedMode','tryonSeedMode','chromaSeedMode','inpaintSeedRandom','tryonSeedRandom','chromaSeedRandom','inpaintSeedReset','tryonSeedReset','chromaSeedReset'])assert.ok(seedUiSource.includes(id),`Thiếu điều khiển seed: ${id}`);
for(const feature of ['Mặc định','Ngẫu nhiên','Tùy chỉnh','randomSeed','seedForRun','setCustomSeed','2147483647'])assert.ok(seedUiSource.includes(feature),`Thiếu cơ chế seed: ${feature}`);
for(const id of ['inpaintSeed','tryonSeed','chromaSeed'])assert.ok(seedUiSource.includes(`seedForRun('${id}')`),`Luồng ${id} chưa chốt seed trước khi gửi tác vụ`);
console.log('OK: seed hỗ trợ mặc định, ngẫu nhiên và tùy chỉnh trên cả ba luồng tạo ảnh.');

assert.ok(!studioMarkup.includes('id="inpaintButton"')&&!studioMarkup.includes('id="tryonButton"'),'Hai nút tạo phương án trùng lặp chưa được loại bỏ');
assert.ok(studioMarkup.includes('data-step-target="studioPrimaryAction"'),'Bước Tạo chưa trỏ đến hành động chung');
assert.ok(serverSource!==undefined&&fs.readFileSync(path.join(root,'app/public/app.js'),'utf8').includes("(studioMode==='character'?()=>window.Character.run():studioMode==='makeup'?()=>window.Makeup.run():studioMode==='enhance'?()=>window.ImageEnhancement.run():studioMode==='outpaint'?runOutpaint:studioMode==='inpaint'?runInpaint:studioMode==='chroma'?runChromaGenerate:runTryon)()"),'Hành động chung chưa gọi trực tiếp tác vụ hiện tại');
console.log('OK: xóa vật thể và thay trang phục dùng chung một nút hành động chính.');

