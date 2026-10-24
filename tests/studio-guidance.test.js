const assert=require('assert'),fs=require('fs'),vm=require('vm'),os=require('os'),path=require('path');
const context={window:{},localStorage:{getItem:()=>null},Date,Number,Math};vm.createContext(context);vm.runInContext(require('./helpers/source').read(path.join(__dirname,'../app/public/studio-guidance.js'),'utf8'),context);
const guide=context.window.StudioGuidance;
assert(guide.recovery('CUDA out of memory').includes('Giảm kích thước'));
assert(guide.recovery('Failed to fetch').includes('trùng'));
assert.equal(guide.recommendations(['seam','unknown','texture']).length,2);
assert(guide.recommendations(['color'])[0].includes('trung tính'));
assert(guide.stageHint({status:'running',stage:'loading-model',updatedAt:new Date().toISOString()}).includes('nạp'));
assert(guide.stageHint({status:'running',stage:'result',updatedAt:new Date(Date.now()-310000).toISOString()}).includes('5 phút'));
assert(guide.stageHint({status:'cancelling'}).includes('điểm an toàn'));
const state={taskType:'tryon',model:'catvton',width:512,height:512,totalWorkSteps:20,startedAt:new Date(Date.now()-10000).toISOString()};
assert(Number.isNaN(guide.historyEta([],state)));
const records=[40,50,90].map(seconds=>({...state,seconds}));assert(Math.abs(guide.historyEta(records,state)-40)<1);
assert(Number.isNaN(guide.historyEta(records,{...state,model:'other'})));
const store=require('../app/edit-history-store'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-history-')),file=path.join(directory,'history.json');
try{
  assert.equal(store.read(file).length,0);
  store.append(file,{sourceId:'original',childId:'child',result:'/outputs/run/seed_1.png',task:'tryon'});
  store.append(file,{sourceId:'original',childId:'second',result:'/outputs/run/seed_2.png',task:'inpaint'});
  assert.equal(store.read(file).length,2);assert.equal(store.read(file)[1].sourceId,'original');
  for(const result of ['https://example.com/a.png','/outputs/../secret','data:image/png;base64,x'])assert.throws(()=>store.append(file,{sourceId:'a',childId:'b',result,task:'tryon'}));
  assert.equal(store.read(file).length,2);
}finally{fs.rmSync(directory,{recursive:true,force:true});}
console.log('OK: recovery guidance, compatible historical ETA, durable branches and rejected unsafe results.');
