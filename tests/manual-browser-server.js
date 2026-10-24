// Local-only visual renderer checks using the same worker and saved fixtures.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),assets=new Map();
http.createServer(async(req,res)=>{try{
 if(!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host||'')||(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host))throw Error('Local requests only');
 const u=new URL(req.url,'http://127.0.0.1');
 if(req.method==='POST'&&u.pathname==='/api/manual/assets'){
  let text='';for await(const chunk of req){text+=chunk;if(text.length>1048576)throw Error('Too large');}
  const data=JSON.parse(text).data;if(!/^data:image\/png;base64,/.test(data))throw Error('PNG only');
  const bytes=Buffer.from(data.split(',')[1],'base64'),url='/manual-assets/'+crypto.createHash('sha256').update(bytes).digest('hex')+'.png';assets.set(url,bytes);
  res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,asset:{url}}));
 }
 if(req.method!=='GET')throw Error('Read only');
 if(assets.has(u.pathname)){res.setHeader('Content-Type','image/png');return res.end(assets.get(u.pathname));}
 const base=u.pathname.startsWith('/manual-assets/')?path.join(root,'workspace/manual/assets'):path.join(root,'app/public');
 const file=u.pathname==='/'?path.join(__dirname,'manual-browser.html'):path.resolve(base,path.basename(u.pathname));
 if(u.pathname!=='/'&&!file.startsWith(base+path.sep))throw Error('Invalid path');
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.html')?'text/html; charset=utf-8':'image/png');res.end(await fs.readFile(file));
 }catch(e){res.writeHead(404);res.end(e.message);}
}).listen(Number(process.env.MANUAL_TEST_PORT||57863),'127.0.0.1',function(){console.log('Manual renderer checks at http://127.0.0.1:'+this.address().port);});
