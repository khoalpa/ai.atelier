(function setupSafeExit(global){
  'use strict';
  const byId=id=>document.getElementById(id);
  const finished=new Set(['completed','failed','cancelled','restart-required']);

  function activeJob(){
    const app=global.AtelierApp||{};
    return Boolean(app.activeJobId&&!finished.has(app.activityState?.status));
  }

  function open(){
    const dialog=byId('safeExitDialog'),notice=byId('safeExitNotice');
    if(!dialog||!notice)return;
    notice.classList.toggle('warning',activeJob());
    notice.innerHTML=activeJob()
      ? '<strong>Tác vụ nền đang hoạt động.</strong><span>Bạn có thể đóng an toàn. Tiến độ đã hoàn tất được giữ lại và tác vụ có thể tiếp tục trên máy.</span>'
      : '<strong>Mọi thứ đã sẵn sàng để đóng.</strong><span>Ảnh, kết quả và thiết lập đã lưu vẫn ở trên máy.</span>';
    dialog.showModal();
  }

  function closeWindow(){
    const dialog=byId('safeExitDialog');
    dialog?.close();
    global.close();
    global.setTimeout(()=>{
      document.body.classList.add('safe-exit-complete');
      document.body.innerHTML='<main class="safe-exit-screen"><div aria-hidden="true">✓</div><h1>Đã chuẩn bị đóng an toàn</h1><p>Dữ liệu đã lưu vẫn được giữ trên máy. Bạn có thể đóng thẻ trình duyệt này.</p><button type="button" onclick="location.reload()">Mở lại AI Atelier</button></main>';
      document.title='Có thể đóng AI Atelier';
    },250);
  }

  function setup(){
    byId('safeExitButton')?.addEventListener('click',open);
    byId('confirmSafeExit')?.addEventListener('click',closeWindow);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});
  else setup();
})(globalThis);
