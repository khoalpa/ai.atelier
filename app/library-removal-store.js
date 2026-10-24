const fs=require('fs');
const path=require('path');
function readRemoved(file){
  if(!fs.existsSync(file))return [];
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!Array.isArray(data.ids))throw new Error('Dữ liệu thư viện đã xóa không hợp lệ.');
  return data.ids.filter(id=>typeof id==='string');
}
function updateRemoved(file,ids,restore=false){
  const removed=new Set(readRemoved(file));
  if(restore)removed.clear();else for(const id of ids)removed.add(id);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+'.tmp';
  fs.writeFileSync(temp,JSON.stringify({ids:[...removed]},null,2));
  fs.renameSync(temp,file);
  return [...removed];
}
module.exports={readRemoved,updateRemoved};
