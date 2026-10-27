'use strict';
const requireFromApp = require('node:module').createRequire(require('node:path').resolve(__dirname,'../../../app/server.js'));
// Dependencies: LLM_BASE_URL, LLM_MODEL, decodePngDataUrl, fs, http, parseJson, readCatalog, renderTemplate, resolveSamplePath, send
module.exports = function createPrompts(deps) {
const require = requireFromApp;
const __dirname = require('node:path').join(deps.ROOT,'app');
const PROMPT_ASSIST_TASKS = new Proxy({}, {get:(_,key)=>deps.readCatalog().promptAssist.tasks[key]});
const compiler=require('../packages/prompting/compiler');
function checkedText(value,label,maximum=16000){if(typeof value!=='string'||value.length>maximum)throw Error(label+' không hợp lệ hoặc vượt '+maximum+' ký tự.');return value;}

function parseAssistResult(raw, fallback) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const candidate = cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (candidate) try {
    const parsed = JSON.parse(candidate);
    const componentKeys = ['subject','environment','action','composition','style','lighting','color','materials','constraints'];
    const components = parsed.components && typeof parsed.components === 'object' && !Array.isArray(parsed.components)
      ? Object.fromEntries(componentKeys.map((key) => [key, String(parsed.components[key] || '').trim()])) : null;
    const assessment = parsed.assessment && typeof parsed.assessment === 'object' && !Array.isArray(parsed.assessment) ? {
      overallScore: Number.isFinite(Number(parsed.assessment.overallScore)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.assessment.overallScore)))) : null,
      components: Object.fromEntries(componentKeys.map((key) => {
        const item = parsed.assessment.components?.[key] || {};
        return [key,{status:['met','partial','missing'].includes(item.status)?item.status:'missing',note:String(item.note||'').trim().slice(0,500),suggestion:String(item.suggestion||'').trim()}];
      })),
      summary: String(parsed.assessment.summary || '').trim().slice(0, 1000),
    } : null;
    return {
      suggestion: String(parsed.suggestion || fallback || '').trim(),
      changes: Array.isArray(parsed.changes) ? parsed.changes.map(String).slice(0, 5) : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 5) : [],
      qualityScore: Number.isFinite(Number(parsed.qualityScore)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.qualityScore)))) : null,
      components,
      assessment,
    };
  } catch {}
  return { suggestion: cleaned || fallback, changes: [], warnings: [], qualityScore: null };
}

