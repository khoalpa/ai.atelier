const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(path.join(__dirname,'../app/public/app.js'),'utf8');
const code=source.slice(source.indexOf('function activityProgress(state){'),source.indexOf('function closeGenerationProgress(){'));
const context={Date,Number,Math};vm.createContext(context);vm.runInContext(code,context);
const info=context.generationProgressInfo;
for(const taskType of ['inpaint','outpaint','text-to-image','tryon']){
  const load=info({taskType,status:'running',stage:'loading-model'});
  assert.equal(load.measured,false);assert.equal(load.progress,0);assert(Number.isNaN(load.eta));
  const running=info({taskType,status:'running',stage:'text-generating',completedSteps:12,totalWorkSteps:30});
  assert.equal(running.percent,40);
  const saving=info({taskType,status:'running',stage:'text-saving',completedSteps:30,totalWorkSteps:30});
  assert.equal(saving.percent,99);
  const failed=info({taskType,status:'failed',completedSteps:12,totalWorkSteps:30});
  assert.equal(failed.percent,40);assert.equal(failed.done,true);
  assert.equal(info({taskType,status:'completed'}).percent,100);
  assert.equal(info({taskType,status:'cancelled'}).percent,0);
}
console.log('OK: shared measured progress, indeterminate loading, failure/cancellation and completion.');

vm.runInContext(source.slice(source.indexOf('function jobProgress(job){'),source.indexOf('async function runJobAction(')),context);
const outpaint=context.jobProgress({taskType:'outpaint',status:'running',stage:'outpaint-seam-repair',currentVariant:1,totalVariants:2,completedSteps:25,totalWorkSteps:100});
assert.equal(outpaint.percent,25);assert.equal(outpaint.total,2);

const textImage=context.jobProgress({taskType:"text-to-image",status:"running",completedSteps:8,totalWorkSteps:40});
assert.equal(textImage.percent,20);assert.equal(textImage.current,8);assert.equal(textImage.total,40);
