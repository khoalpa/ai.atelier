'use strict';
const {validate,renderTemplate}=require('./prompt-store');
function preview(catalog,taskId,variables={},modelId=null){
  validate(catalog);
  if(!variables||typeof variables!=='object'||Array.isArray(variables)||Object.values(variables).some(v=>typeof v!=='string'||v.length>16000))throw Error('Dữ liệu thay biến phải là đối tượng JSON có giá trị văn bản.');
  const task=catalog.tasks[taskId];if(!task)throw Error('Không tìm thấy tác vụ.');
  if(!task.positive&&!task.negative)throw Error('Mục này là chỉ mục sử dụng. Chọn tác vụ có cấu hình positive/negative.');
  const missing=new Set(),refs=new Set();
  function compose(spec,separator){
    if(!spec)return '';
    const vars={...variables};for(const [name,key] of Object.entries(spec.componentBindings||{})){vars[name]=catalog.components[key];refs.add('components:'+key);}
    const parts=(spec.components||[]).map(key=>{refs.add('components:'+key);return catalog.components[key];});
    for(const id of spec.libraryIds||[]){refs.add('library:'+id);parts.push(catalog.library.find(item=>item.id===id).text);}
    if(spec.template){refs.add('templates:'+spec.template);const template=catalog.templates[spec.template];for(const match of template.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g))if(!Object.hasOwn(vars,match[1]))missing.add(match[1]);if(![...template.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].some(m=>!Object.hasOwn(vars,m[1])))parts.push(renderTemplate(template,vars));}
    return parts.join(separator);
  }
  const prompt=compose(task.positive,' '),negativePrompt=compose(task.negative,', ');
  const compiler=require('../packages/prompting/compiler');
  const warnings=catalog.promptQuality?compiler.conflicts(catalog,prompt,negativePrompt):[];
  const policy=modelId&&catalog.promptQuality?compiler.model(catalog,modelId):null;
  if(policy&&!policy.supportsNegative&&negativePrompt)warnings.push('Model này không áp dụng negative prompt.');
  return {taskId,prompt,negativePrompt,effectiveNegativePrompt:policy&&!policy.supportsNegative?'':negativePrompt,warnings,missingVariables:[...missing],references:[...refs],usage:(catalog.catalogUsage||[]).filter(item=>refs.has(item.kind+':'+item.key))};
}
module.exports={preview};
