'use strict';
const requireFromApp = require('node:module').createRequire(require('node:path').resolve(__dirname,'../../../app/server.js'));
// Dependencies: JOBS_DIR, fs, parseJson, path, send
module.exports = function createJobs(deps) {
const require = requireFromApp;
const metadata=require('../packages/storage/metadata');
const __dirname = require('node:path').join(deps.ROOT,'app');
function listJobs() {
  const items=metadata.entries(deps.JOBS_DIR).filter((name) => name.endsWith('.json') && !name.endsWith('.request.json') && !name.endsWith('.checkpoint.json')).map((name) => {
    try { return metadata.read(deps.path.join(deps.JOBS_DIR, name),null); } catch { return null; }
  }).filter(Boolean);
  const known=new Set(items.map(item=>item.jobId)),directory=deps.path.join(deps.ROOT,'workspace/work-queue');
  for(const name of metadata.entries(directory).filter(name=>name.endsWith('.json'))){
    const q=metadata.read(deps.path.join(directory,name),null);if(!q?.requestKey||known.has(q.requestKey))continue;
    const item=q.items[0],task=require('../packages/contracts/jobs').tasks[q.kind];
    items.push({jobId:q.requestKey,taskType:task?.taskType||q.kind,status:q.status==='paused'?'interrupted':q.status,stage:item.checkpoint?.submitted?'preparing':'queued',updatedAt:q.updatedAt,createdAt:q.createdAt,results:item.result?.results||[],resumable:q.status==='paused',resumeMode:task?.resume,queueId:q.id});
  }
  return items.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
}

async function cleanupJobs(req, res) {
  try {
    const body = await deps.parseJson(req, 1024 * 1024);
    const retentionDays = Math.max(1, Math.min(365, Number(body.retentionDays || 14)));
    const cutoff = Date.now() - retentionDays * 86400000;
    const candidates = listJobs().filter((job) => ['completed', 'cancelled'].includes(job.status) && Date.parse(job.updatedAt || 0) < cutoff);
    const files = [];
    for (const job of candidates) {
      const safeId = String(job.jobId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      for (const suffix of ['.json', '.request.json', '.checkpoint.json']) {
        const target = deps.path.join(deps.JOBS_DIR, safeId + suffix);
        if (safeId && metadata.exists(target)) files.push(target);
      }
      const queue=deps.path.join(deps.ROOT,'workspace/work-queue',require('../apps/local-api/task-coordinator').queueId(safeId)+'.json');
      if(safeId&&metadata.exists(queue))files.push(queue);
    }
    if (body.confirm === true) for (const target of files) metadata.remove(target);
    deps.send(res, 200, JSON.stringify({ ok: true, dryRun: body.confirm !== true, retentionDays, jobCount: candidates.length, fileCount: files.length }));
  } catch (error) { deps.send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}
return {get listJobs(){return listJobs;},set listJobs(value){listJobs=value;},
get cleanupJobs(){return cleanupJobs;},set cleanupJobs(value){cleanupJobs=value;}};
};
