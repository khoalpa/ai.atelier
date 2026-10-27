const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=require('./helpers/source').read(path.join(root,'app/server.js'),'utf8');
const body=source.slice(source.indexOf('function modelOperationalState('),source.indexOf('function listModels('));
for(const present of [false,true]){
 const context={ROOT:root,path,process:{env:{}},readLocalConfig:()=>({}),resolveModelPath:value=>path.resolve(root,value||''),fs:{existsSync:()=>present}};vm.createContext(context);vm.runInContext(body,context);
 const state=context.modelOperationalState({id:'qwen-image-controlnet-union',baseModelPath:'models/qwen/qwen-image'},{ready:present});assert.equal(state.operationalReady,present);
 if(!present)assert.ok(state.runtimeMissing.length>=8);
 assert.equal(context.modelOperationalState({id:'catvton'},{ready:true}).operationalReady,true);
}
console.log('PASS: Qwen depth readiness depends on its base and depth-estimator models.');
