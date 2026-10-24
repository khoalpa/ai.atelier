const fs=require('fs'),path=require('path'),crypto=require('crypto');
const metadata=require('../packages/storage/metadata');
function read(file){const data=metadata.read(file,[]);if(!Array.isArray(data))throw new Error('Lịch sử chỉnh sửa không hợp lệ');return data;}
function append(file,input){
  for(const key of ['sourceId','childId','result'])if(typeof input[key]!=='string'||!input[key]||input[key].length>2048)throw new Error('Thiếu hoặc sai thông tin lịch sử');
  if(!['inpaint','tryon','outpaint','enhance','makeup','character','manual'].includes(input.task)||!/^\/outputs\/[a-zA-Z0-9_./%-]+$/.test(input.result)||input.result.includes('..'))throw new Error('Kết quả lịch sử phải là ảnh đã lưu trong ứng dụng');
  const item={id:crypto.randomUUID(),sourceId:input.sourceId,childId:input.childId,result:input.result,task:input.task,createdAt:new Date().toISOString()};
  metadata.update(file,items=>[...items,item],[]);return item;
}
module.exports={read,append};
