const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict');
const {createStore}=require('../app/catalog-transfer-store'),prompts=require('../app/prompt-store');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-package-')),file=path.join(root,'workspace/prompts.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(prompts.FILE,file);
const store=createStore(root,file);
try{
  const system=store.exported('system');assert(system.system);assert(!system.libraries);
  const libraries=store.exported('libraries');assert(!libraries.system);assert.equal(Object.keys(libraries.libraries).length,4);
  const full=store.exported('all'),preview=store.preview(full);assert.equal(preview.documents.length,5);
  const original=fs.readFileSync(file,'utf8');assert.equal(store.preview(full).documents.length,5);assert.equal(fs.readFileSync(file,'utf8'),original);
  const imported=structuredClone(full);imported.system.uiPlaceholders.librarySearch='Package import';imported.libraries.character.items=[{id:'pose',name:'Saved pose',joints:Array.from({length:17},()=>[.5,.5,.9])}];
  const result=store.apply(imported,preview.revisions);assert.equal(result.catalog.uiPlaceholders.librarySearch,'Package import');assert.equal(store.exported('libraries').libraries.character.items.length,1);assert(fs.readdirSync(path.join(root,result.backup)).some(name=>name.endsWith('.json')));
  assert.throws(()=>store.apply(full,preview.revisions),/thay đổi/);
  const invalid=structuredClone(full);invalid.libraries.color=[{id:'x',name:'x',adjustments:{bad:5}}];assert.throws(()=>store.preview(invalid));
  const unknown=structuredClone(full);unknown.libraries['../../config']={};assert.throws(()=>store.preview(unknown));
  // A failed atomic catalog replacement preserves system and all libraries.
  const candidate=store.exported('all');candidate.system.uiPlaceholders.librarySearch='Should roll back';candidate.libraries.character.items=[];
  const expected=store.exported('all'),revisions=store.preview(candidate).revisions,rename=fs.renameSync;let writes=0;
  fs.renameSync=(a,b)=>{if(String(a).endsWith('.tmp')&&++writes===1)throw Error('Injected atomic commit failure');return rename(a,b);};
  try{assert.throws(()=>store.apply(candidate,revisions),/Injected/);}finally{fs.renameSync=rename;}
  assert.deepEqual(store.exported('all'),expected);
  const personalBefore=store.exported('libraries');const onlySystem=store.exported('system');onlySystem.system.uiPlaceholders.librarySearch='System only';store.apply(onlySystem,store.preview(onlySystem).revisions);assert.deepEqual(store.exported('libraries'),personalBefore);
  console.log('OK: scoped packages, exact libraries, validation, stale protection and multi-document rollback.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
