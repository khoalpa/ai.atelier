'use strict';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>{if(typeof x!=='string'||x.length>16000)throw Error('Nội dung preset không hợp lệ.');};
function validateFeatures(c){
  if(c.promptQuality!==undefined){
    const q=c.promptQuality,fields=['subject','action','environment','composition','style','lighting','color','materials','constraints'];
    if(!object(q)||q.schemaVersion!==1||!Array.isArray(q.order)||q.order.length!==fields.length||new Set(q.order).size!==fields.length||fields.some(k=>!q.order.includes(k)))throw Error('Thứ tự ghép prompt không hợp lệ.');
    if(!object(q.models)||!Object.keys(q.models).length)throw Error('Thiếu cấu hình encoder.');
    const assistant=q.assistant;
    if(!object(assistant)||!Number.isFinite(assistant.temperature)||assistant.temperature<0||assistant.temperature>2||!Number.isInteger(assistant.contextWindow)||assistant.contextWindow<4096||assistant.contextWindow>131072||!object(assistant.outputTokens))throw Error('Cấu hình trợ lý prompt không hợp lệ.');
    for(const mode of ['standard','structured','evaluation'])if(!Number.isInteger(assistant.outputTokens[mode])||assistant.outputTokens[mode]<128||assistant.outputTokens[mode]>=assistant.contextWindow)throw Error('Giới hạn trả lời trợ lý không hợp lệ.');
    for(const p of Object.values(q.models)){
      if(!object(p)||!['t5','qwen'].includes(p.encoder)||typeof p.pipeline!=='string'||!Number.isInteger(p.maxSequenceLength)||p.maxSequenceLength<32||p.maxSequenceLength>32768||typeof p.supportsNegative!=='boolean'||typeof p.chatTemplate!=='boolean')throw Error('Cấu hình encoder không hợp lệ.');
      if(p.wrapper!==undefined){text(p.wrapper);if(p.wrapper.split('{prompt}').length!==2||/[{}]/.test(p.wrapper.replace('{prompt}',''))||!Number.isInteger(p.wrapperDropTokens)||p.wrapperDropTokens<0||p.wrapperDropTokens>=p.maxSequenceLength)throw Error('Wrapper encoder không hợp lệ.');}
      if(p.pipeline==='Flux2KleinPipeline'&&(p.encoder!=='qwen'||p.supportsNegative||!p.chatTemplate||p.maxSequenceLength>512))throw Error('Klein dùng Qwen, tối đa 512 token và không áp dụng negative prompt.');
      if(p.pipeline==='ChromaPipeline'&&(p.encoder!=='t5'||p.chatTemplate||p.maxSequenceLength>512))throw Error('Chroma dùng T5 tối đa 512 token, không có chat wrapper.');
      if(p.pipeline.startsWith('QwenImage')&&(p.encoder!=='qwen'||!p.chatTemplate||p.maxSequenceLength>1024))throw Error('Cấu hình Qwen-Image không hợp lệ.');
    }
    if(!Array.isArray(q.conflictRules))throw Error('Quy tắc xung đột không hợp lệ.');
    for(const r of q.conflictRules){if(!object(r)||!Array.isArray(r.a)||!Array.isArray(r.b)||!r.a.length||!r.b.length)throw Error('Quy tắc xung đột không hợp lệ.');for(const t of [...r.a,...r.b,r.message])text(t);}
    if(!object(q.assembly)||q.assembly.silentTruncation!==false||q.assembly.overflow!=='reject'||q.assembly.preserveLocked!==true)throw Error('Không được cắt prompt âm thầm hoặc thay đổi khối khóa.');
    for(const k of fields)if(!object(q.componentRules?.[k])||typeof q.componentRules[k].priority!=='number'||!Number.isFinite(q.componentRules[k].priority)||q.componentRules[k].priority<0||q.componentRules[k].priority>100)throw Error('Vai trò thành phần không hợp lệ.');
    for(const preset of Object.values(c.featurePresets['promptBuilder.presets']||{})){if(!object(preset)||Object.keys(preset).some(k=>!fields.includes(k)))throw Error('Khối preset không hợp lệ.');for(const value of Object.values(preset))text(value);}
    for(const value of Object.values(c.featurePresets['promptBuilder.negativePresets']||{}))text(value);
  }
  if(c.personalLibraries!==undefined){
    if(!object(c.personalLibraries))throw Error('Thư viện cá nhân không hợp lệ.');
    const validator=require('./catalog-transfer-store').createStore('.', 'unused');
    for(const [key,data] of Object.entries(c.personalLibraries)){
      if(!['makeup','character','export','color'].includes(key))throw Error('Thư viện không được hỗ trợ: '+key);
      validator.validateLibrary(key,data,c);
    }
  }
  for(const key of ['anatomy.parts','anatomy.parts.defaults'])if(c.featurePresets?.[key]){
    const data=c.featurePresets[key],ids=new Set();if(data.schemaVersion!==1||!Array.isArray(data.items)||!data.items.length)throw Error('Danh sách bộ phận không hợp lệ.');
    for(const item of data.items)require('./anatomy-parts-store').validatePart(item,ids);
  }
  if(!object(c.featurePresets))throw Error('Thiếu nhóm preset tính năng.');
  if(c.featurePresets!==undefined){
    const p=c.featurePresets;if(!object(p))throw Error('Preset tính năng không hợp lệ.');
    for(const key of ['character.actions','character.poses','character.expressions','character.hands','newImage.framing','idm.descriptions']){
      if(!object(p[key]))throw Error('Thiếu preset: '+key);Object.values(p[key]).forEach(text);
    }
    for(const id of Object.keys(p['character.poses']))if(!Object.hasOwn(p['character.actions'],id))throw Error('Tư thế thiếu mô tả: '+id);
    for(const key of ['keep','relaxed','hands_hips','crossed_arms','wave','point','thumbs_up','peace','touch_hair','hand_chest','walk','run','jump','sit','read','hold_cup','show_product','handshake','handover','look_each_other','group','custom'])if(!Object.hasOwn(p['character.poses'],key)||!Object.hasOwn(p['character.actions'],key))throw Error('Thiếu tư thế được hỗ trợ: '+key);
    for(const key of ['keep','smile','laugh','serious','surprised','sad','angry'])if(!Object.hasOwn(p['character.expressions'],key))throw Error('Thiếu biểu cảm: '+key);
    for(const key of ['open','fist','point','peace','thumbs_up','grip'])if(!Object.hasOwn(p['character.hands'],key))throw Error('Thiếu cử chỉ: '+key);
    for(const key of ['as-described','full-body-hands'])if(!Object.hasOwn(p['newImage.framing'],key))throw Error('Thiếu bố cục ảnh: '+key);
    for(const key of ['upper_body','lower_body','overall','full_body'])if(!Object.hasOwn(p['idm.descriptions'],key))throw Error('Thiếu mô tả trang phục: '+key);
    if(!Array.isArray(p['character.fingers'])||p['character.fingers'].length!==5)throw Error('Cần đủ năm tên ngón tay.');p['character.fingers'].forEach(text);
    if(!object(p['makeup.styles']))throw Error('Thiếu phong cách trang điểm.');
    for(const key of ['natural','office','peach','evening','classic','artistic','custom'])if(!object(p['makeup.styles'][key]))throw Error('Thiếu phong cách: '+key);
    for(const x of Object.values(p['makeup.styles'])){
      if(!object(x))throw Error('Phong cách không hợp lệ.');text(x.name);text(x.prompt);text(x.description);
      for(const key of ['lip','eyeshadow','blush'])if(!/^#[a-f0-9]{6}$/i.test(x[key]))throw Error('Màu trang điểm không hợp lệ.');
      if(!['light','medium','bold'].includes(x.intensity)||!['color','ai'].includes(x.renderer)||!['none','thin','defined'].includes(x.eyeliner)||!['matte','satin','gloss'].includes(x.finish))throw Error('Thông số trang điểm không hợp lệ.');
    }
    for(const key of ['enhancement.levels','enhancement.profiles'])if(!object(p[key]))throw Error('Thiếu preset tăng chi tiết.');
    for(const x of Object.values(p['enhancement.levels']))if(typeof x!=='number'||x<0||x>1)throw Error('Mức tăng chi tiết không hợp lệ.');
    for(const x of Object.values(p['enhancement.profiles']))if(!Array.isArray(x)||x.length!==2||x.some(n=>typeof n!=='number'||n<0||n>1))throw Error('Profile tăng chi tiết không hợp lệ.');
    if(!Array.isArray(p['export.defaults']))throw Error('Thiếu preset xuất ảnh.');
    for(const x of p['export.defaults']){text(x.id);text(x.name);require('../packages/editor-core/export').validate(x.spec);}
    const r=c.runtimePresets;
    if(!object(r.textToImage.profiles))throw Error('Thiếu profile tạo ảnh; không dùng giá trị mặc định trong mã.');
    for(const level of ['preview','balanced','quality']){const x=r.characterQuality?.[level];if(!Array.isArray(x)||x.length!==2||!x.every(Number.isInteger)||x[0]<256||x[0]>2048||x[1]<1||x[1]>100)throw Error('Chất lượng nhân vật không hợp lệ.');}
    for(const family of ['flux','standard'])for(const level of ['fast','balanced','detail']){const x=r.outpaintQuality?.[family]?.[level];if(!object(x)||!Number.isInteger(x.steps)||x.steps<1||x.steps>100||!Number.isInteger(x.resolution)||x.resolution<256||x.resolution>2048||['detail','fabric','seam'].some(k=>typeof x[k]!=='boolean'))throw Error('Chất lượng outpaint không hợp lệ.');}
    const d=r.objectRemovalDefaults;if(!object(d)||!object(d.guidance)||!Number.isFinite(d.guidance.flux)||!Number.isFinite(d.guidance.standard)||d.guidance.flux<1||d.guidance.flux>50||d.guidance.standard<1||d.guidance.standard>50||!Number.isFinite(d.strength)||d.strength<0||d.strength>1||!Number.isInteger(d.steps)||d.steps<1||d.steps>100||!Number.isInteger(d.maxSide)||d.maxSide<256||d.maxSide>2048)throw Error('Giá trị dự phòng không hợp lệ.');
  }
  for(const [key,task] of Object.entries(c.tasks))for(const polarity of ['positive','negative']){
    const spec=task[polarity];if(!spec)continue;
    if(spec.componentBindings!==undefined){if(!object(spec.componentBindings))throw Error('Biến thành phần không hợp lệ.');for(const ref of Object.values(spec.componentBindings))if(!Object.hasOwn(c.components,ref))throw Error('Không tìm thấy thành phần: '+ref);}
    if(spec.template){const vars=[...c.templates[spec.template].matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(m=>m[1]);for(const name of Object.keys(spec.componentBindings||{}))if(!vars.includes(name))throw Error('Biến thành phần không có trong template: '+key+'.'+name);}
  }
  if(c.catalogUsage!==undefined&&(!Array.isArray(c.catalogUsage)||c.catalogUsage.some(x=>!object(x)||!['components','templates','featurePresets'].includes(x.kind)||!Object.hasOwn(c[x.kind]||{},x.key)||typeof x.file!=='string'||!Number.isInteger(x.line)||x.line<1)))throw Error('Nơi sử dụng không hợp lệ.');
  if(c.promptAssist.planners!==undefined){
    if(!object(c.promptAssist.planners))throw Error('Hướng dẫn lập kế hoạch không hợp lệ.');
    for(const item of Object.values(c.promptAssist.planners))if(!object(item)||!Object.hasOwn(c.components,item.systemComponent)||(item.requestTemplate&&!Object.hasOwn(c.templates,item.requestTemplate)))throw Error('Tham chiếu hướng dẫn lập kế hoạch không hợp lệ.');
  }
}
module.exports={validateFeatures};
