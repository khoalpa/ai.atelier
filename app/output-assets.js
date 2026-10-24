const fs = require('fs/promises');
const path = require('path');

// Yield during disk access so a large result library does not block job controls.
async function listOutputAssets(root, limit = 200) {
  const pending = [''];
  let assets = [];
  while (pending.length) {
    const prefix = pending.pop();
    let entries;
    try { entries = await fs.readdir(path.join(root, prefix), {withFileTypes:true}); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (let offset = 0; offset < entries.length; offset += 32) {
      const batch = await Promise.all(entries.slice(offset, offset + 32).map(async entry => {
        const relative = path.posix.join(prefix, entry.name);
        if (entry.isDirectory()) { if(!entry.name.endsWith('.tmp'))pending.push(relative); return null; }
        if (prefix.startsWith('manual/') && !/^manual\/[a-f0-9-]{36}\/result\.(png|jpg|webp)$/.test(relative)) return null;
        if (prefix.startsWith('character/') && !/^result_seed_\d+\.png$/.test(entry.name) && entry.name!=='selected.png') return null;
        if (prefix.startsWith('character/')) {try{const meta=JSON.parse(await fs.readFile(path.join(root,prefix,'metadata.json'),'utf8'));if(meta.previewOnly)return null;}catch{return null;}}
        if (!entry.isFile() || !/\.(png|jpe?g|webp)$/i.test(entry.name)) return null;
        if (/^(source|mask|protected_mask|editable_mask|target_pose|preview|garment|reference|control|depth|pose)\.(png|jpe?g|webp)$/i.test(entry.name)) return null;
        try {
          const stat = await fs.stat(path.join(root, relative));
          let meta={};try{meta=JSON.parse(await fs.readFile(path.join(root,prefix,'metadata.json'),'utf8'));}catch{}
          return {id:`output:${relative}`,name:meta.displayName||entry.name,group:'Kết quả',sourceType:'result',url:`/outputs/${relative}`,createdAt:stat.mtime.toISOString(),sizeBytes:stat.size,task:meta.task||meta.taskType||prefix.split('/')[0]||'generation',projectId:meta.projectId,revision:meta.revision,sourceId:typeof (meta.sourceId||meta.sampleId||meta.source)==='string'?(meta.sourceId||meta.sampleId||meta.source):'',width:meta.width,height:meta.height};
        } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      }));
      assets.push(...batch.filter(Boolean));
      assets.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
      assets = assets.slice(0, limit);
    }
  }
  return assets;
}

module.exports = {listOutputAssets};
