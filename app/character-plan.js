const catalog=require('./catalog-values');
'use strict';
const poses=['keep','relaxed','hands_hips','crossed_arms','wave','point','thumbs_up','peace','touch_hair','hand_chest','walk','run','jump','sit','read','hold_cup','show_product','handshake','handover','look_each_other','group','custom'];
const expressions=['keep','smile','laugh','serious','surprised','sad','angry'];
const ranges={intensity:[0,1],yaw:[-20,20],pitch:[-15,15],roll:[-15,15],gazeX:[-1,1],gazeY:[-1,1]};
function validate(value){
  if(!value||!['face','body','interaction'].includes(value.mode)||!poses.includes(value.pose)||!expressions.includes(value.expression))throw Error('Thiết lập mô tả chưa hợp lệ. Hãy mô tả rõ hơn.');
  const result={mode:value.mode,pose:value.pose,expression:value.expression};
  for(const [key,[low,high]] of Object.entries(ranges)){const n=value[key];if(typeof n!=='number'||!Number.isFinite(n)||n<low||n>high)throw Error('Góc đầu hoặc mức biểu cảm nằm ngoài giới hạn.');result[key]=n;}
  if(typeof value.prompt!=='string'||value.prompt.length>240||value.prompt.trim().split(/\s+/).length>24||/[^\x20-\x7e]/.test(value.prompt))throw Error('Mô tả chi tiết quá dài. Viết ngắn hơn và thử lại.');
  result.prompt=value.prompt.trim();result.summary=String(value.summary||'Kiểm tra thiết lập được gợi ý.').slice(0,400);return result;
}
async function plan(body,request,model){
  if(typeof body.description!=='string'||!body.description.trim()||body.description.length>1000)throw Error('Nhập mô tả từ 1 đến 1000 ký tự.');
  const properties={mode:{type:'string',enum:['face','body','interaction']},pose:{type:'string',enum:poses},expression:{type:'string',enum:expressions},prompt:{type:'string',pattern:'^[ -~]*$',maxLength:240,description:catalog.value('components',"character-plan.translate_extra_object_action_details_into_english")},summary:{type:'string',description:catalog.value('components',"character-plan.vietnamese_summary_of_requested_visible_changes")}};
  for(const [key,[minimum,maximum]] of Object.entries(ranges))properties[key]={type:'number',minimum,maximum};
  const schema={type:'object',properties,required:Object.keys(properties),additionalProperties:false};
  const response=await request({model,stream:false,think:false,format:schema,keep_alive:0,options:{temperature:0,num_predict:600,num_ctx:4096},messages:[{role:'system',content:catalog.value('components',"character-plan.convert_the_user_description_into_controls_for")+JSON.stringify(schema)},{role:'user',content:body.description}]});
  let parsed;try{parsed=JSON.parse(response.message?.content||response.response||'');}catch{throw Error('Chưa đọc được mô tả. Thử lại với câu ngắn hơn.');}
  const result=validate(parsed),normalized=body.description.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
  // A negated clause must not trigger a positive keyword override. Keep its
  // interpretation from the structured planner instead.
  const text=normalized.split(/[,;.!\n]|\b(?:nhung|ma|va)\b/).filter(part=>!/(?:\bkhong\b|\bdung\b|\btranh\b)/.test(part)).join(',');
  // Explicit controls are deterministic; the language model supplies only the
  // remaining interpretation and the English object/action description.
  if(/\bnhin (?:sang |ve |qua )?(?:ben )?trai\b/.test(text))result.gazeX=-.6;
  if(/\bnhin (?:sang |ve |qua )?(?:ben )?phai\b/.test(text))result.gazeX=.6;
  if(/\bnhin len\b/.test(text))result.gazeY=-.5;
  if(/\bnhin xuong\b/.test(text))result.gazeY=.5;
  if(/\b(?:cuoi nhe|mim cuoi)\b/.test(text))result.expression='smile';
  if(/\bcuoi (?:lon|ro|tuoi)\b/.test(text))result.expression='laugh';
  if(/\bbat tay\b/.test(text)){result.mode='interaction';result.pose='handshake';}
  if(/\bnhin nhau\b/.test(text)){result.mode='interaction';result.pose='look_each_other';}
  if(/\b(?:giu nguyen|khong doi) bieu cam\b/.test(normalized))result.expression='keep';
  return {ok:true,...result,description:body.description.trim()};
}
module.exports={plan,validate};
