'use strict';
const requireFromApp = require('node:module').createRequire(require('node:path').resolve(__dirname,'../../../app/server.js'));
// Dependencies: AI_PORT, HOST, MIME, fs, http, path
module.exports = function createTransport(deps) {
const require = requireFromApp;
const __dirname = require('node:path').join(deps.ROOT,'app');
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function safeJoin(base, relativePath) {
  const target = deps.path.resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + deps.path.sep)) return null;
  return target;
}

function parseJson(req, maxBytes = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (Buffer.byteLength(data) > maxBytes) {
        reject(new Error('Payload quá lớn'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('JSON không hợp lệ')); }
    });
    req.on('error', reject);
  });
}

function decodePngDataUrl(value) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value || '');
  if (!match) throw new Error('Dữ liệu mask không hợp lệ');
  return Buffer.from(match[1], 'base64');
}

function decodeImageDataUrl(value) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value || '');
  if (!match) throw new Error('Ảnh tham chiếu phải là PNG, JPEG hoặc WebP');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('Ảnh tham chiếu không hợp lệ hoặc vượt quá 20 MB');
  return { buffer, extension: match[1] === 'jpeg' ? 'jpg' : match[1] };
}

function callAiJson(endpoint, body) {
  return new Promise((resolve,reject)=>{
    const disconnected=()=>reject(Object.assign(new Error('Dịch vụ AI chưa kết nối'),{code:'AI_CONNECTION'}));
    const payload=Buffer.from(JSON.stringify(body),'utf8');
    const request=deps.http.request({hostname:'127.0.0.1',port:deps.AI_PORT,path:endpoint,method:'POST',headers:{'Content-Type':'application/json','Content-Length':payload.length}},response=>{
      let data='';response.on('data',chunk=>data+=chunk);response.on('aborted',disconnected);response.on('error',disconnected);
      response.on('end',()=>{try{const parsed=JSON.parse(data||'{}');if((response.statusCode||500)>=400)return reject(new Error(parsed.error||'Dịch vụ AI từ chối yêu cầu'));resolve(parsed);}catch(error){reject(error);}});
    });request.on('error',disconnected);request.end(payload);
  });
}

function proxyAiHealth(res) {
  deps.http.get({ hostname: '127.0.0.1', port: deps.AI_PORT, path: '/health' }, (upstream) => { let data=''; upstream.on('data',(chunk)=>data+=chunk); upstream.on('end',()=>send(res,upstream.statusCode||500,data)); }).on('error',()=>send(res,503,JSON.stringify({ok:false,error:'Dịch vụ AI chưa chạy'})));
}

function proxyAiGet(res,endpoint){deps.http.get({hostname:'127.0.0.1',port:deps.AI_PORT,path:endpoint},(upstream)=>{let data='';upstream.on('data',(chunk)=>data+=chunk);upstream.on('end',()=>send(res,upstream.statusCode||500,data));}).on('error',()=>send(res,503,JSON.stringify({ok:false,error:'Dịch vụ AI chưa chạy'})));}

function readAiGet(endpoint){return new Promise((resolve)=>{const request=deps.http.get({hostname:'127.0.0.1',port:deps.AI_PORT,path:endpoint,timeout:5000},(upstream)=>{let data='';upstream.on('data',(chunk)=>data+=chunk);upstream.on('end',()=>{try{resolve(JSON.parse(data||'{}'));}catch{resolve({ok:false,error:'Phản hồi AI không hợp lệ'});}});});request.on('timeout',()=>request.destroy());request.on('error',()=>resolve({ok:false,error:'Dịch vụ AI chưa chạy'}));});}

