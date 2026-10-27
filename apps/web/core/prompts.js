'use strict';
// Owned state: pendingPromptAssist, PRESETS, PROMPT_LIBRARY_KEY, PRESET_PROMPTS_KEY, EDITABLE_PRESET_LABELS, DEFAULT_PROMPT_LIBRARY, PROMPT_SLOT_LABELS, LEGACY_INPAINT_LIBRARY_TEXT
// Dependencies: $, binaryMaskDataUrl, current, escapeHtml, refreshStudioReadiness, setMessage, showStudioResultInstructions, studioResultDrafts, studioResultModes
module.exports=function createPrompts(deps){
let pendingPromptAssist, PRESETS, PROMPT_LIBRARY_KEY, PRESET_PROMPTS_KEY, EDITABLE_PRESET_LABELS, DEFAULT_PROMPT_LIBRARY, PROMPT_SLOT_LABELS, LEGACY_INPAINT_LIBRARY_TEXT;
function promptAssistDiff(original,draft){
  const tokenize=text=>String(text).match(/[\p{L}\p{N}\p{M}_]+|\s+|[^\p{L}\p{N}\p{M}_\s]/gu)||[];
  const a=tokenize(original),b=tokenize(draft),chunks=[];
  const push=(type,text)=>{if(!text)return;const last=chunks.at(-1);if(last?.type===type)last.text+=text;else chunks.push({type,text});};
  let start=0,endA=a.length,endB=b.length;
  while(start<endA&&start<endB&&a[start]===b[start]){push('equal',a[start]);start++;}
  while(endA>start&&endB>start&&a[endA-1]===b[endB-1]){endA--;endB--;}
  const n=endA-start,m=endB-start;
  // Bound memory for unusually large drafts; preserve the common edges.
  if(n*m>1000000){push('remove',a.slice(start,endA).join(''));push('add',b.slice(start,endB).join(''));}
  else{
    const rows=Array.from({length:n+1},()=>new Uint32Array(m+1));
    for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)rows[i][j]=a[start+i]===b[start+j]?1+rows[i+1][j+1]:Math.max(rows[i+1][j],rows[i][j+1]);
    let i=0,j=0;
    while(i<n||j<m){
      if(i<n&&j<m&&a[start+i]===b[start+j]){push('equal',a[start+i]);i++;j++;}
      else if(i<n&&(j===m||rows[i+1][j]>=rows[i][j+1]))push('remove',a[start+i++]);
      else push('add',b[start+j++]);
    }
  }
  push('equal',a.slice(endA).join(''));return chunks;
}

function renderPromptAssistDiff(){
  const chunks=promptAssistDiff(deps.$('promptAssistOriginal').value,deps.$('promptAssistDraft').value);
  const changed=chunks.some(chunk=>chunk.type!=='equal');
  deps.$('promptAssistDiffStatus').textContent=changed?'Phần bị xóa được gạch ngang màu đỏ; phần thêm mới được tô xanh.':'Không có thay đổi: bản đề xuất giống nội dung hiện tại.';
  deps.$('promptAssistDiffColumns').hidden=!changed;
  const html=side=>chunks.filter(chunk=>chunk.type!==(side==='original'?'add':'remove')).map(chunk=>{
    const text=deps.escapeHtml(chunk.text);
    return chunk.type==='equal'?text:chunk.type==='remove'?`<del>${text}</del>`:`<ins>${text}</ins>`;
  }).join('');
  deps.$('promptAssistDiffOriginal').innerHTML=html('original');deps.$('promptAssistDiffDraft').innerHTML=html('draft');
}

function renderPromptAssistFeedback(id,title,items){const element=deps.$(id);element.hidden=!items?.length;if(!items?.length)return;element.innerHTML=`<strong>${deps.escapeHtml(title)}</strong><ul>${items.map((item)=>`<li>${deps.escapeHtml(item)}</li>`).join('')}</ul>`;}

