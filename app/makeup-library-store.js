const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {validatePlan}=require('./makeup-plan');
const styles=require('./makeup-styles.json');

// Only reusable cosmetic settings cross this boundary. No source, reference,
// face index, coordinates or masks are saved with a personal style.
function settings(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(styles,input.style))throw Error('Phong cách không hợp lệ.');
  const plan=validatePlan(input,styles[input.style]);
  const description=input.description??'';
  if(typeof description!=='string'||description.length>1000)throw Error('Mô tả tối đa 1000 ký tự.');
  if(description.trim()&&input.plannedDescription!==description.trim())throw Error('Đọc mô tả trước khi lưu phong cách.');
  if(input.style==='custom'&&!description.trim())throw Error('Phong cách tùy chỉnh cần mô tả.');
  if(typeof input.preserveFeatures!=='boolean'||typeof input.skinSmooth!=='number'||!Number.isFinite(input.skinSmooth)||input.skinSmooth<0||input.skinSmooth>50)throw Error('Thiết lập giữ da và làm mịn không hợp lệ.');
  if(!plan.parts.some(p=>plan.strengths[p]>0))throw Error('Tăng độ đậm cho ít nhất một vùng đã chọn.');
  const out={style:input.style,description:description.trim(),plannedDescription:description.trim(),preserveFeatures:input.preserveFeatures,skinSmooth:input.skinSmooth};
  for(const key of ['prompt','parts','lip','eyeshadow','blush','brow','intensity','eyeliner','finish','renderer','strengths'])out[key]=plan[key];
  return out;
}
function read(file){
  if(!fs.existsSync(file))return [];
  const items=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  if(!Array.isArray(items)||items.length>100)throw Error('Thư viện phong cách không hợp lệ.');
  return items.map(item=>{
    if(!item||typeof item.id!=='string'||typeof item.name!=='string')throw Error('Phong cách đã lưu không hợp lệ.');
    return {...item,settings:settings(item.settings)};
  });
}
function save(file,body){
  if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>80||/[\x00-\x1f\x7f]/.test(body.name))throw Error('Tên phong cách cần từ 1 đến 80 ký tự.');
  const value=settings(body.settings),items=read(file),existing=body.id===undefined?-1:items.findIndex(i=>i.id===body.id);
  if(body.id!==undefined&&(typeof body.id!=='string'||existing<0))throw Error('Phong cách cần cập nhật không còn tồn tại.');
  if(existing<0&&items.length>=100)throw Error('Thư viện đã có 100 phong cách. Hãy cập nhật một phong cách hiện có.');
  const now=new Date().toISOString();
  const item={id:existing<0?crypto.randomUUID():items[existing].id,name:body.name.trim(),settings:value,createdAt:existing<0?now:items[existing].createdAt,updatedAt:now};
  if(existing<0)items.push(item);else items[existing]=item;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(temp,JSON.stringify(items,null,2),'utf8');fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  return item;
}
module.exports={settings,read,save};
