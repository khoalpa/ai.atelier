'use strict';
const requireFromApp = require('node:module').createRequire(require('node:path').resolve(__dirname,'../../../app/server.js'));
// Dependencies: CONFIG_FILE, EXTERNAL_MODEL_SOURCES, LLM_BASE_URL, MODEL_CANDIDATES, MODEL_DOWNLOADER, MODEL_DOWNLOADS, MODEL_DOWNLOAD_PYTHON, MODEL_HISTORY, MODEL_REGISTRY, ROOT, fs, parseJson, path, readCatalog, safeJoin, send, spawn
module.exports = function createModels(deps) {
const require = requireFromApp;
const __dirname = require('node:path').join(deps.ROOT,'app');
function readModelRegistry(){if(!deps.fs.existsSync(deps.MODEL_REGISTRY))return{schemaVersion:1,models:[],quarantine:[]};return JSON.parse(deps.fs.readFileSync(deps.MODEL_REGISTRY,'utf8'));}

function readLocalConfig(){if(!deps.fs.existsSync(deps.CONFIG_FILE))return{};return JSON.parse(deps.fs.readFileSync(deps.CONFIG_FILE,'utf8'));}

function resolveModelPath(value){
  const raw=String(value||''),configured=deps.path.isAbsolute(raw)?deps.path.resolve(raw):deps.safeJoin(deps.ROOT,raw);
  if(!configured||deps.fs.existsSync(configured))return configured;
  const modelsRoot=deps.path.resolve(deps.ROOT,'models');
  if(configured.startsWith(modelsRoot+deps.path.sep)){
    const manuallyCopied=deps.path.join(modelsRoot,deps.path.basename(configured));
    if(manuallyCopied!==configured&&deps.fs.existsSync(manuallyCopied))return manuallyCopied;
    const matches=[];
    const findNamedModel=(folder)=>{for(const entry of deps.fs.readdirSync(folder,{withFileTypes:true})){if(!entry.isDirectory()||entry.name.endsWith('.partial')||['.cache','quarantine'].includes(entry.name))continue;const target=deps.path.join(folder,entry.name);if(entry.name===deps.path.basename(configured)&&deps.fs.existsSync(deps.path.join(target,'model_index.json')))matches.push(target);else findNamedModel(target);}};
    if(deps.fs.existsSync(modelsRoot))findNamedModel(modelsRoot);
    if(matches.length===1)return matches[0];
  }
  return configured;
}

function directorySize(target){
  try{
    const stat=deps.fs.statSync(target);if(stat.isFile())return stat.size;
    let total=0;for(const entry of deps.fs.readdirSync(target,{withFileTypes:true})){if(entry.isSymbolicLink())continue;total+=directorySize(deps.path.join(target,entry.name));}return total;
  }catch(error){if(['ENOENT','ENOTDIR'].includes(error.code))return 0;throw error;}
}

function verifyModelEntry(entry){const target=resolveModelPath(entry.path);const reasons=[];if(!target||!deps.fs.existsSync(target))reasons.push('Không tìm thấy đường dẫn');else{const stat=deps.fs.statSync(target);if((entry.requiredFiles||[]).length&&!stat.isDirectory())reasons.push('Model phải là thư mục');for(const relative of entry.requiredFiles||[])if(!deps.fs.existsSync(deps.path.join(target,relative)))reasons.push(`Thiếu ${relative}`);}return{...entry,resolvedPath:target||'',exists:Boolean(target&&deps.fs.existsSync(target)),sizeBytes:target&&deps.fs.existsSync(target)?directorySize(target):0,ready:!reasons.length,reasons};}

function activeModelPath(registry,config,configKey){if(!configKey)return'';if(config[configKey])return deps.path.resolve(config[configKey]);const fallback=registry.models.find((item)=>item.configKey===configKey);return fallback?resolveModelPath(fallback.path):'';}

function saveModelRegistry(registry,action){deps.fs.mkdirSync(deps.MODEL_HISTORY,{recursive:true});if(deps.fs.existsSync(deps.MODEL_REGISTRY)){const snapshot=deps.path.join(deps.MODEL_HISTORY,`${new Date().toISOString().replace(/[:.]/g,'-')}-${action}.json`);deps.fs.copyFileSync(deps.MODEL_REGISTRY,snapshot);}registry.updatedAt=new Date().toISOString();deps.fs.writeFileSync(deps.MODEL_REGISTRY,JSON.stringify(registry,null,2),'utf8');}

function inferLocalModelKind(target,isFile=false){const value=target.toLowerCase().replace(/\\/g,'/');if(value.includes('/lora/')||value.includes('/adapters/'))return'adapter';if(value.includes('/controlnet/'))return'controlnet';if(value.includes('/segmentation/'))return'segmentation';if(value.includes('/detection/'))return'detection';if(value.includes('/pose/'))return'pose';if(value.includes('/tryon/'))return'tryon';if(value.includes('inpaint'))return'inpaint';if(isFile)return'checkpoint';return'text-to-image';}

function inferLocalArchitecture(target){const value=target.toLowerCase();if(value.includes('sdxl')||value.includes('stable-diffusion-xl'))return'sdxl';if(value.includes('sd3.5')||value.includes('sd35')||value.includes('stable-diffusion-3.5'))return'sd35';if(value.includes('sd1.5')||value.includes('stable-diffusion-v1'))return'sd15';return'auto';}

function discoverLocalModels(registry){
  const modelsRoot=deps.path.resolve(deps.ROOT,'models'),known=new Set(),quarantined=deps.path.join(modelsRoot,'quarantine');
  const catalog=readDownloadCatalog().candidates,catalogByPath=new Map(catalog.map((item)=>[deps.path.resolve(deps.safeJoin(deps.ROOT,item.targetPath)||'').toLowerCase(),item]));
  let registryChanged=false;
  registry.models=registry.models.filter((item)=>{if(!item.autoDetected)return true;const target=deps.path.resolve(resolveModelPath(item.path)||'').toLowerCase(),transient=target.split(deps.path.sep).some((part)=>part.endsWith('.partial')||part==='.cache'),catalogOwned=[...catalogByPath.keys()].some((catalogPath)=>target===catalogPath||target.startsWith(catalogPath+deps.path.sep)),catalogItem=catalogByPath.get(target),canonicalExists=catalogItem&&registry.models.some((other)=>other!==item&&other.id===catalogItem.id);if(transient||catalogOwned||canonicalExists){registryChanged=true;return false;}return true;});
  for(const item of [...registry.models,...(registry.quarantine||[])]){const target=resolveModelPath(item.path);if(target)known.add(deps.path.resolve(target).toLowerCase());}
  const discovered=[];
  const add=(target,isFile=false)=>{
    const resolved=deps.path.resolve(target),key=resolved.toLowerCase();if(known.has(key)||resolved.startsWith(quarantined+deps.path.sep))return;
    const relative=deps.path.relative(deps.ROOT,resolved).replace(/\\/g,'/'),base=deps.path.basename(resolved,deps.path.extname(resolved));
    const catalogItem=catalogByPath.get(key);if(catalogItem&&registry.models.some((item)=>item.id===catalogItem.id)){known.add(key);return;}
    const preferredId=catalogItem&&/^[a-z0-9][a-z0-9.-]{1,63}$/.test(catalogItem.id)?catalogItem.id:slugModelId(catalogItem?.id||base);let id=preferredId,suffix=2;while(registry.models.some((item)=>item.id===id)||discovered.some((item)=>item.id===id))id=`${slugModelId(preferredId).slice(0,58)}-${suffix++}`;
    discovered.push({id,name:catalogItem?.name||base.replace(/[-_]+/g,' ').replace(/\b\w/g,(char)=>char.toUpperCase()),kind:catalogItem?.kind||inferLocalModelKind(resolved,isFile),architecture:catalogItem?.architecture||inferLocalArchitecture(resolved),path:relative,configKey:catalogItem?.configKey||'',requiredFiles:isFile?[]:['model_index.json'],license:catalogItem?.license||'unknown',source:catalogItem?.source||'local-auto-scan',status:'auto-detected',autoDetected:true,registeredAt:new Date().toISOString()});known.add(key);
  };
  const walk=(directory)=>{
    const resolved=deps.path.resolve(directory),key=resolved.toLowerCase();if(resolved!==modelsRoot&&(known.has(key)||resolved.startsWith(quarantined+deps.path.sep)))return;
    if(resolved!==modelsRoot&&(deps.path.basename(resolved).endsWith('.partial')||catalogByPath.has(key)))return;
    let entries;try{entries=deps.fs.readdirSync(resolved,{withFileTypes:true});}catch{return;}
    if(entries.some((entry)=>entry.isFile()&&entry.name==='model_index.json')){add(resolved);return;}
    for(const entry of entries){const target=deps.path.join(resolved,entry.name);if(entry.isDirectory()){if(!entry.name.endsWith('.partial')&&!['quarantine','.cache','.git','__pycache__'].includes(entry.name))walk(target);}else if(/\.(safetensors|ckpt|pt|pth|bin)$/i.test(entry.name)&&resolved!==modelsRoot&&!known.has(key)){add(target,true);}}
  };
  walk(modelsRoot);
  if(discovered.length||registryChanged){registry.models.push(...discovered);saveModelRegistry(registry,'auto-discover');}
  return discovered;
}

function sd35DepthOperationalState(){
  const config=readLocalConfig(),root=deps.path.resolve(config.controlnetDepthSd35Model||deps.path.join(deps.ROOT,'models/controlnet/depth-sd35-large')),depth=deps.path.resolve(config.depthEstimatorModel||deps.path.join(deps.ROOT,'models/depth/depth-anything-v2-large'));
  const files=[[root,'config.json'],[root,'diffusion_pytorch_model.safetensors'],[depth,'config.json'],[depth,'preprocessor_config.json'],[depth,'model.safetensors'],[deps.path.join(deps.ROOT,'models/text-to-image/stable-diffusion-3.5-large'),'model_index.json']];
  const missing=files.filter(([folder,name])=>!deps.fs.existsSync(deps.path.join(folder,name))).map(([folder,name])=>deps.path.join(folder,name));
  let reason=missing.length?'ControlNet SD3.5 chưa sẵn sàng: thiếu model ControlNet, model chiều sâu hoặc SD3.5 Large.':'';
  if(missing.length){try{const install=JSON.parse(deps.fs.readFileSync(deps.path.join(deps.ROOT,'workspace/sd35-depth-install.json'),'utf8'));if(install.state==='downloading')reason=`Đang tải ${install.repo?.includes('Depth-Anything')?'model chiều sâu':'ControlNet SD3.5'} · ${Math.floor(Number(install.bytes||0)*100/Math.max(1,Number(install.total||1)))}%`;else if(install.state==='failed')reason='Tải model chưa hoàn tất. Chạy lại trình cài ControlNet SD3.5 để tiếp tục.';}catch{}}
  return {operationalReady:!missing.length,runtimeReason:reason,runtimeMissing:missing};
}

function modelOperationalState(entry,checked){if(entry.id==='controlnet-depth-sd35-large'){const state=sd35DepthOperationalState();return {...state,operationalReady:checked.ready&&state.operationalReady};}if(entry.kind==='inpaint'){const target=checked.resolvedPath,required=['model_index.json','scheduler/scheduler_config.json'];const missing=!target||!deps.fs.existsSync(target)||!deps.fs.statSync(target).isDirectory()?['thư mục model Diffusers']:required.filter((relative)=>!deps.fs.existsSync(deps.path.join(target,relative)));let pipeline='';try{pipeline=String(JSON.parse(deps.fs.readFileSync(deps.path.join(target,'model_index.json'),'utf8'))._class_name||'');}catch{}const expected={sd35:'StableDiffusion3InpaintPipeline',sd3:'StableDiffusion3InpaintPipeline',sdxl:'StableDiffusionXLInpaintPipeline',sd15:'StableDiffusionInpaintPipeline',sd2:'StableDiffusionInpaintPipeline',flux:'FluxFillPipeline'}[String(entry.architecture||'').toLowerCase()];if(expected&&pipeline&&pipeline!==expected)missing.push(`pipeline ${expected}`);return{operationalReady:checked.ready&&!missing.length,runtimeReason:missing.length?`Thiếu cấu trúc Diffusers: ${missing.join(', ')}`:''};}const sdxlIds=new Set(['ip-adapter-sdxl','controlnet-depth-sdxl-small','controlnet-union-sdxl-1.0']);if(!sdxlIds.has(entry.id))return{operationalReady:checked.ready,runtimeReason:''};const config=readLocalConfig(),base=deps.path.resolve(process.env.SDXL_BASE_MODEL||config.sdxlBaseModel||deps.path.join(deps.ROOT,'models','text-to-image','stable-diffusion-xl-base-1.0'));const required=['model_index.json','unet/config.json','unet/diffusion_pytorch_model.fp16.safetensors','vae/diffusion_pytorch_model.fp16.safetensors','text_encoder/model.fp16.safetensors','text_encoder_2/model.fp16.safetensors'];const missing=required.filter((relative)=>!deps.fs.existsSync(deps.path.join(base,relative)));return{operationalReady:checked.ready&&!missing.length,runtimeReason:missing.length?`Thiếu SDXL Base 1.0 (${missing.length} thành phần)`:'',runtimeMissing:missing};}

function listModels(res){const registry=readModelRegistry(),discovered=discoverLocalModels(registry),config=readLocalConfig();const models=registry.models.map((entry)=>{const checked=verifyModelEntry(entry);return{...checked,...modelOperationalState(entry,checked),active:Boolean(activeModelPath(registry,config,entry.configKey)===checked.resolvedPath)};});deps.send(res,200,JSON.stringify({ok:true,schemaVersion:registry.schemaVersion,updatedAt:registry.updatedAt,models,quarantine:registry.quarantine||[],autoDiscovered:discovered.map((item)=>item.id),config,restartRequired:Boolean(config.modelRestartRequired)}));}

const modelOperationalStateStrict=modelOperationalState;

modelOperationalState=function(entry,checked){
  if(entry.id==='idm-vton'){
    const config=readLocalConfig(),vendor=deps.path.resolve(process.env.IDMVTON_ROOT||config.idmVtonRoot||deps.path.join(deps.ROOT,'vendor','IDM-VTON'));
    const model=deps.path.resolve(process.env.IDMVTON_MODEL||config.idmVtonModel||checked.resolvedPath||deps.path.join(deps.ROOT,'models','tryon','IDM-VTON'));
    const densepose=deps.path.resolve(process.env.DENSEPOSE_SCRIPT||config.denseposeScript||deps.path.join(deps.ROOT,'models','pose','densepose','densepose_r50_fpn_dl_fixed.torchscript'));
    const missing=[];
    for(const relative of ['src/tryon_pipeline.py','src/unet_hacked_tryon.py','src/unet_hacked_garmnet.py'])if(!deps.fs.existsSync(deps.path.join(vendor,relative)))missing.push(relative);
    for(const folder of ['unet','unet_encoder','vae','text_encoder','text_encoder_2','image_encoder']){
      if(!deps.fs.existsSync(deps.path.join(model,folder,'config.json')))missing.push(`${folder}/config.json`);
      if(!['model.safetensors','model.bin','pytorch_model.bin','diffusion_pytorch_model.safetensors','diffusion_pytorch_model.bin'].some((name)=>deps.fs.existsSync(deps.path.join(model,folder,name))))missing.push(`${folder}/weights`);
    }
    for(const relative of ['scheduler/scheduler_config.json','tokenizer/vocab.json','tokenizer/merges.txt','tokenizer_2/vocab.json','tokenizer_2/merges.txt'])if(!deps.fs.existsSync(deps.path.join(model,relative)))missing.push(relative);
    if(!deps.fs.existsSync(densepose)||deps.fs.statSync(densepose).size<1000000)missing.push('DensePose TorchScript');
    return{operationalReady:checked.ready&&!missing.length,runtimeReason:missing.length?`Thiếu thành phần IDM-VTON: ${missing.join(', ')}`:'',runtimeMissing:missing};
  }
  if(entry.kind==='inpaint'&&['sd3','sd35'].includes(String(entry.architecture).toLowerCase())){
    try{
      const index=JSON.parse(deps.fs.readFileSync(deps.path.join(checked.resolvedPath,'model_index.json'),'utf8'));
      const transformer=JSON.parse(deps.fs.readFileSync(deps.path.join(checked.resolvedPath,'transformer/config.json'),'utf8'));
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

function readModelDownloadStatus(id){const target=deps.path.join(deps.MODEL_DOWNLOADS,`${id}.json`);try{return JSON.parse(deps.fs.readFileSync(target,'utf8'));}catch{return null;}}

function processIsAlive(pid){if(!Number.isInteger(Number(pid))||Number(pid)<=0)return false;try{process.kill(Number(pid),0);return true;}catch{return false;}}

function liveModelDownloadStatus(entry,download){if(!download)return download;const rawError=String(download.error||download.message||'');if(download.status==='failed'&&/(401|403|gated repo|access to model.+restricted|authorized list)/i.test(rawError))return{...download,errorCode:'access-required',error:'Cần quyền truy cập Hugging Face. Hãy mở trang nguồn, đăng nhập, yêu cầu/chấp nhận quyền truy cập và cấu hình HF_TOKEN trước khi thử lại.'};if(!['starting','running'].includes(download.status))return download;const updatedAt=Date.parse(download.updatedAt||download.createdAt||0),staleForMs=Number.isFinite(updatedAt)?Date.now()-updatedAt:Infinity,alive=processIsAlive(download.processId);if(!alive&&staleForMs>15000)return{...download,status:'failed',stage:'interrupted',errorCode:'download-interrupted',error:'Tiến trình tải đã dừng ngoài dự kiến. Có thể thử lại để tiếp tục từ dữ liệu đã tải.'};const partial=resolveModelPath(`${entry.targetPath}.partial`),bytesDownloaded=partial&&deps.fs.existsSync(partial)?directorySize(partial):Number(download.bytesDownloaded||0),totalBytes=Number(download.totalBytes||0);return{...download,bytesDownloaded,totalBytes,percent:totalBytes?Number(Math.min(99.9,bytesDownloaded*100/totalBytes).toFixed(1)):download.percent};}

const liveModelDownloadStatusBase=liveModelDownloadStatus;

liveModelDownloadStatus=function(entry,download){const result=liveModelDownloadStatusBase(entry,download);if(result?.errorCode==='access-required'&&hasHuggingFaceToken())return{...result,errorCode:'access-verified',error:'Quyền Hugging Face đã được xác thực. Hãy thử tải lại để tiếp tục.'};return result;};

function readExternalModelSources(){try{return JSON.parse(deps.fs.readFileSync(deps.EXTERNAL_MODEL_SOURCES,'utf8'));}catch{return{schemaVersion:1,candidates:[]};}}

function saveExternalModelSources(data){deps.fs.writeFileSync(deps.EXTERNAL_MODEL_SOURCES,JSON.stringify(data,null,2),'utf8');}

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

function hasHuggingFaceToken(){const tokenPath=process.env.HF_TOKEN?null:deps.path.join(process.env.HF_HOME||deps.path.join(process.env.USERPROFILE||'','.cache','huggingface'),'token');return Boolean(process.env.HF_TOKEN)||(Boolean(tokenPath)&&deps.fs.existsSync(tokenPath)&&Boolean(deps.fs.readFileSync(tokenPath,'utf8').trim()));}

function readDownloadCatalog(){const bundled=JSON.parse(deps.fs.readFileSync(deps.MODEL_CANDIDATES,'utf8')),external=readExternalModelSources(),hfAuthenticated=hasHuggingFaceToken(),candidates=[...bundled.candidates,...external.candidates].map((item)=>{let candidate=INTEGRATED_MODEL_NOTES[item.id]?{...item,compatibility:'ready',integrationNote:INTEGRATED_MODEL_NOTES[item.id]}:{...item};const policy=MODEL_LICENSE_POLICIES[item.id];if(policy)candidate={...candidate,licenseCategory:policy.category,licenseLabel:policy.label,licenseNotice:policy.notice};if(hfAuthenticated&&['gated','gated-noncommercial'].includes(candidate.licenseCategory))candidate={...candidate,huggingFaceAccessConfigured:true,licenseLabel:candidate.licenseCategory==='gated'?'Đã cấp quyền Hugging Face':'Đã cấp quyền · Phi thương mại',licenseNotice:candidate.licenseCategory==='gated'?'Token Hugging Face đã được xác thực; model có thể tải lại ngay.':candidate.licenseNotice.replace('Phải chấp nhận quyền truy cập Hugging Face','Quyền truy cập Hugging Face đã được cấp')};const target=resolveModelPath(candidate.targetPath);if(candidate.compatibility==='restricted'&&LOCALLY_USABLE_RESTRICTED_MODELS.has(candidate.id)&&target&&deps.fs.existsSync(deps.path.join(target,'model_index.json')))candidate={...candidate,compatibility:'ready',licenseAcceptedForLocalUse:true};return candidate;});return{...bundled,candidates,huggingFaceAuthenticated:hfAuthenticated};}

function safeModelSourceUrl(value){let url;try{url=new URL(String(value||''));}catch{throw new Error('URL không hợp lệ');}if(url.protocol!=='https:')throw new Error('Chỉ chấp nhận URL HTTPS');if(!['huggingface.co','www.huggingface.co','civitai.com','www.civitai.com'].includes(url.hostname.toLowerCase()))throw new Error('Hiện chỉ hỗ trợ Hugging Face và Civitai');return url;}

function inferArchitecture(values){const text=values.join(' ').toLowerCase();if(text.includes('sdxl')||text.includes('sd xl')||text.includes('stable-diffusion-xl')||text.includes('illustrious'))return'sdxl';if(text.includes('sd3.5')||text.includes('sd 3.5')||text.includes('stable-diffusion-3.5'))return'sd35';if(text.includes('sd2')||text.includes('sd 2')||text.includes('stable-diffusion-2'))return'sd2';if(text.includes('sd1.5')||text.includes('sd 1.5')||text.includes('stable-diffusion-v1')||text.includes('stable-diffusion-1'))return'sd15';return'auto';}

function slugModelId(value){return String(value||'model').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64)||'model';}

async function fetchJson(url,headers={}){const response=await fetch(url,{headers:{'User-Agent':'AI-Atelier/1.0',...headers},redirect:'follow'});if(!response.ok)throw new Error(`Nguồn trả về HTTP ${response.status}`);return response.json();}

async function analyzeModelSource(source){const url=safeModelSourceUrl(source),host=url.hostname.toLowerCase();if(host.includes('huggingface.co')){const parts=url.pathname.split('/').filter(Boolean);if(parts.length<2)throw new Error('URL Hugging Face phải trỏ tới repository');const repoId=`${parts[0]}/${parts[1]}`,revision=parts[2]==='tree'&&parts[3]?parts[3]:'main',headers=process.env.HF_TOKEN?{Authorization:`Bearer ${process.env.HF_TOKEN}`}:{},data=await fetchJson(`https://huggingface.co/api/models/${repoId}`,headers),tags=Array.isArray(data.tags)?data.tags:[],files=Array.isArray(data.siblings)?data.siblings:[],sizeBytes=files.reduce((sum,item)=>sum+Number(item.size||0),0),architecture=inferArchitecture([repoId,data.pipeline_tag||'',...tags]),isDiffusers=files.some((item)=>item.rfilename==='model_index.json'),pipeline=String(data.pipeline_tag||'').toLowerCase(),kind=pipeline.includes('image-to-image')||repoId.toLowerCase().includes('inpaint')?'inpaint':pipeline.includes('text-to-image')?'checkpoint':'custom';return{provider:'huggingface',source:url.href,repoId,revision,id:slugModelId(parts[1]),name:data.cardData?.model_name||parts[1],author:data.author||parts[0],license:data.cardData?.license||'Chưa khai báo',architecture,kind,formatLabel:isDiffusers?'Diffusers':'Repository model',precision:tags.includes('fp16')?'FP16':'Theo model',sizeBytes,estimatedDownloadGb:sizeBytes?sizeBytes/1073741824:null,files:files.length,conversion:isDiffusers?'Không cần':'Có thể cần chuyển đổi',targetPath:`models/imported/${slugModelId(parts[0]+'-'+parts[1])}`,requiredFiles:isDiffusers?['model_index.json']:[]};}const modelId=url.pathname.match(/\/models\/(\d+)/)?.[1],versionId=url.searchParams.get('modelVersionId');if(!modelId)throw new Error('URL Civitai phải trỏ tới trang model');let model,version;if(versionId){version=await fetchJson(`https://civitai.com/api/v1/model-versions/${versionId}`);model={name:version.model?.name||`Civitai ${modelId}`,creator:version.model?.creator};}else{model=await fetchJson(`https://civitai.com/api/v1/models/${modelId}`);version=model.modelVersions?.[0];}if(!version)throw new Error('Không tìm thấy phiên bản Civitai');const primary=(version.files||[]).find((item)=>item.primary)||(version.files||[])[0],name=`${model.name} ${version.name||''}`.trim(),architecture=inferArchitecture([version.baseModel||'',name]);return{provider:'civitai',source:`https://civitai.com/models/${modelId}?modelVersionId=${version.id}`,modelId,modelVersionId:String(version.id),revision:version.name||String(version.id),id:slugModelId(`${model.name}-${version.name||version.id}`),name,author:model.creator?.username||'Civitai creator',license:'Xem điều khoản trên Civitai',architecture,kind:'inpaint',formatLabel:primary?.name?.endsWith('.safetensors')?'Safetensors single-file':'Checkpoint',precision:primary?.metadata?.fp||'Theo tệp',sizeBytes:Number(primary?.sizeKB||0)*1024,estimatedDownloadGb:Number(primary?.sizeKB||0)/1048576,files:(version.files||[]).length,conversion:'Bắt buộc chuyển sang Diffusers nếu là single-file',targetPath:`models/imported/${slugModelId(name)}`,requiredFiles:[]};}

const analyzeModelSourceBase=analyzeModelSource;

analyzeModelSource=async function(source){const analysis=await analyzeModelSourceBase(source);if(analysis.kind==='checkpoint'&&analysis.requiredFiles?.includes('model_index.json'))analysis.kind='text-to-image';return analysis;};

async function analyzeModelUrl(req,res){try{const body=await deps.parseJson(req,1024*1024),analysis=await analyzeModelSource(body.url);deps.send(res,200,JSON.stringify({ok:true,analysis}));}catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}}

function reconcileExternalRegistrations(catalog){const registry=readModelRegistry();let changed=false;for(const entry of catalog.candidates.filter((item)=>item.autoRegister)){const download=readModelDownloadStatus(entry.id);if(download?.status!=='completed'||registry.models.some((item)=>item.id===entry.id))continue;const conversionPending=entry.conversionRequired===true;registry.models.push({id:entry.id,name:entry.name,kind:conversionPending?'checkpoint':entry.kind,architecture:entry.architecture,path:entry.targetPath,configKey:conversionPending?'':(entry.configKey||''),requiredFiles:conversionPending?[]:(entry.requiredFiles||[]),license:entry.license||'unknown',source:entry.source,status:conversionPending?'downloaded-conversion-pending':'downloaded',revision:entry.version||entry.revision||'',autoConvertRequested:Boolean(entry.autoConvertRequested)});changed=true;}if(changed)saveModelRegistry(registry,'url-download-register');}

function listModelCandidates(res){try{const catalog=readDownloadCatalog();reconcileExternalRegistrations(catalog);const registry=readModelRegistry(),registeredIds=new Set(registry.models.map((item)=>item.id));const installed=registry.models.map((entry)=>{const checked=verifyModelEntry(entry),metadata=MODEL_DISPLAY_METADATA[entry.id]||{};return{...metadata,...entry,...checked,...modelOperationalState(entry,checked),downloaded:checked.ready,status:checked.ready?(entry.status||'downloaded'):'missing-files',dependencies:Array.isArray(metadata.dependencies)?metadata.dependencies:(Array.isArray(entry.dependencies)?entry.dependencies:[])};});const candidates=catalog.candidates.map((entry)=>{const target=resolveModelPath(entry.targetPath),download=liveModelDownloadStatus(entry,readModelDownloadStatus(entry.id)),exists=Boolean(target&&deps.fs.existsSync(target)),completed=exists&&(!download||download.status==='completed'),sizeBytes=exists?directorySize(target):0,status=['starting','running'].includes(download?.status)?'downloading':download?.status==='failed'?'download-failed':completed?'downloaded':'waiting-download';return{...entry,resolvedPath:target||'',exists,sizeBytes,downloaded:completed,status,download,registered:registeredIds.has(entry.id)};});const inventory=[...installed,...candidates.filter((item)=>!registeredIds.has(item.id)).map((item)=>({...item,...modelOperationalState(item,{ready:item.downloaded,resolvedPath:item.resolvedPath})}))];deps.send(res,200,JSON.stringify({ok:true,...catalog,candidates,inventory,summary:{total:inventory.length,downloaded:inventory.filter((item)=>item.downloaded).length,waiting:inventory.filter((item)=>!item.downloaded).length,dependencies:inventory.filter((item)=>item.kind==='dependency').length},downloadBehavior:'background-download'}));}catch(error){deps.send(res,500,JSON.stringify({ok:false,error:`Không thể đọc catalog model: ${error.message}`}));}}

async function readOllamaModels(){try{const response=await fetch(`${deps.LLM_BASE_URL}/api/tags`,{signal:AbortSignal.timeout(1800)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const data=await response.json();return{available:true,models:Array.isArray(data.models)?data.models:[],error:''};}catch(error){return{available:false,models:[],error:error.message};}}

async function listModelCandidates(res){try{const catalog=readDownloadCatalog();reconcileExternalRegistrations(catalog);const ollama=await readOllamaModels(),registry=readModelRegistry(),registeredIds=new Set(registry.models.map((item)=>item.id));const installed=registry.models.map((entry)=>{const checked=verifyModelEntry(entry),metadata=MODEL_DISPLAY_METADATA[entry.id]||{};return{...metadata,...entry,...checked,...modelOperationalState(entry,checked),downloaded:checked.ready,status:checked.ready?(entry.status||'downloaded'):'missing-files',dependencies:Array.isArray(metadata.dependencies)?metadata.dependencies:(Array.isArray(entry.dependencies)?entry.dependencies:[])};});const candidates=catalog.candidates.map((entry)=>{if(String(entry.source||'').startsWith('ollama://')){const modelName=String(entry.version||entry.source.slice('ollama://'.length)),model=ollama.models.find((item)=>item.name===modelName||item.model===modelName),downloaded=Boolean(model);return{...entry,provider:'ollama',localEndpoint:deps.LLM_BASE_URL,localModel:modelName,sourcePage:entry.sourcePage||`https://ollama.com/library/${modelName.split(':')[0]}`,resolvedPath:`${deps.LLM_BASE_URL} · ${modelName}`,exists:downloaded,sizeBytes:Number(model?.size||0),downloaded,status:downloaded?'downloaded':ollama.available?'ollama-model-missing':'ollama-unavailable',runtimeReason:downloaded?'':ollama.available?`Chưa có model ${modelName} trong Ollama`:`Không kết nối được Ollama tại ${deps.LLM_BASE_URL}`,registered:registeredIds.has(entry.id)};}const target=resolveModelPath(entry.targetPath),download=liveModelDownloadStatus(entry,readModelDownloadStatus(entry.id)),exists=Boolean(target&&deps.fs.existsSync(target)),completed=exists&&(!download||download.status==='completed'),sizeBytes=exists?directorySize(target):0,status=['starting','running'].includes(download?.status)?'downloading':download?.status==='failed'?'download-failed':completed?'downloaded':'waiting-download';return{...entry,resolvedPath:target||'',exists,sizeBytes,downloaded:completed,status,download,registered:registeredIds.has(entry.id)};});const inventory=[...installed,...candidates.filter((item)=>!registeredIds.has(item.id)).map((item)=>({...item,...modelOperationalState(item,{ready:item.downloaded,resolvedPath:item.resolvedPath})}))];deps.send(res,200,JSON.stringify({ok:true,...catalog,candidates,inventory,ollama:{available:ollama.available,endpoint:deps.LLM_BASE_URL,models:ollama.models.map((item)=>item.name)},summary:{total:inventory.length,downloaded:inventory.filter((item)=>item.downloaded).length,waiting:inventory.filter((item)=>!item.downloaded).length,dependencies:inventory.filter((item)=>item.kind==='dependency').length},downloadBehavior:'background-download'}));}catch(error){deps.send(res,500,JSON.stringify({ok:false,error:`Không thể đọc catalog model: ${error.message}`}));}}

function launchModelDownload(entry){const previous=liveModelDownloadStatus(entry,readModelDownloadStatus(entry.id));if(['starting','running'].includes(previous?.status))return{alreadyRunning:true,download:previous};const target=resolveModelPath(entry.targetPath);if(!target||!target.startsWith(deps.path.resolve(deps.ROOT,'models')+deps.path.sep))throw new Error('Đường dẫn model không an toàn');if(deps.fs.existsSync(target))throw new Error('Model đã tồn tại trên máy');if(!deps.fs.existsSync(deps.MODEL_DOWNLOAD_PYTHON))throw new Error('Thiếu môi trường Python tải model');deps.fs.mkdirSync(deps.MODEL_DOWNLOADS,{recursive:true});const statusPath=deps.path.join(deps.MODEL_DOWNLOADS,`${entry.id}.json`),createdAt=new Date().toISOString();deps.fs.writeFileSync(statusPath,JSON.stringify({id:entry.id,status:'starting',stage:'preparing',percent:Number(previous?.percent||0),source:entry.source,target,createdAt},null,2),'utf8');const child=deps.spawn(deps.MODEL_DOWNLOAD_PYTHON,[deps.MODEL_DOWNLOADER,'--id',entry.id,'--source',entry.source,'--target',target,'--status',statusPath],{cwd:deps.ROOT,detached:true,windowsHide:true,stdio:'ignore',env:process.env});const state={id:entry.id,status:'starting',stage:'preparing',percent:Number(previous?.percent||0),source:entry.source,target,createdAt,updatedAt:createdAt,processId:child.pid};deps.fs.writeFileSync(statusPath,JSON.stringify(state,null,2),'utf8');child.unref();return{id:entry.id,status:'starting',target,processId:child.pid,resumed:Boolean(previous)};}

async function startModelDownload(req,res){try{const body=await deps.parseJson(req,1024*1024),id=String(body.id||'');if(!/^[a-z0-9][a-z0-9.-]{1,63}$/.test(id))throw new Error('ID model không hợp lệ');const entry=readDownloadCatalog().candidates.find((item)=>item.id===id);if(!entry)throw new Error('Model không có trong danh mục tải');deps.send(res,202,JSON.stringify({ok:true,...launchModelDownload(entry)}));}catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}}

const modelDownloadQueue=[];

let activeQueuedModelId='',modelDownloadQueueTimer=null;

function canAutoDownloadModel(entry){const source=String(entry.source||''),level=entry.compatibility||(entry.kind==='dependency'?'dependency':'ready');return /^https:\/\//i.test(source)&&entry.provider!=='ollama'&&!['restricted','integration'].includes(level);}

function scheduleModelDownloadQueue(delay=1200){clearTimeout(modelDownloadQueueTimer);modelDownloadQueueTimer=setTimeout(processModelDownloadQueue,delay);modelDownloadQueueTimer.unref?.();}

function processModelDownloadQueue(){
  if(activeQueuedModelId){const entry=readDownloadCatalog().candidates.find((item)=>item.id===activeQueuedModelId),status=entry?liveModelDownloadStatus(entry,readModelDownloadStatus(activeQueuedModelId)):null;if(status&&['starting','running'].includes(status.status))return scheduleModelDownloadQueue();activeQueuedModelId='';}
  while(modelDownloadQueue.length){const entry=modelDownloadQueue.shift(),target=resolveModelPath(entry.targetPath),status=liveModelDownloadStatus(entry,readModelDownloadStatus(entry.id));if((target&&deps.fs.existsSync(target))||['starting','running'].includes(status?.status))continue;try{launchModelDownload(entry);activeQueuedModelId=entry.id;return scheduleModelDownloadQueue();}catch(error){deps.fs.mkdirSync(deps.MODEL_DOWNLOADS,{recursive:true});deps.fs.writeFileSync(deps.path.join(deps.MODEL_DOWNLOADS,`${entry.id}.json`),JSON.stringify({id:entry.id,status:'failed',error:error.message,updatedAt:new Date().toISOString()},null,2),'utf8');}}
}

async function startAllModelDownloads(req,res){try{const body=await deps.parseJson(req,1024*1024);if(body.confirm!==true)throw new Error('Cần xác nhận tải tất cả model');const queuedIds=new Set([activeQueuedModelId,...modelDownloadQueue.map((item)=>item.id)].filter(Boolean)),queued=[],skipped=[];for(const entry of readDownloadCatalog().candidates){const target=resolveModelPath(entry.targetPath),status=liveModelDownloadStatus(entry,readModelDownloadStatus(entry.id));if(!canAutoDownloadModel(entry)||(target&&deps.fs.existsSync(target))||['starting','running'].includes(status?.status)||queuedIds.has(entry.id)){skipped.push(entry.id);continue;}modelDownloadQueue.push(entry);queuedIds.add(entry.id);queued.push(entry.id);}processModelDownloadQueue();deps.send(res,202,JSON.stringify({ok:true,queued:queued.length,skipped:skipped.length,queuedIds:queued,active:activeQueuedModelId,remaining:modelDownloadQueue.length}));}catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}}

async function registerModelUrl(req,res){try{const body=await deps.parseJson(req,1024*1024);if(body.licenseAccepted!==true)throw new Error('Cần xác nhận đã đọc giấy phép');const analysis=await analyzeModelSource(body.url),id=slugModelId(body.id||analysis.id);if(!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id))throw new Error('ID model không hợp lệ');const registry=readModelRegistry(),external=readExternalModelSources();if(registry.models.some((item)=>item.id===id)||external.candidates.some((item)=>item.id===id))throw new Error('ID model đã tồn tại');const architecture=String(body.architecture||analysis.architecture||'auto').toLowerCase(),kind=String(body.kind||analysis.kind||'custom'),targetPath=String(body.targetPath||analysis.targetPath).replace(/\\/g,'/');if(!['auto','sd3','sd35','sdxl','sd15','sd2'].includes(architecture))throw new Error('Kiến trúc không hợp lệ');const target=resolveModelPath(targetPath);if(!target||!target.startsWith(deps.path.resolve(deps.ROOT,'models')+deps.path.sep))throw new Error('Thư mục đích phải nằm trong models');const conversionRequired=String(analysis.conversion||'').toLowerCase().includes('bắt buộc');const entry={...analysis,id,name:String(body.name||analysis.name),kind,architecture,targetPath,configKey:kind==='inpaint'?'inpaintModel':'',license:String(body.license||analysis.license||'unknown'),autoRegister:true,autoConvertRequested:body.autoConvert===true,conversionRequired,createdAt:new Date().toISOString()};external.candidates.push(entry);saveExternalModelSources(external);const download=launchModelDownload(entry);deps.send(res,202,JSON.stringify({ok:true,entry,download}));}catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}}

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
    return {...feature,selectedModel:selectedId,models:compatible.map((model)=>({id:model.id,name:model.name,kind:model.kind,architecture:model.architecture||'auto',contentStyle:model.contentStyle||'general',removalProfile:deps.readCatalog().runtimePresets.modelInpaintProfiles[model.id]||null,ready:model.ready,registered:model.registered,operationalReady:model.operationalReady,runtimeReason:model.runtimeReason||'',selected:model.id===selectedId}))};
  });
  deps.send(res,200,JSON.stringify({ok:true,restartRequired:Boolean(config.modelRestartRequired),features}));
}

