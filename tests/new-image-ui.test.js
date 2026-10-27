const fs=require('fs'),vm=require('vm'),assert=require('assert');
const script=require('./helpers/source').read(require('path').join(__dirname,'../app/public/new-image.js'),'utf8').replace('  initialize();return','  return');
assert(script.includes("el('chromaGenerateButton').hidden=true"),'Tạo ảnh phải chỉ còn một CTA chính trên thanh tác vụ.');
assert(script.includes("promptLabel.firstChild.textContent='Bạn muốn tạo ảnh gì? '"),'Mô tả phải đứng đầu luồng Tạo ảnh.');
assert(script.includes("composition.append(el('chromaCount').closest('label'))"),'Số phương án phải nằm cùng nhóm khung ảnh.');
assert(script.includes("pipelineLabel.hidden=true;el('textToImagePipeline').value='generate'"),'Pipeline thay trang phục không được xuất hiện trong Tạo ảnh mới.');
assert(script.includes("data-new-similar"),'Ảnh đã chọn phải có hành động tạo thêm tương tự.');
function setup(valid=true){
  const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,classList:{toggle(){}},innerHTML:'',textContent:'',after(){},focus(){},remove(){}});return nodes.get(id);};
  const fields={textToImageModel:'flux-2-klein-4b',chromaPrompt:'blue fabric '.repeat(65)+'red shoes',chromaNegativePrompt:'',chromaSize:'1024',chromaAspect:'4:5',chromaQuality:'4',chromaGuidance:'1',chromaCount:'2',textToImagePipeline:'generate'};
  for(const [id,value]of Object.entries(fields))get(id).value=value;
  const calls=[],errors=[];
  const ctx={window:{},document:{getElementById:get},textQuality:'quality',activeJobId:'',textToImageModels:new Map(),
    escapeHtml:v=>String(v).replaceAll('<','&lt;'),outputUrl:v=>v,refreshStudioReadiness(){},updateTextToImageAvailability(){},
    seedForRun:()=>123,createJobId:()=> 'test-new-image',setMessage:(...a)=>errors.push(a),pollJobStatus:async()=>{},
    setTimeout,clearTimeout,fetch:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return {ok:true,json:async()=>path.endsWith('plan')?{ok:true,valid,profile:{family:'klein'},encoders:[],errors:valid?[]:['too long'],warnings:[]}:{ok:true,totalSeconds:20,loadingSeconds:12,inferenceSeconds:8,peakVramMb:8000,results:[{image:'/outputs/chroma/test.png',seed:123,source:'test.png',sha256:'abc',model:'flux-2-klein-4b',width:928,height:1152}]}};}};
  ctx.setActiveJob=id=>{ctx.activeJobId=id;};vm.runInNewContext(script,ctx);
  return {ctx,get,calls,errors};
}
(async()=>{
  const invalid=setup(false);await invalid.ctx.window.NewImage.generate();
  assert.equal(invalid.calls.length,1);assert.equal(invalid.calls[0].path,'/api/new-image-plan');assert(!invalid.ctx.activeJobId);
  assert.equal(invalid.ctx.window.NewImage.promptReady(),false);
  const good=setup();await good.ctx.window.NewImage.generate();
  assert.deepEqual(good.calls.map(c=>c.path),['/api/new-image-plan','/api/chroma-generate']);
  assert.equal(good.calls[1].body.prompt,good.get('chromaPrompt').value);assert(good.calls[1].body.prompt.length>600);
  assert.equal(good.calls[1].body.negativePrompt,'');assert.equal(good.calls[1].body.aspectRatio,'4:5');assert.equal(good.calls[1].body.count,2);
  const framed=setup();framed.get('chromaFraming').value='full-body-hands';await framed.ctx.window.NewImage.generate();
  assert.equal(framed.calls[0].body.framing,'full-body-hands');assert.equal(framed.calls[1].body.framing,'full-body-hands');
  assert.equal(framed.calls[1].body.prompt,framed.get('chromaPrompt').value,'framing must not overwrite the user prompt');
  assert(good.get('chromaGalleryMeta').textContent.includes('tổng 20s'));assert(good.get('chromaGalleryMeta').textContent.includes('nạp model 12s'));
  good.ctx.window.NewImage.restore({model:'saved',results:[{file:'workspace/outputs/chroma/partial.png',seed:44,source:'partial.png',sha256:'hash'}]});
  assert(good.get('chromaGallery').innerHTML.includes('partial.png'));assert(good.get('chromaGallery').innerHTML.includes('44'));
  console.log('OK: browser preflight blocks invalid text; exact input, ratios, timing and saved partial results.');
})().catch(error=>{console.error(error);process.exitCode=1;});
