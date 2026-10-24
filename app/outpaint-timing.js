const fs=require('fs'),path=require('path');

function outpaintTiming(jobs,folder){
  const grouped=new Map();
  for(const job of jobs){
    if(job.taskType!=='outpaint'||job.status!=='completed'||!(job.durationSeconds>0)||!(job.totalWorkSteps>0)||!/^[\w-]+$/.test(job.jobId))continue;
    let request;try{request=require('../packages/storage/metadata').read(path.join(folder,job.jobId+'.request.json'));if(!request)continue;}catch{continue;}
    const modelId=String(request.modelId||job.modelId||''),maxSide=Number(request.maxSide||(/flux/i.test(modelId)?1024:768));
    const rate=job.durationSeconds/job.totalWorkSteps;
    if(!Number.isFinite(rate)||rate<=0||!modelId)continue;
    const key=modelId+':'+maxSide,group=grouped.get(key)||{modelId,maxSide,rates:[]};
    if(group.rates.length<5)group.rates.push(rate);
    grouped.set(key,group);
  }
  return [...grouped.values()].map(({modelId,maxSide,rates})=>{rates.sort((a,b)=>a-b);const middle=Math.floor(rates.length/2);return {modelId,maxSide,sampleCount:rates.length,secondsPerStep:rates.length%2?rates[middle]:(rates[middle-1]+rates[middle])/2};});
}
module.exports={outpaintTiming};
