'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {bundle}=require('../scripts/bundle-samples');
test('demo bundle excludes private fixtures and update preserves existing sample IDs',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-sample-pack-'));
 try{
  const root=path.join(temp,'source'),release=path.join(temp,'release'),installed=path.join(temp,'installed');
  const put=(base,file,data)=>{const target=path.join(base,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);};
  const digest=crypto.createHash('sha256').update('demo').digest('hex');
  put(root,'samples/demo/a.png','demo');put(root,'samples/testing/private.png','private');put(root,'samples/licenses/credits.json','{}');
  put(root,'samples/catalog.json',JSON.stringify({schemaVersion:2,assets:[{id:'demo-a',path:'demo/a.png',sha256:digest,storage:'samples',roles:['demo'],provenance:{redistributable:true}},{id:'private',path:'testing/private.png',storage:'samples',roles:['regression'],provenance:{redistributable:false}}]}));
  put(root,'samples/aliases.json',JSON.stringify({aliases:{'old-demo':'demo-a','private':'private'}}));
  assert.equal(bundle(root,path.join(release,'samples')).demo,1);
  assert(!fs.existsSync(path.join(release,'samples/testing/private.png')));
  put(installed,'samples/legacy.png','historical-original');
  const script=path.resolve(__dirname,'../scripts/install-samples.ps1');
  execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-SourceRoot',release,'-TargetRoot',installed],{windowsHide:true});
  const samples=require('../packages/samples/catalog');
  assert.equal(fs.readFileSync(samples.resolve(installed,'legacy.png'),'utf8'),'historical-original');
  assert.equal(fs.readFileSync(samples.resolve(installed,'old-demo'),'utf8'),'demo');
  assert.equal(samples.images(installed).length,1);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
