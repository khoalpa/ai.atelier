'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { trustedRequest } = require('../../app/request-security');
const {FILE:PROMPTS_FILE, readCatalog, updateCatalog, renderTemplate, savePresetPrompt, listModes, saveMode, migrateBrowser, previewImport, importCatalog} = require('../../app/prompt-store');
const { readRemoved, updateRemoved } = require('../../app/library-removal-store');
const editHistory = require('../../app/edit-history-store');
const jsonConfigStore=require('../../app/json-config-store').createStore();
const ROOT = path.resolve(__dirname, '../..');
const manualStore = require('../../app/manual-store').createStore(ROOT);
const qualityService = require('../../app/quality-service').createQualityService(ROOT);
process.once('exit', () => qualityService.stop());
const PUBLIC_DIR = path.join(ROOT, 'app', 'public');
const SAMPLES_DIR = path.join(ROOT, 'samples');
const UPLOADS_DIR = path.join(ROOT, 'workspace', 'uploads');
const MASKS_DIR = path.join(ROOT, 'workspace', 'masks');
const OUTPUTS_DIR = path.join(ROOT, 'workspace', 'outputs');
const REVIEW_DIR = path.join(ROOT, 'workspace', 'review');
const REVIEW_STATE = path.join(REVIEW_DIR, 'review-state.json');
const JOBS_DIR = path.join(ROOT, 'workspace', 'jobs');
const BACKUPS_DIR = path.join(ROOT, 'workspace', 'backups');
const RESET_ARCHIVE_DIR = path.join(ROOT, 'workspace', 'reset-archive');
const REFERENCES_DIR = path.join(ROOT, 'workspace', 'references');
const RETRY_COMPARISONS = path.join(REVIEW_DIR, 'retry-comparisons.json');
const MODEL_REGISTRY = path.join(ROOT, 'models', 'registry.json');
const MODEL_CANDIDATES = path.join(ROOT, 'models', 'inpaint-candidates.json');
const EXTERNAL_MODEL_SOURCES = path.join(ROOT, 'models', 'external-sources.json');
const MODEL_DOWNLOADS = path.join(ROOT, 'workspace', 'model-downloads');
const MODEL_DOWNLOADER = path.join(ROOT, 'scripts', 'download_model.py');
const MODEL_DOWNLOAD_PYTHON = require('../../packages/runtime/paths').python(ROOT);
const MODEL_HISTORY = path.join(ROOT, 'workspace', 'model-registry-history');
const CONFIG_FILE = path.join(ROOT, 'workspace', 'config.json');
const assetCatalog=require('../../app/asset-catalog').createCatalog(ROOT);
const regionStore=require('../../app/region-store').createRegionStore(ROOT);
const workQueue=require('../../app/work-queue-store').createQueueStore(ROOT);
const exportPresets=require('../../app/export-presets').createExportPresets(ROOT);
const backupStore=require('../../app/backup-store').createBackupStore(ROOT,{config:CONFIG_FILE,prompts:PROMPTS_FILE});
const HOST = '127.0.0.1';
const PORT = Number(process.env.AI_IMAGE_PORT || 7860);
const AI_PORT = Number(process.env.AI_SEGMENT_PORT || 7861);
const LLM_BASE_URL = String(process.env.ATELIER_LLM_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const LLM_MODEL = String(process.env.ATELIER_LLM_MODEL || 'llava:7b');
const MAKEUP_LLM_MODEL = String(process.env.ATELIER_MAKEUP_LLM_MODEL || 'qwen3:4b');
const {readVersion,webRevision}=require('../../app/runtime-version');
const VERSION=readVersion(ROOT), WEB_REVISION=webRevision(ROOT);
const acceptanceStore=require('../../app/acceptance-store').createAcceptanceStore(ROOT);
const backgroundRenderer=require('../../app/background-renderer').createRenderer(ROOT,`http://${HOST}:${PORT}`);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
const deps={http,fs,path,crypto,spawn,trustedRequest,PROMPTS_FILE,readCatalog,updateCatalog,renderTemplate,savePresetPrompt,listModes,saveMode,migrateBrowser,previewImport,importCatalog,readRemoved,updateRemoved,editHistory,jsonConfigStore,ROOT,manualStore,qualityService,PUBLIC_DIR,SAMPLES_DIR,UPLOADS_DIR,MASKS_DIR,OUTPUTS_DIR,REVIEW_DIR,REVIEW_STATE,JOBS_DIR,BACKUPS_DIR,RESET_ARCHIVE_DIR,REFERENCES_DIR,RETRY_COMPARISONS,MODEL_REGISTRY,MODEL_CANDIDATES,EXTERNAL_MODEL_SOURCES,MODEL_DOWNLOADS,MODEL_DOWNLOADER,MODEL_DOWNLOAD_PYTHON,MODEL_HISTORY,CONFIG_FILE,assetCatalog,regionStore,workQueue,exportPresets,backupStore,HOST,PORT,AI_PORT,LLM_BASE_URL,LLM_MODEL,MAKEUP_LLM_MODEL,readVersion,webRevision,VERSION,WEB_REVISION,acceptanceStore,backgroundRenderer,MIME};
deps.taskRoutes=require('./task-routes')(deps);
for(const name of ["transport","library","jobs","review","prompts","models","administration","routes"]) {
 const service=require('./services/'+name)(deps);
 Object.defineProperties(deps,Object.getOwnPropertyDescriptors(service));
}
const queueRunner=require('../../app/work-queue-runner').createRunner(ROOT,{store:workQueue,manualStore,renderer:backgroundRenderer,ai:deps.callAiJson,canRun:()=>!deps.webRestartPending&&!deps.serviceManager?.busy()});
deps.queueRunner=queueRunner;
deps.taskCoordinator=require('./task-coordinator').createTaskCoordinator({store:workQueue,ai:deps.callAiJson});
deps.serviceManager=require('../../app/service-manager').createServiceManager(ROOT,{aiGet:deps.readAiGet,aiPost:deps.callAiJson,queues:workQueue,jobs:deps.listJobs,runner:queueRunner,port:PORT,aiPort:AI_PORT,loadedVersion:VERSION,loadedRevision:WEB_REVISION});
process.once('exit',()=>backgroundRenderer.stop());
const server = http.createServer((req, res) => {
  if (!trustedRequest(req, PORT)) {
    req.resume();
    return deps.send(res, 403, JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
  }
  if (req.method === 'POST' && req.url === '/api/restart-web') {
    deps.restartWebServer(req,res).catch(() => { if(!res.headersSent)deps.send(res,400,JSON.stringify({ok:false,error:'Yêu cầu khởi động lại không hợp lệ.'})); });
    return;
  }
  Promise.resolve(deps.handleRequest(req, res)).catch((error) => {
    console.error(`[web] ${req.method} ${req.url}:`, error);
    if (!res.headersSent) deps.send(res, 500, JSON.stringify({ ok:false, error:'Dịch vụ gặp lỗi khi xử lý yêu cầu. Hãy thử lại.' }));
    else if (!res.writableEnded) res.destroy();
  });
});
deps.server=server;
server.listen(PORT, HOST, () => {
  if(process.env.ATELIER_DISABLE_BACKGROUND!=='1')queueRunner.start();
  try { if(process.env.ATELIER_DISABLE_BACKGROUND!=='1')qualityService.start(); } catch(error) { console.error('[quality]',error.message); }
  console.log(`AI Image Mask POC đang chạy tại http://${HOST}:${PORT}`);
  console.log('Chế độ offline: không có kết nối mạng bên ngoài.');
});
module.exports={server,services:deps};
