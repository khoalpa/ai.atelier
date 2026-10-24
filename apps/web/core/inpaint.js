'use strict';
// Owned state: inpaintPromptReviewPending
// Dependencies: $, activeJobId, binaryMaskDataUrl, createJobId, current, currentRunDirectory, editableMaskStats, presentStudioResults, seedForRun, selectPrimary, setActiveJob, setMessage, settleJob, showCompare, showMaskGuide, sourceImage, studioResultInstructionsDirty
module.exports=function createInpaint(deps){
let inpaintPromptReviewPending;
async function save() {
  if (!deps.current || !deps.sourceImage) return deps.setMessage('Hãy chọn ảnh trước khi lưu vùng chỉnh sửa.', 'error');
  deps.setMessage('Đang lưu…');
  try {
    const response = await fetch('/api/masks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleId: deps.current.id,
        imageWidth: deps.sourceImage.naturalWidth,
        imageHeight: deps.sourceImage.naturalHeight,
        label: deps.$('labelSelect').value,
        notes: deps.$('notes').value,
        brushSize: Number(deps.$('brushSize').value),
        editableMask: deps.binaryMaskDataUrl(false),
        protectedDetailMask: deps.binaryMaskDataUrl(false, true),
        protectedMask: deps.binaryMaskDataUrl(true),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không thể lưu');
    deps.setMessage(`Đã lưu: ${result.directory}`, 'success');
  } catch (error) {
    deps.setMessage(error.message, 'error');
  }
}

function reviewGenerationPrompts(initial,request={}){
  const dialog=deps.$('generationPromptDialog'),form=deps.$('generationPromptForm'),positive=deps.$('generationPrompt'),negative=deps.$('generationNegativePrompt');
  const panel=deps.$('generationEncoderPrompts');
  let revision=0,timer,closed=false;
  const render=(result)=>{
    if(result.encoders?.length)negative.disabled=result.encoders.every(encoder=>encoder.negativeTokens==null);
    const safe=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    panel.innerHTML=(result.encoders||[]).map(encoder=>`<article class="encoder-prompt encoder-${encoder.kind==='t5'?'t5':'clip'}"><strong>${safe(encoder.name)} · ${safe(encoder.tokens)} / ${safe(encoder.limit)} token${encoder.tokens>encoder.limit?' · Vượt giới hạn':''}</strong><pre>${safe(encoder.prompt)}</pre><small>${encoder.negativeTokens==null?'Model không dùng negative prompt':`Negative prompt: ${safe(encoder.negativeTokens)} / ${safe(encoder.limit)} token${encoder.negativeTokens>encoder.limit?' · Vượt giới hạn':''}`}</small></article>`).join('');
    if(result.tokenError)panel.textContent=result.tokenError;
  };
  const refresh=()=>{
    const version=++revision;clearTimeout(timer);panel.textContent='Đang cập nhật token…';
    timer=setTimeout(async()=>{
      try{
        const response=await fetch('/api/inpaint-prompts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,confirmedPrompts:{prompt:positive.value.trim(),negativePrompt:negative.value.trim()}})});
        const result=await response.json();if(!response.ok||!result.ok)throw new Error();
        if(!closed&&version===revision)render(result);
      }catch{if(!closed&&version===revision)panel.textContent='Chưa xác định được số token. Hãy kiểm tra nội dung prompt và tokenizer của model.';}
    },300);
  };
  const reset=()=>{++revision;clearTimeout(timer);positive.value=initial.prompt;negative.value=initial.negativePrompt;positive.setCustomValidity('');render(initial);};
  reset();
  return new Promise((resolve)=>{
    const close=()=>dialog.close();
    const submit=(event)=>{event.preventDefault();if(!positive.value.trim()){positive.setCustomValidity('Hãy nhập prompt trước khi xác nhận.');positive.reportValidity();return;}dialog.returnValue='confirmed';dialog.close();};
    const clearValidity=()=>{positive.setCustomValidity('');refresh();};
    const finished=()=>{
      closed=true;++revision;clearTimeout(timer);negative.removeEventListener('input',refresh);
      form.removeEventListener('submit',submit);positive.removeEventListener('input',clearValidity);
      for(const id of ['cancelGenerationPrompt','backGenerationPrompt'])deps.$(id).removeEventListener('click',close);
      deps.$('resetGenerationPrompt').removeEventListener('click',reset);
      resolve(dialog.returnValue==='confirmed'?{prompt:positive.value.trim(),negativePrompt:negative.value.trim()}:null);
    };
    dialog.returnValue='';
    dialog.addEventListener('close',finished,{once:true});form.addEventListener('submit',submit);positive.addEventListener('input',clearValidity);negative.addEventListener('input',refresh);
    for(const id of ['cancelGenerationPrompt','backGenerationPrompt'])deps.$(id).addEventListener('click',close);
    deps.$('resetGenerationPrompt').addEventListener('click',reset);dialog.showModal();positive.focus();
  });
}

async function runInpaint() {
  if(descriptionTryonRunning)return deps.setMessage('Hãy hoàn tất tác vụ thay trang phục hiện tại.', 'error');
  if(deps.studioResultInstructionsDirty())return deps.setMessage('Hãy lưu hướng dẫn kết quả sau khi xóa trước khi tạo ảnh.', 'error');
  if (!deps.current || !deps.sourceImage) return deps.setMessage('Hãy chọn ảnh cần chỉnh sửa trước.', 'error');
  if (['sleepwear','underwear','mannequin'].includes(deps.$('accessoryPreset').value) && !deps.$('inpaintPrompt').value.trim()) return deps.setMessage('Preset này đang trống. Hãy nhập mô tả trong Studio hoặc chỉnh sửa tại màn Prompt trước khi tạo ảnh.', 'error');
  const maskStats = deps.editableMaskStats();
  if (maskStats.selected < maskStats.minimum) {
    deps.showMaskGuide(maskStats);
    return;
  }
  if(inpaintPromptReviewPending||deps.activeJobId)return deps.setMessage('Hãy hoàn tất xác nhận hoặc tác vụ hiện tại.', 'error');
  const request={
        sampleId: deps.current.id,
        modelId: deps.$('inpaintModelSelect').value,
        removalTarget: ['sleepwear','underwear','mannequin'].includes(deps.$('accessoryPreset').value)?'custom':deps.$('accessoryPreset').value,
        objectLabel: deps.$('inpaintObjectLabel')?.value?.trim() || '',
        fillMode: deps.$('inpaintFillMode').value,
        forbiddenReplacement: deps.$('inpaintFillMode').value==='base_layer'?'':['sleepwear','underwear','mannequin'].includes(deps.$('accessoryPreset').value)?'':['outfit','shirt'].includes(deps.$('accessoryPreset').value)?'upper-body garment':deps.$('accessoryPreset').value==='pants'?'lower-body garment':'replacement object',
        editableMask: deps.binaryMaskDataUrl(false),
        protectedDetailMask: deps.binaryMaskDataUrl(false,true),
        prompt: deps.$('inpaintPrompt').value,
        negativePrompt: deps.$('inpaintNegativePrompt').disabled ? '' : deps.$('inpaintNegativePrompt').value,
        seed: deps.seedForRun('inpaintSeed'),
        count: Number(deps.$('inpaintCount').value),
        expand: Number(deps.$('maskExpand').value),
        blur: Number(deps.$('maskBlur').value),
        steps: Number(deps.$('inpaintSteps').value),
        strength: Number(deps.$('inpaintStrength').value),
        guidance: Number(deps.$('inpaintGuidance').value),
        cropPadding: Number(deps.$('cropPadding').value), contextRatio: 0.30,
        maxSide: Number(deps.$('inpaintResolution').value),
        autoRetry: true,
        maxAutoRetries: 1,
        useModelProfile: true,
        semanticCheck: true,
      };
  let confirmedPrompts;
  inpaintPromptReviewPending=true;
  try{
    const response=await fetch('/api/inpaint-prompts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelId:request.modelId,removalTarget:request.removalTarget,fillMode:request.fillMode,forbiddenReplacement:request.forbiddenReplacement,prompt:request.prompt,negativePrompt:request.negativePrompt})});
    const result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.error||'Không thể tổng hợp prompt');
    confirmedPrompts=await reviewGenerationPrompts(result,{modelId:request.modelId,fillMode:request.fillMode});
    if(!confirmedPrompts)return;
    if(deps.activeJobId)return deps.setMessage('Một tác vụ khác đang chạy. Hãy thử lại sau.', 'error');
  }catch(error){deps.setMessage(error.message,'error');return;}
  finally{inpaintPromptReviewPending=false;}
  deps.setMessage('Đang kiểm tra ảnh và chuẩn bị Inpainting…');
  const jobId=deps.createJobId('inpaint');deps.setActiveJob(jobId);let jobSucceeded=false,jobError='';
  try {
    const response = await fetch('/api/inpaint', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({...request, jobId, confirmedPrompts}),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể inpaint');
    jobSucceeded=true;
    deps.currentRunDirectory = result.directory;
    const sourceCard = `<article class="result-card"><img src="${deps.current.url}" alt="Ảnh gốc"><p>Ảnh gốc</p></article>`;
    deps.$('resultsGrid').innerHTML = sourceCard + result.results.map((item) => `
      <article class="result-card">
        <img src="${item.image}" alt="Kết quả seed ${item.seed}">
        <p>Seed ${item.seed} · ${result.width} × ${result.height} · ${result.device}<br>Thay đổi ngoài mask: ${(item.outsideMaskMAE * 100).toFixed(3)}% · ${item.removalCheck?.statusLabel||'Chưa kiểm tra phần còn sót'}</p>
        <button data-seed="${item.seed}">Chọn làm kết quả chính</button>
      </article>`).join('');
    for (const button of deps.$('resultsGrid').querySelectorAll('[data-seed]')) {
      button.addEventListener('click', () => deps.selectPrimary(Number(button.dataset.seed), button));
    }
    const selected = result.results.find((item)=>item.seed===result.selectedSeed) || result.results[0];
    deps.presentStudioResults(deps.current.url,selected?.image||'');
    if (selected) deps.showCompare(deps.current.url, selected.image);
    deps.setMessage(`Đã tạo ${result.results.length} phương án bằng ${result.modelName||'model mặc định'} · ${result.removalPassed||0} vượt kiểm tra nhận diện. Hãy xem lại nền và đường biên trước khi chọn.`, result.removalPassed ? 'success' : 'info');
  } catch (error) { jobError=error.message;deps.setMessage(error.message, 'error'); }
  finally { await deps.settleJob(jobId,jobSucceeded?'completed':'failed',jobError); }
}
return {bindings:{get save(){return save;},set save(value){save=value;},
get inpaintPromptReviewPending(){return inpaintPromptReviewPending;},set inpaintPromptReviewPending(value){inpaintPromptReviewPending=value;},
get reviewGenerationPrompts(){return reviewGenerationPrompts;},set reviewGenerationPrompts(value){reviewGenerationPrompts=value;},
get runInpaint(){return runInpaint;},set runInpaint(value){runInpaint=value;}},steps:[
function initialize(){
(inpaintPromptReviewPending = false);
}
]};
};
