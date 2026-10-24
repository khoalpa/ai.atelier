const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=require('./helpers/source').read('app/public/app.js','utf8');
const code=source.slice(source.indexOf('let regionDetection ='),source.indexOf('async function detectWithManagedModel('));
const controls={regionChoices:{querySelectorAll:()=>[{value:'0'}]},regionMergeMode:{value:'replace'}};
let pixels=new Uint8ClampedArray([255,40,40,255,255,40,40,0]);
const ctx={clearRect(){},drawImage(){},getImageData:()=>({data:new Uint8ClampedArray([0,0,0,255,255,255,255,255])})};
const context={Uint8Array,current:{id:'a'},studioMode:'inpaint',$:id=>controls[id],maskCanvas:{width:2,height:1},maskCtx:{getImageData:()=>({data:pixels.slice()}),putImageData:data=>pixels=data.data},document:{createElement:()=>({getContext:()=>ctx})},Image:class{async decode(){}},snapshot(){},render(){},refreshStudioReadiness(){},setMessage(){}};
vm.createContext(context);vm.runInContext(code,context);vm.runInContext("regionDetection={sampleId:'a',mode:'inpaint',items:[{index:0,mask:'mask'}]}",context);
(async()=>{
 for(const [mode,expected] of [['replace',[0,255]],['add',[255,255]],['subtract',[255,0]]]){
  pixels=new Uint8ClampedArray([255,40,40,255,255,40,40,0]);controls.regionMergeMode.value=mode;await context.applyDetectedRegions();assert.deepEqual([pixels[3],pixels[7]],expected);
 }
 context.current={id:'b'};await assert.rejects(context.applyDetectedRegions(),/Ảnh đã đổi/);
 context.current={id:'a'};controls.regionChoices.querySelectorAll=()=>[];await assert.rejects(context.applyDetectedRegions(),/ít nhất một/);
 console.log('OK: replace/add/subtract masks; reject stale image and empty selection.');
})().catch(error=>{console.error(error);process.exitCode=1;});
