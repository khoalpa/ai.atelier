'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {atomic,read}=require('./asset-catalog');
function createRegionStore(root){
 const assets=path.join(root,'workspace/manual/assets'),home=path.join(root,'workspace/regions');let tail=Promise.resolve();
 async function image(url){const m=/^\/manual-assets\/([a-f0-9]{64})\.png$/.exec(url||'');if(!m)throw Error('Ảnh vùng chọn không hợp lệ.');const bytes=await fs.readFile(path.join(assets,m[1]+'.png'));if(bytes.length<24)throw Error('Không đọc được ảnh.');return {key:m[1],width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};}
 async function list(source){const info=await image(source);return read(path.join(home,info.key+'.json'),[]);}
 async function save(body){const task=tail.then(async()=>{const source=await image(body.source),file=path.join(home,source.key+'.json'),items=await read(file,[]);if(body.action==='remove'){await atomic(file,items.filter(i=>i.id!==body.id));return {removed:true};}const mask=await image(body.maskUrl);if(mask.width!==source.width||mask.height!==source.height)throw Error('Ảnh đã đổi kích thước. Chọn lại vùng trước khi lưu.');const name=String(body.name||'').trim().slice(0,80);if(!name)throw Error('Nhập tên vùng chọn.');if(items.length>=100)throw Error('Mỗi ảnh tối đa 100 vùng đã lưu.');const item={id:crypto.randomUUID(),name,maskUrl:body.maskUrl,source:body.source,width:source.width,height:source.height,createdAt:new Date().toISOString()};items.push(item);await atomic(file,items);return item;});tail=task.catch(()=>{});return task;}
 return {list,save};
}
module.exports={createRegionStore};