async function selectFeatureModel(req,res){try{const body=await deps.parseJson(req,1024*1024),feature=MODEL_FEATURES.find((item)=>item.id===String(body.featureId||''));if(!feature)throw new Error('Chức năng không hợp lệ');const registry=readModelRegistry();discoverLocalModels(registry);const model=registry.models.find((item)=>item.id===String(body.modelId||''));if(!model)throw new Error('Model chưa đăng ký');if(!compatibleWithFeature(model,feature))throw new Error(`${model.name} không tương thích với ${feature.name}`);const checked=verifyModelEntry(model),operational=modelOperationalState(model,checked);if(!checked.ready)throw new Error(checked.reasons.join('; '));if(!operational.operationalReady)throw new Error(operational.runtimeReason||'Model chưa sẵn sàng cho chức năng này');const config=readLocalConfig();config.featureModels={...(config.featureModels||{}),[feature.id]:model.id};if(model.configKey)config[model.configKey]=checked.resolvedPath;if(model.architecture)config.inpaintArchitecture=model.architecture;config.modelRestartRequired=true;config.modelChangedAt=new Date().toISOString();deps.fs.mkdirSync(deps.path.dirname(deps.CONFIG_FILE),{recursive:true});deps.fs.writeFileSync(deps.CONFIG_FILE,JSON.stringify(config,null,2),'utf8');deps.send(res,200,JSON.stringify({ok:true,featureId:feature.id,modelId:model.id,restartRequired:true,operationalReady:operational.operationalReady}));}catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}}

