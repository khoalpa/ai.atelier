'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile),Core=require('./public/manual-core');
const ID=/^[a-f0-9-]{36}$/,ASSET=/^\/manual-assets\/([a-f0-9]{64})\.png$/;
const fail=message=>{throw Error(message);};
function number(v,min,max){if(!Number.isFinite(v)||v<min||v>max)fail('Thông số chỉnh sửa vượt giới hạn.');return v;}
function point(p){return {x:number(p?.x,-100000,100000),y:number(p?.y,-100000,100000)};}
function points(values,max=2048){if(!Array.isArray(values)||!values.length||values.length>max)fail('Nét vẽ quá dài. Chia thành các nét ngắn hơn.');return values.map(point);}
function selection(value){if(!value)return null;if(!Array.isArray(value.shapes)||value.shapes.length>32)fail('Vùng chọn quá phức tạp.');if(value.maskUrl&&!ASSET.test(value.maskUrl))fail('Ảnh vùng chọn không hợp lệ.');return {feather:number(value.feather,0,100),...(value.maskUrl?{maskUrl:value.maskUrl}:{}),shapes:value.shapes.map(s=>{if(!['rect','ellipse','polygon'].includes(s.type)||!['replace','add','subtract'].includes(s.mode))fail('Vùng chọn không hợp lệ.');const p=points(s.points,1024);if(s.type==='polygon'?p.length<3:p.length!==2)fail('Vùng chọn thiếu điểm.');return {type:s.type,mode:s.mode,points:p};})};}
function adjustments(a){return Object.fromEntries(Object.keys(Core.defaults()).map(k=>[k,number(a?.[k],-100,100)]));}
function color(v){if(typeof v!=='string'||!/^#[0-9a-f]{6}$/i.test(v))fail('Màu không hợp lệ.');return v;}
function stroke(s,mask=false){
  if(!['paint','erase','restore','clone','heal','blur','sharpen','dodge','burn'].includes(s?.tool))fail('Công cụ không hợp lệ.');
  const out={tool:mask?'erase':s.tool,points:points(s.points),size:number(s.size,1,1000),softness:number(s.softness,0,1),opacity:number(s.opacity,0,1),color:color(s.color||'#000000'),selection:selection(s.selection)};
  if(['clone','heal'].includes(s.tool))out.anchor=point(s.anchor);return out;
}
async function atomic(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(value));await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}}
async function read(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
function createStore(root,options={}){
  const home=path.join(root,'workspace','manual'),assets=path.join(home,'assets'),projects=path.join(home,'projects');
  const python=options.python||path.join(root,'.venv-sam2','Scripts','python.exe'),script=options.script||path.join(root,'scripts','manual-image-io.py');
  let saveQueue=Promise.resolve();
  const serial=fn=>{const work=saveQueue.then(fn);saveQueue=work.catch(()=>{});return work;};
  async function asset(url){const match=ASSET.exec(url||'');if(!match)fail('Ảnh của phiên chỉnh sửa không hợp lệ.');const file=path.join(assets,match[1]+'.png'),bytes=await fs.readFile(file);if(bytes.length<24)fail('Ảnh không hợp lệ.');const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);Core.dimensions(width,height);return {file,width,height,url};}
  async function document(input){
    if(input?.version!==1)fail('Phiên chỉnh sửa không được hỗ trợ.');
    const original=await asset(input.source?.url);if(input.source.width!==original.width||input.source.height!==original.height)fail('Kích thước ảnh nguồn không khớp.');
    const g=input.geometry;Core.dimensions(g?.width,g?.height);if(!Array.isArray(g.matrix)||g.matrix.length!==6)fail('Khung ảnh không hợp lệ.');g.matrix.forEach(v=>number(v,-1e6,1e6));Core.inverse(g.matrix);
    if(g.clips!==undefined&&(!Array.isArray(g.clips)||g.clips.length>500))fail('Có quá nhiều lần cắt ảnh.');const clips=(g.clips||[]).map(p=>{if(!Array.isArray(p)||p.length!==4)fail('Khung cắt không hợp lệ.');return p.map(point);});
    if(!Array.isArray(input.strokes)||input.strokes.length>500||!Array.isArray(input.layers)||input.layers.length>24)fail('Phiên tối đa 500 nét vẽ và 24 lớp.');
    const layers=[];
    for(const l of input.layers){
      if(typeof l.id!=='string'||l.id.length>64||!['image','text','adjustment'].includes(l.type)||layers.some(x=>x.id===l.id))fail('Lớp không hợp lệ.');
      const layer={id:l.id,type:l.type,name:String(l.name||'Lớp').slice(0,100),x:number(l.x,-100000,100000),y:number(l.y,-100000,100000),width:number(l.width,1,16384),height:number(l.height,1,16384),rotation:number(l.rotation,-360,360),opacity:number(l.opacity,0,1),visible:l.visible!==false};
      Core.dimensions(Math.round(layer.width),Math.round(layer.height));
      layer.locked=!!l.locked;
      if(l.type==='image'){await asset(l.url);layer.url=l.url;}else if(l.type==='adjustment'){layer.adjustments=adjustments(l.adjustments);layer.selection=selection(l.selection);}else{layer.text=String(l.text||'').slice(0,2000);layer.color=color(l.color);layer.fontSize=number(l.fontSize,6,1000);layer.bold=!!l.bold;}
      if(!Array.isArray(l.mask)||l.mask.length>128)fail('Vùng che của lớp quá phức tạp.');layer.mask=l.mask.map(s=>stroke(s,true));layers.push(layer);
    }
    const result={version:1,source:{url:original.url,width:original.width,height:original.height,name:String(input.source.name||'Ảnh').slice(0,160),sourceId:String(input.source.sourceId||'').slice(0,2048)},geometry:{width:g.width,height:g.height,matrix:[...g.matrix],clips},adjustments:adjustments(input.adjustments),strokes:input.strokes.map(s=>stroke(s)),layers};
    result.selection=selection(input.selection);
    const selections=[result.selection,...result.strokes.map(s=>s.selection),...layers.map(l=>l.selection)].filter(Boolean);
    for(const s of selections)if(s.maskUrl){const mask=await asset(s.maskUrl);if(mask.width!==original.width||mask.height!==original.height)fail('Vùng chọn không cùng kích thước ảnh nguồn.');}
    if(input.background){const b=input.background;if(!['transparent','color','image'].includes(b.mode))fail('Loại nền không hợp lệ.');const mask=await asset(b.maskUrl);if(mask.width!==original.width||mask.height!==original.height)fail('Mặt nạ chủ thể không khớp ảnh.');if(!Array.isArray(b.strokes)||b.strokes.length>128)fail('Tối đa 128 nét sửa mép chủ thể.');result.background={maskUrl:b.maskUrl,mode:b.mode,color:color(b.color||'#ffffff'),feather:number(b.feather??0,0,30),threshold:number(b.threshold??0,-100,100),decontaminate:number(b.decontaminate??0,0,100),strokes:b.strokes.map(s=>stroke(s)),shadow:{opacity:number(b.shadow?.opacity??0,0,1),blur:number(b.shadow?.blur??12,0,100),x:number(b.shadow?.x??8,-200,200),y:number(b.shadow?.y??8,-200,200)}};if(b.mode==='image'){await asset(b.url);result.background.url=b.url;}}
    if(JSON.stringify(result).length>8*1024*1024)fail('Phiên chỉnh sửa quá lớn. Lưu ảnh rồi mở một phiên mới.');return result;
  }
  async function imageBytes(body){
    if(body.data){const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.data);if(!match)fail('Chỉ hỗ trợ PNG, JPEG hoặc WebP.');const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>80*1024*1024)fail('Ảnh tối đa 80 MB.');return {bytes,format:match[1]};}
    const url=String(body.url||'');const pairs=[['/samples/',path.join(root,'samples')],['/uploads/',path.join(root,'workspace','uploads')],['/outputs/',path.join(root,'workspace','outputs')]];
    for(const [prefix,base] of pairs)if(url.startsWith(prefix)){
      const file=path.resolve(base,decodeURIComponent(url.slice(prefix.length)));if(!file.startsWith(base+path.sep)||! /\.(png|jpe?g|webp)$/i.test(file))fail('Đường dẫn ảnh không hợp lệ.');
      const real=await fs.realpath(file),realBase=await fs.realpath(base);if(!real.startsWith(realBase+path.sep))fail('Ảnh phải nằm trong thư viện.');const stat=await fs.stat(file);if(stat.size>80*1024*1024)fail('Ảnh tối đa 80 MB.');return {bytes:await fs.readFile(file),format:path.extname(file).slice(1)};
    }fail('Chọn ảnh trong thư viện hoặc tải ảnh lên.');
  }
  async function convert(bytes,target){
    const staging=path.join(home,'temp');await fs.mkdir(staging,{recursive:true});const input=path.join(staging,crypto.randomUUID()+'.image');await fs.writeFile(input,bytes);
    try{const result=await execute(python,[script,input,target],{windowsHide:true,timeout:45000,maxBuffer:1024*1024});return JSON.parse(result.stdout.trim());}
    catch(e){throw Error(String(e.stderr||e.message).trim().slice(0,400));}finally{await fs.unlink(input).catch(()=>{});}
  }
  async function importAsset(body){
    const {bytes}=await imageBytes(body);await fs.mkdir(assets,{recursive:true});const temp=path.join(assets,crypto.randomUUID()+'.png');
    try{const size=await convert(bytes,temp),normalized=await fs.readFile(temp),hash=crypto.createHash('sha256').update(normalized).digest('hex');await fs.writeFile(path.join(assets,hash+'.png'),normalized,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});return {url:`/manual-assets/${hash}.png`,...size,name:String(body.name||'Ảnh').slice(0,160),sourceId:String(body.sourceId||'').slice(0,2048)};}finally{await fs.unlink(temp).catch(()=>{});}
  }
  async function load(id,revision){if(!ID.test(id||''))fail('Phiên không hợp lệ.');if(revision!==undefined&&(!Number.isInteger(revision)||revision<1))fail('Phiên bản không hợp lệ.');const file=revision?path.join(home,'versions',id,`${revision}.json`):path.join(projects,id+'.json');const value=await read(file,null);if(!value)fail('Không tìm thấy phiên chỉnh sửa.');return value;}
  async function save(body){return serial(async()=>{
    const id=body.id||body.creationKey||crypto.randomUUID();if(!ID.test(id))fail('Phiên không hợp lệ.');const previous=await read(path.join(projects,id+'.json'),null);if(previous&&body.creationKey&&!body.id){if(JSON.stringify(await document(body.document))!==JSON.stringify(previous.document))fail('Mã công việc đã được dùng cho một phiên khác.');return previous;}if(previous&&body.revision!==previous.revision)fail('Phiên đã được lưu ở cửa sổ khác. Mở lại phiên trước khi sửa tiếp.');if(!previous&&body.id)fail('Không tìm thấy phiên chỉnh sửa.');
    const value={id,revision:(previous?.revision||0)+1,name:String(body.name||'Ảnh chỉnh thủ công').trim().slice(0,120)||'Ảnh chỉnh thủ công',updatedAt:new Date().toISOString(),document:await document(body.document)};
    if(previous?.archived)value.archived=true;
    if(body.thumbnail){const thumb=await asset(body.thumbnail);if(thumb.width>512||thumb.height>512)fail('Ảnh xem trước quá lớn.');value.thumbnail=body.thumbnail;}else if(previous?.thumbnail)value.thumbnail=previous.thumbnail;
    await atomic(path.join(home,'versions',id,`${value.revision}.json`),value);await atomic(path.join(projects,id+'.json'),value);return value;
  });}
  async function list(options={}){await fs.mkdir(projects,{recursive:true});const files=(await fs.readdir(projects)).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f));const all=[];for(let i=0;i<files.length;i+=20)all.push(...await Promise.all(files.slice(i,i+20).map(f=>read(path.join(projects,f),null))));return all.filter(p=>p&&(options.archived?p.archived:!p.archived)&&(!options.sourceId||p.document.source.sourceId===options.sourceId)).map(({id,revision,name,updatedAt,thumbnail,document:d})=>({id,revision,name,updatedAt,thumbnail:thumbnail||d.source.url,sourceId:d.source.sourceId})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
  async function archive(id,archived=true){return serial(async()=>{const p=await load(id);p.archived=archived;await atomic(path.join(projects,id+'.json'),p);return p;});}
  async function resolveOutput(url){const match=/^\/outputs\/manual\/([a-f0-9-]{36})\/result\.(png|jpg|webp)$/.exec(url||'');if(!match)return null;const meta=await read(path.join(root,'workspace','outputs','manual',match[1],'metadata.json'),null);if(!meta?.projectId)return null;return {projectId:meta.projectId,revision:meta.revision};}
  async function versions(id){await load(id);const names=(await fs.readdir(path.join(home,'versions',id))).filter(f=>/^\d+\.json$/.test(f));const result=[];for(const name of names){const p=await read(path.join(home,'versions',id,name));result.push({revision:p.revision,name:p.name,updatedAt:p.updatedAt,thumbnail:p.thumbnail||p.document.source.url});}return result.sort((a,b)=>b.revision-a.revision);}
  async function exportImage(body){
    const project=await load(body.id,body.revision),{bytes,format}=await imageBytes({data:body.data});if(!['png','jpeg','webp'].includes(format))fail('Định dạng xuất không hợp lệ.');const Spec=require('./public/export-core'),spec=body.spec?Spec.validate(body.spec):null,expected=spec?Spec.dimensions(project.document.geometry.width,project.document.geometry.height,spec):project.document.geometry;if(spec&&spec.format!=='image/'+format)fail('Định dạng không khớp mẫu xuất.');const size=await convert(bytes,'--verify');if(size.width!==expected.width||size.height!==expected.height)fail('Kích thước ảnh xuất không khớp phiên đã lưu.');
    const id=body.exportId||crypto.randomUUID();if(!ID.test(id))fail('Mã ảnh xuất không hợp lệ.');const dir=path.join(root,'workspace','outputs','manual',id),staging=dir+'.'+crypto.randomUUID()+'.tmp',ext=format==='jpeg'?'jpg':format,sha256=crypto.createHash('sha256').update(bytes).digest('hex');
    const previous=await read(path.join(dir,'metadata.json'),null);if(previous){if(previous.projectId!==project.id||previous.revision!==project.revision||previous.sha256!==sha256)fail('Mã xuất đã được dùng cho ảnh khác.');return {url:`/outputs/manual/${id}/result.${ext}`,projectId:project.id,revision:project.revision,...size};}
    await fs.mkdir(staging,{recursive:true});
    try{await fs.writeFile(path.join(staging,'result.'+ext),bytes);await atomic(path.join(staging,'metadata.json'),{task:'manual',projectId:project.id,revision:project.revision,createdAt:new Date().toISOString(),width:size.width,height:size.height,sourceId:project.document.source.sourceId,sha256,displayName:spec?Spec.filename(body.name||project.name,spec,size,body.index||1):project.name+'.'+ext,spec});await fs.rename(staging,dir);}catch(error){for(const name of ['result.'+ext,'metadata.json'])await fs.unlink(path.join(staging,name)).catch(()=>{});await fs.rmdir(staging).catch(()=>{});throw error;}
    return {url:`/outputs/manual/${id}/result.${ext}`,projectId:project.id,revision:project.revision,...size};
  }
  async function presets(body){const file=path.join(home,'presets.json');if(!body)return read(file,[]);return serial(async()=>{const items=await read(file,[]);if(body.action==='remove'){await atomic(file,items.filter(x=>x.id!==body.id));return {removed:true};}const index=items.findIndex(x=>x.id===body.id);if(index<0&&items.length>=100)fail('Tối đa 100 bộ màu.');const preset={id:index>=0?body.id:crypto.randomUUID(),name:String(body.name||'Bộ màu').trim().slice(0,100),adjustments:adjustments(body.adjustments)};if(index>=0)items[index]=preset;else items.push(preset);await atomic(file,items);return preset;});}
  return {assets,importAsset,document,save,load,list,archive,resolveOutput,versions,exportImage,presets};
}
module.exports={createStore};
