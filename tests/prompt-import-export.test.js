const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const s=require('../app/prompt-store');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-import-')),file=path.join(dir,'prompts.json');
fs.copyFileSync(s.FILE,file);
try{
  const original=s.readCatalog(file),candidate=structuredClone(original);
  candidate.components[Object.keys(candidate.components)[0]]='New component: ánh sáng "quoted"\n${literal}';
  candidate.templates.removeObject='Please remove {subject}.';
  candidate.processingModes.background.prompt='Imported background instruction';
  candidate.presets.glasses.prompt='Imported glasses prompt';
  candidate.defaults.presets.glasses='Imported reset value';
  candidate.library[0].text='Imported library prompt';
  candidate.promptAssist.system='Imported assistant system instruction';
  candidate.ui.quickIdea1='Imported quick idea';
  const before=fs.readFileSync(file,'utf8'),preview=s.previewImport(candidate,file);
  assert.equal(fs.readFileSync(file,'utf8'),before);assert(!fs.existsSync(path.join(dir,'backups')));
  assert.equal(preview.summary.components,Object.keys(candidate.components).length);
  const imported=s.importCatalog(candidate,preview.revision,file);
  assert.deepEqual(imported,candidate);assert.deepEqual(s.readCatalog(file),candidate);
  const backups=fs.readdirSync(path.join(dir,'backups/prompts'));
  assert.equal(backups.length,1);assert.equal(fs.readFileSync(path.join(dir,'backups/prompts',backups[0]),'utf8'),before);
  s.savePresetPrompt({name:'glasses',reset:true},file);assert.equal(s.readCatalog(file).presets.glasses.prompt,'Imported reset value');
  const unchanged=fs.readFileSync(file,'utf8');
  assert.throws(()=>s.importCatalog(original,preview.revision,file),/thay đổi/);
  for(const change of [v=>v.schemaVersion=9,v=>delete v.components[Object.keys(v.components)[0]],v=>v.templates.removeObject='Remove {unknown}.',v=>v.tasks.bad={positive:{components:['missing']}},v=>v.tasks.bad=null,v=>v.defaults.presets.glasses=123,v=>v.presets.glasses.steps='bad',v=>v.extra='x'.repeat(s.MAX_IMPORT_BYTES)]){
    const invalid=structuredClone(original);change(invalid);assert.throws(()=>s.previewImport(invalid,file));
    assert.throws(()=>s.importCatalog(invalid,s.revision(s.readCatalog(file)),file));
    assert.equal(fs.readFileSync(file,'utf8'),unchanged);
  }
  const unsafe=JSON.parse(JSON.stringify(original).replace('"schemaVersion":1','"__proto__":{"polluted":true},"schemaVersion":1'));
  assert.throws(()=>s.previewImport(unsafe,file),/Tên trường/);assert.equal({}.polluted,undefined);
  // Browser migration history is local bookkeeping, not imported prompt data.
  s.updateCatalog(v=>{v.migrations=['local-browser'];},file);
  const fresh=s.previewImport(original,file);const restored=s.importCatalog(original,fresh.revision,file);
  assert.deepEqual(restored.migrations,['local-browser']);
  const expected=structuredClone(original);expected.migrations=['local-browser'];assert.deepEqual(restored,expected);
  console.log('OK: full import/export round-trip, read-only preview, original backup, imported defaults, invalid/stale rejection and local bookkeeping.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
