const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app/public/app.js'),'utf8');
const server=fs.readFileSync(path.join(root,'app/server.js'),'utf8');
const extract=(text,start,end)=>text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)));
(async()=>{
  const elements={tryonModelSelect:{value:'idm-vton'},tryonModelHint:{}};
  let models=[{id:'catvton',name:'CatVTON',ready:true,registered:true,operationalReady:true},
              {id:'idm-vton',name:'IDM-VTON',ready:true,registered:true,operationalReady:true}];
  const context=vm.createContext({$:id=>elements[id],escapeHtml:s=>s,refreshStudioReadiness(){},
    fetch:async()=>({ok:true,json:async()=>({ok:true,features:[{id:'virtual-tryon',models}]})})});
  vm.runInContext(extract(source,'async function loadTryonModelOptions(){','function refreshStudioReadiness(){'),context);
  await context.loadTryonModelOptions();
  assert.equal(elements.tryonModelSelect.value,'idm-vton');
  assert.match(elements.tryonModelSelect.innerHTML,/value="idm-vton">IDM-VTON · sẵn sàng/);
  models[1]={...models[1],operationalReady:false,runtimeReason:'Thiếu DensePose'};
  await context.loadTryonModelOptions();
  assert.equal(elements.tryonModelSelect.value,'catvton');
  assert.match(elements.tryonModelSelect.innerHTML,/disabled>IDM-VTON · Thiếu DensePose/);
  for(const start of ['async function runTryon()', 'async function runBatchTryon()']){
    const code=source.slice(source.indexOf(start),source.indexOf(start)+2400);
    assert.match(code,/modelId/,'Both single and batch requests must carry the selected model');
    assert.match(code,/garmentDescription/,'Both single and batch requests must carry an optional IDM garment description');
  }
  const runtime=extract(server,'modelOperationalState=function(entry,checked){','const MODEL_DISPLAY_METADATA=');
  const evaluate=(denseposeExists)=>{
    const scope=vm.createContext({ROOT:root,path,process:{env:{}},readLocalConfig:()=>({}),
      modelOperationalStateStrict:()=>({operationalReady:true}),
      fs:{existsSync:file=>denseposeExists||!file.endsWith('.torchscript'),statSync:()=>({size:2000000})}});
    vm.runInContext(runtime,scope);
    return scope.modelOperationalState({id:'idm-vton'},{ready:true,resolvedPath:path.join(root,'models/tryon/IDM-VTON')});
  };
  assert.equal(evaluate(true).operationalReady,true);
  assert.equal(evaluate(false).operationalReady,false);
  assert.match(evaluate(false).runtimeReason,/DensePose/);
  console.log('OK: model selection, missing dependencies, and single/batch payload routing.');
})().catch(error=>{console.error(error);process.exitCode=1;});
