(function(global){
 'use strict';
 async function mount(host,onWebRestart){
  if(!host)return;
  host.innerHTML='<span class="card-kicker">DỊCH VỤ TRÊN MÁY</span><h3>Phiên bản & kết nối</h3><p data-service-version></p><dl class="service-status"><dt>Giao diện</dt><dd data-service-web>Đang kiểm tra…</dd><dt>Xử lý AI</dt><dd data-service-ai>Đang kiểm tra…</dd><dt>Xuất ảnh nền</dt><dd data-service-render>Đang kiểm tra…</dd></dl><p>Lưu vùng chỉnh sửa trước khi nạp lại giao diện. Chỉ khởi động lại khi các tác vụ đã hoàn tất.</p><div class="workflow-actions"><button data-service-refresh>Làm mới</button><button data-service-ai-restart>Khởi động lại AI</button><button data-restart-web>Nạp lại giao diện</button><small data-restart-status role="status"></small></div><p data-service-message role="status"></p><details><summary>Nhật ký khởi động lại gần nhất</summary><pre data-service-log></pre></details>';
  const find=s=>host.querySelector('[data-service-'+s+']');let loading=false,pending=false;
  async function refresh(){if(loading||!host.isConnected)return;loading=true;try{const r=await fetch('/api/services'),d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'Không đọc được trạng thái dịch vụ.');if(!host.isConnected)return;
   find('version').textContent='AI Atelier '+d.expectedVersion;
   find('web').textContent=d.web.version+' · '+(d.web.needsRestart?'Cần nạp lại':'Đã cập nhật');
   find('ai').textContent=d.ai.online?d.ai.version+' · '+(d.ai.needsRestart?'Cần khởi động lại':d.ai.activeRequests?'Đang xử lý':'Sẵn sàng'):'Chưa kết nối';
   find('render').textContent=d.queue.rendererReady?'Sẵn sàng · tiếp tục khi đóng trang':'Cần Edge hoặc Chrome trên máy';
   pending=d.operation?.status==='running';find('ai-restart').disabled=pending||!d.ai.online||d.ai.activeRequests>0;
   host.querySelector('[data-restart-web]').disabled=pending;
   find('message').textContent=d.operation?.message||d.queue.error||'';find('log').textContent=d.operation?.log||'Chưa có nhật ký trong phiên này.';
  }catch(e){find('message').textContent=e.message;}finally{loading=false;}}
  find('refresh').onclick=refresh;host.querySelector('[data-restart-web]').onclick=onWebRestart;
  find('ai-restart').onclick=async()=>{find('ai-restart').disabled=true;find('message').textContent='Đang kiểm tra các tác vụ…';try{const r=await fetch('/api/services/restart-ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true})}),d=await r.json();if(!r.ok)throw Error(d.error);await refresh();}catch(e){find('message').textContent=e.message;find('ai-restart').disabled=false;}};
  await refresh();const timer=setInterval(()=>{if(!host.isConnected)return clearInterval(timer);refresh();},3000);
 }
 global.ServiceManagerUI={mount};
})(window);
