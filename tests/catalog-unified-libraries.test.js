'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const prompts=require('../app/prompt-store');
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-unified-')),home=path.join(root,'workspace'),file=path.join(home,'prompts.json');fs.mkdirSync(home);
  try{
    const initial=structuredClone(prompts.readCatalog());initial.personalLibraries.character={ok:true,version:1,items:[]};fs.writeFileSync(file,JSON.stringify(initial));
    const character=require('../app/character-presets'),legacy=path.join(home,'character-presets.json');
    character.save(legacy,{name:'Unified pose',joints:Array.from({length:17},()=>[.5,.5,1])});
    assert.equal(character.read(legacy).items.at(-1).name,'Unified pose');assert(!fs.existsSync(legacy));
    assert.deepEqual(prompts.readCatalog(file).personalLibraries.makeup,initial.personalLibraries.makeup);
    const exports=require('../app/export-presets').createExportPresets(root),before=await exports.list();
    await exports.save({name:'Unified export',spec:before[0].spec});assert.equal((await exports.list()).at(-1).name,'Unified export');assert(!fs.existsSync(path.join(home,'export-presets.json')));
    const anatomy=require('../app/anatomy-parts-store').create(root),parts=anatomy.read();anatomy.write({items:[parts.items[0]]});assert.equal(anatomy.read().items.length,1);assert.equal(anatomy.reset().items.length,parts.items.length);assert(!fs.existsSync(path.join(home,'anatomy-parts.json')));
    const imported=structuredClone(prompts.readCatalog(file));delete imported.personalLibraries;
    prompts.importCatalog(imported,prompts.revision(prompts.readCatalog(file)),file);assert.equal(character.read(legacy).items.length,1);
    const invalid=structuredClone(prompts.readCatalog(file));invalid.personalLibraries.character.items[0].joints=[];assert.throws(()=>prompts.validate(invalid));
    console.log('OK: unified library writes, isolated group updates, anatomy reset, legacy imports and validation.');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
