'use strict';
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const deps = require('./composition/runtime-dependencies').createRuntimeDependencies(ROOT);
const { qualityService, backgroundRenderer, workQueue, manualStore } = deps;
process.once('exit', () => qualityService.stop());
deps.taskRoutes=require('./task-routes')(deps);
for(const name of ["transport","library","jobs","review","prompts","models","administration","routes"]) {
 const service=require('./services/'+name)(deps);
 Object.defineProperties(deps,Object.getOwnPropertyDescriptors(service));
}
const queueRunner=require('./queue/work-queue-runner').createRunner(ROOT,{store:workQueue,manualStore,renderer:backgroundRenderer,ai:deps.callAiJson,canRun:()=>!deps.webRestartPending&&!deps.serviceManager?.busy()});
deps.queueRunner=queueRunner;
deps.taskCoordinator=require('./task-coordinator').createTaskCoordinator({store:workQueue,ai:deps.callAiJson});
deps.serviceManager=require('./infrastructure/service-manager').createServiceManager(ROOT,{aiGet:deps.readAiGet,aiPost:deps.callAiJson,queues:workQueue,jobs:deps.listJobs,runner:queueRunner,port:deps.PORT,aiPort:deps.AI_PORT,loadedVersion:deps.VERSION,loadedRevision:deps.WEB_REVISION});
process.once('exit',()=>backgroundRenderer.stop());
const server = http.createServer((req, res) => {
  if (!deps.trustedRequest(req, deps.PORT)) {
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
server.listen(deps.PORT, deps.HOST, () => {
  if(process.env.ATELIER_DISABLE_BACKGROUND!=='1')queueRunner.start();
  try { if(process.env.ATELIER_DISABLE_BACKGROUND!=='1')qualityService.start(); } catch(error) { console.error('[quality]',error.message); }
  console.log(`AI Image Mask POC đang chạy tại http://${deps.HOST}:${deps.PORT}`);
  console.log('Chế độ offline: không có kết nối mạng bên ngoài.');
});
module.exports={server,services:deps};
