'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {atomic,read}=require('./asset-catalog');
const execute=require('node:util').promisify(require('node:child_process').execFile);
const digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
function createBackupStore(root,options={}){
  const home=path.join(root,'workspace','backups'),config=options.config||path.join(root,'workspace','config.json'),prompts=options.prompts||path.join(root,'workflows','prompts.json');
  const groups={settings:['config.json','asset-catalog.json','export-presets.json','character-presets.json','makeup-styles.json','manual/presets.json'],working:['config.json','asset-catalog.json','edit-history.json','library-removed.json','regions','export-presets.json','work-queue','character-presets.json','makeup-styles.json','manual/presets.json','review','masks','jobs','quality-learning','acceptance','manual']};
  let running=false;
  const python=options.python||path.join(root,'.venv-sam2/Scripts/python.exe'),sqliteScript=path.join(__dirname,'../scripts/backup-sqlite.py');
  const isSqlite=bytes=>bytes.subarray(0,16).toString()==='SQLite format 3\0';
  async function sqliteCopy(source,target){await execute(python,[sqliteScript,source,target],{windowsHide:true,timeout:120000,maxBuffer:1024*1024});}
  async function consistentBytes(file){const bytes=await fs.readFile(file);if(!isSqlite(bytes))return bytes;await fs.mkdir(home,{recursive:true});const snapshot=path.join(home,'.snapshot-'+crypto.randomUUID()+'.sqlite');try{await sqliteCopy(file,snapshot);return await fs.readFile(snapshot);}finally{await fs.unlink(snapshot).catch(()=>{});}}
  function safe(base,relative){if(typeof relative!=='string'||relative.includes('\\')||relative.split('/').some(x=>!x||x==='.'||x==='..')||path.isAbsolute(relative))throw Error('Đường dẫn trong bản sao lưu không hợp lệ.');const target=path.resolve(base,relative);if(!target.startsWith(path.resolve(base)+path.sep))throw Error('Đường dẫn vượt thư mục sao lưu.');return target;}
  async function walk(base,prefix=''){
    let entries;try{entries=await fs.readdir(base,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const result=[];for(const e of entries){if(e.isSymbolicLink()||['backups','reset-archive','diagnostics','releases','temp','runtime','__pycache__'].includes(e.name)||e.name.endsWith('.tmp')||/\.lock(?:\.recover)?$/.test(e.name)||/\.(sqlite3?|db)-(wal|shm|journal)$/i.test(e.name))continue;const rel=prefix?prefix+'/'+e.name:e.name,file=path.join(base,e.name);if(e.isDirectory())result.push(...await walk(file,rel));else if(e.isFile())result.push({path:rel,file});}return result;
  }
  async function sources(mode){
    if(!['settings','working','full'].includes(mode))throw Error('Phạm vi sao lưu không hợp lệ.');const entries=[];
    async function add(file,key){let stat;try{stat=await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return;throw e;}if(stat.isSymbolicLink())throw Error('Không sao lưu đường dẫn liên kết.');if(stat.isDirectory())entries.push(...(await walk(file)).map(x=>({...x,path:key+'/'+x.path})));else entries.push({path:key,file});}
    if(mode==='full'){await add(path.join(root,'workspace'),'workspace');await add(path.join(root,'samples'),'samples');}
    else for(const name of groups[mode])await add(path.join(root,'workspace',name),'workspace/'+name);
    await add(config,'configuration/config.json');await add(prompts,'configuration/prompts.json');
    return [...new Map(entries.map(e=>[e.path,e])).values()];
  }
  async function preview(mode='full'){const entries=await sources(mode);let bytes=0;for(const e of entries)bytes+=(await fs.stat(e.file)).size;return {mode,files:entries.length,bytes,includes:mode==='full'?['Ảnh nguồn, ảnh mẫu và ảnh kết quả','Phiên sửa, vùng chọn, lịch sử, hàng đợi','Cấu hình và dữ liệu đánh giá']:mode==='settings'?['Cấu hình, album và các bộ mẫu']:['Cấu hình, phiên sửa và lịch sử công việc'],excludes:['Model AI','Bản sao lưu cũ, kho phục hồi, gói phát hành và dữ liệu chẩn đoán',...(mode==='full'?[]:['Ảnh nguồn và ảnh kết quả ngoài phiên thủ công'])]};}
  async function create(mode='full'){
    if(running)throw Error('Đang có thao tác sao lưu hoặc khôi phục.');running=true;let staging;
    try{const name='backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'),dir=path.join(home,name);staging=dir+'.tmp';await fs.mkdir(staging,{recursive:true});const entries=[];
      for(const item of await sources(mode)){const bytes=await consistentBytes(item.file),target=safe(staging,item.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);entries.push({path:item.path,size:bytes.length,sha256:digest(bytes)});}
      const manifest={schemaVersion:3,mode,createdAt:new Date().toISOString(),entries,bytes:entries.reduce((n,x)=>n+x.size,0),restoreMode:'merge',excludes:(await preview(mode)).excludes};await atomic(path.join(staging,'backup-manifest.json'),manifest);await fs.rename(staging,dir);staging=null;return {name,backup:path.relative(root,dir),manifest};
    }finally{running=false;/* Incomplete .tmp backups stay excluded and can be inspected if disk writes fail. */}
  }
  async function list(){await fs.mkdir(home,{recursive:true});const items=[];for(const e of await fs.readdir(home,{withFileTypes:true})){if(!e.isDirectory()||!/^backup-[a-zA-Z0-9-]+$/.test(e.name))continue;const m=await read(path.join(home,e.name,'backup-manifest.json'),null).catch(()=>null);if(!m?.createdAt)continue;items.push({name:e.name,createdAt:m.createdAt,updatedAt:m.createdAt,mode:m.mode||'working',files:m.entries?.length??null,bytes:m.bytes??null,verifiedAt:m.verifiedAt||null,legacy:m.schemaVersion!==3});}return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  function backupPath(name){if(!/^backup-[a-zA-Z0-9-]+$/.test(name||''))throw Error('Tên bản sao lưu không hợp lệ.');return path.join(home,name);}
  function destination(relative){
    if(relative==='configuration/config.json')return config;if(relative==='configuration/prompts.json')return prompts;
    if(!/^(workspace|samples)\//.test(relative)||relative.split('/').some(x=>['backups','reset-archive','diagnostics'].includes(x)))throw Error('Nội dung khôi phục không được hỗ trợ.');return safe(root,relative);
  }
  async function inspect(name){const dir=backupPath(name),m=await read(path.join(dir,'backup-manifest.json'),null);if(!m)throw Error('Không tìm thấy bản sao lưu.');let entries=m.entries;
    if(m.schemaVersion!==3){entries=[];for(const [old,prefix]of [['review','workspace/review'],['masks','workspace/masks'],['jobs','workspace/jobs'],['manual','workspace/manual']])for(const x of await walk(path.join(dir,old)))entries.push({path:old+'/'+x.path,target:prefix+'/'+x.path});for(const [old,target]of [['config.json','configuration/config.json'],['prompts.json','configuration/prompts.json']])if(await fs.stat(path.join(dir,old)).catch(()=>null))entries.push({path:old,target});}
    if(!Array.isArray(entries)||entries.length>100000)throw Error('Danh sách tệp sao lưu không hợp lệ.');const seen=new Set();
    for(const e of entries){const file=safe(dir,e.path);destination(e.target||e.path);if(seen.has(e.path))throw Error('Tệp bị lặp trong bản sao lưu.');seen.add(e.path);const real=await fs.realpath(file);if(!real.startsWith(await fs.realpath(dir)+path.sep))throw Error('Bản sao lưu chứa liên kết không hợp lệ.');const bytes=await fs.readFile(file);if(m.schemaVersion===3&&(bytes.length!==e.size||digest(bytes)!==e.sha256))throw Error('Bản sao lưu bị thay đổi hoặc thiếu dữ liệu: '+e.path);}
    return {dir,manifest:m,entries};
  }
  async function verify(name){const {dir,manifest,entries}=await inspect(name);if(manifest.schemaVersion===3){manifest.verifiedAt=new Date().toISOString();await atomic(path.join(dir,'backup-manifest.json'),manifest);}return {name,verified:manifest.schemaVersion===3,legacy:manifest.schemaVersion!==3,files:entries.length,message:manifest.schemaVersion===3?'Đã đối chiếu đầy đủ nội dung và checksum.':'Bản cũ đọc được nhưng không có checksum để xác minh toàn vẹn.'};}
  async function restore(name){
    if(running)throw Error('Đang có thao tác sao lưu hoặc khôi phục.');running=true;
    try{const {dir,manifest,entries}=await inspect(name),safetyName='backup-before-restore-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'),safety=path.join(home,safetyName),plan=[],savedEntries=[],seen=new Set();
      await fs.mkdir(safety,{recursive:true});
      // Finish the entire safety snapshot before changing any destination.
      for(const e of entries){const relative=e.target||e.path,target=destination(relative);if(seen.has(target))continue;seen.add(target);
        for(let ancestor=target;;ancestor=path.dirname(ancestor)){const stat=await fs.lstat(ancestor).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(stat?.isSymbolicLink())throw Error('Không khôi phục qua đường dẫn liên kết.');if(ancestor===path.dirname(ancestor))break;}
        const exists=await fs.stat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(exists&&!exists.isFile())throw Error('Đích khôi phục không phải tệp: '+relative);
        if(exists){const bytes=await consistentBytes(target),saved=safe(safety,relative);await fs.mkdir(path.dirname(saved),{recursive:true});await fs.writeFile(saved,bytes);savedEntries.push({path:relative,size:bytes.length,sha256:digest(bytes)});}
        plan.push({e,relative,target,existed:Boolean(exists)});
      }
      await atomic(path.join(safety,'backup-manifest.json'),{schemaVersion:3,mode:'safety',createdAt:new Date().toISOString(),from:name,entries:savedEntries,bytes:savedEntries.reduce((n,e)=>n+e.size,0),restoreMode:'merge'});
      const written=[];
      async function replace(target,bytes){await fs.mkdir(path.dirname(target),{recursive:true});const temp=target+'.restore-'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,bytes);if(isSqlite(bytes))await sqliteCopy(temp,target);else await fs.rename(temp,target);}finally{await fs.unlink(temp).catch(()=>{});}}
      try{for(const p of plan){const bytes=await fs.readFile(safe(dir,p.e.path));if(manifest.schemaVersion===3&&(bytes.length!==p.e.size||digest(bytes)!==p.e.sha256))throw Error('Tệp sao lưu thay đổi trong khi khôi phục.');await replace(p.target,bytes);written.push(p);}}
      catch(error){const failures=[];for(const p of written.reverse())try{if(p.existed)await replace(p.target,await fs.readFile(safe(safety,p.relative)));else await fs.unlink(p.target);}catch(rollbackError){failures.push(p.relative);}throw Error(error.message+(failures.length?' Không thể tự hoàn nguyên '+failures.length+' tệp. Khôi phục bản '+safetyName+'.':' Đã hoàn nguyên các tệp vừa thay đổi.'));}
      return {restored:name,files:plan.length,safetyBackup:path.relative(root,safety),message:'Đã khôi phục và giữ các mục mới chưa có trong bản sao lưu.'};
    }finally{running=false;}
  }
  return {preview,create,list,verify,restore};
}
module.exports={createBackupStore};
