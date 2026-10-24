const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { trustedRequest } = require('./request-security');
const {FILE:PROMPTS_FILE, readCatalog, updateCatalog, renderTemplate, savePresetPrompt, listModes, saveMode, migrateBrowser, previewImport, importCatalog} = require('./prompt-store');
const { readRemoved, updateRemoved } = require('./library-removal-store');
const editHistory = require('./edit-history-store');
const jsonConfigStore=require('./json-config-store').createStore();

const ROOT = path.resolve(__dirname, '..');
const manualStore = require('./manual-store').createStore(ROOT);
const qualityService = require('./quality-service').createQualityService(ROOT);
process.once('exit', () => qualityService.stop());
const PUBLIC_DIR = path.join(__dirname, 'public');
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
const MODEL_DOWNLOAD_PYTHON = path.join(ROOT, '.venv-sam2', 'Scripts', 'python.exe');
const MODEL_HISTORY = path.join(ROOT, 'workspace', 'model-registry-history');
const CONFIG_FILE = path.join(ROOT, 'workspace', 'config.json');
const assetCatalog=require('./asset-catalog').createCatalog(ROOT);
const regionStore=require('./region-store').createRegionStore(ROOT);
const workQueue=require('./work-queue-store').createQueueStore(ROOT);
const exportPresets=require('./export-presets').createExportPresets(ROOT);
const backupStore=require('./backup-store').createBackupStore(ROOT,{config:CONFIG_FILE,prompts:PROMPTS_FILE});
const HOST = '127.0.0.1';
const PORT = Number(process.env.AI_IMAGE_PORT || 7860);
const AI_PORT = Number(process.env.AI_SEGMENT_PORT || 7861);
const LLM_BASE_URL = String(process.env.ATELIER_LLM_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const LLM_MODEL = String(process.env.ATELIER_LLM_MODEL || 'llava:7b');
const MAKEUP_LLM_MODEL = String(process.env.ATELIER_MAKEUP_LLM_MODEL || 'qwen3:4b');
const {readVersion,webRevision}=require('./runtime-version');
const VERSION=readVersion(ROOT), WEB_REVISION=webRevision(ROOT);
const acceptanceStore=require('./acceptance-store').createAcceptanceStore(ROOT);
const backgroundRenderer=require('./background-renderer').createRenderer(ROOT,`http://${HOST}:${PORT}`);
let serviceManager;
const queueRunner=require('./work-queue-runner').createRunner(ROOT,{store:workQueue,manualStore,renderer:backgroundRenderer,ai:callAiJson,canRun:()=>!webRestartPending&&!serviceManager?.busy()});
serviceManager=require('./service-manager').createServiceManager(ROOT,{aiGet:readAiGet,aiPost:callAiJson,queues:workQueue,jobs:listJobs,runner:queueRunner,port:PORT,aiPort:AI_PORT,loadedVersion:VERSION,loadedRevision:WEB_REVISION});
process.once('exit',()=>backgroundRenderer.stop());

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

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function safeJoin(base, relativePath) {
  const target = path.resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

function resolveSamplePath(sampleId) {
  const normalized = String(sampleId || '').replace(/\\/g, '/');
  if (normalized.startsWith('uploads/')) return safeJoin(UPLOADS_DIR, normalized.slice('uploads/'.length));
  return safeJoin(SAMPLES_DIR, normalized);
}

function listImages(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(prefix, entry.name);
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listImages(full, rel);
    if (!/\.(png|jpe?g|webp)$/i.test(entry.name)) return [];
    return [{ id: rel, name: entry.name, group: prefix || 'root', sourceType: 'sample', url: `/samples/${rel}` }];
  });
}

function listUploadedImages() {
  return listImages(UPLOADS_DIR).map((item) => ({
    ...item,
    id: `uploads/${item.id}`,
    group: 'Ảnh của bạn',
    sourceType: 'user',
    url: `/uploads/${item.id}`,
  }));
}

async function listOutputAssets() {
  return require('./output-assets').listOutputAssets(OUTPUTS_DIR,Infinity);
}
async function allLibraryAssets(){
  const sources=[...listUploadedImages(),...listImages(SAMPLES_DIR)].map(item=>{const file=item.sourceType==='user'?safeJoin(UPLOADS_DIR,item.id.slice(8)):safeJoin(SAMPLES_DIR,item.id);const stat=fs.statSync(file);return {...item,createdAt:stat.mtime.toISOString(),sizeBytes:stat.size,task:'source'};});
  const sessions=(await manualStore.list()).map(p=>({id:'project:'+p.id,name:p.name,url:p.thumbnail,createdAt:p.updatedAt,projectId:p.id,revision:p.revision,sourceId:p.sourceId,sourceType:'project',task:'manual',group:'Phiên chỉnh sửa'}));
  const removed=new Set(readRemoved(path.join(ROOT,'workspace','library-removed.json')));
  return {removedCount:removed.size,assets:[...await listOutputAssets(),...listReferenceAssets(),...sources,...sessions].filter(item=>!removed.has(item.id))};
}
function listReferenceAssets(){return listImages(REFERENCES_DIR).map((item)=>{const full=safeJoin(REFERENCES_DIR,item.id),stat=fs.statSync(full);return{...item,id:`reference:${item.id}`,group:'Tham chiếu',sourceType:'reference',url:`/references/${item.id}`,createdAt:stat.mtime.toISOString(),sizeBytes:stat.size,task:'reference'};});}

async function uploadSourceImage(req, res) {
  try {
    const body = await parseJson(req, 32 * 1024 * 1024);
    const match = String(body.data || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('Chỉ hỗ trợ ảnh PNG, JPG hoặc WebP');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Ảnh phải nhỏ hơn 20 MB');
    const signatures = {
      'image/png': bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
      'image/jpeg': bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
      'image/webp': bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
    };
    if (!signatures[match[1]]) throw new Error('Nội dung tệp không khớp định dạng ảnh');
    const extensions = {'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
    const original = path.basename(String(body.name || 'image')).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'image';
    const filename = `${original}-${crypto.randomBytes(6).toString('hex')}${extensions[match[1]]}`;
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), bytes, { flag: 'wx' });
    return send(res, 201, JSON.stringify({ ok: true, image: { id:`uploads/${filename}`, name:String(body.name || filename), group:'Ảnh của bạn', sourceType:'user', url:`/uploads/${filename}` } }));
  } catch (error) {
    return send(res, 400, JSON.stringify({ ok: false, error: error.message }));
  }
}

function listJobs() {
  if (!fs.existsSync(JOBS_DIR)) return [];
  return fs.readdirSync(JOBS_DIR).filter((name) => name.endsWith('.json') && !name.endsWith('.request.json') && !name.endsWith('.checkpoint.json')).map((name) => {
    try { return JSON.parse(fs.readFileSync(path.join(JOBS_DIR, name), 'utf8')); } catch { return null; }
  }).filter(Boolean).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function latestOutputBySource() {
  const latest = new Map();
  if (!fs.existsSync(OUTPUTS_DIR)) return latest;
  for (const entry of fs.readdirSync(OUTPUTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(OUTPUTS_DIR, entry.name);
    const metadataPath = path.join(directory, 'metadata.json');
    const selectedPath = path.join(directory, 'selected.png');
    if (!fs.existsSync(metadataPath) || !fs.existsSync(selectedPath)) continue;
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (!metadata.source || !metadata.selectedMetrics) continue;
      const previous = latest.get(metadata.source);
      if (!previous || String(metadata.createdAt) > String(previous.metadata.createdAt)) latest.set(metadata.source, { metadata, selectedPath });
    } catch {}
  }
  return latest;
}

function parseJson(req, maxBytes = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data) > maxBytes) {
        reject(new Error('Payload quá lớn'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('JSON không hợp lệ')); }
    });
    req.on('error', reject);
  });
}

function decodePngDataUrl(value) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value || '');
  if (!match) throw new Error('Dữ liệu mask không hợp lệ');
  return Buffer.from(match[1], 'base64');
}

function decodeImageDataUrl(value) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value || '');
  if (!match) throw new Error('Ảnh tham chiếu phải là PNG, JPEG hoặc WebP');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('Ảnh tham chiếu không hợp lệ hoặc vượt quá 20 MB');
  return { buffer, extension: match[1] === 'jpeg' ? 'jpg' : match[1] };
}

function callAiJson(endpoint, body) {
  return new Promise((resolve,reject)=>{
    const disconnected=()=>reject(Object.assign(new Error('Dịch vụ AI chưa kết nối'),{code:'AI_CONNECTION'}));
    const payload=Buffer.from(JSON.stringify(body),'utf8');
    const request=http.request({hostname:'127.0.0.1',port:AI_PORT,path:endpoint,method:'POST',headers:{'Content-Type':'application/json','Content-Length':payload.length}},response=>{
      let data='';response.on('data',chunk=>data+=chunk);response.on('aborted',disconnected);response.on('error',disconnected);
      response.on('end',()=>{try{const parsed=JSON.parse(data||'{}');if((response.statusCode||500)>=400)return reject(new Error(parsed.error||'Dịch vụ AI từ chối yêu cầu'));resolve(parsed);}catch(error){reject(error);}});
    });request.on('error',disconnected);request.end(payload);
  });
}

const PROMPT_ASSIST_TASKS = new Proxy({}, {get:(_,key)=>readCatalog().promptAssist.tasks[key]});

function parseAssistResult(raw, fallback) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const candidate = cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (candidate) try {
    const parsed = JSON.parse(candidate);
    return {
      suggestion: String(parsed.suggestion || fallback || '').trim(),
      changes: Array.isArray(parsed.changes) ? parsed.changes.map(String).slice(0, 5) : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 5) : [],
      qualityScore: Number.isFinite(Number(parsed.qualityScore)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.qualityScore)))) : null,
    };
  } catch {}
  return { suggestion: cleaned || fallback, changes: [], warnings: [], qualityScore: null };
}

