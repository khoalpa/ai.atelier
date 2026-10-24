const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {listOutputAssets}=require('../app/output-assets');
(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'atelier-assets-'));
  try {
    assert.deepEqual(await listOutputAssets(path.join(dir,'missing')),[]);
    for(const [name,time] of [['old/a.png',100],['new/b.webp',300],['root.jpg',200],['ignored.json',400]]) {
      const file=path.join(dir,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'image');await fs.utimes(file,time,time);
    }
    const assets=await listOutputAssets(dir,2);
    assert.deepEqual(assets.map(item=>item.id),['output:new/b.webp','output:root.jpg']);
    assert.equal(assets[0].task,'new');assert.equal(assets[0].url,'/outputs/new/b.webp');
    assert.equal(assets[0].sizeBytes,5);
    assert.equal((await listOutputAssets(dir)).length,3);
    console.log('OK: async library scan returns the newest results across nested folders.');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
