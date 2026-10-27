(function(global){
  const drafts=new Map();let files=[],state=null,selectedPath=[],mode='form',busy=false;
  const by=id=>document.getElementById(id),clone=value=>JSON.parse(JSON.stringify(value));
  const message=text=>{by('jsonEditorStatus').textContent=text;};
  async function api(id,body){
    const response=await fetch('/api/json-config'+(id?'/'+encodeURIComponent(id):''),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể xử lý cấu hình JSON.');return result;
  }
  function controls(value){busy=value;for(const node of by('jsonEditorDialog').querySelectorAll('button,input,select,textarea'))node.disabled=value;}
  function valueAt(path){return path.reduce((value,key)=>value[key],state.data);}
  function put(path,value){if(!path.length)state.data=value;else valueAt(path.slice(0,-1))[path.at(-1)]=value;}
  function mark(){state.dirty=true;drafts.set(state.id,state);by('jsonEditorDirty').textContent='Có thay đổi chưa lưu';}
  function raw(){return JSON.stringify(valueAt(selectedPath),null,2);}
  function syncRaw(){by('jsonEditorRaw').value=state.rawDraft!==undefined&&JSON.stringify(state.rawPath)===JSON.stringify(selectedPath)?state.rawDraft:raw();}
  function commitRaw(){if(mode!=='raw'||!state)return;let value;try{value=JSON.parse(by('jsonEditorRaw').value.replace(/^\uFEFF/,''));}catch(error){throw new Error('JSON chưa hợp lệ: '+error.message);}put(selectedPath,value);delete state.rawDraft;delete state.rawPath;}
  function change(fn){fn();mark();syncRaw();}
  function element(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
  const kind=value=>value===null?'null':Array.isArray(value)?'array':typeof value==='object'?'object':typeof value;
  const empty=type=>({object:{},array:[],string:'',number:0,boolean:false,null:null})[type];
  function typeSelect(type,handler){const select=element('select');for(const name of ['string','number','boolean','null','object','array'])select.appendChild(new Option(name,name,false,name===type));select.addEventListener('change',()=>handler(select.value));return select;}
  function renderForm(){
    const host=by('jsonEditorForm');host.replaceChildren();const query=by('jsonEditorSearch').value.trim().toLowerCase(),feature=state.id==='prompts'?by('jsonEditorFeature').value:'';let nodes=0;
    function draw(value,path,label,parent,force=false){
      if(feature&&path.length>=2&&!String(path[1]).toLowerCase().includes(feature.toLowerCase())&&state.data.tasks?.[path[1]]?.feature!==feature)return null;
      const labelMatch=query&&String(label).toLowerCase().includes(query);
      if(query&&!force&&!labelMatch&&!JSON.stringify(value).toLowerCase().includes(query))return null;
      if(++nodes>4000)return null;
      const type=kind(value),row=element('div');row.className='json-node';
      const header=element('div');header.className='json-node-header';
      if(parent&&kind(parent)==='object'){
        const key=element('input');key.value=label;key.setAttribute('aria-label','Tên trường');
        key.addEventListener('change',()=>{
          const name=key.value.trim();if(!name||['__proto__','prototype','constructor'].includes(name)||(name!==label&&Object.hasOwn(parent,name))){key.value=label;message('Tên trường trống, trùng hoặc không được hỗ trợ.');return;}
          change(()=>{parent[name]=parent[label];if(name!==label)delete parent[label];});renderForm();
        });header.appendChild(key);
      }else header.appendChild(element('strong',label));
      header.appendChild(typeSelect(type,next=>{change(()=>put(path,empty(next)));renderForm();}));
      if(parent){const remove=element('button','Xóa');remove.type='button';remove.addEventListener('click',()=>{change(()=>{if(Array.isArray(parent))parent.splice(Number(path.at(-1)),1);else delete parent[path.at(-1)];});renderForm();});header.appendChild(remove);}
      row.appendChild(header);
      if(state.id==='prompts'&&path.length===2){const uses=(state.data.catalogUsage||[]).filter(item=>item.kind===path[0]&&item.key===path[1]);if(uses.length){const info=element('small','Nơi dùng: '+uses.map(item=>item.file+':'+item.line).join(' · '));info.className='json-editor-path';row.appendChild(info);}}
      if(type==='object'||type==='array'){
        const details=element('details'),summary=element('summary',`${type==='array'?'Danh sách':'Đối tượng'} · ${Object.keys(value).length} mục`);details.open=path.length<=selectedPath.length||!!query;details.appendChild(summary);
        for(const [key,child] of Object.entries(value)){const node=draw(child,[...path,Array.isArray(value)?Number(key):key],key,value,force||labelMatch);if(node)details.appendChild(node);}
        const add=element('div');add.className='json-node-header';const name=element('input');name.setAttribute('aria-label','Tên trường mới');name.placeholder='Tên trường mới';if(type==='object')add.appendChild(name);
        let newType='string';add.appendChild(typeSelect(newType,next=>newType=next));const button=element('button',type==='array'?'Thêm phần tử':'Thêm trường');button.type='button';
        button.addEventListener('click',()=>{const key=type==='array'?value.length:name.value.trim();if(type==='object'&&(!key||Object.hasOwn(value,key)||['__proto__','prototype','constructor'].includes(key))){message('Tên trường trống, trùng hoặc không được hỗ trợ.');return;}change(()=>{value[key]=empty(newType);});renderForm();});add.appendChild(button);details.appendChild(add);row.appendChild(details);
      }else if(type==='boolean'){
        const input=element('input');input.type='checkbox';input.checked=value;input.setAttribute('aria-label',label);input.addEventListener('change',()=>change(()=>put(path,input.checked)));row.appendChild(input);
      }else if(type!=='null'){
        const input=element(type==='string'?'textarea':'input');if(type==='number'){input.type='number';input.step='any';}else input.rows=value.includes('\n')?4:2;
        input.value=String(value);input.setAttribute('aria-label',label);input.addEventListener('change',()=>{const next=type==='number'?Number(input.value):input.value;if(type==='number'&&(!input.value.trim()||!Number.isFinite(next))){message('Giá trị số không hợp lệ.');return;}change(()=>put(path,next));});row.appendChild(input);
      }
      return row;
    }
    host.appendChild(draw(valueAt(selectedPath),selectedPath,selectedPath.at(-1)||'Toàn bộ cấu hình',null)||element('p','Không có trường phù hợp.'));
    if(nodes>4000)host.appendChild(element('p','Nhiều trường dữ liệu. Chọn một nhóm nhỏ hơn hoặc dùng chế độ JSON để xem toàn bộ.'));
  }
  function groups(){
    const select=by('jsonEditorGroup'),previous=JSON.stringify(selectedPath);select.replaceChildren(new Option('Toàn bộ cấu hình','[]'));
    if(state.data&&typeof state.data==='object'&&!Array.isArray(state.data))for(const key of Object.keys(state.data))select.appendChild(new Option(key,JSON.stringify([key])));
    select.value=[...select.options].some(option=>option.value===previous)?previous:'[]';selectedPath=JSON.parse(select.value);
  }
  function render(){
    const feature=by('jsonEditorFeature'),previous=feature.value;feature.replaceChildren(new Option('Tất cả tính năng',''));
    if(state.id==='prompts')for(const name of new Set((state.data.catalogUsage||[]).map(item=>item.feature).filter(Boolean)))feature.appendChild(new Option(name,name));
    feature.value=[...feature.options].some(item=>item.value===previous)?previous:'';feature.hidden=state.id!=='prompts';
    by('jsonEditorTaskPanel').hidden=state.id!=='prompts';
    const tasks=by('jsonEditorTask'),oldTask=tasks.value;tasks.replaceChildren();if(state.id==='prompts')for(const [id,task] of Object.entries(state.data.tasks||{}))if(task.positive||task.negative)tasks.appendChild(new Option(id,id));tasks.value=[...tasks.options].some(item=>item.value===oldTask)?oldTask:[...tasks.options].some(item=>item.value==='skin.retouch')?'skin.retouch':tasks.options[0]?.value||'';
    groups();syncRaw();renderForm();by('jsonEditorRaw').hidden=mode!=='raw';by('jsonEditorForm').hidden=mode!=='form';
    by('jsonEditorMode').value=mode;
    by('jsonEditorDirty').textContent=state.dirty?'Có thay đổi chưa lưu':'Đã đồng bộ với tệp';by('jsonEditorPath').textContent=state.path+' · '+state.note;
    const backups=by('jsonEditorBackup');backups.replaceChildren(new Option('Chọn bản sao lưu',''));for(const item of state.backups)backups.appendChild(new Option(new Date(item.createdAt).toLocaleString('vi-VN'),item.id));
  }
  async function load(id,discard=false){
    controls(true);try{const fresh=await api(id);state=!discard&&drafts.has(id)?drafts.get(id):{...fresh,dirty:false};selectedPath=state.rawPath||[];if(state.rawDraft!==undefined)mode='raw';render();message(state.dirty?'Bản nháp chưa lưu đã được giữ lại.':'Đã tải cấu hình. Chỉnh sửa rồi kiểm tra trước khi lưu.');}finally{controls(false);}
  }
  async function run(action){
    if(!state||busy)return;controls(true);
    try{
      commitRaw();
      const result=await api(state.id,{action,data:state.data,revision:state.revision});
      if(action==='validate')message(`JSON hợp lệ · ${result.changeCount} vị trí thay đổi. ${result.changes.map(item=>item.path).join(', ')}`);
      else{state={...result,dirty:false};drafts.delete(state.id);render();message((result.saved?'Đã lưu và sao lưu bản trước. ':'Không có thay đổi. ')+result.note);}
    }catch(error){message(error.message);}finally{controls(false);}
  }
  async function open(id='prompts'){
    const dialog=by('jsonEditorDialog');if(!dialog.open)dialog.showModal();controls(true);
    try{files=(await api()).files;const select=by('jsonEditorFile');select.replaceChildren(...files.map(file=>new Option(file.label+' · '+file.path,file.id)));select.value=files.some(file=>file.id===id)?id:files[0].id;await load(select.value);}catch(error){message(error.message);}finally{controls(false);}
  }
  global.AtelierJsonEditor={open};
  global.addEventListener('DOMContentLoaded',()=>{
    by('jsonEditorClose').onclick=()=>{try{commitRaw();}catch{}by('jsonEditorDialog').close();};
    by('jsonEditorFile').onchange=async()=>{const next=by('jsonEditorFile').value;try{commitRaw();await load(next);}catch(error){by('jsonEditorFile').value=state?.id||next;message(error.message);}};
    by('jsonEditorGroup').onchange=()=>{const previous=JSON.stringify(selectedPath);try{commitRaw();selectedPath=JSON.parse(by('jsonEditorGroup').value);render();}catch(error){by('jsonEditorGroup').value=previous;message(error.message);}};
    by('jsonEditorMode').onchange=()=>{try{commitRaw();mode=by('jsonEditorMode').value;render();}catch(error){by('jsonEditorMode').value=mode;message(error.message);}};
    by('jsonEditorSearch').oninput=()=>{if(state)renderForm();};
    by('jsonEditorFeature').onchange=()=>{if(state)renderForm();};
    by('jsonEditorPreview').onclick=async()=>{
      if(!state||state.id!=='prompts'||busy)return;controls(true);
      try{
        commitRaw();const variables=JSON.parse(by('jsonEditorVariables').value||'{}');
        const response=await fetch('/api/catalog-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({catalog:state.data,taskId:by('jsonEditorTask').value,variables,modelId:by('jsonEditorTokenModel').value.trim()})});
        const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'Không thể xem trước tác vụ.');
        const tokens=result.tokenCheck?.encoders?.map(item=>`${item.name}: positive ${item.tokens}/${item.limit}; negative ${item.negativeTokens??'không áp dụng'}`).join('\n')||'';
        by('jsonEditorPreviewOutput').textContent=result.missingVariables.length?'Cần nhập các biến: '+result.missingVariables.join(', '):'Positive:\n'+result.prompt+'\n\nNegative:\n'+result.negativePrompt+'\n\n'+tokens+(result.tokenCheck?'\n'+(result.tokenCheck.withinLimits?'Trong giới hạn tokenizer.':'Vượt giới hạn tokenizer.'): '')+(result.tokenError?'\nChưa kiểm tra token: '+result.tokenError:'')+(result.warnings?.length?'\n\nCần kiểm tra:\n'+result.warnings.join('\n'):'');
        message(result.missingVariables.length?'Điền dữ liệu thay biến để xem bản ghép đầy đủ.':'Đã ghép từ bản nháp. '+(!by('jsonEditorTokenModel').value.trim()?'Chọn ID model để kiểm tra token bằng tokenizer cục bộ.':''));
      }catch(error){message(error.message);}finally{controls(false);}
    };
    by('jsonEditorRaw').oninput=()=>{if(state){state.rawDraft=by('jsonEditorRaw').value;state.rawPath=[...selectedPath];mark();}};
    by('jsonEditorFormat').onclick=()=>{try{commitRaw();syncRaw();message('Đã định dạng JSON.');}catch(error){message(error.message);}};
    by('jsonEditorValidate').onclick=()=>run('validate');by('jsonEditorSave').onclick=()=>run('save');
    by('jsonEditorReload').onclick=()=>{if(!state)return;if(state.dirty&&!global.confirm('Bỏ bản nháp và tải lại tệp đã lưu?'))return;drafts.delete(state.id);load(state.id,true).catch(error=>message(error.message));};
    by('jsonEditorRestore').onclick=async()=>{if(!state||busy)return;const backup=by('jsonEditorBackup').value;if(!backup)return message('Chọn một bản sao lưu.');if(state.dirty&&!global.confirm('Khôi phục bản đã chọn và bỏ bản nháp chưa lưu?'))return;controls(true);try{const result=await api(state.id,{action:'restore',backup,revision:state.revision});drafts.delete(state.id);state={...result,dirty:false};render();message('Đã khôi phục; dữ liệu trước khi khôi phục cũng được sao lưu. '+result.note);}catch(error){message(error.message);}finally{controls(false);}};
    by('jsonEditorExport').onclick=()=>{if(!state)return;try{commitRaw();const url=URL.createObjectURL(new Blob([JSON.stringify(state.data,null,2)+'\n'],{type:'application/json'})),link=element('a');link.href=url;link.download=state.path.split('/').at(-1);document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){message(error.message);}};
    by('jsonEditorImport').onchange=async()=>{const file=by('jsonEditorImport').files[0];if(!file||!state)return;try{if(file.size>3*1024*1024)throw new Error('Tệp tối đa 3 MB.');const value=JSON.parse((await file.text()).replace(/^\uFEFF/,''));selectedPath=[];change(()=>state.data=value);render();message('Đã nạp tệp vào bản nháp. Kiểm tra và lưu để áp dụng.');}catch(error){message(error.message);}finally{by('jsonEditorImport').value='';}};
    document.addEventListener('click',event=>{const button=event.target.closest('[data-json-config-open]');if(button)open(button.dataset.jsonConfigOpen||'prompts').catch(error=>message(error.message));});
  });
  global.addEventListener('beforeunload',event=>{if([...drafts.values()].some(draft=>draft.dirty)){event.preventDefault();event.returnValue='';}});
})(window);