function isPromptRequest(value) {
  const text = String(value || '').trim().toLowerCase();
  return !text || /\?|^(please|can you|could you|would you|create (?:an?|the) (?:image|prompt)|generate (?:an?|the) (?:image|prompt)|write (?:an?|the) prompt|here(?:'s| is)|sure[,!]|hãy|vui lòng|tạo (?:một |ảnh|prompt)|viết (?:một |prompt)|bạn có thể|tôi cần)/i.test(text);
}

function assistantFallback(task, currentText) {
  const idea = String(currentText || '').trim();
  if (task === 'negativePrompt' || task === 'optimizeNegativePrompt') {
    return normalizeNegativePrompt(currentText);
  }
  return idea;
}

function uniquePromptTerms(values) {
  const seen = new Set();
  return values.map((item) => String(item || '').trim().replace(/^[-•\s]+/, '')).filter((item) => {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function normalizeImagePrompt(value) {
  return String(value || '')
    .replace(/(?:\.|,)?\s*(?:for\s+(?:the\s+)?negative\s*prompt|negative\s*prompt|no\s+negative\s+outcomes|as\s+an\s+ai)\b[\s\S]*$/i, '')
    .replace(/\s+/g, ' ').replace(/[\s,;]+$/, '').trim();
}

function normalizeNegativePrompt(value) {
  const generated = String(value || '').split(/[,\n;]/).filter((term) => {
    const normalized = term.trim().toLowerCase();
    if (!normalized || /^(?:short\s+warning|none|n\/a)$/i.test(normalized)) return false;
    return true;
  });
  return uniquePromptTerms(generated).join(', ');
}

function requestLocalLlm(payload, timeoutMs = 90000) {
  const target = new URL('/api/chat', LLM_BASE_URL);
  if (!['http:', 'https:'].includes(target.protocol)) return Promise.reject(new Error('Địa chỉ LLM không hợp lệ'));
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const transport = target.protocol === 'https:' ? require('https') : http;
    const request = transport.request({
      hostname: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname, method: 'POST',
      headers: {'Content-Type':'application/json','Content-Length':data.length},
    }, (response) => {
      let responseBody = '';
      response.on('data', (chunk) => { responseBody += chunk; if (Buffer.byteLength(responseBody) > 2 * 1024 * 1024) request.destroy(new Error('Phản hồi LLM quá lớn')); });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody || '{}');
          if ((response.statusCode || 500) >= 400) return reject(new Error(parsed.error || `LLM trả về HTTP ${response.statusCode}`));
          resolve(parsed);
        } catch { reject(new Error('LLM trả về dữ liệu không hợp lệ')); }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('LLM phản hồi quá thời gian')));
    request.on('error', reject);
    request.end(data);
  });
}

async function promptAssist(req, res) {
  try {
    const body = await parseJson(req, 32 * 1024 * 1024);
    const task = String(body.task || '');
    if (!PROMPT_ASSIST_TASKS[task]) throw new Error('Loại gợi ý không được hỗ trợ');
    const currentText = String(body.currentText || '').trim().slice(0, 4000);
    let context = String(body.context || '').trim().slice(0, 2000);
    if(body.imageModelId){const id=String(body.imageModelId),family=id==='sd35-medium'?'sd35':id==='flux-chroma1-hd'?'chroma':id==='flux-2-klein-4b'?'klein':'sdxl';const limits={sd35:'CLIP 77 tokens; T5 256 tokens. A separate short CLIP description is supported.',sdxl:'Both CLIP encoders allow 77 tokens.',chroma:'T5 allows 512 tokens.',klein:'Qwen allows 512 tokens including its chat wrapper. Negative prompts are not supported.'};context += '\nModel: '+id+'. '+limits[family]+(body.shortClip?' Produce a short description well below 77 tokens. Preserve the main subject, action and constraints.':'');}
    const images = [];
    if (body.sampleId) {
      const source = resolveSamplePath(body.sampleId);
      if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('Không tìm thấy ảnh nguồn');
      const bytes = fs.readFileSync(source);
      if (bytes.length > 20 * 1024 * 1024) throw new Error('Ảnh nguồn vượt quá 20 MB');
      images.push(bytes.toString('base64'));
    }
    if (body.mask) images.push(decodePngDataUrl(body.mask).toString('base64'));
    const instruction = renderTemplate(readCatalog().promptAssist.instruction,{task:PROMPT_ASSIST_TASKS[task],currentText:currentText||'(empty)',context:context||'(none)'});
    const message = {role:'user',content:instruction};
    if (images.length) message.images = images;
    const result = await requestLocalLlm({model:LLM_MODEL,stream:false,messages:[{role:'system',content:readCatalog().promptAssist.system},message],options:{temperature:0.2,num_predict:320}});
    const assisted = parseAssistResult(result.message?.content || result.response, task === 'analyzePrompt' ? currentText : '');
    if (['imagePrompt','optimizePrompt','shortenPrompt','expandPrompt'].includes(task)) assisted.suggestion = normalizeImagePrompt(assisted.suggestion);
    if (['negativePrompt','optimizeNegativePrompt'].includes(task)) assisted.suggestion = normalizeNegativePrompt(assisted.suggestion);
    assisted.changes = assisted.changes.filter((item) => !/^(?:short change|none|n\/a)$/i.test(String(item).trim()));
    assisted.warnings = assisted.warnings.filter((item) => {
      const text = String(item).trim();
      return !/^(?:short warning|none|n\/a)$/i.test(text) && !(text.length > 5 && String(context || '').toLowerCase().includes(text.toLowerCase()));
    });
    if (task !== 'analyzePrompt' && isPromptRequest(assisted.suggestion)) {
      assisted.suggestion = assistantFallback(task, currentText);
      assisted.changes = [];
      assisted.qualityScore = null;
      assisted.warnings = ['AI không trả về nội dung hợp lệ; hệ thống giữ lại nội dung hiện có.'];
    }
    assisted.suggestion = assisted.suggestion.slice(0, 4000);
    if (!assisted.suggestion && task !== 'analyzePrompt') throw new Error('LLM không tạo được nội dung gợi ý');
    return send(res, 200, JSON.stringify({ok:true,...assisted,model:LLM_MODEL,usedImage:images.length > 0}));
  } catch (error) {
    const unavailable = /ECONNREFUSED|ENOTFOUND|socket|LLM phản hồi quá thời gian/i.test(String(error.message));
    return send(res, unavailable ? 503 : 400, JSON.stringify({ok:false,error:unavailable?'Trợ lý AI cục bộ chưa sẵn sàng. Hãy chạy Ollama và kiểm tra model cấu hình.':error.message}));
  }
}

function readModelRegistry(){if(!fs.existsSync(MODEL_REGISTRY))return{schemaVersion:1,models:[],quarantine:[]};return JSON.parse(fs.readFileSync(MODEL_REGISTRY,'utf8'));}
function readLocalConfig(){if(!fs.existsSync(CONFIG_FILE))return{};return JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8'));}
function resolveModelPath(value){
  const raw=String(value||''),configured=path.isAbsolute(raw)?path.resolve(raw):safeJoin(ROOT,raw);
  if(!configured||fs.existsSync(configured))return configured;
  const modelsRoot=path.resolve(ROOT,'models');
  if(configured.startsWith(modelsRoot+path.sep)){
    const manuallyCopied=path.join(modelsRoot,path.basename(configured));
    if(manuallyCopied!==configured&&fs.existsSync(manuallyCopied))return manuallyCopied;
    const matches=[];
    const findNamedModel=(folder)=>{for(const entry of fs.readdirSync(folder,{withFileTypes:true})){if(!entry.isDirectory()||entry.name.endsWith('.partial')||['.cache','quarantine'].includes(entry.name))continue;const target=path.join(folder,entry.name);if(entry.name===path.basename(configured)&&fs.existsSync(path.join(target,'model_index.json')))matches.push(target);else findNamedModel(target);}};
    if(fs.existsSync(modelsRoot))findNamedModel(modelsRoot);
    if(matches.length===1)return matches[0];
  }
  return configured;
}
function directorySize(target){
  try{
    const stat=fs.statSync(target);if(stat.isFile())return stat.size;
    let total=0;for(const entry of fs.readdirSync(target,{withFileTypes:true})){if(entry.isSymbolicLink())continue;total+=directorySize(path.join(target,entry.name));}return total;
  }catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))return 0;throw error;}
}
function verifyModelEntry(entry){const target=resolveModelPath(entry.path);const reasons=[];if(!target||!fs.existsSync(target))reasons.push('Không tìm thấy đường dẫn');else{const stat=fs.statSync(target);if((entry.requiredFiles||[]).length&&!stat.isDirectory())reasons.push('Model phải là thư mục');for(const relative of entry.requiredFiles||[])if(!fs.existsSync(path.join(target,relative)))reasons.push(`Thiếu ${relative}`);}return{...entry,resolvedPath:target||'',exists:Boolean(target&&fs.existsSync(target)),sizeBytes:target&&fs.existsSync(target)?directorySize(target):0,ready:!reasons.length,reasons};}
function activeModelPath(registry,config,configKey){if(!configKey)return'';if(config[configKey])return path.resolve(config[configKey]);const fallback=registry.models.find((item)=>item.configKey===configKey);return fallback?resolveModelPath(fallback.path):'';}
function saveModelRegistry(registry,action){fs.mkdirSync(MODEL_HISTORY,{recursive:true});if(fs.existsSync(MODEL_REGISTRY)){const snapshot=path.join(MODEL_HISTORY,`${new Date().toISOString().replace(/[:.]/g,'-')}-${action}.json`);fs.copyFileSync(MODEL_REGISTRY,snapshot);}registry.updatedAt=new Date().toISOString();fs.writeFileSync(MODEL_REGISTRY,JSON.stringify(registry,null,2),'utf8');}
function inferLocalModelKind(target,isFile=false){const value=target.toLowerCase().replace(/\\/g,'/');if(value.includes('/lora/')||value.includes('/adapters/'))return'adapter';if(value.includes('/controlnet/'))return'controlnet';if(value.includes('/segmentation/'))return'segmentation';if(value.includes('/detection/'))return'detection';if(value.includes('/pose/'))return'pose';if(value.includes('/tryon/'))return'tryon';if(value.includes('inpaint'))return'inpaint';if(isFile)return'checkpoint';return'text-to-image';}
function inferLocalArchitecture(target){const value=target.toLowerCase();if(value.includes('sdxl')||value.includes('stable-diffusion-xl'))return'sdxl';if(value.includes('sd3.5')||value.includes('sd35')||value.includes('stable-diffusion-3.5'))return'sd35';if(value.includes('sd1.5')||value.includes('stable-diffusion-v1'))return'sd15';return'auto';}
function discoverLocalModels(registry){
  const modelsRoot=path.resolve(ROOT,'models'),known=new Set(),quarantined=path.join(modelsRoot,'quarantine');
  const catalog=readDownloadCatalog().candidates,catalogByPath=new Map(catalog.map((item)=>[path.resolve(safeJoin(ROOT,item.targetPath)||'').toLowerCase(),item]));
  let registryChanged=false;
  registry.models=registry.models.filter((item)=>{if(!item.autoDetected)return true;const target=path.resolve(resolveModelPath(item.path)||'').toLowerCase(),transient=target.split(path.sep).some((part)=>part.endsWith('.partial')||part==='.cache'),catalogOwned=[...catalogByPath.keys()].some((catalogPath)=>target===catalogPath||target.startsWith(catalogPath+path.sep)),catalogItem=catalogByPath.get(target),canonicalExists=catalogItem&&registry.models.some((other)=>other!==item&&other.id===catalogItem.id);if(transient||catalogOwned||canonicalExists){registryChanged=true;return false;}return true;});
  for(const item of [...registry.models,...(registry.quarantine||[])]){const target=resolveModelPath(item.path);if(target)known.add(path.resolve(target).toLowerCase());}
  const discovered=[];
  const add=(target,isFile=false)=>{
    const resolved=path.resolve(target),key=resolved.toLowerCase();if(known.has(key)||resolved.startsWith(quarantined+path.sep))return;
    const relative=path.relative(ROOT,resolved).replace(/\\/g,'/'),base=path.basename(resolved,path.extname(resolved));
    const catalogItem=catalogByPath.get(key);if(catalogItem&&registry.models.some((item)=>item.id===catalogItem.id)){known.add(key);return;}
    const preferredId=catalogItem&&/^[a-z0-9][a-z0-9.-]{1,63}$/.test(catalogItem.id)?catalogItem.id:slugModelId(catalogItem?.id||base);let id=preferredId,suffix=2;while(registry.models.some((item)=>item.id===id)||discovered.some((item)=>item.id===id))id=`${slugModelId(preferredId).slice(0,58)}-${suffix++}`;
    discovered.push({id,name:catalogItem?.name||base.replace(/[-_]+/g,' ').replace(/\b\w/g,(char)=>char.toUpperCase()),kind:catalogItem?.kind||inferLocalModelKind(resolved,isFile),architecture:catalogItem?.architecture||inferLocalArchitecture(resolved),path:relative,configKey:catalogItem?.configKey||'',requiredFiles:isFile?[]:['model_index.json'],license:catalogItem?.license||'unknown',source:catalogItem?.source||'local-auto-scan',status:'auto-detected',autoDetected:true,registeredAt:new Date().toISOString()});known.add(key);
  };
  const walk=(directory)=>{
    const resolved=path.resolve(directory),key=resolved.toLowerCase();if(resolved!==modelsRoot&&(known.has(key)||resolved.startsWith(quarantined+path.sep)))return;
    if(resolved!==modelsRoot&&(path.basename(resolved).endsWith('.partial')||catalogByPath.has(key)))return;
    let entries;try{entries=fs.readdirSync(resolved,{withFileTypes:true});}catch{return;}
    if(entries.some((entry)=>entry.isFile()&&entry.name==='model_index.json')){add(resolved);return;}
    for(const entry of entries){const target=path.join(resolved,entry.name);if(entry.isDirectory()){if(!entry.name.endsWith('.partial')&&!['quarantine','.cache','.git','__pycache__'].includes(entry.name))walk(target);}else if(/\.(safetensors|ckpt|pt|pth|bin)$/i.test(entry.name)&&resolved!==modelsRoot&&!known.has(key)){add(target,true);}}
  };
  walk(modelsRoot);
  if(discovered.length||registryChanged){registry.models.push(...discovered);saveModelRegistry(registry,'auto-discover');}
  return discovered;
}
function sd35DepthOperationalState(){
  const config=readLocalConfig(),root=path.resolve(config.controlnetDepthSd35Model||path.join(ROOT,'models/controlnet/depth-sd35-large')),depth=path.resolve(config.depthEstimatorModel||path.join(ROOT,'models/depth/depth-anything-v2-large'));
  const files=[[root,'config.json'],[root,'diffusion_pytorch_model.safetensors'],[depth,'config.json'],[depth,'preprocessor_config.json'],[depth,'model.safetensors'],[path.join(ROOT,'models/text-to-image/stable-diffusion-3.5-large'),'model_index.json']];
  const missing=files.filter(([folder,name])=>!fs.existsSync(path.join(folder,name))).map(([folder,name])=>path.join(folder,name));
  let reason=missing.length?'ControlNet SD3.5 chưa sẵn sàng: thiếu model ControlNet, model chiều sâu hoặc SD3.5 Large.':'';
  if(missing.length){try{const install=JSON.parse(fs.readFileSync(path.join(ROOT,'workspace/sd35-depth-install.json'),'utf8'));if(install.state==='downloading')reason=`Đang tải ${install.repo?.includes('Depth-Anything')?'model chiều sâu':'ControlNet SD3.5'} · ${Math.floor(Number(install.bytes||0)*100/Math.max(1,Number(install.total||1)))}%`;else if(install.state==='failed')reason='Tải model chưa hoàn tất. Chạy lại trình cài ControlNet SD3.5 để tiếp tục.';}catch{}}
  return {operationalReady:!missing.length,runtimeReason:reason,runtimeMissing:missing};
}
function modelOperationalState(entry,checked){if(entry.id==='controlnet-depth-sd35-large'){const state=sd35DepthOperationalState();return {...state,operationalReady:checked.ready&&state.operationalReady};}if(entry.kind==='inpaint'){const target=checked.resolvedPath,required=['model_index.json','scheduler/scheduler_config.json'];const missing=!target||!fs.existsSync(target)||!fs.statSync(target).isDirectory()?['thư mục model Diffusers']:required.filter((relative)=>!fs.existsSync(path.join(target,relative)));let pipeline='';try{pipeline=String(JSON.parse(fs.readFileSync(path.join(target,'model_index.json'),'utf8'))._class_name||'');}catch{}const expected={sd35:'StableDiffusion3InpaintPipeline',sd3:'StableDiffusion3InpaintPipeline',sdxl:'StableDiffusionXLInpaintPipeline',sd15:'StableDiffusionInpaintPipeline',sd2:'StableDiffusionInpaintPipeline',flux:'FluxFillPipeline'}[String(entry.architecture||'').toLowerCase()];if(expected&&pipeline&&pipeline!==expected)missing.push(`pipeline ${expected}`);return{operationalReady:checked.ready&&!missing.length,runtimeReason:missing.length?`Thiếu cấu trúc Diffusers: ${missing.join(', ')}`:''};}const sdxlIds=new Set(['ip-adapter-sdxl','controlnet-depth-sdxl-small','controlnet-union-sdxl-1.0']);if(!sdxlIds.has(entry.id))return{operationalReady:checked.ready,runtimeReason:''};const config=readLocalConfig(),base=path.resolve(process.env.SDXL_BASE_MODEL||config.sdxlBaseModel||path.join(ROOT,'models','text-to-image','stable-diffusion-xl-base-1.0'));const required=['model_index.json','unet/config.json','unet/diffusion_pytorch_model.fp16.safetensors','vae/diffusion_pytorch_model.fp16.safetensors','text_encoder/model.fp16.safetensors','text_encoder_2/model.fp16.safetensors'];const missing=required.filter((relative)=>!fs.existsSync(path.join(base,relative)));return{operationalReady:checked.ready&&!missing.length,runtimeReason:missing.length?`Thiếu SDXL Base 1.0 (${missing.length} thành phần)`:'',runtimeMissing:missing};}
function listModels(res){const registry=readModelRegistry(),discovered=discoverLocalModels(registry),config=readLocalConfig();const models=registry.models.map((entry)=>{const checked=verifyModelEntry(entry);return{...checked,...modelOperationalState(entry,checked),active:Boolean(activeModelPath(registry,config,entry.configKey)===checked.resolvedPath)};});send(res,200,JSON.stringify({ok:true,schemaVersion:registry.schemaVersion,updatedAt:registry.updatedAt,models,quarantine:registry.quarantine||[],autoDiscovered:discovered.map((item)=>item.id),config,restartRequired:Boolean(config.modelRestartRequired)}));}
// SD3 inpainting also supports the original 16-channel text-to-image transformer.
// The service explicitly instantiates StableDiffusion3InpaintPipeline from these components.
const modelOperationalStateStrict=modelOperationalState;
modelOperationalState=function(entry,checked){
  if(entry.id==='idm-vton'){
    const config=readLocalConfig(),vendor=path.resolve(process.env.IDMVTON_ROOT||config.idmVtonRoot||path.join(ROOT,'vendor','IDM-VTON'));
    const model=path.resolve(process.env.IDMVTON_MODEL||config.idmVtonModel||checked.resolvedPath||path.join(ROOT,'models','tryon','IDM-VTON'));
    const densepose=path.resolve(process.env.DENSEPOSE_SCRIPT||config.denseposeScript||path.join(ROOT,'models','pose','densepose','densepose_r50_fpn_dl_fixed.torchscript'));
    const missing=[];
    for(const relative of ['src/tryon_pipeline.py','src/unet_hacked_tryon.py','src/unet_hacked_garmnet.py'])if(!fs.existsSync(path.join(vendor,relative)))missing.push(relative);
    for(const folder of ['unet','unet_encoder','vae','text_encoder','text_encoder_2','image_encoder']){
      if(!fs.existsSync(path.join(model,folder,'config.json')))missing.push(`${folder}/config.json`);
      if(!['model.safetensors','model.bin','pytorch_model.bin','diffusion_pytorch_model.safetensors','diffusion_pytorch_model.bin'].some((name)=>fs.existsSync(path.join(model,folder,name))))missing.push(`${folder}/weights`);
    }
    for(const relative of ['scheduler/scheduler_config.json','tokenizer/vocab.json','tokenizer/merges.txt','tokenizer_2/vocab.json','tokenizer_2/merges.txt'])if(!fs.existsSync(path.join(model,relative)))missing.push(relative);
    if(!fs.existsSync(densepose)||fs.statSync(densepose).size<1000000)missing.push('DensePose TorchScript');
    return{operationalReady:checked.ready&&!missing.length,runtimeReason:missing.length?`Thiếu thành phần IDM-VTON: ${missing.join(', ')}`:'',runtimeMissing:missing};
  }
  if(entry.kind==='inpaint'&&['sd3','sd35'].includes(String(entry.architecture).toLowerCase())){
    try{
      const index=JSON.parse(fs.readFileSync(path.join(checked.resolvedPath,'model_index.json'),'utf8'));
      const transformer=JSON.parse(fs.readFileSync(path.join(checked.resolvedPath,'transformer/config.json'),'utf8'));
      if(index._class_name==='StableDiffusion3Pipeline'&&transformer._class_name==='SD3Transformer2DModel'&&transformer.in_channels===16){
        return modelOperationalStateStrict({...entry,architecture:'auto'},checked);
      }
    }catch{}
  }
  return modelOperationalStateStrict(entry,checked);
};
const MODEL_DISPLAY_METADATA={
  'sd35-inpaint':{version:'3.5 Large',precision:'BF16',pipeline:'StableDiffusion3InpaintPipeline',resolution:'1024×1024',recommendedVramGb:'18–24',formatLabel:'Diffusers',author:'Stability AI',commercialUse:'Theo Stability AI Community License',features:['LoRA SD3.5','Inpainting','CPU offload']},
  catvton:{version:'mix-48k-1024',precision:'FP16',pipeline:'CatVTONPipeline',resolution:'1024 px',recommendedVramGb:'8–12',formatLabel:'Diffusers + attention weights',dependencies:['catvton-base','catvton-vae'],features:['Virtual try-on']},
  'catvton-base':{version:'SD1.5 Inpainting',precision:'FP16',pipeline:'CatVTON dependency',resolution:'512×512',recommendedVramGb:'6–8',formatLabel:'Diffusers'},
  'catvton-vae':{precision:'FP32',pipeline:'AutoencoderKL',formatLabel:'Diffusers VAE'},
  'sam2-tiny':{version:'2.1 Tiny',precision:'FP32',pipeline:'SAM2ImagePredictor',recommendedVramGb:'2–4',formatLabel:'PyTorch checkpoint',features:['Point mask','Segmentation']},
  'yolo11-pose':{version:'YOLO11n',precision:'FP32',pipeline:'Ultralytics YOLO',recommendedVramGb:'2–4',formatLabel:'PyTorch checkpoint',features:['17 keypoints','Person detection']},
  adetailer:{precision:'FP32',pipeline:'Ultralytics YOLO',recommendedVramGb:'2–4',formatLabel:'PyTorch checkpoints',features:['Face detection','Detail mask']},
  'yolo-world':{precision:'FP32',pipeline:'YOLOWorld',recommendedVramGb:'4–8',formatLabel:'PyTorch checkpoint',features:['Open-vocabulary detection']},
  'ip-adapter-sdxl':{precision:'FP16',pipeline:'IP-Adapter SDXL',recommendedVramGb:'10–16',formatLabel:'Adapter weights',dependencies:['sdxl-base-1.0'],features:['Reference conditioning']},
  'controlnet-depth-sdxl-small':{precision:'FP16',pipeline:'ControlNet SDXL',recommendedVramGb:'10–16',formatLabel:'Diffusers',dependencies:['sdxl-base-1.0'],features:['Depth control']},
  'controlnet-union-sdxl-1.0':{dependencies:['sdxl-base-1.0']},
  'sdxl-base-1.0':{version:'1.0',precision:'FP16',pipeline:'StableDiffusionXLPipeline',resolution:'1024×1024',recommendedVramGb:'10–16',formatLabel:'Diffusers',author:'Stability AI',features:['Text-to-image','Model nền SDXL','LoRA SDXL','ControlNet SDXL']},
  'flux-chroma1-hd':{version:'Chroma1-HD',precision:'BF16',pipeline:'ChromaPipeline',resolution:'1024×1024',recommendedVramGb:'18–24',formatLabel:'Diffusers + single-file transformer',features:['Text-to-image','CPU offload','Có thể tối ưu 4-bit/8-bit'],integrationNote:'Chế độ 4-bit/8-bit là cách nạp Chroma hiện có, không phải một model riêng; cần kiểm chứng bitsandbytes trên Windows/CUDA trước khi kích hoạt.'},
};
function readModelDownloadStatus(id){const target=path.join(MODEL_DOWNLOADS,`${id}.json`);try{return JSON.parse(fs.readFileSync(target,'utf8'));}catch{return null;}}
function processIsAlive(pid){if(!Number.isInteger(Number(pid))||Number(pid)<=0)return false;try{process.kill(Number(pid),0);return true;}catch{return false;}}
function liveModelDownloadStatus(entry,download){if(!download)return download;const rawError=String(download.error||download.message||'');if(download.status==='failed'&&/(401|403|gated repo|access to model.+restricted|authorized list)/i.test(rawError))return{...download,errorCode:'access-required',error:'Cần quyền truy cập Hugging Face. Hãy mở trang nguồn, đăng nhập, yêu cầu/chấp nhận quyền truy cập và cấu hình HF_TOKEN trước khi thử lại.'};if(!['starting','running'].includes(download.status))return download;const updatedAt=Date.parse(download.updatedAt||download.createdAt||0),staleForMs=Number.isFinite(updatedAt)?Date.now()-updatedAt:Infinity,alive=processIsAlive(download.processId);if(!alive&&staleForMs>15000)return{...download,status:'failed',stage:'interrupted',errorCode:'download-interrupted',error:'Tiến trình tải đã dừng ngoài dự kiến. Có thể thử lại để tiếp tục từ dữ liệu đã tải.'};const partial=resolveModelPath(`${entry.targetPath}.partial`),bytesDownloaded=partial&&fs.existsSync(partial)?directorySize(partial):Number(download.bytesDownloaded||0),totalBytes=Number(download.totalBytes||0);return{...download,bytesDownloaded,totalBytes,percent:totalBytes?Number(Math.min(99.9,bytesDownloaded*100/totalBytes).toFixed(1)):download.percent};}
const liveModelDownloadStatusBase=liveModelDownloadStatus;
liveModelDownloadStatus=function(entry,download){const result=liveModelDownloadStatusBase(entry,download);if(result?.errorCode==='access-required'&&hasHuggingFaceToken())return{...result,errorCode:'access-verified',error:'Quyền Hugging Face đã được xác thực. Hãy thử tải lại để tiếp tục.'};return result;};
function readExternalModelSources(){try{return JSON.parse(fs.readFileSync(EXTERNAL_MODEL_SOURCES,'utf8'));}catch{return{schemaVersion:1,candidates:[]};}}
function saveExternalModelSources(data){fs.writeFileSync(EXTERNAL_MODEL_SOURCES,JSON.stringify(data,null,2),'utf8');}
const INTEGRATED_MODEL_NOTES={
  'flux-2-klein-4b':'Đã tích hợp FLUX.2 klein 4B: BF16, CPU offload, 4 bước, guidance 1; chạy offline sau khi tải và kiểm tra checksum.',
  'grounding-dino-base':'Đã tích hợp loader Transformers và dùng SAM 2.1 tinh chỉnh hộp phát hiện thành mask.',
  birefnet:'Đã tích hợp vào bước tách nền và chuẩn hóa ảnh trang phục trước CatVTON.',
  'controlnet-union-sdxl-1.0':'Đã tích hợp ControlNet Union ở chế độ depth cho luồng SDXL + IP-Adapter.',
  'florence-2-large':'Đã tích hợp open-vocabulary detection và dùng SAM 2.1 tinh chỉnh vùng thành mask.',
  'sdxl-inpaint-base-0.1':'Đã hỗ trợ trực tiếp bằng StableDiffusionXLInpaintPipeline; đây là pipeline hoàn chỉnh, không cần SDXL Base để chạy.',
};
const MODEL_LICENSE_POLICIES={
  'sd35-medium':{category:'community',label:'Giấy phép cộng đồng',notice:'Có thể dùng cục bộ sau khi đã tải; cần tuân thủ Stability AI Community License khi sử dụng thương mại.'},
  'waifu-inpaint-xl':{category:'gated',label:'Cần cấp quyền Hugging Face',notice:'Mở trang nguồn, đăng nhập và được chủ model cấp quyền; sau đó cấu hình HF_TOKEN rồi tải lại.'},
  'flux-1-fill-dev':{category:'gated-noncommercial',label:'Cấp quyền · Phi thương mại',notice:'Phải chấp nhận quyền truy cập Hugging Face và chỉ dùng phi thương mại nếu chưa có giấy phép FLUX phù hợp.'},
  'idm-vton':{category:'noncommercial',label:'Chỉ phi thương mại',notice:'CC-BY-NC-SA-4.0 chỉ cho phép mục đích phi thương mại và yêu cầu tuân thủ điều kiện ghi công/chia sẻ tương tự.'},
};
const LOCALLY_USABLE_RESTRICTED_MODELS=new Set(['sd35-medium']);
function hasHuggingFaceToken(){const tokenPath=process.env.HF_TOKEN?null:path.join(process.env.HF_HOME||path.join(process.env.USERPROFILE||'','.cache','huggingface'),'token');return Boolean(process.env.HF_TOKEN)||(Boolean(tokenPath)&&fs.existsSync(tokenPath)&&Boolean(fs.readFileSync(tokenPath,'utf8').trim()));}
function readDownloadCatalog(){const bundled=JSON.parse(fs.readFileSync(MODEL_CANDIDATES,'utf8')),external=readExternalModelSources(),hfAuthenticated=hasHuggingFaceToken(),candidates=[...bundled.candidates,...external.candidates].map((item)=>{let candidate=INTEGRATED_MODEL_NOTES[item.id]?{...item,compatibility:'ready',integrationNote:INTEGRATED_MODEL_NOTES[item.id]}:{...item};const policy=MODEL_LICENSE_POLICIES[item.id];if(policy)candidate={...candidate,licenseCategory:policy.category,licenseLabel:policy.label,licenseNotice:policy.notice};if(hfAuthenticated&&['gated','gated-noncommercial'].includes(candidate.licenseCategory))candidate={...candidate,huggingFaceAccessConfigured:true,licenseLabel:candidate.licenseCategory==='gated'?'Đã cấp quyền Hugging Face':'Đã cấp quyền · Phi thương mại',licenseNotice:candidate.licenseCategory==='gated'?'Token Hugging Face đã được xác thực; model có thể tải lại ngay.':candidate.licenseNotice.replace('Phải chấp nhận quyền truy cập Hugging Face','Quyền truy cập Hugging Face đã được cấp')};const target=resolveModelPath(candidate.targetPath);if(candidate.compatibility==='restricted'&&LOCALLY_USABLE_RESTRICTED_MODELS.has(candidate.id)&&target&&fs.existsSync(path.join(target,'model_index.json')))candidate={...candidate,compatibility:'ready',licenseAcceptedForLocalUse:true};return candidate;});return{...bundled,candidates,huggingFaceAuthenticated:hfAuthenticated};}
function safeModelSourceUrl(value){let url;try{url=new URL(String(value||''));}catch{throw new Error('URL không hợp lệ');}if(url.protocol!=='https:')throw new Error('Chỉ chấp nhận URL HTTPS');if(!['huggingface.co','www.huggingface.co','civitai.com','www.civitai.com'].includes(url.hostname.toLowerCase()))throw new Error('Hiện chỉ hỗ trợ Hugging Face và Civitai');return url;}
function inferArchitecture(values){const text=values.join(' ').toLowerCase();if(text.includes('sdxl')||text.includes('sd xl')||text.includes('stable-diffusion-xl')||text.includes('illustrious'))return'sdxl';if(text.includes('sd3.5')||text.includes('sd 3.5')||text.includes('stable-diffusion-3.5'))return'sd35';if(text.includes('sd2')||text.includes('sd 2')||text.includes('stable-diffusion-2'))return'sd2';if(text.includes('sd1.5')||text.includes('sd 1.5')||text.includes('stable-diffusion-v1')||text.includes('stable-diffusion-1'))return'sd15';return'auto';}
function slugModelId(value){return String(value||'model').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64)||'model';}
async function fetchJson(url,headers={}){const response=await fetch(url,{headers:{'User-Agent':'AI-Atelier/1.0',...headers},redirect:'follow'});if(!response.ok)throw new Error(`Nguồn trả về HTTP ${response.status}`);return response.json();}
async function analyzeModelSource(source){const url=safeModelSourceUrl(source),host=url.hostname.toLowerCase();if(host.includes('huggingface.co')){const parts=url.pathname.split('/').filter(Boolean);if(parts.length<2)throw new Error('URL Hugging Face phải trỏ tới repository');const repoId=`${parts[0]}/${parts[1]}`,revision=parts[2]==='tree'&&parts[3]?parts[3]:'main',headers=process.env.HF_TOKEN?{Authorization:`Bearer ${process.env.HF_TOKEN}`}:{},data=await fetchJson(`https://huggingface.co/api/models/${repoId}`,headers),tags=Array.isArray(data.tags)?data.tags:[],files=Array.isArray(data.siblings)?data.siblings:[],sizeBytes=files.reduce((sum,item)=>sum+Number(item.size||0),0),architecture=inferArchitecture([repoId,data.pipeline_tag||'',...tags]),isDiffusers=files.some((item)=>item.rfilename==='model_index.json'),pipeline=String(data.pipeline_tag||'').toLowerCase(),kind=pipeline.includes('image-to-image')||repoId.toLowerCase().includes('inpaint')?'inpaint':pipeline.includes('text-to-image')?'checkpoint':'custom';return{provider:'huggingface',source:url.href,repoId,revision,id:slugModelId(parts[1]),name:data.cardData?.model_name||parts[1],author:data.author||parts[0],license:data.cardData?.license||'Chưa khai báo',architecture,kind,formatLabel:isDiffusers?'Diffusers':'Repository model',precision:tags.includes('fp16')?'FP16':'Theo model',sizeBytes,estimatedDownloadGb:sizeBytes?sizeBytes/1073741824:null,files:files.length,conversion:isDiffusers?'Không cần':'Có thể cần chuyển đổi',targetPath:`models/imported/${slugModelId(parts[0]+'-'+parts[1])}`,requiredFiles:isDiffusers?['model_index.json']:[]};}const modelId=url.pathname.match(/\/models\/(\d+)/)?.[1],versionId=url.searchParams.get('modelVersionId');if(!modelId)throw new Error('URL Civitai phải trỏ tới trang model');let model,version;if(versionId){version=await fetchJson(`https://civitai.com/api/v1/model-versions/${versionId}`);model={name:version.model?.name||`Civitai ${modelId}`,creator:version.model?.creator};}else{model=await fetchJson(`https://civitai.com/api/v1/models/${modelId}`);version=model.modelVersions?.[0];}if(!version)throw new Error('Không tìm thấy phiên bản Civitai');const primary=(version.files||[]).find((item)=>item.primary)||(version.files||[])[0],name=`${model.name} ${version.name||''}`.trim(),architecture=inferArchitecture([version.baseModel||'',name]);return{provider:'civitai',source:`https://civitai.com/models/${modelId}?modelVersionId=${version.id}`,modelId,modelVersionId:String(version.id),revision:version.name||String(version.id),id:slugModelId(`${model.name}-${version.name||version.id}`),name,author:model.creator?.username||'Civitai creator',license:'Xem điều khoản trên Civitai',architecture,kind:'inpaint',formatLabel:primary?.name?.endsWith('.safetensors')?'Safetensors single-file':'Checkpoint',precision:primary?.metadata?.fp||'Theo tệp',sizeBytes:Number(primary?.sizeKB||0)*1024,estimatedDownloadGb:Number(primary?.sizeKB||0)/1048576,files:(version.files||[]).length,conversion:'Bắt buộc chuyển sang Diffusers nếu là single-file',targetPath:`models/imported/${slugModelId(name)}`,requiredFiles:[]};}
const analyzeModelSourceBase=analyzeModelSource;
analyzeModelSource=async function(source){const analysis=await analyzeModelSourceBase(source);if(analysis.kind==='checkpoint'&&analysis.requiredFiles?.includes('model_index.json'))analysis.kind='text-to-image';return analysis;};
async function analyzeModelUrl(req,res){try{const body=await parseJson(req,1024*1024),analysis=await analyzeModelSource(body.url);send(res,200,JSON.stringify({ok:true,analysis}));}catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}}
function reconcileExternalRegistrations(catalog){const registry=readModelRegistry();let changed=false;for(const entry of catalog.candidates.filter((item)=>item.autoRegister)){const download=readModelDownloadStatus(entry.id);if(download?.status!=='completed'||registry.models.some((item)=>item.id===entry.id))continue;const conversionPending=entry.conversionRequired===true;registry.models.push({id:entry.id,name:entry.name,kind:conversionPending?'checkpoint':entry.kind,architecture:entry.architecture,path:entry.targetPath,configKey:conversionPending?'':(entry.configKey||''),requiredFiles:conversionPending?[]:(entry.requiredFiles||[]),license:entry.license||'unknown',source:entry.source,status:conversionPending?'downloaded-conversion-pending':'downloaded',revision:entry.version||entry.revision||'',autoConvertRequested:Boolean(entry.autoConvertRequested)});changed=true;}if(changed)saveModelRegistry(registry,'url-download-register');}
function listModelCandidates(res){try{const catalog=readDownloadCatalog();reconcileExternalRegistrations(catalog);const registry=readModelRegistry(),registeredIds=new Set(registry.models.map((item)=>item.id));const installed=registry.models.map((entry)=>{const checked=verifyModelEntry(entry),metadata=MODEL_DISPLAY_METADATA[entry.id]||{};return{...metadata,...entry,...checked,...modelOperationalState(entry,checked),downloaded:checked.ready,status:checked.ready?(entry.status||'downloaded'):'missing-files',dependencies:Array.isArray(metadata.dependencies)?metadata.dependencies:(Array.isArray(entry.dependencies)?entry.dependencies:[])};});const candidates=catalog.candidates.map((entry)=>{const target=resolveModelPath(entry.targetPath),download=liveModelDownloadStatus(entry,readModelDownloadStatus(entry.id)),exists=Boolean(target&&fs.existsSync(target)),completed=exists&&(!download||download.status==='completed'),sizeBytes=exists?directorySize(target):0,status=['starting','running'].includes(download?.status)?'downloading':download?.status==='failed'?'download-failed':completed?'downloaded':'waiting-download';return{...entry,resolvedPath:target||'',exists,sizeBytes,downloaded:completed,status,download,registered:registeredIds.has(entry.id)};});const inventory=[...installed,...candidates.filter((item)=>!registeredIds.has(item.id)).map((item)=>({...item,...modelOperationalState(item,{ready:item.downloaded,resolvedPath:item.resolvedPath})}))];send(res,200,JSON.stringify({ok:true,...catalog,candidates,inventory,summary:{total:inventory.length,downloaded:inventory.filter((item)=>item.downloaded).length,waiting:inventory.filter((item)=>!item.downloaded).length,dependencies:inventory.filter((item)=>item.kind==='dependency').length},downloadBehavior:'background-download'}));}catch(error){send(res,500,JSON.stringify({ok:false,error:`Không thể đọc catalog model: ${error.message}`}));}}
async function readOllamaModels(){try{const response=await fetch(`${LLM_BASE_URL}/api/tags`,{signal:AbortSignal.timeout(1800)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const data=await response.json();return{available:true,models:Array.isArray(data.models)?data.models:[],error:''};}catch(error){return{available:false,models:[],error:error.message};}}
async function listModelCandidates(res){try{const catalog=readDownloadCatalog();reconcileExternalRegistrations(catalog);const ollama=await readOllamaModels(),registry=readModelRegistry(),registeredIds=new Set(registry.models.map((item)=>item.id));const installed=registry.models.map((entry)=>{const checked=verifyModelEntry(entry),metadata=MODEL_DISPLAY_METADATA[entry.id]||{};return{...metadata,...entry,...checked,...modelOperationalState(entry,checked),downloaded:checked.ready,status:checked.ready?(entry.status||'downloaded'):'missing-files',dependencies:Array.isArray(metadata.dependencies)?metadata.dependencies:(Array.isArray(entry.dependencies)?entry.dependencies:[])};});const candidates=catalog.candidates.map((entry)=>{if(String(entry.source||'').startsWith('ollama://')){const modelName=String(entry.version||entry.source.slice('ollama://'.length)),model=ollama.models.find((item)=>item.name===modelName||item.model===modelName),downloaded=Boolean(model);return{...entry,provider:'ollama',localEndpoint:LLM_BASE_URL,localModel:modelName,sourcePage:entry.sourcePage||`https://ollama.com/library/${modelName.split(':')[0]}`,resolvedPath:`${LLM_BASE_URL} · ${modelName}`,exists:downloaded,sizeBytes:Number(model?.size||0),downloaded,status:downloaded?'downloaded':ollama.available?'ollama-model-missing':'ollama-unavailable',runtimeReason:downloaded?'':ollama.available?`Chưa có model ${modelName} trong Ollama`:`Không kết nối được Ollama tại ${LLM_BASE_URL}`,registered:registeredIds.has(entry.id)};}const target=resolveModelPath(entry.targetPath),download=liveModelDownloadStatus(entry,readModelDownloadStatus(entry.id)),exists=Boolean(target&&fs.existsSync(target)),completed=exists&&(!download||download.status==='completed'),sizeBytes=exists?directorySize(target):0,status=['starting','running'].includes(download?.status)?'downloading':download?.status==='failed'?'download-failed':completed?'downloaded':'waiting-download';return{...entry,resolvedPath:target||'',exists,sizeBytes,downloaded:completed,status,download,registered:registeredIds.has(entry.id)};});const inventory=[...installed,...candidates.filter((item)=>!registeredIds.has(item.id)).map((item)=>({...item,...modelOperationalState(item,{ready:item.downloaded,resolvedPath:item.resolvedPath})}))];send(res,200,JSON.stringify({ok:true,...catalog,candidates,inventory,ollama:{available:ollama.available,endpoint:LLM_BASE_URL,models:ollama.models.map((item)=>item.name)},summary:{total:inventory.length,downloaded:inventory.filter((item)=>item.downloaded).length,waiting:inventory.filter((item)=>!item.downloaded).length,dependencies:inventory.filter((item)=>item.kind==='dependency').length},downloadBehavior:'background-download'}));}catch(error){send(res,500,JSON.stringify({ok:false,error:`Không thể đọc catalog model: ${error.message}`}));}}
function launchModelDownload(entry){const previous=liveModelDownloadStatus(entry,readModelDownloadStatus(entry.id));if(['starting','running'].includes(previous?.status))return{alreadyRunning:true,download:previous};const target=resolveModelPath(entry.targetPath);if(!target||!target.startsWith(path.resolve(ROOT,'models')+path.sep))throw new Error('Đường dẫn model không an toàn');if(fs.existsSync(target))throw new Error('Model đã tồn tại trên máy');if(!fs.existsSync(MODEL_DOWNLOAD_PYTHON))throw new Error('Thiếu môi trường Python tải model');fs.mkdirSync(MODEL_DOWNLOADS,{recursive:true});const statusPath=path.join(MODEL_DOWNLOADS,`${entry.id}.json`),createdAt=new Date().toISOString();fs.writeFileSync(statusPath,JSON.stringify({id:entry.id,status:'starting',stage:'preparing',percent:Number(previous?.percent||0),source:entry.source,target,createdAt},null,2),'utf8');const child=spawn(MODEL_DOWNLOAD_PYTHON,[MODEL_DOWNLOADER,'--id',entry.id,'--source',entry.source,'--target',target,'--status',statusPath],{cwd:ROOT,detached:true,windowsHide:true,stdio:'ignore',env:process.env});const state={id:entry.id,status:'starting',stage:'preparing',percent:Number(previous?.percent||0),source:entry.source,target,createdAt,updatedAt:createdAt,processId:child.pid};fs.writeFileSync(statusPath,JSON.stringify(state,null,2),'utf8');child.unref();return{id:entry.id,status:'starting',target,processId:child.pid,resumed:Boolean(previous)};}
async function startModelDownload(req,res){try{const body=await parseJson(req,1024*1024),id=String(body.id||'');if(!/^[a-z0-9][a-z0-9.-]{1,63}$/.test(id))throw new Error('ID model không hợp lệ');const entry=readDownloadCatalog().candidates.find((item)=>item.id===id);if(!entry)throw new Error('Model không có trong danh mục tải');send(res,202,JSON.stringify({ok:true,...launchModelDownload(entry)}));}catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}}
const modelDownloadQueue=[];
let activeQueuedModelId='',modelDownloadQueueTimer=null;
function canAutoDownloadModel(entry){const source=String(entry.source||''),level=entry.compatibility||(entry.kind==='dependency'?'dependency':'ready');return /^https:\/\//i.test(source)&&entry.provider!=='ollama'&&!['restricted','integration'].includes(level);}
function scheduleModelDownloadQueue(delay=1200){clearTimeout(modelDownloadQueueTimer);modelDownloadQueueTimer=setTimeout(processModelDownloadQueue,delay);modelDownloadQueueTimer.unref?.();}
function processModelDownloadQueue(){
  if(activeQueuedModelId){const entry=readDownloadCatalog().candidates.find((item)=>item.id===activeQueuedModelId),status=entry?liveModelDownloadStatus(entry,readModelDownloadStatus(activeQueuedModelId)):null;if(status&&['starting','running'].includes(status.status))return scheduleModelDownloadQueue();activeQueuedModelId='';}
  while(modelDownloadQueue.length){const entry=modelDownloadQueue.shift(),target=resolveModelPath(entry.targetPath),status=liveModelDownloadStatus(entry,readModelDownloadStatus(entry.id));if((target&&fs.existsSync(target))||['starting','running'].includes(status?.status))continue;try{launchModelDownload(entry);activeQueuedModelId=entry.id;return scheduleModelDownloadQueue();}catch(error){fs.mkdirSync(MODEL_DOWNLOADS,{recursive:true});fs.writeFileSync(path.join(MODEL_DOWNLOADS,`${entry.id}.json`),JSON.stringify({id:entry.id,status:'failed',error:error.message,updatedAt:new Date().toISOString()},null,2),'utf8');}}
}
async function startAllModelDownloads(req,res){try{const body=await parseJson(req,1024*1024);if(body.confirm!==true)throw new Error('Cần xác nhận tải tất cả model');const queuedIds=new Set([activeQueuedModelId,...modelDownloadQueue.map((item)=>item.id)].filter(Boolean)),queued=[],skipped=[];for(const entry of readDownloadCatalog().candidates){const target=resolveModelPath(entry.targetPath),status=liveModelDownloadStatus(entry,readModelDownloadStatus(entry.id));if(!canAutoDownloadModel(entry)||(target&&fs.existsSync(target))||['starting','running'].includes(status?.status)||queuedIds.has(entry.id)){skipped.push(entry.id);continue;}modelDownloadQueue.push(entry);queuedIds.add(entry.id);queued.push(entry.id);}processModelDownloadQueue();send(res,202,JSON.stringify({ok:true,queued:queued.length,skipped:skipped.length,queuedIds:queued,active:activeQueuedModelId,remaining:modelDownloadQueue.length}));}catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}}
async function registerModelUrl(req,res){try{const body=await parseJson(req,1024*1024);if(body.licenseAccepted!==true)throw new Error('Cần xác nhận đã đọc giấy phép');const analysis=await analyzeModelSource(body.url),id=slugModelId(body.id||analysis.id);if(!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id))throw new Error('ID model không hợp lệ');const registry=readModelRegistry(),external=readExternalModelSources();if(registry.models.some((item)=>item.id===id)||external.candidates.some((item)=>item.id===id))throw new Error('ID model đã tồn tại');const architecture=String(body.architecture||analysis.architecture||'auto').toLowerCase(),kind=String(body.kind||analysis.kind||'custom'),targetPath=String(body.targetPath||analysis.targetPath).replace(/\\/g,'/');if(!['auto','sd3','sd35','sdxl','sd15','sd2'].includes(architecture))throw new Error('Kiến trúc không hợp lệ');const target=resolveModelPath(targetPath);if(!target||!target.startsWith(path.resolve(ROOT,'models')+path.sep))throw new Error('Thư mục đích phải nằm trong models');const conversionRequired=String(analysis.conversion||'').toLowerCase().includes('bắt buộc');const entry={...analysis,id,name:String(body.name||analysis.name),kind,architecture,targetPath,configKey:kind==='inpaint'?'inpaintModel':'',license:String(body.license||analysis.license||'unknown'),autoRegister:true,autoConvertRequested:body.autoConvert===true,conversionRequired,createdAt:new Date().toISOString()};external.candidates.push(entry);saveExternalModelSources(external);const download=launchModelDownload(entry);send(res,202,JSON.stringify({ok:true,entry,download}));}catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}}