function isPromptRequest(value) {
  const text = String(value || '').trim().toLowerCase();
  return !text || /\?|^(please|can you|could you|would you|create (?:an?|the) (?:image|prompt)|generate (?:an?|the) (?:image|prompt)|write (?:an?|the) prompt|here(?:'s| is)|sure[,!]|hãy|vui lòng|tạo (?:một |ảnh|prompt)|viết (?:một |prompt)|bạn có thể|tôi cần)/i.test(text);
}

function assistantFallback(task, currentText) {
  const idea = String(currentText || '').trim();
  if (task === 'negativePrompt' || task === 'optimizeNegativePrompt') {
    return normalizeNegativePrompt(currentText);
  }
  return idea;
}

function uniquePromptTerms(values) {
  const seen = new Set();
  return values.map((item) => String(item || '').trim().replace(/^[-•\s]+/, '')).filter((item) => {
    const key = item.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function normalizeImagePrompt(value) {
  return String(value || '')
    .replace(/(?:\.|,)?\s*(?:for\s+(?:the\s+)?negative\s*prompt|negative\s*prompt|no\s+negative\s+outcomes|as\s+an\s+ai)\b[\s\S]*$/i, '')
    .replace(/\s+/g, ' ').replace(/[\s,;]+$/, '').trim();
}

function normalizeNegativePrompt(value) {
  const generated = String(value || '').split(/[,\n;]/).filter((term) => {
    const normalized = term.trim().toLowerCase();
    if (!normalized || /^(?:short\s+warning|none|n\/a)$/i.test(normalized)) return false;
    return true;
  });
  return uniquePromptTerms(generated).join(', ');
}

function requestLocalLlm(payload, timeoutMs = 90000) {
  const target = new URL('/api/chat', deps.LLM_BASE_URL);
  if (!['http:', 'https:'].includes(target.protocol)) return Promise.reject(new Error('Địa chỉ LLM không hợp lệ'));
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const transport = target.protocol === 'https:' ? require('https') : deps.http;
    const request = transport.request({
      hostname: target.hostname, port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname, method: 'POST',
      headers: {'Content-Type':'application/json','Content-Length':data.length},
    }, (response) => {
      let responseBody = '';
      response.on('data', (chunk) => { responseBody += chunk; if (Buffer.byteLength(responseBody) > 2 * 1024 * 1024) request.destroy(new Error('Phản hồi LLM quá lớn')); });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody || '{}');
          if ((response.statusCode || 500) >= 400) return reject(new Error(parsed.error || `LLM trả về HTTP ${response.statusCode}`));
          resolve(parsed);
        } catch { reject(new Error('LLM trả về dữ liệu không hợp lệ')); }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('LLM phản hồi quá thời gian')));
    request.on('error', reject);
    request.end(data);
  });
}

async function promptAssist(req, res) {
  try {
    const body = await deps.parseJson(req, 32 * 1024 * 1024);
    const task = String(body.task || '');
    if (task === 'shortenPrompt') throw new Error('Tác vụ rút gọn cho CLIP đã bị loại vĩnh viễn');
    if (!PROMPT_ASSIST_TASKS[task]) throw new Error('Loại gợi ý không được hỗ trợ');
    const currentText = checkedText(body.currentText ?? '', 'Prompt').trim();
    let context = checkedText(body.context ?? '', 'Ngữ cảnh',160000).trim();
    let policy=null;
    if(body.imageModelId){policy=compiler.model(deps.readCatalog(),String(body.imageModelId));context+='\nModel policy: '+JSON.stringify(policy);}
    const quality=deps.readCatalog().promptQuality;
    if(quality&&body.structured===true)context+='\nComponent roles: '+JSON.stringify(quality.componentRules);
    if(quality&&['negativePrompt','optimizeNegativePrompt'].includes(task))context+='\nNegative prompt rules: '+JSON.stringify(quality.negativeRules);
    if(body.lockedComponents!==undefined){
      if(!body.imageModelId||body.structured!==true)throw Error('Khối khóa cần model và chế độ prompt có cấu trúc.');
      compiler.compile(deps.readCatalog(),{modelId:String(body.imageModelId),locked:body.lockedComponents});
    }
    const images = [];
    if (body.imageData) {
      const sources = Array.isArray(body.imageData) ? body.imageData.slice(0,4) : [body.imageData];
      let total = 0;
      for (const source of sources) {
        const match = String(source).match(/^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
        if (!match) throw new Error('Ảnh tham khảo phải là PNG, JPEG hoặc WebP');
        const bytes = Buffer.from(match[1], 'base64');total += bytes.length;
        if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Mỗi ảnh tham khảo phải nhỏ hơn 20 MB');
        images.push(bytes.toString('base64'));
      }
      if (total > 24 * 1024 * 1024) throw new Error('Tổng dung lượng ảnh tham khảo vượt quá 24 MB');
    }
    if (body.sampleId) {
      const source = deps.resolveSamplePath(body.sampleId);
      if (!source || !deps.fs.existsSync(source) || !deps.fs.statSync(source).isFile()) throw new Error('Không tìm thấy ảnh nguồn');
      const bytes = deps.fs.readFileSync(source);
      if (bytes.length > 20 * 1024 * 1024) throw new Error('Ảnh nguồn vượt quá 20 MB');
      images.push(bytes.toString('base64'));
    }
    if (body.mask) images.push(deps.decodePngDataUrl(body.mask).toString('base64'));
    let instruction = deps.renderTemplate(deps.readCatalog().promptAssist.instruction,{task:PROMPT_ASSIST_TASKS[task],currentText:currentText||'(empty)',context:context||'(none)'});
    if (body.structured === true && ['imagePrompt','optimizePrompt','expandPrompt'].includes(task)) {
      instruction = instruction.replace(
        /Return JSON only with this exact shape: \{[^\n]+\}\./,
        deps.readCatalog().components['promptBuilder.structured']
      );
    }
    if (body.evaluation === true && images.length) {
      instruction = instruction.replace(
        /Return JSON only with this exact shape: \{[^\n]+\}\./,
        deps.readCatalog().components['promptBuilder.assessment']
      );
    }
    const message = {role:'user',content:instruction};
    if (images.length) message.images = images;
    const assistant=quality.assistant;
    const result = await requestLocalLlm({model:deps.LLM_MODEL,stream:false,messages:[{role:'system',content:deps.readCatalog().promptAssist.system},message],options:{temperature:assistant.temperature,num_ctx:assistant.contextWindow,num_predict:body.evaluation===true?assistant.outputTokens.evaluation:body.structured===true?assistant.outputTokens.structured:assistant.outputTokens.standard}});
    if(result.done_reason==='length'||result.done===false)throw Error('AI đã chạm giới hạn trả lời; chưa áp dụng nội dung có thể bị cắt. Nội dung hiện tại được giữ nguyên.');
    const assisted = parseAssistResult(result.message?.content || result.response, task === 'analyzePrompt' ? currentText : '');
    if(body.structured===true&&!assisted.components)throw Error('AI chưa trả về các khối prompt có cấu trúc; nội dung hiện tại được giữ nguyên.');
    if (body.evaluation === true && !assisted.assessment) throw Error('AI chưa trả về đánh giá ảnh có cấu trúc; chưa có điểm chất lượng để sử dụng.');
    if (['imagePrompt','optimizePrompt','expandPrompt'].includes(task)) assisted.suggestion = normalizeImagePrompt(assisted.suggestion);
    if (['negativePrompt','optimizeNegativePrompt'].includes(task)) assisted.suggestion = normalizeNegativePrompt(assisted.suggestion);
    assisted.changes = assisted.changes.filter((item) => !/^(?:short change|none|n\/a)$/i.test(String(item).trim()));
    assisted.warnings = assisted.warnings.filter((item) => {
      const text = String(item).trim();
      return !/^(?:short warning|none|n\/a)$/i.test(text) && !(text.length > 5 && String(context || '').toLowerCase().includes(text.toLowerCase()));
    });
    if (task !== 'analyzePrompt' && isPromptRequest(assisted.suggestion)) {
      assisted.suggestion = assistantFallback(task, currentText);
      assisted.changes = [];
      assisted.qualityScore = null;
      assisted.warnings = ['AI không trả về nội dung hợp lệ; hệ thống giữ lại nội dung hiện có.'];
    }
    checkedText(assisted.suggestion,'Kết quả AI');
    if(assisted.components)for(const value of Object.values(assisted.components))checkedText(value,'Khối prompt AI');
    if(assisted.assessment)for(const value of Object.values(assisted.assessment.components))checkedText(value.suggestion,'Gợi ý sửa prompt');
    if(body.structured===true&&assisted.components&&body.imageModelId){
      const compiled=compiler.compile(deps.readCatalog(),{modelId:String(body.imageModelId),components:assisted.components,locked:body.lockedComponents||{}});
      assisted.components=compiled.components;assisted.suggestion=compiled.prompt;assisted.warnings.push(...compiled.warnings);
    }
    if(body.structured===true&&body.lockedComponents&&Object.keys(body.lockedComponents).length&&!assisted.components)throw Error('AI chưa trả về các khối có cấu trúc; nội dung hiện tại và các khối khóa được giữ nguyên.');
    if(policy&&!policy.supportsNegative&&['negativePrompt','optimizeNegativePrompt'].includes(task))assisted.warnings.push('Model đã chọn không áp dụng negative prompt.');
    let tokenCheck=null,tokenError=null;
    if(policy&&typeof deps.callAiJson==='function'&&task!=='analyzePrompt'){
      try{const negativeTask=['negativePrompt','optimizeNegativePrompt'].includes(task);tokenCheck=await deps.callAiJson('/catalog-token-preview',{modelId:String(body.imageModelId),prompt:negativeTask?'':assisted.suggestion,negativePrompt:negativeTask?assisted.suggestion:''});if(!tokenCheck.withinLimits)assisted.warnings.push('Kết quả vượt giới hạn tokenizer; hãy chỉnh sửa trước khi tạo ảnh. Nội dung được giữ nguyên.');}
      catch(error){tokenError=error.message;assisted.warnings.push('Chưa kiểm tra được tokenizer: '+error.message);}
    }
    if (!assisted.suggestion && task !== 'analyzePrompt') throw new Error('LLM không tạo được nội dung gợi ý');
    return deps.send(res, 200, JSON.stringify({ok:true,...assisted,tokenCheck,tokenError,model:deps.LLM_MODEL,usedImage:images.length > 0}));
  } catch (error) {
    const unavailable = /ECONNREFUSED|ENOTFOUND|socket|LLM phản hồi quá thời gian/i.test(String(error.message));
    return deps.send(res, unavailable ? 503 : 400, JSON.stringify({ok:false,error:unavailable?'Trợ lý AI cục bộ chưa sẵn sàng. Hãy chạy Ollama và kiểm tra model cấu hình.':error.message}));
  }
}
return {get PROMPT_ASSIST_TASKS(){return PROMPT_ASSIST_TASKS;},
get parseAssistResult(){return parseAssistResult;},set parseAssistResult(value){parseAssistResult=value;},
get isPromptRequest(){return isPromptRequest;},set isPromptRequest(value){isPromptRequest=value;},
get assistantFallback(){return assistantFallback;},set assistantFallback(value){assistantFallback=value;},
get uniquePromptTerms(){return uniquePromptTerms;},set uniquePromptTerms(value){uniquePromptTerms=value;},
get normalizeImagePrompt(){return normalizeImagePrompt;},set normalizeImagePrompt(value){normalizeImagePrompt=value;},
get normalizeNegativePrompt(){return normalizeNegativePrompt;},set normalizeNegativePrompt(value){normalizeNegativePrompt=value;},
get requestLocalLlm(){return requestLocalLlm;},set requestLocalLlm(value){requestLocalLlm=value;},
get promptAssist(){return promptAssist;},set promptAssist(value){promptAssist=value;}};
};
