const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'..');
const fields={};
for(const id of ['enhanceMethod','enhanceProfile','enhanceLevel','enhanceScope','enhanceDimensions','enhanceStatus','enhancePreview','enhanceRun','enhanceRefresh','enhancePreviewX','enhancePreviewY','studioContinueEnhance','skinRetouchControls','enhanceProfileRow','enhanceLevelRow','enhanceLevelLabel','enhancePreviewPosition','enhanceProtectionHint','skinSmooth','skinSmoothValue','skinRetouchHint','skinPreserveTexture','skinEdgeControls','edgeWidth','edgeWidthValue','edgeSoftness','edgeSoftnessValue','edgeDecontam','edgeDecontamValue','edgePickSkin','edgePickBackground','edgeClearPoints','edgePointsStatus'])fields[id]={value:'',addEventListener(){},setAttribute(){}};
Object.assign(fields.enhanceMethod,{value:'light'});fields.enhanceScope.value='all';fields.enhanceProfile.value='product';fields.enhanceLevel.value='light';fields.enhancePreviewX.value='25';fields.enhancePreviewY.value='75';
fields.edgeWidth.value='16';fields.edgeSoftness.value='50';fields.edgeDecontam.value='30';let selected=0; fields.skinSmooth.value='35';fields.skinPreserveTexture.checked=true;
const context={window:{},document:{getElementById:id=>fields[id]},sourceImage:{naturalWidth:3000,naturalHeight:2000},studioMode:'enhance',canvas:{scrollIntoView(){}},render(){},setMessage(){},canvasPoint:event=>({x:event.x,y:event.y}),current:{id:'uploads/test.png'},activeJobId:'',
    editableMaskStats:()=>({selected}),binaryMaskDataUrl:(invert,protect)=>protect?'protected-pixels':'selected-pixels',refreshStudioReadiness(){},
    fetch:async()=>({ok:true,json:async()=>({serviceReady:true,modelReady:true,skin:{version:1,modelReady:true},edgeVersion:1,maxPixels:16777216,maxSide:8192})})};
