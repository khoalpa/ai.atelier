'use strict';
const requireFromApp = require('node:module').createRequire(require('node:path').resolve(__dirname,'../../../app/server.js'));
// Dependencies: AI_PORT, HOST, JOBS_DIR, MAKEUP_LLM_MODEL, OUTPUTS_DIR, PORT, PROMPTS_FILE, PUBLIC_DIR, REFERENCES_DIR, REVIEW_DIR, ROOT, SAMPLES_DIR, UPLOADS_DIR, VERSION, acceptanceStore, activateModel, activateScoreWeights, allLibraryAssets, analyzeModelUrl, assetCatalog, backgroundRenderer, backupStore, backupWorkspace, benchmarkReview, benchmarkWithPreflight, buildGoldenBaseline, buildQualityDashboard, buildRetryPlan, calibrateQuality, calibrateWeights, callAiJson, cleanupJobs, compareGoldenBaseline, compareScoreWeights, confirmDefaultWeights, deleteModel, editHistory, exportApprovedManifest, exportModelManifest, exportPresets, fs, importCatalog, jsonConfigStore, listBackups, listImages, listJobs, listModelCandidates, listModels, listModes, listRetryComparisons, listUploadedImages, manualStore, migrateBrowser, modelCapabilities, modelOperationalState, parseJson, path, previewImport, promptAssist, proxyAiGet, proxyAiHealth, proxyToAi, qualityOverview, qualityService, quarantineModel, readAiGet, readCatalog, readLocalConfig, readOllamaModels, readReviewState, referenceReadiness, regionStore, registerModel, registerModelUrl, releaseAcceptance, requestLocalLlm, resetWorkspaceData, restoreBackup, restoreQuarantinedModel, reviewReadiness, safeJoin, saveMask, saveMode, savePresetPrompt, saveReferenceProfile, saveRetryComparison, sd35DepthOperationalState, selectFeatureModel, selectResult, send, serveFile, serviceManager, startAllModelDownloads, startModelDownload, streamJobEvents, systemOverview, updateCatalog, updateRemoved, updateReview, uploadSourceImage, webRestartPending, workQueue
module.exports = function createRoutes(deps) {
const require = requireFromApp;
const __dirname = require('node:path').join(deps.ROOT,'app');
let anatomyParts;
const getAnatomyParts=()=>anatomyParts||(anatomyParts=require('./anatomy-parts-store').create(deps.ROOT));
const catalogTransfer=require('./catalog-transfer-store').createStore(process.env.ATELIER_JSON_CONFIG_ROOT||deps.ROOT,deps.PROMPTS_FILE);
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${deps.HOST}:${deps.PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  if(pathname==='/api/catalog-package'){
    try{
      if(req.method==='GET'){const bundle=catalogTransfer.exported(url.searchParams.get('scope')||'all');res.setHeader('Content-Disposition','attachment; filename="ai-atelier-catalog-package.json"');return deps.send(res,200,JSON.stringify(bundle,null,2));}
      if(req.method!=='POST')return deps.send(res,405,JSON.stringify({ok:false,error:'Phương thức không được hỗ trợ.'}));
      if((req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')return deps.send(res,403,JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
      const body=await deps.parseJson(req,5*1024*1024);
      const result=body.action==='preview'?catalogTransfer.preview(body.bundle):body.action==='import'?catalogTransfer.apply(body.bundle,body.revisions):null;
      if(!result)throw Error('Thao tác gói cấu hình không hợp lệ.');return deps.send(res,200,JSON.stringify({ok:true,...result}));
    }catch(error){return deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if(pathname==='/api/catalog-preview'&&req.method==='POST'){
    try{
      if((req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')return deps.send(res,403,JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
      const body=await deps.parseJson(req,3*1024*1024),result=require('./catalog-inspector').preview(body.catalog||deps.readCatalog(),body.taskId,body.variables||{},body.modelId||null);
      if(body.modelId&&!result.missingVariables.length){try{result.tokenCheck=await deps.callAiJson('/catalog-token-preview',{modelId:body.modelId,prompt:result.prompt,negativePrompt:result.negativePrompt});}catch(error){result.tokenError=error.message;}}
      return deps.send(res,200,JSON.stringify({ok:true,...result}));
    }catch(error){return deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if(deps.taskRoutes&&await deps.taskRoutes(req,res,url))return;
  if(pathname==='/api/services'&&req.method==='GET')return deps.send(res,200,JSON.stringify(await deps.serviceManager.state()));
  if(pathname==='/api/services/restart-ai'&&req.method==='POST'){try{if((await deps.parseJson(req,1024)).confirm!==true)throw Error('Thiếu xác nhận khởi động lại.');return deps.send(res,202,JSON.stringify({ok:true,operation:await deps.serviceManager.restart()}));}catch(e){return deps.send(res,409,JSON.stringify({ok:false,error:e.message}));}}
  if(pathname==='/api/background-render'){try{if(req.method==='GET')return deps.send(res,200,JSON.stringify({work:deps.backgroundRenderer.work(url.searchParams.get('token'))}));if(req.method==='POST'){deps.backgroundRenderer.complete(await deps.parseJson(req,110*1024*1024));return deps.send(res,200,JSON.stringify({ok:true}));}}catch(e){return deps.send(res,403,JSON.stringify({ok:false,error:e.message}));}}
  if(pathname==='/api/acceptance'&&['GET','POST'].includes(req.method)){try{return deps.send(res,200,JSON.stringify(req.method==='GET'?{ok:true,...await deps.acceptanceStore.state()}:{ok:true,item:await deps.acceptanceStore.action(await deps.parseJson(req,16384))}));}catch(e){return deps.send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(pathname==='/api/work-queue'&&['GET','POST'].includes(req.method)){try{let result;if(req.method==='GET')result=url.searchParams.has('id')?{queue:{...await deps.workQueue.get(url.searchParams.get('id')),owner:undefined}}:{items:await deps.workQueue.list()};else {const body=await deps.parseJson(req,33*1024*1024);if(!['create','start','stop'].includes(body.action))throw Error('Hàng đợi đã chuyển sang dịch vụ nền. Tải lại giao diện để tiếp tục.');if(body.action==='start'&&(deps.webRestartPending||deps.serviceManager.busy()))throw Error('Dịch vụ đang khởi động lại. Thử lại sau ít giây.');result={queue:{...await deps.workQueue.action(body),owner:undefined}};}return deps.send(res,200,JSON.stringify({ok:true,...result}));}catch(e){return deps.send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(req.method==='POST'&&(deps.webRestartPending||deps.serviceManager.busy())&&['/api/manual-cutout','/api/character-render','/api/character-regenerate','/api/anatomy-preview','/api/anatomy-inpaint','/api/makeup','/api/enhance','/api/outpaint','/api/inpaint','/api/tryon','/api/batch-tryon','/api/resume-job','/api/chroma-generate','/api/sd35-conditioned-generate','/api/sdxl-conditioned-generate'].includes(pathname))return deps.send(res,503,JSON.stringify({ok:false,error:'Dịch vụ đang khởi động lại. Thử lại sau ít giây.'}));
  if(pathname==='/api/export-presets'&&['GET','POST'].includes(req.method)){try{return deps.send(res,200,JSON.stringify(req.method==='GET'?{ok:true,items:await deps.exportPresets.list()}:{ok:true,item:await deps.exportPresets.save(await deps.parseJson(req,16384))}));}catch(e){return deps.send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(pathname==='/api/regions'&&['GET','POST'].includes(req.method)){try{return deps.send(res,200,JSON.stringify(req.method==='GET'?{ok:true,items:await deps.regionStore.list(url.searchParams.get('source'))}:{ok:true,item:await deps.regionStore.save(await deps.parseJson(req,16384))}));}catch(e){return deps.send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(req.method==='POST'&&pathname==='/api/manual-cutout'){try{return deps.send(res,200,JSON.stringify(await deps.callAiJson('/manual-cutout',await deps.parseJson(req,16384))));}catch(e){return deps.send(res,400,JSON.stringify({ok:false,error:e.message.includes('endpoint')?'Khởi động lại dịch vụ AI để nạp công cụ tách chủ thể mới. Vẫn có thể dùng vùng chọn thủ công.':e.message}));}}
  if(pathname.startsWith('/api/manual/')) {
    try {
      const action=pathname.slice('/api/manual/'.length);
      if(req.method==='GET'&&action==='projects')return deps.send(res,200,JSON.stringify({ok:true,items:await deps.manualStore.list({sourceId:url.searchParams.get('sourceId')||'',archived:url.searchParams.get('archived')==='true'})}));
      if(req.method==='GET'&&action==='resolve')return deps.send(res,200,JSON.stringify({ok:true,link:await deps.manualStore.resolveOutput(url.searchParams.get('url'))}));
      if(req.method==='GET'&&action==='versions')return deps.send(res,200,JSON.stringify({ok:true,items:await deps.manualStore.versions(url.searchParams.get('id'))}));
      if(req.method==='GET'&&action==='project')return deps.send(res,200,JSON.stringify({ok:true,project:await deps.manualStore.load(url.searchParams.get('id'),url.searchParams.has('revision')?Number(url.searchParams.get('revision')):undefined)}));
      if(req.method==='GET'&&action==='presets')return deps.send(res,200,JSON.stringify({ok:true,items:await deps.manualStore.presets()}));
      if(req.method!=='POST')return deps.send(res,405,JSON.stringify({ok:false,error:'Thao tác không được hỗ trợ.'}));
      const body=await deps.parseJson(req,['assets','export'].includes(action)?110*1024*1024:9*1024*1024);
      const result=action==='assets'?{asset:await deps.manualStore.importAsset(body)}:action==='projects'?{project:await deps.manualStore.save(body)}:action==='archive'?{project:await deps.manualStore.archive(body.id,body.archived!==false)}:action==='export'?{output:await deps.manualStore.exportImage(body)}:action==='presets'?{preset:await deps.manualStore.presets(body)}:null;
      if(!result)throw Error('Thao tác không được hỗ trợ.');return deps.send(res,200,JSON.stringify({ok:true,...result}));
    }catch(error){return deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if(req.method==='GET'&&/^\/manual-assets\/[a-f0-9]{64}\.png$/.test(pathname))return deps.serveFile(res,deps.manualStore.assets,pathname.slice('/manual-assets/'.length));
  if(pathname.startsWith('/api/quality-learning/')) {
    const action=pathname.slice('/api/quality-learning/'.length);
    if(req.method!=='POST'||!['state','configure','feedback','rollback','selection','report'].includes(action))return deps.send(res,405,JSON.stringify({ok:false,error:'Thao tác không được hỗ trợ.'}));
    try { const body=await deps.parseJson(req,64*1024),result=await deps.qualityService.call(action,body);
      if(action==='feedback'&&body.rating){try{const state=await deps.qualityService.call('state',{resultId:body.resultId}),entry=state.results?.[0],url=entry?.[body.target||'original'];if(url?.startsWith('/outputs/'))await deps.assetCatalog.update({ids:['output:'+url.slice('/outputs/'.length)],review:{status:body.rating==='good'?'approved':body.rating==='clear'?'pending':'needs-work',defects:body.defects||[]}});}catch(e){result.feedbackWarning='Đã lưu phản hồi; quyết định trong Duyệt ảnh chưa đồng bộ: '+e.message;}}
      return deps.send(res,200,JSON.stringify(result)); }
    catch(error) { return deps.send(res,400,JSON.stringify({ok:false,error:error.message})); }
  }
  if(pathname==='/api/json-config'&&req.method==='GET')return deps.send(res,200,JSON.stringify({ok:true,files:deps.jsonConfigStore.list()}));
  if(pathname.startsWith('/api/json-config/')){
    try{
      const id=pathname.slice('/api/json-config/'.length);
      if(req.method==='GET')return deps.send(res,200,JSON.stringify({ok:true,...deps.jsonConfigStore.read(id)}));
      if(req.method!=='POST')return deps.send(res,405,JSON.stringify({ok:false,error:'Phương thức không được hỗ trợ.'}));
      if((req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')return deps.send(res,403,JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
      const body=await deps.parseJson(req,4*1024*1024);
      const result=body.action==='validate'?deps.jsonConfigStore.preview(id,body.data,body.revision):body.action==='save'?deps.jsonConfigStore.save(id,body.data,body.revision):body.action==='restore'?deps.jsonConfigStore.restore(id,body.backup,body.revision):null;
      if(!result)throw new Error('Thao tác JSON không hợp lệ.');
      return deps.send(res,200,JSON.stringify({ok:true,...result}));
    }catch(error){return deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if(req.method==='GET'&&pathname==='/api/prompts/export'){
    try{
      const content=JSON.stringify(deps.readCatalog(),null,2)+'\n';
      res.setHeader('Content-Disposition','attachment; filename="ai-atelier-prompts.json"');
      return deps.send(res,200,content);
    }catch(error){return deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if(req.method==='GET'&&pathname==='/api/prompts.js'){
    try{return deps.send(res,200,'window.ATELIER_PROMPTS='+JSON.stringify(deps.readCatalog()).replace(/</g,'\\u003c')+';','application/javascript; charset=utf-8');}
    catch(error){return deps.send(res,500,'throw new Error("Không thể tải cấu hình prompt");','application/javascript; charset=utf-8');}
  }
  if(pathname==='/api/prompts'&&['GET','POST'].includes(req.method)){
    try{
      if(req.method==='POST'){
        if((req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')return deps.send(res,403,JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
        const body=await deps.parseJson(req,3*1024*1024);
        if(body.action==='preview-import')return deps.send(res,200,JSON.stringify({ok:true,...deps.previewImport(body.catalog)}));
        if(body.action==='import')return deps.send(res,200,JSON.stringify({ok:true,catalog:deps.importCatalog(body.catalog,body.expectedRevision)}));
        if(body.action==='migrate')return deps.send(res,200,JSON.stringify({ok:true,catalog:deps.migrateBrowser(body)}));
        if(body.action!=='library')throw new Error('Thao tác prompt không hợp lệ.');
        const catalog=deps.updateCatalog(value=>{
          if(JSON.stringify(body.expectedLibrary)!==JSON.stringify(value.library))throw new Error('Thư viện đã thay đổi ở cửa sổ khác. Tải lại trang trước khi lưu.');
          value.library=body.items;
        });
        return deps.send(res,200,JSON.stringify({ok:true,catalog}));
      }
      return deps.send(res,200,JSON.stringify({ok:true,catalog:deps.readCatalog()}));
    }catch(error){return deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if (pathname === '/api/processing-modes' && ['GET','POST'].includes(req.method)) {
    const file=deps.PROMPTS_FILE;
    try {
      if(req.method==='POST'){
        if((req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')return deps.send(res,403,JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
        const modes=deps.saveMode(file,await deps.parseJson(req,128*1024));
        return deps.send(res,200,JSON.stringify({ok:true,modes}));
      }
      return deps.send(res,200,JSON.stringify({ok:true,modes:deps.listModes(file)}));
    }catch(error){return deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if (req.method === 'POST' && pathname === '/api/preset-prompt') {
    if ((req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') return deps.send(res, 403, JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
    try {
      const body = await deps.parseJson(req, 128 * 1024);
      const result = deps.savePresetPrompt(body);
      return deps.send(res, 200, JSON.stringify(result));
    } catch (error) { return deps.send(res, 400, JSON.stringify({ok:false,error:error.message})); }
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    return deps.send(res, 200, JSON.stringify({ ok: true, offline: true, version: deps.VERSION, backgroundQueueVersion:1, acceptanceVersion:1, serviceManagerVersion:1, newImageVersion:2, enhanceVersion:1, makeupVersion:1, characterVersion:1, aiPort:deps.AI_PORT, instanceId: String(process.pid) }));
  }
  if (pathname === '/api/edit-history' && ['GET','POST'].includes(req.method)) {
    try {
      const file=deps.path.join(deps.ROOT,'workspace','edit-history.json');
      if(req.method==='GET')return deps.send(res,200,JSON.stringify({ok:true,items:deps.editHistory.read(file)}));
      if((req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')return deps.send(res,403,JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
      const item=deps.editHistory.append(file,await deps.parseJson(req,16*1024));
      return deps.send(res,200,JSON.stringify({ok:true,item}));
    }catch(error){return deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if (req.method === 'GET' && pathname === '/api/images') {
    const images=await deps.assetCatalog.decorate([...deps.listUploadedImages(), ...deps.listImages(deps.SAMPLES_DIR)]);
    return deps.send(res, 200, JSON.stringify({ images: images.filter(item=>url.searchParams.get('tests')==='true'||!item.testData) }));
  }
  if (req.method === 'GET' && pathname === '/api/output-prompts') {
    try {
      const file=deps.safeJoin(deps.OUTPUTS_DIR,String(url.searchParams.get('file')||''));
      if(!file||!deps.fs.existsSync(file)||!deps.fs.statSync(file).isFile()||!/\.(png|jpe?g|webp)$/i.test(file))throw new Error('Output not found');
      const sidecar=file.replace(/\.[^.]+$/,'.json'),metadata=deps.path.join(deps.path.dirname(file),'metadata.json');
      const target=deps.fs.existsSync(sidecar)?sidecar:metadata;
      const data=deps.fs.existsSync(target)?JSON.parse(deps.fs.readFileSync(target,'utf8')):{};
      return deps.send(res,200,JSON.stringify({ok:true,promptHistory:data.promptHistory||[]}));
    }catch(error){return deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if (req.method === 'GET' && pathname === '/api/library-assets') {
    const {assets,removedCount}=await deps.allLibraryAssets();
    return deps.send(res,200,JSON.stringify({ok:true,removedCount,...await deps.assetCatalog.query(assets,Object.fromEntries(url.searchParams))}));
  }
  if(req.method==='GET'&&pathname==='/api/image-projects'){const {assets}=await deps.allLibraryAssets();return deps.send(res,200,JSON.stringify({ok:true,items:await deps.assetCatalog.projects(await deps.assetCatalog.decorate(assets.filter(a=>a.sourceType!=='project')),await deps.manualStore.list())}));}
  if(pathname==='/api/anatomy-parts'&&['GET','POST'].includes(req.method)){try{const store=getAnatomyParts();if(req.method==='GET')return deps.send(res,200,JSON.stringify({ok:true,...store.read()}));const body=await deps.parseJson(req,128*1024);const result=body.action==='reset'?store.reset():body.action==='save'?store.write({items:body.items}):null;if(!result)throw Error('Thao tác danh sách bộ phận không hợp lệ.');return deps.send(res,200,JSON.stringify({ok:true,...result}));}catch(error){return deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}}
  if(req.method==='GET'&&pathname==='/api/asset-catalog-state')return deps.send(res,200,JSON.stringify({ok:true,catalog:await deps.assetCatalog.state()}));
  if(req.method==='POST'&&pathname==='/api/review-creative'){try{const body=await deps.parseJson(req,16384),assets=(await deps.allLibraryAssets()).assets,item=assets.find(i=>i.id===body.id&&i.url===body.url&&i.sourceType==='result');if(!item)throw Error('Ảnh kết quả không còn trong thư viện.');await deps.assetCatalog.update({ids:[item.id],review:{status:body.status,defects:body.defects}});let feedbackWarning='';try{const state=await deps.qualityService.call('state',{url:item.url}),result=(state.results||[]).find(i=>i.original===item.url||i.improved===item.url);if(result)await deps.qualityService.call('feedback',{resultId:result.id,target:result.improved===item.url?'improved':'original',rating:body.status==='approved'?'good':body.status==='pending'?'clear':'needs-work',defects:body.defects});}catch(e){feedbackWarning='Đã lưu quyết định; phản hồi hoàn thiện chi tiết chưa đồng bộ: '+e.message;}return deps.send(res,200,JSON.stringify({ok:true,feedbackWarning}));}catch(e){return deps.send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(req.method==='POST'&&pathname==='/api/asset-catalog'){try{return deps.send(res,200,JSON.stringify({ok:true,catalog:await deps.assetCatalog.update(await deps.parseJson(req,128*1024))}));}catch(e){return deps.send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(req.method==='GET'&&pathname==='/api/backup-preview'){try{return deps.send(res,200,JSON.stringify({ok:true,...await deps.backupStore.preview(url.searchParams.get('mode')||'full')}));}catch(e){return deps.send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(req.method==='POST'&&pathname==='/api/backup-verify'){try{const body=await deps.parseJson(req,8192);return deps.send(res,200,JSON.stringify({ok:true,...await deps.backupStore.verify(body.name)}));}catch(e){return deps.send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if (req.method === 'POST' && pathname === '/api/library-remove') {
    try {
      const body=await deps.parseJson(req,128*1024),restore=body.restore===true;
      if(!restore&&(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>1000||body.ids.some(id=>typeof id!=='string')))throw new Error('Chọn từ 1 đến 1000 ảnh.');
      const known=new Set((await deps.allLibraryAssets()).assets.map(item=>item.id));
      if(!restore&&body.ids.some(id=>!known.has(id)))throw new Error('Một số ảnh không còn trong thư viện. Hãy tải lại danh sách.');
      const removed=deps.updateRemoved(deps.path.join(deps.ROOT,'workspace','library-removed.json'),restore?[]:body.ids,restore);
      return deps.send(res,200,JSON.stringify({ok:true,removedCount:removed.length}));
    }catch(error){return deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if (req.method === 'POST' && pathname === '/api/images/upload') return deps.uploadSourceImage(req, res);
  if (req.method === 'POST' && pathname === '/api/prompt-assist') return deps.promptAssist(req, res);
  if (req.method === 'GET' && pathname === '/api/jobs') return deps.send(res, 200, JSON.stringify({ ok: true, jobs: deps.listJobs() }));
  if (req.method === 'GET' && pathname === '/api/job-events') return deps.streamJobEvents(req,res,String(url.searchParams.get('jobId')||''));
  if (req.method === 'GET' && pathname === '/api/system-check') return deps.proxyAiHealth(res);
  if (req.method === 'GET' && pathname === '/api/system-overview') return deps.systemOverview(res);
  if (req.method === 'POST' && pathname === '/api/reset-data') return deps.resetWorkspaceData(req, res);
  if (req.method === 'GET' && pathname === '/api/quality-overview') return deps.qualityOverview(res);
  if (req.method === 'GET' && pathname === '/api/lora-status') return deps.proxyAiGet(res,'/lora-status'+url.search);
  if (req.method === 'GET' && pathname === '/api/models') return deps.listModels(res);
  if (req.method === 'GET' && pathname === '/api/model-candidates') return deps.listModelCandidates(res);
  if (req.method === 'GET' && pathname === '/api/model-capabilities') return deps.modelCapabilities(res);
  if (req.method === 'GET' && pathname === '/api/models/export') return deps.exportModelManifest(res);
  if (req.method === 'GET' && pathname === '/api/benchmark-review') return deps.benchmarkReview(res,url.searchParams.get('category')||'');
  if (req.method === 'GET' && pathname === '/api/reference-readiness') return deps.referenceReadiness(res);
  if (req.method === 'GET' && pathname === '/api/chroma-status') return deps.proxyAiGet(res,'/chroma-status');
  if (req.method === 'GET' && pathname === '/api/review-readiness') return deps.reviewReadiness(res);
  if (req.method === 'GET' && pathname === '/api/retry-comparisons') return deps.listRetryComparisons(res);
  if (req.method === 'GET' && pathname === '/api/backups') return deps.listBackups(res);
  if (req.method === 'GET' && pathname === '/api/review') return deps.send(res, 200, JSON.stringify({ ok: true, state: deps.readReviewState() }));
  if (req.method === 'POST' && pathname === '/api/review') return deps.updateReview(req, res);
  if (req.method === 'POST' && pathname === '/api/export-approved') return deps.exportApprovedManifest(req, res);
  if (req.method === 'POST' && pathname === '/api/calibrate-quality') return deps.calibrateQuality(req, res);
  if (req.method === 'POST' && pathname === '/api/calibrate-weights') return deps.calibrateWeights(req, res);
  if (req.method === 'POST' && pathname === '/api/compare-weights') return deps.compareScoreWeights(req, res);
  if (req.method === 'POST' && pathname === '/api/activate-weights') return deps.activateScoreWeights(req, res);
  if (req.method === 'POST' && pathname === '/api/confirm-default-weights') return deps.confirmDefaultWeights(req, res);
  if (req.method === 'POST' && pathname === '/api/reference-profile') return deps.saveReferenceProfile(req, res);
  if (req.method === 'POST' && pathname === '/api/retry-plan') return deps.buildRetryPlan(req, res);
  if (req.method === 'POST' && pathname === '/api/retry-comparison') return deps.saveRetryComparison(req, res);
  if (req.method === 'POST' && pathname === '/api/release-acceptance') return deps.releaseAcceptance(req, res);
  if (req.method === 'POST' && pathname === '/api/golden-baseline') return deps.buildGoldenBaseline(req, res);
  if (req.method === 'POST' && pathname === '/api/compare-baseline') return deps.compareGoldenBaseline(req, res);
  if (req.method === 'POST' && pathname === '/api/cleanup-jobs') return deps.cleanupJobs(req, res);
  if (req.method === 'POST' && pathname === '/api/quality-dashboard') return deps.buildQualityDashboard(req, res);
  if (req.method === 'POST' && pathname === '/api/backup') return deps.backupWorkspace(req, res);
  if (req.method === 'POST' && pathname === '/api/restore-backup') return deps.restoreBackup(req, res);
  if (req.method === 'POST' && pathname === '/api/masks') return deps.saveMask(req, res);
  if (req.method === 'POST' && pathname === '/api/segment') return deps.proxyToAi(req, res,'/segment',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/analyze-people') return deps.proxyToAi(req, res, '/analyze-people');
  if (req.method === 'POST' && pathname === '/api/auto-mask') return deps.proxyToAi(req, res, '/auto-mask',30*1024*1024);
  if (req.method === 'GET' && pathname === '/api/runtime-model-status') return deps.proxyAiGet(res,'/runtime-model-status');
  if (req.method === 'POST' && pathname === '/api/detect-regions') return deps.proxyToAi(req,res,'/detect-regions',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/adetailer-refine') return deps.proxyToAi(req,res,'/adetailer-refine',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/sd35-conditioned-generate') {
    return deps.send(res,410,JSON.stringify({ok:false,error:'ControlNet SD3.5 dùng token CLIP đã bị loại vĩnh viễn.'}));
  }
  if (req.method === 'POST' && pathname === '/api/sdxl-conditioned-generate') {
    return deps.send(res,410,JSON.stringify({ok:false,error:'ControlNet SDXL dùng token CLIP đã bị loại vĩnh viễn.'}));
  }
  if (req.method === 'POST' && pathname === '/api/preprocess-garment') return deps.proxyToAi(req, res, '/preprocess-garment', 30 * 1024 * 1024);
  if (req.method === 'GET' && pathname === '/api/character-config') {const [health,ollama]=await Promise.all([deps.readAiGet('/health'),deps.readOllamaModels()]);return deps.send(res,200,JSON.stringify({ok:true,...(health.character||{}),serviceReady:health.characterVersion===1,plannerReady:ollama.models.some(m=>m.name===deps.MAKEUP_LLM_MODEL||m.model===deps.MAKEUP_LLM_MODEL)}));}
  if (req.method === 'POST' && ['/api/character-analyze','/api/character-preview','/api/character-render','/api/character-regenerate'].includes(pathname)) return deps.proxyToAi(req,res,pathname.slice(4),30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/character-refine') {try{return deps.send(res,200,JSON.stringify(await require('./character-refine').refine(await deps.parseJson(req,16384),deps.requestLocalLlm,deps.MAKEUP_LLM_MODEL)));}catch(e){return deps.send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if (req.method === 'POST' && pathname === '/api/character-plan') {try{return deps.send(res,200,JSON.stringify(await require('./character-plan').plan(await deps.parseJson(req,8192),deps.requestLocalLlm,deps.MAKEUP_LLM_MODEL)));}catch(e){return deps.send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if (pathname === '/api/character-presets' && ['GET','POST'].includes(req.method)) {try{const store=require('./character-presets');const file=deps.path.join(deps.ROOT,'workspace','character-presets.json');return deps.send(res,200,JSON.stringify(req.method==='GET'?store.read(file):store.save(file,await deps.parseJson(req,32768))));}catch(e){return deps.send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if (req.method === 'POST' && pathname === '/api/makeup-compare') return deps.proxyToAi(req,res,'/makeup-compare',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/makeup') return deps.proxyToAi(req,res,'/makeup',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/makeup-analyze') return deps.proxyToAi(req,res,'/makeup-analyze');
  if (req.method === 'POST' && pathname === '/api/makeup-reference') return deps.proxyToAi(req,res,'/makeup-reference');
  if (pathname === '/api/makeup-library' && ['GET','POST'].includes(req.method)) {
    try {
      const library=require('./makeup-library-store'),file=deps.path.join(deps.ROOT,'workspace','makeup-styles.json');
      if(req.method==='GET')return deps.send(res,200,JSON.stringify({ok:true,styles:library.read(file)}));
      const body=await deps.parseJson(req,16384),item=library.save(file,body);
      return deps.send(res,200,JSON.stringify({ok:true,item,styles:library.read(file)}));
    } catch(error) {return deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if (req.method === 'GET' && pathname === '/api/makeup-config') {const [health,ollama]=await Promise.all([deps.readAiGet('/health'),deps.readOllamaModels()]);return deps.send(res,200,JSON.stringify({ok:true,...(health.makeup||{}),serviceReady:health.makeupVersion===1,plannerReady:ollama.models.some(model=>model.name===deps.MAKEUP_LLM_MODEL||model.model===deps.MAKEUP_LLM_MODEL)}));}
  if (req.method === 'POST' && pathname === '/api/makeup-plan') {try{const body=await deps.parseJson(req,8192);return deps.send(res,200,JSON.stringify(await require('./makeup-plan').planMakeup(body,deps.requestLocalLlm,deps.MAKEUP_LLM_MODEL)));}catch(error){return deps.send(res,400,JSON.stringify({ok:false,error:'Không đọc được mô tả: '+error.message}));}}
  if (req.method === 'POST' && pathname === '/api/enhance') return deps.proxyToAi(req,res,'/enhance',30*1024*1024);
  if (req.method === 'GET' && pathname === '/api/enhance-config') {const health=await deps.readAiGet('/health');return deps.send(res,200,JSON.stringify({ok:true,...(health.enhancement||{}),serviceReady:health.enhanceVersion===1}));}
  if (req.method === 'POST' && pathname === '/api/outpaint') return deps.proxyToAi(req,res,'/outpaint',30*1024*1024);
  if (req.method === 'GET' && pathname === '/api/outpaint-config') {const health=await deps.readAiGet('/health');return deps.send(res,200,JSON.stringify({ok:true,version:2,serviceReady:health.outpaintVersion===2,maxPixels:Number(process.env.ATELIER_OUTPAINT_MAX_PIXELS||16777216),timing:require('./outpaint-timing').outpaintTiming(deps.listJobs(),deps.JOBS_DIR)}));}
  if (req.method === 'POST' && pathname === '/api/inpaint') return deps.proxyToAi(req,res,'/inpaint',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/anatomy-preview') return deps.proxyToAi(req,res,'/anatomy-preview',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/anatomy-inpaint') return deps.proxyToAi(req,res,'/anatomy-inpaint',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/inpaint-prompts') return deps.proxyToAi(req,res,'/inpaint-prompts',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/qwen-depth-generate') return deps.proxyToAi(req,res,'/qwen-depth-generate',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/lora-configure') return deps.proxyToAi(req,res,'/lora-configure');
  if (req.method === 'POST' && pathname === '/api/lora-ab-test') return deps.proxyToAi(req,res,'/lora-ab-test',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/lora-ab-matrix') return deps.proxyToAi(req,res,'/lora-ab-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/lora-strength-matrix') return deps.proxyToAi(req,res,'/lora-strength-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/texture-recovery-matrix') return deps.proxyToAi(req,res,'/texture-recovery-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/structural-refine-matrix') return deps.proxyToAi(req,res,'/structural-refine-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/effective-step-matrix') return deps.proxyToAi(req,res,'/effective-step-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/hybrid-tryon-compare') return deps.proxyToAi(req,res,'/hybrid-tryon-compare',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/normalize-garment-reference') return deps.proxyToAi(req,res,'/normalize-garment-reference',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/validate-reference') return deps.proxyToAi(req,res,'/validate-product-reference',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/qualify-reference') return deps.proxyToAi(req,res,'/qualify-product-reference',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/chroma-smoke') return deps.proxyToAi(req,res,'/chroma-smoke');
  if (req.method === 'POST' && pathname === '/api/new-image-plan') return deps.proxyToAi(req,res,'/new-image-plan');
  if (req.method === 'GET' && pathname === '/api/new-image-config') {const health=await deps.readAiGet('/health');return deps.send(res,200,JSON.stringify({ok:true,version:2,serviceReady:health.newImageVersion===2}));}
  if (req.method === 'POST' && pathname === '/api/chroma-generate') return deps.proxyToAi(req,res,'/chroma-generate');
  if (req.method === 'POST' && pathname === '/api/catvton-reference-matrix') return deps.proxyToAi(req,res,'/catvton-reference-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/catvton-dedicated-mask-matrix') return deps.proxyToAi(req,res,'/catvton-dedicated-mask-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/catvton-retry-matrix') return deps.proxyToAi(req,res,'/catvton-retry-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/catvton-color-audit') return deps.proxyToAi(req,res,'/catvton-color-audit',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/catvton-geometry-audit') return deps.proxyToAi(req,res,'/catvton-geometry-audit',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/models/register') return deps.registerModel(req,res);
  if (req.method === 'POST' && pathname === '/api/models/download') return deps.startModelDownload(req,res);
  if (req.method === 'POST' && pathname === '/api/models/download-all') return deps.startAllModelDownloads(req,res);
  if (req.method === 'POST' && pathname === '/api/models/url/analyze') return deps.analyzeModelUrl(req,res);
  if (req.method === 'POST' && pathname === '/api/models/url/register') return deps.registerModelUrl(req,res);
  if (req.method === 'POST' && pathname === '/api/models/activate') return deps.activateModel(req,res);
  if (req.method === 'POST' && pathname === '/api/model-capabilities/select') return deps.selectFeatureModel(req,res);
  if (req.method === 'POST' && pathname === '/api/models/quarantine') return deps.quarantineModel(req,res);
  if (req.method === 'POST' && pathname === '/api/models/restore') return deps.restoreQuarantinedModel(req,res);
  if (req.method === 'POST' && pathname === '/api/models/delete') return deps.deleteModel(req,res);
  if (req.method === 'POST' && pathname === '/api/tryon') return deps.proxyToAi(req, res, '/tryon', 30 * 1024 * 1024);
  if (req.method === 'POST' && pathname === '/api/batch-tryon') return deps.proxyToAi(req, res, '/batch-tryon', 30 * 1024 * 1024);
  if (req.method === 'POST' && pathname === '/api/cancel-job') return deps.proxyToAi(req, res, '/cancel-job');
  if (req.method === 'POST' && pathname === '/api/job-status') return deps.proxyToAi(req, res, '/job-status');
  if (req.method === 'POST' && pathname === '/api/resume-job') return deps.proxyToAi(req, res, '/resume-job', 30 * 1024 * 1024);
  if (req.method === 'POST' && pathname === '/api/benchmark') return deps.benchmarkWithPreflight(req, res);
  if (req.method === 'POST' && pathname === '/api/regression-audit') return deps.proxyToAi(req, res, '/regression-audit');
  if (req.method === 'POST' && pathname === '/api/select-result') return deps.selectResult(req, res);
  if (req.method === 'GET' && pathname === '/sample-credits') {
    return deps.serveFile(res, deps.path.join(deps.SAMPLES_DIR, 'licenses'), 'index.html');
  }
  if (req.method === 'GET' && /^\/sample-thumbnails\/[a-f0-9]{16}\.webp$/.test(pathname)) {
    return deps.serveFile(res, deps.path.join(deps.SAMPLES_DIR, 'previews', 'demo'), deps.path.basename(pathname));
  }
  if (req.method === 'GET' && pathname.startsWith('/samples/')) {
    const id = pathname.slice('/samples/'.length);
    const file = deps.resolveSamplePath(id);
    if (!file) return deps.send(res, 404, 'Sample not found');
    return deps.serveFile(res, deps.path.dirname(file), deps.path.basename(file));
  }
  if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
    return deps.serveFile(res, deps.UPLOADS_DIR, pathname.slice('/uploads/'.length));
  }
  if (req.method === 'GET' && pathname.startsWith('/outputs/')) {
    return deps.serveFile(res, deps.OUTPUTS_DIR, pathname.slice('/outputs/'.length));
  }
  if (req.method === 'GET' && pathname.startsWith('/references/')) {
    return deps.serveFile(res, deps.REFERENCES_DIR, pathname.slice('/references/'.length));
  }
  if (req.method === 'GET' && pathname.startsWith('/workspace/outputs/')) {
    return deps.serveFile(res, deps.OUTPUTS_DIR, pathname.slice('/workspace/outputs/'.length));
  }
  if (req.method === 'GET' && pathname === '/reports/regression-report.html') return deps.serveFile(res, deps.REVIEW_DIR, 'regression-report.html');
  if (req.method === 'GET' && pathname === '/reports/quality-dashboard.html') return deps.serveFile(res, deps.REVIEW_DIR, 'quality-dashboard.html');
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return deps.serveFile(res, deps.PUBLIC_DIR, 'index.html');
  }
  if (req.method === 'GET') return deps.serveFile(res, deps.PUBLIC_DIR, pathname.slice(1));
  deps.send(res, 405, JSON.stringify({ error: 'Phương thức không được hỗ trợ' }));
}
return {get handleRequest(){return handleRequest;},set handleRequest(value){handleRequest=value;}};
};
