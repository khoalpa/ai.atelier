const fs=require('fs'),path=require('path'),crypto=require('crypto');
const promptStore=require('./prompt-store');
const ROOT=path.resolve(__dirname,'..');
const DEFINITIONS=[
  ['prompts','Prompt và cấu hình tạo ảnh','workspace/prompts.json','Tải lại trang để cập nhật các cửa sổ đang mở.'],
  ['config','Cấu hình ứng dụng','workspace/config.json','Thay đổi đường dẫn hoặc cấu hình AI có thể cần khởi động lại dịch vụ AI.'],
  ['registry','Model đã đăng ký','models/registry.json','Làm mới màn Model sau khi lưu.'],
  ['candidates','Danh mục model tích hợp','models/inpaint-candidates.json','Làm mới màn Model sau khi lưu.'],
  ['sources','Nguồn model bổ sung','models/external-sources.json','Làm mới màn Model sau khi lưu.'],
  ['theme-tokens','Giá trị giao diện','themes/tokens.json','Tệp nguồn được lưu; cần build theme để cập nhật CSS đã sinh.'],
  ['theme-project','Cấu hình theme','themes/project.json','Tệp nguồn được lưu; cần áp dụng/build theme để cập nhật giao diện.']
];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const revision=data=>crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
function createStore(root=process.env.ATELIER_JSON_CONFIG_ROOT||ROOT,promptsFile=promptStore.FILE){
  const definitions=DEFINITIONS.map(([id,label,relative,note])=>({id,label,relative,note,file:id==='prompts'?promptsFile:path.join(root,relative)}));
  const backupRoot=path.join(root,'workspace/backups/json-config');
  function definition(id){const item=definitions.find(item=>item.id===id);if(!item)throw new Error('Tệp JSON không được hỗ trợ.');return item;}
  function read(id){const item=definition(id),data=JSON.parse(fs.readFileSync(item.file,'utf8'));return {id,label:item.label,path:item.relative,note:item.note,data,revision:revision(data),backups:backups(id)};}
  function backups(id){definition(id);const dir=path.join(backupRoot,id);return fs.existsSync(dir)?fs.readdirSync(dir).filter(name=>/^\d+-[a-f0-9-]+\.json$/.test(name)).sort().reverse().map(name=>({id:name,createdAt:new Date(Number(name.split('-')[0])).toISOString()})):[];}
  function safe(value,depth=0){
    if(depth>60)throw new Error('JSON lồng quá sâu.');
    if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))throw new Error('Tên trường không được hỗ trợ: '+key);safe(child,depth+1);}
  }
  function validate(id,data){
    const item=definition(id);if(!object(data))throw new Error('Gốc của cấu hình phải là một đối tượng JSON.');
    if(Buffer.byteLength(JSON.stringify(data))>3*1024*1024)throw new Error('Cấu hình tối đa 3 MB.');safe(data);
    const nonempty=v=>typeof v==='string'&&!!v.trim();
    if(id==='prompts')promptStore.previewImport(data,item.file);
    if(['registry','candidates','sources'].includes(id)){
      const key=id==='registry'?'models':'candidates';if(data.schemaVersion!==1||!Array.isArray(data[key]))throw new Error('Phiên bản hoặc danh sách model không hợp lệ.');
      const ids=new Set();for(const model of data[key]){
        if(!object(model)||!nonempty(model.id)||!nonempty(model.name)||ids.has(model.id))throw new Error('Model phải có ID duy nhất và tên hợp lệ.');ids.add(model.id);
        if(id==='registry'&&(!nonempty(model.path)||!nonempty(model.kind)))throw new Error('Model phải có đường dẫn và loại.');
        if(model.requiredFiles!==undefined&&(!Array.isArray(model.requiredFiles)||model.requiredFiles.some(file=>!nonempty(file))))throw new Error('Danh sách tệp bắt buộc không hợp lệ.');
      }
    }
    if(id==='config'){
      const current=read(id).data;
      const type=value=>value===null?'null':Array.isArray(value)?'array':typeof value;
      for(const key of Object.keys(current))if(Object.hasOwn(data,key)&&type(data[key])!==type(current[key]))throw new Error('Sai kiểu dữ liệu của cấu hình: '+key);
      if(data.featureModels!==undefined&&(!object(data.featureModels)||Object.values(data.featureModels).some(value=>!nonempty(value))))throw new Error('Ánh xạ model theo chức năng không hợp lệ.');
      if(data.modelRestartRequired!==undefined&&typeof data.modelRestartRequired!=='boolean')throw new Error('modelRestartRequired phải là boolean.');
      for(const key of ['inpaintModel','chromaModel','catvtonModel','catvtonBase','catvtonVae','poseModel'])if(data[key]!==undefined&&!nonempty(data[key]))throw new Error('Đường dẫn không hợp lệ: '+key);
      for(const key of ['modelAppliedPaths'])if(data[key]!==undefined&&(!object(data[key])||Object.values(data[key]).some(value=>!nonempty(value))))throw new Error('Danh sách đường dẫn không hợp lệ: '+key);
    }
    if(id==='theme-tokens'){
      for(const key of ['themes','status','styles','density'])if(!object(data[key])||!Object.keys(data[key]).length)throw new Error('Thiếu nhóm theme: '+key);
      for(const theme of Object.values(data.themes)){if(!object(theme)||!object(theme.light)||!object(theme.dark))throw new Error('Theme phải có bảng màu light và dark.');}
      const current=read(id).data;
      function shape(next,previous){for(const [key,old] of Object.entries(previous)){if(!Object.hasOwn(next,key))throw new Error('Thiếu token cần thiết: '+key);if(object(old)){if(!object(next[key]))throw new Error('Nhóm token không hợp lệ: '+key);shape(next[key],old);}else if(typeof next[key]!==typeof old)throw new Error('Sai kiểu token: '+key);}}
      shape(data,current);
    }
    if(id==='theme-project'){
      const tokens=read('theme-tokens').data;
      if(!nonempty(data.version)||!nonempty(data.project)||!Object.hasOwn(tokens.themes,data.theme)||!['light','dark','system'].includes(data.mode)||!Object.hasOwn(tokens.styles,data.style)||!Object.hasOwn(tokens.density,data.density))throw new Error('Cấu hình theme không tương thích với tokens.json.');
    }
    return true;
  }
  function preview(id,data,expectedRevision){
    const current=read(id);if(typeof expectedRevision!=='string'||expectedRevision!==current.revision)throw new Error('Tệp đã thay đổi. Tải lại dữ liệu trước khi lưu.');validate(id,data);
    const changes=[];
    function diff(a,b,location=''){
      if(JSON.stringify(a)===JSON.stringify(b))return;
      if(object(a)&&object(b)){for(const key of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[key],b[key],location+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'));}
      else changes.push({path:location||'/',kind:a===undefined?'added':b===undefined?'removed':'changed'});
    }
    diff(current.data,data);return {valid:true,changeCount:changes.length,changes:changes.slice(0,100),note:current.note};
  }
  function save(id,data,expectedRevision){
    const check=preview(id,data,expectedRevision),item=definition(id);if(!check.changeCount)return {...read(id),saved:false};
    const dir=path.join(backupRoot,id);fs.mkdirSync(dir,{recursive:true});const backup=Date.now()+'-'+crypto.randomUUID()+'.json';fs.copyFileSync(item.file,path.join(dir,backup));
    const temp=item.file+'.'+crypto.randomUUID()+'.tmp';
    try{fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{encoding:'utf8',flag:'wx'});fs.renameSync(temp,item.file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    return {...read(id),saved:true,backup};
  }
  function restore(id,backup,expectedRevision){
    definition(id);if(typeof backup!=='string'||!backups(id).some(item=>item.id===backup))throw new Error('Bản sao lưu không hợp lệ.');
    return save(id,JSON.parse(fs.readFileSync(path.join(backupRoot,id,backup),'utf8')),expectedRevision);
  }
  return {list:()=>definitions.map(({id,label,relative,note})=>({id,label,path:relative,note})),read,preview,save,restore,validate};
}
module.exports={createStore};
