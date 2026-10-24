'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {atomic,read}=require('./asset-catalog'),{locked}=require('./process-lock');
const TASKS={
  character:{name:'Tư thế & biểu cảm',checks:{identity:'Giữ đặc điểm nhân vật',pose:'Đúng tư thế / biểu cảm',hands:'Tay, ngón và điểm tiếp xúc hợp lý',clothing:'Trang phục còn đúng',preservation:'Vùng cần giữ không bị sửa'}},
  tryon:{name:'Thay trang phục',checks:{identity:'Giữ đặc điểm nhân vật',garment:'Đúng cổ, tay, gấu và số lớp',color:'Đúng màu / họa tiết',anatomy:'Hình thể và bàn tay hợp lý',residual:'Không còn trang phục cũ sai vị trí'}},
  inpaint:{name:'Xóa vật thể',checks:{removal:'Vật thể đã được xóa',background:'Nền nối tiếp tự nhiên',edge:'Không lộ vệt hoặc đường nối',preservation:'Vùng cần giữ không bị sửa'}},
  outpaint:{name:'Mở rộng ảnh',checks:{composition:'Bố cục mở rộng hợp lý',edge:'Không lộ đường nối',content:'Nội dung mới nhất quán',preservation:'Ảnh gốc được giữ theo lựa chọn'}},
  enhance:{name:'Cải thiện ảnh',checks:{detail:'Chi tiết rõ, không viền giả',skin:'Da và chất liệu tự nhiên',color:'Màu sắc đúng',preservation:'Không thay đổi nội dung'}},
  makeup:{name:'Trang điểm',checks:{identity:'Giữ đặc điểm khuôn mặt',placement:'Trang điểm đúng vị trí',skin:'Da còn chi tiết',style:'Đúng phong cách yêu cầu'}},
  'text-to-image':{name:'Ảnh mới',checks:{prompt:'Đúng mô tả',anatomy:'Hình thể / cấu trúc hợp lý',detail:'Chi tiết không lỗi rõ',composition:'Bố cục sử dụng được'}},
  manual:{name:'Chỉnh sửa thủ công / nền',checks:{edge:'Mép chủ thể sạch',color:'Màu và nền đúng thiết lập',layers:'Lớp và bố cục đúng',export:'Đúng kích thước / độ trong suốt'}}
};
function createAcceptanceStore(root){
  const file=path.join(root,'workspace/acceptance/suite.json'),cache=new Map();
  const load=async()=>read(file,{schemaVersion:1,release:(await read(path.join(root,'version.json'),{})).version||'2.5.0',revision:0,cases:[]});
  async function inspect(url){
    const match=/^\/(samples|uploads|outputs|manual-assets)\/(.+)$/.exec(url||'');
    if(!match||!(/\.(png|jpe?g|webp)$/i.test(url)))throw Error('Chọn ảnh trong thư viện của ứng dụng.');
    const base=path.join(root,match[1]==='samples'?'samples':match[1]==='manual-assets'?'workspace/manual/assets':'workspace/'+match[1]);
    const target=path.resolve(base,match[2]);if(!target.startsWith(path.resolve(base)+path.sep))throw Error('Đường dẫn ảnh không hợp lệ.');
    const real=await fs.realpath(target),realBase=await fs.realpath(base);if(!real.startsWith(realBase+path.sep))throw Error('Ảnh nằm ngoài thư viện.');
    const stat=await fs.stat(real);if(!stat.isFile()||stat.size>80*1024*1024)throw Error('Ảnh vượt giới hạn kiểm tra.');
    const key=real+':'+stat.size+':'+stat.mtimeMs+':'+stat.ctimeMs;
    if(cache.has(key))return cache.get(key);
    const bytes=await fs.readFile(real),value={url,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:stat.size};
    if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){value.width=bytes.readUInt32BE(16);value.height=bytes.readUInt32BE(20);}
    if(cache.size>1000)cache.clear();cache.set(key,value);return value;
  }
  async function fingerprint(c){return {source:c.sourceUrl?await inspect(c.sourceUrl):null,reference:c.referenceUrl?await inspect(c.referenceUrl):null,result:await inspect(c.resultUrl)};}
  async function evidence(url){
    if(!url.startsWith('/outputs/'))return {status:'unavailable',note:'Chưa có chỉ số kỹ thuật của lượt tạo ảnh.'};
    const target=path.resolve(root,'workspace',url.slice(1));let meta;
    for(const file of [path.join(path.dirname(target),'metadata.json'),target.replace(/\.[^.]+$/,'.json')]){try{const actual=await fs.realpath(file),base=await fs.realpath(path.join(root,'workspace/outputs'));if(!actual.startsWith(base+path.sep)||(await fs.stat(actual)).size>8*1024*1024)continue;meta=JSON.parse(await fs.readFile(file,'utf8'));break;}catch{}}
    if(!meta)return {status:'unavailable',note:'Chưa có chỉ số kỹ thuật của lượt tạo ảnh.'};
    // Try-on stores filenames relative to this metadata folder; other tasks
    // store workspace paths. Bind the gate to the chosen image, not another
    // seed that happened to be selected by the run's automatic ranking.
    const result=meta.results?.find(r=>{const file=String(r.file||r.image||'').replace(/\\/g,'/');return file===path.basename(target)||file.endsWith(url.slice(1));})||{};
    const gate=result.qualityGate||meta.selectedQualityGate||meta.qualityGate||null;
    return {status:gate?.passed===false?'failed':gate?.passed===true?'passed':'recorded',model:meta.modelId||meta.model||'',createdAt:meta.createdAt||'',metrics:{...(result.metrics||meta.metrics||{}),...(result.finalReview?{finalReview:result.finalReview}:{})},gate,note:'Chỉ số đã lưu của đúng lượt xử lý ảnh này; quyết định nghiệm thu cần đối chiếu trực quan.'};
  }
  const same=(a,b)=>a?.source?.sha256===b?.source?.sha256&&a?.result?.sha256===b?.result?.sha256&&a?.reference?.sha256===b?.reference?.sha256;
  async function state(){const data=await load(),cases=[];
    for(const c of data.cases.filter(c=>!c.archived)){let integrity='valid',error='';try{if(!same(c.files,await fingerprint(c)))integrity='changed';}catch(e){integrity='missing';error=e.message;}
      cases.push({...c,integrity,error,status:integrity!=='valid'?'stale':c.review?.decision||'pending'});
    }
    const tasks=Object.entries(TASKS).map(([id,t])=>{const rows=cases.filter(c=>c.task===id);return {id,...t,total:rows.length,approved:rows.filter(c=>c.status==='approved').length,needsWork:rows.filter(c=>c.status==='needs-work').length,pending:rows.filter(c=>['pending','stale'].includes(c.status)).length,standard:rows.filter(c=>c.difficulty==='standard').length,hard:rows.filter(c=>c.difficulty==='hard').length,ready:rows.some(c=>c.difficulty==='standard'&&c.status==='approved')&&rows.some(c=>c.difficulty==='hard'&&c.status==='approved')&&rows.every(c=>c.status==='approved'&&c.technical?.status!=='failed')};});
    return {...data,cases,archived:data.cases.filter(c=>c.archived),tasks,ready:tasks.every(t=>t.ready),summary:{total:cases.length,approved:cases.filter(c=>c.status==='approved').length,needsWork:cases.filter(c=>c.status==='needs-work').length,stale:cases.filter(c=>c.status==='stale').length,pending:cases.filter(c=>c.status==='pending').length},scope:'Bộ nghiệm thu nội bộ trên những ca đã chọn; không phải bảo đảm cho mọi ảnh.'};
  }
  async function action(body){return locked(file+'.lock',async()=>{const data=await load();let c;
    if(body.action==='add'){
      if(!TASKS[body.task]||!['standard','hard'].includes(body.difficulty))throw Error('Chọn tác vụ và độ khó.');
      if(data.cases.length>=300)throw Error('Bộ nghiệm thu tối đa 300 ca.');
      const name=String(body.name||'').trim().slice(0,160);if(!name)throw Error('Nhập tên ca nghiệm thu.');
      if(body.task!=='text-to-image'&&!body.sourceUrl)throw Error('Ca này cần ảnh nguồn để đối chiếu.');
      if(data.cases.some(c=>!c.archived&&c.task===body.task&&c.resultUrl===body.resultUrl))throw Error('Ảnh này đã có trong bộ nghiệm thu.');
      c={id:crypto.randomUUID(),revision:1,name,task:body.task,difficulty:body.difficulty,sourceUrl:body.sourceUrl||'',referenceUrl:body.referenceUrl||'',resultUrl:body.resultUrl,description:String(body.description||'').slice(0,2000),createdAt:new Date().toISOString()};
      c.files=await fingerprint(c);c.technical=await evidence(c.resultUrl);data.cases.push(c);
    }else{
      c=data.cases.find(c=>c.id===body.id);if(!c||(c.archived&&body.action!=='restore'))throw Error('Ca nghiệm thu không còn trong danh sách.');
      if(body.revision!==c.revision)throw Error('Ca này đã được cập nhật. Mở lại trước khi lưu.');
      const previous={revision:c.revision,files:c.files,review:c.review||null,at:new Date().toISOString(),action:body.action};
      if(body.action==='review'){
        if(!same(c.files,await fingerprint(c)))throw Error('Ảnh đã thay đổi. Cập nhật mốc ảnh rồi duyệt lại.');
        const checks=Object.fromEntries(Object.keys(TASKS[c.task].checks).map(k=>[k,body.checks?.[k]]));
        if(Object.values(checks).some(v=>!['pass','fail','na'].includes(v)))throw Error('Đánh giá đầy đủ các tiêu chí trước khi lưu.');
        const note=String(body.note||'').trim().slice(0,2000);if(Object.values(checks).includes('na')&&!note)throw Error('Ghi lý do cho tiêu chí không áp dụng.');
        if(Object.values(checks).every(v=>v==='na'))throw Error('Cần ít nhất một tiêu chí được đánh giá.');
        c.review={checks,note,reviewer:body.reviewer==='assistant'?'assistant':'operator',decision:Object.values(checks).includes('fail')?'needs-work':'approved',at:new Date().toISOString()};
      }else if(body.action==='refresh'){c.files=await fingerprint(c);c.technical=await evidence(c.resultUrl);delete c.review;}
      else if(body.action==='archive')c.archived=true;
      else if(body.action==='restore'){
        if(data.cases.some(other=>other.id!==c.id&&!other.archived&&other.task===c.task&&other.resultUrl===c.resultUrl))throw Error('Ảnh này đã có ca đang hoạt động. Lưu trữ ca đó trước khi khôi phục ca cũ.');
        c.archived=false;
      }
      else throw Error('Thao tác không hợp lệ.');
      (c.history||=[]).push(previous);
      c.revision++;
    }
    data.revision++;data.updatedAt=new Date().toISOString();await atomic(file,data);return c;
  });}
  return {state,action,inspect};
}
module.exports={createAcceptanceStore,TASKS};
