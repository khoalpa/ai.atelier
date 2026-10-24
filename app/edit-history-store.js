const fs=require('fs'),path=require('path'),crypto=require('crypto');
function read(file){if(!fs.existsSync(file))return [];const data=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(data))throw new Error('Lịch sử chỉnh sửa không hợp lệ');return data;}
function append(file,input){
  for(const key of ['sourceId','childId','result'])if(typeof input[key]!=='string'||!input[key]||input[key].length>2048)throw new Error('Thiếu hoặc sai thông tin lịch sử');
  if(!['inpaint','tryon','outpaint','enhance','makeup','character','manual'].includes(input.task)||!/^\/outputs\/[a-zA-Z0-9_./%-]+$/.test(input.result)||input.result.includes('..'))throw new Error('Kết quả lịch sử phải là ảnh đã lưu trong ứng dụng');
  const items=read(file),item={id:crypto.randomUUID(),sourceId:input.sourceId,childId:input.childId,result:input.result,task:input.task,createdAt:new Date().toISOString()};
  items.push(item);fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temp,JSON.stringify(items,null,2));fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}return item;
}
module.exports={read,append};
