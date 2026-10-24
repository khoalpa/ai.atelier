'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const connections=new Map();
const supported=key=>/^(asset-catalog\.json|library-removed\.json|edit-history\.json|acceptance\/suite\.json|regions\/[^/]+\.json|work-queue\/[a-f0-9-]+\.json|jobs\/[a-zA-Z0-9_-]+(?:\.(?:request|checkpoint))?\.json|manual\/(?:projects\/[^/]+|versions\/[^/]+\/\d+)\.json)$/.test(key);
function locate(file){
 const absolute=path.resolve(file);let dir=path.dirname(absolute);
 while(dir!==path.dirname(dir)){
  if(path.basename(dir)==='workspace'||fs.existsSync(path.join(dir,'metadata.sqlite3'))){const key=path.relative(dir,absolute).split(path.sep).join('/');return supported(key)?{home:dir,key}:null;}
  dir=path.dirname(dir);
 }
 return null;
}
function open(home){
 const file=path.join(home,'metadata.sqlite3');
 if(!fs.existsSync(file))return null;
 if(!connections.has(file)){
  const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=20000; PRAGMA foreign_keys=ON;');
  connections.set(file,db);
 }
 const db=connections.get(file);
 return db.prepare("SELECT value FROM metadata WHERE key='active'").get()?.value==='1'?db:null;
}
function connection(file){const found=locate(file);if(!found)return null;const db=open(found.home);return db?{...found,db}:null;}
function read(file,fallback){
 const c=connection(file);
 if(c){const row=c.db.prepare('SELECT data FROM documents WHERE key=?').get(c.key);return row?JSON.parse(row.data):fallback;}
 try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}
}
function write(file,value){
 const c=connection(file),data=JSON.stringify(value);
 if(c){put(c.db,c.key,data);return;}
 fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.'+crypto.randomUUID()+'.tmp';
 try{fs.writeFileSync(temporary,data);fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function put(db,key,data){
 const value=JSON.parse(data),kind=key.split('/')[0].replace('.json','');
 db.prepare(`INSERT INTO documents(key,kind,source_id,status,data,revision,updated_at) VALUES(?,?,?,?,?,1,?)
 ON CONFLICT(key) DO UPDATE SET source_id=excluded.source_id,status=excluded.status,data=excluded.data,revision=documents.revision+1,updated_at=excluded.updated_at`)
 .run(key,kind,String(value.sourceId||value.document?.source?.sourceId||''),String(value.status||''),data,new Date().toISOString());
}
function update(file,fn,fallback){
 const c=connection(file);if(!c){const value=fn(read(file,fallback));write(file,value);return value;}
 c.db.exec('BEGIN IMMEDIATE');try{const value=fn(read(file,fallback));put(c.db,c.key,JSON.stringify(value));c.db.exec('COMMIT');return value;}catch(e){c.db.exec('ROLLBACK');throw e;}
}
function entries(directory){
 const probe=connection(path.join(directory,/[/\\]manual[/\\]versions[/\\]/.test(directory)?'1.json':'00000000-0000-0000-0000-000000000000.json'));
 if(!probe)return fs.existsSync(directory)?fs.readdirSync(directory):[];
 const prefix=probe.key.slice(0,probe.key.lastIndexOf('/')+1);
 return probe.db.prepare('SELECT key FROM documents WHERE substr(key,1,?)=? ORDER BY key').all(prefix.length,prefix).map(r=>r.key.slice(prefix.length)).filter(n=>!n.includes('/'));
}
function exists(file){const c=connection(file);return c?!!c.db.prepare('SELECT 1 FROM documents WHERE key=?').get(c.key):fs.existsSync(file);}
function remove(file){const c=connection(file);if(c)c.db.prepare('DELETE FROM documents WHERE key=?').run(c.key);else if(fs.existsSync(file))fs.unlinkSync(file);}
function batchWrite(values){
 const first=values.length&&connection(values[0][0]);
 if(!first){for(const [file,value] of values)write(file,value);return;}
 first.db.exec('BEGIN IMMEDIATE');try{for(const [file,value] of values){const c=connection(file);if(!c||c.db!==first.db)throw Error('Các bản ghi phải thuộc cùng kho dữ liệu.');put(c.db,c.key,JSON.stringify(value));}first.db.exec('COMMIT');}catch(e){first.db.exec('ROLLBACK');throw e;}
}
function snapshot(home){const db=open(home);return db?db.prepare('SELECT key,data FROM documents ORDER BY key').all():[];}
function removeKeys(home,keys){const db=open(home);if(!db)return;db.exec('BEGIN IMMEDIATE');try{const remove=db.prepare('DELETE FROM documents WHERE key=?');for(const key of keys){if(!supported(key))throw Error('Đường dẫn dữ liệu không hợp lệ.');remove.run(key);}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
function close(home){for(const [file,db] of connections)if(!home||file===path.join(home,'metadata.sqlite3')){db.close();connections.delete(file);}}
function migrate(home){
 fs.mkdirSync(home,{recursive:true});
 if(open(home))return {alreadyActive:true,...status(home)};
 const target=path.join(home,'metadata.sqlite3');
 if(fs.existsSync(target)){close(home);fs.renameSync(target,target+'.inactive-'+crypto.randomUUID());}
 const records=[];
 function walk(dir,prefix=''){if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){const key=prefix+item.name;if(item.isDirectory()){if(['jobs','manual','projects','versions','acceptance','regions','work-queue'].includes(item.name)||prefix.startsWith('manual/versions/'))walk(path.join(dir,item.name),key+'/');}else if(supported(key)){const bytes=fs.readFileSync(path.join(dir,item.name));JSON.parse(bytes.toString('utf8'));records.push({key,bytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}}}
 walk(home);
 const stamp=new Date().toISOString().replace(/[:.]/g,'-'),backup=path.join(home,'backups','metadata-'+stamp);fs.mkdirSync(backup,{recursive:true});
 for(const r of records){const to=path.join(backup,r.key);fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,r.bytes);}
 fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),records:records.map(({key,sha256,bytes})=>({key,sha256,bytes:bytes.length}))},null,2));
 const staging=target+'.'+crypto.randomUUID()+'.tmp',db=new DatabaseSync(staging);
 try{
  db.exec(`PRAGMA synchronous=FULL; CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE documents(key TEXT PRIMARY KEY,kind TEXT NOT NULL,source_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT '',data TEXT NOT NULL CHECK(json_valid(data)),revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
   CREATE INDEX documents_kind ON documents(kind,status,updated_at); CREATE INDEX documents_source ON documents(source_id);
   BEGIN IMMEDIATE;`);
  for(const r of records)put(db,r.key,r.bytes.toString('utf8'));
  const metadata=db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)');metadata.run('schema','1');metadata.run('active','1');metadata.run('backup',backup);metadata.run('migratedAt',new Date().toISOString());
  db.exec('COMMIT');
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('SELECT count(*) AS n FROM documents').get().n!==records.length)throw Error('Không xác minh được kho dữ liệu sau chuyển đổi.');
  for(const r of records){if(db.prepare('SELECT data FROM documents WHERE key=?').get(r.key).data!==r.bytes.toString('utf8'))throw Error('Dữ liệu chuyển đổi không khớp: '+r.key);}
  db.close();fs.renameSync(staging,target);
 }catch(e){try{db.close();}catch{}throw e;}
 return {alreadyActive:false,backup,...status(home)};
}
function status(home){const db=open(home);return {active:!!db,schema:db?Number(db.prepare("SELECT value FROM metadata WHERE key='schema'").get().value):null,documents:db?db.prepare('SELECT count(*) AS n FROM documents').get().n:0};}
function exportLegacy(home){
 const db=open(home);if(!db)throw Error('Kho dữ liệu chưa được kích hoạt.');
 const rows=db.prepare('SELECT key,data FROM documents ORDER BY key').all();
 // Keep SQLite authoritative until every exported JSON file is durable.
 for(const row of rows){if(!supported(row.key))throw Error('Đường dẫn dữ liệu không hợp lệ.');const file=path.join(home,row.key);fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.export.tmp';fs.writeFileSync(temp,row.data);fs.renameSync(temp,file);}
 // Originals retained by migration may describe records deleted since then.
 // Archive these before switching back, otherwise legacy readers resurrect them.
 const keys=new Set(rows.map(row=>row.key)),archive=path.join(home,'backups','rollback-obsolete-'+crypto.randomUUID());
 function reconcile(dir,prefix=''){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   const key=prefix+entry.name,file=path.join(dir,entry.name);
   if(entry.isDirectory()&&['jobs','regions','work-queue','manual','projects','versions','acceptance'].includes(entry.name))reconcile(file,key+'/');
   else if(entry.isDirectory()&&prefix.startsWith('manual/versions/'))reconcile(file,key+'/');
   else if(entry.isFile()&&supported(key)&&!keys.has(key)){const to=path.join(archive,key);fs.mkdirSync(path.dirname(to),{recursive:true});fs.renameSync(file,to);}
  }
 }
 reconcile(home);
 db.prepare("UPDATE metadata SET value='0' WHERE key='active'").run();close(home);
 return {exported:rows.length,active:false};
}
module.exports={supported,locate,connection,read,write,update,batchWrite,entries,exists,remove,removeKeys,migrate,status,snapshot,exportLegacy,close,open};
process.once('exit',()=>close());
