const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const C=require('../app/public/manual-core'),{createStore}=require('../app/manual-store'),exec=promisify(execFile),ROOT=path.resolve(__dirname,'..');
test('manual projects validate assets, keep immutable revisions, reject stale writes, and publish exact exports',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'atelier-manual-'));const store=createStore(root,{python:path.join(ROOT,'.venv-sam2','Scripts','python.exe'),script:path.join(ROOT,'scripts','manual-image-io.py')});
  try{
    const file=path.join(root,'fixture.png');await exec(path.join(ROOT,'.venv-sam2','Scripts','python.exe'),['-c',"from PIL import Image; import sys; im=Image.new('RGBA',(32,24),(30,90,180,128)); im.save(sys.argv[1])",file],{windowsHide:true});
    const encoded='data:image/png;base64,'+(await fs.readFile(file)).toString('base64'),asset=await store.importAsset({data:encoded,name:'fixture.png',sourceId:'fixture'});assert.equal(asset.width,32);assert.equal(asset.height,24);
    assert.deepEqual(await store.importAsset({data:encoded,name:'fixture.png',sourceId:'fixture'}),asset);
    const doc=C.create(asset);const first=await store.save({name:'First',document:doc});assert.equal(first.revision,1);
    doc.adjustments.temperature=15;const second=await store.save({id:first.id,revision:1,name:'Second',document:doc});assert.equal(second.revision,2);assert.equal((await store.load(first.id,1)).document.adjustments.temperature,0);
    await assert.rejects(store.save({id:first.id,revision:1,document:doc}),/cửa sổ khác/);assert.equal((await store.load(first.id)).revision,2);
    const output=await store.exportImage({id:first.id,revision:1,data:encoded});assert.match(output.url,/^\/outputs\/manual\/.*\/result.png$/);assert.equal(output.width,32);assert.deepEqual(await fs.readFile(path.join(root,'workspace',output.url.slice(1))),await fs.readFile(file));
    const meta=JSON.parse(await fs.readFile(path.join(root,'workspace',path.dirname(output.url.slice(1)),'metadata.json'),'utf8'));assert.equal(meta.projectId,first.id);assert.equal(meta.revision,1);
    assert.equal((await store.list()).length,1);assert.equal((await store.list())[0].name,'Second');
    assert.equal((await store.resolveOutput(output.url)).projectId,first.id);
    assert.equal((await store.versions(first.id)).length,2);
    await store.archive(first.id,true);assert.equal((await store.list()).length,0);assert.equal((await store.list({archived:true})).length,1);await store.archive(first.id,false);
    const creationKey=require('node:crypto').randomUUID(),created=await store.save({creationKey,document:C.create(asset)});assert.equal((await store.save({creationKey,document:C.create(asset)})).id,created.id);
    const exportId=require('node:crypto').randomUUID(),once=await store.exportImage({id:created.id,revision:1,exportId,data:encoded});assert.equal((await store.exportImage({id:created.id,revision:1,exportId,data:encoded})).url,once.url);
    const advanced=C.create(asset);advanced.selection={shapes:[],feather:0,maskUrl:asset.url};advanced.background={maskUrl:asset.url,mode:'transparent',strokes:[],shadow:{opacity:.3,blur:4,x:2,y:2}};advanced.layers=[{id:'adjust',type:'adjustment',name:'Vùng',x:0,y:0,width:32,height:24,rotation:0,opacity:1,visible:true,locked:true,mask:[],selection:advanced.selection,adjustments:{...C.defaults(),brightness:20}}];const checked=await store.document(advanced);assert(checked.layers[0].locked);assert.equal(checked.layers[0].selection.maskUrl,asset.url);assert.equal(checked.background.shadow.opacity,.3);assert.equal(checked.background.decontaminate,0);advanced.background.decontaminate=75;assert.equal((await store.document(advanced)).background.decontaminate,75);advanced.background.decontaminate=101;await assert.rejects(store.document(advanced));delete advanced.background.decontaminate;
    const preset=await store.presets({name:'Warm',adjustments:doc.adjustments});assert.equal((await store.presets())[0].id,preset.id);
    const invalid=structuredClone(doc);invalid.source.url='/manual-assets/../../secret.png';await assert.rejects(store.save({document:invalid}));
    invalid.source=asset;invalid.source.width=31;await assert.rejects(store.save({document:invalid}),/Kích thước/);
    await assert.rejects(store.importAsset({url:'/uploads/../../secret.png'}));await assert.rejects(store.importAsset({url:'https://example.com/image.png'}));await assert.rejects(store.importAsset({data:'data:image/png;base64,YWJj'}));
    const layerDoc=C.create({...asset,width:32});layerDoc.layers=[{id:'x',type:'text',name:'X',x:0,y:0,width:8192,height:8192,rotation:0,opacity:1,visible:true,text:'X',color:'#ffffff',fontSize:12,mask:[]}];await assert.rejects(store.document(layerDoc),/triệu pixel/);
    await assert.rejects(store.load('../outside'));assert.equal((await store.load(first.id)).revision,2);
    const valid=C.create({...asset,width:32});
    const parallel=await Promise.allSettled([store.save({id:first.id,revision:2,name:'Writer one',document:valid}),store.save({id:first.id,revision:2,name:'Writer two',document:valid})]);assert.equal(parallel.filter(x=>x.status==='fulfilled').length,1);assert.equal(parallel.filter(x=>x.status==='rejected').length,1);assert.equal((await store.load(first.id)).revision,3);
    valid.strokes=[{tool:'paint',points:[{x:2,y:2}],size:4,opacity:1,softness:0,color:'#ffffff',selection:{feather:0,shapes:[{type:'rect',mode:'replace',points:[{x:1,y:1}]}]}}];await assert.rejects(store.document(valid),/thiếu điểm/);
  }finally{const resolved=path.resolve(root);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));assert(path.basename(resolved).startsWith('atelier-manual-'));await fs.rm(resolved,{recursive:true,force:true});}
});