async function proxyToAi(req, res, endpoint = '/segment', maxBytes = 2 * 1024 * 1024) {
  let payload;
  try {
    payload = Buffer.from(JSON.stringify(await parseJson(req, maxBytes)), 'utf8');
  } catch (error) {
    return send(res, 400, JSON.stringify({ ok: false, error: error.message }));
  }
  if(deps.taskCoordinator){
    const body=JSON.parse(payload.toString('utf8'));
    let closed=false;res.once('close',()=>{closed=!res.writableEnded;});
    try{
      let result;
      if(endpoint==='/job-status')result=await deps.taskCoordinator.status(body.jobId);
      else if(endpoint==='/cancel-job')result=await deps.taskCoordinator.cancel(body.jobId);
      else if(endpoint==='/resume-job')result=await deps.taskCoordinator.resume(body.jobId,()=>closed);
      else if(require('../packages/contracts/jobs').forRoute(endpoint)){
        const submitted=await deps.taskCoordinator.enqueue(endpoint,body);
        res.setHeader('X-Atelier-Job-Id',submitted.jobId);
        result=await deps.taskCoordinator.wait(submitted.queueId,()=>closed);
      }else result=undefined;
      if(result!==undefined){if(!closed&&result)send(res,200,JSON.stringify(result));return;}
    }catch(error){if(!closed)send(res,400,JSON.stringify({ok:false,error:error.message}));return;}
  }
  const fail = () => {
    if (!res.destroyed && !res.writableEnded) send(res, 503, JSON.stringify({
      ok: false,
      error: 'Mất kết nối dịch vụ AI. Hãy kiểm tra bộ nhớ GPU và khởi động lại bằng start-ai.ps1.',
    }));
  };
  const upstream = deps.http.request({
    hostname: '127.0.0.1', port: deps.AI_PORT, path: endpoint, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
  }, (upstreamRes) => {
    let data = '';
    upstreamRes.on('data', (chunk) => { data += chunk; });
    upstreamRes.on('aborted', fail);
    upstreamRes.on('error', fail);
    upstreamRes.on('end', () => send(res, upstreamRes.statusCode || 500, data));
  });
  upstream.on('error', fail);
  upstream.end(payload);
}

function serveFile(res, base, relativePath) {
  const file = safeJoin(base, relativePath);
  if (!file || !deps.fs.existsSync(file) || !deps.fs.statSync(file).isFile()) {
    return send(res, 404, JSON.stringify({ error: 'Không tìm thấy tệp' }));
  }
  const type = deps.MIME[deps.path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  deps.fs.createReadStream(file).pipe(res);
}

function streamJobEvents(req, res, jobId) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(jobId)) return send(res, 400, JSON.stringify({ ok:false, error:'Mã tác vụ không hợp lệ' }));
  res.writeHead(200, {
    'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-cache, no-store',
    'Connection':'keep-alive', 'X-Accel-Buffering':'no', 'X-Content-Type-Options':'nosniff',
  });
  res.write('retry: 1500\n\n');
  let closed=false,busy=false,lastPayload='';
  const poll=async()=>{
    if(closed||busy)return;busy=true;
    try{
      const state=deps.taskCoordinator?await deps.taskCoordinator.status(jobId):await callAiJson('/job-status',{jobId});
      if(closed)return;const encoded=JSON.stringify(state);
      if(encoded!==lastPayload){lastPayload=encoded;res.write(`event: state\ndata: ${encoded}\n\n`);}
      if(['completed','cancelled','failed'].includes(state.status)){res.write('event: end\ndata: {}\n\n');clearInterval(timer);res.end();}
    }catch{if(!closed)res.write('event: heartbeat\ndata: {}\n\n');}finally{busy=false;}
  };
  const timer=setInterval(poll,800);poll();
  req.on('close',()=>{closed=true;clearInterval(timer);});
}
return {get send(){return send;},set send(value){send=value;},
get safeJoin(){return safeJoin;},set safeJoin(value){safeJoin=value;},
get parseJson(){return parseJson;},set parseJson(value){parseJson=value;},
get decodePngDataUrl(){return decodePngDataUrl;},set decodePngDataUrl(value){decodePngDataUrl=value;},
get decodeImageDataUrl(){return decodeImageDataUrl;},set decodeImageDataUrl(value){decodeImageDataUrl=value;},
get callAiJson(){return callAiJson;},set callAiJson(value){callAiJson=value;},
get proxyAiHealth(){return proxyAiHealth;},set proxyAiHealth(value){proxyAiHealth=value;},
get proxyAiGet(){return proxyAiGet;},set proxyAiGet(value){proxyAiGet=value;},
get readAiGet(){return readAiGet;},set readAiGet(value){readAiGet=value;},
get proxyToAi(){return proxyToAi;},set proxyToAi(value){proxyToAi=value;},
get serveFile(){return serveFile;},set serveFile(value){serveFile=value;},
get streamJobEvents(){return streamJobEvents;},set streamJobEvents(value){streamJobEvents=value;}};
};