const MODEL_FEATURES=[
  {id:'inpainting',name:'Xóa vật thể / Inpainting',description:'Tái tạo vùng được mask',kinds:['inpaint'],defaultModel:'sd35-inpaint'},
  {id:'virtual-tryon',name:'Thay trang phục',description:'Mặc trang phục tham chiếu lên nhân vật',kinds:['tryon'],defaultModel:'catvton'},
  {id:'segmentation',name:'Chọn vùng bằng AI',description:'Tạo mask từ điểm chọn',kinds:['segmentation'],defaultModel:'sam2-tiny'},
  {id:'pose',name:'Phát hiện người và pose',description:'Xác định người, khớp và vùng cơ thể',kinds:['pose'],defaultModel:'yolo11-pose'},
  {id:'face-detail',name:'Phát hiện / tinh chỉnh khuôn mặt',description:'Tạo mask và tinh chỉnh chi tiết khuôn mặt',kinds:['detection'],includeIds:['adetailer'],defaultModel:'adetailer'},
  {id:'object-detection',name:'Phát hiện đối tượng theo mô tả',description:'Tạo mask theo tên phụ kiện hoặc đối tượng',kinds:['detection'],includeIds:['yolo-world'],defaultModel:'yolo-world'},
  {id:'text-to-image',name:'Tạo ảnh từ mô tả',description:'Sinh ảnh mới từ prompt',kinds:['text-to-image'],defaultModel:'flux-chroma1-hd'},
  {id:'reference-conditioning',name:'Giữ phong cách từ ảnh tham chiếu',description:'Điều kiện hóa bằng ảnh IP-Adapter',kinds:['adapter'],defaultModel:'ip-adapter-sdxl'},
  {id:'depth-control',name:'Giữ chiều sâu / bố cục',description:'Điều khiển sinh ảnh bằng depth map',kinds:['controlnet'],defaultModel:'controlnet-depth-sd35-large'},
];
function compatibleWithFeature(model,feature){if(!feature.kinds.includes(model.kind))return false;if(feature.includeIds&&!feature.includeIds.includes(model.id))return false;return true;}
function modelCapabilities(res){
  const registry=readModelRegistry();
  discoverLocalModels(registry);
  const config=readLocalConfig(),selected=config.featureModels||{},registeredIds=new Set(registry.models.map((entry)=>entry.id));
  const checkedModels=registry.models.map((entry)=>{const checked=verifyModelEntry(entry);return{...checked,...modelOperationalState(entry,checked),registered:true};});
  const catalogModels=readDownloadCatalog().candidates.filter((entry)=>!registeredIds.has(entry.id)).map((entry)=>{
    const checked=verifyModelEntry({...entry,path:entry.targetPath,configKey:entry.configKey||''});
    const operational=modelOperationalState({...entry,path:entry.targetPath,configKey:entry.configKey||''},checked);
    return {...checked,...operational,registered:false,runtimeReason:checked.ready?(operational.runtimeReason||'Chưa đăng ký model vào hệ thống'):'Chưa tải về hoặc thiếu tệp model'};
  });
  const features=MODEL_FEATURES.map((feature)=>{
    const compatible=[...checkedModels,...catalogModels].filter((model)=>model.ready&&model.operationalReady!==false&&compatibleWithFeature(model,feature));
    const selectedId=selected[feature.id]||feature.defaultModel;
    return {...feature,selectedModel:selectedId,models:compatible.map((model)=>({id:model.id,name:model.name,kind:model.kind,architecture:model.architecture||'auto',contentStyle:model.contentStyle||'general',removalProfile:readCatalog().runtimePresets.modelInpaintProfiles[model.id]||null,ready:model.ready,registered:model.registered,operationalReady:model.operationalReady,runtimeReason:model.runtimeReason||'',selected:model.id===selectedId}))};
  });
  send(res,200,JSON.stringify({ok:true,restartRequired:Boolean(config.modelRestartRequired),features}));
}
async function selectFeatureModel(req,res){try{const body=await parseJson(req,1024*1024),feature=MODEL_FEATURES.find((item)=>item.id===String(body.featureId||''));if(!feature)throw new Error('Chức năng không hợp lệ');const registry=readModelRegistry();discoverLocalModels(registry);const model=registry.models.find((item)=>item.id===String(body.modelId||''));if(!model)throw new Error('Model chưa đăng ký');if(!compatibleWithFeature(model,feature))throw new Error(`${model.name} không tương thích với ${feature.name}`);const checked=verifyModelEntry(model),operational=modelOperationalState(model,checked);if(!checked.ready)throw new Error(checked.reasons.join('; '));if(!operational.operationalReady)throw new Error(operational.runtimeReason||'Model chưa sẵn sàng cho chức năng này');const config=readLocalConfig();config.featureModels={...(config.featureModels||{}),[feature.id]:model.id};if(model.configKey)config[model.configKey]=checked.resolvedPath;if(model.architecture)config.inpaintArchitecture=model.architecture;config.modelRestartRequired=true;config.modelChangedAt=new Date().toISOString();fs.mkdirSync(path.dirname(CONFIG_FILE),{recursive:true});fs.writeFileSync(CONFIG_FILE,JSON.stringify(config,null,2),'utf8');send(res,200,JSON.stringify({ok:true,featureId:feature.id,modelId:model.id,restartRequired:true,operationalReady:operational.operationalReady}));}catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}}

