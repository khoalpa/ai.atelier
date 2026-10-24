/* Independent controls and a source-bound, reviewed queue of ordinary jobs. */
window.CharacterExtra=(()=>{
  'use strict';
  const el=id=>document.getElementById(id),clone=value=>structuredClone(value);
  let api,perPerson={},handSide='right',qualityRecovery=true,catalogPoses=[['keep','Giữ tư thế']],selected=[],people=[],queue=[],running=false,stop=false;
  const key='atelier-character-queue-v2';
  const select=(id,items)=>{const node=el(id),old=node.value;node.replaceChildren(...items.map(([v,t])=>new Option(t,String(v))));if(items.some(([v])=>String(v)===old))node.value=old;};
  const individual=()=>Number(el('characterIndividual').value);
  function settings(){return {handSide,qualityRecovery,perPerson:Object.fromEntries(Object.entries(perPerson).filter(([id])=>selected.includes(Number(id))))};}
  function refreshPeople(analysis,ids){
    people=analysis?.people||[];selected=[...ids];for(const id of Object.keys(perPerson))if(!ids.includes(Number(id)))delete perPerson[id];
    if(!api)return;select('characterIndividual',ids.map(id=>[id,'Người '+(id+1)]));loadIndividual();
  }
  function reset(){perPerson={};selected=[];people=[];if(api){select('characterIndividual',[]);loadIndividual();}}
  function restore(s){perPerson=clone(s.perPerson||{});handSide=s.handSide||'right';qualityRecovery=s.qualityRecovery!==false;el('characterHandSide').value=handSide;el('characterQualityRecovery').checked=qualityRecovery;}
  function loadIndividual(){
    const id=individual(),value=perPerson[id],exists=selected.includes(id);el('characterIndividualEnabled').checked=Boolean(value);
    el('characterIndividualEnabled').disabled=!exists;el('characterIndividualFields').disabled=!exists||!value;
    const s={...api.settings(),...value};
    select('characterIndividualPose',catalogPoses.filter(([value])=>!['handshake','handover','look_each_other','group'].includes(value)));
    select('characterIndividualExpression',[...el('characterExpression').options].map(o=>[o.value,o.textContent]));
    for(const [name,k] of [['Pose','pose'],['Expression','expression'],['Intensity','intensity'],['Yaw','yaw'],['GazeX','gazeX']])el('characterIndividual'+name).value=k==='pose'&&['handshake','handover','look_each_other','group'].includes(s[k])?'keep':s[k]??0;
    el('characterIndividualHandSide').value=s.handSide||handSide;loadHand();
    el('characterHandSide').disabled=s.mode==='face';
    for(const suffix of ['IndividualPose','IndividualHandSide','Hand','Gesture','Spread','WristRotation','Contact','ContactX','ContactY',...Array.from({length:5},(_,i)=>'Finger'+i)])el('character'+suffix).disabled=s.mode==='face'||suffix==='IndividualPose'&&['handshake','handover','look_each_other'].includes(s.pose);
  }
  function loadHand(){
    const hand=el('characterHand').value,s=perPerson[individual()]?.hands?.[hand]||{};
    el('characterGesture').value=s.gesture||'auto';el('characterFingerControls').hidden=el('characterGesture').value!=='custom';
    for(let i=0;i<5;i++)el('characterFinger'+i).value=s.fingers?.[i]||0;
    el('characterSpread').value=s.spread??.5;el('characterWristRotation').value=s.rotation||0;el('characterContact').checked=Boolean(s.contact);
    const wrist=api.target(individual())?.[hand==='left'?9:10];el('characterContactX').value=s.contact?.x??wrist?.[0]??.5;el('characterContactY').value=s.contact?.y??wrist?.[1]??.5;
    el('characterContactFields').hidden=!s.contact;
  }
  function saveIndividual(clearPose=false){
    if(api.locked())return;const id=individual(),old=perPerson[id];if(!old)return;
    for(const [name,k] of [['Pose','pose'],['Expression','expression'],['Intensity','intensity'],['Yaw','yaw'],['GazeX','gazeX']])if(!el('characterIndividual'+name).disabled)old[k]=['pose','expression'].includes(k)?el('characterIndividual'+name).value:Number(el('characterIndividual'+name).value);
    if(!el('characterIndividualHandSide').disabled)old.handSide=el('characterIndividualHandSide').value;api.invalidate(clearPose);
  }
  function saveHand(){
    if(api.locked())return;const item=perPerson[individual()];if(!item)return;item.hands||={};
    const value={gesture:el('characterGesture').value,fingers:Array.from({length:5},(_,i)=>Number(el('characterFinger'+i).value)),spread:Number(el('characterSpread').value),rotation:Number(el('characterWristRotation').value)};
    if(el('characterContact').checked)value.contact={x:Number(el('characterContactX').value),y:Number(el('characterContactY').value)};
    item.hands[el('characterHand').value]=value;el('characterContactFields').hidden=!value.contact;el('characterFingerControls').hidden=value.gesture!=='custom';api.invalidate(Boolean(value.contact));
  }
  async function refine(){
    if(api.locked())return;const id=individual(),a=api.analysis();if(!a||!selected.includes(id))return api.notice('Nhận diện và chọn nhân vật trước.','error');
    const source=api.source()?.id,description=el('characterRefineDescription').value.trim(),snapshot=JSON.stringify(api.settings());api.setBusy(true);
    try{
      const current={...api.settings(),...perPerson[id]},value=await api.post('/api/character-refine',{description,current});
      if(api.source()?.id!==source||JSON.stringify(api.settings())!==snapshot||el('characterRefineDescription').value.trim()!==description)throw Error('Thiết lập đã thay đổi. Đọc lại yêu cầu sửa tiếp.');
      const targets=clone(api.settings().targetPoses),q=clone(api.target(id));
      for(const move of value.moves){q[move.joint][0]+=move.dx;q[move.joint][1]+=move.dy;if(q[move.joint].slice(0,2).some(v=>v<.01||v>.99))throw Error('Khớp vượt khung ảnh. Mở rộng ảnh hoặc giảm thay đổi.');q[move.joint][2]=1;}
      if(value.moves.length)targets[id]=q;
      perPerson[id]={...perPerson[id],...value.changes};api.setTargets(targets);loadIndividual();el('characterRefineSummary').textContent=value.summary+' Kiểm tra lại vùng tác động trước khi tạo.';
      api.notice('Đã cập nhật riêng phần được yêu cầu. Các thiết lập khác được giữ.','success');
    }catch(e){api.notice(e.message,'error');}finally{api.setBusy(false);}
  }
  function persist(){
    try{localStorage.setItem(key,JSON.stringify(queue.map(({overlay,...row})=>row)));}catch{api.notice('Bộ nhớ trình duyệt đã đầy; danh sách này chỉ giữ trong phiên hiện tại.','error');}
  }
  function transfer(q,from,to){
    const center=p=>[(p[11][0]+p[12][0])/2,(p[11][1]+p[12][1])/2],height=p=>Math.hypot((p[5][0]+p[6][0]-p[11][0]-p[12][0])/2,(p[5][1]+p[6][1]-p[11][1]-p[12][1])/2),width=p=>Math.hypot(p[5][0]-p[6][0],p[5][1]-p[6][1]),a=center(from),b=center(to);
    const sx=width(to)/Math.max(.01,width(from)),sy=height(to)/Math.max(.01,height(from));
    return q.map(p=>[(p[0]-a[0])*sx+b[0],(p[1]-a[1])*sy+b[1],p[2]]);
  }
  function requestFor(row){
    const s=clone(row.template),ids=row.mapping.map(Number);
    if(row.mapping.some(id=>id==='')||new Set(ids).size!==ids.length)throw Error('Chọn các nhân vật khác nhau cho từng vai.');
    const per={},targets={};
    row.template.personIds.forEach((old,n)=>{
      const id=ids[n],person=row.analysis.people.find(p=>p.id===id),original=row.sourcePeople.find(p=>p.id===old);
      if(!person||!original)throw Error('Nhân vật không còn trong ảnh.');
      if(s.perPerson?.[old]){
        per[id]=clone(s.perPerson[old]);
        for(const hand of Object.values(per[id].hands||{}))if(hand.contact){
          const q=Array.from({length:17},()=>[hand.contact.x,hand.contact.y,1]),point=transfer(q,original.keypoints,person.keypoints)[0];hand.contact={x:point[0],y:point[1]};
        }
      }
      if(s.mode!=='face'&&s.targetPoses?.[old]){targets[id]=transfer(s.targetPoses[old],original.keypoints,person.keypoints);if(targets[id].some(p=>p[2]>.25&&p.slice(0,2).some(v=>v<0||v>1)))throw Error('Tư thế vượt khung ảnh này. Chỉnh riêng ảnh trước khi áp dụng.');targets[id].forEach(p=>{p[0]=Math.max(0,Math.min(1,p[0]));p[1]=Math.max(0,Math.min(1,p[1]));});}
    });
    return {...s,sampleId:row.sampleId,sourceSha256:row.analysis.sourceSha256,personIds:ids,perPerson:per,targetPoses:targets,limitSelection:false,protectedDetailMask:undefined,editableMask:undefined,preview:false,variantOffset:0};
  }
  function renderQueue(){
    const host=el('characterBatchRows');host.replaceChildren();
    for(const row of queue){
      const article=document.createElement('article');article.className='character-batch-row';const title=document.createElement('strong');title.textContent=row.name;article.append(title);
      if(!row.results){
        row.template.personIds.forEach((id,n)=>{
          const label=document.createElement('label'),choice=document.createElement('select');label.textContent='Áp dụng vai người '+(id+1)+' cho';choice.add(new Option('Chọn người trong ảnh này…',''));
          for(const p of row.analysis.people)choice.add(new Option('Người '+(p.id+1),String(p.id)));choice.value=row.mapping[n];choice.disabled=running;
          choice.onchange=()=>{if(api.locked())return;delete row.jobId;row.mapping[n]=choice.value;row.approved=false;row.request=null;row.overlay=null;row.status='Chưa duyệt';persist();renderQueue();};label.append(choice);article.append(label);
        });
        const preview=document.createElement('button');preview.textContent='Kiểm tra ảnh này';preview.disabled=running;
        preview.onclick=async()=>{if(api.locked())return;preview.disabled=true;api.setBusy(true);try{const request=requestFor(row),plan=await api.post('/api/character-preview',request);if(row.request?.planHash!==plan.planHash)delete row.jobId;row.request={...request,planHash:plan.planHash,targetPoses:plan.targetPoses};row.overlay=plan.overlay;row.approved=false;row.status='Xem vùng cam rồi đánh dấu đồng ý.';persist();}catch(e){row.status=e.message;row.request=null;row.approved=false;}finally{api.setBusy(false);renderQueue();}};article.append(preview);
        if(row.overlay){const image=new Image();image.src=row.overlay;image.alt='Vùng thay đổi của '+row.name;article.append(image);const label=document.createElement('label'),approved=document.createElement('input');label.className='character-check';approved.type='checkbox';approved.checked=row.approved;approved.disabled=running;approved.onchange=()=>{row.approved=approved.checked;persist();};label.append(approved,'Đã kiểm tra đúng người và vùng thay đổi');article.append(label);}
      }else{const result=document.createElement('button');result.textContent='Xem kết quả';result.onclick=()=>api.show({results:row.results});article.append(result);}
      const status=document.createElement('p');status.textContent=row.status||'Chưa duyệt';status.setAttribute('role','status');article.append(status);
      const remove=document.createElement('button');remove.textContent='Bỏ khỏi danh sách';remove.disabled=running;remove.onclick=()=>{queue=queue.filter(r=>r!==row);persist();renderQueue();};article.append(remove);host.append(article);
    }
    el('characterBatchRun').disabled=running||!queue.length;el('characterBatchStop').disabled=!running;
  }
  async function addBatch(){
    if(api.locked())return;const analysis=api.analysis();if(!analysis||!selected.length)return api.notice('Nhận diện, chọn người và thiết lập trên ảnh hiện tại trước.','error');
    const ids=[...el('characterBatchImages').selectedOptions].map(o=>o.value);if(!ids.length)return api.notice('Chọn ảnh cần thêm vào danh sách.','error');
    if(queue.length+ids.length>12)return api.notice('Mỗi danh sách tối đa 12 ảnh.','error');
    const template=clone(api.settings()),sourcePeople=clone(analysis.people);api.setBusy(true);
    try{for(const sampleId of ids){if(queue.some(r=>r.sampleId===sampleId))continue;const a=await api.post('/api/character-analyze',{sampleId}),image=api.images().find(i=>i.id===sampleId);queue.push({id:crypto.randomUUID(),sampleId,name:image?.name||sampleId,analysis:a,sourcePeople,template,mapping:template.personIds.map(()=>a.people.length===1&&template.personIds.length===1?String(a.people[0].id):''),approved:false,status:'Chưa duyệt'});persist();renderQueue();}}
    catch(e){api.notice(e.message,'error');}finally{api.setBusy(false);renderQueue();}
  }
  async function runBatch(){
    if(api.locked())return;const pending=queue.filter(r=>!r.results);if(!pending.length)return;
    if(pending.some(r=>!r.approved||!r.request))return api.notice('Duyệt từng ảnh còn lại trước khi chạy danh sách.','error');
    if(typeof WorkQueue!=='undefined'){running=true;api.setBusy(true);renderQueue();try{await WorkQueue.characterBatch(pending,()=>{persist();renderQueue();});api.notice('Danh sách đã được lưu trong Hoạt động. Có thể tiếp tục hoặc thử lại từng ảnh lỗi tại đó.','success');}catch(e){api.notice(e.message,'error');}finally{running=false;api.setBusy(false);renderQueue();}return;}
    let batchError='';running=true;stop=false;el('characterBatchStop').textContent='Dừng sau ảnh hiện tại';api.setBusy(true);renderQueue();
    try{for(const row of pending){
      if(stop)break;
      // On reconnect, recover a completed job rather than silently duplicate it.
      if(row.jobId){try{const state=await api.post('/api/job-status',{jobId:row.jobId});if(state.status==='completed'&&state.results?.length){row.results=state.results;row.status='Hoàn tất';persist();renderQueue();continue;}if(state.status==='running')throw Error('Ảnh này vẫn đang xử lý. Theo dõi trong Hoạt động.');}catch(e){if(e.message.includes('vẫn đang'))throw e;}}
      const jobId=globalThis.AtelierApp.createJobId('character');row.jobId=jobId;row.status='Đang xử lý';persist();renderQueue();globalThis.AtelierApp.setActiveJob(jobId);let success=false,error='';
      try{const result=await api.post('/api/character-render',{...row.request,jobId});row.results=result.results;row.status='Hoàn tất';success=true;}
      catch(e){error=e.message;batchError=error;row.status=error;row.approved=false;stop=true;}
      finally{await globalThis.AtelierApp.settleJob(jobId,success?'completed':'failed',error);persist();renderQueue();}
    }}catch(e){batchError=e.message;stop=true;}finally{running=false;api.setBusy(false);renderQueue();api.notice(batchError?'Đã dừng danh sách: '+batchError:stop?'Đã dừng danh sách. Ảnh hoàn tất vẫn được giữ.':'Đã xử lý các ảnh đã duyệt.',batchError?'error':'success');}
  }
  function setup(bridge){
    api=bridge;const details=document.createElement('details');details.id='characterAdvanced';details.innerHTML=`<summary>Tay &amp; thiết lập riêng từng người</summary>
      <p>Trái/phải là phía của nhân vật. Thiết lập chung ở trên vẫn áp dụng cho người chưa có thiết lập riêng.</p>
      <label>Bên tay của cử chỉ<select id="characterHandSide"><option value="right">Tay phải</option><option value="left">Tay trái</option><option value="both">Cả hai tay</option></select></label>
      <label>Nhân vật cần chỉnh riêng<select id="characterIndividual"></select></label><label class="character-check"><input id="characterIndividualEnabled" type="checkbox">Dùng thiết lập riêng cho người này</label>
      <fieldset id="characterIndividualFields" disabled><legend>Thiết lập riêng</legend>
      <label>Tư thế riêng<select id="characterIndividualPose"></select></label><label>Biểu cảm riêng<select id="characterIndividualExpression"></select></label>
      <label>Mức biểu cảm riêng<input id="characterIndividualIntensity" type="range" min="0" max="1" step="0.05"></label><label>Xoay đầu riêng<input id="characterIndividualYaw" type="range" min="-20" max="20"></label><label>Hướng nhìn riêng<input id="characterIndividualGazeX" type="range" min="-1" max="1" step="0.1"></label>
      <label>Bên tay của tư thế riêng<select id="characterIndividualHandSide"><option value="right">Tay phải</option><option value="left">Tay trái</option><option value="both">Cả hai tay</option></select></label>
      <label>Bàn tay cần chỉnh<select id="characterHand"><option value="right">Tay phải</option><option value="left">Tay trái</option></select></label>
      <label>Cử chỉ bàn tay<select id="characterGesture"><option value="auto">Theo hành động</option><option value="open">Xòe bàn tay</option><option value="fist">Nắm tay</option><option value="point">Chỉ ngón trỏ</option><option value="peace">Dấu V</option><option value="thumbs_up">Giơ ngón cái</option><option value="grip">Cầm / nắm đồ vật</option><option value="custom">Chỉnh từng ngón</option></select></label>
      <div id="characterFingerControls" hidden><p>0: duỗi thẳng · 1: co vào lòng bàn tay.</p>${['Cái','Trỏ','Giữa','Áp út','Út'].map((name,i)=>`<label>Ngón ${name.toLowerCase()}<input id="characterFinger${i}" type="range" min="0" max="1" step="0.1"></label>`).join('')}</div>
      <label>Độ xòe ngón<input id="characterSpread" type="range" min="0" max="1" step="0.1"></label><label>Xoay cổ tay<input id="characterWristRotation" type="range" min="-90" max="90" step="5"></label>
      <label class="character-check"><input id="characterContact" type="checkbox">Đặt vị trí cổ tay tại điểm tiếp xúc</label><div id="characterContactFields" hidden><label>Vị trí ngang (0–1)<input id="characterContactX" type="number" min="0.01" max="0.99" step="0.01"></label><label>Vị trí dọc (0–1)<input id="characterContactY" type="number" min="0.01" max="0.99" step="0.01"></label></div>
      <p>Khung ngón tay là hướng dẫn tạo ảnh. Cần kiểm tra ngón tay và điểm chạm trong kết quả.</p></fieldset></details>`;
    el('characterEditor').before(details);
    const workflow=document.createElement('details');workflow.id='characterWorkflow';workflow.innerHTML=`<summary>Sửa tiếp &amp; áp dụng nhiều ảnh</summary>
      <label>Sửa tiếp người đang chọn<textarea id="characterRefineDescription" rows="2" maxlength="1000" placeholder="Giữ tư thế, hạ tay phải một chút"></textarea></label><button id="characterRefine" type="button">Đọc yêu cầu sửa tiếp</button><p id="characterRefineSummary" role="status"></p>
      <details><summary>Áp dụng thiết lập cho nhiều ảnh</summary><p>Chọn người và duyệt vùng tác động riêng trên từng ảnh. Vùng tô bảo vệ/giới hạn của ảnh hiện tại không được sao chép; người không chọn vẫn được giữ nguyên.</p><label>Ảnh trong thư viện<select id="characterBatchImages" multiple size="5"></select></label><button id="characterBatchRefresh" type="button">Làm mới danh sách ảnh</button><button id="characterBatchAdd" type="button">Thêm ảnh với thiết lập hiện tại</button><div id="characterBatchRows"></div><button id="characterBatchRun" type="button">Chạy các ảnh đã duyệt</button><button id="characterBatchStop" type="button" disabled>Dừng sau ảnh hiện tại</button></details>`;
    el('characterStatus').before(workflow);const quality=document.createElement('label');quality.className='character-check';quality.innerHTML='<input id="characterQualityRecovery" type="checkbox" checked>Giữ màu, chi tiết vải và làm dịu đường ghép';el('characterKeepFace').closest('label').before(quality);
    el('characterQualityRecovery').onchange=()=>{qualityRecovery=el('characterQualityRecovery').checked;api.invalidate();};el('characterHandSide').onchange=()=>{handSide=el('characterHandSide').value;api.invalidate(true);};el('characterIndividual').onchange=loadIndividual;
    el('characterIndividualEnabled').onchange=()=>{if(api.locked())return;const id=individual();if(el('characterIndividualEnabled').checked){const s=api.settings();perPerson[id]={pose:['handshake','handover','look_each_other','group'].includes(s.pose)?'keep':s.pose,expression:s.expression,intensity:s.intensity,yaw:s.yaw,gazeX:s.gazeX,handSide,hands:{}};}else delete perPerson[id];loadIndividual();api.invalidate(true);};
    for(const suffix of ['Pose','Expression','Intensity','Yaw','GazeX','HandSide'])el('characterIndividual'+suffix).oninput=()=>saveIndividual(['Pose','HandSide'].includes(suffix));
    el('characterHand').onchange=loadHand;for(const suffix of ['Gesture','Spread','WristRotation','Contact','ContactX','ContactY',...Array.from({length:5},(_,i)=>'Finger'+i)])el('character'+suffix).oninput=saveHand;
    el('characterRefine').onclick=refine;el('characterBatchAdd').onclick=addBatch;el('characterBatchRun').onclick=runBatch;el('characterBatchStop').onclick=()=>{stop=true;if(typeof WorkQueue!=='undefined')WorkQueue.stop().catch(e=>api.notice(e.message,'error'));el('characterBatchStop').textContent='Sẽ dừng sau ảnh hiện tại';};
    el('characterBatchRefresh').onclick=async()=>{try{const r=await fetch('/api/images'),data=await r.json(),items=Array.isArray(data)?data:data.images||[];select('characterBatchImages',items.map(i=>[i.id,i.name||i.id]));}catch(e){api.notice(e.message,'error');}};el('characterBatchRefresh').click();
    try{queue=JSON.parse(localStorage.getItem(key)||'[]').slice(0,12).map(row=>({...row,approved:false,status:row.results?'Hoàn tất':'Kiểm tra lại ảnh trước khi chạy tiếp.'}));}catch{queue=[];}
    renderQueue();loadIndividual();
  }
  return {setup,settings,people:refreshPeople,reset,restore,running:()=>running,configuration:value=>{if(value.poses)catalogPoses=Object.entries(value.poses);if(api)loadIndividual();if(el('characterQualityRecovery')){el('characterQualityRecovery').title=value.qualityRecoveryReady?'Nhận diện trang phục cục bộ đã sẵn sàng.':'Giữ màu vải cần model nhận diện trang phục IDM-VTON; làm dịu đường ghép vẫn hoạt động.';}}};
})();
