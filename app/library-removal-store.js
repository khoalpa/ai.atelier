const fs=require('fs');
const path=require('path');
const metadata=require('../packages/storage/metadata');
function readRemoved(file){
  const data=metadata.read(file,{ids:[]});
  if(!Array.isArray(data.ids))throw new Error('Dữ liệu thư viện đã xóa không hợp lệ.');
  return data.ids.filter(id=>typeof id==='string');
}
function updateRemoved(file,ids,restore=false){
  return metadata.update(file,data=>{if(!Array.isArray(data.ids))throw Error('Dữ liệu thư viện đã xóa không hợp lệ.');const removed=new Set(data.ids);if(restore)removed.clear();else for(const id of ids)removed.add(id);return {ids:[...removed]};},{ids:[]}).ids;
}
module.exports={readRemoved,updateRemoved};
