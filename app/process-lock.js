'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
function alive(pid) { try { process.kill(pid,0); return true; } catch(e) { return e.code !== 'ESRCH'; } }
async function acquire(file, waitMs=0) {
  await fs.mkdir(path.dirname(file), {recursive:true}); const deadline=Date.now()+waitMs;
  const token=crypto.randomUUID();
  do {
    try {
      const handle=await fs.open(file,'wx');
      try { await handle.writeFile(JSON.stringify({pid:process.pid,token,createdAt:Date.now()})); } finally { await handle.close(); }
      return async()=>{try { const current=JSON.parse(await fs.readFile(file,'utf8')); if(current.token===token)await fs.unlink(file); } catch(e){if(e.code!=='ENOENT')throw e;} };
    } catch(e) {
      if(e.code!=='EEXIST')throw e;
      try {
        const stat=await fs.stat(file), text=await fs.readFile(file,'utf8'); let owner;
        try { owner=JSON.parse(text); } catch {}
        if (owner?.pid ? !alive(owner.pid) : Date.now()-stat.mtimeMs>30000) {
          // One reaper owns recovery, so competing web instances cannot remove a new lock.
          const reaper=await acquire(file+'.recover');
          if(reaper) { try { if(await fs.readFile(file,'utf8')===text)await fs.unlink(file); } finally { await reaper(); } }
        }
      } catch(e){if(e.code!=='ENOENT')throw e;}
      if(Date.now()>=deadline)return null; await delay(40);
    }
  } while(true);
}
async function locked(file, fn) { const release=await acquire(file,10000); if(!release)throw Error('Dữ liệu đang được cập nhật. Hãy thử lại.');try{return await fn();}finally{await release();} }
module.exports={acquire,locked,alive};
