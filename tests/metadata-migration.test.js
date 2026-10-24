'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const metadata=require('../packages/storage/metadata');
async function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-metadata-'));try{const home=path.join(root,'workspace');fs.mkdirSync(home);const put=(key,value)=>{const file=path.join(home,key);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));return file;};await fn({root,home,put});}finally{metadata.close(path.join(root,'workspace'));assert(root.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});}}
test('migration verifies original records, keeps rollback copies and is idempotent',()=>fixture(async({home,put})=>{
 const file=put('asset-catalog.json',{version:1,assets:{photo:{name:'Ảnh'}},albums:['A']});put('jobs/one.json',{jobId:'one',status:'completed'});
 const result=metadata.migrate(home);assert.equal(result.documents,2);assert.equal(metadata.migrate(home).alreadyActive,true);assert(fs.existsSync(path.join(result.backup,'manifest.json')));
 metadata.update(file,value=>({...value,albums:['A','B']}));assert.deepEqual(metadata.read(file).albums,['A','B']);assert.deepEqual(JSON.parse(fs.readFileSync(file)).albums,['A']);
 metadata.exportLegacy(home);assert.deepEqual(JSON.parse(fs.readFileSync(file)).albums,['A','B']);assert.equal(metadata.status(home).active,false);
}));
test('invalid JSON never activates a partially migrated store',()=>fixture(async({home,put})=>{const file=put('asset-catalog.json',{});fs.writeFileSync(file,'invalid');assert.throws(()=>metadata.migrate(home));assert(!fs.existsSync(path.join(home,'metadata.sqlite3')));assert.equal(fs.readFileSync(file,'utf8'),'invalid');}));
test('new queue and manual revisions enumerate from SQLite without legacy files',()=>fixture(async({root,home,put})=>{
 metadata.migrate(home);const store=require('../app/work-queue-store').createQueueStore(root),q=await store.action({action:'create',kind:'character',items:[{name:'A',payload:{}}]});
 assert.equal((await store.list())[0].id,q.id);assert(!fs.existsSync(path.join(home,'work-queue',q.id+'.json')));
 const id='00000000-0000-0000-0000-000000000001',version=path.join(home,'manual/versions',id,'1.json'),head=path.join(home,'manual/projects',id+'.json');
 metadata.batchWrite([[version,{id,revision:1}],[head,{id,revision:1}]]);assert.deepEqual(metadata.entries(path.dirname(version)),['1.json']);
 assert.throws(()=>metadata.batchWrite([[head,{revision:2}],[path.join(home,'config.json'),{}]]));assert.equal(metadata.read(head).revision,1);
}));
test('backup and restore preserve migrated records and new records with no JSON mirrors',()=>fixture(async({root,home,put})=>{
 put('asset-catalog.json',{version:1,assets:{},albums:[]});metadata.migrate(home);const file=path.join(home,'asset-catalog.json');metadata.write(file,{version:1,assets:{},albums:['Saved']});
 const store=require('../app/backup-store').createBackupStore(root),saved=await store.create('working');assert(saved.manifest.entries.some(e=>e.path==='workspace/asset-catalog.json'));assert(!saved.manifest.entries.some(e=>e.path==='workspace/metadata.sqlite3'));
 metadata.write(file,{version:1,assets:{},albums:['Changed']});metadata.write(path.join(home,'jobs/new.json'),{jobId:'new',status:'completed'});
 const restored=await store.restore(saved.name);assert.deepEqual(metadata.read(file).albums,['Saved']);assert.equal(metadata.read(path.join(home,'jobs/new.json')).status,'completed');assert(restored.safetyBackup);
}));
test('Python execution records are immediately visible to the Node repository',()=>fixture(async({home})=>{
 metadata.migrate(home);const file=path.join(home,'jobs/python-job.json'),root=path.resolve(__dirname,'..');
 execFileSync(path.join(root,'.venv-sam2/Scripts/python.exe'),['-c',"from services.ai.runtime import metadata; import sys; metadata.write(sys.argv[1], {'jobId':'python-job','status':'completed'}); assert metadata.exists(sys.argv[1])",file],{cwd:root,env:{...process.env,PYTHONPATH:root},windowsHide:true});
 assert.equal(metadata.read(file).status,'completed');assert(metadata.entries(path.dirname(file)).includes('python-job.json'));assert(!fs.existsSync(file));
}));
