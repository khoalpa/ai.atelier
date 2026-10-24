'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function read(file){if(!fs.existsSync(file))return {ok:true,version:1,items:[]};const data=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(data.items))throw Error('Thư viện tư thế không hợp lệ.');return {ok:true,version:1,items:data.items};}
function save(file,body){
  if(typeof body.name!=='string'||!body.name.trim()||body.name.length>80)throw Error('Tên mẫu từ 1 đến 80 ký tự.');
  const joints=body.joints;if(!Array.isArray(joints)||joints.length!==17||joints.some(p=>!Array.isArray(p)||p.length!==3||p.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1)))throw Error('Khung xương cần 17 khớp hợp lệ.');
  const data=read(file);if(data.items.length>=100)throw Error('Thư viện đã có 100 mẫu.');
  const item={id:crypto.randomUUID(),name:body.name.trim(),joints,createdAt:new Date().toISOString()};data.items.push(item);
  fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(data,null,2),'utf8');fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  return {...data,item};
}
module.exports={read,save};
