const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {createStore}=require('../app/json-config-store');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-json-')),project=path.resolve(__dirname,'..');
const original=createStore();
for(const item of original.list()){const target=path.join(root,item.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(project,item.path),target);}
const store=createStore(root,path.join(root,'workspace/prompts.json'));
try{
  assert.equal(store.list().length,7);
  for(const item of store.list())assert(store.validate(item.id,store.read(item.id).data));
  assert.throws(()=>store.read('../config'));assert.throws(()=>store.read('workspace/config.json'));
  const before=store.read('prompts'),data=structuredClone(before.data);data.uiPlaceholders.librarySearch='Updated editor value';
  const preview=store.preview('prompts',data,before.revision);assert.equal(preview.changeCount,1);assert.equal(store.read('prompts').revision,before.revision);assert.equal(store.read('prompts').backups.length,0);
  const saved=store.save('prompts',data,before.revision);assert(saved.saved);assert.equal(saved.data.uiPlaceholders.librarySearch,data.uiPlaceholders.librarySearch);assert.equal(saved.backups.length,1);
  const backup=JSON.parse(fs.readFileSync(path.join(root,'workspace/backups/json-config/prompts',saved.backup),'utf8'));assert.deepEqual(backup,before.data);
  assert.throws(()=>store.save('prompts',before.data,before.revision),/thay đổi/);
  assert.throws(()=>store.restore('prompts','../../config.json',saved.revision));
  const restored=store.restore('prompts',saved.backup,saved.revision);assert.deepEqual(restored.data,before.data);assert.equal(restored.backups.length,2);
  const unchanged=store.save('prompts',restored.data,restored.revision);assert.equal(unchanged.saved,false);assert.equal(unchanged.backups.length,2);
  for(const [id,data] of [['prompts',{}],['config',{featureModels:[]}],['registry',{schemaVersion:1,models:[{id:'x',name:'X'}]}],['sources',{schemaVersion:1,candidates:[{id:'x',name:'x'},{id:'x',name:'x'}]}],['theme-project',{version:'1',project:'x',theme:'missing',mode:'dark',style:'minimal',density:'compact'}],['theme-tokens',{themes:{}}]]){
    const current=store.read(id);assert.throws(()=>store.save(id,data,current.revision));assert.equal(store.read(id).revision,current.revision);
  }
  const malicious=JSON.parse('{"__proto__":{"polluted":true}}');assert.throws(()=>store.validate('config',malicious));assert.equal({}.polluted,undefined);
  const config=store.read('config');config.data.editorTest='Unicode: ánh sáng "quoted"\nNew line';assert.equal(store.save('config',config.data,config.revision).data.editorTest,config.data.editorTest);
  console.log('OK: all seven documents, preview, atomic backups, restore, stale rejection, validation and path allowlist.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
