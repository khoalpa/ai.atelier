(function(global){
  const catalog=global.ATELIER_PROMPTS;
  if(!catalog)throw new Error('Không thể tải thư viện prompt.');
  for(const [id,value] of Object.entries(catalog.ui)){const field=document.getElementById(id);if(field)field.value=value;}
  function applyPlaceholders(){for(const [id,value] of Object.entries(catalog.uiPlaceholders)){const field=document.getElementById(id);if(field)field.placeholder=value;}}
  applyPlaceholders();
  async function save(body,url='/api/prompts'){
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể lưu prompt.');
    if(result.catalog){
      // Existing reset controls retain this array; update it in place on import.
      const defaults=catalog.defaults.library;
      defaults.splice(0,defaults.length,...result.catalog.defaults.library);
      result.catalog.defaults.library=defaults;
      for(const key of Object.keys(catalog))delete catalog[key];
      Object.assign(catalog,result.catalog);
    }
    return result;
  }
  global.AtelierPromptCatalog={
    applyPlaceholders,
    async saveLibrary(items){return (await save({action:'library',items,expectedLibrary:catalog.library})).catalog;},
    renderTransfer(root,onImported){
      const panel=document.createElement('section');panel.className='prompt-editor';
      panel.innerHTML='<div><p class="eyebrow">NHẬP / XUẤT</p><h2>Toàn bộ cấu hình prompt</h2></div><p>Bao gồm prompt, negative prompt, thành phần ghép, template, preset, chế độ xử lý, thư viện, hướng dẫn trợ lý AI và giá trị gốc để khôi phục.</p><label>Phạm vi<select data-transfer-scope><option value="system">Cấu hình prompt hệ thống</option><option value="libraries">Thư viện cá nhân</option><option value="all">Gói đầy đủ</option></select></label><p>Gói cấu hình không kèm ảnh hoặc model.</p><div class="button-row"><button type="button" data-export-prompts>Xuất toàn bộ JSON</button><button type="button" data-choose-prompts>Chọn tệp nhập</button><input type="file" data-import-file accept=".json,application/json" hidden></div><p data-import-summary hidden></p><p data-import-notice hidden>Nhập sẽ thay thế toàn bộ cấu hình đã lưu. Hệ thống tự sao lưu cấu hình hiện tại trước khi áp dụng.</p><div class="button-row" data-import-actions hidden><button type="button" class="primary" data-apply-import disabled>Áp dụng tệp nhập</button><button type="button" data-cancel-import>Hủy nhập</button></div><small data-transfer-status role="status" aria-live="polite"></small>';
      root.prepend(panel);
      const get=selector=>panel.querySelector(selector),file=get('[data-import-file]'),choose=get('[data-choose-prompts]'),exportButton=get('[data-export-prompts]'),apply=get('[data-apply-import]'),cancel=get('[data-cancel-import]'),summary=get('[data-import-summary]'),notice=get('[data-import-notice]'),actions=get('[data-import-actions]'),status=get('[data-transfer-status]');
      const scope=get('[data-transfer-scope]');let pending=null;
      const busy=value=>{scope.disabled=choose.disabled=exportButton.disabled=file.disabled=cancel.disabled=value;apply.disabled=value||!pending;};
      const clear=()=>{pending=null;file.value='';summary.hidden=notice.hidden=actions.hidden=true;apply.disabled=true;};
      choose.addEventListener('click',()=>file.click());
      cancel.addEventListener('click',()=>{clear();status.textContent='Đã hủy nhập. Cấu hình hiện tại được giữ nguyên.';});
      exportButton.addEventListener('click',async()=>{
        busy(true);status.textContent='Đang xuất toàn bộ cấu hình…';
        try{
          const response=await fetch((scope.value||'system')==='system'?'/api/prompts/export':'/api/catalog-package?scope='+encodeURIComponent(scope.value),{cache:'no-store'});
          if(!response.ok)throw new Error((await response.json()).error||'Không thể xuất prompt.');
          const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
          link.href=url;link.download=(scope.value||'system')==='system'?'ai-atelier-prompts.json':'ai-atelier-catalog-package.json';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
          status.textContent='Đã xuất phạm vi đã chọn ra tệp JSON.';
        }catch(error){status.textContent=error.message;}finally{busy(false);}
      });
      file.addEventListener('change',async()=>{
        const selected=file.files[0];clear();if(!selected)return;
        busy(true);status.textContent='Đang kiểm tra tệp nhập…';
        try{
          if(selected.size>4*1024*1024)throw new Error('Tệp nhập tối đa 4 MB; cấu hình hệ thống tối đa 2 MB.');
          let value;try{value=JSON.parse((await selected.text()).replace(/^\uFEFF/,''));}catch{throw new Error('Tệp không phải JSON hợp lệ.');}
          if(value?.format==='ai-atelier-catalog-package'){const result=await save({action:'preview',bundle:value},'/api/catalog-package');pending={bundle:value,revisions:result.revisions};summary.textContent=selected.name+' · '+result.documents.join(', ')+' · '+JSON.stringify(result.counts);summary.hidden=notice.hidden=actions.hidden=false;status.textContent='Gói hợp lệ. Chỉ các phần có trong gói sẽ được thay thế.';return;}
          const result=await save({action:'preview-import',catalog:value});
          pending={catalog:value,revision:result.revision};
          const s=result.summary;
          summary.textContent=`${selected.name} · ${s.library} prompt thư viện · ${s.components} thành phần · ${s.templates} template · ${s.presets} preset · ${s.processingModes} chế độ · ${s.tasks} tác vụ · ${s.promptAssist} hướng dẫn AI · ${s.ui} giá trị giao diện · ${s.uiPlaceholders} gợi ý ô nhập · ${s.runtimePresets} nhóm thông số · ${s.outfitTypes} loại đối tượng · ${s.encoderPolicies||0} cấu hình encoder · bản prompt ${s.qualityRevision||0}`;
          summary.hidden=notice.hidden=actions.hidden=false;status.textContent='Tệp hợp lệ. Sẵn sàng nhập toàn bộ cấu hình.';
        }catch(error){clear();status.textContent=error.message;}finally{busy(false);}
      });
      apply.addEventListener('click',async()=>{
        if(!pending)return;busy(true);status.textContent='Đang sao lưu và nhập cấu hình…';
        try{
          if(pending.bundle)await save({action:'import',bundle:pending.bundle,revisions:pending.revisions},'/api/catalog-package');else await save({action:'import',catalog:pending.catalog,expectedRevision:pending.revision});
          clear();onImported();
          if(typeof global.setMessage==='function')global.setMessage('Đã nhập toàn bộ cấu hình prompt. Bản trước đã được sao lưu.','success');
        }catch(error){status.textContent=error.message;}finally{busy(false);}
      });
    },
    template(key,vars){
      const text=catalog.templates[key];if(typeof text!=='string')throw new Error('Không tìm thấy mẫu prompt: '+key);
      return text.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(_,name)=>{if(!Object.hasOwn(vars,name))throw new Error('Thiếu biến prompt: '+name);return String(vars[name]);});
    }
  };
  async function migrate(){
    const keys=['atelier.promptLibrary.v1','atelier.accessoryPresetPrompts.v1'],old=keys.map(key=>localStorage.getItem(key));
    if(old.every(v=>v===null))return;
    let id=localStorage.getItem('atelier.promptMigrationId');if(!id){id=crypto.randomUUID();localStorage.setItem('atelier.promptMigrationId',id);}
    await save({action:'migrate',migrationId:id,items:old[0]===null?null:JSON.parse(old[0]),presets:old[1]===null?undefined:JSON.parse(old[1])});
    keys.forEach((key,i)=>{if(localStorage.getItem(key)===old[i])localStorage.removeItem(key);});localStorage.removeItem('atelier.promptMigrationId');
    if(typeof global.applyManagedPromptDefaults==='function')global.applyManagedPromptDefaults();
    if(typeof global.renderPromptManager==='function')global.renderPromptManager();
  }
  global.addEventListener('load',()=>{migrate().catch(error=>{if(typeof global.setMessage==='function')global.setMessage('Không thể nhập prompt cũ: '+error.message,'error');});});
})(window);
