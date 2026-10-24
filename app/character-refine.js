'use strict';
const ranges={intensity:[0,1],yaw:[-20,20],pitch:[-15,15],roll:[-15,15],gazeX:[-1,1],gazeY:[-1,1]};
const expressions=['keep','smile','laugh','serious','surprised','sad','angry'];
function validate(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['changes','moves','summary'].includes(k)))throw Error('Chưa đọc được thay đổi.');
  const changes=value.changes||{},moves=value.moves||[];
  if(typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).some(k=>!['expression',...Object.keys(ranges)].includes(k)))throw Error('Chỉ sửa biểu cảm, góc đầu và khớp được yêu cầu.');
  if(changes.expression!==undefined&&!expressions.includes(changes.expression))throw Error('Biểu cảm không hợp lệ.');
  for(const [key,[min,max]] of Object.entries(ranges))if(changes[key]!==undefined&&(typeof changes[key]!=='number'||!Number.isFinite(changes[key])||changes[key]<min||changes[key]>max))throw Error('Thay đổi vượt giới hạn.');
  if(!Array.isArray(moves)||moves.length>4)throw Error('Quá nhiều khớp cần chỉnh.');
  for(const move of moves)if(!move||Object.keys(move).some(k=>!['joint','dx','dy'].includes(k))||![7,8,9,10,13,14,15,16].includes(move.joint)||!['dx','dy'].every(k=>typeof move[k]==='number'&&Number.isFinite(move[k])&&Math.abs(move[k])<=.08))throw Error('Dịch khớp không hợp lệ.');
  if(!Object.keys(changes).length&&!moves.some(move=>move.dx!==0||move.dy!==0))throw Error('Mô tả rõ hơn, ví dụ: hạ tay phải một chút hoặc cười nhẹ hơn.');
  return {changes,moves:moves.filter(move=>move.dx!==0||move.dy!==0),summary:String(value.summary||'Kiểm tra khớp và biểu cảm vừa điều chỉnh.').slice(0,400)};
}
async function refine(body,request,model){
  if(typeof body.description!=='string'||!body.description.trim()||body.description.length>1000)throw Error('Nhập mô tả từ 1 đến 1000 ký tự.');
  const current={};for(const key of ['expression',...Object.keys(ranges)])if(body.current?.[key]!==undefined)current[key]=body.current[key];
  validate({changes:{expression:current.expression||'keep',...Object.fromEntries(Object.entries(current).filter(([k])=>k in ranges))},moves:[]});
  const text=body.description.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
  // Common relative edits have precise, reproducible semantics. Never reset
  // the pose or unspecified facial controls when interpreting an increment.
  if(!/\b(khong|dung|tranh)\b/.test(text)&&/\b(ha|nang) tay (trai|phai)\b/.test(text)){
    const side=/tay trai/.test(text)?'left':'right',dy=/\bha tay/.test(text)?.025:-.025,wrist=side==='left'?9:10;
    return {ok:true,...validate({changes:{},moves:[{joint:wrist,dx:0,dy},{joint:wrist-2,dx:0,dy:dy*.5}],summary:`${dy>0?'Hạ':'Nâng'} tay ${side==='left'?'trái':'phải'} một chút; giữ các thiết lập còn lại.`})};
  }
  const properties={expression:{type:'string',enum:expressions}};for(const [k,[minimum,maximum]] of Object.entries(ranges))properties[k]={type:'number',minimum,maximum};
  const schema={type:'object',additionalProperties:false,required:['changes','moves','summary'],properties:{changes:{type:'object',properties,additionalProperties:false},moves:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,required:['joint','dx','dy'],properties:{joint:{type:'integer',enum:[7,8,9,10,13,14,15,16]},dx:{type:'number',minimum:-.08,maximum:.08},dy:{type:'number',minimum:-.08,maximum:.08}}}},summary:{type:'string'}}};
  const response=await request({model,stream:false,think:false,format:schema,keep_alive:0,options:{temperature:0,num_predict:500,num_ctx:4096},messages:[{role:'system',content:'Interpret an incremental edit to a photograph. Return ONLY requested changes. Preserve all unspecified controls by omitting them. Existing expression keep means unchanged, not neutral. Joint IDs are anatomical: 7 left elbow, 8 right elbow, 9 left wrist, 10 right wrist, 13/14 knees, 15/16 ankles. dx/dy are normalized image offsets; positive dy lowers. A little = .025. Never move joints when asked to keep pose. Summary in Vietnamese. Current controls: '+JSON.stringify(current)},{role:'user',content:body.description}]});
  let value;try{value=JSON.parse(response.message?.content||response.response||'');}catch{throw Error('Chưa đọc được mô tả. Thử câu ngắn hơn.');}
  const parsed=validate(value);
  parsed.changes=Object.fromEntries(Object.entries(parsed.changes).filter(([key,v])=>v!==current[key]));
  return {ok:true,...validate(parsed)};
}
module.exports={refine,validate};