function openPromptAssistPreview({targetId,statusId,title,previous,result,analysisOnly=false}){
  pendingPromptAssist={targetId,statusId,analysisOnly};
  deps.$('promptAssistDialogTitle').textContent=title;deps.$('promptAssistOriginal').value=previous;deps.$('promptAssistDraft').value=result.suggestion||previous;
  renderPromptAssistDiff();
  deps.$('promptAssistDraft').readOnly=analysisOnly;deps.$('applyPromptAssistButton').hidden=analysisOnly;
  deps.$('copyPromptAssistButton').textContent=analysisOnly?'Sao chép nội dung':'Sao chép bản nháp';
  deps.$('promptAssistScore').hidden=result.qualityScore===null||result.qualityScore===undefined;deps.$('promptAssistScore').textContent=`Độ rõ prompt: ${result.qualityScore}/100`;
  renderPromptAssistFeedback('promptAssistChanges','AI đã cải thiện',result.changes);renderPromptAssistFeedback('promptAssistWarnings','Cần lưu ý',result.warnings);
  deps.$('promptAssistDialog').showModal();
}

async function requestPromptSuggestion({task,targetId,buttonId,statusId,includeImage=false,includeMask=false,context='',title='Bản nháp AI'}) {
  const target=deps.$(targetId),button=deps.$(buttonId),status=deps.$(statusId),previous=target.value;
  const originalLabel=button.textContent;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Đang phân tích…';
  status.parentElement.classList.remove('is-success','is-error');status.textContent='LLM đang chuẩn bị bản nháp để bạn xem trước…';
  try {
    const payload={task,currentText:previous,context};
    if(['chromaPrompt','chromaNegativePrompt'].includes(targetId))payload.imageModelId=deps.$('textToImageModel').value;
    if(includeImage&&deps.current)payload.sampleId=deps.current.id;if(includeMask&&deps.current)payload.mask=deps.binaryMaskDataUrl(false);
    const response=await fetch('/api/prompt-assist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const result=await response.json().catch(()=>({}));if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tạo gợi ý');
    openPromptAssistPreview({targetId,statusId,title,previous,result,analysisOnly:task==='analyzePrompt'});
    status.textContent=`Đã tạo bản nháp bằng ${result.model}. Chỉ áp dụng khi bạn xác nhận.`;status.parentElement.classList.add('is-success');
  } catch(error) {status.textContent=error.message;status.parentElement.classList.add('is-error');deps.setMessage(error.message,'error');}
  finally {button.disabled=false;button.removeAttribute('aria-busy');button.textContent=originalLabel;}
}

function runPromptAssist(options){return requestPromptSuggestion(options);}

function applyPreset(name) {
  const p = PRESETS[name];
  if(p){
    deps.$('inpaintPrompt').value=readEditablePresetPrompt(name); deps.$('maskExpand').value=p.expand; deps.$('maskBlur').value=p.blur;
    deps.$('inpaintSteps').value=p.steps; deps.$('inpaintStrength').value=p.strength;
    deps.$('inpaintGuidance').value=p.guidance; deps.$('cropPadding').value=p.crop;
    if(p.resolution)deps.$('inpaintResolution').value=p.resolution;
  } else if(name==='custom') {
    deps.$('inpaintPrompt').value='';
  }

  const garment=['outfit','sleepwear','underwear','shirt','pants'].includes(name);
  deps.$('inpaintFillMode').disabled=!garment;
  if(!garment)deps.$('inpaintFillMode').value='background';
  else if(deps.$('inpaintFillMode').value==='background')deps.$('inpaintFillMode').value='reconstruct_body';
  deps.$('inpaintFillModeHint').textContent=garment?'Phục hồi tay, vai hoặc chân; giữ vùng nhạy cảm được che bằng trang phục kín.':'Vật thể nhỏ sẽ được thay bằng nền hoặc chi tiết xung quanh.';
  if(typeof deps.showStudioResultInstructions==='function')deps.showStudioResultInstructions();
  if(typeof applyInpaintModelSettings==='function')applyInpaintModelSettings(true);
}

