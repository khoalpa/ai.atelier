/* Structured prompt builder for the text-to-image workspace. */
window.PromptBuilder=(()=>{
  const $=id=>document.getElementById(id), esc=value=>globalThis.AtelierApp.escapeHtml(String(value??''));
  const presets=new Proxy({}, {get:(_,key)=>($('promptBuilderPresetVersion').value==='quality-v1'?window.ATELIER_PROMPTS.promptQuality.baseline.featurePresets['promptBuilder.presets']:window.ATELIER_PROMPTS.featurePresets['promptBuilder.presets'])[key]});
  const render=(key,vars)=>window.ATELIER_PROMPTS.templates[key].replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(_,key)=>String(vars[key]));
  const fields=['subject','environment','action','composition','style','lighting','color','materials','constraints'];
  const STORAGE_KEY='atelier.prompt-builder.v2';
  let references=[],busy=false,saveTimer=null,lastAssessment=null,previewError='',autoNegative='';
  function values(){return Object.fromEntries(fields.map(key=>[key,$('promptBlock-'+key).value.trim()]));}
  function locks(){return Object.fromEntries(fields.filter(key=>$('promptLock-'+key).checked).map(key=>[key,$('promptBlock-'+key).value]));}
  function adapter(){const id=$('textToImageModel').value,p=globalThis.AtelierPromptCompiler.model(window.ATELIER_PROMPTS,id);return {id,label:p.label,negative:p.supportsNegative};}
  function conflicts(v=values()){return globalThis.AtelierPromptCompiler.compile(window.ATELIER_PROMPTS,{modelId:$('textToImageModel').value,components:v,locked:locks(),negativePrompt:$('chromaNegativePrompt').value}).warnings;}
  function compose(){return globalThis.AtelierPromptCompiler.compile(window.ATELIER_PROMPTS,{modelId:$('textToImageModel').value,components:values(),locked:locks()}).prompt;}
  function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem(STORAGE_KEY,JSON.stringify({values:values(),locks:Object.fromEntries(fields.map(key=>[key,$('promptLock-'+key).checked])),preset:$('promptBuilderPreset').value,presetVersion:$('promptBuilderPresetVersion').value,referenceMode:$('promptReferenceMode').value}));}catch{}},150);}
  function restore(){try{const state=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(!state)return;for(const key of fields){if(typeof state.values?.[key]==='string')$('promptBlock-'+key).value=state.values[key];$('promptLock-'+key).checked=Boolean(state.locks?.[key]);}if(state.preset)$('promptBuilderPreset').value=state.preset;if(['quality-v1','quality-v2'].includes(state.presetVersion))$('promptBuilderPresetVersion').value=state.presetVersion;if(state.referenceMode)$('promptReferenceMode').value=state.referenceMode;}catch{localStorage.removeItem(STORAGE_KEY);}}
  function syncPreview(){
    try{
      const prompt=compose();$('promptBuilderPreview').textContent=prompt||'Điền một hoặc nhiều khối để xem prompt tổng hợp.';
      if(previewError&&$('promptBuilderStatus').textContent===previewError)$('promptBuilderStatus').textContent='';previewError='';
      $('promptBuilderApply').disabled=!prompt;$('promptBuilderVariants').disabled=!prompt||busy;
      const issues=conflicts(),host=$('promptBuilderConflicts');host.hidden=!issues.length;host.innerHTML=issues.length?'<strong>Cần kiểm tra trước khi tạo</strong><ul>'+issues.map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul>':'';
      $('promptBuilderAdapter').textContent=adapter().label;
    }catch(error){previewError=error.message;$('promptBuilderAdapter').textContent='Chờ chọn model T5/Qwen phù hợp';$('promptBuilderStatus').textContent=previewError;$('promptBuilderApply').disabled=true;$('promptBuilderVariants').disabled=true;}
    save();
  }
  function apply(){const prompt=compose();if(!prompt)return;$('chromaPrompt').value=prompt;$('chromaPrompt').dispatchEvent(new Event('input',{bubbles:true}));$('promptBuilderStatus').textContent='Đã đưa prompt có cấu trúc vào ô Mô tả ảnh.';}
  function context(mode='compose'){
    const locked=fields.filter(key=>$('promptLock-'+key).checked).map(key=>`${key}: ${$('promptBlock-'+key).value.trim()}`).filter(value=>!value.endsWith(': '));
    return render('promptBuilder.context',{mode:mode,adapter:adapter().label,fields:JSON.stringify(values()),locked:locked.join(' | ')||'(none)'});
  }
  function fileData(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Không thể đọc ảnh '+file.name));reader.readAsDataURL(file);});}
  function renderReferences(){
    const host=$('promptReferenceList');host.innerHTML=references.map((item,index)=>`<article><img src="${item.data}" alt="Ảnh tham khảo ${index+1}"><div><strong>${esc(item.name)}</strong><select data-reference-role="${index}" aria-label="Vai trò ảnh ${index+1}"><option value="subject" ${item.role==='subject'?'selected':''}>Chủ thể</option><option value="style" ${item.role==='style'?'selected':''}>Phong cách</option><option value="composition" ${item.role==='composition'?'selected':''}>Bố cục</option><option value="color" ${item.role==='color'?'selected':''}>Màu sắc</option><option value="materials" ${item.role==='materials'?'selected':''}>Chất liệu</option></select><button type="button" data-reference-remove="${index}">Bỏ ảnh</button></div></article>`).join('');
    for(const select of host.querySelectorAll('[data-reference-role]'))select.onchange=()=>{references[Number(select.dataset.referenceRole)].role=select.value;};
    for(const button of host.querySelectorAll('[data-reference-remove]'))button.onclick=()=>{references.splice(Number(button.dataset.referenceRemove),1);renderReferences();};
    $('promptBuilderAnalyzeImage').disabled=!references.length;
  }
  function applyComponents(components){if(!components)return false;let changed=false;for(const key of fields)if(!$('promptLock-'+key).checked&&typeof components[key]==='string'&&components[key].trim()){$('promptBlock-'+key).value=components[key].trim();changed=true;}return changed;}
  async function assist(mode='compose'){
    if(busy)return;busy=true;syncPreview();$('promptBuilderStatus').textContent=mode==='image'?'AI đang đọc ảnh tham khảo…':'AI đang xây dựng prompt…';
    try{
      const body={task:'imagePrompt',structured:true,lockedComponents:Object.fromEntries(fields.filter(key=>$('promptLock-'+key).checked).map(key=>[key,$('promptBlock-'+key).value])),currentText:compose()||$('chromaPrompt').value.trim(),context:context(mode),imageModelId:$('textToImageModel').value};
      if(mode==='image'){if(!references.length)throw Error('Hãy chọn ảnh tham khảo trước.');body.imageData=references.map(item=>item.data);body.context+=render('promptBuilder.references',{roles:references.map((item,index)=>`${index+1}=${item.role}`).join(', '),referenceMode:$('promptReferenceMode').value});}
      const response=await fetch('/api/prompt-assist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json().catch(()=>({}));
      if(!response.ok||!result.ok)throw Error(result.error||'Không thể tạo prompt.');
      const structured=applyComponents(result.components);syncPreview();$('chromaPrompt').value=structured?compose():result.suggestion;$('chromaPrompt').dispatchEvent(new Event('input',{bubbles:true}));
      $('promptBuilderStatus').textContent=`Đã tạo prompt bằng ${result.model}${result.usedImage?' từ ảnh tham khảo':''}. Bạn có thể chỉnh sửa trước khi tạo ảnh.`;
    }catch(error){$('promptBuilderStatus').textContent=error.message;globalThis.AtelierApp.setMessage(error.message,'error');}
    finally{busy=false;syncPreview();}
  }
  async function variants(){
    if(busy)return;busy=true;syncPreview();$('promptBuilderStatus').textContent='Đang tạo 3 hướng diễn đạt…';$('promptBuilderVariantList').replaceChildren();
    try{
      const base=compose();
      const results=[];for(const angle of window.ATELIER_PROMPTS.featurePresets['promptBuilder.variants']){
        const response=await fetch('/api/prompt-assist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:'imagePrompt',currentText:base,context:context('variant')+' Variation direction: '+angle,imageModelId:$('textToImageModel').value})});
        const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'Không thể tạo biến thể.');results.push(result.suggestion);
      }
      $('promptBuilderVariantList').innerHTML=results.map((text,index)=>`<button type="button" data-prompt-variant="${index}"><strong>Phương án ${index+1}</strong><span>${esc(text)}</span></button>`).join('');
      for(const button of $('promptBuilderVariantList').querySelectorAll('[data-prompt-variant]'))button.onclick=()=>{$('chromaPrompt').value=results[Number(button.dataset.promptVariant)];$('chromaPrompt').dispatchEvent(new Event('input',{bubbles:true}));$('promptBuilderStatus').textContent='Đã chọn phương án '+(Number(button.dataset.promptVariant)+1)+'.';};
      $('promptBuilderStatus').textContent='Chọn một phương án để đưa vào Mô tả ảnh.';
    }catch(error){$('promptBuilderStatus').textContent=error.message;}
    finally{busy=false;syncPreview();}
  }
  function preset(name){
    const data=presets[name];if(!data)return;
    for(const [key,value] of Object.entries(data))if(!$('promptLock-'+key).checked)$('promptBlock-'+key).value=value;
    const negative=$('chromaNegativePrompt'),defaultNegative=window.ATELIER_PROMPTS.library.find(item=>item.slot==='new-image-negative'&&item.isDefault)?.text;
    if(adapter().negative&&(!negative.value.trim()||negative.value===defaultNegative||(autoNegative&&negative.value===autoNegative))){
      autoNegative=$('promptBuilderPresetVersion').value==='quality-v1'?(defaultNegative||''):window.ATELIER_PROMPTS.featurePresets['promptBuilder.negativePresets']?.[name]||'';negative.value=autoNegative;negative.dispatchEvent(new Event('input',{bubbles:true}));
    }
    syncPreview();
  }
  async function toDataUrl(url){const response=await fetch(url);if(!response.ok)throw Error('Không thể đọc ảnh kết quả.');const blob=await response.blob();return fileData(new File([blob],'result.'+(blob.type.split('/')[1]||'png'),{type:blob.type}));}
  function renderAssessment(item){
    const host=$('promptResultAssessment');if(!host||!lastAssessment)return;const labels={subject:'Chủ thể',environment:'Bối cảnh',action:'Hành động',composition:'Bố cục',style:'Phong cách',lighting:'Ánh sáng',color:'Màu sắc',materials:'Chất liệu',constraints:'Ràng buộc'},status={met:'Đạt',partial:'Đạt một phần',missing:'Chưa đạt'};
    host.hidden=false;host.innerHTML=`<header><strong>Mức khớp prompt · ${lastAssessment.overallScore??'—'}/100</strong><button type="button" data-assessment-close>Đóng</button></header><p>${esc(lastAssessment.summary)}</p><div>${fields.filter(key=>values()[key]).map(key=>{const row=lastAssessment.components[key];return `<article class="assessment-${row.status}"><strong>${labels[key]} · ${status[row.status]}</strong><span>${esc(row.note||'')}</span></article>`;}).join('')}</div><button type="button" class="primary" data-assessment-improve>Cải thiện lượt tiếp theo</button>`;
    host.querySelector('[data-assessment-close]').onclick=()=>{host.hidden=true;};host.querySelector('[data-assessment-improve]').onclick=()=>improveFromAssessment(item);
  }
  async function evaluateResult(item){
    if(busy)return;busy=true;globalThis.AtelierApp.setMessage('AI đang đối chiếu ảnh với Prompt Builder…','success');
    try{const image=await toDataUrl(item.image||globalThis.AtelierApp.outputUrl(item.file)),body={task:'imagePrompt',evaluation:true,currentText:compose(),promptComponents:values(),context:render('promptBuilder.evaluate',{fields:JSON.stringify(values())}),imageModelId:$('textToImageModel').value,imageData:image};const response=await fetch('/api/prompt-assist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();if(!response.ok||!result.ok||!result.assessment)throw Error(result.error||'AI chưa trả về đánh giá có cấu trúc.');lastAssessment=result.assessment;renderAssessment(item);globalThis.AtelierApp.setMessage('Đã đánh giá mức khớp của ảnh theo từng khối.','success');}catch(error){globalThis.AtelierApp.setMessage(error.message,'error');}finally{busy=false;}
  }
  function improveFromAssessment(){if(!lastAssessment)return;let changed=0;for(const key of fields){const item=lastAssessment.components[key];if(!$('promptLock-'+key).checked&&item&&item.status!=='met'&&item.suggestion){$('promptBlock-'+key).value=item.suggestion;changed++;}}syncPreview();apply();$('promptBuilder').open=true;$('promptBuilder').scrollIntoView({behavior:'smooth',block:'center'});globalThis.AtelierApp.setMessage(changed?`Đã cập nhật ${changed} khối chưa đạt; các khối đã khóa hoặc đã đạt được giữ nguyên.`:'Không có khối nào cần cập nhật.','success');}
  function initialize(){
    if(!$('promptBuilder'))return;
    restore();for(const key of fields){$('promptBlock-'+key).addEventListener('input',syncPreview);$('promptLock-'+key).addEventListener('change',syncPreview);}
    $('promptBuilderPresetVersion').onchange=()=>{$('promptBuilderPreset').value?preset($('promptBuilderPreset').value):syncPreview();};$('promptBuilderPreset').onchange=event=>preset(event.target.value);$('promptBuilderApply').onclick=apply;$('promptBuilderAi').onclick=()=>assist('compose');$('promptBuilderAnalyzeImage').onclick=()=>assist('image');$('promptBuilderVariants').onclick=variants;
    $('promptReferenceImage').onchange=async event=>{const files=[...event.target.files].slice(0,4);event.target.value='';if(!files.length)return;if(files.some(file=>!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>20*1024*1024)||files.reduce((sum,file)=>sum+file.size,0)>24*1024*1024)return $('promptBuilderStatus').textContent='Chỉ nhận tối đa 4 ảnh PNG, JPEG hoặc WebP; mỗi ảnh dưới 20 MB và tổng dưới 24 MB.';try{references=await Promise.all(files.map(async(file,index)=>({name:file.name,data:await fileData(file),role:['subject','style','composition','color'][index]||'subject'})));renderReferences();$('promptBuilderStatus').textContent=`${references.length} ảnh đã sẵn sàng; hãy kiểm tra vai trò trước khi phân tích.`;}catch(error){$('promptBuilderStatus').textContent=error.message;}};
    $('promptReferenceMode').addEventListener('change',syncPreview);$('chromaNegativePrompt').addEventListener('input',syncPreview);$('textToImageModel').addEventListener('change',syncPreview);syncPreview();
  }
  initialize();return {compose,values,apply,assist,adapter,conflicts,applyComponents,evaluateResult,improveFromAssessment,refresh:syncPreview};
})();
