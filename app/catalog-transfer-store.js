'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const prompts=require('./prompt-store');
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const LIBRARIES={makeup:'makeup-styles.json',character:'character-presets.json',export:'export-presets.json',color:'manual/presets.json'};
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function createStore(root=path.resolve(__dirname,'..'),systemFile=prompts.FILE){
  const file=key=>key==='system'?systemFile:path.join(root,'workspace',LIBRARIES[key]);
  function read(key){if(key!=='system')return require('./catalog-library').read(file(key),key==='character'?{ok:true,version:1,items:[]}:[]);return prompts.readCatalog(systemFile);}
  function validateLibrary(key,data,catalog){
    const items=key==='character'?data?.items:data;
    if(!Array.isArray(items)||items.length>100)throw Error('Thư viện không hợp lệ: '+key);
    if(key==='character'&&(!object(data)||data.version!==1))throw Error('Phiên bản thư viện tư thế không hợp lệ.');
    const ids=new Set();for(const item of items){
      if(!object(item)||typeof item.id!=='string'||!item.id||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>100)throw Error('Mục thư viện phải có tên và ID duy nhất.');ids.add(item.id);
      if(key==='character'&&(!Array.isArray(item.joints)||item.joints.length!==17||item.joints.some(p=>!Array.isArray(p)||p.length!==3||p.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1))))throw Error('Khung xương cần 17 khớp hợp lệ.');
      if(key==='makeup'){
        const s=item.settings,base=catalog.featurePresets?.['makeup.styles']?.[s?.style];if(!base)throw Error('Phong cách trang điểm không tồn tại.');
        require('./makeup-plan').validatePlan(s,base);
        if(typeof s.preserveFeatures!=='boolean'||typeof s.skinSmooth!=='number'||s.skinSmooth<0||s.skinSmooth>50||!Number.isFinite(s.skinSmooth))throw Error('Thiết lập trang điểm không hợp lệ.');
        if(typeof s.description!=='string'||s.description.length>1000||(s.description.trim()&&s.plannedDescription!==s.description.trim()))throw Error('Mô tả trang điểm chưa được xác nhận.');
      }
      if(key==='export')require('../packages/editor-core/export').validate(item.spec);
      if(key==='color'){if(!object(item.adjustments))throw Error('Bộ màu không hợp lệ.');for(const name of Object.keys(require('../packages/editor-core/document').defaults())){const n=item.adjustments[name];if(typeof n!=='number'||!Number.isFinite(n)||n< -100||n>100)throw Error('Thông số màu không hợp lệ.');}}
    }
  }
  function exported(scope){
    if(!['system','libraries','all'].includes(scope))throw Error('Phạm vi xuất không hợp lệ.');
    const value={format:'ai-atelier-catalog-package',version:1};
    if(scope!=='libraries'){value.system=structuredClone(prompts.readCatalog(systemFile));delete value.system.personalLibraries;}
    if(scope!=='system')value.libraries=Object.fromEntries(Object.keys(LIBRARIES).map(key=>[key,read(key)]));
    return value;
  }
  function prepare(bundle){
    if(!object(bundle)||bundle.format!=='ai-atelier-catalog-package'||bundle.version!==1||Buffer.byteLength(JSON.stringify(bundle))>4*1024*1024)throw Error('Gói cấu hình không hợp lệ hoặc vượt 4 MB.');
    const catalog=bundle.system||prompts.readCatalog(systemFile),documents={};
    if(bundle.system){prompts.previewImport(bundle.system,systemFile);documents.system=bundle.system;}
    if(bundle.libraries!==undefined){if(!object(bundle.libraries))throw Error('Thư viện trong gói không hợp lệ.');for(const [key,data] of Object.entries(bundle.libraries)){if(!Object.hasOwn(LIBRARIES,key))throw Error('Thư viện không được hỗ trợ: '+key);validateLibrary(key,data,catalog);documents[key]=data;}}
    if(!Object.keys(documents).length)throw Error('Gói không có dữ liệu để nhập.');
    return documents;
  }
  function preview(bundle){const documents=prepare(bundle);return {revisions:Object.fromEntries(Object.keys(documents).map(key=>[key,digest(read(key))])),documents:Object.keys(documents),counts:Object.fromEntries(Object.entries(documents).map(([key,data])=>[key,key==='system'?Object.keys(data.components).length:(key==='character'?data.items:data).length]))};}
  function apply(bundle,revisions){
    const documents=prepare(bundle),keys=Object.keys(documents);if(!object(revisions)||keys.some(key=>revisions[key]!==digest(read(key))))throw Error('Cấu hình hoặc thư viện đã thay đổi. Xem trước lại gói nhập.');
    if(read('system').personalLibraries){
      const catalog=prompts.updateCatalog(current=>{
        const libraries=structuredClone(current.personalLibraries),migrations=current.migrations;
        if(documents.system){for(const key of Object.keys(current))delete current[key];Object.assign(current,structuredClone(documents.system));current.personalLibraries||=libraries;if(migrations)current.migrations=migrations;else delete current.migrations;}
        for(const key of keys)if(key!=='system')current.personalLibraries[key]=structuredClone(documents[key]);
      },systemFile);
      return {catalog,documents:keys,backup:'workspace/backups/prompts'};
    }
    // Preserve installation-local browser migration history during transfers.
    if(documents.system){documents.system=structuredClone(documents.system);const current=read('system');if(current.migrations)documents.system.migrations=current.migrations;else delete documents.system.migrations;}
    const dir=path.join(root,'workspace/backups/catalog-packages',Date.now()+'-'+crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});
    const prepared=[],committed=[];
    try{
      for(const key of keys){const target=file(key),exists=fs.existsSync(target),backup=path.join(dir,key+'.json');if(exists)fs.copyFileSync(target,backup);fs.mkdirSync(path.dirname(target),{recursive:true});const temp=target+'.'+crypto.randomUUID()+'.tmp';prepared.push({key,target,temp,backup,exists});fs.writeFileSync(temp,JSON.stringify(documents[key],null,2)+'\n',{encoding:'utf8',flag:'wx'});}
      fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(prepared.map(({key,exists})=>({key,exists})),null,2));
      for(const item of prepared){if(revisions[item.key]!==digest(read(item.key)))throw Error('Dữ liệu thay đổi trong lúc nhập.');fs.renameSync(item.temp,item.target);committed.push(item);}
    }catch(error){
      const failures=[];for(const item of committed.reverse())try{if(item.exists){const temp=item.target+'.rollback-'+crypto.randomUUID();fs.copyFileSync(item.backup,temp);fs.renameSync(temp,item.target);}else fs.unlinkSync(item.target);}catch(e){failures.push(e.message);}
      if(failures.length)throw Error('Nhập thất bại; khôi phục chưa hoàn tất. Bản sao lưu: '+dir+' · '+failures.join('; '));throw error;
    }finally{for(const item of prepared)if(fs.existsSync(item.temp))fs.unlinkSync(item.temp);}
    return {catalog:prompts.readCatalog(systemFile),documents:keys,backup:path.relative(root,dir).replace(/\\/g,'/')};
  }
  return {exported,preview,apply,validateLibrary};
}
module.exports={createStore};