vm.createContext(context);vm.runInContext(require('./helpers/source').read(path.join(root,'app/public/image-enhancement.js'),'utf8'),context);
(async()=>{
  const api=context.window.ImageEnhancement;api.setup();await new Promise(setImmediate);
  assert(api.requirements(true,false).every(r=>r[1]));
  fields.enhanceMethod.value='ai2x';api.sync();
  assert.equal(fields.enhanceRun.disabled,true,'24MP full image must be blocked');
  assert.equal(fields.enhancePreview.disabled,false,'crop preview may still run');
  fields.enhanceScope.value='selected';
  assert.equal(api.requirements(true,false).find(r=>r[0]==='Vùng chỉnh sửa')[1],false);
  selected=10; const request=api.payload(true);
  assert.equal(request.sampleId,'uploads/test.png');assert.equal(request.protectedDetailMask,'protected-pixels');assert.equal(request.editableMask,'selected-pixels');
  assert.equal(request.preview,true);assert.equal(request.previewX,25);assert.equal(request.previewY,75);
  fields.enhanceScope.value='all';assert.equal(api.payload().editableMask,'');
  for(const method of ['skin-smooth','skin-heal','skin-ai']){
    fields.enhanceMethod.value=method;fields.enhanceScope.value='all';selected=0;api.sync();
    assert.equal(fields.enhanceScope.value,'selected');assert.equal(fields.enhanceScope.disabled,true);
    assert.equal(fields.enhancePreview.disabled,true);assert.equal(fields.enhanceRun.disabled,true);
    assert.throws(()=>api.payload(),/Tô vùng/);
    selected=10;api.sync();const skin=api.payload(true);
    assert.equal(fields.enhanceRun.disabled,false);assert.equal(fields.enhancePreview.disabled,false);
    assert.equal(skin.scope,'selected');assert.equal(skin.profile,'portrait');
    assert.equal(skin.skinSmooth,35);assert.equal(skin.preserveTexture,true);
    assert.equal(skin.editableMask,'selected-pixels');assert.equal(skin.protectedDetailMask,'protected-pixels');
  }
  fields.enhanceMethod.value='skin-edge';fields.enhanceScope.value='all';selected=0;api.sync();
  assert.equal(fields.enhancePreview.disabled,true);assert.equal(fields.enhanceScope.value,'selected');
  selected=10;api.sync();assert.equal(fields.enhanceRun.disabled,false);
  fields.edgePickSkin.onclick();let prevented=0;assert(api.captureEdgePoint({x:80,y:100,preventDefault(){prevented++;}}));
  api.sync();assert.equal(fields.enhanceRun.disabled,true,'one side must block both actions');
  assert.throws(()=>api.payload(),/hai điểm/);
  api.pickMissingPoint();assert(api.captureEdgePoint({x:280,y:100,preventDefault(){prevented++;}}));
  api.sync();assert.equal(fields.enhanceRun.disabled,false);
  const edge=api.payload(true);assert.equal(edge.edgeWidth,16);assert.equal(edge.edgeSoftness,50);assert.equal(edge.edgeDecontam,30);
  assert.equal(edge.edgeSkinPoint.x,80);assert.equal(edge.edgeBackgroundPoint.x,280);assert.equal(edge.edgeKeepShape,true);assert.equal(prevented,2);
  assert(!api.captureEdgePoint({x:1,y:1}),'normal paint must pass through');
  fields.edgeClearPoints.onclick();assert.equal(api.payload().edgeSkinPoint,null);assert.equal(api.payload().edgeBackgroundPoint,null);
  fields.edgePickSkin.onclick();context.studioMode='inpaint';assert.equal(api.captureEdgePoint({x:1,y:1}),false);context.studioMode='enhance';
  api.resetEdgeGuides();assert.equal(api.payload().edgeSkinPoint,null);
  context.fetch=async()=>({ok:true,json:async()=>({serviceReady:true,modelReady:true,skin:{version:1,modelReady:true}})});
  await fields.enhanceRefresh.onclick();assert.equal(fields.enhanceRun.disabled,true,'old service blocks edge even if skin is ready');
  fields.enhanceMethod.value='skin-ai';
  context.fetch=async()=>({ok:true,json:async()=>({serviceReady:true,modelReady:true,skin:{version:1,modelReady:false}})});
  await fields.enhanceRefresh.onclick();assert.equal(fields.enhanceRun.disabled,true);
  fields.enhanceMethod.value='skin-heal';api.sync();assert.equal(fields.enhanceRun.disabled,false);
  context.fetch=async()=>({ok:true,json:async()=>({serviceReady:true,modelReady:true})});
  await fields.enhanceRefresh.onclick();assert.equal(fields.enhanceRun.disabled,true,'old service must not run skin tools');
  fields.enhanceMethod.value='light';api.sync();assert.equal(fields.enhanceRun.disabled,false);
  assert.equal(fields.enhanceScope.disabled,false);
  context.activeJobId='other';api.sync();assert.equal(fields.enhancePreview.disabled,true);
  context.current=null;assert.throws(()=>api.payload(),/Chọn ảnh/);
  // Same history validator used by all result-continuation actions.
  const history=require('../app/edit-history-store');const os=require('os');const folder=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-enhancement-'));
  try{const file=path.join(folder,'history.json');history.append(file,{sourceId:'source',childId:'child',result:'/outputs/enhance/run/result_seed_0.png',task:'enhance'});assert.equal(history.read(file)[0].task,'enhance');assert.throws(()=>history.append(file,{sourceId:'a',childId:'b',result:'/outputs/../private.png',task:'enhance'}));}
  finally{fs.rmSync(folder,{recursive:true,force:true});}
  console.log('OK: enhancement readiness, preview budget, masks, busy state and continuation history.');
})().catch(error=>{console.error(error);process.exitCode=1;});
