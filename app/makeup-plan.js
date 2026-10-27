const catalog=require('./catalog-values');
/* Local language planning is explicit; unsupported descriptions never vanish silently. */
const presets=catalog.live('featurePresets','makeup.styles');
const parts=['lips','eyes','brows','cheeks','base'];
const fold=text=>text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
function explicitOverrides(plan,description,base={}){
  plan.strengths={...Object.fromEntries(parts.map(p=>[p,100])),...plan.strengths};
  // Explicit local constraints take precedence over suggestions from a small LLM.
  const text=fold(description),clauses=text.split(/[,;.\n]+/),names={lips:/\b(son|moi|lipstick|lips)\b/,eyes:/\b(mat|eyeshadow|eyes|eyeliner)\b/,brows:/\b(chan may|long may|brows|eyebrows)\b/,cheeks:/\b(ma|blush|cheeks)\b/,base:/\b(nen|foundation|base)\b/};
  const colors=[['hong dat','#a66b70'],['do ruou','#812d46'],['hong cam','#cf776f'],['cam dao','#d9947b'],['xanh lam','#5279ae'],['xanh duong','#5279ae'],['xanh la','#54856d'],['do dam','#932f52'],['hong','#ce8d87'],['do','#b52e3f'],['cam','#d08759'],['dao','#d9947b'],['tim','#8366b8'],['nau','#88736b'],['den','#382c30']];
  if(/\btong dao\b/.test(text))for(const key of ['lip','eyeshadow','blush'])plan[key]=presets.peach[key];
  const forbidden=new Set(),excludeNames={lips:'son|moi|lipstick|lips',eyes:catalog.value('components',"makeup-plan.mat_mi_mat_phan_mat_eyes_eyeshadow"),brows:catalog.value('components',"makeup-plan.chan_may_long_may_brows_eyebrows"),cheeks:catalog.value('components',"makeup-plan.ma_ma_hong_blush_cheeks"),base:catalog.value('components',"makeup-plan.nen_nen_da_foundation_base")};
  for(const clause of clauses){
    const only=/\bchi (?:can |muon )?(?:to|danh|phu|trang diem)\b|\bonly\b/.test(clause);
    const positive=clause.split(/\b(khong|no|without)\b/)[0];
    const mentioned=parts.filter(p=>names[p].test(positive));
    if(/\b(giam|nhe hon|less|reduce)\b/.test(clause))for(const p of mentioned)plan.strengths[p]=Math.round((base.strengths?.[p]??100)*.65);
    for(const [part,key] of [['lips','lip'],['eyes','eyeshadow'],['cheeks','blush'],['brows','brow']])if(names[part].test(clause)&&/\b(giu mau|giu nguyen mau|keep (?:the )?color)\b/.test(clause)&&base[key])plan[key]=base[key];
    if(only&&mentioned.length)plan.parts=mentioned;
    for(const p of parts){
      const excluded=new RegExp(catalog.value('components',"makeup-plan.b_khong_khong_can_bo_qua_giu")+excludeNames[p]+')\\b').test(clause);
      if(excluded)forbidden.add(p);
    }
    if(/\b(khong|no|without)\b/.test(clause))continue;
    const colorParts=['lips','eyes','cheeks','brows'].filter(p=>names[p].test(clause));
    for(const [part,key] of [['lips','lip'],['eyes','eyeshadow'],['cheeks','blush'],['brows','brow']])if(colorParts.length===1&&colorParts[0]===part){
      // "Má hồng" names a cosmetic; by itself it is not a request to turn it pink.
      const colorText=part==='cheeks'?clause.replace(/\bma hong\b/g,'ma'):clause;
      const color=colors.find(([name])=>new RegExp('\\b'+name+'\\b').test(colorText));
      if(color)plan[key]=color[1];else if(/\b(giam|nhe hon|less|reduce)\b/.test(clause)&&base[key])plan[key]=base[key];
    }
  }
  plan.parts=plan.parts.filter(p=>!forbidden.has(p));
  if(!plan.parts.length)throw Error('Mô tả không còn vùng trang điểm. Hãy chỉ rõ vùng muốn sửa.');
  if(/\b(ke mat manh|thin eyeliner)\b/.test(text))plan.eyeliner='thin';
  if(/\b(khong ke mat|no eyeliner)\b/.test(text))plan.eyeliner='none';
  const localReduction=c=>/\b(giam|nhe hon|less|reduce)\b/.test(c)&&parts.some(p=>names[p].test(c));
  const overall=clauses.filter(c=>!localReduction(c)).join(', ');
  if(/\b(nhe|tu nhien|subtle|natural)\b/.test(overall))plan.intensity='light';
  else if(clauses.some(localReduction)&&base.intensity)plan.intensity=base.intensity;
  if(/\b(dam|bold)\b/.test(text))plan.intensity='bold';
  if(/\b(son li|matte)\b/.test(text))plan.finish='matte';
  if(/\bson\b[^,;.]{0,35}\bbong\b|\bgloss\b/.test(text))plan.finish='gloss';
  const positiveEffects=clauses.filter(c=>! /\b(khong|no|without)\b/.test(c)).join(', ');
  const positivePrompt=plan.prompt.split(',').filter(c=>! /\b(no|without)\b/i.test(c)).join(', ');
  if(/\b(nhu|anh kim|kim tuyen|hoa tiet)\b/.test(positiveEffects)||/\b(glitter|shimmer|iridescent|metallic|patterns?|drawings?)\b/i.test(positivePrompt)){
    plan.renderer='ai';
    if(!/\b(nhe|tu nhien|tinh te|subtle|natural|light|dam|bold)\b/.test(text))plan.intensity='medium';
    if(/\bnhu bac\b/.test(positiveEffects)&&!/silver (?:glitter|shimmer)/i.test(plan.prompt))plan.prompt+=catalog.value('components',"makeup-plan.silver_glitter");
    if(/\bnhu vang\b/.test(positiveEffects)&&!/gold(?:en)? (?:glitter|shimmer)/i.test(plan.prompt))plan.prompt+=catalog.value('components',"makeup-plan.gold_glitter");
  }
  return plan;
}
function validatePlan(value,base){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Chưa đọc được mô tả. Hãy viết ngắn hơn và thử lại.');
  const plan={...base};
  for(const [key,choices] of Object.entries({intensity:['light','medium','bold'],renderer:['color','ai'],eyeliner:['none','thin','defined'],finish:['matte','satin','gloss']})){
    if(!choices.includes(value[key]))throw Error('Trợ lý trả về thiết lập chưa hợp lệ. Hãy thử đọc mô tả lại.');
    plan[key]=value[key];
  }
  for(const key of ['lip','eyeshadow','blush','brow']){
    const color=key==='brow'?(value[key]??base[key]??'#59443b'):value[key];
    if(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color))throw Error('Không đọc được màu trang điểm. Hãy thử mô tả lại.');
    plan[key]=color.toLowerCase();
  }
  const strengths=value.strengths??base.strengths??{};
  if(!strengths||typeof strengths!=='object'||Array.isArray(strengths)||Object.keys(strengths).some(p=>!parts.includes(p)))throw Error('Độ đậm từng vùng không hợp lệ.');
  plan.strengths={};for(const p of parts){const n=strengths[p]??100;if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>100)throw Error('Độ đậm từng vùng phải từ 0 đến 100%.');plan.strengths[p]=n;}
  if(!Array.isArray(value.parts)||!value.parts.length||value.parts.some(p=>!parts.includes(p)))throw Error('Chưa xác định được vùng trang điểm.');
  plan.parts=[...new Set(value.parts)];
  if(typeof value.prompt!=='string'||!value.prompt.trim()||value.prompt.length>320||value.prompt.trim().split(/\s+/).length>38||/[^\x20-\x7e]/.test(value.prompt))throw Error('Mô tả hiệu ứng quá dài. Hãy mô tả ngắn gọn hơn.');
  plan.prompt=value.prompt.trim();
  plan.summary=typeof value.summary==='string'?value.summary.slice(0,400):'Đã đọc mô tả. Kiểm tra màu, vùng trang điểm và mức độ bên dưới.';
  return plan;
}
async function planMakeup(body,requestLlm,model){
  if(typeof body.style!=='string'||!Object.hasOwn(presets,body.style))throw Error('Phong cách không hợp lệ.');
  if(typeof body.description!=='string'||body.description.length>1000)throw Error('Mô tả tối đa 1000 ký tự.');
  const description=body.description.trim();let base={...presets[body.style],parts,brow:'#59443b',strengths:Object.fromEntries(parts.map(p=>[p,100]))};
  if(body.baseSettings!==undefined)base=validatePlan(body.baseSettings,base);
  if(!description)return {ok:true,...base,description,summary:base.description};
  const properties={prompt:{type:'string',description:catalog.value('components',"makeup-plan.english_translation_of_the_requested_cosmetic_effects"),pattern:'^[ -~]+$'},summary:{type:'string',description:catalog.value('components',"makeup-plan.brief_vietnamese_summary")},parts:{type:'array',items:{type:'string',enum:parts},minItems:1},
    intensity:{type:'string',enum:['light','medium','bold']},renderer:{type:'string',enum:['color','ai']},
    lip:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},eyeshadow:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},blush:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},brow:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},
    eyeliner:{type:'string',enum:['none','thin','defined']},finish:{type:'string',enum:['matte','satin','gloss']}};
  const schema={type:'object',properties,required:Object.keys(properties),additionalProperties:false};
  const result=await requestLlm({model,stream:false,think:false,format:schema,keep_alive:0,options:{temperature:0,num_predict:600,num_ctx:4096},messages:[
    {role:'system',content:catalog.value('components',"makeup-plan.translate_vietnamese_or_english_makeup_requests_to")+JSON.stringify(schema)},
    {role:'user',content:catalog.template('makeup.request',{style:JSON.stringify(base),description})}
  ]});
  let value;try{value=JSON.parse(result.message?.content||result.response||'');}catch{throw Error('Trợ lý chưa đọc được mô tả. Hãy thử lại với câu ngắn hơn.');}
  const plan=explicitOverrides(validatePlan(value,base),description,base),names={lips:'môi',eyes:'mí mắt',brows:'chân mày',cheeks:'má',base:'nền da'};
  validatePlan(plan,base);
  plan.summary='Vùng áp dụng: '+plan.parts.map(p=>names[p]).join(', ')+'. Kiểm tra màu và mức độ bên dưới trước khi xem thử.';
  return {ok:true,...plan,description};
}
module.exports={planMakeup,validatePlan,explicitOverrides};
