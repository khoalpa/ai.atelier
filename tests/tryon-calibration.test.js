const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app/public/app.js','utf8');
const code=source.slice(source.indexOf('async function calibrateQuality()'),source.indexOf('async function buildGoldenBaseline()'));
const controls=Object.fromEntries(['minimumQuality','minimumSimilarity','minimumSeam','minimumAnatomy'].map(id=>[id,{value:99}]));
let result={ok:true,qualityVersion:1,calibrationReady:true,approvedCount:20,recommendation:{minimumQuality:60,minimumSimilarity:.5,minimumSeam:65,minimumAnatomy:90}},message;
const context={$:id=>controls[id],setMessage:(text,kind)=>{message=kind;},fetch:async()=>({ok:true,json:async()=>result})};
vm.createContext(context);vm.runInContext(code,context);
(async()=>{
  await context.calibrateQuality();assert.equal(controls.minimumQuality.value,99);assert.equal(message,'warning');
  result={...result,qualityVersion:2,calibrationReady:false,approvedCount:3};
  await context.calibrateQuality();assert.equal(controls.minimumQuality.value,99);
  result={...result,calibrationReady:true,approvedCount:10};
  await context.calibrateQuality();assert.equal(controls.minimumQuality.value,60);assert.equal(message,'success');
  console.log('OK: legacy and insufficient reviews cannot silently change the live v2 quality thresholds.');
})().catch(error=>{console.error(error);process.exitCode=1;});
