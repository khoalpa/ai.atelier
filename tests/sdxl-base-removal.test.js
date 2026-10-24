const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'app/server.js'),'utf8');
const body=server.slice(server.indexOf('function modelOperationalState('),server.indexOf('function listModels('));
for(const present of [false,true]){
 const context={ROOT:root,path,process:{env:{}},readLocalConfig:()=>({}),fs:{existsSync:()=>present}};
 vm.createContext(context);vm.runInContext(body,context);
 for(const id of ['ip-adapter-sdxl','controlnet-depth-sdxl-small','controlnet-union-sdxl-1.0']){
  const result=context.modelOperationalState({id},{ready:true});
  assert.equal(result.operationalReady,present);
  if(!present)assert.match(result.runtimeReason,/SDXL Base/);
 }
 assert.equal(context.modelOperationalState({id:'catvton'},{ready:true}).operationalReady,true);
}
console.log('OK: missing SDXL base blocks its adapters while other models remain usable.');
