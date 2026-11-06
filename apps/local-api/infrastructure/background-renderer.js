'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
function browserPath(){return [process.env.ATELIER_RENDER_BROWSER,path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),path.join(process.env.PROGRAMFILES||'C:/Program Files','Google/Chrome/Application/chrome.exe')].find(p=>p&&fs.existsSync(p))||'';}
function createRenderer(root, origin, options={}) {
  const token=crypto.randomBytes(32).toString('hex');let child=null, pending=null, stopped=false;
  function fail(message){if(pending){clearTimeout(pending.timer);pending.reject(Error(message));pending=null;}}
  function start(){
    if(child)return;
    const executable=options.browser||browserPath();if(!executable)throw Error('Cần Microsoft Edge hoặc Chrome trên máy để xuất ảnh nền.');
    const profile=path.join(root,'workspace/runtime/render-'+crypto.randomUUID());fs.mkdirSync(profile,{recursive:true});
    child=spawn(process.execPath,[path.join(__dirname,'render-host.js'),executable,origin+'/background-render.html#'+token,profile,root],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
    const current=child;
    const ended=()=>{if(child!==current)return;child=null;fail('Bộ dựng ảnh nền đã dừng. Có thể tiếp tục lô từ Hoạt động.');};
    child.once('error',ended);child.once('exit',ended);
  }
  function render(document,spec){
    if(stopped)return Promise.reject(Error('Dịch vụ đang đóng.'));
    if(pending)return Promise.reject(Error('Bộ dựng ảnh đang bận.'));
    return new Promise((resolve,reject)=>{const id=crypto.randomUUID();pending={id,document,spec,resolve,reject,claimed:false,timer:setTimeout(()=>{fail('Dựng ảnh quá thời gian. Hãy tiếp tục lại lô.');child?.disconnect();child=null;},options.timeoutMs||120000)};try{start();}catch(e){fail(e.message);}});
  }
  function work(provided){if(provided!==token)throw Error('Phiên dựng ảnh không hợp lệ.');if(!pending||pending.claimed)return null;pending.claimed=true;return {id:pending.id,document:pending.document,spec:pending.spec};}
  function complete(body){if(body.token!==token)throw Error('Phiên dựng ảnh không hợp lệ.');if(!pending||body.id!==pending.id)throw Error('Kết quả dựng ảnh đã hết hiệu lực.');if(body.error){fail(String(body.error).slice(0,500));return;}if(!/^data:image\/(png|jpeg|webp);base64,/.test(body.data||''))throw Error('Ảnh xuất không hợp lệ.');clearTimeout(pending.timer);const done=pending;pending=null;done.resolve(body.data);}
  function stop(){stopped=true;fail('Dịch vụ đang đóng.');if(child?.connected)child.disconnect();child=null;}
  return {render,work,complete,stop,available:()=>Boolean(options.browser||browserPath())};
}
module.exports={createRenderer,browserPath};