async function registerModel(req,res){try{const body=await deps.parseJson(req,1024*1024);const id=String(body.id||'').trim();if(!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id))throw new Error('ID model không hợp lệ');const target=resolveModelPath(body.path);if(!target||!deps.fs.existsSync(target))throw new Error('Đường dẫn model không tồn tại');const registry=readModelRegistry();if(registry.models.some((item)=>item.id===id))throw new Error('ID model đã tồn tại');const architecture=String(body.architecture||'auto').toLowerCase();if(!['auto','sd3','sd35','sdxl','sd15','sd2'].includes(architecture))throw new Error('Kiến trúc model không được hỗ trợ');const entry={id,name:String(body.name||id),kind:String(body.kind||'custom'),architecture,path:deps.path.relative(deps.ROOT,target).startsWith('..')?target:deps.path.relative(deps.ROOT,target).replace(/\\/g,'/'),configKey:String(body.configKey||''),requiredFiles:Array.isArray(body.requiredFiles)?body.requiredFiles.map(String):[],license:String(body.license||'unknown'),source:String(body.source||'local')};const checked=verifyModelEntry(entry);if(!checked.ready)throw new Error(checked.reasons.join('; '));registry.models.push(entry);saveModelRegistry(registry,'register');deps.send(res,200,JSON.stringify({ok:true,model:checked}));}catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}}

