'use strict';
const fs=require('node:fs'),path=require('node:path');

function validatePart(raw,ids){
  const id=String(raw?.id||'').trim();
  if(!/^[a-z][a-z0-9_-]{1,63}$/.test(id))throw Error('ID bộ phận phải có 2–64 ký tự chữ thường, số, gạch ngang hoặc gạch dưới.');
  if(ids.has(id))throw Error(`ID bộ phận bị trùng: ${id}`);ids.add(id);
  const label=String(raw.label||'').trim();if(!label||label.length>80)throw Error(`Tên hiển thị của ${id} không hợp lệ.`);
  const kind=String(raw.kind||'limb');if(!['hand','foot','limb','region'].includes(kind))throw Error(`Loại hình học của ${id} không hợp lệ.`);
  const side=String(raw.side||'center');if(!['left','right','center'].includes(side))throw Error(`Phía cơ thể của ${id} không hợp lệ.`);
  const joint=value=>{const number=Number(value);if(!Number.isInteger(number)||number<0||number>16)throw Error(`Chỉ số khớp của ${id} phải từ 0 đến 16.`);return number;};
  const joints=Array.from(new Set((raw.joints||[]).map(joint)));if(!joints.length)throw Error(`${id} cần ít nhất một khớp.`);
  const segments=(raw.segments||[]).map(pair=>{if(!Array.isArray(pair)||pair.length!==2)throw Error(`Đoạn xương của ${id} phải có hai khớp.`);return pair.map(joint);});
  const bounded=(value,min,max,name)=>{const number=Number(value);if(!Number.isFinite(number)||number<min||number>max)throw Error(`${name} của ${id} phải từ ${min} đến ${max}.`);return number;};
  const mask=raw.mask||{},quality=raw.quality||{};
  return{id,label,kind,side,joints,segments,mask:{safe:bounded(mask.safe,.05,1.5,'Mask an toàn'),balanced:bounded(mask.balanced,.05,1.5,'Mask cân bằng'),strict:bounded(mask.strict,.05,1.5,'Mask nghiêm ngặt'),endpointScale:bounded(mask.endpointScale,.5,4,'Hệ số đầu mút'),minimumRadius:bounded(mask.minimumRadius,4,128,'Bán kính tối thiểu'),...(kind==='foot'?{ellipseRatio:bounded(mask.ellipseRatio||2,1,4,'Tỷ lệ ellipse')}: {})},quality:{safe:bounded(quality.safe,0,100,'Ngưỡng an toàn'),balanced:bounded(quality.balanced,0,100,'Ngưỡng cân bằng'),strict:bounded(quality.strict,0,100,'Ngưỡng nghiêm ngặt')}};
}
function create(root){
  const catalog=path.join(root,'workspace','prompts.json');
  if(fs.existsSync(catalog)){
    const store=require('./prompt-store');
    const read=()=>{const data=store.readCatalog(catalog).featurePresets;return {...data['anatomy.parts'],customized:JSON.stringify(data['anatomy.parts'])!==JSON.stringify(data['anatomy.parts.defaults'])};};
    const validate=value=>{if(!Array.isArray(value?.items)||!value.items.length)throw Error('Danh sách bộ phận không được để trống.');const ids=new Set();return {schemaVersion:1,items:value.items.map(item=>validatePart(item,ids))};};
    const write=value=>{const checked=validate(value);store.updateCatalog(data=>{data.featurePresets['anatomy.parts']=checked;},catalog);return read();};
    const reset=()=>{store.updateCatalog(data=>{data.featurePresets['anatomy.parts']=structuredClone(data.featurePresets['anatomy.parts.defaults']);},catalog);return read();};
    return {read,write,reset,validate};
  }
  throw Error('Thiếu workspace/prompts.json.');
}
module.exports={create,validatePart};
