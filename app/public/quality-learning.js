/* Local feedback and finishing: choosing an image never implies satisfaction. */
window.QualityLearning = (() => {
  const names = {'text-to-image':'Tạo ảnh mới', inpaint:'Xóa vật thể', tryon:'Thay trang phục', outpaint:'Mở rộng ảnh'};
  const defects = {blur:'Thiếu nét', seam:'Lộ đường nối', residual:'Còn vật thể', identity:'Thay đổi nhân vật', garment:'Sai trang phục', anatomy:'Lỗi hình thể', prompt:'Chưa đúng mô tả', color:'Sai màu', other:'Khác'};
  const profileNames = {validating:'Đang kiểm chứng', active:'Đang áp dụng', 'rolled-back':'Đã khôi phục mặc định', rejected:'Chưa đạt', superseded:'Đã thay thế'};
  const reasonNames = {'task-check':'Kết quả chưa đạt kiểm tra của tác vụ', 'already-finished':'Ảnh bố cục hoặc đã được hoàn thiện', 'image-too-large':'Ảnh vượt giới hạn kích thước', 'time-budget':'Hết thời gian xử lý cho phép', 'unsuitable-detail':'Không có vùng chi tiết phù hợp', 'mask-unavailable':'Thiếu hoặc sai vùng chỉnh sửa / bảo vệ', 'job-limit':'Đã dùng một lượt hoàn thiện của tác vụ', 'comparison-failed':'Bản thử chưa vượt kiểm tra pixel', 'mode-changed':'Chế độ tự động thay đổi trong lúc xử lý', 'source-changed':'Ảnh ban đầu thay đổi trong lúc xử lý', 'processing-error':'Không hoàn tất bước xử lý bổ sung', 'legacy-unspecified':'Bản ghi cũ chưa tách rõ nguyên nhân'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let latestJob = '', dialog = null, cache = null, dialogJob = '', refreshTimer = null, emptyPolls = 0;
  async function api(action = 'state', body = {}) {
    const response = await fetch('/api/quality-learning/' + action, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || 'Không thể đọc dữ liệu chất lượng.');
    if(result.feedbackWarning)status(result.feedbackWarning,true);
    return result;
  }
  function status(text, error = false) {
    const node = dialog?.querySelector('[data-quality-status]');
    if (node) { node.textContent = text; node.classList.toggle('has-error', error); }
  }
  function summary(data) {
    return `${data.summary.results} ảnh đã ghi nhận · ${data.summary.rated} đánh giá · ${data.summary.accepted} hài lòng · ${data.summary.compared} so sánh trước–sau`;
  }
  const count = value => Number(value || 0).toLocaleString('vi-VN');
  const seconds = value => value == null ? 'Chưa đo' : `${Number(value).toLocaleString('vi-VN', {maximumFractionDigits:3})} giây`;
  const percent = value => value == null ? 'Chưa có so sánh' : `${(value * 100).toLocaleString('vi-VN', {maximumFractionDigits:1})}%`;
  function reportContent(report) {
    const total = report.total;
    return `<p class="quality-report-period">Toàn bộ kết quả đã ghi nhận · Cập nhật ${esc(new Date(report.generatedAt).toLocaleString('vi-VN'))}</p>
      ${total.recorded ? '' : '<p class="quality-report-empty">Chưa có kết quả. Báo cáo sẽ có dữ liệu sau khi tác vụ mới hoàn tất và được kiểm tra.</p>'}
      <div class="quality-report-metrics"><div><strong>${count(total.recorded)}</strong><span>Ảnh đã ghi nhận · ${count(total.jobs)} tác vụ</span></div><div><strong>${count(total.improved)}</strong><span>Bản hoàn thiện vượt kiểm tra pixel</span></div><div><strong>${percent(total.preferImprovedRate)}</strong><span>Ưu tiên bản mới · ${count(total.compared)} so sánh</span></div><div><strong>${seconds(total.assessmentTime.averageSeconds)}</strong><span>Thời gian xử lý thêm trung bình · đã đo ${count(total.assessmentTime.samples)} / ${count(total.recorded)} ảnh</span></div></div>
      <div class="quality-report-table" role="region" aria-label="Báo cáo theo tác vụ" tabindex="0"><table><caption>Hiệu quả theo tác vụ</caption><thead><tr><th scope="col">Tác vụ</th><th scope="col">Ảnh ghi nhận</th><th scope="col">Có bản hoàn thiện</th><th scope="col">Giữ ảnh gốc</th><th scope="col">Ưu tiên bản mới</th><th scope="col">Xử lý thêm / ảnh</th></tr></thead><tbody>${report.tasks.map(row => `<tr><th scope="row">${esc(names[row.task])}</th><td>${count(row.recorded)}<small>${count(row.observed)} chỉ ghi nhận</small></td><td>${count(row.improved)}</td><td>${count(row.retained)}</td><td>${percent(row.preferImprovedRate)}<small>${count(row.preferImproved)} / ${count(row.compared)} so sánh</small></td><td>${seconds(row.assessmentTime.averageSeconds)}<small>Đã đo ${count(row.assessmentTime.samples)} / ${count(row.recorded)} ảnh</small></td></tr>`).join('')}</tbody></table></div>
      <p class="quality-report-note">Tỷ lệ ưu tiên = số lần chọn bản hoàn thiện / tất cả so sánh đã lưu, gồm cả lựa chọn tương đương. Vượt kiểm tra pixel chưa có nghĩa là người dùng thích hơn. Thời gian xử lý thêm gồm đọc ảnh, đánh giá và hoàn thiện nếu có; không gồm chờ nền hoặc tạo ảnh bằng AI. Bản ghi cũ thiếu thời gian không được tính là 0.</p>
      <div class="quality-report-details">${report.tasks.map(row => `<details><summary>${esc(names[row.task])} · ${count(row.retained)} ảnh giữ nguyên · ${count(row.rated)} đánh giá</summary><p>Đã thử hoàn thiện: ${count(row.attempted)} ảnh. Hài lòng: ${count(row.good)}; cần sửa: ${count(row.needsWork)}.</p><p>So sánh: ${count(row.preferImproved)} chọn bản mới · ${count(row.preferOriginal)} chọn ảnh ban đầu · ${count(row.tie)} tương đương.</p><p>Thời gian xử lý thêm lớn nhất: ${seconds(row.assessmentTime.maxSeconds)}. Riêng bước hoàn thiện trung bình: ${seconds(row.finishingTime.averageSeconds)} (${count(row.finishingTime.samples)} lượt có số đo).</p><h4>Lý do giữ ảnh gốc</h4>${row.reasons.length ? `<ul>${row.reasons.map(reason => `<li><span>${esc(reasonNames[reason.code] || reasonNames['legacy-unspecified'])}</span><strong>${count(reason.count)} ảnh</strong></li>`).join('')}</ul>` : '<p>Chưa có ảnh được giữ lại sau bước kiểm tra tự động.</p>'}</details>`).join('')}</div>`;
  }
  async function refreshReport(section) {
    if (!section?.isConnected) return;
    const button = section.querySelector('[data-quality-report-refresh]');
    const message = section.querySelector('[data-quality-report-status]');
    if (!button || button.disabled) return;
    button.disabled = true; message.textContent = 'Đang cập nhật báo cáo…';
    try {
      const {report} = await api('report'); if (!section.isConnected) return;
      section.querySelector('[data-quality-report]').innerHTML = reportContent(report);
      section.querySelector('[data-quality-settings-status]').textContent = summary({summary:{results:report.total.recorded, rated:report.total.rated, accepted:report.total.good, compared:report.total.compared}});
      message.textContent = 'Đã cập nhật báo cáo.';
    } catch (error) { message.textContent = 'Chưa cập nhật được báo cáo: ' + error.message; }
    finally { button.disabled = false; }
  }
  async function mountSettings(host) {
    host.querySelector('.quality-settings')?.remove();
    const section = document.createElement('section'); section.className = 'quality-settings';
    section.innerHTML = '<h2>Hoàn thiện chi tiết tự động</h2><p data-quality-settings-status role="status">Đang đọc cài đặt…</p>';
    host.querySelector('.settings-dashboard')?.after(section);
    try {
      const data = await api(); if (!section.isConnected) return;
      cache = data;
      section.innerHTML = `<h2>Hoàn thiện chi tiết tự động</h2><p>Ghi nhận bốn loại tác vụ sau khi hoàn tất. Chế độ tự động thử tăng chi tiết nhẹ trong vùng được phép sửa, tối đa một phương án mỗi tác vụ. Ảnh và phản hồi chỉ lưu trên máy.</p>
        <form><div class="quality-settings-fields"><label>Chế độ<select name="mode"><option value="off">Tắt</option><option value="observe">Chỉ ghi nhận và đánh giá</option><option value="auto">Tự động hoàn thiện chi tiết</option></select></label><label>Ngân sách hoàn thiện (giây)<input name="maxSeconds" type="number" min="2" max="30" step="1" value="${data.settings.maxSeconds}" required></label></div><button type="submit">Lưu cài đặt</button> <button type="button" data-quality-history>Xem kết quả và phản hồi</button></form>
        <p data-quality-settings-status role="status">${esc(summary(data))}</p><small>Ảnh tự hoàn thiện tối đa 4 triệu pixel. Các lỗi nội dung như sai trang phục, còn vật thể hoặc lỗi hình thể cần xem lại. Cấu hình học được chỉ điều chỉnh bước hoàn thiện nhẹ; thông số tạo ảnh bạn đã chọn được giữ nguyên.</small>
        <section class="quality-report" aria-label="Báo cáo hiệu quả"><div class="quality-report-heading"><h3>Báo cáo hiệu quả</h3><button type="button" data-quality-report-refresh>Làm mới báo cáo</button></div><p data-quality-report-status role="status"></p><div data-quality-report></div></section>
        <div class="quality-profiles"><h3>Cấu hình đã học</h3>${data.profiles.length ? data.profiles.map(p => `<article><strong>${esc(names[p.task])} · ${esc(p.model)} · ${esc(p.group)}</strong><p>${esc(profileNames[p.state])} · ${p.holdoutCount} nhóm ảnh kiểm chứng · ${p.wins} nhóm ưu tiên bản mới</p>${['active','validating'].includes(p.state) ? `<button type="button" data-quality-rollback="${esc(p.id)}">Khôi phục mặc định</button>` : ''}</article>`).join('') : '<p>Chưa đủ phản hồi. Cần ít nhất 3 nhóm nội dung độc lập để chọn cấu hình, rồi ít nhất 5 nhóm mới để kiểm chứng trước khi áp dụng.</p>'}</div>`;
      section.querySelector('[name=mode]').value = data.settings.mode;
      section.querySelector('form').onsubmit = async event => {
        event.preventDefault(); const button = section.querySelector('[type=submit]'); button.disabled = true;
        const message = section.querySelector('[data-quality-settings-status]');
        try {
          const result = await api('configure', {mode:section.querySelector('[name=mode]').value, maxSeconds:Number(section.querySelector('[name=maxSeconds]').value), revision:data.settings.revision});
          data.settings = result.settings; message.textContent = 'Đã lưu. Áp dụng cho tác vụ hoàn tất tiếp theo.';
        } catch (error) { message.textContent = error.message; }
        finally { button.disabled = false; }
      };
      section.querySelector('[data-quality-history]').onclick = () => open('');
      section.querySelector('[data-quality-report-refresh]').onclick = () => refreshReport(section);
      await refreshReport(section);
      for (const button of section.querySelectorAll('[data-quality-rollback]')) button.onclick = async () => {
        button.disabled = true;
        try { await api('rollback', {profileId:button.dataset.qualityRollback}); await mountSettings(host); }
        catch (error) { section.querySelector('[data-quality-settings-status]').textContent = error.message; button.disabled = false; }
      };
    } catch (error) { section.querySelector('[data-quality-settings-status]').textContent = error.message; }
  }
  function cards(data) {
    return data.results.map(r => {
      const f = r.feedback || {};
      return `<article class="quality-result" data-quality-result="${esc(r.id)}"><div class="quality-result-heading"><strong>${esc(names[r.task])} · seed ${esc(r.seed ?? '—')}</strong><span>${r.status === 'improved' ? 'Có bản hoàn thiện' : r.status === 'retained' ? 'Giữ bản ban đầu' : 'Cần đánh giá'}</span></div><p>${esc(r.message)}</p>
        <div class="quality-image-pair"><figure><a href="${esc(r.original)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(r.original)}" alt="Ảnh ban đầu"></a><figcaption>Ảnh ban đầu</figcaption></figure>${r.improved ? `<figure><a href="${esc(r.improved)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(r.improved)}" alt="Bản hoàn thiện nhẹ"></a><figcaption>Bản hoàn thiện nhẹ · ${(r.finishingSeconds || 0).toFixed(2)} giây</figcaption></figure>` : ''}</div>
        <div class="quality-feedback"><label>Ảnh đang đánh giá<select data-quality-target><option value="original">Ảnh ban đầu</option>${r.improved ? `<option value="improved" ${f.target === 'improved' ? 'selected' : ''}>Bản hoàn thiện</option>` : ''}</select></label><label>Điểm cần sửa<select data-quality-defect><option value="">Chọn nếu có</option>${Object.entries(defects).map(([id,label]) => `<option value="${id}" ${f.defects?.includes(id) ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="button-row"><button data-quality-rate="good">Hài lòng</button><button data-quality-rate="needs-work">Cần sửa</button><button data-quality-rate="clear">Xóa đánh giá</button></div>
        ${r.improved ? '<p>Sau khi xem cả hai ảnh, bạn ưu tiên:</p><div class="button-row"><button data-quality-prefer="improved">Bản hoàn thiện</button><button data-quality-prefer="original">Ảnh ban đầu</button><button data-quality-prefer="tie">Tương đương</button></div>' : ''}
        <p class="quality-feedback-saved">${f.rating ? `Đã lưu: ${f.rating === 'good' ? 'Hài lòng' : 'Cần sửa'} · ${f.target === 'improved' ? 'bản hoàn thiện' : 'ảnh ban đầu'}. ` : 'Chưa có đánh giá. '}${f.preference ? `Ưu tiên: ${{original:'ảnh ban đầu',improved:'bản hoàn thiện',tie:'tương đương'}[f.preference]}.` : ''}</p>
        <div class="button-row"><a data-quality-download href="${esc(f.target === 'improved' && r.improved ? r.improved : r.original)}" download>Tải ảnh đang chọn</a><button data-quality-continue>Dùng để chỉnh sửa tiếp</button></div>
        <details><summary>Thông tin kiểm tra</summary><p>${esc(r.model)} · ${r.width} × ${r.height} px. ${r.technical.passed ? 'Không phát hiện vi phạm trong các kiểm tra hiện có.' : esc(r.technical.reasons.join(' '))} Nội dung và thẩm mỹ cần được xem trực tiếp.</p>${r.comparison ? `<p>Thay đổi lớn nhất: ${r.comparison.maxDelta}/255. Ngoài vùng cho phép: ${r.comparison.outsideMaxDelta}/255. ${r.comparison.passed ? 'Bản thử vượt kiểm tra pixel.' : 'Bản thử không vượt kiểm tra pixel.'}</p>` : ''}</details></div></article>`;
    }).join('');
  }
  async function refreshDialog() {
    const currentDialog = dialog; if (!currentDialog?.open) return;
    const data = await api('state', {jobId:dialogJob}); if (dialog !== currentDialog) return;
    cache = data;
    const list = currentDialog.querySelector('[data-quality-list]');
    list.innerHTML = cards(data) || `<p>${data.settings.mode === 'off' ? 'Tính năng đang tắt. Bật trong Cài đặt để ghi nhận các tác vụ tiếp theo.' : dialogJob ? 'Chưa có đánh giá cho tác vụ này. Bộ kiểm tra đọc kết quả sau khi tác vụ hoàn tất.' : 'Chưa có kết quả được ghi nhận. Các tác vụ mới sẽ xuất hiện ở đây sau khi hoàn tất.'}</p>`;
    status(summary(data) + (data.jobs.processing ? ' · Đang kiểm tra kết quả…' : '') + (data.errors.length || data.workerError ? ' · Có lượt kiểm tra chưa hoàn tất; ảnh đã tạo vẫn được giữ.' : ''));
    if (data.errors.length) {
      const details = document.createElement('details');
      const title = document.createElement('summary'); title.textContent = 'Lượt kiểm tra cần chú ý'; details.append(title);
      for (const error of data.errors) { const p = document.createElement('p'); p.textContent = `${error.id}: ${error.error}`; details.append(p); }
      list.append(details);
    }
    if (!data.results.length && dialogJob && data.settings.mode !== 'off' && emptyPolls++ < 10) {
      clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refreshDialog().catch(error => status(error.message, true)), 4000);
    }
  }
  async function open(jobId = latestJob) {
    dialog?.close(); dialogJob = jobId; emptyPolls = 0;
    dialog = document.createElement('dialog'); dialog.className = 'quality-dialog';
    dialog.setAttribute('aria-label', 'Đánh giá và cải thiện chất lượng');
    dialog.innerHTML = '<header><h2>Đánh giá và cải thiện chất lượng</h2><button data-quality-close aria-label="Đóng đánh giá">Đóng</button></header><p data-quality-status role="status">Đang đọc kết quả…</p><div class="button-row"><button data-quality-all>Tất cả kết quả gần đây</button><button data-quality-refresh>Làm mới</button></div><div data-quality-list></div>';
    const currentDialog = dialog;
    currentDialog.addEventListener('close', () => { clearTimeout(refreshTimer); currentDialog.remove(); if (dialog === currentDialog) dialog = null; });
    currentDialog.querySelector('[data-quality-close]').onclick = () => currentDialog.close();
    currentDialog.querySelector('[data-quality-all]').onclick = () => { dialogJob = ''; refreshDialog().catch(error => status(error.message, true)); };
    currentDialog.querySelector('[data-quality-refresh]').onclick = () => refreshDialog().catch(error => status(error.message, true));
    currentDialog.addEventListener('change', event => {
      const card = event.target.closest('[data-quality-result]'); if (!card) return;
      const result = cache.results.find(r => r.id === card.dataset.qualityResult);
      card.querySelector('[data-quality-download]').href = card.querySelector('[data-quality-target]').value === 'improved' ? result.improved : result.original;
    });
    currentDialog.addEventListener('click', async event => {
      const card = event.target.closest('[data-quality-result]'), button = event.target.closest('button');
      if (!card || !button) return;
      const result = cache.results.find(r => r.id === card.dataset.qualityResult), target = card.querySelector('[data-quality-target]').value;
      const request = {resultId:result.id, target};
      button.disabled = true;
      try {
        if (button.hasAttribute('data-quality-rate')) {
          request.rating = button.dataset.qualityRate;
          const defect = card.querySelector('[data-quality-defect]').value;
          request.defects = request.rating === 'needs-work' && defect ? [defect] : [];
          await api('feedback', request); await refreshDialog();
          await refreshReport(document.querySelector('.quality-settings'));
        } else if (button.hasAttribute('data-quality-prefer')) {
          await api('feedback', {...request, preference:button.dataset.qualityPrefer}); await refreshDialog();
          await refreshReport(document.querySelector('.quality-settings'));
        } else if (button.hasAttribute('data-quality-continue')) {
          if (typeof globalThis.AtelierApp.activeJobId !== 'undefined' && globalThis.AtelierApp.activeJobId) throw new Error('Hãy đợi tác vụ hiện tại hoàn tất.');
          const response = await fetch(target === 'improved' ? result.improved : result.original);
          if (!response.ok) throw new Error('Không đọc được ảnh đã lưu.');
          const blob = await response.blob();
          await globalThis.AtelierApp.uploadSourceImage(new File([blob], 'anh-chinh-sua-tiep.png', {type:blob.type}));
          await api('feedback', {...request, selected:true});
          currentDialog.close(); globalThis.AtelierApp.setStudioMode('inpaint'); globalThis.AtelierApp.activateAppView('create');
          globalThis.AtelierApp.setMessage('Đã mở ảnh để chỉnh sửa tiếp. Chọn công cụ và vùng cần sửa.', 'success');
        }
      } catch (error) { status(error.message, true); }
      finally { button.disabled = false; }
    });
    document.body.append(currentDialog); currentDialog.showModal();
    try { await refreshDialog(); } catch (error) { status(error.message, true); }
  }
  function notifyJob(state) {
    if (['enhance','makeup','character'].includes(state?.taskType)) {
      document.getElementById('studioResultsTrayQuality')?.remove();
      return;
    }
    if (state?.status !== 'completed' || !state.jobId) return;
    latestJob = state.jobId;
    for (const id of [state.taskType === 'text-to-image' ? 'chromaGallery' : 'studioResultsTray']) {
      const host = document.getElementById(id); if (!host) continue;
      let bar = document.getElementById(id + 'Quality');
      if (!bar) {
        bar = document.createElement('div'); bar.id = id + 'Quality'; bar.className = 'quality-result-link';
        if (id === 'studioResultsTray') host.append(bar); else host.after(bar);
      }
      bar.innerHTML = '<button type="button">Đánh giá & cải thiện chất lượng</button><small>Ảnh đã lưu. Kiểm tra bổ sung chạy nền.</small>';
      bar.querySelector('button').onclick = () => open(state.jobId);
    }
  }
  function selection(params) { return api('selection', params).catch(() => null); }
  return {mountSettings, notifyJob, open, selection};
})();