async function activateModel(req,res){try{const body=await deps.parseJson(req,1024*1024);const registry=readModelRegistry();const entry=registry.models.find((item)=>item.id===body.id);if(!entry)throw new Error('Model chưa đăng ký');if(!entry.configKey)throw new Error('Model này không có khóa cấu hình kích hoạt');const checked=verifyModelEntry(entry);if(!checked.ready)throw new Error(checked.reasons.join('; '));const operational=modelOperationalState(entry,checked);if(!operational.operationalReady)throw new Error(operational.runtimeReason||'Model chưa sẵn sàng');const config=readLocalConfig();const appliedPath=config.modelAppliedPaths?.[entry.configKey]?deps.path.resolve(config.modelAppliedPaths[entry.configKey]):'';const alreadyApplied=appliedPath===checked.resolvedPath;config[entry.configKey]=checked.resolvedPath;if(entry.kind==='inpaint')config.inpaintArchitecture=entry.architecture||'auto';config.modelRestartRequired=!alreadyApplied;config.modelChangedAt=new Date().toISOString();if(alreadyApplied)config.modelAppliedAt=config.modelAppliedAt||new Date().toISOString();deps.fs.mkdirSync(deps.path.dirname(deps.CONFIG_FILE),{recursive:true});deps.fs.writeFileSync(deps.CONFIG_FILE,JSON.stringify(config,null,2),'utf8');deps.send(res,200,JSON.stringify({ok:true,id:entry.id,configKey:entry.configKey,path:checked.resolvedPath,architecture:entry.architecture||'auto',active:true,alreadyApplied,restartRequired:!alreadyApplied}));}catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}}