async function registerModel(req,res){try{const body=await parseJson(req,1024*1024);const id=String(body.id||'').trim();if(!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id))throw new Error('ID model không hợp lệ');const target=resolveModelPath(body.path);if(!target||!fs.existsSync(target))throw new Error('Đường dẫn model không tồn tại');const registry=readModelRegistry();if(registry.models.some((item)=>item.id===id))throw new Error('ID model đã tồn tại');const architecture=String(body.architecture||'auto').toLowerCase();if(!['auto','sd3','sd35','sdxl','sd15','sd2'].includes(architecture))throw new Error('Kiến trúc model không được hỗ trợ');const entry={id,name:String(body.name||id),kind:String(body.kind||'custom'),architecture,path:path.relative(ROOT,target).startsWith('..')?target:path.relative(ROOT,target).replace(/\\/g,'/'),configKey:String(body.configKey||''),requiredFiles:Array.isArray(body.requiredFiles)?body.requiredFiles.map(String):[],license:String(body.license||'unknown'),source:String(body.source||'local')};const checked=verifyModelEntry(entry);if(!checked.ready)throw new Error(checked.reasons.join('; '));registry.models.push(entry);saveModelRegistry(registry,'register');send(res,200,JSON.stringify({ok:true,model:checked}));}catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}}

async function activateModel(req,res){try{const body=await parseJson(req,1024*1024);const registry=readModelRegistry();const entry=registry.models.find((item)=>item.id===body.id);if(!entry)throw new Error('Model chưa đăng ký');if(!entry.configKey)throw new Error('Model này không có khóa cấu hình kích hoạt');const checked=verifyModelEntry(entry);if(!checked.ready)throw new Error(checked.reasons.join('; '));const operational=modelOperationalState(entry,checked);if(!operational.operationalReady)throw new Error(operational.runtimeReason||'Model chưa sẵn sàng');const config=readLocalConfig();const appliedPath=config.modelAppliedPaths?.[entry.configKey]?path.resolve(config.modelAppliedPaths[entry.configKey]):'';const alreadyApplied=appliedPath===checked.resolvedPath;config[entry.configKey]=checked.resolvedPath;if(entry.kind==='inpaint')config.inpaintArchitecture=entry.architecture||'auto';config.modelRestartRequired=!alreadyApplied;config.modelChangedAt=new Date().toISOString();if(alreadyApplied)config.modelAppliedAt=config.modelAppliedAt||new Date().toISOString();fs.mkdirSync(path.dirname(CONFIG_FILE),{recursive:true});fs.writeFileSync(CONFIG_FILE,JSON.stringify(config,null,2),'utf8');send(res,200,JSON.stringify({ok:true,id:entry.id,configKey:entry.configKey,path:checked.resolvedPath,architecture:entry.architecture||'auto',active:true,alreadyApplied,restartRequired:!alreadyApplied}));}catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}}

function exportModelManifest(res){const registry=readModelRegistry();const manifest={schemaVersion:1,createdAt:new Date().toISOString(),models:registry.models.map((entry)=>{const checked=verifyModelEntry(entry);return{id:entry.id,name:entry.name,kind:entry.kind,path:entry.path,ready:checked.ready,sizeBytes:checked.sizeBytes,license:entry.license,source:entry.source,reasons:checked.reasons};})};const target=path.join(ROOT,'workspace','review','model-manifest.json');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(manifest,null,2),'utf8');send(res,200,JSON.stringify({ok:true,manifest:path.relative(ROOT,target),...manifest}));}

async function quarantineModel(req,res){try{const body=await parseJson(req,1024*1024);if(body.confirm!==true)throw new Error('Cần xác nhận đưa model vào cách ly');const registry=readModelRegistry();const index=registry.models.findIndex((item)=>item.id===body.id);if(index<0)throw new Error('Model chưa đăng ký');const entry=registry.models[index],checked=verifyModelEntry(entry),modelsRoot=path.resolve(ROOT,'models'),quarantineRoot=path.resolve(modelsRoot,'quarantine');if(!checked.resolvedPath.startsWith(modelsRoot+path.sep)||checked.resolvedPath.startsWith(quarantineRoot+path.sep))throw new Error('Chỉ cách ly model nằm trong thư mục models');const config=readLocalConfig();if(activeModelPath(registry,config,entry.configKey)===checked.resolvedPath)throw new Error('Không thể cách ly model đang được cấu hình hoạt động');fs.mkdirSync(quarantineRoot,{recursive:true});const destination=path.join(quarantineRoot,`${entry.id}-${new Date().toISOString().replace(/[:.]/g,'-')}`);fs.renameSync(checked.resolvedPath,destination);registry.models.splice(index,1);registry.quarantine=registry.quarantine||[];registry.quarantine.push({...entry,originalPath:entry.path,path:path.relative(ROOT,destination).replace(/\\/g,'/'),quarantinedAt:new Date().toISOString()});saveModelRegistry(registry,'quarantine');send(res,200,JSON.stringify({ok:true,id:entry.id,quarantinePath:path.relative(ROOT,destination),recoverable:true}));}catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}}

async function restoreQuarantinedModel(req,res){try{const body=await parseJson(req,1024*1024);const registry=readModelRegistry();const index=(registry.quarantine||[]).findIndex((item)=>item.id===body.id);if(index<0)throw new Error('Không tìm thấy model trong vùng cách ly');const entry=registry.quarantine[index],source=resolveModelPath(entry.path),destination=resolveModelPath(entry.originalPath);if(!source||!destination||!fs.existsSync(source))throw new Error('Dữ liệu cách ly không tồn tại');if(fs.existsSync(destination))throw new Error('Vị trí khôi phục đã tồn tại');fs.mkdirSync(path.dirname(destination),{recursive:true});fs.renameSync(source,destination);registry.quarantine.splice(index,1);const restored={...entry,path:entry.originalPath};delete restored.originalPath;delete restored.quarantinedAt;registry.models.push(restored);saveModelRegistry(registry,'restore');send(res,200,JSON.stringify({ok:true,id:entry.id,path:restored.path}));}catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}}

async function deleteModel(req,res){try{const body=await parseJson(req,1024*1024),id=String(body.id||''),location=body.location==='quarantine'?'quarantine':'registered';if(body.confirm!==id||!id)throw new Error('Cần nhập đúng ID model để xác nhận xóa vĩnh viễn');const registry=readModelRegistry(),collection=location==='quarantine'?(registry.quarantine||[]):registry.models,index=collection.findIndex((item)=>item.id===id);if(index<0)throw new Error(location==='quarantine'?'Không tìm thấy model trong vùng cách ly':'Model chưa đăng ký');const entry=collection[index],checked=verifyModelEntry(entry),target=checked.resolvedPath&&path.resolve(checked.resolvedPath),modelsRoot=path.resolve(ROOT,'models'),quarantineRoot=path.join(modelsRoot,'quarantine');if(!target||target===modelsRoot||!target.startsWith(modelsRoot+path.sep))throw new Error('Chỉ có thể xóa model nằm trong thư mục models');if(location==='quarantine'&&!target.startsWith(quarantineRoot+path.sep))throw new Error('Đường dẫn cách ly không hợp lệ');if(location==='registered'){const config=readLocalConfig(),selectedByFeature=Object.values(config.featureModels||{}).includes(id);if(activeModelPath(registry,config,entry.configKey)===target||selectedByFeature)throw new Error('Không thể xóa model đang được cấu hình hoạt động');const shared=registry.models.some((item,otherIndex)=>otherIndex!==index&&resolveModelPath(item.path)===target);if(shared)throw new Error('Không thể xóa dữ liệu đang được model khác sử dụng');}const sizeBytes=fs.existsSync(target)?directorySize(target):0;if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:false});collection.splice(index,1);if(location==='quarantine')registry.quarantine=collection;saveModelRegistry(registry,'delete');send(res,200,JSON.stringify({ok:true,id,location,deletedPath:path.relative(ROOT,target).replace(/\\/g,'/'),sizeBytes}));}catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}}

