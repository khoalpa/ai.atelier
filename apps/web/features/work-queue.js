(function(global){
 'use strict';
 const expanded=new Set();let active='';
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function api(body){const response=await fetch('/api/work-queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'Không cập nhật được hàng đợi.');return result.queue;}
 async function get(id){const r=await fetch('/api/work-queue?id='+encodeURIComponent(id)),d=await r.json();if(!r.ok)throw Error(d.error);return d.queue;}
 async function create(kind,name,items){return api({action:'create',kind,name,items});}
 async function run(id,progress=()=>{}){
  if(active)throw Error('Một lô đang được theo dõi trong cửa sổ này.');active=id;
  try{let q=await api({action:'start',id});progress(q);
   while(['queued','running','interrupted'].includes(q.status)&&!q.stopRequested){await delay(1000);try{q=await get(id);}catch(e){throw Error('Mất kết nối giao diện. Lô vẫn được lưu trên máy; xem lại tại Hoạt động khi kết nối trở lại.');}progress(q);}
   return q;
  }finally{active='';}
 }
 async function stop(id=active){if(id)return api({action:'stop',id});}
 async function render(host){if(!host?.isConnected)return;const r=await fetch('/api/work-queue'),d=await r.json();if(!r.ok)throw Error(d.error);if(!host.isConnected)return;let target=host.querySelector('#unifiedQueues');if(!target){target=document.createElement('section');target.id='unifiedQueues';host.prepend(target);}target.innerHTML='<h2>Hàng đợi xử lý</h2><p>Lô tiếp tục khi đóng giao diện. Giữ máy và dịch vụ đang chạy; tiến độ được lưu sau mỗi ảnh.</p>'+(!d.items.length?'<p>Các tác vụ AI, chỉnh màu và xuất ảnh sẽ xuất hiện ở đây.</p>':d.items.map(q=>`<article class="workflow-card"><strong>${esc(q.name)}</strong><p>${q.items.filter(i=>i.status==='completed').length}/${q.items.length} hoàn tất · ${esc({queued:'Đang chờ dịch vụ',running:'Đang chạy nền',paused:'Đã dừng',interrupted:'Đang nối lại sau gián đoạn',completed:'Hoàn tất',cancelled:'Đã hủy'}[q.status]||q.status)}</p><div class="workflow-actions">${['running','queued'].includes(q.status)?`<button data-queue-stop="${q.id}">Dừng sau ảnh hiện tại</button>`:!['completed','cancelled'].includes(q.status)?`<button data-queue-run="${q.id}">${q.items.some(i=>i.status==='failed')?'Thử lại ảnh lỗi và tiếp tục':'Tiếp tục'}</button>`:''}<button data-queue-detail="${q.id}">Xem từng ảnh</button></div><div data-queue-items="${q.id}" ${expanded.has(q.id)?'':'hidden'}>${q.items.map(i=>`<p>${esc(i.name)} · ${esc({pending:'Chờ xử lý',running:'Đang xử lý',completed:'Hoàn tất',failed:'Cần thử lại',cancelled:'Đã hủy'}[i.status])}${i.error?' · '+esc(i.error):''}${i.result?.url?` <a href="${esc(i.result.url)}" download="${esc(i.result.filename||i.name)}">Tải ảnh</a>`:''}</p>`).join('')}</div></article>`).join(''));
  for(const b of target.querySelectorAll('[data-queue-stop]'))b.onclick=async()=>{await stop(b.dataset.queueStop);b.textContent='Sẽ dừng sau ảnh hiện tại';b.disabled=true;};
  for(const b of target.querySelectorAll('[data-queue-detail]'))b.onclick=()=>{const details=target.querySelector(`[data-queue-items="${b.dataset.queueDetail}"]`);details.hidden=!details.hidden;if(details.hidden)expanded.delete(b.dataset.queueDetail);else expanded.add(b.dataset.queueDetail);};
  for(const b of target.querySelectorAll('[data-queue-run]'))b.onclick=async()=>{b.disabled=true;try{await run(b.dataset.queueRun,()=>render(host).catch(()=>{}));}catch(e){b.after(document.createTextNode(e.message));}finally{if(b.isConnected)b.disabled=false;}};
 }
 async function characterBatch(rows,progress){const q=await create('character','Tư thế & biểu cảm · '+rows.length+' ảnh',rows.map(r=>({name:r.name,payload:r.request,jobId:r.jobId})));return run(q.id,state=>{state.items.forEach((i,n)=>{rows[n].jobId=i.jobId;rows[n].status=i.error||({pending:'Chờ xử lý',running:'Đang xử lý',completed:'Hoàn tất',failed:'Cần thử lại',cancelled:'Đã hủy'}[i.status]);if(i.result?.results)rows[n].results=i.result.results;});progress(state);});}

 global.WorkQueue={create,run,stop,render,characterBatch,active:()=>active};
})(window);
