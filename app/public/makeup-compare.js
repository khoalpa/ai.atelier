/* One snapshot, one original image, 2–4 independently rendered style previews. */
window.MakeupCompare=(()=>{
  const el=id=>document.getElementById(id),allParts=['lips','eyes','brows','cheeks','base'];
  const clone=value=>JSON.parse(JSON.stringify(value));
  let saved=[],catalogSignature='',choices=[],selected=new Set(['preset:natural','preset:classic']),running=false,jobId='',state=null;
  let cards=new Map(),zoom='fit',original=false,center={x:.5,y:.5},selecting=false;
  async function request(url,body){
    const response=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok||data.ok===false)throw Error(data.error||'Không thể so sánh phong cách.');return data;
  }
  function buildChoices(){
    const catalog=window.Makeup.catalog();if(!Object.keys(catalog).length)return;
    choices=Object.entries(catalog).filter(([key])=>key!=='custom').map(([key,value])=>({id:'preset:'+key,name:value.name,
      settings:{...value,style:key,description:'',plannedDescription:'',parts:allParts,brow:'#59443b',skinSmooth:0,preserveFeatures:true}}));
    choices.push({id:'current',name:'Thiết lập hiện tại · kể cả ảnh tham chiếu'});
    choices.push(...saved.map(item=>({id:'saved:'+item.id,name:'Của tôi · '+item.name,settings:item.settings})));
    selected=new Set([...selected].filter(key=>choices.some(choice=>choice.id===key)));
    const host=el('makeupCompareChoices');host.replaceChildren();
    for(const choice of choices){const label=document.createElement('label'),input=document.createElement('input');
      label.className='makeup-check';input.type='checkbox';input.dataset.compareStyle=choice.id;input.checked=selected.has(choice.id);
      input.onchange=()=>{if(input.checked&&selected.size>=4){input.checked=false;return;}input.checked?selected.add(choice.id):selected.delete(choice.id);sync();};
      label.append(input,choice.name);host.append(label);
    }
    catalogSignature=JSON.stringify(catalog);sync();
  }
  async function refresh(){
    if(running||window.Makeup.isLocked())return;
    try{saved=(await request('/api/makeup-library')).styles;buildChoices();el('makeupCompareHint').textContent='Chọn 2–4 phong cách. Mọi phương án dùng chung vùng đỏ và vùng bảo vệ hiện tại.';}
    catch(error){el('makeupCompareHint').textContent=error.message;buildChoices();}
  }
  function sync(){
    if(!el('makeupCompareStart'))return;
    const catalog=window.Makeup.catalog();if(Object.keys(catalog).length&&JSON.stringify(catalog)!==catalogSignature){buildChoices();return;}
    const locked=running||selecting||window.Makeup.isLocked();
    el('makeupCompareStart').disabled=locked||!window.Makeup.comparisonReady()||selected.size<2||selected.size>4;
    el('makeupCompareRefresh').disabled=locked;
    el('makeupCompareCancel').disabled=!running||state?.status==='cancelling';
    el('makeupCompareCount').textContent=selected.size+' / 4 phong cách';
    el('makeupCompareChoices').querySelectorAll('input').forEach(input=>input.disabled=locked||(!input.checked&&selected.size>=4));
    for(const card of cards.values())if(card.choose)card.choose.disabled=locked;
  }
  function selectedStyles(){
    if(selected.size<2||selected.size>4)throw Error('Chọn từ 2 đến 4 phong cách.');
    return choices.filter(c=>selected.has(c.id)).map(choice=>{
      if(choice.id==='current'){
        if(!window.Makeup.descriptionReady())throw Error('Đọc mô tả hiện tại trước khi đưa vào bảng so sánh.');
        const value=window.Makeup.settings();return {id:choice.id,name:('Hiện tại · '+value.styleName).slice(0,160),settings:clone(value)};
      }
      return {id:choice.id,name:choice.name.slice(0,160),settings:clone(choice.settings)};
    });
  }
  function setZoom(){
    for(const card of cards.values())if(card.item){
      const scale=zoom==='fit'?Math.min(card.viewport.clientWidth/card.item.width,card.viewport.clientHeight/card.item.height,1):Number(zoom);
      card.pixels.style.width=card.item.width*scale+'px';card.pixels.style.height=card.item.height*scale+'px';
      card.viewport.scrollLeft=Math.max(0,center.x*card.item.width*scale-card.viewport.clientWidth/2);
      card.viewport.scrollTop=Math.max(0,center.y*card.item.height*scale-card.viewport.clientHeight/2);
      card.before.hidden=!original;card.after.hidden=original;
    }
  }
  function synchronize(origin){
    const pixels=origin.pixels,viewport=origin.viewport;
    center={x:(viewport.scrollLeft+viewport.clientWidth/2)/Math.max(1,pixels.offsetWidth),y:(viewport.scrollTop+viewport.clientHeight/2)/Math.max(1,pixels.offsetHeight)};
    for(const card of cards.values())if(card!==origin&&card.item){
      const left=Math.max(0,center.x*card.pixels.offsetWidth-card.viewport.clientWidth/2),top=Math.max(0,center.y*card.pixels.offsetHeight-card.viewport.clientHeight/2);
      if(Math.abs(card.viewport.scrollLeft-left)>.5)card.viewport.scrollLeft=left;
      if(Math.abs(card.viewport.scrollTop-top)>.5)card.viewport.scrollTop=top;
    }
  }
  function addImage(card,item){
    card.item=item;const viewport=document.createElement('div'),pixels=document.createElement('div'),before=new Image(),after=new Image();
    viewport.className='makeup-compare-viewport';viewport.tabIndex=0;viewport.setAttribute('aria-label','Ảnh so sánh · '+item.comparisonName);
    pixels.className='makeup-compare-pixels';before.src=outputUrl(item.comparisonFile);after.src=outputUrl(item.file);
    before.alt='Ảnh gốc';after.alt=item.comparisonName;before.draggable=after.draggable=false;
    pixels.append(before,after);viewport.append(pixels);card.imageHost.append(viewport);
    Object.assign(card,{viewport,pixels,before,after});viewport.onscroll=()=>synchronize(card);
    let drag=null;
    viewport.onpointerdown=event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(event.pointerId);};
    viewport.onpointermove=event=>{if(drag){viewport.scrollLeft=drag.left+drag.x-event.clientX;viewport.scrollTop=drag.top+drag.y-event.clientY;}};
    viewport.onpointerup=viewport.onpointercancel=()=>drag=null;
    const swatches=document.createElement('div');swatches.className='makeup-compare-swatches';
    for(const [key,name] of [['lip','Son'],['eyeshadow','Mắt'],['blush','Má'],['brow','Mày']]){const chip=document.createElement('span');chip.textContent=name;chip.title=name+' '+item.settings[key];chip.style.borderBottomColor=item.settings[key];swatches.append(chip);}
    card.imageHost.append(swatches);
    const details=document.createElement('details'),summary=document.createElement('summary'),copy=document.createElement('p');summary.textContent='Thiết lập đã dùng';
    const names={lips:'môi',eyes:'mí mắt',cheeks:'má',brows:'chân mày',base:'nền da'};
    copy.textContent=(item.settings.renderer==='ai'?'AI · ':'Phủ màu · ')+({light:'Nhẹ',medium:'Vừa',bold:'Đậm'}[item.settings.intensity])+'. '+item.settings.parts.map(p=>names[p]+' '+(item.settings.strengths?.[p]??100)+'%').join(', ')+'. '+(item.settings.description||'');details.append(summary,copy);card.imageHost.append(details);
    const choose=document.createElement('button');choose.type='button';choose.textContent='Chọn phong cách này';choose.dataset.compareChoose=item.comparisonId;
    choose.onclick=async()=>{
      if(running||selecting||window.Makeup.isLocked())return;selecting=true;sync();
      try{if(await window.Makeup.editAgain(item)){el('makeupCompareNotice').textContent='Đã chọn '+item.comparisonName+'. Thiết lập, vùng đỏ và vùng bảo vệ đã được khôi phục; dùng Áp dụng để tạo hai ảnh đầy đủ.';window.Makeup.focus();}}
      finally{selecting=false;sync();}
    };card.choose=choose;card.imageHost.append(choose);setZoom();
  }
  function render(){
    if(!state)return;
    el('makeupCompareBoard').hidden=false;
    const entries=state.comparisonEntries||(state.results||[]).map(item=>({id:item.comparisonId,name:item.comparisonName,status:'completed',progress:100,settings:item.settings}));
    for(const entry of entries){
      let card=cards.get(entry.id);
      if(!card){const root=document.createElement('article'),heading=document.createElement('h4'),status=document.createElement('p'),bar=document.createElement('progress'),imageHost=document.createElement('div');
        root.className='makeup-compare-card';heading.textContent=entry.name;bar.max=100;bar.setAttribute('aria-label','Tiến độ · '+entry.name);status.setAttribute('role','status');root.append(heading,status,bar,imageHost);el('makeupCompareGrid').append(root);card={root,status,bar,imageHost};cards.set(entry.id,card);
      }
      card.status.textContent=({queued:'Đang chờ',running:'Đang tạo',completed:'Đã tạo xong',cancelled:'Đã dừng',failed:'Chưa tạo được'}[entry.status]||entry.status)+(entry.error?' · '+entry.error:'');
      card.bar.value=entry.progress||0;
      const item=(state.results||[]).find(item=>item.comparisonId===entry.id);if(item&&!card.item)addImage(card,item);
    }
    const completed=(state.results||[]).length,total=entries.length,done=['completed','cancelled','failed','interrupted'].includes(state.status);
    el('makeupCompareNotice').textContent=(done?(state.status==='cancelled'?'Đã dừng · ':state.status==='interrupted'?'Lượt so sánh bị gián đoạn · ':'Đã kết thúc · '):'Đang so sánh · ')+completed+'/'+total+' phong cách đã có ảnh.'+(done&&completed?' Chọn một phong cách để chỉnh tiếp và tạo ảnh đầy đủ.':'');
    sync();
  }
  function update(next){
    if(!next?.comparison)return;
    if(jobId&&next.jobId!==jobId)return;
    if(!jobId){jobId=next.jobId;cards.clear();el('makeupCompareGrid').replaceChildren();}
    state=next;running=['running','cancelling'].includes(next.status);render();
    if(!running)setTimeout(sync,0); // The shared job handler clears its lock after rendering.
  }
  function show(next){
    jobId=next.jobId||'';state={...next,status:next.status||'completed'};cards.clear();el('makeupCompareGrid').replaceChildren();zoom='fit';center={x:.5,y:.5};original=false;
    el('makeupCompareZoom').value='fit';el('makeupCompareOriginal').checked=false;running=['running','cancelling'].includes(state.status);
    activateAppView('create');setStudioMode('makeup');render();el('makeupCompareBoard').scrollIntoView({block:'start'});
  }
  async function start(){
    if(running||window.Makeup.isLocked()||inpaintPromptReviewPending||descriptionTryonRunning)return;
    let body;try{body={...window.Makeup.comparisonSource(),comparisonStyles:selectedStyles()};}catch(error){return setMessage(error.message,'error');}
    const id=createJobId('makeup-compare');jobId=id;running=true;window.Makeup.setExtensionBusy(true);setActiveJob(id);
    show({jobId:id,comparison:true,status:'running',results:[],comparisonEntries:body.comparisonStyles.map(style=>({...style,status:'queued',progress:0}))});
    let status='failed',error='',detached=false;
    try{const result=await request('/api/makeup-compare',{...body,jobId:id});status=result.status;update(result);}
    catch(failure){error=failure.message;setMessage(error,'error');
      try{const latest=await request('/api/job-status',{jobId:id});update(latest);detached=latest.comparison&&['running','cancelling'].includes(latest.status);if(['completed','cancelled','failed'].includes(latest.status))status=latest.status;}catch{}
      if(!detached&&['running','cancelling'].includes(state?.status))update({...state,status:'failed',comparisonEntries:state.comparisonEntries.map(entry=>entry.status==='completed'?entry:{...entry,status:'failed',error})});
    }
    finally{if(!detached){await settleJob(id,status,error);running=false;}window.Makeup.setExtensionBusy(false);sync();}
  }
  function setup(){
    el('makeupCompareStart').onclick=start;el('makeupCompareRefresh').onclick=refresh;
    el('makeupCompareCancel').onclick=async()=>{if(!running)return;try{await request('/api/cancel-job',{jobId});state={...state,status:'cancelling'};render();}catch(error){setMessage(error.message,'error');}};
    el('makeupCompareZoom').onchange=event=>{zoom=event.target.value;setZoom();};
    el('makeupCompareOriginal').onchange=event=>{original=event.target.checked;setZoom();};
    window.addEventListener('resize',()=>{if(zoom==='fit')setZoom();});refresh();
  }
  document.addEventListener('DOMContentLoaded',setup);
  return {sync,update,show};
})();
