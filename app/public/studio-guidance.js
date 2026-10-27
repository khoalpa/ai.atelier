(function(global){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const repairs={seam:'Biên: xem kỹ cổ, vai và eo; dùng sửa biên cục bộ rồi so sánh lại.',texture:'Hoa văn: dùng ảnh sản phẩm rõ nét, đúng màu; tránh tăng số bước khi reference chưa đạt.',anatomy:'Hình thể: kiểm tra đúng nhân vật, mask và vùng bảo vệ tay; dùng pose trước khi chạy lại.',collar:'Cổ áo: giới hạn vùng sửa ở cổ; bảo vệ mặt và tóc.',sleeves:'Tay áo: kiểm tra mask phủ hết tay áo cũ; bảo vệ bàn tay.',waist:'Eo: loại cạp quần khỏi mask nếu chỉ thay áo.'};
  function recovery(message){
    if(/out of memory|cuda.*memory|hết.*bộ nhớ|VRAM/i.test(message))return 'Giảm kích thước ảnh hoặc số phương án, đóng ứng dụng dùng GPU rồi thử lại.';
    if(/model|checkpoint|safetensors|phụ thuộc/i.test(message))return 'Mở Model để kiểm tra tệp và phụ thuộc. Nếu vừa đổi model nền, khởi động lại dịch vụ AI trong Cài đặt.';
    if(/fetch|network|kết nối|ECONN|timeout/i.test(message))return 'Kiểm tra dịch vụ trong Cài đặt. Giữ trang mở và xem Hoạt động trước khi chạy lại để tránh tạo tác vụ trùng.';
    if(/reference|tham chiếu|qualification/i.test(message))return 'Chọn ảnh sản phẩm riêng, đủ toàn bộ trang phục; lưu và chạy kiểm định cho đúng loại trước benchmark.';
    return 'Xem Hoạt động để kiểm tra tác vụ. Ảnh và kết quả đã lưu vẫn có thể mở từ Thư viện.';
  }
  function recommendations(labels){return labels.map(label=>repairs[label]).filter(Boolean);}
  repairs.color='Màu: dùng reference dưới ánh sáng trung tính, tránh ảnh bị ám màu; so sánh màu và chất liệu trước khi chấp nhận bản chạy lại.';
  function stageHint(state){
    if(state.status==='failed')return recovery(state.error||'');
    if(state.status==='cancelling')return 'Đã yêu cầu hủy; đang chờ lượt xử lý hiện tại kết thúc ở điểm an toàn.';
    const last=Date.parse(state.updatedAt||state.startedAt);
    if(Number.isFinite(last)&&Date.now()-last>300000)return 'Chưa nhận cập nhật trong hơn 5 phút. Kiểm tra Hoạt động và trạng thái dịch vụ trước khi chạy lại.';
    if(/model|loading/.test(state.stage||''))return 'Đang nạp hoặc chuyển model vào bộ nhớ; lần đầu có thể lâu hơn. Chưa đủ dữ liệu để đo phần trăm của bước này.';
    if(/preparing|validating/.test(state.stage||''))return 'Đang kiểm tra ảnh và chuẩn bị vùng xử lý trước khi tạo kết quả.';
    return '';
  }
  function attachRepairHint(select){
    const label=select.closest('label');if(!label)return;
    let hint=label.nextElementSibling;if(!hint?.matches('[data-repair-hint]')){hint=document.createElement('div');hint.dataset.repairHint='';hint.setAttribute('role','status');label.after(hint);}
    const labels=[...select.selectedOptions].map(option=>option.value);hint.replaceChildren();
    for(const text of recommendations(labels)){const p=document.createElement('p');p.textContent=text;hint.append(p);}
    if(labels.length){const p=document.createElement('p');p.textContent='Chọn Chạy lại để lưu nhãn. Hàng chạy lại sẽ dùng các nhãn này để chọn vùng và cấu hình, giữ kết quả cũ để so sánh.';hint.append(p);}
  }
  function historyEta(records,state){
    const matches=records.filter(item=>item.taskType===state.taskType&&item.model===state.model&&item.width===state.width&&item.height===state.height&&item.totalWorkSteps===state.totalWorkSteps&&item.seconds>0).map(item=>item.seconds).sort((a,b)=>a-b);
    if(matches.length<3)return NaN;
    const elapsed=(Date.now()-Date.parse(state.startedAt))/1000;
    return Math.max(0,matches[Math.floor(matches.length/2)]-elapsed);
  }
  let durations=[];try{durations=JSON.parse(localStorage.getItem('atelier.durations')||'[]');if(!Array.isArray(durations))durations=[];}catch{}
  function observeJob(state){
    if(state.status!=='completed'||!state.startedAt||durations.some(item=>item.jobId===state.jobId))return;
    const seconds=(Date.parse(state.updatedAt)-Date.parse(state.startedAt))/1000;
    if(!Number.isFinite(seconds)||seconds<=0)return;
    durations.push({jobId:state.jobId,taskType:state.taskType,model:state.model,width:state.width,height:state.height,totalWorkSteps:state.totalWorkSteps,seconds});durations=durations.slice(-100);
    try{localStorage.setItem('atelier.durations',JSON.stringify(durations));}catch{}
  }
  function referenceGuide(){
    const file=document.getElementById('garmentFile');if(!file)return;
    const guide=document.createElement('details');guide.className='studio-guidance';guide.innerHTML='<summary>Chuẩn bị ảnh trang phục tốt</summary><div class="reference-examples"><div><strong>✓ Nên dùng</strong><p>Ảnh sản phẩm trải phẳng hoặc treo thẳng; nền đơn sắc; đủ cổ, tay và gấu; ánh sáng đều, thấy rõ hoa văn.</p></div><div><strong>△ Cần thay ảnh</strong><p>Ảnh đang mặc trên người, tay che áo, cắt mất gấu, nhiều trang phục, ảnh mờ hoặc ánh sáng làm đổi màu.</p></div></div><ol><li>Chọn đúng loại áo, quần/váy hoặc toàn thân.</li><li>Chọn ảnh và tách nền nếu cần. Kiểm tra còn đủ mép trang phục.</li><li>Lưu ảnh tham chiếu, xem lý do chưa đạt và chạy kiểm định trước benchmark.</li></ol><p>Ảnh vừa chọn dùng để thử trong Studio. Bộ benchmark chỉ dùng reference đã lưu và vượt kiểm định.</p>';
    file.closest('label').after(guide);
    const button=document.createElement('button');button.type='button';button.textContent='Mở thiết lập và kiểm định tham chiếu';button.onclick=()=>{globalThis.AtelierApp.setExperienceMode('expert');const target=document.getElementById('saveReferenceButton');target.scrollIntoView({behavior:'smooth',block:'center'});target.focus({preventScroll:true});};guide.append(button);
  }
  function showPreview(){
    if(!globalThis.AtelierApp.current||!globalThis.AtelierApp.sourceImage)return globalThis.AtelierApp.setMessage('Chọn ảnh nguồn trước khi xem vùng xử lý.','error');
    let dialog=document.getElementById('scopePreview');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='scopePreview';dialog.className='scope-preview';document.body.append(dialog);}
    const stats=globalThis.AtelierApp.editableMaskStats(),auto=globalThis.AtelierApp.studioMode==='tryon'&&document.getElementById('autoMaskToggle').checked,body=globalThis.AtelierApp.studioMode==='tryon'&&!isDescriptionTryon()&&document.getElementById('reconstructExposedBodyToggle').checked;
    dialog.innerHTML=`<h2>Xem trước vùng xử lý</h2><p>Đỏ: vùng chọn sửa · Xanh: vùng bảo vệ · Phần còn lại nằm ngoài mask hiện tại.</p><canvas aria-label="Ảnh nguồn với vùng sửa màu đỏ và vùng bảo vệ màu xanh"></canvas><p>Vùng sửa sau khi trừ vùng bảo vệ: ${(stats.coverage*100).toFixed(1)}% ảnh.</p><p>${auto?'Tự tạo mask đang bật: vùng thực tế sẽ được tính lại khi chạy. ':''}${body?'Tái tạo cơ thể đang bật: AI có thể mở rộng vùng quần áo cũ để sinh phần da mới lộ ra. Đây là bản xem trước mask hiện tại; vùng mở rộng chưa được tính.':''}</p><p>${stats.selected<stats.minimum?'Chưa có đủ vùng sửa. Hãy tô mask hoặc bật tự tạo mask.':'Kiểm tra mask có phủ hết quần áo cũ, đặc biệt ở cổ, tay áo và eo.'}</p><button type="button">Quay lại chỉnh sửa</button>`;
    const out=dialog.querySelector('canvas');out.width=globalThis.AtelierApp.canvas.width;out.height=globalThis.AtelierApp.canvas.height;const context=out.getContext('2d');context.drawImage(globalThis.AtelierApp.sourceImage,0,0,out.width,out.height);context.globalAlpha=.55;context.drawImage(globalThis.AtelierApp.maskCanvas,0,0,out.width,out.height);context.drawImage(globalThis.AtelierApp.protectCanvas,0,0,out.width,out.height);
    dialog.querySelector('button').onclick=()=>dialog.close();dialog.showModal();
  }
  async function renderHistory(){
    const host=document.getElementById('editHistory');if(!host)return;
    try{
      const response=await fetch('/api/edit-history'),data=await response.json();if(!response.ok)throw new Error(data.error);
      host.replaceChildren();const title=document.createElement('summary');title.textContent='Lịch sử chỉnh sửa · chọn một bản để tạo nhánh';host.append(title);
      const related=new Set([globalThis.AtelierApp.current?.id]);let changed=true;while(changed){changed=false;for(const item of data.items)if(related.has(item.sourceId)||related.has(item.childId)){for(const id of [item.sourceId,item.childId])if(!related.has(id)){related.add(id);changed=true;}}}
      const items=data.items.filter(item=>related.has(item.sourceId)||related.has(item.childId));
      if(!items.length){const p=document.createElement('p');p.textContent='Chọn kết quả rồi dùng Chỉnh sửa tiếp để lưu một nhánh. Lịch sử được lưu trên máy.';host.append(p);}
      for(const item of items){const row=document.createElement('article');row.className='history-entry';row.innerHTML=`<img src="${escape(item.result)}" alt="Phiên bản đã dùng để sửa tiếp" loading="lazy"><div><strong>${escape(item.task==='manual'?'Chỉnh sửa thủ công':item.task==='character'?'Tư thế & biểu cảm':item.task==='makeup'?'Trang điểm AI':item.task==='enhance'?'Cải thiện ảnh':item.task==='outpaint'?'Mở rộng ảnh':item.task==='tryon'?'Thay trang phục':'Xóa vật thể')}</strong><small>${escape(item.sourceId)} → ${escape(item.childId)}</small><time>${escape(new Date(item.createdAt).toLocaleString('vi-VN'))}</time><button type="button">Mở bản này để tạo nhánh</button></div>`;row.querySelector('button').onclick=async()=>{if(globalThis.AtelierApp.activeJobId&&!['completed','failed','cancelled','restart-required'].includes(globalThis.AtelierApp.activityState?.status))return globalThis.AtelierApp.setMessage('Hãy đợi tác vụ hiện tại kết thúc trước khi mở bản cũ.','error');if(item.task==='manual'){await window.ManualEditor.openUrl(item.result,'Bản chỉnh thủ công',item.childId);return;}globalThis.AtelierApp.studioPendingResult=item.result;await globalThis.AtelierApp.continueFromSelectedResult(item.task,item.childId);};host.append(row);}
    }catch(error){host.replaceChildren();const summary=document.createElement('summary');summary.textContent='Lịch sử chỉnh sửa';const message=document.createElement('p');message.textContent='Không thể đọc lịch sử: '+error.message;const retry=document.createElement('button');retry.type='button';retry.textContent='Tải lại lịch sử';retry.onclick=renderHistory;host.append(summary,message,retry);}
  }
  async function recordBranch(item){
    const response=await fetch('/api/edit-history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Không thể lưu lịch sử chỉnh sửa');await renderHistory();
  }
  function init(){
    referenceGuide();
    for(const id of ['inpaintModelSelect','tryonModelSelect','textToImageModel'])document.getElementById(id)?.closest('label')?.classList.add('expert-only');
    const preview=document.createElement('button');preview.type='button';preview.textContent='Kiểm tra vùng xóa';preview.id='scopePreviewButton';preview.onclick=showPreview;document.getElementById('journeyContent').append(preview);
    const history=document.createElement('details');history.id='editHistory';history.className='studio-guidance';document.getElementById('journeyContent').append(history);renderHistory();
    document.addEventListener('change',event=>{if(event.target.matches('[data-benchmark-labels]'))attachRepairHint(event.target);});
  }
  global.StudioGuidance={recovery,recommendations,stageHint,attachRepairHint,historyEta,observeJob,eta:state=>historyEta(durations,state),recordBranch,renderHistory,init};
})(window);