function readEditablePresetOverrides(){return {};}

function readEditablePresetPrompt(name){
  const saved=Object.hasOwn(EDITABLE_PRESET_LABELS,name)?readEditablePresetOverrides()[name]:null;
  return typeof saved==='string'&&(saved.trim()||PRESETS[name]?.prompt==='')?saved:PRESETS[name]?.prompt||'';
}

function renderPresetPromptEditor(root){
  const panel=document.createElement('section');
  panel.className='prompt-editor';
  panel.innerHTML=`<div><p class="eyebrow">ĐỐI TƯỢNG CẦN XÓA</p><h2>Mô tả yêu cầu xóa</h2></div><p>Xác định đối tượng và phạm vi cần xóa cho từng Preset trong Studio.</p><label>Preset<select id="presetPromptName">${Object.entries(EDITABLE_PRESET_LABELS).filter(([value])=>["outfit","sleepwear","underwear","shirt","pants","glasses","hat","jewelry","bag","shoes","mannequin"].includes(value)).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><label>Mô tả yêu cầu xóa<textarea id="presetPromptText" rows="6"></textarea></label><div class="prompt-editor-actions"><button id="presetPromptSave" class="primary">Lưu preset</button><button id="presetPromptReset">Khôi phục preset gốc</button></div><small id="presetPromptStatus" role="status"></small>`;
  root.appendChild(panel);
  const select=panel.querySelector('#presetPromptName'),text=panel.querySelector('#presetPromptText'),status=panel.querySelector('#presetPromptStatus');
  const load=()=>{text.value=readEditablePresetPrompt(select.value);status.textContent='';};
  select.addEventListener('change',()=>{
    const previous=select.dataset.loaded;
    if(previous&&text.value!==readEditablePresetPrompt(previous)&&!window.confirm('Nội dung chưa lưu. Chuyển sang preset khác?')){select.value=previous;return;}
    load();select.dataset.loaded=select.value;
  });
  const persist=async(reset)=>{
    const name=select.value,value=text.value.trim();
    if(!reset&&!value&&!['sleepwear','underwear','mannequin'].includes(name)){status.textContent='Hãy nhập nội dung prompt.';return;}
    const save=panel.querySelector('#presetPromptSave'),restore=panel.querySelector('#presetPromptReset');
    save.disabled=restore.disabled=select.disabled=text.disabled=true;
    status.textContent='Đang lưu prompt…';
    try{
      const response=await fetch('/api/preset-prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,prompt:value,reset})});
      const result=await response.json();
      if(!response.ok||!result.ok)throw new Error(result.error||'Không thể lưu preset.');
      PRESETS[name].prompt=result.prompt;
      window.ATELIER_PROMPTS.presets[name].prompt=result.prompt;
      text.value=result.prompt;
      status.textContent=reset?'Đã khôi phục prompt gốc.':'Đã lưu prompt. Chọn lại preset trong Studio để áp dụng.';
    }catch(error){status.textContent=error.message;}
    finally{save.disabled=restore.disabled=select.disabled=text.disabled=false;}
  };
  panel.querySelector('#presetPromptSave').addEventListener('click',()=>persist(false));
  panel.querySelector('#presetPromptReset').addEventListener('click',()=>persist(true));
  load();select.dataset.loaded=select.value;
}

async function renderProcessingModeEditor(root){
  const panel=document.createElement('section');panel.className='prompt-editor';
  panel.innerHTML=`<div><p class="eyebrow">KẾT QUẢ SAU KHI XÓA</p><h2>Hướng dẫn phần thay thế</h2></div><p>Xác định phần thay thế sau khi xóa. Nội dung được dùng chung với Studio.</p><label>Kết quả sau khi xóa<select data-mode-select disabled></select></label>
  <label>Hướng dẫn cho kết quả đã chọn<textarea data-mode-text rows="6" maxlength="16000" disabled></textarea></label><div class="prompt-editor-actions"><button data-mode-save class="primary" disabled>Lưu hướng dẫn</button><button data-mode-reset disabled>Khôi phục nội dung gốc</button></div><small data-mode-status role="status">Đang tải kết quả sau khi xóa…</small>`;
  root.appendChild(panel);
  const select=panel.querySelector('[data-mode-select]'),text=panel.querySelector('[data-mode-text]'),save=panel.querySelector('[data-mode-save]'),reset=panel.querySelector('[data-mode-reset]'),status=panel.querySelector('[data-mode-status]');
  let modes=[],loaded='';
  const busy=(value)=>{select.disabled=text.disabled=save.disabled=reset.disabled=value;};
  const load=()=>{loaded=select.value;text.value=modes.find(mode=>mode.id===loaded)?.prompt||'';};
  select.addEventListener('change',()=>{
    if(text.value!==modes.find(mode=>mode.id===loaded)?.prompt&&!window.confirm('Nội dung chưa lưu. Chọn kết quả sau khi xóa khác?')){select.value=loaded;return;}
    load();status.textContent='';
  });
  const persist=async(restore)=>{
    if(!restore&&!text.value.trim()){status.textContent='Hãy nhập nội dung hướng dẫn.';return;}
    busy(true);status.textContent='Đang lưu hướng dẫn kết quả sau khi xóa…';
    try{
      const response=await fetch('/api/processing-modes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:select.value,prompt:text.value,reset:restore})});
      const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể lưu hướng dẫn kết quả sau khi xóa.');
      modes=result.modes;deps.studioResultModes=result.modes;deps.studioResultDrafts.delete(select.value);deps.showStudioResultInstructions();load();status.textContent=restore?'Đã khôi phục nội dung gốc.':'Đã lưu. Nội dung được áp dụng từ lần tạo ảnh tiếp theo.';
    }catch(error){status.textContent=error.message;}finally{busy(false);}
  };
  save.addEventListener('click',()=>persist(false));reset.addEventListener('click',()=>persist(true));
  try{
    const response=await fetch('/api/processing-modes');const result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tải kết quả sau khi xóa.');
    modes=result.modes;select.innerHTML=modes.map(mode=>`<option value="${deps.escapeHtml(mode.id)}">${deps.escapeHtml(mode.label)}</option>`).join('');
    load();busy(false);status.textContent='';
  }catch(error){status.textContent=error.message;}
}

function readPromptLibrary(){return structuredClone(window.ATELIER_PROMPTS.library);}

async function writePromptLibrary(items){await window.AtelierPromptCatalog.saveLibrary(items);}

function applyManagedPromptDefaults(){const items=readPromptLibrary(),mapping={'new-image':'chromaPrompt','new-image-negative':'chromaNegativePrompt','inpaint':'inpaintPrompt','inpaint-negative':'inpaintNegativePrompt'};for(const [slot,id] of Object.entries(mapping)){const item=items.find((entry)=>entry.slot===slot&&entry.isDefault);if(item&&deps.$(id))deps.$(id).value=item.text;}deps.refreshStudioReadiness();}

function renderPromptManager(){
  const root=deps.$('promptManager');if(!root)return;const items=readPromptLibrary(),defaults=items.filter((item)=>item.isDefault).length,positive=items.filter((item)=>!item.slot.endsWith('-negative')).length;
  root.innerHTML=`<section class="prompt-summary"><article><span>TỔNG SỐ</span><strong>${items.length}</strong><small>prompt đã lưu</small></article><article><span>PROMPT</span><strong>${positive}</strong><small>mô tả tạo ảnh và chỉnh sửa</small></article><article><span>NEGATIVE</span><strong>${items.length-positive}</strong><small>nội dung cần tránh</small></article><article><span>MẶC ĐỊNH</span><strong>${defaults}</strong><small>đang áp dụng trong Studio</small></article></section><div class="prompt-manager-layout"><section class="prompt-editor"><div><p class="eyebrow">CHỈNH SỬA</p><h2 id="promptEditorTitle">Thêm prompt</h2></div><input id="promptEditId" type="hidden"><label>Tên prompt<input id="promptName" placeholder="${deps.escapeHtml(window.ATELIER_PROMPTS.uiPlaceholders.promptName)}"></label><label>Phạm vi<select id="promptSlot">${Object.entries(PROMPT_SLOT_LABELS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><label>Nội dung<textarea id="promptText" rows="8" placeholder="${deps.escapeHtml(window.ATELIER_PROMPTS.uiPlaceholders.promptText)}"></textarea></label><div class="prompt-editor-actions"><button id="promptSave" class="primary">Lưu prompt</button><button id="promptCancel">Làm trống</button></div><button id="promptResetDefaults" class="prompt-reset">Khôi phục thư viện ban đầu</button></section><section><div class="prompt-list-heading"><div><p class="eyebrow">THƯ VIỆN</p><h2>Prompt đã lưu</h2></div><select id="promptFilter" aria-label="Lọc prompt"><option value="all">Tất cả</option>${Object.entries(PROMPT_SLOT_LABELS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></div><div id="promptList" class="prompt-list"></div></section></div>`;
  const taskEditors=document.createElement('div');taskEditors.className='prompt-task-editors';
  window.AtelierPromptCatalog.renderTransfer(root,()=>{
    deps.studioResultModes=Object.entries(window.ATELIER_PROMPTS.processingModes).map(([id,mode])=>({id,...mode}));
    deps.studioResultDrafts.clear();
    for(const [id,value] of Object.entries(window.ATELIER_PROMPTS.ui)){const field=deps.$(id);if(field)field.value=value;}
    window.AtelierPromptCatalog.applyPlaceholders();deps.showStudioResultInstructions();applyManagedPromptDefaults();renderPromptManager();
  });
  root.querySelector('.prompt-manager-layout').before(taskEditors);
  const jsonConfigButton=document.createElement('button');jsonConfigButton.type='button';jsonConfigButton.className='json-editor-open expert-only';jsonConfigButton.dataset.jsonConfigOpen='prompts';jsonConfigButton.textContent='Chỉnh sửa đầy đủ JSON · tất cả nhóm cấu hình';root.prepend(jsonConfigButton);
  renderPresetPromptEditor(taskEditors);
  renderProcessingModeEditor(taskEditors);
  const renderList=()=>{const filter=deps.$('promptFilter').value,list=items.filter((item)=>filter==='all'||item.slot===filter);deps.$('promptList').innerHTML=list.map((item)=>`<article class="prompt-card ${item.isDefault?'is-default':''}" data-prompt-id="${deps.escapeHtml(item.id)}"><div class="prompt-card-head"><div><span>${deps.escapeHtml(PROMPT_SLOT_LABELS[item.slot]||item.slot)}</span><strong>${deps.escapeHtml(item.name)}</strong></div>${item.isDefault?'<em>Mặc định</em>':''}</div><p>${deps.escapeHtml(item.text)}</p><div class="prompt-card-actions"><button data-prompt-edit>Chỉnh sửa</button><button data-prompt-default ${item.isDefault?'disabled':''}>Đặt mặc định</button><button data-prompt-copy>Nhân bản</button><button data-prompt-delete ${item.builtin?'disabled title="Prompt tích hợp không thể xóa"':''}>Xóa</button></div></article>`).join('')||'<div class="library-empty"><div><strong>Chưa có prompt</strong><p>Thêm prompt đầu tiên cho phạm vi này.</p></div></div>';};
  const clearEditor=()=>{deps.$('promptEditId').value='';deps.$('promptName').value='';deps.$('promptText').value='';deps.$('promptEditorTitle').textContent='Thêm prompt';};renderList();
  deps.$('promptFilter').addEventListener('change',renderList);deps.$('promptCancel').addEventListener('click',clearEditor);
  deps.$('promptSave').addEventListener('click',async()=>{try{const name=deps.$('promptName').value.trim(),text=deps.$('promptText').value.trim(),slot=deps.$('promptSlot').value,id=deps.$('promptEditId').value;if(!name||!text)return deps.setMessage('Hãy nhập tên và nội dung prompt.','error');if(id){const item=items.find((entry)=>entry.id===id);if(item)Object.assign(item,{name,text,slot});}else items.push({id:`prompt-${Date.now()}`,name,text,slot,isDefault:false,builtin:false});await writePromptLibrary(items);applyManagedPromptDefaults();renderPromptManager();deps.setMessage('Đã lưu prompt.','success');}catch(error){deps.setMessage(error.message,'error');renderPromptManager();}});
  deps.$('promptResetDefaults').addEventListener('click',async()=>{try{await writePromptLibrary(DEFAULT_PROMPT_LIBRARY.map((item)=>({...item})));applyManagedPromptDefaults();renderPromptManager();deps.setMessage('Đã khôi phục thư viện prompt ban đầu.','success');}catch(error){deps.setMessage(error.message,'error');renderPromptManager();}});
  deps.$('promptList').addEventListener('click',async(event)=>{try{const card=event.target.closest('[data-prompt-id]'),item=items.find((entry)=>entry.id===card?.dataset.promptId);if(!item)return;if(event.target.closest('[data-prompt-edit]')){deps.$('promptEditId').value=item.id;deps.$('promptName').value=item.name;deps.$('promptSlot').value=item.slot;deps.$('promptText').value=item.text;deps.$('promptEditorTitle').textContent='Chỉnh sửa prompt';deps.$('promptName').focus();}else if(event.target.closest('[data-prompt-default]')){for(const entry of items)if(entry.slot===item.slot)entry.isDefault=false;item.isDefault=true;await writePromptLibrary(items);applyManagedPromptDefaults();renderPromptManager();}else if(event.target.closest('[data-prompt-copy]')){items.push({...item,id:`prompt-${Date.now()}`,name:`${item.name} · bản sao`,isDefault:false,builtin:false});await writePromptLibrary(items);renderPromptManager();}else if(event.target.closest('[data-prompt-delete]')&&!item.builtin){const index=items.indexOf(item);items.splice(index,1);if(item.isDefault){const fallback=items.find((entry)=>entry.slot===item.slot);if(fallback)fallback.isDefault=true;}await writePromptLibrary(items);applyManagedPromptDefaults();renderPromptManager();}}catch(error){deps.setMessage(error.message,'error');renderPromptManager();}});
}
return {bindings:{get pendingPromptAssist(){return pendingPromptAssist;},set pendingPromptAssist(value){pendingPromptAssist=value;},
get promptAssistDiff(){return promptAssistDiff;},set promptAssistDiff(value){promptAssistDiff=value;},
get renderPromptAssistDiff(){return renderPromptAssistDiff;},set renderPromptAssistDiff(value){renderPromptAssistDiff=value;},
get renderPromptAssistFeedback(){return renderPromptAssistFeedback;},set renderPromptAssistFeedback(value){renderPromptAssistFeedback=value;},
get openPromptAssistPreview(){return openPromptAssistPreview;},set openPromptAssistPreview(value){openPromptAssistPreview=value;},
get requestPromptSuggestion(){return requestPromptSuggestion;},set requestPromptSuggestion(value){requestPromptSuggestion=value;},
get runPromptAssist(){return runPromptAssist;},set runPromptAssist(value){runPromptAssist=value;},
get PRESETS(){return PRESETS;},set PRESETS(value){PRESETS=value;},
get applyPreset(){return applyPreset;},set applyPreset(value){applyPreset=value;},
get PROMPT_LIBRARY_KEY(){return PROMPT_LIBRARY_KEY;},set PROMPT_LIBRARY_KEY(value){PROMPT_LIBRARY_KEY=value;},
get PRESET_PROMPTS_KEY(){return PRESET_PROMPTS_KEY;},set PRESET_PROMPTS_KEY(value){PRESET_PROMPTS_KEY=value;},
get EDITABLE_PRESET_LABELS(){return EDITABLE_PRESET_LABELS;},set EDITABLE_PRESET_LABELS(value){EDITABLE_PRESET_LABELS=value;},
get readEditablePresetOverrides(){return readEditablePresetOverrides;},set readEditablePresetOverrides(value){readEditablePresetOverrides=value;},
get readEditablePresetPrompt(){return readEditablePresetPrompt;},set readEditablePresetPrompt(value){readEditablePresetPrompt=value;},
get renderPresetPromptEditor(){return renderPresetPromptEditor;},set renderPresetPromptEditor(value){renderPresetPromptEditor=value;},
get renderProcessingModeEditor(){return renderProcessingModeEditor;},set renderProcessingModeEditor(value){renderProcessingModeEditor=value;},
get DEFAULT_PROMPT_LIBRARY(){return DEFAULT_PROMPT_LIBRARY;},set DEFAULT_PROMPT_LIBRARY(value){DEFAULT_PROMPT_LIBRARY=value;},
get PROMPT_SLOT_LABELS(){return PROMPT_SLOT_LABELS;},set PROMPT_SLOT_LABELS(value){PROMPT_SLOT_LABELS=value;},
get LEGACY_INPAINT_LIBRARY_TEXT(){return LEGACY_INPAINT_LIBRARY_TEXT;},set LEGACY_INPAINT_LIBRARY_TEXT(value){LEGACY_INPAINT_LIBRARY_TEXT=value;},
get readPromptLibrary(){return readPromptLibrary;},set readPromptLibrary(value){readPromptLibrary=value;},
get writePromptLibrary(){return writePromptLibrary;},set writePromptLibrary(value){writePromptLibrary=value;},
get applyManagedPromptDefaults(){return applyManagedPromptDefaults;},set applyManagedPromptDefaults(value){applyManagedPromptDefaults=value;},
get renderPromptManager(){return renderPromptManager;},set renderPromptManager(value){renderPromptManager=value;}},steps:[
function initialize(){
(pendingPromptAssist = null);
},
function initialize(){
(PRESETS = new Proxy({}, {get:(_,name)=>window.ATELIER_PROMPTS.presets[name]}));
},
function initialize(){
(PROMPT_LIBRARY_KEY = 'atelier.promptLibrary.v1');
},
function initialize(){
(PRESET_PROMPTS_KEY = 'atelier.accessoryPresetPrompts.v1');
},
function initialize(){
(EDITABLE_PRESET_LABELS = {outfit:'Trang phục',shirt:'Áo / phần trên',pants:'Quần / váy',glasses:'Kính',hat:'Mũ',jewelry:'Trang sức',bag:'Túi',shoes:'Giày dép'});
},
function initialize(){
(DEFAULT_PROMPT_LIBRARY = window.ATELIER_PROMPTS.defaults.library);
},
function initialize(){
(PROMPT_SLOT_LABELS = {'new-image':'Prompt · Ảnh mới','new-image-negative':'Negative prompt · Ảnh mới','inpaint':'Prompt · Mô tả yêu cầu xóa','inpaint-negative':'Negative prompt · Điều cần tránh dùng chung'});
},
function initialize(){
(LEGACY_INPAINT_LIBRARY_TEXT = window.ATELIER_PROMPTS.legacyLibrary);
}
]};
};
