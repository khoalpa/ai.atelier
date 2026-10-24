'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const samples=require('../packages/samples/catalog');
test('explicitly curated synthetic demos are not hidden by filename heuristics',()=>{
 const {testAsset}=require('../app/asset-catalog');
 assert.equal(testAsset({id:'synthetic/data.png',sampleRole:'demo'}),false);
 assert.equal(testAsset({id:'synthetic/data.png'}),true);
});
test('curated listing keeps legacy IDs, archive links, and private fixtures out of demo',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-samples-'));
 try{
  const put=(name,bytes)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
  put('samples/demo/new.png','new');put('samples/testing/mask.png','mask');put('workspace/sample-archive/v1/old.jpg','old');
  put('samples/aliases.json',JSON.stringify({aliases:{'old-name.jpg':'private','duplicate.jpg':'private'}}));
  put('samples/catalog.json',JSON.stringify({schemaVersion:2,assets:[
   {id:'stable',path:'demo/new.png',label:'Demo',group:'People',roles:['demo'],provenance:{synthetic:true}},
   {id:'mask',path:'testing/mask.png',roles:['regression']},
   {id:'private',path:'old.jpg',storage:'archive',roles:['archive']},
   {id:'bad',path:'../../secret.png',roles:['demo']}
  ]}));
  assert.deepEqual(samples.images(root).map(a=>a.id),['stable']);
  assert.equal(samples.resolve(root,'stable'),path.join(root,'samples/demo/new.png'));
  assert.equal(samples.resolve(root,'demo/new.png'),samples.resolve(root,'stable'));
  assert.equal(samples.resolve(root,'old-name.jpg'),samples.resolve(root,'duplicate.jpg'));
  assert.equal(fs.readFileSync(samples.resolve(root,'old-name.jpg'),'utf8'),'old');
  for(const id of ['../secret.png','C:/secret.png','bad','catalog.json','unknown.png'])assert.equal(samples.resolve(root,id),null,id);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('legacy installations without catalog continue to resolve samples',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-samples-'));
 try{fs.mkdirSync(path.join(root,'samples'));fs.writeFileSync(path.join(root,'samples/source.png'),'legacy');assert.ok(samples.resolve(root,'source.png'));assert.equal(samples.images(root),null);assert.equal(samples.resolve(root,'../source.png'),null);}
 finally{fs.rmSync(root,{recursive:true,force:true});}
});
