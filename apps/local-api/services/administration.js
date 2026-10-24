'use strict';
const requireFromApp = require('node:module').createRequire(require('node:path').resolve(__dirname,'../../../app/server.js'));
// Dependencies: JOBS_DIR, MASKS_DIR, OUTPUTS_DIR, RESET_ARCHIVE_DIR, REVIEW_DIR, ROOT, UPLOADS_DIR, activeModelPath, allBenchmarkReports, backupStore, fs, listJobs, modelOperationalState, parseJson, path, readAiGet, readLocalConfig, readModelRegistry, referenceReadinessPayload, send, server, serviceManager, spawn, verifyModelEntry, workQueue
module.exports = function createAdministration(deps) {
const require = requireFromApp;
const metadata=require('../packages/storage/metadata');
const __dirname = require('node:path').join(deps.ROOT,'app');
const QUALITY_FILE_PATTERN = /^(quality-|regression-|golden-baseline|release-acceptance|score-weights|active-score-weights|weight-ab-report|automatic-mask-smoke|catvton-|effective-step-|hybrid-|lora-(?:ab|matrix|strength)|structural-refine-|texture-recovery-|chroma-(?:smoke|generate)|sd35-smoke-test)/i;

function directoryChildren(directory) {
  if (!deps.fs.existsSync(directory)) return [];
  return deps.fs.readdirSync(directory).map((name) => deps.path.join(directory, name));
}

function qualityDataTargets() {
  const reviewReports = deps.fs.existsSync(deps.REVIEW_DIR)
    ? deps.fs.readdirSync(deps.REVIEW_DIR).filter((name) => QUALITY_FILE_PATTERN.test(name)).map((name) => deps.path.join(deps.REVIEW_DIR, name))
    : [];
  const benchmarkRuns = (deps.allBenchmarkReports() || []).map((entry) => deps.path.dirname(entry.target));
  return [...new Set([...reviewReports, ...benchmarkRuns])];
}

function reviewDataTargets() {
  if (!deps.fs.existsSync(deps.REVIEW_DIR)) return [];
  return deps.fs.readdirSync(deps.REVIEW_DIR)
    .filter((name) => name === 'review-state.json' || name === 'retry-comparisons.json' || /^review-state-.*\.json$/i.test(name) || /^approved-manifest-.*\.json$/i.test(name))
    .map((name) => deps.path.join(deps.REVIEW_DIR, name));
}

function resetTargets(scope) {
  const groups = {
    uploads: directoryChildren(deps.UPLOADS_DIR),
    masks: directoryChildren(deps.MASKS_DIR),
    review: reviewDataTargets(),
    jobs: [...directoryChildren(deps.JOBS_DIR),...directoryChildren(deps.path.join(deps.ROOT,'workspace/work-queue'))],
    quality: qualityDataTargets(),
    outputs: directoryChildren(deps.OUTPUTS_DIR),
    manual: directoryChildren(deps.path.join(deps.ROOT,'workspace','manual')),
  };
  if (scope === 'all') return [...new Set(Object.values(groups).flat())];
  if (!Object.prototype.hasOwnProperty.call(groups, scope)) throw new Error('Phạm vi đặt lại không hợp lệ');
  return groups[scope];
}

function targetStats(target) {
  if (!deps.fs.existsSync(target)) return { files: 0, bytes: 0 };
  const stat = deps.fs.statSync(target);
  if (stat.isFile()) return { files: 1, bytes: stat.size };
  return deps.fs.readdirSync(target).reduce((total, name) => {
    const value = targetStats(deps.path.join(target, name));
    total.files += value.files; total.bytes += value.bytes;
    return total;
  }, { files: 0, bytes: 0 });
}

function resetDataOverview() {
  const scopes = {};
  for (const scope of ['uploads','masks','review','jobs','quality','outputs','manual']) {
    const targets = resetTargets(scope);
    const stats = targets.reduce((total, target) => { const value=targetStats(target); total.files+=value.files; total.bytes+=value.bytes; return total; }, { files:0, bytes:0 });
    scopes[scope] = { items: targets.length, ...stats };
  }
  const archives = deps.fs.existsSync(deps.RESET_ARCHIVE_DIR) ? deps.fs.readdirSync(deps.RESET_ARCHIVE_DIR, { withFileTypes:true }).filter((entry)=>entry.isDirectory()).length : 0;
  return { scopes, archives };
}

async function resetWorkspaceData(req, res) {
  try {
    const body = await deps.parseJson(req, 64 * 1024);
    const scope = String(body.scope || '');
    if (body.confirm !== true) throw new Error('Cần xác nhận trước khi đặt lại dữ liệu');
    if (deps.listJobs().some((job)=>['running','cancelling','queued'].includes(job.status)) || (await deps.workQueue.list()).some(q=>['running','queued'].includes(q.status))) {
      throw new Error('Không thể đặt lại khi vẫn còn tác vụ đang chạy');
    }
    const targets = resetTargets(scope);
    const home=deps.path.join(deps.ROOT,'workspace');
    const prefixes=scope==='all'?['jobs/','work-queue/','manual/']:scope==='jobs'?['jobs/','work-queue/']:scope==='manual'?['manual/']:[];
    const records=metadata.snapshot(home).filter(row=>prefixes.some(prefix=>row.key.startsWith(prefix)));
    if (!targets.length&&!records.length) return deps.send(res, 200, JSON.stringify({ ok:true, scope, movedItems:0, movedFiles:0, bytes:0, message:'Danh sách đã trống' }));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archive = deps.path.join(deps.RESET_ARCHIVE_DIR, `${stamp}-${scope}`);
    deps.fs.mkdirSync(archive, { recursive:true });
    let movedFiles=0,bytes=0;
    for (const target of targets) {
      if (!deps.fs.existsSync(target)) continue;
      const relative = deps.path.relative(deps.path.join(deps.ROOT, 'workspace'), target);
      if (relative.startsWith('..') || deps.path.isAbsolute(relative)) throw new Error('Dữ liệu nằm ngoài vùng làm việc');
      const destination = deps.path.join(archive, relative);
      deps.fs.mkdirSync(deps.path.dirname(destination), { recursive:true });
      const stats=targetStats(target); movedFiles+=stats.files; bytes+=stats.bytes;
      deps.fs.renameSync(target, destination);
    }
    // Write current database values over any retained pre-migration JSON.
    // Only then remove them atomically from the active repository.
    for(const row of records){const destination=deps.path.join(archive,row.key);deps.fs.mkdirSync(deps.path.dirname(destination),{recursive:true});deps.fs.writeFileSync(destination,row.data);}
    metadata.removeKeys(home,records.map(row=>row.key));
    const manifest={schemaVersion:1,createdAt:new Date().toISOString(),scope,movedItems:targets.length,movedFiles,bytes,restoreNote:'Di chuyển dữ liệu về đúng đường dẫn tương đối trong manifest để phục hồi.'};
    deps.fs.writeFileSync(deps.path.join(archive,'reset-manifest.json'),JSON.stringify(manifest,null,2),'utf8');
    deps.send(res,200,JSON.stringify({ok:true,scope,archive:deps.path.relative(deps.ROOT,archive),...manifest}));
  } catch (error) { deps.send(res, 400, JSON.stringify({ ok:false, error:error.message })); }
}

async function listBackups(res) {
  const backups = await deps.backupStore.list();
  deps.send(res, 200, JSON.stringify({ ok: true, backups }));
}

async function restoreBackup(req, res) {
  try {
    const body = await deps.parseJson(req, 1024 * 1024);
    if (body.confirm !== true) throw new Error('Khôi phục cần xác nhận rõ ràng');
    if(deps.listJobs().some(j=>['running','cancelling'].includes(j.status))||(await deps.workQueue.list()).some(q=>['running','queued'].includes(q.status)))throw Error('Đợi tác vụ và hàng đợi đang chạy hoàn tất trước khi khôi phục.');
    deps.send(res,200,JSON.stringify({ok:true,...await deps.backupStore.restore(String(body.name||''))}));
  } catch(error) { deps.send(res,400,JSON.stringify({ok:false,error:error.message})); }
}

async function backupWorkspace(req, res) {
  try {
    const body=await deps.parseJson(req,1024*1024);
    if(deps.listJobs().some(j=>['running','cancelling'].includes(j.status))||(await deps.workQueue.list()).some(q=>['running','queued'].includes(q.status)))throw Error('Đợi tác vụ và hàng đợi đang chạy hoàn tất trước khi sao lưu.');
    deps.send(res,200,JSON.stringify({ok:true,...await deps.backupStore.create(body.mode||'full')}));
  } catch (error) { deps.send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

async function systemOverview(res){
  const [health,runtime]=await Promise.all([deps.readAiGet('/health'),deps.readAiGet('/runtime-model-status')]);
  const registry=deps.readModelRegistry(),config=deps.readLocalConfig();
  const models=registry.models.map((entry)=>{const checked=deps.verifyModelEntry(entry),operational=deps.modelOperationalState(entry,checked);return{id:entry.id,name:entry.name,kind:entry.kind,ready:checked.ready,operationalReady:operational.operationalReady,runtimeReason:operational.runtimeReason||'',selected:Boolean(deps.activeModelPath(registry,config,entry.configKey)===checked.resolvedPath)};});
  const backups=await deps.backupStore.list();
  const baselinePath=deps.path.join(deps.REVIEW_DIR,'golden-baseline.json');let baseline=null;try{const value=JSON.parse(deps.fs.readFileSync(baselinePath,'utf8'));baseline={createdAt:value.createdAt,caseCount:Number(value.caseCount||0)};}catch{}
  const jobItems=deps.listJobs(),running=jobItems.filter((item)=>['running','cancelling'].includes(item.status)).length,interrupted=jobItems.filter((item)=>item.status==='interrupted').length;
  const readyCount=models.filter((item)=>item.ready&&item.operationalReady!==false).length;
  deps.send(res,200,JSON.stringify({ok:true,offline:true,checkedAt:new Date().toISOString(),health,runtime,models,resetData:resetDataOverview(),summary:{readyCount,totalModels:models.length,selectedCount:models.filter((item)=>item.selected).length,backupCount:backups.length,runningJobs:running,interruptedJobs:interrupted,diskFreeGb:health.diskFreeGb??null,gpu:health.gpu||'Không xác định',gpuMemoryMb:Number(health.gpuMemoryMb||0)},backups:backups.slice(0,8),referenceReadiness:deps.referenceReadinessPayload(),baseline,restartRequired:Boolean(config.modelRestartRequired),ready:Boolean(health.ok&&readyCount===models.length&&!config.modelRestartRequired)}));
}

let webRestartPending = false;

async function restartWebServer(req, res) {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return deps.send(res, 403, JSON.stringify({ok:false,error:'Yêu cầu phải đến từ AI Atelier.'}));
  const body = await deps.parseJson(req, 1024);
  if (body.confirm !== true) return deps.send(res, 400, JSON.stringify({ok:false,error:'Thiếu xác nhận khởi động lại.'}));
  if(deps.serviceManager.busy())return deps.send(res,409,JSON.stringify({ok:false,error:'Dịch vụ AI đang khởi động lại.'}));
  try{await deps.serviceManager.idle();}catch(e){return deps.send(res,409,JSON.stringify({ok:false,error:e.message}));}
  if (webRestartPending || deps.listJobs().some(item => ['running','cancelling'].includes(item.status))) return deps.send(res, 409, JSON.stringify({ok:false,error:'Hãy đợi tác vụ đang chạy kết thúc.'}));
  webRestartPending = true;
  const helper = deps.spawn(process.execPath, [deps.path.join(__dirname, 'restart-web.js'), String(process.pid)], {cwd:deps.ROOT, detached:true, windowsHide:true, stdio:'ignore'});
  helper.once('error', () => { webRestartPending=false; deps.send(res,500,JSON.stringify({ok:false,error:'Không thể khởi động trình khởi động lại.'})); });
  helper.once('spawn', () => {
    helper.unref();
    res.once('finish', () => {
      deps.server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    });
    deps.send(res,202,JSON.stringify({ok:true,instanceId:String(process.pid)}));
  });
}
return {get QUALITY_FILE_PATTERN(){return QUALITY_FILE_PATTERN;},
get directoryChildren(){return directoryChildren;},set directoryChildren(value){directoryChildren=value;},
get qualityDataTargets(){return qualityDataTargets;},set qualityDataTargets(value){qualityDataTargets=value;},
get reviewDataTargets(){return reviewDataTargets;},set reviewDataTargets(value){reviewDataTargets=value;},
get resetTargets(){return resetTargets;},set resetTargets(value){resetTargets=value;},
get targetStats(){return targetStats;},set targetStats(value){targetStats=value;},
get resetDataOverview(){return resetDataOverview;},set resetDataOverview(value){resetDataOverview=value;},
get resetWorkspaceData(){return resetWorkspaceData;},set resetWorkspaceData(value){resetWorkspaceData=value;},
get listBackups(){return listBackups;},set listBackups(value){listBackups=value;},
get restoreBackup(){return restoreBackup;},set restoreBackup(value){restoreBackup=value;},
get backupWorkspace(){return backupWorkspace;},set backupWorkspace(value){backupWorkspace=value;},
get systemOverview(){return systemOverview;},set systemOverview(value){systemOverview=value;},
get webRestartPending(){return webRestartPending;},set webRestartPending(value){webRestartPending=value;},
get restartWebServer(){return restartWebServer;},set restartWebServer(value){restartWebServer=value;}};
};
