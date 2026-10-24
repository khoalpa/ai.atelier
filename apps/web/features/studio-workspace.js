/* Workspace presentation: no generation requests or image data are stored here. */
(function(global){
  'use strict';
  const byId=id=>document.getElementById(id);
  const names={journey:'Công cụ',settings:'Thiết lập',results:'Kết quả',options:'Phương án',actions:'Thao tác'};
  const panels={};
  let state={};
  function save(){try{localStorage.setItem('studioPanelLayout',JSON.stringify(state));}catch{}}
  function labelToggle(button,label){
    button.setAttribute('aria-label',label);button.title=label;
    if(!button.dataset.layoutIcon)button.textContent=label;
  }
  function setPanel(name,collapsed){
    const panel=panels[name];if(!panel)return;
    state[name]=Boolean(collapsed);panel.classList.toggle('panel-collapsed',state[name]);
    document.getElementById('appMain').classList.toggle(`collapse-${name}`,state[name]);
    document.querySelectorAll(`[data-panel-toggle="${name}"]`).forEach(button=>{
      button.setAttribute('aria-expanded',String(!state[name]));
      labelToggle(button,`${state[name]?'Mở':'Thu'} ${names[name]}`);
    });
    save();
  }
  function reveal(node){
    if(!node)return;
    for(const [name,panel] of Object.entries(panels))if(panel.contains(node))setPanel(name,false);
    for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS'&&!(node.tagName==='SUMMARY'&&parent===node.parentElement))parent.open=true;
  }
  function togglePanel(name){
    if(name==='results'&&panels.results.hidden){
      if(!byId('studioResultsFilmstrip').children.length){byId('studioCommandHint').textContent='Chưa có kết quả. Tạo ảnh để xem các phương án.';return;}
      panels.results.hidden=false;
      if(byId('studioCompareAfter').getAttribute('src'))byId('studioCompareStage').hidden=false;
      setPanel(name,false);return;
    }
    setPanel(name,!state[name]);
  }
  function syncJourney(){
    const task=document.body.dataset.studioTask,description=byId('tryonInputMode').value==='description';
    const steps=task==='character'?[['Ảnh nguồn','Chọn ảnh nhân vật','imageSelect'],['Nhân vật','Chọn người cần thay đổi','characterDetect'],['Tư thế & biểu cảm','Kiểm tra vùng tác động','characterPreview']]:task==='makeup'?[['Ảnh nguồn','Chọn ảnh nhân vật','imageSelect'],['Khuôn mặt','Chọn người cần trang điểm','makeupDetect'],['Phong cách','Chọn kiểu hoặc nhập mô tả','makeupStyle']]:task==='enhance'?
      [['Ảnh nguồn','Chọn hoặc tải ảnh','imageSelect'],['Cải thiện','Chọn mức độ và phạm vi','enhanceMethod'],['Xem thử','Kiểm tra chi tiết','enhancePreview']]:task==='outpaint'?
      [['Ảnh nguồn','Chọn hoặc tải ảnh','imageSelect'],['Khung mở rộng','Chọn tỷ lệ và vị trí','outpaintWidth'],['Mô tả','Nội dung phần mở rộng','outpaintPrompt']]:task==='chroma'?
      [['Ý tưởng','Mô tả ảnh muốn tạo','chromaPrompt'],['Chất lượng','Chọn mức chi tiết','textToImagePreset'],['Tạo và so sánh','Sinh phương án','studioPrimaryAction']]:
      [['Ảnh nguồn','Chọn hoặc tải ảnh','imageSelect'],['Chọn vùng','Vẽ hoặc dùng AI','addTool'],task==='inpaint'?['Yêu cầu','Mô tả kết quả mong muốn','inpaintPrompt']:description?['Mô tả','Trang phục hoặc phụ kiện mới','tryonDescription']:['Tham chiếu','Thêm ảnh trang phục','garmentFile']];
    document.querySelectorAll('.journey-steps li').forEach((step,index)=>{
      step.hidden=task==='chroma'&&index===3;
      if(index<3){step.dataset.stepTarget=steps[index][2];step.querySelector('strong').textContent=steps[index][0];step.querySelector('small').textContent=steps[index][1];}
      if(task==='chroma')step.classList.toggle('complete',index===0?Boolean(byId('chromaPrompt').value.trim()):index===1?Boolean(byId('textToImageModel').value):Boolean(byId('studioCompareAfter').getAttribute('src')));
    });
    document.querySelectorAll('[data-studio-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.studioMode===task)));
    const count=task==='character'?byId('characterCount').value:task==='makeup'?2:task==='enhance'?1:byId(task==='outpaint'?'outpaintCount':task==='inpaint'?'inpaintCount':task==='chroma'?'chromaCount':'tryonCount')?.value;
    const hint=byId('studioCommandHint');
    if(hint&&!globalThis.AtelierApp.activeJobId)hint.textContent=hint.textContent.replace(/ · \d+ phương án$/,'')+` · ${count||1} phương án`;
  }
  function setup(){
    try{const saved=JSON.parse(localStorage.getItem('studioPanelLayout')||'{}');state=saved&&typeof saved==='object'&&!Array.isArray(saved)?saved:{};}catch{state={};}
    panels.journey=document.querySelector('.journey-panel');panels.settings=document.querySelector('.settings-panel');panels.results=byId('studioResultsTray');
    if(panels.results.hidden)state.results=true;
    panels.journey.id='studioToolsPanel';panels.settings.id='studioSettingsPanel';
    const workspace=document.querySelector('.workspace'),bar=document.createElement('div');bar.className='workspace-layout-controls';bar.setAttribute('role','group');bar.setAttribute('aria-label','Bố cục vùng làm việc');
    workspace.prepend(bar);
    const layoutIcons={
      journey:'<path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18a2.1 2.1 0 0 0 3 3l5.3-5.3a5 5 0 0 0 6.4-6.4l-3.2 3.2-3-3Z"/>',
      settings:'<path d="M4 7h7m4 0h5M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
      results:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>',
      all:'<path class="layout-collapse-icon" d="M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5"/><path class="layout-expand-icon" d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>'
    };
    const addLayoutIcon=(button,name)=>{button.dataset.layoutIcon=name;button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${layoutIcons[name]}</svg>`;};
    for(const name of Object.keys(panels)){
      const button=document.createElement('button');button.type='button';button.dataset.panelToggle=name;button.setAttribute('aria-controls',panels[name].id);
      button.onclick=()=>togglePanel(name);bar.append(button);
      const heading=panels[name].querySelector(name==='journey'?'.journey-heading':name==='settings'?'.panel-heading':'.studio-results-head');
      const local=button.cloneNode();local.onclick=button.onclick;heading.append(local);
      addLayoutIcon(button,name);
      setPanel(name,state[name]);
    }
    for(const [name,selector] of [['options','.studio-results-options'],['actions','.studio-result-actions']]){
      const panel=document.querySelector(selector);panels[name]=panel;panel.id=`studioResult${name}`;
      const button=document.createElement('button');button.type='button';button.dataset.panelToggle=name;button.setAttribute('aria-controls',panel.id);
      button.onclick=()=>setPanel(name,!state[name]);panel.prepend(button);setPanel(name,state[name]);
    }
    const all=document.createElement('button');all.type='button';addLayoutIcon(all,'all');all.setAttribute('aria-controls',Object.values(panels).map(panel=>panel.id).join(' '));all.onclick=()=>{
      const collapse=!Object.keys(panels).every(name=>state[name]);
      Object.keys(panels).forEach(name=>setPanel(name,collapse));
      document.querySelectorAll('#appMain details').forEach(detail=>{detail.open=!collapse;});
      globalThis.AtelierApp.setStudioCommandCollapsed(collapse);globalThis.AtelierApp.studioCommandManuallyCollapsed=collapse;
      if(byId('activityCenter')&&!byId('activityCenter').hidden&&byId('activityCenter').classList.contains('is-collapsed')!==collapse)byId('activityCollapse').click();
    };bar.append(all);
    const updateAll=()=>{const collapsed=Object.keys(panels).every(name=>state[name]);all.setAttribute('aria-expanded',String(!collapsed));labelToggle(all,collapsed?'Mở tất cả':'Thu tất cả');};
    new MutationObserver(updateAll).observe(byId('appMain'),{attributes:true,attributeFilter:['class']});updateAll();
    const switcher=document.querySelector('.studio-mode-card'),header=document.createElement('div');header.className='workspace-compact-header';
    workspace.prepend(header);header.append(switcher,bar);
    const progressDock=document.createElement('div');progressDock.className='workspace-progress-dock';
    byId('canvasWrap').after(progressDock);progressDock.append(byId('editorLiveProgress'),byId('chromaLiveProgress'));
    const statusDetails=document.createElement('button');statusDetails.type='button';statusDetails.className='studio-status-details';statusDetails.textContent='Chi tiết';statusDetails.setAttribute('aria-expanded','false');progressDock.id='studioProgressDetails';statusDetails.setAttribute('aria-controls',progressDock.id);
    byId('studioCommandBar').insertBefore(statusDetails,byId('studioCommandBar').querySelector('.studio-command-actions'));
    statusDetails.onclick=()=>{const open=progressDock.classList.toggle('is-open');statusDetails.setAttribute('aria-expanded',String(open));statusDetails.textContent=open?'Ẩn chi tiết':'Chi tiết';};
    const syncStatusDetails=()=>{const available=Boolean(progressDock.querySelector('.generation-live:not([hidden])'));statusDetails.hidden=!available;if(!available){progressDock.classList.remove('is-open');statusDetails.setAttribute('aria-expanded','false');statusDetails.textContent='Chi tiết';}};
    new MutationObserver(syncStatusDetails).observe(progressDock,{subtree:true,attributes:true,attributeFilter:['hidden']});syncStatusDetails();
    const tools=document.createElement('details');tools.className='canvas-tools';tools.open=true;tools.innerHTML='<summary>Công cụ chỉnh vùng</summary><div class="canvas-tools-content"></div>';
    byId('canvasWrap').before(tools);
    const content=tools.querySelector('div');
    for(const node of [byId('addTool').closest('.tool-group'),byId('brushSize').closest('label'),byId('undoButton').closest('.button-row')])content.append(node);
    byId('clearButton').textContent='Xóa vùng đã chọn';byId('aiTool').textContent='Chọn vùng bằng AI';byId('saveButton').textContent='Lưu vùng đã chọn';
    document.querySelector('.mask-action-heading strong').textContent='Lưu vùng chỉnh sửa';
    const advanced=document.createElement('details');advanced.className='advanced-panel';advanced.innerHTML='<summary>Thiết lập nâng cao</summary>';byId('outpaintRun').before(advanced);
    const advancedIds=['outpaintModel','outpaintNegative','outpaintOverlap','outpaintSeed','outpaintSteps','outpaintGuidance','outpaintResolution','outpaintSeamWidth','outpaintSeamSteps'];
    for(const id of advancedIds){const label=byId(id)?.closest('label');if(label)advanced.append(label);}
    // Advanced settings remain discoverable in simple mode, behind an explicit disclosure.
    document.querySelectorAll('.advanced-panel').forEach(node=>node.classList.remove('expert-only'));
    byId('inpaintNegativePrompt').closest('label').parentElement.classList.add('expert-only');
    byId('inpaintFillModePrompt').closest('.studio-result-instructions').classList.add('expert-only');
    byId('tryonDescriptionNegative').closest('label').classList.add('expert-only');
    byId('emptyCanvasState').innerHTML='<strong>Thêm ảnh để bắt đầu</strong><p>Kéo ảnh vào vùng này hoặc chọn ảnh trên máy.</p><button type="button">Chọn ảnh nguồn</button>';
    byId('emptyCanvasState').querySelector('button').onclick=()=>byId('sourceImageFile').click();
    byId('canvasWrap').addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();});
    byId('canvasWrap').addEventListener('drop',event=>{if(!event.dataTransfer.files.length)return;event.preventDefault();globalThis.AtelierApp.uploadSourceImage(event.dataTransfer.files[0]).catch(error=>globalThis.AtelierApp.setMessage(error.message,'error'));});
    document.addEventListener('focusin',event=>{if(!event.target.closest('[data-panel-toggle]'))reveal(event.target);});
    document.addEventListener('click',event=>{
      const step=event.target.closest('[data-step-target]');if(step)reveal(byId(step.dataset.stepTarget));
      if(event.target.closest('#studioPrimaryAction,#studioNextAction')){
        const command=byId('studioPrimaryAction').dataset.command;
        if(['prompt','frame'].includes(command))reveal(byId(command==='frame'?'outpaintWidth':document.body.dataset.studioTask==='chroma'?'chromaPrompt':'tryonDescription'));
        if(command==='mask')tools.open=true;
      }
    },true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]'))Object.keys(panels).forEach(name=>setPanel(name,false));});
    for(const id of ['qualityPreset','inpaintQualityPreset','outpaintCount','tryonCount','inpaintCount','chromaCount'])byId(id)?.addEventListener('change',()=>globalThis.AtelierApp.refreshStudioReadiness());
    const observer=new ResizeObserver(()=>{
      const top=header.offsetHeight+workspace.querySelector('.canvas-toolbar').offsetHeight+tools.offsetHeight;
      workspace.style.setProperty('--studio-results-top',`${top}px`);
      if(typeof globalThis.AtelierApp.fitCanvas==='function')globalThis.AtelierApp.fitCanvas();
    });observer.observe(byId('canvasWrap'));observer.observe(header);observer.observe(tools);observer.observe(workspace.querySelector('.canvas-toolbar'));
    const icons=['M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z','M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z','M4 12l5 5L20 6','M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2','M12 3l9 5v9l-9 5-9-5V8ZM3 8l9 5 9-5M12 13v9','M5 4h14v16H5ZM8 8h8M8 12h8M8 16h5'];
    document.querySelectorAll('.primary-nav .nav-item>span').forEach((span,index)=>{span.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[index]}"/></svg>`;});
    setupCompare();syncJourney();
    byId('studioCloseResults').addEventListener('click',()=>setPanel('results',true));
    const disclosures=state.disclosures&&typeof state.disclosures==='object'?state.disclosures:{};state.disclosures=disclosures;
    document.querySelectorAll('#appMain details').forEach((detail,index)=>{
      const key=detail.id||`disclosure-${index}`;
      if(typeof disclosures[key]==='boolean')detail.open=disclosures[key];
      detail.addEventListener('toggle',()=>{disclosures[key]=detail.open;save();});
    });
  }
  function setupCompare(){
    const viewport=document.querySelector('.studio-compare-images');
    const images=document.createElement('div');images.className='compare-image-pair';
    images.append(byId('studioCompareBefore'),byId('studioCompareAfterWrap'));viewport.append(images);
    const controls=document.createElement('label');controls.className='compare-zoom';controls.innerHTML='Zoom đồng bộ <select aria-label="Độ phóng đại ảnh so sánh"><option value="1">Vừa khung</option><option value="2">2×</option><option value="4">4×</option></select><small>Kéo ảnh để xem chi tiết · Nhấp đôi để vừa khung</small>';
    byId('studioCompareSlider').closest('label').after(controls);
    let zoom=1,x=0,y=0,drag=null;
    const paint=()=>{images.style.transform=`translate(${x}px,${y}px) scale(${zoom})`;};
    controls.querySelector('select').onchange=event=>{zoom=Number(event.target.value);x=y=0;paint();};
    viewport.addEventListener('pointerdown',event=>{if(zoom===1)return;drag={x:event.clientX-x,y:event.clientY-y};viewport.setPointerCapture(event.pointerId);});
    viewport.addEventListener('pointermove',event=>{if(!drag)return;const limitX=viewport.clientWidth*(zoom-1)/2,limitY=viewport.clientHeight*(zoom-1)/2;x=Math.max(-limitX,Math.min(limitX,event.clientX-drag.x));y=Math.max(-limitY,Math.min(limitY,event.clientY-drag.y));paint();});
    const stop=()=>{drag=null;};viewport.addEventListener('pointerup',stop);viewport.addEventListener('pointercancel',stop);
    viewport.addEventListener('dblclick',()=>{zoom=1;x=y=0;controls.querySelector('select').value='1';paint();});
    viewport.querySelectorAll('img').forEach(img=>{img.draggable=false;});
    new MutationObserver(()=>{zoom=1;x=y=0;controls.querySelector('select').value='1';paint();setPanel('results',false);document.querySelector('.workspace').scrollIntoView({block:'start',behavior:'instant'});}).observe(byId('studioCompareAfter'),{attributes:true,attributeFilter:['src']});
  }
  function applyQualityDefaults(){
    for(const [id,value] of [['qualityPreset','quality'],['inpaintQualityPreset','detail']]){const field=byId(id);if(field){field.value=value;field.dispatchEvent(new Event('change'));}}
    byId('outpaintQuality').click();globalThis.AtelierApp.applyTextToImagePreset('balanced');
    syncJourney();
  }
  global.StudioWorkspace={setup,syncJourney,reveal,setPanel,applyQualityDefaults};
})(window);
