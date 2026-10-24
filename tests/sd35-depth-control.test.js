const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=require('./helpers/source').read(path.join(root,'app/server.js'),'utf8');
const body=source.slice(source.indexOf('function sd35DepthOperationalState('),source.indexOf('function listModels('));
for(const present of [false,true]){
 const context={ROOT:root,path,process:{env:{}},readLocalConfig:()=>({}),fs:{existsSync:()=>present}};vm.createContext(context);vm.runInContext(body,context);
 const state=context.modelOperationalState({id:'controlnet-depth-sd35-large'},{ready:present});assert.equal(state.operationalReady,present);
 if(!present)assert.ok(state.runtimeMissing.length>=5);
 assert.equal(context.modelOperationalState({id:'catvton'},{ready:true}).operationalReady,true);
}
const client=require('./helpers/source').read(path.join(root,'app/public/app.js'),'utf8');const gate=client.slice(client.indexOf('function textControlUnavailableReason('),client.indexOf('function updateTextToImagePipeline('));
const context={modelInventory:[]};vm.createContext(context);vm.runInContext(gate,context);assert.ok(context.textControlUnavailableReason());
context.modelInventory=[{id:'controlnet-depth-sd35-large',downloaded:true,operationalReady:true}];assert.equal(context.textControlUnavailableReason(),'');
context.modelInventory[0].operationalReady=false;assert.ok(context.textControlUnavailableReason());
console.log('PASS: SD3.5 depth readiness depends on its own models, without SDXL/IP-Adapter.');
