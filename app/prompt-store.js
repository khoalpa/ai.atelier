const fs=require('fs'),path=require('path'),crypto=require('crypto');
const FILE=process.env.ATELIER_PROMPTS_FILE||path.resolve(__dirname,'../workspace/prompts.json');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function text(v,empty=false){if(typeof v!=='string'||v.length>16000||(!empty&&!v.trim()))throw new Error('Nội dung prompt không hợp lệ (tối đa 16000 ký tự).');}
function validate(v){
  if(!object(v)||v.schemaVersion!==1)throw new Error('Phiên bản cấu hình prompt không được hỗ trợ.');
  for(const k of ['components','templates','tasks','processingModes','presets','promptAssist','ui','defaults','uiPlaceholders','runtimePresets'])if(!object(v[k]))throw new Error(`Thiếu nhóm prompt: ${k}`);
  for(const g of ['components','templates','ui','uiPlaceholders'])for(const entry of Object.values(v[g]))text(entry,true);
  const number=(value,min,max)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error('Thông số chạy không hợp lệ.');};
  const integer=(value,min,max)=>{number(value,min,max);if(!Number.isInteger(value))throw new Error('Thông số phải là số nguyên.');};
  const quality=(profiles,names)=>{
    if(!object(profiles))throw new Error('Thiếu preset chất lượng.');
    for(const name of names){const p=profiles[name];if(!object(p))throw new Error('Thiếu preset: '+name);integer(Number(p.count),1,16);integer(p.steps,1,200);}
  };
  const runtime=v.runtimePresets,levels=['fast','balanced','quality'];
  if(!object(runtime.textToImage)||!object(runtime.textToImage.sizes)||!object(runtime.textToImage.steps))throw new Error('Thiếu preset tạo ảnh.');
  for(const name of levels)integer(Number(runtime.textToImage.sizes[name]),64,8192);
  for(const family of ['standard','chroma','klein']){if(!object(runtime.textToImage.steps[family]))throw new Error('Thiếu preset model: '+family);for(const name of levels)integer(runtime.textToImage.steps[family][name],1,200);}
  if(runtime.textToImage.profiles!==undefined){
    if(!object(runtime.textToImage.profiles))throw new Error('Profile tạo ảnh không hợp lệ.');
    for(const family of ['sd35','sdxl','chroma','klein']){
      const p=runtime.textToImage.profiles[family];if(!object(p)||!object(p.steps))throw new Error('Thiếu profile tạo ảnh: '+family);
      number(p.guidance,1,8);for(const name of levels)integer(p.steps[name],4,50);
      if(family==='klein'&&(p.guidance!==1||levels.some(name=>p.steps[name]!==4)))throw new Error('Klein cần 4 bước và guidance 1.');
    }
  }
  quality(runtime.tryonQuality,levels);
  for(const p of Object.values(runtime.tryonQuality))if(typeof p.twoStage!=='boolean')throw new Error('Cấu hình hai giai đoạn không hợp lệ.');
  if(!object(runtime.inpaintQuality))throw new Error('Thiếu preset inpaint.');
  for(const kind of ['garment','object']){const profiles=runtime.inpaintQuality[kind];quality(profiles,['fast','balanced','detail']);for(const p of Object.values(profiles)){number(p.strength,0,1);if(p.resolution!==undefined)integer(Number(p.resolution),64,8192);}}
  if(!object(runtime.inpaintProfiles))throw new Error('Thiếu profile inpaint.');
  for(const architecture of ['flux','sd35','sd3','sdxl','sd15','sd2']){
    const p=runtime.inpaintProfiles[architecture];if(!object(p))throw new Error('Thiếu profile: '+architecture);
    integer(p.nativeResolution,64,8192);integer(p.steps,1,200);number(p.strength,0,1);number(p.guidance,0,50);number(p.retryStrengthIncrement,0,1);integer(p.maximumRetries,0,10);text(p.promptMode);
    if(typeof p.supportsNegativePrompt!=='boolean')throw new Error('Cấu hình negative prompt không hợp lệ.');
  }
  if(!object(runtime.modelInpaintProfiles))throw new Error('Thiếu profile riêng theo model.');
  for(const profile of Object.values(runtime.modelInpaintProfiles)){
    if(!object(profile))throw new Error('Profile model không hợp lệ.');
    for(const key of ['nativeResolution','steps','maximumRetries'])if(profile[key]!==undefined)integer(profile[key],key==='maximumRetries'?0:1,key==='nativeResolution'?8192:key==='steps'?200:10);
    for(const key of ['strength','retryStrengthIncrement','guidance'])if(profile[key]!==undefined)number(profile[key],0,key==='guidance'?50:1);
    if(profile.promptMode!==undefined)text(profile.promptMode);
    if(profile.supportsNegativePrompt!==undefined&&typeof profile.supportsNegativePrompt!=='boolean')throw new Error('Cấu hình negative theo model không hợp lệ.');
  }
  if(!Array.isArray(v.outfitTypes)||!v.outfitTypes.length)throw new Error('Thiếu danh mục đối tượng.');
  const outfitIds=new Set();
  for(const item of v.outfitTypes){
    if(!object(item))throw new Error('Đối tượng không hợp lệ.');text(item.id);text(item.label);
    if(outfitIds.has(item.id))throw new Error('ID đối tượng bị trùng.');outfitIds.add(item.id);
    if(item.category!==undefined)text(item.category);
    if(item.classes!==undefined){if(!Array.isArray(item.classes)||!item.classes.length)throw new Error('Từ khóa nhận diện không hợp lệ.');for(const term of item.classes)text(term);}
  }
  for(const [id,m] of Object.entries(v.processingModes)){if(!['base_layer','reconstruct_body','background'].includes(id)||!object(m))throw new Error('Chế độ xử lý không hợp lệ.');text(m.label);text(m.prompt);}
  if(Object.keys(v.processingModes).length!==3)throw new Error('Thiếu chế độ xử lý.');
  for(const p of Object.values(v.presets)){if(!object(p))throw new Error('Preset không hợp lệ.');text(p.prompt,true);}
  if(!object(v.promptAssist.tasks))throw new Error('Thiếu hướng dẫn trợ lý prompt.');
  for(const entry of Object.values(v.promptAssist.tasks))text(entry);
  text(v.promptAssist.system);text(v.promptAssist.instruction);
  if(!object(v.defaults.presets)||!object(v.defaults.processingModes)||!Array.isArray(v.defaults.library))throw new Error('Thiếu nội dung prompt gốc.');
  const slots=new Set(['new-image','new-image-negative','inpaint','inpaint-negative']);
  for(const items of [v.library,v.defaults.library]){
    if(!Array.isArray(items)||items.length>2000)throw new Error('Thư viện prompt không hợp lệ.');
    const ids=new Set(),defaults=new Set();
    for(const item of items){
      if(!object(item)||!slots.has(item.slot)||typeof item.isDefault!=='boolean'||typeof item.builtin!=='boolean')throw new Error('Mục thư viện prompt không hợp lệ.');
      text(item.id);text(item.name);text(item.text);
      if(ids.has(item.id))throw new Error('ID prompt bị trùng.');ids.add(item.id);
      if(item.isDefault){if(defaults.has(item.slot))throw new Error('Mỗi phạm vi chỉ có một prompt mặc định.');defaults.add(item.slot);}
    }
  }
  for(const task of Object.values(v.tasks)){
    if(!object(task))throw new Error('Tác vụ prompt không hợp lệ.');
    if(task.components!==undefined&&!Array.isArray(task.components))throw new Error('Danh sách thành phần không hợp lệ.');
    for(const id of task.components||[])if(!Object.hasOwn(v.components,id))throw new Error('Tham chiếu thành phần không tồn tại.');
    if(task.source&&(!Object.hasOwn(v,task.source)||!Object.hasOwn(v[task.source],task.key)))throw new Error('Nguồn prompt không tồn tại.');
    for(const polarity of ['positive','negative']){
    const spec=task[polarity];if(spec===undefined)continue;
    if(!object(spec)||(spec.components!==undefined&&!Array.isArray(spec.components)))throw new Error('Cấu hình ghép prompt không hợp lệ.');
    if(spec.template&&!Object.hasOwn(v.templates,spec.template))throw new Error('Tham chiếu template không tồn tại.');
    for(const id of spec.components||[])if(!Object.hasOwn(v.components,id))throw new Error('Tham chiếu thành phần không tồn tại.');
    if(spec.libraryIds!==undefined){
      if(!Array.isArray(spec.libraryIds))throw new Error('Tham chiếu thư viện không hợp lệ.');
      for(const id of spec.libraryIds){const item=v.library.find(item=>item.id===id);if(!item||item.slot.endsWith('-negative')!==(polarity==='negative'))throw new Error('Tham chiếu thư viện không tồn tại hoặc sai loại: '+id);}
    }
  }
  }
  for(const [id,preset] of Object.entries(v.presets)){
    if(!Object.hasOwn(v.defaults.presets,id))throw new Error('Thiếu preset gốc: '+id);
    text(v.defaults.presets[id],true);
    for(const key of ['expand','blur','steps','strength','guidance','crop'])if(typeof preset[key]!=='number'||!Number.isFinite(preset[key]))throw new Error('Thông số preset không hợp lệ: '+id+'.'+key);
  }
  for(const id of Object.keys(v.processingModes)){
    const mode=v.defaults.processingModes[id];if(!object(mode))throw new Error('Thiếu chế độ xử lý gốc: '+id);text(mode.label);text(mode.prompt);
  }
  if(v.legacyLibrary!==undefined){if(!object(v.legacyLibrary))throw new Error('Dữ liệu prompt cũ không hợp lệ.');for(const entry of Object.values(v.legacyLibrary))text(entry,true);}
  if(v.migrations!==undefined&&(!Array.isArray(v.migrations)||v.migrations.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id))))throw new Error('Dữ liệu chuyển đổi không hợp lệ.');
  require('./catalog-schema').validateFeatures(v);
  return v;
}
const MAX_IMPORT_BYTES=2*1024*1024;
function revision(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function summary(value){return {components:Object.keys(value.components).length,templates:Object.keys(value.templates).length,tasks:Object.keys(value.tasks).length,processingModes:Object.keys(value.processingModes).length,presets:Object.keys(value.presets).length,library:value.library.length,promptAssist:Object.keys(value.promptAssist.tasks).length,ui:Object.keys(value.ui).length,uiPlaceholders:Object.keys(value.uiPlaceholders).length,runtimePresets:Object.keys(value.runtimePresets).length,outfitTypes:value.outfitTypes.length,encoderPolicies:Object.keys(value.promptQuality?.models||{}).length,featurePresets:Object.keys(value.featurePresets||{}).length,qualityRevision:value.promptQuality?.revision||0};}
function prepareImport(candidate,current){
  if(Buffer.byteLength(JSON.stringify(candidate)??'')>MAX_IMPORT_BYTES)throw new Error('Tệp prompt tối đa 2 MB.');
  function safeKeys(value){
    if(!value||typeof value!=='object')return;
    for(const [key,child] of Object.entries(value)){
      if(['__proto__','prototype','constructor'].includes(key))throw new Error('Tên trường không được hỗ trợ: '+key);
      safeKeys(child);
    }
  }
  safeKeys(candidate);
  if(current.promptQuality&&!candidate.promptQuality)throw new Error('Tệp nhập thiếu promptQuality chứa cấu hình encoder đang sử dụng.');
  validate(candidate);
  if(current.promptQuality)for(const id of Object.keys(current.promptQuality.models))if(!candidate.promptQuality.models[id])throw new Error('Thiếu cấu hình encoder đang sử dụng: '+id);
  // Compiled callers use these IDs and template variables. Imported files may
  // add entries and change text, but must retain the application's contract.
  for(const group of ['components','templates','processingModes','presets','ui','uiPlaceholders','runtimePresets',...(current.featurePresets?['featurePresets']:[])])for(const key of Object.keys(current[group])){
    if(!object(candidate[group]))throw new Error('Thiếu nhóm cấu hình: '+group);
    if(!Object.hasOwn(candidate[group],key))throw new Error('Tệp nhập thiếu mục cần thiết: '+group+'.'+key);
  }
  for(const item of current.outfitTypes)if(!candidate.outfitTypes.some(entry=>entry.id===item.id))throw new Error('Tệp nhập thiếu loại đối tượng: '+item.id);
  for(const key of Object.keys(current.promptAssist.tasks))if(!Object.hasOwn(candidate.promptAssist.tasks,key))throw new Error('Thiếu hướng dẫn trợ lý prompt: '+key);
  const variables=text=>[...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(m=>m[1]).sort();
  for(const key of Object.keys(current.templates))if(JSON.stringify(variables(candidate.templates[key]))!==JSON.stringify(variables(current.templates[key])))throw new Error('Biến trong template không tương thích: '+key);
  if(JSON.stringify(variables(candidate.promptAssist.instruction))!==JSON.stringify(variables(current.promptAssist.instruction)))throw new Error('Biến hướng dẫn trợ lý prompt không tương thích.');
  return candidate;
}
function previewImport(candidate,file=FILE){const current=readCatalog(file);prepareImport(candidate,current);return {summary:summary(candidate),revision:revision(current)};}
function importCatalog(candidate,expectedRevision,file=FILE){
  return updateCatalog(current=>{
    if(typeof expectedRevision!=='string'||expectedRevision!==revision(current))throw new Error('Cấu hình đã thay đổi sau khi xem trước. Chọn lại tệp để nhập.');
    prepareImport(candidate,current);
    const next=structuredClone(candidate);
    // Older exports predate unified personal libraries. Preserve local data.
    if(current.personalLibraries&&!next.personalLibraries)next.personalLibraries=structuredClone(current.personalLibraries);
    // Browser migration bookkeeping belongs to this installation.
    if(current.migrations)next.migrations=current.migrations;else delete next.migrations;
    for(const key of Object.keys(current))delete current[key];
    Object.assign(current,next);
  },file);
}
function readCatalog(file=FILE){return validate(JSON.parse(fs.readFileSync(file,'utf8')));}
function updateCatalog(change,file=FILE){
  // Synchronous mutations cannot interleave in the web process.
  const v=readCatalog(file);change(v);validate(v);
  const tmp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`,backup=path.join(path.dirname(file),'backups','prompts');
  fs.mkdirSync(backup,{recursive:true});fs.copyFileSync(file,path.join(backup,`${Date.now()}-${crypto.randomUUID()}.json`));
  try{fs.writeFileSync(tmp,JSON.stringify(v,null,2)+'\n',{encoding:'utf8',flag:'wx'});fs.renameSync(tmp,file);}
  finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  return v;
}
function renderTemplate(template,vars){return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(_,key)=>{if(!Object.hasOwn(vars,key))throw new Error(`Thiếu biến prompt: ${key}`);return String(vars[key]);});}
function listModes(file=FILE){return Object.entries(readCatalog(file).processingModes).map(([id,m])=>({id,...m}));}
function saveMode(file=FILE,{id,prompt,reset=false}){
  updateCatalog(v=>{if(!Object.hasOwn(v.processingModes,id))throw new Error('Chế độ xử lý không được hỗ trợ.');if(!reset)text(prompt);v.processingModes[id].prompt=reset?v.defaults.processingModes[id].prompt:prompt.trim();},file);
  return listModes(file);
}
function savePresetPrompt({name,prompt,reset=false},file=FILE){
  const v=updateCatalog(v=>{if(!Object.hasOwn(v.presets,name))throw new Error('Preset không được hỗ trợ.');if(!reset)text(prompt,['sleepwear','underwear','mannequin'].includes(name));v.presets[name].prompt=reset?v.defaults.presets[name]:prompt.trim();},file);
  return {ok:true,name,prompt:v.presets[name].prompt};
}
function migrateBrowser({migrationId,items,presets},file=FILE){
  if(typeof migrationId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(migrationId))throw new Error('Mã chuyển đổi không hợp lệ.');
  return updateCatalog(v=>{
    v.migrations??=[];if(v.migrations.includes(migrationId))return;
    if(items!==null&&items!==undefined&&!Array.isArray(items))throw new Error('Thư viện cũ không hợp lệ.');
    for(const item of items||[]){
      if(!object(item))throw new Error('Prompt cũ không hợp lệ.');
      const current=v.library.find(entry=>entry.id===item.id),original=v.defaults.library.find(entry=>entry.id===item.id);
      const same=(a,b)=>a&&b&&a.text===b.text&&a.name===b.name&&a.slot===b.slot&&a.isDefault===b.isDefault;
      if(same(current,item))continue;
      const conflict=current&&!same(current,original);
      const activeDefault=v.library.find(entry=>entry.slot===item.slot&&entry.isDefault);
      const defaultOriginal=v.defaults.library.find(entry=>entry.slot===item.slot&&entry.isDefault);
      const useDefault=item.isDefault&&!conflict&&(!activeDefault||same(activeDefault,defaultOriginal));
      if(useDefault)for(const entry of v.library)if(entry.slot===item.slot)entry.isDefault=false;
      const copy={...item,id:conflict?`${item.id}-import-${migrationId}`:item.id,builtin:conflict?false:!!original,isDefault:useDefault};
      if(current&&!conflict)Object.assign(current,copy);else v.library.push(copy);
    }
    if(presets!==undefined&&!object(presets))throw new Error('Preset cũ không hợp lệ.');
    for(const [name,prompt] of Object.entries(presets||{})){
      if(!Object.hasOwn(v.presets,name))continue;text(prompt,true);
      if(prompt===v.presets[name].prompt||!prompt.trim())continue;
      v.library.push({id:`preset-${name}-import-${migrationId}`,name:`Preset ${name} (đã nhập)`,slot:'inpaint',text:prompt,isDefault:false,builtin:false});
    }
    v.migrations.push(migrationId);
  },file);
}
module.exports={FILE,validate,readCatalog,updateCatalog,renderTemplate,listModes,saveMode,savePresetPrompt,migrateBrowser,MAX_IMPORT_BYTES,revision,summary,previewImport,importCatalog};
