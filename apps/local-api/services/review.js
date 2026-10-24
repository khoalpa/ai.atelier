'use strict';
const requireFromApp = require('node:module').createRequire(require('node:path').resolve(__dirname,'../../../app/server.js'));
// Dependencies: OUTPUTS_DIR, REFERENCES_DIR, RETRY_COMPARISONS, REVIEW_DIR, REVIEW_STATE, ROOT, callAiJson, crypto, decodeImageDataUrl, fs, parseJson, path, resolveSamplePath, safeJoin, send
module.exports = function createReview(deps) {
const require = requireFromApp;
const __dirname = require('node:path').join(deps.ROOT,'app');
function latestOutputBySource() {
  const latest = new Map();
  if (!deps.fs.existsSync(deps.OUTPUTS_DIR)) return latest;
  for (const entry of deps.fs.readdirSync(deps.OUTPUTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = deps.path.join(deps.OUTPUTS_DIR, entry.name);
    const metadataPath = deps.path.join(directory, 'metadata.json');
    const selectedPath = deps.path.join(directory, 'selected.png');
    if (!deps.fs.existsSync(metadataPath) || !deps.fs.existsSync(selectedPath)) continue;
    try {
      const metadata = JSON.parse(deps.fs.readFileSync(metadataPath, 'utf8'));
      if (!metadata.source || !metadata.selectedMetrics) continue;
      const previous = latest.get(metadata.source);
      if (!previous || String(metadata.createdAt) > String(previous.metadata.createdAt)) latest.set(metadata.source, { metadata, selectedPath });
    } catch {}
  }
  return latest;
}

function readReviewState() {
  if (!deps.fs.existsSync(deps.REVIEW_STATE)) return { schemaVersion: 2, updatedAt: null, items: {}, legacyItems: {} };
  const state=JSON.parse(deps.fs.readFileSync(deps.REVIEW_STATE, 'utf8'));
  if(Number(state.schemaVersion||1)>=2)return state;
  deps.fs.mkdirSync(deps.REVIEW_DIR,{recursive:true});const backup=deps.path.join(deps.REVIEW_DIR,`review-state-v1-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);deps.fs.copyFileSync(deps.REVIEW_STATE,backup);
  const migrated={schemaVersion:2,migratedAt:new Date().toISOString(),migrationBackup:deps.path.relative(deps.ROOT,backup),updatedAt:new Date().toISOString(),items:{},legacyItems:state.items||{}};
  deps.fs.writeFileSync(deps.REVIEW_STATE,JSON.stringify(migrated,null,2),'utf8');return migrated;
}

function reviewKey(category,sampleId){return `${category}:${sampleId}`;}

function writeReviewState(state) {
  deps.fs.mkdirSync(deps.REVIEW_DIR, { recursive: true });
  state.updatedAt = new Date().toISOString();
  deps.fs.writeFileSync(deps.REVIEW_STATE, JSON.stringify(state, null, 2), 'utf8');
}

async function updateReview(req, res) {
  try {
    const body = await deps.parseJson(req, 2 * 1024 * 1024);
    const updates = Array.isArray(body.items) ? body.items : [body];
    const state = readReviewState();
    const validStatuses = new Set(['pending', 'approved', 'retry', 'rejected']);
    for (const update of updates) {
      const sampleId = String(update.sampleId || '').replace(/\\/g, '/');
      const category=String(update.category||'');if(!['upper_body','lower_body','overall'].includes(category))throw new Error('Thiếu hoặc sai loại trang phục cho quyết định duyệt');
      const sample = deps.resolveSamplePath(sampleId);
      if (!sample || !deps.fs.existsSync(sample)) throw new Error(`Ảnh mẫu không tồn tại: ${sampleId}`);
      const status = String(update.status || 'pending');
      if (!validStatuses.has(status)) throw new Error(`Trạng thái không hợp lệ: ${status}`);
      const key=reviewKey(category,sampleId);const previous = state.items[key] || {};
      state.items[key] = {
        ...previous, category, sampleId, status, notes: String(update.notes ?? previous.notes ?? ''),
        defectLabels: Array.isArray(update.defectLabels) ? update.defectLabels.filter((label) => ['seam', 'color', 'texture', 'anatomy', 'collar', 'sleeves', 'waist', 'hem', 'layers', 'old-clothing'].includes(label)) : (previous.defectLabels || []),
        selected: String(update.selected ?? previous.selected ?? ''), reviewedAt: new Date().toISOString(),
      };
    }
    writeReviewState(state);
    deps.send(res, 200, JSON.stringify({ ok: true, state }));
  } catch (error) { deps.send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

async function exportApprovedManifest(req, res) {
  try {
    await deps.parseJson(req, 1024 * 1024);
    const state = readReviewState();
    const approved = Object.values(state.items).filter((item) => item.status === 'approved').map((item) => {
      const selected = String(item.selected || '').replace(/\\/g, '/');
      const file = selected ? deps.safeJoin(deps.ROOT, selected) : null;
      return { ...item, selectedExists: Boolean(file && file.startsWith(deps.OUTPUTS_DIR + deps.path.sep) && deps.fs.existsSync(file)) };
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    deps.fs.mkdirSync(deps.REVIEW_DIR, { recursive: true });
    const target = deps.path.join(deps.REVIEW_DIR, `approved-manifest-${stamp}.json`);
    const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), approvedCount: approved.length, items: approved };
    deps.fs.writeFileSync(target, JSON.stringify(manifest, null, 2), 'utf8');
    deps.send(res, 200, JSON.stringify({ ok: true, manifest: deps.path.relative(deps.ROOT, target), approvedCount: approved.length }));
  } catch (error) { deps.send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

async function calibrateQuality(req, res) {
  try {
    await deps.parseJson(req, 1024 * 1024);
    const state = readReviewState();
    const samples = [];
    for (const item of Object.values(state.items)) {
      if (!['approved', 'retry', 'rejected'].includes(item.status) || !item.selected) continue;
      const selected = deps.safeJoin(deps.ROOT, String(item.selected).replace(/\\/g, '/'));
      if (!selected || !selected.startsWith(deps.OUTPUTS_DIR + deps.path.sep)) continue;
      const metadataPath = deps.path.join(deps.path.dirname(selected), 'metadata.json');
      if (!deps.fs.existsSync(metadataPath)) continue;
      const metadata = JSON.parse(deps.fs.readFileSync(metadataPath, 'utf8'));
      if (!metadata.selectedMetrics) continue;
      samples.push({ sampleId: item.sampleId, label: item.status, qualityVersion:metadata.qualityVersion||1, defectLabels: item.defectLabels || [], ...metadata.selectedMetrics });
    }
    const qualityVersion = samples.some(item=>item.qualityVersion===2)?2:1;
    const approved = samples.filter((item) => item.label === 'approved' && item.qualityVersion===qualityVersion);
    const percentile = (values, ratio, fallback) => {
      const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
      return sorted.length ? sorted[Math.floor((sorted.length - 1) * ratio)] : fallback;
    };
    const recommendation = {
      minimumQuality: Number(percentile(approved.map((x) => x.qualityScore), 0.15, 75).toFixed(2)),
      minimumSimilarity: Number(percentile(approved.map((x) => x.referenceSimilarity), 0.15, 0.55).toFixed(4)),
      minimumSeam: Number(percentile(approved.map((x) => x.seamScore), 0.15, 65).toFixed(2)),
      minimumAnatomy: Number(percentile(approved.map((x) => x.anatomyScore), 0.15, 90).toFixed(2)),
    };
    const report = { schemaVersion: 2, qualityVersion, calibrationReady:approved.length>=10, createdAt: new Date().toISOString(), sampleCount: samples.length, approvedCount: approved.length, recommendation, samples };
    deps.fs.mkdirSync(deps.REVIEW_DIR, { recursive: true });
    const target = deps.path.join(deps.REVIEW_DIR, 'quality-calibration.json');
    deps.fs.writeFileSync(target, JSON.stringify(report, null, 2), 'utf8');
    deps.send(res, 200, JSON.stringify({ ok: true, report: deps.path.relative(deps.ROOT, target), ...report }));
  } catch (error) { deps.send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

async function calibrateWeights(req, res) {
  try {
    await deps.parseJson(req, 1024 * 1024);
    const state = readReviewState();
    const reviewed = Object.values(state.items).filter((item) => ['approved','retry','rejected'].includes(item.status));
    const counts = { seam: 0, color: 0, texture: 0, anatomy: 0, collar: 0, sleeves: 0, waist: 0 };
    for (const item of reviewed) for (const label of item.defectLabels || []) if (label in counts) counts[label] += 1;
    const raw = { visualQuality: 0.35, referenceSimilarity: 0.25, seamScore: 0.15 + counts.seam * 0.02, anatomyScore: 0.15 + counts.anatomy * 0.02, textureContinuity: 0.10 + counts.texture * 0.02 };
    const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
    const weights = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Number((value / total).toFixed(4))]));
    const report = { schemaVersion: 1, createdAt: new Date().toISOString(), reviewedCount: reviewed.length, labelCounts: counts, weights, regionPriorities: ['collar','sleeves','waist'].sort((a,b)=>counts[b]-counts[a]) };
    deps.fs.mkdirSync(deps.REVIEW_DIR, { recursive: true });
    const target = deps.path.join(deps.REVIEW_DIR, 'score-weights.json');
    deps.fs.writeFileSync(target, JSON.stringify(report, null, 2), 'utf8');
    deps.send(res, 200, JSON.stringify({ ok: true, report: deps.path.relative(deps.ROOT, target), ...report }));
  } catch (error) { deps.send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

function allBenchmarkReports() {
  if (!deps.fs.existsSync(deps.OUTPUTS_DIR)) return null;
  const reports = [];
  for (const entry of deps.fs.readdirSync(deps.OUTPUTS_DIR, { withFileTypes: true })) {
    const target = deps.path.join(deps.OUTPUTS_DIR, entry.name, 'batch-report.json');
    if (!entry.isDirectory() || !deps.fs.existsSync(target)) continue;
    try { const report = JSON.parse(deps.fs.readFileSync(target, 'utf8')); if (report.benchmark) reports.push({ target, report }); } catch {}
  }
  return reports.sort((a,b)=>String(b.report.createdAt).localeCompare(String(a.report.createdAt)));
}

function latestBenchmarkReportsByCategory(){const latest={};for(const entry of allBenchmarkReports()||[])if(!latest[entry.report.category])latest[entry.report.category]=entry;return latest;}

function latestBenchmarkReport(category=''){const reports=allBenchmarkReports()||[];return reports.find((entry)=>!category||entry.report.category===category)||null;}

function benchmarkReview(res,category) {
  const latest = latestBenchmarkReport(category);
  if (!latest) return deps.send(res, 404, JSON.stringify({ ok: false, error: 'Chưa có benchmark' }));
  const state = readReviewState();
  const items = latest.report.items.map((item) => {
    const key=reviewKey(latest.report.category,item.sampleId);const review = state.items[key] || { category:latest.report.category,status: 'pending', defectLabels: [] };
    const suggestedRegion = review.defectLabels?.find((label)=>['collar','sleeves','waist'].includes(label)) || (latest.report.category === 'lower_body' ? 'waist' : Number(item.seamScore) < 80 ? 'collar' : Number(item.textureContinuity) < 82 ? 'sleeves' : 'auto');
    return { ...item, category:latest.report.category,sourceUrl: `/samples/${item.sampleId}`, resultUrl: '/' + String(item.selected).replace(/\\/g, '/').replace(/^workspace\//, ''), review, suggestedRegion };
  });
  const counts = items.reduce((result,item)=>{const status=item.review.status||'pending';result[status]=(result[status]||0)+1;return result;},{pending:0,approved:0,retry:0,rejected:0});
  deps.send(res, 200, JSON.stringify({ ok: true, report: deps.path.relative(deps.ROOT, latest.target), total: items.length, counts, items }));
}

function reviewReadiness(res) {
  const state=readReviewState();const items=Object.values(state.items);const reviewed=items.filter((item)=>['approved','retry','rejected'].includes(item.status));const labeled=reviewed.filter((item)=>(item.defectLabels||[]).length>0);
  const latest=latestBenchmarkReportsByCategory();const categories=['upper_body','lower_body','overall'];const expected=categories.flatMap((category)=>(latest[category]?.report?.items||[]).map((item)=>({category,sampleId:item.sampleId})));
  const pending=expected.filter(({category,sampleId})=>!['approved','retry','rejected'].includes(state.items[reviewKey(category,sampleId)]?.status));const perCategory=Object.fromEntries(categories.map((category)=>{const categoryItems=expected.filter((item)=>item.category===category);const categoryReviews=categoryItems.map((item)=>state.items[reviewKey(category,item.sampleId)]).filter(Boolean);return[category,{total:categoryItems.length,reviewed:categoryReviews.filter((item)=>['approved','retry','rejected'].includes(item.status)).length,approved:categoryReviews.filter((item)=>item.status==='approved').length,pending:categoryItems.length-categoryReviews.filter((item)=>['approved','retry','rejected'].includes(item.status)).length}];}));
  const profilePath=deps.path.join(deps.REVIEW_DIR,'reference-profiles.json');const profiles=deps.fs.existsSync(profilePath)?JSON.parse(deps.fs.readFileSync(profilePath,'utf8')).profiles||{}:{};
  const references=Object.fromEntries(['upper_body','lower_body','overall'].map((category)=>[category,profiles[category]?.specializedReferenceRequired===false]));
  const activeWeights=deps.fs.existsSync(deps.path.join(deps.REVIEW_DIR,'active-score-weights.json'));const blockers=[];
  if(pending.length)blockers.push(`Còn ${pending.length} ảnh chưa duyệt`);if(reviewed.length<5)blockers.push('Cần ít nhất 5 ảnh đã duyệt để đánh giá trọng số');if(labeled.length<3)blockers.push('Cần ít nhất 3 ảnh có nhãn lỗi để kích hoạt trọng số');
  for(const [category,ready] of Object.entries(references))if(!ready)blockers.push(`Thiếu ảnh tham chiếu chuyên biệt: ${category}`);if(!activeWeights)blockers.push('Trọng số hiệu chỉnh chưa được kích hoạt');
  deps.send(res,200,JSON.stringify({ok:true,schemaVersion:state.schemaVersion,total:expected.length,reviewed:reviewed.length,pending:pending.length,approved:reviewed.filter((item)=>item.status==='approved').length,retry:reviewed.filter((item)=>item.status==='retry').length,rejected:reviewed.filter((item)=>item.status==='rejected').length,labeled:labeled.length,next:pending[0]||null,perCategory,references,activeWeights,legacyCount:Object.keys(state.legacyItems||{}).length,ready:blockers.length===0,blockers}));
}

async function buildRetryPlan(req,res) {
  try {
    const body=await deps.parseJson(req,1024*1024);const category=String(body.category||'upper_body');if(!['upper_body','lower_body','overall'].includes(category))throw new Error('Loại trang phục không hợp lệ');
    const state=readReviewState();const items=Object.values(state.items).filter((item)=>item.category===category&&item.status==='retry').map((item)=>{
      const labels=item.defectLabels||[];const region=labels.find((label)=>['collar','sleeves','waist'].includes(label))||'auto';
      const strategy=labels.includes('anatomy')?'pose-and-structure':labels.includes('texture')||labels.includes('color')?'texture-fidelity':labels.includes('seam')||region!=='auto'?'targeted-seam':'balanced';
      const settings={count:2,steps:strategy==='texture-fidelity'?40:35,guidance:strategy==='texture-fidelity'?3:2.5,maxRetries:2,usePose:strategy==='pose-and-structure',repairSeams:true,generativeRefine:strategy==='targeted-seam',refineRegion:region,minimumSimilarity:strategy==='texture-fidelity'?.65:.55,minimumAnatomy:strategy==='pose-and-structure'?95:90};
      return{sampleId:item.sampleId,oldSelected:item.selected||'',defectLabels:labels,strategy,category,settings};
    });
    deps.send(res,200,JSON.stringify({ok:true,count:items.length,items}));
  } catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
}

function readRetryComparisons(){return deps.fs.existsSync(deps.RETRY_COMPARISONS)?JSON.parse(deps.fs.readFileSync(deps.RETRY_COMPARISONS,'utf8')):{schemaVersion:1,updatedAt:null,items:[]};}

async function saveRetryComparison(req,res){
  try{
    const body=await deps.parseJson(req,2*1024*1024);const sampleId=String(body.sampleId||'').replace(/\\/g,'/');const sample=deps.resolveSamplePath(sampleId);if(!sample||!deps.fs.existsSync(sample))throw new Error('Ảnh mẫu không tồn tại');
    const newSelected=String(body.newSelected||'').replace(/\\/g,'/');const newFile=deps.safeJoin(deps.ROOT,newSelected);if(!newFile||!deps.fs.existsSync(newFile))throw new Error('Kết quả chạy lại không tồn tại');
    const data=readRetryComparisons();const entry={sampleId,oldSelected:String(body.oldSelected||''),newSelected,strategy:String(body.strategy||'balanced'),defectLabels:Array.isArray(body.defectLabels)?body.defectLabels:[],metrics:body.metrics||null,createdAt:new Date().toISOString(),promoted:false};
    data.items=data.items.filter((item)=>item.sampleId!==sampleId);data.items.push(entry);data.updatedAt=new Date().toISOString();deps.fs.mkdirSync(deps.REVIEW_DIR,{recursive:true});deps.fs.writeFileSync(deps.RETRY_COMPARISONS,JSON.stringify(data,null,2),'utf8');deps.send(res,200,JSON.stringify({ok:true,entry}));
  }catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
}

function listRetryComparisons(res){const data=readRetryComparisons();const items=data.items.map((item)=>({...item,oldUrl:item.oldSelected?'/'+item.oldSelected.replace(/^workspace\//,''):null,newUrl:'/'+item.newSelected.replace(/^workspace\//,'')}));deps.send(res,200,JSON.stringify({ok:true,...data,items}));}

async function compareScoreWeights(req, res) {
  try {
    await deps.parseJson(req, 1024 * 1024);
    const latest = latestBenchmarkReport();
    if (!latest) throw new Error('Chưa có benchmark');
    const weightPath = deps.path.join(deps.REVIEW_DIR, 'score-weights.json');
    const calibrated = deps.fs.existsSync(weightPath) ? JSON.parse(deps.fs.readFileSync(weightPath,'utf8')).weights : { visualQuality:.35,referenceSimilarity:.25,seamScore:.15,anatomyScore:.15,textureContinuity:.10 };
    const defaults = { visualQuality:.35,referenceSimilarity:.25,seamScore:.15,anatomyScore:.15,textureContinuity:.10 };
    const score = (item,w) => item.qualityScore*w.visualQuality + item.referenceSimilarity*100*w.referenceSimilarity + item.seamScore*w.seamScore + item.anatomyScore*w.anatomyScore + item.textureContinuity*w.textureContinuity;
    const items = latest.report.items.map((item)=>({sampleId:item.sampleId,defaultScore:Number(score(item,defaults).toFixed(4)),calibratedScore:Number(score(item,calibrated).toFixed(4))})).map((item)=>({...item,delta:Number((item.calibratedScore-item.defaultScore).toFixed(4))}));
    const report={schemaVersion:1,createdAt:new Date().toISOString(),category:latest.report.category,count:items.length,defaultWeights:defaults,calibratedWeights:calibrated,averageDelta:Number((items.reduce((sum,item)=>sum+item.delta,0)/Math.max(1,items.length)).toFixed(4)),items};
    const target=deps.path.join(deps.REVIEW_DIR,'weight-ab-report.json');deps.fs.writeFileSync(target,JSON.stringify(report,null,2),'utf8');
    deps.send(res,200,JSON.stringify({ok:true,report:deps.path.relative(deps.ROOT,target),...report}));
  } catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
}

async function activateScoreWeights(req, res) {
  try {
    await deps.parseJson(req, 1024 * 1024);
    const latestByCategory=latestBenchmarkReportsByCategory();if(!Object.keys(latestByCategory).length)throw new Error('Chưa có benchmark để so sánh');
    const state = readReviewState();
    const reviewed = Object.values(state.items).filter((item) => ['approved','retry','rejected'].includes(item.status));
    const labeled = reviewed.filter((item) => (item.defectLabels || []).length > 0);
    if (reviewed.length < 5 || labeled.length < 3) {
      return deps.send(res, 409, JSON.stringify({ ok:false, error:`Chưa đủ bằng chứng: cần ít nhất 5 ảnh đã duyệt và 3 ảnh có nhãn lỗi; hiện có ${reviewed.length} và ${labeled.length}.` }));
    }
    const weightPath = deps.path.join(deps.REVIEW_DIR, 'score-weights.json');
    if (!deps.fs.existsSync(weightPath)) throw new Error('Chưa có trọng số đề xuất');
    const proposal = JSON.parse(deps.fs.readFileSync(weightPath, 'utf8'));
    const defaults = { visualQuality:.35,referenceSimilarity:.25,seamScore:.15,anatomyScore:.15,textureContinuity:.10 };
    const score = (item,w) => Number(item.qualityScore||0)*w.visualQuality + Number(item.referenceSimilarity||0)*100*w.referenceSimilarity + Number(item.seamScore||0)*w.seamScore + Number(item.anatomyScore||0)*w.anatomyScore + Number(item.textureContinuity||0)*w.textureContinuity;
    const reportItems = new Map(Object.entries(latestByCategory).flatMap(([category,entry])=>(entry.report.items||[]).map((item)=>[reviewKey(category,item.sampleId),item])));
    const evidence = reviewed.map((review) => ({ review, item: reportItems.get(reviewKey(review.category,review.sampleId)) })).filter((entry) => entry.item);
    if (evidence.length < 5) return deps.send(res, 409, JSON.stringify({ok:false,error:'Benchmark gần nhất không chứa đủ 5 ảnh đã duyệt để đánh giá A/B.'}));
    const utility = (entry,w) => entry.review.status === 'approved' ? score(entry.item,w) : 100-score(entry.item,w);
    const defaultUtility = evidence.reduce((sum,entry)=>sum+utility(entry,defaults),0)/evidence.length;
    const candidateUtility = evidence.reduce((sum,entry)=>sum+utility(entry,proposal.weights),0)/evidence.length;
    const improvement = candidateUtility-defaultUtility;
    if (improvement < 0.1) return deps.send(res,409,JSON.stringify({ok:false,error:`Trọng số chưa cải thiện A/B đủ 0,1 điểm (hiện ${improvement.toFixed(4)}); không kích hoạt.`}));
    const active = {...proposal, activatedAt:new Date().toISOString(), evidenceCount:evidence.length, labeledCount:labeled.length, utilityImprovement:Number(improvement.toFixed(4))};
    const target = deps.path.join(deps.REVIEW_DIR,'active-score-weights.json');
    deps.fs.writeFileSync(target,JSON.stringify(active,null,2),'utf8');
    deps.send(res,200,JSON.stringify({ok:true,report:deps.path.relative(deps.ROOT,target),...active}));
  } catch(error) { deps.send(res,400,JSON.stringify({ok:false,error:error.message})); }
}

async function confirmDefaultWeights(req,res){
  try{const body=await deps.parseJson(req,1024*1024);if(body.confirm!==true)throw new Error('Cần xác nhận rõ ràng');const state=readReviewState();const categories=['upper_body','lower_body','overall'];const items=Object.values(state.items);const approvedByCategory=Object.fromEntries(categories.map((category)=>[category,items.filter((item)=>item.category===category&&item.status==='approved').length]));if(!categories.every((category)=>approvedByCategory[category]>=23))return deps.send(res,409,JSON.stringify({ok:false,error:'Chỉ có thể xác nhận trọng số mặc định sau khi đủ 23 ảnh được chấp nhận ở cả ba loại.'}));const labeled=items.filter((item)=>(item.defectLabels||[]).length>0);if(labeled.length)return deps.send(res,409,JSON.stringify({ok:false,error:'Đã có nhãn lỗi; hãy dùng quy trình hiệu chỉnh và A/B.'}));const active={schemaVersion:1,activatedAt:new Date().toISOString(),mode:'default-no-calibration-required',reason:'69 trường hợp đã chấp nhận và không có nhãn lỗi',weights:{visualQuality:.35,referenceSimilarity:.25,seamScore:.15,anatomyScore:.15,textureContinuity:.10}};const target=deps.path.join(deps.REVIEW_DIR,'active-score-weights.json');deps.fs.writeFileSync(target,JSON.stringify(active,null,2),'utf8');deps.send(res,200,JSON.stringify({ok:true,report:deps.path.relative(deps.ROOT,target),...active}));}catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
}

async function saveReferenceProfile(req,res) {
  try {
    const body = await deps.parseJson(req,30*1024*1024);
    const category = String(body.category || '');
    if (!['upper_body','lower_body','overall'].includes(category)) throw new Error('Loại trang phục không hợp lệ');
    const decoded = deps.decodeImageDataUrl(body.image);
    const automated = await deps.callAiJson('/validate-product-reference',{category,image:body.image});
    const validation = require('./product-reference-review').applyProductReview(automated,body.productReview,deps.crypto.createHash('sha256').update(decoded.buffer).digest('hex'));
    if(!validation.accepted)return deps.send(res,422,JSON.stringify({ok:false,error:'Ảnh tham chiếu không đạt cổng kiểm định',validation}));
    const directory = deps.path.join(deps.REFERENCES_DIR,category);deps.fs.mkdirSync(directory,{recursive:true});
    for(const name of deps.fs.readdirSync(directory)) if(/^reference\.(png|jpe?g|webp)$/i.test(name)) deps.fs.unlinkSync(deps.path.join(directory,name));
    const target = deps.path.join(directory,`reference.${decoded.extension}`);deps.fs.writeFileSync(target,decoded.buffer);
    const profilePath=deps.path.join(deps.REVIEW_DIR,'reference-profiles.json');deps.fs.mkdirSync(deps.REVIEW_DIR,{recursive:true});
    const profiles=deps.fs.existsSync(profilePath)?JSON.parse(deps.fs.readFileSync(profilePath,'utf8')):{schemaVersion:1,profiles:{}};
    const manifest=deps.path.join(directory,'manifest.json');deps.fs.writeFileSync(manifest,JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),category,reference:deps.path.relative(deps.ROOT,target).replace(/\\/g,'/'),validation},null,2),'utf8');
    profiles.profiles=profiles.profiles||{};profiles.profiles[category]={...(profiles.profiles[category]||{}),status:'validated-product-reference',specializedReferenceRequired:false,reference:deps.path.relative(deps.ROOT,target).replace(/\\/g,'/'),manifest:deps.path.relative(deps.ROOT,manifest).replace(/\\/g,'/'),validation,updatedAt:new Date().toISOString()};profiles.updatedAt=new Date().toISOString();
    deps.fs.writeFileSync(profilePath,JSON.stringify(profiles,null,2),'utf8');
    deps.send(res,200,JSON.stringify({ok:true,category,reference:deps.path.relative(deps.ROOT,target),manifest:deps.path.relative(deps.ROOT,manifest),validation}));
  } catch(error) { deps.send(res,400,JSON.stringify({ok:false,error:error.message})); }
}

function referenceReadinessPayload() {
  const categories=['upper_body','lower_body','overall'];const profilePath=deps.path.join(deps.REVIEW_DIR,'reference-profiles.json');const document=deps.fs.existsSync(profilePath)?JSON.parse(deps.fs.readFileSync(profilePath,'utf8')):{profiles:{}};
  const items=categories.map((category)=>{const profile=document.profiles?.[category]||{};const validation=profile.validation||{};const reference=profile.reference||'';const target=reference?deps.safeJoin(deps.ROOT,reference):null;const exists=Boolean(target&&deps.fs.existsSync(target)&&deps.fs.statSync(target).isFile());let digest='',checksumMatches=false;if(exists){digest=deps.crypto.createHash('sha256').update(deps.fs.readFileSync(target)).digest('hex');checksumMatches=Boolean(validation.accepted&&validation.metrics?.sha256&&digest===validation.metrics.sha256);}const qualificationReport=profile.qualificationReport||'';const qualificationTarget=qualificationReport?deps.safeJoin(deps.ROOT,qualificationReport):null;let qualification=null;try{if(qualificationTarget&&deps.fs.existsSync(qualificationTarget))qualification=JSON.parse(deps.fs.readFileSync(qualificationTarget,'utf8'));}catch{}const canonical=['characters/c001.png','characters/c002.png','characters/c003.png'];const qualificationMatches=Boolean(qualification&&qualification.passed===true&&qualification.category===category&&qualification.reference===reference&&qualification.referenceSha256===digest&&qualification.validationSha256===validation.metrics?.sha256&&qualification.requiredCount===3&&qualification.passedCount===3&&JSON.stringify(qualification.qualificationSamples)===JSON.stringify(canonical));const blockers=[];if(!validation.accepted)blockers.push('Chưa qua kiểm định sản phẩm');if(!reference)blockers.push('Chưa có tệp reference');else if(!exists)blockers.push('Tệp reference không tồn tại');if(exists&&validation.accepted&&!checksumMatches)blockers.push('Checksum không khớp manifest');if(profile.status!=='qualified')blockers.push('Chưa đạt smoke qualification');else if(!qualificationMatches)blockers.push('Báo cáo qualification thiếu, cũ hoặc không khớp reference hiện tại');if(profile.specializedReferenceRequired!==false)blockers.push('Profile chưa được kích hoạt');return{category,ready:blockers.length===0,status:profile.status||'missing',reference,referenceSha256:digest,manifest:profile.manifest||'',qualificationReport,qualificationMatches,checksumMatches,metrics:validation.metrics||null,blockers};});
  for(const item of items){
    const profile=document.profiles?.[item.category]||{};
    const candidate=profile.normalizedReference;
    const target=candidate?deps.safeJoin(deps.ROOT,candidate):null;
    item.experimentalReference=target&&deps.fs.existsSync(target)&&deps.fs.statSync(target).isFile()?candidate:'';
    item.reason=profile.reason||'';
  }
  return{ok:true,schemaVersion:1,updatedAt:document.updatedAt||null,allReady:items.every((item)=>item.ready),readyCount:items.filter((item)=>item.ready).length,total:items.length,items,blockers:items.flatMap((item)=>item.blockers.map((reason)=>`${item.category}: ${reason}`))};
}

function referenceReadiness(res){deps.send(res,200,JSON.stringify(referenceReadinessPayload()));}

async function benchmarkWithPreflight(req,res){
  try{const body=await deps.parseJson(req,30*1024*1024);const category=String(body.category||'upper_body');const readiness=referenceReadinessPayload();const item=readiness.items.find((entry)=>entry.category===category);if(!item?.ready)return deps.send(res,409,JSON.stringify({ok:false,error:`Benchmark bị chặn: reference ${category} chưa sẵn sàng`,preflight:item,readiness}));const target=deps.safeJoin(deps.ROOT,item.reference);const extension=deps.path.extname(target).toLowerCase();const mime=extension==='.png'?'image/png':extension==='.webp'?'image/webp':'image/jpeg';body.garmentImage=`data:${mime};base64,${deps.fs.readFileSync(target).toString('base64')}`;body.benchmarkProvenance={schemaVersion:1,category,reference:item.reference,referenceSha256:item.referenceSha256,qualificationReport:item.qualificationReport,qualificationPassed:true};const result=await deps.callAiJson('/benchmark',body);deps.send(res,200,JSON.stringify({...result,preflight:body.benchmarkProvenance}));}catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
}

async function releaseAcceptance(req,res){
  try{
    await deps.parseJson(req,1024*1024);
    const reports=[];
    if(deps.fs.existsSync(deps.OUTPUTS_DIR))for(const entry of deps.fs.readdirSync(deps.OUTPUTS_DIR,{withFileTypes:true})){
      const target=deps.path.join(deps.OUTPUTS_DIR,entry.name,'batch-report.json');if(!entry.isDirectory()||!deps.fs.existsSync(target))continue;
      try{const report=JSON.parse(deps.fs.readFileSync(target,'utf8'));if(report.benchmark)reports.push({target,report});}catch{}
    }
    reports.sort((a,b)=>String(b.report.createdAt).localeCompare(String(a.report.createdAt)));
    const latest={};for(const entry of reports)if(!latest[entry.report.category])latest[entry.report.category]=entry;
    const categories=['upper_body','lower_body','overall'];const readiness=referenceReadinessPayload();
    const checks=categories.map((category)=>{const entry=latest[category],reference=readiness.items.find((item)=>item.category===category);if(!entry)return{category,passed:false,reasons:['Thiếu benchmark']};const items=entry.report.items||[];const avg=(key)=>items.reduce((sum,item)=>sum+Number(item[key]||0),0)/Math.max(1,items.length);const values={qualityScore:avg('qualityScore'),referenceSimilarity:avg('referenceSimilarity'),seamScore:avg('seamScore'),anatomyScore:avg('anatomyScore')};const reasons=[];const provenance=entry.report.benchmarkProvenance||{};if(!reference?.ready)reasons.push(...(reference?.blockers||['Reference chưa sẵn sàng']).map((reason)=>`Reference: ${reason}`));if(provenance.category!==category||provenance.reference!==reference?.reference||provenance.referenceSha256!==reference?.referenceSha256||provenance.qualificationReport!==reference?.qualificationReport||provenance.qualificationPassed!==true)reasons.push('Benchmark không gắn với qualification/reference hiện tại');if(entry.report.completed!==23||entry.report.failed||items.length!==23||new Set(items.map((item)=>item.sampleId)).size!==23)reasons.push('Benchmark chưa đủ 23 ảnh duy nhất hoặc còn lỗi');if(values.qualityScore<90)reasons.push('Điểm tổng dưới 90');if(values.referenceSimilarity<.60)reasons.push('Độ giống dưới 0,60');if(values.seamScore<80)reasons.push('Điểm biên dưới 80');if(values.anatomyScore<95)reasons.push('Điểm hình thể dưới 95');if(Number(entry.report.performance?.peakVramMb||0)>8192)reasons.push('VRAM vượt 8 GB');return{category,passed:!reasons.length,values,performance:entry.report.performance,report:deps.path.relative(deps.ROOT,entry.target),benchmarkProvenance:provenance,reasons};});
    const state=readReviewState();const approvedByCategory=Object.fromEntries(categories.map((category)=>[category,Object.values(state.items).filter((item)=>item.category===category&&item.status==='approved').length]));const approved=Object.values(approvedByCategory).reduce((sum,value)=>sum+value,0);
    const referenceReady=readiness.allReady;
    const technicalPassed=checks.every((item)=>item.passed);const contentReady=categories.every((category)=>approvedByCategory[category]>=23)&&referenceReady;
    const benchmarkBlockers=checks.flatMap((check)=>check.reasons.filter((reason)=>!reason.startsWith('Reference: ')).map((reason)=>`${check.category}: ${reason}`));const blockers=[...readiness.blockers,...benchmarkBlockers,...categories.filter((category)=>approvedByCategory[category]<23).map((category)=>`${category}: mới duyệt ${approvedByCategory[category]}/23 ảnh`)];const report={schemaVersion:3,createdAt:new Date().toISOString(),technicalPassed,contentReady,referenceReady,approvedCount:approved,approvedByCategory,status:technicalPassed&&contentReady?'passed':technicalPassed?'technical-pass-review-pending':'failed',referenceReadiness:readiness,blockers:[...new Set(blockers)],checks};
    const target=deps.path.join(deps.REVIEW_DIR,'release-acceptance.json');deps.fs.writeFileSync(target,JSON.stringify(report,null,2),'utf8');deps.send(res,200,JSON.stringify({ok:true,report:deps.path.relative(deps.ROOT,target),...report}));
  }catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
}

async function buildGoldenBaseline(req, res) {
  try {
    await deps.parseJson(req, 1024 * 1024);
    const state = readReviewState();
    const cases = [];
    for (const item of Object.values(state.items).filter((entry) => entry.status === 'approved' && entry.selected)) {
      const selected = deps.safeJoin(deps.ROOT, String(item.selected).replace(/\\/g, '/'));
      if (!selected || !selected.startsWith(deps.OUTPUTS_DIR + deps.path.sep) || !deps.fs.existsSync(selected)) continue;
      const metadataPath = deps.path.join(deps.path.dirname(selected), 'metadata.json');
      const metadata = deps.fs.existsSync(metadataPath) ? JSON.parse(deps.fs.readFileSync(metadataPath, 'utf8')) : {};
      cases.push({
        sampleId: item.sampleId, category: metadata.category || item.category, qualityVersion: metadata.qualityVersion || 1, selected: deps.path.relative(deps.ROOT, selected),
        sha256: deps.crypto.createHash('sha256').update(deps.fs.readFileSync(selected)).digest('hex'),
        metrics: metadata.selectedMetrics || null, defectLabels: item.defectLabels || [],
      });
    }
    const baseline = { schemaVersion: 1, appVersion: '1.1.0', createdAt: new Date().toISOString(), caseCount: cases.length, cases };
    deps.fs.mkdirSync(deps.REVIEW_DIR, { recursive: true });
    const target = deps.path.join(deps.REVIEW_DIR, 'golden-baseline.json');
    deps.fs.writeFileSync(target, JSON.stringify(baseline, null, 2), 'utf8');
    deps.send(res, 200, JSON.stringify({ ok: true, baseline: deps.path.relative(deps.ROOT, target), ...baseline }));
  } catch (error) { deps.send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

async function compareGoldenBaseline(req, res) {
  try {
    await deps.parseJson(req, 1024 * 1024);
    const baselinePath = deps.path.join(deps.REVIEW_DIR, 'golden-baseline.json');
    if (!deps.fs.existsSync(baselinePath)) throw new Error('Chưa có bộ ảnh chuẩn');
    const baseline = JSON.parse(deps.fs.readFileSync(baselinePath, 'utf8'));
    const latest = latestOutputBySource();
    const keys = ['qualityScore', 'referenceSimilarity', 'seamScore', 'anatomyScore', 'textureContinuity'];
    const limits = { qualityScore: -3, referenceSimilarity: -0.03, seamScore: -5, anatomyScore: -3, textureContinuity: -5 };
    const cases = baseline.cases.map((base) => {
      const candidate = latest.get(base.sampleId);
      if (!candidate || !base.metrics) return { sampleId: base.sampleId, status: 'missing-metrics', baseline: base.selected, current: candidate ? deps.path.relative(deps.ROOT, candidate.selectedPath) : null, deltas: {}, warnings: ['Thiếu chỉ số để so sánh'] };
      if((base.qualityVersion||1)!==(candidate.metadata.qualityVersion||1)||(base.category&&base.category!==candidate.metadata.category))return {sampleId:base.sampleId,status:'missing-metrics',baseline:base.selected,current:deps.path.relative(deps.ROOT,candidate.selectedPath),deltas:{},warnings:['Khác phiên bản chấm điểm hoặc loại trang phục; cần bộ chuẩn tương ứng.']};
      const deltas = Object.fromEntries(keys.map((key) => [key, Number(((candidate.metadata.selectedMetrics[key] ?? 0) - (base.metrics[key] ?? 0)).toFixed(5))]));
      const warnings = keys.filter((key) => deltas[key] < limits[key]).map((key) => `${key}: ${deltas[key]}`);
      return { sampleId: base.sampleId, status: warnings.length ? 'regressed' : 'passed', baseline: base.selected, current: deps.path.relative(deps.ROOT, candidate.selectedPath), deltas, warnings };
    });
    const report = { schemaVersion: 1, createdAt: new Date().toISOString(), baselineCreatedAt: baseline.createdAt, total: cases.length, passed: cases.filter((item) => item.status === 'passed').length, regressed: cases.filter((item) => item.status === 'regressed').length, missing: cases.filter((item) => item.status === 'missing-metrics').length, cases };
    deps.fs.mkdirSync(deps.REVIEW_DIR, { recursive: true });
    const jsonTarget = deps.path.join(deps.REVIEW_DIR, 'regression-comparison.json');
    const htmlTarget = deps.path.join(deps.REVIEW_DIR, 'regression-report.html');
    deps.fs.writeFileSync(jsonTarget, JSON.stringify(report, null, 2), 'utf8');
    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
    const imageUrl = (relative) => relative ? '/' + String(relative).replace(/\\/g, '/').replace(/^workspace\//, '') : '';
    const rows = cases.map((item) => `<article><h2>${escape(item.sampleId)} — ${escape(item.status)}</h2><div class="images"><figure><img src="${escape(imageUrl(item.baseline))}"><figcaption>Baseline</figcaption></figure><figure><img src="${escape(imageUrl(item.current))}"><figcaption>Mới nhất</figcaption></figure></div><pre>${escape(JSON.stringify(item.deltas, null, 2))}</pre><p>${escape(item.warnings.join(' · ') || 'Không phát hiện suy giảm')}</p></article>`).join('');
    deps.fs.writeFileSync(htmlTarget, `<!doctype html><meta charset="utf-8"><title>Báo cáo hồi quy hình ảnh</title><style>body{font:15px system-ui;background:#111;color:#eee;max-width:1100px;margin:auto;padding:24px}article{border:1px solid #444;padding:16px;margin:16px 0}.images{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%}pre{white-space:pre-wrap}</style><h1>Báo cáo hồi quy</h1><p>${report.passed}/${report.total} đạt · ${report.regressed} suy giảm · ${report.missing} thiếu dữ liệu</p>${rows}`, 'utf8');
    deps.send(res, 200, JSON.stringify({ ok: true, json: deps.path.relative(deps.ROOT, jsonTarget), html: deps.path.relative(deps.ROOT, htmlTarget), ...report }));
  } catch (error) { deps.send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

async function buildQualityDashboard(req, res) {
  try {
    await deps.parseJson(req, 1024 * 1024);
    const reports = [];
    if (deps.fs.existsSync(deps.OUTPUTS_DIR)) for (const entry of deps.fs.readdirSync(deps.OUTPUTS_DIR, { withFileTypes: true })) {
      const reportPath = deps.path.join(deps.OUTPUTS_DIR, entry.name, 'batch-report.json');
      if (!entry.isDirectory() || !deps.fs.existsSync(reportPath)) continue;
      try { const report = JSON.parse(deps.fs.readFileSync(reportPath, 'utf8')); if (report.benchmark) reports.push({ reportPath, ...report }); } catch {}
    }
    reports.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const latest = reports[0] || null;
    const latestByCategory = {};
    for (const report of reports) if (!latestByCategory[report.category]) latestByCategory[report.category] = report;
    const items = latest?.items || [];
    const average = (key) => items.length ? items.reduce((sum, item) => sum + Number(item[key] || 0), 0) / items.length : 0;
    const metrics = Object.fromEntries(['qualityScore','referenceSimilarity','seamScore','anatomyScore','textureContinuity'].map((key) => [key, Number(average(key).toFixed(4))]));
    const summarize = (subset) => ({ count: subset.length, qualityScore: Number((subset.reduce((sum,item)=>sum+Number(item.qualityScore||0),0)/Math.max(1,subset.length)).toFixed(4)), seamScore: Number((subset.reduce((sum,item)=>sum+Number(item.seamScore||0),0)/Math.max(1,subset.length)).toFixed(4)), averageSeconds: Number((subset.reduce((sum,item)=>sum+Number(item.durationSeconds||0),0)/Math.max(1,subset.length)).toFixed(3)) });
    const groups = {
      characters: summarize(items.filter((item)=>String(item.sampleId).startsWith('characters/'))),
      landscape: summarize(items.filter((item)=>String(item.sampleId).startsWith('landscape/'))),
      portrait: summarize(items.filter((item)=>String(item.sampleId).startsWith('portrait/'))),
      lowerMaskConfidence: summarize(items.filter((item)=>Number(item.autoMaskScore||0)<0.7)),
      higherMaskConfidence: summarize(items.filter((item)=>Number(item.autoMaskScore||0)>=0.7)),
    };
    const recommendations = {
      upper_body: { count: metrics.qualityScore && metrics.qualityScore < 85 ? 4 : 2, steps: metrics.seamScore && metrics.seamScore < 75 ? 42 : 35, guidance: 2.5, maxSide: 960, repairSeams: true },
      lower_body: { count: 2, steps: 38, guidance: 2.5, maxSide: 960, repairSeams: true, refineRegion: 'waist' },
      overall: { count: 4, steps: 42, guidance: 3, maxSide: 1024, repairSeams: true },
    };
    const categoryBenchmarks = Object.fromEntries(Object.entries(latestByCategory).map(([category, report]) => {
      const categoryItems = report.items || [];
      const avg = (key) => Number((categoryItems.reduce((sum,item)=>sum+Number(item[key]||0),0)/Math.max(1,categoryItems.length)).toFixed(4));
      return [category, { report:deps.path.relative(deps.ROOT,report.reportPath), count:categoryItems.length, qualityScore:avg('qualityScore'), referenceSimilarity:avg('referenceSimilarity'), seamScore:avg('seamScore'), anatomyScore:avg('anatomyScore'), textureContinuity:avg('textureContinuity'), performance:report.performance }];
    }));
    const payload = { schemaVersion: 1, createdAt: new Date().toISOString(), benchmarkCount: reports.length, latestReport: latest ? deps.path.relative(deps.ROOT, latest.reportPath) : null, itemCount: items.length, metrics, groups, categoryBenchmarks, performance: latest?.performance || null, recommendations };
    deps.fs.mkdirSync(deps.REVIEW_DIR, { recursive: true });
    const jsonTarget = deps.path.join(deps.REVIEW_DIR, 'quality-dashboard.json');
    const htmlTarget = deps.path.join(deps.REVIEW_DIR, 'quality-dashboard.html');
    deps.fs.writeFileSync(jsonTarget, JSON.stringify(payload, null, 2), 'utf8');
    const bars = Object.entries(metrics).map(([key, value]) => { const percent = key === 'referenceSimilarity' ? value * 100 : value; return `<div><label>${key}: ${value}</label><div class="track"><span style="width:${Math.max(0,Math.min(100,percent))}%"></span></div></div>`; }).join('');
    deps.fs.writeFileSync(htmlTarget, `<!doctype html><meta charset="utf-8"><title>Quality dashboard</title><style>body{font:15px system-ui;background:#111;color:#eee;max-width:900px;margin:auto;padding:24px}.track{height:18px;background:#333;margin:5px 0 16px}.track span{display:block;height:100%;background:#e8a84c}pre{background:#1b1f24;padding:16px;overflow:auto}</style><h1>Quality dashboard</h1><p>${payload.itemCount} ảnh trong benchmark mới nhất · ${payload.benchmarkCount} lượt benchmark</p>${bars}<h2>So sánh loại trang phục</h2><pre>${JSON.stringify(categoryBenchmarks, null, 2)}</pre><h2>Theo nhóm ảnh và độ tin cậy mask</h2><pre>${JSON.stringify(groups, null, 2)}</pre><h2>Hiệu năng</h2><pre>${JSON.stringify(payload.performance, null, 2)}</pre><h2>Cấu hình đề xuất</h2><pre>${JSON.stringify(recommendations, null, 2)}</pre>`, 'utf8');
    deps.send(res, 200, JSON.stringify({ ok: true, json: deps.path.relative(deps.ROOT, jsonTarget), html: deps.path.relative(deps.ROOT, htmlTarget), ...payload }));
  } catch (error) { deps.send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

function qualityOverview(res){
  const readOptional=(target)=>{try{return JSON.parse(deps.fs.readFileSync(target,'utf8'));}catch{return null;}};
  const dashboard=readOptional(deps.path.join(deps.REVIEW_DIR,'quality-dashboard.json'));
  const regression=readOptional(deps.path.join(deps.REVIEW_DIR,'regression-comparison.json'));
  const baseline=readOptional(deps.path.join(deps.REVIEW_DIR,'golden-baseline.json'));
  const acceptance=readOptional(deps.path.join(deps.REVIEW_DIR,'release-acceptance.json'));
  const reports=allBenchmarkReports()||[],latest=reports[0]?.report||null;
  const state=readReviewState(),latestByCategory=latestBenchmarkReportsByCategory();
  const expected=Object.entries(latestByCategory).flatMap(([category,entry])=>(entry.report.items||[]).map((item)=>state.items[reviewKey(category,item.sampleId)]).filter(Boolean));
  const reviewed=expected.filter((item)=>['approved','retry','rejected'].includes(item.status));
  const categories=Object.entries(latestByCategory).map(([category,entry])=>({category,createdAt:entry.report.createdAt,count:(entry.report.items||[]).length,performance:entry.report.performance||null}));
  deps.send(res,200,JSON.stringify({ok:true,checkedAt:new Date().toISOString(),dashboard,regression,baseline,acceptance,latestBenchmark:latest?{createdAt:latest.createdAt,category:latest.category,count:(latest.items||[]).length,performance:latest.performance||null}:null,benchmarkCount:reports.length,categories,review:{total:categories.reduce((sum,item)=>sum+item.count,0),reviewed:reviewed.length,approved:reviewed.filter((item)=>item.status==='approved').length,retry:reviewed.filter((item)=>item.status==='retry').length,rejected:reviewed.filter((item)=>item.status==='rejected').length}}));
}
return {get latestOutputBySource(){return latestOutputBySource;},set latestOutputBySource(value){latestOutputBySource=value;},
get readReviewState(){return readReviewState;},set readReviewState(value){readReviewState=value;},
get reviewKey(){return reviewKey;},set reviewKey(value){reviewKey=value;},
get writeReviewState(){return writeReviewState;},set writeReviewState(value){writeReviewState=value;},
get updateReview(){return updateReview;},set updateReview(value){updateReview=value;},
get exportApprovedManifest(){return exportApprovedManifest;},set exportApprovedManifest(value){exportApprovedManifest=value;},
get calibrateQuality(){return calibrateQuality;},set calibrateQuality(value){calibrateQuality=value;},
get calibrateWeights(){return calibrateWeights;},set calibrateWeights(value){calibrateWeights=value;},
get allBenchmarkReports(){return allBenchmarkReports;},set allBenchmarkReports(value){allBenchmarkReports=value;},
get latestBenchmarkReportsByCategory(){return latestBenchmarkReportsByCategory;},set latestBenchmarkReportsByCategory(value){latestBenchmarkReportsByCategory=value;},
get latestBenchmarkReport(){return latestBenchmarkReport;},set latestBenchmarkReport(value){latestBenchmarkReport=value;},
get benchmarkReview(){return benchmarkReview;},set benchmarkReview(value){benchmarkReview=value;},
get reviewReadiness(){return reviewReadiness;},set reviewReadiness(value){reviewReadiness=value;},
get buildRetryPlan(){return buildRetryPlan;},set buildRetryPlan(value){buildRetryPlan=value;},
get readRetryComparisons(){return readRetryComparisons;},set readRetryComparisons(value){readRetryComparisons=value;},
get saveRetryComparison(){return saveRetryComparison;},set saveRetryComparison(value){saveRetryComparison=value;},
get listRetryComparisons(){return listRetryComparisons;},set listRetryComparisons(value){listRetryComparisons=value;},
get compareScoreWeights(){return compareScoreWeights;},set compareScoreWeights(value){compareScoreWeights=value;},
get activateScoreWeights(){return activateScoreWeights;},set activateScoreWeights(value){activateScoreWeights=value;},
get confirmDefaultWeights(){return confirmDefaultWeights;},set confirmDefaultWeights(value){confirmDefaultWeights=value;},
get saveReferenceProfile(){return saveReferenceProfile;},set saveReferenceProfile(value){saveReferenceProfile=value;},
get referenceReadinessPayload(){return referenceReadinessPayload;},set referenceReadinessPayload(value){referenceReadinessPayload=value;},
get referenceReadiness(){return referenceReadiness;},set referenceReadiness(value){referenceReadiness=value;},
get benchmarkWithPreflight(){return benchmarkWithPreflight;},set benchmarkWithPreflight(value){benchmarkWithPreflight=value;},
get releaseAcceptance(){return releaseAcceptance;},set releaseAcceptance(value){releaseAcceptance=value;},
get buildGoldenBaseline(){return buildGoldenBaseline;},set buildGoldenBaseline(value){buildGoldenBaseline=value;},
get compareGoldenBaseline(){return compareGoldenBaseline;},set compareGoldenBaseline(value){compareGoldenBaseline=value;},
get buildQualityDashboard(){return buildQualityDashboard;},set buildQualityDashboard(value){buildQualityDashboard=value;},
get qualityOverview(){return qualityOverview;},set qualityOverview(value){qualityOverview=value;}};
};
