'use strict';
// Migration requires both services stopped. Holding their ports prevents a
// launcher racing the one-time migration or export back to legacy JSON.
const path=require('node:path'),net=require('node:net'),storage=require('../packages/storage/metadata');
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const home=path.resolve(option('--workspace',path.join(__dirname,'../workspace'))),action=option('--action','status');
(async()=>{
 if(action==='status'){console.log(JSON.stringify(storage.status(home)));return;}
 if(!['migrate','export'].includes(action))throw Error('Dùng --action status, migrate hoặc export.');
 const locks=[];
 try{
  for(const port of [Number(option('--web-port',process.env.AI_IMAGE_PORT||7860)),Number(option('--ai-port',process.env.AI_SEGMENT_PORT||7861))]){
   const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',()=>reject(Error('Dừng dịch vụ trên cổng '+port+' trước khi chuyển dữ liệu.')));server.listen(port,'127.0.0.1',resolve);});locks.push(server);
  }
  console.log(JSON.stringify(action==='migrate'?storage.migrate(home):storage.exportLegacy(home),null,2));
 }finally{storage.close(home);for(const server of locks)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
