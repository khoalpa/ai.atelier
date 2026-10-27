(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AtelierPromptCompiler=factory();})(globalThis,()=>{
  'use strict';
  function model(catalog,id){const policy=catalog.promptQuality?.models?.[id];if(!policy)throw Error('Chưa có cấu hình encoder cho model: '+id);return policy;}
  function conflicts(catalog,positive,negative=''){
    const hits=(text,terms)=>terms.some(term=>new RegExp('(^|[^\\p{L}\\p{N}])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^\\p{L}\\p{N}])','iu').test(text));
    const warnings=[];
    for(const rule of catalog.promptQuality.conflictRules)if(hits(positive,rule.a)&&hits(positive,rule.b))warnings.push(rule.message);
    for(const term of negative.split(/[,;\n]+/).map(s=>s.trim()).filter(s=>s.length>3))if(hits(positive,[term]))warnings.push('Nội dung xuất hiện ở cả prompt chính và negative: '+term);
    return [...new Set(warnings)];
  }
  function compile(catalog,{modelId,components={},locked={},negativePrompt=''}){
    const policy=model(catalog,modelId),rules=catalog.promptQuality,seen=new Set(),parts=[],resolved={};
    if(!components||typeof components!=='object'||Array.isArray(components)||!locked||typeof locked!=='object'||Array.isArray(locked))throw Error('Các khối prompt phải là một đối tượng.');
    for(const key of [...Object.keys(components),...Object.keys(locked)])if(!rules.order.includes(key))throw Error('Khối prompt không được hỗ trợ: '+key);
    for(const key of rules.order){
      const value=Object.hasOwn(locked,key)?locked[key]:components[key]??'';
      if(typeof value!=='string'||value.length>16000)throw Error('Khối prompt không hợp lệ: '+key);
      resolved[key]=value;const normalized=value.trim().replace(/\s+/g,' ').toLocaleLowerCase();
      if(!normalized||(!Object.hasOwn(locked,key)&&seen.has(normalized)))continue;
      seen.add(normalized);parts.push(Object.hasOwn(locked,key)?value:value.trim());
    }
    const prompt=parts.reduce((text,part)=>text?text+(/[.!?]\s*$/.test(text)?' ':'. ')+part:part,'');
    if(prompt.length>16000||typeof negativePrompt!=='string'||negativePrompt.length>16000)throw Error('Prompt vượt giới hạn dữ liệu 16000 ký tự.');
    const warnings=conflicts(catalog,prompt,policy.supportsNegative?negativePrompt:'');
    if(!policy.supportsNegative&&negativePrompt.trim())warnings.push('Model này không áp dụng negative prompt; nội dung này được giữ trong ô nhập và không gửi đến model.');
    return {prompt,negativePrompt:policy.supportsNegative?negativePrompt:'',components:resolved,warnings,policy};
  }
  return {model,compile,conflicts};
});
