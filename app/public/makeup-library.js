/* Reference images yield cosmetic settings only; target face masks stay in Makeup. */
window.MakeupLibrary=(()=>{
  const el=id=>document.getElementById(id);
  let referenceImages=[],reference=null,analysis=null,selectedFace=null,saved=[],busy=false,revision=0;
  async function api(url,body){
    const response=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();if(!response.ok||data.ok===false)throw Error(data.error||'Không thể hoàn tất thao tác.');return data;
  }
  const selectedStyle=()=>saved.find(s=>s.id===el('makeupSavedStyle').value);
  function sync(){
    if(!el('makeupReferenceStatus'))return;
    const locked=busy||window.Makeup.isLocked();
    for(const id of ['makeupReferenceSelect','makeupReferenceUpload','makeupReferenceRefresh','makeupSavedStyle'])el(id).disabled=locked;
    el('makeupReferenceDetect').disabled=locked||!reference||!window.Makeup.referenceReady();
    el('makeupReferenceApply').disabled=locked||selectedFace===null||!analysis;
    el('makeupLoadStyle').disabled=locked||!selectedStyle();
    const savable=window.Makeup.descriptionReady()&&Boolean(el('makeupStyleName').value.trim());
    el('makeupSaveStyle').disabled=locked||!savable;el('makeupUpdateStyle').disabled=locked||!savable||!selectedStyle();
    el('makeupReferenceFaces').querySelectorAll('button').forEach(button=>button.disabled=locked);
  }
  async function work(statusId,fn){
    if(busy||window.Makeup.isLocked())return;
    busy=true;window.Makeup.setExtensionBusy(true);
    try{await fn();}catch(error){el(statusId).textContent=error.message;setMessage(error.message,'error');}
    finally{busy=false;window.Makeup.setExtensionBusy(false);}
  }
  function resetReference(){
    revision++;analysis=null;selectedFace=null;el('makeupReferenceFaces').replaceChildren();
    reference=referenceImages.find(image=>image.id===el('makeupReferenceSelect').value)||null;
    el('makeupReferenceImage').hidden=!reference;
    if(reference)el('makeupReferenceImage').src=reference.url;else el('makeupReferenceImage').removeAttribute('src');
    el('makeupReferenceStatus').textContent=reference?'Nhận diện rồi chọn khuôn mặt tham chiếu. Lấy gợi ý sẽ thay bộ thiết lập hiện tại.':'Chọn ảnh tham chiếu từ thư viện hoặc tải ảnh riêng.';sync();
  }
  async function loadImages(selected=el('makeupReferenceSelect').value){
    referenceImages=(await api('/api/images')).images;
    el('makeupReferenceSelect').replaceChildren(new Option('Chọn ảnh tham chiếu…',''));
    for(const image of referenceImages)el('makeupReferenceSelect').append(new Option(`${image.group} / ${image.name}`,image.id));
    el('makeupReferenceSelect').value=selected;resetReference();
  }
  async function detect(){return work('makeupReferenceStatus',async()=>{
    const id=reference.id,token=revision;el('makeupReferenceStatus').textContent='Đang nhận diện khuôn mặt tham chiếu…';
    // Discard old choices immediately, including after a failed re-detection.
    analysis=null;selectedFace=null;el('makeupReferenceFaces').replaceChildren();
    const result=await api('/api/makeup-reference',{sampleId:id});
    if(token!==revision||reference?.id!==id)return;
    analysis=result;
    for(const face of result.faces){
      const button=document.createElement('button'),image=new Image();button.type='button';button.dataset.face=face.index;button.setAttribute('aria-pressed','false');image.src=face.thumbnail;image.alt='';
      button.append(image,`Mặt tham chiếu ${face.index+1}`);button.onclick=()=>{
        if(busy||window.Makeup.isLocked())return;selectedFace=face.index;
        el('makeupReferenceFaces').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.face)===selectedFace)));
        el('makeupReferenceStatus').textContent='Đã chọn mặt tham chiếu '+(selectedFace+1)+'. Nhấn Lấy gợi ý để đọc màu.';sync();
      };el('makeupReferenceFaces').append(button);
    }
    if(result.faces.length===1){selectedFace=result.faces[0].index;el('makeupReferenceFaces').querySelector('button').setAttribute('aria-pressed','true');}
    el('makeupReferenceStatus').textContent=result.faces.length===1?'Đã chọn mặt tham chiếu. Nhấn Lấy gợi ý để đọc màu.':'Chọn đúng khuôn mặt muốn lấy phong cách.';
  });}
  async function applyReference(){return work('makeupReferenceStatus',async()=>{
    const id=reference.id,token=revision;el('makeupReferenceStatus').textContent='Đang đọc màu và độ đậm từ khuôn mặt…';
    const result=await api('/api/makeup-reference',{sampleId:id,faceIndex:selectedFace,sourceSha256:analysis.sourceSha256});
    if(token!==revision||reference?.id!==id)return;
    window.Makeup.loadStyle(result.plan,'Gợi ý từ ảnh tham chiếu · '+reference.name);
    el('makeupReferenceStatus').textContent=result.warnings.join(' ');
    el('makeupSavedStyle').value='';el('makeupStyleName').value='';
    setMessage('Đã lấy gợi ý. Chỉnh màu, độ đậm hoặc nhập mô tả bổ sung rồi xem thử.','success');
  });}
  function showStyles(items,selected=el('makeupSavedStyle').value){
    saved=items;el('makeupSavedStyle').replaceChildren(new Option('Chọn phong cách…',''));
    for(const style of saved)el('makeupSavedStyle').append(new Option(style.name,style.id));
    el('makeupSavedStyle').value=selected;sync();
  }
  async function save(update=false){return work('makeupLibraryStatus',async()=>{
    if(!window.Makeup.descriptionReady())throw Error('Đọc mô tả trước khi lưu phong cách.');
    const item=selectedStyle();if(update&&!item)throw Error('Chọn phong cách muốn cập nhật.');
    const result=await api('/api/makeup-library',{name:el('makeupStyleName').value,settings:window.Makeup.settings(),...(update?{id:item.id}:{})});
    showStyles(result.styles,result.item.id);el('makeupLibraryStatus').textContent='Đã lưu “'+result.item.name+'” trên máy. Có thể dùng trên ảnh khác.';
    setMessage('Đã lưu phong cách cá nhân.','success');
  });}
  async function upload(file){if(!file)return;return work('makeupReferenceStatus',async()=>{
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024)throw Error('Chọn ảnh PNG, JPG hoặc WebP nhỏ hơn 20 MB.');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Không đọc được ảnh tham chiếu.'));reader.readAsDataURL(file);});
    const result=await api('/api/images/upload',{name:file.name,data});await loadImages(result.image.id);
    el('makeupReferenceStatus').textContent='Đã thêm ảnh tham chiếu. Ảnh nhân vật đang chỉnh vẫn được giữ nguyên.';
  });}
  function setup(){
    el('makeupReferenceSelect').onchange=resetReference;
    el('makeupReferenceRefresh').onclick=()=>work('makeupReferenceStatus',()=>loadImages());
    el('makeupReferenceUpload').onclick=()=>el('makeupReferenceFile').click();
    el('makeupReferenceFile').onchange=event=>{const file=event.target.files[0];event.target.value='';upload(file);};
    el('makeupReferenceDetect').onclick=detect;el('makeupReferenceApply').onclick=applyReference;
    el('makeupSavedStyle').onchange=()=>{el('makeupStyleName').value=selectedStyle()?.name||'';sync();};
    el('makeupStyleName').oninput=sync;
    el('makeupLoadStyle').onclick=()=>{if(busy||window.Makeup.isLocked())return;const item=selectedStyle();if(item){window.Makeup.loadStyle(item.settings,'Phong cách của tôi · '+item.name);el('makeupLibraryStatus').textContent='Đã áp dụng thiết lập. Kiểm tra vùng trang điểm trên khuôn mặt hiện tại.';}};
    el('makeupSaveStyle').onclick=()=>save();el('makeupUpdateStyle').onclick=()=>save(true);
    loadImages().catch(error=>el('makeupReferenceStatus').textContent=error.message);
    api('/api/makeup-library').then(data=>showStyles(data.styles)).catch(error=>el('makeupLibraryStatus').textContent=error.message);
  }
  document.addEventListener('DOMContentLoaded',setup);
  return {sync};
})();
