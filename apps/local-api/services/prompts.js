'use strict';
const requireFromApp = require('node:module').createRequire(require('node:path').resolve(__dirname,'../../../app/server.js'));
// Dependencies: LLM_BASE_URL, LLM_MODEL, decodePngDataUrl, fs, http, parseJson, readCatalog, renderTemplate, resolveSamplePath, send
module.exports = function createPrompts(deps) {
const require = requireFromApp;
const __dirname = require('node:path').join(deps.ROOT,'app');
const PROMPT_ASSIST_TASKS = new Proxy({}, {get:(_,key)=>deps.readCatalog().promptAssist.tasks[key]});

function parseAssistResult(raw, fallback) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const candidate = cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (candidate) try {
    const parsed = JSON.parse(candidate);
    return {
      suggestion: String(parsed.suggestion || fallback || '').trim(),
      changes: Array.isArray(parsed.changes) ? parsed.changes.map(String).slice(0, 5) : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 5) : [],
      qualityScore: Number.isFinite(Number(parsed.qualityScore)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.qualityScore)))) : null,
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
    if (!PROMPT_ASSIST_TASKS[task]) throw new Error('Loại gợi ý không được hỗ trợ');
    const currentText = String(body.currentText || '').trim().slice(0, 4000);
    let context = String(body.context || '').trim().slice(0, 2000);
    if(body.imageModelId){const id=String(body.imageModelId),family=id==='sd35-medium'?'sd35':id==='flux-chroma1-hd'?'chroma':id==='flux-2-klein-4b'?'klein':'sdxl';const limits={sd35:'CLIP 77 tokens; T5 256 tokens. A separate short CLIP description is supported.',sdxl:'Both CLIP encoders allow 77 tokens.',chroma:'T5 allows 512 tokens.',klein:'Qwen allows 512 tokens including its chat wrapper. Negative prompts are not supported.'};context += '\nModel: '+id+'. '+limits[family]+(body.shortClip?' Produce a short description well below 77 tokens. Preserve the main subject, action and constraints.':'');}
    const images = [];
    if (body.sampleId) {
      const source = deps.resolveSamplePath(body.sampleId);
      if (!source || !deps.fs.existsSync(source) || !deps.fs.statSync(source).isFile()) throw new Error('Không tìm thấy ảnh nguồn');
      const bytes = deps.fs.readFileSync(source);
      if (bytes.length > 20 * 1024 * 1024) throw new Error('Ảnh nguồn vượt quá 20 MB');
      images.push(bytes.toString('base64'));
    }
    if (body.mask) images.push(deps.decodePngDataUrl(body.mask).toString('base64'));
    const instruction = deps.renderTemplate(deps.readCatalog().promptAssist.instruction,{task:PROMPT_ASSIST_TASKS[task],currentText:currentText||'(empty)',context:context||'(none)'});
    const message = {role:'user',content:instruction};
    if (images.length) message.images = images;
    const result = await requestLocalLlm({model:deps.LLM_MODEL,stream:false,messages:[{role:'system',content:deps.readCatalog().promptAssist.system},message],options:{temperature:0.2,num_predict:320}});
    const assisted = parseAssistResult(result.message?.content || result.response, task === 'analyzePrompt' ? currentText : '');
    if (['imagePrompt','optimizePrompt','shortenPrompt','expandPrompt'].includes(task)) assisted.suggestion = normalizeImagePrompt(assisted.suggestion);
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
    assisted.suggestion = assisted.suggestion.slice(0, 4000);
    if (!assisted.suggestion && task !== 'analyzePrompt') throw new Error('LLM không tạo được nội dung gợi ý');
    return deps.send(res, 200, JSON.stringify({ok:true,...assisted,model:deps.LLM_MODEL,usedImage:images.length > 0}));
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