function readReviewState() {
  if (!fs.existsSync(REVIEW_STATE)) return { schemaVersion: 2, updatedAt: null, items: {}, legacyItems: {} };
  const state=JSON.parse(fs.readFileSync(REVIEW_STATE, 'utf8'));
  if(Number(state.schemaVersion||1)>=2)return state;
  fs.mkdirSync(REVIEW_DIR,{recursive:true});const backup=path.join(REVIEW_DIR,`review-state-v1-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);fs.copyFileSync(REVIEW_STATE,backup);
  const migrated={schemaVersion:2,migratedAt:new Date().toISOString(),migrationBackup:path.relative(ROOT,backup),updatedAt:new Date().toISOString(),items:{},legacyItems:state.items||{}};
  fs.writeFileSync(REVIEW_STATE,JSON.stringify(migrated,null,2),'utf8');return migrated;
}

function reviewKey(category,sampleId){return `${category}:${sampleId}`;}

function writeReviewState(state) {
  fs.mkdirSync(REVIEW_DIR, { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(REVIEW_STATE, JSON.stringify(state, null, 2), 'utf8');
}

async function updateReview(req, res) {
  try {
    const body = await parseJson(req, 2 * 1024 * 1024);
    const updates = Array.isArray(body.items) ? body.items : [body];
    const state = readReviewState();
    const validStatuses = new Set(['pending', 'approved', 'retry', 'rejected']);
    for (const update of updates) {
      const sampleId = String(update.sampleId || '').replace(/\\/g, '/');
      const category=String(update.category||'');if(!['upper_body','lower_body','overall'].includes(category))throw new Error('Thiếu hoặc sai loại trang phục cho quyết định duyệt');
      const sample = resolveSamplePath(sampleId);
      if (!sample || !fs.existsSync(sample)) throw new Error(`Ảnh mẫu không tồn tại: ${sampleId}`);
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
    send(res, 200, JSON.stringify({ ok: true, state }));
  } catch (error) { send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

async function exportApprovedManifest(req, res) {
  try {
    await parseJson(req, 1024 * 1024);
    const state = readReviewState();
    const approved = Object.values(state.items).filter((item) => item.status === 'approved').map((item) => {
      const selected = String(item.selected || '').replace(/\\/g, '/');
      const file = selected ? safeJoin(ROOT, selected) : null;
      return { ...item, selectedExists: Boolean(file && file.startsWith(OUTPUTS_DIR + path.sep) && fs.existsSync(file)) };
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(REVIEW_DIR, { recursive: true });
    const target = path.join(REVIEW_DIR, `approved-manifest-${stamp}.json`);
    const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), approvedCount: approved.length, items: approved };
    fs.writeFileSync(target, JSON.stringify(manifest, null, 2), 'utf8');
    send(res, 200, JSON.stringify({ ok: true, manifest: path.relative(ROOT, target), approvedCount: approved.length }));
  } catch (error) { send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

async function calibrateQuality(req, res) {
  try {
    await parseJson(req, 1024 * 1024);
    const state = readReviewState();
    const samples = [];
    for (const item of Object.values(state.items)) {
      if (!['approved', 'retry', 'rejected'].includes(item.status) || !item.selected) continue;
      const selected = safeJoin(ROOT, String(item.selected).replace(/\\/g, '/'));
      if (!selected || !selected.startsWith(OUTPUTS_DIR + path.sep)) continue;
      const metadataPath = path.join(path.dirname(selected), 'metadata.json');
      if (!fs.existsSync(metadataPath)) continue;
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
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
    fs.mkdirSync(REVIEW_DIR, { recursive: true });
    const target = path.join(REVIEW_DIR, 'quality-calibration.json');
    fs.writeFileSync(target, JSON.stringify(report, null, 2), 'utf8');
    send(res, 200, JSON.stringify({ ok: true, report: path.relative(ROOT, target), ...report }));
  } catch (error) { send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

async function calibrateWeights(req, res) {
  try {
    await parseJson(req, 1024 * 1024);
    const state = readReviewState();
    const reviewed = Object.values(state.items).filter((item) => ['approved','retry','rejected'].includes(item.status));
    const counts = { seam: 0, color: 0, texture: 0, anatomy: 0, collar: 0, sleeves: 0, waist: 0 };
    for (const item of reviewed) for (const label of item.defectLabels || []) if (label in counts) counts[label] += 1;
    const raw = { visualQuality: 0.35, referenceSimilarity: 0.25, seamScore: 0.15 + counts.seam * 0.02, anatomyScore: 0.15 + counts.anatomy * 0.02, textureContinuity: 0.10 + counts.texture * 0.02 };
    const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
    const weights = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Number((value / total).toFixed(4))]));
    const report = { schemaVersion: 1, createdAt: new Date().toISOString(), reviewedCount: reviewed.length, labelCounts: counts, weights, regionPriorities: ['collar','sleeves','waist'].sort((a,b)=>counts[b]-counts[a]) };
    fs.mkdirSync(REVIEW_DIR, { recursive: true });
    const target = path.join(REVIEW_DIR, 'score-weights.json');
    fs.writeFileSync(target, JSON.stringify(report, null, 2), 'utf8');
    send(res, 200, JSON.stringify({ ok: true, report: path.relative(ROOT, target), ...report }));
  } catch (error) { send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

function allBenchmarkReports() {
  if (!fs.existsSync(OUTPUTS_DIR)) return null;
  const reports = [];
  for (const entry of fs.readdirSync(OUTPUTS_DIR, { withFileTypes: true })) {
    const target = path.join(OUTPUTS_DIR, entry.name, 'batch-report.json');
    if (!entry.isDirectory() || !fs.existsSync(target)) continue;
    try { const report = JSON.parse(fs.readFileSync(target, 'utf8')); if (report.benchmark) reports.push({ target, report }); } catch {}
  }
  return reports.sort((a,b)=>String(b.report.createdAt).localeCompare(String(a.report.createdAt)));
}

const QUALITY_FILE_PATTERN = /^(quality-|regression-|golden-baseline|release-acceptance|score-weights|active-score-weights|weight-ab-report|automatic-mask-smoke|catvton-|effective-step-|hybrid-|lora-(?:ab|matrix|strength)|structural-refine-|texture-recovery-|chroma-(?:smoke|generate)|sd35-smoke-test)/i;

function directoryChildren(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).map((name) => path.join(directory, name));
}

function qualityDataTargets() {
  const reviewReports = fs.existsSync(REVIEW_DIR)
    ? fs.readdirSync(REVIEW_DIR).filter((name) => QUALITY_FILE_PATTERN.test(name)).map((name) => path.join(REVIEW_DIR, name))
    : [];
  const benchmarkRuns = (allBenchmarkReports() || []).map((entry) => path.dirname(entry.target));
  return [...new Set([...reviewReports, ...benchmarkRuns])];
}

function reviewDataTargets() {
  if (!fs.existsSync(REVIEW_DIR)) return [];
  return fs.readdirSync(REVIEW_DIR)
    .filter((name) => name === 'review-state.json' || name === 'retry-comparisons.json' || /^review-state-.*\.json$/i.test(name) || /^approved-manifest-.*\.json$/i.test(name))
    .map((name) => path.join(REVIEW_DIR, name));
}

function resetTargets(scope) {
  const groups = {
    uploads: directoryChildren(UPLOADS_DIR),
    masks: directoryChildren(MASKS_DIR),
    review: reviewDataTargets(),
    jobs: directoryChildren(JOBS_DIR),
    quality: qualityDataTargets(),
    outputs: directoryChildren(OUTPUTS_DIR),
    manual: directoryChildren(path.join(ROOT,'workspace','manual')),
  };
  if (scope === 'all') return [...new Set(Object.values(groups).flat())];
  if (!Object.prototype.hasOwnProperty.call(groups, scope)) throw new Error('Phạm vi đặt lại không hợp lệ');
  return groups[scope];
}

function targetStats(target) {
  if (!fs.existsSync(target)) return { files: 0, bytes: 0 };
  const stat = fs.statSync(target);
  if (stat.isFile()) return { files: 1, bytes: stat.size };
  return fs.readdirSync(target).reduce((total, name) => {
    const value = targetStats(path.join(target, name));
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
  const archives = fs.existsSync(RESET_ARCHIVE_DIR) ? fs.readdirSync(RESET_ARCHIVE_DIR, { withFileTypes:true }).filter((entry)=>entry.isDirectory()).length : 0;
  return { scopes, archives };
}

async function resetWorkspaceData(req, res) {
  try {
    const body = await parseJson(req, 64 * 1024);
    const scope = String(body.scope || '');
    if (body.confirm !== true) throw new Error('Cần xác nhận trước khi đặt lại dữ liệu');
    if (['jobs','all'].includes(scope) && listJobs().some((job)=>['running','cancelling'].includes(job.status))) {
      throw new Error('Không thể đặt lại khi vẫn còn tác vụ đang chạy');
    }
    const targets = resetTargets(scope);
    if (!targets.length) return send(res, 200, JSON.stringify({ ok:true, scope, movedItems:0, movedFiles:0, bytes:0, message:'Danh sách đã trống' }));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archive = path.join(RESET_ARCHIVE_DIR, `${stamp}-${scope}`);
    fs.mkdirSync(archive, { recursive:true });
    let movedFiles=0,bytes=0;
    for (const target of targets) {
      if (!fs.existsSync(target)) continue;
      const relative = path.relative(path.join(ROOT, 'workspace'), target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Dữ liệu nằm ngoài vùng làm việc');
      const destination = path.join(archive, relative);
      fs.mkdirSync(path.dirname(destination), { recursive:true });
      const stats=targetStats(target); movedFiles+=stats.files; bytes+=stats.bytes;
      fs.renameSync(target, destination);
    }
    const manifest={schemaVersion:1,createdAt:new Date().toISOString(),scope,movedItems:targets.length,movedFiles,bytes,restoreNote:'Di chuyển dữ liệu về đúng đường dẫn tương đối trong manifest để phục hồi.'};
    fs.writeFileSync(path.join(archive,'reset-manifest.json'),JSON.stringify(manifest,null,2),'utf8');
    send(res,200,JSON.stringify({ok:true,scope,archive:path.relative(ROOT,archive),...manifest}));
  } catch (error) { send(res, 400, JSON.stringify({ ok:false, error:error.message })); }
}

function latestBenchmarkReportsByCategory(){const latest={};for(const entry of allBenchmarkReports()||[])if(!latest[entry.report.category])latest[entry.report.category]=entry;return latest;}
function latestBenchmarkReport(category=''){const reports=allBenchmarkReports()||[];return reports.find((entry)=>!category||entry.report.category===category)||null;}

function benchmarkReview(res,category) {
  const latest = latestBenchmarkReport(category);
  if (!latest) return send(res, 404, JSON.stringify({ ok: false, error: 'Chưa có benchmark' }));
  const state = readReviewState();
  const items = latest.report.items.map((item) => {
    const key=reviewKey(latest.report.category,item.sampleId);const review = state.items[key] || { category:latest.report.category,status: 'pending', defectLabels: [] };
    const suggestedRegion = review.defectLabels?.find((label)=>['collar','sleeves','waist'].includes(label)) || (latest.report.category === 'lower_body' ? 'waist' : Number(item.seamScore) < 80 ? 'collar' : Number(item.textureContinuity) < 82 ? 'sleeves' : 'auto');
    return { ...item, category:latest.report.category,sourceUrl: `/samples/${item.sampleId}`, resultUrl: '/' + String(item.selected).replace(/\\/g, '/').replace(/^workspace\//, ''), review, suggestedRegion };
  });
  const counts = items.reduce((result,item)=>{const status=item.review.status||'pending';result[status]=(result[status]||0)+1;return result;},{pending:0,approved:0,retry:0,rejected:0});
  send(res, 200, JSON.stringify({ ok: true, report: path.relative(ROOT, latest.target), total: items.length, counts, items }));
}

function reviewReadiness(res) {
  const state=readReviewState();const items=Object.values(state.items);const reviewed=items.filter((item)=>['approved','retry','rejected'].includes(item.status));const labeled=reviewed.filter((item)=>(item.defectLabels||[]).length>0);
  const latest=latestBenchmarkReportsByCategory();const categories=['upper_body','lower_body','overall'];const expected=categories.flatMap((category)=>(latest[category]?.report?.items||[]).map((item)=>({category,sampleId:item.sampleId})));
  const pending=expected.filter(({category,sampleId})=>!['approved','retry','rejected'].includes(state.items[reviewKey(category,sampleId)]?.status));const perCategory=Object.fromEntries(categories.map((category)=>{const categoryItems=expected.filter((item)=>item.category===category);const categoryReviews=categoryItems.map((item)=>state.items[reviewKey(category,item.sampleId)]).filter(Boolean);return[category,{total:categoryItems.length,reviewed:categoryReviews.filter((item)=>['approved','retry','rejected'].includes(item.status)).length,approved:categoryReviews.filter((item)=>item.status==='approved').length,pending:categoryItems.length-categoryReviews.filter((item)=>['approved','retry','rejected'].includes(item.status)).length}];}));
  const profilePath=path.join(REVIEW_DIR,'reference-profiles.json');const profiles=fs.existsSync(profilePath)?JSON.parse(fs.readFileSync(profilePath,'utf8')).profiles||{}:{};
  const references=Object.fromEntries(['upper_body','lower_body','overall'].map((category)=>[category,profiles[category]?.specializedReferenceRequired===false]));
  const activeWeights=fs.existsSync(path.join(REVIEW_DIR,'active-score-weights.json'));const blockers=[];
  if(pending.length)blockers.push(`Còn ${pending.length} ảnh chưa duyệt`);if(reviewed.length<5)blockers.push('Cần ít nhất 5 ảnh đã duyệt để đánh giá trọng số');if(labeled.length<3)blockers.push('Cần ít nhất 3 ảnh có nhãn lỗi để kích hoạt trọng số');
  for(const [category,ready] of Object.entries(references))if(!ready)blockers.push(`Thiếu ảnh tham chiếu chuyên biệt: ${category}`);if(!activeWeights)blockers.push('Trọng số hiệu chỉnh chưa được kích hoạt');
  send(res,200,JSON.stringify({ok:true,schemaVersion:state.schemaVersion,total:expected.length,reviewed:reviewed.length,pending:pending.length,approved:reviewed.filter((item)=>item.status==='approved').length,retry:reviewed.filter((item)=>item.status==='retry').length,rejected:reviewed.filter((item)=>item.status==='rejected').length,labeled:labeled.length,next:pending[0]||null,perCategory,references,activeWeights,legacyCount:Object.keys(state.legacyItems||{}).length,ready:blockers.length===0,blockers}));
}

async function buildRetryPlan(req,res) {
  try {
    const body=await parseJson(req,1024*1024);const category=String(body.category||'upper_body');if(!['upper_body','lower_body','overall'].includes(category))throw new Error('Loại trang phục không hợp lệ');
    const state=readReviewState();const items=Object.values(state.items).filter((item)=>item.category===category&&item.status==='retry').map((item)=>{
      const labels=item.defectLabels||[];const region=labels.find((label)=>['collar','sleeves','waist'].includes(label))||'auto';
      const strategy=labels.includes('anatomy')?'pose-and-structure':labels.includes('texture')||labels.includes('color')?'texture-fidelity':labels.includes('seam')||region!=='auto'?'targeted-seam':'balanced';
      const settings={count:2,steps:strategy==='texture-fidelity'?40:35,guidance:strategy==='texture-fidelity'?3:2.5,maxRetries:2,usePose:strategy==='pose-and-structure',repairSeams:true,generativeRefine:strategy==='targeted-seam',refineRegion:region,minimumSimilarity:strategy==='texture-fidelity'?.65:.55,minimumAnatomy:strategy==='pose-and-structure'?95:90};
      return{sampleId:item.sampleId,oldSelected:item.selected||'',defectLabels:labels,strategy,category,settings};
    });
    send(res,200,JSON.stringify({ok:true,count:items.length,items}));
  } catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}
}

function readRetryComparisons(){return fs.existsSync(RETRY_COMPARISONS)?JSON.parse(fs.readFileSync(RETRY_COMPARISONS,'utf8')):{schemaVersion:1,updatedAt:null,items:[]};}

async function saveRetryComparison(req,res){
  try{
    const body=await parseJson(req,2*1024*1024);const sampleId=String(body.sampleId||'').replace(/\\/g,'/');const sample=resolveSamplePath(sampleId);if(!sample||!fs.existsSync(sample))throw new Error('Ảnh mẫu không tồn tại');
    const newSelected=String(body.newSelected||'').replace(/\\/g,'/');const newFile=safeJoin(ROOT,newSelected);if(!newFile||!fs.existsSync(newFile))throw new Error('Kết quả chạy lại không tồn tại');
    const data=readRetryComparisons();const entry={sampleId,oldSelected:String(body.oldSelected||''),newSelected,strategy:String(body.strategy||'balanced'),defectLabels:Array.isArray(body.defectLabels)?body.defectLabels:[],metrics:body.metrics||null,createdAt:new Date().toISOString(),promoted:false};
    data.items=data.items.filter((item)=>item.sampleId!==sampleId);data.items.push(entry);data.updatedAt=new Date().toISOString();fs.mkdirSync(REVIEW_DIR,{recursive:true});fs.writeFileSync(RETRY_COMPARISONS,JSON.stringify(data,null,2),'utf8');send(res,200,JSON.stringify({ok:true,entry}));
  }catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}
}

function listRetryComparisons(res){const data=readRetryComparisons();const items=data.items.map((item)=>({...item,oldUrl:item.oldSelected?'/'+item.oldSelected.replace(/^workspace\//,''):null,newUrl:'/'+item.newSelected.replace(/^workspace\//,'')}));send(res,200,JSON.stringify({ok:true,...data,items}));}

async function compareScoreWeights(req, res) {
  try {
    await parseJson(req, 1024 * 1024);
    const latest = latestBenchmarkReport();
    if (!latest) throw new Error('Chưa có benchmark');
    const weightPath = path.join(REVIEW_DIR, 'score-weights.json');
    const calibrated = fs.existsSync(weightPath) ? JSON.parse(fs.readFileSync(weightPath,'utf8')).weights : { visualQuality:.35,referenceSimilarity:.25,seamScore:.15,anatomyScore:.15,textureContinuity:.10 };
    const defaults = { visualQuality:.35,referenceSimilarity:.25,seamScore:.15,anatomyScore:.15,textureContinuity:.10 };
    const score = (item,w) => item.qualityScore*w.visualQuality + item.referenceSimilarity*100*w.referenceSimilarity + item.seamScore*w.seamScore + item.anatomyScore*w.anatomyScore + item.textureContinuity*w.textureContinuity;
    const items = latest.report.items.map((item)=>({sampleId:item.sampleId,defaultScore:Number(score(item,defaults).toFixed(4)),calibratedScore:Number(score(item,calibrated).toFixed(4))})).map((item)=>({...item,delta:Number((item.calibratedScore-item.defaultScore).toFixed(4))}));
    const report={schemaVersion:1,createdAt:new Date().toISOString(),category:latest.report.category,count:items.length,defaultWeights:defaults,calibratedWeights:calibrated,averageDelta:Number((items.reduce((sum,item)=>sum+item.delta,0)/Math.max(1,items.length)).toFixed(4)),items};
    const target=path.join(REVIEW_DIR,'weight-ab-report.json');fs.writeFileSync(target,JSON.stringify(report,null,2),'utf8');
    send(res,200,JSON.stringify({ok:true,report:path.relative(ROOT,target),...report}));
  } catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}
}

async function activateScoreWeights(req, res) {
  try {
    await parseJson(req, 1024 * 1024);
    const latestByCategory=latestBenchmarkReportsByCategory();if(!Object.keys(latestByCategory).length)throw new Error('Chưa có benchmark để so sánh');
    const state = readReviewState();
    const reviewed = Object.values(state.items).filter((item) => ['approved','retry','rejected'].includes(item.status));
    const labeled = reviewed.filter((item) => (item.defectLabels || []).length > 0);
    if (reviewed.length < 5 || labeled.length < 3) {
      return send(res, 409, JSON.stringify({ ok:false, error:`Chưa đủ bằng chứng: cần ít nhất 5 ảnh đã duyệt và 3 ảnh có nhãn lỗi; hiện có ${reviewed.length} và ${labeled.length}.` }));
    }
    const weightPath = path.join(REVIEW_DIR, 'score-weights.json');
    if (!fs.existsSync(weightPath)) throw new Error('Chưa có trọng số đề xuất');
    const proposal = JSON.parse(fs.readFileSync(weightPath, 'utf8'));
    const defaults = { visualQuality:.35,referenceSimilarity:.25,seamScore:.15,anatomyScore:.15,textureContinuity:.10 };
    const score = (item,w) => Number(item.qualityScore||0)*w.visualQuality + Number(item.referenceSimilarity||0)*100*w.referenceSimilarity + Number(item.seamScore||0)*w.seamScore + Number(item.anatomyScore||0)*w.anatomyScore + Number(item.textureContinuity||0)*w.textureContinuity;
    const reportItems = new Map(Object.entries(latestByCategory).flatMap(([category,entry])=>(entry.report.items||[]).map((item)=>[reviewKey(category,item.sampleId),item])));
    const evidence = reviewed.map((review) => ({ review, item: reportItems.get(reviewKey(review.category,review.sampleId)) })).filter((entry) => entry.item);
    if (evidence.length < 5) return send(res, 409, JSON.stringify({ok:false,error:'Benchmark gần nhất không chứa đủ 5 ảnh đã duyệt để đánh giá A/B.'}));
    const utility = (entry,w) => entry.review.status === 'approved' ? score(entry.item,w) : 100-score(entry.item,w);
    const defaultUtility = evidence.reduce((sum,entry)=>sum+utility(entry,defaults),0)/evidence.length;
    const candidateUtility = evidence.reduce((sum,entry)=>sum+utility(entry,proposal.weights),0)/evidence.length;
    const improvement = candidateUtility-defaultUtility;
    if (improvement < 0.1) return send(res,409,JSON.stringify({ok:false,error:`Trọng số chưa cải thiện A/B đủ 0,1 điểm (hiện ${improvement.toFixed(4)}); không kích hoạt.`}));
    const active = {...proposal, activatedAt:new Date().toISOString(), evidenceCount:evidence.length, labeledCount:labeled.length, utilityImprovement:Number(improvement.toFixed(4))};
    const target = path.join(REVIEW_DIR,'active-score-weights.json');
    fs.writeFileSync(target,JSON.stringify(active,null,2),'utf8');
    send(res,200,JSON.stringify({ok:true,report:path.relative(ROOT,target),...active}));
  } catch(error) { send(res,400,JSON.stringify({ok:false,error:error.message})); }
}

async function confirmDefaultWeights(req,res){
  try{const body=await parseJson(req,1024*1024);if(body.confirm!==true)throw new Error('Cần xác nhận rõ ràng');const state=readReviewState();const categories=['upper_body','lower_body','overall'];const items=Object.values(state.items);const approvedByCategory=Object.fromEntries(categories.map((category)=>[category,items.filter((item)=>item.category===category&&item.status==='approved').length]));if(!categories.every((category)=>approvedByCategory[category]>=23))return send(res,409,JSON.stringify({ok:false,error:'Chỉ có thể xác nhận trọng số mặc định sau khi đủ 23 ảnh được chấp nhận ở cả ba loại.'}));const labeled=items.filter((item)=>(item.defectLabels||[]).length>0);if(labeled.length)return send(res,409,JSON.stringify({ok:false,error:'Đã có nhãn lỗi; hãy dùng quy trình hiệu chỉnh và A/B.'}));const active={schemaVersion:1,activatedAt:new Date().toISOString(),mode:'default-no-calibration-required',reason:'69 trường hợp đã chấp nhận và không có nhãn lỗi',weights:{visualQuality:.35,referenceSimilarity:.25,seamScore:.15,anatomyScore:.15,textureContinuity:.10}};const target=path.join(REVIEW_DIR,'active-score-weights.json');fs.writeFileSync(target,JSON.stringify(active,null,2),'utf8');send(res,200,JSON.stringify({ok:true,report:path.relative(ROOT,target),...active}));}catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}
}

async function saveReferenceProfile(req,res) {
  try {
    const body = await parseJson(req,30*1024*1024);
    const category = String(body.category || '');
    if (!['upper_body','lower_body','overall'].includes(category)) throw new Error('Loại trang phục không hợp lệ');
    const decoded = decodeImageDataUrl(body.image);
    const automated = await callAiJson('/validate-product-reference',{category,image:body.image});
    const validation = require('./product-reference-review').applyProductReview(automated,body.productReview,crypto.createHash('sha256').update(decoded.buffer).digest('hex'));
    if(!validation.accepted)return send(res,422,JSON.stringify({ok:false,error:'Ảnh tham chiếu không đạt cổng kiểm định',validation}));
    const directory = path.join(REFERENCES_DIR,category);fs.mkdirSync(directory,{recursive:true});
    for(const name of fs.readdirSync(directory)) if(/^reference\.(png|jpe?g|webp)$/i.test(name)) fs.unlinkSync(path.join(directory,name));
    const target = path.join(directory,`reference.${decoded.extension}`);fs.writeFileSync(target,decoded.buffer);
    const profilePath=path.join(REVIEW_DIR,'reference-profiles.json');fs.mkdirSync(REVIEW_DIR,{recursive:true});
    const profiles=fs.existsSync(profilePath)?JSON.parse(fs.readFileSync(profilePath,'utf8')):{schemaVersion:1,profiles:{}};
    const manifest=path.join(directory,'manifest.json');fs.writeFileSync(manifest,JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),category,reference:path.relative(ROOT,target).replace(/\\/g,'/'),validation},null,2),'utf8');
    profiles.profiles=profiles.profiles||{};profiles.profiles[category]={...(profiles.profiles[category]||{}),status:'validated-product-reference',specializedReferenceRequired:false,reference:path.relative(ROOT,target).replace(/\\/g,'/'),manifest:path.relative(ROOT,manifest).replace(/\\/g,'/'),validation,updatedAt:new Date().toISOString()};profiles.updatedAt=new Date().toISOString();
    fs.writeFileSync(profilePath,JSON.stringify(profiles,null,2),'utf8');
    send(res,200,JSON.stringify({ok:true,category,reference:path.relative(ROOT,target),manifest:path.relative(ROOT,manifest),validation}));
  } catch(error) { send(res,400,JSON.stringify({ok:false,error:error.message})); }
}

function referenceReadinessPayload() {
  const categories=['upper_body','lower_body','overall'];const profilePath=path.join(REVIEW_DIR,'reference-profiles.json');const document=fs.existsSync(profilePath)?JSON.parse(fs.readFileSync(profilePath,'utf8')):{profiles:{}};
  const items=categories.map((category)=>{const profile=document.profiles?.[category]||{};const validation=profile.validation||{};const reference=profile.reference||'';const target=reference?safeJoin(ROOT,reference):null;const exists=Boolean(target&&fs.existsSync(target)&&fs.statSync(target).isFile());let digest='',checksumMatches=false;if(exists){digest=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');checksumMatches=Boolean(validation.accepted&&validation.metrics?.sha256&&digest===validation.metrics.sha256);}const qualificationReport=profile.qualificationReport||'';const qualificationTarget=qualificationReport?safeJoin(ROOT,qualificationReport):null;let qualification=null;try{if(qualificationTarget&&fs.existsSync(qualificationTarget))qualification=JSON.parse(fs.readFileSync(qualificationTarget,'utf8'));}catch{}const canonical=['characters/c001.png','characters/c002.png','characters/c003.png'];const qualificationMatches=Boolean(qualification&&qualification.passed===true&&qualification.category===category&&qualification.reference===reference&&qualification.referenceSha256===digest&&qualification.validationSha256===validation.metrics?.sha256&&qualification.requiredCount===3&&qualification.passedCount===3&&JSON.stringify(qualification.qualificationSamples)===JSON.stringify(canonical));const blockers=[];if(!validation.accepted)blockers.push('Chưa qua kiểm định sản phẩm');if(!reference)blockers.push('Chưa có tệp reference');else if(!exists)blockers.push('Tệp reference không tồn tại');if(exists&&validation.accepted&&!checksumMatches)blockers.push('Checksum không khớp manifest');if(profile.status!=='qualified')blockers.push('Chưa đạt smoke qualification');else if(!qualificationMatches)blockers.push('Báo cáo qualification thiếu, cũ hoặc không khớp reference hiện tại');if(profile.specializedReferenceRequired!==false)blockers.push('Profile chưa được kích hoạt');return{category,ready:blockers.length===0,status:profile.status||'missing',reference,referenceSha256:digest,manifest:profile.manifest||'',qualificationReport,qualificationMatches,checksumMatches,metrics:validation.metrics||null,blockers};});
  for(const item of items){
    const profile=document.profiles?.[item.category]||{};
    const candidate=profile.normalizedReference;
    const target=candidate?safeJoin(ROOT,candidate):null;
    item.experimentalReference=target&&fs.existsSync(target)&&fs.statSync(target).isFile()?candidate:'';
    item.reason=profile.reason||'';
  }
  return{ok:true,schemaVersion:1,updatedAt:document.updatedAt||null,allReady:items.every((item)=>item.ready),readyCount:items.filter((item)=>item.ready).length,total:items.length,items,blockers:items.flatMap((item)=>item.blockers.map((reason)=>`${item.category}: ${reason}`))};
}

function referenceReadiness(res){send(res,200,JSON.stringify(referenceReadinessPayload()));}

async function benchmarkWithPreflight(req,res){
  try{const body=await parseJson(req,30*1024*1024);const category=String(body.category||'upper_body');const readiness=referenceReadinessPayload();const item=readiness.items.find((entry)=>entry.category===category);if(!item?.ready)return send(res,409,JSON.stringify({ok:false,error:`Benchmark bị chặn: reference ${category} chưa sẵn sàng`,preflight:item,readiness}));const target=safeJoin(ROOT,item.reference);const extension=path.extname(target).toLowerCase();const mime=extension==='.png'?'image/png':extension==='.webp'?'image/webp':'image/jpeg';body.garmentImage=`data:${mime};base64,${fs.readFileSync(target).toString('base64')}`;body.benchmarkProvenance={schemaVersion:1,category,reference:item.reference,referenceSha256:item.referenceSha256,qualificationReport:item.qualificationReport,qualificationPassed:true};const result=await callAiJson('/benchmark',body);send(res,200,JSON.stringify({...result,preflight:body.benchmarkProvenance}));}catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}
}

async function releaseAcceptance(req,res){
  try{
    await parseJson(req,1024*1024);
    const reports=[];
    if(fs.existsSync(OUTPUTS_DIR))for(const entry of fs.readdirSync(OUTPUTS_DIR,{withFileTypes:true})){
      const target=path.join(OUTPUTS_DIR,entry.name,'batch-report.json');if(!entry.isDirectory()||!fs.existsSync(target))continue;
      try{const report=JSON.parse(fs.readFileSync(target,'utf8'));if(report.benchmark)reports.push({target,report});}catch{}
    }
    reports.sort((a,b)=>String(b.report.createdAt).localeCompare(String(a.report.createdAt)));
    const latest={};for(const entry of reports)if(!latest[entry.report.category])latest[entry.report.category]=entry;
    const categories=['upper_body','lower_body','overall'];const readiness=referenceReadinessPayload();
    const checks=categories.map((category)=>{const entry=latest[category],reference=readiness.items.find((item)=>item.category===category);if(!entry)return{category,passed:false,reasons:['Thiếu benchmark']};const items=entry.report.items||[];const avg=(key)=>items.reduce((sum,item)=>sum+Number(item[key]||0),0)/Math.max(1,items.length);const values={qualityScore:avg('qualityScore'),referenceSimilarity:avg('referenceSimilarity'),seamScore:avg('seamScore'),anatomyScore:avg('anatomyScore')};const reasons=[];const provenance=entry.report.benchmarkProvenance||{};if(!reference?.ready)reasons.push(...(reference?.blockers||['Reference chưa sẵn sàng']).map((reason)=>`Reference: ${reason}`));if(provenance.category!==category||provenance.reference!==reference?.reference||provenance.referenceSha256!==reference?.referenceSha256||provenance.qualificationReport!==reference?.qualificationReport||provenance.qualificationPassed!==true)reasons.push('Benchmark không gắn với qualification/reference hiện tại');if(entry.report.completed!==23||entry.report.failed||items.length!==23||new Set(items.map((item)=>item.sampleId)).size!==23)reasons.push('Benchmark chưa đủ 23 ảnh duy nhất hoặc còn lỗi');if(values.qualityScore<90)reasons.push('Điểm tổng dưới 90');if(values.referenceSimilarity<.60)reasons.push('Độ giống dưới 0,60');if(values.seamScore<80)reasons.push('Điểm biên dưới 80');if(values.anatomyScore<95)reasons.push('Điểm hình thể dưới 95');if(Number(entry.report.performance?.peakVramMb||0)>8192)reasons.push('VRAM vượt 8 GB');return{category,passed:!reasons.length,values,performance:entry.report.performance,report:path.relative(ROOT,entry.target),benchmarkProvenance:provenance,reasons};});
    const state=readReviewState();const approvedByCategory=Object.fromEntries(categories.map((category)=>[category,Object.values(state.items).filter((item)=>item.category===category&&item.status==='approved').length]));const approved=Object.values(approvedByCategory).reduce((sum,value)=>sum+value,0);
    const referenceReady=readiness.allReady;
    const technicalPassed=checks.every((item)=>item.passed);const contentReady=categories.every((category)=>approvedByCategory[category]>=23)&&referenceReady;
    const benchmarkBlockers=checks.flatMap((check)=>check.reasons.filter((reason)=>!reason.startsWith('Reference: ')).map((reason)=>`${check.category}: ${reason}`));const blockers=[...readiness.blockers,...benchmarkBlockers,...categories.filter((category)=>approvedByCategory[category]<23).map((category)=>`${category}: mới duyệt ${approvedByCategory[category]}/23 ảnh`)];const report={schemaVersion:3,createdAt:new Date().toISOString(),technicalPassed,contentReady,referenceReady,approvedCount:approved,approvedByCategory,status:technicalPassed&&contentReady?'passed':technicalPassed?'technical-pass-review-pending':'failed',referenceReadiness:readiness,blockers:[...new Set(blockers)],checks};
    const target=path.join(REVIEW_DIR,'release-acceptance.json');fs.writeFileSync(target,JSON.stringify(report,null,2),'utf8');send(res,200,JSON.stringify({ok:true,report:path.relative(ROOT,target),...report}));
  }catch(error){send(res,400,JSON.stringify({ok:false,error:error.message}));}
}

async function listBackups(res) {
  const backups = await backupStore.list();
  send(res, 200, JSON.stringify({ ok: true, backups }));
}

async function restoreBackup(req, res) {
  try {
    const body = await parseJson(req, 1024 * 1024);
    if (body.confirm !== true) throw new Error('Khôi phục cần xác nhận rõ ràng');
    if(listJobs().some(j=>['running','cancelling'].includes(j.status))||(await workQueue.list()).some(q=>['running','queued'].includes(q.status)))throw Error('Đợi tác vụ và hàng đợi đang chạy hoàn tất trước khi khôi phục.');
    send(res,200,JSON.stringify({ok:true,...await backupStore.restore(String(body.name||''))}));
  } catch(error) { send(res,400,JSON.stringify({ok:false,error:error.message})); }
}

async function buildGoldenBaseline(req, res) {
  try {
    await parseJson(req, 1024 * 1024);
    const state = readReviewState();
    const cases = [];
    for (const item of Object.values(state.items).filter((entry) => entry.status === 'approved' && entry.selected)) {
      const selected = safeJoin(ROOT, String(item.selected).replace(/\\/g, '/'));
      if (!selected || !selected.startsWith(OUTPUTS_DIR + path.sep) || !fs.existsSync(selected)) continue;
      const metadataPath = path.join(path.dirname(selected), 'metadata.json');
      const metadata = fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : {};
      cases.push({
        sampleId: item.sampleId, category: metadata.category || item.category, qualityVersion: metadata.qualityVersion || 1, selected: path.relative(ROOT, selected),
        sha256: crypto.createHash('sha256').update(fs.readFileSync(selected)).digest('hex'),
        metrics: metadata.selectedMetrics || null, defectLabels: item.defectLabels || [],
      });
    }
    const baseline = { schemaVersion: 1, appVersion: '1.1.0', createdAt: new Date().toISOString(), caseCount: cases.length, cases };
    fs.mkdirSync(REVIEW_DIR, { recursive: true });
    const target = path.join(REVIEW_DIR, 'golden-baseline.json');
    fs.writeFileSync(target, JSON.stringify(baseline, null, 2), 'utf8');
    send(res, 200, JSON.stringify({ ok: true, baseline: path.relative(ROOT, target), ...baseline }));
  } catch (error) { send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

async function compareGoldenBaseline(req, res) {
  try {
    await parseJson(req, 1024 * 1024);
    const baselinePath = path.join(REVIEW_DIR, 'golden-baseline.json');
    if (!fs.existsSync(baselinePath)) throw new Error('Chưa có bộ ảnh chuẩn');
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const latest = latestOutputBySource();
    const keys = ['qualityScore', 'referenceSimilarity', 'seamScore', 'anatomyScore', 'textureContinuity'];
    const limits = { qualityScore: -3, referenceSimilarity: -0.03, seamScore: -5, anatomyScore: -3, textureContinuity: -5 };
    const cases = baseline.cases.map((base) => {
      const candidate = latest.get(base.sampleId);
      if (!candidate || !base.metrics) return { sampleId: base.sampleId, status: 'missing-metrics', baseline: base.selected, current: candidate ? path.relative(ROOT, candidate.selectedPath) : null, deltas: {}, warnings: ['Thiếu chỉ số để so sánh'] };
      if((base.qualityVersion||1)!==(candidate.metadata.qualityVersion||1)||(base.category&&base.category!==candidate.metadata.category))return {sampleId:base.sampleId,status:'missing-metrics',baseline:base.selected,current:path.relative(ROOT,candidate.selectedPath),deltas:{},warnings:['Khác phiên bản chấm điểm hoặc loại trang phục; cần bộ chuẩn tương ứng.']};
      const deltas = Object.fromEntries(keys.map((key) => [key, Number(((candidate.metadata.selectedMetrics[key] ?? 0) - (base.metrics[key] ?? 0)).toFixed(5))]));
      const warnings = keys.filter((key) => deltas[key] < limits[key]).map((key) => `${key}: ${deltas[key]}`);
      return { sampleId: base.sampleId, status: warnings.length ? 'regressed' : 'passed', baseline: base.selected, current: path.relative(ROOT, candidate.selectedPath), deltas, warnings };
    });
    const report = { schemaVersion: 1, createdAt: new Date().toISOString(), baselineCreatedAt: baseline.createdAt, total: cases.length, passed: cases.filter((item) => item.status === 'passed').length, regressed: cases.filter((item) => item.status === 'regressed').length, missing: cases.filter((item) => item.status === 'missing-metrics').length, cases };
    fs.mkdirSync(REVIEW_DIR, { recursive: true });
    const jsonTarget = path.join(REVIEW_DIR, 'regression-comparison.json');
    const htmlTarget = path.join(REVIEW_DIR, 'regression-report.html');
    fs.writeFileSync(jsonTarget, JSON.stringify(report, null, 2), 'utf8');
    const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
    const imageUrl = (relative) => relative ? '/' + String(relative).replace(/\\/g, '/').replace(/^workspace\//, '') : '';
    const rows = cases.map((item) => `<article><h2>${escape(item.sampleId)} — ${escape(item.status)}</h2><div class="images"><figure><img src="${escape(imageUrl(item.baseline))}"><figcaption>Baseline</figcaption></figure><figure><img src="${escape(imageUrl(item.current))}"><figcaption>Mới nhất</figcaption></figure></div><pre>${escape(JSON.stringify(item.deltas, null, 2))}</pre><p>${escape(item.warnings.join(' · ') || 'Không phát hiện suy giảm')}</p></article>`).join('');
    fs.writeFileSync(htmlTarget, `<!doctype html><meta charset="utf-8"><title>Báo cáo hồi quy hình ảnh</title><style>body{font:15px system-ui;background:#111;color:#eee;max-width:1100px;margin:auto;padding:24px}article{border:1px solid #444;padding:16px;margin:16px 0}.images{display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%}pre{white-space:pre-wrap}</style><h1>Báo cáo hồi quy</h1><p>${report.passed}/${report.total} đạt · ${report.regressed} suy giảm · ${report.missing} thiếu dữ liệu</p>${rows}`, 'utf8');
    send(res, 200, JSON.stringify({ ok: true, json: path.relative(ROOT, jsonTarget), html: path.relative(ROOT, htmlTarget), ...report }));
  } catch (error) { send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

async function cleanupJobs(req, res) {
  try {
    const body = await parseJson(req, 1024 * 1024);
    const retentionDays = Math.max(1, Math.min(365, Number(body.retentionDays || 14)));
    const cutoff = Date.now() - retentionDays * 86400000;
    const candidates = listJobs().filter((job) => ['completed', 'cancelled'].includes(job.status) && Date.parse(job.updatedAt || 0) < cutoff);
    const files = [];
    for (const job of candidates) {
      const safeId = String(job.jobId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      for (const suffix of ['.json', '.request.json', '.checkpoint.json']) {
        const target = path.join(JOBS_DIR, safeId + suffix);
        if (safeId && fs.existsSync(target)) files.push(target);
      }
    }
    if (body.confirm === true) for (const target of files) fs.unlinkSync(target);
    send(res, 200, JSON.stringify({ ok: true, dryRun: body.confirm !== true, retentionDays, jobCount: candidates.length, fileCount: files.length }));
  } catch (error) { send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

async function buildQualityDashboard(req, res) {
  try {
    await parseJson(req, 1024 * 1024);
    const reports = [];
    if (fs.existsSync(OUTPUTS_DIR)) for (const entry of fs.readdirSync(OUTPUTS_DIR, { withFileTypes: true })) {
      const reportPath = path.join(OUTPUTS_DIR, entry.name, 'batch-report.json');
      if (!entry.isDirectory() || !fs.existsSync(reportPath)) continue;
      try { const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); if (report.benchmark) reports.push({ reportPath, ...report }); } catch {}
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
      return [category, { report:path.relative(ROOT,report.reportPath), count:categoryItems.length, qualityScore:avg('qualityScore'), referenceSimilarity:avg('referenceSimilarity'), seamScore:avg('seamScore'), anatomyScore:avg('anatomyScore'), textureContinuity:avg('textureContinuity'), performance:report.performance }];
    }));
    const payload = { schemaVersion: 1, createdAt: new Date().toISOString(), benchmarkCount: reports.length, latestReport: latest ? path.relative(ROOT, latest.reportPath) : null, itemCount: items.length, metrics, groups, categoryBenchmarks, performance: latest?.performance || null, recommendations };
    fs.mkdirSync(REVIEW_DIR, { recursive: true });
    const jsonTarget = path.join(REVIEW_DIR, 'quality-dashboard.json');
    const htmlTarget = path.join(REVIEW_DIR, 'quality-dashboard.html');
    fs.writeFileSync(jsonTarget, JSON.stringify(payload, null, 2), 'utf8');
    const bars = Object.entries(metrics).map(([key, value]) => { const percent = key === 'referenceSimilarity' ? value * 100 : value; return `<div><label>${key}: ${value}</label><div class="track"><span style="width:${Math.max(0,Math.min(100,percent))}%"></span></div></div>`; }).join('');
    fs.writeFileSync(htmlTarget, `<!doctype html><meta charset="utf-8"><title>Quality dashboard</title><style>body{font:15px system-ui;background:#111;color:#eee;max-width:900px;margin:auto;padding:24px}.track{height:18px;background:#333;margin:5px 0 16px}.track span{display:block;height:100%;background:#e8a84c}pre{background:#1b1f24;padding:16px;overflow:auto}</style><h1>Quality dashboard</h1><p>${payload.itemCount} ảnh trong benchmark mới nhất · ${payload.benchmarkCount} lượt benchmark</p>${bars}<h2>So sánh loại trang phục</h2><pre>${JSON.stringify(categoryBenchmarks, null, 2)}</pre><h2>Theo nhóm ảnh và độ tin cậy mask</h2><pre>${JSON.stringify(groups, null, 2)}</pre><h2>Hiệu năng</h2><pre>${JSON.stringify(payload.performance, null, 2)}</pre><h2>Cấu hình đề xuất</h2><pre>${JSON.stringify(recommendations, null, 2)}</pre>`, 'utf8');
    send(res, 200, JSON.stringify({ ok: true, json: path.relative(ROOT, jsonTarget), html: path.relative(ROOT, htmlTarget), ...payload }));
  } catch (error) { send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

async function backupWorkspace(req, res) {
  try {
    const body=await parseJson(req,1024*1024);
    if(listJobs().some(j=>['running','cancelling'].includes(j.status))||(await workQueue.list()).some(q=>['running','queued'].includes(q.status)))throw Error('Đợi tác vụ và hàng đợi đang chạy hoàn tất trước khi sao lưu.');
    send(res,200,JSON.stringify({ok:true,...await backupStore.create(body.mode||'full')}));
  } catch (error) { send(res, 400, JSON.stringify({ ok: false, error: error.message })); }
}

function proxyAiHealth(res) {
  http.get({ hostname: '127.0.0.1', port: AI_PORT, path: '/health' }, (upstream) => { let data=''; upstream.on('data',(chunk)=>data+=chunk); upstream.on('end',()=>send(res,upstream.statusCode||500,data)); }).on('error',()=>send(res,503,JSON.stringify({ok:false,error:'Dịch vụ AI chưa chạy'})));
}

function proxyAiGet(res,endpoint){http.get({hostname:'127.0.0.1',port:AI_PORT,path:endpoint},(upstream)=>{let data='';upstream.on('data',(chunk)=>data+=chunk);upstream.on('end',()=>send(res,upstream.statusCode||500,data));}).on('error',()=>send(res,503,JSON.stringify({ok:false,error:'Dịch vụ AI chưa chạy'})));}

function readAiGet(endpoint){return new Promise((resolve)=>{const request=http.get({hostname:'127.0.0.1',port:AI_PORT,path:endpoint,timeout:5000},(upstream)=>{let data='';upstream.on('data',(chunk)=>data+=chunk);upstream.on('end',()=>{try{resolve(JSON.parse(data||'{}'));}catch{resolve({ok:false,error:'Phản hồi AI không hợp lệ'});}});});request.on('timeout',()=>request.destroy());request.on('error',()=>resolve({ok:false,error:'Dịch vụ AI chưa chạy'}));});}

async function systemOverview(res){
  const [health,runtime]=await Promise.all([readAiGet('/health'),readAiGet('/runtime-model-status')]);
  const registry=readModelRegistry(),config=readLocalConfig();
  const models=registry.models.map((entry)=>{const checked=verifyModelEntry(entry),operational=modelOperationalState(entry,checked);return{id:entry.id,name:entry.name,kind:entry.kind,ready:checked.ready,operationalReady:operational.operationalReady,runtimeReason:operational.runtimeReason||'',selected:Boolean(activeModelPath(registry,config,entry.configKey)===checked.resolvedPath)};});
  const backups=await backupStore.list();
  const baselinePath=path.join(REVIEW_DIR,'golden-baseline.json');let baseline=null;try{const value=JSON.parse(fs.readFileSync(baselinePath,'utf8'));baseline={createdAt:value.createdAt,caseCount:Number(value.caseCount||0)};}catch{}
  const jobItems=listJobs(),running=jobItems.filter((item)=>['running','cancelling'].includes(item.status)).length,interrupted=jobItems.filter((item)=>item.status==='interrupted').length;
  const readyCount=models.filter((item)=>item.ready&&item.operationalReady!==false).length;
  send(res,200,JSON.stringify({ok:true,offline:true,checkedAt:new Date().toISOString(),health,runtime,models,resetData:resetDataOverview(),summary:{readyCount,totalModels:models.length,selectedCount:models.filter((item)=>item.selected).length,backupCount:backups.length,runningJobs:running,interruptedJobs:interrupted,diskFreeGb:health.diskFreeGb??null,gpu:health.gpu||'Không xác định',gpuMemoryMb:Number(health.gpuMemoryMb||0)},backups:backups.slice(0,8),referenceReadiness:referenceReadinessPayload(),baseline,restartRequired:Boolean(config.modelRestartRequired),ready:Boolean(health.ok&&readyCount===models.length&&!config.modelRestartRequired)}));
}

async function saveMask(req, res) {
  try {
    const body = await parseJson(req);
    const sampleId = String(body.sampleId || '').replace(/\\/g, '/');
    const validSample = resolveSamplePath(sampleId);
    if (!validSample || !fs.existsSync(validSample)) throw new Error('Ảnh mẫu không tồn tại');

    const stem = path.basename(sampleId, path.extname(sampleId)).replace(/[^a-zA-Z0-9_-]/g, '_');
    const group = path.dirname(sampleId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runId = `${group}_${stem}_${stamp}`;
    const runDir = safeJoin(MASKS_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    fs.writeFileSync(path.join(runDir, 'editable_mask.png'), decodePngDataUrl(body.editableMask));
    fs.writeFileSync(path.join(runDir, 'protected_mask.png'), decodePngDataUrl(body.protectedMask));
    const metadata = {
      schemaVersion: 1,
      runId,
      createdAt: new Date().toISOString(),
      source: sampleId,
      imageWidth: Number(body.imageWidth),
      imageHeight: Number(body.imageHeight),
      label: String(body.label || 'garment'),
      notes: String(body.notes || ''),
      brushSize: Number(body.brushSize || 0),
      editor: 'manual-mask-poc',
    };
    fs.writeFileSync(path.join(runDir, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf8');
    send(res, 200, JSON.stringify({ ok: true, runId, directory: path.relative(ROOT, runDir) }));
  } catch (error) {
    send(res, 400, JSON.stringify({ ok: false, error: error.message }));
  }
}

function qualityOverview(res){
  const readOptional=(target)=>{try{return JSON.parse(fs.readFileSync(target,'utf8'));}catch{return null;}};
  const dashboard=readOptional(path.join(REVIEW_DIR,'quality-dashboard.json'));
  const regression=readOptional(path.join(REVIEW_DIR,'regression-comparison.json'));
  const baseline=readOptional(path.join(REVIEW_DIR,'golden-baseline.json'));
  const acceptance=readOptional(path.join(REVIEW_DIR,'release-acceptance.json'));
  const reports=allBenchmarkReports()||[],latest=reports[0]?.report||null;
  const state=readReviewState(),latestByCategory=latestBenchmarkReportsByCategory();
  const expected=Object.entries(latestByCategory).flatMap(([category,entry])=>(entry.report.items||[]).map((item)=>state.items[reviewKey(category,item.sampleId)]).filter(Boolean));
  const reviewed=expected.filter((item)=>['approved','retry','rejected'].includes(item.status));
  const categories=Object.entries(latestByCategory).map(([category,entry])=>({category,createdAt:entry.report.createdAt,count:(entry.report.items||[]).length,performance:entry.report.performance||null}));
  send(res,200,JSON.stringify({ok:true,checkedAt:new Date().toISOString(),dashboard,regression,baseline,acceptance,latestBenchmark:latest?{createdAt:latest.createdAt,category:latest.category,count:(latest.items||[]).length,performance:latest.performance||null}:null,benchmarkCount:reports.length,categories,review:{total:categories.reduce((sum,item)=>sum+item.count,0),reviewed:reviewed.length,approved:reviewed.filter((item)=>item.status==='approved').length,retry:reviewed.filter((item)=>item.status==='retry').length,rejected:reviewed.filter((item)=>item.status==='rejected').length}}));
}

async function selectResult(req, res) {
  try {
    const body = await parseJson(req, 1024 * 1024);
    const directory = safeJoin(ROOT, String(body.directory || ''));
    if (!directory || !directory.startsWith(MASKS_DIR + path.sep) && !directory.startsWith(path.join(ROOT, 'workspace', 'outputs') + path.sep)) {
      throw new Error('Thư mục kết quả không hợp lệ');
    }
    const seed = Number(body.seed);
    if (!Number.isSafeInteger(seed)) throw new Error('Seed không hợp lệ');
    const metadataPath = path.join(directory, 'metadata.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const candidate = (metadata.results || []).find(item => item.seed === seed);
    let source = path.join(directory, `result_seed_${seed}.png`);
    if (candidate?.file) {
      const filename = path.basename(String(candidate.file).replace(/\\/g, '/'));
      if (!new RegExp(`^(result|retry)_seed_${seed}\\.png$`).test(filename)) throw new Error('Tệp phương án không hợp lệ');
      source = path.join(directory, filename);
    } else if (!fs.existsSync(source)) {
      source = path.join(directory, `retry_seed_${seed}.png`);
    }
    const target = path.join(directory, 'selected.png');
    if (!fs.existsSync(source)) throw new Error('Không tìm thấy phương án');
    if (candidate && Number.isFinite(candidate.qualityScore)) {
      const keys = ['qualityScore', 'rankingScore', 'referenceSimilarity', 'seamScore', 'anatomyScore', 'textureContinuity', 'preservationScore'];
      metadata.selectedMetrics = Object.fromEntries(keys.filter(key => Number.isFinite(candidate[key])).map(key => [key, candidate[key]]));
      for(const key of ['colorMaterial','geometry','poseConsistency','metricSemantics'])if(candidate[key]!==undefined)metadata.selectedMetrics[key]=candidate[key];
      metadata.selectedQualityScore = candidate.qualityScore;
      metadata.bodyAudit = candidate.bodyAudit || null;
      if (metadata.qualityGate) {
        const gate = metadata.qualityGate;
        if (metadata.qualityVersion===2) {
          metadata.qualityGate=candidate.qualityGate?.version===2?{...candidate.qualityGate,requiresVisualReview:true}:{...gate,passed:false,reasons:['missing-candidate-assessment'],requiresVisualReview:true};
        } else gate.passed = candidate.bodyAudit?.passed !== false &&
          candidate.qualityScore >= gate.minimumQuality && candidate.referenceSimilarity >= gate.minimumSimilarity &&
          candidate.seamScore >= gate.minimumSeam && candidate.anatomyScore >= gate.minimumAnatomy;
      }
    } else if (metadata.selectedSeed !== seed) {
      // Older runs did not persist per-candidate scores; never reuse another image's metrics.
      metadata.selectedMetrics = null;
      metadata.selectedQualityScore = null;
      metadata.bodyAudit = null;
      if (metadata.qualityGate) metadata.qualityGate.passed = null;
    }
    fs.copyFileSync(source, target);
    metadata.selectedSeed = seed;
    metadata.selectedAt = new Date().toISOString();
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    send(res, 200, JSON.stringify({ ok: true, selected: path.relative(ROOT, target) }));
  } catch (error) {
    send(res, 400, JSON.stringify({ ok: false, error: error.message }));
  }
}

async function proxyToAi(req, res, endpoint = '/segment', maxBytes = 2 * 1024 * 1024) {
  let payload;
  try {
    payload = Buffer.from(JSON.stringify(await parseJson(req, maxBytes)), 'utf8');
  } catch (error) {
    return send(res, 400, JSON.stringify({ ok: false, error: error.message }));
  }
  const fail = () => {
    if (!res.destroyed && !res.writableEnded) send(res, 503, JSON.stringify({
      ok: false,
      error: 'Mất kết nối dịch vụ AI. Hãy kiểm tra bộ nhớ GPU và khởi động lại bằng start-ai.ps1.',
    }));
  };
  const upstream = http.request({
    hostname: '127.0.0.1', port: AI_PORT, path: endpoint, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
  }, (upstreamRes) => {
    let data = '';
    upstreamRes.on('data', (chunk) => { data += chunk; });
    upstreamRes.on('aborted', fail);
    upstreamRes.on('error', fail);
    upstreamRes.on('end', () => send(res, upstreamRes.statusCode || 500, data));
  });
  upstream.on('error', fail);
  upstream.end(payload);
}

function serveFile(res, base, relativePath) {
  const file = safeJoin(base, relativePath);
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, JSON.stringify({ error: 'Không tìm thấy tệp' }));
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

function streamJobEvents(req, res, jobId) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(jobId)) return send(res, 400, JSON.stringify({ ok:false, error:'Mã tác vụ không hợp lệ' }));
  res.writeHead(200, {
    'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-cache, no-store',
    'Connection':'keep-alive', 'X-Accel-Buffering':'no', 'X-Content-Type-Options':'nosniff',
  });
  res.write('retry: 1500\n\n');
  let closed=false,busy=false,lastPayload='';
  const poll=()=>{
    if(closed||busy)return;busy=true;
    const payload=JSON.stringify({jobId});
    const upstream=http.request({hostname:HOST,port:AI_PORT,path:'/job-status',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},(upstreamRes)=>{
      let data='';upstreamRes.on('data',(chunk)=>{data+=chunk;});upstreamRes.on('end',()=>{busy=false;if(closed)return;try{const state=JSON.parse(data);const encoded=JSON.stringify(state);if(encoded!==lastPayload){lastPayload=encoded;res.write(`event: state\ndata: ${encoded}\n\n`);}if(['completed','cancelled','failed'].includes(state.status)){res.write('event: end\ndata: {}\n\n');clearInterval(timer);res.end();}}catch{res.write('event: heartbeat\ndata: {}\n\n');}});
    });
    upstream.on('error',()=>{busy=false;if(!closed)res.write('event: heartbeat\ndata: {}\n\n');});upstream.end(payload);
  };
  const timer=setInterval(poll,800);poll();
  req.on('close',()=>{closed=true;clearInterval(timer);});
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  if(pathname==='/api/services'&&req.method==='GET')return send(res,200,JSON.stringify(await serviceManager.state()));
  if(pathname==='/api/services/restart-ai'&&req.method==='POST'){try{if((await parseJson(req,1024)).confirm!==true)throw Error('Thiếu xác nhận khởi động lại.');return send(res,202,JSON.stringify({ok:true,operation:await serviceManager.restart()}));}catch(e){return send(res,409,JSON.stringify({ok:false,error:e.message}));}}
  if(pathname==='/api/background-render'){try{if(req.method==='GET')return send(res,200,JSON.stringify({work:backgroundRenderer.work(url.searchParams.get('token'))}));if(req.method==='POST'){backgroundRenderer.complete(await parseJson(req,110*1024*1024));return send(res,200,JSON.stringify({ok:true}));}}catch(e){return send(res,403,JSON.stringify({ok:false,error:e.message}));}}
  if(pathname==='/api/acceptance'&&['GET','POST'].includes(req.method)){try{return send(res,200,JSON.stringify(req.method==='GET'?{ok:true,...await acceptanceStore.state()}:{ok:true,item:await acceptanceStore.action(await parseJson(req,16384))}));}catch(e){return send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(pathname==='/api/work-queue'&&['GET','POST'].includes(req.method)){try{let result;if(req.method==='GET')result=url.searchParams.has('id')?{queue:{...await workQueue.get(url.searchParams.get('id')),owner:undefined}}:{items:await workQueue.list()};else {const body=await parseJson(req,33*1024*1024);if(!['create','start','stop'].includes(body.action))throw Error('Hàng đợi đã chuyển sang dịch vụ nền. Tải lại giao diện để tiếp tục.');if(body.action==='start'&&(webRestartPending||serviceManager.busy()))throw Error('Dịch vụ đang khởi động lại. Thử lại sau ít giây.');result={queue:{...await workQueue.action(body),owner:undefined}};}return send(res,200,JSON.stringify({ok:true,...result}));}catch(e){return send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(req.method==='POST'&&(webRestartPending||serviceManager.busy())&&['/api/manual-cutout','/api/character-render','/api/character-regenerate','/api/makeup','/api/enhance','/api/outpaint','/api/inpaint','/api/tryon','/api/batch-tryon','/api/resume-job','/api/chroma-generate','/api/sd35-conditioned-generate','/api/sdxl-conditioned-generate'].includes(pathname))return send(res,503,JSON.stringify({ok:false,error:'Dịch vụ đang khởi động lại. Thử lại sau ít giây.'}));
  if(pathname==='/api/export-presets'&&['GET','POST'].includes(req.method)){try{return send(res,200,JSON.stringify(req.method==='GET'?{ok:true,items:await exportPresets.list()}:{ok:true,item:await exportPresets.save(await parseJson(req,16384))}));}catch(e){return send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(pathname==='/api/regions'&&['GET','POST'].includes(req.method)){try{return send(res,200,JSON.stringify(req.method==='GET'?{ok:true,items:await regionStore.list(url.searchParams.get('source'))}:{ok:true,item:await regionStore.save(await parseJson(req,16384))}));}catch(e){return send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(req.method==='POST'&&pathname==='/api/manual-cutout'){try{return send(res,200,JSON.stringify(await callAiJson('/manual-cutout',await parseJson(req,16384))));}catch(e){return send(res,400,JSON.stringify({ok:false,error:e.message.includes('endpoint')?'Khởi động lại dịch vụ AI để nạp công cụ tách chủ thể mới. Vẫn có thể dùng vùng chọn thủ công.':e.message}));}}
  if(pathname.startsWith('/api/manual/')) {
    try {
      const action=pathname.slice('/api/manual/'.length);
      if(req.method==='GET'&&action==='projects')return send(res,200,JSON.stringify({ok:true,items:await manualStore.list({sourceId:url.searchParams.get('sourceId')||'',archived:url.searchParams.get('archived')==='true'})}));
      if(req.method==='GET'&&action==='resolve')return send(res,200,JSON.stringify({ok:true,link:await manualStore.resolveOutput(url.searchParams.get('url'))}));
      if(req.method==='GET'&&action==='versions')return send(res,200,JSON.stringify({ok:true,items:await manualStore.versions(url.searchParams.get('id'))}));
      if(req.method==='GET'&&action==='project')return send(res,200,JSON.stringify({ok:true,project:await manualStore.load(url.searchParams.get('id'),url.searchParams.has('revision')?Number(url.searchParams.get('revision')):undefined)}));
      if(req.method==='GET'&&action==='presets')return send(res,200,JSON.stringify({ok:true,items:await manualStore.presets()}));
      if(req.method!=='POST')return send(res,405,JSON.stringify({ok:false,error:'Thao tác không được hỗ trợ.'}));
      const body=await parseJson(req,['assets','export'].includes(action)?110*1024*1024:9*1024*1024);
      const result=action==='assets'?{asset:await manualStore.importAsset(body)}:action==='projects'?{project:await manualStore.save(body)}:action==='archive'?{project:await manualStore.archive(body.id,body.archived!==false)}:action==='export'?{output:await manualStore.exportImage(body)}:action==='presets'?{preset:await manualStore.presets(body)}:null;
      if(!result)throw Error('Thao tác không được hỗ trợ.');return send(res,200,JSON.stringify({ok:true,...result}));
    }catch(error){return send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if(req.method==='GET'&&/^\/manual-assets\/[a-f0-9]{64}\.png$/.test(pathname))return serveFile(res,manualStore.assets,pathname.slice('/manual-assets/'.length));
  if(pathname.startsWith('/api/quality-learning/')) {
    const action=pathname.slice('/api/quality-learning/'.length);
    if(req.method!=='POST'||!['state','configure','feedback','rollback','selection','report'].includes(action))return send(res,405,JSON.stringify({ok:false,error:'Thao tác không được hỗ trợ.'}));
    try { const body=await parseJson(req,64*1024),result=await qualityService.call(action,body);
      if(action==='feedback'&&body.rating){try{const state=await qualityService.call('state',{resultId:body.resultId}),entry=state.results?.[0],url=entry?.[body.target||'original'];if(url?.startsWith('/outputs/'))await assetCatalog.update({ids:['output:'+url.slice('/outputs/'.length)],review:{status:body.rating==='good'?'approved':body.rating==='clear'?'pending':'needs-work',defects:body.defects||[]}});}catch(e){result.feedbackWarning='Đã lưu phản hồi; quyết định trong Duyệt ảnh chưa đồng bộ: '+e.message;}}
      return send(res,200,JSON.stringify(result)); }
    catch(error) { return send(res,400,JSON.stringify({ok:false,error:error.message})); }
  }
  if(pathname==='/api/json-config'&&req.method==='GET')return send(res,200,JSON.stringify({ok:true,files:jsonConfigStore.list()}));
  if(pathname.startsWith('/api/json-config/')){
    try{
      const id=pathname.slice('/api/json-config/'.length);
      if(req.method==='GET')return send(res,200,JSON.stringify({ok:true,...jsonConfigStore.read(id)}));
      if(req.method!=='POST')return send(res,405,JSON.stringify({ok:false,error:'Phương thức không được hỗ trợ.'}));
      if((req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')return send(res,403,JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
      const body=await parseJson(req,4*1024*1024);
      const result=body.action==='validate'?jsonConfigStore.preview(id,body.data,body.revision):body.action==='save'?jsonConfigStore.save(id,body.data,body.revision):body.action==='restore'?jsonConfigStore.restore(id,body.backup,body.revision):null;
      if(!result)throw new Error('Thao tác JSON không hợp lệ.');
      return send(res,200,JSON.stringify({ok:true,...result}));
    }catch(error){return send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if(req.method==='GET'&&pathname==='/api/prompts/export'){
    try{
      const content=JSON.stringify(readCatalog(),null,2)+'\n';
      res.setHeader('Content-Disposition','attachment; filename="ai-atelier-prompts.json"');
      return send(res,200,content);
    }catch(error){return send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if(req.method==='GET'&&pathname==='/api/prompts.js'){
    try{return send(res,200,'window.ATELIER_PROMPTS='+JSON.stringify(readCatalog()).replace(/</g,'\\u003c')+';','application/javascript; charset=utf-8');}
    catch(error){return send(res,500,'throw new Error("Không thể tải cấu hình prompt");','application/javascript; charset=utf-8');}
  }
  if(pathname==='/api/prompts'&&['GET','POST'].includes(req.method)){
    try{
      if(req.method==='POST'){
        if((req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')return send(res,403,JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
        const body=await parseJson(req,3*1024*1024);
        if(body.action==='preview-import')return send(res,200,JSON.stringify({ok:true,...previewImport(body.catalog)}));
        if(body.action==='import')return send(res,200,JSON.stringify({ok:true,catalog:importCatalog(body.catalog,body.expectedRevision)}));
        if(body.action==='migrate')return send(res,200,JSON.stringify({ok:true,catalog:migrateBrowser(body)}));
        if(body.action!=='library')throw new Error('Thao tác prompt không hợp lệ.');
        const catalog=updateCatalog(value=>{
          if(JSON.stringify(body.expectedLibrary)!==JSON.stringify(value.library))throw new Error('Thư viện đã thay đổi ở cửa sổ khác. Tải lại trang trước khi lưu.');
          value.library=body.items;
        });
        return send(res,200,JSON.stringify({ok:true,catalog}));
      }
      return send(res,200,JSON.stringify({ok:true,catalog:readCatalog()}));
    }catch(error){return send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if (pathname === '/api/processing-modes' && ['GET','POST'].includes(req.method)) {
    const file=PROMPTS_FILE;
    try {
      if(req.method==='POST'){
        if((req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')return send(res,403,JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
        const modes=saveMode(file,await parseJson(req,128*1024));
        return send(res,200,JSON.stringify({ok:true,modes}));
      }
      return send(res,200,JSON.stringify({ok:true,modes:listModes(file)}));
    }catch(error){return send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if (req.method === 'POST' && pathname === '/api/preset-prompt') {
    if ((req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
    try {
      const body = await parseJson(req, 128 * 1024);
      const result = savePresetPrompt(body);
      return send(res, 200, JSON.stringify(result));
    } catch (error) { return send(res, 400, JSON.stringify({ok:false,error:error.message})); }
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    return send(res, 200, JSON.stringify({ ok: true, offline: true, version: VERSION, backgroundQueueVersion:1, acceptanceVersion:1, serviceManagerVersion:1, newImageVersion:2, enhanceVersion:1, makeupVersion:1, characterVersion:1, aiPort:AI_PORT, instanceId: String(process.pid) }));
  }
  if (pathname === '/api/edit-history' && ['GET','POST'].includes(req.method)) {
    try {
      const file=path.join(ROOT,'workspace','edit-history.json');
      if(req.method==='GET')return send(res,200,JSON.stringify({ok:true,items:editHistory.read(file)}));
      if((req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)||req.headers['sec-fetch-site']==='cross-site')return send(res,403,JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
      const item=editHistory.append(file,await parseJson(req,16*1024));
      return send(res,200,JSON.stringify({ok:true,item}));
    }catch(error){return send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if (req.method === 'GET' && pathname === '/api/images') {
    const images=await assetCatalog.decorate([...listUploadedImages(), ...listImages(SAMPLES_DIR)]);
    return send(res, 200, JSON.stringify({ images: images.filter(item=>url.searchParams.get('tests')==='true'||!item.testData) }));
  }
  if (req.method === 'GET' && pathname === '/api/output-prompts') {
    try {
      const file=safeJoin(OUTPUTS_DIR,String(url.searchParams.get('file')||''));
      if(!file||!fs.existsSync(file)||!fs.statSync(file).isFile()||!/\.(png|jpe?g|webp)$/i.test(file))throw new Error('Output not found');
      const sidecar=file.replace(/\.[^.]+$/,'.json'),metadata=path.join(path.dirname(file),'metadata.json');
      const target=fs.existsSync(sidecar)?sidecar:metadata;
      const data=fs.existsSync(target)?JSON.parse(fs.readFileSync(target,'utf8')):{};
      return send(res,200,JSON.stringify({ok:true,promptHistory:data.promptHistory||[]}));
    }catch(error){return send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if (req.method === 'GET' && pathname === '/api/library-assets') {
    const {assets,removedCount}=await allLibraryAssets();
    return send(res,200,JSON.stringify({ok:true,removedCount,...await assetCatalog.query(assets,Object.fromEntries(url.searchParams))}));
  }
  if(req.method==='GET'&&pathname==='/api/image-projects'){const {assets}=await allLibraryAssets();return send(res,200,JSON.stringify({ok:true,items:await assetCatalog.projects(await assetCatalog.decorate(assets.filter(a=>a.sourceType!=='project')),await manualStore.list())}));}
  if(req.method==='GET'&&pathname==='/api/asset-catalog-state')return send(res,200,JSON.stringify({ok:true,catalog:await assetCatalog.state()}));
  if(req.method==='POST'&&pathname==='/api/review-creative'){try{const body=await parseJson(req,16384),assets=(await allLibraryAssets()).assets,item=assets.find(i=>i.id===body.id&&i.url===body.url&&i.sourceType==='result');if(!item)throw Error('Ảnh kết quả không còn trong thư viện.');await assetCatalog.update({ids:[item.id],review:{status:body.status,defects:body.defects}});let feedbackWarning='';try{const state=await qualityService.call('state',{url:item.url}),result=(state.results||[]).find(i=>i.original===item.url||i.improved===item.url);if(result)await qualityService.call('feedback',{resultId:result.id,target:result.improved===item.url?'improved':'original',rating:body.status==='approved'?'good':body.status==='pending'?'clear':'needs-work',defects:body.defects});}catch(e){feedbackWarning='Đã lưu quyết định; phản hồi hoàn thiện chi tiết chưa đồng bộ: '+e.message;}return send(res,200,JSON.stringify({ok:true,feedbackWarning}));}catch(e){return send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(req.method==='POST'&&pathname==='/api/asset-catalog'){try{return send(res,200,JSON.stringify({ok:true,catalog:await assetCatalog.update(await parseJson(req,128*1024))}));}catch(e){return send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(req.method==='GET'&&pathname==='/api/backup-preview'){try{return send(res,200,JSON.stringify({ok:true,...await backupStore.preview(url.searchParams.get('mode')||'full')}));}catch(e){return send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if(req.method==='POST'&&pathname==='/api/backup-verify'){try{const body=await parseJson(req,8192);return send(res,200,JSON.stringify({ok:true,...await backupStore.verify(body.name)}));}catch(e){return send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if (req.method === 'POST' && pathname === '/api/library-remove') {
    try {
      const body=await parseJson(req,128*1024),restore=body.restore===true;
      if(!restore&&(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>1000||body.ids.some(id=>typeof id!=='string')))throw new Error('Chọn từ 1 đến 1000 ảnh.');
      const known=new Set((await allLibraryAssets()).assets.map(item=>item.id));
      if(!restore&&body.ids.some(id=>!known.has(id)))throw new Error('Một số ảnh không còn trong thư viện. Hãy tải lại danh sách.');
      const removed=updateRemoved(path.join(ROOT,'workspace','library-removed.json'),restore?[]:body.ids,restore);
      return send(res,200,JSON.stringify({ok:true,removedCount:removed.length}));
    }catch(error){return send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if (req.method === 'POST' && pathname === '/api/images/upload') return uploadSourceImage(req, res);
  if (req.method === 'POST' && pathname === '/api/prompt-assist') return promptAssist(req, res);
  if (req.method === 'GET' && pathname === '/api/jobs') return send(res, 200, JSON.stringify({ ok: true, jobs: listJobs() }));
  if (req.method === 'GET' && pathname === '/api/job-events') return streamJobEvents(req,res,String(url.searchParams.get('jobId')||''));
  if (req.method === 'GET' && pathname === '/api/system-check') return proxyAiHealth(res);
  if (req.method === 'GET' && pathname === '/api/system-overview') return systemOverview(res);
  if (req.method === 'POST' && pathname === '/api/reset-data') return resetWorkspaceData(req, res);
  if (req.method === 'GET' && pathname === '/api/quality-overview') return qualityOverview(res);
  if (req.method === 'GET' && pathname === '/api/lora-status') return proxyAiGet(res,'/lora-status'+url.search);
  if (req.method === 'GET' && pathname === '/api/models') return listModels(res);
  if (req.method === 'GET' && pathname === '/api/model-candidates') return listModelCandidates(res);
  if (req.method === 'GET' && pathname === '/api/model-capabilities') return modelCapabilities(res);
  if (req.method === 'GET' && pathname === '/api/models/export') return exportModelManifest(res);
  if (req.method === 'GET' && pathname === '/api/benchmark-review') return benchmarkReview(res,url.searchParams.get('category')||'');
  if (req.method === 'GET' && pathname === '/api/reference-readiness') return referenceReadiness(res);
  if (req.method === 'GET' && pathname === '/api/chroma-status') return proxyAiGet(res,'/chroma-status');
  if (req.method === 'GET' && pathname === '/api/review-readiness') return reviewReadiness(res);
  if (req.method === 'GET' && pathname === '/api/retry-comparisons') return listRetryComparisons(res);
  if (req.method === 'GET' && pathname === '/api/backups') return listBackups(res);
  if (req.method === 'GET' && pathname === '/api/review') return send(res, 200, JSON.stringify({ ok: true, state: readReviewState() }));
  if (req.method === 'POST' && pathname === '/api/review') return updateReview(req, res);
  if (req.method === 'POST' && pathname === '/api/export-approved') return exportApprovedManifest(req, res);
  if (req.method === 'POST' && pathname === '/api/calibrate-quality') return calibrateQuality(req, res);
  if (req.method === 'POST' && pathname === '/api/calibrate-weights') return calibrateWeights(req, res);
  if (req.method === 'POST' && pathname === '/api/compare-weights') return compareScoreWeights(req, res);
  if (req.method === 'POST' && pathname === '/api/activate-weights') return activateScoreWeights(req, res);
  if (req.method === 'POST' && pathname === '/api/confirm-default-weights') return confirmDefaultWeights(req, res);
  if (req.method === 'POST' && pathname === '/api/reference-profile') return saveReferenceProfile(req, res);
  if (req.method === 'POST' && pathname === '/api/retry-plan') return buildRetryPlan(req, res);
  if (req.method === 'POST' && pathname === '/api/retry-comparison') return saveRetryComparison(req, res);
  if (req.method === 'POST' && pathname === '/api/release-acceptance') return releaseAcceptance(req, res);
  if (req.method === 'POST' && pathname === '/api/golden-baseline') return buildGoldenBaseline(req, res);
  if (req.method === 'POST' && pathname === '/api/compare-baseline') return compareGoldenBaseline(req, res);
  if (req.method === 'POST' && pathname === '/api/cleanup-jobs') return cleanupJobs(req, res);
  if (req.method === 'POST' && pathname === '/api/quality-dashboard') return buildQualityDashboard(req, res);
  if (req.method === 'POST' && pathname === '/api/backup') return backupWorkspace(req, res);
  if (req.method === 'POST' && pathname === '/api/restore-backup') return restoreBackup(req, res);
  if (req.method === 'POST' && pathname === '/api/masks') return saveMask(req, res);
  if (req.method === 'POST' && pathname === '/api/segment') return proxyToAi(req, res,'/segment',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/analyze-people') return proxyToAi(req, res, '/analyze-people');
  if (req.method === 'POST' && pathname === '/api/auto-mask') return proxyToAi(req, res, '/auto-mask',30*1024*1024);
  if (req.method === 'GET' && pathname === '/api/runtime-model-status') return proxyAiGet(res,'/runtime-model-status');
  if (req.method === 'POST' && pathname === '/api/detect-regions') return proxyToAi(req,res,'/detect-regions',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/adetailer-refine') return proxyToAi(req,res,'/adetailer-refine',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/sd35-conditioned-generate') {
    const state=sd35DepthOperationalState();
    if(!state.operationalReady)return send(res,409,JSON.stringify({ok:false,error:state.runtimeReason}));
    return proxyToAi(req,res,'/sd35-conditioned-generate',30*1024*1024);
  }
  if (req.method === 'POST' && pathname === '/api/sdxl-conditioned-generate') {
    const state=modelOperationalState({id:'ip-adapter-sdxl'},{ready:true});
    if(!state.operationalReady)return send(res,409,JSON.stringify({ok:false,error:'Không thể dùng ControlNet/IP-Adapter: '+state.runtimeReason}));
    const config=readLocalConfig();
    const depthRoot=path.resolve(ROOT,config.depthEstimatorModel||'models/depth/depth-anything-v2-large');
    if(['config.json','preprocessor_config.json','model.safetensors'].some(name=>!fs.existsSync(path.join(depthRoot,name))))return send(res,409,JSON.stringify({ok:false,error:'Thiếu model ước lượng chiều sâu Depth Anything V2. Cài model trước khi tạo ảnh SDXL.'}));
    return proxyToAi(req,res,'/sdxl-conditioned-generate',30*1024*1024);
  }
  if (req.method === 'POST' && pathname === '/api/preprocess-garment') return proxyToAi(req, res, '/preprocess-garment', 30 * 1024 * 1024);
  if (req.method === 'GET' && pathname === '/api/character-config') {const [health,ollama]=await Promise.all([readAiGet('/health'),readOllamaModels()]);return send(res,200,JSON.stringify({ok:true,...(health.character||{}),serviceReady:health.characterVersion===1,plannerReady:ollama.models.some(m=>m.name===MAKEUP_LLM_MODEL||m.model===MAKEUP_LLM_MODEL)}));}
  if (req.method === 'POST' && ['/api/character-analyze','/api/character-preview','/api/character-render','/api/character-regenerate'].includes(pathname)) return proxyToAi(req,res,pathname.slice(4),30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/character-refine') {try{return send(res,200,JSON.stringify(await require('./character-refine').refine(await parseJson(req,16384),requestLocalLlm,MAKEUP_LLM_MODEL)));}catch(e){return send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if (req.method === 'POST' && pathname === '/api/character-plan') {try{return send(res,200,JSON.stringify(await require('./character-plan').plan(await parseJson(req,8192),requestLocalLlm,MAKEUP_LLM_MODEL)));}catch(e){return send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if (pathname === '/api/character-presets' && ['GET','POST'].includes(req.method)) {try{const store=require('./character-presets');const file=path.join(ROOT,'workspace','character-presets.json');return send(res,200,JSON.stringify(req.method==='GET'?store.read(file):store.save(file,await parseJson(req,32768))));}catch(e){return send(res,400,JSON.stringify({ok:false,error:e.message}));}}
  if (req.method === 'POST' && pathname === '/api/makeup-compare') return proxyToAi(req,res,'/makeup-compare',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/makeup') return proxyToAi(req,res,'/makeup',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/makeup-analyze') return proxyToAi(req,res,'/makeup-analyze');
  if (req.method === 'POST' && pathname === '/api/makeup-reference') return proxyToAi(req,res,'/makeup-reference');
  if (pathname === '/api/makeup-library' && ['GET','POST'].includes(req.method)) {
    try {
      const library=require('./makeup-library-store'),file=path.join(ROOT,'workspace','makeup-styles.json');
      if(req.method==='GET')return send(res,200,JSON.stringify({ok:true,styles:library.read(file)}));
      const body=await parseJson(req,16384),item=library.save(file,body);
      return send(res,200,JSON.stringify({ok:true,item,styles:library.read(file)}));
    } catch(error) {return send(res,400,JSON.stringify({ok:false,error:error.message}));}
  }
  if (req.method === 'GET' && pathname === '/api/makeup-config') {const [health,ollama]=await Promise.all([readAiGet('/health'),readOllamaModels()]);return send(res,200,JSON.stringify({ok:true,...(health.makeup||{}),serviceReady:health.makeupVersion===1,plannerReady:ollama.models.some(model=>model.name===MAKEUP_LLM_MODEL||model.model===MAKEUP_LLM_MODEL)}));}
  if (req.method === 'POST' && pathname === '/api/makeup-plan') {try{const body=await parseJson(req,8192);return send(res,200,JSON.stringify(await require('./makeup-plan').planMakeup(body,requestLocalLlm,MAKEUP_LLM_MODEL)));}catch(error){return send(res,400,JSON.stringify({ok:false,error:'Không đọc được mô tả: '+error.message}));}}
  if (req.method === 'POST' && pathname === '/api/enhance') return proxyToAi(req,res,'/enhance',30*1024*1024);
  if (req.method === 'GET' && pathname === '/api/enhance-config') {const health=await readAiGet('/health');return send(res,200,JSON.stringify({ok:true,...(health.enhancement||{}),serviceReady:health.enhanceVersion===1}));}
  if (req.method === 'POST' && pathname === '/api/outpaint') return proxyToAi(req, res, '/outpaint');
  if (req.method === 'GET' && pathname === '/api/outpaint-config') {const health=await readAiGet('/health');return send(res,200,JSON.stringify({ok:true,version:2,serviceReady:health.outpaintVersion===2,maxPixels:Number(process.env.ATELIER_OUTPAINT_MAX_PIXELS||16777216),timing:require('./outpaint-timing').outpaintTiming(listJobs(),JOBS_DIR)}));}
  if (req.method === 'POST' && pathname === '/api/inpaint') return proxyToAi(req, res, '/inpaint', 30 * 1024 * 1024);
  if (req.method === 'POST' && pathname === '/api/inpaint-prompts') return proxyToAi(req, res, '/inpaint-prompts', 30 * 1024 * 1024);
  if (req.method === 'POST' && pathname === '/api/lora-configure') return proxyToAi(req,res,'/lora-configure');
  if (req.method === 'POST' && pathname === '/api/lora-ab-test') return proxyToAi(req,res,'/lora-ab-test',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/lora-ab-matrix') return proxyToAi(req,res,'/lora-ab-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/lora-strength-matrix') return proxyToAi(req,res,'/lora-strength-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/texture-recovery-matrix') return proxyToAi(req,res,'/texture-recovery-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/structural-refine-matrix') return proxyToAi(req,res,'/structural-refine-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/effective-step-matrix') return proxyToAi(req,res,'/effective-step-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/hybrid-tryon-compare') return proxyToAi(req,res,'/hybrid-tryon-compare',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/normalize-garment-reference') return proxyToAi(req,res,'/normalize-garment-reference',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/validate-reference') return proxyToAi(req,res,'/validate-product-reference',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/qualify-reference') return proxyToAi(req,res,'/qualify-product-reference',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/chroma-smoke') return proxyToAi(req,res,'/chroma-smoke');
  if (req.method === 'POST' && pathname === '/api/new-image-plan') return proxyToAi(req,res,'/new-image-plan');
  if (req.method === 'GET' && pathname === '/api/new-image-config') {const health=await readAiGet('/health');return send(res,200,JSON.stringify({ok:true,version:2,serviceReady:health.newImageVersion===2}));}
  if (req.method === 'POST' && pathname === '/api/chroma-generate') return proxyToAi(req,res,'/chroma-generate');
  if (req.method === 'POST' && pathname === '/api/catvton-reference-matrix') return proxyToAi(req,res,'/catvton-reference-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/catvton-dedicated-mask-matrix') return proxyToAi(req,res,'/catvton-dedicated-mask-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/catvton-retry-matrix') return proxyToAi(req,res,'/catvton-retry-matrix',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/catvton-color-audit') return proxyToAi(req,res,'/catvton-color-audit',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/catvton-geometry-audit') return proxyToAi(req,res,'/catvton-geometry-audit',30*1024*1024);
  if (req.method === 'POST' && pathname === '/api/models/register') return registerModel(req,res);
  if (req.method === 'POST' && pathname === '/api/models/download') return startModelDownload(req,res);
  if (req.method === 'POST' && pathname === '/api/models/download-all') return startAllModelDownloads(req,res);
  if (req.method === 'POST' && pathname === '/api/models/url/analyze') return analyzeModelUrl(req,res);
  if (req.method === 'POST' && pathname === '/api/models/url/register') return registerModelUrl(req,res);
  if (req.method === 'POST' && pathname === '/api/models/activate') return activateModel(req,res);
  if (req.method === 'POST' && pathname === '/api/model-capabilities/select') return selectFeatureModel(req,res);
  if (req.method === 'POST' && pathname === '/api/models/quarantine') return quarantineModel(req,res);
  if (req.method === 'POST' && pathname === '/api/models/restore') return restoreQuarantinedModel(req,res);
  if (req.method === 'POST' && pathname === '/api/models/delete') return deleteModel(req,res);
  if (req.method === 'POST' && pathname === '/api/tryon') return proxyToAi(req, res, '/tryon', 30 * 1024 * 1024);
  if (req.method === 'POST' && pathname === '/api/batch-tryon') return proxyToAi(req, res, '/batch-tryon', 30 * 1024 * 1024);
  if (req.method === 'POST' && pathname === '/api/cancel-job') return proxyToAi(req, res, '/cancel-job');
  if (req.method === 'POST' && pathname === '/api/job-status') return proxyToAi(req, res, '/job-status');
  if (req.method === 'POST' && pathname === '/api/resume-job') return proxyToAi(req, res, '/resume-job', 30 * 1024 * 1024);
  if (req.method === 'POST' && pathname === '/api/benchmark') return benchmarkWithPreflight(req, res);
  if (req.method === 'POST' && pathname === '/api/regression-audit') return proxyToAi(req, res, '/regression-audit');
  if (req.method === 'POST' && pathname === '/api/select-result') return selectResult(req, res);
  if (req.method === 'GET' && pathname.startsWith('/samples/')) {
    return serveFile(res, SAMPLES_DIR, pathname.slice('/samples/'.length));
  }
  if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
    return serveFile(res, UPLOADS_DIR, pathname.slice('/uploads/'.length));
  }
  if (req.method === 'GET' && pathname.startsWith('/outputs/')) {
    return serveFile(res, OUTPUTS_DIR, pathname.slice('/outputs/'.length));
  }
  if (req.method === 'GET' && pathname.startsWith('/references/')) {
    return serveFile(res, REFERENCES_DIR, pathname.slice('/references/'.length));
  }
  if (req.method === 'GET' && pathname.startsWith('/workspace/outputs/')) {
    return serveFile(res, OUTPUTS_DIR, pathname.slice('/workspace/outputs/'.length));
  }
  if (req.method === 'GET' && pathname === '/reports/regression-report.html') return serveFile(res, REVIEW_DIR, 'regression-report.html');
  if (req.method === 'GET' && pathname === '/reports/quality-dashboard.html') return serveFile(res, REVIEW_DIR, 'quality-dashboard.html');
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    return serveFile(res, PUBLIC_DIR, 'index.html');
  }
  if (req.method === 'GET') return serveFile(res, PUBLIC_DIR, pathname.slice(1));
  send(res, 405, JSON.stringify({ error: 'Phương thức không được hỗ trợ' }));
}

let webRestartPending = false;
async function restartWebServer(req, res) {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, JSON.stringify({ok:false,error:'Yêu cầu phải đến từ AI Atelier.'}));
  const body = await parseJson(req, 1024);
  if (body.confirm !== true) return send(res, 400, JSON.stringify({ok:false,error:'Thiếu xác nhận khởi động lại.'}));
  if(serviceManager.busy())return send(res,409,JSON.stringify({ok:false,error:'Dịch vụ AI đang khởi động lại.'}));
  try{await serviceManager.idle();}catch(e){return send(res,409,JSON.stringify({ok:false,error:e.message}));}
  if (webRestartPending || listJobs().some(item => ['running','cancelling'].includes(item.status))) return send(res, 409, JSON.stringify({ok:false,error:'Hãy đợi tác vụ đang chạy kết thúc.'}));
  webRestartPending = true;
  const helper = spawn(process.execPath, [path.join(__dirname, 'restart-web.js'), String(process.pid)], {cwd:ROOT, detached:true, windowsHide:true, stdio:'ignore'});
  helper.once('error', () => { webRestartPending=false; send(res,500,JSON.stringify({ok:false,error:'Không thể khởi động trình khởi động lại.'})); });
  helper.once('spawn', () => {
    helper.unref();
    res.once('finish', () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    });
    send(res,202,JSON.stringify({ok:true,instanceId:String(process.pid)}));
  });
}

const server = http.createServer((req, res) => {
  if (!trustedRequest(req, PORT)) {
    req.resume();
    return send(res, 403, JSON.stringify({ok:false,error:'Yêu cầu phải đến từ ứng dụng này.'}));
  }
  if (req.method === 'POST' && req.url === '/api/restart-web') {
    restartWebServer(req,res).catch(() => { if(!res.headersSent)send(res,400,JSON.stringify({ok:false,error:'Yêu cầu khởi động lại không hợp lệ.'})); });
    return;
  }
  Promise.resolve(handleRequest(req, res)).catch((error) => {
    console.error(`[web] ${req.method} ${req.url}:`, error);
    if (!res.headersSent) send(res, 500, JSON.stringify({ ok:false, error:'Dịch vụ gặp lỗi khi xử lý yêu cầu. Hãy thử lại.' }));
    else if (!res.writableEnded) res.destroy();
  });
});

server.listen(PORT, HOST, () => {
  queueRunner.start();
  try { qualityService.start(); } catch(error) { console.error('[quality]',error.message); }
  console.log(`AI Image Mask POC đang chạy tại http://${HOST}:${PORT}`);
  console.log('Chế độ offline: không có kết nối mạng bên ngoài.');
});

