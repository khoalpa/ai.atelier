const assert=require('assert'),fs=require('fs'),vm=require('vm'),os=require('os'),path=require('path');
const fields={};
for(const id of ['outpaintSteps','outpaintGuidance','outpaintResolution','outpaintOverlap','outpaintPreset','outpaintCount','outpaintWidth','outpaintHeight','outpaintLeft','outpaintTop'])fields[id]={value:'',dataset:{}};
for(const id of ['outpaintPreserve','outpaintDetail','outpaintMaterialRefine','outpaintSeamRepair','outpaintSourceEnhance','outpaintChooseLayout'])fields[id]={checked:false};
Object.assign(fields,{outpaintModel:{value:'flux-1-fill-dev'},outpaintEstimate:{},outpaintRun:{},outpaintCount:{value:'2'},outpaintWidth:{value:'1536'},outpaintHeight:{value:'1024'},outpaintLeft:{value:'256'},outpaintTop:{value:'0'}});
const context={$:id=>fields[id],sourceImage:{naturalWidth:1024,naturalHeight:1024}};
vm.createContext(context);vm.runInContext(require('./helpers/source').read('app/public/outpaint.js','utf8'),context);
vm.runInContext('outpaintServiceReady=true',context);
fields.outpaintPreserve.checked=true;fields.outpaintChooseLayout.checked=true;
context.applyOutpaintPreset('fast');assert.equal(fields.outpaintSteps.value,'24');assert(!fields.outpaintDetail.checked);
context.applyOutpaintPreset('balanced');assert(fields.outpaintDetail.checked);assert(!fields.outpaintMaterialRefine.checked);
context.applyOutpaintPreset('detail');assert(fields.outpaintMaterialRefine.checked);assert.equal(fields.outpaintSteps.value,'50');
assert.equal(fields.outpaintCount.value,'2','quality must not change variant count');assert(fields.outpaintPreserve.checked);
assert.equal(fields.outpaintRun.textContent,'Tạo bố cục mở rộng');
const work=context.estimateOutpaintWork({width:1536,height:1024},{side:1024,steps:50,count:4,seam:true,detail:true,fabric:true,layout:true});
assert.equal(work.total,200);assert(work.finish>0);
const full=context.estimateOutpaintWork({width:1536,height:1024},{side:1024,steps:50,count:4,seam:true,detail:true,fabric:true,layout:false});
assert(full.total>work.total+work.finish,'refine one selected variant saves work');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'outpaint-timing-'));
try{
  const jobs=[1,2,3].map(n=>({jobId:'test-'+n,taskType:'outpaint',status:'completed',durationSeconds:n*100,totalWorkSteps:100}));
  for(const j of jobs)fs.writeFileSync(path.join(folder,j.jobId+'.request.json'),JSON.stringify({modelId:'flux-1-fill-dev',maxSide:768}));
  const timings=require('../app/outpaint-timing').outpaintTiming([...jobs,{...jobs[0],jobId:'../invalid'}],folder);
  assert.equal(timings.length,1);assert.equal(timings[0].secondsPerStep,2);assert.equal(timings[0].sampleCount,3);
  assert.equal(require('../app/outpaint-timing').outpaintTiming(jobs.slice(0,2),folder)[0].secondsPerStep,1.5);
  context.calibration=timings;vm.runInContext('outpaintTiming=calibration',context);fields.outpaintResolution.value='768';
  context.refreshOutpaintEstimate();assert(fields.outpaintEstimate.textContent.includes('3 lần chạy'));
}finally{fs.rmSync(folder,{recursive:true,force:true});}
console.log('OK: quality presets independent of count/preservation; layout cost; calibrated timing and invalid history.');
