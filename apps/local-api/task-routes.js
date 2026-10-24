'use strict';
const {tasks}=require('../../packages/contracts/jobs');
module.exports=function createTaskRoutes(deps){
 return async function taskRoutes(req,res,url){
  if(url.pathname!=='/api/tasks'&&!url.pathname.startsWith('/api/tasks/'))return false;
  try{
   if(req.method==='POST'&&url.pathname==='/api/tasks'){
    if(deps.webRestartPending||deps.serviceManager.busy())throw Error('Dịch vụ đang khởi động lại.');
    const body=await deps.parseJson(req),task=tasks[body.kind];if(!task)throw Error('Loại tác vụ không hợp lệ.');
    const result=await deps.taskCoordinator.enqueue(task.route,{...body.payload,...(body.jobId?{jobId:body.jobId}:{})});
    deps.send(res,202,JSON.stringify(result));
   }else{
    const [, , ,jobId,action]=url.pathname.split('/');
    if(req.method==='GET'&&jobId&&!action)deps.send(res,200,JSON.stringify(await deps.taskCoordinator.status(jobId)));
    else if(req.method==='POST'&&jobId&&action==='cancel')deps.send(res,200,JSON.stringify(await deps.taskCoordinator.cancel(jobId)));
    else {deps.send(res,404,JSON.stringify({ok:false,error:'Không tìm thấy thao tác.'}));}
   }
  }catch(error){deps.send(res,400,JSON.stringify({ok:false,error:error.message}));}
  return true;
 };
};
