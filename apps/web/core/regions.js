'use strict';
// Owned state: regionDetection, regionController
// Dependencies: $, activeJobId, createJobId, current, currentRunDirectory, maskCanvas, maskCtx, presentStudioResults, refreshStudioReadiness, render, seedForRun, selectPrimary, setActiveJob, setMessage, snapshot, sourceImage, studioMode
module.exports=function createRegions(deps){
let regionDetection, regionController;
async function loadRuntimeModelStatus(){const response=await fetch('/api/runtime-model-status');const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra công cụ');const names={'adetailer':'ADetailer','yolo-world':'YOLO-World','grounding-dino-base':'Grounding DINO','florence-2-large':'Florence-2'};deps.$('runtimeModelStatus').textContent=Object.entries(names).map(([id,name])=>{const model=result.models[id];return `${name}: ${model?.loaded?'Đã nạp vào bộ nhớ':model?.ready?'Đã có tệp · chưa nạp':'Thiếu tệp công cụ'}`;}).join('\n');return result;}

function selectedRegions(){
  if(!regionDetection || regionDetection.sampleId!==deps.current?.id || regionDetection.mode!==deps.studioMode) throw new Error('Ảnh đã đổi. Hãy tìm đối tượng lại.');
  const indices=[...deps.$('regionChoices').querySelectorAll('input:checked')].map(input=>Number(input.value));
  const items=regionDetection.items.filter(item=>indices.includes(item.index));
  if(!items.length)throw new Error('Hãy chọn ít nhất một đối tượng.');
  return items;
}

async function applyDetectedRegions(){
  const items=selectedRegions(),sampleId=deps.current.id,mode=deps.studioMode;
  const canvas=document.createElement('canvas');canvas.width=deps.maskCanvas.width;canvas.height=deps.maskCanvas.height;
  const ctx=canvas.getContext('2d'),selected=new Uint8Array(canvas.width*canvas.height);
  for(const item of items){
    const img=new Image();img.src=item.mask;await img.decode();ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    for(let i=0;i<selected.length;i++)if(pixels[i*4]>127)selected[i]=1;
  }
  if(deps.current?.id!==sampleId||deps.studioMode!==mode)throw new Error('Ảnh đã đổi. Hãy tìm đối tượng lại.');
  deps.snapshot();const pixels=deps.maskCtx.getImageData(0,0,canvas.width,canvas.height),merge=deps.$('regionMergeMode').value;
  for(let i=0;i<selected.length;i++){
    const old=pixels.data[i*4+3]>127,active=merge==='add'?old||selected[i]:merge==='subtract'?old&&!selected[i]:selected[i];
    pixels.data[i*4]=255;pixels.data[i*4+1]=40;pixels.data[i*4+2]=40;pixels.data[i*4+3]=active?255:0;
  }
  deps.maskCtx.putImageData(pixels,0,0);deps.render();deps.refreshStudioReadiness();deps.setMessage('Đã áp dụng vùng chọn. Kiểm tra vùng đỏ trước khi chỉnh sửa.','success');
}

async function detectWithManagedModel(model){
  if(!deps.current)throw new Error('Hãy chọn ảnh cần chỉnh sửa.');
  if(regionController||deps.activeJobId)throw new Error('Hãy hoàn tất tác vụ hiện tại.');
  const target=deps.current.id,mode=deps.studioMode,classes=deps.$('yoloClasses').value.split(',').map(item=>item.trim()).filter(Boolean);
  if(model!=='adetailer'&&!classes.length)throw new Error('Hãy nhập đối tượng cần chọn bằng tiếng Anh.');
  const controller=new AbortController();regionController=controller;regionDetection=null;
  deps.$('regionResults').hidden=true;deps.$('adetailerRefineButton').disabled=true;
  deps.$('cancelRegionButton').hidden=false;deps.$('regionDetectButton').disabled=true;deps.$('adetailerMaskButton').disabled=true;
  deps.$('regionProgress').textContent='Đang nhận diện và tạo vùng chọn…';
  try{
    const response=await fetch('/api/detect-regions',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({sampleId:target,model,classes,confidence:.25,padding:model==='adetailer'?12:8})});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể phát hiện vùng');
    if(deps.current?.id!==target||deps.studioMode!==mode)return;
    if(!result.count)throw new Error('Không tìm thấy đối tượng phù hợp. Thử mô tả hoặc bộ nhận diện khác.');
    regionDetection={sampleId:target,mode,model,items:result.detections};
    deps.$('regionChoices').replaceChildren();
    for(const [position,item] of result.detections.entries()){
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=item.index;input.checked=true;
      const preview=document.createElement('canvas');preview.width=64;preview.height=64;preview.setAttribute('aria-hidden','true');
      const [x0,y0,x1,y1]=item.box;
      if(deps.sourceImage&&x1>x0&&y1>y0)preview.getContext('2d').drawImage(deps.sourceImage,x0,y0,x1-x0,y1-y0,0,0,64,64);
      label.append(input,preview,document.createTextNode(`${model==='adetailer'?'Khuôn mặt':item.label} ${position+1}`));deps.$('regionChoices').append(label);
    }
    deps.$('regionResults').hidden=false;deps.$('adetailerRefineButton').disabled=model!=='adetailer';
    deps.$('regionProgress').textContent=`Tìm thấy ${result.count} vùng. Chọn đối tượng rồi áp dụng. ${result.warning||''}`;
  }catch(error){deps.$('regionProgress').textContent=error.name==='AbortError'?'Đã hủy chờ kết quả. Lượt xử lý trên máy chủ có thể còn đang hoàn tất.':error.message;if(error.name!=='AbortError')throw error;}
  finally{regionController=null;deps.$('cancelRegionButton').hidden=true;deps.$('regionDetectButton').disabled=false;deps.$('adetailerMaskButton').disabled=false;}
}

async function runAdetailerRefine(){if(!deps.current)throw new Error('Hãy chọn ảnh cần chỉnh sửa.');if(deps.activeJobId||regionController)throw new Error('Hãy hoàn tất tác vụ hiện tại.');const faces=selectedRegions();if(regionDetection.model!=='adetailer')throw new Error('Hãy tìm khuôn mặt trước.');const jobId=deps.createJobId('adetailer');deps.setActiveJob(jobId);deps.$('adetailerRefineButton').disabled=true;try{const response=await fetch('/api/adetailer-refine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId,sampleId:deps.current.id,faceIndices:faces.map(item=>item.index),strength:Number(deps.$('faceStrength').value),seed:deps.seedForRun('inpaintSeed'),steps:Number(deps.$('inpaintSteps').value),guidance:Number(deps.$('inpaintGuidance').value),count:1,maxSide:768})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tinh chỉnh khuôn mặt');deps.currentRunDirectory=result.directory;deps.$('resultsGrid').innerHTML=`<article class="result-card"><img src="${deps.current.url}" alt="Ảnh gốc"><p>Ảnh gốc</p></article>`+result.results.map((item)=>`<article class="result-card"><img src="${item.image}" alt="ADetailer"><p>ADetailer · seed ${item.seed}</p><button data-seed="${item.seed}">Dùng kết quả này</button></article>`).join('');for(const button of deps.$('resultsGrid').querySelectorAll('[data-seed]'))button.addEventListener('click',()=>deps.selectPrimary(Number(button.dataset.seed),button));deps.$('comparePanel').hidden=true;deps.presentStudioResults(deps.current.url);deps.$('resultsDialog').showModal();deps.setMessage(`ADetailer đã tinh chỉnh ${result.detector.count} khuôn mặt.`,'success');}finally{deps.$('adetailerRefineButton').disabled=false;deps.setActiveJob('');}}
return {bindings:{get loadRuntimeModelStatus(){return loadRuntimeModelStatus;},set loadRuntimeModelStatus(value){loadRuntimeModelStatus=value;},
get regionDetection(){return regionDetection;},set regionDetection(value){regionDetection=value;},
get regionController(){return regionController;},set regionController(value){regionController=value;},
get selectedRegions(){return selectedRegions;},set selectedRegions(value){selectedRegions=value;},
get applyDetectedRegions(){return applyDetectedRegions;},set applyDetectedRegions(value){applyDetectedRegions=value;},
get detectWithManagedModel(){return detectWithManagedModel;},set detectWithManagedModel(value){detectWithManagedModel=value;},
get runAdetailerRefine(){return runAdetailerRefine;},set runAdetailerRefine(value){runAdetailerRefine=value;}},steps:[
function initialize(){
(regionDetection = null);
(regionController = null);
}
]};
};
