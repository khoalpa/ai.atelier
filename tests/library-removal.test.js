const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert');
const {readRemoved,updateRemoved}=require('../app/library-removal-store');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-library-')),file=path.join(dir,'removed.json');
try{
 assert.deepEqual(readRemoved(file),[]);
 updateRemoved(file,['source:a','result:b']);
 updateRemoved(file,['source:a','reference:c']);
 assert.deepEqual(readRemoved(file),['source:a','result:b','reference:c']);
 updateRemoved(file,[],true);assert.deepEqual(readRemoved(file),[]);
 fs.writeFileSync(file,'broken');assert.throws(()=>readRemoved(file));
 console.log('OK: persistent removal, deduplication, restoration and corrupt-state handling.');
}finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);}