function exportModelManifest(res){const registry=readModelRegistry();const manifest={schemaVersion:1,createdAt:new Date().toISOString(),models:registry.models.map((entry)=>{const checked=verifyModelEntry(entry);return{id:entry.id,name:entry.name,kind:entry.kind,path:entry.path,ready:checked.ready,sizeBytes:checked.sizeBytes,license:entry.license,source:entry.source,reasons:checked.reasons};})};const target=deps.path.join(deps.ROOT,'workspace','review','model-manifest.json');deps.fs.mkdirSync(deps.path.dirname(target),{recursive:true});deps.fs.writeFileSync(target,JSON.stringify(manifest,null,2),'utf8');deps.send(res,200,JSON.stringify({ok:true,manifest:deps.path.relative(deps.ROOT,target),...manifest}));}

async function quarantineModel(req,res){try{const body=await deps.parseJson(req,1024*1024);if(body.confirm!==true)throw new Error('Cần xác nhận đưa model vào cách ly');const registry=readModelRegistry();const index=registry.models.findIndex((item)=>item.id===body.id);if(index<0)throw new Error('Model chưa đăng ký');const entry=registry.models[index],checked=verifyModelEntry(entry),modelsRoot=deps.path.resolve(deps.ROOT,'models'),quarantineRoot=deps.path.resolve(modelsRoot,'quarantine');if(!checked.resolvedPath.startsWith(modelsRoot+deps.path.sep)||checked.resolvedPath.startsWith(quarantineRoot+deps.path.sep))throw new Error('Chỉ cách ly model nằm trong thư mục models');const config=readLocalConfig();if(activeModelPath(registry,config,entry.configKey)===checked.resolvedPath)throw new Error('Không thể cách ly model đang được cấu hình hoạt động');deps.fs.mkdirSync(quarantineRoot,{recursive:true});const destination=deps.path.join(quarantineRoot,`${entry.id}-${new Date().toISOString().replace(/[:.]/g,'-')}`);deps.fs.renameSync(checked.resolvedPath,destination);registry.models.splice(index,1);registry.quarantine=registry.quarantine||[];registry.quarantine.push({...entry,originalPath:entry.path,path:deps.path.relative(deps.ROOT,destination).replace(/\\/g,'/'),quarantinedAt:new Date().toISOString()});saveModelRegistry(registry,'quarantine');deps.send(res,200,JSON.stringify({ok:true,id:entry.id,quarantinePath:deps.path.relative(deps.ROOT,destination),recoverable:true}));}catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}}

