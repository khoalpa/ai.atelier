// Optional local visual QA against an isolated replay fixture, never user feedback.
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
if(!process.env.QUALITY_FIXTURE_ROOT)throw new Error('Set QUALITY_FIXTURE_ROOT to an isolated replay directory.');
const fixture=path.resolve(process.env.QUALITY_FIXTURE_ROOT);
if(!fs.existsSync(path.join(fixture,'workspace/quality-learning/state.sqlite3')))throw new Error('Missing replay fixture');
const service=require('../app/quality-service').createQualityService(fixture,{python:path.join(root,'.venv-sam2/Scripts/python.exe'),workerPath:path.join(root,'quality_learning.py')});
process.once('exit',()=>service.stop());
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  try{
    if(req.method==='POST'&&url.pathname.startsWith('/api/quality-learning/')){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>65536)throw new Error('Payload too large');}
      const value=await service.call(url.pathname.split('/').pop(),JSON.parse(body||'{}'));
      res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(value));
    }
    if(url.pathname==='/'){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      return res.end('<!doctype html><html lang="vi"><meta charset="utf-8"><title>Quality UI · isolated replay</title><link rel="stylesheet" href="/quality-learning.css"><body style="background:#101719;color:#eee;font:16px system-ui;padding:24px"><h1>Kiểm chứng giao diện · dữ liệu riêng</h1><main id="host"><div class="settings-dashboard"></div></main><script src="/quality-learning.js"></script><script>QualityLearning.mountSettings(document.getElementById("host"));</script></body></html>');
    }
    const base=url.pathname.startsWith('/outputs/')?path.join(fixture,'workspace/outputs'):path.join(root,'app/public');
    const relative=url.pathname.startsWith('/outputs/')?url.pathname.slice(9):url.pathname.slice(1);
    const file=path.resolve(base,relative);
    if(!file.startsWith(base+path.sep))throw new Error('Invalid path');
    res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'image/png');
    res.end(fs.readFileSync(file));
  }catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,error:error.message}));}
}).listen(Number(process.env.QUALITY_UI_PORT||57862),'127.0.0.1',function(){
  console.log(JSON.stringify({ready:true,port:this.address().port,fixture}));
});
