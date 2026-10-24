'use strict';
// Owned state: RESET_SCOPE_UI
// Dependencies: $, activateAppView, buildGoldenBaseline, current, escapeHtml, images, loadImage, loadReviewState, readableRequestError, renderImageOptions, setMessage, showEmptyEditorState
module.exports=function createSettings(deps){
let RESET_SCOPE_UI;
function systemStateLabel(model){if(model.ready&&model.operationalReady!==false)return 'Sẵn sàng';return model.runtimeReason||'Thiếu tệp model';}

function formatResetSize(bytes){if(!bytes)return '0 KB';const units=['B','KB','MB','GB'];let value=bytes,index=0;while(value>=1024&&index<units.length-1){value/=1024;index++;}return `${value.toFixed(index?1:0)} ${units[index]}`;}

async function reloadSourceImages(){
  const selectedId=deps.current?.id;
  const response=await fetch('/api/images'),data=await response.json();
  if(!response.ok)throw new Error(data.error||'Không thể tải lại danh sách ảnh');
  deps.images=data.images||[];deps.renderImageOptions();
  const selected=deps.images.find((item)=>item.id===selectedId);if(selected)await deps.loadImage(selected);else deps.showEmptyEditorState();
}

async function resetWorkspaceScope(scope,button){
  const label=scope==='all'?'toàn bộ dữ liệu làm việc':RESET_SCOPE_UI[scope]?.[0]||scope;
  if(!window.confirm(`Đặt lại ${label}?\n\nDữ liệu sẽ được chuyển vào kho phục hồi trên máy, không bị xóa vĩnh viễn. Model, cấu hình và ảnh mẫu không bị ảnh hưởng.`))return;
  const feedback=document.querySelector('.reset-feedback'),original=button.textContent;button.disabled=true;button.textContent='Đang đặt lại…';
  try{
    const response=await fetch('/api/reset-data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope,confirm:true})});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể đặt lại dữ liệu');
    if(feedback)feedback.textContent=result.movedItems?`Đã đặt lại ${label}. ${result.movedFiles} tệp đã được chuyển vào ${result.archive}.`:`${label} hiện đã trống.`;
    if(['uploads','all'].includes(scope))await reloadSourceImages();
    if(['review','quality','all'].includes(scope))await deps.loadReviewState();
    await loadSystemOverview();
  }catch(error){if(feedback)feedback.textContent=error.message;deps.setMessage(error.message,'error');button.disabled=false;button.textContent=original;}
}

async function openModelManager(){
  deps.activateAppView('model');
}

async function loadSystemOverview(){
  const root=deps.$('systemOverview');if(!root)return;
  root.setAttribute('aria-busy','true');
  try{
    const response=await fetch('/api/system-overview'),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Không thể kiểm tra hệ thống');
    const summary=result.summary,allReady=result.ready;
    root.innerHTML=`
      <section class="system-status ${allReady?'is-ready':'needs-attention'}">
        <div><span class="system-pulse"></span><div><strong>${allReady?'Các công cụ đã sẵn sàng chạy ngoại tuyến':'Hệ thống cần xử lý'}</strong><small>Kiểm tra lúc ${new Date(result.checkedAt).toLocaleTimeString('vi-VN')} · ${result.offline?'Dữ liệu chỉ lưu trên máy':'Đang dùng kết nối ngoài'}</small></div></div>
        <button data-system-refresh>Kiểm tra lại</button>
      </section>
      <section class="system-metrics" aria-label="Tổng quan hệ thống">
        <article><span>MODEL</span><strong>${summary.readyCount}/${summary.totalModels}</strong><small>model đủ điều kiện kỹ thuật</small></article>
        <article><span>THIẾT BỊ</span><strong>${deps.escapeHtml(summary.gpu)}</strong><small>${summary.gpuMemoryMb?`${summary.gpuMemoryMb} MB VRAM`:'Chế độ CPU'}</small></article>
        <article><span>LƯU TRỮ</span><strong>${summary.diskFreeGb??'—'} GB</strong><small>dung lượng còn trống</small></article>
        <article><span>KHÔI PHỤC</span><strong>${summary.backupCount}</strong><small>bản sao lưu cục bộ</small></article>
      </section>
      <section class="workflow-card"><strong>Chất lượng tham chiếu trang phục: ${result.referenceReadiness?.readyCount??0}/${result.referenceReadiness?.total??3} bộ đạt kiểm định</strong><p>Model đủ điều kiện chạy chưa đồng nghĩa ảnh đã đạt chất lượng. Kiểm tra kết quả tại Duyệt trước khi bàn giao.</p></section>
      <section class="system-layout">
        <div class="system-main">
          <div class="section-heading"><div><span class="card-kicker">MODEL CỤC BỘ</span><h2>Khả năng đang sử dụng</h2></div><button data-open-model-manager>Quản lý model</button></div>
          <div class="system-models">${result.models.map((model)=>`<article><span class="model-state ${model.ready&&model.operationalReady!==false?'ok':'warn'}"></span><div><strong>${deps.escapeHtml(model.name)}</strong><small>${deps.escapeHtml(model.kind)} · ${deps.escapeHtml(systemStateLabel(model))}</small></div><span class="state-badge">${model.selected?'Đã chọn':'Khả dụng'}</span></article>`).join('')}</div>
        </div>
        <aside class="system-side">
          <article class="system-action"><span class="card-kicker">AN TOÀN DỮ LIỆU</span><h3>Sao lưu và khôi phục</h3><p>${result.backups[0]?.createdAt?`Gần nhất: ${new Date(result.backups[0].createdAt).toLocaleString('vi-VN')}`:'Chưa có bản sao lưu.'}</p><button data-system-backup>Sao lưu ngay</button></article>
          <article class="system-action"><span class="card-kicker">DỮ LIỆU CHUẨN</span><h3>Baseline hồi quy</h3><p>${result.baseline?`${result.baseline.caseCount} trường hợp · ${new Date(result.baseline.createdAt).toLocaleDateString('vi-VN')}`:'Chưa tạo baseline.'}</p><button data-system-baseline>${result.baseline?'Tạo lại baseline':'Tạo baseline'}</button></article>
          <article class="system-action compact"><span class="card-kicker">TÁC VỤ</span><h3>${summary.runningJobs} đang chạy · ${summary.interruptedJobs} gián đoạn</h3><button data-trigger="jobsButton">Mở hàng tác vụ</button></article>
        </aside>
      </section>
      <section class="system-reset">
        <div class="section-heading"><div><span class="card-kicker">ĐẶT LẠI DỮ LIỆU</span><h2>Dọn các danh sách cục bộ</h2></div><span class="reset-archive-count">${result.resetData.archives} lần đặt lại có thể phục hồi</span></div>
        <p class="reset-note">Dữ liệu được chuyển vào kho phục hồi, không xóa vĩnh viễn. Model, cấu hình, bản sao lưu và ảnh mẫu luôn được giữ nguyên.</p>
        <div class="reset-grid">${Object.entries(RESET_SCOPE_UI).map(([scope,[label,description]])=>{const data=result.resetData.scopes[scope]||{items:0,files:0,bytes:0};return `<article><div><strong>${label}</strong><small>${description}</small><span>${data.items} mục · ${data.files} tệp · ${formatResetSize(data.bytes)}</span></div><button class="danger" data-reset-scope="${scope}" ${data.items?'':'disabled'}>Đặt lại</button></article>`;}).join('')}</div>
        <div class="reset-footer"><p class="reset-feedback" role="status">Chọn từng nhóm để kiểm soát chính xác dữ liệu cần dọn.</p><button class="danger" data-reset-scope="all" ${Object.values(result.resetData.scopes).some((item)=>item.items)?'':'disabled'}>Đặt lại toàn bộ dữ liệu làm việc</button></div>
      </section>`;
    root.querySelector('[data-system-refresh]')?.addEventListener('click',loadSystemOverview);
    root.querySelector('[data-system-backup]')?.addEventListener('click',()=>window.BackupUI.open());
    root.querySelector('[data-system-baseline]')?.addEventListener('click',async()=>{await deps.buildGoldenBaseline();await loadSystemOverview();});
    for(const button of root.querySelectorAll('[data-reset-scope]'))button.addEventListener('click',()=>resetWorkspaceScope(button.dataset.resetScope,button));
  }catch(error){root.innerHTML=`<section class="system-status needs-attention"><div><span class="system-pulse"></span><div><strong>Không thể đọc trạng thái hệ thống</strong><small>${deps.escapeHtml(deps.readableRequestError(error))}</small></div></div><button data-system-refresh>Thử lại</button></section>`;root.querySelector('[data-system-refresh]')?.addEventListener('click',loadSystemOverview);}
  finally{root.removeAttribute('aria-busy');}
}
return {bindings:{get systemStateLabel(){return systemStateLabel;},set systemStateLabel(value){systemStateLabel=value;},
get RESET_SCOPE_UI(){return RESET_SCOPE_UI;},set RESET_SCOPE_UI(value){RESET_SCOPE_UI=value;},
get formatResetSize(){return formatResetSize;},set formatResetSize(value){formatResetSize=value;},
get reloadSourceImages(){return reloadSourceImages;},set reloadSourceImages(value){reloadSourceImages=value;},
get resetWorkspaceScope(){return resetWorkspaceScope;},set resetWorkspaceScope(value){resetWorkspaceScope=value;},
get openModelManager(){return openModelManager;},set openModelManager(value){openModelManager=value;},
get loadSystemOverview(){return loadSystemOverview;},set loadSystemOverview(value){loadSystemOverview=value;}},steps:[
function initialize(){
(RESET_SCOPE_UI = {
  uploads:['Ảnh của bạn','Ảnh do bạn tải lên; ảnh mẫu có sẵn được giữ nguyên.'],
  manual:['Chỉnh sửa thủ công','Phiên chỉnh sửa, ảnh gốc của phiên và bộ màu đã lưu.'],
  masks:['Mask đã lưu','Các mask đã lưu từ những phiên chỉnh sửa trước.'],
  review:['Hàng duyệt','Trạng thái chờ duyệt, chấp nhận, chạy lại và loại bỏ.'],
  jobs:['Tác vụ','Lịch sử tác vụ đã hoàn tất hoặc bị gián đoạn.'],
  quality:['Chất lượng','Báo cáo, baseline, hiệu chỉnh và benchmark chất lượng.'],
  outputs:['Kết quả tạo ảnh','Các ảnh kết quả và thư mục chạy đã sinh ra.'],
});
}
]};
};
