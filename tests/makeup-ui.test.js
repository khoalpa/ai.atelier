const assert=require('assert'),fs=require('fs'),vm=require('vm');
const fields={makeupReaderStatus:{}};
for(const id of ['makeupStatus','makeupPreview','makeupRun','makeupDetect','makeupReadDescription','makeupStyle','makeupDescription','makeupSmooth','makeupSmoothValue','makeupSummary','makeupFaces','makeupRefresh','makeupLip','makeupEyeshadow','makeupBlush','makeupIntensity','makeupRenderer','makeupEyeliner','makeupFinish','makeupPreserve'])fields[id]={value:'',checked:true,addEventListener(){},replaceChildren(){},querySelectorAll(){return[];}};
fields.makeupStyle.value='natural';fields.makeupRenderer.value='color';fields.makeupSmooth.value='0';
let chosen=['lips','eyes','brows','cheeks','base'],selected=100;
const boxes=['lips','eyes','brows','cheeks','base'].map(part=>({dataset:{makeupPart:part},get checked(){return chosen.includes(part)},set checked(value){chosen=value?[...new Set([...chosen,part])]:chosen.filter(p=>p!==part)}}));
const context={window:{},document:{getElementById:id=>fields[id],querySelector:()=>null,querySelectorAll:selector=>selector.includes('data-makeup-strength')?[]:selector.includes(':checked')?boxes.filter(x=>x.checked):boxes},current:{id:'portrait'},sourceImage:{},activeJobId:'',editableMaskStats:()=>({selected}),refreshStudioReadiness(){},
  fetch:async()=>({ok:true,json:async()=>({ok:true,serviceReady:true,landmarkReady:true,aiReady:true,plannerReady:true,styles:require('../app/makeup-styles.json')})})};
vm.createContext(context);vm.runInContext(fs.readFileSync('app/public/makeup.js','utf8'),context);
(async()=>{
 const api=context.window.Makeup;api.setup();await new Promise(setImmediate);
 assert.equal(api.requirements(true).find(x=>x[0]==='Khuôn mặt')[1],false);assert.equal(fields.makeupRun.disabled,true);
 assert.throws(()=>api.payload(),/khuôn mặt/);
 fields.makeupDescription.value='Chỉ tô son';api.sync();assert.equal(api.requirements(true).find(x=>x[0]==='Mô tả')[1],false);
 fields.makeupDescription.value='';fields.makeupStyle.value='custom';assert.equal(api.requirements(true).find(x=>x[0]==='Mô tả')[1],false);
 fields.makeupStyle.value='natural';chosen=[];api.sync();assert.equal(api.requirements(true).find(x=>x[0]==='Vùng trang điểm')[1],false);assert(fields.makeupSmooth.disabled);
 chosen=['lips'];context.activeJobId='other';api.sync();assert(fields.makeupDetect.disabled);assert(fields.makeupRun.disabled);
 context.activeJobId='';api.reset();assert(!fields.makeupDetect.disabled);
 context.fetch=async()=>({ok:true,json:async()=>({serviceReady:false})});await fields.makeupRefresh.onclick();assert(fields.makeupDetect.disabled);assert.equal(api.requirements(true).find(x=>x[0]==='Dịch vụ')[1],false);
 const html=fs.readFileSync('app/public/index.html','utf8');assert(html.includes('id="makeupSmooth" type="range" min="0" max="50" value="0"'));assert(html.includes('id="makeupPreserve" type="checkbox" checked'));
 console.log('OK: face required, description invalidation, empty regions, busy and unavailable service guards, smoothing opt-in.');
})().catch(e=>{console.error(e);process.exitCode=1;});