async function restoreQuarantinedModel(req,res){try{const body=await deps.parseJson(req,1024*1024);const registry=readModelRegistry();const index=(registry.quarantine||[]).findIndex((item)=>item.id===body.id);if(index<0)throw new Error('Không tìm thấy model trong vùng cách ly');const entry=registry.quarantine[index],source=resolveModelPath(entry.path),destination=resolveModelPath(entry.originalPath);if(!source||!destination||!deps.fs.existsSync(source))throw new Error('Dữ liệu cách ly không tồn tại');if(deps.fs.existsSync(destination))throw new Error('Vị trí khôi phục đã tồn tại');deps.fs.mkdirSync(deps.path.dirname(destination),{recursive:true});deps.fs.renameSync(source,destination);registry.quarantine.splice(index,1);const restored={...entry,path:entry.originalPath};delete restored.originalPath;delete restored.quarantinedAt;registry.models.push(restored);saveModelRegistry(registry,'restore');deps.send(res,200,JSON.stringify({ok:true,id:entry.id,path:restored.path}));}catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}}

async function deleteModel(req,res){try{const body=await deps.parseJson(req,1024*1024),id=String(body.id||''),location=body.location==='quarantine'?'quarantine':'registered';if(body.confirm!==id||!id)throw new Error('Cần nhập đúng ID model để xác nhận xóa vĩnh viễn');const registry=readModelRegistry(),collection=location==='quarantine'?(registry.quarantine||[]):registry.models,index=collection.findIndex((item)=>item.id===id);if(index<0)throw new Error(location==='quarantine'?'Không tìm thấy model trong vùng cách ly':'Model chưa đăng ký');const entry=collection[index],checked=verifyModelEntry(entry),target=checked.resolvedPath&&deps.path.resolve(checked.resolvedPath),modelsRoot=deps.path.resolve(deps.ROOT,'models'),quarantineRoot=deps.path.join(modelsRoot,'quarantine');if(!target||target===modelsRoot||!target.startsWith(modelsRoot+deps.path.sep))throw new Error('Chỉ có thể xóa model nằm trong thư mục models');if(location==='quarantine'&&!target.startsWith(quarantineRoot+deps.path.sep))throw new Error('Đường dẫn cách ly không hợp lệ');if(location==='registered'){const config=readLocalConfig(),selectedByFeature=Object.values(config.featureModels||{}).includes(id);if(activeModelPath(registry,config,entry.configKey)===target||selectedByFeature)throw new Error('Không thể xóa model đang được cấu hình hoạt động');const shared=registry.models.some((item,otherIndex)=>otherIndex!==index&&resolveModelPath(item.path)===target);if(shared)throw new Error('Không thể xóa dữ liệu đang được model khác sử dụng');}const sizeBytes=deps.fs.existsSync(target)?directorySize(target):0;if(deps.fs.existsSync(target))deps.fs.rmSync(target,{recursive:true,force:false});collection.splice(index,1);if(location==='quarantine')registry.quarantine=collection;saveModelRegistry(registry,'delete');deps.send(res,200,JSON.stringify({ok:true,id,location,deletedPath:deps.path.relative(deps.ROOT,target).replace(/\\/g,'/'),sizeBytes}));}catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}}
return {get readModelRegistry(){return readModelRegistry;},set readModelRegistry(value){readModelRegistry=value;},
get readLocalConfig(){return readLocalConfig;},set readLocalConfig(value){readLocalConfig=value;},
get resolveModelPath(){return resolveModelPath;},set resolveModelPath(value){resolveModelPath=value;},
get directorySize(){return directorySize;},set directorySize(value){directorySize=value;},
get verifyModelEntry(){return verifyModelEntry;},set verifyModelEntry(value){verifyModelEntry=value;},
get activeModelPath(){return activeModelPath;},set activeModelPath(value){activeModelPath=value;},
get saveModelRegistry(){return saveModelRegistry;},set saveModelRegistry(value){saveModelRegistry=value;},
get inferLocalModelKind(){return inferLocalModelKind;},set inferLocalModelKind(value){inferLocalModelKind=value;},
get inferLocalArchitecture(){return inferLocalArchitecture;},set inferLocalArchitecture(value){inferLocalArchitecture=value;},
get discoverLocalModels(){return discoverLocalModels;},set discoverLocalModels(value){discoverLocalModels=value;},
get sd35DepthOperationalState(){return sd35DepthOperationalState;},set sd35DepthOperationalState(value){sd35DepthOperationalState=value;},
get modelOperationalState(){return modelOperationalState;},set modelOperationalState(value){modelOperationalState=value;},
get listModels(){return listModels;},set listModels(value){listModels=value;},
get modelOperationalStateStrict(){return modelOperationalStateStrict;},
get MODEL_DISPLAY_METADATA(){return MODEL_DISPLAY_METADATA;},
get readModelDownloadStatus(){return readModelDownloadStatus;},set readModelDownloadStatus(value){readModelDownloadStatus=value;},
get processIsAlive(){return processIsAlive;},set processIsAlive(value){processIsAlive=value;},
get liveModelDownloadStatus(){return liveModelDownloadStatus;},set liveModelDownloadStatus(value){liveModelDownloadStatus=value;},
get liveModelDownloadStatusBase(){return liveModelDownloadStatusBase;},
get readExternalModelSources(){return readExternalModelSources;},set readExternalModelSources(value){readExternalModelSources=value;},
get saveExternalModelSources(){return saveExternalModelSources;},set saveExternalModelSources(value){saveExternalModelSources=value;},
get INTEGRATED_MODEL_NOTES(){return INTEGRATED_MODEL_NOTES;},
get MODEL_LICENSE_POLICIES(){return MODEL_LICENSE_POLICIES;},
get LOCALLY_USABLE_RESTRICTED_MODELS(){return LOCALLY_USABLE_RESTRICTED_MODELS;},
get hasHuggingFaceToken(){return hasHuggingFaceToken;},set hasHuggingFaceToken(value){hasHuggingFaceToken=value;},
get readDownloadCatalog(){return readDownloadCatalog;},set readDownloadCatalog(value){readDownloadCatalog=value;},
get safeModelSourceUrl(){return safeModelSourceUrl;},set safeModelSourceUrl(value){safeModelSourceUrl=value;},
get inferArchitecture(){return inferArchitecture;},set inferArchitecture(value){inferArchitecture=value;},
get slugModelId(){return slugModelId;},set slugModelId(value){slugModelId=value;},
get fetchJson(){return fetchJson;},set fetchJson(value){fetchJson=value;},
get analyzeModelSource(){return analyzeModelSource;},set analyzeModelSource(value){analyzeModelSource=value;},
get analyzeModelSourceBase(){return analyzeModelSourceBase;},
get analyzeModelUrl(){return analyzeModelUrl;},set analyzeModelUrl(value){analyzeModelUrl=value;},
get reconcileExternalRegistrations(){return reconcileExternalRegistrations;},set reconcileExternalRegistrations(value){reconcileExternalRegistrations=value;},
get listModelCandidates(){return listModelCandidates;},set listModelCandidates(value){listModelCandidates=value;},
get readOllamaModels(){return readOllamaModels;},set readOllamaModels(value){readOllamaModels=value;},
get launchModelDownload(){return launchModelDownload;},set launchModelDownload(value){launchModelDownload=value;},
get startModelDownload(){return startModelDownload;},set startModelDownload(value){startModelDownload=value;},
get modelDownloadQueue(){return modelDownloadQueue;},
get activeQueuedModelId(){return activeQueuedModelId;},set activeQueuedModelId(value){activeQueuedModelId=value;},
get modelDownloadQueueTimer(){return modelDownloadQueueTimer;},set modelDownloadQueueTimer(value){modelDownloadQueueTimer=value;},
get canAutoDownloadModel(){return canAutoDownloadModel;},set canAutoDownloadModel(value){canAutoDownloadModel=value;},
get scheduleModelDownloadQueue(){return scheduleModelDownloadQueue;},set scheduleModelDownloadQueue(value){scheduleModelDownloadQueue=value;},
get processModelDownloadQueue(){return processModelDownloadQueue;},set processModelDownloadQueue(value){processModelDownloadQueue=value;},
get startAllModelDownloads(){return startAllModelDownloads;},set startAllModelDownloads(value){startAllModelDownloads=value;},
get registerModelUrl(){return registerModelUrl;},set registerModelUrl(value){registerModelUrl=value;},
get MODEL_FEATURES(){return MODEL_FEATURES;},
get compatibleWithFeature(){return compatibleWithFeature;},set compatibleWithFeature(value){compatibleWithFeature=value;},
get modelCapabilities(){return modelCapabilities;},set modelCapabilities(value){modelCapabilities=value;},
get selectFeatureModel(){return selectFeatureModel;},set selectFeatureModel(value){selectFeatureModel=value;},
get registerModel(){return registerModel;},set registerModel(value){registerModel=value;},
get activateModel(){return activateModel;},set activateModel(value){activateModel=value;},
get exportModelManifest(){return exportModelManifest;},set exportModelManifest(value){exportModelManifest=value;},
get quarantineModel(){return quarantineModel;},set quarantineModel(value){quarantineModel=value;},
get restoreQuarantinedModel(){return restoreQuarantinedModel;},set restoreQuarantinedModel(value){restoreQuarantinedModel=value;},
get deleteModel(){return deleteModel;},set deleteModel(value){deleteModel=value;}};
};
